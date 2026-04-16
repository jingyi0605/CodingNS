import { spawn } from "node:child_process";
import path from "node:path";

import type { TerminalTemplateRuntimeStatus } from "../../types/domain.js";

interface PortProcessInfo {
  processId: number;
  parentProcessId: number | null;
  processGroupId: number | null;
  processName: string | null;
  processCommandLine: string | null;
  parentProcessName: string | null;
  parentProcessCommandLine: string | null;
  terminationScope: "process" | "process_group";
}

export async function discoverTemplateRuntimeStatuses(
  items: Array<{ templateId: string; port: number }>,
  signal?: AbortSignal
): Promise<TerminalTemplateRuntimeStatus[]> {
  throwIfAborted(signal);
  const uniquePorts = [...new Set(items.map((item) => item.port))];
  const processInfoByPort = new Map<number, PortProcessInfo | null>();

  await Promise.all(
    uniquePorts.map(async (port) => {
      processInfoByPort.set(port, await findPortProcess(port, signal));
    })
  );

  throwIfAborted(signal);
  return items.map((item) => {
    const processInfo = processInfoByPort.get(item.port) ?? null;

    return {
      templateId: item.templateId,
      port: item.port,
      occupied: processInfo !== null,
      processId: processInfo?.processId ?? null,
      parentProcessId: processInfo?.parentProcessId ?? null,
      processGroupId: processInfo?.processGroupId ?? null,
      processName: processInfo?.processName ?? null,
      processCommandLine: processInfo?.processCommandLine ?? null,
      parentProcessName: processInfo?.parentProcessName ?? null,
      parentProcessCommandLine: processInfo?.parentProcessCommandLine ?? null,
      terminationScope: processInfo?.terminationScope ?? null
    };
  });
}

export async function terminateRuntimeProcess(processInfo: PortProcessInfo): Promise<void> {
  if (!Number.isInteger(processInfo.processId) || processInfo.processId <= 0) {
    throw new Error(`invalid process id: ${processInfo.processId}`);
  }

  if (process.platform === "win32") {
    await runProcess("taskkill", ["/PID", String(processInfo.processId), "/T", "/F"]);
    return;
  }

  if (
    processInfo.terminationScope === "process_group" &&
    Number.isInteger(processInfo.processGroupId) &&
    (processInfo.processGroupId ?? 0) > 0
  ) {
    const processGroupId = processInfo.processGroupId as number;

    // 如果目标就是当前 Host 所在进程组，改用脱离的 helper 延后执行，先把 HTTP 响应发出去。
    if (await shouldDeferPosixProcessGroupTermination(processInfo.processId, processGroupId)) {
      scheduleDeferredPosixTermination({
        processId: processInfo.processId,
        processGroupId
      });
      return;
    }

    signalPosixProcessGroup(processGroupId, "SIGTERM");
    await waitForProcessGroupExit(processGroupId, 1500);

    if (isProcessGroupAlive(processGroupId)) {
      signalPosixProcessGroup(processGroupId, "SIGKILL");
      await waitForProcessGroupExit(processGroupId, 1500);
    }

    return;
  }

  if (await shouldDeferPosixProcessTermination(processInfo.processId)) {
    scheduleDeferredPosixTermination({
      processId: processInfo.processId,
      processGroupId: null
    });
    return;
  }

  process.kill(processInfo.processId, "SIGTERM");
  await waitForProcessExit(processInfo.processId, 1500);

  if (isProcessAlive(processInfo.processId)) {
    process.kill(processInfo.processId, "SIGKILL");
    await waitForProcessExit(processInfo.processId, 1500);
  }
}

async function findPortProcess(port: number, signal?: AbortSignal): Promise<PortProcessInfo | null> {
  throwIfAborted(signal);

  if (process.platform === "win32") {
    return await findWindowsPortProcess(port, signal);
  }

  return await findPosixPortProcess(port, signal);
}

async function findWindowsPortProcess(port: number, signal?: AbortSignal): Promise<PortProcessInfo | null> {
  const shellPath =
    process.env.SYSTEMROOT
      ? path.join(process.env.SYSTEMROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
  const script = [
    `$port=${port}`,
    "$connection = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $connection) { return }",
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($connection.OwningProcess)\" | Select-Object ProcessId, ParentProcessId, Name, CommandLine",
    "if (-not $process) { return }",
    "$process | ConvertTo-Json -Compress"
  ].join("; ");
  const stdout = await tryRunProcess(shellPath, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], signal);

  if (!stdout?.trim()) {
    return null;
  }

  const parsed = JSON.parse(stdout) as WindowsProcessInfo;

  if (!Number.isInteger(parsed.ProcessId) || parsed.ProcessId <= 0) {
    return null;
  }

  const parentProcessId = normalizeOptionalPositiveInteger(parsed.ParentProcessId);
  const parentProcess = parentProcessId ? await lookupWindowsProcess(parentProcessId, signal) : null;

  return {
    processId: parsed.ProcessId,
    parentProcessId,
    processGroupId: null,
    processName: parsed.Name?.trim() || null,
    processCommandLine: parsed.CommandLine?.trim() || null,
    parentProcessName: parentProcess?.Name?.trim() || null,
    parentProcessCommandLine: parentProcess?.CommandLine?.trim() || null,
    terminationScope: "process"
  };
}

async function findPosixPortProcess(port: number, signal?: AbortSignal): Promise<PortProcessInfo | null> {
  if (process.platform === "linux") {
    const ssInfo = await findLinuxPortProcessWithSs(port, signal);

    if (ssInfo) {
      return ssInfo;
    }
  }

  return await findPosixPortProcessWithLsof(port, signal);
}

async function findLinuxPortProcessWithSs(port: number, signal?: AbortSignal): Promise<PortProcessInfo | null> {
  const stdout = await tryRunProcess("ss", ["-ltnp"], signal);

  if (!stdout) {
    return null;
  }

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes(`:${port}`) || !line.includes("LISTEN")) {
      continue;
    }

    const matched = line.match(/users:\(\("([^"]+)",pid=(\d+),fd=\d+\)\)/);

    if (!matched) {
      continue;
    }

    const [, processName, processIdText] = matched;
    const processId = Number(processIdText);

    if (!Number.isInteger(processId) || processId <= 0) {
      continue;
    }

    return await enrichPosixProcess(processId, processName, signal);
  }

  return null;
}

async function findPosixPortProcessWithLsof(port: number, signal?: AbortSignal): Promise<PortProcessInfo | null> {
  const stdout = await tryRunProcess("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-Fpct"
  ], signal);

  if (!stdout) {
    return null;
  }

  let processId: number | null = null;
  let processName: string | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      processId = Number.isInteger(parsed) ? parsed : null;
      continue;
    }

    if (line.startsWith("c")) {
      processName = line.slice(1).trim() || null;
    }

    if (processId) {
      return await enrichPosixProcess(processId, processName, signal);
    }
  }

  return null;
}

async function enrichPosixProcess(
  processId: number,
  fallbackName: string | null,
  signal?: AbortSignal
): Promise<PortProcessInfo | null> {
  const currentProcess = await lookupPosixProcess(processId, fallbackName, signal);

  if (!currentProcess) {
    return null;
  }

  const parentProcess =
    currentProcess.parentProcessId !== null
      ? await lookupPosixProcess(currentProcess.parentProcessId, null, signal)
      : null;

  return {
    processId: currentProcess.processId,
    parentProcessId: currentProcess.parentProcessId,
    processGroupId: currentProcess.processGroupId,
    processName: currentProcess.processName,
    processCommandLine: currentProcess.processCommandLine,
    parentProcessName: parentProcess?.processName ?? null,
    parentProcessCommandLine: parentProcess?.processCommandLine ?? null,
    terminationScope: currentProcess.processGroupId ? "process_group" : "process"
  };
}

async function tryRunProcess(
  command: string,
  args: string[],
  signal?: AbortSignal
): Promise<string | null> {
  try {
    return await runProcess(command, args, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return null;
  }
}

async function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let onAbort: (() => void) | null = null;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;

      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }

      callback();
    };

    if (signal) {
      onAbort = () => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }

        finish(() => {
          reject(signal.reason ?? new Error("template runtime discovery aborted"));
        });
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });
    child.on("close", (exitCode) => {
      finish(() => {
        if (exitCode !== 0) {
          reject(new Error(stderr.trim() || `${command} exited with code ${exitCode ?? "unknown"}`));
          return;
        }

        resolve(stdout);
      });
    });
  });
}

async function lookupPosixProcess(
  processId: number,
  fallbackName: string | null,
  signal?: AbortSignal
): Promise<{
  processId: number;
  parentProcessId: number | null;
  processGroupId: number | null;
  processName: string | null;
  processCommandLine: string | null;
} | null> {
  if (!Number.isInteger(processId) || processId <= 0) {
    return null;
  }

  const [parentProcessIdText, processGroupIdText, processNameText, processCommandLine] = await Promise.all([
    tryRunProcess("ps", ["-p", String(processId), "-o", "ppid="], signal),
    tryRunProcess("ps", ["-p", String(processId), "-o", "pgid="], signal),
    tryRunProcess("ps", ["-p", String(processId), "-o", "comm="], signal),
    tryRunProcess("ps", ["-p", String(processId), "-o", "args="], signal)
  ]);

  const processName = processNameText?.trim() || fallbackName;
  const commandLine = processCommandLine?.trim() || null;

  if (!processName && !commandLine) {
    return null;
  }

  return {
    processId,
    parentProcessId: normalizeOptionalPositiveInteger(parentProcessIdText),
    processGroupId: normalizeOptionalPositiveInteger(processGroupIdText),
    processName,
    processCommandLine: commandLine
  };
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return false;
    }

    throw error;
  }
}

function isProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return false;
    }

    throw error;
  }
}

function signalPosixProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  process.kill(-processGroupId, signal);
}

async function waitForProcessExit(processId: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(processId)) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
}

async function waitForProcessGroupExit(processGroupId: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessGroupAlive(processGroupId)) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
}

interface WindowsProcessInfo {
  ProcessId: number;
  ParentProcessId?: number | null;
  Name: string | null;
  CommandLine: string | null;
}

async function lookupWindowsProcess(processId: number, signal?: AbortSignal): Promise<WindowsProcessInfo | null> {
  const shellPath =
    process.env.SYSTEMROOT
      ? path.join(process.env.SYSTEMROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
  const script = [
    `$processId=${processId}`,
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $processId\" | Select-Object ProcessId, ParentProcessId, Name, CommandLine",
    "if (-not $process) { return }",
    "$process | ConvertTo-Json -Compress"
  ].join("; ");
  const stdout = await tryRunProcess(shellPath, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], signal);

  if (!stdout?.trim()) {
    return null;
  }

  return JSON.parse(stdout) as WindowsProcessInfo;
}

async function shouldDeferPosixProcessTermination(processId: number): Promise<boolean> {
  return processId === process.pid;
}

async function shouldDeferPosixProcessGroupTermination(
  processId: number,
  processGroupId: number
): Promise<boolean> {
  if (processId === process.pid) {
    return true;
  }

  const currentProcessGroupId = await lookupCurrentPosixProcessGroupId();
  return currentProcessGroupId !== null && currentProcessGroupId === processGroupId;
}

let currentPosixProcessGroupIdPromise: Promise<number | null> | null = null;

async function lookupCurrentPosixProcessGroupId(): Promise<number | null> {
  if (!currentPosixProcessGroupIdPromise) {
    currentPosixProcessGroupIdPromise = (async () => {
      const stdout = await tryRunProcess("ps", ["-p", String(process.pid), "-o", "pgid="]);
      return normalizeOptionalPositiveInteger(stdout);
    })();
  }

  return await currentPosixProcessGroupIdPromise;
}

function scheduleDeferredPosixTermination(input: {
  processId: number;
  processGroupId: number | null;
}): void {
  const target =
    input.processGroupId && input.processGroupId > 0
      ? `kill -TERM -- -${input.processGroupId} 2>/dev/null || kill -TERM ${input.processId} 2>/dev/null || true`
      : `kill -TERM ${input.processId} 2>/dev/null || true`;
  const forceTarget =
    input.processGroupId && input.processGroupId > 0
      ? `kill -KILL -- -${input.processGroupId} 2>/dev/null || kill -KILL ${input.processId} 2>/dev/null || true`
      : `kill -KILL ${input.processId} 2>/dev/null || true`;
  const script = `sleep 0.2; ${target}; sleep 1.5; ${forceTarget}`;
  const helper = spawn("sh", ["-c", script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  helper.unref();
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("template runtime discovery aborted");
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.includes("aborted");
}
