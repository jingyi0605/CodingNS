import type Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  CapabilityService,
  ClaudeCodeAdapter,
  type CodexForkTransport,
  type CodexThreadControlTransport,
  type ContextUsageSnapshot,
  CodexAdapter,
  type ForkSourceMessageSnapshot,
  type ForkSourceType,
  GeminiAdapter,
  KimiAdapter,
  OpenCodeAdapter,
  type ProviderModelOption,
  ProviderRegistry,
  SessionSyncService,
  type ForkStrategy,
  type HistoryDirection,
  type HistoryPage,
  type ProviderCapabilities,
  type ProviderSessionDiscovery,
  type ProviderSubscription,
  type SendMessageResult
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashContent } from "../../shared/utils/hash.js";
import { createId } from "../../shared/utils/id.js";
import { logPerformance } from "../../shared/utils/perf-log.js";
import {
  isTerminalDebugEnabled,
  logTerminalDebug,
  terminalDebugNowMs
} from "../../shared/utils/terminal-debug-log.js";
import { nowIso } from "../../shared/utils/time.js";
import { isCommandAvailable } from "../../shared/utils/command-availability.js";
import type {
  SessionActivityConfidence,
  SessionActivityResolutionSource,
  SessionBinding,
  SessionChangedFileRecord,
  SessionIndexRecord,
  SessionListItem,
  SessionProviderConfigMode,
  SessionResolvedRunningState,
  SessionStateRecord,
  SessionStatusSnapshot
} from "../../types/domain.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { ParallelSessionGroupRepository } from "../../storage/repositories/parallel-session-group-repository.js";
import type { ParallelSessionMemberRepository } from "../../storage/repositories/parallel-session-member-repository.js";
import type { SessionIsolatedWorkspaceRepository } from "../../storage/repositories/session-isolated-workspace-repository.js";
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
import { SessionForkRepository } from "../../storage/repositories/session-fork-repository.js";
import {
  buildParallelGroupColorToken,
  resolveParallelDisplayParentSessionId
} from "../parallel-sessions/parallel-session-group-service.js";
import { enrichClaudeCapabilities } from "../provider/claude-model-options.js";
import {
  CodexModelOptionsService,
  createFallbackCodexModelOptions,
  enrichCodexCapabilities
} from "../provider/codex-model-options.js";
import {
  OpenCodeModelOptionsService,
  createFallbackOpenCodeModelOptions,
  enrichOpenCodeCapabilities
} from "../provider/opencode-model-options.js";
import {
  getSharedProviderDiscoveryHelperClient,
  type ProviderSessionDiscoveryHelperConfig
} from "../provider/provider-discovery-helper-client.js";
import { discoverWorkspaceSessionsInRuntime } from "../provider/provider-discovery-runtime.js";
import { createTaskManager, TaskManager } from "../tasks/task-manager.js";
import {
  HOST_TASK_TYPES,
  type TaskHandle,
  type TaskMetricsSnapshot
} from "../tasks/task-types.js";
import { CodexAppServerHelperClient } from "./codex-app-server-helper-client.js";
import {
  CodingnsProviderSessionDeleteCli,
  type ProviderSessionDeleteCli
} from "./provider-session-delete-cli.js";
import type { SessionProviderConfigService } from "./session-provider-config-service.js";

interface StartSessionInput {
  workspaceId: string;
  userId: string;
  provider: string;
  initialPrompt?: string;
  providerConfigMode?: SessionProviderConfigMode | null;
  providerPresetId?: string | null;
  parentSessionId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

interface ArchiveSessionInput {
  sessionId: string;
  userId: string;
  isArchived: boolean;
}

interface ForkSessionInput {
  sessionId: string;
  userId: string;
  sourceType: ForkSourceType;
  sourceMessageId?: string | null;
  sourceMessageSnapshot?: ForkSourceMessageSnapshot | null;
  strategy?: ForkStrategy;
  targetProvider?: string | null;
  providerConfigMode?: SessionProviderConfigMode | null;
  providerPresetId?: string | null;
  targetWorkspaceId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
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
  sessionKind: "default" | "annotation";
  annotationSourceMessageId: string | null;
  annotationSourceText: string | null;
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
  pass1Index: SessionIndexRecord;
}

const RECONSTRUCTED_FORK_TARGET_PROVIDERS = new Set(["codex", "claude-code", "opencode"]);
const FORK_RECONSTRUCTION_PAGE_SIZE = 200;
const MAX_FORK_DEPTH = 4;
const SYNTHETIC_CODEX_SESSION_CLEANUP_GRACE_MS = 120_000;

interface WorkspaceDiscoveryStatus {
  refreshedAt: number;
  isComplete: boolean;
}

type WorkspaceStateRefreshPhase = "fresh" | "stale" | "running" | "cooldown" | "failed";

interface WorkspaceStateRefreshStatus {
  phase: WorkspaceStateRefreshPhase;
  dirtyReasons: Set<string>;
  pendingSessions: Map<string, SessionListItem>;
  runningPromise: Promise<void> | null;
  cooldownTimer: NodeJS.Timeout | null;
  lastRequestedAt: number | null;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  lastFailedAt: number | null;
  nextAllowedAt: number | null;
  runningTaskId: string | null;
}

interface ProviderCapabilityCacheEntry {
  refreshedAt: number;
  value: ProviderCapabilities;
}

interface CodexDirtyBindingRepairState {
  promise: Promise<SessionBinding> | null;
  lastAttemptedAt: number;
}

interface DeliveredHistoryMessageState {
  readonly signaturesByMessageId: Map<string, string>;
  lastMutableTailRefreshAtMs: number;
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

interface SessionHistoryAdapterOverrides {
  codexForkTransportFactory?: () => CodexForkTransport;
  providerSessionDeleteCli?: ProviderSessionDeleteCli;
}

type LiveActivityObservationResolver = (sessionId: string) => SessionActivityObservation | null;
type SessionDeletedObserver = (input: {
  sessionId: string;
  userId: string;
  workspaceId: string;
  remainingWorkspaceSessionCount: number;
}) => Promise<void> | void;

const SESSION_START_DEFERRED_PROVIDERS = new Set([
  "codex",
  "claude-code",
  "opencode",
  "gemini",
  "kimi"
]);
const MUTABLE_HISTORY_TAIL_PROVIDERS = new Set([
  "claude-code",
  "codex",
  "gemini",
  "kimi",
  "opencode"
]);
const MUTABLE_HISTORY_TAIL_REFRESH_INTERVAL_MS = 1_200;
const WORKSPACE_DISCOVERY_BACKGROUND_MAX_AGE_MS = 15_000;
const WORKSPACE_DISCOVERY_SCAN_CONCURRENCY = 2;
const PROVIDER_CAPABILITY_CACHE_MAX_AGE_MS = 5_000;
const WORKSPACE_DISCOVERY_PERSIST_BATCH_SIZE = 25;
const SESSION_TRANSACTION_HOTSPOT_THRESHOLD_MS = 150;
const WORKSPACE_STATE_REFRESH_COOLDOWN_MS = 1_500;
const SQLITE_BUSY_RETRY_LIMIT = 3;
const SQLITE_BUSY_RETRY_DELAY_MS = 100;
const CODEX_DIRTY_BINDING_REPAIR_COOLDOWN_MS = 5_000;

export class SessionHistoryService {
  private readonly providerRegistry: ProviderRegistry;
  private readonly sessionSyncService: SessionSyncService;
  private readonly capabilityService: CapabilityService;
  private readonly sessionActivityAuthorityService: SessionActivityAuthorityService;
  private readonly sessionForkRepository: Pick<SessionForkRepository, "upsert" | "findBySessionId">;
  private readonly providerSessionDeleteCli: ProviderSessionDeleteCli;
  private readonly claudeCodeHomeDir: string;
  private readonly codexModelOptionsService: CodexModelOptionsService;
  private readonly openCodeModelOptionsService: OpenCodeModelOptionsService;
  private readonly providerCliCommandPaths: Readonly<Partial<Record<string, string>>>;
  private readonly providerCliAvailability: Readonly<Partial<Record<string, boolean>>>;
  private readonly parallelSessionGroupRepository: Pick<ParallelSessionGroupRepository, "listByIds"> | null;
  private readonly parallelSessionMemberRepository: Pick<
    ParallelSessionMemberRepository,
    "findBySessionId" | "listBySessionIds" | "listByGroupIds"
  > | null;
  private readonly sessionIsolatedWorkspaceRepository: Pick<
    SessionIsolatedWorkspaceRepository,
    "findByOwnerSessionId" | "listByOwnerSessionIds" | "listBySourceWorkspaceId"
  > | null;
  private readonly providerDiscoveryHelperClient = getSharedProviderDiscoveryHelperClient();
  private readonly providerSessionDiscoveryConfig: ProviderSessionDiscoveryHelperConfig;
  private readonly sessionProviderConfigService: Pick<
    SessionProviderConfigService,
    "prepareSessionBinding"
  > | null;
  private readonly taskManager: TaskManager;
  private readonly workspaceDiscoveryStatuses = new Map<string, WorkspaceDiscoveryStatus>();
  private readonly workspaceStateRefreshStatuses = new Map<string, WorkspaceStateRefreshStatus>();
  private readonly providerCapabilityCache = new Map<string, ProviderCapabilityCacheEntry>();
  private readonly codexDirtyBindingRepairStates = new Map<string, CodexDirtyBindingRepairState>();
  private readonly liveActivityObservationResolvers = new Set<LiveActivityObservationResolver>();
  private readonly sessionDeletedObservers = new Set<SessionDeletedObserver>();
  private readonly workspaceSessionRelations = new Map<
    string,
    Map<string, SessionRelationDescriptor>
  >();
  private workspaceStateRefreshTaskSequence = 0;

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
    > | null = null,
    sessionForkRepository: Pick<SessionForkRepository, "upsert" | "findBySessionId"> | null = null,
    adapterOverrides: SessionHistoryAdapterOverrides = {},
    taskManager: TaskManager = createTaskManager(),
    parallelSessionGroupRepository: Pick<ParallelSessionGroupRepository, "listByIds"> | null = null,
    parallelSessionMemberRepository: Pick<
      ParallelSessionMemberRepository,
      "findBySessionId" | "listBySessionIds" | "listByGroupIds"
    > | null = null,
    sessionIsolatedWorkspaceRepository: Pick<
      SessionIsolatedWorkspaceRepository,
      "findByOwnerSessionId" | "listByOwnerSessionIds" | "listBySourceWorkspaceId"
    > | null = null,
    sessionProviderConfigService: Pick<SessionProviderConfigService, "prepareSessionBinding"> | null = null
  ) {
    this.sessionActivityAuthorityService = sessionActivityAuthorityService;
    this.sessionForkRepository = sessionForkRepository ?? new SessionForkRepository(db);
    this.providerSessionDeleteCli =
      adapterOverrides.providerSessionDeleteCli ?? new CodingnsProviderSessionDeleteCli(config);
    this.taskManager = taskManager;
    this.parallelSessionGroupRepository = parallelSessionGroupRepository;
    this.parallelSessionMemberRepository = parallelSessionMemberRepository;
    this.sessionIsolatedWorkspaceRepository = sessionIsolatedWorkspaceRepository;
    this.sessionProviderConfigService = sessionProviderConfigService;
    this.claudeCodeHomeDir = config.claudeCodeHomeDir;
    this.providerCliCommandPaths = {
      "claude-code": process.platform === "win32" ? "claude.cmd" : "claude",
      codex: config.codexCliPath,
      gemini: config.geminiCliPath,
      kimi: config.kimiCliPath
    };
    // CLI 是否可用只在 Host 启动时探测一次；后续统一读缓存，更新 CLI 后重启 Host 生效。
    this.providerCliAvailability = buildProviderCliAvailabilitySnapshot(this.providerCliCommandPaths);
    this.providerSessionDiscoveryConfig = {
      claudeCodeHomeDir: config.claudeCodeHomeDir,
      codexCliPath: config.codexCliPath,
      codexHomeDir: config.codexHomeDir,
      geminiCliPath: config.geminiCliPath,
      geminiHomeDir: config.geminiHomeDir,
      kimiDefaultModel: config.kimiDefaultModel,
      kimiHomeDir: config.kimiHomeDir,
      opencodeBaseUrl: config.opencodeBaseUrl,
      opencodeDataDir: config.opencodeDataDir,
      opencodeDbPath: config.opencodeDbPath
    };
    this.providerRegistry = new ProviderRegistry([
      new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
      new CodexAdapter({
        homeDir: config.codexHomeDir,
        forkTransportFactory:
          adapterOverrides.codexForkTransportFactory
          ?? createCodexForkTransportFactory(config.codexCliPath, config.codexHomeDir),
        threadControlTransportFactory: createCodexThreadControlTransportFactory(
          config.codexCliPath,
          config.codexHomeDir
        )
      }),
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
    this.registerBackgroundTasks();
  }

  observeBackgroundTaskMetrics(): TaskMetricsSnapshot {
    return this.taskManager.observe();
  }

  registerLiveActivityObservationResolver(
    resolver: LiveActivityObservationResolver
  ): { close(): void } {
    this.liveActivityObservationResolvers.add(resolver);
    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        this.liveActivityObservationResolvers.delete(resolver);
      }
    };
  }

  registerSessionDeletedObserver(
    observer: SessionDeletedObserver
  ): { close(): void } {
    this.sessionDeletedObservers.add(observer);

    return {
      close: () => {
        this.sessionDeletedObservers.delete(observer);
      }
    };
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.workspaceDiscovery)) {
      this.taskManager.register<{
        workspaceId: string;
        userId: string;
        refreshStateMode: "inline" | "deferred";
      }, SessionListItem[]>({
        taskType: HOST_TASK_TYPES.workspaceDiscovery,
        executionLane: "host_background",
        run: async ({ workspaceId, userId, refreshStateMode }, context) =>
          this.runDiscoverWorkspaceSessions(
            workspaceId,
            userId,
            refreshStateMode,
            context.signal
          )
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.workspaceDiscoveryScan)) {
      this.taskManager.register<{
        config: ProviderSessionDiscoveryHelperConfig;
        workspacePath: string;
        knownSessions: import("@codingns/session-sync-core").ProviderSessionSummary[];
      }, ProviderSessionDiscovery>({
        taskType: HOST_TASK_TYPES.workspaceDiscoveryScan,
        executionLane: "helper_process",
        concurrency: WORKSPACE_DISCOVERY_SCAN_CONCURRENCY,
        helperProcessHandler: "session.workspace_discovery",
        run: async ({ config, workspacePath, knownSessions }, context) =>
          await discoverWorkspaceSessionsInRuntime(
            config,
            workspacePath,
            knownSessions,
            context.signal
          )
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.providerCapabilityRefresh)) {
      this.taskManager.register<{
        capabilities: ProviderCapabilities;
        workspacePath: string | null;
      }, void>({
        taskType: HOST_TASK_TYPES.providerCapabilityRefresh,
        executionLane: "external_process",
        run: async ({ capabilities, workspacePath }) => {
          const value = await this.enrichProviderCapabilities(capabilities, workspacePath);
          this.providerCapabilityCache.set(
            buildProviderCapabilityCacheKey(capabilities.provider, workspacePath),
            {
              refreshedAt: Date.now(),
              value
            }
          );
        }
      });
    }
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
      this.taskManager.recordCacheHit(HOST_TASK_TYPES.workspaceDiscovery, workspaceId);
      return this.listWorkspaceSessions(workspaceId, userId);
    }

    return this.taskManager.enqueue<{
      workspaceId: string;
      userId: string;
      refreshStateMode: "inline" | "deferred";
    }, SessionListItem[]>(HOST_TASK_TYPES.workspaceDiscovery, {
      key: workspaceId,
      source: "session_history.discover_workspace_sessions",
      input: {
        workspaceId,
        userId,
        refreshStateMode: options?.refreshStateMode ?? "inline"
      }
    }).promise;
  }

  requestWorkspaceDiscovery(
    workspaceId: string,
    userId: string,
    options?: {
      maxAgeMs?: number;
      force?: boolean;
      refreshStateMode?: "inline" | "deferred";
    }
  ): void {
    const maxAgeMs = options?.maxAgeMs ?? WORKSPACE_DISCOVERY_BACKGROUND_MAX_AGE_MS;
    const force = options?.force ?? false;

    if (!force && !this.needsWorkspaceDiscovery(workspaceId, maxAgeMs)) {
      return;
    }

    const task = this.taskManager.enqueue<{
      workspaceId: string;
      userId: string;
      refreshStateMode: "inline" | "deferred";
    }, SessionListItem[]>(HOST_TASK_TYPES.workspaceDiscovery, {
      key: workspaceId,
      source: "session_history.request_workspace_discovery",
      input: {
        workspaceId,
        userId,
        refreshStateMode: options?.refreshStateMode ?? "deferred"
      }
    });

    if (task.deduped) {
      return;
    }

    void task.promise.catch((error) => {
        logPerformance(
          "workspace.discover_sessions.background_failed",
          0,
          {
            workspaceId,
            error: error instanceof Error ? error.message : "unknown"
          },
          {
            thresholdMs: 0,
            force: true
          }
        );
        return this.listWorkspaceSessions(workspaceId, userId);
      });
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
    const resolveStartedAt = Date.now();
    const resolvedSessionId = this.resolveCanonicalSessionId(sessionId, userId);
    const resolveSessionIdMs = Date.now() - resolveStartedAt;
    const bindingLookupStartedAt = Date.now();
    let binding = this.getBindingOrThrow(resolvedSessionId);
    const bindingLookupMs = Date.now() - bindingLookupStartedAt;
    let repairBindingMs = 0;

    if (userId) {
      const repairStartedAt = Date.now();
      binding = await this.repairCodexDirtyBindingBeforeHistoryRead(
        resolvedSessionId,
        userId,
        binding
      );
      repairBindingMs = Date.now() - repairStartedAt;
    }

    const current = this.sessionStatusSnapshotRepository.findBySessionId(resolvedSessionId);
    const safeLimit = clampLimit(limit);
    const knownTotalLookupStartedAt = Date.now();
    const knownTotalMessageCount =
      direction === "backward" && cursor === null
        ? this.sessionIndexRepository.findIndexRecordBySessionId(resolvedSessionId)?.messageCount ?? null
        : null;
    const knownTotalLookupMs = Date.now() - knownTotalLookupStartedAt;
    let readDurationMs = 0;
    let refreshStateDurationMs = 0;
    let snapshotSyncingMs = 0;
    let snapshotIdleMs = 0;

    const snapshotSyncingStartedAt = Date.now();
    this.upsertSnapshot(resolvedSessionId, {
      syncStatus: "syncing",
      syncCursor: current?.syncCursor ?? cursor,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: current?.lastErrorCode ?? null,
      lastErrorDetail: current?.lastErrorDetail ?? null,
      resumedAt: current?.resumedAt ?? null
    });
    snapshotSyncingMs = Date.now() - snapshotSyncingStartedAt;

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

      const snapshotIdleStartedAt = Date.now();
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
      snapshotIdleMs = Date.now() - snapshotIdleStartedAt;

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
          resolveSessionIdMs,
          bindingLookupMs,
          repairBindingMs,
          knownTotalLookupMs,
          snapshotSyncingMs,
          snapshotIdleMs,
          readMs: readDurationMs,
          refreshStateMs: refreshStateDurationMs
        },
        {
          thresholdMs: 0,
          force: true
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
          resolveSessionIdMs,
          bindingLookupMs,
          repairBindingMs,
          knownTotalLookupMs,
          snapshotSyncingMs,
          snapshotIdleMs,
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

  resolveMessageOriginByClientRequestId(
    sessionId: string,
    clientRequestId: string | null,
    messageId: string | null,
    updatedAt: string
  ): void {
    if (!this.sessionMessageOriginRepository || !clientRequestId || !messageId) {
      return;
    }

    this.sessionMessageOriginRepository.resolveMessageId(
      sessionId,
      clientRequestId,
      messageId,
      updatedAt
    );
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

  async syncSessionTitle(sessionId: string, signal?: AbortSignal): Promise<void> {
    const binding = this.getBindingOrThrow(sessionId);
    await this.syncSessionTitleFromProvider(sessionId, binding, signal);
  }

  async syncWorkspaceSessionTitles(
    workspaceId: string,
    userId: string,
    concurrency = 1,
    signal?: AbortSignal
  ): Promise<void> {
    const sessions = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);

    await runWithConcurrency(sessions, concurrency, async (session) => {
      await this.syncSessionTitle(session.sessionId, signal).catch(() => {
        return;
      });
    }, signal);
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
    const directItems = this.sessionIndexRepository
      .listByWorkspace(workspaceId, userId)
      .filter((item) => !this.isPendingSessionAlias(item));
    const projectedItems = this.listProjectedIsolatedWorkspaceSessions(workspaceId, userId);

    return this.enrichSessionItems(
      workspaceId,
      sortSessionListItemsByRecentActivity(
        mergeSessionListItemsBySessionId([...directItems, ...projectedItems])
      )
    );
  }

  getProviderCapabilitiesSnapshot(provider: string): ProviderCapabilities {
    try {
      return this.resolveProviderCapabilitiesImmediate(
        this.applyProviderCliAvailability(this.capabilityService.getProviderCapabilities(provider)),
        null
      );
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
      const baseCapabilities = this.applyProviderCliAvailability(
        this.capabilityService.getProviderCapabilities(provider)
      );

      if (baseCapabilities.provider === "opencode" && workspacePath) {
        const refreshed = await this.enrichProviderCapabilities(baseCapabilities, workspacePath);
        const cacheKey = buildProviderCapabilityCacheKey(baseCapabilities.provider, workspacePath);
        this.providerCapabilityCache.set(cacheKey, {
          refreshedAt: Date.now(),
          value: refreshed
        });
        return refreshed;
      }

      this.scheduleProviderCapabilityRefresh(baseCapabilities, workspacePath);
      return this.resolveProviderCapabilitiesImmediate(baseCapabilities, workspacePath);
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  async getSessionCapabilities(sessionId: string): Promise<ProviderCapabilities> {
    const binding = this.getBindingOrThrow(sessionId);
    const workspace = this.getWorkspaceOrThrow(binding.workspaceId);
    const workspacePath = workspace.path;

    return this.capabilityService
      .getSessionCapabilities(binding.provider, binding.providerSessionId)
      .then((capabilities) => {
        const normalizedCapabilities = this.applyProviderCliAvailability(capabilities);

        if (normalizedCapabilities.provider === "opencode") {
          return this.enrichProviderCapabilities(normalizedCapabilities, workspacePath)
            .then((refreshed) => {
              const cacheKey = buildProviderCapabilityCacheKey(
                normalizedCapabilities.provider,
                workspacePath
              );
              this.providerCapabilityCache.set(cacheKey, {
                refreshedAt: Date.now(),
                value: refreshed
              });
              return refreshed;
            });
        }

        this.scheduleProviderCapabilityRefresh(normalizedCapabilities, workspacePath);
        return this.resolveProviderCapabilitiesImmediate(normalizedCapabilities, workspacePath);
      })
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

  private resolveProviderCapabilitiesImmediate(
    capabilities: ProviderCapabilities,
    workspacePath: string | null
  ): ProviderCapabilities {
    const cacheKey = buildProviderCapabilityCacheKey(capabilities.provider, workspacePath);
    const cached = this.providerCapabilityCache.get(cacheKey);

    if (cached) {
      this.taskManager.recordCacheHit(HOST_TASK_TYPES.providerCapabilityRefresh, cacheKey);
      return cached.value;
    }

    const claudeEnriched = enrichClaudeCapabilities(capabilities, {
      claudeHomeDir: this.claudeCodeHomeDir,
      workspacePath
    });

    return applyImmediateModelOptionFallbacks(
      claudeEnriched,
      this.codexModelOptionsService.peekSnapshot(),
      this.openCodeModelOptionsService.peekSnapshot(workspacePath)
    );
  }

  private scheduleProviderCapabilityRefresh(
    capabilities: ProviderCapabilities,
    workspacePath: string | null
  ): void {
    const cacheKey = buildProviderCapabilityCacheKey(capabilities.provider, workspacePath);
    const cached = this.providerCapabilityCache.get(cacheKey);

    if (
      cached &&
      Date.now() - cached.refreshedAt <= PROVIDER_CAPABILITY_CACHE_MAX_AGE_MS
    ) {
      return;
    }

    const task = this.taskManager.enqueue<{
      capabilities: ProviderCapabilities;
      workspacePath: string | null;
    }, void>(HOST_TASK_TYPES.providerCapabilityRefresh, {
      key: cacheKey,
      source: "session_history.provider_capability_refresh",
      input: {
        capabilities,
        workspacePath
      }
    });

    if (task.deduped) {
      return;
    }

    void task.promise.catch((error) => {
        logPerformance(
          "provider.capabilities.background_failed",
          0,
          {
            provider: capabilities.provider,
            workspacePath,
            error: error instanceof Error ? error.message : "unknown"
          },
          {
            thresholdMs: 0,
            force: true
          }
        );
      });
  }

  private applyProviderCliAvailability(capabilities: ProviderCapabilities): ProviderCapabilities {
    if (!isProviderCliBacked(capabilities.provider)) {
      return capabilities;
    }

    if (this.providerCliAvailability[capabilities.provider]) {
      return capabilities;
    }

    const limitation = buildProviderCliUnavailableMessage(capabilities.provider);
    const limitations = capabilities.limitations.includes(limitation)
      ? capabilities.limitations
      : [limitation, ...capabilities.limitations];

    return {
      ...capabilities,
      canStartSession: false,
      canResumeSession: false,
      canSendMessage: false,
      supportsSubagents: false,
      supportsInterrupt: false,
      supportsSessionFork: false,
      supportsNativeAgents: false,
      limitations
    };
  }

  private assertProviderCapabilityEnabled(
    provider: string,
    capability: "canStartSession" | "canResumeSession",
    fallbackDetail: string
  ): void {
    const capabilities = this.getProviderCapabilitiesSnapshot(provider);

    if (capabilities[capability]) {
      return;
    }

    throw new AppError({
      statusCode: 409,
      errorCode: "PROVIDER_UNAVAILABLE",
      detail: capabilities.limitations[0] ?? fallbackDetail,
      field: "provider"
    });
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
    this.assertProviderCapabilityEnabled(
      binding.provider,
      "canResumeSession",
      "当前 provider 不支持继续会话"
    );

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
    if (SESSION_START_DEFERRED_PROVIDERS.has(input.provider)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_START_DEFERRED",
        detail: "当前 provider 仅支持在首条消息发送时通过 start-live 创建原生会话",
        field: "provider"
      });
    }

    return this.startSessionDirect(input);
  }

  private async startSessionDirect(input: StartSessionInput): Promise<SessionListItem> {
    const workspace = this.getWorkspaceOrThrow(input.workspaceId);
    this.assertProviderCapabilityEnabled(
      input.provider,
      "canStartSession",
      "当前 provider 不支持创建会话"
    );
    const sessionId = createId();
    const providerBinding = this.prepareDirectSessionBinding({
      sessionId,
      provider: input.provider,
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null
    });

    try {
      const result = await this.startProviderSessionWithBinding(
        input.provider,
        workspace.path,
        providerBinding.runtimeHomeDir,
        {
          initialPrompt: input.initialPrompt
        }
      );
      const timestamp = nowIso();

      const persist = this.db.transaction(() => {
        this.sessionBindingRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          providerSessionId: result.session.providerSessionId,
          rawStoreRef: result.session.rawStoreRef,
          providerConfigMode: providerBinding.providerConfigMode,
          providerPresetId: providerBinding.providerPresetId,
          runtimeHomeDir: providerBinding.runtimeHomeDir,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionIndexRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          parentSessionId: input.parentSessionId ?? result.session.parentProviderSessionId ?? null,
          sessionKind: input.sessionKind ?? "default",
          annotationSourceMessageId: input.annotationSourceMessageId ?? null,
          annotationSourceText: input.annotationSourceText ?? null,
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

  async forkSession(input: ForkSessionInput): Promise<SessionListItem> {
    const binding = this.getBindingOrThrow(input.sessionId);
    const targetWorkspaceId = input.targetWorkspaceId?.trim() || binding.workspaceId;
    const workspace = this.getWorkspaceOrThrow(targetWorkspaceId);
    const targetProvider = input.targetProvider?.trim() || binding.provider;
    this.assertProviderCapabilityEnabled(
      targetProvider,
      "canStartSession",
      "当前 provider 不支持 fork 创建会话"
    );
    const sourceMessageId =
      input.sourceType === "message"
        ? input.sourceMessageId?.trim() || null
        : null;

    if (input.sourceType === "message" && !sourceMessageId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "按消息派生会话时必须提供 sourceMessageId",
        field: "sourceMessageId"
      });
    }

    this.assertForkDepthWithinLimit(input.sessionId);

    const requestedTargetSelection = resolveRequestedProviderSelection({
      existingBinding: targetProvider === binding.provider ? binding : null,
      providerConfigMode: input.providerConfigMode ?? undefined,
      providerPresetId: input.providerPresetId ?? undefined
    });

    if (
      targetProvider !== binding.provider
      || !areEquivalentProviderBindingSelection(binding, requestedTargetSelection)
    ) {
      return this.forkSessionAcrossProviders({
        ...input,
        targetProvider,
        providerConfigMode: requestedTargetSelection.providerConfigMode,
        providerPresetId: requestedTargetSelection.providerPresetId
      }, binding, sourceMessageId);
    }

    try {
      const result = await this.sessionSyncService.forkSession(
        binding.provider,
        binding.providerSessionId,
        workspace.path,
        {
          rawStoreRef: binding.rawStoreRef,
          sourceType: input.sourceType,
          sourceMessageId,
          sourceMessageSnapshot: input.sourceMessageSnapshot ?? null,
          strategy: input.strategy ?? "auto"
        }
      );
      const sessionId = createId();
      const timestamp = nowIso();

      this.db.transaction(() => {
        this.sessionBindingRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          providerSessionId: result.session.providerSessionId,
          rawStoreRef: result.session.rawStoreRef,
          providerConfigMode: binding.providerConfigMode,
          providerPresetId: binding.providerPresetId,
          runtimeHomeDir: binding.runtimeHomeDir,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionIndexRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          parentSessionId: input.sessionId,
          sessionKind: input.sessionKind ?? "default",
          annotationSourceMessageId: input.annotationSourceMessageId ?? null,
          annotationSourceText: input.annotationSourceText ?? null,
          isSubagent: result.session.isSubagent ?? false,
          subagentLabel: result.session.subagentLabel ?? null,
          title: result.session.title,
          messageCount: result.session.messageCount,
          isArchived: result.session.isArchived ?? false,
          lastMessageAt: result.session.lastMessageAt,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionForkRepository.upsert({
          sessionId,
          parentSessionId: input.sessionId,
          provider: result.session.provider,
          forkSourceType: result.forkSourceType,
          forkSourceSessionId: input.sessionId,
          forkSourceMessageId: sourceMessageId,
          inheritedPrefixMessageCount: result.inheritedPrefixMessageCount,
          providerParentSessionId: binding.providerSessionId,
          providerSourceMessageId: result.providerSourceMessageId ?? null,
          forkMethod: result.forkMethod,
          createdAt: timestamp
        });
        this.sessionStatusSnapshotRepository.upsert({
          sessionId,
          syncStatus: "idle",
          syncCursor: null,
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
      })();

      const forkedSession = this.getSessionListItemOrThrow(sessionId, input.userId);
      const relationMap =
        this.workspaceSessionRelations.get(workspace.id)
        ?? new Map<string, SessionRelationDescriptor>();

      relationMap.set(sessionId, {
        parentSessionId: input.sessionId,
        sessionKind: forkedSession.sessionKind ?? input.sessionKind ?? "default",
        annotationSourceMessageId:
          forkedSession.annotationSourceMessageId ?? input.annotationSourceMessageId ?? null,
        annotationSourceText:
          forkedSession.annotationSourceText ?? input.annotationSourceText ?? null,
        isSubagent: forkedSession.isSubagent ?? false,
        subagentLabel: forkedSession.subagentLabel ?? null
      });
      this.workspaceSessionRelations.set(workspace.id, relationMap);

      return this.getSessionListItemOrThrow(sessionId, input.userId);
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  private async forkSessionAcrossProviders(
    input: ForkSessionInput & { targetProvider: string },
    sourceBinding: SessionBinding,
    sourceMessageId: string | null
  ): Promise<SessionListItem> {
    if (!RECONSTRUCTED_FORK_TARGET_PROVIDERS.has(input.targetProvider)) {
      throw mapSessionProviderError(new Error("FORK_TARGET_PROVIDER_NOT_SUPPORTED"));
    }

    const sourceIndex = this.sessionIndexRepository.findIndexRecordBySessionId(input.sessionId);
    const inheritedMessages = await this.readForkSourceMessages(
      input.sessionId,
      sourceBinding,
      input.sourceType,
      sourceMessageId,
      input.sourceMessageSnapshot ?? null
    );
    const reconstructedMessages = inheritedMessages.filter(
      (message) =>
        (message.role === "user" || message.role === "assistant")
        && message.kind === "text"
        && message.content.trim().length > 0
    );
    const inheritedPrompt = buildReconstructedForkPrompt({
      sourceProvider: sourceBinding.provider,
      targetProvider: input.targetProvider,
      sourceType: input.sourceType,
      sourceTitle: sourceIndex?.title?.trim() || null,
      messages: reconstructedMessages
    });
    const startedSession = await this.startSessionDirect({
      workspaceId: input.targetWorkspaceId?.trim() || sourceBinding.workspaceId,
      userId: input.userId,
      provider: input.targetProvider,
      initialPrompt: inheritedPrompt,
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null,
      parentSessionId: input.sessionId,
      sessionKind: input.sessionKind ?? "default",
      annotationSourceMessageId: input.annotationSourceMessageId ?? null,
      annotationSourceText: input.annotationSourceText ?? null
    });
    const timestamp = nowIso();
    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(startedSession.sessionId);

    this.db.transaction(() => {
      if (currentIndex) {
        this.sessionIndexRepository.upsert({
          ...currentIndex,
          parentSessionId: input.sessionId,
          sessionKind: input.sessionKind ?? currentIndex.sessionKind ?? "default",
          annotationSourceMessageId:
            input.annotationSourceMessageId ?? currentIndex.annotationSourceMessageId ?? null,
          annotationSourceText:
            input.annotationSourceText ?? currentIndex.annotationSourceText ?? null,
          updatedAt: timestamp
        });
      }

      this.sessionForkRepository.upsert({
        sessionId: startedSession.sessionId,
        parentSessionId: input.sessionId,
        provider: input.targetProvider,
        forkSourceType: input.sourceType,
        forkSourceSessionId: input.sessionId,
        forkSourceMessageId: sourceMessageId,
        inheritedPrefixMessageCount: reconstructedMessages.length,
        providerParentSessionId: sourceBinding.providerSessionId,
        providerSourceMessageId: null,
        forkMethod:
          input.sourceType === "session"
            ? "reconstructed_session_fork"
            : "reconstructed_message_fork",
        createdAt: timestamp
      });
    })();

    const relationMap =
      this.workspaceSessionRelations.get(input.targetWorkspaceId?.trim() || sourceBinding.workspaceId)
      ?? new Map<string, SessionRelationDescriptor>();

    relationMap.set(startedSession.sessionId, {
      parentSessionId: input.sessionId,
      sessionKind: startedSession.sessionKind ?? input.sessionKind ?? "default",
      annotationSourceMessageId:
        startedSession.annotationSourceMessageId ?? input.annotationSourceMessageId ?? null,
      annotationSourceText:
        startedSession.annotationSourceText ?? input.annotationSourceText ?? null,
      isSubagent: startedSession.isSubagent ?? false,
      subagentLabel: startedSession.subagentLabel ?? null
    });
    this.workspaceSessionRelations.set(
      input.targetWorkspaceId?.trim() || sourceBinding.workspaceId,
      relationMap
    );

    return this.getSessionListItemOrThrow(startedSession.sessionId, input.userId);
  }

  private prepareDirectSessionBinding(input: {
    sessionId: string;
    provider: string;
    providerConfigMode?: SessionProviderConfigMode | null;
    providerPresetId?: string | null;
  }) {
    if (!this.sessionProviderConfigService) {
      return {
        providerConfigMode: "global-default" as const,
        providerPresetId: null,
        runtimeHomeDir: null
      };
    }

    return this.sessionProviderConfigService.prepareSessionBinding({
      sessionId: input.sessionId,
      provider: input.provider as SessionBinding["provider"],
      providerConfigMode: input.providerConfigMode ?? undefined,
      providerPresetId: input.providerPresetId ?? null
    });
  }

  private startProviderSessionWithBinding(
    provider: string,
    workspacePath: string,
    runtimeHomeDir: string | null,
    options: {
      initialPrompt?: string;
    }
  ) {
    const scopedRuntimeHomeDir = runtimeHomeDir?.trim() || null;

    if (!scopedRuntimeHomeDir) {
      return this.sessionSyncService.startSession(provider, workspacePath, options);
    }

    switch (provider) {
      case "claude-code":
        return new ClaudeCodeAdapter({ homeDir: scopedRuntimeHomeDir }).startSession(workspacePath, options);
      case "codex":
        return new CodexAdapter({ homeDir: scopedRuntimeHomeDir }).startSession(workspacePath, options);
      case "gemini":
        return new GeminiAdapter({
          homeDir: scopedRuntimeHomeDir,
          commandPath: this.providerSessionDiscoveryConfig.geminiCliPath
        }).startSession(workspacePath, options);
      default:
        return this.sessionSyncService.startSession(provider, workspacePath, options);
    }
  }

  private async readForkSourceMessages(
    sessionId: string,
    binding: SessionBinding,
    sourceType: ForkSourceType,
    sourceMessageId: string | null,
    sourceMessageSnapshot: ForkSourceMessageSnapshot | null = null
  ): Promise<HistoryPage["messages"]> {
    const messages: HistoryPage["messages"] = [];
    let cursor: string | null = null;

    while (true) {
      const page = await this.readPage(
        sessionId,
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        FORK_RECONSTRUCTION_PAGE_SIZE,
        "forward"
      );

      messages.push(...page.messages);

      if (!page.nextCursor) {
        break;
      }

      cursor = page.nextCursor;
    }

    if (sourceType === "session") {
      return messages;
    }

    const targetIndex = messages.findIndex((message) => message.messageId === sourceMessageId);

    if (targetIndex < 0) {
      throw mapSessionProviderError(new Error("FORK_SOURCE_MESSAGE_NOT_FOUND"));
    }

    const inheritedMessages = messages.slice(0, targetIndex + 1);

    if (!sourceMessageSnapshot) {
      return inheritedMessages;
    }

    const targetMessage = inheritedMessages[targetIndex];

    if (!targetMessage) {
      return inheritedMessages;
    }

    inheritedMessages[targetIndex] = {
      ...targetMessage,
      role: sourceMessageSnapshot.role,
      kind: sourceMessageSnapshot.kind,
      content: sourceMessageSnapshot.content
    };

    return inheritedMessages;
  }

  private assertForkDepthWithinLimit(parentSessionId: string) {
    const nextDepth = this.getSessionForkDepth(parentSessionId) + 1;

    if (nextDepth > MAX_FORK_DEPTH) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FORK_DEPTH_LIMIT_EXCEEDED",
        detail: `fork 会话层级最多支持 ${MAX_FORK_DEPTH} 级`
      });
    }
  }

  private getSessionForkDepth(sessionId: string): number {
    let depth = 1;
    let currentSessionId: string | null = sessionId;
    const visitedSessionIds = new Set<string>();

    while (currentSessionId) {
      if (visitedSessionIds.has(currentSessionId)) {
        return depth;
      }

      visitedSessionIds.add(currentSessionId);

      const parentSessionId: string | null =
        this.sessionForkRepository.findBySessionId(currentSessionId)?.parentSessionId
        ?? this.sessionIndexRepository.findIndexRecordBySessionId(currentSessionId)?.parentSessionId
        ?? null;

      if (!parentSessionId) {
        return depth;
      }

      depth += 1;
      currentSessionId = parentSessionId;
    }

    return depth;
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
    const sessionFork = this.sessionForkRepository.findBySessionId(sessionId);
    const parentTitle =
      sessionFork?.parentSessionId
        ? this.sessionIndexRepository.findIndexRecordBySessionId(sessionFork.parentSessionId)?.title ?? null
        : null;

    this.sessionIndexRepository.upsert({
      sessionId,
      workspaceId: binding.workspaceId,
      provider: binding.provider,
      parentSessionId: existing?.parentSessionId ?? null,
      sessionKind: existing?.sessionKind ?? "default",
      annotationSourceMessageId: existing?.annotationSourceMessageId ?? null,
      annotationSourceText: existing?.annotationSourceText ?? null,
      isSubagent: existing?.isSubagent ?? false,
      subagentLabel: existing?.subagentLabel ?? null,
      title: resolveSessionListTitle(
        binding.provider,
        existing?.title ?? null,
        result.message.content,
        parentTitle
      ),
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
    const deliveredMessages = createDeliveredHistoryMessageState();
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
          deliveredMessages,
          onEnvelope,
          "session.backfill"
        );
      } else {
        await this.pullSessionHistory(
          sessionId,
          currentCursor,
          safeLimit,
          deliveredMessages,
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
        deliveredMessages,
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

  async readAllTextHistoryMessages(
    sessionId: string,
    limit = FORK_RECONSTRUCTION_PAGE_SIZE
  ): Promise<HistoryPage["messages"]> {
    const binding = this.getBindingOrThrow(sessionId);
    const messages: HistoryPage["messages"] = [];
    let cursor: string | null = null;
    let remaining = Math.max(limit, 0);

    while (remaining > 0) {
      const pageSize = Math.min(remaining, FORK_RECONSTRUCTION_PAGE_SIZE);
      const page = await this.readPage(
        sessionId,
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        pageSize,
        "forward"
      );

      messages.push(
        ...page.messages.filter(
          (message) =>
            (message.role === "user" || message.role === "assistant")
            && message.kind === "text"
            && message.content.trim().length > 0
        )
      );

      if (!page.nextCursor || page.messages.length === 0) {
        break;
      }

      cursor = page.nextCursor;
      remaining -= page.messages.length;
    }

    return messages;
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
      sessionKind: existing.sessionKind ?? "default",
      annotationSourceMessageId: existing.annotationSourceMessageId ?? null,
      annotationSourceText: existing.annotationSourceText ?? null,
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

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const binding = this.getBindingOrThrow(sessionId);
    const existing = this.getSessionListItemOrThrow(sessionId, userId);
    const resolvedExisting =
      existing.runningState === "starting" || existing.runningState === "running"
        ? await this.refreshRuntimeFallbackSession(sessionId, userId).catch(() => existing)
        : existing;

    if (resolvedExisting.runningState === "starting" || resolvedExisting.runningState === "running") {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_DELETE_RUNNING",
        detail: "运行中的会话不能直接删除，请先等当前执行结束",
        field: "sessionId"
      });
    }

    try {
      await this.providerSessionDeleteCli.deleteSession({
        provider: binding.provider,
        providerSessionId: binding.providerSessionId,
        rawStoreRef: binding.rawStoreRef
      });
    } catch (error) {
      if (!isProviderSessionMissing(error)) {
        throw mapSessionProviderError(error);
      }
    }

    for (const observer of this.sessionDeletedObservers) {
      await observer({
        sessionId,
        userId,
        workspaceId: binding.workspaceId,
        remainingWorkspaceSessionCount: this.countOtherWorkspaceSessions(
          binding.workspaceId,
          sessionId
        )
      });
    }

    const deleteTransaction = this.db.transaction((targetSessionId: string) => {
      this.detachSessionRelationsBeforeDelete(targetSessionId);
      this.deleteSessionById(targetSessionId);
    });

    deleteTransaction(sessionId);
    this.removeWorkspaceSessionRelation(sessionId);
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
    // discovery 和 runtime 回填会并发命中这里；如果在事务外先看重复，再事务内写入，
    // 中间就会留下一个竞态窗口，最后直接撞 UNIQUE(provider, provider_session_id)。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.db.transaction(() => {
          const currentBinding = this.sessionBindingRepository.findBySessionId(sessionId);
          const timestamp = nowIso();
          const duplicateBinding = this.findSameWorkspaceBindingDuplicate(
            sessionId,
            workspaceId,
            resolvedSnapshot
          );

          if (duplicateBinding) {
            // 运行时链路显式指定了当前 sessionId，就应该由当前会话接管同工作区里的重复底层会话。
            // 否则后续事件重放或后台发现补录都会持续撞 UNIQUE(provider, provider_session_id)。
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
            providerConfigMode:
              currentBinding?.providerConfigMode
              ?? duplicateBinding?.providerConfigMode
              ?? "global-default",
            providerPresetId:
              currentBinding?.providerPresetId
              ?? duplicateBinding?.providerPresetId
              ?? null,
            runtimeHomeDir:
              currentBinding?.runtimeHomeDir
              ?? duplicateBinding?.runtimeHomeDir
              ?? null,
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
        return;
      } catch (error) {
        if (attempt === 0 && isSessionBindingProviderUniqueConflict(error)) {
          continue;
        }

        throw error;
      }
    }
  }

  private async runDiscoverWorkspaceSessions(
    workspaceId: string,
    userId: string,
    refreshStateMode: "inline" | "deferred" = "inline",
    signal?: AbortSignal
  ): Promise<SessionListItem[]> {
    const startedAt = Date.now();
    const debugStartedAtMs = terminalDebugNowMs();
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    let discoverDurationMs = 0;
    let persistDurationMs = 0;
    let persistPass1DurationMs = 0;
    let persistPass1BatchCount = 0;
    let persistPass1MaxBatchMs = 0;
    let relationMapDurationMs = 0;
    let persistPass2DurationMs = 0;
    let persistPass2BatchCount = 0;
    let persistPass2MaxBatchMs = 0;
    let cleanupDurationMs = 0;
    let listItemsDurationMs = 0;
    let refreshStateDurationMs = 0;
    const refreshStateCount = 10;

    try {
      const discoverStartedAt = Date.now();
      const existingWorkspaceSessions = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);
      const knownSessions = this.buildKnownSessionSummaries(
        existingWorkspaceSessions,
        workspace.path
      );
      const discoveryHandle = this.taskManager.enqueue<{
        config: ProviderSessionDiscoveryHelperConfig;
        workspacePath: string;
        knownSessions: import("@codingns/session-sync-core").ProviderSessionSummary[];
      }, ProviderSessionDiscovery>(HOST_TASK_TYPES.workspaceDiscoveryScan, {
        key: workspaceId,
        source: "session_history.workspace_discovery.scan",
        input: {
          config: this.providerSessionDiscoveryConfig,
          workspacePath: workspace.path,
          knownSessions
        }
      });
      const discovery = await awaitTaskHandleWithSignal(discoveryHandle, signal).catch((error) => {
        throw mapSessionProviderError(error);
      });
      const sessions = discovery.sessions;
      discoverDurationMs = Date.now() - discoverStartedAt;
      const timestamp = nowIso();
      const discoveredSessionIds = new Map<string, string>();
      const persistedSessions: PersistedSessionDescriptor[] = [];
      const claimedPendingSessionIds = new Set<string>();
      const persistPass1Transaction = this.db.transaction((batch: typeof sessions) => {
        for (const session of batch) {
          const exactExisting =
            this.sessionBindingRepository.findByProviderSession(
              session.provider,
              session.providerSessionId
            ) ?? (
              shouldMatchSessionBindingByRawStoreRef(session.provider)
                ? this.sessionBindingRepository.findByRawStoreRef(session.provider, session.rawStoreRef)
                : null
            );

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
          const nextBinding: SessionBinding = {
            sessionId,
            workspaceId: workspace.id,
            provider: session.provider,
            providerSessionId: session.providerSessionId,
            rawStoreRef: session.rawStoreRef,
            providerConfigMode: existing?.providerConfigMode ?? "global-default",
            providerPresetId: existing?.providerPresetId ?? null,
            runtimeHomeDir: existing?.runtimeHomeDir ?? null,
            createdAt,
            updatedAt: timestamp
          };

          if (!areEquivalentSessionBindings(existing, nextBinding)) {
            this.sessionBindingRepository.upsert(nextBinding);
          }
          const preservedParentSessionId =
            existingIndex?.parentSessionId
            ?? this.sessionForkRepository.findBySessionId(sessionId)?.parentSessionId
            ?? null;
          const preservedParentTitle =
            preservedParentSessionId
              ? this.sessionIndexRepository.findIndexRecordBySessionId(preservedParentSessionId)?.title ?? null
              : null;
          const preservedTitle = resolvePersistedSessionTitle(
            session.provider,
            session.title,
            existingIndex?.title ?? null,
            preservedParentTitle
          );
          const nextIndex: SessionIndexRecord = {
            sessionId,
            workspaceId: workspace.id,
            provider: session.provider,
            parentSessionId: preservedParentSessionId,
            sessionKind: existingIndex?.sessionKind ?? "default",
            annotationSourceMessageId: existingIndex?.annotationSourceMessageId ?? null,
            annotationSourceText: existingIndex?.annotationSourceText ?? null,
            isSubagent: existingIndex?.isSubagent ?? false,
            subagentLabel: existingIndex?.subagentLabel ?? null,
            title: preservedTitle,
            messageCount: session.messageCount,
            isArchived: resolveDiscoveredArchiveState(
              session.provider,
              existingIndex?.isArchived ?? false,
              session.isArchived
            ),
            lastMessageAt: session.lastMessageAt,
            createdAt,
            updatedAt: timestamp
          };

          if (!areEquivalentSessionIndexRecords(existingIndex, nextIndex)) {
            this.sessionIndexRepository.upsert(nextIndex);
          }

          const nextSnapshot: SessionStatusSnapshot = {
            sessionId,
            syncStatus: currentSnapshot?.syncStatus ?? "idle",
            syncCursor: currentSnapshot?.syncCursor ?? null,
            lastSyncAt: currentSnapshot?.lastSyncAt ?? null,
            lastErrorCode: currentSnapshot?.lastErrorCode ?? null,
            lastErrorDetail: currentSnapshot?.lastErrorDetail ?? null,
            resumedAt: currentSnapshot?.resumedAt ?? null,
            updatedAt: timestamp
          };

          if (!areEquivalentSessionStatusSnapshots(currentSnapshot, nextSnapshot)) {
            this.sessionStatusSnapshotRepository.upsert(nextSnapshot);
          }
          discoveredSessionIds.set(
            buildProviderSessionKey(session.provider, session.providerSessionId),
            sessionId
          );
          persistedSessions.push({
            session,
            sessionId,
            createdAt,
            existingIndex,
            pass1Index: nextIndex
          });
        }
      });

      const persistPass1StartedAt = Date.now();
      const persistPass1Stats = await runBatchedTransactions(
        sessions,
        WORKSPACE_DISCOVERY_PERSIST_BATCH_SIZE,
        persistPass1Transaction,
        {
          scope: "workspace.discover_sessions.persist_pass1.batch",
          thresholdMs: SESSION_TRANSACTION_HOTSPOT_THRESHOLD_MS,
          detail: {
            workspaceId,
            workspacePath: workspace.path,
            phase: "pass1"
          }
        }
      );
      persistPass1DurationMs = Date.now() - persistPass1StartedAt;
      persistPass1BatchCount = persistPass1Stats.batchCount;
      persistPass1MaxBatchMs = persistPass1Stats.maxBatchMs;

      const relationMapStartedAt = Date.now();
      const relationMap = this.buildWorkspaceSessionRelationMap(sessions, discoveredSessionIds);
      relationMapDurationMs = Date.now() - relationMapStartedAt;

      const persistPass2Transaction = this.db.transaction((batch: PersistedSessionDescriptor[]) => {
        for (const persistedSession of batch) {
          const relation = relationMap.get(persistedSession.sessionId);
          const resolvedParentSessionId =
            relation?.parentSessionId
            ?? persistedSession.existingIndex?.parentSessionId
            ?? this.sessionForkRepository.findBySessionId(persistedSession.sessionId)?.parentSessionId
            ?? null;
          const resolvedParentTitle =
            resolvedParentSessionId
              ? this.sessionIndexRepository.findIndexRecordBySessionId(resolvedParentSessionId)?.title ?? null
              : null;

          const nextIndex: SessionIndexRecord = {
            sessionId: persistedSession.sessionId,
            workspaceId: workspace.id,
            provider: persistedSession.session.provider,
            parentSessionId: resolvedParentSessionId,
            sessionKind:
              relation?.sessionKind
              ?? persistedSession.existingIndex?.sessionKind
              ?? "default",
            annotationSourceMessageId:
              relation?.annotationSourceMessageId
              ?? persistedSession.existingIndex?.annotationSourceMessageId
              ?? null,
            annotationSourceText:
              relation?.annotationSourceText
              ?? persistedSession.existingIndex?.annotationSourceText
              ?? null,
            isSubagent:
              relation?.isSubagent
              ?? persistedSession.existingIndex?.isSubagent
              ?? false,
            subagentLabel:
              relation?.subagentLabel
              ?? persistedSession.existingIndex?.subagentLabel
              ?? null,
            title: resolvePersistedSessionTitle(
              persistedSession.session.provider,
              persistedSession.session.title,
              persistedSession.existingIndex?.title ?? null,
              resolvedParentTitle
            ),
            messageCount: persistedSession.session.messageCount,
            isArchived: resolveDiscoveredArchiveState(
              persistedSession.session.provider,
              persistedSession.existingIndex?.isArchived ?? false,
              persistedSession.session.isArchived
            ),
            lastMessageAt: persistedSession.session.lastMessageAt,
            createdAt: persistedSession.createdAt,
            updatedAt: timestamp
          };

          if (!areEquivalentSessionIndexRecords(persistedSession.pass1Index, nextIndex)) {
            this.sessionIndexRepository.upsert(nextIndex);
          }
        }
      });

      const persistPass2StartedAt = Date.now();
      const persistPass2Stats = await runBatchedTransactions(
        persistedSessions,
        WORKSPACE_DISCOVERY_PERSIST_BATCH_SIZE,
        persistPass2Transaction,
        {
          scope: "workspace.discover_sessions.persist_pass2.batch",
          thresholdMs: SESSION_TRANSACTION_HOTSPOT_THRESHOLD_MS,
          detail: {
            workspaceId,
            workspacePath: workspace.path,
            phase: "pass2"
          }
        }
      );
      persistPass2DurationMs = Date.now() - persistPass2StartedAt;
      persistPass2BatchCount = persistPass2Stats.batchCount;
      persistPass2MaxBatchMs = persistPass2Stats.maxBatchMs;
      persistDurationMs = persistPass1DurationMs + relationMapDurationMs + persistPass2DurationMs;
      if (discovery.isComplete) {
        const cleanupStartedAt = Date.now();
        await this.cleanupStaleHiddenSessions(workspaceId, userId, sessions);
        cleanupDurationMs = Date.now() - cleanupStartedAt;
      }
      this.workspaceSessionRelations.set(
        workspaceId,
        relationMap
      );

      const listItemsStartedAt = Date.now();
      const items = this.sessionIndexRepository.listByWorkspace(workspaceId, userId);
      listItemsDurationMs = Date.now() - listItemsStartedAt;
      const refreshCandidates = buildSessionStateRefreshCandidates(items, refreshStateCount);
      this.workspaceDiscoveryStatuses.set(workspaceId, {
        refreshedAt: Date.now(),
        isComplete: discovery.isComplete
      });

      const refreshStateStartedAt = Date.now();
      if (refreshStateMode === "inline") {
        await this.refreshRecentSessionStates(refreshCandidates, userId);
      } else {
        this.scheduleWorkspaceStateRefresh(workspaceId, userId, refreshCandidates);
      }
      refreshStateDurationMs = Date.now() - refreshStateStartedAt;

      const nextItems = this.listWorkspaceSessions(workspaceId, userId);

      if (isTerminalDebugEnabled()) {
        logTerminalDebug("workspace.discovery.completed", {
          workspaceId,
          sessionCount: sessions.length,
          returnedSessionCount: nextItems.length,
          discoverMs: discoverDurationMs,
          persistMs: persistDurationMs,
          persistPass1Ms: persistPass1DurationMs,
          persistPass1BatchCount,
          persistPass1MaxBatchMs,
          relationMapMs: relationMapDurationMs,
          persistPass2Ms: persistPass2DurationMs,
          persistPass2BatchCount,
          persistPass2MaxBatchMs,
          cleanupMs: cleanupDurationMs,
          listItemsMs: listItemsDurationMs,
          refreshStateMs: refreshStateDurationMs,
          refreshStateDeferred: refreshStateMode !== "inline",
          durationMs: terminalDebugNowMs() - debugStartedAtMs
        });
      }

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
          providerDiagnostics: (discovery.providerDiagnostics ?? []).map((entry) => {
            const scannedFiles = entry.scannedFiles ?? 0;
            const skippedByMtimeSize = entry.skippedByMtimeSize ?? 0;
            const parsedFiles = entry.parsedFiles ?? 0;
            const bytesRead = entry.bytesRead ?? 0;

            return [
              entry.provider,
              entry.status,
              `${Math.round(entry.durationMs)}ms`,
              `sessions=${entry.sessionCount}`,
              `scanned=${scannedFiles}`,
              `skipped=${skippedByMtimeSize}`,
              `parsed=${parsedFiles}`,
              `bytes=${bytesRead}`
            ].join(":");
          }),
          refreshedStates: refreshCandidates.length,
          discoverMs: discoverDurationMs,
          persistMs: persistDurationMs,
          persistPass1Ms: persistPass1DurationMs,
          persistPass1BatchCount,
          persistPass1MaxBatchMs,
          relationMapMs: relationMapDurationMs,
          persistPass2Ms: persistPass2DurationMs,
          persistPass2BatchCount,
          persistPass2MaxBatchMs,
          cleanupMs: cleanupDurationMs,
          listItemsMs: listItemsDurationMs,
          refreshStateMs: refreshStateDurationMs,
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
          persistPass1Ms: persistPass1DurationMs,
          persistPass1BatchCount,
          persistPass1MaxBatchMs,
          relationMapMs: relationMapDurationMs,
          persistPass2Ms: persistPass2DurationMs,
          persistPass2BatchCount,
          persistPass2MaxBatchMs,
          cleanupMs: cleanupDurationMs,
          listItemsMs: listItemsDurationMs,
          refreshStateMs: refreshStateDurationMs,
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
      .then(async (page) => {
        const sanitizedPage = await this.sanitizeForkHistoryPage(
          sessionId,
          page,
          cursor,
          direction
        );
        const messagesWithAttachments = this.sessionMessageAttachmentService.enrichMessages(
          sessionId,
          sanitizedPage.messages
        );
        const messages = this.enrichMessagesWithOrigin(sessionId, messagesWithAttachments);
        this.persistSessionChangedFiles(sessionId, messages);

        return {
          ...sanitizedPage,
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

        if (this.shouldTreatMissingGeminiRuntimeHistoryAsEmpty(sessionId, provider, error)) {
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

  private shouldTreatMissingGeminiRuntimeHistoryAsEmpty(
    sessionId: string,
    provider: string,
    error: unknown
  ): boolean {
    if (provider !== "gemini" || !isGeminiChatNotFoundError(error)) {
      return false;
    }

    return this.listSessionStatesBySessionId(sessionId).some(
      (state) =>
        state.activitySource === "runtime"
        && (state.runningState === "starting" || state.runningState === "running")
    );
  }

  private enrichMessagesWithOrigin(
    sessionId: string,
    messages: HistoryPage["messages"]
  ): SessionHistoryMessageWithOrigin[] {
    return this.resolveMessageOrigins(sessionId, messages);
  }

  private async sanitizeForkHistoryPage(
    sessionId: string,
    page: HistoryPage,
    cursor: string | null,
    direction: HistoryDirection
  ): Promise<HistoryPage> {
    if (direction !== "forward" || cursor !== null || page.messages.length === 0) {
      return page;
    }

    const forkRecord = this.sessionForkRepository.findBySessionId(sessionId);

    if (
      !forkRecord
      || forkRecord.forkSourceType !== "message"
      || !forkRecord.forkSourceMessageId
    ) {
      return page;
    }

    const childSession = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);
    const childCreatedAt = childSession?.createdAt?.trim() || null;

    if (!childCreatedAt) {
      return page;
    }

    const parentBinding = this.getBindingOrThrow(forkRecord.forkSourceSessionId);
    const inheritedMessages = await this.readForkSourceMessages(
      forkRecord.forkSourceSessionId,
      parentBinding,
      "message",
      forkRecord.forkSourceMessageId,
      null
    );
    const expectedInheritedCount = inheritedMessages.length;

    if (expectedInheritedCount <= 0) {
      return page;
    }

    const parentMessages = await this.readForkSourceMessages(
      forkRecord.forkSourceSessionId,
      parentBinding,
      "session",
      null,
      null
    );
    let leakedInheritedCount = countCommonHistoryPrefixLength(
      page.messages.slice(expectedInheritedCount),
      parentMessages.slice(expectedInheritedCount)
    );

    if (leakedInheritedCount <= 0) {
      for (let index = expectedInheritedCount; index < page.messages.length; index += 1) {
        const message = page.messages[index];

        if (!message || message.timestamp > childCreatedAt) {
          break;
        }

        leakedInheritedCount += 1;
      }
    }

    if (forkRecord.inheritedPrefixMessageCount !== expectedInheritedCount) {
      this.sessionForkRepository.upsert({
        ...forkRecord,
        inheritedPrefixMessageCount: expectedInheritedCount
      });
    }

    if (leakedInheritedCount <= 0) {
      return page;
    }

    return {
      ...page,
      messages: [
        ...page.messages.slice(0, expectedInheritedCount),
        ...page.messages.slice(expectedInheritedCount + leakedInheritedCount)
      ],
      total: Math.max(0, page.total - leakedInheritedCount)
    };
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

      return {
        ...message,
        origin: null,
        originRef: null
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
        : this.resolvePersistedParentSessionId(sessionId);

      relationMap.set(sessionId, {
        parentSessionId,
        sessionKind:
          this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.sessionKind ?? "default",
        annotationSourceMessageId:
          this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.annotationSourceMessageId ?? null,
        annotationSourceText:
          this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.annotationSourceText ?? null,
        isSubagent:
          session.isSubagent === true
          || this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.isSubagent === true,
        subagentLabel:
          session.subagentLabel?.trim()
          || this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.subagentLabel
          || null
      });
    }

    return relationMap;
  }

  private enrichSessionItems(workspaceId: string, items: SessionListItem[]): SessionListItem[] {
    const relationMap = this.workspaceSessionRelations.get(workspaceId);
    const projectionBySessionId = this.buildParallelProjectionBySessionId(items);

    if (!relationMap) {
      return items.map((item) => this.enrichSessionItem(item, projectionBySessionId.get(item.sessionId)));
    }

    return items.map((item) => {
      const relation = relationMap.get(item.sessionId);

      if (!relation) {
        return this.enrichSessionItem(item, projectionBySessionId.get(item.sessionId));
      }

      return this.enrichSessionItem({
        ...item,
        parentSessionId: relation.parentSessionId,
        sessionKind: relation.sessionKind,
        annotationSourceMessageId: relation.annotationSourceMessageId,
        annotationSourceText: relation.annotationSourceText,
        isSubagent: relation.isSubagent,
        subagentLabel: relation.subagentLabel
      }, projectionBySessionId.get(item.sessionId));
    });
  }

  private enrichSessionItem(
    item: SessionListItem,
    projection?: {
      parallelGroup: NonNullable<SessionListItem["parallelGroup"]>;
      displayParentSessionId: string | null;
      sessionIsolatedWorkspace: SessionListItem["sessionIsolatedWorkspace"];
    }
  ): SessionListItem {
    const resolvedProjection =
      projection
      ?? this.buildParallelProjectionBySessionId([item]).get(item.sessionId);
    const relation = this.workspaceSessionRelations.get(item.workspaceId)?.get(item.sessionId);
    const nextItem = relation
      ? {
          ...item,
          parentSessionId: relation.parentSessionId,
          sessionKind: relation.sessionKind,
          annotationSourceMessageId: relation.annotationSourceMessageId,
          annotationSourceText: relation.annotationSourceText,
          isSubagent: relation.isSubagent,
          subagentLabel: relation.subagentLabel
        }
      : {
          ...item,
          parentSessionId: item.parentSessionId ?? null,
          sessionKind: item.sessionKind ?? "default",
          annotationSourceMessageId: item.annotationSourceMessageId ?? null,
          annotationSourceText: item.annotationSourceText ?? null,
          isSubagent: item.isSubagent ?? false,
          subagentLabel: item.subagentLabel ?? null
        };
    const resolution = this.sessionActivityAuthorityService.resolvePersistedSession(nextItem);

    return applySessionActivityResolution({
      ...nextItem,
      parallelGroup: resolvedProjection?.parallelGroup ?? null,
      displayParentSessionId: resolvedProjection?.displayParentSessionId ?? null,
      sessionIsolatedWorkspace: resolvedProjection?.sessionIsolatedWorkspace ?? null
    }, resolution);
  }

  private buildParallelProjectionBySessionId(items: readonly SessionListItem[]): Map<
    string,
    {
      parallelGroup: NonNullable<SessionListItem["parallelGroup"]>;
      displayParentSessionId: string | null;
      sessionIsolatedWorkspace: SessionListItem["sessionIsolatedWorkspace"];
    }
  > {
    const projectionBySessionId = new Map<
      string,
      {
        parallelGroup: NonNullable<SessionListItem["parallelGroup"]>;
        displayParentSessionId: string | null;
        sessionIsolatedWorkspace: SessionListItem["sessionIsolatedWorkspace"];
      }
    >();

    if (
      !this.parallelSessionGroupRepository
      || !this.parallelSessionMemberRepository
      || !this.sessionIsolatedWorkspaceRepository
      || items.length === 0
    ) {
      return projectionBySessionId;
    }

    const sessionIds = items.map((item) => item.sessionId);
    const members = this.parallelSessionMemberRepository
      .listBySessionIds(sessionIds)
      .filter((member) => member.deletedAt === null);

    if (members.length === 0) {
      return projectionBySessionId;
    }

    const groupIds = [...new Set(members.map((member) => member.groupId))];
    const groups = this.parallelSessionGroupRepository
      .listByIds(groupIds)
      .filter((group) => group.status !== "deleted");
    const groupById = new Map(groups.map((group) => [group.id, group] as const));
    const activeMembersByGroupId = new Map<string, typeof members>();

    for (const member of this.parallelSessionMemberRepository.listByGroupIds(groupIds)) {
      if (member.deletedAt !== null) {
        continue;
      }

      const groupMembers = activeMembersByGroupId.get(member.groupId) ?? [];
      groupMembers.push(member);
      activeMembersByGroupId.set(member.groupId, groupMembers);
    }

    const isolatedWorkspaceBySessionId = new Map(
      this.sessionIsolatedWorkspaceRepository
        .listByOwnerSessionIds(sessionIds)
        .map((record) => [record.ownerSessionId, record] as const)
    );

    for (const member of members) {
      const group = groupById.get(member.groupId);

      if (!group) {
        continue;
      }

      const activeMembers = activeMembersByGroupId.get(member.groupId) ?? [member];
      const isolatedWorkspace = isolatedWorkspaceBySessionId.get(member.sessionId) ?? null;

      projectionBySessionId.set(member.sessionId, {
        parallelGroup: {
          groupId: group.id,
          role: member.sessionId === group.anchorSessionId ? "anchor" : "member",
          memberCount: activeMembers.length,
          sourceType: group.sourceType,
          sourceSessionId: group.sourceSessionId,
          anchorSessionId: group.anchorSessionId,
          colorToken: buildParallelGroupColorToken(group.id)
        },
        displayParentSessionId: resolveParallelDisplayParentSessionId(group, member),
        sessionIsolatedWorkspace:
          isolatedWorkspace
            ? {
                id: isolatedWorkspace.id,
                workspaceId: isolatedWorkspace.workspaceId,
                sourceWorkspaceId: isolatedWorkspace.sourceWorkspaceId,
                branchName: isolatedWorkspace.branchName,
                lifecycleStatus: isolatedWorkspace.lifecycleStatus,
                promotedAt: isolatedWorkspace.promotedAt,
                createdAt: isolatedWorkspace.createdAt,
                updatedAt: isolatedWorkspace.updatedAt
              }
            : null
      });
    }

    return projectionBySessionId;
  }

  private listProjectedIsolatedWorkspaceSessions(
    workspaceId: string,
    userId: string
  ): SessionListItem[] {
    if (!this.sessionIsolatedWorkspaceRepository) {
      return [];
    }

    return this.sessionIsolatedWorkspaceRepository
      .listBySourceWorkspaceId(workspaceId)
      .filter(
        (record) =>
          record.lifecycleStatus === "active"
          || record.lifecycleStatus === "removing"
      )
      .map((record) => this.sessionIndexRepository.findBySessionId(record.ownerSessionId, userId))
      .filter((item): item is SessionListItem => Boolean(item))
      .filter((item) => !this.isPendingSessionAlias(item));
  }

  private async pullSessionHistory(
    sessionId: string,
    cursor: string | null,
    limit: number,
    deliveredMessages: DeliveredHistoryMessageState,
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
      await this.publishHistoryEnvelope(sessionId, binding, page, deliveredMessages, onEnvelope, envelopeType);

      if (
        envelopeType === "session.delta" &&
        shouldRefreshMutableHistoryTail(binding.provider, page, currentCursor, deliveredMessages)
      ) {
        const tailPage = await this.readPage(
          sessionId,
          binding.provider,
          binding.providerSessionId,
          binding.rawStoreRef,
          null,
          Math.max(limit, 20),
          "backward"
        );

        deliveredMessages.lastMutableTailRefreshAtMs = Date.now();
        await this.publishHistoryEnvelope(
          sessionId,
          binding,
          tailPage,
          deliveredMessages,
          onEnvelope,
          envelopeType
        );
      }

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
    deliveredMessages: DeliveredHistoryMessageState,
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

    await this.publishHistoryEnvelope(sessionId, binding, page, deliveredMessages, onEnvelope, envelopeType);
    return page.cursor;
  }

  private async publishHistoryEnvelope(
    sessionId: string,
    binding: SessionBinding,
    page: HistoryPage,
    deliveredMessages: DeliveredHistoryMessageState,
    onEnvelope: (envelope: SessionHistoryEnvelope) => Promise<void> | void,
    envelopeType: SessionHistoryEnvelope["type"]
  ): Promise<void> {
    const messages = page.messages.filter((message) => {
      const nextSignature = buildDeliveredHistoryMessageSignature(message);
      const previousSignature = deliveredMessages.signaturesByMessageId.get(message.messageId);

      if (previousSignature === nextSignature) {
        return false;
      }

      rememberDeliveredHistoryMessage(deliveredMessages, message.messageId, nextSignature);
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
    binding: SessionBinding,
    signal?: AbortSignal
  ): Promise<void> {
    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

    if (!currentIndex) {
      return;
    }

    if (shouldSkipClaudePendingBinding(binding)) {
      return;
    }

    if (!shouldSyncSessionTitleFromProvider(binding.provider, currentIndex.title)) {
      return;
    }

    const nextTitle = (
      await this.providerDiscoveryHelperClient.readSessionTitle({
        config: this.providerSessionDiscoveryConfig,
        provider: binding.provider,
        providerSessionId: binding.providerSessionId,
        rawStoreRef: binding.rawStoreRef
      }, signal)
    ).trim();

    const resolvedTitle = resolvePersistedSessionTitle(
      binding.provider,
      nextTitle,
      currentIndex.title
    );

    if (resolvedTitle.length === 0 || resolvedTitle === currentIndex.title) {
      return;
    }

    this.sessionIndexRepository.upsert({
      ...currentIndex,
      title: resolvedTitle,
      updatedAt: nowIso()
    });
  }

  private resolvePersistedParentSessionId(sessionId: string): string | null {
    return (
      this.sessionForkRepository.findBySessionId(sessionId)?.parentSessionId
      ?? this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.parentSessionId
      ?? null
    );
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
    const canonicalSessionId = this.resolveCanonicalSessionId(sessionId, userId);
    const item =
      this.findSessionListItem(canonicalSessionId, sessionId, userId)
      ?? this.repairMissingSessionListItem(canonicalSessionId, userId)
      ?? (
        canonicalSessionId === sessionId
          ? null
          : this.repairMissingSessionListItem(sessionId, userId)
      )
      ?? this.findSessionListItem(canonicalSessionId, sessionId, userId);

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

  private findSessionListItem(
    canonicalSessionId: string,
    sessionId: string,
    userId: string
  ): SessionListItem | null {
    return (
      this.sessionIndexRepository.findBySessionId(canonicalSessionId, userId)
      ?? (
        canonicalSessionId === sessionId
          ? null
          : this.sessionIndexRepository.findBySessionId(sessionId, userId)
      )
    );
  }

  private repairMissingSessionListItem(sessionId: string, userId: string): SessionListItem | null {
    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

    if (!binding) {
      return null;
    }

    const existingIndex = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);
    const existingSnapshot = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);
    const existingState = this.sessionStateRepository.findBySessionAndUser(sessionId, userId);
    const timestamp = nowIso();
    const fallbackLastMessageAt =
      existingIndex?.lastMessageAt
      ?? existingState?.lastEventAt
      ?? existingSnapshot?.lastSyncAt
      ?? null;
    const fallbackCreatedAt =
      pickEarlierIso(binding.createdAt, existingIndex?.createdAt ?? null)
      ?? timestamp;

    this.db.transaction(() => {
      this.sessionIndexRepository.upsert({
        sessionId,
        workspaceId: binding.workspaceId,
        provider: binding.provider,
        parentSessionId: existingIndex?.parentSessionId ?? this.sessionForkRepository.findBySessionId(sessionId)?.parentSessionId ?? null,
        sessionKind: existingIndex?.sessionKind ?? "default",
        annotationSourceMessageId: existingIndex?.annotationSourceMessageId ?? null,
        annotationSourceText: existingIndex?.annotationSourceText ?? null,
        isSubagent: existingIndex?.isSubagent ?? false,
        subagentLabel: existingIndex?.subagentLabel ?? null,
        title:
          existingIndex?.title?.trim()
          || buildRecoveredSessionTitle(binding.provider, binding.providerSessionId),
        messageCount: existingIndex?.messageCount ?? 0,
        isArchived: existingIndex?.isArchived ?? false,
        lastMessageAt: fallbackLastMessageAt,
        createdAt: fallbackCreatedAt,
        updatedAt: timestamp
      });

      if (!existingSnapshot) {
        this.sessionStatusSnapshotRepository.upsert({
          sessionId,
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: fallbackLastMessageAt,
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          updatedAt: timestamp
        });
      }

      if (!existingState) {
        this.sessionStateRepository.upsert({
          sessionId,
          userId,
          runningState: inferRecoveredSessionRunningState(binding),
          activitySource: inferRecoveredSessionActivitySource(binding),
          favorite: false,
          lastEventAt: shouldRecoverSessionAsActive(binding) ? (binding.updatedAt || timestamp) : fallbackLastMessageAt,
          completedAt: null,
          lastSeenAt: null,
          updatedAt: timestamp
        });
      }
    })();

    console.warn(
      `[session-history] repaired missing session index for ${sessionId} (${binding.provider})`
    );

    return this.sessionIndexRepository.findBySessionId(sessionId, userId);
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
    if (!descriptor) {
      return null;
    }

    const aliasTargetSessionId =
      extractSessionAliasTargetSessionId(descriptor.providerSessionId)
      ?? extractSessionAliasTargetSessionId(descriptor.rawStoreRef);

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
    const refreshState = this.getOrCreateWorkspaceStateRefreshStatus(inflightKey);
    const now = Date.now();

    refreshState.lastRequestedAt = now;
    refreshState.phase = refreshState.phase === "fresh" ? "stale" : refreshState.phase;
    refreshState.dirtyReasons.add("workspace.discovery.deferred_state_refresh");
    mergeWorkspaceStateRefreshSessions(refreshState.pendingSessions, sessions);

    if (refreshState.phase === "running" && refreshState.runningPromise) {
      return;
    }

    if (this.isWorkspaceStateRefreshCoolingDown(refreshState, now)) {
      refreshState.phase = "stale";
      this.ensureWorkspaceStateRefreshCooldownTimer(inflightKey, workspaceId, userId, refreshState);
      return;
    }

    this.startWorkspaceStateRefreshTask(inflightKey, workspaceId, userId, refreshState);
  }

  private getOrCreateWorkspaceStateRefreshStatus(key: string): WorkspaceStateRefreshStatus {
    const existing = this.workspaceStateRefreshStatuses.get(key);

    if (existing) {
      return existing;
    }

    const created: WorkspaceStateRefreshStatus = {
      phase: "fresh",
      dirtyReasons: new Set<string>(),
      pendingSessions: new Map<string, SessionListItem>(),
      runningPromise: null,
      cooldownTimer: null,
      lastRequestedAt: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastFailedAt: null,
      nextAllowedAt: null,
      runningTaskId: null
    };

    this.workspaceStateRefreshStatuses.set(key, created);
    return created;
  }

  private isWorkspaceStateRefreshCoolingDown(
    state: WorkspaceStateRefreshStatus,
    now: number
  ): boolean {
    if (state.nextAllowedAt === null || now >= state.nextAllowedAt) {
      return false;
    }

    return state.phase === "cooldown" || state.phase === "failed";
  }

  private startWorkspaceStateRefreshTask(
    key: string,
    workspaceId: string,
    userId: string,
    state: WorkspaceStateRefreshStatus
  ): void {
    if (state.runningPromise) {
      return;
    }

    const sessions = [...state.pendingSessions.values()];
    if (sessions.length === 0) {
      state.phase = "fresh";
      state.dirtyReasons.clear();
      return;
    }

    state.pendingSessions.clear();
    state.phase = "running";
    state.lastStartedAt = Date.now();
    state.runningTaskId = `${key}:${++this.workspaceStateRefreshTaskSequence}`;

    const startedAt = Date.now();
    const task = delay(0)
      .then(() => this.refreshRecentSessionStates(sessions, userId))
      .then(() => {
        state.lastCompletedAt = Date.now();
        state.phase = "cooldown";
        state.nextAllowedAt = state.lastCompletedAt + WORKSPACE_STATE_REFRESH_COOLDOWN_MS;
        state.dirtyReasons.clear();
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
        state.lastFailedAt = Date.now();
        state.phase = "failed";
        state.nextAllowedAt = state.lastFailedAt + WORKSPACE_STATE_REFRESH_COOLDOWN_MS;
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
        state.runningPromise = null;
        state.runningTaskId = null;

        if (state.pendingSessions.size === 0) {
          if (state.phase === "cooldown") {
            this.ensureWorkspaceStateRefreshCooldownTimer(key, workspaceId, userId, state);
            return;
          }

          if (state.phase === "failed") {
            this.ensureWorkspaceStateRefreshCooldownTimer(key, workspaceId, userId, state);
            return;
          }

          state.phase = "fresh";
          return;
        }

        state.phase = "stale";
        this.ensureWorkspaceStateRefreshCooldownTimer(key, workspaceId, userId, state);
      });

    state.runningPromise = task;
  }

  private ensureWorkspaceStateRefreshCooldownTimer(
    key: string,
    workspaceId: string,
    userId: string,
    state: WorkspaceStateRefreshStatus
  ): void {
    if (state.cooldownTimer) {
      return;
    }

    const now = Date.now();
    const delayMs = Math.max(0, (state.nextAllowedAt ?? now) - now);
    state.cooldownTimer = setTimeout(() => {
      state.cooldownTimer = null;

      if (state.pendingSessions.size === 0) {
        state.phase = "fresh";
        state.dirtyReasons.clear();
        state.nextAllowedAt = null;
        return;
      }

      state.phase = "stale";
      this.startWorkspaceStateRefreshTask(key, workspaceId, userId, state);
    }, delayMs);
  }

  private async cleanupStaleHiddenSessions(
    workspaceId: string,
    userId: string,
    sessions: Array<{
      provider: string;
      providerSessionId: string;
      rawStoreRef: string;
    }>
  ): Promise<void> {
    const discoveredProviderSessionIds = new Set(
      sessions.map((session) => buildProviderSessionKey(session.provider, session.providerSessionId))
    );
    const discoveredRawStoreRefs = new Set(sessions.map((session) => session.rawStoreRef));
    const nowMs = Date.now();
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
              (
                shouldRemoveMissingSyntheticCodexSession(session.rawStoreRef) &&
                !this.shouldPreserveSyntheticCodexSession(session, nowMs)
              )
            )) ||
          (session.provider === "claude-code" && shouldRemoveHiddenClaudeDebugSession(session))
        );
      });
    const managedButlerSessionIds = this.listManagedButlerSessionIds(
      staleHiddenSessions.map((session) => session.sessionId)
    );
    const deletableSessions = staleHiddenSessions.filter(
      (session) => !managedButlerSessionIds.has(session.sessionId)
    );

    if (deletableSessions.length === 0) {
      return;
    }

    const deleteTransaction = this.db.transaction((ids: string[]) => {
      for (const sessionId of ids) {
        this.detachSessionRelationsBeforeDelete(sessionId);
        this.deleteSessionById(sessionId);
      }
    });

    await runBatchedTransactions(
      deletableSessions.map((session) => session.sessionId),
      WORKSPACE_DISCOVERY_PERSIST_BATCH_SIZE,
      deleteTransaction,
      {
        scope: "workspace.discover_sessions.cleanup_hidden.batch",
        thresholdMs: SESSION_TRANSACTION_HOTSPOT_THRESHOLD_MS,
        detail: {
          workspaceId,
          userId,
          phase: "cleanup_hidden"
        }
      }
    );
  }

  private listManagedButlerSessionIds(sessionIds: string[]): Set<string> {
    if (sessionIds.length === 0) {
      return new Set();
    }

    const managedSessionIds = new Set<string>();

    for (let index = 0; index < sessionIds.length; index += WORKSPACE_DISCOVERY_PERSIST_BATCH_SIZE) {
      const batch = sessionIds.slice(index, index + WORKSPACE_DISCOVERY_PERSIST_BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT session_id
           FROM butler_sessions
           WHERE session_id IN (${placeholders})`
        )
        .all(...batch) as Array<{ session_id: string }>;

      for (const row of rows) {
        managedSessionIds.add(row.session_id);
      }
    }

    return managedSessionIds;
  }

  private shouldPreserveSyntheticCodexSession(
    session: Pick<
      SessionListItem,
      "sessionId" | "activitySource" | "runningState" | "createdAt" | "updatedAt"
    >,
    nowMs: number
  ): boolean {
    if (
      session.activitySource === "runtime"
      || session.runningState === "starting"
      || session.runningState === "running"
    ) {
      return true;
    }

    const hasActiveRuntimeState = this.listSessionStatesBySessionId(session.sessionId).some(
      (state) =>
        state.activitySource === "runtime"
        || state.runningState === "starting"
        || state.runningState === "running"
    );

    if (hasActiveRuntimeState) {
      return true;
    }

    const latestTouchedAt = pickLaterIso(session.updatedAt, session.createdAt) ?? session.updatedAt;
    const latestTouchedAtMs = Date.parse(latestTouchedAt);

    if (!Number.isFinite(latestTouchedAtMs)) {
      return false;
    }

    return nowMs - latestTouchedAtMs <= SYNTHETIC_CODEX_SESSION_CLEANUP_GRACE_MS;
  }

  private findSameWorkspaceBindingDuplicate(
    sessionId: string,
    workspaceId: string,
    snapshot: { provider: string; providerSessionId: string; rawStoreRef: string }
  ): SessionBinding | null {
    if (isPendingBindingValue(snapshot.providerSessionId)) {
      return null;
    }

    const existing =
      this.sessionBindingRepository.findByProviderSession(
        snapshot.provider,
        snapshot.providerSessionId
      ) ?? (
        shouldMatchSessionBindingByRawStoreRef(snapshot.provider)
          ? this.sessionBindingRepository.findByRawStoreRef(snapshot.provider, snapshot.rawStoreRef)
          : null
      );

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

    const sourceBinding = this.sessionBindingRepository.findBySessionId(input.sourceSessionId);

    if (!sourceBinding) {
      return;
    }

    const targetBinding = this.sessionBindingRepository.findBySessionId(input.targetSessionId);

    if (!targetBinding) {
      this.sessionBindingRepository.upsert({
        sessionId: input.targetSessionId,
        workspaceId: input.workspaceId,
        provider: input.provider as SessionBinding["provider"],
        providerSessionId: buildPendingBindingValue(input.provider, input.targetSessionId),
        rawStoreRef: buildPendingBindingValue(input.provider, input.targetSessionId),
        providerConfigMode: sourceBinding.providerConfigMode,
        providerPresetId: sourceBinding.providerPresetId,
        runtimeHomeDir: sourceBinding.runtimeHomeDir,
        createdAt: sourceBinding.createdAt,
        updatedAt: input.timestamp
      });
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
      .prepare("DELETE FROM session_forks WHERE session_id = ?")
      .run(input.sourceSessionId);

    // 保留旧 session_id 作为 alias，避免前端或 Butler 还拿着旧 id 时直接炸成 SESSION_NOT_FOUND。
    this.sessionBindingRepository.upsert({
      sessionId: input.sourceSessionId,
      workspaceId: sourceBinding.workspaceId,
      provider: sourceBinding.provider,
      providerSessionId: buildAliasBindingValue(
        input.provider,
        input.targetSessionId,
        input.sourceSessionId
      ),
      rawStoreRef: buildAliasBindingValue(
        input.provider,
        input.targetSessionId,
        input.sourceSessionId
      ),
      providerConfigMode: sourceBinding.providerConfigMode,
      providerPresetId: sourceBinding.providerPresetId,
      runtimeHomeDir: sourceBinding.runtimeHomeDir,
      createdAt: sourceBinding.createdAt,
      updatedAt: input.timestamp
    });

    if (sourceIndex) {
      this.sessionIndexRepository.upsert({
        ...sourceIndex,
        updatedAt: input.timestamp
      });
    }

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
      sessionKind:
        targetRelation?.sessionKind
        ?? sourceRelation?.sessionKind
        ?? targetIndex?.sessionKind
        ?? sourceIndex?.sessionKind
        ?? "default",
      annotationSourceMessageId:
        targetRelation?.annotationSourceMessageId
        ?? sourceRelation?.annotationSourceMessageId
        ?? targetIndex?.annotationSourceMessageId
        ?? sourceIndex?.annotationSourceMessageId
        ?? null,
      annotationSourceText:
        targetRelation?.annotationSourceText
        ?? sourceRelation?.annotationSourceText
        ?? targetIndex?.annotationSourceText
        ?? sourceIndex?.annotationSourceText
        ?? null,
      isSubagent: Boolean(
        targetRelation?.isSubagent
        || sourceRelation?.isSubagent
        || targetIndex?.isSubagent
        || sourceIndex?.isSubagent
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
    this.sessionMessageAttachmentService.deleteSessionAttachments(sessionId);
    this.sessionChangedFileService.deleteBySessionId(sessionId);
    this.db
      .prepare("DELETE FROM session_message_attachments WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("DELETE FROM session_message_origins WHERE session_id = ?")
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
      .prepare("DELETE FROM session_forks WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("DELETE FROM session_indices WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("DELETE FROM session_bindings WHERE session_id = ?")
      .run(sessionId);
  }

  private countOtherWorkspaceSessions(workspaceId: string, sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM session_bindings
         WHERE workspace_id = ?
           AND session_id != ?`
      )
      .get(workspaceId, sessionId) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  }

  private detachSessionRelationsBeforeDelete(sessionId: string): void {
    this.db
      .prepare(
        `UPDATE session_indices
         SET parent_session_id = NULL
         WHERE parent_session_id = ?`
      )
      .run(sessionId);
    this.db
      .prepare(
        `DELETE FROM session_forks
         WHERE parent_session_id = ?
            OR fork_source_session_id = ?`
      )
      .run(sessionId, sessionId);
    this.db
      .prepare("DELETE FROM butler_control_sessions WHERE session_id = ?")
      .run(sessionId);

    const butlerSessionIds = this.db
      .prepare(
        `SELECT id
         FROM butler_sessions
         WHERE session_id = ?`
      )
      .all(sessionId)
      .map((row) => String((row as { id: string }).id));

    if (butlerSessionIds.length === 0) {
      return;
    }

    const butlerPlaceholders = butlerSessionIds.map(() => "?").join(", ");
    const checkpointIds = this.db
      .prepare(
        `SELECT id
         FROM session_checkpoints
         WHERE butler_session_id IN (${butlerPlaceholders})`
      )
      .all(...butlerSessionIds)
      .map((row) => String((row as { id: string }).id));

    if (checkpointIds.length > 0) {
      const checkpointPlaceholders = checkpointIds.map(() => "?").join(", ");
      this.db
        .prepare(
          `UPDATE project_memories
           SET source_checkpoint_id = NULL
           WHERE source_checkpoint_id IN (${checkpointPlaceholders})`
        )
        .run(...checkpointIds);
    }

    this.db
      .prepare(
        `UPDATE project_memories
         SET source_butler_session_id = NULL
         WHERE source_butler_session_id IN (${butlerPlaceholders})`
      )
      .run(...butlerSessionIds);
    this.db
      .prepare(
        `UPDATE patrol_runs
         SET butler_session_id = NULL
         WHERE butler_session_id IN (${butlerPlaceholders})`
      )
      .run(...butlerSessionIds);
    this.db
      .prepare(
        `UPDATE verification_runs
         SET butler_session_id = NULL
         WHERE butler_session_id IN (${butlerPlaceholders})`
      )
      .run(...butlerSessionIds);
    this.db
      .prepare("DELETE FROM butler_sessions WHERE session_id = ?")
      .run(sessionId);
  }

  private removeWorkspaceSessionRelation(sessionId: string): void {
    for (const relationMap of this.workspaceSessionRelations.values()) {
      relationMap.delete(sessionId);

      for (const relation of relationMap.values()) {
        if (relation.parentSessionId === sessionId) {
          relation.parentSessionId = null;
        }
      }
    }
  }

  private buildKnownSessionSummaries(
    sessions: SessionListItem[],
    workspacePath: string
  ) {
    return sessions
      .filter((session) => !this.isPendingSessionAlias(session))
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
    const timestamp = nowIso();
    const liveObservation = this.resolveLiveActivityObservation(sessionId);
    const inspection = liveObservation
      ? null
      : inspectSessionActivity(binding.provider, binding.rawStoreRef);

    if (inspection) {
      const nowMs = Date.parse(timestamp);

      if (shouldClearStaleRuntimeWithoutInspection(current, inspection, nowMs)) {
        this.sessionActivityAuthorityService.clearSession(sessionId);
      }

      if (shouldPreserveRuntimeTerminalState(current, inspection)) {
        return current;
      }
    }

    const resolution = liveObservation
      ? this.sessionActivityAuthorityService.observe(liveObservation)
      : this.sessionActivityAuthorityService.observe(
          buildInspectionActivityObservation(sessionId, inspection as ReturnType<typeof inspectSessionActivity>, timestamp)
        );
    const resolvedLastEventAt =
      liveObservation
        ? resolution.lastObservedAt ?? current?.lastEventAt ?? null
        : inspection && hasInspectionEvidence(inspection)
          ? resolution.lastObservedAt ?? inspection.lastEventAt ?? current?.lastEventAt ?? null
          : current?.lastEventAt ?? null;
    const nextRecord: SessionStateRecord = {
      sessionId,
      userId,
      runningState: mapResolvedRunningStateToStored(resolution.runningState, current),
      activitySource: mapResolutionSourceToLegacyActivitySource(
        resolution.activityResolutionSource,
        inspection
      ),
      favorite: current?.favorite ?? false,
      lastEventAt: resolvedLastEventAt,
      completedAt:
        isTerminalResolvedRunningState(resolution.runningState)
          ? resolution.terminalAt ?? inspection?.completedAtCandidate ?? current?.completedAt ?? null
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
        ?? inspection?.lastEventAt
        ?? inspection?.completedAtCandidate
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

  private async repairCodexDirtyBindingBeforeHistoryRead(
    sessionId: string,
    userId: string,
    binding: SessionBinding
  ): Promise<SessionBinding> {
    if (!shouldRepairCodexDirtyBinding(binding)) {
      this.codexDirtyBindingRepairStates.delete(sessionId);
      return binding;
    }

    const existingState = this.codexDirtyBindingRepairStates.get(sessionId);

    if (existingState?.promise) {
      return existingState.promise;
    }

    const now = Date.now();

    if (
      existingState &&
      now - existingState.lastAttemptedAt < CODEX_DIRTY_BINDING_REPAIR_COOLDOWN_MS
    ) {
      return this.getBindingOrThrow(sessionId);
    }

    const repairPromise = (async (): Promise<SessionBinding> => {
      await this.discoverWorkspaceSessions(binding.workspaceId, userId, {
        force: true,
        refreshStateMode: "deferred"
      }).catch(() => {
        return [];
      });

      return this.getBindingOrThrow(sessionId);
    })();

    this.codexDirtyBindingRepairStates.set(sessionId, {
      promise: repairPromise,
      lastAttemptedAt: now
    });

    return repairPromise.finally(() => {
      const currentState = this.codexDirtyBindingRepairStates.get(sessionId);

      if (!currentState || currentState.promise !== repairPromise) {
        return;
      }

      currentState.promise = null;
      currentState.lastAttemptedAt = Date.now();
      this.codexDirtyBindingRepairStates.set(sessionId, currentState);
    });
  }

  private resolveLiveActivityObservation(sessionId: string): SessionActivityObservation | null {
    for (const resolver of this.liveActivityObservationResolvers) {
      const observation = resolver(sessionId);

      if (observation) {
        return observation;
      }
    }

    return null;
  }

  private upsertSnapshot(
    sessionId: string,
    input: Omit<SessionStatusSnapshot, "sessionId" | "updatedAt">
  ): void {
    const resolvedSessionId = this.resolveCanonicalSessionId(sessionId);

    if (!this.sessionBindingRepository.findBySessionId(resolvedSessionId)) {
      return;
    }

    this.sessionStatusSnapshotRepository.upsert({
      sessionId: resolvedSessionId,
      ...input,
      updatedAt: nowIso()
    });
  }

  private markSessionError(sessionId: string, errorCode: string, error: unknown): void {
    const resolvedSessionId = this.resolveCanonicalSessionId(sessionId);

    if (!this.sessionBindingRepository.findBySessionId(resolvedSessionId)) {
      return;
    }

    const current = this.sessionStatusSnapshotRepository.findBySessionId(resolvedSessionId);

    this.sessionStatusSnapshotRepository.upsert({
      sessionId: resolvedSessionId,
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

function isProviderCliBacked(provider: string): provider is "claude-code" | "codex" | "gemini" | "kimi" {
  return provider === "claude-code" || provider === "codex" || provider === "gemini" || provider === "kimi";
}

function buildProviderCliAvailabilitySnapshot(
  commandPaths: Readonly<Partial<Record<string, string>>>
): Readonly<Partial<Record<string, boolean>>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(commandPaths).map(([provider, commandPath]) => [
        provider,
        isCommandAvailable(commandPath)
      ])
    )
  );
}

function buildProviderCliUnavailableMessage(provider: string): string {
  switch (provider) {
    case "claude-code":
      return "未检测到 Claude CLI";
    case "codex":
      return "未检测到 Codex CLI";
    case "gemini":
      return "未检测到 Gemini CLI";
    case "kimi":
      return "未检测到 Kimi CLI";
    default:
      return "未检测到对应 CLI";
  }
}

function createCodexForkTransportFactory(
  commandPath: string,
  homeDir: string
): () => CodexForkTransport {
  return () => {
    const client = new CodexAppServerHelperClient(commandPath, { homeDir });
    const transport = client.createForkTransport();

    return {
      ...transport,
      close() {
        transport.close();
        client.dispose();
      }
    };
  };
}

function createCodexThreadControlTransportFactory(
  commandPath: string,
  homeDir: string
): () => CodexThreadControlTransport {
  return () => {
    const client = new CodexAppServerHelperClient(commandPath, { homeDir });
    const transport = client.createThreadControlTransport();

    return {
      ...transport,
      close() {
        transport.close();
        client.dispose();
      }
    };
  };
}

function buildInspectionActivityObservation(
  sessionId: string,
  inspection: ReturnType<typeof inspectSessionActivity>,
  observedAt: string
): SessionActivityObservation {
  const resolvedRunningState =
    inspection.runningState === "failed"
      ? "failed"
      : inspection.completedAtCandidate
        ? "completed"
        : inspection.runningState;

  return {
    sessionId,
    runId: null,
    runningState: resolvedRunningState,
    source: hasInspectionEvidence(inspection) ? "inferred_log" : "unknown",
    confidence: "weak",
    detail: inspection.errorDetail,
    interruptSource: null,
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
  const rawResolvedRunningState =
    resolution.runningState === "unknown" && item.runningState === null
      ? null
      : resolution.runningState;
  const resolvedRunningState =
    resolution.activityResolutionSource === "inferred_log" && rawResolvedRunningState === "completed"
      ? "idle"
      : rawResolvedRunningState;
  const shouldClearResolvedFailure = resolvedRunningState !== "failed" && item.runningState === "failed";
  const lastEventAt = resolution.lastObservedAt ?? item.lastEventAt;
  const completedAt =
    rawResolvedRunningState && isTerminalResolvedRunningState(rawResolvedRunningState)
      ? resolution.terminalAt ?? item.completedAt
      : null;
  const lastErrorCode =
    resolvedRunningState === "failed"
      ? resolution.errorCode ?? item.lastErrorCode
      : shouldClearResolvedFailure
        ? null
        : item.lastErrorCode;
  const lastErrorDetail =
    resolvedRunningState === "failed"
      ? resolution.detail ?? item.lastErrorDetail
      : shouldClearResolvedFailure
        ? null
        : item.lastErrorDetail;
  const syncStatus =
    resolvedRunningState === "failed"
      ? "error"
      : shouldClearResolvedFailure && item.syncStatus === "error"
        ? "idle"
        : item.syncStatus;

  return {
    ...item,
    syncStatus,
    runningState: resolvedRunningState,
    activitySource: mapResolutionSourceToCompatibilitySource(resolution.activityResolutionSource),
    activityResolutionSource: resolution.activityResolutionSource,
    activityConfidence: resolution.activityConfidence,
    runId: resolution.runId,
    lastEventAt,
    completedAt,
    lastErrorCode,
    lastErrorDetail,
    watchdogTriggeredAt: resolution.watchdogTriggeredAt,
    activityState: resolveActivityState(resolvedRunningState, completedAt, item.lastSeenAt)
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

function buildSessionStateRefreshCandidates(
  items: SessionListItem[],
  recentCount: number
): SessionListItem[] {
  const recentItems = items.slice(0, recentCount);
  const activeResidues = items.filter((item) => isSessionStateRefreshCandidate(item));
  const deduped = new Map<string, SessionListItem>();

  for (const item of [...recentItems, ...activeResidues]) {
    deduped.set(item.sessionId, item);
  }

  return Array.from(deduped.values());
}

function mergeWorkspaceStateRefreshSessions(
  target: Map<string, SessionListItem>,
  sessions: SessionListItem[]
): void {
  for (const session of sessions) {
    target.set(session.sessionId, session);
  }
}

function isSessionStateRefreshCandidate(item: SessionListItem): boolean {
  return item.activityState === "running"
    || item.runningState === "starting"
    || item.runningState === "running";
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
    sessionKind: input.target?.sessionKind ?? input.source?.sessionKind ?? "default",
    annotationSourceMessageId:
      input.target?.annotationSourceMessageId ?? input.source?.annotationSourceMessageId ?? null,
    annotationSourceText:
      input.target?.annotationSourceText ?? input.source?.annotationSourceText ?? null,
    isSubagent: Boolean(input.target?.isSubagent || input.source?.isSubagent),
    subagentLabel: input.target?.subagentLabel ?? input.source?.subagentLabel ?? null,
    title: pickPreferredSessionTitle(input.target?.title ?? null, input.source?.title ?? null),
    messageCount: Math.max(input.target?.messageCount ?? 0, input.source?.messageCount ?? 0),
    isArchived: mergePersistedArchiveState(
      input.provider,
      input.target?.isArchived,
      input.source?.isArchived
    ),
    lastMessageAt: pickLaterIso(input.target?.lastMessageAt ?? null, input.source?.lastMessageAt ?? null),
    createdAt: pickEarlierIso(input.target?.createdAt ?? null, input.source?.createdAt ?? null) ?? input.timestamp,
    updatedAt: input.timestamp
  };
}

function mergePersistedArchiveState(
  provider: string,
  targetArchived: boolean | null | undefined,
  sourceArchived: boolean | null | undefined
): boolean {
  // 只有 Codex 这类真实支持归档的 provider 才认底层归档真相；
  // 其他 provider 的归档完全由 Host 本地索引维护，不能让旧副本把恢复状态再刷回去。
  if (shouldUseProviderDiscoveredArchiveState(provider)) {
    return Boolean(targetArchived || sourceArchived);
  }

  return targetArchived ?? sourceArchived ?? false;
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

function countCommonHistoryPrefixLength(
  left: HistoryPage["messages"],
  right: HistoryPage["messages"]
): number {
  const maxLength = Math.min(left.length, right.length);
  let count = 0;

  for (; count < maxLength; count += 1) {
    if (!areHistoryMessagesEquivalent(left[count], right[count])) {
      break;
    }
  }

  return count;
}

function areHistoryMessagesEquivalent(
  left: HistoryPage["messages"][number] | undefined,
  right: HistoryPage["messages"][number] | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  if (left.messageId && right.messageId) {
    if (left.messageId === right.messageId) {
      return true;
    }
  }

  if (left.rawRef && right.rawRef) {
    if (left.rawRef === right.rawRef) {
      return true;
    }
  }

  return left.role === right.role
    && left.kind === right.kind
    && left.content === right.content
    && left.timestamp === right.timestamp;
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

function isSessionBindingProviderUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes(
    "UNIQUE constraint failed: session_bindings.provider, session_bindings.provider_session_id"
  );
}

function buildPendingBindingValue(provider: string, sessionId: string): string {
  return `pending://${provider}/${sessionId}`;
}

function shouldRecoverSessionAsActive(
  binding: Pick<SessionBinding, "providerSessionId" | "rawStoreRef">
): boolean {
  return isPendingBindingValue(binding.providerSessionId) || isPendingBindingValue(binding.rawStoreRef);
}

function inferRecoveredSessionRunningState(
  binding: Pick<SessionBinding, "providerSessionId" | "rawStoreRef">
): SessionStateRecord["runningState"] {
  return shouldRecoverSessionAsActive(binding) ? "starting" : "idle";
}

function inferRecoveredSessionActivitySource(
  binding: Pick<SessionBinding, "providerSessionId" | "rawStoreRef">
): SessionStateRecord["activitySource"] {
  return shouldRecoverSessionAsActive(binding) ? "runtime" : "none";
}

function buildAliasBindingValue(provider: string, targetSessionId: string, sourceSessionId: string): string {
  return `alias://${provider}/${targetSessionId}/${sourceSessionId}`;
}

function extractPendingBindingTargetSessionId(value: string): string | null {
  if (!isPendingBindingValue(value)) {
    return null;
  }

  const normalizedValue = value.trim();
  const targetSessionId = normalizedValue.slice(normalizedValue.indexOf("/", "pending://".length) + 1).trim();
  return targetSessionId || null;
}

function extractAliasBindingTargetSessionId(value: string): string | null {
  const normalizedValue = value.trim();

  if (!normalizedValue.toLowerCase().startsWith("alias://")) {
    return null;
  }

  const pathStart = normalizedValue.indexOf("/", "alias://".length);

  if (pathStart < 0) {
    return null;
  }

  const targetAndSource = normalizedValue.slice(pathStart + 1).trim();

  if (targetAndSource.length === 0) {
    return null;
  }

  const [targetSessionId] = targetAndSource.split("/", 1);
  return targetSessionId?.trim() || null;
}

function extractSessionAliasTargetSessionId(value: string): string | null {
  return extractAliasBindingTargetSessionId(value) ?? extractPendingBindingTargetSessionId(value);
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
  provider: string,
  existingArchived: boolean,
  discoveredArchived: boolean | null | undefined
): boolean {
  if (!shouldUseProviderDiscoveredArchiveState(provider)) {
    return existingArchived;
  }

  return discoveredArchived === true;
}

function shouldUseProviderDiscoveredArchiveState(provider: string): boolean {
  // 当前只有 Codex 的归档能稳定映射到底层文件位置；其余 provider 一律信本地 session_indices。
  return provider === "codex";
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

function isProviderSessionMissing(error: unknown): boolean {
  return error instanceof Error && error.message === "PROVIDER_SESSION_NOT_FOUND";
}

function createDeliveredHistoryMessageState(): DeliveredHistoryMessageState {
  return {
    signaturesByMessageId: new Map(),
    lastMutableTailRefreshAtMs: 0
  };
}

function shouldRefreshMutableHistoryTail(
  provider: string,
  page: HistoryPage,
  cursor: string | null,
  deliveredMessages: DeliveredHistoryMessageState
): boolean {
  if (!MUTABLE_HISTORY_TAIL_PROVIDERS.has(provider) || cursor === null || page.messages.length > 0) {
    return false;
  }

  return Date.now() - deliveredMessages.lastMutableTailRefreshAtMs >= MUTABLE_HISTORY_TAIL_REFRESH_INTERVAL_MS;
}

function buildDeliveredHistoryMessageSignature(
  message: SessionHistoryEnvelope["messages"][number]
): string {
  return hashContent(
    JSON.stringify({
      provider: message.provider,
      providerSessionId: message.providerSessionId,
      role: message.role,
      kind: message.kind,
      content: message.content,
      toolCall: message.toolCall,
      attachments: message.attachments ?? [],
      timestamp: message.timestamp,
      rawRef: message.rawRef
    })
  );
}

function rememberDeliveredHistoryMessage(
  state: DeliveredHistoryMessageState,
  messageId: string,
  signature: string
): void {
  if (state.signaturesByMessageId.has(messageId)) {
    state.signaturesByMessageId.delete(messageId);
  }

  state.signaturesByMessageId.set(messageId, signature);

  while (state.signaturesByMessageId.size > 2_048) {
    const oldestMessageId = state.signaturesByMessageId.keys().next().value;

    if (typeof oldestMessageId !== "string") {
      break;
    }

    state.signaturesByMessageId.delete(oldestMessageId);
  }
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

function isGeminiChatNotFoundError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.errorCode === "GEMINI_CHAT_NOT_FOUND";
  }

  return error instanceof Error && error.message === "GEMINI_CHAT_NOT_FOUND";
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

function shouldRepairCodexDirtyBinding(binding: Pick<SessionBinding, "provider" | "providerSessionId" | "rawStoreRef">): boolean {
  if (binding.provider !== "codex") {
    return false;
  }

  if (isSyntheticCodexRawStoreRef(binding.rawStoreRef)) {
    return false;
  }

  const expectedThreadId = binding.providerSessionId.trim();

  if (!expectedThreadId) {
    return false;
  }

  const boundThreadId = readCodexThreadIdFromRawStore(binding.rawStoreRef);

  if (boundThreadId) {
    return boundThreadId !== expectedThreadId;
  }

  return !existsSync(binding.rawStoreRef);
}

function readCodexThreadIdFromRawStore(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const firstLine = readFileSync(filePath, "utf8")
      .split(/\r?\n/, 1)
      .at(0)
      ?.trim();

    if (!firstLine) {
      return null;
    }

    const record = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: {
        id?: unknown;
      };
    };

    if (record.type !== "session_meta") {
      return null;
    }

    const threadId =
      typeof record.payload?.id === "string"
        ? record.payload.id.trim()
        : "";
    return threadId.length > 0 ? threadId : null;
  } catch {
    return null;
  }
}

function shouldMatchSessionBindingByRawStoreRef(provider: string): boolean {
  return provider !== "codex";
}

function resolveSessionListTitle(
  provider: string,
  existingTitle: string | null,
  fallbackContent: string,
  parentTitle: string | null = null
): string {
  const normalizedExistingTitle = existingTitle?.trim() ?? "";
  const normalizedParentTitle = parentTitle?.trim() ?? "";
  const fallbackTitle = buildUserMessageTitle(
    fallbackContent,
    normalizedExistingTitle || "继续对话"
  );

  if (
    normalizedExistingTitle.length > 0 &&
    !isSyntheticCodexSessionTitle(normalizedExistingTitle) &&
    (
      normalizedParentTitle.length === 0 ||
      normalizedExistingTitle !== normalizedParentTitle
    )
  ) {
    return normalizedExistingTitle;
  }

  if (normalizedParentTitle.length > 0 && normalizedExistingTitle === normalizedParentTitle) {
    return fallbackTitle;
  }

  if (provider === "codex") {
    return fallbackTitle;
  }

  return normalizedExistingTitle || fallbackTitle;
}

function buildUserMessageTitle(content: string, fallbackTitle: string): string {
  const title = content.trim().replace(/\s+/g, " ");
  return title.slice(0, 48) || fallbackTitle;
}

function buildRecoveredSessionTitle(provider: string, providerSessionId: string): string {
  if (isPendingBindingValue(providerSessionId)) {
    return "新会话";
  }

  const normalizedProvider = provider.trim().toLowerCase();
  const providerLabel =
    normalizedProvider === "claude-code"
      ? "Claude"
      : normalizedProvider === "codex"
        ? "Codex"
        : normalizedProvider === "gemini"
          ? "Gemini"
          : normalizedProvider === "kimi"
            ? "Kimi"
            : normalizedProvider === "opencode"
              ? "OpenCode"
              : provider;

  return `${providerLabel} 会话 ${providerSessionId.slice(0, 8)}`;
}

function resolvePersistedSessionTitle(
  provider: string,
  discoveredTitle: string,
  existingTitle: string | null,
  parentTitle: string | null = null
): string {
  const nextTitle = discoveredTitle.trim();
  const currentTitle = existingTitle?.trim() ?? "";
  const normalizedParentTitle = parentTitle?.trim() ?? "";

  if (!currentTitle) {
    if (provider === "codex" && isSyntheticCodexSessionTitle(nextTitle)) {
      return currentTitle;
    }

    if (normalizedParentTitle.length > 0 && nextTitle === normalizedParentTitle) {
      return currentTitle;
    }

    return nextTitle;
  }

  if (nextTitle.length === 0) {
    return currentTitle;
  }

  if (provider === "codex" && isSyntheticCodexSessionTitle(nextTitle)) {
    return currentTitle;
  }

  if (normalizedParentTitle.length > 0 && nextTitle === normalizedParentTitle && currentTitle !== normalizedParentTitle) {
    return currentTitle;
  }

  return nextTitle;
}

function isSyntheticCodexSessionTitle(title: string): boolean {
  return (
    /^rollout-\d{4}-\d{2}-\d{2}t/i.test(title) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)
  );
}

function shouldSyncSessionTitleFromProvider(
  provider: string,
  currentTitle: string | null
): boolean {
  const normalizedTitle = currentTitle?.trim() ?? "";

  if (normalizedTitle.length === 0) {
    return true;
  }

  if (provider === "codex" && isSyntheticCodexSessionTitle(normalizedTitle)) {
    return true;
  }

  return false;
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

const STALE_RUNTIME_WITHOUT_INSPECTION_GRACE_MS = 120_000;

function shouldClearStaleRuntimeWithoutInspection(
  current: SessionStateRecord | null,
  inspection: ReturnType<typeof inspectSessionActivity>,
  nowMs: number
): boolean {
  if (!current || current.activitySource !== "runtime") {
    return false;
  }

  if (current.runningState !== "starting" && current.runningState !== "running") {
    return false;
  }

  if (inspection.lastEventAt || inspection.completedAtCandidate || inspection.errorCode) {
    return false;
  }

  if (!current.lastEventAt) {
    return true;
  }

  const lastEventAtMs = Date.parse(current.lastEventAt);

  if (!Number.isFinite(lastEventAtMs)) {
    return true;
  }

  return nowMs - lastEventAtMs > STALE_RUNTIME_WITHOUT_INSPECTION_GRACE_MS;
}

function shouldPreserveRuntimeTerminalState(
  current: SessionStateRecord | null,
  inspection: ReturnType<typeof inspectSessionActivity>
): boolean {
  if (!current || current.activitySource !== "runtime") {
    return false;
  }

  if (!inspection.lastEventAt) {
    return !shouldClearStaleRuntimeWithoutInspection(current, inspection, Date.now());
  }

  if (!current.lastEventAt) {
    return true;
  }

  if (isTerminalRunningState(current.runningState)) {
    return inspection.lastEventAt.localeCompare(current.lastEventAt) <= 0;
  }

  if (current.runningState === "starting" || current.runningState === "running") {
    if (
      inspection.completedAtCandidate
      || inspection.errorCode
      || inspection.runningState === "interrupted"
    ) {
      return false;
    }

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
  inspection: ReturnType<typeof inspectSessionActivity> | null
): SessionStateRecord["activitySource"] {
  if (source === "authoritative_runtime" || source === "authoritative_provider_event") {
    return "runtime";
  }

  if (inspection && (inspection.lastEventAt || inspection.completedAtCandidate)) {
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

function buildReconstructedForkPrompt(input: {
  sourceProvider: string;
  targetProvider: string;
  sourceType: ForkSourceType;
  sourceTitle: string | null;
  messages: HistoryPage["messages"];
}): string {
  const lines = [
    input.sourceTitle
      ? `源会话：${input.sourceTitle}`
      : "源会话：未命名会话",
    `源 provider：${input.sourceProvider}`,
    `目标 provider：${input.targetProvider}`,
    input.sourceType === "message"
      ? "分叉方式：从指定消息点重建后续上下文"
      : "分叉方式：从整条会话重建上下文",
    "",
    "下面是需要继承到新会话里的历史文本。",
    "请把这些内容当作已经发生过的上下文事实，不要逐条复述，也不要把它们当成新的用户问题重新回答。",
    "后续我会在这条新分支里继续追加新的指令。",
    ""
  ];

  if (input.messages.length === 0) {
    lines.push("当前没有可继承的历史文本。");
    return lines.join("\n");
  }

  for (const message of input.messages) {
    lines.push(message.role === "user" ? "[用户]" : "[助手]");
    lines.push(message.content.trim());
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildProviderCapabilityCacheKey(
  provider: string,
  workspacePath: string | null
): string {
  return `${provider}::${workspacePath ?? ""}`;
}

async function runWithConcurrency<TItem>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency) || 1);
  const queue = [...items];
  const runners = Array.from({
    length: Math.min(normalizedConcurrency, queue.length || 1)
  }, async () => {
    while (queue.length > 0) {
      throwIfAborted(signal);
      const current = queue.shift();

      if (current === undefined) {
        return;
      }

      await worker(current);
    }
  });

  await Promise.all(runners);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("任务已取消");
  }
}

async function awaitTaskHandleWithSignal<TResult>(
  handle: TaskHandle<TResult>,
  signal?: AbortSignal
): Promise<TResult> {
  if (!signal) {
    return await handle.promise;
  }

  if (signal.aborted) {
    handle.cancel(getAbortMessage(signal.reason));
    throw signal.reason ?? new Error("任务已取消");
  }

  return await new Promise<TResult>((resolve, reject) => {
    const onAbort = () => {
      handle.cancel(getAbortMessage(signal.reason));
      reject(signal.reason ?? new Error("任务已取消"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    handle.promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function getAbortMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }

  return "任务已取消";
}

function areEquivalentSessionBindings(
  current: SessionBinding | null,
  next: SessionBinding
): boolean {
  if (!current) {
    return false;
  }

  return (
    current.sessionId === next.sessionId &&
    current.workspaceId === next.workspaceId &&
    current.provider === next.provider &&
    current.providerSessionId === next.providerSessionId &&
    current.rawStoreRef === next.rawStoreRef &&
    current.providerConfigMode === next.providerConfigMode &&
    current.providerPresetId === next.providerPresetId &&
    current.runtimeHomeDir === next.runtimeHomeDir &&
    current.createdAt === next.createdAt
  );
}

function resolveRequestedProviderSelection(input: {
  existingBinding?: Pick<SessionBinding, "providerConfigMode" | "providerPresetId"> | null;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
}): {
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
} {
  const existingSelection = input.existingBinding
    ? {
        providerConfigMode: input.existingBinding.providerConfigMode,
        providerPresetId: input.existingBinding.providerPresetId
      }
    : null;
  const normalizedPresetId = input.providerPresetId?.trim() || null;

  if (input.providerConfigMode === undefined && input.providerPresetId === undefined) {
    return existingSelection ?? {
      providerConfigMode: "global-default",
      providerPresetId: null
    };
  }

  const providerConfigMode =
    input.providerConfigMode
    ?? (normalizedPresetId ? "cc-switch-preset" : "global-default");

  if (providerConfigMode === "global-default") {
    return {
      providerConfigMode,
      providerPresetId: null
    };
  }

  const providerPresetId = normalizedPresetId ?? existingSelection?.providerPresetId ?? null;

  if (!providerPresetId) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "使用 cc-switch preset 时必须提供 providerPresetId",
      field: "providerPresetId"
    });
  }

  return {
    providerConfigMode,
    providerPresetId
  };
}

function areEquivalentProviderBindingSelection(
  binding: Pick<SessionBinding, "providerConfigMode" | "providerPresetId">,
  selection: {
    providerConfigMode: SessionProviderConfigMode;
    providerPresetId: string | null;
  }
): boolean {
  return (
    binding.providerConfigMode === selection.providerConfigMode
    && binding.providerPresetId === selection.providerPresetId
  );
}

function areEquivalentSessionIndexRecords(
  current: SessionIndexRecord | null,
  next: SessionIndexRecord
): boolean {
  if (!current) {
    return false;
  }

  return (
    current.sessionId === next.sessionId &&
    current.workspaceId === next.workspaceId &&
    current.provider === next.provider &&
    (current.parentSessionId ?? null) === (next.parentSessionId ?? null) &&
    (current.sessionKind ?? "default") === (next.sessionKind ?? "default") &&
    (current.annotationSourceMessageId ?? null) === (next.annotationSourceMessageId ?? null) &&
    (current.annotationSourceText ?? null) === (next.annotationSourceText ?? null) &&
    (current.isSubagent ?? false) === (next.isSubagent ?? false) &&
    (current.subagentLabel ?? null) === (next.subagentLabel ?? null) &&
    current.title === next.title &&
    current.messageCount === next.messageCount &&
    current.isArchived === next.isArchived &&
    (current.lastMessageAt ?? null) === (next.lastMessageAt ?? null) &&
    current.createdAt === next.createdAt
  );
}

function areEquivalentSessionStatusSnapshots(
  current: SessionStatusSnapshot | null,
  next: SessionStatusSnapshot
): boolean {
  if (!current) {
    return false;
  }

  return (
    current.sessionId === next.sessionId &&
    current.syncStatus === next.syncStatus &&
    (current.syncCursor ?? null) === (next.syncCursor ?? null) &&
    (current.lastSyncAt ?? null) === (next.lastSyncAt ?? null) &&
    (current.lastErrorCode ?? null) === (next.lastErrorCode ?? null) &&
    (current.lastErrorDetail ?? null) === (next.lastErrorDetail ?? null) &&
    (current.resumedAt ?? null) === (next.resumedAt ?? null)
  );
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const sqliteCode = "code" in error ? error.code : null;
  const message = error instanceof Error ? error.message : String(error);

  return sqliteCode === "SQLITE_BUSY" || message.includes("database is locked");
}

async function runBatchedTransactions<TItem>(
  items: readonly TItem[],
  batchSize: number,
  transaction: (batch: TItem[]) => void,
  logOptions?: {
    scope: string;
    thresholdMs?: number;
    detail?: Record<string, unknown>;
  }
): Promise<{
  batchCount: number;
  maxBatchMs: number;
}> {
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize) || 1);
  let batchCount = 0;
  let maxBatchMs = 0;

  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    const batch = items.slice(index, index + normalizedBatchSize);
    const batchStartedAt = Date.now();
    let retryCount = 0;

    while (true) {
      try {
        transaction(batch);
        break;
      } catch (error) {
        if (!isSqliteBusyError(error) || retryCount >= SQLITE_BUSY_RETRY_LIMIT) {
          throw error;
        }

        retryCount += 1;
        await delay(SQLITE_BUSY_RETRY_DELAY_MS * retryCount);
      }
    }

    const batchDurationMs = Date.now() - batchStartedAt;
    const nextBatchIndex = batchCount + 1;

    if (logOptions) {
      logPerformance(
        logOptions.scope,
        batchDurationMs,
        {
          ...logOptions.detail,
          batchIndex: nextBatchIndex,
          batchSize: batch.length,
          batchStartIndex: index,
          retryCount,
          totalItems: items.length,
          configuredBatchSize: normalizedBatchSize
        },
        {
          thresholdMs: logOptions.thresholdMs ?? SESSION_TRANSACTION_HOTSPOT_THRESHOLD_MS
        }
      );
    }

    batchCount += 1;
    maxBatchMs = Math.max(maxBatchMs, batchDurationMs);

    if (index + normalizedBatchSize < items.length) {
      await delay(0);
    }
  }

  return {
    batchCount,
    maxBatchMs
  };
}

function mergeSessionListItemsBySessionId(items: readonly SessionListItem[]): SessionListItem[] {
  const itemBySessionId = new Map<string, SessionListItem>();

  for (const item of items) {
    itemBySessionId.set(item.sessionId, item);
  }

  return [...itemBySessionId.values()];
}

function sortSessionListItemsByRecentActivity(items: readonly SessionListItem[]): SessionListItem[] {
  return [...items].sort((left, right) => {
    const leftPrimary = left.lastMessageAt ?? left.updatedAt;
    const rightPrimary = right.lastMessageAt ?? right.updatedAt;

    if (leftPrimary !== rightPrimary) {
      return rightPrimary.localeCompare(leftPrimary);
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function applyImmediateModelOptionFallbacks(
  capabilities: ProviderCapabilities,
  codexSnapshot: { modelOptions: ProviderModelOption[]; defaultReasoningLevel: string | null } | null,
  openCodeSnapshot: { modelOptions: ProviderModelOption[] } | null
): ProviderCapabilities {
  if (capabilities.provider === "codex") {
    return {
      ...capabilities,
      modelOptions: codexSnapshot?.modelOptions ?? createFallbackCodexModelOptions(null),
      defaultReasoningLevel: codexSnapshot?.defaultReasoningLevel ?? null,
      limitations: codexSnapshot
        ? capabilities.limitations
        : Array.from(
            new Set([
              ...capabilities.limitations,
              "当前暂时使用缓存或兜底模型列表，后台会继续刷新 Codex 能力。"
            ])
          )
    };
  }

  if (capabilities.provider === "opencode") {
    return {
      ...capabilities,
      modelOptions: openCodeSnapshot?.modelOptions ?? createFallbackOpenCodeModelOptions(null),
      limitations: openCodeSnapshot
        ? capabilities.limitations
        : Array.from(
            new Set([
              ...capabilities.limitations,
              "当前暂时使用缓存或兜底模型列表，后台会继续刷新 OpenCode 能力。"
            ])
          )
    };
  }

  return capabilities;
}
