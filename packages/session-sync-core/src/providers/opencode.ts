import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  DetectSessionsOptions,
  HistoryDirection,
  HistoryPage,
  InRunInputMode,
  NormalizedMessage,
  ProviderAdapter,
  ProviderArchiveUpdateResult,
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
  ensureText,
  nextTimestamp,
  normalizeWorkspacePath,
  sliceHistory
} from "./utils.js";
import {
  buildMessageRawRef,
  buildSessionRawStoreRef,
  firstValidNumber,
  normalizeOpenCodeMessageEnvelopes,
  parseSessionIdFromRawStoreRef,
  readInteger,
  toIsoTimestamp,
  toJsonRecord,
  type OpenCodeMessageEnvelope,
  type OpenCodeServerSession,
  type OpenCodeSessionMetadataRecord,
  workspaceMatches
} from "./opencode-shared.js";

const DEFAULT_DATA_DIR = join(homedir(), ".local", "share", "opencode");
const DEFAULT_BASE_URL = process.env.CODINGNS_OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 800;
const MIN_POLL_INTERVAL_MS = 200;
const DEFAULT_SERVER_PAGE_LIMIT = 100;

interface OpenCodeAdapterOptions {
  baseUrl?: string;
  baseUrlResolver?: (input?: { refresh?: boolean }) => Promise<string> | string;
  dataDir?: string;
  dbPath?: string;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
}

interface SessionSummaryRow {
  id?: unknown;
  parent_id?: unknown;
  directory?: unknown;
  title?: unknown;
  time_created?: unknown;
  time_updated?: unknown;
  time_archived?: unknown;
  message_count?: unknown;
  last_message_time_ms?: unknown;
}

interface SessionMetadataRow {
  id?: unknown;
  parent_id?: unknown;
  time_archived?: unknown;
  message_count?: unknown;
}

interface SessionTitleRow {
  title?: unknown;
}

interface SessionExistsRow {
  session_exists?: unknown;
}

interface PartHistoryRow {
  part_id?: unknown;
  message_id?: unknown;
  part_time_created?: unknown;
  part_data?: unknown;
  message_time_created?: unknown;
  message_data?: unknown;
}

interface SessionPageResponse<T> {
  data: T;
  headers: Headers;
}

export class OpenCodeAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "opencode";

  constructor(private readonly options: OpenCodeAdapterOptions = {}) {}

  async detectSessions(
    workspacePath: string,
    _options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const serverSessions = await this.tryDetectSessionsFromServer(targetPath);

    if (serverSessions) {
      return serverSessions;
    }

    const rows = this.withReadonlyDb((db) => {
      return db.prepare(
        `SELECT
           s.id AS id,
           s.parent_id AS parent_id,
           s.directory AS directory,
           s.title AS title,
           s.time_created AS time_created,
           s.time_updated AS time_updated,
           s.time_archived AS time_archived,
           COALESCE(stats.message_count, 0) AS message_count,
           stats.last_message_time_ms AS last_message_time_ms
         FROM session s
         LEFT JOIN (
           SELECT
             session_id,
             COUNT(*) AS message_count,
             MAX(COALESCE(time_updated, time_created)) AS last_message_time_ms
           FROM message
           GROUP BY session_id
         ) AS stats
           ON stats.session_id = s.id`
      ).all() as SessionSummaryRow[];
    });

    return rows
      .map((row) => this.normalizeSqliteSessionSummaryRow(row))
      .filter((summary): summary is ProviderSessionSummary => summary !== null)
      .filter((summary) => workspaceMatches(targetPath, normalizeWorkspacePath(summary.workspacePath)))
      .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
  }

  async readRecentSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    _totalMessageCount: number,
    limit: number
  ): Promise<HistoryPage | null> {
    return this.readSessionHistory(providerSessionId, rawStoreRef, null, limit, "backward");
  }

  async readSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    const sessionId = this.resolveSessionId(providerSessionId, rawStoreRef);
    const serverMessages = await this.tryReadSessionMessagesFromServer(sessionId);
    const messages = serverMessages ?? this.readSessionMessagesFromSqlite(sessionId);
    return sliceHistory(messages, cursor, limit, direction);
  }

  subscribeSession(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription {
    const sessionId = this.resolveSessionId(providerSessionId, rawStoreRef);
    const pollIntervalMs = this.resolvePollIntervalMs();
    const normalizedRawStoreRef = buildSessionRawStoreRef(sessionId);
    let currentCursor = cursor;
    let closed = false;
    let inFlight = false;

    const timer = setInterval(() => {
      if (closed || inFlight) {
        return;
      }

      inFlight = true;

      void this.readSessionHistory(
        sessionId,
        normalizedRawStoreRef,
        currentCursor,
        limit,
        "forward"
      )
        .then(async (page) => {
          if (page.messages.length === 0) {
            return;
          }

          currentCursor = page.cursor;
          await onEvent({
            messages: page.messages,
            cursor: page.cursor
          });
        })
        .catch(() => {
          return;
        })
        .finally(() => {
          inFlight = false;
        });
    }, pollIntervalMs);

    return {
      close() {
        closed = true;
        clearInterval(timer);
      }
    };
  }

  async resumeSession(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ResumeSessionResult> {
    const sessionId = this.resolveSessionId(providerSessionId, rawStoreRef);

    if (!(await this.tryAssertSessionExistsOnServer(sessionId))) {
      this.assertSessionExistsOnSqlite(sessionId);
    }

    return {
      provider: this.providerId,
      providerSessionId: sessionId,
      resumedAt: nextTimestamp(),
      rawStoreRef: buildSessionRawStoreRef(sessionId)
    };
  }

  async startSession(
    workspacePath: string,
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    const session = await this.createSessionOnServer(workspacePath);

    if (options.initialPrompt?.trim()) {
      await this.postTextPrompt(session.id, options.initialPrompt.trim());
    }

    const summary = await this.readSessionSummaryFromServer(session.id)
      .catch(() => null);
    const sessionSummary = summary ?? this.normalizeServerSessionSummary(session, new Map()) ?? {
      provider: this.providerId,
      providerSessionId: session.id,
      title: ensureText(session.title).trim() || session.id,
      workspacePath,
      rawStoreRef: buildSessionRawStoreRef(session.id),
      isArchived: false,
      lastMessageAt: nextTimestamp(),
      messageCount: options.initialPrompt?.trim() ? 1 : 0,
      parentProviderSessionId: null,
      isSubagent: false,
      subagentLabel: null
    };

    return {
      session: sessionSummary,
      initialCursor: null
    };
  }

  async sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null
  ): Promise<SendMessageResult> {
    const sessionId = this.resolveSessionId(providerSessionId, rawStoreRef);
    const trimmed = content.trim();

    if (!trimmed) {
      throw new Error("INVALID_INPUT");
    }

    const acceptedAt = nextTimestamp();

    await this.postTextPrompt(sessionId, trimmed);

    const message = await this.findAcceptedUserMessage(sessionId, trimmed)
      ?? buildSyntheticAcceptedMessage(sessionId, trimmed, acceptedAt);

    return {
      acceptedAt,
      clientRequestId,
      message
    };
  }

  async readSessionTitle(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<string> {
    const sessionId = this.resolveSessionId(providerSessionId, rawStoreRef);
    const serverTitle = await this.tryReadSessionTitleFromServer(sessionId);

    if (serverTitle) {
      return serverTitle;
    }

    const row = this.withReadonlyDb((db) => {
      return db.prepare(
        `SELECT title FROM session WHERE id = ? LIMIT 1`
      ).get(sessionId) as SessionTitleRow | undefined;
    });

    if (!row) {
      throw new Error("PROVIDER_SESSION_NOT_FOUND");
    }

    const title = ensureText(row.title).trim();
    return title || sessionId;
  }

  async renameSessionTitle(
    providerSessionId: string,
    rawStoreRef: string,
    title: string
  ): Promise<string> {
    const sessionId = this.resolveSessionId(providerSessionId, rawStoreRef);
    const nextTitle = title.trim();

    if (!nextTitle) {
      throw new Error("INVALID_INPUT");
    }

    const response = await this.fetchJson<OpenCodeServerSession>(
      `/session/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: nextTitle
        })
      }
    );

    return ensureText(response.data.title).trim() || nextTitle;
  }

  async updateSessionArchiveState(
    _providerSessionId: string,
    _rawStoreRef: string,
    _isArchived: boolean
  ): Promise<ProviderArchiveUpdateResult> {
    throw new Error("OPENCODE_ARCHIVE_NOT_SUPPORTED");
  }

  getProviderCapabilities(): ProviderCapabilities {
    return {
      provider: this.providerId,
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none" satisfies InRunInputMode,
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      supportsTodo: true,
      supportsSessionDiff: true,
      supportsPermissionRequests: true,
      supportsSessionFork: true,
      supportsSessionShare: true,
      supportsAsyncPrompt: true,
      supportsNativeAgents: true,
      limitations: [
        "当前 OpenCode 先以 server 为主链路；server 不可达时只对历史读取做 sqlite 只读兜底。",
        "附件上传、权限回复和分享管理还没有接到当前 UI。"
      ]
    };
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  private async tryDetectSessionsFromServer(
    targetPath: string
  ): Promise<ProviderSessionSummary[] | null> {
    try {
      const response = await this.fetchJson<OpenCodeServerSession[]>("/session", {
        query: {
          directory: targetPath || undefined,
          roots: "true"
        }
      });
      const ids = response.data
        .map((session) => ensureText(session.id).trim())
        .filter((value) => value.length > 0);
      const metadata = this.readSessionMetadata(ids);

      return response.data
        .map((session) => this.normalizeServerSessionSummary(session, metadata))
        .filter((summary): summary is ProviderSessionSummary => summary !== null)
        .filter((summary) => workspaceMatches(targetPath, normalizeWorkspacePath(summary.workspacePath)))
        .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
    } catch (error) {
      if (isServerUnavailableError(error)) {
        return null;
      }

      throw error;
    }
  }

  private async tryReadSessionMessagesFromServer(
    sessionId: string
  ): Promise<NormalizedMessage[] | null> {
    try {
      return await this.readSessionMessagesFromServer(sessionId);
    } catch (error) {
      if (isServerUnavailableError(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readSessionMessagesFromServer(sessionId: string): Promise<NormalizedMessage[]> {
    const envelopes: OpenCodeMessageEnvelope[] = [];
    let before: string | null = null;

    while (true) {
      const response: SessionPageResponse<OpenCodeMessageEnvelope[]> = await this.fetchJson(
        `/session/${encodeURIComponent(sessionId)}/message`,
        {
          query: {
            limit: String(DEFAULT_SERVER_PAGE_LIMIT),
            before: before ?? undefined
          }
        }
      );

      envelopes.push(...response.data);

      const nextCursor: string | null = response.headers.get("x-next-cursor");

      if (!nextCursor) {
        break;
      }

      before = nextCursor;
    }

    return normalizeOpenCodeMessageEnvelopes(
      sessionId,
      sessionId,
      envelopes
    );
  }

  private async createSessionOnServer(workspacePath: string): Promise<{ id: string; title?: unknown }> {
    const response = await this.fetchJson<OpenCodeServerSession>("/session", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      query: {
        directory: workspacePath
      },
      body: JSON.stringify({})
    });
    const sessionId = ensureText(response.data.id).trim();

    if (!sessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    return {
      id: sessionId,
      title: response.data.title
    };
  }

  private async postTextPrompt(sessionId: string, text: string): Promise<void> {
    await this.fetchJson(
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          parts: [
            {
              type: "text",
              text
            }
          ]
        })
      }
    );
  }

  private async findAcceptedUserMessage(
    sessionId: string,
    content: string
  ): Promise<NormalizedMessage | null> {
    try {
      const response = await this.fetchJson<OpenCodeMessageEnvelope[]>(
        `/session/${encodeURIComponent(sessionId)}/message`,
        {
          query: {
            limit: "20"
          }
        }
      );
      const messages = normalizeOpenCodeMessageEnvelopes(
        sessionId,
        sessionId,
        response.data.reverse()
      );
      const trimmed = content.trim();

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];

        if (
          message?.role === "user"
          && message.content.trim() === trimmed
        ) {
          return message;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async readSessionSummaryFromServer(
    sessionId: string
  ): Promise<ProviderSessionSummary | null> {
    const response = await this.fetchJson<OpenCodeServerSession>(
      `/session/${encodeURIComponent(sessionId)}`
    );
    const metadata = this.readSessionMetadata([sessionId]);

    return this.normalizeServerSessionSummary(response.data, metadata);
  }

  private async tryReadSessionTitleFromServer(sessionId: string): Promise<string | null> {
    try {
      const response = await this.fetchJson<OpenCodeServerSession>(
        `/session/${encodeURIComponent(sessionId)}`
      );
      const title = ensureText(response.data.title).trim();
      return title || sessionId;
    } catch (error) {
      if (isServerUnavailableError(error)) {
        return null;
      }

      throw error;
    }
  }

  private async tryAssertSessionExistsOnServer(sessionId: string): Promise<boolean> {
    try {
      await this.fetchJson(`/session/${encodeURIComponent(sessionId)}`);
      return true;
    } catch (error) {
      if (isServerUnavailableError(error)) {
        return false;
      }

      if (error instanceof Error && error.message === "PROVIDER_SESSION_NOT_FOUND") {
        throw error;
      }

      throw error;
    }
  }

  private async resolveBaseUrl(refresh = false): Promise<string> {
    const resolved = this.options.baseUrlResolver
      ? await this.options.baseUrlResolver({ refresh })
      : (this.options.baseUrl?.trim() || DEFAULT_BASE_URL);

    return resolved.trim().replace(/\/+$/, "");
  }

  private resolveDbPath(): string {
    const configuredPath = this.options.dbPath?.trim();

    if (configuredPath) {
      return configuredPath;
    }

    const dataDir = this.options.dataDir?.trim() || DEFAULT_DATA_DIR;
    return join(dataDir, "opencode.db");
  }

  private resolvePollIntervalMs(): number {
    const configured = this.options.pollIntervalMs;

    if (!Number.isFinite(configured)) {
      return DEFAULT_POLL_INTERVAL_MS;
    }

    return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(configured as number));
  }

  private resolveRequestTimeoutMs(): number {
    const configured = this.options.requestTimeoutMs;

    if (!Number.isFinite(configured)) {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }

    return Math.max(1_000, Math.floor(configured as number));
  }

  private async fetchJson<T = unknown>(
    pathname: string,
    input: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      query?: Record<string, string | undefined>;
    } = {}
  ): Promise<SessionPageResponse<T>> {
    return this.fetchJsonWithRetry(pathname, input, false);
  }

  private async fetchJsonWithRetry<T = unknown>(
    pathname: string,
    input: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      query?: Record<string, string | undefined>;
    },
    refresh: boolean
  ): Promise<SessionPageResponse<T>> {
    const url = new URL(pathname, `${await this.resolveBaseUrl(refresh)}/`);

    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.resolveRequestTimeoutMs());

    let response: Response;

    try {
      response = await fetch(url, {
        method: input.method ?? "GET",
        headers: input.headers,
        body: input.body,
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof Error && error.name === "AbortError") {
        if (!refresh && this.options.baseUrlResolver) {
          return this.fetchJsonWithRetry(pathname, input, true);
        }

        throw new Error("SERVER_UNAVAILABLE");
      }

      if (!refresh && this.options.baseUrlResolver) {
        return this.fetchJsonWithRetry(pathname, input, true);
      }

      throw new Error("SERVER_UNAVAILABLE");
    }

    clearTimeout(timer);

    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      const mapped = mapOpenCodeHttpError(response.status, detail);

      if (!refresh && isServerUnavailableError(mapped) && this.options.baseUrlResolver) {
        return this.fetchJsonWithRetry(pathname, input, true);
      }

      throw mapped;
    }

    const text = await response.text();

    return {
      data: text.length > 0 ? (JSON.parse(text) as T) : (undefined as T),
      headers: response.headers
    };
  }

  private withReadonlyDb<T>(run: (db: DatabaseSync) => T): T {
    const dbPath = this.resolveDbPath();

    if (!existsSync(dbPath)) {
      throw new Error("OPENCODE_DB_NOT_FOUND");
    }

    let db: DatabaseSync | null = null;

    try {
      db = new DatabaseSync(dbPath, { open: true, readOnly: true });
      return run(db);
    } finally {
      db?.close();
    }
  }

  private resolveSessionId(providerSessionId: string, rawStoreRef: string): string {
    const explicit = providerSessionId.trim();

    if (explicit.length > 0) {
      return explicit;
    }

    const parsed = parseSessionIdFromRawStoreRef(rawStoreRef);

    if (parsed) {
      return parsed;
    }

    throw new Error("PROVIDER_SESSION_ID_REQUIRED");
  }

  private assertSessionExistsOnSqlite(sessionId: string): void {
    const row = this.withReadonlyDb((db) => {
      return db.prepare(
        `SELECT EXISTS(SELECT 1 FROM session WHERE id = ?) AS session_exists`
      ).get(sessionId) as SessionExistsRow | undefined;
    });
    const exists = readInteger(row?.session_exists);

    if (exists !== 1) {
      throw new Error("PROVIDER_SESSION_NOT_FOUND");
    }
  }

  private normalizeSqliteSessionSummaryRow(row: SessionSummaryRow): ProviderSessionSummary | null {
    const sessionId = ensureText(row.id).trim();

    if (!sessionId) {
      return null;
    }

    const workspacePath = ensureText(row.directory).trim();
    const summaryUpdatedAtMs = firstValidNumber(
      row.last_message_time_ms,
      row.time_updated,
      row.time_created
    );
    const lastMessageAt = toIsoTimestamp(summaryUpdatedAtMs, null);
    const title = ensureText(row.title).trim() || sessionId;
    const parentProviderSessionId = ensureText(row.parent_id).trim() || null;
    const isArchived = row.time_archived !== null && row.time_archived !== undefined;

    return {
      provider: this.providerId,
      providerSessionId: sessionId,
      title,
      workspacePath,
      rawStoreRef: buildSessionRawStoreRef(sessionId),
      isArchived,
      lastMessageAt,
      messageCount: Math.max(0, readInteger(row.message_count) ?? 0),
      parentProviderSessionId,
      isSubagent: Boolean(parentProviderSessionId),
      subagentLabel: null
    };
  }

  private normalizeServerSessionSummary(
    session: OpenCodeServerSession,
    metadataById: Map<string, OpenCodeSessionMetadataRecord>
  ): ProviderSessionSummary | null {
    const sessionId = ensureText(session.id).trim();

    if (!sessionId) {
      return null;
    }

    const metadata = metadataById.get(sessionId);
    const time = toJsonRecord(session.time);
    const summaryUpdatedAtMs = firstValidNumber(time?.updated, time?.created);
    const parentProviderSessionId =
      ensureText(session.parentID).trim()
      || ensureText(session.parent_id).trim()
      || metadata?.parentProviderSessionId
      || null;
    const workspacePath = ensureText(session.directory).trim();

    return {
      provider: this.providerId,
      providerSessionId: sessionId,
      title: ensureText(session.title).trim() || sessionId,
      workspacePath,
      rawStoreRef: buildSessionRawStoreRef(sessionId),
      isArchived: metadata?.isArchived ?? false,
      lastMessageAt: toIsoTimestamp(summaryUpdatedAtMs, null),
      messageCount: metadata?.messageCount ?? 0,
      parentProviderSessionId,
      isSubagent: Boolean(parentProviderSessionId),
      subagentLabel: null
    };
  }

  private readSessionMetadata(
    sessionIds: string[]
  ): Map<string, OpenCodeSessionMetadataRecord> {
    if (sessionIds.length === 0 || !existsSync(this.resolveDbPath())) {
      return new Map();
    }

    return this.withReadonlyDb((db) => {
      const placeholders = sessionIds.map(() => "?").join(", ");
      const rows = db.prepare(
        `SELECT
           s.id AS id,
           s.parent_id AS parent_id,
           s.time_archived AS time_archived,
           COALESCE(stats.message_count, 0) AS message_count
         FROM session s
         LEFT JOIN (
           SELECT session_id, COUNT(*) AS message_count
           FROM message
           GROUP BY session_id
         ) AS stats
           ON stats.session_id = s.id
         WHERE s.id IN (${placeholders})`
      ).all(...sessionIds) as SessionMetadataRow[];

      return new Map(
        rows
          .map((row) => {
            const sessionId = ensureText(row.id).trim();

            if (!sessionId) {
              return null;
            }

            return [
              sessionId,
              {
                parentProviderSessionId: ensureText(row.parent_id).trim() || null,
                isArchived: row.time_archived !== null && row.time_archived !== undefined,
                messageCount: Math.max(0, readInteger(row.message_count) ?? 0)
              } satisfies OpenCodeSessionMetadataRecord
            ] as const;
          })
          .filter((entry): entry is readonly [string, OpenCodeSessionMetadataRecord] => entry !== null)
      );
    });
  }

  private readSessionMessagesFromSqlite(sessionId: string): NormalizedMessage[] {
    this.assertSessionExistsOnSqlite(sessionId);

    const rows = this.withReadonlyDb((db) => {
      return db.prepare(
        `SELECT
           p.id AS part_id,
           p.message_id AS message_id,
           p.time_created AS part_time_created,
           p.data AS part_data,
           m.time_created AS message_time_created,
           m.data AS message_data
         FROM part p
         INNER JOIN message m
           ON m.id = p.message_id
         WHERE p.session_id = ?
         ORDER BY p.time_created ASC, p.rowid ASC`
      ).all(sessionId) as PartHistoryRow[];
    });

    const envelopes = rows.reduce<Map<string, OpenCodeMessageEnvelope>>((map, row) => {
      const messageId = ensureText(row.message_id).trim();
      const partId = ensureText(row.part_id).trim();
      const messagePayload = toJsonRecord(row.message_data);
      const partPayload = toJsonRecord(row.part_data);

      if (!messageId || !partId || !messagePayload || !partPayload) {
        return map;
      }

      const existing = map.get(messageId) ?? {
        info: {
          ...messagePayload,
          id: messageId,
          sessionID: sessionId,
          time: {
            ...(toJsonRecord(messagePayload.time) ?? {}),
            created: firstValidNumber(row.message_time_created) ?? undefined
          }
        },
        parts: []
      };

      const parts = Array.isArray(existing.parts) ? existing.parts : [];
      parts.push({
        ...partPayload,
        id: partId,
        sessionID: sessionId,
        messageID: messageId
      });
      existing.parts = parts;
      map.set(messageId, existing);
      return map;
    }, new Map());

    return normalizeOpenCodeMessageEnvelopes(
      sessionId,
      sessionId,
      [...envelopes.values()]
    );
  }
}

function buildSyntheticAcceptedMessage(
  sessionId: string,
  content: string,
  timestamp: string
): NormalizedMessage {
  const rawRef = `${buildMessageRawRef(sessionId, `accepted-${Date.parse(timestamp)}`)}#synthetic`;

  return {
    messageId: `opencode-accepted-${Date.parse(timestamp)}`,
    provider: "opencode",
    providerSessionId: sessionId,
    role: "user",
    kind: "text",
    content,
    toolCall: null,
    timestamp,
    sequence: 1,
    rawRef
  };
}

function mapOpenCodeHttpError(statusCode: number, detail: string): Error {
  if (statusCode === 404) {
    return new Error("PROVIDER_SESSION_NOT_FOUND");
  }

  if (statusCode >= 500) {
    return new Error("SERVER_UNAVAILABLE");
  }

  if (statusCode === 409 && /active|running|busy/i.test(detail)) {
    return new Error("ACTIVE_RUN_EXISTS");
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

function isServerUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === "SERVER_UNAVAILABLE";
}
