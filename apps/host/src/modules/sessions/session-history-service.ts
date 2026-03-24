import type Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  CapabilityService,
  ClaudeCodeAdapter,
  CodexAdapter,
  ProviderRegistry,
  SessionSyncService,
  type HistoryDirection,
  type HistoryPage,
  type ProviderCapabilities,
  type ProviderSubscription,
  type SendMessageResult
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { logPerformance } from "../../shared/utils/perf-log.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  SessionBinding,
  SessionListItem,
  SessionStateRecord,
  SessionStatusSnapshot
} from "../../types/domain.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import { inspectSessionActivity } from "./session-activity-inspector.js";
import { mapSessionProviderError } from "./session-provider-error-mapper.js";

interface StartSessionInput {
  workspaceId: string;
  userId: string;
  provider: string;
  initialPrompt?: string;
}

export interface SessionHistoryEnvelope {
  type: "session.backfill" | "session.delta";
  sessionId: string;
  cursor: string | null;
  messages: HistoryPage["messages"];
}

interface SessionRelationDescriptor {
  parentSessionId: string | null;
  isSubagent: boolean;
  subagentLabel: string | null;
}

export class SessionHistoryService {
  private readonly providerRegistry: ProviderRegistry;
  private readonly sessionSyncService: SessionSyncService;
  private readonly capabilityService: CapabilityService;
  private readonly workspaceDiscoveryTimestamps = new Map<string, number>();
  private readonly workspaceDiscoveryInflight = new Map<string, Promise<SessionListItem[]>>();
  private readonly workspaceSessionRelations = new Map<
    string,
    Map<string, SessionRelationDescriptor>
  >();

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly sessionBindingRepository: SessionBindingRepository,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly sessionStatusSnapshotRepository: SessionStatusSnapshotRepository,
    config: HostConfig
  ) {
    this.providerRegistry = new ProviderRegistry([
      new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
      new CodexAdapter({ homeDir: config.codexHomeDir })
    ]);
    this.sessionSyncService = new SessionSyncService(this.providerRegistry);
    this.capabilityService = new CapabilityService(this.providerRegistry);
  }

  async discoverWorkspaceSessions(
    workspaceId: string,
    userId: string,
    options?: {
      maxAgeMs?: number;
      force?: boolean;
    }
  ): Promise<SessionListItem[]> {
    const maxAgeMs = options?.maxAgeMs ?? 0;
    const force = options?.force ?? false;
    const lastRefreshedAt = this.workspaceDiscoveryTimestamps.get(workspaceId) ?? 0;

    if (!force && maxAgeMs > 0 && Date.now() - lastRefreshedAt <= maxAgeMs) {
      return this.listWorkspaceSessions(workspaceId, userId);
    }

    const inflight = this.workspaceDiscoveryInflight.get(workspaceId);

    if (inflight) {
      return inflight;
    }

    const task = this.runDiscoverWorkspaceSessions(workspaceId, userId).finally(() => {
      this.workspaceDiscoveryInflight.delete(workspaceId);
    });

    this.workspaceDiscoveryInflight.set(workspaceId, task);
    return task;
  }

  async readSessionHistory(
    sessionId: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward",
    userId?: string
  ): Promise<HistoryPage> {
    const startedAt = Date.now();
    const binding = this.getBindingOrThrow(sessionId);
    const current = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);
    const safeLimit = clampLimit(limit);
    let readDurationMs = 0;
    let refreshStateDurationMs = 0;

    this.upsertSnapshot(sessionId, {
      syncStatus: "syncing",
      syncCursor: current?.syncCursor ?? cursor,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: current?.resumedAt ?? null
    });

    try {
      const readStartedAt = Date.now();
      const page = await this.readPage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        safeLimit,
        direction
      );
      readDurationMs = Date.now() - readStartedAt;

      this.upsertSnapshot(sessionId, {
        syncStatus: "idle",
        syncCursor:
          direction === "backward" && cursor !== null
            ? current?.syncCursor ?? page.cursor
            : page.cursor,
        lastSyncAt: nowIso(),
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: current?.resumedAt ?? null
      });

      logPerformance(
        "session.read_history",
        Date.now() - startedAt,
        {
          sessionId,
          provider: binding.provider,
          direction,
          limit: safeLimit,
          hasCursor: cursor !== null,
          messageCount: page.messages.length,
          total: page.total,
          readMs: readDurationMs,
          refreshStateMs: refreshStateDurationMs
        },
        {
          thresholdMs: 300
        }
      );

      return page;
    } catch (error) {
      logPerformance(
        "session.read_history.failed",
        Date.now() - startedAt,
        {
          sessionId,
          provider: binding.provider,
          direction,
          limit: safeLimit,
          hasCursor: cursor !== null,
          readMs: readDurationMs,
          refreshStateMs: refreshStateDurationMs,
          error: error instanceof Error ? error.message : "unknown"
        },
        {
          thresholdMs: 0,
          force: true
        }
      );
      this.markSessionError(sessionId, "PROVIDER_READ_FAILED", error);
      throw mapSessionProviderError(error);
    }
  }

  async findLatestUserMessage(
    sessionId: string,
    content: string,
    maxAttempts = 12
  ): Promise<SendMessageResult["message"] | null> {
    const binding = this.getBindingOrThrow(sessionId);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const page = await this.readPage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        null,
        30,
        "backward"
      );
      const matched = [...page.messages]
        .reverse()
        .find((message) => message.role === "user" && message.content === content);

      if (matched) {
        return matched;
      }

      if (attempt < maxAttempts - 1) {
        await delay(100);
      }
    }

    return null;
  }

  getSession(sessionId: string, userId: string): SessionListItem {
    return this.enrichSessionItem(this.getSessionListItemOrThrow(sessionId, userId));
  }

  listWorkspaceSessions(workspaceId: string, userId: string): SessionListItem[] {
    return this.enrichSessionItems(
      workspaceId,
      this.sessionIndexRepository.listByWorkspace(workspaceId, userId)
    );
  }

  getProviderCapabilities(provider: string): ProviderCapabilities {
    try {
      return this.capabilityService.getProviderCapabilities(provider);
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  async getSessionCapabilities(sessionId: string): Promise<ProviderCapabilities> {
    const binding = this.getBindingOrThrow(sessionId);

    return this.capabilityService
      .getSessionCapabilities(binding.provider, binding.providerSessionId)
      .catch((error) => {
        throw mapSessionProviderError(error);
      });
  }

  async resumeSession(sessionId: string): Promise<{
    sessionId: string;
    provider: string;
    providerSessionId: string;
    resumedAt: string;
  }> {
    const binding = this.getBindingOrThrow(sessionId);

    try {
      const result = await this.sessionSyncService.resumeSession(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef
      );

      this.upsertSnapshot(sessionId, {
        syncStatus: "idle",
        syncCursor:
          this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
        lastSyncAt: result.resumedAt,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: result.resumedAt
      });

      return {
        sessionId,
        provider: result.provider,
        providerSessionId: result.providerSessionId,
        resumedAt: result.resumedAt
      };
    } catch (error) {
      this.markSessionError(sessionId, "RESUME_FAILED", error);
      throw mapSessionProviderError(error);
    }
  }

  async startSession(input: StartSessionInput): Promise<SessionListItem> {
    const workspace = this.getWorkspaceOrThrow(input.workspaceId);

    if (input.provider === "codex" || input.provider === "claude-code") {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_START_DEFERRED",
        detail: "当前 provider 仅支持在首条消息发送时通过 start-live 创建原生会话",
        field: "provider"
      });
    }

    try {
      const result = await this.sessionSyncService.startSession(input.provider, workspace.path, {
        initialPrompt: input.initialPrompt
      });
      const sessionId = createId();
      const timestamp = nowIso();

      const persist = this.db.transaction(() => {
        this.sessionBindingRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          providerSessionId: result.session.providerSessionId,
          rawStoreRef: result.session.rawStoreRef,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionIndexRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          title: result.session.title,
          messageCount: result.session.messageCount,
          lastMessageAt: result.session.lastMessageAt,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionStatusSnapshotRepository.upsert({
          sessionId,
          syncStatus: "idle",
          syncCursor: result.initialCursor,
          lastSyncAt: timestamp,
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          updatedAt: timestamp
        });
        this.sessionStateRepository.upsert({
          sessionId,
          userId: input.userId,
          runningState: "idle",
          lastEventAt: result.session.lastMessageAt,
          completedAt: null,
          lastSeenAt: null,
          updatedAt: timestamp
        });
      });

      persist();
      return this.getSessionListItemOrThrow(sessionId, input.userId);
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  async sendMessage(
    sessionId: string,
    content: string,
    clientRequestId: string | null
  ): Promise<SendMessageResult & { sessionId: string }> {
    const binding = this.getBindingOrThrow(sessionId);
    const result = await this.sessionSyncService
      .sendMessage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        content,
        clientRequestId
      )
      .catch((error) => {
        this.markSessionError(sessionId, "SEND_FAILED", error);
        throw mapSessionProviderError(error);
      });

    const existing = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

    this.sessionIndexRepository.upsert({
      sessionId,
      workspaceId: binding.workspaceId,
      provider: binding.provider,
      title: existing?.title ?? result.message.content.slice(0, 48),
      messageCount: (existing?.messageCount ?? 0) + 1,
      lastMessageAt: result.message.timestamp,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: result.message.timestamp
    });
    this.upsertSnapshot(sessionId, {
      syncStatus: "idle",
      syncCursor:
        this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
      lastSyncAt: result.acceptedAt,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
    });

    return {
      sessionId,
      ...result
    };
  }

  async subscribeSession(
    sessionId: string,
    cursor: string | null,
    limit: number,
    onEnvelope: (envelope: SessionHistoryEnvelope) => Promise<void> | void
  ): Promise<ProviderSubscription> {
    const sentMessageIds = new Set<string>();
    const safeLimit = clampLimit(limit);
    let currentCursor = cursor;
    const current = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);
    let closed = false;
    let polling = false;

    this.upsertSnapshot(sessionId, {
      syncStatus: "syncing",
      syncCursor: current?.syncCursor ?? cursor,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: current?.resumedAt ?? null
    });

    try {
      await this.pullSessionHistory(sessionId, currentCursor, safeLimit, sentMessageIds, onEnvelope, "session.backfill")
        .then((nextCursor) => {
          currentCursor = nextCursor;
        });
    } catch (error) {
      this.markSessionError(sessionId, "SUBSCRIBE_FAILED", error);
      throw mapSessionProviderError(error);
    }

    const timer = setInterval(() => {
      if (closed || polling) {
        return;
      }

      polling = true;
      void this.pullSessionHistory(
        sessionId,
        currentCursor,
        safeLimit,
        sentMessageIds,
        onEnvelope,
        "session.delta",
        () => closed
      )
        .then((nextCursor) => {
          currentCursor = nextCursor;
        })
        .catch((error) => {
          this.markSessionError(sessionId, "SUBSCRIBE_FAILED", error);
        })
        .finally(() => {
          polling = false;
        });
    }, 300);

    return {
      close() {
        closed = true;
        clearInterval(timer);
      }
    };
  }

  async markSessionSeen(sessionId: string, userId: string): Promise<void> {
    const existing =
      this.sessionStateRepository.findBySessionAndUser(sessionId, userId) ??
      (await this.refreshSessionState(sessionId, userId));
    const seenAt = nowIso();

    this.sessionStateRepository.upsert({
      sessionId,
      userId,
      runningState: existing?.runningState ?? "idle",
      lastEventAt: existing?.lastEventAt ?? null,
      completedAt: existing?.completedAt ?? null,
      lastSeenAt: seenAt,
      updatedAt: seenAt
    });
  }

  getBindingOrThrow(sessionId: string): SessionBinding {
    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

    if (!binding) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SESSION_NOT_FOUND",
        detail: "session 不存在"
      });
    }

    return binding;
  }

  persistSessionBinding(
    sessionId: string,
    workspaceId: string,
    snapshot: { provider: string; providerSessionId: string | null; rawStoreRef: string | null }
  ): void {
    if (!snapshot.providerSessionId || !snapshot.rawStoreRef) {
      return;
    }

    const currentBinding = this.sessionBindingRepository.findBySessionId(sessionId);
    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);
    const timestamp = nowIso();

    this.sessionBindingRepository.upsert({
      sessionId,
      workspaceId,
      provider: snapshot.provider as "claude-code" | "codex",
      providerSessionId: snapshot.providerSessionId,
      rawStoreRef: snapshot.rawStoreRef,
      createdAt: currentBinding?.createdAt ?? timestamp,
      updatedAt: timestamp
    });

    if (currentIndex) {
      this.sessionIndexRepository.upsert({
        ...currentIndex,
        updatedAt: timestamp
      });
    }
  }

  private async runDiscoverWorkspaceSessions(
    workspaceId: string,
    userId: string
  ): Promise<SessionListItem[]> {
    const startedAt = Date.now();
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    let discoverDurationMs = 0;
    let persistDurationMs = 0;
    let refreshStateDurationMs = 0;

    try {
      const discoverStartedAt = Date.now();
      const knownSessions = this.buildKnownSessionSummaries(
        this.sessionIndexRepository.listByWorkspace(workspaceId, userId),
        workspace.path
      );
      const sessions = await this.sessionSyncService
        .discoverWorkspaceSessions(workspace.path, {
          knownSessions
        })
        .catch((error) => {
          throw mapSessionProviderError(error);
        });
      discoverDurationMs = Date.now() - discoverStartedAt;
      const timestamp = nowIso();
      const discoveredSessionIds = new Map<string, string>();

      const persist = this.db.transaction(() => {
        for (const session of sessions) {
          const existing =
            this.sessionBindingRepository.findByProviderSession(
              session.provider,
              session.providerSessionId
            ) ?? this.sessionBindingRepository.findByRawStoreRef(session.provider, session.rawStoreRef);
          const currentSnapshot = existing
            ? this.sessionStatusSnapshotRepository.findBySessionId(existing.sessionId)
            : null;
          const sessionId = existing?.sessionId ?? createId();
          const createdAt = existing?.createdAt ?? timestamp;

          this.sessionBindingRepository.upsert({
            sessionId,
            workspaceId: workspace.id,
            provider: session.provider,
            providerSessionId: session.providerSessionId,
            rawStoreRef: session.rawStoreRef,
            createdAt,
            updatedAt: timestamp
          });
          this.sessionIndexRepository.upsert({
            sessionId,
            workspaceId: workspace.id,
            provider: session.provider,
            title: session.title,
            messageCount: session.messageCount,
            lastMessageAt: session.lastMessageAt,
            createdAt,
            updatedAt: timestamp
          });
          this.sessionStatusSnapshotRepository.upsert({
            sessionId,
            syncStatus: currentSnapshot?.syncStatus ?? "idle",
            syncCursor: currentSnapshot?.syncCursor ?? null,
            lastSyncAt: currentSnapshot?.lastSyncAt ?? null,
            lastErrorCode: currentSnapshot?.lastErrorCode ?? null,
            lastErrorDetail: currentSnapshot?.lastErrorDetail ?? null,
            resumedAt: currentSnapshot?.resumedAt ?? null,
            updatedAt: timestamp
          });
          discoveredSessionIds.set(
            buildProviderSessionKey(session.provider, session.providerSessionId),
            sessionId
          );
        }
      });

      const persistStartedAt = Date.now();
      persist();
      persistDurationMs = Date.now() - persistStartedAt;
      this.cleanupLegacyCodexDraftSessions(workspaceId, userId, sessions);
      this.workspaceSessionRelations.set(
        workspaceId,
        this.buildWorkspaceSessionRelationMap(sessions, discoveredSessionIds)
      );

      const items = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);
      const refreshStateStartedAt = Date.now();
      await this.refreshRecentSessionStates(items.slice(0, 10), userId);
      refreshStateDurationMs = Date.now() - refreshStateStartedAt;
      this.workspaceDiscoveryTimestamps.set(workspaceId, Date.now());
      const nextItems = this.listWorkspaceSessions(workspaceId, userId);

      logPerformance(
        "workspace.discover_sessions",
        Date.now() - startedAt,
        {
          workspaceId,
          workspacePath: workspace.path,
          knownSessions: knownSessions.length,
          discoveredSessions: sessions.length,
          returnedSessions: nextItems.length,
          refreshedStates: Math.min(items.length, 10),
          discoverMs: discoverDurationMs,
          persistMs: persistDurationMs,
          refreshStateMs: refreshStateDurationMs
        },
        {
          thresholdMs: 500
        }
      );

      return nextItems;
    } catch (error) {
      logPerformance(
        "workspace.discover_sessions.failed",
        Date.now() - startedAt,
        {
          workspaceId,
          workspacePath: workspace.path,
          discoverMs: discoverDurationMs,
          persistMs: persistDurationMs,
          refreshStateMs: refreshStateDurationMs,
          error: error instanceof Error ? error.message : "unknown"
        },
        {
          thresholdMs: 0,
          force: true
        }
      );
      throw error;
    }
  }

  private async readPage(
    provider: string,
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    if (shouldShortCircuitMissingSyntheticCodexHistory(provider, rawStoreRef)) {
      return {
        messages: [],
        cursor,
        nextCursor: null,
        total: 0
      };
    }

    return this.sessionSyncService
      .readHistory(provider, providerSessionId, rawStoreRef, cursor, limit, direction)
      .catch((error) => {
        if (shouldTreatMissingSyntheticHistoryAsEmpty(provider, rawStoreRef, error)) {
          return {
            messages: [],
            cursor,
            nextCursor: null,
            total: 0
          };
        }

        throw mapSessionProviderError(error);
      });
  }

  private buildWorkspaceSessionRelationMap(
    sessions: Array<{
      provider: string;
      providerSessionId: string;
      parentProviderSessionId?: string | null;
      isSubagent?: boolean;
      subagentLabel?: string | null;
    }>,
    discoveredSessionIds: Map<string, string>
  ): Map<string, SessionRelationDescriptor> {
    const relationMap = new Map<string, SessionRelationDescriptor>();

    for (const session of sessions) {
      const sessionId = discoveredSessionIds.get(
        buildProviderSessionKey(session.provider, session.providerSessionId)
      );

      if (!sessionId) {
        continue;
      }

      const parentSessionId = session.parentProviderSessionId
        ? discoveredSessionIds.get(
            buildProviderSessionKey(session.provider, session.parentProviderSessionId)
          ) ??
          this.sessionBindingRepository.findByProviderSession(
            session.provider,
            session.parentProviderSessionId
          )?.sessionId ??
          null
        : null;

      relationMap.set(sessionId, {
        parentSessionId,
        isSubagent: Boolean(session.isSubagent || parentSessionId),
        subagentLabel: session.subagentLabel?.trim() || null
      });
    }

    return relationMap;
  }

  private enrichSessionItems(workspaceId: string, items: SessionListItem[]): SessionListItem[] {
    const relationMap = this.workspaceSessionRelations.get(workspaceId);

    if (!relationMap) {
      return items.map((item) => this.enrichSessionItem(item));
    }

    return items.map((item) => {
      const relation = relationMap.get(item.sessionId);

      if (!relation) {
        return this.enrichSessionItem(item);
      }

      return {
        ...item,
        parentSessionId: relation.parentSessionId,
        isSubagent: relation.isSubagent,
        subagentLabel: relation.subagentLabel
      };
    });
  }

  private enrichSessionItem(item: SessionListItem): SessionListItem {
    const relation = this.workspaceSessionRelations.get(item.workspaceId)?.get(item.sessionId);

    if (!relation) {
      return {
        ...item,
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null
      };
    }

    return {
      ...item,
      parentSessionId: relation.parentSessionId,
      isSubagent: relation.isSubagent,
      subagentLabel: relation.subagentLabel
    };
  }

  private async pullSessionHistory(
    sessionId: string,
    cursor: string | null,
    limit: number,
    sentMessageIds: Set<string>,
    onEnvelope: (envelope: SessionHistoryEnvelope) => Promise<void> | void,
    envelopeType: SessionHistoryEnvelope["type"],
    isClosed: () => boolean = () => false
  ): Promise<string | null> {
    let currentCursor = cursor;

    while (!isClosed()) {
      const binding = this.getBindingOrThrow(sessionId);
      const page = await this.readPage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        currentCursor,
        limit
      );
      const messages = page.messages.filter((message) => {
        if (sentMessageIds.has(message.messageId)) {
          return false;
        }

        sentMessageIds.add(message.messageId);
        return true;
      });

      if (messages.length > 0) {
        this.upsertSnapshot(sessionId, {
          syncStatus: "idle",
          syncCursor: page.cursor,
          lastSyncAt: nowIso(),
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt:
            this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
        });

        await onEnvelope({
          type: envelopeType,
          sessionId,
          cursor: page.cursor,
          messages
        });
      }

      currentCursor = page.cursor;

      if (!page.nextCursor) {
        return currentCursor;
      }
    }

    return currentCursor;
  }

  private getWorkspaceOrThrow(workspaceId: string) {
    const workspace = this.workspaceRepository.findById(workspaceId);

    if (!workspace) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "工作区不存在"
      });
    }

    return workspace;
  }

  private getSessionListItemOrThrow(sessionId: string, userId: string): SessionListItem {
    const item = this.sessionIndexRepository.findBySessionId(sessionId, userId);

    if (!item) {
      throw new AppError({
        statusCode: 500,
        errorCode: "SESSION_INDEX_MISSING",
        detail: "session 索引缺失"
      });
    }

    return item;
  }

  private async refreshRecentSessionStates(
    sessions: SessionListItem[],
    userId: string
  ): Promise<void> {
    await Promise.all(sessions.map((session) => this.refreshSessionState(session.sessionId, userId)));
  }

  private cleanupLegacyCodexDraftSessions(
    workspaceId: string,
    userId: string,
    sessions: Array<{
      provider: string;
      providerSessionId: string;
      rawStoreRef: string;
    }>
  ): void {
    const discoveredProviderSessionIds = new Set(
      sessions
        .filter((session) => session.provider === "codex")
        .map((session) => session.providerSessionId)
    );
    const discoveredRawStoreRefs = new Set(
      sessions
        .filter((session) => session.provider === "codex")
        .map((session) => session.rawStoreRef)
    );
    const staleDrafts = this.sessionIndexRepository
      .listByWorkspace(workspaceId, userId)
      .filter(
        (session) =>
          session.provider === "codex" &&
          !discoveredProviderSessionIds.has(session.providerSessionId) &&
          !discoveredRawStoreRefs.has(session.rawStoreRef) &&
          isLegacyCodingNsRolloutSession(session.providerSessionId, session.rawStoreRef)
      );

    if (staleDrafts.length === 0) {
      return;
    }

    const remove = this.db.transaction((sessionIds: string[]) => {
      for (const sessionId of sessionIds) {
        this.db
          .prepare("DELETE FROM session_file_context_bindings WHERE session_id = ?")
          .run(sessionId);
        this.db
          .prepare("DELETE FROM session_states WHERE session_id = ?")
          .run(sessionId);
        this.db
          .prepare("DELETE FROM session_status_snapshots WHERE session_id = ?")
          .run(sessionId);
        this.db
          .prepare("DELETE FROM session_indices WHERE session_id = ?")
          .run(sessionId);
        this.db
          .prepare("DELETE FROM session_bindings WHERE session_id = ?")
          .run(sessionId);
      }
    });

    remove(staleDrafts.map((session) => session.sessionId));
  }

  private buildKnownSessionSummaries(
    sessions: SessionListItem[],
    workspacePath: string
  ) {
    return sessions.flatMap((session) => {
      const stats = safeStat(session.rawStoreRef);

      if (!stats) {
        return [];
      }

      return [
        {
          provider: session.provider,
          providerSessionId: session.providerSessionId,
          title: session.title,
          workspacePath,
          rawStoreRef: session.rawStoreRef,
          lastMessageAt: session.lastMessageAt,
          messageCount: session.messageCount,
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        }
      ];
    });
  }

  private async refreshSessionState(
    sessionId: string,
    userId: string
  ): Promise<SessionStateRecord | null> {
    const binding = this.getBindingOrThrow(sessionId);
    const current = this.sessionStateRepository.findBySessionAndUser(sessionId, userId);
    const inspection = inspectSessionActivity(binding.provider, binding.rawStoreRef);
    const timestamp = nowIso();
    const completedAt =
      current?.runningState === "running" &&
      inspection.runningState === "idle" &&
      !inspection.hasPendingTools
        ? inspection.completedAtCandidate ?? inspection.lastEventAt ?? current?.completedAt ?? null
        : current?.completedAt ?? null;

    const nextRecord: SessionStateRecord = {
      sessionId,
      userId,
      runningState: inspection.runningState,
      lastEventAt: inspection.lastEventAt,
      completedAt,
      lastSeenAt: current?.lastSeenAt ?? null,
      updatedAt: timestamp
    };

    this.sessionStateRepository.upsert(nextRecord);
    return nextRecord;
  }

  private upsertSnapshot(
    sessionId: string,
    input: Omit<SessionStatusSnapshot, "sessionId" | "updatedAt">
  ): void {
    this.sessionStatusSnapshotRepository.upsert({
      sessionId,
      ...input,
      updatedAt: nowIso()
    });
  }

  private markSessionError(sessionId: string, errorCode: string, error: unknown): void {
    const current = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);

    this.sessionStatusSnapshotRepository.upsert({
      sessionId,
      syncStatus: "error",
      syncCursor: current?.syncCursor ?? null,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: errorCode,
      lastErrorDetail: error instanceof Error ? error.message : "unknown",
      resumedAt: current?.resumedAt ?? null,
      updatedAt: nowIso()
    });
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

function buildProviderSessionKey(provider: string, providerSessionId: string): string {
  return `${provider}::${providerSessionId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeStat(filePath: string): { mtimeMs: number; size: number } | null {
  try {
    const stats = statSync(filePath);
    return {
      mtimeMs: stats.mtimeMs,
      size: stats.size
    };
  } catch {
    return null;
  }
}

function shouldTreatMissingSyntheticHistoryAsEmpty(
  provider: string,
  rawStoreRef: string,
  error: unknown
): boolean {
  if (provider !== "codex") {
    return false;
  }

  if (!isSyntheticCodexRawStoreRef(rawStoreRef)) {
    return false;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes("ENOENT");
}

function shouldShortCircuitMissingSyntheticCodexHistory(
  provider: string,
  rawStoreRef: string
): boolean {
  return provider === "codex" && isSyntheticCodexRawStoreRef(rawStoreRef) && !existsSync(rawStoreRef);
}

function isSyntheticCodexRawStoreRef(rawStoreRef: string): boolean {
  const normalizedRawStoreRef = rawStoreRef.replaceAll("\\", "/").toLowerCase();

  return (
    normalizedRawStoreRef.includes("/runtime/codex/") ||
    normalizedRawStoreRef.startsWith("runtime/codex/")
  );
}

function isLegacyCodingNsRolloutSession(providerSessionId: string, rawStoreRef: string): boolean {
  if (!providerSessionId.startsWith("rollout-")) {
    return false;
  }

  if (!existsSync(rawStoreRef)) {
    return false;
  }

  try {
    const firstLine = readFileSync(rawStoreRef, "utf8")
      .split(/\r?\n/, 1)
      .at(0)
      ?.trim();

    if (!firstLine) {
      return false;
    }

    const record = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: {
        source?: unknown;
      };
    };

    return record.type === "session_meta" && record.payload?.source === "codingns";
  } catch {
    return false;
  }
}
