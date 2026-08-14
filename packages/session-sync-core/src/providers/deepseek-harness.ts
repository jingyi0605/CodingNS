import { randomUUID } from "node:crypto";

import type {
  DetectSessionsOptions,
  ForkSessionOptions,
  ForkSessionResult,
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderAdapter,
  ProviderArchiveUpdateResult,
  ProviderCapabilities,
  ProviderRealtimeEvent,
  ProviderSessionSummary,
  ProviderSubscription,
  ResumeSessionResult,
  SendMessageResult,
  StartSessionOptions,
  StartSessionResult
} from "../types.js";
import { ensureText, extractTextBlocks, messageIdFromStableKey, nextTimestamp, sliceHistory } from "./utils.js";

export interface DeepSeekHarnessEnvelope {
  rpcId: string;
  method: string;
  payload: unknown;
}

export interface DeepSeekHarnessTransport {
  call<T>(method: string, payload: unknown): Promise<T>;
  subscribe(channel: "mux" | "host", onEnvelope: (envelope: DeepSeekHarnessEnvelope) => void): ProviderSubscription;
}

export interface DeepSeekHarnessProviderOptions {
  transport: DeepSeekHarnessTransport;
  harnessVersion?: string;
}

export class DeepSeekHarnessAdapter implements ProviderAdapter {
  readonly providerId = "deepseek-harness" as const;

  constructor(private readonly options: DeepSeekHarnessProviderOptions) {}

  async detectSessions(workspacePath: string, _options?: DetectSessionsOptions): Promise<ProviderSessionSummary[]> {
    const response = await this.options.transport.call<{ items?: unknown[] }>("session.list", {});
    return (response.items ?? []).map((item) => normalizeSummary(item, workspacePath, this.options.harnessVersion)).filter((item): item is ProviderSessionSummary => item !== null).filter((item) => normalizePath(item.workspacePath) === normalizePath(workspacePath));
  }

  async readSessionHistory(providerSessionId: string, rawStoreRef: string, cursor: string | null, limit: number, direction: HistoryDirection = "forward"): Promise<HistoryPage> {
    const beforeSeq = direction === "backward" && cursor ? decodeHarnessCursor(cursor) : undefined;
    const response = await this.options.transport.call<{ events?: unknown[]; hasMore?: boolean }>("session.history", {
      sessionId: providerSessionId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: Math.max(1, Math.min(limit, 100))
    });
    const messages = (response.events ?? []).map((entry, index) => mapHarnessEntry(providerSessionId, rawStoreRef, entry, index)).filter((message): message is NormalizedMessage => message !== null);
    return sliceHistory(messages, cursor, limit, direction);
  }

  subscribeSession(providerSessionId: string, rawStoreRef: string, cursor: string | null, _limit: number, onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void): ProviderSubscription {
    let lastSeq = cursor ? decodeHarnessCursor(cursor) : -1;
    return this.options.transport.subscribe("mux", (envelope) => {
      const payload = asRecord(envelope.payload);
      if (envelope.method !== "events.push" && envelope.method !== "session/event") return;
      if (String(payload.sessionId ?? "") !== providerSessionId) return;
      const mapped = mapHarnessEntry(providerSessionId, rawStoreRef, payload.event ?? payload, 0);
      if (!mapped || mapped.sequence <= lastSeq) return;
      lastSeq = mapped.sequence;
      void onEvent({ messages: [mapped], cursor: encodeHarnessCursor(lastSeq) });
    });
  }

  async resumeSession(providerSessionId: string, rawStoreRef: string): Promise<ResumeSessionResult> {
    await this.options.transport.call("session.history", { sessionId: providerSessionId, maxMessages: 1 });
    throw new Error("HARNESS_CAPABILITY_UNSUPPORTED");
  }

  async startSession(workspacePath: string, options: StartSessionOptions): Promise<StartSessionResult> {
    const created = await this.options.transport.call<{ sessionId: string }>("session.create", { cwd: workspacePath });
    const sessionId = String(created.sessionId);
    if (options.initialPrompt?.trim()) await this.options.transport.call("session.prompt", { sessionId, content: [{ type: "text", text: options.initialPrompt.trim() }], mode: "queue" });
    return {
      session: {
        provider: this.providerId,
        providerSessionId: sessionId,
        title: options.initialPrompt?.trim().slice(0, 80) || `DeepSeek Harness ${sessionId.slice(0, 8)}`,
        workspacePath,
        rawStoreRef: buildRawStoreRef(this.options.harnessVersion, sessionId),
        isArchived: false,
        lastMessageAt: nextTimestamp(),
        messageCount: options.initialPrompt?.trim() ? 1 : 0
      },
      initialCursor: null
    };
  }

  async forkSession(providerSessionId: string, workspacePath: string, options: ForkSessionOptions): Promise<ForkSessionResult> {
    if (options.sourceType === "message" && !options.sourceMessageId) throw new Error("FORK_SOURCE_MESSAGE_ID_REQUIRED");
    const response = await this.options.transport.call<{ sessionId: string }>("session.fork", { sessionId: providerSessionId, ...(options.sourceMessageId ? { atSeq: Number(options.sourceMessageId) || undefined } : {}) });
    const sessionId = response.sessionId;
    return {
      session: {
        provider: this.providerId,
        providerSessionId: sessionId,
        title: `DeepSeek Harness ${sessionId.slice(0, 8)}`,
        workspacePath,
        rawStoreRef: buildRawStoreRef(this.options.harnessVersion, sessionId),
        isArchived: false,
        lastMessageAt: nextTimestamp(),
        messageCount: 0,
        parentProviderSessionId: providerSessionId
      },
      forkMethod: "native_session_fork",
      forkSourceType: options.sourceType,
      inheritedPrefixMessageCount: 0,
      providerSourceMessageId: options.sourceMessageId ?? null
    };
  }

  async sendMessage(providerSessionId: string, _rawStoreRef: string, content: string, clientRequestId: string | null, permissionMode?: string | null): Promise<SendMessageResult> {
    const acceptedAt = nextTimestamp();
    await this.options.transport.call("session.prompt", { sessionId: providerSessionId, content: [{ type: "text", text: content }], mode: permissionMode === "steer" ? "steer" : "queue" });
    const message = createAcceptedMessage(providerSessionId, content, acceptedAt);
    return { acceptedAt, clientRequestId, message };
  }

  async readSessionTitle(providerSessionId: string): Promise<string> {
    const response = await this.options.transport.call<{ items?: unknown[] }>("session.list", {});
    const summaries = (response.items ?? [])
      .map((item) => normalizeSummary(item, "", this.options.harnessVersion))
      .filter((item): item is ProviderSessionSummary => item !== null);
    return summaries.find((summary) => summary.providerSessionId === providerSessionId)?.title ?? `DeepSeek Harness ${providerSessionId.slice(0, 8)}`;
  }

  async renameSessionTitle(providerSessionId: string, _rawStoreRef: string, title: string): Promise<string> {
    const response = await this.options.transport.call<{ title?: string }>("session.rename", { sessionId: providerSessionId, title });
    return response.title?.trim() || title.trim();
  }

  async updateSessionArchiveState(_providerSessionId: string, _rawStoreRef: string, _isArchived: boolean): Promise<ProviderArchiveUpdateResult> {
    throw new Error("HARNESS_CAPABILITY_UNSUPPORTED");
  }

  getProviderCapabilities(): ProviderCapabilities {
    return harnessCapabilities();
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return harnessCapabilities();
  }
}

export function mapHarnessEntry(providerSessionId: string, rawStoreRef: string, input: unknown, fallbackSequence: number): NormalizedMessage | null {
  const record = asRecord(input);
  const event = asRecord(record.event ?? record);
  const type = typeof event.type === "string" ? event.type : "unknown";
  const sequence = typeof event.seq === "number" ? event.seq : fallbackSequence;
  const data = asRecord(event.data ?? event.message ?? event);
  const timestamp = normalizeTimestamp(event.time ?? event.timestamp ?? data.timestamp);
  const stable = `${providerSessionId}:${sequence}:${type}`;
  if (["turn/start", "turn/end", "session/subscribed"].includes(type)) return null;
  if (type === "tool/call") {
    const callId = ensureText(data.callId ?? data.id ?? `${sequence}`);
    return { messageId: messageIdFromStableKey(stable), provider: "deepseek-harness", providerSessionId, role: "tool", kind: "tool_call", content: extractTextBlocks(data.input ?? data.arguments ?? ""), toolCall: { callId, name: ensureText(data.name ?? data.toolName), input: extractTextBlocks(data.input ?? data.arguments ?? ""), output: null, error: null, status: "running" }, timestamp, sequence, rawRef: `${rawStoreRef}#seq=${sequence}` };
  }
  if (type === "tool/result") {
    const callId = ensureText(data.callId ?? data.id ?? `${sequence}`);
    const error = data.error ? extractTextBlocks(data.error) : null;
    return { messageId: messageIdFromStableKey(stable), provider: "deepseek-harness", providerSessionId, role: "tool", kind: "tool_result", content: extractTextBlocks(data.output ?? data.result ?? data.error ?? ""), toolCall: { callId, name: ensureText(data.name ?? data.toolName), input: "", output: error ? null : extractTextBlocks(data.output ?? data.result ?? ""), error, status: error ? "failed" : "completed" }, timestamp, sequence, rawRef: `${rawStoreRef}#seq=${sequence}` };
  }
  const role = type.startsWith("user/") ? "user" : type.startsWith("assistant/") ? "assistant" : "system";
  const kind = type === "assistant/thinking" ? "thinking" : "text";
  const content = extractTextBlocks(data.text ?? data.content ?? data.message ?? event.text ?? "");
  if (!content && role === "system") return null;
  return { messageId: messageIdFromStableKey(stable), provider: "deepseek-harness", providerSessionId, role, kind, content, toolCall: null, timestamp, sequence, rawRef: `${rawStoreRef}#seq=${sequence}` };
}

function normalizeSummary(input: unknown, workspacePath: string, version = "0.1.0-rc.5"): ProviderSessionSummary | null {
  const record = asRecord(input);
  const providerSessionId = ensureText(record.sessionId ?? record.id).trim();
  if (!providerSessionId) return null;
  return { provider: "deepseek-harness", providerSessionId, title: ensureText(record.title).trim() || `DeepSeek Harness ${providerSessionId.slice(0, 8)}`, workspacePath: ensureText(record.cwd).trim() || workspacePath, rawStoreRef: buildRawStoreRef(version, providerSessionId), isArchived: false, lastMessageAt: normalizeTimestamp(record.updatedAt ?? record.createdAt), messageCount: typeof record.messageCount === "number" ? record.messageCount : 0 };
}

function buildRawStoreRef(version: string | undefined, sessionId: string): string { return `harness://${version ?? "0.1.0-rc.5"}/${sessionId}`; }
function harnessCapabilities(): ProviderCapabilities { return { provider: "deepseek-harness", canStartSession: true, canResumeSession: false, canSendMessage: true, inRunInputMode: "queued_guidance", supportsSubagents: true, supportsInterrupt: true, supportsStructuredToolCalls: true, supportsTokenUsage: false, supportsAttachments: true, supportsPermissionPrompt: true, supportsCheckpoint: false, supportsSessionDiff: false, supportsSessionFork: true, supportsSessionDelete: false, supportsSessionShare: false, supportsAsyncPrompt: true, supportsNativeAgents: true, limitations: ["Harness 仍是 Developer Preview，版本必须锁定。", "断线恢复先读取 history，不依赖 events.mux 的 since。", "首版不支持删除、Diff、Share 和独立 resume。"] }; }
function createAcceptedMessage(providerSessionId: string, content: string, timestamp: string): NormalizedMessage { return { messageId: randomUUID(), provider: "deepseek-harness", providerSessionId, role: "user", kind: "text", content, toolCall: null, timestamp, sequence: -1, rawRef: `harness://${providerSessionId}/accepted` }; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function normalizePath(value: string): string { return value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase(); }
function normalizeTimestamp(value: unknown): string { if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString(); if (typeof value === "string" && value.trim()) return new Date(value).toISOString(); return nextTimestamp(); }
function encodeHarnessCursor(sequence: number): string { return Buffer.from(JSON.stringify({ sequence }), "utf8").toString("base64url"); }
function decodeHarnessCursor(cursor: string): number { try { const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { sequence?: number }; return typeof parsed.sequence === "number" ? parsed.sequence : -1; } catch { throw new Error("CURSOR_INVALID"); } }
