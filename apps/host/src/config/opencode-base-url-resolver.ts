import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import { getSharedOpenCodeSystemProbeHelperClient } from "./opencode-system-probe-helper-client.js";
const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 800;
const DEFAULT_MANAGED_SERVER_RETRY_COOLDOWN_MS = 10_000;

interface OpenCodeBaseUrlResolverOptions {
  configuredBaseUrl?: string | null;
  commandPath?: string | null;
  cacheTtlMs?: number;
  inspectProcessList?: () => Promise<string> | string;
  inspectListeningSockets?: (pid: number) => Promise<OpenCodeListeningSocket[]> | OpenCodeListeningSocket[];
  inspectProcessCwd?: (pid: number) => Promise<string | null> | string | null;
  probeBaseUrl?: (baseUrl: string) => Promise<boolean>;
  now?: () => number;
  managedServerRetryCooldownMs?: number;
}

interface ResolveBaseUrlInput {
  refresh?: boolean;
  workspacePath?: string | null;
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
  private readonly inspectProcessList: () => Promise<string> | string;
  private readonly inspectListeningSockets:
    (pid: number) => Promise<OpenCodeListeningSocket[]> | OpenCodeListeningSocket[];
  private readonly inspectProcessCwd: (pid: number) => Promise<string | null> | string | null;
  private readonly probeBaseUrl: (baseUrl: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly managedServerRetryCooldownMs: number;
  private readonly cachedBaseUrlByWorkspaceKey = new Map<string, string>();
  private readonly cachedAtByWorkspaceKey = new Map<string, number>();
  private readonly inflightByWorkspaceKey = new Map<string, Promise<string>>();
  private readonly managedServerBaseUrlByWorkspaceKey = new Map<string, string>();
  private readonly managedServerProcessByWorkspaceKey = new Map<string, ManagedOpenCodeServerProcess>();
  private readonly managedServerInflightByWorkspaceKey = new Map<string, Promise<string>>();
  private readonly managedServerRetryBlockedUntilByWorkspaceKey = new Map<string, number>();
  private disposed = false;

  constructor(options: OpenCodeBaseUrlResolverOptions = {}) {
    this.configuredBaseUrl = normalizeBaseUrl(options.configuredBaseUrl ?? null);
    this.commandPath = normalizeCommandPath(options.commandPath ?? null);
    this.cacheTtlMs = Math.max(500, Math.floor(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
    this.inspectProcessList =
      options.inspectProcessList
      ?? (() => getSharedOpenCodeSystemProbeHelperClient().readProcessList());
    this.inspectListeningSockets =
      options.inspectListeningSockets
      ?? ((pid) => getSharedOpenCodeSystemProbeHelperClient().readListeningSockets(pid));
    this.inspectProcessCwd =
      options.inspectProcessCwd
      ?? ((pid) => getSharedOpenCodeSystemProbeHelperClient().readProcessCwd(pid));
    this.probeBaseUrl = options.probeBaseUrl ?? probeOpenCodeBaseUrl;
    this.now = options.now ?? Date.now;
    this.managedServerRetryCooldownMs = Math.max(
      1_000,
      Math.floor(options.managedServerRetryCooldownMs ?? DEFAULT_MANAGED_SERVER_RETRY_COOLDOWN_MS)
    );
  }

  async resolve(input: ResolveBaseUrlInput = {}): Promise<string> {
    this.ensureNotDisposed();

    if (this.configuredBaseUrl) {
      return this.configuredBaseUrl;
    }

    const workspaceKey = normalizeWorkspaceKey(input.workspacePath);
    const cachedBaseUrl = this.cachedBaseUrlByWorkspaceKey.get(workspaceKey) ?? null;
    const cachedAt = this.cachedAtByWorkspaceKey.get(workspaceKey) ?? 0;

    if (!input.refresh && cachedBaseUrl && this.now() - cachedAt < this.cacheTtlMs) {
      return cachedBaseUrl;
    }

    const inflight = this.inflightByWorkspaceKey.get(workspaceKey) ?? null;

    if (inflight) {
      return inflight;
    }

    const task = this.discoverAvailableBaseUrl(input.workspacePath ?? null);
    const wrappedTask = task.finally(() => {
      if (this.inflightByWorkspaceKey.get(workspaceKey) === wrappedTask) {
        this.inflightByWorkspaceKey.delete(workspaceKey);
      }
    });
    this.inflightByWorkspaceKey.set(workspaceKey, wrappedTask);

    return wrappedTask;
  }

  async listReachableBaseUrls(input: ResolveBaseUrlInput = {}): Promise<string[]> {
    this.ensureNotDisposed();

    const candidates = await this.collectCandidateBaseUrls(input.workspacePath ?? null);
    const available: string[] = [];

    for (const candidate of candidates) {
      if (await this.probeBaseUrl(candidate)) {
        available.push(candidate);
      }
    }

    return available;
  }

  private async discoverAvailableBaseUrl(workspacePath: string | null): Promise<string> {
    const workspaceKey = normalizeWorkspaceKey(workspacePath);
    const candidates = await this.collectCandidateBaseUrls(workspacePath);

    for (const candidate of candidates) {
      if (await this.probeBaseUrl(candidate)) {
        this.cachedBaseUrlByWorkspaceKey.set(workspaceKey, candidate);
        this.cachedAtByWorkspaceKey.set(workspaceKey, this.now());
        return candidate;
      }
    }

    if (workspacePath || process.platform === "win32") {
      const managedCandidate = await this.ensureManagedServerBaseUrl(
        workspacePath ?? process.cwd()
      );

      if (await this.probeBaseUrl(managedCandidate)) {
        this.managedServerBaseUrlByWorkspaceKey.set(workspaceKey, managedCandidate);
        this.cachedBaseUrlByWorkspaceKey.set(workspaceKey, managedCandidate);
        this.cachedAtByWorkspaceKey.set(workspaceKey, this.now());
        return managedCandidate;
      }
    }

    this.cachedAtByWorkspaceKey.set(workspaceKey, this.now());
    throw new Error("SERVER_UNAVAILABLE");
  }

  private async collectCandidateBaseUrls(workspacePath: string | null): Promise<string[]> {
    if (this.configuredBaseUrl) {
      return [this.configuredBaseUrl];
    }

    const workspaceKey = normalizeWorkspaceKey(workspacePath);
    const targetWorkspacePath = normalizeWorkspaceCompareValue(workspacePath);
    const serveProcesses = await Promise.all(
      parseServeProcesses(await this.inspectProcessList(), this.commandPath)
        .map(async (record) => ({
        ...record,
          cwd: normalizeWorkspaceCompareValue(await this.inspectProcessCwd(record.pid))
        }))
    );
    const matchingServeProcesses =
      targetWorkspacePath
        ? serveProcesses.filter((record) => record.cwd === targetWorkspacePath)
        : serveProcesses;
    const fallbackServeProcesses =
      matchingServeProcesses.length > 0
        ? matchingServeProcesses
        : process.platform === "win32"
          ? serveProcesses
          : matchingServeProcesses;

    return dedupeBaseUrls([
      this.cachedBaseUrlByWorkspaceKey.get(workspaceKey) ?? null,
      this.managedServerBaseUrlByWorkspaceKey.get(workspaceKey) ?? null,
      ...(await Promise.all(fallbackServeProcesses.map(async (record) => {
        return (await this.inspectListeningSockets(record.pid)).map((socket) => {
          return `http://${formatHostname(normalizeHostname(socket.hostname))}:${socket.port}`;
        });
      }))).flat()
    ]);
  }

  private async ensureManagedServerBaseUrl(workspacePath: string): Promise<string> {
    const workspaceKey = normalizeWorkspaceKey(workspacePath);
    const managedServerProcess = this.managedServerProcessByWorkspaceKey.get(workspaceKey) ?? null;
    const managedServerBaseUrl = this.managedServerBaseUrlByWorkspaceKey.get(workspaceKey) ?? null;

    if (managedServerProcess && !managedServerProcess.killed && managedServerBaseUrl) {
      return managedServerBaseUrl;
    }

    const inflight = this.managedServerInflightByWorkspaceKey.get(workspaceKey) ?? null;

    if (inflight) {
      return inflight;
    }

    const blockedUntil = this.managedServerRetryBlockedUntilByWorkspaceKey.get(workspaceKey) ?? 0;

    if (blockedUntil > this.now()) {
      throw new Error("SERVER_UNAVAILABLE");
    }

    const task = this.startManagedServer(workspacePath);
    const wrappedTask = task.finally(() => {
      if (this.managedServerInflightByWorkspaceKey.get(workspaceKey) === wrappedTask) {
        this.managedServerInflightByWorkspaceKey.delete(workspaceKey);
      }
    });
    this.managedServerInflightByWorkspaceKey.set(workspaceKey, wrappedTask);
    return wrappedTask;
  }

  private async startManagedServer(workspacePath: string): Promise<string> {
    const commandPath = this.commandPath?.trim();
    const workspaceKey = normalizeWorkspaceKey(workspacePath);

    this.ensureNotDisposed();

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
        cwd: workspacePath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    this.managedServerProcessByWorkspaceKey.set(workspaceKey, child);
    this.managedServerRetryBlockedUntilByWorkspaceKey.delete(workspaceKey);

    child.once("exit", () => {
      if (this.managedServerProcessByWorkspaceKey.get(workspaceKey) === child) {
        this.managedServerProcessByWorkspaceKey.delete(workspaceKey);
        this.managedServerBaseUrlByWorkspaceKey.delete(workspaceKey);
      }
    });

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        child.kill();
        this.recordManagedServerFailure(workspaceKey);
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
          this.managedServerBaseUrlByWorkspaceKey.set(workspaceKey, baseUrl);
          cleanup();
          resolve(baseUrl);
          return;
        }
      };

      const handleExit = () => {
        cleanup();
        this.recordManagedServerFailure(workspaceKey);
        reject(new Error(output.trim() || "SERVER_UNAVAILABLE"));
      };

      const handleError = () => {
        cleanup();
        this.recordManagedServerFailure(workspaceKey);
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

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cachedBaseUrlByWorkspaceKey.clear();
    this.cachedAtByWorkspaceKey.clear();
    this.inflightByWorkspaceKey.clear();
    this.managedServerBaseUrlByWorkspaceKey.clear();
    this.managedServerInflightByWorkspaceKey.clear();
    this.managedServerRetryBlockedUntilByWorkspaceKey.clear();

    for (const child of this.managedServerProcessByWorkspaceKey.values()) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    this.managedServerProcessByWorkspaceKey.clear();
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("SERVER_UNAVAILABLE");
    }
  }

  private recordManagedServerFailure(workspaceKey: string): void {
    this.managedServerRetryBlockedUntilByWorkspaceKey.set(
      workspaceKey,
      this.now() + this.managedServerRetryCooldownMs
    );
  }
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

function normalizeWorkspaceKey(value: string | null | undefined): string {
  return normalizeWorkspaceCompareValue(value) ?? "";
}

function normalizeWorkspaceCompareValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().replaceAll("\\", "/").replace(/\/+$/, "") ?? "";

  if (!normalized) {
    return null;
  }

  return /^[a-z]:(?:\/|$)/i.test(normalized) ? normalized.toLowerCase() : normalized;
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
