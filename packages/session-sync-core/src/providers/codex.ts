import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import crypto from "node:crypto";

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
  ProviderDiscoveryDiagnostic,
  ProviderId,
  ProviderRealtimeEvent,
  ProviderSessionDiscovery,
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
  extractTextBlocks,
  ensureText,
  messageIdFromRawRef,
  messageIdFromStableKey,
  nextTimestamp,
  normalizeWorkspacePath,
  readFirstNonEmptyLine,
  readJsonLines,
  readTrailingJsonLines,
  type RawJsonLine,
  safeDate,
  sliceHistory,
  stringifyStructuredValue,
  walkJsonlFiles
} from "./utils.js";
import { buildCodexResumeHistoryFromRawStore } from "../codex-resume-history.js";
import { loadDatabaseSync, type DatabaseSyncType } from "../sqlite/node-sqlite.js";

interface CodexAdapterOptions {
  homeDir: string;
  forkTransportFactory?: () => CodexForkTransport;
  threadControlTransportFactory?: () => CodexThreadControlTransport;
}

export interface CodexForkTransport {
  initialize(): Promise<void>;
  forkThread(
    providerSessionId: string
  ): Promise<{ providerSessionId: string; rawStoreRef: string | null }>;
  readThread(providerSessionId: string): Promise<Record<string, unknown>>;
  rollbackThread(
    providerSessionId: string,
    numTurns: number
  ): Promise<{ providerSessionId: string; rawStoreRef: string | null }>;
  resumeThreadFromHistory(input: {
    providerSessionId?: string | null;
    workspacePath: string;
    history: unknown[];
    model?: string | null;
  }): Promise<{ providerSessionId: string; rawStoreRef: string | null }>;
  close(): void;
}

export interface CodexThreadControlTransport {
  initialize(): Promise<void>;
  archiveThread(providerSessionId: string): Promise<void>;
  unarchiveThread(providerSessionId: string): Promise<void>;
  readThread(providerSessionId: string): Promise<Record<string, unknown>>;
  close(): void;
}

type CodexMessageSource = "event_msg" | "response_item";
const CODEX_SESSION_TITLE_MAX_LENGTH = 48;

interface CodexHistoryCacheEntry {
  filePath: string;
  providerSessionId: string;
  mtimeMs: number;
  size: number;
  messages: NormalizedMessage[];
}

interface CodexSessionSummaryCacheEntry {
  filePath: string;
  mtimeMs: number;
  size: number;
  workspacePath: string | null;
  providerSessionId: string | null;
  title: string | null;
  summary: ProviderSessionSummary | null;
}

interface CodexThreadMetadataIndexCacheEntry {
  indexPathMtimeMs: number | null;
  stateDbPath: string | null;
  stateDbMtimeMs: number | null;
  index: Map<string, CodexThreadMetadata>;
}

interface CodexThreadMetadata {
  title: string | null;
  cwd: string | null;
  createdAtMs: number | null;
  firstUserMessage: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  isArchived: boolean | null;
  rolloutPath: string | null;
}

interface CodexSpawnRelation {
  parentProviderSessionId: string;
}

interface CodexSpawnRelationScanCacheEntry {
  filePath: string;
  mtimeMs: number;
  size: number;
  workspacePath: string | null;
  directRelations: Array<readonly [string, CodexSpawnRelation]>;
  spawnRecords: CodexSpawnRecord[];
}

interface CodexSpawnRecord {
  parentProviderSessionId: string;
  workspacePath: string | null;
  message: string;
  timestampMs: number | null;
}

interface CodexSessionIdentity {
  threadId: string;
  cwd: string;
  parentThreadId: string | null;
}

const HISTORY_CACHE_LIMIT = 6;
const SESSION_SUMMARY_CACHE_LIMIT = 512;
const SPAWN_RELATION_SCAN_CACHE_LIMIT = 512;
const RECENT_HISTORY_INITIAL_BYTES = 256 * 1024;
const RECENT_HISTORY_MAX_BYTES = 4 * 1024 * 1024;
const RECENT_HISTORY_BUFFER_MESSAGES = 24;
const CODEX_CONFIG_CONTEXT_WINDOW_PATTERN =
  /(?:^|\n)\s*model_context_window\s*=\s*(\d+)\s*(?:\n|$)/i;
const KNOWN_CODEX_CONTEXT_WINDOWS = new Map<string, number>([
  ["gpt-5.3-codex", 400_000],
  ["codex-mini-latest", 200_000]
]);

export class CodexAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "codex";
  private readonly historyCache = new Map<string, CodexHistoryCacheEntry>();
  private readonly sessionSummaryCache = new Map<string, CodexSessionSummaryCacheEntry>();
  private readonly spawnRelationScanCache = new Map<string, CodexSpawnRelationScanCacheEntry>();
  private threadMetadataIndexCache: CodexThreadMetadataIndexCacheEntry | null = null;

  constructor(private readonly options: CodexAdapterOptions) {}

  async detectSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]> {
    const discovery = await this.detectSessionsDetailed(workspacePath, options);
    return discovery.sessions;
  }

  async detectSessionsDetailed(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionDiscovery> {
    const startedAt = Date.now();
    const targetPath = normalizeWorkspacePath(workspacePath);
    const knownSessions = (options?.knownSessions ?? []).filter(
      (session) => session.provider === this.providerId
    );
    const threadMetadataIndex = this.readThreadMetadataIndex();
    const files = this.listSessionFiles(targetPath, threadMetadataIndex, knownSessions);
    const knownByRawStoreRef = new Map(
      knownSessions.map((session) => [session.rawStoreRef, session] as const)
    );
    const knownByProviderSessionId = new Map(
      knownSessions.map((session) => [session.providerSessionId, session] as const)
    );
    const sessionsByProviderSessionId = new Map<string, ProviderSessionSummary>();
    const retainedSummaries: Array<{
      filePath: string;
      stats: { mtimeMs: number; size: number };
      sessionIdentity: CodexSessionIdentity | null;
      summary: ProviderSessionSummary;
    }> = [];
    const pendingFiles: Array<{
      filePath: string;
      fileSessionId: string;
      stats: { mtimeMs: number; size: number };
      sessionIdentity: CodexSessionIdentity | null;
    }> = [];
    let scannedFiles = 0;
    let skippedByMtimeSize = 0;
    let parsedFiles = 0;
    let bytesRead = 0;

    for (const filePath of files) {
      scannedFiles += 1;
      const stats = statSync(filePath);
      const cachedSummary = this.sessionSummaryCache.get(filePath);
      const fileSessionId = basename(filePath, ".jsonl");
      const sessionIdentity = this.readSessionIdentity(filePath, fileSessionId);

      if (
        cachedSummary
        && cachedSummary.mtimeMs === stats.mtimeMs
        && cachedSummary.size === stats.size
        && (
          !cachedSummary.summary
          || !sessionIdentity
          || cachedSummary.summary.providerSessionId === sessionIdentity.threadId
        )
      ) {
        this.touchSessionSummaryCache(filePath, cachedSummary);

        if (
          cachedSummary.summary
          && hasUsableCodexTitle(cachedSummary.summary.title)
          && normalizeWorkspacePath(cachedSummary.summary.workspacePath) === targetPath
        ) {
          skippedByMtimeSize += 1;
          retainedSummaries.push({
            filePath,
            stats,
            sessionIdentity,
            summary: cachedSummary.summary
          });
          continue;
        }

        if (
          cachedSummary.workspacePath
          && normalizeWorkspacePath(cachedSummary.workspacePath) !== targetPath
        ) {
          continue;
        }
      }

      const knownByPath = knownByRawStoreRef.get(filePath);

      if (
        knownByPath
        && knownByPath.sourceMtimeMs === stats.mtimeMs
        && knownByPath.sourceSizeBytes === stats.size
        && hasUsableCodexTitle(knownByPath.title)
        && (
          !sessionIdentity
          || knownByPath.providerSessionId === sessionIdentity.threadId
        )
      ) {
        skippedByMtimeSize += 1;
        if (normalizeWorkspacePath(knownByPath.workspacePath) === targetPath) {
          retainedSummaries.push({
            filePath,
            stats,
            sessionIdentity,
            summary: knownByPath
          });
          continue;
        }

        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: knownByPath.workspacePath,
          providerSessionId: knownByPath.providerSessionId,
          title: null,
          summary: null
        });
        continue;
      }

      if (
        sessionIdentity?.cwd
        && normalizeWorkspacePath(sessionIdentity.cwd) !== targetPath
      ) {
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: sessionIdentity.cwd,
          providerSessionId: sessionIdentity.threadId,
          title: null,
          summary: null
        });
        continue;
      }

      pendingFiles.push({
        filePath,
        fileSessionId,
        stats: {
          mtimeMs: stats.mtimeMs,
          size: stats.size
        },
        sessionIdentity
      });
    }

    if (pendingFiles.length === 0 && retainedSummaries.length === 0) {
      const sessions = [...sessionsByProviderSessionId.values()].sort((left, right) =>
        (left.lastMessageAt ?? "").localeCompare(right.lastMessageAt ?? "")
      );
      const diagnostic: ProviderDiscoveryDiagnostic = {
        provider: this.providerId,
        status: "success",
        durationMs: Date.now() - startedAt,
        sessionCount: sessions.length,
        isComplete: true,
        errorMessage: null,
        scannedFiles,
        skippedByMtimeSize,
        parsedFiles,
        bytesRead
      };

      return {
        sessions,
        isComplete: true,
        providerDiagnostics: [diagnostic]
      };
    }

    const pendingThreadIds = new Set(
      [...pendingFiles, ...retainedSummaries]
        .map((entry) => entry.sessionIdentity?.threadId ?? null)
        .filter((value): value is string => value !== null)
    );
    const spawnedAgentRelationIndex = this.readSpawnedAgentRelationIndex(
      [...pendingFiles, ...retainedSummaries].map((entry) => ({
        filePath: entry.filePath,
        stats: entry.stats,
        sessionIdentity: entry.sessionIdentity
      })),
      targetPath,
      threadMetadataIndex,
      pendingThreadIds
    );

    for (const entry of retainedSummaries) {
      const currentThreadId = entry.sessionIdentity?.threadId ?? entry.summary.providerSessionId;
      const currentThreadMetadata = threadMetadataIndex.get(currentThreadId) ?? null;
      const currentSpawnRelation = spawnedAgentRelationIndex.get(currentThreadId) ?? null;
      const summary = this.hydrateSessionSummary(
        {
          ...entry.summary,
          workspacePath: entry.sessionIdentity?.cwd || entry.summary.workspacePath
        },
        entry.filePath,
        entry.stats,
        currentThreadMetadata,
        currentSpawnRelation
      );

      this.touchSessionSummaryCache(entry.filePath, {
        filePath: entry.filePath,
        mtimeMs: entry.stats.mtimeMs,
        size: entry.stats.size,
        workspacePath: summary.workspacePath,
        providerSessionId: summary.providerSessionId,
        title: summary.title,
        summary
      });
      sessionsByProviderSessionId.set(summary.providerSessionId, summary);
    }

    for (const entry of pendingFiles) {
      const { filePath, fileSessionId, stats, sessionIdentity } = entry;
      parsedFiles += 1;
      bytesRead += stats.size;
      const records = readJsonLines(filePath);
      const meta = records.find((record) => record.data.type === "session_meta")?.data;
      const metaPayload = (meta?.payload ?? {}) as Record<string, unknown>;
      const codexSessionId = this.resolveCodexSessionId(metaPayload, fileSessionId);

      if (shouldIgnoreCodingNsDraftSession(metaPayload)) {
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: null,
          providerSessionId: codexSessionId,
          title: null,
          summary: null
        });
        continue;
      }

      const cwd = ensureText(metaPayload.cwd);
      const cachedWorkspacePath = cwd || null;
      const sessionWorkspacePath = cwd || workspacePath;

      if (normalizeWorkspacePath(cwd) !== targetPath) {
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: cachedWorkspacePath,
          providerSessionId: codexSessionId,
          title: null,
          summary: null
        });
        continue;
      }
      const currentThreadMetadata =
        threadMetadataIndex.get(codexSessionId) ??
        (sessionIdentity ? threadMetadataIndex.get(sessionIdentity.threadId) : null);
      const currentSpawnRelation =
        spawnedAgentRelationIndex.get(codexSessionId) ??
        (sessionIdentity ? spawnedAgentRelationIndex.get(sessionIdentity.threadId) : null);
      const knownBySessionId = knownByProviderSessionId.get(codexSessionId);

      if (
        knownBySessionId
        && knownBySessionId.sourceMtimeMs === stats.mtimeMs
        && knownBySessionId.sourceSizeBytes === stats.size
        && hasUsableCodexTitle(knownBySessionId.title)
      ) {
        const summary = this.hydrateSessionSummary(
          {
            ...knownBySessionId,
            workspacePath: sessionWorkspacePath
          },
          filePath,
          stats,
          currentThreadMetadata,
          currentSpawnRelation
        );
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: sessionWorkspacePath,
          providerSessionId: summary.providerSessionId,
          title: summary.title,
          summary
        });
        sessionsByProviderSessionId.set(codexSessionId, summary);
        continue;
      }

      const messages = this.parseMessagesFromEntries(filePath, records, codexSessionId);
      const title =
        this.resolveIndexedTitle(threadMetadataIndex, codexSessionId) ??
        resolveCodexFallbackTitle(messages) ??
        fileSessionId;
      const lastMessageAt =
        messages.at(-1)?.timestamp ?? (ensureText(metaPayload.timestamp) || null);

      const summary = this.hydrateSessionSummary({
        provider: this.providerId,
        providerSessionId: codexSessionId,
        title,
        workspacePath: sessionWorkspacePath,
        rawStoreRef: filePath,
        lastMessageAt,
        messageCount: messages.length,
        isArchived: false
      }, filePath, stats, currentThreadMetadata, currentSpawnRelation);
      sessionsByProviderSessionId.set(codexSessionId, summary);
      this.touchSessionSummaryCache(filePath, {
        filePath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        workspacePath: sessionWorkspacePath,
        providerSessionId: summary.providerSessionId,
        title: summary.title,
        summary
      });
    }

    const sessions = [...sessionsByProviderSessionId.values()].sort((left, right) =>
      (left.lastMessageAt ?? "").localeCompare(right.lastMessageAt ?? "")
    );
    const diagnostic: ProviderDiscoveryDiagnostic = {
      provider: this.providerId,
      status: "success",
      durationMs: Date.now() - startedAt,
      sessionCount: sessions.length,
      isComplete: true,
      errorMessage: null,
      scannedFiles,
      skippedByMtimeSize,
      parsedFiles,
      bytesRead
    };

    return {
      sessions,
      isComplete: true,
      providerDiagnostics: [diagnostic]
    };
  }

  async readSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);

    if (!existsSync(resolvedStoreRef)) {
      return {
        messages: [],
        cursor,
        nextCursor: null,
        total: 0
      };
    }

    const messages = this.getParsedMessages(resolvedStoreRef, providerSessionId);
    return sliceHistory(messages, cursor, limit, direction);
  }

  async readRecentSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    totalMessageCount: number,
    limit: number
  ): Promise<HistoryPage | null> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);

    if (!existsSync(resolvedStoreRef)) {
      return null;
    }

    const stats = statSync(resolvedStoreRef);
    const cached = this.historyCache.get(resolvedStoreRef);

    if (
      cached
      && cached.providerSessionId === providerSessionId
      && cached.mtimeMs === stats.mtimeMs
      && cached.size === stats.size
    ) {
      this.touchHistoryCache(resolvedStoreRef, cached);
      return sliceHistory(cached.messages, null, limit, "backward");
    }

    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    let maxBytes = Math.min(RECENT_HISTORY_INITIAL_BYTES, stats.size);

    while (maxBytes > 0) {
      const lines = readTrailingJsonLines(resolvedStoreRef, maxBytes);

      if (lines.length > 0) {
        const messages = this.parseMessagesFromEntries(resolvedStoreRef, lines, providerSessionId);

        if (
          messages.length > 0
          && (
          messages.length >= Math.min(totalMessageCount, safeLimit + RECENT_HISTORY_BUFFER_MESSAGES)
          || maxBytes >= stats.size
          )
        ) {
          return buildRecentHistoryPage(messages, totalMessageCount, safeLimit);
        }
      }

      if (maxBytes >= stats.size || maxBytes >= RECENT_HISTORY_MAX_BYTES) {
        break;
      }

      maxBytes = Math.min(stats.size, maxBytes * 2, RECENT_HISTORY_MAX_BYTES);
    }

    return null;
  }

  subscribeSession(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription {
    let currentCursor = cursor;
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    let lastMtime = existsSync(resolvedStoreRef) ? statSync(resolvedStoreRef).mtimeMs : 0;

    const timer = setInterval(async () => {
      if (!existsSync(resolvedStoreRef)) {
        return;
      }

      const nextStat = statSync(resolvedStoreRef);

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
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    statSync(resolvedStoreRef);

    return {
      provider: this.providerId,
      providerSessionId,
      resumedAt: nextTimestamp(),
      rawStoreRef: resolvedStoreRef
    };
  }

  async startSession(
    workspacePath: string,
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    const now = new Date();
    const sessionId = `rollout-${now.toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}`;
    const folder = join(
      this.options.homeDir,
      "sessions",
      `${now.getUTCFullYear()}`,
      `${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
      `${String(now.getUTCDate()).padStart(2, "0")}`
    );

    ensureDirectory(folder);

    const filePath = join(folder, `${sessionId}.jsonl`);
    const nowIso = nextTimestamp();

    appendJsonLine(filePath, {
      timestamp: nowIso,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: nowIso,
        cwd: workspacePath,
        originator: "CodingNS Host",
        source: "codingns"
      }
    });

    if (options.initialPrompt) {
      appendJsonLine(filePath, {
        timestamp: nextTimestamp(),
        type: "event_msg",
        payload: {
          type: "user_message",
          message: options.initialPrompt
        }
      });
    }

    return {
      session: {
        provider: this.providerId,
        providerSessionId: sessionId,
        title: options.initialPrompt?.slice(0, CODEX_SESSION_TITLE_MAX_LENGTH) || "New Codex session",
        workspacePath,
        rawStoreRef: filePath,
        isArchived: false,
        lastMessageAt: nextTimestamp(),
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
    const transportFactory = this.options.forkTransportFactory;

    if (!transportFactory) {
      throw new Error("CODEX_FORK_TRANSPORT_NOT_CONFIGURED");
    }

    const transport = transportFactory();

    try {
      await transport.initialize();

      if (options.sourceType === "session") {
        const forked = await this.forkThreadWithHistoryFallback(
          transport,
          providerSessionId,
          workspacePath,
          options.rawStoreRef
        );
        return await this.buildForkResultFromTransport({
          providerSessionId: forked.providerSessionId,
          rawStoreRef: forked.rawStoreRef,
          workspacePath,
          fallbackParentProviderSessionId: providerSessionId,
          forkMethod: "native_session_fork",
          forkSourceType: "session",
          providerSourceMessageId: null
        });
      }

      const targetMessageId = options.sourceMessageId?.trim();

      if (!targetMessageId) {
        throw new Error("FORK_SOURCE_MESSAGE_ID_REQUIRED");
      }

      if (options.strategy === "reconstruct-only") {
        throw new Error("CODEX_RECONSTRUCTED_MESSAGE_FORK_NOT_SUPPORTED");
      }

      const resolvedStoreRef = this.resolveSessionFilePath(options.rawStoreRef, providerSessionId);
      const parsedMessages = this.getParsedMessages(resolvedStoreRef, providerSessionId);
      const targetMessage = parsedMessages.find((message) => message.messageId === targetMessageId);

      if (!targetMessage) {
        throw new Error("FORK_SOURCE_MESSAGE_NOT_FOUND");
      }
      const targetSnapshot = applyForkSourceMessageSnapshot(
        targetMessage,
        options.sourceMessageSnapshot
      );

      const threadReadResult = await transport.readThread(providerSessionId);
      const threadSnapshot = extractCodexThreadHistorySnapshot(threadReadResult);
      const truncatedHistory = truncateCodexThreadHistory(
        threadSnapshot.value,
        parsedMessages,
        targetSnapshot
      );

      if (truncatedHistory.length === 0) {
        throw new Error("CODEX_FORK_HISTORY_EMPTY");
      }

      if (threadSnapshot.kind !== "turns") {
        throw new Error("CODEX_RECONSTRUCTED_MESSAGE_FORK_NOT_SUPPORTED");
      }

      const rollbackPlan = buildCodexTurnRollbackPlan(threadSnapshot, parsedMessages, targetSnapshot);
      const forked = await transport.forkThread(providerSessionId);
      const finalized =
        rollbackPlan.numTurnsToRollback > 0
          ? await transport.rollbackThread(
              forked.providerSessionId,
              rollbackPlan.numTurnsToRollback
            )
          : forked;
      const childThreadReadResult = await transport.readThread(finalized.providerSessionId);

      if (!this.isForkedChildHistoryAligned(childThreadReadResult, truncatedHistory)) {
        throw new Error("CODEX_NATIVE_MESSAGE_FORK_DIRTY");
      }

      return await this.buildForkResultFromTransport({
        providerSessionId: finalized.providerSessionId,
        rawStoreRef: finalized.rawStoreRef,
        workspacePath,
        fallbackParentProviderSessionId: providerSessionId,
        forkMethod: "native_message_fork",
        forkSourceType: "message",
        providerSourceMessageId: null,
        messageCountOverride: targetSnapshot.sequence,
        inheritedPrefixMessageCountOverride: targetSnapshot.sequence,
        lastMessageAtOverride: targetSnapshot.timestamp
      });
    } finally {
      transport.close();
    }
  }

  async sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null,
    _permissionMode?: string | null
  ): Promise<SendMessageResult> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const lineNumber = readJsonLines(resolvedStoreRef).length + 1;
    const acceptedAt = nextTimestamp();

    appendJsonLine(resolvedStoreRef, {
      timestamp: acceptedAt,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: content,
        clientRequestId
      }
    });

    const rawRef = createRawRef(this.providerId, resolvedStoreRef, lineNumber);
    this.historyCache.delete(resolvedStoreRef);

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
          readJsonLines(resolvedStoreRef),
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
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const fileSessionId = basename(resolvedStoreRef, ".jsonl");
    const sessionIdentity = this.readSessionIdentity(resolvedStoreRef, fileSessionId);
    const threadMetadataIndex = this.readThreadMetadataIndex();
    const indexedTitle =
      this.resolveIndexedTitle(threadMetadataIndex, providerSessionId) ??
      (sessionIdentity
        ? this.resolveIndexedTitle(threadMetadataIndex, sessionIdentity.threadId)
        : null);

    if (indexedTitle) {
      return indexedTitle;
    }

    const stats = statSync(resolvedStoreRef);
    const cachedSummary = this.sessionSummaryCache.get(resolvedStoreRef);

    if (
      cachedSummary
      && cachedSummary.mtimeMs === stats.mtimeMs
      && cachedSummary.size === stats.size
      && (
        cachedSummary.providerSessionId === providerSessionId
        || (sessionIdentity
          && cachedSummary.providerSessionId === sessionIdentity.threadId)
      )
    ) {
      this.touchSessionSummaryCache(resolvedStoreRef, cachedSummary);

      if (cachedSummary.title) {
        return cachedSummary.title;
      }

      if (cachedSummary.summary) {
        return cachedSummary.summary.title;
      }
    }

    const records = readJsonLines(resolvedStoreRef);
    const meta = records.find((record) => record.data.type === "session_meta")?.data;
    const metaPayload = (meta?.payload ?? {}) as Record<string, unknown>;
    const codexSessionId = this.resolveCodexSessionId(metaPayload, providerSessionId || fileSessionId);
    const messages = this.parseMessagesFromEntries(resolvedStoreRef, records, codexSessionId);
    const resolvedTitle = (
      this.resolveIndexedTitle(threadMetadataIndex, codexSessionId) ??
      resolveCodexFallbackTitle(messages) ??
      fileSessionId
    );

    this.touchSessionSummaryCache(resolvedStoreRef, {
      filePath: resolvedStoreRef,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      workspacePath: (sessionIdentity?.cwd ?? ensureText(metaPayload.cwd)) || null,
      providerSessionId: codexSessionId,
      title: resolvedTitle,
      summary: null
    });

    return resolvedTitle;
  }

  async renameSessionTitle(
    providerSessionId: string,
    rawStoreRef: string,
    title: string
  ): Promise<string> {
    const nextTitle = title.trim();
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const indexPath = join(this.options.homeDir, "session_index.jsonl");
    const stateDbPath = findLatestCodexStateDatabase(this.options.homeDir);

    statSync(resolvedStoreRef);
    ensureDirectory(this.options.homeDir);
    appendJsonLine(indexPath, {
      id: providerSessionId,
      thread_name: nextTitle
    });

    if (stateDbPath) {
      const DatabaseSync = loadDatabaseSync();
      let db: DatabaseSyncType | null = null;

      try {
        db = new DatabaseSync(stateDbPath, { open: true });
        db.prepare("UPDATE threads SET title = ? WHERE id = ?").run(nextTitle, providerSessionId);
      } finally {
        db?.close();
      }
    }

    this.sessionSummaryCache.delete(resolvedStoreRef);

    return nextTitle;
  }

  async updateSessionArchiveState(
    providerSessionId: string,
    rawStoreRef: string,
    isArchived: boolean
  ): Promise<import("../types.js").ProviderArchiveUpdateResult> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const currentFileName = basename(resolvedStoreRef) || `${providerSessionId}.jsonl`;
    const nextStoreRef = isArchived
      ? join(this.options.homeDir, "archived_sessions", currentFileName)
      : buildCodexActiveSessionPath(this.options.homeDir, currentFileName);
    const controlResult = await this.updateArchiveStateViaThreadControlTransport(
      providerSessionId,
      resolvedStoreRef,
      nextStoreRef,
      isArchived
    );

    let finalStoreRef = nextStoreRef;

    if (controlResult) {
      finalStoreRef = controlResult.rawStoreRef;
    } else {
      const stateDbPath = findLatestCodexStateDatabase(this.options.homeDir);

      statSync(resolvedStoreRef);

      if (resolvedStoreRef !== nextStoreRef) {
        ensureDirectory(dirname(nextStoreRef));
        renameSync(resolvedStoreRef, nextStoreRef);
      }

      if (stateDbPath) {
        const DatabaseSync = loadDatabaseSync();
        let db: DatabaseSyncType | null = null;

        try {
          db = new DatabaseSync(stateDbPath, { open: true });
          db.prepare(
            `UPDATE threads
             SET archived = ?,
                 archived_at = ?,
                 rollout_path = ?
             WHERE id = ?`
          ).run(
            isArchived ? 1 : 0,
            isArchived ? Math.floor(Date.now() / 1000) : null,
            nextStoreRef,
            providerSessionId
          );
        } finally {
          db?.close();
        }
      }
    }

    this.sessionSummaryCache.delete(resolvedStoreRef);
    this.sessionSummaryCache.delete(finalStoreRef);
    // 归档切换后线程索引的 archived / rollout_path 也变了，不能继续赌文件系统 mtime 一定会跳。
    this.invalidateThreadMetadataIndexCache();

    return {
      rawStoreRef: finalStoreRef,
      isArchived
    };
  }

  private async updateArchiveStateViaThreadControlTransport(
    providerSessionId: string,
    resolvedStoreRef: string,
    nextStoreRef: string,
    isArchived: boolean
  ): Promise<{ rawStoreRef: string } | null> {
    const createTransport = this.options.threadControlTransportFactory;

    if (!createTransport) {
      return null;
    }

    const transport = createTransport();

    try {
      await transport.initialize();

      if (isArchived) {
        await transport.archiveThread(providerSessionId);
      } else {
        await transport.unarchiveThread(providerSessionId);
      }

      const result = await transport.readThread(providerSessionId).catch(() => null);
      const thread = result && typeof result === "object"
        ? ((result.thread ?? null) as Record<string, unknown> | null)
        : null;
      const appServerRawStoreRef = ensureText(thread?.path).trim();
      const resolvedNextStoreRef =
        appServerRawStoreRef.length > 0
          ? this.resolveSessionFilePath(appServerRawStoreRef, providerSessionId)
          : this.resolveSessionFilePath(nextStoreRef, providerSessionId);

      this.sessionSummaryCache.delete(resolvedStoreRef);
      this.sessionSummaryCache.delete(resolvedNextStoreRef);
      return {
        rawStoreRef: resolvedNextStoreRef
      };
    } catch {
      return null;
    } finally {
      transport.close();
    }
  }

  getProviderCapabilities(): ProviderCapabilities {
    return {
      provider: this.providerId,
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      supportsSessionFork: true,
      limitations: [
        "运行中追加消息依赖 Codex CLI app-server 暴露 turn/steer；当前项目实测 codex-cli 0.118.0 可用。",
        "当前 npm SDK 仍只有 run/runStreamed 轮询式接口，宿主运行时需经由 Codex CLI app-server 才能直发 steer。"
      ]
    };
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  async readContextUsage(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ContextUsageSnapshot | null> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const records = readJsonLines(resolvedStoreRef).map((record) => record.data);

    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];

      if (ensureText(record.type).trim() !== "event_msg") {
        continue;
      }

      const payload = ((record.payload ?? {}) as Record<string, unknown>);

      if (ensureText(payload.type).trim() !== "token_count") {
        continue;
      }

      const info = ((payload.info ?? {}) as Record<string, unknown>);
      const lastUsage = ((info.last_token_usage ?? {}) as Record<string, unknown>);
      const uncachedInputTokens = readNonNegativeInteger(lastUsage.input_tokens);
      const cachedInputTokens = readNonNegativeInteger(lastUsage.cached_input_tokens);

      if (uncachedInputTokens === null && cachedInputTokens === null) {
        continue;
      }

      const promptTokens = uncachedInputTokens ?? 0;
      const modelId = ensureText(info.model ?? info.model_id).trim() || null;
      const runtimeContextWindow = readNonNegativeInteger(info.model_context_window);
      const contextWindow =
        runtimeContextWindow
        ?? resolveCodexKnownContextWindow(modelId)
        ?? readCodexConfigContextWindow(this.options.homeDir);

      if (contextWindow === null || contextWindow <= 0) {
        return null;
      }

      return {
        provider: this.providerId,
        promptTokens,
        uncachedInputTokens: uncachedInputTokens ?? 0,
        cachedInputTokens: cachedInputTokens ?? 0,
        contextWindow,
        usageRatio: clampUsageRatio(promptTokens, contextWindow),
        source: "provider-log",
        contextWindowSource:
          runtimeContextWindow !== null
            ? "provider-log"
            : resolveCodexKnownContextWindow(modelId) !== null
              ? "model-map"
              : "provider-config",
        modelId,
        capturedAt: safeDate(record.timestamp, "").trim() || null,
        isEstimated: runtimeContextWindow === null
      };
    }

    return null;
  }

  private readThreadMetadataIndex(): Map<string, CodexThreadMetadata> {
    const indexPath = join(this.options.homeDir, "session_index.jsonl");
    const indexPathMtimeMs = existsSync(indexPath) ? statSync(indexPath).mtimeMs : null;
    const stateDbPath = findLatestCodexStateDatabase(this.options.homeDir);
    const stateDbMtimeMs =
      stateDbPath && existsSync(stateDbPath) ? statSync(stateDbPath).mtimeMs : null;
    const cached = this.threadMetadataIndexCache;

    if (
      cached
      && cached.indexPathMtimeMs === indexPathMtimeMs
      && cached.stateDbPath === stateDbPath
      && cached.stateDbMtimeMs === stateDbMtimeMs
    ) {
      return cached.index;
    }

    const index = new Map<string, CodexThreadMetadata>();

    if (existsSync(indexPath)) {
      const lines = readFileSync(indexPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      // 这里容忍单行脏数据，避免某一条坏记录把整个会话列表拖死。
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as {
            id?: unknown;
            thread_name?: unknown;
          };
          const id = ensureText(record.id).trim();

          if (id.length === 0) {
            continue;
          }

          index.set(id, {
            title: normalizeCodexIndexedTitle(ensureText(record.thread_name)) || null,
            cwd: null,
            createdAtMs: null,
            firstUserMessage: null,
            agentNickname: null,
            agentRole: null,
            isArchived: null,
            rolloutPath: null
          });
        } catch {
          continue;
        }
      }
    }

    if (!stateDbPath) {
      this.threadMetadataIndexCache = {
        indexPathMtimeMs,
        stateDbPath: null,
        stateDbMtimeMs: null,
        index
      };
      return index;
    }

    const DatabaseSync = loadDatabaseSync();
    let db: DatabaseSyncType | null = null;

    try {
      db = new DatabaseSync(stateDbPath, { open: true, readOnly: true });
      const rows = db.prepare(
        `SELECT
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         FROM threads`
      ).all() as Array<{
        id?: unknown;
        title?: unknown;
        cwd?: unknown;
        created_at?: unknown;
        archived?: unknown;
        first_user_message?: unknown;
        agent_nickname?: unknown;
        agent_role?: unknown;
        rollout_path?: unknown;
      }>;

      for (const row of rows) {
        const id = ensureText(row.id).trim();

        if (id.length === 0) {
          continue;
        }

        const current = index.get(id);
        const dbTitle = normalizeCodexIndexedTitle(ensureText(row.title)) || null;
        const createdAtSeconds =
          typeof row.created_at === "number"
            ? row.created_at
            : Number.parseInt(ensureText(row.created_at), 10);

        index.set(id, {
          title: current?.title ?? dbTitle,
          cwd: ensureText(row.cwd).trim() || (current?.cwd ?? null),
          createdAtMs: Number.isFinite(createdAtSeconds) ? createdAtSeconds * 1000 : null,
          firstUserMessage:
            ensureText(row.first_user_message).trim() || (current?.firstUserMessage ?? null),
          agentNickname:
            ensureText(row.agent_nickname).trim() || (current?.agentNickname ?? null),
          agentRole: ensureText(row.agent_role).trim() || (current?.agentRole ?? null),
          rolloutPath:
            ensureText(row.rollout_path).trim() || (current?.rolloutPath ?? null),
          isArchived:
            typeof row.archived === "number"
              ? row.archived === 1
              : ensureText(row.rollout_path).includes("archived_sessions")
                ? true
                : (current?.isArchived ?? null)
        });
      }
    } catch {
      this.threadMetadataIndexCache = {
        indexPathMtimeMs,
        stateDbPath,
        stateDbMtimeMs,
        index
      };
      return index;
    } finally {
      db?.close();
    }

    this.threadMetadataIndexCache = {
      indexPathMtimeMs,
      stateDbPath,
      stateDbMtimeMs,
      index
    };
    return index;
  }

  private listSessionFiles(
    targetPath: string,
    threadMetadataIndex: Map<string, CodexThreadMetadata>,
    knownSessions: ProviderSessionSummary[]
  ): string[] {
    const activeFiles = walkJsonlFiles(join(this.options.homeDir, "sessions"));
    const archivedFiles = this.listArchivedSessionFiles(
      targetPath,
      threadMetadataIndex,
      knownSessions
    );
    return [...activeFiles, ...archivedFiles];
  }

  private listArchivedSessionFiles(
    targetPath: string,
    threadMetadataIndex: Map<string, CodexThreadMetadata>,
    knownSessions: ProviderSessionSummary[]
  ): string[] {
    const archivedFiles = new Set<string>();

    for (const metadata of threadMetadataIndex.values()) {
      if (
        metadata.isArchived !== true
        || !metadata.rolloutPath
      ) {
        continue;
      }

      if (
        targetPath.length > 0
        && normalizeWorkspacePath(metadata.cwd ?? "") !== targetPath
      ) {
        continue;
      }

      archivedFiles.add(metadata.rolloutPath);
    }

    for (const session of knownSessions) {
      if (
        session.isArchived !== true
        || normalizeWorkspacePath(session.workspacePath) !== targetPath
        || !isCodexArchivedFilePath(session.rawStoreRef)
      ) {
        continue;
      }

      archivedFiles.add(session.rawStoreRef);
    }

    if (archivedFiles.size > 0) {
      return [...archivedFiles].filter((filePath) => existsSync(filePath));
    }

    if (threadMetadataIndex.size === 0) {
      return walkJsonlFiles(join(this.options.homeDir, "archived_sessions"));
    }

    return [];
  }

  private resolveSessionFilePath(rawStoreRef: string, providerSessionId: string): string {
    const matchedByThreadId = this.findSessionFileByThreadId(providerSessionId);

    if (existsSync(rawStoreRef)) {
      const boundThreadId = this.readThreadIdFromRawStore(rawStoreRef);

      if (!boundThreadId || boundThreadId === providerSessionId) {
        return rawStoreRef;
      }

      if (matchedByThreadId) {
        return matchedByThreadId;
      }

      return buildSyntheticCodexHistoryPath(this.options.homeDir, providerSessionId);
    }

    const fileName = basename(rawStoreRef) || `${providerSessionId}.jsonl`;
    const match = fileName.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T.+\.jsonl$/);
    const candidates = [
      join(this.options.homeDir, "archived_sessions", fileName),
      match
        ? join(this.options.homeDir, "sessions", match[1], match[2], match[3], fileName)
        : null
    ].filter((value): value is string => value !== null);

    const matchedPath = candidates.find((candidate) => existsSync(candidate));

    if (matchedPath) {
      return matchedPath;
    }

    if (matchedByThreadId) {
      return matchedByThreadId;
    }

    if (isSyntheticCodexHistoryPath(rawStoreRef)) {
      return rawStoreRef;
    }

    return buildSyntheticCodexHistoryPath(this.options.homeDir, providerSessionId);
  }

  private findSessionFileByThreadId(providerSessionId: string): string | null {
    const threadMetadataIndex = this.readThreadMetadataIndex();
    const activeFiles = walkJsonlFiles(join(this.options.homeDir, "sessions"));
    const archivedFiles = this.listArchivedSessionFiles("", threadMetadataIndex, []);

    for (const filePath of [...activeFiles, ...archivedFiles]) {
      const threadId = this.readThreadIdFromRawStore(filePath);

      if (threadId === providerSessionId) {
        return filePath;
      }
    }

    return null;
  }

  private readThreadIdFromRawStore(filePath: string): string | null {
    if (!existsSync(filePath)) {
      return null;
    }

    const firstLine = readFirstNonEmptyLine(filePath);

    if (!firstLine) {
      return null;
    }

    try {
      const record = JSON.parse(firstLine) as {
        type?: unknown;
        payload?: {
          id?: unknown;
        };
      };

      if (ensureText(record.type).trim() !== "session_meta") {
        return null;
      }

      const threadId = ensureText(record.payload?.id).trim();
      return threadId.length > 0 ? threadId : null;
    } catch {
      return null;
    }
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

    const records = readJsonLines(filePath);
    const messages = this.parseMessagesFromEntries(filePath, records, providerSessionId);
    this.touchHistoryCache(filePath, {
      filePath,
      providerSessionId,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      messages
    });
    return messages;
  }

  private touchHistoryCache(filePath: string, entry: CodexHistoryCacheEntry): void {
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

  private async buildForkResultFromTransport(input: {
    providerSessionId: string;
    rawStoreRef: string | null;
    workspacePath: string;
    fallbackParentProviderSessionId: string | null;
    forkMethod: ForkSessionResult["forkMethod"];
    forkSourceType: ForkSessionResult["forkSourceType"];
    providerSourceMessageId: string | null;
    messageCountOverride?: number;
    inheritedPrefixMessageCountOverride?: number;
    lastMessageAtOverride?: string | null;
  }): Promise<ForkSessionResult> {
    const resolvedStoreRef =
      input.rawStoreRef
        ? this.resolveSessionFilePath(input.rawStoreRef, input.providerSessionId)
        : this.findSessionFileByThreadId(input.providerSessionId)
          ?? buildCodexActiveSessionPath(this.options.homeDir, `${input.providerSessionId}.jsonl`);
    const messages =
      existsSync(resolvedStoreRef)
        ? this.getParsedMessages(resolvedStoreRef, input.providerSessionId)
        : [];
    const threadMetadataIndex = this.readThreadMetadataIndex();
    const threadMetadata = threadMetadataIndex.get(input.providerSessionId) ?? null;
    const title =
      this.resolveIndexedTitle(threadMetadataIndex, input.providerSessionId)
      ?? resolveCodexFallbackTitle(messages)
      ?? "";

    return {
      session: {
        provider: this.providerId,
        providerSessionId: input.providerSessionId,
        title,
        workspacePath: input.workspacePath,
        rawStoreRef: resolvedStoreRef,
        isArchived: resolveCodexArchivedState(threadMetadata, resolvedStoreRef),
        lastMessageAt: input.lastMessageAtOverride ?? messages.at(-1)?.timestamp ?? nextTimestamp(),
        messageCount: input.messageCountOverride ?? messages.length,
        parentProviderSessionId: input.fallbackParentProviderSessionId
      },
      forkMethod: input.forkMethod,
      forkSourceType: input.forkSourceType,
      inheritedPrefixMessageCount: input.inheritedPrefixMessageCountOverride ?? messages.length,
      providerSourceMessageId: input.providerSourceMessageId
    };
  }

  private async forkThreadWithHistoryFallback(
    transport: CodexForkTransport,
    providerSessionId: string,
    workspacePath: string,
    rawStoreRef: string
  ): Promise<{ providerSessionId: string; rawStoreRef: string | null }> {
    try {
      return await transport.forkThread(providerSessionId);
    } catch (error) {
      const history = buildCodexResumeHistoryFromRawStore(rawStoreRef);

      if (!shouldFallbackCodexForkFromHistory(error, history)) {
        throw error;
      }

      // app-server 的 thread/fork 依赖源 thread 已经挂在当前连接上。
      // 这个前提跨请求就会失效，所以这里退回到本地 transcript 冷恢复一次。
      const rebuilt = await transport.resumeThreadFromHistory({
        providerSessionId: null,
        workspacePath,
        history,
        model: null
      });

      return await transport.forkThread(rebuilt.providerSessionId);
    }
  }

  private touchSessionSummaryCache(
    filePath: string,
    entry: CodexSessionSummaryCacheEntry
  ): void {
    this.sessionSummaryCache.delete(filePath);
    this.sessionSummaryCache.set(filePath, entry);

    while (this.sessionSummaryCache.size > SESSION_SUMMARY_CACHE_LIMIT) {
      const oldestKey = this.sessionSummaryCache.keys().next().value;

      if (!oldestKey) {
        break;
      }

      this.sessionSummaryCache.delete(oldestKey);
    }
  }

  private invalidateThreadMetadataIndexCache(): void {
    this.threadMetadataIndexCache = null;
  }

  private touchSpawnRelationScanCache(
    filePath: string,
    entry: CodexSpawnRelationScanCacheEntry
  ): void {
    this.spawnRelationScanCache.delete(filePath);
    this.spawnRelationScanCache.set(filePath, entry);

    while (this.spawnRelationScanCache.size > SPAWN_RELATION_SCAN_CACHE_LIMIT) {
      const oldestKey = this.spawnRelationScanCache.keys().next().value;

      if (!oldestKey) {
        break;
      }

      this.spawnRelationScanCache.delete(oldestKey);
    }
  }

  private isForkedChildHistoryAligned(
    childThreadReadResult: Record<string, unknown>,
    expectedHistory: unknown[]
  ): boolean {
    const expectedSignatures = collectCodexForkComparableSignatures(expectedHistory);

    if (expectedSignatures.length === 0) {
      return false;
    }

    let childHistory: unknown[];

    try {
      childHistory = extractCodexThreadHistory(childThreadReadResult);
    } catch {
      return false;
    }

    const childSignatures = collectCodexForkComparableSignatures(childHistory);

    if (childSignatures.length !== expectedSignatures.length) {
      return false;
    }

    return expectedSignatures.every((signature, index) => childSignatures[index] === signature);
  }

  private resolveCodexSessionId(
    metaPayload: Record<string, unknown>,
    providerSessionId: string
  ): string {
    const metaId = ensureText(metaPayload.id).trim();
    const normalizedProviderSessionId = ensureText(providerSessionId).trim();

    if (looksLikeCodexThreadId(metaId)) {
      return metaId;
    }

    const matched = normalizedProviderSessionId.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    );

    if (matched?.[1]) {
      return matched[1];
    }

    return metaId || normalizedProviderSessionId;
  }

  private resolveIndexedTitle(
    index: Map<string, CodexThreadMetadata>,
    sessionId: string
  ): string | null {
    const metadata = index.get(sessionId);
    const indexedTitle = normalizeCodexIndexedTitle(metadata?.title);
    const normalizedFirstUserMessage = normalizeCodexIndexedTitle(metadata?.firstUserMessage);

    if (indexedTitle) {
      // Codex 有时会把第一条用户消息原样回填成 title，这种脏标题仍然按统一长度预算裁掉。
      if (normalizedFirstUserMessage && indexedTitle === normalizedFirstUserMessage) {
        return indexedTitle.slice(0, CODEX_SESSION_TITLE_MAX_LENGTH);
      }

      return indexedTitle;
    }

    return normalizeCodexMessageTitle(metadata?.firstUserMessage);
  }

  private readSpawnedAgentRelationIndex(
    files: Array<{
      filePath: string;
      stats: { mtimeMs: number; size: number };
      sessionIdentity: CodexSessionIdentity | null;
    }>,
    targetPath: string,
    threadMetadataIndex: Map<string, CodexThreadMetadata>,
    candidateThreadIds?: Iterable<string>
  ): Map<string, CodexSpawnRelation> {
    const directRelations = new Map<string, CodexSpawnRelation>();
    const spawnRecords: CodexSpawnRecord[] = [];

    for (const entry of files) {
      const { filePath, stats } = entry;
      const cached = this.spawnRelationScanCache.get(filePath);

      if (
        cached
        && cached.mtimeMs === stats.mtimeMs
        && cached.size === stats.size
      ) {
        this.touchSpawnRelationScanCache(filePath, cached);

        if (cached.workspacePath !== targetPath) {
          continue;
        }

        for (const [threadId, relation] of cached.directRelations) {
          directRelations.set(threadId, relation);
        }

        spawnRecords.push(...cached.spawnRecords);
        continue;
      }

      const sessionIdentity =
        entry.sessionIdentity ?? this.readSessionIdentity(filePath, basename(filePath, ".jsonl"));

      if (!sessionIdentity) {
        this.touchSpawnRelationScanCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: null,
          directRelations: [],
          spawnRecords: []
        });
        continue;
      }

      const workspacePath = normalizeWorkspacePath(sessionIdentity.cwd);

      if (workspacePath !== targetPath) {
        this.touchSpawnRelationScanCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath,
          directRelations: [],
          spawnRecords: []
        });
        continue;
      }

      if (sessionIdentity.parentThreadId) {
        const relation = {
          parentProviderSessionId: sessionIdentity.parentThreadId
        } satisfies CodexSpawnRelation;
        directRelations.set(sessionIdentity.threadId, relation);
        this.touchSpawnRelationScanCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath,
          directRelations: [[sessionIdentity.threadId, relation]],
          spawnRecords: []
        });
        continue;
      }

      const records = readJsonLines(filePath).map((record) => record.data);
      const spawnCallById = new Map<string, CodexSpawnRecord>();
      const fileSpawnRecords: CodexSpawnRecord[] = [];
      const fileDirectRelations: Array<readonly [string, CodexSpawnRelation]> = [];

      for (const record of records) {
        if (record.type !== "response_item") {
          continue;
        }

        const payload = (record.payload ?? {}) as Record<string, unknown>;
        const payloadType = ensureText(payload.type).trim();

        if (payloadType === "function_call" && ensureText(payload.name).trim() === "spawn_agent") {
          const callId = ensureText(payload.call_id).trim();
          const args = parseStructuredJson(ensureText(payload.arguments));
          const message = ensureText(args?.message).trim();

          if (callId.length === 0 || message.length === 0) {
            continue;
          }

          const spawnRecord: CodexSpawnRecord = {
            parentProviderSessionId: sessionIdentity.threadId,
            workspacePath: sessionIdentity.cwd,
            message,
            timestampMs: toTimestampMs(record.timestamp)
          };

          spawnCallById.set(callId, spawnRecord);
          fileSpawnRecords.push(spawnRecord);
          spawnRecords.push(spawnRecord);
          continue;
        }

        if (payloadType !== "function_call_output") {
          continue;
        }

        const callId = ensureText(payload.call_id).trim();
        const spawnRecord = spawnCallById.get(callId);

        if (!spawnRecord) {
          continue;
        }

        const agentId = parseCodexAgentIdFromToolOutput(ensureText(payload.output));

        if (!agentId) {
          continue;
        }

        const relation = {
          parentProviderSessionId: spawnRecord.parentProviderSessionId
        } satisfies CodexSpawnRelation;
        directRelations.set(agentId, relation);
        fileDirectRelations.push([agentId, relation]);
      }

      this.touchSpawnRelationScanCache(filePath, {
        filePath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        workspacePath,
        directRelations: fileDirectRelations,
        spawnRecords: fileSpawnRecords
      });
    }

    const relationCandidates =
      candidateThreadIds === undefined
        ? [...threadMetadataIndex.entries()]
        : [...new Set(candidateThreadIds)]
          .map((threadId) => [threadId, threadMetadataIndex.get(threadId) ?? null] as const)
          .filter((entry): entry is readonly [string, CodexThreadMetadata] => entry[1] !== null);

    for (const [threadId, metadata] of relationCandidates) {
      if (directRelations.has(threadId)) {
        continue;
      }

      if (!metadata.agentRole && !metadata.agentNickname) {
        continue;
      }

      const firstUserMessage = metadata.firstUserMessage?.trim();
      const workspacePath = metadata.cwd ? normalizeWorkspacePath(metadata.cwd) : null;

      if (!firstUserMessage || workspacePath !== targetPath) {
        continue;
      }

      const matchedSpawn = pickClosestCodexSpawnRecord(
        spawnRecords,
        workspacePath,
        firstUserMessage,
        metadata.createdAtMs
      );

      if (!matchedSpawn) {
        continue;
      }

      directRelations.set(threadId, {
        parentProviderSessionId: matchedSpawn.parentProviderSessionId
      });
    }

    return directRelations;
  }

  private readSessionIdentity(
    filePath: string,
    fallbackSessionId: string
  ): CodexSessionIdentity | null {
    if (!existsSync(filePath)) {
      return null;
    }

    const firstLine = readFirstNonEmptyLine(filePath);

    if (!firstLine) {
      return null;
    }

    try {
      const record = JSON.parse(firstLine) as {
        type?: unknown;
        payload?: {
          id?: unknown;
          cwd?: unknown;
        };
      };

      if (ensureText(record.type).trim() !== "session_meta") {
        return null;
      }

      const payload = (record.payload ?? {}) as Record<string, unknown>;

      return {
        threadId: this.resolveCodexSessionId(payload, fallbackSessionId),
        cwd: ensureText(payload.cwd).trim(),
        parentThreadId: resolveCodexParentThreadId(payload)
      };
    } catch {
      return null;
    }
  }

  private hydrateSessionSummary(
    summary: ProviderSessionSummary,
    filePath: string,
    stats: { mtimeMs: number; size: number },
    metadata?: CodexThreadMetadata | null,
    relation?: CodexSpawnRelation | null
  ): ProviderSessionSummary {
    const resolvedRelation = relation ?? null;
    const resolvedMetadata = metadata ?? null;
    const isSubagent =
      resolvedMetadata || resolvedRelation
        ? isCodexSubagentThread(resolvedMetadata, resolvedRelation)
        : Boolean(summary.isSubagent);

    return {
      ...summary,
      rawStoreRef: filePath,
      isArchived: resolveCodexArchivedState(resolvedMetadata, filePath),
      parentProviderSessionId:
        resolvedRelation?.parentProviderSessionId ?? summary.parentProviderSessionId ?? null,
      isSubagent,
      subagentLabel:
        resolvedMetadata !== null
          ? buildCodexSubagentLabel(resolvedMetadata)
          : summary.subagentLabel ?? null,
      sourceMtimeMs: stats.mtimeMs,
      sourceSizeBytes: stats.size
    };
  }

  private parseMessages(
    filePath: string,
    records: Array<RawJsonLine>,
    providerSessionId: string
  ): NormalizedMessage[] {
    return this.parseMessagesFromEntries(filePath, records, providerSessionId);
  }

  private parseMessagesFromEntries(
    filePath: string,
    records: Array<Pick<RawJsonLine, "lineNumber" | "partIndex" | "data">>,
    providerSessionId: string
  ): NormalizedMessage[] {
    const effectiveRecords = filterRolledBackCodexRecords(records);
    const messages: Array<{
      source: CodexMessageSource;
      dedupeKey: string;
      message: NormalizedMessage;
    }> = [];
    const messageIndexesByKey = new Map<string, number[]>();
    const toolNameById = new Map<string, string>();
    let sequence = 0;

    const pushMessage = (
      source: CodexMessageSource,
      message: Omit<NormalizedMessage, "sequence">
    ) => {
      const dedupeKey = buildCodexMessageDedupeKey(message);
      const candidateIndexes = messageIndexesByKey.get(dedupeKey) ?? [];

      for (let index = candidateIndexes.length - 1; index >= 0; index -= 1) {
        const existingIndex = candidateIndexes[index];
        const existing = messages[existingIndex];

        if (!isEquivalentCodexMessage(existing.message, message)) {
          continue;
        }

        // 同一条逻辑消息如果被 event_msg 和 response_item 同时记录，
        // 优先保留结构更稳定的 response_item，避免时间线重复。
        if (codexMessageSourcePriority(source) > codexMessageSourcePriority(existing.source)) {
          messages[existingIndex] = {
            source,
            dedupeKey,
            message: {
              ...message,
              sequence: existing.message.sequence
            }
          };
        }

        return;
      }

      sequence += 1;
      messageIndexesByKey.set(dedupeKey, [...candidateIndexes, messages.length]);
      messages.push({
        source,
        dedupeKey,
        message: {
          ...message,
          sequence
        }
      });
    };

    effectiveRecords.forEach(({ lineNumber, partIndex, data: record }) => {
      const rawRef = createRawRef(this.providerId, filePath, lineNumber, partIndex || undefined);

      if (record.type === "event_msg") {
        const payload = (record.payload ?? {}) as Record<string, unknown>;
        const eventType = ensureText(payload.type);

        if (eventType === "user_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: resolveCodexParsedMessageId({
                providerSessionId,
                rawRef,
                role: "user",
                kind: "text",
                payloadId: payload.id
              }),
              provider: this.providerId,
              providerSessionId,
              role: "user",
              kind: "text",
              content,
              toolCall: null,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              rawRef
            });
          }
        }

        if (eventType === "agent_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: resolveCodexParsedMessageId({
                providerSessionId,
                rawRef,
                role: "assistant",
                kind: "text",
                payloadId: payload.id
              }),
              provider: this.providerId,
              providerSessionId,
              role: "assistant",
              kind: "text",
              content,
              toolCall: null,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              rawRef
            });
          }
        }

        if (eventType === "agent_reasoning") {
          const content = extractTextBlocks(payload.text ?? payload.message).trim();

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: resolveCodexParsedMessageId({
                providerSessionId,
                rawRef,
                role: "assistant",
                kind: "thinking",
                payloadId: payload.id
              }),
              provider: this.providerId,
              providerSessionId,
              role: "assistant",
              kind: "thinking",
              content,
              toolCall: null,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              rawRef
            });
          }
        }
      }

      if (record.type === "response_item") {
        const payload = (record.payload ?? {}) as {
          id?: unknown;
          type?: unknown;
          role?: unknown;
          content?: Array<Record<string, unknown>>;
          summary?: Array<Record<string, unknown>>;
          name?: unknown;
          arguments?: unknown;
          call_id?: unknown;
          input?: unknown;
          output?: unknown;
        };
        const payloadType = ensureText(payload.type);

        if (payloadType === "reasoning") {
          const content = extractTextFromArray(payload.summary);

          if (content.length === 0) {
            return;
          }

          pushMessage("response_item", {
            messageId: resolveCodexParsedMessageId({
              providerSessionId,
              rawRef,
              role: "assistant",
              kind: "thinking",
              payloadId: payload.id
            }),
            provider: this.providerId,
            providerSessionId,
            role: "assistant",
            kind: "thinking",
            content,
            toolCall: null,
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            rawRef
          });
          return;
        }

        if (payloadType === "function_call" || payloadType === "custom_tool_call") {
          const callId = ensureText(payload.call_id).trim() || rawRef;
          const name = ensureText(payload.name).trim() || "tool";
          const inputSource = payloadType === "custom_tool_call" ? payload.input : payload.arguments;
          const input = stringifyStructuredValue(inputSource);
          toolNameById.set(callId, name);

          pushMessage("response_item", {
            messageId: resolveCodexParsedMessageId({
              providerSessionId,
              rawRef,
              role: "tool",
              kind: "tool_call",
              callId
            }),
            provider: this.providerId,
            providerSessionId,
            role: "tool",
            kind: "tool_call",
            content: input,
            toolCall: {
              callId,
              name,
              input,
              output: null,
              error: null,
              status: "running"
            },
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            rawRef
          });
          return;
        }

        if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
          const callId = ensureText(payload.call_id).trim() || rawRef;
          const name = toolNameById.get(callId) ?? "tool";
          const output = extractTextBlocks(payload.output).trim() || stringifyStructuredValue(payload.output);
          const resultState = resolveToolResultState(payload, output);

          pushMessage("response_item", {
            messageId: resolveCodexParsedMessageId({
              providerSessionId,
              rawRef,
              role: "tool",
              kind: "tool_result",
              callId
            }),
            provider: this.providerId,
            providerSessionId,
            role: "tool",
            kind: "tool_result",
            content: output,
            toolCall: {
              callId,
              name,
              input: "",
              output: resultState.status === "failed" ? null : output,
              error: resultState.status === "failed" ? output : null,
              status: resultState.status
            },
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            rawRef
          });
          return;
        }

        if (payloadType !== "message") {
          return;
        }

        const role = ensureText(payload.role);
        const content = extractTextFromArray(payload.content);

        if (content.length === 0 || (role !== "assistant" && role !== "user")) {
          return;
        }

        pushMessage("response_item", {
          messageId: resolveCodexParsedMessageId({
            providerSessionId,
            rawRef,
            role,
            kind: "text",
            payloadId: payload.id
          }),
          provider: this.providerId,
          providerSessionId,
          role,
          kind: "text",
          content,
          toolCall: null,
          timestamp: safeDate(record.timestamp, nextTimestamp()),
          rawRef
        });
      }
    });

    return messages.map((entry) => entry.message);
  }
}

function filterRolledBackCodexRecords<T extends Pick<RawJsonLine, "lineNumber" | "partIndex" | "data">>(
  records: T[]
): T[] {
  const completedTurnSegments: Array<{
    startLineNumber: number;
    endLineNumber: number;
    rolledBack: boolean;
  }> = [];
  let activeTurnStartLineNumber: number | null = null;
  let sawRollbackEvent = false;

  for (const recordEntry of records) {
    const record = recordEntry.data;

    if (record.type !== "event_msg") {
      continue;
    }

    const payload = (record.payload ?? {}) as Record<string, unknown>;
    const eventType = ensureText(payload.type).trim();

    if (eventType === "task_started") {
      activeTurnStartLineNumber = recordEntry.lineNumber;
      continue;
    }

    if (eventType === "task_complete" || eventType === "task_failed") {
      if (activeTurnStartLineNumber !== null) {
        completedTurnSegments.push({
          startLineNumber: activeTurnStartLineNumber,
          endLineNumber: recordEntry.lineNumber,
          rolledBack: false
        });
      }

      activeTurnStartLineNumber = null;
      continue;
    }

    if (eventType !== "thread_rolled_back") {
      continue;
    }

    sawRollbackEvent = true;
    const requestedTurnCount = Math.max(
      0,
      Math.trunc(
        typeof payload.num_turns === "number"
          ? payload.num_turns
          : Number.parseInt(ensureText(payload.num_turns), 10)
      ) || 0
    );

    if (requestedTurnCount <= 0) {
      continue;
    }

    let remainingTurnsToRollback = requestedTurnCount;

    for (let index = completedTurnSegments.length - 1; index >= 0; index -= 1) {
      const segment = completedTurnSegments[index];

      if (!segment || segment.rolledBack) {
        continue;
      }

      segment.rolledBack = true;
      remainingTurnsToRollback -= 1;

      if (remainingTurnsToRollback <= 0) {
        break;
      }
    }
  }

  if (!sawRollbackEvent) {
    return records;
  }

  const rolledBackSegments = completedTurnSegments
    .filter((segment) => segment.rolledBack)
    .sort((left, right) => left.startLineNumber - right.startLineNumber);

  if (rolledBackSegments.length === 0) {
    return records;
  }

  const filteredRecords: T[] = [];
  let segmentIndex = 0;

  for (const recordEntry of records) {
    while (
      segmentIndex < rolledBackSegments.length
      && recordEntry.lineNumber > rolledBackSegments[segmentIndex]!.endLineNumber
    ) {
      segmentIndex += 1;
    }

    const activeSegment =
      segmentIndex < rolledBackSegments.length ? rolledBackSegments[segmentIndex]! : null;

    if (
      activeSegment
      && recordEntry.lineNumber >= activeSegment.startLineNumber
      && recordEntry.lineNumber <= activeSegment.endLineNumber
    ) {
      continue;
    }

    filteredRecords.push(recordEntry);
  }

  return filteredRecords;
}

function buildRecentHistoryPage(
  messages: NormalizedMessage[],
  totalMessageCount: number,
  limit: number
): HistoryPage {
  const effectiveTotal = Math.max(totalMessageCount, messages.length);
  const pageMessages = messages.slice(-Math.min(limit, messages.length)).map((message, index, items) => ({
    ...message,
    sequence: effectiveTotal - items.length + index + 1
  }));
  const nextCursor =
    effectiveTotal > pageMessages.length
      ? encodeCursor(effectiveTotal - pageMessages.length)
      : null;

  return {
    messages: pageMessages,
    cursor: encodeCursor(effectiveTotal),
    nextCursor,
    total: effectiveTotal
  };
}

function buildCodexMessageDedupeKey(message: Omit<NormalizedMessage, "sequence">): string {
  const comparable = toComparableCodexMessage(message);

  return JSON.stringify({
    role: comparable.role,
    kind: comparable.kind,
    content: comparable.content,
    toolCall: comparable.toolCall
      ? {
          callId: comparable.toolCall.callId,
          name: comparable.toolCall.name,
          input: comparable.toolCall.input,
          output: comparable.toolCall.output,
          error: comparable.toolCall.error,
          status: comparable.toolCall.status
        }
      : null
  });
}

function resolveCodexFallbackTitle(messages: NormalizedMessage[]): string | null {
  const preferredMessage = messages.find(
    (message) => message.role === "user" && !looksLikeCodexRulesMessage(message.content)
  );

  if (preferredMessage) {
    return normalizeCodexMessageTitle(preferredMessage.content);
  }

  const firstUserMessage = messages.find((message) => message.role === "user");
  return normalizeCodexMessageTitle(firstUserMessage?.content);
}

function looksLikeCodexRulesMessage(content: string): boolean {
  const normalized = content.trim();
  const beginsWithRulesHeader = /^#?\s*AGENTS\.md instructions for\b/i.test(normalized);

  if (beginsWithRulesHeader) {
    return true;
  }

  return /AGENTS\.md instructions for/i.test(normalized)
    && /<INSTRUCTIONS>/i.test(normalized);
}

function codexMessageSourcePriority(source: CodexMessageSource): number {
  return source === "response_item" ? 2 : 1;
}

function isEquivalentCodexMessage(
  left: Pick<NormalizedMessage, "role" | "kind" | "content" | "timestamp" | "toolCall">,
  right: Pick<NormalizedMessage, "role" | "kind" | "content" | "timestamp" | "toolCall">
): boolean {
  const comparableLeft = toComparableCodexMessage(left);
  const comparableRight = toComparableCodexMessage(right);

  if (
    comparableLeft.role !== comparableRight.role ||
    comparableLeft.kind !== comparableRight.kind ||
    comparableLeft.content !== comparableRight.content
  ) {
    return false;
  }

  if (JSON.stringify(comparableLeft.toolCall) !== JSON.stringify(comparableRight.toolCall)) {
    return false;
  }

  return areCodexTimestampsNear(left.timestamp, right.timestamp);
}

function toComparableCodexMessage<
  T extends Pick<NormalizedMessage, "role" | "kind" | "content" | "toolCall">
>(message: T): {
  role: T["role"];
  kind: T["kind"];
  content: string;
  toolCall:
    | {
        callId: string;
        name: string;
        input: string;
        output: string | null;
        error: string | null;
        status: NonNullable<T["toolCall"]>["status"];
      }
    | null;
} {
  return {
    role: message.role,
    kind: message.kind,
    content: normalizeComparableCodexContent(message.kind, message.content),
    toolCall: message.toolCall
      ? {
          callId: message.toolCall.callId,
          name: message.toolCall.name,
          input: normalizeComparableCodexLineEndings(message.toolCall.input),
          output:
            message.toolCall.output === null
              ? null
              : normalizeComparableCodexLineEndings(message.toolCall.output),
          error:
            message.toolCall.error === null
              ? null
              : normalizeComparableCodexLineEndings(message.toolCall.error),
          status: message.toolCall.status
        }
      : null
  };
}

function normalizeComparableCodexContent(
  kind: NormalizedMessage["kind"],
  content: string
): string {
  const normalized = normalizeComparableCodexLineEndings(content);

  if (kind === "text" || kind === "thinking") {
    return normalized.trimEnd();
  }

  return normalized;
}

function normalizeComparableCodexLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function areCodexTimestampsNear(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);

  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return left === right;
  }

  return Math.abs(leftMs - rightMs) <= 1000;
}

function resolveCodexParsedMessageId(input: {
  providerSessionId: string;
  rawRef: string;
  role: NormalizedMessage["role"];
  kind: NormalizedMessage["kind"];
  payloadId?: unknown;
  callId?: string | null;
}): string {
  const stableIdentity = resolveCodexStableIdentity(input);

  if (!stableIdentity) {
    return messageIdFromRawRef(input.rawRef);
  }

  return messageIdFromStableKey(buildCodexStableMessageKey(input.providerSessionId, stableIdentity));
}

function resolveCodexStableIdentity(input: {
  role: NormalizedMessage["role"];
  kind: NormalizedMessage["kind"];
  payloadId?: unknown;
  callId?: string | null;
}): string | null {
  if (input.kind === "tool_call" || input.kind === "tool_result") {
    const normalizedCallId = ensureText(input.callId).trim();

    if (!normalizedCallId) {
      return null;
    }

    return input.kind === "tool_call"
      ? `tool:call:${normalizedCallId}`
      : `tool:result:${normalizedCallId}`;
  }

  if (
    input.role !== "assistant"
    && input.role !== "user"
  ) {
    return null;
  }

  const normalizedPayloadId = ensureText(input.payloadId).trim();

  if (!normalizedPayloadId) {
    return null;
  }

  const identityKind = input.kind === "thinking" ? "thinking" : "text";
  return `${input.role}:${identityKind}:${normalizedPayloadId}`;
}

function buildCodexStableMessageKey(providerSessionId: string, stableIdentity: string): string {
  return `codex:${providerSessionId}:${stableIdentity}`;
}

function extractTextFromArray(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => extractTextBlocks(item).trim())
    .filter((item) => item.length > 0)
    .join("\n");
}

function resolveToolResultState(
  payload: Record<string, unknown>,
  output: string
): { status: "completed" | "failed" } {
  const statusText = ensureText(payload.status).trim().toLowerCase();

  if (statusText === "failed" || statusText === "error") {
    return { status: "failed" };
  }

  if (statusText === "completed" || statusText === "success" || statusText === "succeeded") {
    return { status: "completed" };
  }

  if (typeof payload.success === "boolean") {
    return {
      status: payload.success ? "completed" : "failed"
    };
  }

  if (typeof payload.is_error === "boolean") {
    return {
      status: payload.is_error ? "failed" : "completed"
    };
  }

  if (typeof payload.exit_code === "number") {
    return {
      status: payload.exit_code === 0 ? "completed" : "failed"
    };
  }

  const exitCodeMatch = output.match(/(?:^|\n)Exit code:\s*(-?\d+)/i);

  if (exitCodeMatch) {
    return {
      status: Number(exitCodeMatch[1]) === 0 ? "completed" : "failed"
    };
  }

  if (payload.error != null) {
    return { status: "failed" };
  }

  return { status: "completed" };
}

function shouldIgnoreCodingNsDraftSession(metaPayload: Record<string, unknown>): boolean {
  const source = ensureText(metaPayload.source).trim().toLowerCase();
  const sessionId = ensureText(metaPayload.id).trim().toLowerCase();

  return source === "codingns" && sessionId.startsWith("rollout-");
}

function looksLikeCodexThreadId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function findLatestCodexStateDatabase(homeDir: string): string | null {
  if (!existsSync(homeDir)) {
    return null;
  }

  const candidates = readdirSync(homeDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/i.test(entry.name))
    .map((entry) => {
      const filePath = join(homeDir, entry.name);

      return {
        filePath,
        mtimeMs: statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.filePath ?? null;
}

function parseStructuredJson(value: string): Record<string, unknown> | null {
  const text = value.trim();

  if (text.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

function clampUsageRatio(promptTokens: number, contextWindow: number): number {
  if (contextWindow <= 0) {
    return 0;
  }

  return Math.min(Math.max(promptTokens / contextWindow, 0), 1);
}

function resolveCodexKnownContextWindow(modelId: string | null): number | null {
  if (!modelId) {
    return null;
  }

  return KNOWN_CODEX_CONTEXT_WINDOWS.get(modelId) ?? null;
}

function readCodexConfigContextWindow(homeDir: string): number | null {
  const configPath = join(homeDir, "config.toml");

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf8");
    const matched = content.match(CODEX_CONFIG_CONTEXT_WINDOW_PATTERN);

    if (!matched?.[1]) {
      return null;
    }

    return Number.parseInt(matched[1], 10);
  } catch {
    return null;
  }
}

function parseCodexAgentIdFromToolOutput(output: string): string | null {
  const parsed = parseStructuredJson(output);
  const agentId = ensureText(parsed?.agent_id ?? parsed?.agentId).trim();

  if (looksLikeCodexThreadId(agentId)) {
    return agentId;
  }

  const matched = output.match(
    /"agent(?:_id|Id)"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i
  );

  return matched?.[1] ?? null;
}

function resolveCodexParentThreadId(payload: Record<string, unknown>): string | null {
  const directParentThreadId = ensureText(payload.forked_from_id).trim();

  if (directParentThreadId.length > 0) {
    return directParentThreadId;
  }

  const source =
    typeof payload.source === "object" && payload.source !== null
      ? (payload.source as Record<string, unknown>)
      : null;
  const subagent =
    typeof source?.subagent === "object" && source.subagent !== null
      ? (source.subagent as Record<string, unknown>)
      : null;
  const threadSpawn =
    typeof subagent?.thread_spawn === "object" && subagent.thread_spawn !== null
      ? (subagent.thread_spawn as Record<string, unknown>)
      : null;
  const nestedParentThreadId = ensureText(threadSpawn?.parent_thread_id).trim();

  return nestedParentThreadId.length > 0 ? nestedParentThreadId : null;
}

function toTimestampMs(value: unknown): number | null {
  const timestampMs = Date.parse(ensureText(value).trim());
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function pickClosestCodexSpawnRecord(
  spawnRecords: CodexSpawnRecord[],
  workspacePath: string,
  message: string,
  createdAtMs: number | null
): CodexSpawnRecord | null {
  const matchedRecords = spawnRecords.filter(
    (record) =>
      record.workspacePath !== null &&
      normalizeWorkspacePath(record.workspacePath) === workspacePath &&
      record.message === message
  );

  if (matchedRecords.length === 0) {
    return null;
  }

  if (createdAtMs === null) {
    return matchedRecords.at(-1) ?? null;
  }

  const closeRecord = matchedRecords
    .filter((record) => record.timestampMs !== null)
    .sort(
      (left, right) =>
        Math.abs((left.timestampMs ?? createdAtMs) - createdAtMs) -
        Math.abs((right.timestampMs ?? createdAtMs) - createdAtMs)
    )
    .find((record) => Math.abs((record.timestampMs ?? createdAtMs) - createdAtMs) <= 120_000);

  return closeRecord ?? matchedRecords.at(-1) ?? null;
}

function isCodexSubagentThread(
  metadata: CodexThreadMetadata | null | undefined,
  relation: CodexSpawnRelation | null | undefined
): boolean {
  return Boolean(relation?.parentProviderSessionId || metadata?.agentRole || metadata?.agentNickname);
}

function buildCodexSubagentLabel(metadata: CodexThreadMetadata | null | undefined): string | null {
  const agentRole = metadata?.agentRole?.trim() || "";
  const agentNickname = metadata?.agentNickname?.trim() || "";

  if (agentRole && agentNickname) {
    return `${agentRole} · ${agentNickname}`;
  }

  return agentNickname || agentRole || null;
}

function resolveCodexArchivedState(
  metadata: CodexThreadMetadata | null | undefined,
  filePath: string
): boolean {
  if (isCodexArchivedFilePath(filePath)) {
    return true;
  }

  if (typeof metadata?.isArchived === "boolean") {
    return metadata.isArchived;
  }

  return false;
}

function isCodexArchivedFilePath(filePath: string): boolean {
  return filePath.replaceAll("\\", "/").includes("/archived_sessions/");
}

function buildCodexActiveSessionPath(homeDir: string, fileName: string): string {
  const match = fileName.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T.+\.jsonl$/);

  if (!match) {
    return join(homeDir, "sessions", fileName);
  }

  return join(homeDir, "sessions", match[1], match[2], match[3], fileName);
}

function buildSyntheticCodexHistoryPath(homeDir: string, providerSessionId: string): string {
  return join(homeDir, "runtime", "codex", `${providerSessionId}.jsonl`);
}

function isSyntheticCodexHistoryPath(rawStoreRef: string): boolean {
  const normalized = rawStoreRef.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/runtime/codex/") || normalized.startsWith("runtime/codex/");
}

function hasUsableCodexTitle(title: string | null | undefined): boolean {
  return normalizeCodexIndexedTitle(title) !== null;
}

function normalizeCodexIndexedTitle(title: string | null | undefined): string | null {
  const normalized = ensureText(title).trim();

  if (normalized.length === 0 || looksLikeCodexRulesMessage(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeCodexMessageTitle(content: string | null | undefined): string | null {
  const normalized = normalizeCodexIndexedTitle(content);
  return normalized ? normalized.slice(0, CODEX_SESSION_TITLE_MAX_LENGTH) : null;
}

function extractCodexThreadHistory(result: Record<string, unknown>): unknown[] {
  const snapshot = extractCodexThreadHistorySnapshot(result);
  return snapshot.value;
}

type CodexThreadHistorySnapshot =
  | {
      kind: "entries";
      value: unknown[];
      comparableEntries: Array<{
        signature: string;
        entryIndex: number;
      }>;
    }
  | {
      kind: "turns";
      value: unknown[];
      comparableEntries: Array<{
        signature: string;
        turnIndex: number;
        containerPath: string[];
        entryIndex: number;
      }>;
    };

function extractCodexThreadHistorySnapshot(result: Record<string, unknown>): CodexThreadHistorySnapshot {
  const directHistory =
    pickCodexHistoryArray(result)
    ?? pickCodexHistoryArray(toRecord(result.thread))
    ?? pickCodexHistoryArray(toRecord(result.data));

  if (directHistory) {
    return {
      kind: "entries",
      value: directHistory,
      comparableEntries: directHistory.flatMap((entry, entryIndex) => {
        const signature = buildCodexThreadHistorySignature(entry);
        return signature ? [{ signature, entryIndex }] : [];
      })
    };
  }

  const turns =
    pickCodexTurnArray(result.turns)
    ?? pickCodexTurnArray(toRecord(result.thread)?.turns)
    ?? pickCodexTurnArray(toRecord(result.data)?.turns);

  if (!turns) {
    throw new Error("CODEX_THREAD_HISTORY_MISSING");
  }

  const comparableEntries = turns.flatMap((turn, turnIndex) =>
    collectCodexTurnComparableEntries(turn, turnIndex)
  );

  if (comparableEntries.length === 0) {
    throw new Error("CODEX_THREAD_HISTORY_MISSING");
  }

  return {
    kind: "turns",
    value: turns,
    comparableEntries
  };
}

function isSyntheticCodexSessionTitle(title: string | null | undefined): boolean {
  const normalizedTitle = ensureText(title).trim();

  if (normalizedTitle.length === 0) {
    return false;
  }

  return (
    /^rollout-\d{4}-\d{2}-\d{2}t/i.test(normalizedTitle) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedTitle)
  );
}

function pickCodexHistoryArray(value: unknown): unknown[] | null {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  for (const key of ["history", "items"]) {
    const candidate = record[key];

    if (
      Array.isArray(candidate)
      && candidate.some((entry) => buildCodexThreadHistorySignature(entry) !== null)
    ) {
      return candidate;
    }
  }

  return null;
}

function pickCodexTurnArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function collectCodexTurnComparableEntries(
  value: unknown,
  turnIndex: number,
  parentPath: string[] = []
): Array<{
  signature: string;
  turnIndex: number;
  containerPath: string[];
  entryIndex: number;
}> {
  const record = toRecord(value);

  if (!record) {
    return [];
  }

  for (const key of ["history", "items"]) {
    const candidate = record[key];

    if (
      Array.isArray(candidate)
      && candidate.some((entry) => buildCodexThreadHistorySignature(entry) !== null)
    ) {
      const containerPath = [...parentPath, key];
      return candidate.flatMap((entry, entryIndex) => {
        const signature = buildCodexThreadHistorySignature(entry);
        return signature
          ? [{
              signature,
              turnIndex,
              containerPath,
              entryIndex
            }]
          : [];
      });
    }
  }

  return ([
    ["input", record.input],
    ["output", record.output],
    ["turn", record.turn],
    ["data", record.data],
    ["result", record.result]
  ] as Array<[string, unknown]>).flatMap(([key, candidate]) =>
    collectCodexTurnComparableEntries(candidate, turnIndex, [...parentPath, key])
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function truncateCodexThreadHistory(
  history: unknown[],
  parsedMessages: NormalizedMessage[],
  targetMessage: Pick<NormalizedMessage, "messageId" | "role" | "kind" | "content" | "sequence">
): unknown[] {
  const snapshot = normalizeCodexThreadHistorySnapshot(history);

  if (snapshot.kind === "entries") {
    const targetEntry = resolveCodexThreadHistoryTargetEntry(snapshot, parsedMessages, targetMessage);
    return snapshot.value.slice(0, targetEntry.entryIndex + 1);
  }

  const targetEntry = resolveCodexThreadHistoryTargetEntry(snapshot, parsedMessages, targetMessage);
  const truncatedTurns = snapshot.value.slice(0, targetEntry.turnIndex + 1);
  const lastTurn = truncatedTurns.at(-1);

  if (!lastTurn) {
    throw new Error("CODEX_FORK_SOURCE_MESSAGE_UNMAPPABLE");
  }

  return [
    ...flattenCodexTurnHistory(truncatedTurns.slice(0, -1)),
    ...collectCodexTurnHistoryItems(
      truncateCodexTurnAtPath(lastTurn, targetEntry.containerPath, targetEntry.entryIndex)
    )
  ];
}

function normalizeCodexThreadHistorySnapshot(history: unknown[]): CodexThreadHistorySnapshot {
  const directComparableEntries = history.flatMap((entry, entryIndex) => {
    const signature = buildCodexThreadHistorySignature(entry);
    return signature ? [{ signature, entryIndex }] : [];
  });

  if (directComparableEntries.length > 0) {
    return {
      kind: "entries",
      value: history,
      comparableEntries: directComparableEntries
    };
  }

  const turnComparableEntries = history.flatMap((turn, turnIndex) =>
    collectCodexTurnComparableEntries(turn, turnIndex)
  );

  if (turnComparableEntries.length > 0) {
    return {
      kind: "turns",
      value: history,
      comparableEntries: turnComparableEntries
    };
  }

  throw new Error("CODEX_THREAD_HISTORY_MISSING");
}

function resolveCodexThreadHistoryTargetEntry(
  snapshot: Extract<CodexThreadHistorySnapshot, { kind: "entries" }>,
  parsedMessages: NormalizedMessage[],
  targetMessage: Pick<NormalizedMessage, "messageId" | "role" | "kind" | "content" | "sequence">
): Extract<CodexThreadHistorySnapshot, { kind: "entries" }>["comparableEntries"][number];
function resolveCodexThreadHistoryTargetEntry(
  snapshot: Extract<CodexThreadHistorySnapshot, { kind: "turns" }>,
  parsedMessages: NormalizedMessage[],
  targetMessage: Pick<NormalizedMessage, "messageId" | "role" | "kind" | "content" | "sequence">
): Extract<CodexThreadHistorySnapshot, { kind: "turns" }>["comparableEntries"][number];
function resolveCodexThreadHistoryTargetEntry(
  snapshot: CodexThreadHistorySnapshot,
  parsedMessages: NormalizedMessage[],
  targetMessage: Pick<NormalizedMessage, "messageId" | "role" | "kind" | "content" | "sequence">
): CodexThreadHistorySnapshot["comparableEntries"][number] {
  const targetSignature = buildCodexThreadHistorySignature(targetMessage);

  if (!targetSignature) {
    throw new Error("CODEX_FORK_SOURCE_MESSAGE_UNMAPPABLE");
  }

  const matchingEntries = snapshot.comparableEntries.filter(
    (entry) => entry.signature === targetSignature
  );

  if (matchingEntries.length === 0) {
    throw new Error("CODEX_FORK_SOURCE_MESSAGE_UNMAPPABLE");
  }

  const targetOccurrence = resolveCodexMessageSignatureOccurrence(parsedMessages, targetMessage);
  return matchingEntries[Math.min(targetOccurrence, matchingEntries.length) - 1] ?? matchingEntries.at(-1)!;
}

function resolveCodexMessageSignatureOccurrence(
  parsedMessages: NormalizedMessage[],
  targetMessage: Pick<NormalizedMessage, "messageId" | "role" | "kind" | "content" | "sequence">
): number {
  const targetSignature = buildCodexThreadHistorySignature(targetMessage);

  if (!targetSignature) {
    return 1;
  }

  let occurrence = 0;

  for (const message of parsedMessages) {
    if (buildCodexThreadHistorySignature(message) !== targetSignature) {
      continue;
    }

    occurrence += 1;

    if (message.messageId === targetMessage.messageId) {
      return occurrence;
    }
  }

  return Math.max(1, occurrence);
}

function buildCodexTurnRollbackPlan(
  snapshot: Extract<CodexThreadHistorySnapshot, { kind: "turns" }>,
  parsedMessages: NormalizedMessage[],
  targetMessage: Pick<NormalizedMessage, "messageId" | "role" | "kind" | "content" | "sequence">
): {
  targetTurnIndex: number;
  numTurnsToRollback: number;
} {
  const targetEntry = resolveCodexThreadHistoryTargetEntry(snapshot, parsedMessages, targetMessage);
  const turnEntries = snapshot.comparableEntries.filter(
    (entry) => entry.turnIndex === targetEntry.turnIndex
  );
  const lastComparableEntryInTurn = turnEntries.at(-1) ?? null;

  if (!lastComparableEntryInTurn) {
    throw new Error("CODEX_FORK_SOURCE_MESSAGE_UNMAPPABLE");
  }

  if (
    lastComparableEntryInTurn.containerPath.join("/") !== targetEntry.containerPath.join("/")
    || lastComparableEntryInTurn.entryIndex !== targetEntry.entryIndex
  ) {
    throw new Error("CODEX_MESSAGE_FORK_TURN_BOUNDARY_REQUIRED");
  }

  return {
    targetTurnIndex: targetEntry.turnIndex,
    numTurnsToRollback: Math.max(0, snapshot.value.length - targetEntry.turnIndex - 1)
  };
}

function truncateCodexTurnAtPath(
  turn: unknown,
  containerPath: string[],
  entryIndex: number
): unknown {
  if (containerPath.length === 0) {
    return turn;
  }

  const record = toRecord(turn);

  if (!record) {
    return turn;
  }

  const [head, ...rest] = containerPath;
  const current = record[head];

  if (rest.length === 0) {
    if (!Array.isArray(current)) {
      return turn;
    }

    return {
      ...record,
      [head]: current.slice(0, entryIndex + 1)
    };
  }

  return {
    ...record,
    [head]: truncateCodexTurnAtPath(current, rest, entryIndex)
  };
}

function flattenCodexTurnHistory(turns: unknown[]): unknown[] {
  return turns.flatMap((turn) => collectCodexTurnHistoryItems(turn));
}

function collectCodexTurnHistoryItems(value: unknown): unknown[] {
  const direct = pickCodexHistoryArray(value);

  if (direct) {
    return direct;
  }

  const record = toRecord(value);

  if (!record) {
    return [];
  }

  return ([
    record.input,
    record.output,
    record.turn,
    record.data,
    record.result
  ] as unknown[]).flatMap((candidate) => collectCodexTurnHistoryItems(candidate));
}

function buildCodexThreadHistorySignature(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const normalizedKind = ensureText(item.kind).trim();
  const normalizedRole = ensureText(item.role).trim();
  const normalizedContent = ensureText(item.content).trim();

  if (normalizedKind && normalizedRole) {
    return `${normalizedRole}:${normalizedKind}:${normalizedContent}`;
  }

  const type = ensureText(item.type).trim();

  if (type === "userMessage") {
    const content = stringifyCodexThreadMessageContent(item.content);
    return content ? `user:text:${content}` : null;
  }

  if (type === "agentMessage") {
    const content = ensureText(item.text).trim() || stringifyCodexThreadMessageContent(item.content);
    return content ? `assistant:text:${content}` : null;
  }

  if (type === "message") {
    const role = ensureText(item.role).trim();
    const content = stringifyCodexThreadMessageContent(item.content);

    if (!role || !content) {
      return null;
    }

    return `${role}:text:${content}`;
  }

  if (type === "reasoning") {
    const content = stringifyCodexReasoningContent(item.summary ?? item.content);
    return content ? `assistant:thinking:${content}` : null;
  }

  if (type === "function_call" || type === "tool_call") {
    const name = ensureText(item.name).trim();
    const inputValue = item.arguments ?? item.input;
    const content = stringifyStructuredValue(inputValue);
    return name || content ? `assistant:tool_call:${name}:${content}` : null;
  }

  if (type === "function_call_output" || type === "tool_result") {
    const content = ensureText(item.output ?? item.content).trim();
    return content ? `tool:tool_result:${content}` : null;
  }

  if (normalizedRole && normalizedContent) {
    return `${normalizedRole}:text:${normalizedContent}`;
  }

  return null;
}

function applyForkSourceMessageSnapshot(
  targetMessage: NormalizedMessage,
  snapshot: ForkSessionOptions["sourceMessageSnapshot"]
): NormalizedMessage {
  if (!snapshot) {
    return targetMessage;
  }

  return {
    ...targetMessage,
    role: snapshot.role,
    kind: snapshot.kind,
    content: snapshot.content
  };
}

function collectCodexForkComparableSignatures(history: unknown[]): string[] {
  try {
    return normalizeCodexThreadHistorySnapshot(history).comparableEntries.map((entry) => entry.signature);
  } catch {
    return [];
  }
}

function stringifyCodexThreadMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      return ensureText(
        record.text
        ?? record.input_text
        ?? record.output_text
        ?? (ensureText(record.type).trim() === "text" ? record.text : null)
      ).trim();
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
}

function stringifyCodexReasoningContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      return ensureText(record.text ?? record.summary_text).trim();
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
}

function shouldFallbackCodexForkFromHistory(
  error: unknown,
  history: unknown[]
): boolean {
  if (history.length === 0) {
    return false;
  }

  return isCodexThreadLoadError(error);
}

function isCodexThreadLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();

  return (
    normalized.includes("thread not loaded") ||
    normalized.includes("no rollout found for thread id")
  );
}
