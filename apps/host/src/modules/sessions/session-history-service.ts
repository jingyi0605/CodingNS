import type Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  CapabilityService,
  ClaudeCodeAdapter,
  type ContextUsageSnapshot,
  CodexAdapter,
  GeminiAdapter,
  KimiAdapter,
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
  SessionActivityConfidence,
  SessionActivityResolutionSource,
  SessionBinding,
  SessionChangedFileRecord,
  SessionIndexRecord,
  SessionListItem,
  SessionResolvedRunningState,
  SessionStateRecord,
  SessionStatusSnapshot
} from "../../types/domain.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import { inspectSessionActivity } from "./session-activity-inspector.js";
import {
  SessionActivityAuthorityService,
  type SessionActivityObservation,
  type SessionActivityResolution
} from "./session-activity-authority-service.js";
import { SessionChangedFileService } from "./session-changed-file-service.js";
import { SessionMessageAttachmentService } from "./session-message-attachment-service.js";
import { mapSessionProviderError } from "./session-provider-error-mapper.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
import { enrichClaudeCapabilities } from "../provider/claude-model-options.js";
import {
  CodexModelOptionsService,
  enrichCodexCapabilities
} from "../provider/codex-model-options.js";
import {
  OpenCodeModelOptionsService,
  enrichOpenCodeCapabilities
} from "../provider/opencode-model-options.js";

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

interface FavoriteSessionInput {
  sessionId: string;
  userId: string;
  isFavorite: boolean;
}

export interface SessionHistoryEnvelope {
  type: "session.backfill" | "session.delta" | "session.history_older";
  sessionId: string;
  cursor: string | null;
  olderCursor?: string | null;
  messages: HistoryPage["messages"];
}

export type SessionHistoryMessageWithOrigin = HistoryPage["messages"][number] & {
  origin: string | null;
  originRef: string | null;
};

interface SessionRelationDescriptor {
  parentSessionId: string | null;
  isSubagent: boolean;
  subagentLabel: string | null;
}

interface PersistedSessionDescriptor {
  session: Awaited<
    ReturnType<SessionSyncService["discoverWorkspaceSessions"]>
  >["sessions"][number];
  sessionId: string;
  createdAt: string;
  existingIndex: SessionIndexRecord | null;
}

interface WorkspaceDiscoveryStatus {
  refreshedAt: number;
  isComplete: boolean;
}

interface PendingSessionAliasDescriptor {
  sessionId: string;
  workspaceId: string;
  provider: string;
  providerSessionId: string;
  rawStoreRef: string;
}

interface SessionStateRecordRow {
  session_id: string;
  user_id: string;
  running_state: SessionStateRecord["runningState"];
  activity_source: SessionStateRecord["activitySource"];
  favorite: number;
  last_event_at: string | null;
  completed_at: string | null;
  last_seen_at: string | null;
  updated_at: string;
}

const SESSION_START_DEFERRED_PROVIDERS = new Set([
  "codex",
  "claude-code",
  "opencode",
  "gemini",
  "kimi"
]);

export class SessionHistoryService {
  private readonly providerRegistry: ProviderRegistry;
  private readonly sessionSyncService: SessionSyncService;
  private readonly capabilityService: CapabilityService;
  private readonly sessionActivityAuthorityService: SessionActivityAuthorityService;
  private readonly claudeCodeHomeDir: string;
  private readonly codexModelOptionsService: CodexModelOptionsService;
  private readonly openCodeModelOptionsService: OpenCodeModelOptionsService;
  private readonly workspaceDiscoveryStatuses = new Map<string, WorkspaceDiscoveryStatus>();
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
    config: HostConfig,
    sessionActivityAuthorityService = new SessionActivityAuthorityService(),
    private readonly sessionMessageOriginRepository: Pick<
      SessionMessageOriginRepository,
      "listBySessionAndMessageIds" | "listUnresolvedBySessionAndContents" | "resolveMessageId"
    > | null = null
  ) {
    this.sessionActivityAuthorityService = sessionActivityAuthorityService;
    this.claudeCodeHomeDir = config.claudeCodeHomeDir;
    this.providerRegistry = new ProviderRegistry([
      new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
      new CodexAdapter({ homeDir: config.codexHomeDir }),
      new GeminiAdapter({
        homeDir: config.geminiHomeDir,
        commandPath: config.geminiCliPath
      }),
      new KimiAdapter({
        homeDir: config.kimiHomeDir,
        defaultModel: config.kimiDefaultModel
      }),
      new OpenCodeAdapter({
        baseUrl: config.opencodeBaseUrl,
        baseUrlResolver: config.opencodeBaseUrlResolver?.resolve.bind(config.opencodeBaseUrlResolver),
        dataDir: config.opencodeDataDir,
        dbPath: config.opencodeDbPath
      })
    ]);
    this.sessionSyncService = new SessionSyncService(this.providerRegistry);
    this.capabilityService = new CapabilityService(this.providerRegistry);
    this.codexModelOptionsService = new CodexModelOptionsService({
      commandPath: config.codexCliPath
    });
    this.openCodeModelOptionsService = new OpenCodeModelOptionsService({
      baseUrl: config.opencodeBaseUrl,
      baseUrlResolver: config.opencodeBaseUrlResolver?.resolve.bind(config.opencodeBaseUrlResolver),
      commandPath: config.opencodeCliPath
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
    const discoveryStatus = this.workspaceDiscoveryStatuses.get(workspaceId);
    const lastRefreshedAt = discoveryStatus?.refreshedAt ?? 0;

    if (
      !force &&
      discoveryStatus?.isComplete === true &&
      maxAgeMs > 0 &&
      Date.now() - lastRefreshedAt <= maxAgeMs
    ) {
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

    const discoveryStatus = this.workspaceDiscoveryStatuses.get(workspaceId);

    if (!discoveryStatus) {
      return true;
    }

    if (!discoveryStatus.isComplete) {
      return true;
    }

    return Date.now() - discoveryStatus.refreshedAt > maxAgeMs;
  }

  async readSessionHistory(
    sessionId: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward",
    userId?: string
  ): Promise<HistoryPage> {
    const startedAt = Date.now();
    const resolvedSessionId = this.resolveCanonicalSessionId(sessionId, userId);
    const binding = this.getBindingOrThrow(resolvedSessionId);
    const current = this.sessionStatusSnapshotRepository.findBySessionId(resolvedSessionId);
    const safeLimit = clampLimit(limit);
    const knownTotalMessageCount =
      direction === "backward" && cursor === null
        ? this.sessionIndexRepository.findIndexRecordBySessionId(resolvedSessionId)?.messageCount ?? null
        : null;
    let readDurationMs = 0;
    let refreshStateDurationMs = 0;

    this.upsertSnapshot(resolvedSessionId, {
      syncStatus: "syncing",
      syncCursor: current?.syncCursor ?? cursor,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: current?.lastErrorCode ?? null,
      lastErrorDetail: current?.lastErrorDetail ?? null,
      resumedAt: current?.resumedAt ?? null
    });

    try {
      const readStartedAt = Date.now();
      const page = await this.readPage(
        resolvedSessionId,
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        safeLimit,
        direction,
        knownTotalMessageCount
      );
      readDurationMs = Date.now() - readStartedAt;

      this.upsertSnapshot(resolvedSessionId, {
        syncStatus: "idle",
        syncCursor:
          direction === "backward" && cursor !== null
            ? current?.syncCursor ?? page.cursor
            : page.cursor,
        lastSyncAt: nowIso(),
        lastErrorCode: current?.lastErrorCode ?? null,
        lastErrorDetail: current?.lastErrorDetail ?? null,
        resumedAt: current?.resumedAt ?? null
      });

      logPerformance(
        "session.read_history",
        Date.now() - startedAt,
        {
          sessionId: resolvedSessionId,
          requestedSessionId: sessionId,
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
          sessionId: resolvedSessionId,
          requestedSessionId: sessionId,
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
      this.markSessionError(resolvedSessionId, "PROVIDER_READ_FAILED", error);
      throw mapSessionProviderError(error);
    }
  }

  resolveMessageOrigin(
    sessionId: string,
    message: HistoryPage["messages"][number]
  ): SessionHistoryMessageWithOrigin {
    return this.resolveMessageOrigins(sessionId, [message])[0] ?? {
      ...message,
      origin: null,
      originRef: null
    };
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
            isAcceptedUserMessageTimestamp(binding.provider, message.timestamp, minTimestamp)
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
      this.sessionIndexRepository
        .listByWorkspace(workspaceId, userId)
        .filter((item) => !this.isPendingSessionAlias(item))
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
    const codexEnriched = await enrichCodexCapabilities(
      claudeEnriched,
      this.codexModelOptionsService
    );

    return enrichOpenCodeCapabilities(
      codexEnriched,
      this.openCodeModelOptionsService,
      workspacePath
    );
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
        lastErrorCode: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.lastErrorCode ?? null,
        lastErrorDetail: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.lastErrorDetail ?? null,
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

    if (SESSION_START_DEFERRED_PROVIDERS.has(input.provider)) {
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
          favorite: false,
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
    clientRequestId: string | null,
    permissionMode: string | null = null
  ): Promise<SendMessageResult & { sessionId: string }> {
    const binding = this.getBindingOrThrow(sessionId);
    const result = await this.sessionSyncService
      .sendMessage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        content,
        clientRequestId,
        permissionMode
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
      lastErrorCode: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.lastErrorCode ?? null,
      lastErrorDetail: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.lastErrorDetail ?? null,
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
      lastErrorCode: current?.lastErrorCode ?? null,
      lastErrorDetail: current?.lastErrorDetail ?? null,
      resumedAt: current?.resumedAt ?? null
    });

    try {
      if (currentCursor === null) {
        currentCursor = await this.pullRecentSessionHistory(
          sessionId,
          safeLimit,
          sentMessageIds,
          onEnvelope,
          "session.backfill"
        );
      } else {
        await this.pullSessionHistory(
          sessionId,
          currentCursor,
          safeLimit,
          sentMessageIds,
          onEnvelope,
          "session.backfill"
        ).then((nextCursor) => {
          currentCursor = nextCursor;
        });
      }
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

  async readRecentHistoryEnvelope(
    sessionId: string,
    limit = 20
  ): Promise<SessionHistoryEnvelope | null> {
    const binding = this.getBindingOrThrow(sessionId);

    if (shouldSkipClaudePendingBinding(binding)) {
      return null;
    }

    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);
    const page = await this.readPage(
      sessionId,
      binding.provider,
      binding.providerSessionId,
      binding.rawStoreRef,
      null,
      clampLimit(limit),
      "backward",
      currentIndex?.messageCount ?? null
    );

    if (!page.messages.some((message) => message.role !== "user")) {
      return null;
    }

    await this.syncSessionTitleFromProvider(sessionId, binding);
    this.upsertSnapshot(sessionId, {
      syncStatus: "idle",
      syncCursor: page.cursor,
      lastSyncAt: nowIso(),
      lastErrorCode: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.lastErrorCode ?? null,
      lastErrorDetail: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.lastErrorDetail ?? null,
      resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
    });

    return {
      type: "session.delta",
      sessionId,
      cursor: page.cursor,
      messages: page.messages
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
      favorite: existing?.favorite ?? false,
      lastEventAt: existing?.lastEventAt ?? null,
      completedAt: existing?.completedAt ?? null,
      lastSeenAt: seenAt,
      updatedAt: seenAt
    });
  }

  async updateSessionFavoriteState(input: FavoriteSessionInput): Promise<SessionListItem> {
    this.getBindingOrThrow(input.sessionId);
    const existingItem = this.getSessionListItemOrThrow(input.sessionId, input.userId);
    const currentState =
      this.sessionStateRepository.findBySessionAndUser(input.sessionId, input.userId) ??
      (await this.refreshSessionState(input.sessionId, input.userId));
    const timestamp = nowIso();

    this.sessionStateRepository.upsert({
      sessionId: input.sessionId,
      userId: input.userId,
      runningState: currentState?.runningState ?? "idle",
      activitySource: currentState?.activitySource ?? "none",
      favorite: input.isFavorite,
      lastEventAt: currentState?.lastEventAt ?? existingItem.lastEventAt ?? null,
      completedAt: currentState?.completedAt ?? existingItem.completedAt ?? null,
      lastSeenAt: currentState?.lastSeenAt ?? existingItem.lastSeenAt ?? null,
      updatedAt: timestamp
    });

    return this.enrichSessionItem({
      ...this.getSessionListItemOrThrow(input.sessionId, input.userId),
      isFavorite: input.isFavorite
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

    return this.resolvePendingSessionAliasBinding(binding) ?? binding;
  }

  persistSessionBinding(
    sessionId: string,
    workspaceId: string,
    snapshot: { provider: string; providerSessionId: string | null; rawStoreRef: string | null }
  ): void {
    if (!snapshot.providerSessionId || !snapshot.rawStoreRef) {
      return;
    }

    const resolvedSnapshot = normalizeSessionBindingSnapshot(sessionId, {
      provider: snapshot.provider,
      providerSessionId: snapshot.providerSessionId,
      rawStoreRef: snapshot.rawStoreRef
    });
    const currentBinding = this.sessionBindingRepository.findBySessionId(sessionId);
    const timestamp = nowIso();
    const duplicateBinding = this.findPendingBindingDuplicate(
      sessionId,
      workspaceId,
      currentBinding,
      resolvedSnapshot
    );

    this.db.transaction(() => {
      if (duplicateBinding) {
        // 新建运行时会话会先写入 pending 绑定，后台发现链路可能在真 ID 回填前先落一条重复记录。
        // 这里保留当前 runtime session，把扫描出的重复会话并回当前会话，避免 provider_session_id 撞唯一键。
        this.mergeSessionIntoTarget({
          workspaceId,
          targetSessionId: sessionId,
          sourceSessionId: duplicateBinding.sessionId,
          provider: resolvedSnapshot.provider,
          timestamp
        });
      }

      const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

      this.sessionBindingRepository.upsert({
        sessionId,
        workspaceId,
        provider: resolvedSnapshot.provider,
        providerSessionId: resolvedSnapshot.providerSessionId,
        rawStoreRef: resolvedSnapshot.rawStoreRef,
        createdAt:
          pickEarlierIso(currentBinding?.createdAt ?? null, duplicateBinding?.createdAt ?? null)
          ?? timestamp,
        updatedAt: timestamp
      });

      if (currentIndex) {
        this.sessionIndexRepository.upsert({
          ...currentIndex,
          updatedAt: timestamp
        });
      }
    })();
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
      const existingWorkspaceSessions = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);
      const knownSessions = this.buildKnownSessionSummaries(
        existingWorkspaceSessions,
        workspace.path
      );
      const discovery = await this.sessionSyncService
        .discoverWorkspaceSessions(workspace.path, {
          knownSessions
        })
        .catch((error) => {
          throw mapSessionProviderError(error);
        });
      const sessions = discovery.sessions;
      discoverDurationMs = Date.now() - discoverStartedAt;
      const timestamp = nowIso();
      const discoveredSessionIds = new Map<string, string>();
      const persistedSessions: PersistedSessionDescriptor[] = [];
      const claimedPendingSessionIds = new Set<string>();

      const persist = this.db.transaction(() => {
        for (const session of sessions) {
          const exactExisting =
            this.sessionBindingRepository.findByProviderSession(
              session.provider,
              session.providerSessionId
            ) ?? this.sessionBindingRepository.findByRawStoreRef(session.provider, session.rawStoreRef);

          // discover 只能补全当前工作区，不能把别的工作区已有会话偷过来重绑。
          if (exactExisting && exactExisting.workspaceId !== workspaceId) {
            continue;
          }

          const pendingDuplicate =
            exactExisting
            ?? findClaudePendingDiscoveryDuplicate(
              session,
              existingWorkspaceSessions,
              claimedPendingSessionIds
            )
            ?? findKimiRuntimeDiscoveryDuplicate(
              session,
              existingWorkspaceSessions,
              claimedPendingSessionIds
            );
          const existing = exactExisting ?? (
            pendingDuplicate
              ? this.sessionBindingRepository.findBySessionId(pendingDuplicate.sessionId)
              : null
          );

          if (pendingDuplicate && !exactExisting) {
            claimedPendingSessionIds.add(pendingDuplicate.sessionId);
          }

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
            isArchived: resolveDiscoveredArchiveState(existingIndex?.isArchived ?? false, session.isArchived),
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
            isArchived: resolveDiscoveredArchiveState(
              persistedSession.existingIndex?.isArchived ?? false,
              persistedSession.session.isArchived
            ),
            lastMessageAt: persistedSession.session.lastMessageAt,
            createdAt: persistedSession.createdAt,
            updatedAt: timestamp
          });
        }
      });

      const persistStartedAt = Date.now();
      persist();
      persistDurationMs = Date.now() - persistStartedAt;
      if (discovery.isComplete) {
        this.cleanupStaleHiddenSessions(workspaceId, userId, sessions);
      }
      this.workspaceSessionRelations.set(
        workspaceId,
        this.buildWorkspaceSessionRelationMap(sessions, discoveredSessionIds)
      );

      const items = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);
      const recentItems = items.slice(0, refreshStateCount);
      this.workspaceDiscoveryStatuses.set(workspaceId, {
        refreshedAt: Date.now(),
        isComplete: discovery.isComplete
      });

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
          discoveryComplete: discovery.isComplete,
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
    if (shouldShortCircuitClaudePendingHistory(provider, providerSessionId, rawStoreRef)) {
      return {
        messages: [],
        cursor,
        nextCursor: null,
        total: 0
      };
    }

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
        const messagesWithAttachments = this.sessionMessageAttachmentService.enrichMessages(sessionId, page.messages);
        const messages = this.enrichMessagesWithOrigin(sessionId, messagesWithAttachments);
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

  private enrichMessagesWithOrigin(
    sessionId: string,
    messages: HistoryPage["messages"]
  ): SessionHistoryMessageWithOrigin[] {
    return this.resolveMessageOrigins(sessionId, messages);
  }

  private resolveMessageOrigins(
    sessionId: string,
    messages: HistoryPage["messages"]
  ): SessionHistoryMessageWithOrigin[] {
    const originRepository = this.sessionMessageOriginRepository;

    if (!originRepository || messages.length === 0) {
      return messages.map((message) => ({
        ...message,
        origin: null,
        originRef: null
      }));
    }

    const messageIds = [...new Set(messages.map((message) => message.messageId).filter(Boolean))];
    const originRows = originRepository.listBySessionAndMessageIds(sessionId, messageIds);
    const originByMessageId = new Map(
      originRows
        .filter((row) => row.messageId)
        .map((row) => [row.messageId!, row] as const)
    );
    const unresolvedRows = originRepository.listUnresolvedBySessionAndContents(
      sessionId,
      [...new Set(messages.map((message) => message.content).filter((content) => content.trim().length > 0))]
    );
    const unresolvedByContent = new Map<string, typeof unresolvedRows>();

    for (const row of unresolvedRows) {
      const current = unresolvedByContent.get(row.content) ?? [];
      current.push(row);
      unresolvedByContent.set(row.content, current);
    }

    return messages.map((message) => {
      const resolved = originByMessageId.get(message.messageId) ?? null;

      if (resolved) {
        return {
          ...message,
          origin: resolved.origin,
          originRef: resolved.originRef
        };
      }

      if (message.role !== "user") {
        return {
          ...message,
          origin: null,
          originRef: null
        };
      }

      const candidates = unresolvedByContent.get(message.content) ?? [];
      const matched = candidates.find((row) => isMessageAtOrAfter(message.timestamp, row.createdAt)) ?? null;

      if (!matched) {
        return {
          ...message,
          origin: null,
          originRef: null
        };
      }

      originRepository.resolveMessageId(
        sessionId,
        matched.clientRequestId,
        message.messageId,
        message.timestamp
      );
      unresolvedByContent.set(
        message.content,
        candidates.filter((candidate) => candidate.clientRequestId !== matched.clientRequestId)
      );

      return {
        ...message,
        origin: matched.origin,
        originRef: matched.originRef
      };
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

      return this.enrichSessionItem({
        ...item,
        parentSessionId: relation.parentSessionId,
        isSubagent: relation.isSubagent,
        subagentLabel: relation.subagentLabel
      });
    });
  }

  private enrichSessionItem(item: SessionListItem): SessionListItem {
    const relation = this.workspaceSessionRelations.get(item.workspaceId)?.get(item.sessionId);
    const nextItem = relation
      ? {
          ...item,
          parentSessionId: relation.parentSessionId,
          isSubagent: relation.isSubagent,
          subagentLabel: relation.subagentLabel
        }
      : {
          ...item,
          parentSessionId: item.parentSessionId ?? null,
          isSubagent: item.isSubagent ?? false,
          subagentLabel: item.subagentLabel ?? null
        };
    const resolution = this.sessionActivityAuthorityService.resolvePersistedSession(nextItem);

    return applySessionActivityResolution(nextItem, resolution);
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
      await this.publishHistoryEnvelope(sessionId, binding, page, sentMessageIds, onEnvelope, envelopeType);

      currentCursor = page.cursor;

      if (!page.nextCursor) {
        return currentCursor;
      }
    }

    return currentCursor;
  }

  private async pullRecentSessionHistory(
    sessionId: string,
    limit: number,
    sentMessageIds: Set<string>,
    onEnvelope: (envelope: SessionHistoryEnvelope) => Promise<void> | void,
    envelopeType: SessionHistoryEnvelope["type"]
  ): Promise<string | null> {
    const binding = this.getBindingOrThrow(sessionId);
    const knownTotalMessageCount =
      this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.messageCount ?? null;
    const page = await this.readPage(
      sessionId,
      binding.provider,
      binding.providerSessionId,
      binding.rawStoreRef,
      null,
      limit,
      "backward",
      knownTotalMessageCount
    );

    await this.publishHistoryEnvelope(sessionId, binding, page, sentMessageIds, onEnvelope, envelopeType);
    return page.cursor;
  }

  private async publishHistoryEnvelope(
    sessionId: string,
    binding: SessionBinding,
    page: HistoryPage,
    sentMessageIds: Set<string>,
    onEnvelope: (envelope: SessionHistoryEnvelope) => Promise<void> | void,
    envelopeType: SessionHistoryEnvelope["type"]
  ): Promise<void> {
    const messages = page.messages.filter((message) => {
      if (sentMessageIds.has(message.messageId)) {
        return false;
      }

      sentMessageIds.add(message.messageId);
      return true;
    });

    if (messages.length === 0) {
      return;
    }

    await this.syncSessionTitleFromProvider(sessionId, binding);
    const snapshot = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);
    this.upsertSnapshot(sessionId, {
      syncStatus: "idle",
      syncCursor: page.cursor,
      lastSyncAt: nowIso(),
      lastErrorCode: snapshot?.lastErrorCode ?? null,
      lastErrorDetail: snapshot?.lastErrorDetail ?? null,
      resumedAt: snapshot?.resumedAt ?? null
    });

    await onEnvelope({
      type: envelopeType,
      sessionId,
      cursor: page.cursor,
      messages
    });
  }

  private async syncSessionTitleFromProvider(
    sessionId: string,
    binding: SessionBinding
  ): Promise<void> {
    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

    if (!currentIndex) {
      return;
    }

    if (shouldSkipClaudePendingBinding(binding)) {
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

    const aliasTargetSessionId = this.findPendingSessionAliasTargetSessionId(item);

    if (!aliasTargetSessionId) {
      return item;
    }

    return this.sessionIndexRepository.findBySessionId(aliasTargetSessionId, userId) ?? item;
  }

  private resolveCanonicalSessionId(sessionId: string, userId?: string): string {
    if (userId) {
      const item = this.sessionIndexRepository.findBySessionId(sessionId, userId);
      const aliasTargetSessionId = this.findPendingSessionAliasTargetSessionId(item);

      if (aliasTargetSessionId) {
        return aliasTargetSessionId;
      }
    }

    const binding = this.sessionBindingRepository.findBySessionId(sessionId);
    return this.findPendingSessionAliasTargetSessionId(binding) ?? sessionId;
  }

  private isPendingSessionAlias(
    item: Pick<
      SessionListItem,
      "sessionId" | "workspaceId" | "provider" | "providerSessionId" | "rawStoreRef"
    >
  ): boolean {
    return Boolean(this.findPendingSessionAliasTargetSessionId(item));
  }

  private resolvePendingSessionAliasBinding(binding: SessionBinding): SessionBinding | null {
    const aliasTargetSessionId = this.findPendingSessionAliasTargetSessionId(binding);

    if (!aliasTargetSessionId) {
      return null;
    }

    return this.sessionBindingRepository.findBySessionId(aliasTargetSessionId);
  }

  private findPendingSessionAliasTargetSessionId(
    descriptor: PendingSessionAliasDescriptor | null | undefined
  ): string | null {
    if (!descriptor || descriptor.provider !== "gemini") {
      return null;
    }

    const aliasTargetSessionId =
      extractPendingBindingTargetSessionId(descriptor.providerSessionId)
      ?? extractPendingBindingTargetSessionId(descriptor.rawStoreRef);

    if (!aliasTargetSessionId || aliasTargetSessionId === descriptor.sessionId) {
      return null;
    }

    const targetBinding = this.sessionBindingRepository.findBySessionId(aliasTargetSessionId);

    if (!targetBinding) {
      return null;
    }

    if (
      targetBinding.workspaceId !== descriptor.workspaceId
      || targetBinding.provider !== descriptor.provider
      || isPendingBindingValue(targetBinding.providerSessionId)
      || isPendingBindingValue(targetBinding.rawStoreRef)
    ) {
      return null;
    }

    return aliasTargetSessionId;
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
        this.deleteSessionById(sessionId);
      }
    });

    remove(sessionIds);
  }

  private findPendingBindingDuplicate(
    sessionId: string,
    workspaceId: string,
    currentBinding: SessionBinding | null,
    snapshot: { provider: string; providerSessionId: string; rawStoreRef: string }
  ): SessionBinding | null {
    if (!currentBinding || !isPendingBindingValue(currentBinding.providerSessionId)) {
      return null;
    }

    if (isPendingBindingValue(snapshot.providerSessionId)) {
      return null;
    }

    const existing =
      this.sessionBindingRepository.findByProviderSession(
        snapshot.provider,
        snapshot.providerSessionId
      ) ?? this.sessionBindingRepository.findByRawStoreRef(snapshot.provider, snapshot.rawStoreRef);

    if (!existing || existing.sessionId === sessionId) {
      return null;
    }

    if (existing.workspaceId !== workspaceId) {
      throw new Error("SESSION_BINDING_WORKSPACE_CONFLICT");
    }

    return existing;
  }

  private mergeSessionIntoTarget(input: {
    workspaceId: string;
    targetSessionId: string;
    sourceSessionId: string;
    provider: string;
    timestamp: string;
  }): void {
    if (input.targetSessionId === input.sourceSessionId) {
      return;
    }

    const targetBinding = this.sessionBindingRepository.findBySessionId(input.targetSessionId);
    const sourceBinding = this.sessionBindingRepository.findBySessionId(input.sourceSessionId);

    if (!targetBinding || !sourceBinding) {
      return;
    }

    const targetIndex = this.sessionIndexRepository.findIndexRecordBySessionId(input.targetSessionId);
    const sourceIndex = this.sessionIndexRepository.findIndexRecordBySessionId(input.sourceSessionId);
    const targetSnapshot = this.sessionStatusSnapshotRepository.findBySessionId(input.targetSessionId);
    const sourceSnapshot = this.sessionStatusSnapshotRepository.findBySessionId(input.sourceSessionId);
    const targetStates = this.listSessionStatesBySessionId(input.targetSessionId);
    const sourceStates = this.listSessionStatesBySessionId(input.sourceSessionId);
    const targetStateByUserId = new Map(targetStates.map((state) => [state.userId, state] as const));

    this.copyChangedFilesToTarget(input.targetSessionId, input.sourceSessionId);
    this.copyChangedFileIndexStateToTarget(input.targetSessionId, input.sourceSessionId);

    for (const sourceState of sourceStates) {
      this.sessionStateRepository.upsert(
        mergeSessionStateRecord(
          targetStateByUserId.get(sourceState.userId) ?? null,
          {
            ...sourceState,
            sessionId: input.targetSessionId
          }
        )
      );
    }

    const mergedIndex = mergeSessionIndexRecord({
      targetSessionId: input.targetSessionId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      target: targetIndex,
      source: sourceIndex,
      timestamp: input.timestamp
    });

    if (mergedIndex) {
      this.sessionIndexRepository.upsert(mergedIndex);
    }

    const mergedSnapshot = mergeSessionStatusSnapshot({
      targetSessionId: input.targetSessionId,
      target: targetSnapshot,
      source: sourceSnapshot,
      timestamp: input.timestamp
    });

    if (mergedSnapshot) {
      this.sessionStatusSnapshotRepository.upsert(mergedSnapshot);
    }

    this.db
      .prepare(
        `UPDATE session_indices
         SET parent_session_id = ?
         WHERE parent_session_id = ?`
      )
      .run(input.targetSessionId, input.sourceSessionId);
    this.db
      .prepare(
        `UPDATE session_message_attachments
         SET session_id = ?
         WHERE session_id = ?`
      )
      .run(input.targetSessionId, input.sourceSessionId);
    this.db
      .prepare(
        `UPDATE session_file_context_bindings
         SET session_id = ?
         WHERE session_id = ?`
      )
      .run(input.targetSessionId, input.sourceSessionId);
    this.db
      .prepare(
        `UPDATE session_send_queue
         SET session_id = ?
         WHERE session_id = ?`
      )
      .run(input.targetSessionId, input.sourceSessionId);

    this.db
      .prepare("DELETE FROM session_changed_files WHERE session_id = ?")
      .run(input.sourceSessionId);
    this.db
      .prepare("DELETE FROM session_changed_file_states WHERE session_id = ?")
      .run(input.sourceSessionId);
    this.db
      .prepare("DELETE FROM session_states WHERE session_id = ?")
      .run(input.sourceSessionId);
    this.db
      .prepare("DELETE FROM session_status_snapshots WHERE session_id = ?")
      .run(input.sourceSessionId);
    this.db
      .prepare("DELETE FROM session_indices WHERE session_id = ?")
      .run(input.sourceSessionId);
    this.db
      .prepare("DELETE FROM session_bindings WHERE session_id = ?")
      .run(input.sourceSessionId);

    this.rewriteWorkspaceSessionRelations(
      input.workspaceId,
      input.targetSessionId,
      input.sourceSessionId,
      targetIndex,
      sourceIndex
    );
  }

  private listSessionStatesBySessionId(sessionId: string): SessionStateRecord[] {
    return this.db
      .prepare(
        `SELECT
           session_id AS session_id,
           user_id AS user_id,
           running_state AS running_state,
           activity_source AS activity_source,
           favorite AS favorite,
           last_event_at AS last_event_at,
           completed_at AS completed_at,
           last_seen_at AS last_seen_at,
           updated_at AS updated_at
         FROM session_states
         WHERE session_id = ?`
      )
      .all(sessionId)
      .map((row) => mapSessionStateRecordRow(row as SessionStateRecordRow));
  }

  private copyChangedFilesToTarget(targetSessionId: string, sourceSessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO session_changed_files (
           session_id,
           workspace_id,
           path,
           first_detected_at,
           last_detected_at,
           last_tool_name
         )
         SELECT ?, workspace_id, path, first_detected_at, last_detected_at, last_tool_name
         FROM session_changed_files
         WHERE session_id = ?
         ON CONFLICT(session_id, path) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           first_detected_at = MIN(session_changed_files.first_detected_at, excluded.first_detected_at),
           last_detected_at = MAX(session_changed_files.last_detected_at, excluded.last_detected_at),
           last_tool_name = COALESCE(excluded.last_tool_name, session_changed_files.last_tool_name)`
      )
      .run(targetSessionId, sourceSessionId);
  }

  private copyChangedFileIndexStateToTarget(targetSessionId: string, sourceSessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO session_changed_file_states (
           session_id,
           indexed_at,
           updated_at
         )
         SELECT ?, indexed_at, updated_at
         FROM session_changed_file_states
         WHERE session_id = ?
         ON CONFLICT(session_id) DO UPDATE SET
           indexed_at = MIN(session_changed_file_states.indexed_at, excluded.indexed_at),
           updated_at = MAX(session_changed_file_states.updated_at, excluded.updated_at)`
      )
      .run(targetSessionId, sourceSessionId);
  }

  private rewriteWorkspaceSessionRelations(
    workspaceId: string,
    targetSessionId: string,
    sourceSessionId: string,
    targetIndex: SessionIndexRecord | null,
    sourceIndex: SessionIndexRecord | null
  ): void {
    const relationMap = this.workspaceSessionRelations.get(workspaceId);

    if (!relationMap) {
      return;
    }

    const sourceRelation = relationMap.get(sourceSessionId);
    const targetRelation = relationMap.get(targetSessionId);
    const fallbackParentSessionId =
      targetIndex?.parentSessionId ?? sourceIndex?.parentSessionId ?? null;

    relationMap.delete(sourceSessionId);
    relationMap.set(targetSessionId, {
      parentSessionId:
        targetRelation?.parentSessionId ?? sourceRelation?.parentSessionId ?? fallbackParentSessionId,
      isSubagent: Boolean(
        targetRelation?.isSubagent
        || sourceRelation?.isSubagent
        || targetIndex?.isSubagent
        || sourceIndex?.isSubagent
        || fallbackParentSessionId
      ),
      subagentLabel:
        targetRelation?.subagentLabel
        ?? sourceRelation?.subagentLabel
        ?? targetIndex?.subagentLabel
        ?? sourceIndex?.subagentLabel
        ?? null
    });

    for (const relation of relationMap.values()) {
      if (relation.parentSessionId === sourceSessionId) {
        relation.parentSessionId = targetSessionId;
      }
    }
  }

  private deleteSessionById(sessionId: string): void {
    this.sessionChangedFileService.deleteBySessionId(sessionId);
    this.db
      .prepare("DELETE FROM session_message_attachments WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("DELETE FROM session_send_queue WHERE session_id = ?")
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

  private buildKnownSessionSummaries(
    sessions: SessionListItem[],
    workspacePath: string
  ) {
    return sessions
      .filter((session) => !shouldSkipClaudePendingBinding(session))
      .map((session) => {
      const stats = safeStat(session.rawStoreRef);

      return {
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        title: session.title,
        workspacePath,
        rawStoreRef: session.rawStoreRef,
        lastMessageAt: session.lastMessageAt,
        messageCount: session.messageCount,
        sourceMtimeMs: stats?.mtimeMs,
        sourceSizeBytes: stats?.size
      };
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

    const resolution = this.sessionActivityAuthorityService.observe(
      buildInspectionActivityObservation(sessionId, inspection, timestamp)
    );
    const nextRecord: SessionStateRecord = {
      sessionId,
      userId,
      runningState: mapResolvedRunningStateToStored(resolution.runningState, current),
      activitySource: mapResolutionSourceToLegacyActivitySource(
        resolution.activityResolutionSource,
        inspection
      ),
      favorite: current?.favorite ?? false,
      lastEventAt: resolution.lastObservedAt ?? inspection.lastEventAt ?? current?.lastEventAt ?? null,
      completedAt:
        isTerminalResolvedRunningState(resolution.runningState)
          ? resolution.terminalAt ?? inspection.completedAtCandidate ?? current?.completedAt ?? null
          : null,
      lastSeenAt: current?.lastSeenAt ?? null,
      updatedAt: timestamp
    };

    this.sessionStateRepository.upsert(nextRecord);

    const currentSnapshot = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);
    const shouldClearRuntimeFailure =
      current?.runningState === "failed" && resolution.runningState !== "failed";
    this.sessionStatusSnapshotRepository.upsert({
      sessionId,
      syncStatus:
        resolution.runningState === "failed"
          ? "error"
          : shouldClearRuntimeFailure
            ? "idle"
            : currentSnapshot?.syncStatus ?? "idle",
      syncCursor: currentSnapshot?.syncCursor ?? null,
      lastSyncAt:
        resolution.lastObservedAt
        ?? resolution.terminalAt
        ?? inspection.lastEventAt
        ?? inspection.completedAtCandidate
        ?? currentSnapshot?.lastSyncAt
        ?? null,
      lastErrorCode:
        resolution.runningState === "failed"
          ? resolution.errorCode
          : shouldClearRuntimeFailure
            ? null
            : currentSnapshot?.lastErrorCode ?? null,
      lastErrorDetail:
        resolution.runningState === "failed"
          ? resolution.detail
          : shouldClearRuntimeFailure
            ? null
            : currentSnapshot?.lastErrorDetail ?? null,
      resumedAt: currentSnapshot?.resumedAt ?? null,
      updatedAt: timestamp
    });

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

function buildInspectionActivityObservation(
  sessionId: string,
  inspection: ReturnType<typeof inspectSessionActivity>,
  observedAt: string
): SessionActivityObservation {
  return {
    sessionId,
    runId: null,
    runningState: inspection.runningState,
    source: hasInspectionEvidence(inspection) ? "inferred_log" : "unknown",
    confidence: "weak",
    detail: inspection.errorDetail,
    errorCode: inspection.errorCode,
    observedAt: inspection.completedAtCandidate ?? inspection.lastEventAt ?? observedAt
  };
}

function hasInspectionEvidence(inspection: ReturnType<typeof inspectSessionActivity>): boolean {
  return inspection.runningState !== "idle"
    || !!inspection.lastEventAt
    || !!inspection.completedAtCandidate;
}

function applySessionActivityResolution(
  item: SessionListItem,
  resolution: SessionActivityResolution
): SessionListItem {
  const runningState = resolution.runningState;
  const shouldClearResolvedFailure = runningState !== "failed" && item.runningState === "failed";
  const lastEventAt = resolution.lastObservedAt ?? item.lastEventAt;
  const completedAt =
    isTerminalResolvedRunningState(runningState)
      ? resolution.terminalAt ?? item.completedAt
      : null;
  const lastErrorCode =
    runningState === "failed"
      ? resolution.errorCode ?? item.lastErrorCode
      : shouldClearResolvedFailure
        ? null
        : item.lastErrorCode;
  const lastErrorDetail =
    runningState === "failed"
      ? resolution.detail ?? item.lastErrorDetail
      : shouldClearResolvedFailure
        ? null
        : item.lastErrorDetail;
  const syncStatus =
    runningState === "failed"
      ? "error"
      : shouldClearResolvedFailure && item.syncStatus === "error"
        ? "idle"
        : item.syncStatus;

  return {
    ...item,
    syncStatus,
    runningState,
    activitySource: mapResolutionSourceToCompatibilitySource(resolution.activityResolutionSource),
    activityResolutionSource: resolution.activityResolutionSource,
    activityConfidence: resolution.activityConfidence,
    runId: resolution.runId,
    lastEventAt,
    completedAt,
    lastErrorCode,
    lastErrorDetail,
    watchdogTriggeredAt: resolution.watchdogTriggeredAt,
    activityState: resolveActivityState(runningState, completedAt, item.lastSeenAt)
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

function mapSessionStateRecordRow(row: SessionStateRecordRow): SessionStateRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    runningState: row.running_state,
    activitySource: row.activity_source,
    favorite: row.favorite === 1,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at
  };
}

function mergeSessionStateRecord(
  target: SessionStateRecord | null,
  source: SessionStateRecord
): SessionStateRecord {
  if (!target) {
    return source;
  }

  const preferred = pickPreferredSessionState(target, source);

  return {
    sessionId: source.sessionId,
    userId: source.userId,
    runningState: preferred.runningState,
    activitySource: preferred.activitySource,
    favorite: target.favorite || source.favorite,
    lastEventAt: pickLaterIso(target.lastEventAt, source.lastEventAt),
    completedAt: pickLaterIso(target.completedAt, source.completedAt),
    lastSeenAt: pickLaterIso(target.lastSeenAt, source.lastSeenAt),
    updatedAt: pickLaterIso(target.updatedAt, source.updatedAt) ?? preferred.updatedAt
  };
}

function pickPreferredSessionState(
  left: SessionStateRecord,
  right: SessionStateRecord
): SessionStateRecord {
  const leftPriority = scoreSessionState(left);
  const rightPriority = scoreSessionState(right);

  if (leftPriority !== rightPriority) {
    return leftPriority > rightPriority ? left : right;
  }

  return (pickLaterIso(left.updatedAt, right.updatedAt) ?? left.updatedAt) === right.updatedAt
    ? right
    : left;
}

function scoreSessionState(record: SessionStateRecord): number {
  if (
    record.activitySource === "runtime"
    && (record.runningState === "starting" || record.runningState === "running")
  ) {
    return 6;
  }

  if (record.activitySource === "runtime") {
    return 5;
  }

  if (record.activitySource === "inferred" && record.runningState === "running") {
    return 4;
  }

  if (record.activitySource === "inferred") {
    return 3;
  }

  return record.favorite ? 2 : 1;
}

function mergeSessionIndexRecord(input: {
  targetSessionId: string;
  workspaceId: string;
  provider: string;
  target: SessionIndexRecord | null;
  source: SessionIndexRecord | null;
  timestamp: string;
}): SessionIndexRecord | null {
  if (!input.target && !input.source) {
    return null;
  }

  return {
    sessionId: input.targetSessionId,
    workspaceId: input.workspaceId,
    provider: (input.target?.provider ?? input.source?.provider ?? input.provider) as SessionIndexRecord["provider"],
    parentSessionId: input.target?.parentSessionId ?? input.source?.parentSessionId ?? null,
    isSubagent: Boolean(input.target?.isSubagent || input.source?.isSubagent),
    subagentLabel: input.target?.subagentLabel ?? input.source?.subagentLabel ?? null,
    title: pickPreferredSessionTitle(input.target?.title ?? null, input.source?.title ?? null),
    messageCount: Math.max(input.target?.messageCount ?? 0, input.source?.messageCount ?? 0),
    isArchived: Boolean(input.target?.isArchived || input.source?.isArchived),
    lastMessageAt: pickLaterIso(input.target?.lastMessageAt ?? null, input.source?.lastMessageAt ?? null),
    createdAt: pickEarlierIso(input.target?.createdAt ?? null, input.source?.createdAt ?? null) ?? input.timestamp,
    updatedAt: input.timestamp
  };
}

function mergeSessionStatusSnapshot(input: {
  targetSessionId: string;
  target: SessionStatusSnapshot | null;
  source: SessionStatusSnapshot | null;
  timestamp: string;
}): SessionStatusSnapshot | null {
  if (!input.target && !input.source) {
    return null;
  }

  const preferred = pickPreferredSnapshot(input.target, input.source);

  return {
    sessionId: input.targetSessionId,
    syncStatus: preferred?.syncStatus ?? "idle",
    syncCursor: input.target?.syncCursor ?? input.source?.syncCursor ?? null,
    lastSyncAt: pickLaterIso(input.target?.lastSyncAt ?? null, input.source?.lastSyncAt ?? null),
    lastErrorCode: preferred?.lastErrorCode ?? null,
    lastErrorDetail: preferred?.lastErrorDetail ?? null,
    resumedAt: pickLaterIso(input.target?.resumedAt ?? null, input.source?.resumedAt ?? null),
    updatedAt: input.timestamp
  };
}

function pickPreferredSnapshot(
  left: SessionStatusSnapshot | null,
  right: SessionStatusSnapshot | null
): SessionStatusSnapshot | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left.syncStatus === "error" && right.syncStatus !== "error") {
    return left;
  }

  if (right.syncStatus === "error" && left.syncStatus !== "error") {
    return right;
  }

  return (pickLaterIso(left.updatedAt, right.updatedAt) ?? left.updatedAt) === right.updatedAt
    ? right
    : left;
}

function pickPreferredSessionTitle(target: string | null, source: string | null): string {
  const normalizedTarget = target?.trim() ?? "";
  const normalizedSource = source?.trim() ?? "";

  if (!normalizedTarget) {
    return normalizedSource;
  }

  if (!normalizedSource) {
    return normalizedTarget;
  }

  if (looksLikeGeneratedSessionTitle(normalizedTarget) && !looksLikeGeneratedSessionTitle(normalizedSource)) {
    return normalizedSource;
  }

  return normalizedTarget;
}

function looksLikeGeneratedSessionTitle(title: string): boolean {
  return /^(Claude|Codex|OpenCode)\s+会话\b/i.test(title);
}

function pickEarlierIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left.localeCompare(right) <= 0 ? left : right;
}

function pickLaterIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left.localeCompare(right) >= 0 ? left : right;
}

function buildProviderSessionKey(provider: string, providerSessionId: string): string {
  return `${provider}::${providerSessionId}`;
}

function normalizeSessionBindingSnapshot(
  sessionId: string,
  snapshot: { provider: string; providerSessionId: string; rawStoreRef: string }
): { provider: string; providerSessionId: string; rawStoreRef: string } {
  if (
    snapshot.provider !== "claude-code" ||
    !(
      isPendingBindingValue(snapshot.providerSessionId) ||
      isClaudePendingRuntimeRawStoreRef(snapshot.rawStoreRef)
    )
  ) {
    return snapshot;
  }

  return {
    provider: snapshot.provider,
    providerSessionId: buildPendingBindingValue("claude-code", sessionId),
    rawStoreRef: buildPendingBindingValue("claude-code", sessionId)
  };
}

function shouldSkipClaudePendingBinding(binding: Pick<SessionBinding, "provider" | "providerSessionId" | "rawStoreRef">): boolean {
  if (binding.provider !== "claude-code") {
    return false;
  }

  if (isPendingBindingValue(binding.providerSessionId)) {
    return true;
  }

  return isClaudePendingRuntimeRawStoreRef(binding.rawStoreRef);
}

function isPendingBindingValue(value: string): boolean {
  return value.trim().toLowerCase().startsWith("pending://");
}

function buildPendingBindingValue(provider: string, sessionId: string): string {
  return `pending://${provider}/${sessionId}`;
}

function extractPendingBindingTargetSessionId(value: string): string | null {
  if (!isPendingBindingValue(value)) {
    return null;
  }

  const normalizedValue = value.trim();
  const targetSessionId = normalizedValue.slice(normalizedValue.indexOf("/", "pending://".length) + 1).trim();
  return targetSessionId || null;
}

function isClaudePendingRuntimeRawStoreRef(rawStoreRef: string): boolean {
  const normalizedRawStoreRef = rawStoreRef.replaceAll("\\", "/").toLowerCase();
  return normalizedRawStoreRef.includes("/.pending-");
}

function shouldShortCircuitClaudePendingHistory(
  provider: string,
  providerSessionId: string,
  rawStoreRef: string
): boolean {
  if (provider !== "claude-code" && provider !== "gemini") {
    return false;
  }

  return isPendingBindingValue(providerSessionId) || isPendingBindingValue(rawStoreRef);
}

function findClaudePendingDiscoveryDuplicate(
  session: {
    provider: string;
    providerSessionId: string;
    rawStoreRef: string;
    title: string;
    messageCount: number;
    lastMessageAt: string | null;
  },
  existingSessions: SessionListItem[],
  claimedSessionIds: Set<string>
): SessionListItem | null {
  if (session.provider !== "claude-code") {
    return null;
  }

  if (
    isPendingBindingValue(session.providerSessionId)
    || session.rawStoreRef.replaceAll("\\", "/").toLowerCase().includes("/.pending-")
  ) {
    return null;
  }

  const comparableTitle = normalizeClaudeComparableTitle(session.title);

  if (!comparableTitle) {
    return null;
  }

  const titleMatchedCandidates = existingSessions.filter((item) => {
    if (claimedSessionIds.has(item.sessionId)) {
      return false;
    }

    if (item.provider !== "claude-code" || !shouldSkipClaudePendingBinding(item)) {
      return false;
    }

    if (normalizeClaudeComparableTitle(item.title) !== comparableTitle) {
      return false;
    }

    return isCloseClaudeSessionTimestamp(
      item.lastMessageAt ?? item.createdAt,
      session.lastMessageAt
    );
  });

  if (titleMatchedCandidates.length === 1) {
    return titleMatchedCandidates[0];
  }

  const activePendingCandidates = existingSessions.filter((item) => {
    if (claimedSessionIds.has(item.sessionId)) {
      return false;
    }

    if (item.provider !== "claude-code" || !shouldSkipClaudePendingBinding(item)) {
      return false;
    }

    if (item.activitySource !== "runtime") {
      return false;
    }

    if (item.runningState !== "starting" && item.runningState !== "running") {
      return false;
    }

    return isCloseClaudeSessionTimestamp(
      item.lastMessageAt ?? item.lastEventAt ?? item.createdAt,
      session.lastMessageAt
    );
  });

  return activePendingCandidates.length === 1 ? activePendingCandidates[0] : null;
}

function findKimiRuntimeDiscoveryDuplicate(
  session: {
    provider: string;
    providerSessionId: string;
    rawStoreRef: string;
    title: string;
    messageCount: number;
    lastMessageAt: string | null;
  },
  existingSessions: SessionListItem[],
  claimedSessionIds: Set<string>
): SessionListItem | null {
  if (session.provider !== "kimi" || isPendingBindingValue(session.providerSessionId)) {
    return null;
  }

  const candidates = existingSessions.filter((item) => {
    if (claimedSessionIds.has(item.sessionId)) {
      return false;
    }

    if (item.provider !== "kimi" || !shouldRecoverKimiRuntimeBinding(item)) {
      return false;
    }

    return isCloseKimiSessionTimestamp(item.lastMessageAt ?? item.createdAt, session.lastMessageAt);
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  const comparableTitle = normalizeKimiComparableTitle(session.title);

  if (!comparableTitle) {
    return null;
  }

  const titleMatchedCandidates = candidates.filter(
    (item) => normalizeKimiComparableTitle(item.title) === comparableTitle
  );

  return titleMatchedCandidates.length === 1
    ? titleMatchedCandidates[0]
    : null;
}

function shouldRecoverKimiRuntimeBinding(item: SessionListItem): boolean {
  if (isPendingBindingValue(item.providerSessionId)) {
    return true;
  }

  if (item.messageCount !== 0 || item.activitySource !== "runtime") {
    return false;
  }

  if (item.runningState === "starting") {
    return true;
  }

  if (item.lastErrorCode === "PROVIDER_READ_FAILED") {
    return true;
  }

  return (item.lastErrorDetail ?? "").includes("provider 会话不存在");
}

function normalizeKimiComparableTitle(title: string): string | null {
  const normalized = title.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
    ? null
    : normalized;
}

function isCloseKimiSessionTimestamp(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }

  const leftAt = Date.parse(left);
  const rightAt = Date.parse(right);

  if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) {
    return false;
  }

  return Math.abs(leftAt - rightAt) <= 2 * 60 * 1_000;
}

function normalizeClaudeComparableTitle(title: string | null | undefined): string {
  return title?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function isCloseClaudeSessionTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
  maxGapMs = 2 * 60 * 1000
): boolean {
  if (!left || !right) {
    return true;
  }

  const leftAt = Date.parse(left);
  const rightAt = Date.parse(right);

  if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) {
    return true;
  }

  return Math.abs(leftAt - rightAt) <= maxGapMs;
}

function resolveDiscoveredArchiveState(
  existingArchived: boolean,
  discoveredArchived: boolean | null | undefined
): boolean {
  if (existingArchived) {
    return true;
  }

  return discoveredArchived === true;
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

function isAcceptedUserMessageTimestamp(
  provider: string,
  timestamp: string,
  minTimestamp: string | null
): boolean {
  if (
    provider === "kimi"
    && isSyntheticKimiHistoryTimestamp(timestamp)
  ) {
    return true;
  }

  return isMessageAtOrAfter(timestamp, minTimestamp);
}

function isSyntheticKimiHistoryTimestamp(timestamp: string): boolean {
  return timestamp.startsWith("2020-01-01T00:");
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
    return inspection.lastEventAt.localeCompare(current.lastEventAt) <= 0;
  }

  return false;
}

function isTerminalRunningState(state: SessionStateRecord["runningState"]): boolean {
  return state === "completed" || state === "interrupted" || state === "failed";
}

function isTerminalResolvedRunningState(
  state: SessionResolvedRunningState
): state is Extract<SessionResolvedRunningState, "completed" | "interrupted" | "failed"> {
  return state === "completed" || state === "interrupted" || state === "failed";
}

function mapResolvedRunningStateToStored(
  runningState: SessionResolvedRunningState,
  current: SessionStateRecord | null
): SessionStateRecord["runningState"] {
  if (runningState !== "stale" && runningState !== "unknown") {
    return runningState;
  }

  if (current?.runningState === "starting" || current?.runningState === "running") {
    return current.runningState;
  }

  return "running";
}

function mapResolutionSourceToLegacyActivitySource(
  source: SessionActivityResolutionSource,
  inspection: ReturnType<typeof inspectSessionActivity>
): SessionStateRecord["activitySource"] {
  if (source === "authoritative_runtime" || source === "authoritative_provider_event") {
    return "runtime";
  }

  if (inspection.lastEventAt || inspection.completedAtCandidate) {
    return "inferred";
  }

  return "none";
}

function mapResolutionSourceToCompatibilitySource(
  source: SessionActivityResolutionSource
): SessionListItem["activitySource"] {
  if (source === "authoritative_runtime" || source === "authoritative_provider_event") {
    return "runtime";
  }

  if (source === "inferred_log") {
    return "inferred";
  }

  return "none";
}

function resolveActivityState(
  runningState: SessionResolvedRunningState | null,
  completedAt: string | null,
  lastSeenAt: string | null
): SessionListItem["activityState"] {
  if (runningState === "starting" || runningState === "running") {
    return "running";
  }

  if (completedAt && (!lastSeenAt || completedAt > lastSeenAt)) {
    return "completed_unread";
  }

  return "idle";
}
