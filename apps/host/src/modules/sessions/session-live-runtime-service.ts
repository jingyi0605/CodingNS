import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  type ActiveRunHandle,
  ClaudeRuntimeAdapter,
  type ContextUsageSnapshot,
  CodexRuntimeAdapter,
  GeminiRuntimeAdapter,
  type InRunInputMode,
  KimiRuntimeAdapter,
  type NormalizedMessageAttachment,
  OpenCodeRuntimeAdapter,
  ProviderRuntimeService,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeRunRequest,
  type ProviderSubscription,
  type RuntimeEvent,
  type RuntimeRunState,
  type SendMessageResult
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { isPerfDebugEnabled, logPerformance } from "../../shared/utils/perf-log.js";
import { logPermissionDebug } from "../../shared/utils/permission-debug-log.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionSendQueueRepository } from "../../storage/repositories/session-send-queue-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type {
  SessionActivityConfidence,
  SessionActivityResolutionSource,
  SessionListItem,
  SessionResolvedRunningState,
  SessionRunningState,
  SessionSendQueueItemRecord,
  SessionStatusSnapshot
} from "../../types/domain.js";
import {
  SessionActivityAuthorityService,
  type SessionActivityObservation,
  type SessionActivityResolution
} from "./session-activity-authority-service.js";
import { SessionChangedFileService } from "./session-changed-file-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type {
  RuntimeImageAttachmentDescriptor,
  SessionImageAttachmentInput
} from "./session-message-attachment-service.js";
import { SessionMessageAttachmentService } from "./session-message-attachment-service.js";
import {
  SessionPermissionRequestService,
  type SessionPermissionEnvelope,
  type SessionPermissionReplyInput,
  type SessionPermissionRequestView
} from "./session-permission-request-service.js";
import { mapSessionProviderError } from "./session-provider-error-mapper.js";
import type {
  SessionHistoryEnvelope,
  SessionHistoryMessageWithOrigin,
  SessionHistoryService
} from "./session-history-service.js";
import { ClaudeRuntimeHelperAdapter } from "./claude-runtime-helper-client.js";
import { CodexAppServerHelperClient } from "./codex-app-server-helper-client.js";

interface RuntimeSendOptions {
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  attachments?: SessionImageAttachmentInput[];
}

interface StartLiveSessionInput {
  workspaceId: string;
  userId: string;
  provider: string;
  content: string;
  clientRequestId: string | null;
  parentSessionId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  runtimeOptions?: RuntimeSendOptions;
}

interface SendLiveMessageInput {
  sessionId: string;
  userId: string;
  content: string;
  clientRequestId: string | null;
  runtimeOptions?: RuntimeSendOptions;
}

interface LiveMessageAcceptedResult {
  sessionId: string;
  provider: string;
  providerSessionId: string;
  acceptedAt: string;
  clientRequestId: string | null;
  message: SendMessageResult["message"];
  session?: SessionListItem;
}

interface PersistedAttachmentBundle {
  messageAttachments: NormalizedMessageAttachment[];
  runtimeAttachments: RuntimeImageAttachmentDescriptor[];
}

interface PendingSessionSendDebugTrace {
  mode: "start_live" | "send_live";
  sessionId: string;
  workspaceId: string;
  provider: string;
  clientRequestId: string | null;
  startedAtMs: number;
  responseReadyAtMs: number | null;
  firstRuntimeEventAtMs: number | null;
}

export interface SessionQueueItemView {
  id: string;
  sessionId: string;
  content: string;
  clientRequestId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  status: SessionSendQueueItemRecord["status"];
  orderIndex: number;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeleteQueuedMessageResult {
  sessionId: string;
  queueItemId: string;
  deleted: boolean;
}

interface SteerQueuedMessageResult extends LiveMessageAcceptedResult {
  queueItemId: string;
}

export interface SessionRuntimeStatusView {
  sessionId: string;
  runningState: SessionResolvedRunningState | RuntimeRunState;
  hasActiveRun: boolean;
  canAttach: boolean;
  canInterrupt: boolean;
  inRunInputMode: InRunInputMode;
  provider: string;
  providerSessionId: string;
  activityResolutionSource: SessionActivityResolutionSource;
  activityConfidence: SessionActivityConfidence;
  runId: string | null;
  detail: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  updatedAt: string;
  watchdogTriggeredAt: string | null;
  contextUsage: ContextUsageSnapshot | null;
}

export interface InterruptSessionResult {
  sessionId: string;
  interrupted: boolean;
  detail: string | null;
}

export interface SessionRuntimeStatusEnvelope {
  type: "session.runtime_status";
  sessionId: string;
  status: "starting" | "running" | "completed" | "failed" | "interrupted";
  detail: string | null;
  timestamp: string;
}

export interface SessionRuntimeErrorEnvelope {
  type: "session.runtime_error";
  sessionId: string;
  error_code: string;
  detail: string;
  timestamp: string;
}

export interface SessionInterruptedEnvelope {
  type: "session.interrupted";
  sessionId: string;
  detail: string | null;
  timestamp: string;
}

export interface SessionActivityEnvelope {
  type: "session.activity";
  sessionId: string;
  runningState: SessionResolvedRunningState;
  activityResolutionSource: SessionActivityResolutionSource;
  activityConfidence: SessionActivityConfidence;
  runId: string | null;
  detail: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  hasActiveRun: boolean;
  canInterrupt: boolean;
  updatedAt: string;
  watchdogTriggeredAt: string | null;
}

export interface SessionRuntimeMessageEnvelope {
  type: "session.runtime_message";
  sessionId: string;
  message: SessionHistoryMessageWithOrigin;
  source: "runtime";
}

export type SessionRuntimeEnvelope =
  | SessionHistoryEnvelope
  | SessionRuntimeMessageEnvelope
  | SessionActivityEnvelope
  | SessionRuntimeStatusEnvelope
  | SessionRuntimeErrorEnvelope
  | SessionInterruptedEnvelope
  | SessionPermissionEnvelope;

interface SessionTerminalStateEvent {
  sessionId: string;
  status: "completed" | "failed" | "interrupted";
  timestamp: string;
  detail: string | null;
  source: "runtime" | "external_runtime";
}

type ExternalRuntimeStatus = Extract<SessionRuntimeStatusEnvelope["status"], "running" | "completed" | "failed">;

const RUNTIME_START_BINDING_WAIT_TIMEOUT_MS = 10_000;
const START_BINDING_POLL_INTERVAL_MS = 50;

interface ClaudeHookBridgeConfig {
  provider: "claude-code";
  bridgeUrl: string;
  token: string;
  scriptPath: string;
  command: string;
  supportedEvents: string[];
}

interface ClaudeHookEventPayload {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  reason?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_input?: unknown;
  permission_suggestions?: unknown;
  title?: string;
  message?: string;
  notification_type?: string;
}

interface ExternalRuntimeSnapshot {
  sessionId: string;
  provider: "claude-code";
  providerSessionId: string;
  rawStoreRef: string;
  runningState: ExternalRuntimeStatus;
  detail: string | null;
  updatedAt: string;
}

export class SessionLiveRuntimeService {
  private readonly providerRuntimeService: ProviderRuntimeService;
  private readonly sessionActivityAuthorityService: SessionActivityAuthorityService;
  private readonly sessionPermissionRequestService: SessionPermissionRequestService;
  private readonly runtimeAdapterDisposables: Array<{ dispose(): void }>;
  private readonly externalRuntimeSnapshots = new Map<string, ExternalRuntimeSnapshot>();
  private readonly runtimeListeners = new Map<
    string,
    Set<(envelope: SessionRuntimeEnvelope | SessionHistoryEnvelope) => Promise<void> | void>
  >();
  private readonly terminalStateListeners = new Set<
    (event: SessionTerminalStateEvent) => Promise<void> | void
  >();
  private readonly runtimeMessageSeenSessions = new Set<string>();
  private readonly runtimeHistoryFallbackSentSessions = new Set<string>();
  private readonly queueDispatchSessions = new Set<string>();
  private readonly queueRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingSendDebugTracesBySessionId = new Map<string, PendingSessionSendDebugTrace[]>();

  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionMessageAttachmentService: SessionMessageAttachmentService,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionChangedFileService: SessionChangedFileService,
    private readonly sessionBindingRepository: SessionBindingRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly sessionSendQueueRepository: SessionSendQueueRepository,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly sessionStatusSnapshotRepository: SessionStatusSnapshotRepository,
    private readonly config: HostConfig,
    sessionActivityAuthorityService = new SessionActivityAuthorityService()
  ) {
    this.sessionActivityAuthorityService = sessionActivityAuthorityService;
    this.sessionPermissionRequestService = new SessionPermissionRequestService(
      sessionHistoryService,
      sessionBindingRepository,
      authUserRepository,
      workspaceService,
      config,
      async (envelope) => {
        await this.emitExternalRuntimeEnvelope(envelope);
      },
      async (input) => {
        return this.resolveActiveClaudePermissionSession(input);
      }
    );
    const runtimeAdapters = createProviderRuntimeAdapters(config, {
      handleCodexServerRequest: async (input) =>
        this.sessionPermissionRequestService.handleCodexServerRequest(
          input.sessionId,
          input.providerSessionId,
          input.request
        )
    });
    this.runtimeAdapterDisposables = runtimeAdapters.disposables;
    this.providerRuntimeService = new ProviderRuntimeService(runtimeAdapters.adapters);
  }

  async startLiveSession(input: StartLiveSessionInput): Promise<LiveMessageAcceptedResult> {
    const requestStartedAt = nowIso();
    const sessionId = createId();
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);
    const debugTrace = this.beginPendingSendDebugTrace({
      mode: "start_live",
      sessionId,
      workspaceId: workspace.id,
      provider: input.provider,
      clientRequestId: input.clientRequestId
    });

    try {
      const capabilities = this.sessionHistoryService.getProviderCapabilitiesSnapshot(input.provider);
      this.ensurePendingSessionBinding(sessionId, workspace.id, input.provider);
      const persistedAttachments = this.persistMessageAttachments(
        sessionId,
        input.clientRequestId,
        input.runtimeOptions?.attachments ?? []
      );
      const providerPrompt = this.sessionMessageAttachmentService.buildProviderPrompt(
        input.provider,
        input.content,
        persistedAttachments.runtimeAttachments
      );

      this.ensureCapability(capabilities.canStartSession, "provider", "provider 不支持 start-live");
      this.ensureCapability(capabilities.canSendMessage, "provider", "provider 不支持实时对话");

      const launchRuntimeStartedAtMs = performance.now();
      const handle = await this.launchRuntimeRun(
        {
          sessionId,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          provider: input.provider as ProviderRuntimeRunRequest["provider"],
          providerSessionId: null,
          rawStoreRef: null,
          sequenceBase: 1,
          options: {
            content: input.content,
            clientRequestId: input.clientRequestId,
            model: input.runtimeOptions?.model ?? null,
            reasoningLevel: input.runtimeOptions?.reasoningLevel ?? null,
            permissionMode: input.runtimeOptions?.permissionMode ?? null,
            providerPrompt,
            attachments: persistedAttachments.runtimeAttachments
          }
        },
        "start"
      );
      this.logSendDebugStep(debugTrace, "launch_runtime", launchRuntimeStartedAtMs, {
        userId: input.userId
      });
      const snapshot = handle.getSnapshot();

      this.attachRuntimePersistence(handle, sessionId, workspace.id, input.userId);
      this.createRuntimeBackedSession({
        sessionId,
        workspaceId: workspace.id,
        userId: input.userId,
        provider: input.provider,
        parentSessionId: input.parentSessionId ?? null,
        sessionKind: input.sessionKind ?? "default",
        annotationSourceMessageId: input.annotationSourceMessageId ?? null,
        annotationSourceText: input.annotationSourceText ?? null,
        initialContent: input.content,
        snapshot
      });
      const startBindingTask = this.waitForResolvedStartBinding(
        sessionId,
        workspace.id,
        input.provider,
        handle
      ).catch(() => {
        return;
      });

      if (shouldAwaitStartBindingBeforeAcceptedUserLookup(input.provider)) {
        const bindingWaitStartedAtMs = performance.now();
        await Promise.race([
          startBindingTask,
          waitForAcceptedUserLookupWindow()
        ]);
        this.logSendDebugStep(debugTrace, "binding_wait", bindingWaitStartedAtMs, {
          provider: input.provider
        });
      }

      const binding = this.sessionHistoryService.getBindingOrThrow(sessionId);
      const acceptedLookupStartedAtMs = performance.now();
      const acceptedMessage = shouldAwaitAcceptedUserMessage(input.provider)
        ? await this.findAcceptedUserMessage(
            sessionId,
            this.sessionMessageAttachmentService.buildAcceptedContentCandidates(
              input.content,
              providerPrompt
            ),
            requestStartedAt
          )
        : null;
      this.logSendDebugStep(debugTrace, "accepted_user_lookup", acceptedLookupStartedAtMs, {
        awaited: shouldAwaitAcceptedUserMessage(input.provider),
        matched: Boolean(acceptedMessage)
      });
      if (!shouldAwaitStartBindingBeforeAcceptedUserLookup(input.provider)) {
        void startBindingTask;
      }
      const acceptedAt = acceptedMessage?.timestamp ?? nowIso();
      const boundAttachments = this.sessionMessageAttachmentService.bindClientRequestToMessage(
        sessionId,
        input.clientRequestId,
        acceptedMessage?.messageId ?? null
      );

      const session = this.sessionHistoryService.getSession(sessionId, input.userId);
      this.markSendDebugResponseReady(debugTrace, {
        returnedAcceptedMessage: Boolean(acceptedMessage),
        returnedSyntheticUser: !acceptedMessage,
        providerSessionId: binding.providerSessionId
      });

      return {
        sessionId: session.sessionId,
        provider: input.provider,
        providerSessionId: binding.providerSessionId,
        acceptedAt,
        clientRequestId: input.clientRequestId,
        message:
          (acceptedMessage
            ? {
                ...acceptedMessage,
                attachments: boundAttachments
              }
            : null) ??
          createSyntheticUserMessage(
            input.provider,
            binding.providerSessionId,
            input.content,
            acceptedAt,
            1,
            boundAttachments.length > 0
              ? boundAttachments
              : persistedAttachments.messageAttachments
          ),
        session
      };
    } catch (error) {
      this.failPendingSendDebugTrace(debugTrace, error);
      throw error;
    }
  }

  async sendLiveMessage(input: SendLiveMessageInput): Promise<LiveMessageAcceptedResult> {
    return this.sendLiveMessageDirect(input);
  }

  async listQueuedMessages(sessionId: string, userId: string): Promise<SessionQueueItemView[]> {
    const session = await this.resolveQueueDispatchSession(sessionId, userId);
    this.maybeDispatchQueuedMessages(session);

    return this.sessionSendQueueRepository
      .listBySessionAndUser(sessionId, userId)
      .map(mapQueueItemRecordToView);
  }

  async enqueueLiveMessage(input: SendLiveMessageInput): Promise<SessionQueueItemView> {
    const session = await this.resolveQueueDispatchSession(input.sessionId, input.userId);
    this.persistMessageAttachments(
      input.sessionId,
      input.clientRequestId,
      input.runtimeOptions?.attachments ?? []
    );
    const timestamp = nowIso();
    const queueItem: SessionSendQueueItemRecord = {
      id: createId(),
      sessionId: input.sessionId,
      userId: input.userId,
      content: input.content,
      clientRequestId: input.clientRequestId,
      model: input.runtimeOptions?.model ?? null,
      reasoningLevel: input.runtimeOptions?.reasoningLevel ?? null,
      permissionMode: input.runtimeOptions?.permissionMode ?? null,
      status: "queued",
      orderIndex: this.sessionSendQueueRepository.getNextOrderIndex(input.sessionId),
      errorDetail: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      dispatchedAt: null
    };

    this.sessionSendQueueRepository.insert(queueItem);

    this.maybeDispatchQueuedMessages(session);
    return mapQueueItemRecordToView(queueItem);
  }

  async steerQueuedMessage(
    sessionId: string,
    userId: string,
    queueItemId: string
  ): Promise<SteerQueuedMessageResult> {
    const session = await this.resolveQueueDispatchSession(sessionId, userId);
    const queueItem = this.sessionSendQueueRepository.findBySessionUserAndId(
      sessionId,
      userId,
      queueItemId
    );

    if (!queueItem) {
      throw new AppError({
        statusCode: 404,
        errorCode: "QUEUE_ITEM_NOT_FOUND",
        detail: "未找到对应的发送队列项",
        field: "queueItemId"
      });
    }

    if (queueItem.status !== "queued" && queueItem.status !== "failed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "QUEUE_ITEM_NOT_STEERABLE",
        detail: "该队列项已经开始发送，当前不能再引导",
        field: "queueItemId"
      });
    }

    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(runtimeSessionId);

    if (!runtimeSnapshot || !isActiveRuntimeState(runtimeSnapshot.runningState)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_NOT_RUNNING",
        detail: "当前会话不在运行中，无法立刻引导这条消息",
        field: "queueItemId"
      });
    }

    const capabilities = await this.sessionHistoryService.getSessionCapabilities(sessionId);

    if (capabilities.inRunInputMode === "none") {
      throw new AppError({
        statusCode: 409,
        errorCode: "QUEUE_STEER_NOT_SUPPORTED",
        detail: "当前 provider 不支持把等待消息立刻引导到正在运行的会话",
        field: "queueItemId"
      });
    }

    const dispatchStartedAt = nowIso();
    const claimed = this.sessionSendQueueRepository.markDispatching(queueItem.id, dispatchStartedAt);

    if (!claimed) {
      throw new AppError({
        statusCode: 409,
        errorCode: "QUEUE_ITEM_NOT_STEERABLE",
        detail: "该队列项状态已经变化，请刷新后重试",
        field: "queueItemId"
      });
    }

    const restoredAttachments = queueItem.clientRequestId
      ? this.sessionMessageAttachmentService.getRuntimeAttachments(
          sessionId,
          queueItem.clientRequestId
        )
      : [];
    const persistedAttachments: PersistedAttachmentBundle = {
      messageAttachments: restoredAttachments,
      runtimeAttachments: restoredAttachments
    };

    try {
      const result = await this.sendLiveMessageDirect(
        {
          sessionId,
          userId,
          content: queueItem.content,
          clientRequestId: queueItem.clientRequestId,
          runtimeOptions: {
            model: queueItem.model,
            reasoningLevel: queueItem.reasoningLevel,
            permissionMode: queueItem.permissionMode,
            attachments: []
          }
        },
        persistedAttachments
      );
      this.sessionSendQueueRepository.delete(queueItem.id);

      return {
        ...result,
        queueItemId: queueItem.id,
        session
      };
      } catch (error) {
        if (isQueueDispatchRetryableError(error)) {
          this.sessionSendQueueRepository.markQueued(queueItem.id, nowIso());
          this.scheduleQueueRetry(sessionId);
        } else {
          this.sessionSendQueueRepository.markFailed(
            queueItem.id,
            error instanceof Error ? error.message : "QUEUE_STEER_FAILED",
            nowIso()
          );
        }

      throw error;
    }
  }

  async deleteQueuedMessage(
    sessionId: string,
    userId: string,
    queueItemId: string
  ): Promise<DeleteQueuedMessageResult> {
    this.sessionHistoryService.getSession(sessionId, userId);
    const queueItem = this.sessionSendQueueRepository.findBySessionUserAndId(
      sessionId,
      userId,
      queueItemId
    );

    if (!queueItem) {
      throw new AppError({
        statusCode: 404,
        errorCode: "QUEUE_ITEM_NOT_FOUND",
        detail: "未找到对应的发送队列项",
        field: "queueItemId"
      });
    }

    if (queueItem.status !== "queued" && queueItem.status !== "failed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "QUEUE_ITEM_NOT_DELETABLE",
        detail: "该队列项已经开始发送，当前不允许删除",
        field: "queueItemId"
      });
    }

    this.sessionSendQueueRepository.delete(queueItemId);
    this.sessionMessageAttachmentService.deletePendingAttachments(
      sessionId,
      queueItem.clientRequestId
    );

    return {
      sessionId,
      queueItemId,
      deleted: true
    };
  }

  getClaudeHookBridgeConfig(): ClaudeHookBridgeConfig {
    return buildClaudeHookBridgeConfig(this.config);
  }

  async ingestClaudeHookEvent(payload: ClaudeHookEventPayload): Promise<{
    accepted: boolean;
    ignored: boolean;
    sessionId: string | null;
    bridgeResponse: Record<string, unknown> | null;
  }> {
    const hookEventName = normalizeClaudeHookEventName(payload.hook_event_name);
    logPermissionDebug("claude_hook_event.ingest.begin", {
      hookEventName,
      sessionId: payload.session_id ?? null,
      cwd: payload.cwd ?? null,
      transcriptPath: payload.transcript_path ?? null
    });

    if (!hookEventName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "hook_event_name 不能为空",
        field: "hook_event_name"
      });
    }

    if (!isSupportedClaudeHookEvent(hookEventName)) {
      logPermissionDebug("claude_hook_event.ingest.unsupported", {
        hookEventName
      });
      return {
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: null
      };
    }

    if (hookEventName === "PreToolUse") {
      logPermissionDebug("claude_hook_event.route", {
        hookEventName,
        route: "handleClaudePreToolUse"
      });
      return this.sessionPermissionRequestService.handleClaudePreToolUse(payload);
    }

    if (hookEventName === "PermissionRequest") {
      logPermissionDebug("claude_hook_event.route", {
        hookEventName,
        route: "handleClaudePermissionRequest"
      });
      return this.sessionPermissionRequestService.handleClaudePermissionRequest(payload);
    }

    const providerSessionId = normalizeRequiredText(payload.session_id, "session_id");
    const workspacePath = normalizeRequiredText(payload.cwd, "cwd");
    const workspace = this.workspaceService.findWorkspaceByPath(workspacePath);

    if (!workspace) {
      logPermissionDebug("claude_hook_event.workspace_not_found", {
        hookEventName,
        sessionId: payload.session_id ?? null,
        cwd: payload.cwd ?? null
      });
      return {
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: null
      };
    }

    const binding = await this.resolveClaudeExternalBinding({
      providerSessionId,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      transcriptPath: normalizeOptionalText(payload.transcript_path)
    });

    const timestamp = nowIso();
    const runtimeUpdate = mapClaudeHookToRuntimeUpdate(hookEventName, payload, timestamp);
    logPermissionDebug("claude_hook_event.runtime_update", {
      hookEventName,
      sessionId: binding.sessionId,
      providerSessionId,
      hasRuntimeUpdate: runtimeUpdate !== null
    });

    if (!runtimeUpdate) {
      return {
        accepted: true,
        ignored: true,
        sessionId: binding.sessionId,
        bridgeResponse: null
      };
    }

    if (this.shouldIgnoreClaudeExternalRuntimeUpdate(binding.sessionId)) {
      this.clearExternalRuntimeSnapshot(binding.sessionId);

      return {
        accepted: true,
        ignored: true,
        sessionId: binding.sessionId,
        bridgeResponse: null
      };
    }

    await this.applyExternalRuntimeUpdate({
      sessionId: binding.sessionId,
      workspaceId: workspace.id,
      providerSessionId,
      rawStoreRef: binding.rawStoreRef,
      ...runtimeUpdate
    });

    return {
      accepted: true,
      ignored: false,
      sessionId: binding.sessionId,
      bridgeResponse: null
    };
  }

  async getSessionRuntime(sessionId: string, userId: string): Promise<SessionRuntimeStatusView> {
    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(runtimeSessionId);
    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(runtimeSessionId) ?? null;
    const runtimeHasActiveRun = runtimeSnapshot ? isActiveRuntimeState(runtimeSnapshot.runningState) : false;
    const externalHasActiveRun = externalRuntimeSnapshot
      ? isActiveRuntimeState(externalRuntimeSnapshot.runningState)
      : false;
    const session = runtimeSnapshot || externalRuntimeSnapshot
      ? this.sessionHistoryService.getSession(sessionId, userId)
      : await this.sessionHistoryService.refreshRuntimeFallbackSession(sessionId, userId);
    this.maybeDispatchQueuedMessages(session);
    const capabilities = await this.sessionHistoryService.getSessionCapabilities(sessionId);
    const contextUsage = await this.sessionHistoryService.getSessionContextUsage(sessionId).catch(() => null);
    const resolution = runtimeSnapshot
      ? this.sessionActivityAuthorityService.observe(
          createRuntimeActivityObservation(runtimeSessionId, runtimeSnapshot)
        )
      : externalRuntimeSnapshot
        ? this.sessionActivityAuthorityService.observe(
            createExternalRuntimeActivityObservation(runtimeSessionId, externalRuntimeSnapshot)
          )
        : this.sessionActivityAuthorityService.resolvePersistedSession(session);

    if (runtimeSnapshot) {
      return {
        sessionId,
        provider: session.provider,
        providerSessionId: runtimeSnapshot.providerSessionId ?? session.providerSessionId,
        runningState: resolution.runningState,
        hasActiveRun: runtimeHasActiveRun,
        canAttach: runtimeHasActiveRun,
        canInterrupt: runtimeHasActiveRun && runtimeSnapshot.supportsInterrupt,
        inRunInputMode: capabilities.inRunInputMode,
        activityResolutionSource: resolution.activityResolutionSource,
        activityConfidence: resolution.activityConfidence,
        runId: resolution.runId,
        detail: resolution.detail,
        errorCode:
          resolution.runningState === "failed"
            ? resolution.errorCode ?? session.lastErrorCode
            : null,
        errorDetail:
          resolution.runningState === "failed"
            ? resolution.detail ?? session.lastErrorDetail
            : null,
        updatedAt: resolution.updatedAt,
        watchdogTriggeredAt: resolution.watchdogTriggeredAt,
        contextUsage
      };
    }

    if (externalRuntimeSnapshot) {
      return {
        sessionId,
        provider: "claude-code",
        providerSessionId: externalRuntimeSnapshot.providerSessionId,
        runningState: resolution.runningState,
        hasActiveRun: externalHasActiveRun,
        canAttach: false,
        canInterrupt: false,
        inRunInputMode: capabilities.inRunInputMode,
        activityResolutionSource: resolution.activityResolutionSource,
        activityConfidence: resolution.activityConfidence,
        runId: resolution.runId,
        detail: resolution.detail,
        errorCode: resolution.runningState === "failed" ? resolution.errorCode ?? session.lastErrorCode : null,
        errorDetail: resolution.runningState === "failed" ? resolution.detail ?? session.lastErrorDetail : null,
        updatedAt: resolution.updatedAt,
        watchdogTriggeredAt: resolution.watchdogTriggeredAt,
        contextUsage
      };
    }

    const persistedErrorCode = resolution.runningState === "failed" ? resolution.errorCode ?? session.lastErrorCode : null;
    const persistedErrorDetail = resolution.runningState === "failed" ? resolution.detail ?? session.lastErrorDetail : null;

    return {
      sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      runningState: resolution.runningState,
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: capabilities.inRunInputMode,
      activityResolutionSource: resolution.activityResolutionSource,
      activityConfidence: resolution.activityConfidence,
      runId: resolution.runId,
      detail: persistedErrorDetail,
      errorCode: persistedErrorCode,
      errorDetail: persistedErrorDetail,
      updatedAt: resolution.updatedAt,
      watchdogTriggeredAt: resolution.watchdogTriggeredAt,
      contextUsage
    };
  }

  resolveLiveActivityObservation(sessionId: string): SessionActivityObservation | null {
    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(runtimeSessionId);

    if (runtimeSnapshot) {
      return createRuntimeActivityObservation(runtimeSessionId, runtimeSnapshot);
    }

    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(runtimeSessionId) ?? null;

    if (externalRuntimeSnapshot) {
      return createExternalRuntimeActivityObservation(runtimeSessionId, externalRuntimeSnapshot);
    }

    return null;
  }

  async interruptSession(sessionId: string, userId: string): Promise<InterruptSessionResult> {
    this.sessionHistoryService.getSession(sessionId, userId);
    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    const runtime = this.providerRuntimeService.getSnapshot(runtimeSessionId);

    if (!runtime || (runtime.runningState !== "running" && runtime.runningState !== "starting")) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_NOT_RUNNING",
        detail: "当前会话不在运行中，无法中断",
        field: "sessionId"
      });
    }

    const interrupted = await this.providerRuntimeService.interrupt(runtimeSessionId).catch((error) => {
      if (error instanceof Error && error.message === "INTERRUPT_NOT_SUPPORTED") {
        throw new AppError({
          statusCode: 400,
          errorCode: "CAPABILITY_NOT_SUPPORTED",
          detail: "当前 provider 不支持中断",
          field: "sessionId"
        });
      }

      throw mapSessionProviderError(error);
    });

    return {
      sessionId,
      interrupted: true,
      detail: interrupted.detail ?? "interrupt requested"
    };
  }

  registerTerminalStateListener(
    listener: (event: SessionTerminalStateEvent) => Promise<void> | void
  ): ProviderSubscription {
    this.terminalStateListeners.add(listener);

    return {
      close: () => {
        this.terminalStateListeners.delete(listener);
      }
    };
  }

  async listPermissionRequests(
    sessionId: string,
    userId: string
  ): Promise<SessionPermissionRequestView[]> {
    return this.sessionPermissionRequestService.listSessionPermissionRequests(sessionId, userId);
  }

  async replyPermissionRequest(
    sessionId: string,
    userId: string,
    requestId: string,
    input: SessionPermissionReplyInput
  ): Promise<SessionPermissionRequestView> {
    return this.sessionPermissionRequestService.replyToSessionPermissionRequest(
      sessionId,
      userId,
      requestId,
      input
    );
  }

  subscribeRuntime(
    sessionId: string,
    onEnvelope: (envelope: SessionRuntimeEnvelope | SessionHistoryEnvelope) => Promise<void> | void
  ): ProviderSubscription {
    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(runtimeSessionId);
    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(runtimeSessionId) ?? null;
    const initialActivityEnvelope = this.buildSessionActivityEnvelope(sessionId, runtimeSessionId);

    if (runtimeSnapshot) {
      void onEnvelope({
        type: "session.runtime_status",
        sessionId,
        status: runtimeSnapshot.runningState,
        detail: runtimeSnapshot.detail,
        timestamp: runtimeSnapshot.lastEventAt ?? runtimeSnapshot.startedAt
      });
    }

    if (externalRuntimeSnapshot) {
      void onEnvelope({
        type: "session.runtime_status",
        sessionId,
        status: externalRuntimeSnapshot.runningState,
        detail: externalRuntimeSnapshot.detail,
        timestamp: externalRuntimeSnapshot.updatedAt
      });
    }

    if (initialActivityEnvelope) {
      void onEnvelope(initialActivityEnvelope);
    }

    const runtimeSubscription = this.providerRuntimeService.subscribe(runtimeSessionId, async (event) => {
      const envelope = this.mapRuntimeEventToEnvelope(sessionId, event, runtimeSessionId);

      if (!envelope) {
        return;
      }

      await onEnvelope(envelope);
    });
    const externalSubscription = this.subscribeExternalRuntime(runtimeSessionId, async (envelope) => {
      await onEnvelope({
        ...envelope,
        sessionId
      });
    });
    const activitySubscription = this.sessionActivityAuthorityService.subscribe(
      runtimeSessionId,
      async () => {
        const envelope = this.buildSessionActivityEnvelope(sessionId, runtimeSessionId);

        if (!envelope) {
          return;
        }

        await onEnvelope(envelope);
      }
    );

    return {
      close: () => {
        runtimeSubscription.close();
        externalSubscription.close();
        activitySubscription.close();
      }
    };
  }

  async dispose(): Promise<void> {
    this.queueRetryTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.queueRetryTimers.clear();
    this.runtimeMessageSeenSessions.clear();
    this.runtimeHistoryFallbackSentSessions.clear();
    this.sessionActivityAuthorityService.dispose();
    await this.sessionPermissionRequestService.dispose();
    await this.providerRuntimeService.dispose();
    for (const disposable of this.runtimeAdapterDisposables) {
      disposable.dispose();
    }
    this.externalRuntimeSnapshots.clear();
    this.runtimeListeners.clear();
  }

  private subscribeExternalRuntime(
    sessionId: string,
    listener: (envelope: SessionRuntimeEnvelope | SessionHistoryEnvelope) => Promise<void> | void
  ): ProviderSubscription {
    const listeners = this.runtimeListeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.runtimeListeners.set(sessionId, listeners);
    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        const nextListeners = this.runtimeListeners.get(sessionId);

        if (!nextListeners) {
          return;
        }

        nextListeners.delete(listener);

        if (nextListeners.size === 0) {
          this.runtimeListeners.delete(sessionId);
        }
      }
    };
  }

  private async emitExternalRuntimeEnvelope(
    envelope: SessionRuntimeEnvelope | SessionHistoryEnvelope
  ): Promise<void> {
    const listeners = this.runtimeListeners.get(envelope.sessionId);

    if (!listeners || listeners.size === 0) {
      return;
    }

    await Promise.all(
      [...listeners].map(async (listener) => {
        await listener(envelope);
      })
    );
  }

  private buildSessionActivityEnvelope(
    sessionId: string,
    runtimeSessionId = sessionId
  ): SessionActivityEnvelope | null {
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(runtimeSessionId);

    if (runtimeSnapshot) {
      const resolution = this.sessionActivityAuthorityService.observe(
        createRuntimeActivityObservation(runtimeSessionId, runtimeSnapshot)
      );

      return {
        ...this.mapResolutionToActivityEnvelope(resolution, {
          hasActiveRun: isActiveRuntimeState(runtimeSnapshot.runningState),
          canInterrupt:
            isActiveRuntimeState(runtimeSnapshot.runningState) && runtimeSnapshot.supportsInterrupt
        }),
        sessionId
      };
    }

    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(runtimeSessionId) ?? null;

    if (externalRuntimeSnapshot) {
      const resolution = this.sessionActivityAuthorityService.observe(
        createExternalRuntimeActivityObservation(runtimeSessionId, externalRuntimeSnapshot)
      );

      return {
        ...this.mapResolutionToActivityEnvelope(resolution, {
          hasActiveRun: isActiveRuntimeState(externalRuntimeSnapshot.runningState),
          canInterrupt: false
        }),
        sessionId
      };
    }

    const resolution = this.sessionActivityAuthorityService.getResolution(runtimeSessionId);

    if (!resolution) {
      return null;
    }

    return {
      ...this.mapResolutionToActivityEnvelope(resolution, {
        hasActiveRun: resolution.runningState === "stale" || resolution.runningState === "unknown",
        canInterrupt: false
      }),
      sessionId
    };
  }

  private resolveRuntimeSessionId(sessionId: string): string {
    if (
      this.providerRuntimeService.getSnapshot(sessionId)
      || this.externalRuntimeSnapshots.has(sessionId)
    ) {
      return sessionId;
    }

    const listSnapshots =
      "listSnapshots" in this.providerRuntimeService
      && typeof this.providerRuntimeService.listSnapshots === "function"
        ? this.providerRuntimeService.listSnapshots.bind(this.providerRuntimeService)
        : null;

    if (!listSnapshots) {
      return sessionId;
    }

    const linkedSnapshot = listSnapshots()
      .find((snapshot) => this.isLinkedGeminiRuntimeSession(snapshot.sessionId, sessionId));

    return linkedSnapshot?.sessionId ?? sessionId;
  }

  private isLinkedGeminiRuntimeSession(candidateSessionId: string, targetSessionId: string): boolean {
    if (candidateSessionId === targetSessionId) {
      return true;
    }

    const binding = this.sessionBindingRepository.findBySessionId(candidateSessionId);

    if (!binding || binding.provider !== "gemini") {
      return false;
    }

    return isGeminiPendingRuntimeAliasBinding(binding.providerSessionId, targetSessionId)
      || isGeminiPendingRuntimeAliasBinding(binding.rawStoreRef, targetSessionId);
  }

  private mapResolutionToActivityEnvelope(
    resolution: SessionActivityResolution,
    options: {
      hasActiveRun: boolean;
      canInterrupt: boolean;
    }
  ): SessionActivityEnvelope {
    return {
      type: "session.activity",
      sessionId: resolution.sessionId,
      runningState: resolution.runningState,
      activityResolutionSource: resolution.activityResolutionSource,
      activityConfidence: resolution.activityConfidence,
      runId: resolution.runId,
      detail: resolution.detail,
      errorCode: resolution.errorCode,
      errorDetail: resolution.detail,
      hasActiveRun: options.hasActiveRun,
      canInterrupt: options.canInterrupt,
      updatedAt: resolution.updatedAt,
      watchdogTriggeredAt: resolution.watchdogTriggeredAt
    };
  }

  private async resolveClaudeExternalBinding(input: {
    providerSessionId: string;
    workspaceId: string;
    workspacePath: string;
    transcriptPath: string | null;
  }): Promise<{
    sessionId: string;
    rawStoreRef: string;
  }> {
    const rawStoreRef =
      input.transcriptPath ??
      findClaudeSessionFile(this.config.claudeCodeHomeDir, input.providerSessionId) ??
      buildClaudeRawStoreRef(this.config.claudeCodeHomeDir, input.workspacePath, input.providerSessionId);
    let binding =
      this.sessionBindingRepository.findByProviderSession("claude-code", input.providerSessionId) ??
      this.sessionBindingRepository.findByRawStoreRef("claude-code", rawStoreRef);

    if (!binding) {
      const userIds = this.authUserRepository.listIds();
      const bootstrapUserId = userIds[0] ?? null;

      if (bootstrapUserId) {
        await this.sessionHistoryService.discoverWorkspaceSessions(input.workspaceId, bootstrapUserId, {
          force: true,
          refreshStateMode: "deferred"
        }).catch(() => {
          return;
        });
      }

      binding =
        this.sessionBindingRepository.findByProviderSession("claude-code", input.providerSessionId) ??
        this.sessionBindingRepository.findByRawStoreRef("claude-code", rawStoreRef);
    }

    if (binding) {
      return {
        sessionId: binding.sessionId,
        rawStoreRef: binding.rawStoreRef
      };
    }

    const sessionId = createId();
    const timestamp = nowIso();

    this.sessionHistoryService.persistSessionBinding(sessionId, input.workspaceId, {
      provider: "claude-code",
      providerSessionId: input.providerSessionId,
      rawStoreRef
    });
    this.sessionIndexRepository.upsert({
      sessionId,
      workspaceId: input.workspaceId,
      provider: "claude-code",
      parentSessionId: null,
      sessionKind: "default",
      isSubagent: false,
      subagentLabel: null,
      title: `Claude 会话 ${input.providerSessionId.slice(0, 8)}`,
      messageCount: 0,
      isArchived: false,
      lastMessageAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.upsertSnapshot(sessionId, {
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null
    });

    return {
      sessionId,
      rawStoreRef
    };
  }

  private async applyExternalRuntimeUpdate(input: {
    sessionId: string;
    workspaceId: string;
    providerSessionId: string;
    rawStoreRef: string;
    runningState: ExternalRuntimeStatus;
    detail: string | null;
    timestamp: string;
  }): Promise<void> {
    const userIds = this.authUserRepository.listIds();

    if (userIds.length === 0) {
      return;
    }

    const existingIndex = this.sessionIndexRepository.findIndexRecordBySessionId(input.sessionId);

    if (existingIndex) {
      const nextLastMessageAt =
        existingIndex.lastMessageAt && existingIndex.lastMessageAt.localeCompare(input.timestamp) >= 0
          ? existingIndex.lastMessageAt
          : input.timestamp;

      this.sessionIndexRepository.upsert({
        ...existingIndex,
        lastMessageAt: nextLastMessageAt,
        updatedAt: input.timestamp
      });
    }

    for (const userId of userIds) {
      const current = this.sessionStateRepository.findBySessionAndUser(input.sessionId, userId);

      if (current?.lastEventAt && current.lastEventAt.localeCompare(input.timestamp) > 0) {
        continue;
      }

      this.sessionStateRepository.upsert({
        sessionId: input.sessionId,
        userId,
        runningState: input.runningState,
        activitySource: "runtime",
        favorite: current?.favorite ?? false,
        lastEventAt: input.timestamp,
        completedAt: isTerminalSessionRunningState(input.runningState) ? input.timestamp : null,
        lastSeenAt: current?.lastSeenAt ?? null,
        updatedAt: nowIso()
      });
    }

    this.upsertSnapshot(input.sessionId, {
      syncStatus: input.runningState === "failed" ? "error" : "idle",
      syncCursor: this.sessionStatusSnapshotRepository.findBySessionId(input.sessionId)?.syncCursor ?? null,
      lastSyncAt: input.timestamp,
      lastErrorCode: input.runningState === "failed" ? "CLAUDE_HOOK_STOP_FAILURE" : null,
      lastErrorDetail: input.runningState === "failed" ? (input.detail ?? "Claude hook failed") : null,
      resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(input.sessionId)?.resumedAt ?? null
    });

    this.sessionActivityAuthorityService.observe({
      sessionId: input.sessionId,
      runId: null,
      runningState: input.runningState,
      source: "authoritative_provider_event",
      confidence: input.runningState === "failed" ? "strong" : "authoritative",
      detail: input.detail,
      errorCode: input.runningState === "failed" ? "CLAUDE_HOOK_STOP_FAILURE" : null,
      observedAt: input.timestamp
    });

    if (input.runningState === "running") {
      this.externalRuntimeSnapshots.set(input.sessionId, {
        sessionId: input.sessionId,
        provider: "claude-code",
        providerSessionId: input.providerSessionId,
        rawStoreRef: input.rawStoreRef,
        runningState: input.runningState,
        detail: input.detail,
        updatedAt: input.timestamp
      });
    } else {
      this.externalRuntimeSnapshots.delete(input.sessionId);
    }

    const envelope =
      input.runningState === "failed"
        ? ({
            type: "session.runtime_error",
            sessionId: input.sessionId,
            error_code: "CLAUDE_HOOK_STOP_FAILURE",
            detail: input.detail ?? "Claude hook failed",
            timestamp: input.timestamp
          } satisfies SessionRuntimeErrorEnvelope)
        : ({
            type: "session.runtime_status",
            sessionId: input.sessionId,
            status: input.runningState,
            detail: input.detail,
            timestamp: input.timestamp
          } satisfies SessionRuntimeStatusEnvelope);

    await this.emitExternalRuntimeEnvelope(envelope);

    if (isTerminalSessionRunningState(input.runningState)) {
      await this.emitTerminalStateEvent({
        sessionId: input.sessionId,
        status: input.runningState,
        timestamp: input.timestamp,
        detail: input.detail,
        source: "external_runtime"
      });
      void this.dispatchNextQueuedMessage(input.sessionId);
    }
  }

  private async startRuntimeRun(
    request: ProviderRuntimeRunRequest,
    userId: string,
    mode: "start" | "continue"
  ): Promise<void> {
    this.runtimeMessageSeenSessions.delete(request.sessionId);
    this.runtimeHistoryFallbackSentSessions.delete(request.sessionId);

    if (request.provider === "claude-code") {
      this.clearExternalRuntimeSnapshot(request.sessionId);
    }

    const handle = await this.launchRuntimeRun(request, mode);
    const snapshot = handle.getSnapshot();
    const currentState = this.sessionStateRepository.findBySessionAndUser(request.sessionId, userId);

    this.attachRuntimePersistence(handle, request.sessionId, request.workspaceId, userId);
    this.sessionHistoryService.persistSessionBinding(request.sessionId, request.workspaceId, snapshot);
    this.sessionStateRepository.upsert({
      sessionId: request.sessionId,
      userId,
      runningState: toStoredRunningState(snapshot.runningState),
      activitySource: "runtime",
      favorite: currentState?.favorite ?? false,
      lastEventAt: snapshot.lastEventAt,
      completedAt: snapshot.completedAt,
      lastSeenAt: currentState?.lastSeenAt ?? null,
      updatedAt: nowIso()
    });
    this.sessionActivityAuthorityService.observe(
      createRuntimeActivityObservation(request.sessionId, snapshot)
    );
  }

  private async sendLiveMessageDirect(
    input: SendLiveMessageInput,
    persistedAttachments?: PersistedAttachmentBundle
  ): Promise<LiveMessageAcceptedResult> {
    const requestStartedAt = nowIso();
    const session = this.sessionHistoryService.getSession(input.sessionId, input.userId);
    const debugTrace = this.beginPendingSendDebugTrace({
      mode: "send_live",
      sessionId: input.sessionId,
      workspaceId: session.workspaceId,
      provider: session.provider,
      clientRequestId: input.clientRequestId
    });

    try {
      const capabilities = await this.sessionHistoryService.getSessionCapabilities(input.sessionId);
      const workspace = this.workspaceService.getWorkspaceOrThrow(session.workspaceId);
      const runtimeMode = shouldStartNativeSessionOnFirstMessage(session);
      const syntheticForkRawStoreRef =
        runtimeMode === "start" && shouldResumeCodexSyntheticForkSession(session)
          ? session.rawStoreRef
          : null;
      const nextUserSequence =
        runtimeMode === "start"
          ? 1
          : await this.resolveNextUserSequence(input.sessionId, session.messageCount);
      const resolvedAttachments =
        persistedAttachments
        ?? this.persistMessageAttachments(
          input.sessionId,
          input.clientRequestId,
          input.runtimeOptions?.attachments ?? []
        );
      const providerPrompt = this.sessionMessageAttachmentService.buildProviderPrompt(
        session.provider,
        input.content,
        resolvedAttachments.runtimeAttachments
      );

      this.ensureCapability(capabilities.canSendMessage, "sessionId", "provider 不支持实时对话");

      const runtimeRequest = {
        sessionId: input.sessionId,
        workspaceId: session.workspaceId,
        workspacePath: workspace.path,
        provider: session.provider,
        providerSessionId: runtimeMode === "start" ? null : session.providerSessionId,
        rawStoreRef: runtimeMode === "start" ? syntheticForkRawStoreRef : session.rawStoreRef,
        sequenceBase: nextUserSequence,
        options: {
          content: input.content,
          clientRequestId: input.clientRequestId,
          model: input.runtimeOptions?.model ?? null,
          reasoningLevel: input.runtimeOptions?.reasoningLevel ?? null,
          permissionMode: input.runtimeOptions?.permissionMode ?? null,
          providerPrompt,
          attachments: resolvedAttachments.runtimeAttachments
        }
      } as const;

      const runtimeSessionId = this.resolveRuntimeSessionId(input.sessionId);
      const activeRun = this.providerRuntimeService.getSnapshot(runtimeSessionId);
      const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(runtimeSessionId);

      if (
        activeRun &&
        activeRun.provider === "claude-code" &&
        isActiveRuntimeState(activeRun.runningState)
      ) {
        this.clearExternalRuntimeSnapshot(runtimeSessionId);
      }

      if (
        !activeRun &&
        session.provider === "claude-code" &&
        externalRuntimeSnapshot &&
        isActiveRuntimeState(externalRuntimeSnapshot.runningState)
      ) {
        throw new AppError({
          statusCode: 409,
          errorCode: "SESSION_EXTERNAL_RUN_ACTIVE",
          detail: "当前 Claude 外部会话仍在运行，不能直接追加；请加入队列或等待当前轮结束",
          field: "sessionId"
        });
      }

      if (activeRun && isActiveRuntimeState(activeRun.runningState)) {
        const submitStartedAtMs = performance.now();
        await this.providerRuntimeService.submitToActiveRun(runtimeSessionId, runtimeRequest.options)
          .catch((error) => {
            throw mapSessionProviderError(error);
          });
        this.logSendDebugStep(debugTrace, "submit_to_active_run", submitStartedAtMs, {
          runtimeMode,
          activeRunState: activeRun.runningState
        });
      } else {
        const startRuntimeStartedAtMs = performance.now();
        await this.startRuntimeRun(runtimeRequest, input.userId, runtimeMode);
        this.logSendDebugStep(debugTrace, "start_runtime_run", startRuntimeStartedAtMs, {
          runtimeMode
        });
      }

      const binding = this.sessionHistoryService.getBindingOrThrow(input.sessionId);
      const acceptedLookupStartedAtMs = performance.now();
      const acceptedMessage = await this.findAcceptedUserMessage(
        input.sessionId,
        this.sessionMessageAttachmentService.buildAcceptedContentCandidates(
          input.content,
          providerPrompt
        ),
        requestStartedAt
      );
      this.logSendDebugStep(debugTrace, "accepted_user_lookup", acceptedLookupStartedAtMs, {
        matched: Boolean(acceptedMessage)
      });
      const acceptedAt = acceptedMessage?.timestamp ?? nowIso();
      const boundAttachments = this.sessionMessageAttachmentService.bindClientRequestToMessage(
        input.sessionId,
        input.clientRequestId,
        acceptedMessage?.messageId ?? null
      );
      this.refreshSyntheticSessionTitle(session, input.content, input.userId);
      this.markSendDebugResponseReady(debugTrace, {
        runtimeMode,
        returnedAcceptedMessage: Boolean(acceptedMessage),
        returnedSyntheticUser: !acceptedMessage,
        providerSessionId: binding.providerSessionId
      });

      return {
        sessionId: input.sessionId,
        provider: session.provider,
        providerSessionId: binding.providerSessionId,
        acceptedAt,
        clientRequestId: input.clientRequestId,
        message:
          (acceptedMessage
            ? {
                ...acceptedMessage,
                attachments: boundAttachments
              }
            : null) ??
          createSyntheticUserMessage(
            session.provider,
            binding.providerSessionId,
            input.content,
            acceptedAt,
            nextUserSequence,
            boundAttachments.length > 0
              ? boundAttachments
              : resolvedAttachments.messageAttachments
          )
      };
    } catch (error) {
      this.failPendingSendDebugTrace(debugTrace, error);
      throw error;
    }
  }

  private async dispatchNextQueuedMessage(sessionId: string): Promise<void> {
    if (this.queueDispatchSessions.has(sessionId)) {
      return;
    }

    this.queueDispatchSessions.add(sessionId);

    try {
      const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);
      const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(sessionId);

      if (
        (runtimeSnapshot && isActiveRuntimeState(runtimeSnapshot.runningState))
        || (externalRuntimeSnapshot && isActiveRuntimeState(externalRuntimeSnapshot.runningState))
      ) {
        return;
      }

      const nextQueueItem = this.sessionSendQueueRepository.findNextQueued(sessionId);

      if (!nextQueueItem) {
        return;
      }

      const dispatchStartedAt = nowIso();
      const claimed = this.sessionSendQueueRepository.markDispatching(
        nextQueueItem.id,
        dispatchStartedAt
      );

      if (!claimed) {
        return;
      }

      const session = await this.findSessionForQueueDispatch(nextQueueItem);

      if (session && this.shouldBlockQueueDispatch(session)) {
        this.sessionSendQueueRepository.markQueued(nextQueueItem.id, nowIso());
        this.scheduleQueueRetry(sessionId);
        return;
      }

      const restoredAttachments = nextQueueItem.clientRequestId
        ? this.sessionMessageAttachmentService.getRuntimeAttachments(
            sessionId,
            nextQueueItem.clientRequestId
          )
        : [];
      const persistedAttachments: PersistedAttachmentBundle = {
        messageAttachments: restoredAttachments,
        runtimeAttachments: restoredAttachments
      };

      try {
        await this.sendLiveMessageDirect(
          {
            sessionId: nextQueueItem.sessionId,
            userId: nextQueueItem.userId,
            content: nextQueueItem.content,
            clientRequestId: nextQueueItem.clientRequestId,
            runtimeOptions: {
              model: nextQueueItem.model,
              reasoningLevel: nextQueueItem.reasoningLevel,
              permissionMode: nextQueueItem.permissionMode,
              attachments: []
            }
          },
          persistedAttachments
        );
        this.sessionSendQueueRepository.delete(nextQueueItem.id);
      } catch (error) {
        if (isQueueDispatchRetryableError(error)) {
          this.sessionSendQueueRepository.markQueued(nextQueueItem.id, nowIso());
          this.scheduleQueueRetry(sessionId);
          return;
        }

        this.sessionSendQueueRepository.markFailed(
          nextQueueItem.id,
          error instanceof Error ? error.message : "QUEUE_DISPATCH_FAILED",
          nowIso()
        );
      }
    } finally {
      this.queueDispatchSessions.delete(sessionId);
    }
  }

  private maybeDispatchQueuedMessages(session: Pick<SessionListItem, "sessionId" | "provider" | "runningState">): void {
    if (this.shouldBlockQueueDispatch(session)) {
      return;
    }

    void this.dispatchNextQueuedMessage(session.sessionId);
  }

  private shouldBlockQueueDispatch(
    session: Pick<SessionListItem, "sessionId" | "provider" | "runningState">
  ): boolean {
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(session.sessionId);

    if (runtimeSnapshot && isActiveRuntimeState(runtimeSnapshot.runningState)) {
      return true;
    }

    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(session.sessionId);

    if (externalRuntimeSnapshot && isActiveRuntimeState(externalRuntimeSnapshot.runningState)) {
      return true;
    }

    if (session.provider === "claude-code" && isPendingSessionRunningState(session.runningState)) {
      return true;
    }

    return false;
  }

  private scheduleQueueRetry(sessionId: string): void {
    if (this.queueRetryTimers.has(sessionId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.queueRetryTimers.delete(sessionId);
      void this.dispatchNextQueuedMessage(sessionId);
    }, 1200);

    this.queueRetryTimers.set(sessionId, timer);
  }

  private async findSessionForQueueDispatch(
    queueItem: Pick<SessionSendQueueItemRecord, "sessionId" | "userId"> | null
  ): Promise<SessionListItem | null> {
    if (!queueItem) {
      return null;
    }

    try {
      return await this.resolveQueueDispatchSession(queueItem.sessionId, queueItem.userId);
    } catch {
      return null;
    }
  }

  private async resolveQueueDispatchSession(
    sessionId: string,
    userId: string
  ): Promise<SessionListItem> {
    const session = this.sessionHistoryService.getSession(sessionId, userId);

    if (
      session.provider !== "claude-code"
      || !isPendingSessionRunningState(session.runningState)
    ) {
      return session;
    }

    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);
    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(sessionId);

    if (
      (runtimeSnapshot && isActiveRuntimeState(runtimeSnapshot.runningState))
      || (externalRuntimeSnapshot && isActiveRuntimeState(externalRuntimeSnapshot.runningState))
    ) {
      return session;
    }

    return Promise.resolve(this.sessionHistoryService.refreshRuntimeFallbackSession(sessionId, userId))
      .then((refreshedSession) => refreshedSession ?? session)
      .catch(() => session);
  }

  private async launchRuntimeRun(
    request: ProviderRuntimeRunRequest,
    mode: "start" | "continue"
  ): Promise<ActiveRunHandle> {
    try {
      return await (mode === "start"
        ? this.providerRuntimeService.startSession(request)
        : this.providerRuntimeService.continueSession(request));
    } catch (error) {
      throw mapSessionProviderError(error);
    }
  }

  private attachRuntimePersistence(
    handle: ActiveRunHandle,
    sessionId: string,
    workspaceId: string,
    userId: string
  ): void {
    handle.attach(async (event) => {
      await this.persistRuntimeEvent(sessionId, workspaceId, userId, event);
    });
  }

  private createRuntimeBackedSession(input: {
    sessionId: string;
    workspaceId: string;
    userId: string;
    provider: string;
    parentSessionId: string | null;
    sessionKind: "default" | "annotation";
    annotationSourceMessageId: string | null;
    annotationSourceText: string | null;
    initialContent: string;
    snapshot: ReturnType<ActiveRunHandle["getSnapshot"]>;
  }): void {
    const timestamp = nowIso();
    this.sessionHistoryService.persistSessionBinding(
      input.sessionId,
      input.workspaceId,
      this.buildBindingSnapshot(
        input.sessionId,
        input.snapshot.provider,
        input.snapshot.providerSessionId,
        input.snapshot.rawStoreRef
      )
    );
    this.sessionIndexRepository.upsert({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      parentSessionId: input.parentSessionId,
      sessionKind: input.sessionKind,
      annotationSourceMessageId: input.annotationSourceMessageId,
      annotationSourceText: input.annotationSourceText,
      isSubagent: false,
      subagentLabel: null,
      title: buildSessionTitle(input.initialContent),
      messageCount: 0,
      isArchived: false,
      lastMessageAt: input.snapshot.lastEventAt,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.upsertSnapshot(input.sessionId, {
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: input.snapshot.lastEventAt ?? timestamp,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null
    });
    this.sessionStateRepository.upsert({
      sessionId: input.sessionId,
      userId: input.userId,
      runningState: toStoredRunningState(input.snapshot.runningState),
      activitySource: "runtime",
      favorite: false,
      lastEventAt: input.snapshot.lastEventAt,
      completedAt: input.snapshot.completedAt,
      lastSeenAt: null,
      updatedAt: timestamp
    });
    this.sessionActivityAuthorityService.observe(
      createRuntimeActivityObservation(input.sessionId, input.snapshot)
    );
  }

  private ensurePendingSessionBinding(
    sessionId: string,
    workspaceId: string,
    provider: string
  ): void {
    this.sessionHistoryService.persistSessionBinding(
      sessionId,
      workspaceId,
      this.buildBindingSnapshot(sessionId, provider, null, null)
    );
  }

  private buildBindingSnapshot(
    sessionId: string,
    provider: string,
    providerSessionId: string | null,
    rawStoreRef: string | null
  ): { provider: string; providerSessionId: string; rawStoreRef: string } {
    const pendingValue = `pending://${provider}/${sessionId}`;

    return {
      provider,
      providerSessionId: providerSessionId ?? pendingValue,
      rawStoreRef: rawStoreRef ?? pendingValue
    };
  }

  private async persistRuntimeEvent(
    sessionId: string,
    workspaceId: string,
    userId: string,
    event: RuntimeEvent
  ): Promise<void> {
    this.observePendingSendDebugTraceEvent(sessionId, event);
    this.sessionHistoryService.persistSessionBinding(sessionId, workspaceId, {
      provider: event.provider,
      providerSessionId: event.providerSessionId,
      rawStoreRef: event.rawStoreRef
    });
    const currentState = this.sessionStateRepository.findBySessionAndUser(sessionId, userId);
    const currentRunningState = currentState?.runningState ?? null;
    const shouldPreserveTerminalState = isTerminalSessionRunningState(currentRunningState);

    if (event.type === "message") {
      this.runtimeMessageSeenSessions.add(sessionId);
      this.runtimeHistoryFallbackSentSessions.delete(sessionId);
      const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
      await this.sessionHistoryService.syncSessionTitle(sessionId).catch(() => {
        return;
      });
      const existing = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

      if (existing) {
        this.sessionIndexRepository.upsert({
          ...existing,
          messageCount: existing.messageCount + 1,
          lastMessageAt: event.message.timestamp,
          updatedAt: event.message.timestamp
        });
      }

      this.sessionChangedFileService.recordMessages(
        sessionId,
        workspaceId,
        workspace.path,
        [event.message]
      );

      this.sessionStateRepository.upsert({
        sessionId,
        userId,
        runningState: shouldPreserveTerminalState ? currentRunningState : "running",
        activitySource: "runtime",
        favorite: currentState?.favorite ?? false,
        lastEventAt: event.message.timestamp,
        completedAt: shouldPreserveTerminalState ? currentState?.completedAt ?? null : null,
        lastSeenAt: currentState?.lastSeenAt ?? null,
        updatedAt: nowIso()
      });

      this.upsertSnapshot(sessionId, {
        syncStatus: "idle",
        syncCursor:
          this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
        lastSyncAt: event.message.timestamp,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
      });
      return;
    }

    if (shouldPreserveTerminalState) {
      this.sessionStateRepository.upsert({
        sessionId,
        userId,
        runningState: currentRunningState,
        activitySource: "runtime",
        favorite: currentState?.favorite ?? false,
        lastEventAt: event.timestamp,
        completedAt: currentState?.completedAt ?? null,
        lastSeenAt: currentState?.lastSeenAt ?? null,
        updatedAt: nowIso()
      });

      this.upsertSnapshot(sessionId, {
        syncStatus: "idle",
        syncCursor:
          this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
        lastSyncAt: event.timestamp,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
      });
      await this.maybeEmitRuntimeHistoryFallback(sessionId, event);
      return;
    }

    const completedAt =
      event.status === "completed" || event.status === "interrupted" || event.status === "failed"
        ? event.timestamp
        : this.sessionStateRepository.findBySessionAndUser(sessionId, userId)?.completedAt ?? null;

    if (completedAt) {
      await this.sessionHistoryService.syncSessionTitle(sessionId).catch(() => {
        return;
      });
    }

    this.sessionStateRepository.upsert({
      sessionId,
      userId,
      runningState: toStoredRunningState(event.status),
      activitySource: "runtime",
      favorite: currentState?.favorite ?? false,
      lastEventAt: event.timestamp,
      completedAt,
      lastSeenAt: currentState?.lastSeenAt ?? null,
      updatedAt: nowIso()
    });

    this.sessionActivityAuthorityService.observe(
      createRuntimeEventObservation(
        sessionId,
        event,
        this.providerRuntimeService.getSnapshot(sessionId)?.startedAt ?? null
      )
    );

    this.upsertSnapshot(sessionId, {
      syncStatus: event.type === "error" ? "error" : "idle",
      syncCursor:
        this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
      lastSyncAt: event.timestamp,
      lastErrorCode: event.type === "error" ? event.errorCode : null,
      lastErrorDetail: event.type === "error" ? (event.detail ?? "runtime failed") : null,
      resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
    });

    await this.maybeEmitRuntimeHistoryFallback(sessionId, event);

    if (isTerminalRuntimeEventStatus(event.status)) {
      if (!isTerminalSessionRunningState(currentRunningState)) {
        await this.emitTerminalStateEvent({
          sessionId,
          status: event.status,
          timestamp: event.timestamp,
          detail: event.detail ?? null,
          source: "runtime"
        });
      }

      void this.dispatchNextQueuedMessage(sessionId);
    }
  }

  private async emitTerminalStateEvent(event: SessionTerminalStateEvent): Promise<void> {
    for (const listener of this.terminalStateListeners) {
      await listener(event);
    }
  }

  private beginPendingSendDebugTrace(input: {
    mode: PendingSessionSendDebugTrace["mode"];
    sessionId: string;
    workspaceId: string;
    provider: string;
    clientRequestId: string | null;
  }): PendingSessionSendDebugTrace | null {
    if (!isPerfDebugEnabled()) {
      return null;
    }

    const trace: PendingSessionSendDebugTrace = {
      ...input,
      startedAtMs: performance.now(),
      responseReadyAtMs: null,
      firstRuntimeEventAtMs: null
    };
    const queue = this.pendingSendDebugTracesBySessionId.get(input.sessionId) ?? [];
    queue.push(trace);
    this.pendingSendDebugTracesBySessionId.set(input.sessionId, queue);
    logPerformance(
      `session_send.${trace.mode}.begin`,
      0,
      this.buildSendDebugDetail(trace),
      {
        force: true,
        thresholdMs: 0
      }
    );
    return trace;
  }

  private logSendDebugStep(
    trace: PendingSessionSendDebugTrace | null,
    step: string,
    startedAtMs: number,
    detail: Record<string, unknown> = {}
  ): void {
    if (!trace) {
      return;
    }

    logPerformance(
      `session_send.${trace.mode}.${step}`,
      performance.now() - startedAtMs,
      {
        ...this.buildSendDebugDetail(trace),
        ...detail
      },
      {
        force: true,
        thresholdMs: 0
      }
    );
  }

  private markSendDebugResponseReady(
    trace: PendingSessionSendDebugTrace | null,
    detail: Record<string, unknown> = {}
  ): void {
    if (!trace || trace.responseReadyAtMs !== null) {
      return;
    }

    trace.responseReadyAtMs = performance.now();
    logPerformance(
      `session_send.${trace.mode}.response_ready`,
      trace.responseReadyAtMs - trace.startedAtMs,
      {
        ...this.buildSendDebugDetail(trace),
        ...detail
      },
      {
        force: true,
        thresholdMs: 0
      }
    );
  }

  private failPendingSendDebugTrace(
    trace: PendingSessionSendDebugTrace | null,
    error: unknown
  ): void {
    if (!trace) {
      return;
    }

    logPerformance(
      `session_send.${trace.mode}.error`,
      performance.now() - trace.startedAtMs,
      {
        ...this.buildSendDebugDetail(trace),
        error: error instanceof Error ? error.message : String(error)
      },
      {
        force: true,
        thresholdMs: 0
      }
    );
    this.removePendingSendDebugTrace(trace);
  }

  private observePendingSendDebugTraceEvent(sessionId: string, event: RuntimeEvent): void {
    const trace = this.peekPendingSendDebugTrace(sessionId);

    if (!trace) {
      return;
    }

    const nowMs = performance.now();

    if (trace.firstRuntimeEventAtMs === null) {
      trace.firstRuntimeEventAtMs = nowMs;
      logPerformance(
        `session_send.${trace.mode}.first_runtime_event`,
        trace.firstRuntimeEventAtMs - trace.startedAtMs,
        {
          ...this.buildSendDebugDetail(trace),
          eventType: event.type,
          status: event.status,
          role: event.type === "message" ? event.message.role : null,
          kind: event.type === "message" ? event.message.kind : null,
          responseReady: trace.responseReadyAtMs !== null
        },
        {
          force: true,
          thresholdMs: 0
        }
      );
    }

    if (event.type === "message" && event.message.role === "assistant") {
      logPerformance(
        `session_send.${trace.mode}.first_assistant_message`,
        nowMs - trace.startedAtMs,
        {
          ...this.buildSendDebugDetail(trace),
          kind: event.message.kind,
          contentLength: event.message.content.length,
          responseToAssistantMs:
            trace.responseReadyAtMs === null ? null : nowMs - trace.responseReadyAtMs
        },
        {
          force: true,
          thresholdMs: 0
        }
      );
      this.removePendingSendDebugTrace(trace);
      return;
    }

    if (
      event.type === "error" ||
      (event.type !== "message" && isTerminalRuntimeEventStatus(event.status))
    ) {
      logPerformance(
        `session_send.${trace.mode}.completed_without_assistant`,
        nowMs - trace.startedAtMs,
        {
          ...this.buildSendDebugDetail(trace),
          eventType: event.type,
          status: event.status,
          detail: event.detail
        },
        {
          force: true,
          thresholdMs: 0
        }
      );
      this.removePendingSendDebugTrace(trace);
    }
  }

  private peekPendingSendDebugTrace(sessionId: string): PendingSessionSendDebugTrace | null {
    const queue = this.pendingSendDebugTracesBySessionId.get(sessionId);
    return queue && queue.length > 0 ? queue[0] : null;
  }

  private removePendingSendDebugTrace(trace: PendingSessionSendDebugTrace): void {
    const queue = this.pendingSendDebugTracesBySessionId.get(trace.sessionId);

    if (!queue || queue.length === 0) {
      return;
    }

    const nextQueue = queue.filter((item) => item !== trace);

    if (nextQueue.length === 0) {
      this.pendingSendDebugTracesBySessionId.delete(trace.sessionId);
      return;
    }

    this.pendingSendDebugTracesBySessionId.set(trace.sessionId, nextQueue);
  }

  private buildSendDebugDetail(
    trace: PendingSessionSendDebugTrace
  ): Record<string, unknown> {
    return {
      sessionId: trace.sessionId,
      workspaceId: trace.workspaceId,
      provider: trace.provider,
      clientRequestId: trace.clientRequestId
    };
  }

  private async findAcceptedUserMessage(
    sessionId: string,
    content: string | string[],
    minTimestamp: string
  ): Promise<SendMessageResult["message"] | null> {
    try {
      return await withTimeout(
        this.sessionHistoryService.findLatestUserMessage(sessionId, content, 12, minTimestamp),
        1200
      );
    } catch {
      return null;
    }
  }

  private async resolveNextUserSequence(
    sessionId: string,
    messageCount: number
  ): Promise<number> {
    let maxSequence = Math.max(messageCount, 0);
    const envelope = await Promise.resolve(
      this.sessionHistoryService.readRecentHistoryEnvelope(sessionId, 10)
    ).catch(() => {
      return null;
    });

    for (const message of envelope?.messages ?? []) {
      if (Number.isFinite(message.sequence) && message.sequence > maxSequence) {
        maxSequence = message.sequence;
      }
    }

    return Math.max(maxSequence + 1, 1);
  }

  private async waitForResolvedStartBinding(
    sessionId: string,
    workspaceId: string,
    provider: string,
    handle: ActiveRunHandle
  ): Promise<void> {
    if (provider !== "gemini" && provider !== "kimi") {
      return;
    }

    const startedAt = Date.now();

    while (Date.now() - startedAt < RUNTIME_START_BINDING_WAIT_TIMEOUT_MS) {
      const snapshot = handle.getSnapshot();

      if (hasResolvedRuntimeBinding(snapshot.providerSessionId, snapshot.rawStoreRef)) {
        this.sessionHistoryService.persistSessionBinding(sessionId, workspaceId, {
          provider: snapshot.provider,
          providerSessionId: snapshot.providerSessionId,
          rawStoreRef: snapshot.rawStoreRef
        });
        return;
      }

      await waitForRuntimeBindingPoll();
    }
  }

  private persistMessageAttachments(
    sessionId: string,
    clientRequestId: string | null,
    attachments: SessionImageAttachmentInput[]
  ) {
    if (!clientRequestId || attachments.length === 0) {
      return {
        messageAttachments: [] as NormalizedMessageAttachment[],
        runtimeAttachments: []
      };
    }

    return this.sessionMessageAttachmentService.persistImageAttachments({
      sessionId,
      clientRequestId,
      attachments
    });
  }

  private refreshSyntheticSessionTitle(
    session: Pick<
      SessionListItem,
      "sessionId" | "provider" | "title" | "parentSessionId" | "forkMethod" | "forkSourceType"
    >,
    content: string,
    userId: string
  ): void {
    const currentIndex = this.sessionIndexRepository.findIndexRecordBySessionId(session.sessionId);

    if (!currentIndex) {
      return;
    }

    const parentTitle =
      session.parentSessionId
        ? this.sessionHistoryService.getSession(session.parentSessionId, userId).title
        : null;
    const nextTitle = resolveRuntimeSessionTitle(
      currentIndex.provider,
      currentIndex.title,
      content,
      parentTitle,
      session.forkMethod,
      session.forkSourceType
    );

    if (!nextTitle || nextTitle === currentIndex.title) {
      return;
    }

    this.sessionIndexRepository.upsert({
      ...currentIndex,
      title: nextTitle,
      updatedAt: nowIso()
    });
  }

  private mapRuntimeEventToEnvelope(
    sessionId: string,
    event: RuntimeEvent,
    originSessionId = sessionId
  ): SessionRuntimeEnvelope | null {
    if (event.type === "message") {
      return {
        type: "session.runtime_message",
        sessionId,
        message: this.sessionHistoryService.resolveMessageOrigin(originSessionId, event.message),
        source: "runtime"
      };
    }

    if (event.type === "error") {
      return {
        type: "session.runtime_error",
        sessionId,
        error_code: event.errorCode,
        detail: event.detail ?? "runtime failed",
        timestamp: event.timestamp
      };
    }

    if (event.type === "interrupted") {
      return {
        type: "session.interrupted",
        sessionId,
        detail: event.detail,
        timestamp: event.timestamp
      };
    }

    return {
      type: "session.runtime_status",
      sessionId,
      status: event.status,
      detail: event.detail,
      timestamp: event.timestamp
    };
  }

  private async maybeEmitRuntimeHistoryFallback(
    sessionId: string,
    event: RuntimeEvent
  ): Promise<void> {
    if (event.provider !== "claude-code") {
      return;
    }

    if (event.status === "starting") {
      return;
    }

    if (this.runtimeMessageSeenSessions.has(sessionId)) {
      return;
    }

    if (this.runtimeHistoryFallbackSentSessions.has(sessionId)) {
      return;
    }

    const envelope = await Promise.resolve(
      this.sessionHistoryService.readRecentHistoryEnvelope(sessionId)
    ).catch(() => {
      return null;
    });

    if (!envelope) {
      return;
    }

    this.runtimeHistoryFallbackSentSessions.add(sessionId);
    await this.emitExternalRuntimeEnvelope(envelope);
  }

  private ensureCapability(enabled: boolean, field: string, detail: string): void {
    if (enabled) {
      return;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "CAPABILITY_NOT_SUPPORTED",
      detail,
      field
    });
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

  private shouldIgnoreClaudeExternalRuntimeUpdate(sessionId: string): boolean {
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);

    return Boolean(
      runtimeSnapshot &&
      runtimeSnapshot.provider === "claude-code" &&
      isActiveRuntimeState(runtimeSnapshot.runningState)
    );
  }

  private clearExternalRuntimeSnapshot(sessionId: string): void {
    this.externalRuntimeSnapshots.delete(sessionId);
  }

  private async resolveActiveClaudePermissionSession(input: {
    providerSessionId: string;
    workspaceId: string;
    workspacePath: string;
    transcriptPath: string | null;
  }): Promise<{ sessionId: string; rawStoreRef: string } | null> {
    const activeSnapshots = this.providerRuntimeService
      .listSnapshots()
      .filter(
        (snapshot) =>
          snapshot.provider === "claude-code" &&
          snapshot.workspaceId === input.workspaceId &&
          isActiveRuntimeState(snapshot.runningState)
      );

    if (activeSnapshots.length !== 1) {
      return null;
    }

    const activeSnapshot = activeSnapshots[0];

    if (!activeSnapshot) {
      return null;
    }

    const rawStoreRef =
      input.transcriptPath ??
      activeSnapshot.rawStoreRef ??
      buildClaudeRawStoreRef(this.config.claudeCodeHomeDir, input.workspacePath, input.providerSessionId);

    this.sessionHistoryService.persistSessionBinding(activeSnapshot.sessionId, input.workspaceId, {
      provider: "claude-code",
      providerSessionId: input.providerSessionId,
      rawStoreRef
    });

    return {
      sessionId: activeSnapshot.sessionId,
      rawStoreRef
    };
  }
}

function createSyntheticUserMessage(
  provider: string,
  providerSessionId: string,
  content: string,
  timestamp: string,
  sequence: number,
  attachments: NormalizedMessageAttachment[] = []
): SendMessageResult["message"] {
  const syntheticId = createId();

  return {
    messageId: `synthetic-${syntheticId}`,
    provider: provider as SendMessageResult["message"]["provider"],
    providerSessionId,
    role: "user",
    kind: "text",
    content,
    toolCall: null,
    attachments,
    timestamp,
    sequence,
    rawRef: `synthetic://${provider}/${providerSessionId}/${syntheticId}`
  };
}

function createRuntimeActivityObservation(
  sessionId: string,
  snapshot: {
    startedAt: string;
    lastEventAt: string | null;
    runningState: RuntimeRunState;
    detail: string | null;
    errorCode?: string | null;
  }
): SessionActivityObservation {
  return {
    sessionId,
    runId: buildRuntimeRunId(sessionId, snapshot.startedAt),
    runningState: snapshot.runningState,
    source: "authoritative_runtime",
    confidence:
      snapshot.runningState === "failed" || snapshot.runningState === "completed" || snapshot.runningState === "interrupted"
        ? "strong"
        : "authoritative",
    detail: snapshot.detail,
    errorCode: snapshot.runningState === "failed" ? snapshot.errorCode ?? null : null,
    observedAt: snapshot.lastEventAt ?? snapshot.startedAt
  };
}

function createExternalRuntimeActivityObservation(
  sessionId: string,
  snapshot: {
    runningState: ExternalRuntimeStatus;
    detail: string | null;
    updatedAt: string;
  }
): SessionActivityObservation {
  return {
    sessionId,
    runId: null,
    runningState: snapshot.runningState,
    source: "authoritative_provider_event",
    confidence: snapshot.runningState === "failed" ? "strong" : "authoritative",
    detail: snapshot.detail,
    errorCode: snapshot.runningState === "failed" ? "CLAUDE_HOOK_STOP_FAILURE" : null,
    observedAt: snapshot.updatedAt
  };
}

function createRuntimeEventObservation(
  sessionId: string,
  event: RuntimeEvent,
  startedAt: string | null
): SessionActivityObservation {
  return {
    sessionId,
    runId: buildRuntimeRunId(sessionId, startedAt ?? event.timestamp),
    runningState: event.type === "message" ? "running" : event.status ?? "running",
    source: "authoritative_runtime",
    confidence:
      event.type === "error" || event.status === "completed" || event.status === "interrupted"
        ? "strong"
        : "authoritative",
    detail:
      event.type === "message"
        ? "Host 正在接收这一轮运行的实时事件"
        : event.detail,
    errorCode: event.type === "error" ? event.errorCode : null,
    observedAt: event.type === "message" ? event.message.timestamp : event.timestamp
  };
}

function buildRuntimeRunId(sessionId: string, startedAt: string): string {
  return `runtime:${sessionId}:${startedAt}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    void promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toStoredRunningState(state: RuntimeRunState): SessionRunningState {
  return state;
}

function normalizeClaudeHookEventName(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function isSupportedClaudeHookEvent(value: string): boolean {
  return (
    value === "PreToolUse" ||
    value === "PermissionRequest" ||
    value === "Notification" ||
    value === "UserPromptSubmit" ||
    value === "SessionStart" ||
    value === "Stop" ||
    value === "StopFailure" ||
    value === "SessionEnd"
  );
}

function normalizeRequiredText(value: string | undefined, field: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能为空`,
      field
    });
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function mapClaudeHookToRuntimeUpdate(
  hookEventName: string,
  payload: ClaudeHookEventPayload,
  timestamp: string
): {
  runningState: ExternalRuntimeStatus;
  detail: string | null;
  timestamp: string;
} | null {
  if (hookEventName === "UserPromptSubmit") {
    return {
      runningState: "running",
      detail: "Claude Code 外部会话正在响应新的用户输入",
      timestamp
    };
  }

  if (hookEventName === "SessionStart") {
    return {
      runningState: "running",
      detail: "Claude Code 外部会话已启动",
      timestamp
    };
  }

  if (hookEventName === "StopFailure") {
    return {
      runningState: "failed",
      detail: "Claude Code 外部会话执行失败",
      timestamp
    };
  }

  if (hookEventName === "Stop") {
    if (payload.stop_hook_active) {
      return {
        runningState: "running",
        detail: "Claude Code 外部会话仍在继续执行",
        timestamp
      };
    }

    return {
      runningState: "completed",
      detail: "Claude Code 外部会话本轮输出已结束",
      timestamp
    };
  }

  if (hookEventName === "SessionEnd") {
    return {
      runningState: "completed",
      detail: payload.reason?.trim() ? `Claude Code 外部会话已结束：${payload.reason.trim()}` : "Claude Code 外部会话已结束",
      timestamp
    };
  }

  return null;
}

function buildSessionTitle(content: string): string {
  const title = content.trim().replace(/\s+/g, " ");
  return title.slice(0, 48) || "继续对话";
}

function resolveRuntimeSessionTitle(
  provider: string,
  existingTitle: string,
  content: string,
  parentTitle: string | null,
  forkMethod: SessionListItem["forkMethod"],
  forkSourceType: SessionListItem["forkSourceType"]
): string | null {
  const normalizedExistingTitle = existingTitle.trim();
  const normalizedParentTitle = parentTitle?.trim() ?? "";
  const isForkSession = Boolean(forkMethod || forkSourceType);

  if (
    normalizedExistingTitle.length > 0 &&
    !isSyntheticRuntimeSessionTitle(provider, normalizedExistingTitle) &&
    (!isForkSession || normalizedExistingTitle !== normalizedParentTitle)
  ) {
    return null;
  }

  return buildSessionTitle(content);
}

function isSyntheticRuntimeSessionTitle(provider: string, title: string): boolean {
  if (provider !== "codex") {
    return false;
  }

  return (
    /^rollout-\d{4}-\d{2}-\d{2}t/i.test(title) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)
  );
}

function shouldStartNativeSessionOnFirstMessage(session: {
  provider: string;
  providerSessionId: string;
  messageCount: number;
}): "start" | "continue" {
  if (session.provider !== "codex" && session.provider !== "opencode") {
    return "continue";
  }

  if (session.provider === "codex" && session.providerSessionId.startsWith("rollout-")) {
    return "start";
  }

  if (session.messageCount > 0) {
    return "continue";
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    session.providerSessionId
  )
    ? "continue"
    : "start";
}

function shouldResumeCodexSyntheticForkSession(session: {
  provider: string;
  providerSessionId: string;
  messageCount: number;
  rawStoreRef?: string | null;
}): boolean {
  return (
    session.provider === "codex"
    && session.messageCount > 0
    && session.providerSessionId.startsWith("rollout-")
    && Boolean(session.rawStoreRef?.trim())
  );
}

function isActiveRuntimeState(state: RuntimeRunState | SessionRunningState): boolean {
  return state === "starting" || state === "running";
}

function isTerminalRuntimeEventStatus(
  status: RuntimeEvent["status"]
): status is "completed" | "interrupted" | "failed" {
  return status === "completed" || status === "interrupted" || status === "failed";
}

function isPendingSessionRunningState(
  state: SessionResolvedRunningState | SessionRunningState | RuntimeRunState | null | undefined
): boolean {
  return state === "starting" || state === "running";
}

function isQueueDispatchRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    if (
      error.errorCode === "ACTIVE_RUN_EXISTS"
      || error.errorCode === "SESSION_NOT_RUNNING"
      || error.errorCode === "IN_RUN_INPUT_NOT_SUPPORTED"
      || error.errorCode === "SESSION_EXTERNAL_RUN_ACTIVE"
      || error.errorCode === "PROVIDER_RUNTIME_UNAVAILABLE"
      || error.errorCode === "PROVIDER_RUNTIME_TIMEOUT"
    ) {
      return true;
    }

    return error.statusCode >= 500;
  }

  if (error instanceof Error) {
    return (
      error.message === "ACTIVE_RUN_EXISTS"
      || error.message === "SESSION_NOT_RUNNING"
      || error.message === "IN_RUN_INPUT_NOT_SUPPORTED"
      || error.message === "SESSION_EXTERNAL_RUN_ACTIVE"
      || error.message === "SERVER_UNAVAILABLE"
      || error.message === "SERVER_TIMEOUT"
    );
  }

  return false;
}

function mapQueueItemRecordToView(record: SessionSendQueueItemRecord): SessionQueueItemView {
  return {
    id: record.id,
    sessionId: record.sessionId,
    content: record.content,
    clientRequestId: record.clientRequestId,
    model: record.model,
    reasoningLevel: record.reasoningLevel,
    permissionMode: record.permissionMode,
    status: record.status,
    orderIndex: record.orderIndex,
    errorDetail: record.errorDetail,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function isTerminalSessionRunningState(
  state: SessionRunningState | null | undefined
): state is "completed" | "interrupted" | "failed" {
  return state === "completed" || state === "interrupted" || state === "failed";
}

function hasResolvedRuntimeBinding(
  providerSessionId: string | null,
  rawStoreRef: string | null
): providerSessionId is string {
  if (!providerSessionId?.trim() || !rawStoreRef?.trim()) {
    return false;
  }

  return !providerSessionId.trim().toLowerCase().startsWith("pending://")
    && !rawStoreRef.trim().toLowerCase().startsWith("pending://");
}

function waitForRuntimeBindingPoll(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, START_BINDING_POLL_INTERVAL_MS);
  });
}

function isGeminiPendingRuntimeAliasBinding(value: string, targetSessionId: string): boolean {
  return value.trim().toLowerCase() === `pending://gemini/${targetSessionId.trim().toLowerCase()}`;
}

function shouldAwaitAcceptedUserMessage(provider: string): boolean {
  return provider !== "gemini";
}

function shouldAwaitStartBindingBeforeAcceptedUserLookup(provider: string): boolean {
  return provider === "kimi";
}

function waitForAcceptedUserLookupWindow(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 1200);
  });
}

function createProviderRuntimeAdapters(
  config: HostConfig,
  options: {
    handleCodexServerRequest?: (input: {
      sessionId: string;
      providerSessionId: string;
      request: Record<string, unknown>;
    }) => Promise<unknown>;
  } = {}
): {
  adapters: ProviderRuntimeAdapter[];
  disposables: Array<{ dispose(): void }>;
} {
  const claudeHookBridgeConfig = buildClaudeHookBridgeConfig(config);
  const claudeAdapter =
    process.env.VITEST
      ? new ClaudeRuntimeAdapter({
        homeDir: config.claudeCodeHomeDir,
        hookBridge: {
          url: claudeHookBridgeConfig.bridgeUrl,
          token: config.claudeHookBridgeToken,
          scriptPath: claudeHookBridgeConfig.scriptPath
        }
      })
      : new ClaudeRuntimeHelperAdapter({
        homeDir: config.claudeCodeHomeDir,
        hookBridge: {
          url: claudeHookBridgeConfig.bridgeUrl,
          token: config.claudeHookBridgeToken,
          scriptPath: claudeHookBridgeConfig.scriptPath
        }
      });
  const disposables: Array<{ dispose(): void }> = [];

  if ("dispose" in claudeAdapter && typeof claudeAdapter.dispose === "function") {
    disposables.push(claudeAdapter);
  }

  const codexTransportHelper =
    process.env.VITEST
      ? null
      : new CodexAppServerHelperClient(config.codexCliPath, {
        homeDir: config.codexHomeDir
      });

  if (codexTransportHelper) {
    disposables.push(codexTransportHelper);
  }

  return {
    adapters: [
      claudeAdapter,
      new CodexRuntimeAdapter({
        homeDir: config.codexHomeDir,
        commandPath: config.codexCliPath,
        transportFactory: codexTransportHelper?.createTransport.bind(codexTransportHelper),
        handleServerRequest: options.handleCodexServerRequest
      }),
      new GeminiRuntimeAdapter({
        homeDir: config.geminiHomeDir,
        commandPath: config.geminiCliPath
      }),
      new KimiRuntimeAdapter({
        homeDir: config.kimiHomeDir,
        commandPath: config.kimiCliPath
      }),
      new OpenCodeRuntimeAdapter({
        baseUrl: config.opencodeBaseUrl,
        baseUrlResolver: config.opencodeBaseUrlResolver?.resolve.bind(config.opencodeBaseUrlResolver)
      })
    ],
    disposables
  };
}

function buildClaudeHookBridgeConfig(config: HostConfig): ClaudeHookBridgeConfig {
  const bridgeUrl = `http://127.0.0.1:${config.port}/api/providers/claude-code/hook-bridge/events`;
  const scriptPath = resolveClaudeHookBridgeScriptPath();
  const command = `node "${scriptPath}" --url "${bridgeUrl}" --token "${config.claudeHookBridgeToken}"`;

  return {
    provider: "claude-code",
    bridgeUrl,
    token: config.claudeHookBridgeToken,
    scriptPath,
    command,
    supportedEvents: [
      "PreToolUse",
      "PermissionRequest",
      "Notification",
      "UserPromptSubmit",
      "SessionStart",
      "Stop",
      "StopFailure",
      "SessionEnd"
    ]
  };
}

function resolveClaudeHookBridgeScriptPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "scripts", "claude-hook-bridge.cjs"),
    path.resolve(process.cwd(), "..", "scripts", "claude-hook-bridge.cjs"),
    path.resolve(process.cwd(), "..", "..", "scripts", "claude-hook-bridge.cjs")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

function buildClaudeRawStoreRef(homeDir: string, workspacePath: string, sessionId: string): string {
  return path.join(homeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`);
}

function findClaudeSessionFile(homeDir: string, sessionId: string): string | null {
  const projectsDir = path.join(homeDir, "projects");

  if (!existsSync(projectsDir)) {
    return null;
  }

  const candidates = readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDir, entry.name, `${sessionId}.jsonl`))
    .filter((candidate) => existsSync(candidate));

  return candidates[0] ?? null;
}

function workspaceSlug(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const normalizedDriveLetter = trimmed.replace(/^[A-Z](?=:)/, (value) => value.toLowerCase());

  return normalizedDriveLetter
    .replaceAll(":", "-")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
}
