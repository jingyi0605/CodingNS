import {
  buildSessionRawStoreRef,
  normalizeOpenCodePartMessage,
  normalizeOpenCodeToolStatus,
  parseSessionIdFromRawStoreRef,
  toJsonRecord
} from "../providers/opencode-shared.js";
import { ensureText, extractTextBlocks, nextTimestamp } from "../providers/utils.js";
import type { ProviderId } from "../types.js";
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  RuntimeRunState
} from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const TIMEOUT_WARNING_THRESHOLD_MS = 15_000;
const MAX_CONSECUTIVE_TIMEOUTS = 5;

interface OpenCodeRuntimeOptions {
  baseUrl?: string;
  baseUrlResolver?: (input?: { refresh?: boolean }) => Promise<string> | string;
  requestTimeoutMs?: number;
}

interface TimeoutRetryState {
  startedAtMs: number;
  timeoutCount: number;
}

interface OpenCodeRuntimeState {
  readonly providerSessionId: string;
  readonly rawStoreRef: string;
  sequence: number;
  readonly sink: ProviderRuntimeEventSink;
  readonly messageInfoById: Map<string, Record<string, unknown>>;
  readonly partById: Map<string, Record<string, unknown>>;
  readonly messageIdByPartId: Map<string, string>;
  readonly partIdsByMessageId: Map<string, Set<string>>;
  readonly emittedPartSignatures: Map<string, string>;
  readonly emittedSequenceByPartId: Map<string, number>;
}

export class OpenCodeRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId: ProviderId = "opencode";

  constructor(private readonly options: OpenCodeRuntimeOptions = {}) {}

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const providerSessionId = await this.createSession(request.workspacePath);
    const rawStoreRef = buildSessionRawStoreRef(providerSessionId);

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef
    });

    return this.createLaunchResult(request, sink, providerSessionId, rawStoreRef);
  }

  async continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const providerSessionId = this.resolveProviderSessionId(
      request.providerSessionId,
      request.rawStoreRef
    );
    const rawStoreRef = request.rawStoreRef ?? buildSessionRawStoreRef(providerSessionId);

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef
    });

    return this.createLaunchResult(request, sink, providerSessionId, rawStoreRef);
  }

  private createLaunchResult(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink,
    providerSessionId: string,
    rawStoreRef: string
  ): ProviderRuntimeLaunchResult {
    const abortController = new AbortController();

    return {
      providerSessionId,
      rawStoreRef,
      interrupt: async () => {
        await this.abortSession(providerSessionId);
        abortController.abort();
      },
      completed: this.runSession(
        request,
        {
          providerSessionId,
          rawStoreRef,
          sequence: 0,
          sink,
          messageInfoById: new Map(),
          partById: new Map(),
          messageIdByPartId: new Map(),
          partIdsByMessageId: new Map(),
          emittedPartSignatures: new Map(),
          emittedSequenceByPartId: new Map()
        },
        abortController.signal
      )
    };
  }

  private async runSession(
    request: ProviderRuntimeRunRequest,
    state: OpenCodeRuntimeState,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await Promise.all([
        this.consumeEventStream(state, signal),
        this.sendPrompt(state.providerSessionId, request, signal)
      ]);
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      await state.sink.emit({
        type: "error",
        status: "failed",
        providerSessionId: state.providerSessionId,
        rawStoreRef: state.rawStoreRef,
        errorCode: mapOpenCodeRuntimeErrorCode(error),
        detail: error instanceof Error ? error.message : "opencode runtime failed",
        timestamp: nextTimestamp()
      });
    }
  }

  private async consumeEventStream(
    state: OpenCodeRuntimeState,
    signal: AbortSignal
  ): Promise<void> {
    const response = await this.fetchResponse("/event", {
      signal
    });

    if (!response.body) {
      throw new Error("OPENCODE_EVENT_STREAM_UNAVAILABLE");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const next = await reader.read();

        if (next.done) {
          break;
        }

        buffer += decoder.decode(next.value, { stream: true });

        while (true) {
          const separatorIndex = buffer.indexOf("\n\n");

          if (separatorIndex < 0) {
            break;
          }

          const frame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          const payload = extractSseData(frame);

          if (!payload) {
            continue;
          }

          const rawEvent = JSON.parse(payload) as unknown;
          const event = unwrapEventPayload(rawEvent);

          if (!event) {
            continue;
          }

          const terminal = await this.handleEvent(event, state);

          if (terminal) {
            return;
          }
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async handleEvent(
    event: Record<string, unknown>,
    state: OpenCodeRuntimeState
  ): Promise<boolean> {
    const eventType = ensureText(event.type).trim();

    if (!eventType) {
      return false;
    }

    if (eventType === "session.error") {
      const properties = toJsonRecord(event.properties) ?? {};
      const sessionId = ensureText(properties.sessionID).trim();

      if (sessionId && sessionId !== state.providerSessionId) {
        return false;
      }

      const errorPayload = toJsonRecord(properties.error) ?? {};
      await state.sink.emit({
        type: "error",
        status: "failed",
        providerSessionId: state.providerSessionId,
        rawStoreRef: state.rawStoreRef,
        errorCode: ensureText(errorPayload.type).trim() || "OPENCODE_SESSION_ERROR",
        detail: extractTextBlocks(errorPayload).trim() || "OpenCode session failed",
        timestamp: nextTimestamp()
      });
      return true;
    }

    if (eventType === "session.status") {
      const properties = toJsonRecord(event.properties) ?? {};

      if (ensureText(properties.sessionID).trim() !== state.providerSessionId) {
        return false;
      }

      const status = toJsonRecord(properties.status) ?? {};
      const mapped = mapSessionStatus(status);

      await state.sink.emit({
        type: "status",
        status: mapped.status,
        providerSessionId: state.providerSessionId,
        rawStoreRef: state.rawStoreRef,
        detail: mapped.detail,
        timestamp: nextTimestamp()
      });
      return false;
    }

    if (eventType === "session.idle") {
      const properties = toJsonRecord(event.properties) ?? {};

      if (ensureText(properties.sessionID).trim() !== state.providerSessionId) {
        return false;
      }

      await state.sink.emit({
        type: "complete",
        status: "completed",
        providerSessionId: state.providerSessionId,
        rawStoreRef: state.rawStoreRef,
        detail: "OpenCode 本轮输出已结束",
        timestamp: nextTimestamp()
      });
      return true;
    }

    if (eventType === "message.updated") {
      const info = toJsonRecord(toJsonRecord(event.properties)?.info);
      const messageId = ensureText(info?.id).trim();
      const sessionId = ensureText(info?.sessionID).trim();

      if (!info || !messageId || sessionId !== state.providerSessionId) {
        return false;
      }

      state.messageInfoById.set(messageId, info);
      const partIds = state.partIdsByMessageId.get(messageId);

      if (!partIds) {
        return false;
      }

      for (const partId of partIds) {
        const part = state.partById.get(partId);

        if (part) {
          await this.emitNormalizedPartMessage(part, state);
        }
      }

      return false;
    }

    if (eventType === "message.part.updated") {
      const part = toJsonRecord(toJsonRecord(event.properties)?.part);
      const partId = ensureText(part?.id).trim();
      const messageId = ensureText(part?.messageID).trim();
      const sessionId = ensureText(part?.sessionID).trim();

      if (!part || !partId || !messageId || sessionId !== state.providerSessionId) {
        return false;
      }

      const merged = mergeRecords(state.partById.get(partId), part);
      state.partById.set(partId, merged);
      state.messageIdByPartId.set(partId, messageId);

      const knownPartIds = state.partIdsByMessageId.get(messageId) ?? new Set<string>();
      knownPartIds.add(partId);
      state.partIdsByMessageId.set(messageId, knownPartIds);

      await this.emitNormalizedPartMessage(merged, state);
      return false;
    }

    if (eventType === "message.part.delta") {
      const properties = toJsonRecord(event.properties) ?? {};
      const partId = ensureText(properties.partID).trim();
      const messageId = ensureText(properties.messageID).trim();
      const sessionId = ensureText(properties.sessionID).trim();

      if (!partId || sessionId !== state.providerSessionId) {
        return false;
      }

      const existing = state.partById.get(partId) ?? {};
      const field = ensureText(properties.field).trim();
      const delta = ensureText(properties.delta);
      const knownMessageId = messageId || state.messageIdByPartId.get(partId) || "";
      const nextPart: Record<string, unknown> = {
        ...existing,
        id: ensureText(existing.id).trim() || partId,
        messageID: ensureText(existing.messageID).trim() || knownMessageId,
        sessionID: ensureText(existing.sessionID).trim() || state.providerSessionId
      };

      if (field === "text") {
        if (!ensureText(nextPart.type).trim()) {
          nextPart.type = "text";
        }

        nextPart.text = `${ensureText(existing.text)}${delta}`;
      }

      state.partById.set(partId, nextPart);

      if (knownMessageId) {
        state.messageIdByPartId.set(partId, knownMessageId);
        const knownPartIds = state.partIdsByMessageId.get(knownMessageId) ?? new Set<string>();
        knownPartIds.add(partId);
        state.partIdsByMessageId.set(knownMessageId, knownPartIds);
      }

      await this.emitNormalizedPartMessage(nextPart, state);
      return false;
    }

    return false;
  }

  private async emitNormalizedPartMessage(
    partPayload: Record<string, unknown>,
    state: OpenCodeRuntimeState
  ): Promise<void> {
    if (!shouldEmitPart(partPayload)) {
      return;
    }

    const partId = ensureText(partPayload.id).trim();
    const messageId =
      ensureText(partPayload.messageID).trim() || state.messageIdByPartId.get(partId) || "";
    const messagePayload = state.messageInfoById.get(messageId);

    if (!messageId || !partId || !messagePayload) {
      return;
    }

    state.messageIdByPartId.set(partId, messageId);

    const normalized = normalizeOpenCodePartMessage({
      sessionId: state.providerSessionId,
      providerSessionId: state.providerSessionId,
      partId,
      messageId,
      partPayload,
      messagePayload,
      defaultTimestamp: nextTimestamp()
    });

    if (!normalized) {
      return;
    }

    const signature = [
      normalized.kind,
      normalized.content,
      normalized.toolCall?.status ?? "",
      normalized.toolCall?.output ?? "",
      normalized.toolCall?.error ?? ""
    ].join("|");

    if (state.emittedPartSignatures.get(partId) === signature) {
      return;
    }

    const currentSequence =
      state.emittedSequenceByPartId.get(partId)
      ?? (() => {
        state.sequence += 1;
        state.emittedSequenceByPartId.set(partId, state.sequence);
        return state.sequence;
      })();
    state.emittedPartSignatures.set(partId, signature);

    await state.sink.emit({
      type: "message",
      providerSessionId: state.providerSessionId,
      rawStoreRef: state.rawStoreRef,
      message: {
        ...normalized,
        sequence: currentSequence
      },
      status: "running",
      timestamp: normalized.timestamp,
      rawEventRef: normalized.rawRef
    });
  }

  private async createSession(workspacePath: string): Promise<string> {
    const response = await this.fetchJson<{ id?: unknown }>("/session", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      query: {
        directory: workspacePath
      },
      body: JSON.stringify({})
    });
    const sessionId = ensureText(response.id).trim();

    if (!sessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    return sessionId;
  }

  private resolveProviderSessionId(
    providerSessionId: string | null,
    rawStoreRef: string | null
  ): string {
    const explicit = providerSessionId?.trim();

    if (explicit) {
      return explicit;
    }

    const parsed = rawStoreRef ? parseSessionIdFromRawStoreRef(rawStoreRef) : null;

    if (parsed) {
      return parsed;
    }

    throw new Error("PROVIDER_SESSION_ID_REQUIRED");
  }

  private async sendPrompt(
    providerSessionId: string,
    request: ProviderRuntimeRunRequest,
    signal: AbortSignal
  ): Promise<void> {
    const content = request.options.providerPrompt?.trim() || request.options.content.trim();

    if (!content) {
      throw new Error("INVALID_INPUT");
    }

    const body: Record<string, unknown> = {
      parts: [
        {
          type: "text",
          text: content
        }
      ]
    };
    const model = parseModelSelection(request.options.model);

    if (model) {
      body.model = model;
    }

    await this.fetchJson(
      `/session/${encodeURIComponent(providerSessionId)}/message`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal
      }
    );
  }

  private async abortSession(providerSessionId: string): Promise<void> {
    await this.fetchJson(
      `/session/${encodeURIComponent(providerSessionId)}/abort`,
      {
        method: "POST"
      }
    );
  }

  private async resolveBaseUrl(refresh = false): Promise<string> {
    const resolved = this.options.baseUrlResolver
      ? await this.options.baseUrlResolver({ refresh })
      : this.options.baseUrl?.trim();

    if (!resolved) {
      throw new Error("SERVER_UNAVAILABLE");
    }

    return resolved.trim().replace(/\/+$/, "");
  }

  private resolveRequestTimeoutMs(): number {
    const configured = this.options.requestTimeoutMs;

    if (!Number.isFinite(configured)) {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }

    return Math.max(1_000, Math.floor(configured as number));
  }

  private async fetchResponse(
    pathname: string,
    input: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      query?: Record<string, string | undefined>;
      signal?: AbortSignal;
    } = {}
  ): Promise<Response> {
    return this.fetchResponseWithRetry(pathname, input, false);
  }

  private async fetchResponseWithRetry(
    pathname: string,
    input: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      query?: Record<string, string | undefined>;
      signal?: AbortSignal;
    },
    refresh: boolean,
    timeoutState: TimeoutRetryState = createTimeoutRetryState()
  ): Promise<Response> {
    const url = new URL(pathname, `${await this.resolveBaseUrl(refresh)}/`);

    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }

    const controller = new AbortController();
    const cleanup = bindAbortSignals(controller, input.signal);
    const timer = setTimeout(() => {
      controller.abort();
    }, this.resolveRequestTimeoutMs());

    try {
      const response = await fetch(url, {
        method: input.method ?? "GET",
        headers: input.headers,
        body: input.body,
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await safeReadResponseText(response);
        const mapped = mapRuntimeHttpError(response.status, detail);

        if (!refresh && isRuntimeServerUnavailableError(mapped) && this.options.baseUrlResolver) {
          return this.fetchResponseWithRetry(pathname, input, true);
        }

        throw mapped;
      }

      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        if (input.signal?.aborted) {
          throw error;
        }

        const nextTimeoutState = advanceTimeoutRetryState(timeoutState);

        if (!shouldSurfaceTimeout(nextTimeoutState)) {
          if (!refresh && this.options.baseUrlResolver) {
            return this.fetchResponseWithRetry(pathname, input, true, nextTimeoutState);
          }

          return this.fetchResponseWithRetry(pathname, input, refresh, nextTimeoutState);
        }

        throw new Error("SERVER_TIMEOUT");
      }

      if (isRuntimeRequestUnavailable(error)) {
        if (!refresh && this.options.baseUrlResolver) {
          return this.fetchResponseWithRetry(pathname, input, true, timeoutState);
        }

        throw new Error("SERVER_UNAVAILABLE");
      }

      throw error;
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  private async fetchJson<T = unknown>(
    pathname: string,
    input: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      query?: Record<string, string | undefined>;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const response = await this.fetchResponse(pathname, input);
    const text = await response.text();
    return text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);
  }
}

function shouldEmitPart(partPayload: Record<string, unknown>): boolean {
  const partType = ensureText(partPayload.type).trim().toLowerCase();

  if (partType === "text") {
    const text = ensureText(partPayload.text).trim();
    const time = toJsonRecord(partPayload.time);
    return text.length > 0 && (!time || typeof time.end === "number");
  }

  if (partType === "reasoning") {
    const text = ensureText(partPayload.text).trim();
    const time = toJsonRecord(partPayload.time);
    return text.length > 0 && Boolean(time && typeof time.end === "number");
  }

  if (partType === "tool") {
    const status = normalizeOpenCodeToolStatus(toJsonRecord(partPayload.state)?.status);
    return status !== "running";
  }

  if (partType === "step-start" || partType === "step-finish") {
    return false;
  }

  return true;
}

function mergeRecords(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> {
  if (!current) {
    return { ...next };
  }

  const merged = {
    ...current,
    ...next
  };

  const currentState = toJsonRecord(current.state);
  const nextState = toJsonRecord(next.state);

  if (currentState || nextState) {
    merged.state = {
      ...(currentState ?? {}),
      ...(nextState ?? {})
    };
  }

  const currentTime = toJsonRecord(current.time);
  const nextTime = toJsonRecord(next.time);

  if (currentTime || nextTime) {
    merged.time = {
      ...(currentTime ?? {}),
      ...(nextTime ?? {})
    };
  }

  return merged;
}

function extractSseData(frame: string): string | null {
  const lines = frame.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}

function unwrapEventPayload(rawEvent: unknown): Record<string, unknown> | null {
  const record = toJsonRecord(rawEvent);

  if (!record) {
    return null;
  }

  const payload = toJsonRecord(record.payload);
  return payload ?? record;
}

function mapSessionStatus(
  status: Record<string, unknown>
): { status: RuntimeRunState; detail: string | null } {
  const statusType = ensureText(status.type).trim().toLowerCase();

  if (statusType === "busy") {
    return {
      status: "running",
      detail: "OpenCode 正在处理这轮输入"
    };
  }

  if (statusType === "retry") {
    const attempt = ensureText(status.attempt).trim();
    const message = ensureText(status.message).trim();
    return {
      status: "running",
      detail: message || (attempt ? `OpenCode 正在重试（第 ${attempt} 次）` : "OpenCode 正在重试")
    };
  }

  return {
    status: "completed",
    detail: "OpenCode 当前空闲"
  };
}

function parseModelSelection(
  model: string | null
): { providerID: string; modelID: string } | null {
  const normalized = model?.trim();

  if (!normalized) {
    return null;
  }

  const slashIndex = normalized.indexOf("/");

  if (slashIndex > 0) {
    return {
      providerID: normalized.slice(0, slashIndex),
      modelID: normalized.slice(slashIndex + 1)
    };
  }

  return null;
}

function bindAbortSignals(
  controller: AbortController,
  upstream: AbortSignal | undefined
): () => void {
  if (!upstream) {
    return () => {
      return;
    };
  }

  const handleAbort = () => {
    controller.abort();
  };

  upstream.addEventListener("abort", handleAbort);

  return () => {
    upstream.removeEventListener("abort", handleAbort);
  };
}

function mapRuntimeHttpError(statusCode: number, detail: string): Error {
  if (statusCode === 404) {
    return new Error("PROVIDER_SESSION_NOT_FOUND");
  }

  if (statusCode === 409 && /active|running|busy/i.test(detail)) {
    return new Error("ACTIVE_RUN_EXISTS");
  }

  if (statusCode >= 500) {
    return new Error("SERVER_UNAVAILABLE");
  }

  return new Error(detail || `OPENCODE_HTTP_${statusCode}`);
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function isRuntimeServerUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === "SERVER_UNAVAILABLE";
}

function isRuntimeRequestUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = "cause" in error ? error.cause : null;

  if (cause && typeof cause === "object" && "code" in cause) {
    const code = typeof cause.code === "string" ? cause.code : "";

    if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND") {
      return true;
    }
  }

  return error.message === "fetch failed";
}

function createTimeoutRetryState(): TimeoutRetryState {
  return {
    startedAtMs: Date.now(),
    timeoutCount: 0
  };
}

function advanceTimeoutRetryState(state: TimeoutRetryState): TimeoutRetryState {
  return {
    startedAtMs: state.startedAtMs,
    timeoutCount: state.timeoutCount + 1
  };
}

function shouldSurfaceTimeout(state: TimeoutRetryState): boolean {
  return (
    state.timeoutCount >= MAX_CONSECUTIVE_TIMEOUTS
    || Date.now() - state.startedAtMs >= TIMEOUT_WARNING_THRESHOLD_MS
  );
}

function mapOpenCodeRuntimeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "OPENCODE_RUNTIME_FAILED";
  }

  if (error.message === "SERVER_TIMEOUT") {
    return "OPENCODE_REQUEST_TIMEOUT";
  }

  if (error.message === "SERVER_UNAVAILABLE") {
    return "OPENCODE_SERVER_UNAVAILABLE";
  }

  return "OPENCODE_RUNTIME_FAILED";
}
