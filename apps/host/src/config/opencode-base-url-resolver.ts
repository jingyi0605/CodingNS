import { spawnSync } from "node:child_process";

const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";
const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 800;

interface OpenCodeBaseUrlResolverOptions {
  configuredBaseUrl?: string | null;
  fallbackBaseUrl?: string;
  cacheTtlMs?: number;
  inspectProcessList?: () => string;
  probeBaseUrl?: (baseUrl: string) => Promise<boolean>;
  now?: () => number;
}

interface ResolveBaseUrlInput {
  refresh?: boolean;
}

export class OpenCodeBaseUrlResolver {
  private readonly configuredBaseUrl: string | null;
  private readonly fallbackBaseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly inspectProcessList: () => string;
  private readonly probeBaseUrl: (baseUrl: string) => Promise<boolean>;
  private readonly now: () => number;
  private cachedBaseUrl: string | null = null;
  private cachedAt = 0;
  private inflight: Promise<string> | null = null;

  constructor(options: OpenCodeBaseUrlResolverOptions = {}) {
    this.configuredBaseUrl = normalizeBaseUrl(options.configuredBaseUrl ?? null);
    this.fallbackBaseUrl =
      normalizeBaseUrl(options.fallbackBaseUrl ?? DEFAULT_OPENCODE_BASE_URL)
      ?? DEFAULT_OPENCODE_BASE_URL;
    this.cacheTtlMs = Math.max(500, Math.floor(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
    this.inspectProcessList = options.inspectProcessList ?? readProcessList;
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
    const candidates = dedupeBaseUrls([
      this.cachedBaseUrl,
      ...parseServeBaseUrls(this.inspectProcessList()),
      this.fallbackBaseUrl
    ]);

    for (const candidate of candidates) {
      if (await this.probeBaseUrl(candidate)) {
        this.cachedBaseUrl = candidate;
        this.cachedAt = this.now();
        return candidate;
      }
    }

    this.cachedAt = this.now();
    return this.cachedBaseUrl ?? this.fallbackBaseUrl;
  }
}

function readProcessList(): string {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout ?? "";
}

function parseServeBaseUrls(output: string): string[] {
  const records: Array<{ pid: number; baseUrl: string }> = [];

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

    if (!command.includes("opencode") || !/\sserve(?:\s|$)/.test(command)) {
      continue;
    }

    const port = extractFlagValue(command, "--port");

    if (!port || !/^\d+$/.test(port)) {
      continue;
    }

    const hostname = normalizeHostname(extractFlagValue(command, "--hostname"));
    records.push({
      pid,
      baseUrl: `http://${formatHostname(hostname)}:${port}`
    });
  }

  return records
    .sort((left, right) => right.pid - left.pid)
    .map((record) => record.baseUrl);
}

function extractFlagValue(command: string, flag: string): string | null {
  const matched = command.match(new RegExp(`${escapeRegExp(flag)}\\s+([^\\s]+)`));
  return matched?.[1] ?? null;
}

function normalizeHostname(value: string | null): string {
  const normalized = value?.trim();

  if (!normalized || normalized === "0.0.0.0") {
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
