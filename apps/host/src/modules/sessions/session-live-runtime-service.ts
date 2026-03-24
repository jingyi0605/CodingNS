import {
  type ActiveRunHandle,
  ClaudeRuntimeAdapter,
  CodexRuntimeAdapter,
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
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type {
  SessionListItem,
  SessionRunningState,
  SessionStatusSnapshot
} from "../../types/domain.js";
import { SessionChangedFileService } from "./session-changed-file-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { SessionImageAttachmentInput } from "./session-message-attachment-service.js";
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

export interface SessionRuntimeStatusView {
  sessionId: string;
  runningState: SessionRunningState | RuntimeRunState;
  hasActiveRun: boolean;
  canAttach: boolean;
  canInterrupt: boolean;
  provider: string;
  providerSessionId: string;
  detail: string | null;
  updatedAt: string;
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

export class SessionLiveRuntimeService {
  private readonly providerRuntimeService: ProviderRuntimeService;

  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionMessageAttachmentService: SessionMessageAttachmentService,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionChangedFileService: SessionChangedFileService,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly sessionStatusSnapshotRepository: SessionStatusSnapshotRepository,
    config: HostConfig
  ) {
    this.providerRuntimeService = new ProviderRuntimeService(createProviderRuntimeAdapters(config));
  }

  async startLiveSession(input: StartLiveSessionInput): Promise<LiveMessageAcceptedResult> {
    const capabilities = this.sessionHistoryService.getProviderCapabilities(input.provider);
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
      )
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
          boundAttachments.length > 0
            ? boundAttachments
            : persistedAttachments.messageAttachments
        ),
      session: this.sessionHistoryService.getSession(sessionId, input.userId)
    };
  }

  async sendLiveMessage(input: SendLiveMessageInput): Promise<LiveMessageAcceptedResult> {
    const session = this.sessionHistoryService.getSession(input.sessionId, input.userId);
    const capabilities = await this.sessionHistoryService.getSessionCapabilities(input.sessionId);
    const workspace = this.workspaceService.getWorkspaceOrThrow(session.workspaceId);
    const runtimeMode = shouldStartNativeSessionOnFirstMessage(session);
    const persistedAttachments = this.persistMessageAttachments(
      input.sessionId,
      input.clientRequestId,
      input.runtimeOptions?.attachments ?? []
    );
    const providerPrompt = this.sessionMessageAttachmentService.buildProviderPrompt(
      session.provider,
      input.content,
      persistedAttachments.runtimeAttachments
    );

    this.ensureCapability(capabilities.canSendMessage, "sessionId", "provider 不支持实时对话");

    await this.startRuntimeRun(
      {
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
          attachments: persistedAttachments.runtimeAttachments
        }
      },
      input.userId,
      runtimeMode
    );

    const binding = this.sessionHistoryService.getBindingOrThrow(input.sessionId);
    const acceptedMessage = await this.findAcceptedUserMessage(
      input.sessionId,
      this.sessionMessageAttachmentService.buildAcceptedContentCandidates(
        input.content,
        providerPrompt
      )
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
          boundAttachments.length > 0
            ? boundAttachments
            : persistedAttachments.messageAttachments
        )
    };
  }

  async getSessionRuntime(sessionId: string, userId: string): Promise<SessionRuntimeStatusView> {
    const session = this.sessionHistoryService.getSession(sessionId, userId);
    const runtimeSnapshot = this.providerRuntimeService.getSnapshot(sessionId);

    if (runtimeSnapshot) {
      return {
        sessionId,
        provider: session.provider,
        providerSessionId: runtimeSnapshot.providerSessionId ?? session.providerSessionId,
        runningState: runtimeSnapshot.runningState,
        hasActiveRun: true,
        canAttach: true,
        canInterrupt: runtimeSnapshot.supportsInterrupt,
        detail: runtimeSnapshot.detail,
        updatedAt: runtimeSnapshot.lastEventAt ?? runtimeSnapshot.startedAt
      };
    }

    return {
      sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      runningState: session.runningState ?? "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      detail: null,
      updatedAt: session.lastEventAt ?? session.updatedAt
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

    if (runtimeSnapshot) {
      void onEnvelope({
        type: "session.runtime_status",
        sessionId,
        status: runtimeSnapshot.runningState,
        detail: runtimeSnapshot.detail,
        timestamp: runtimeSnapshot.lastEventAt ?? runtimeSnapshot.startedAt
      });
    }

    return this.providerRuntimeService.subscribe(sessionId, async (event) => {
      const envelope = this.mapRuntimeEventToEnvelope(sessionId, event);

      if (!envelope) {
        return;
      }

      await onEnvelope(envelope);
    });
  }

  async dispose(): Promise<void> {
    await this.providerRuntimeService.dispose();
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
      isArchived: this.resolveArchivedState(request.sessionId, currentState?.isArchived ?? false),
      lastEventAt: snapshot.lastEventAt,
      completedAt: snapshot.completedAt,
      lastSeenAt: currentState?.lastSeenAt ?? null,
      updatedAt: nowIso()
    });
    this.attachRuntimePersistence(handle, request.sessionId, request.workspaceId, userId);
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
      isArchived: this.resolveArchivedState(input.sessionId),
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

    if (event.type === "message") {
      const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
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
        runningState: "running",
        activitySource: "runtime",
        isArchived: this.resolveArchivedState(sessionId, currentState?.isArchived ?? false),
        lastEventAt: event.message.timestamp,
        completedAt: null,
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

    const completedAt =
      event.status === "completed" || event.status === "interrupted" || event.status === "failed"
        ? event.timestamp
        : this.sessionStateRepository.findBySessionAndUser(sessionId, userId)?.completedAt ?? null;

    this.sessionStateRepository.upsert({
      sessionId,
      userId,
      runningState: toStoredRunningState(event.status),
      activitySource: "runtime",
      isArchived: this.resolveArchivedState(sessionId, currentState?.isArchived ?? false),
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
      lastErrorCode: event.type === "error" ? "PROVIDER_RUNTIME_ERROR" : null,
      lastErrorDetail: event.type === "error" ? (event.detail ?? "runtime failed") : null,
      resumedAt: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
    });
  }

  private async findAcceptedUserMessage(
    sessionId: string,
    content: string | string[]
  ): Promise<SendMessageResult["message"] | null> {
    try {
      return await withTimeout(
        this.sessionHistoryService.findLatestUserMessage(sessionId, content),
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
        error_code: "PROVIDER_RUNTIME_ERROR",
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

  private resolveArchivedState(sessionId: string, fallback = false): boolean {
    return this.sessionIndexRepository.findIndexRecordBySessionId(sessionId)?.isArchived ?? fallback;
  }
}

function createSyntheticUserMessage(
  provider: string,
  providerSessionId: string,
  content: string,
  timestamp: string,
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
    sequence: Number.MAX_SAFE_INTEGER - 1,
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

function createProviderRuntimeAdapters(config: HostConfig): ProviderRuntimeAdapter[] {
  return [
    new ClaudeRuntimeAdapter({
      homeDir: config.claudeCodeHomeDir
    }),
    new CodexRuntimeAdapter()
  ];
}
