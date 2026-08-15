import {
  createClientRequest,
  createClientResponse,
  parseHarnessServerResponse,
  type HarnessClientResponse,
  type HarnessRpcResult,
  type HarnessServerRequest
} from "./deepseek-harness-protocol.js";

export type HarnessFetch = typeof fetch;

export interface DeepSeekHarnessApiClientOptions {
  baseUrl: string;
  fetchImpl?: HarnessFetch;
  requestTimeoutMs?: number;
}

export interface DeepSeekHarnessWorkspaceView {
  workspaceId: string;
  path: string;
  title?: string;
  sessionIds?: string[];
}

export type DeepSeekHarnessSessionCreateTarget =
  | { workspaceId: string }
  | { cwd: string };

export class DeepSeekHarnessRpcError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "DeepSeekHarnessRpcError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** 负责 transport、信封和业务错误三层校验。业务适配器只调用这个类。 */
export class DeepSeekHarnessApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HarnessFetch;
  private readonly requestTimeoutMs: number;

  constructor(options: DeepSeekHarnessApiClientOptions) {
    const parsed = new URL(options.baseUrl);

    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "::1") {
      throw new Error("HARNESS_LOOPBACK_ONLY");
    }

    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? 10_000);
  }

  async call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const request = createClientRequest(method, payload);
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal
      },
      signal
    );

    if (!response.ok) {
      throw new DeepSeekHarnessRpcError(
        "HARNESS_RPC_TRANSPORT_ERROR",
        `Harness HTTP ${response.status}`,
        response.status >= 500
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new DeepSeekHarnessRpcError("HARNESS_RPC_PROTOCOL_ERROR", "Harness 返回的 JSON 无法解析");
    }

    const envelope = parseHarnessServerResponse(body, request.rpcId);
    return unwrapResult<T>(envelope.result);
  }

  async respond(rpcId: string, result: HarnessRpcResult<unknown>, signal?: AbortSignal): Promise<void> {
    const request: HarnessClientResponse = createClientResponse(rpcId, result);
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal
      },
      signal
    );

    if (!response.ok) {
      throw new DeepSeekHarnessRpcError("HARNESS_RPC_TRANSPORT_ERROR", `Harness HTTP ${response.status}`, response.status >= 500);
    }
  }

  async describe(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("host.describe", {}, signal);
  }

  async createWorkspace(path: string, signal?: AbortSignal): Promise<{ workspace: DeepSeekHarnessWorkspaceView; created: boolean }> {
    return this.call<{ workspace: DeepSeekHarnessWorkspaceView; created: boolean }>("workspace.create", { path }, signal);
  }

  async createSession(target: DeepSeekHarnessSessionCreateTarget | string, signal?: AbortSignal): Promise<{ sessionId: string }> {
    const payload = typeof target === "string" ? { cwd: target } : target;
    return this.call<{ sessionId: string }>("session.create", payload, signal);
  }

  async listSessions(signal?: AbortSignal): Promise<{ items: Array<Record<string, unknown>> }> {
    return this.call<{ items: Array<Record<string, unknown>> }>("session.list", {}, signal);
  }

  async listWorkspaces(signal?: AbortSignal): Promise<{ items: Array<Record<string, unknown>>; archivedSessionIds?: string[] }> {
    return this.call<{ items: Array<Record<string, unknown>>; archivedSessionIds?: string[] }>("workspace.list", {}, signal);
  }

  async readHistory(sessionId: string, beforeSeq?: number, maxMessages = 100, signal?: AbortSignal): Promise<{ events: Array<Record<string, unknown>>; hasMore?: boolean }> {
    return this.call("session.history", { sessionId, ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages }, signal);
  }

  async prompt(sessionId: string, content: unknown, mode: "queue" | "steer" = "queue", signal?: AbortSignal): Promise<{ accepted: true }> {
    return this.call<{ accepted: true }>("session.prompt", { sessionId, content, mode }, signal);
  }

  async cancel(sessionId: string, signal?: AbortSignal): Promise<{ accepted: true }> {
    return this.call<{ accepted: true }>("session.cancel", { sessionId }, signal);
  }

  async updateQueue(sessionId: string, action: unknown, signal?: AbortSignal): Promise<{ accepted: true }> {
    return this.call<{ accepted: true }>("session.updateQueue", { sessionId, action }, signal);
  }

  async fork(sessionId: string, atSeq?: number, signal?: AbortSignal): Promise<{ sessionId: string }> {
    return this.call<{ sessionId: string }>("session.fork", { sessionId, ...(atSeq === undefined ? {} : { atSeq }) }, signal);
  }

  async rename(sessionId: string, title: string, signal?: AbortSignal): Promise<{ title: string }> {
    return this.call<{ title: string }>("session.rename", { sessionId, title }, signal);
  }

  async archiveSession(sessionId: string, signal?: AbortSignal): Promise<{ archivedSessionIds: string[] }> {
    return this.call<{ archivedSessionIds: string[] }>("workspace.archiveSession", { sessionId }, signal);
  }

  async models(sessionId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("session.models", { sessionId }, signal);
  }

  async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call("session.selectModel", { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }, signal);
  }

  async attachment(sessionId: string, attachmentId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call("session.attachment", { sessionId, attachmentId }, signal);
  }

  async subscribe(pathname: "/api/events.mux" | "/api/events.host", onEnvelope: (request: HarnessServerRequest) => void, signal?: AbortSignal, onClose?: () => void): Promise<() => void> {
    const WebSocketCtor = await resolveWebSocket();
    const url = this.baseUrl.replace(/^http/, "ws") + pathname;
    const socket = new WebSocketCtor(url);
    let closed = false;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new DeepSeekHarnessRpcError("HARNESS_SIDECAR_UNAVAILABLE", "Harness WebSocket 无法连接", true)); };
      const onClose = () => { cleanup(); reject(new DeepSeekHarnessRpcError("HARNESS_SIDECAR_UNAVAILABLE", "Harness WebSocket 已关闭", true)); };
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onClose, { once: true });
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        const parsed = typeof event.data === "string" ? JSON.parse(event.data) : JSON.parse(String(event.data));
        if (parsed?.type === "server-request") {
          onEnvelope(parsed as HarnessServerRequest);
        }
      } catch {
        // 坏帧由事件桥记录，不能让一个坏帧终止整条订阅。
      }
    });

    const close = () => {
      if (closed) return;
      closed = true;
      socket.close();
    };
    signal?.addEventListener("abort", close, { once: true });
    socket.addEventListener("close", () => {
      signal?.removeEventListener("abort", close);
      onClose?.();
    });
    return close;
  }

  private async fetchWithTimeout(input: string | URL, init: RequestInit, parentSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const abortParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortParent, { once: true });

    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      throw new DeepSeekHarnessRpcError("HARNESS_RPC_TRANSPORT_ERROR", error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortParent);
    }
  }
}

function unwrapResult<T>(result: HarnessRpcResult<unknown>): T {
  if (result.ok) return result.value as T;
  throw new DeepSeekHarnessRpcError("HARNESS_RPC_BUSINESS_ERROR", result.error.message, isRetryableCode(result.error.code));
}

function isRetryableCode(code: string): boolean {
  return /busy|unavailable|timeout|internal|temporar/i.test(code);
}

async function resolveWebSocket(): Promise<typeof WebSocket> {
  if (typeof WebSocket !== "undefined") return WebSocket;
  const module = await import("ws");
  return module.WebSocket as unknown as typeof WebSocket;
}
