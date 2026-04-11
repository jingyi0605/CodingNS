import { basename, dirname, join } from "node:path";
import { existsSync, statSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";

import {
  buildClaudeMessageSignature,
  buildClaudeProgressiveTrackKey,
  buildClaudeStableRawRef,
  normalizeClaudeMessagePart,
  normalizeClaudeMessageParts,
  readClaudeMessageId,
  shouldReuseClaudeProgressiveIdentity,
  toClaudeRecord,
  type ClaudeMessageEnvelope,
  type ClaudeStableMessageRef
} from "../claude-message-utils.js";
import type {
  ContextUsageSnapshot,
  DetectSessionsOptions,
  ForkSessionOptions,
  ForkSessionResult,
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderId,
  ProviderModelOption,
  ProviderRealtimeEvent,
  ProviderSessionSummary,
  ProviderSubscription,
  ResumeSessionResult,
  SendMessageResult,
  StartSessionOptions,
  StartSessionResult
} from "../types.js";
import {
  appendJsonLine,
  createRawRef,
  encodeCursor,
  ensureDirectory,
  ensureText,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath,
  readFirstNonEmptyLine,
  readJsonLines,
  safeDate,
  sliceHistory,
  walkJsonlFiles,
  workspaceSlug
} from "./utils.js";

interface ClaudeCodeAdapterOptions {
  homeDir: string;
}

interface ClaudeHistoryCacheEntry {
  filePath: string;
  providerSessionId: string;
  mtimeMs: number;
  size: number;
  messages: NormalizedMessage[];
}

interface ClaudeSubagentMetadata {
  providerSessionId: string;
  parentProviderSessionId: string;
  subagentLabel: string | null;
}

interface ClaudeForkTargetLocation {
  recordIndex: number;
  partIndex: number;
  recordSource: ClaudeMessageEnvelope["source"];
  providerSourceMessageId: string | null;
}

const HISTORY_CACHE_LIMIT = 6;
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const CLAUDE_MODEL_OPTIONS: ProviderModelOption[] = [
  {
    id: "provider-default",
    name: "跟随 CLI 默认模型",
    usesProviderDefault: true
  },
  {
    id: "sonnet",
    name: "Sonnet"
  },
  {
    id: "opus",
    name: "Opus"
  },
  {
    id: "haiku",
    name: "Haiku"
  }
];

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "claude-code";
  private readonly historyCache = new Map<string, ClaudeHistoryCacheEntry>();

  constructor(private readonly options: ClaudeCodeAdapterOptions) {}

  async detectSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const files = this.listWorkspaceFiles(workspacePath);
    const subagentMetadataByFilePath = buildClaudeSubagentMetadataIndex(files);
    const knownByRawStoreRef = new Map(
      (options?.knownSessions ?? [])
        .filter((session) => session.provider === this.providerId)
        .map((session) => [session.rawStoreRef, session] as const)
    );
    const sessions: ProviderSessionSummary[] = [];

    for (const filePath of files) {
      if (isPendingClaudeRuntimeFile(filePath)) {
        continue;
      }

      if (shouldHideClaudeDebugSession(filePath)) {
        continue;
      }

      const stats = statSync(filePath);
      const known = knownByRawStoreRef.get(filePath);
      const subagentMetadata = subagentMetadataByFilePath.get(filePath);
      const providerSessionId =
        subagentMetadata?.providerSessionId ?? basename(filePath, ".jsonl");

      if (
        known
        && known.sourceMtimeMs === stats.mtimeMs
        && known.sourceSizeBytes === stats.size
        && normalizeWorkspacePath(known.workspacePath) === targetPath
      ) {
        sessions.push({
          ...known,
          providerSessionId,
          rawStoreRef: filePath,
          parentProviderSessionId: subagentMetadata?.parentProviderSessionId ?? null,
          isSubagent: subagentMetadata !== undefined,
          subagentLabel: known.subagentLabel ?? subagentMetadata?.subagentLabel ?? null,
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        });
        continue;
      }

      const records = readJsonLines(filePath);
      const typedRecords = records.map((record) => record.data);
      const matchesWorkspace = typedRecords.some(
        (record) => normalizeWorkspacePath(ensureText(record.cwd)) === targetPath
      );

      if (!matchesWorkspace) {
        continue;
      }

      const messages = this.parseMessages(filePath, typedRecords);
      const title =
        this.resolveClaudeTitle(typedRecords) ||
        messages.find((message) => message.role === "user")?.content.slice(0, 48) ||
        basename(filePath, ".jsonl");
      const lastMessageAt =
        messages.at(-1)?.timestamp ??
        (ensureText(typedRecords.at(-1)?.timestamp) || null);

      sessions.push({
        provider: this.providerId,
        providerSessionId,
        title,
        workspacePath,
        rawStoreRef: filePath,
        lastMessageAt,
        messageCount: messages.length,
        parentProviderSessionId: subagentMetadata?.parentProviderSessionId ?? null,
        isSubagent: subagentMetadata !== undefined,
        subagentLabel: subagentMetadata?.subagentLabel ?? null,
        sourceMtimeMs: stats.mtimeMs,
        sourceSizeBytes: stats.size
      });
    }

    return sessions.sort((left, right) =>
      (left.lastMessageAt ?? "").localeCompare(right.lastMessageAt ?? "")
    );
  }

  async readSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    const messages = this.getParsedMessages(rawStoreRef, providerSessionId);
    return sliceHistory(messages, cursor, limit, direction);
  }

  subscribeSession(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription {
    let currentCursor = cursor;
    let lastMtime = statSync(rawStoreRef).mtimeMs;

    const timer = setInterval(async () => {
      const nextStat = statSync(rawStoreRef);

      if (nextStat.mtimeMs <= lastMtime) {
        return;
      }

      lastMtime = nextStat.mtimeMs;

      const page = await this.readSessionHistory(providerSessionId, rawStoreRef, currentCursor, limit);

      if (page.messages.length === 0) {
        return;
      }

      currentCursor = page.cursor;

      await onEvent({
        messages: page.messages,
        cursor: page.cursor
      });
    }, 300);

    return {
      close() {
        clearInterval(timer);
      }
    };
  }

  async resumeSession(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ResumeSessionResult> {
    statSync(rawStoreRef);

    return {
      provider: this.providerId,
      providerSessionId,
      resumedAt: nextTimestamp(),
      rawStoreRef
    };
  }

  async startSession(
    workspacePath: string,
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    const sessionId = crypto.randomUUID();
    const projectDir = join(this.options.homeDir, "projects", workspaceSlug(workspacePath));
    ensureDirectory(projectDir);

    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const now = nextTimestamp();

    appendJsonLine(filePath, {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: now,
      sessionId
    });

    if (options.initialPrompt) {
      appendJsonLine(filePath, {
        parentUuid: null,
        isSidechain: false,
        promptId: crypto.randomUUID(),
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: options.initialPrompt }]
        },
        uuid: crypto.randomUUID(),
        timestamp: now,
        cwd: workspacePath,
        sessionId
      });
    }

    appendJsonLine(filePath, {
      type: "ai-title",
      sessionId,
      aiTitle: options.initialPrompt?.slice(0, 48) || "New Claude Code session"
    });

    return {
      session: {
        provider: this.providerId,
        providerSessionId: sessionId,
        title: options.initialPrompt?.slice(0, 48) || "New Claude Code session",
        workspacePath,
        rawStoreRef: filePath,
        isArchived: false,
        lastMessageAt: now,
        messageCount: options.initialPrompt ? 1 : 0
      },
      initialCursor: encodeCursor(options.initialPrompt ? 1 : 0)
    };
  }

  async forkSession(
    providerSessionId: string,
    workspacePath: string,
    options: ForkSessionOptions
  ): Promise<ForkSessionResult> {
    const sourceFilePath = this.resolveForkSourceFilePath(options.rawStoreRef, providerSessionId);
    const sourceRecords = readJsonLines(sourceFilePath).map((record) => record.data);
    const forkedSessionId = crypto.randomUUID();
    const projectDir = join(this.options.homeDir, "projects", workspaceSlug(workspacePath));

    ensureDirectory(projectDir);

    let forkedRecords = sourceRecords.map((record) => cloneJsonRecord(record));
    let providerSourceMessageId: string | null = null;
    let forkMethod: ForkSessionResult["forkMethod"] = "native_session_fork";

    if (options.sourceType === "message") {
      const targetMessageId = options.sourceMessageId?.trim();

      if (!targetMessageId) {
        throw new Error("FORK_SOURCE_MESSAGE_ID_REQUIRED");
      }

      const target = this.locateForkTarget(sourceRecords, providerSessionId, targetMessageId);

      if (!target) {
        throw new Error("FORK_SOURCE_MESSAGE_NOT_FOUND");
      }

      forkedRecords = forkedRecords.slice(0, target.recordIndex + 1);
      forkedRecords[target.recordIndex] = truncateClaudeForkRecord(
        forkedRecords[target.recordIndex],
        target
      );
      providerSourceMessageId = target.providerSourceMessageId;
      forkMethod = "native_message_fork";
    }

    const targetFilePath = join(projectDir, `${forkedSessionId}.jsonl`);
    const persistedForkRecords = forkedRecords
      // fork 后的标题必须由子会话自己生成，不能把父会话的 ai-title 原样抄过去。
      .filter((record) => shouldPreserveClaudeForkRecord(record));
    const serializedRecords = persistedForkRecords
      .map((record) => replaceClaudeRecordSessionId(record, forkedSessionId))
      .map((record) => JSON.stringify(record))
      .join("\n");

    writeFileSync(targetFilePath, `${serializedRecords}\n`, "utf8");
    this.historyCache.delete(targetFilePath);

    const messages = this.getParsedMessages(targetFilePath, forkedSessionId);
    const title = this.resolveClaudeTitle(persistedForkRecords) || "";

    return {
      session: {
        provider: this.providerId,
        providerSessionId: forkedSessionId,
        title,
        workspacePath,
        rawStoreRef: targetFilePath,
        isArchived: false,
        lastMessageAt: messages.at(-1)?.timestamp ?? nextTimestamp(),
        messageCount: messages.length,
        parentProviderSessionId: null,
        isSubagent: false,
        subagentLabel: null
      },
      forkMethod,
      forkSourceType: options.sourceType,
      inheritedPrefixMessageCount: messages.length,
      providerSourceMessageId
    };
  }

  async sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null,
    _permissionMode?: string | null
  ): Promise<SendMessageResult> {
    const records = readJsonLines(rawStoreRef).map((record) => record.data);
    const lineNumber = records.length + 1;
    const acceptedAt = nextTimestamp();
    const cwd =
      records
        .map((record) => ensureText(record.cwd))
        .find((value) => value.length > 0) ?? "";

    appendJsonLine(rawStoreRef, {
      parentUuid: null,
      isSidechain: false,
      promptId: crypto.randomUUID(),
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: content }]
      },
      uuid: crypto.randomUUID(),
      timestamp: acceptedAt,
      cwd,
      sessionId: providerSessionId,
      clientRequestId
    });

    const rawRef = createRawRef(this.providerId, rawStoreRef, lineNumber, 0);
    this.historyCache.delete(rawStoreRef);

    return {
      acceptedAt,
      clientRequestId,
      message: {
        messageId: messageIdFromRawRef(rawRef),
        provider: this.providerId,
        providerSessionId,
        role: "user",
        kind: "text",
        content,
        toolCall: null,
        timestamp: acceptedAt,
        sequence: this.parseMessages(
          rawStoreRef,
          readJsonLines(rawStoreRef).map((record) => record.data),
          providerSessionId
        ).length,
        rawRef
      }
    };
  }

  async readSessionTitle(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<string> {
    if (isPendingClaudeRuntimeRef(providerSessionId, rawStoreRef)) {
      return "";
    }

    statSync(rawStoreRef);
    const records = readJsonLines(rawStoreRef).map((record) => record.data);
    const messages = this.parseMessages(rawStoreRef, records, providerSessionId);

    return (
      this.resolveClaudeTitle(records) ||
      messages.find((message) => message.role === "user")?.content.slice(0, 48) ||
      basename(rawStoreRef, ".jsonl")
    );
  }

  async renameSessionTitle(
    providerSessionId: string,
    rawStoreRef: string,
    title: string
  ): Promise<string> {
    const nextTitle = title.trim();

    statSync(rawStoreRef);
    appendJsonLine(rawStoreRef, {
      type: "ai-title",
      sessionId: providerSessionId,
      aiTitle: nextTitle
    });
    this.historyCache.delete(rawStoreRef);

    return nextTitle;
  }

  async updateSessionArchiveState(): Promise<import("../types.js").ProviderArchiveUpdateResult> {
    throw new Error("claude-code archive state is managed by host");
  }

  getProviderCapabilities(): ProviderCapabilities {
    return {
      provider: this.providerId,
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: true,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsPermissionRequests: true,
      supportsSessionFork: true,
      supportsCheckpoint: false,
      modelOptions: CLAUDE_MODEL_OPTIONS,
      limitations: ["当前实现只读取原生 jsonl，会话恢复不负责拉起外部 Claude 进程。"]
    };
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  async readContextUsage(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ContextUsageSnapshot | null> {
    statSync(rawStoreRef);
    const records = readJsonLines(rawStoreRef).map((record) => record.data);

    for (let index = records.length - 1; index >= 0; index -= 1) {
      const snapshot = extractClaudeUsageSnapshot(records[index]);

      if (!snapshot) {
        continue;
      }

      const uncachedInputTokens = readNonNegativeInteger(snapshot.usage.input_tokens) ?? 0;
      const cacheCreationInputTokens =
        readNonNegativeInteger(snapshot.usage.cache_creation_input_tokens) ?? 0;
      const cacheReadInputTokens = readNonNegativeInteger(snapshot.usage.cache_read_input_tokens) ?? 0;
      const cachedInputTokens = cacheCreationInputTokens + cacheReadInputTokens;
      const promptTokens = uncachedInputTokens + cachedInputTokens;
      const modelId = ensureText(snapshot.model ?? snapshot.recordModel).trim() || null;
      const contextWindow = resolveClaudeContextWindow(modelId);

      return {
        provider: this.providerId,
        promptTokens,
        uncachedInputTokens,
        cachedInputTokens,
        contextWindow,
        usageRatio: clampClaudeUsageRatio(promptTokens, contextWindow),
        source: "provider-log",
        contextWindowSource: "model-map",
        modelId,
        capturedAt: safeDate(snapshot.timestamp, "").trim() || null,
        isEstimated: true
      };
    }

    return null;
  }

  private resolveClaudeTitle(records: Array<Record<string, unknown>>): string {
    // Claude 会在会话过程中多次刷新 ai-title，取最后一个有效值才是当前标题。
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];

      if (record?.type !== "ai-title") {
        continue;
      }

      const title = ensureText(record.aiTitle).trim();

      if (title.length > 0) {
        return title;
      }
    }

    return "";
  }

  private listWorkspaceFiles(workspacePath: string): string[] {
    const exactProjectDir = join(this.options.homeDir, "projects", workspaceSlug(workspacePath));

    if (existsSync(exactProjectDir)) {
      return walkJsonlFiles(exactProjectDir);
    }

    return walkJsonlFiles(join(this.options.homeDir, "projects"));
  }

  private resolveForkSourceFilePath(rawStoreRef: string, providerSessionId: string): string {
    if (existsSync(rawStoreRef)) {
      return rawStoreRef;
    }

    for (const filePath of walkJsonlFiles(join(this.options.homeDir, "projects"))) {
      if (basename(filePath, ".jsonl") === providerSessionId) {
        return filePath;
      }
    }

    throw new Error("PROVIDER_SESSION_NOT_FOUND");
  }

  private locateForkTarget(
    records: Array<Record<string, unknown>>,
    providerSessionId: string,
    sourceMessageId: string
  ): ClaudeForkTargetLocation | null {
    const toolNameById = new Map<string, string>();
    const stableMessageRefByIdentity = new Map<string, ClaudeStableMessageRef>();
    const progressiveMessagesByTrackKey = new Map<string, NormalizedMessage>();
    let sequence = 0;
    let matched: ClaudeForkTargetLocation | null = null;

    records.forEach((record, recordIndex) => {
      this.collectMessageEnvelopes(record).forEach((envelope) => {
        const parts = normalizeClaudeMessageParts(envelope.message.content);

        parts.forEach((part, partIndex) => {
          const normalized = normalizeClaudeMessagePart({
            part,
            envelope,
            providerSessionId,
            partIndex,
            timestamp: safeDate(envelope.timestamp, nextTimestamp()),
            toolNameById,
            resolveStableMessageRef: (identity) => {
              const existing = stableMessageRefByIdentity.get(identity);

              if (existing) {
                return existing;
              }

              sequence += 1;
              const created: ClaudeStableMessageRef = {
                sequence,
                rawRef: buildClaudeStableRawRef(identity)
              };
              stableMessageRefByIdentity.set(identity, created);
              return created;
            }
          });

          if (!normalized) {
            return;
          }

          if (normalized.role === "user") {
            progressiveMessagesByTrackKey.clear();
          }

          const trackKey = buildClaudeProgressiveTrackKey(normalized, partIndex);
          const previousProgressive = trackKey
            ? progressiveMessagesByTrackKey.get(trackKey) ?? null
            : null;
          const nextMessage =
            previousProgressive && shouldReuseClaudeProgressiveIdentity(previousProgressive, normalized)
              ? {
                  ...normalized,
                  messageId: previousProgressive.messageId,
                  rawRef: previousProgressive.rawRef,
                  sequence: previousProgressive.sequence
                }
              : normalized;

          if (trackKey) {
            progressiveMessagesByTrackKey.set(trackKey, nextMessage);
          }

          if (nextMessage.messageId === sourceMessageId) {
            matched = {
              recordIndex,
              partIndex,
              recordSource: envelope.source,
              providerSourceMessageId: envelope.messageId
            };
          }
        });
      });
    });

    return matched;
  }

  private getParsedMessages(filePath: string, providerSessionId: string): NormalizedMessage[] {
    const stats = statSync(filePath);
    const cached = this.historyCache.get(filePath);

    if (
      cached
      && cached.providerSessionId === providerSessionId
      && cached.mtimeMs === stats.mtimeMs
      && cached.size === stats.size
    ) {
      this.touchHistoryCache(filePath, cached);
      return cached.messages;
    }

    const records = readJsonLines(filePath).map((record) => record.data);
    const messages = this.parseMessages(filePath, records, providerSessionId);
    this.touchHistoryCache(filePath, {
      filePath,
      providerSessionId,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      messages
    });
    return messages;
  }

  private touchHistoryCache(filePath: string, entry: ClaudeHistoryCacheEntry): void {
    this.historyCache.delete(filePath);
    this.historyCache.set(filePath, entry);

    while (this.historyCache.size > HISTORY_CACHE_LIMIT) {
      const oldestKey = this.historyCache.keys().next().value;

      if (!oldestKey) {
        break;
      }

      this.historyCache.delete(oldestKey);
    }
  }

  private parseMessages(
    filePath: string,
    records: Array<Record<string, unknown>>,
    providerSessionId = basename(filePath, ".jsonl")
  ): NormalizedMessage[] {
    const messageIdsInOrder: string[] = [];
    const messagesById = new Map<string, NormalizedMessage>();
    const toolNameById = new Map<string, string>();
    const stableMessageRefByIdentity = new Map<string, ClaudeStableMessageRef>();
    const progressiveMessagesByTrackKey = new Map<string, NormalizedMessage>();
    let sequence = 0;

    records.forEach((record) => {
      this.collectMessageEnvelopes(record).forEach((envelope) => {
        const parts = normalizeClaudeMessageParts(envelope.message.content);

        parts.forEach((part, partIndex) => {
          const normalized = normalizeClaudeMessagePart({
            part,
            envelope,
            providerSessionId,
            partIndex,
            timestamp: safeDate(envelope.timestamp, nextTimestamp()),
            toolNameById,
            resolveStableMessageRef: (identity) => {
              const existing = stableMessageRefByIdentity.get(identity);

              if (existing) {
                return existing;
              }

              sequence += 1;
              const created: ClaudeStableMessageRef = {
                sequence,
                rawRef: buildClaudeStableRawRef(identity)
              };
              stableMessageRefByIdentity.set(identity, created);
              return created;
            }
          });

          if (!normalized) {
            return;
          }

          if (normalized.role === "user") {
            progressiveMessagesByTrackKey.clear();
          }

          const trackKey = buildClaudeProgressiveTrackKey(normalized, partIndex);
          const previousProgressive = trackKey
            ? progressiveMessagesByTrackKey.get(trackKey) ?? null
            : null;
          const nextMessage =
            previousProgressive && shouldReuseClaudeProgressiveIdentity(previousProgressive, normalized)
              ? {
                  ...normalized,
                  messageId: previousProgressive.messageId,
                  rawRef: previousProgressive.rawRef,
                  sequence: previousProgressive.sequence
                }
              : normalized;

          if (trackKey) {
            progressiveMessagesByTrackKey.set(trackKey, nextMessage);
          }

          const signature = buildClaudeMessageSignature(nextMessage);
          const current = messagesById.get(nextMessage.messageId) ?? null;

          if (current && buildClaudeMessageSignature(current) === signature) {
            return;
          }

          if (!messagesById.has(nextMessage.messageId)) {
            messageIdsInOrder.push(nextMessage.messageId);
          }

          messagesById.set(nextMessage.messageId, nextMessage);
        });
      });
    });

    return messageIdsInOrder
      .map((messageId) => messagesById.get(messageId) ?? null)
      .filter((message): message is NormalizedMessage => message !== null);
  }

  private collectMessageEnvelopes(record: Record<string, unknown>): ClaudeMessageEnvelope[] {
    const envelopes: ClaudeMessageEnvelope[] = [];
    const directType = ensureText(record.type);
    const directMessage = toClaudeRecord(record.message);

    if (directType === "user" || directType === "assistant") {
      envelopes.push({
        type: directType,
        source: "direct",
        messageId: readClaudeMessageId(directMessage, record),
        timestamp: record.timestamp,
        message: directMessage as ClaudeMessageEnvelope["message"]
      });
    }

    const progressMessage = this.readProgressEnvelope(record);

    if (progressMessage) {
      envelopes.push(progressMessage);
    }

    return envelopes;
  }

  private readProgressEnvelope(record: Record<string, unknown>): ClaudeMessageEnvelope | null {
    if (ensureText(record.type) !== "progress") {
      return null;
    }

    const nested = toClaudeRecord(toClaudeRecord(record.data).message);
    const nestedType = ensureText(nested.type);
    const nestedMessage = toClaudeRecord(nested.message);

    if (nestedType !== "user" && nestedType !== "assistant") {
      return null;
    }

    return {
      type: nestedType,
      source: "progress",
      messageId: readClaudeMessageId(nestedMessage, nested),
      timestamp: nested.timestamp ?? record.timestamp,
      message: nestedMessage as ClaudeMessageEnvelope["message"]
    };
  }
}

function isPendingClaudeRuntimeRef(providerSessionId: string, rawStoreRef: string): boolean {
  if (providerSessionId.trim().toLowerCase().startsWith("pending://")) {
    return true;
  }

  const normalizedRawStoreRef = rawStoreRef.replaceAll("\\", "/").toLowerCase();
  return normalizedRawStoreRef.includes("/.pending-");
}

function cloneJsonRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceClaudeRecordSessionId(
  record: Record<string, unknown>,
  sessionId: string
): Record<string, unknown> {
  const nextRecord = cloneJsonRecord(record);

  replaceClaudeSessionIdRecursive(nextRecord, sessionId);
  return nextRecord;
}

function replaceClaudeSessionIdRecursive(value: unknown, sessionId: string): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => replaceClaudeSessionIdRecursive(item, sessionId));
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.sessionId === "string" && record.sessionId.trim().length > 0) {
    record.sessionId = sessionId;
  }

  Object.values(record).forEach((nested) => replaceClaudeSessionIdRecursive(nested, sessionId));
}

function truncateClaudeForkRecord(
  record: Record<string, unknown>,
  target: ClaudeForkTargetLocation
): Record<string, unknown> {
  const nextRecord = cloneJsonRecord(record);

  if (target.recordSource === "progress") {
    const progressData = toClaudeRecord(nextRecord.data);
    const nestedEnvelope = toClaudeRecord(progressData.message);

    nestedEnvelope.message = truncateClaudeMessageContent(
      toClaudeRecord(nestedEnvelope.message),
      target.partIndex
    );
    progressData.message = nestedEnvelope;
    nextRecord.data = progressData;
    return nextRecord;
  }

  nextRecord.message = truncateClaudeMessageContent(
    toClaudeRecord(nextRecord.message),
    target.partIndex
  );
  return nextRecord;
}

function truncateClaudeMessageContent(
  message: Record<string, unknown>,
  partIndex: number
): Record<string, unknown> {
  const content = message.content;

  if (Array.isArray(content)) {
    message.content = content.slice(0, partIndex + 1);
  }

  return message;
}

function shouldPreserveClaudeForkRecord(record: Record<string, unknown>): boolean {
  return record.type !== "ai-title";
}

function buildClaudeSubagentMetadataIndex(
  files: string[]
): Map<string, ClaudeSubagentMetadata> {
  const metadataByFilePath = new Map<string, ClaudeSubagentMetadata>();
  const filePathSet = new Set(files);

  for (const filePath of files) {
    const metadata = parseClaudeSubagentPathMetadata(filePath);

    if (!metadata) {
      continue;
    }

    metadataByFilePath.set(filePath, metadata);
  }

  for (const filePath of files) {
    const records = readJsonLines(filePath).map((record) => record.data);
    const taskSpawnMetadata = parseClaudeTaskSpawnMetadata(filePath, records, filePathSet);

    for (const [childFilePath, metadata] of taskSpawnMetadata) {
      const existing = metadataByFilePath.get(childFilePath);

      if (!existing) {
        metadataByFilePath.set(childFilePath, metadata);
        continue;
      }

      metadataByFilePath.set(childFilePath, {
        ...existing,
        subagentLabel: existing.subagentLabel ?? metadata.subagentLabel
      });
    }
  }

  return metadataByFilePath;
}

function parseClaudeSubagentPathMetadata(filePath: string): ClaudeSubagentMetadata | null {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const matched = normalizedPath.match(/\/([^/]+)\/subagents\/([^/]+)\.jsonl$/i);

  if (!matched?.[1] || !matched[2]) {
    return null;
  }

  const parentProviderSessionId = matched[1];
  const agentFileName = matched[2];

  return {
    providerSessionId: `${parentProviderSessionId}::${agentFileName}`,
    parentProviderSessionId,
    subagentLabel: readClaudeSubagentMetaLabel(filePath)
  };
}

function parseClaudeTaskSpawnMetadata(
  filePath: string,
  records: Array<Record<string, unknown>>,
  filePathSet: ReadonlySet<string>
): Map<string, ClaudeSubagentMetadata> {
  const taskSpawnMetadata = new Map<string, ClaudeSubagentMetadata>();
  const taskRequestByToolId = new Map<
    string,
    {
      parentProviderSessionId: string;
      subagentLabel: string | null;
    }
  >();
  const parentDir = dirname(filePath);

  for (const record of records) {
    const sessionId = ensureText(record.sessionId).trim();

    if (!sessionId) {
      continue;
    }

    for (const message of collectClaudeRecordMessages(record)) {
      if (message.role === "assistant") {
        for (const taskRequest of extractClaudeTaskRequests(message.message)) {
          taskRequestByToolId.set(taskRequest.toolUseId, {
            parentProviderSessionId: sessionId,
            subagentLabel: formatClaudeSubagentLabel(
              taskRequest.subagentType,
              taskRequest.description
            )
          });
        }

        continue;
      }

      if (message.role !== "user") {
        continue;
      }

      for (const toolUseId of extractClaudeToolResultIds(message.message)) {
        const taskRequest = taskRequestByToolId.get(toolUseId);
        const agentFileName = normalizeClaudeAgentFileName(readClaudeTaskResultAgentId(record));

        if (!taskRequest || !agentFileName) {
          continue;
        }

        const childFilePath = join(parentDir, `${agentFileName}.jsonl`);

        if (!filePathSet.has(childFilePath)) {
          continue;
        }

        taskSpawnMetadata.set(childFilePath, {
          providerSessionId: `${taskRequest.parentProviderSessionId}::${agentFileName}`,
          parentProviderSessionId: taskRequest.parentProviderSessionId,
          subagentLabel: taskRequest.subagentLabel
        });
      }
    }
  }

  return taskSpawnMetadata;
}

function collectClaudeRecordMessages(
  record: Record<string, unknown>
): Array<{ role: string; message: Record<string, unknown> }> {
  const messages: Array<{ role: string; message: Record<string, unknown> }> = [];
  const directRole = ensureText(toClaudeRecord(record.message).role).trim();
  const directMessage = toClaudeRecord(record.message);

  if ((directRole === "assistant" || directRole === "user") && Object.keys(directMessage).length > 0) {
    messages.push({
      role: directRole,
      message: directMessage
    });
  }

  if (ensureText(record.type) !== "progress") {
    return messages;
  }

  const nested = toClaudeRecord(toClaudeRecord(record.data).message);
  const nestedRole = ensureText(toClaudeRecord(nested.message).role).trim();
  const nestedMessage = toClaudeRecord(nested.message);

  if ((nestedRole === "assistant" || nestedRole === "user") && Object.keys(nestedMessage).length > 0) {
    messages.push({
      role: nestedRole,
      message: nestedMessage
    });
  }

  return messages;
}

function extractClaudeTaskRequests(
  message: Record<string, unknown>
): Array<{ toolUseId: string; subagentType: string; description: string }> {
  const content = Array.isArray(message.content) ? message.content : [];
  const requests: Array<{ toolUseId: string; subagentType: string; description: string }> = [];

  for (const item of content) {
    const part = toClaudeRecord(item);
    const partType = ensureText(part.type).trim();
    const toolUseId = ensureText(part.id).trim();
    const toolName = ensureText(part.name).trim();

    if (partType !== "tool_use" || toolName !== "Task" || !toolUseId) {
      continue;
    }

    const input = toClaudeRecord(part.input);
    requests.push({
      toolUseId,
      subagentType: ensureText(input.subagent_type).trim(),
      description: ensureText(input.description).trim()
    });
  }

  return requests;
}

function extractClaudeToolResultIds(message: Record<string, unknown>): string[] {
  const content = Array.isArray(message.content) ? message.content : [];
  const toolResultIds: string[] = [];

  for (const item of content) {
    const part = toClaudeRecord(item);

    if (ensureText(part.type).trim() !== "tool_result") {
      continue;
    }

    const toolUseId = ensureText(part.tool_use_id).trim();

    if (toolUseId) {
      toolResultIds.push(toolUseId);
    }
  }

  return toolResultIds;
}

function readClaudeTaskResultAgentId(record: Record<string, unknown>): string {
  const toolUseResult = toClaudeRecord(record.toolUseResult);
  return ensureText(toolUseResult.agentId).trim();
}

function normalizeClaudeAgentFileName(agentId: string): string | null {
  const normalizedAgentId = agentId.trim();

  if (!normalizedAgentId) {
    return null;
  }

  if (/^agent-[^/]+$/i.test(normalizedAgentId)) {
    return normalizedAgentId;
  }

  return /^[-a-z0-9_]+$/i.test(normalizedAgentId) ? `agent-${normalizedAgentId}` : null;
}

function readClaudeSubagentMetaLabel(filePath: string): string | null {
  const metaFilePath = filePath.replace(/\.jsonl$/i, ".meta.json");

  if (!existsSync(metaFilePath)) {
    return null;
  }

  try {
    const meta = JSON.parse(readFirstNonEmptyLine(metaFilePath, 64 * 1024) ?? "{}") as Record<string, unknown>;
    return formatClaudeSubagentLabel(
      ensureText(meta.agentType).trim(),
      ensureText(meta.description).trim()
    );
  } catch {
    return null;
  }
}

function formatClaudeSubagentLabel(subagentType: string, description: string): string | null {
  const normalizedType = subagentType.trim().toLowerCase();
  const normalizedDescription = description.trim();

  if (!normalizedType && !normalizedDescription) {
    return null;
  }

  if (!normalizedType) {
    return normalizedDescription;
  }

  if (!normalizedDescription) {
    return normalizedType;
  }

  return `${normalizedType} · ${normalizedDescription}`;
}

function shouldHideClaudeDebugSession(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");

  if (normalizedPath.includes("/subagents/")) {
    return false;
  }

  const firstLine = readFirstNonEmptyLine(filePath);

  if (!firstLine) {
    return false;
  }

  try {
    const record = JSON.parse(firstLine) as {
      type?: unknown;
      isSidechain?: unknown;
      agentId?: unknown;
      message?: {
        role?: unknown;
        content?: unknown;
      };
    };
    const firstUserContent = extractClaudeDebugMessageText(record.message?.content);

    return (
      record.type === "user" &&
      Boolean(record.isSidechain) &&
      ensureText(record.agentId).trim().length > 0 &&
      /^agent-[^/]+\.jsonl$/i.test(basename(filePath)) &&
      firstUserContent === "Warmup"
    );
  } catch {
    return false;
  }
}

function isPendingClaudeRuntimeFile(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/").toLowerCase();
  return /\/\.pending-[^/]+\.jsonl$/i.test(normalizedPath);
}

function extractClaudeDebugMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (!item || typeof item !== "object") {
        return "";
      }

      return ensureText((item as Record<string, unknown>).text);
    })
    .join("\n")
    .trim();
}

function extractClaudeUsageSnapshot(record: Record<string, unknown>): {
  usage: Record<string, unknown>;
  timestamp: unknown;
  model: unknown;
  recordModel: unknown;
} | null {
  const directType = ensureText(record.type).trim();

  if (directType === "assistant") {
    const message = ((record.message ?? {}) as Record<string, unknown>);
    const usage = ((message.usage ?? {}) as Record<string, unknown>);

    if (Object.keys(usage).length > 0) {
      return {
        usage,
        timestamp: record.timestamp,
        model: message.model,
        recordModel: record.model
      };
    }
  }

  if (directType !== "progress") {
    return null;
  }

  const data = ((record.data ?? {}) as Record<string, unknown>);
  const nested = ((data.message ?? {}) as Record<string, unknown>);

  if (ensureText(nested.type).trim() !== "assistant") {
    return null;
  }

  const message = ((nested.message ?? {}) as Record<string, unknown>);
  const usage = ((message.usage ?? {}) as Record<string, unknown>);

  if (Object.keys(usage).length === 0) {
    return null;
  }

  return {
    usage,
    timestamp: nested.timestamp ?? record.timestamp,
    model: message.model,
    recordModel: nested.model ?? record.model
  };
}

function readNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function resolveClaudeContextWindow(modelId: string | null): number {
  const normalizedModelId = modelId?.trim().toLowerCase() ?? "";

  if (
    normalizedModelId.includes("claude") ||
    normalizedModelId === "sonnet" ||
    normalizedModelId === "opus" ||
    normalizedModelId === "haiku" ||
    normalizedModelId.length === 0
  ) {
    return DEFAULT_CLAUDE_CONTEXT_WINDOW;
  }

  return DEFAULT_CLAUDE_CONTEXT_WINDOW;
}

function clampClaudeUsageRatio(promptTokens: number, contextWindow: number): number {
  if (contextWindow <= 0) {
    return 0;
  }

  return Math.min(Math.max(promptTokens / contextWindow, 0), 1);
}
