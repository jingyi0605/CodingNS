import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  type ActiveRunHandle,
  ClaudeRuntimeAdapter,
  type ContextUsageSnapshot,
  CodexRuntimeAdapter,
  type InRunInputMode,
  type NormalizedMessageAttachment,
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
import { nowIso } from "../../shared/utils/time.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionSendQueueRepository } from "../../storage/repositories/session-send-queue-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type {
  SessionListItem,
  SessionRunningState,
  SessionSendQueueItemRecord,
  SessionStatusSnapshot
} from "../../types/domain.js";
import { SessionChangedFileService } from "./session-changed-file-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type {
  RuntimeImageAttachmentDescriptor,
  SessionImageAttachmentInput
} from "./session-message-attachment-service.js";
import { SessionMessageAttachmentService } from "./session-message-attachment-service.js";
import { mapSessionProviderError } from "./session-provider-error-mapper.js";
import type { SessionHistoryEnvelope, SessionHistoryService } from "./session-history-service.js";

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
  runningState: SessionRunningState | RuntimeRunState;
  hasActiveRun: boolean;
  canAttach: boolean;
  canInterrupt: boolean;
  inRunInputMode: InRunInputMode;
  provider: string;
  providerSessionId: string;
  detail: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  updatedAt: string;
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

export type SessionRuntimeEnvelope =
  | SessionHistoryEnvelope
  | SessionRuntimeStatusEnvelope
  | SessionRuntimeErrorEnvelope
  | SessionInterruptedEnvelope;

type ExternalRuntimeStatus = Extract<SessionRuntimeStatusEnvelope["status"], "running" | "completed" | "failed">;

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
  private readonly externalRuntimeSnapshots = new Map<string, ExternalRuntimeSnapshot>();
  private readonly runtimeListeners = new Map<
    string,
    Set<(envelope: SessionRuntimeEnvelope) => Promise<void> | void>
  >();
  private readonly queueDispatchSessions = new Set<string>();
  private readonly queueRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    private readonly config: HostConfig
  ) {
    this.providerRuntimeService = new ProviderRuntimeService(createProviderRuntimeAdapters(config));
  }

  async startLiveSession(input: StartLiveSessionInput): Promise<LiveMessageAcceptedResult> {
    const requestStartedAt = nowIso();
    const capabilities = this.sessionHistoryService.getProviderCapabilitiesSnapshot(input.provider);
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);
    const sessionId = createId();
    const persistedAttachments = this.persistMessageAttachments(
      sessionId,
      input.clientRequestId,
      input.runtimeOptions?.attachments ?? []
    );
    const providerPrompt = this.sessionMessageAttachmentService.buildProviderPrompt(
      input.provider as "claude-code" | "codex",
      input.content,
      persistedAttachments.runtimeAttachments
    );

    this.ensureCapability(capabilities.canStartSession, "provider", "provider 不支持 start-live");
    this.ensureCapability(capabilities.canSendMessage, "provider", "provider 不支持实时对话");

    const handle = await this.launchRuntimeRun(
      {
        sessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        provider: input.provider as ProviderRuntimeRunRequest["provider"],
        providerSessionId: null,
        rawStoreRef: null,
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
    const snapshot = handle.getSnapshot();

    this.createRuntimeBackedSession({
      sessionId,
      workspaceId: workspace.id,
      userId: input.userId,
      provider: input.provider,
      initialContent: input.content,
      snapshot
    });
    this.attachRuntimePersistence(handle, sessionId, workspace.id, input.userId);

    const binding = this.sessionHistoryService.getBindingOrThrow(sessionId);
    const acceptedMessage = await this.findAcceptedUserMessage(
      sessionId,
      this.sessionMessageAttachmentService.buildAcceptedContentCandidates(
        input.content,
        providerPrompt
      ),
      requestStartedAt
    );
    const acceptedAt = acceptedMessage?.timestamp ?? nowIso();
    const boundAttachments = this.sessionMessageAttachmentService.bindClientRequestToMessage(
      sessionId,
      input.clientRequestId,
      acceptedMessage?.messageId ?? null
    );

    return {
      sessionId,
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
      session: this.sessionHistoryService.getSession(sessionId, input.userId)
    };
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

    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);

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
      if (isQueueDispatchDeferredError(error)) {
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
    const bridgeUrl = `http://127.0.0.1:${this.config.port}/api/providers/claude-code/hook-bridge/events`;
    const scriptPath = path.resolve(process.cwd(), "scripts", "claude-hook-bridge.cjs");
    const command = `node "${scriptPath}" --url "${bridgeUrl}" --token "${this.config.claudeHookBridgeToken}"`;

    return {
      provider: "claude-code",
      bridgeUrl,
      token: this.config.claudeHookBridgeToken,
      scriptPath,
      command,
      supportedEvents: ["UserPromptSubmit", "SessionStart", "Stop", "StopFailure", "SessionEnd"]
    };
  }

  async ingestClaudeHookEvent(payload: ClaudeHookEventPayload): Promise<{
    accepted: boolean;
    ignored: boolean;
    sessionId: string | null;
  }> {
    const hookEventName = normalizeClaudeHookEventName(payload.hook_event_name);

    if (!hookEventName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "hook_event_name 不能为空",
        field: "hook_event_name"
      });
    }

    if (!isSupportedClaudeHookEvent(hookEventName)) {
      return {
        accepted: true,
        ignored: true,
        sessionId: null
      };
    }

    const providerSessionId = normalizeRequiredText(payload.session_id, "session_id");
    const workspacePath = normalizeRequiredText(payload.cwd, "cwd");
    const workspace = this.workspaceService.findWorkspaceByPath(workspacePath);

    if (!workspace) {
      return {
        accepted: true,
        ignored: true,
        sessionId: null
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

    if (!runtimeUpdate) {
      return {
        accepted: true,
        ignored: true,
        sessionId: binding.sessionId
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
      sessionId: binding.sessionId
    };
  }

  async getSessionRuntime(sessionId: string, userId: string): Promise<SessionRuntimeStatusView> {
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);
    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(sessionId) ?? null;
    const session = runtimeSnapshot || externalRuntimeSnapshot
      ? this.sessionHistoryService.getSession(sessionId, userId)
      : await this.sessionHistoryService.refreshRuntimeFallbackSession(sessionId, userId);
    this.maybeDispatchQueuedMessages(session);
    const capabilities = await this.sessionHistoryService.getSessionCapabilities(sessionId);
    const contextUsage = await this.sessionHistoryService.getSessionContextUsage(sessionId).catch(() => null);

    if (runtimeSnapshot) {
      return {
        sessionId,
        provider: session.provider,
        providerSessionId: runtimeSnapshot.providerSessionId ?? session.providerSessionId,
        runningState: runtimeSnapshot.runningState,
        hasActiveRun: true,
        canAttach: true,
        canInterrupt: runtimeSnapshot.supportsInterrupt,
        inRunInputMode: capabilities.inRunInputMode,
        detail: runtimeSnapshot.detail,
        errorCode:
          runtimeSnapshot.runningState === "failed"
            ? runtimeSnapshot.errorCode ?? session.lastErrorCode
            : null,
        errorDetail:
          runtimeSnapshot.runningState === "failed"
            ? runtimeSnapshot.detail ?? session.lastErrorDetail
            : null,
        updatedAt: runtimeSnapshot.lastEventAt ?? runtimeSnapshot.startedAt,
        contextUsage
      };
    }

    if (externalRuntimeSnapshot) {
      return {
        sessionId,
        provider: "claude-code",
        providerSessionId: externalRuntimeSnapshot.providerSessionId,
        runningState: externalRuntimeSnapshot.runningState,
        hasActiveRun: true,
        canAttach: false,
        canInterrupt: false,
        inRunInputMode: capabilities.inRunInputMode,
        detail: externalRuntimeSnapshot.detail,
        errorCode: session.runningState === "failed" ? session.lastErrorCode : null,
        errorDetail: session.runningState === "failed" ? session.lastErrorDetail : null,
        updatedAt: externalRuntimeSnapshot.updatedAt,
        contextUsage
      };
    }

    const persistedErrorCode = session.runningState === "failed" ? session.lastErrorCode : null;
    const persistedErrorDetail = session.runningState === "failed" ? session.lastErrorDetail : null;

    return {
      sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      runningState: session.runningState ?? "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: capabilities.inRunInputMode,
      detail: persistedErrorDetail,
      errorCode: persistedErrorCode,
      errorDetail: persistedErrorDetail,
      updatedAt: session.lastEventAt ?? session.updatedAt,
      contextUsage
    };
  }

  async interruptSession(sessionId: string, userId: string): Promise<InterruptSessionResult> {
    this.sessionHistoryService.getSession(sessionId, userId);
    const runtime = this.providerRuntimeService.getSnapshot(sessionId);

    if (!runtime || (runtime.runningState !== "running" && runtime.runningState !== "starting")) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_NOT_RUNNING",
        detail: "当前会话不在运行中，无法中断",
        field: "sessionId"
      });
    }

    const interrupted = await this.providerRuntimeService.interrupt(sessionId).catch((error) => {
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

  subscribeRuntime(
    sessionId: string,
    onEnvelope: (envelope: SessionRuntimeEnvelope) => Promise<void> | void
  ): ProviderSubscription {
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);
    const externalRuntimeSnapshot = this.externalRuntimeSnapshots.get(sessionId) ?? null;

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

    const runtimeSubscription = this.providerRuntimeService.subscribe(sessionId, async (event) => {
      const envelope = this.mapRuntimeEventToEnvelope(sessionId, event);

      if (!envelope) {
        return;
      }

      await onEnvelope(envelope);
    });
    const externalSubscription = this.subscribeExternalRuntime(sessionId, onEnvelope);

    return {
      close: () => {
        runtimeSubscription.close();
        externalSubscription.close();
      }
    };
  }

  async dispose(): Promise<void> {
    this.queueRetryTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.queueRetryTimers.clear();
    await this.providerRuntimeService.dispose();
    this.externalRuntimeSnapshots.clear();
    this.runtimeListeners.clear();
  }

  private subscribeExternalRuntime(
    sessionId: string,
    listener: (envelope: SessionRuntimeEnvelope) => Promise<void> | void
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

  private async emitExternalRuntimeEnvelope(envelope: SessionRuntimeEnvelope): Promise<void> {
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
      void this.dispatchNextQueuedMessage(input.sessionId);
    }
  }

  private async startRuntimeRun(
    request: ProviderRuntimeRunRequest,
    userId: string,
    mode: "start" | "continue"
  ): Promise<void> {
    const handle = await this.launchRuntimeRun(request, mode);
    const snapshot = handle.getSnapshot();
    const currentState = this.sessionStateRepository.findBySessionAndUser(request.sessionId, userId);

    this.sessionHistoryService.persistSessionBinding(request.sessionId, request.workspaceId, snapshot);
    this.sessionStateRepository.upsert({
      sessionId: request.sessionId,
      userId,
      runningState: toStoredRunningState(snapshot.runningState),
      activitySource: "runtime",
      lastEventAt: snapshot.lastEventAt,
      completedAt: snapshot.completedAt,
      lastSeenAt: currentState?.lastSeenAt ?? null,
      updatedAt: nowIso()
    });
    this.attachRuntimePersistence(handle, request.sessionId, request.workspaceId, userId);
  }

  private async sendLiveMessageDirect(
    input: SendLiveMessageInput,
    persistedAttachments?: PersistedAttachmentBundle
  ): Promise<LiveMessageAcceptedResult> {
    const requestStartedAt = nowIso();
    const session = this.sessionHistoryService.getSession(input.sessionId, input.userId);
    const capabilities = await this.sessionHistoryService.getSessionCapabilities(input.sessionId);
    const workspace = this.workspaceService.getWorkspaceOrThrow(session.workspaceId);
    const runtimeMode = shouldStartNativeSessionOnFirstMessage(session);
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
      rawStoreRef: runtimeMode === "start" ? null : session.rawStoreRef,
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

    const activeRun = this.providerRuntimeService.getSnapshot(input.sessionId);

    if (activeRun && isActiveRuntimeState(activeRun.runningState)) {
      await this.providerRuntimeService.submitToActiveRun(input.sessionId, runtimeRequest.options)
        .catch((error) => {
          throw mapSessionProviderError(error);
        });
    } else {
      await this.startRuntimeRun(runtimeRequest, input.userId, runtimeMode);
    }

    const binding = this.sessionHistoryService.getBindingOrThrow(input.sessionId);
    const acceptedMessage = await this.findAcceptedUserMessage(
      input.sessionId,
      this.sessionMessageAttachmentService.buildAcceptedContentCandidates(
        input.content,
        providerPrompt
      ),
      requestStartedAt
    );
    const acceptedAt = acceptedMessage?.timestamp ?? nowIso();
    const boundAttachments = this.sessionMessageAttachmentService.bindClientRequestToMessage(
      input.sessionId,
      input.clientRequestId,
      acceptedMessage?.messageId ?? null
    );

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
          Math.max(session.messageCount + 1, 1),
          boundAttachments.length > 0
            ? boundAttachments
            : resolvedAttachments.messageAttachments
        )
    };
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
        if (isQueueDispatchDeferredError(error)) {
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
    return mode === "start"
      ? this.providerRuntimeService.startSession(request)
      : this.providerRuntimeService.continueSession(request);
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
    initialContent: string;
    snapshot: ReturnType<ActiveRunHandle["getSnapshot"]>;
  }): void {
    const timestamp = nowIso();
    const providerSessionId =
      input.snapshot.providerSessionId ?? `pending://${input.provider}/${input.sessionId}`;
    const rawStoreRef = input.snapshot.rawStoreRef ?? `pending://${input.provider}/${input.sessionId}`;

    this.sessionHistoryService.persistSessionBinding(input.sessionId, input.workspaceId, {
      provider: input.snapshot.provider,
      providerSessionId,
      rawStoreRef
    });
    this.sessionIndexRepository.upsert({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      provider: input.provider as "claude-code" | "codex",
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
      lastEventAt: input.snapshot.lastEventAt,
      completedAt: input.snapshot.completedAt,
      lastSeenAt: null,
      updatedAt: timestamp
    });
  }

  private async persistRuntimeEvent(
    sessionId: string,
    workspaceId: string,
    userId: string,
    event: RuntimeEvent
  ): Promise<void> {
    this.sessionHistoryService.persistSessionBinding(sessionId, workspaceId, {
      provider: event.provider,
      providerSessionId: event.providerSessionId,
      rawStoreRef: event.rawStoreRef
    });
    const currentState = this.sessionStateRepository.findBySessionAndUser(sessionId, userId);
    const currentRunningState = currentState?.runningState ?? null;
    const shouldPreserveTerminalState = isTerminalSessionRunningState(currentRunningState);

    if (event.type === "message") {
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
      lastEventAt: event.timestamp,
      completedAt,
      lastSeenAt: currentState?.lastSeenAt ?? null,
      updatedAt: nowIso()
    });

    this.upsertSnapshot(sessionId, {
      syncStatus: event.type === "error" ? "error" : "idle",
      syncCursor:
        this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
      lastSyncAt: event.timestamp,
      lastErrorCode: event.type === "error" ? event.errorCode : null,
      lastErrorDetail: event.type === "error" ? (event.detail ?? "runtime failed") : null,
      resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
    });

    if (isTerminalRuntimeEventStatus(event.status)) {
      void this.dispatchNextQueuedMessage(sessionId);
    }
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

  private mapRuntimeEventToEnvelope(
    sessionId: string,
    event: RuntimeEvent
  ): SessionRuntimeEnvelope | null {
    if (event.type === "message") {
      return null;
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

function shouldStartNativeSessionOnFirstMessage(session: {
  provider: string;
  providerSessionId: string;
  messageCount: number;
}): "start" | "continue" {
  if (session.provider !== "codex") {
    return "continue";
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

function isActiveRuntimeState(state: RuntimeRunState | SessionRunningState): boolean {
  return state === "starting" || state === "running";
}

function isTerminalRuntimeEventStatus(
  status: RuntimeEvent["status"]
): status is "completed" | "interrupted" | "failed" {
  return status === "completed" || status === "interrupted" || status === "failed";
}

function isPendingSessionRunningState(
  state: SessionRunningState | RuntimeRunState | null | undefined
): boolean {
  return state === "starting" || state === "running";
}

function isQueueDispatchDeferredError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.errorCode === "ACTIVE_RUN_EXISTS" || error.errorCode === "SESSION_NOT_RUNNING";
  }

  if (error instanceof Error) {
    return error.message === "ACTIVE_RUN_EXISTS";
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

function createProviderRuntimeAdapters(config: HostConfig): ProviderRuntimeAdapter[] {
  return [
    new ClaudeRuntimeAdapter({
      homeDir: config.claudeCodeHomeDir
    }),
    new CodexRuntimeAdapter()
  ];
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
