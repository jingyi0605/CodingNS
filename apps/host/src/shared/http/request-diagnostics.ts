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
  readonly rawWritableEnded: boolean | null;
  readonly rawWritableFinished: boolean | null;
  readonly rawDestroyed: boolean | null;
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
    readonly nodeVersion: string;
    readonly platform: NodeJS.Platform;
    readonly arch: string;
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
  rawWritableEnded: boolean | null;
  rawWritableFinished: boolean | null;
  rawDestroyed: boolean | null;
  aborted: boolean;
  remoteAddress: string | null;
  userAgent: string | null;
  contentType: string | null;
  contentLength: string | null;
}

interface ReplyState {
  statusCode: number | null;
  replySent: boolean | null;
  headersSent: boolean | null;
  rawWritableEnded: boolean | null;
  rawWritableFinished: boolean | null;
  rawDestroyed: boolean | null;
}

export class HttpRequestDiagnosticsTracker {
  private nextRequestId = 1;
  private readonly activeRequests = new Map<number, MutableRequestDiagnosticsRecord>();
  private readonly activeReplyReaders = new Map<number, () => ReplyState>();
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
      rawWritableEnded: null,
      rawWritableFinished: null,
      rawDestroyed: null,
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

  watchReply(requestId: number, reply: FastifyReply): void {
    this.activeReplyReaders.set(requestId, () => readReplyState(reply));
    this.refreshReplyState(requestId);
  }

  finish(requestId: number, reply: FastifyReply, request?: FastifyRequest): void {
    const record = this.activeRequests.get(requestId);
    if (!record) {
      this.activeReplyReaders.delete(requestId);
      return;
    }

    const finishedAtMs = Date.now();
    record.finishedAt = new Date(finishedAtMs).toISOString();
    record.durationMs = finishedAtMs - record.startedAtMs;
    record.routePath = request ? readRoutePath(request) : record.routePath;
    applyReplyState(record, readReplyState(reply));

    this.activeRequests.delete(requestId);
    this.activeReplyReaders.delete(requestId);
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
    this.refreshActiveReplyStates();
    const activeRequests = Array.from(this.activeRequests.values()).map((record) => cloneRecord(record, now));
    return {
      reason,
      capturedAt: new Date(now).toISOString(),
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
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
        record.rawWritableEnded = null;
        record.rawWritableFinished = null;
        record.rawDestroyed = null;
        this.pushRecent(record);
      }

      this.activeRequests.delete(firstKey);
      this.activeReplyReaders.delete(firstKey);
    }
  }

  private refreshActiveReplyStates(): void {
    for (const requestId of this.activeRequests.keys()) {
      this.refreshReplyState(requestId);
    }
  }

  private refreshReplyState(requestId: number): void {
    const record = this.activeRequests.get(requestId);
    const reader = this.activeReplyReaders.get(requestId);
    if (!record || !reader) {
      return;
    }

    applyReplyState(record, safeReadReplyState(reader));
  }
}

export function logHostFatalDiagnostics(
  tracker: HttpRequestDiagnosticsTracker,
  reason: string,
  error: unknown
): void {
  try {
    console.error("[host-fatal]", {
      reason,
      error: serializeFatalError(error),
      diagnostics: tracker.snapshot(reason)
    });
  } catch (diagnosticsError) {
    console.error("[host-fatal] failed to collect diagnostics", {
      reason,
      error: serializeFatalError(error),
      diagnosticsError: serializeFatalError(diagnosticsError)
    });
  }
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

function readReplyState(reply: FastifyReply): ReplyState {
  return {
    statusCode: reply.statusCode,
    replySent: reply.sent,
    headersSent: reply.raw.headersSent,
    rawWritableEnded: reply.raw.writableEnded,
    rawWritableFinished: reply.raw.writableFinished,
    rawDestroyed: reply.raw.destroyed
  };
}

function safeReadReplyState(reader: () => ReplyState): ReplyState {
  try {
    return reader();
  } catch {
    return {
      statusCode: null,
      replySent: null,
      headersSent: null,
      rawWritableEnded: null,
      rawWritableFinished: null,
      rawDestroyed: null
    };
  }
}

function applyReplyState(record: MutableRequestDiagnosticsRecord, state: ReplyState): void {
  record.statusCode = state.statusCode;
  record.replySent = state.replySent;
  record.headersSent = state.headersSent;
  record.rawWritableEnded = state.rawWritableEnded;
  record.rawWritableFinished = state.rawWritableFinished;
  record.rawDestroyed = state.rawDestroyed;
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
