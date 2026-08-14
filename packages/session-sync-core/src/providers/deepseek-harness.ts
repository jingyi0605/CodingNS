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

export interface DeepSeekHarnessStreamMessageMapper {
  map(input: unknown, fallbackSequence: number): NormalizedMessage[];
}

type HarnessAssistantPartKind = "thinking" | "text";

interface HarnessEntry {
  event: Record<string, unknown>;
  type: string;
  sequence: number;
  data: Record<string, unknown>;
  timestamp: string;
}

interface HarnessAssistantTrack {
  turn: string;
  step: string;
}

interface HarnessStreamBlock {
  track: HarnessAssistantTrack;
  partIndex: number;
  kind: HarnessAssistantPartKind;
  content: string;
  timestamp: string;
  sequence: number;
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
    const messages = (response.events ?? []).flatMap((entry, index) => mapHarnessEntries(providerSessionId, rawStoreRef, entry, index));
    return sliceHistory(messages, cursor, limit, direction);
  }

  subscribeSession(providerSessionId: string, rawStoreRef: string, cursor: string | null, _limit: number, onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void): ProviderSubscription {
    let lastSeq = cursor ? decodeHarnessCursor(cursor) : -1;
    const streamMapper = createDeepSeekHarnessStreamMessageMapper(providerSessionId, rawStoreRef);
    return this.options.transport.subscribe("mux", (envelope) => {
      const payload = asRecord(envelope.payload);
      if (envelope.method !== "events.push" && envelope.method !== "session/event") return;
      if (String(payload.sessionId ?? "") !== providerSessionId) return;
      const sourceEvent = payload.event ?? payload;
      const sequence = getHarnessEntrySequence(sourceEvent, lastSeq + 1);
      if (sequence <= lastSeq) return;
      lastSeq = sequence;
      const messages = streamMapper.map(sourceEvent, sequence);
      if (messages.length === 0) return;
      void onEvent({ messages, cursor: encodeHarnessCursor(lastSeq) });
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

/**
 * 兼容仍只接受单条消息的调用方。实时和历史路径应使用 mapHarnessEntries，
 * 因为 Harness 的一条 assistant/message 可能同时包含思考和正式正文。
 */
export function mapHarnessEntry(providerSessionId: string, rawStoreRef: string, input: unknown, fallbackSequence: number): NormalizedMessage | null {
  return mapHarnessSingleEntry(providerSessionId, rawStoreRef, readHarnessEntry(input, fallbackSequence));
}

export function mapHarnessEntries(providerSessionId: string, rawStoreRef: string, input: unknown, fallbackSequence: number): NormalizedMessage[] {
  const entry = readHarnessEntry(input, fallbackSequence);

  if (entry.type === "assistant/chunk") return [];

  if (entry.type === "assistant/message") {
    const parts = extractHarnessAssistantMessageParts(entry.data.message ?? entry.data.content);

    if (parts.length > 0) {
      const track = resolveHarnessAssistantTrack(entry.data, entry.sequence);
      return parts.map((part) => createHarnessAssistantPartMessage({
        providerSessionId,
        rawStoreRef,
        track,
        partIndex: part.partIndex,
        kind: part.kind,
        content: part.content,
        timestamp: entry.timestamp,
        sequence: entry.sequence
      }));
    }
  }

  const mapped = mapHarnessSingleEntry(providerSessionId, rawStoreRef, entry);
  return mapped ? [mapped] : [];
}

export function createDeepSeekHarnessStreamMessageMapper(
  providerSessionId: string,
  rawStoreRef: string
): DeepSeekHarnessStreamMessageMapper {
  const blocksByKey = new Map<string, HarnessStreamBlock>();

  return {
    map(input: unknown, fallbackSequence: number): NormalizedMessage[] {
      const entry = readHarnessEntry(input, fallbackSequence);

      if (entry.type === "assistant/chunk") {
        return mapHarnessAssistantChunk(providerSessionId, rawStoreRef, entry, blocksByKey);
      }

      if (entry.type === "assistant/message") {
        const track = resolveHarnessAssistantTrack(entry.data, entry.sequence);
        const messages = mapHarnessEntries(providerSessionId, rawStoreRef, input, fallbackSequence);
        clearHarnessAssistantTrack(blocksByKey, track);
        return messages;
      }

      return mapHarnessEntries(providerSessionId, rawStoreRef, input, fallbackSequence);
    }
  };
}

export function getHarnessEntrySequence(input: unknown, fallbackSequence: number): number {
  return readHarnessEntry(input, fallbackSequence).sequence;
}

export function isHarnessAssistantChunk(input: unknown): boolean {
  return readHarnessEntry(input, 0).type === "assistant/chunk";
}

function mapHarnessSingleEntry(providerSessionId: string, rawStoreRef: string, entry: HarnessEntry): NormalizedMessage | null {
  const { event, type, sequence, data, timestamp } = entry;
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
  // Harness 会推送没有正文的 assistant 状态事件；它们不是可显示的对话消息。
  if (!content && (role === "system" || (role === "assistant" && kind === "text"))) return null;
  return { messageId: messageIdFromStableKey(stable), provider: "deepseek-harness", providerSessionId, role, kind, content, toolCall: null, timestamp, sequence, rawRef: `${rawStoreRef}#seq=${sequence}` };
}

function mapHarnessAssistantChunk(
  providerSessionId: string,
  rawStoreRef: string,
  entry: HarnessEntry,
  blocksByKey: Map<string, HarnessStreamBlock>
): NormalizedMessage[] {
  const chunk = asRecord(entry.data.chunk);
  const partIndex = readHarnessPartIndex(chunk.index);

  if (partIndex === null) return [];

  const track = resolveHarnessAssistantTrack(entry.data, entry.sequence);
  const key = buildHarnessStreamBlockKey(track, partIndex);
  const chunkType = ensureText(chunk.type).trim();

  if (chunkType === "block-start") {
    const kind = resolveHarnessAssistantPartKind(chunk.blockType);
    if (!kind) return [];
    blocksByKey.set(key, {
      track,
      partIndex,
      kind,
      content: "",
      timestamp: entry.timestamp,
      sequence: entry.sequence
    });
    return [];
  }

  if (chunkType === "reasoning-delta" || chunkType === "text-delta") {
    const kind = chunkType === "reasoning-delta" ? "thinking" : "text";
    const block = getOrCreateHarnessStreamBlock(blocksByKey, key, {
      track,
      partIndex,
      kind,
      timestamp: entry.timestamp,
      sequence: entry.sequence
    });
    const delta = ensureText(chunk.text);
    if (!delta) return [];
    block.content += delta;
    return [createHarnessAssistantPartMessage({
      providerSessionId,
      rawStoreRef,
      track: block.track,
      partIndex: block.partIndex,
      kind: block.kind,
      content: block.content,
      timestamp: block.timestamp,
      sequence: block.sequence
    })];
  }

  if (chunkType === "block-end") {
    const completedBlock = asRecord(chunk.block);
    const kind = resolveHarnessAssistantPartKind(completedBlock.type) ?? blocksByKey.get(key)?.kind ?? null;
    if (!kind) return [];
    const block = getOrCreateHarnessStreamBlock(blocksByKey, key, {
      track,
      partIndex,
      kind,
      timestamp: entry.timestamp,
      sequence: entry.sequence
    });
    const content = extractTextBlocks(completedBlock.text ?? completedBlock.content);
    if (content) block.content = content;
    if (!block.content) return [];
    return [createHarnessAssistantPartMessage({
      providerSessionId,
      rawStoreRef,
      track: block.track,
      partIndex: block.partIndex,
      kind: block.kind,
      content: block.content,
      timestamp: block.timestamp,
      sequence: block.sequence
    })];
  }

  return [];
}

function getOrCreateHarnessStreamBlock(
  blocksByKey: Map<string, HarnessStreamBlock>,
  key: string,
  input: Omit<HarnessStreamBlock, "content">
): HarnessStreamBlock {
  const existing = blocksByKey.get(key);
  if (existing) return existing;
  const created: HarnessStreamBlock = { ...input, content: "" };
  blocksByKey.set(key, created);
  return created;
}

function extractHarnessAssistantMessageParts(value: unknown): Array<{ partIndex: number; kind: HarnessAssistantPartKind; content: string }> {
  const record = asRecord(value);
  const content = Array.isArray(value) ? value : Array.isArray(record.content) ? record.content : null;
  if (!content) return [];

  return content.flatMap((part, partIndex) => {
    const block = asRecord(part);
    const kind = resolveHarnessAssistantPartKind(block.type);
    if (!kind) return [];
    const text = extractTextBlocks(kind === "thinking" ? block.text ?? block.thinking ?? block.content : block.text ?? block.content);
    return text ? [{ partIndex, kind, content: text }] : [];
  });
}

function createHarnessAssistantPartMessage(input: {
  providerSessionId: string;
  rawStoreRef: string;
  track: HarnessAssistantTrack;
  partIndex: number;
  kind: HarnessAssistantPartKind;
  content: string;
  timestamp: string;
  sequence: number;
}): NormalizedMessage {
  const stable = `${input.providerSessionId}:assistant:${input.track.turn}:${input.track.step}:${input.kind}:${input.partIndex}`;
  return {
    messageId: messageIdFromStableKey(stable),
    provider: "deepseek-harness",
    providerSessionId: input.providerSessionId,
    role: "assistant",
    kind: input.kind,
    content: input.content,
    toolCall: null,
    timestamp: input.timestamp,
    sequence: input.sequence,
    rawRef: buildHarnessAssistantPartRawRef(input.rawStoreRef, input.track, input.kind, input.partIndex)
  };
}

function readHarnessEntry(input: unknown, fallbackSequence: number): HarnessEntry {
  const record = asRecord(input);
  const event = asRecord(record.event ?? record);
  const data = asRecord(event.data ?? event.message ?? event);
  return {
    event,
    type: typeof event.type === "string" ? event.type : "unknown",
    sequence: typeof event.seq === "number" ? event.seq : fallbackSequence,
    data,
    timestamp: normalizeTimestamp(event.time ?? event.timestamp ?? data.timestamp)
  };
}

function resolveHarnessAssistantTrack(data: Record<string, unknown>, sequence: number): HarnessAssistantTrack {
  return {
    turn: normalizeHarnessTrackPart(data.turn, `seq-${sequence}`),
    step: normalizeHarnessTrackPart(data.step, "default")
  };
}

function normalizeHarnessTrackPart(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim().replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return fallback;
}

function readHarnessPartIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function resolveHarnessAssistantPartKind(value: unknown): HarnessAssistantPartKind | null {
  const type = ensureText(value).trim();
  if (type === "reasoning" || type === "thinking") return "thinking";
  if (type === "text") return "text";
  return null;
}

function buildHarnessStreamBlockKey(track: HarnessAssistantTrack, partIndex: number): string {
  return `${track.turn}:${track.step}:${partIndex}`;
}

function clearHarnessAssistantTrack(blocksByKey: Map<string, HarnessStreamBlock>, track: HarnessAssistantTrack): void {
  const prefix = `${track.turn}:${track.step}:`;
  for (const key of blocksByKey.keys()) {
    if (key.startsWith(prefix)) blocksByKey.delete(key);
  }
}

function buildHarnessAssistantPartRawRef(
  rawStoreRef: string,
  track: HarnessAssistantTrack,
  kind: HarnessAssistantPartKind,
  partIndex: number
): string {
  const messageKey = `turn-${track.turn}-step-${track.step}`;
  return `${rawStoreRef}/message/${messageKey}/part/${kind}-${partIndex}?part=${partIndex}`;
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
