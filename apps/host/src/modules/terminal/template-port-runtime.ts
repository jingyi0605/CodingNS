import { spawn } from "node:child_process";
import path from "node:path";

import type { TerminalTemplateRuntimeStatus } from "../../types/domain.js";

interface PortProcessInfo {
  processId: number;
  processName: string | null;
  processCommandLine: string | null;
}

export async function discoverTemplateRuntimeStatuses(
  items: Array<{ templateId: string; port: number }>
): Promise<TerminalTemplateRuntimeStatus[]> {
  const uniquePorts = [...new Set(items.map((item) => item.port))];
  const processInfoByPort = new Map<number, PortProcessInfo | null>();

  await Promise.all(
    uniquePorts.map(async (port) => {
      processInfoByPort.set(port, await findPortProcess(port));
    })
  );

  return items.map((item) => {
    const processInfo = processInfoByPort.get(item.port) ?? null;

    return {
      templateId: item.templateId,
      port: item.port,
      occupied: processInfo !== null,
      processId: processInfo?.processId ?? null,
      processName: processInfo?.processName ?? null,
      processCommandLine: processInfo?.processCommandLine ?? null
    };
  });
}

export async function terminateRuntimeProcess(processId: number): Promise<void> {
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error(`invalid process id: ${processId}`);
  }

  if (process.platform === "win32") {
    await runProcess("taskkill", ["/PID", String(processId), "/T", "/F"]);
    return;
  }

  process.kill(processId, "SIGTERM");
  await waitForProcessExit(processId, 1500);

  if (isProcessAlive(processId)) {
    process.kill(processId, "SIGKILL");
    await waitForProcessExit(processId, 1500);
  }
}

async function findPortProcess(port: number): Promise<PortProcessInfo | null> {
  if (process.platform === "win32") {
    return await findWindowsPortProcess(port);
  }

  return await findPosixPortProcess(port);
}

async function findWindowsPortProcess(port: number): Promise<PortProcessInfo | null> {
  const shellPath =
    process.env.SYSTEMROOT
      ? path.join(process.env.SYSTEMROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
  const script = [
    `$port=${port}`,
    "$connection = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $connection) { return }",
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($connection.OwningProcess)\" | Select-Object ProcessId, Name, CommandLine",
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
  ]);

  if (!stdout?.trim()) {
    return null;
  }

  const parsed = JSON.parse(stdout) as WindowsProcessInfo;

  if (!Number.isInteger(parsed.ProcessId) || parsed.ProcessId <= 0) {
    return null;
  }

  return {
    processId: parsed.ProcessId,
    processName: parsed.Name?.trim() || null,
    processCommandLine: parsed.CommandLine?.trim() || null
  };
}

async function findPosixPortProcess(port: number): Promise<PortProcessInfo | null> {
  if (process.platform === "linux") {
    const ssInfo = await findLinuxPortProcessWithSs(port);

    if (ssInfo) {
      return ssInfo;
    }
  }

  return await findPosixPortProcessWithLsof(port);
}

async function findLinuxPortProcessWithSs(port: number): Promise<PortProcessInfo | null> {
  const stdout = await tryRunProcess("ss", ["-ltnp"]);

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

    return await enrichPosixProcess(processId, processName);
  }

  return null;
}

async function findPosixPortProcessWithLsof(port: number): Promise<PortProcessInfo | null> {
  const stdout = await tryRunProcess("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-Fpct"
  ]);

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
      return await enrichPosixProcess(processId, processName);
    }
  }

  return null;
}

async function enrichPosixProcess(
  processId: number,
  fallbackName: string | null
): Promise<PortProcessInfo | null> {
  const processName = (await tryRunProcess("ps", ["-p", String(processId), "-o", "comm="]))?.trim() || fallbackName;
  const processCommandLine =
    (await tryRunProcess("ps", ["-p", String(processId), "-o", "args="]))?.trim() || null;

  return {
    processId,
    processName,
    processCommandLine
  };
}

async function tryRunProcess(command: string, args: string[]): Promise<string | null> {
  try {
    return await runProcess(command, args);
  } catch {
    return null;
  }
}

async function runProcess(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with code ${exitCode ?? "unknown"}`));
        return;
      }

      resolve(stdout);
    });
  });
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

interface WindowsProcessInfo {
  ProcessId: number;
  Name: string | null;
  CommandLine: string | null;
}
