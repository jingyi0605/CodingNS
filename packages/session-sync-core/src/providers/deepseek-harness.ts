import { randomUUID } from "node:crypto";

import type {
  ContextUsageSnapshot,
  DetectSessionsOptions,
  ForkSessionOptions,
  ForkSessionResult,
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderAdapter,
  ProviderArchiveUpdateResult,
  ProviderCapabilities,
  ProviderModelOption,
  ProviderRealtimeEvent,
  ProviderSessionActivityObservation,
  ProviderSessionStats,
  ProviderSessionStatsReadOptions,
  ProviderSessionSummary,
  ProviderSubscription,
  ResumeSessionResult,
  SendMessageResult,
  StartSessionOptions,
  StartSessionResult
} from "../types.js";
import { addDerivedCacheHitRate } from "../session-stats.js";
import {
  addCatalogCostMetric,
  filterUsageLinesByBillingStart,
  type VerifiedUsageLine
} from "../session-pricing.js";
import { deleteDeepSeekHarnessSessionFiles } from "./deepseek-harness-session-store.js";
import { ensureText, extractTextBlocks, messageIdFromStableKey, nextTimestamp } from "./utils.js";

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
  dshHomeDir?: string;
}

export interface DeepSeekHarnessStreamMessageMapper {
  map(input: unknown, fallbackSequence: number): NormalizedMessage[];
}

/** DSH turn/end 是会话结束状态的唯一权威来源，不能用 host 的 running=false 替代。 */
export interface DeepSeekHarnessTurnEndActivity {
  sequence: number;
  runningState: "completed" | "interrupted" | "failed";
  observedAt: string;
  detail: string | null;
  errorCode: string | null;
  runId: string | null;
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
    const archivedSessionIds = await this.readArchivedSessionIds();
    return (response.items ?? [])
      .map((item) => normalizeSummary(item, workspacePath, this.options.harnessVersion))
      .filter((item): item is ProviderSessionSummary => item !== null)
      .filter((item) => !archivedSessionIds.has(item.providerSessionId))
      .filter((item) => normalizePath(item.workspacePath) === normalizePath(workspacePath));
  }

  async readSessionActivity(
    providerSessionId: string,
    _rawStoreRef: string
  ): Promise<ProviderSessionActivityObservation | null> {
    const response = await this.options.transport.call<{ items?: unknown[] }>("session.list", {});
    const session = (response.items ?? [])
      .map((item) => asRecord(item))
      .find((item) => ensureText(item.sessionId ?? item.id).trim() === providerSessionId.trim());

    if (!session) {
      return null;
    }

    const observedAt = normalizeOptionalTimestamp(session.updatedAt ?? session.createdAt);

    if (session.running === true) {
      return {
        runningState: "running",
        confidence: "authoritative",
        observedAt,
        detail: null,
        errorCode: null,
        runId: null
      };
    }

    const history = await this.options.transport.call<{ events?: unknown[] }>("session.history", {
      sessionId: providerSessionId,
      maxMessages: 100
    });

    return resolveHarnessHistoryActivity(history.events ?? [], observedAt) ?? {
      runningState: "idle",
      confidence: "authoritative",
      observedAt,
      detail: null,
      errorCode: null,
      runId: null
    };
  }

  async readSessionHistory(providerSessionId: string, rawStoreRef: string, cursor: string | null, limit: number, direction: HistoryDirection = "forward"): Promise<HistoryPage> {
    const cursorSequence = cursor ? decodeHarnessCursor(cursor) : null;
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const beforeSeq = direction === "backward" ? cursorSequence ?? undefined : undefined;
    const response = await this.options.transport.call<{ events?: unknown[]; hasMore?: boolean }>("session.history", {
      sessionId: providerSessionId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: safeLimit
    });
    const entries = (response.events ?? [])
      .map((entry, index) => ({ input: entry, sequence: getHarnessEntrySequence(entry, index) }))
      .sort((left, right) => left.sequence - right.sequence);
    const messages = entries.flatMap((entry) =>
      mapHarnessEntries(providerSessionId, rawStoreRef, entry.input, entry.sequence)
    );
    const latestSequence = entries.at(-1)?.sequence ?? cursorSequence;

    if (direction === "forward") {
      const messagesAfterCursor = cursorSequence === null
        ? messages
        : messages.filter((message) => message.sequence > cursorSequence);

      return {
        messages: messagesAfterCursor,
        cursor: latestSequence === null ? cursor : encodeHarnessCursor(latestSequence),
        nextCursor: null,
        total: messagesAfterCursor.length
      };
    }

    const pageMessages = messages.length > safeLimit ? messages.slice(-safeLimit) : messages;
    const oldestSequence = pageMessages[0]?.sequence ?? entries[0]?.sequence ?? null;
    const hasOlderMessages = response.hasMore === true || messages.length > pageMessages.length;

    return {
      messages: pageMessages,
      cursor: latestSequence === null ? cursor : encodeHarnessCursor(latestSequence),
      nextCursor: hasOlderMessages && oldestSequence !== null
        ? encodeHarnessCursor(oldestSequence)
        : null,
      total: messages.length
    };
  }

  async readSessionStats(
    providerSessionId: string,
    _rawStoreRef: string,
    options?: ProviderSessionStatsReadOptions
  ): Promise<ProviderSessionStats | null> {
    // 累计指标继续读取原生 projection。只有启用计费的新会话才让同一次 history
    // 响应携带原始事件，用于按 (turn, step) 折叠模型和最终 usage。
    const { projections, values, events } = await this.readHistoryProjections(
      providerSessionId,
      Boolean(options?.billing)
    );
    const sessionStats = asRecord(values.sessionStats);
    const tokenUsage = asRecord(values.tokenUsage);
    const capturedAt = nextTimestamp();
    const asOfSequence = readNonNegativeNumber(projections.asOfSeq);
    const watermark = asOfSequence === null
      ? { kind: "captured-at" as const, value: capturedAt }
      : { kind: "source-sequence" as const, value: String(asOfSequence) };
    const metrics: ProviderSessionStats["metrics"] = {};

    addHarnessProjectionMetric(metrics, "turns", sessionStats.turns, watermark);
    addHarnessProjectionMetric(metrics, "steps", sessionStats.steps, watermark);
    addHarnessProjectionMetric(metrics, "llmMs", sessionStats.llmMs, watermark);
    addHarnessProjectionMetric(metrics, "toolMs", sessionStats.toolMs, watermark);
    addHarnessProjectionMetric(metrics, "ttftMs", sessionStats.ttftMs, watermark);
    addHarnessProjectionMetric(metrics, "ttftSteps", sessionStats.ttftSteps, watermark);
    addHarnessProjectionMetric(metrics, "decodeMs", sessionStats.decodeMs, watermark);
    addHarnessProjectionMetric(metrics, "decodeTokens", sessionStats.decodeTokens, watermark);
    const uncachedInputTokens = readNonNegativeNumber(tokenUsage.uncachedInputTokens);
    const cacheReadTokens = readNonNegativeNumber(tokenUsage.cacheReadTokens);
    const cacheWriteTokens = readNonNegativeNumber(tokenUsage.cacheWriteTokens);

    addHarnessProjectionMetric(metrics, "uncachedInputTokens", uncachedInputTokens, watermark);
    if (uncachedInputTokens !== null && cacheReadTokens !== null && cacheWriteTokens !== null) {
      addHarnessProjectionMetric(
        metrics,
        "inputTokens",
        uncachedInputTokens + cacheReadTokens + cacheWriteTokens,
        watermark
      );
    } else {
      // 旧版 projection 可能没有完整的三个输入桶，继续保留未缓存输入作为兼容值。
      addHarnessProjectionMetric(
        metrics,
        "inputTokens",
        tokenUsage.inputTokens ?? tokenUsage.uncachedInputTokens,
        watermark
      );
    }
    addHarnessProjectionMetric(metrics, "outputTokens", tokenUsage.outputTokens, watermark);
    addHarnessProjectionMetric(metrics, "cacheReadTokens", cacheReadTokens, watermark);
    addHarnessProjectionMetric(metrics, "cacheWriteTokens", cacheWriteTokens, watermark);
    // Harness 明确把三类 token 作为互不重叠的计费输入桶。
    addDerivedCacheHitRate(metrics, {
      denominator: ["uncachedInputTokens", "cacheReadTokens", "cacheWriteTokens"]
    });

    const usageLines = buildHarnessUsageLines(events);
    const billingLines = filterUsageLinesByBillingStart(usageLines, options?.billing);
    const latestEvent = events
      .map((event, index) => readHarnessEntry(event, index))
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    const costWatermark = latestEvent
      ? { kind: "source-sequence" as const, value: String(latestEvent.sequence) }
      : watermark;
    addCatalogCostMetric(metrics, billingLines, options, costWatermark);

    return Object.keys(metrics).length > 0
      ? { provider: this.providerId, capturedAt, metrics }
      : null;
  }

  async readContextUsage(
    providerSessionId: string,
    _rawStoreRef: string
  ): Promise<ContextUsageSnapshot | null> {
    const { values } = await this.readHistoryProjections(providerSessionId);
    const contextPressure = asRecord(values.contextPressure);
    // `projectedTokens` 是 Harness 为下一次请求推进后的上下文压力。它包含 provider
    // usage 锚点后的表层增量，正是原生 ContextMeter 用于显示占用率的值。
    const promptTokens = readNonNegativeNumber(contextPressure.projectedTokens);
    const contextWindow = readPositiveNumber(contextPressure.contextWindow);

    if (promptTokens === null || contextWindow === null) {
      return null;
    }

    return {
      provider: this.providerId,
      promptTokens,
      contextWindow,
      usageRatio: clampHarnessContextUsage(promptTokens, contextWindow),
      source: "provider-runtime",
      contextWindowSource: "provider-runtime",
      modelId: null,
      capturedAt: nextTimestamp(),
      isEstimated: true
    };
  }

  subscribeSession(providerSessionId: string, rawStoreRef: string, cursor: string | null, _limit: number, onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void): ProviderSubscription {
    let lastSeq = cursor ? decodeHarnessCursor(cursor) ?? -1 : -1;
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
    const workspace = await this.options.transport.call<{ workspace?: { workspaceId?: string } }>("workspace.create", { path: workspacePath });
    const workspaceId = String(workspace.workspace?.workspaceId ?? "").trim();
    if (!workspaceId) throw new Error("HARNESS_WORKSPACE_ID_MISSING");
    const created = await this.options.transport.call<{ sessionId: string }>("session.create", { workspaceId });
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
    if (options.strategy === "reconstruct-only") throw new Error("HARNESS_RECONSTRUCTED_MESSAGE_FORK_NOT_SUPPORTED");

    const forkAnchor = options.sourceType === "message"
      ? await this.resolveForkAnchor(providerSessionId, options.rawStoreRef, options.sourceMessageId!)
      : null;
    const atSeq = forkAnchor?.atSeq;
    const inheritedPrefixMessageCount = forkAnchor?.inheritedPrefixMessageCount
      ?? await this.resolveSessionForkMessageCount(providerSessionId, options.rawStoreRef);
    const response = await this.options.transport.call<{ sessionId: string }>("session.fork", {
      sessionId: providerSessionId,
      ...(atSeq === undefined ? {} : { atSeq })
    });
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
        messageCount: inheritedPrefixMessageCount,
        parentProviderSessionId: providerSessionId
      },
      forkMethod: "native_session_fork",
      forkSourceType: options.sourceType,
      inheritedPrefixMessageCount,
      providerSourceMessageId: options.sourceMessageId ?? null
    };
  }

  private async resolveForkAnchor(
    providerSessionId: string,
    rawStoreRef: string,
    sourceMessageId: string
  ): Promise<{ atSeq: number; inheritedPrefixMessageCount: number }> {
    const entries = await this.readForkHistoryEntries(providerSessionId);
    const sourceMessage = entries
      .flatMap((entry) => mapHarnessEntries(providerSessionId, rawStoreRef, entry.event, entry.sequence))
      .find((message) => message.messageId === sourceMessageId);

    if (!sourceMessage) {
      throw new Error("FORK_SOURCE_MESSAGE_NOT_FOUND");
    }

    const seedEndSequence = resolveHarnessForkSeedEndSequence(entries, sourceMessage.sequence);
    return {
      atSeq: sourceMessage.sequence,
      inheritedPrefixMessageCount: countHarnessForkMessages(
        providerSessionId,
        rawStoreRef,
        entries,
        seedEndSequence
      )
    };
  }

  private async resolveSessionForkMessageCount(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<number> {
    const entries = await this.readForkHistoryEntries(providerSessionId);
    return countHarnessForkMessages(
      providerSessionId,
      rawStoreRef,
      entries,
      resolveHarnessForkSeedEndSequence(entries)
    );
  }

  private async readForkHistoryEntries(providerSessionId: string): Promise<HarnessEntry[]> {
    let beforeSeq: number | undefined;
    const pages: HarnessEntry[][] = [];
    const seenCursors = new Set<number>();

    while (true) {
      const response = await this.options.transport.call<{ events?: unknown[]; hasMore?: boolean }>("session.history", {
        sessionId: providerSessionId,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: 100
      });
      const entries = (response.events ?? [])
        .map((entry, index) => readHarnessEntry(entry, index))
        .sort((left, right) => left.sequence - right.sequence);

      if (entries.length === 0) {
        break;
      }

      pages.unshift(entries);
      const oldestSequence = entries[0]?.sequence;

      if (response.hasMore !== true || oldestSequence === undefined || seenCursors.has(oldestSequence)) {
        break;
      }

      seenCursors.add(oldestSequence);
      beforeSeq = oldestSequence;
    }

    return pages.flat();
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

  async deleteSession(providerSessionId: string, _rawStoreRef: string): Promise<void> {
    const response = await this.options.transport.call<{ items?: unknown[] }>("session.list", {});
    const record = (response.items ?? [])
      .map((item) => asRecord(item))
      .find((item) => ensureText(item.sessionId ?? item.id).trim() === providerSessionId.trim());
    const cwd = ensureText(record?.cwd).trim() || null;

    if (record) {
      await this.callIgnoringMissingSession("session.cancel", { sessionId: providerSessionId });
      await this.callIgnoringMissingSession("workspace.archiveSession", { sessionId: providerSessionId });
    }

    deleteDeepSeekHarnessSessionFiles(providerSessionId, {
      cwd,
      dshHomeDir: this.options.dshHomeDir
    });
  }

  async updateSessionArchiveState(_providerSessionId: string, _rawStoreRef: string, _isArchived: boolean): Promise<ProviderArchiveUpdateResult> {
    throw new Error("HARNESS_CAPABILITY_UNSUPPORTED");
  }

  private async readHistoryProjections(providerSessionId: string, includeEvents = false): Promise<{
    projections: Record<string, unknown>;
    values: Record<string, unknown>;
    events: unknown[];
  }> {
    const response = await this.options.transport.call<{ projections?: unknown; events?: unknown[] }>("session.history", {
      sessionId: providerSessionId,
      maxMessages: includeEvents ? 1000 : 1
    });
    const projections = asRecord(response.projections);

    return {
      projections,
      values: asRecord(projections.values),
      events: includeEvents ? response.events ?? [] : []
    };
  }

  getProviderCapabilities(): ProviderCapabilities {
    return harnessCapabilities();
  }

  async getSessionCapabilities(providerSessionId: string): Promise<ProviderCapabilities> {
    try {
      const response = await this.options.transport.call<unknown>(
        providerSessionId ? "session.models" : "llm.models",
        providerSessionId ? { sessionId: providerSessionId } : {}
      );
      return harnessCapabilities(parseHarnessModelOptions(response));
    } catch {
      // 模型目录不可用时仍保留会话的基本能力，避免只因下拉列表失败而阻断对话。
      return harnessCapabilities();
    }
  }

  private async readArchivedSessionIds(): Promise<Set<string>> {
    try {
      const response = await this.options.transport.call<{ archivedSessionIds?: unknown[] }>("workspace.list", {});
      return new Set(
        (response.archivedSessionIds ?? [])
          .map((value) => ensureText(value).trim())
          .filter(Boolean)
      );
    } catch {
      // 旧 Harness 没有 workspace.list 时不阻断已有的会话发现链路。
      return new Set();
    }
  }

  private async callIgnoringMissingSession(method: string, payload: unknown): Promise<void> {
    try {
      await this.options.transport.call(method, payload);
    } catch (error) {
      if (!isHarnessMissingSessionError(error)) {
        throw error;
      }
    }
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

    if (hasHarnessAssistantMessageBlocks(entry.data)) {
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

export function parseHarnessTurnEndActivity(
  input: unknown,
  fallbackSequence: number
): DeepSeekHarnessTurnEndActivity | null {
  const entry = readHarnessEntry(input, fallbackSequence);

  if (entry.type !== "turn/end") {
    return null;
  }

  const reasonInput = entry.data.reason;
  const reason = asRecord(reasonInput);
  const kind = ensureText(
    typeof reasonInput === "string" ? reasonInput : reason.kind
  ).trim().toLowerCase();
  const runningState = mapHarnessTurnEndReason(kind);

  if (!runningState) {
    return null;
  }

  const reasonError = asRecord(reason.error);
  const detail = extractTextBlocks(
    reason.message
    ?? reason.detail
    ?? reasonError.message
    ?? entry.data.error
    ?? entry.data.message
    ?? ""
  ).trim() || null;
  const errorCode = runningState === "failed"
    ? ensureText(reason.code ?? reasonError.code ?? entry.data.errorCode).trim() || "HARNESS_TURN_FAILED"
    : null;

  return {
    sequence: entry.sequence,
    runningState,
    observedAt: entry.timestamp,
    detail: runningState === "failed" ? detail ?? "Harness turn failed" : detail,
    errorCode,
    runId: ensureText(entry.data.turn).trim() || null
  };
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
    const result = extractHarnessToolResult(data, sequence);
    return { messageId: messageIdFromStableKey(stable), provider: "deepseek-harness", providerSessionId, role: "tool", kind: "tool_result", content: result.content, toolCall: { callId: result.callId, name: result.name, input: "", output: result.error ? null : result.content, error: result.error, status: result.failed ? "failed" : "completed" }, timestamp, sequence, rawRef: `${rawStoreRef}#seq=${sequence}` };
  }
  const role = isHarnessSystemContextMessage(type, data)
    ? "system"
    : type.startsWith("user/") ? "user" : type.startsWith("assistant/") ? "assistant" : "system";
  const kind = type === "assistant/thinking" ? "thinking" : "text";
  const content = extractTextBlocks(data.text ?? data.content ?? data.message ?? event.text ?? "");
  // Harness 会推送没有正文的 assistant 状态事件；它们不是可显示的对话消息。
  if (!content && (role === "system" || (role === "assistant" && kind === "text"))) return null;
  return { messageId: messageIdFromStableKey(stable), provider: "deepseek-harness", providerSessionId, role, kind, content, toolCall: null, timestamp, sequence, rawRef: `${rawStoreRef}#seq=${sequence}` };
}

function resolveHarnessHistoryActivity(
  entries: unknown[],
  fallbackObservedAt: string | null
): ProviderSessionActivityObservation | null {
  let latest: DeepSeekHarnessTurnEndActivity | null = null;

  for (let index = 0; index < entries.length; index += 1) {
    const terminal = parseHarnessTurnEndActivity(entries[index], index);

    if (!terminal || (latest && terminal.sequence < latest.sequence)) {
      continue;
    }

    latest = terminal;
  }

  if (!latest) {
    return null;
  }

  return {
    runningState: latest.runningState,
    confidence: "authoritative",
    observedAt: latest.observedAt || fallbackObservedAt,
    detail: latest.detail,
    errorCode: latest.errorCode,
    runId: latest.runId
  };
}

function mapHarnessTurnEndReason(
  kind: string
): DeepSeekHarnessTurnEndActivity["runningState"] | null {
  if (kind === "completed" || kind === "complete" || kind === "success") {
    return "completed";
  }

  if (kind === "failed" || kind === "failure" || kind === "error") {
    return "failed";
  }

  if (
    kind === "interrupted"
    || kind === "interrupt"
    || kind === "aborted"
    || kind === "cancelled"
    || kind === "canceled"
    || kind === "blocked"
    || kind === "max-tokens"
    || kind === "max_tokens"
  ) {
    return "interrupted";
  }

  return null;
}

function hasHarnessAssistantMessageBlocks(data: Record<string, unknown>): boolean {
  const message = asRecord(data.message);
  return Array.isArray(message.content) || Array.isArray(data.content);
}

function isHarnessSystemContextMessage(type: string, data: Record<string, unknown>): boolean {
  if (type !== "user/message") {
    return false;
  }

  const source = asRecord(data.source);
  const kind = ensureText(source.kind).trim();

  if (kind === "agent-instructions") {
    return true;
  }

  return kind === "plugin"
    && ensureText(source.plugin).trim() === "@deepseek-ai/dsh-system-prompt"
    && ensureText(source.form).trim() === "snapshot";
}

function extractHarnessToolResult(data: Record<string, unknown>, sequence: number): {
  callId: string;
  name: string;
  content: string;
  error: string | null;
  failed: boolean;
} {
  const message = asRecord(data.message);
  const source = asRecord(message.source);
  const resultBlock = (Array.isArray(message.content) ? message.content : [])
    .map((block) => asRecord(block))
    .find((block) => ensureText(block.type).trim() === "tool-result") ?? {};
  const content = extractTextBlocks(
    resultBlock.content ?? data.output ?? data.result ?? data.error ?? ""
  );
  const failed = resultBlock.isError === true || data.isError === true || data.error != null;
  const error = failed
    ? extractTextBlocks(data.error ?? resultBlock.error ?? content).trim() || null
    : null;

  return {
    callId: ensureText(
      data.callId ?? data.id ?? source.callId ?? resultBlock.toolCallId ?? `${sequence}`
    ),
    name: ensureText(data.name ?? data.toolName ?? source.toolName),
    content,
    error,
    failed
  };
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

function resolveHarnessForkSeedEndSequence(
  entries: readonly HarnessEntry[],
  anchorSequence?: number
): number {
  if (entries.length === 0) {
    return -1;
  }

  let boundaryIndex = -1;

  if (anchorSequence === undefined) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.type === "turn/end") {
        boundaryIndex = index;
        break;
      }
    }
  } else {
    boundaryIndex = entries.findIndex(
      (entry: HarnessEntry) => entry.type === "turn/end" && entry.sequence >= anchorSequence
    );
  }

  if (boundaryIndex < 0) {
    return anchorSequence ?? entries.at(-1)!.sequence;
  }

  let seedEndIndex = boundaryIndex + 1;

  while (seedEndIndex < entries.length && entries[seedEndIndex]?.type !== "turn/start") {
    seedEndIndex += 1;
  }

  return entries[seedEndIndex - 1]?.sequence ?? entries[boundaryIndex]!.sequence;
}

function countHarnessForkMessages(
  providerSessionId: string,
  rawStoreRef: string,
  entries: readonly HarnessEntry[],
  seedEndSequence: number
): number {
  if (seedEndSequence < 0) {
    return 0;
  }

  return entries
    .filter((entry) => entry.sequence <= seedEndSequence)
    .flatMap((entry) => mapHarnessEntries(providerSessionId, rawStoreRef, entry.event, entry.sequence))
    .length;
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
  return { provider: "deepseek-harness", providerSessionId, title: ensureText(record.title).trim() || `DeepSeek Harness ${providerSessionId.slice(0, 8)}`, workspacePath: ensureText(record.cwd).trim() || workspacePath, rawStoreRef: buildRawStoreRef(version, providerSessionId), isArchived: record.isArchived === true || record.archived === true, lastMessageAt: normalizeTimestamp(record.updatedAt ?? record.createdAt), messageCount: typeof record.messageCount === "number" ? record.messageCount : 0 };
}

function isHarnessMissingSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session[- ]?not[- ]?found|unknown session|no such session/i.test(message);
}

function buildRawStoreRef(version: string | undefined, sessionId: string): string { return `harness://${version ?? "0.1.0-rc.5"}/${sessionId}`; }
function harnessCapabilities(modelOptions?: ProviderModelOption[]): ProviderCapabilities {
  return {
    provider: "deepseek-harness",
    canStartSession: true,
    canResumeSession: false,
    canSendMessage: true,
    inRunInputMode: "queued_guidance",
    supportsSubagents: true,
    supportsInterrupt: true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: false,
    supportsAttachments: true,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    supportsSessionDiff: false,
    supportsSessionFork: true,
    supportsSessionDelete: true,
    supportsSessionShare: false,
    supportsAsyncPrompt: true,
    supportsNativeAgents: true,
    ...(modelOptions && modelOptions.length > 0 ? { modelOptions } : {}),
    limitations: [
      "Harness 仍是 Developer Preview，版本必须锁定。",
      "断线恢复先读取 history，不依赖 events.mux 的 since。",
      "删除会话会归档当前 sidecar 中的会话并清理 JSONL 历史目录；不支持 Diff、Share 和独立 resume。"
    ]
  };
}

/** 将 DSH 的 provider/model 二元组编码为运行时 selectModel 可直接消费的稳定模型 ID。 */
function parseHarnessModelOptions(input: unknown): ProviderModelOption[] {
  const options = new Map<string, ProviderModelOption>();
  const groups = asRecord(input).groups;

  if (!Array.isArray(groups)) {
    return [];
  }

  for (const groupInput of groups) {
    const group = asRecord(groupInput);
    const provider = ensureText(group.id).trim();
    const models = group.models;

    if (!provider || !Array.isArray(models)) {
      continue;
    }

    for (const modelInput of models) {
      const model = asRecord(modelInput);
      const modelId = ensureText(model.id).trim();

      if (!modelId) {
        continue;
      }

      const reasoning = asRecord(model.reasoning);
      const supportedReasoningEfforts = Array.isArray(reasoning.efforts)
        ? Array.from(new Set(
          reasoning.efforts
            .map((effort) => ensureText(asRecord(effort).id).trim())
            .filter(Boolean)
        ))
        : [];
      const defaultReasoningEffort = ensureText(reasoning.defaultEffort).trim();
      const id = `${provider}:${modelId}`;

      if (!options.has(id)) {
        options.set(id, {
          id,
          name: ensureText(model.name).trim() || modelId,
          ...(supportedReasoningEfforts.length > 0 ? { supportedReasoningEfforts } : {}),
          ...(defaultReasoningEffort ? { defaultReasoningEffort } : {})
        });
      }
    }
  }

  return [...options.values()];
}
function createAcceptedMessage(providerSessionId: string, content: string, timestamp: string): NormalizedMessage { const messageId = randomUUID(); return { messageId, provider: "deepseek-harness", providerSessionId, role: "user", kind: "text", content, toolCall: null, timestamp, sequence: Number.MAX_SAFE_INTEGER, rawRef: `synthetic://deepseek-harness/${providerSessionId}/${messageId}` }; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = readNonNegativeNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function clampHarnessContextUsage(promptTokens: number, contextWindow: number): number {
  return Math.max(0, Math.min(promptTokens / contextWindow, 1));
}

interface HarnessUsageCandidate {
  turn: string;
  step: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  timestamp: string;
  sequence: number;
}

function buildHarnessUsageLines(events: readonly unknown[]): VerifiedUsageLine[] {
  const usageByTrack = new Map<string, HarnessUsageCandidate>();
  const modelByTrack = new Map<string, string>();
  const latestModelBySession = { value: "" };
  const terminalStateByTurn = new Map<string, {
    state: DeepSeekHarnessTurnEndActivity["runningState"];
    sequence: number;
  }>();

  for (let index = 0; index < events.length; index += 1) {
    const entry = readHarnessEntry(events[index], index);
    const turn = normalizeHarnessTrackPart(
      entry.data.turn ?? entry.data.turnId ?? entry.data.turn_id,
      ""
    );
    const step = normalizeHarnessTrackPart(
      entry.data.step ?? entry.data.stepId ?? entry.data.step_id,
      "default"
    );
    const model = resolveHarnessEventModel(entry.data);

    if (model) {
      latestModelBySession.value = model;
    }

    if (entry.type === "turn/end" && turn) {
      const terminal = parseHarnessTurnEndActivity(entry.event, entry.sequence);
      const previous = terminalStateByTurn.get(turn);

      if (terminal && (!previous || terminal.sequence >= previous.sequence)) {
        terminalStateByTurn.set(turn, {
          state: terminal.runningState,
          sequence: terminal.sequence
        });
      }
    }

    if (!turn) {
      continue;
    }

    const trackKey = `${turn}:${step}`;

    if (model) {
      modelByTrack.set(trackKey, model);
    }

    const usage = resolveHarnessEventUsage(entry.data);

    if (!usage) {
      continue;
    }

    usageByTrack.set(trackKey, {
      turn,
      step,
      model: model || modelByTrack.get(trackKey) || latestModelBySession.value,
      ...usage,
      timestamp: entry.timestamp,
      sequence: entry.sequence
    });
  }

  return [...usageByTrack.values()].map((candidate) => ({
    key: `${candidate.turn}:${candidate.step}`,
    turnKey: candidate.turn,
    provider: "deepseek-harness",
    model: candidate.model || modelByTrack.get(`${candidate.turn}:${candidate.step}`) || latestModelBySession.value,
    inputTokens: candidate.inputTokens ?? 0,
    outputTokens: candidate.outputTokens ?? 0,
    reasoningTokens: candidate.reasoningTokens ?? 0,
    cacheReadTokens: candidate.cacheReadTokens ?? 0,
    cacheWriteTokens: candidate.cacheWriteTokens ?? 0,
    inputIncludesCacheRead: false,
    completed: Boolean(
      (candidate.model || modelByTrack.get(`${candidate.turn}:${candidate.step}`) || latestModelBySession.value)
      && candidate.timestamp
      && candidate.inputTokens !== null
      && candidate.outputTokens !== null
      // `assistant/message.usage` 是 provider 已经结算的 step 用量；用户中断或
      // provider 失败也可能产生可计费用量。只要存在可识别的 turn/end 终态，就
      // 认为这条 usage 已经封口，未知终态仍然拒绝计费。
      && terminalStateByTurn.has(candidate.turn)
    ),
    timestamp: candidate.timestamp
  }));
}

function resolveHarnessEventModel(data: Record<string, unknown>): string {
  const request = asRecord(data.request);
  const header = asRecord(data.header);
  const context = asRecord(data.context);
  const message = asRecord(data.message);
  const chunk = asRecord(data.chunk);
  const source = asRecord(data.source);
  const requestHeader = asRecord(request.header);
  const requestContext = asRecord(request.context);
  const requestConfig = asRecord(request.config);
  const headerConfig = asRecord(header.config);
  const messageSource = asRecord(message.source);
  const chunkSource = asRecord(chunk.source);
  return ensureText(
    data.model
    ?? data.modelId
    ?? data.model_id
    ?? source.model
    ?? source.modelId
    ?? source.model_id
    ?? request.model
    ?? request.modelId
    ?? request.model_id
    ?? requestHeader.model
    ?? requestHeader.modelId
    ?? requestHeader.model_id
    ?? requestContext.model
    ?? requestContext.modelId
    ?? requestContext.model_id
    ?? requestConfig.model
    ?? requestConfig.modelId
    ?? requestConfig.model_id
    ?? header.model
    ?? header.modelId
    ?? header.model_id
    ?? headerConfig.model
    ?? headerConfig.modelId
    ?? headerConfig.model_id
    ?? context.model
    ?? context.modelId
    ?? context.model_id
    ?? message.model
    ?? message.modelId
    ?? message.model_id
    ?? messageSource.model
    ?? messageSource.modelId
    ?? messageSource.model_id
    ?? chunk.model
    ?? chunk.modelId
    ?? chunk.model_id
    ?? chunkSource.model
    ?? chunkSource.modelId
    ?? chunkSource.model_id
  ).trim();
}

function resolveHarnessEventUsage(data: Record<string, unknown>): Omit<HarnessUsageCandidate, "turn" | "step" | "model" | "timestamp" | "sequence"> | null {
  const message = asRecord(data.message);
  const chunk = asRecord(data.chunk);
  const candidates = [
    asRecord(data.usage),
    asRecord(data.tokenUsage),
    asRecord(data.token_usage),
    asRecord(data.tokens),
    asRecord(message.usage),
    asRecord(message.tokens),
    asRecord(chunk.usage),
    asRecord(chunk.tokens)
  ];
  const usage = candidates.find((candidate) => Object.keys(candidate).length > 0);

  if (!usage) {
    return null;
  }

  const inputTokens = readHarnessUsageNumber(usage, [
    "uncachedInputTokens",
    "uncached_input_tokens",
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens"
  ]);
  const outputTokens = readHarnessUsageNumber(usage, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens"
  ]);

  if (inputTokens === null && outputTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: readHarnessUsageNumber(usage, ["reasoningTokens", "reasoning_tokens", "thoughts", "thinking"]),
    cacheReadTokens: readHarnessUsageNumber(usage, ["cacheReadTokens", "cache_read_tokens", "cachedInputTokens", "cached_input_tokens"]),
    cacheWriteTokens: readHarnessUsageNumber(usage, ["cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens"])
  };
}

function readHarnessUsageNumber(record: Record<string, unknown>, fields: readonly string[]): number | null {
  for (const field of fields) {
    const value = readNonNegativeNumber(record[field]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function addHarnessProjectionMetric(
  metrics: ProviderSessionStats["metrics"],
  metric: keyof ProviderSessionStats["metrics"],
  rawValue: unknown,
  watermark: { kind: "source-sequence" | "captured-at"; value: string }
): void {
  const value = readNonNegativeNumber(rawValue);

  if (value === null) {
    return;
  }

  metrics[metric] = {
    value,
    source: "provider-projection",
    semantic: "cumulative",
    watermark
  };
}
function normalizePath(value: string): string { return value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase(); }
function normalizeOptionalTimestamp(value: unknown): string | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    return null;
  }

  const timestamp = new Date(
    typeof value === "number" && value < 1e12 ? value * 1000 : value
  );
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}
function normalizeTimestamp(value: unknown): string { if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString(); if (typeof value === "string" && value.trim()) return new Date(value).toISOString(); return nextTimestamp(); }
function encodeHarnessCursor(sequence: number): string { return Buffer.from(JSON.stringify({ sequence }), "utf8").toString("base64url"); }
function decodeHarnessCursor(cursor: string): number | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      sequence?: unknown;
      index?: unknown;
    };

    if (typeof parsed.sequence === "number" && Number.isInteger(parsed.sequence) && parsed.sequence >= 0) {
      return parsed.sequence;
    }

    // 旧版本把通用 { index } cursor 写进了 Harness 会话；重读最新页以迁移该游标，不能把 index 当 seq 传给 DSH。
    if (typeof parsed.index === "number") {
      return null;
    }

    throw new Error("CURSOR_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "CURSOR_INVALID") {
      throw error;
    }

    throw new Error("CURSOR_INVALID");
  }
}
