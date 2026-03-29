import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 800;

interface OpenCodeBaseUrlResolverOptions {
  configuredBaseUrl?: string | null;
  commandPath?: string | null;
  cacheTtlMs?: number;
  inspectProcessList?: () => string;
  inspectListeningSockets?: (pid: number) => OpenCodeListeningSocket[];
  probeBaseUrl?: (baseUrl: string) => Promise<boolean>;
  now?: () => number;
}

interface ResolveBaseUrlInput {
  refresh?: boolean;
}

interface OpenCodeServeProcessRecord {
  pid: number;
  command: string;
}

interface OpenCodeListeningSocket {
  hostname: string;
  port: number;
}

type ManagedOpenCodeServerProcess = ChildProcessByStdio<null, Readable, Readable>;

export class OpenCodeBaseUrlResolver {
  private readonly configuredBaseUrl: string | null;
  private readonly commandPath: string | null;
  private readonly cacheTtlMs: number;
  private readonly inspectProcessList: () => string;
  private readonly inspectListeningSockets: (pid: number) => OpenCodeListeningSocket[];
  private readonly probeBaseUrl: (baseUrl: string) => Promise<boolean>;
  private readonly now: () => number;
  private cachedBaseUrl: string | null = null;
  private cachedAt = 0;
  private inflight: Promise<string> | null = null;
  private managedServerBaseUrl: string | null = null;
  private managedServerProcess: ManagedOpenCodeServerProcess | null = null;
  private managedServerInflight: Promise<string> | null = null;

  constructor(options: OpenCodeBaseUrlResolverOptions = {}) {
    this.configuredBaseUrl = normalizeBaseUrl(options.configuredBaseUrl ?? null);
    this.commandPath = normalizeCommandPath(options.commandPath ?? null);
    this.cacheTtlMs = Math.max(500, Math.floor(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
    this.inspectProcessList = options.inspectProcessList ?? readProcessList;
    this.inspectListeningSockets = options.inspectListeningSockets ?? readListeningSockets;
    this.probeBaseUrl = options.probeBaseUrl ?? probeOpenCodeBaseUrl;
    this.now = options.now ?? Date.now;
  }

  async resolve(input: ResolveBaseUrlInput = {}): Promise<string> {
    if (this.configuredBaseUrl) {
      return this.configuredBaseUrl;
    }

    if (!input.refresh && this.cachedBaseUrl && this.now() - this.cachedAt < this.cacheTtlMs) {
      return this.cachedBaseUrl;
    }

    if (this.inflight) {
      return this.inflight;
    }

    const task = this.discoverAvailableBaseUrl();
    const wrappedTask = task.finally(() => {
      if (this.inflight === wrappedTask) {
        this.inflight = null;
      }
    });
    this.inflight = wrappedTask;

    return this.inflight;
  }

  private async discoverAvailableBaseUrl(): Promise<string> {
    const serveProcesses = parseServeProcesses(this.inspectProcessList(), this.commandPath);
    const candidates = dedupeBaseUrls([
      this.cachedBaseUrl,
      this.managedServerBaseUrl,
      ...serveProcesses.flatMap((record) => {
        return this.inspectListeningSockets(record.pid).map((socket) => {
          return `http://${formatHostname(normalizeHostname(socket.hostname))}:${socket.port}`;
        });
      })
    ]);

    for (const candidate of candidates) {
      if (await this.probeBaseUrl(candidate)) {
        this.cachedBaseUrl = candidate;
        this.cachedAt = this.now();
        return candidate;
      }
    }

    if (process.platform === "win32") {
      const managedCandidate = await this.ensureManagedServerBaseUrl();

      if (await this.probeBaseUrl(managedCandidate)) {
        this.managedServerBaseUrl = managedCandidate;
        this.cachedBaseUrl = managedCandidate;
        this.cachedAt = this.now();
        return managedCandidate;
      }
    }

    this.cachedAt = this.now();
    throw new Error("SERVER_UNAVAILABLE");
  }

  private async ensureManagedServerBaseUrl(): Promise<string> {
    if (this.managedServerProcess && !this.managedServerProcess.killed && this.managedServerBaseUrl) {
      return this.managedServerBaseUrl;
    }

    if (this.managedServerInflight) {
      return this.managedServerInflight;
    }

    const task = this.startManagedServer();
    const wrappedTask = task.finally(() => {
      if (this.managedServerInflight === wrappedTask) {
        this.managedServerInflight = null;
      }
    });
    this.managedServerInflight = wrappedTask;
    return wrappedTask;
  }

  private async startManagedServer(): Promise<string> {
    const commandPath = this.commandPath?.trim();

    if (!commandPath) {
      throw new Error("SERVER_UNAVAILABLE");
    }

    const env = {
      ...process.env
    };
    delete env.OPENCODE_SERVER_PASSWORD;

    const child = spawn(
      commandPath,
      ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"],
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    this.managedServerProcess = child;

    child.once("exit", () => {
      if (this.managedServerProcess === child) {
        this.managedServerProcess = null;
        this.managedServerBaseUrl = null;
      }
    });

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        child.kill();
        reject(new Error("SERVER_UNAVAILABLE"));
      }, 5_000);
      let output = "";

      const handleChunk = (chunk: Buffer | string) => {
        output += chunk.toString();

        for (const line of output.split(/\r?\n/)) {
          const matched = line.match(/opencode server listening on\s+(https?:\/\/\S+)/i);

          if (!matched) {
            continue;
          }

          const baseUrl = normalizeBaseUrl(matched[1]) ?? matched[1];
          this.managedServerBaseUrl = baseUrl;
          cleanup();
          resolve(baseUrl);
          return;
        }
      };

      const handleExit = () => {
        cleanup();
        reject(new Error(output.trim() || "SERVER_UNAVAILABLE"));
      };

      const handleError = () => {
        cleanup();
        reject(new Error("SERVER_UNAVAILABLE"));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        child.stdout.off("data", handleChunk);
        child.stderr.off("data", handleChunk);
        child.off("exit", handleExit);
        child.off("error", handleError);
      };

      child.stdout.on("data", handleChunk);
      child.stderr.on("data", handleChunk);
      child.once("exit", handleExit);
      child.once("error", handleError);
    });
  }
}

function readProcessList(): string {
  if (process.platform === "win32") {
    return readWindowsProcessList();
  }

  return readUnixProcessList();
}

function readUnixProcessList(): string {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout ?? "";
}

function readWindowsProcessList(): string {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      [
        "$ErrorActionPreference = 'SilentlyContinue'",
        "Get-CimInstance Win32_Process",
        "| Where-Object { $_.CommandLine }",
        "| ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }"
      ].join(" ")
    ],
    {
      encoding: "utf8",
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    return "";
  }

  return result.stdout ?? "";
}

function parseServeProcesses(output: string, commandPath: string | null): OpenCodeServeProcessRecord[] {
  const records: OpenCodeServeProcessRecord[] = [];

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const matched = trimmed.match(/^(\d+)\s+(.+)$/);

    if (!matched) {
      continue;
    }

    const pid = Number(matched[1]);
    const command = matched[2];

    if (!isOpenCodeServeCommand(command, commandPath)) {
      continue;
    }

    records.push({
      pid,
      command
    });
  }

  return records
    .sort((left, right) => right.pid - left.pid)
    .filter((record, index, array) => {
      return array.findIndex((candidate) => candidate.pid === record.pid) === index;
    });
}

function normalizeHostname(value: string | null): string {
  const normalized = value?.trim();

  if (!normalized || normalized === "0.0.0.0" || normalized === "*") {
    return "127.0.0.1";
  }

  if (normalized === "::" || normalized === "[::]") {
    return "::1";
  }

  return normalized;
}

function formatHostname(value: string): string {
  if (value.includes(":") && !value.startsWith("[")) {
    return `[${value}]`;
  }

  return value;
}

function readListeningSockets(pid: number): OpenCodeListeningSocket[] {
  if (process.platform === "win32") {
    return readWindowsListeningSockets(pid);
  }

  return readUnixListeningSockets(pid);
}

function readUnixListeningSockets(pid: number): OpenCodeListeningSocket[] {
  const result = spawnSync(
    "lsof",
    ["-Pan", "-n", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"],
    {
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    return [];
  }

  const records: OpenCodeListeningSocket[] = [];

  for (const line of (result.stdout ?? "").split(/\r?\n/)) {
    const matched = line.match(/\sTCP\s+(.+?)\s+\(LISTEN\)$/);

    if (!matched) {
      continue;
    }

    const endpoint = matched[1]?.trim() ?? "";
    const parsed = parseSocketEndpoint(endpoint);

    if (!parsed) {
      continue;
    }

    records.push(parsed);
  }

  return dedupeListeningSockets(records).sort(compareListeningSockets);
}

function readWindowsListeningSockets(pid: number): OpenCodeListeningSocket[] {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return [];
  }

  const records: OpenCodeListeningSocket[] = [];

  for (const line of (result.stdout ?? "").split(/\r?\n/)) {
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

    if (!parsed) {
      continue;
    }

    records.push(parsed);
  }

  return dedupeListeningSockets(records).sort(compareListeningSockets);
}

function normalizeBaseUrl(value: string | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\/+$/, "");
}

function dedupeBaseUrls(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeBaseUrl(value ?? null);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeCommandPath(value: string | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return normalized;
}

function isOpenCodeServeCommand(command: string, commandPath: string | null): boolean {
  if (!/\sserve(?:\s|$)/.test(command)) {
    return false;
  }

  const normalizedCommand = command.trim();
  const markers = new Set<string>(["opencode"]);

  if (commandPath) {
    markers.add(commandPath);
    const baseName = commandPath.split(/[\\/]/).pop()?.replace(/^[.]+/, "").trim();

    if (baseName) {
      markers.add(baseName);
    }
  }

  for (const marker of markers) {
    const normalizedMarker = marker.trim();

    if (!normalizedMarker) {
      continue;
    }

    if (normalizedCommand.includes(normalizedMarker)) {
      return true;
    }

    if (new RegExp(`(^|[\\\\/\\s])\\.?${escapeRegExp(normalizedMarker)}(?:\\s|$)`, "i").test(normalizedCommand)) {
      return true;
    }
  }

  return false;
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
    const normalizedHostname = normalizeHostname(value.hostname);
    const key = `${normalizedHostname}:${value.port}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      hostname: normalizedHostname,
      port: value.port
    });
  }

  return result;
}

function compareListeningSockets(
  left: OpenCodeListeningSocket,
  right: OpenCodeListeningSocket
): number {
  return scoreListeningSocket(right) - scoreListeningSocket(left);
}

function scoreListeningSocket(value: OpenCodeListeningSocket): number {
  const hostname = normalizeHostname(value.hostname);

  if (hostname === "127.0.0.1") {
    return 3;
  }

  if (hostname === "::1") {
    return 2;
  }

  return 1;
}

async function probeOpenCodeBaseUrl(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, DEFAULT_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/session", `${baseUrl}/`), {
      method: "GET",
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
