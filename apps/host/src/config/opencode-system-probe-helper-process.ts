import { spawn } from "node:child_process";
import { readlinkSync } from "node:fs";
import readline from "node:readline";

interface OpenCodeListeningSocket {
  hostname: string;
  port: number;
}

type HelperRequest =
  | {
      id: string;
      type: "read_process_list";
    }
  | {
      id: string;
      type: "read_process_cwd";
      pid: number;
    }
  | {
      id: string;
      type: "read_listening_sockets";
      pid: number;
    };

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let payload: HelperRequest;

  try {
    payload = JSON.parse(line) as HelperRequest;
  } catch {
    return;
  }

  try {
    switch (payload.type) {
      case "read_process_list":
        emitResult(payload.id, await readProcessList());
        return;
      case "read_process_cwd":
        emitResult(payload.id, await readProcessCwd(payload.pid));
        return;
      case "read_listening_sockets":
        emitResult(payload.id, await readListeningSockets(payload.pid));
        return;
    }
  } catch (error) {
    emitError(payload.id, error instanceof Error ? error.message : String(error));
  }
}

function emitResult(id: string, result: unknown): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      id,
      ok: true,
      result
    })}\n`
  );
}

function emitError(id: string, error: string): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      id,
      ok: false,
      error
    })}\n`
  );
}

async function readProcessList(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "$ErrorActionPreference = 'SilentlyContinue'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }"
      ],
      {
        windowsHide: true
      }
    );

    return result.status === 0 ? result.stdout : "";
  }

  const result = await runCommand("ps", ["-ax", "-o", "pid=,command="]);
  return result.status === 0 ? result.stdout : "";
}

async function readProcessCwd(pid: number): Promise<string | null> {
  if (!Number.isFinite(pid) || pid <= 0 || process.platform === "win32") {
    return null;
  }

  if (process.platform === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }

  const result = await runCommand("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);

  if (result.status !== 0) {
    return null;
  }

  const line = result.stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("n"));

  return line?.slice(1).trim() || null;
}

async function readListeningSockets(pid: number): Promise<OpenCodeListeningSocket[]> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return [];
  }

  if (process.platform === "win32") {
    const result = await runCommand("netstat", ["-ano", "-p", "tcp"], {
      windowsHide: true
    });

    if (result.status !== 0) {
      return [];
    }

    const records: OpenCodeListeningSocket[] = [];

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const columns = trimmed.split(/\s+/);

      if (columns.length < 5) {
        continue;
      }

      const protocol = columns[0]?.toUpperCase();
      const localAddress = columns[1] ?? "";
      const state = columns[3]?.toUpperCase();
      const owningPid = Number(columns[4]);

      if (protocol !== "TCP" || state !== "LISTENING" || owningPid !== pid) {
        continue;
      }

      const parsed = parseSocketEndpoint(localAddress);

      if (parsed) {
        records.push(parsed);
      }
    }

    return dedupeListeningSockets(records).sort(compareListeningSockets);
  }

  const result = await runCommand(
    "lsof",
    ["-Pan", "-n", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"]
  );

  if (result.status !== 0) {
    return [];
  }

  const records: OpenCodeListeningSocket[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const matched = line.match(/\sTCP\s+(.+?)\s+\(LISTEN\)$/);

    if (!matched) {
      continue;
    }

    const endpoint = matched[1]?.trim() ?? "";
    const parsed = parseSocketEndpoint(endpoint);

    if (parsed) {
      records.push(parsed);
    }
  }

  return dedupeListeningSockets(records).sort(compareListeningSockets);
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    windowsHide?: boolean;
  } = {}
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: options.windowsHide ?? false
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout,
        stderr
      });
    });
  });
}

function parseSocketEndpoint(endpoint: string): OpenCodeListeningSocket | null {
  const trimmed = endpoint.trim();

  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.lastIndexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  const rawHostname = trimmed.slice(0, separatorIndex).trim();
  const rawPort = trimmed.slice(separatorIndex + 1).trim();

  if (!/^\d+$/.test(rawPort)) {
    return null;
  }

  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  return {
    hostname,
    port: Number(rawPort)
  };
}

function dedupeListeningSockets(values: OpenCodeListeningSocket[]): OpenCodeListeningSocket[] {
  const result: OpenCodeListeningSocket[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = `${value.hostname}:${value.port}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function compareListeningSockets(left: OpenCodeListeningSocket, right: OpenCodeListeningSocket): number {
  if (left.port !== right.port) {
    return right.port - left.port;
  }

  return left.hostname.localeCompare(right.hostname);
}
