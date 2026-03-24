import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import crypto from "node:crypto";

import type {
  DetectSessionsOptions,
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderId,
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
  extractTextBlocks,
  ensureText,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath,
  readJsonLines,
  safeDate,
  sliceHistory,
  stringifyStructuredValue,
  walkJsonlFiles
} from "./utils.js";

interface CodexAdapterOptions {
  homeDir: string;
}

type CodexMessageSource = "event_msg" | "response_item";

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
  summary: ProviderSessionSummary | null;
}

interface CodexThreadMetadata {
  title: string | null;
  cwd: string | null;
  createdAtMs: number | null;
  firstUserMessage: string | null;
  agentNickname: string | null;
  agentRole: string | null;
}

interface CodexSpawnRelation {
  parentProviderSessionId: string;
}

interface CodexSpawnRecord {
  parentProviderSessionId: string;
  workspacePath: string | null;
  message: string;
  timestampMs: number | null;
}

const HISTORY_CACHE_LIMIT = 6;
const SESSION_SUMMARY_CACHE_LIMIT = 512;

export class CodexAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "codex";
  private readonly historyCache = new Map<string, CodexHistoryCacheEntry>();
  private readonly sessionSummaryCache = new Map<string, CodexSessionSummaryCacheEntry>();

  constructor(private readonly options: CodexAdapterOptions) {}

  async detectSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const files = this.listSessionFiles();
    const threadMetadataIndex = this.readThreadMetadataIndex();
    const spawnedAgentRelationIndex = this.readSpawnedAgentRelationIndex(
      files,
      targetPath,
      threadMetadataIndex
    );
    const knownSessions = (options?.knownSessions ?? []).filter(
      (session) => session.provider === this.providerId
    );
    const knownByRawStoreRef = new Map(
      knownSessions.map((session) => [session.rawStoreRef, session] as const)
    );
    const knownByProviderSessionId = new Map(
      knownSessions.map((session) => [session.providerSessionId, session] as const)
    );
    const sessionsByProviderSessionId = new Map<string, ProviderSessionSummary>();

    for (const filePath of files) {
      const stats = statSync(filePath);
      const cachedSummary = this.sessionSummaryCache.get(filePath);
      const fileSessionId = basename(filePath, ".jsonl");
      const sessionIdentity = this.readSessionIdentity(filePath, fileSessionId);
      const threadMetadata = sessionIdentity
        ? threadMetadataIndex.get(sessionIdentity.threadId)
        : null;
      const spawnRelation = sessionIdentity
        ? spawnedAgentRelationIndex.get(sessionIdentity.threadId)
        : null;

      if (
        cachedSummary
        && cachedSummary.mtimeMs === stats.mtimeMs
        && cachedSummary.size === stats.size
      ) {
        this.touchSessionSummaryCache(filePath, cachedSummary);

        if (
          cachedSummary.summary
          && hasUsableCodexTitle(cachedSummary.summary.title)
          && normalizeWorkspacePath(cachedSummary.summary.workspacePath) === targetPath
        ) {
          sessionsByProviderSessionId.set(cachedSummary.summary.providerSessionId, {
            ...cachedSummary.summary,
            rawStoreRef: filePath,
            parentProviderSessionId: spawnRelation?.parentProviderSessionId ?? null,
            isSubagent: isCodexSubagentThread(threadMetadata, spawnRelation),
            subagentLabel: buildCodexSubagentLabel(threadMetadata),
            sourceMtimeMs: stats.mtimeMs,
            sourceSizeBytes: stats.size
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
        && normalizeWorkspacePath(knownByPath.workspacePath) === targetPath
      ) {
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: knownByPath.workspacePath,
          summary: {
            ...knownByPath,
            rawStoreRef: filePath,
            parentProviderSessionId: spawnRelation?.parentProviderSessionId ?? null,
            isSubagent: isCodexSubagentThread(threadMetadata, spawnRelation),
            subagentLabel: buildCodexSubagentLabel(threadMetadata),
            sourceMtimeMs: stats.mtimeMs,
            sourceSizeBytes: stats.size
          }
        });
        sessionsByProviderSessionId.set(knownByPath.providerSessionId, {
          ...knownByPath,
          rawStoreRef: filePath,
          parentProviderSessionId: spawnRelation?.parentProviderSessionId ?? null,
          isSubagent: isCodexSubagentThread(threadMetadata, spawnRelation),
          subagentLabel: buildCodexSubagentLabel(threadMetadata),
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        });
        continue;
      }

      const records = readJsonLines(filePath).map((record) => record.data);
      const meta = records.find((record) => record.type === "session_meta");
      const metaPayload = (meta?.payload ?? {}) as Record<string, unknown>;

      if (shouldIgnoreCodingNsDraftSession(metaPayload)) {
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: null,
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
          summary: null
        });
        continue;
      }

      const codexSessionId = this.resolveCodexSessionId(metaPayload, fileSessionId);
      const currentThreadMetadata = threadMetadataIndex.get(codexSessionId) ?? threadMetadata;
      const currentSpawnRelation = spawnedAgentRelationIndex.get(codexSessionId) ?? spawnRelation;
      const knownBySessionId = knownByProviderSessionId.get(codexSessionId);

      if (
        knownBySessionId
        && knownBySessionId.sourceMtimeMs === stats.mtimeMs
        && knownBySessionId.sourceSizeBytes === stats.size
        && hasUsableCodexTitle(knownBySessionId.title)
      ) {
        this.touchSessionSummaryCache(filePath, {
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          workspacePath: sessionWorkspacePath,
          summary: {
            ...knownBySessionId,
            rawStoreRef: filePath,
            workspacePath: sessionWorkspacePath,
            parentProviderSessionId: currentSpawnRelation?.parentProviderSessionId ?? null,
            isSubagent: isCodexSubagentThread(currentThreadMetadata, currentSpawnRelation),
            subagentLabel: buildCodexSubagentLabel(currentThreadMetadata),
            sourceMtimeMs: stats.mtimeMs,
            sourceSizeBytes: stats.size
          }
        });
        sessionsByProviderSessionId.set(codexSessionId, {
          ...knownBySessionId,
          rawStoreRef: filePath,
          workspacePath: sessionWorkspacePath,
          parentProviderSessionId: currentSpawnRelation?.parentProviderSessionId ?? null,
          isSubagent: isCodexSubagentThread(currentThreadMetadata, currentSpawnRelation),
          subagentLabel: buildCodexSubagentLabel(currentThreadMetadata),
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        });
        continue;
      }

      const messages = this.parseMessages(filePath, records, codexSessionId);
      const title =
        this.resolveIndexedTitle(threadMetadataIndex, codexSessionId) ??
        resolveCodexFallbackTitle(messages) ??
        fileSessionId;
      const lastMessageAt =
        messages.at(-1)?.timestamp ?? (ensureText(metaPayload.timestamp) || null);

      sessionsByProviderSessionId.set(codexSessionId, {
        provider: this.providerId,
        providerSessionId: codexSessionId,
        title,
        workspacePath: sessionWorkspacePath,
        rawStoreRef: filePath,
        lastMessageAt,
        messageCount: messages.length,
        parentProviderSessionId: currentSpawnRelation?.parentProviderSessionId ?? null,
        isSubagent: isCodexSubagentThread(currentThreadMetadata, currentSpawnRelation),
        subagentLabel: buildCodexSubagentLabel(currentThreadMetadata),
        sourceMtimeMs: stats.mtimeMs,
        sourceSizeBytes: stats.size
      });
      this.touchSessionSummaryCache(filePath, {
        filePath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        workspacePath: sessionWorkspacePath,
        summary: sessionsByProviderSessionId.get(codexSessionId) ?? null
      });
    }

    return [...sessionsByProviderSessionId.values()].sort((left, right) =>
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
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const messages = this.getParsedMessages(resolvedStoreRef, providerSessionId);
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
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    let lastMtime = statSync(resolvedStoreRef).mtimeMs;

    const timer = setInterval(async () => {
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
        title: options.initialPrompt?.slice(0, 48) || "New Codex session",
        workspacePath,
        rawStoreRef: filePath,
        lastMessageAt: nextTimestamp(),
        messageCount: options.initialPrompt ? 1 : 0
      },
      initialCursor: encodeCursor(options.initialPrompt ? 1 : 0)
    };
  }

  async sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null
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
          readJsonLines(resolvedStoreRef).map((record) => record.data),
          providerSessionId
        ).length,
        rawRef
      }
    };
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
      let db: DatabaseSync | null = null;

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

  getProviderCapabilities(): ProviderCapabilities {
    return {
      provider: this.providerId,
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: false,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: ["当前实现只维护原生会话文件，不负责直接驱动 Codex CLI 进程执行。"]
    };
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  private readThreadMetadataIndex(): Map<string, CodexThreadMetadata> {
    const index = new Map<string, CodexThreadMetadata>();
    const indexPath = join(this.options.homeDir, "session_index.jsonl");

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
            agentRole: null
          });
        } catch {
          continue;
        }
      }
    }

    const stateDbPath = findLatestCodexStateDatabase(this.options.homeDir);

    if (!stateDbPath) {
      return index;
    }

    let db: DatabaseSync | null = null;

    try {
      db = new DatabaseSync(stateDbPath, { open: true, readOnly: true });
      const rows = db.prepare(
        `SELECT
           id,
           title,
           cwd,
           created_at,
           first_user_message,
           agent_nickname,
           agent_role
         FROM threads`
      ).all() as Array<{
        id?: unknown;
        title?: unknown;
        cwd?: unknown;
        created_at?: unknown;
        first_user_message?: unknown;
        agent_nickname?: unknown;
        agent_role?: unknown;
      }>;

      for (const row of rows) {
        const id = ensureText(row.id).trim();

        if (id.length === 0) {
          continue;
        }

        const current = index.get(id);
        const createdAtSeconds =
          typeof row.created_at === "number"
            ? row.created_at
            : Number.parseInt(ensureText(row.created_at), 10);

        index.set(id, {
          title: normalizeCodexIndexedTitle(ensureText(row.title)) || (current?.title ?? null),
          cwd: ensureText(row.cwd).trim() || (current?.cwd ?? null),
          createdAtMs: Number.isFinite(createdAtSeconds) ? createdAtSeconds * 1000 : null,
          firstUserMessage:
            ensureText(row.first_user_message).trim() || (current?.firstUserMessage ?? null),
          agentNickname:
            ensureText(row.agent_nickname).trim() || (current?.agentNickname ?? null),
          agentRole: ensureText(row.agent_role).trim() || (current?.agentRole ?? null)
        });
      }
    } catch {
      return index;
    } finally {
      db?.close();
    }

    return index;
  }

  private listSessionFiles(): string[] {
    const activeFiles = walkJsonlFiles(join(this.options.homeDir, "sessions"));
    const archivedFiles = walkJsonlFiles(join(this.options.homeDir, "archived_sessions"));
    return [...activeFiles, ...archivedFiles];
  }

  private resolveSessionFilePath(rawStoreRef: string, providerSessionId: string): string {
    if (existsSync(rawStoreRef)) {
      return rawStoreRef;
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

    const matchedByThreadId = this.findSessionFileByThreadId(providerSessionId);

    if (matchedByThreadId) {
      return matchedByThreadId;
    }

    return rawStoreRef;
  }

  private findSessionFileByThreadId(providerSessionId: string): string | null {
    for (const filePath of this.listSessionFiles()) {
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

    const firstLine = readFileSync(filePath, "utf8")
      .split(/\r?\n/, 1)
      .at(0)
      ?.trim();

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

    if (indexedTitle) {
      return indexedTitle;
    }

    return normalizeCodexMessageTitle(metadata?.firstUserMessage);
  }

  private readSpawnedAgentRelationIndex(
    files: string[],
    targetPath: string,
    threadMetadataIndex: Map<string, CodexThreadMetadata>
  ): Map<string, CodexSpawnRelation> {
    const directRelations = new Map<string, CodexSpawnRelation>();
    const spawnRecords: CodexSpawnRecord[] = [];

    for (const filePath of files) {
      const sessionIdentity = this.readSessionIdentity(filePath, basename(filePath, ".jsonl"));

      if (!sessionIdentity) {
        continue;
      }

      if (normalizeWorkspacePath(sessionIdentity.cwd) !== targetPath) {
        continue;
      }

      const records = readJsonLines(filePath).map((record) => record.data);
      const spawnCallById = new Map<string, CodexSpawnRecord>();

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

        directRelations.set(agentId, {
          parentProviderSessionId: spawnRecord.parentProviderSessionId
        });
      }
    }

    for (const [threadId, metadata] of threadMetadataIndex.entries()) {
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
  ): { threadId: string; cwd: string } | null {
    if (!existsSync(filePath)) {
      return null;
    }

    const firstLine = readFileSync(filePath, "utf8")
      .split(/\r?\n/, 1)
      .at(0)
      ?.trim();

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
        cwd: ensureText(payload.cwd).trim()
      };
    } catch {
      return null;
    }
  }

  private parseMessages(
    filePath: string,
    records: Array<Record<string, unknown>>,
    providerSessionId: string
  ): NormalizedMessage[] {
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

    records.forEach((record, index) => {
      const lineNumber = index + 1;
      const rawRef = createRawRef(this.providerId, filePath, lineNumber);

      if (record.type === "event_msg") {
        const payload = (record.payload ?? {}) as Record<string, unknown>;
        const eventType = ensureText(payload.type);

        if (eventType === "user_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: messageIdFromRawRef(rawRef),
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
              messageId: messageIdFromRawRef(rawRef),
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
              messageId: messageIdFromRawRef(rawRef),
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
            messageId: messageIdFromRawRef(rawRef),
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
            messageId: messageIdFromRawRef(rawRef),
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
            messageId: messageIdFromRawRef(rawRef),
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
          messageId: messageIdFromRawRef(rawRef),
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
  return normalized ? normalized.slice(0, 48) : null;
}
