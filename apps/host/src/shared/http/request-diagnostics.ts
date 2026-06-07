import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_MAX_RECENT_REQUESTS = 120;
const DEFAULT_MAX_ACTIVE_REQUESTS = 80;
const SLOW_ACTIVE_REQUEST_MS = 10_000;

export interface RequestDiagnosticsRecord {
  readonly id: number;
  readonly method: string;
  readonly url: string;
  readonly routePath: string | null;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly statusCode: number | null;
  readonly replySent: boolean | null;
  readonly headersSent: boolean | null;
  readonly aborted: boolean;
  readonly remoteAddress: string | null;
  readonly userAgent: string | null;
  readonly contentType: string | null;
  readonly contentLength: string | null;
}

export interface HostFatalDiagnosticsSnapshot {
  readonly reason: string;
  readonly capturedAt: string;
  readonly process: {
    readonly pid: number;
    readonly uptimeSeconds: number;
    readonly memoryUsage: NodeJS.MemoryUsage;
  };
  readonly activeRequests: RequestDiagnosticsRecord[];
  readonly slowActiveRequests: RequestDiagnosticsRecord[];
  readonly recentRequests: RequestDiagnosticsRecord[];
}

interface MutableRequestDiagnosticsRecord {
  id: number;
  method: string;
  url: string;
  routePath: string | null;
  startedAt: string;
  startedAtMs: number;
  finishedAt: string | null;
  durationMs: number | null;
  statusCode: number | null;
  replySent: boolean | null;
  headersSent: boolean | null;
  aborted: boolean;
  remoteAddress: string | null;
  userAgent: string | null;
  contentType: string | null;
  contentLength: string | null;
}

export class HttpRequestDiagnosticsTracker {
  private nextRequestId = 1;
  private readonly activeRequests = new Map<number, MutableRequestDiagnosticsRecord>();
  private readonly recentRequests: MutableRequestDiagnosticsRecord[] = [];

  constructor(
    private readonly maxRecentRequests = DEFAULT_MAX_RECENT_REQUESTS,
    private readonly maxActiveRequests = DEFAULT_MAX_ACTIVE_REQUESTS
  ) {}

  begin(request: FastifyRequest): number {
    const requestId = this.nextRequestId++;
    const startedAtMs = Date.now();
    const record: MutableRequestDiagnosticsRecord = {
      id: requestId,
      method: request.method,
      url: sanitizeRequestUrl(request.url),
      routePath: readRoutePath(request),
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      finishedAt: null,
      durationMs: null,
      statusCode: null,
      replySent: null,
      headersSent: null,
      aborted: false,
      remoteAddress: request.ip || null,
      userAgent: readHeader(request, "user-agent"),
      contentType: readHeader(request, "content-type"),
      contentLength: readHeader(request, "content-length")
    };

    this.activeRequests.set(requestId, record);
    this.pruneActiveRequestsIfNeeded();
    return requestId;
  }

  finish(requestId: number, reply: FastifyReply, request?: FastifyRequest): void {
    const record = this.activeRequests.get(requestId);
    if (!record) {
      return;
    }

    const finishedAtMs = Date.now();
    record.finishedAt = new Date(finishedAtMs).toISOString();
    record.durationMs = finishedAtMs - record.startedAtMs;
    record.routePath = request ? readRoutePath(request) : record.routePath;
    record.statusCode = reply.statusCode;
    record.replySent = reply.sent;
    record.headersSent = reply.raw.headersSent;

    this.activeRequests.delete(requestId);
    this.pushRecent(record);
  }

  markAborted(requestId: number): void {
    const record = this.activeRequests.get(requestId);
    if (record) {
      record.aborted = true;
    }
  }

  snapshot(reason: string): HostFatalDiagnosticsSnapshot {
    const now = Date.now();
    const activeRequests = Array.from(this.activeRequests.values()).map((record) => cloneRecord(record, now));
    return {
      reason,
      capturedAt: new Date(now).toISOString(),
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsage: process.memoryUsage()
      },
      activeRequests,
      slowActiveRequests: activeRequests.filter((record) => (record.durationMs ?? 0) >= SLOW_ACTIVE_REQUEST_MS),
      recentRequests: this.recentRequests.map((record) => cloneRecord(record))
    };
  }

  private pushRecent(record: MutableRequestDiagnosticsRecord): void {
    this.recentRequests.push({ ...record });
    while (this.recentRequests.length > this.maxRecentRequests) {
      this.recentRequests.shift();
    }
  }

  private pruneActiveRequestsIfNeeded(): void {
    while (this.activeRequests.size > this.maxActiveRequests) {
      const firstKey = this.activeRequests.keys().next().value;
      if (typeof firstKey !== "number") {
        return;
      }

      const record = this.activeRequests.get(firstKey);
      if (record) {
        const now = Date.now();
        record.finishedAt = new Date(now).toISOString();
        record.durationMs = now - record.startedAtMs;
        record.statusCode = null;
        record.replySent = null;
        record.headersSent = null;
        this.pushRecent(record);
      }

      this.activeRequests.delete(firstKey);
    }
  }
}

export function logHostFatalDiagnostics(
  tracker: HttpRequestDiagnosticsTracker,
  reason: string,
  error: unknown
): void {
  console.error("[host-fatal]", {
    reason,
    error: serializeFatalError(error),
    diagnostics: tracker.snapshot(reason)
  });
}

function cloneRecord(record: MutableRequestDiagnosticsRecord, nowMs?: number): RequestDiagnosticsRecord {
  const durationMs = record.finishedAt === null && typeof nowMs === "number"
    ? nowMs - record.startedAtMs
    : record.durationMs;

  return {
    ...record,
    durationMs
  };
}

function readRoutePath(request: FastifyRequest): string | null {
  const routeOptions = request.routeOptions as { url?: unknown } | undefined;
  return typeof routeOptions?.url === "string" ? routeOptions.url : null;
}

function readHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return typeof value === "string" ? value : null;
}

function sanitizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    return `${sanitizeRequestPath(parsed.pathname)}${parsed.search}`;
  } catch {
    return url.length > 500 ? `${url.slice(0, 500)}…` : url;
  }
}

function sanitizeRequestPath(pathname: string): string {
  const segments = pathname.split("/");
  const previewIndex = segments.indexOf("preview");

  if (previewIndex >= 0 && segments[previewIndex + 1] === "affairs-files" && segments[previewIndex + 2]) {
    segments[previewIndex + 2] = "[redacted]";
    return segments.join("/");
  }

  if (previewIndex >= 0 && segments[previewIndex + 1] === "files" && segments[previewIndex + 2]) {
    segments[previewIndex + 2] = "[redacted]";
    return segments.join("/");
  }

  if (previewIndex >= 0 && segments[previewIndex + 1] === "workspace-bridge") {
    if (segments[previewIndex + 2] && segments[previewIndex + 2] !== "capabilities") {
      segments[previewIndex + 2] = "[redacted]";
    }
    return segments.join("/");
  }

  return pathname;
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized === "token"
    || normalized === "access_token"
    || normalized === "refresh_token"
    || normalized === "authorization"
    || normalized === "auth";
}

function serializeFatalError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const nodeError = error as NodeJS.ErrnoException;
    return {
      name: error.name,
      message: error.message,
      code: nodeError.code,
      stack: error.stack
    };
  }

  return {
    name: typeof error,
    message: String(error)
  };
}
