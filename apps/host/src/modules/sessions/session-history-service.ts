import type Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  CapabilityService,
  ClaudeCodeAdapter,
  type ContextUsageSnapshot,
  CodexAdapter,
  OpenCodeAdapter,
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
  SessionChangedFileRecord,
  SessionIndexRecord,
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
import { SessionChangedFileService } from "./session-changed-file-service.js";
import { SessionMessageAttachmentService } from "./session-message-attachment-service.js";
import { mapSessionProviderError } from "./session-provider-error-mapper.js";
import { enrichClaudeCapabilities } from "../provider/claude-model-options.js";
import {
  CodexModelOptionsService,
  enrichCodexCapabilities
} from "../provider/codex-model-options.js";

interface StartSessionInput {
  workspaceId: string;
  userId: string;
  provider: string;
  initialPrompt?: string;
}

interface ArchiveSessionInput {
  sessionId: string;
  userId: string;
  isArchived: boolean;
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

interface PersistedSessionDescriptor {
  session: Awaited<
    ReturnType<SessionSyncService["discoverWorkspaceSessions"]>
  >[number];
  sessionId: string;
  createdAt: string;
  existingIndex: SessionIndexRecord | null;
}

export class SessionHistoryService {
  private readonly providerRegistry: ProviderRegistry;
  private readonly sessionSyncService: SessionSyncService;
  private readonly capabilityService: CapabilityService;
  private readonly claudeCodeHomeDir: string;
  private readonly codexModelOptionsService: CodexModelOptionsService;
  private readonly workspaceDiscoveryTimestamps = new Map<string, number>();
  private readonly workspaceDiscoveryInflight = new Map<string, Promise<SessionListItem[]>>();
  private readonly workspaceStateRefreshInflight = new Map<string, Promise<void>>();
  private readonly workspaceSessionRelations = new Map<
    string,
    Map<string, SessionRelationDescriptor>
  >();

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly sessionBindingRepository: SessionBindingRepository,
    private readonly sessionChangedFileService: SessionChangedFileService,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionMessageAttachmentService: SessionMessageAttachmentService,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly sessionStatusSnapshotRepository: SessionStatusSnapshotRepository,
    config: HostConfig
  ) {
    this.claudeCodeHomeDir = config.claudeCodeHomeDir;
    this.providerRegistry = new ProviderRegistry([
      new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
      new CodexAdapter({ homeDir: config.codexHomeDir }),
      new OpenCodeAdapter({
        baseUrl: config.opencodeBaseUrl,
        dataDir: config.opencodeDataDir,
        dbPath: config.opencodeDbPath
      })
    ]);
    this.sessionSyncService = new SessionSyncService(this.providerRegistry);
    this.capabilityService = new CapabilityService(this.providerRegistry);
    this.codexModelOptionsService = new CodexModelOptionsService({
      commandPath: config.codexCliPath
    });
  }

  async discoverWorkspaceSessions(
    workspaceId: string,
    userId: string,
    options?: {
      maxAgeMs?: number;
      force?: boolean;
      refreshStateMode?: "inline" | "deferred";
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

    const task = this.runDiscoverWorkspaceSessions(
      workspaceId,
      userId,
      options?.refreshStateMode ?? "inline"
    ).finally(() => {
      this.workspaceDiscoveryInflight.delete(workspaceId);
    });

    this.workspaceDiscoveryInflight.set(workspaceId, task);
    return task;
  }

  needsWorkspaceDiscovery(workspaceId: string, maxAgeMs: number): boolean {
    if (maxAgeMs <= 0) {
      return true;
    }

    const lastRefreshedAt = this.workspaceDiscoveryTimestamps.get(workspaceId) ?? 0;
    return Date.now() - lastRefreshedAt > maxAgeMs;
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
    const knownTotalMessageCount =
      direction === "backward" && cursor === null
        ? this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.messageCount ?? null
        : null;
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
        sessionId,
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        safeLimit,
        direction,
        knownTotalMessageCount
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
    content: string | string[],
    maxAttempts = 12,
    minTimestamp: string | null = null
  ): Promise<SendMessageResult["message"] | null> {
    const binding = this.getBindingOrThrow(sessionId);
    const acceptedContents = new Set(
      (Array.isArray(content) ? content : [content]).filter((value) => value.trim().length > 0)
    );

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const knownTotalMessageCount =
        this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.messageCount ?? null;
      const page = await this.readPage(
        sessionId,
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        null,
        30,
        "backward",
        knownTotalMessageCount
      );
      const matched = [...page.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "user" &&
            acceptedContents.has(message.content) &&
            isMessageAtOrAfter(message.timestamp, minTimestamp)
        );

      if (matched) {
        return matched;
      }

      if (attempt < maxAttempts - 1) {
        await delay(100);
      }
    }

    return null;
  }

  readSessionAttachment(
    sessionId: string,
    attachmentId: string
  ): {
    attachment: import("@codingns/session-sync-core").NormalizedMessageAttachment;
    fileName: string;
    mimeType: string;
    content: Buffer;
  } | null {
    return this.sessionMessageAttachmentService.readAttachmentContent(sessionId, attachmentId);
  }

  getSession(sessionId: string, userId: string): SessionListItem {
    return this.enrichSessionItem(this.getSessionListItemOrThrow(sessionId, userId));
  }

  async refreshRuntimeFallbackSession(sessionId: string, userId: string): Promise<SessionListItem> {
    await this.refreshSessionState(sessionId, userId);
    return this.enrichSessionItem(this.getSessionListItemOrThrow(sessionId, userId));
  }

  async syncSessionTitle(sessionId: string): Promise<void> {
    const binding = this.getBindingOrThrow(sessionId);
    await this.syncSessionTitleFromProvider(sessionId, binding);
  }

  async syncWorkspaceSessionTitles(workspaceId: string, userId: string): Promise<void> {
    const sessions = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);

    for (const session of sessions) {
      await this.syncSessionTitle(session.sessionId).catch(() => {
        return;
      });
    }
  }

  async listSessionChangedFiles(
    sessionId: string,
    userId: string
  ): Promise<SessionChangedFileRecord[]> {
    this.getSession(sessionId, userId);

    await this.ensureSessionChangedFilesIndexed(sessionId);

    return this.sessionChangedFileService.listBySessionId(sessionId);
  }

  listWorkspaceSessions(workspaceId: string, userId: string): SessionListItem[] {
    return this.enrichSessionItems(
      workspaceId,
      this.sessionIndexRepository.listByWorkspace(workspaceId, userId)
    );
  }

  getProviderCapabilitiesSnapshot(provider: string): ProviderCapabilities {
    try {
      return this.capabilityService.getProviderCapabilities(provider);
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  async getProviderCapabilities(
    provider: string,
    workspaceId?: string | null
  ): Promise<ProviderCapabilities> {
    try {
      const workspacePath = workspaceId ? this.getWorkspaceOrThrow(workspaceId).path : null;

      return await this.enrichProviderCapabilities(
        this.capabilityService.getProviderCapabilities(provider),
        workspacePath
      );
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  async getSessionCapabilities(sessionId: string): Promise<ProviderCapabilities> {
    const binding = this.getBindingOrThrow(sessionId);
    const workspace = this.getWorkspaceOrThrow(binding.workspaceId);

    return this.capabilityService
      .getSessionCapabilities(binding.provider, binding.providerSessionId)
      .then((capabilities) => this.enrichProviderCapabilities(capabilities, workspace.path))
      .catch((error) => {
        throw mapSessionProviderError(error);
      });
  }

  private async enrichProviderCapabilities(
    capabilities: ProviderCapabilities,
    workspacePath: string | null
  ): Promise<ProviderCapabilities> {
    const claudeEnriched = enrichClaudeCapabilities(capabilities, {
      claudeHomeDir: this.claudeCodeHomeDir,
      workspacePath
    });

    return enrichCodexCapabilities(claudeEnriched, this.codexModelOptionsService);
  }

  async getSessionContextUsage(sessionId: string): Promise<ContextUsageSnapshot | null> {
    const binding = this.getBindingOrThrow(sessionId);

    try {
      return await this.sessionSyncService.readContextUsage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef
      );
    } catch (error) {
      throw mapSessionProviderError(error);
    }
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

    if (input.provider === "codex" || input.provider === "claude-code" || input.provider === "opencode") {
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
          parentSessionId: result.session.parentProviderSessionId ?? null,
          isSubagent: result.session.isSubagent ?? false,
          subagentLabel: result.session.subagentLabel ?? null,
          title: result.session.title,
          messageCount: result.session.messageCount,
          isArchived: false,
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
          activitySource: "none",
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
      parentSessionId: existing?.parentSessionId ?? null,
      isSubagent: existing?.isSubagent ?? false,
      subagentLabel: existing?.subagentLabel ?? null,
      title: existing?.title ?? result.message.content.slice(0, 48),
      messageCount: (existing?.messageCount ?? 0) + 1,
      isArchived: existing?.isArchived ?? false,
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
      activitySource: existing?.activitySource ?? "none",
      lastEventAt: existing?.lastEventAt ?? null,
      completedAt: existing?.completedAt ?? null,
      lastSeenAt: seenAt,
      updatedAt: seenAt
    });
  }

  async updateSessionArchiveState(input: ArchiveSessionInput): Promise<SessionListItem> {
    const binding = this.getBindingOrThrow(input.sessionId);
    const existing = this.getSessionListItemOrThrow(input.sessionId, input.userId);
    const timestamp = nowIso();
    let nextRawStoreRef = binding.rawStoreRef;
    let nextArchivedState = input.isArchived;

    if (binding.provider === "codex") {
      const result = await this.sessionSyncService
        .updateSessionArchiveState(
          binding.provider,
          binding.providerSessionId,
          binding.rawStoreRef,
          input.isArchived
        )
        .catch((error) => {
          throw mapSessionProviderError(error);
        });

      this.sessionBindingRepository.upsert({
        ...binding,
        rawStoreRef: result.rawStoreRef,
        updatedAt: timestamp
      });
      nextRawStoreRef = result.rawStoreRef;
      nextArchivedState = result.isArchived;
    }

    this.sessionIndexRepository.upsert({
      sessionId: input.sessionId,
      workspaceId: existing.workspaceId,
      provider: existing.provider,
      parentSessionId: existing.parentSessionId ?? null,
      isSubagent: existing.isSubagent ?? false,
      subagentLabel: existing.subagentLabel ?? null,
      title: existing.title,
      messageCount: existing.messageCount,
      isArchived: nextArchivedState,
      lastMessageAt: existing.lastMessageAt,
      createdAt: existing.createdAt,
      updatedAt: timestamp
    });

    return this.enrichSessionItem({
      ...this.getSessionListItemOrThrow(input.sessionId, input.userId),
      rawStoreRef: nextRawStoreRef,
      isArchived: nextArchivedState
    });
  }

  async renameSessionTitle(
    sessionId: string,
    userId: string,
    title: string
  ): Promise<SessionListItem> {
    const binding = this.getBindingOrThrow(sessionId);
    const existing = this.getSessionListItemOrThrow(sessionId, userId);
    const nextTitle = title.trim();
    const timestamp = nowIso();

    try {
      await this.sessionSyncService.renameSessionTitle(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        nextTitle
      );
    } catch (error) {
      throw mapSessionProviderError(error);
    }

    this.sessionIndexRepository.renameTitle(sessionId, nextTitle, timestamp);

    return this.enrichSessionItem({
      ...existing,
      title: nextTitle,
      updatedAt: timestamp
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
      provider: snapshot.provider,
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
    userId: string,
    refreshStateMode: "inline" | "deferred" = "inline"
  ): Promise<SessionListItem[]> {
    const startedAt = Date.now();
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    let discoverDurationMs = 0;
    let persistDurationMs = 0;
    const refreshStateCount = 10;

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
      const persistedSessions: PersistedSessionDescriptor[] = [];

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
          const existingIndex = existing
            ? this.sessionIndexRepository.findIndexRecordBySessionId(existing.sessionId)
            : null;

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
            isArchived: session.isArchived ?? existingIndex?.isArchived ?? false,
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
          persistedSessions.push({
            session,
            sessionId,
            createdAt,
            existingIndex
          });
        }

        const relationMap = this.buildWorkspaceSessionRelationMap(sessions, discoveredSessionIds);

        for (const persistedSession of persistedSessions) {
          const relation = relationMap.get(persistedSession.sessionId);

          this.sessionIndexRepository.upsert({
            sessionId: persistedSession.sessionId,
            workspaceId: workspace.id,
            provider: persistedSession.session.provider,
            parentSessionId: relation?.parentSessionId ?? null,
            isSubagent: relation?.isSubagent ?? false,
            subagentLabel: relation?.subagentLabel ?? null,
            title: persistedSession.session.title,
            messageCount: persistedSession.session.messageCount,
            isArchived:
              persistedSession.session.isArchived ??
              persistedSession.existingIndex?.isArchived ??
              false,
            lastMessageAt: persistedSession.session.lastMessageAt,
            createdAt: persistedSession.createdAt,
            updatedAt: timestamp
          });
        }
      });

      const persistStartedAt = Date.now();
      persist();
      persistDurationMs = Date.now() - persistStartedAt;
      this.cleanupStaleHiddenSessions(workspaceId, userId, sessions);
      this.workspaceSessionRelations.set(
        workspaceId,
        this.buildWorkspaceSessionRelationMap(sessions, discoveredSessionIds)
      );

      const items = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);
      const recentItems = items.slice(0, refreshStateCount);
      this.workspaceDiscoveryTimestamps.set(workspaceId, Date.now());

      if (refreshStateMode === "inline") {
        await this.refreshRecentSessionStates(recentItems, userId);
      } else {
        this.scheduleWorkspaceStateRefresh(workspaceId, userId, recentItems);
      }

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
          refreshedStates: Math.min(items.length, refreshStateCount),
          discoverMs: discoverDurationMs,
          persistMs: persistDurationMs,
          refreshStateDeferred: refreshStateMode !== "inline"
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
          refreshStateDeferred: refreshStateMode !== "inline",
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
    sessionId: string,
    provider: string,
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward",
    knownTotalMessageCount: number | null = null
  ): Promise<HistoryPage> {
    if (shouldShortCircuitMissingSyntheticCodexHistory(provider, rawStoreRef)) {
      return {
        messages: [],
        cursor,
        nextCursor: null,
        total: 0
      };
    }

    const historyTask =
      direction === "backward" && cursor === null && typeof knownTotalMessageCount === "number"
        ? this.sessionSyncService.readRecentHistory(
            provider,
            providerSessionId,
            rawStoreRef,
            knownTotalMessageCount,
            limit
          )
        : this.sessionSyncService.readHistory(
            provider,
            providerSessionId,
            rawStoreRef,
            cursor,
            limit,
            direction
          );

    return historyTask
      .then((page) => {
        const messages = this.sessionMessageAttachmentService.enrichMessages(sessionId, page.messages);
        this.persistSessionChangedFiles(sessionId, messages);

        return {
          ...page,
          messages
        };
      })
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
        parentSessionId: item.parentSessionId ?? null,
        isSubagent: item.isSubagent ?? false,
        subagentLabel: item.subagentLabel ?? null
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
        sessionId,
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
        await this.syncSessionTitleFromProvider(sessionId, binding);
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

  private async syncSessionTitleFromProvider(
    sessionId: string,
    binding: SessionBinding
  ): Promise<void> {
    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

    if (!currentIndex) {
      return;
    }

    const nextTitle = (
      await this.sessionSyncService.readSessionTitle(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef
      )
    ).trim();

    if (nextTitle.length === 0 || nextTitle === currentIndex.title) {
      return;
    }

    this.sessionIndexRepository.upsert({
      ...currentIndex,
      title: nextTitle,
      updatedAt: nowIso()
    });
  }

  private async ensureSessionChangedFilesIndexed(
    sessionId: string
  ): Promise<void> {
    if (this.sessionChangedFileService.hasIndexedSession(sessionId)) {
      return;
    }

    const binding = this.getBindingOrThrow(sessionId);
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    while (true) {
      const page = await this.readPage(
        sessionId,
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        100,
        "forward"
      );

      if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
        this.sessionChangedFileService.markSessionIndexed(sessionId, nowIso());
        return;
      }

      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  private persistSessionChangedFiles(sessionId: string, messages: HistoryPage["messages"]): void {
    if (messages.length === 0) {
      return;
    }

    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

    if (!binding) {
      return;
    }

    const workspace = this.workspaceRepository.findById(binding.workspaceId);

    if (!workspace) {
      return;
    }

    this.sessionChangedFileService.recordMessages(
      sessionId,
      binding.workspaceId,
      workspace.path,
      messages
    );
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
    for (let index = 0; index < sessions.length; index += 1) {
      if (index > 0) {
        await delay(0);
      }

      await this.refreshSessionState(sessions[index]!.sessionId, userId);
    }
  }

  private scheduleWorkspaceStateRefresh(
    workspaceId: string,
    userId: string,
    sessions: SessionListItem[]
  ): void {
    if (sessions.length === 0) {
      return;
    }

    const inflightKey = `${workspaceId}:${userId}`;

    if (this.workspaceStateRefreshInflight.has(inflightKey)) {
      return;
    }

    const startedAt = Date.now();
    const task = delay(0)
      .then(() => this.refreshRecentSessionStates(sessions, userId))
      .then(() => {
        logPerformance(
          "workspace.refresh_recent_session_states",
          Date.now() - startedAt,
          {
            workspaceId,
            refreshedStates: sessions.length
          },
          {
            thresholdMs: 300
          }
        );
      })
      .catch((error) => {
        logPerformance(
          "workspace.refresh_recent_session_states.failed",
          Date.now() - startedAt,
          {
            workspaceId,
            refreshedStates: sessions.length,
            error: error instanceof Error ? error.message : "unknown"
          },
          {
            thresholdMs: 0,
            force: true
          }
        );
      })
      .finally(() => {
        this.workspaceStateRefreshInflight.delete(inflightKey);
      });

    this.workspaceStateRefreshInflight.set(inflightKey, task);
  }

  private cleanupStaleHiddenSessions(
    workspaceId: string,
    userId: string,
    sessions: Array<{
      provider: string;
      providerSessionId: string;
      rawStoreRef: string;
    }>
  ): void {
    const discoveredProviderSessionIds = new Set(
      sessions.map((session) => buildProviderSessionKey(session.provider, session.providerSessionId))
    );
    const discoveredRawStoreRefs = new Set(sessions.map((session) => session.rawStoreRef));
    const staleHiddenSessions = this.sessionIndexRepository
      .listByWorkspace(workspaceId, userId)
      .filter((session) => {
        if (discoveredProviderSessionIds.has(buildProviderSessionKey(session.provider, session.providerSessionId))) {
          return false;
        }

        if (discoveredRawStoreRefs.has(session.rawStoreRef)) {
          return false;
        }

        return (
          (session.provider === "codex" &&
            (
              isLegacyCodingNsRolloutSession(session.providerSessionId, session.rawStoreRef) ||
              shouldRemoveMissingSyntheticCodexSession(session.rawStoreRef)
            )) ||
          (session.provider === "claude-code" && shouldRemoveHiddenClaudeDebugSession(session))
        );
      });

    if (staleHiddenSessions.length === 0) {
      return;
    }

    this.deleteSessionsByIds(staleHiddenSessions.map((session) => session.sessionId));
  }

  private deleteSessionsByIds(sessionIds: string[]): void {
    const remove = this.db.transaction((ids: string[]) => {
      for (const sessionId of ids) {
        this.sessionChangedFileService.deleteBySessionId(sessionId);
        this.db
          .prepare("DELETE FROM session_message_attachments WHERE session_id = ?")
          .run(sessionId);
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

    remove(sessionIds);
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

    if (shouldPreserveRuntimeTerminalState(current, inspection)) {
      return current;
    }

    const nextRecord: SessionStateRecord = {
      sessionId,
      userId,
      runningState: inspection.runningState === "running" ? "running" : "idle",
      activitySource:
        inspection.lastEventAt || inspection.completedAtCandidate ? "inferred" : "none",
      lastEventAt: inspection.lastEventAt,
      completedAt: inspection.completedAtCandidate,
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

function isMessageAtOrAfter(timestamp: string, minTimestamp: string | null): boolean {
  if (!minTimestamp) {
    return true;
  }

  const messageAt = Date.parse(timestamp);
  const minAt = Date.parse(minTimestamp);

  if (!Number.isFinite(messageAt) || !Number.isFinite(minAt)) {
    return true;
  }

  return messageAt >= minAt;
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

function shouldRemoveMissingSyntheticCodexSession(rawStoreRef: string): boolean {
  return isSyntheticCodexRawStoreRef(rawStoreRef) && !existsSync(rawStoreRef);
}

function shouldRemoveHiddenClaudeDebugSession(session: {
  providerSessionId: string;
  rawStoreRef: string;
}): boolean {
  const normalizedRawStoreRef = session.rawStoreRef.replaceAll("\\", "/");

  if (normalizedRawStoreRef.includes("/subagents/")) {
    return false;
  }

  return (
    /^agent-[^/]+$/i.test(session.providerSessionId) &&
    /\/agent-[^/]+\.jsonl$/i.test(normalizedRawStoreRef)
  );
}

function shouldPreserveRuntimeTerminalState(
  current: SessionStateRecord | null,
  inspection: ReturnType<typeof inspectSessionActivity>
): boolean {
  if (!current || current.activitySource !== "runtime") {
    return false;
  }

  if (!inspection.lastEventAt || !current.lastEventAt) {
    return true;
  }

  if (isTerminalRunningState(current.runningState)) {
    return inspection.lastEventAt.localeCompare(current.lastEventAt) <= 0;
  }

  if (current.runningState === "starting" || current.runningState === "running") {
    return inspection.lastEventAt.localeCompare(current.lastEventAt) < 0;
  }

  return false;
}

function isTerminalRunningState(state: SessionStateRecord["runningState"]): boolean {
  return state === "completed" || state === "interrupted" || state === "failed";
}
