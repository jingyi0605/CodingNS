import {
  ClaudeRuntimeAdapter,
  CodexRuntimeAdapter,
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
import type { SessionRunningState, SessionStatusSnapshot } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { mapSessionProviderError } from "./session-provider-error-mapper.js";
import type { SessionHistoryEnvelope, SessionHistoryService } from "./session-history-service.js";

interface RuntimeSendOptions {
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
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
    private readonly workspaceService: WorkspaceService,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly sessionStatusSnapshotRepository: SessionStatusSnapshotRepository,
    config: HostConfig
  ) {
    this.providerRuntimeService = new ProviderRuntimeService(createProviderRuntimeAdapters(config));
  }

  async startLiveSession(input: StartLiveSessionInput): Promise<LiveMessageAcceptedResult> {
    const capabilities = this.sessionHistoryService.getProviderCapabilities(input.provider);

    this.ensureCapability(
      capabilities.canStartSession,
      "provider",
      "当前 provider 不支持 start-live"
    );
    this.ensureCapability(
      capabilities.canSendMessage,
      "provider",
      "当前 provider 不支持实时消息"
    );

    const session = await this.sessionHistoryService.startSession({
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider
    });
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);

    await this.startRuntimeRun(
      {
        sessionId: session.sessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        rawStoreRef: session.rawStoreRef,
        options: {
          content: input.content,
          clientRequestId: input.clientRequestId,
          model: input.runtimeOptions?.model ?? null,
          reasoningLevel: input.runtimeOptions?.reasoningLevel ?? null,
          permissionMode: input.runtimeOptions?.permissionMode ?? null
        }
      },
      input.userId,
      "continue"
    );

    const acceptedMessage = await this.sessionHistoryService.findLatestUserMessage(
      session.sessionId,
      input.content
    );
    const acceptedAt = acceptedMessage?.timestamp ?? nowIso();

    return {
      sessionId: session.sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      acceptedAt,
      clientRequestId: input.clientRequestId,
      message:
        acceptedMessage ??
        createSyntheticUserMessage(
          session.provider,
          session.providerSessionId,
          input.content,
          acceptedAt
        )
    };
  }

  async sendLiveMessage(input: SendLiveMessageInput): Promise<LiveMessageAcceptedResult> {
    const session = this.sessionHistoryService.getSession(input.sessionId, input.userId);
    const capabilities = await this.sessionHistoryService.getSessionCapabilities(input.sessionId);
    const workspace = this.workspaceService.getWorkspaceOrThrow(session.workspaceId);

    this.ensureCapability(
      capabilities.canSendMessage,
      "sessionId",
      "当前会话 provider 不支持实时消息"
    );

    await this.startRuntimeRun(
      {
        sessionId: input.sessionId,
        workspaceId: session.workspaceId,
        workspacePath: workspace.path,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        rawStoreRef: session.rawStoreRef,
        options: {
          content: input.content,
          clientRequestId: input.clientRequestId,
          model: input.runtimeOptions?.model ?? null,
          reasoningLevel: input.runtimeOptions?.reasoningLevel ?? null,
          permissionMode: input.runtimeOptions?.permissionMode ?? null
        }
      },
      input.userId,
      "continue"
    );

    const acceptedMessage = await this.sessionHistoryService.findLatestUserMessage(
      input.sessionId,
      input.content
    );
    const acceptedAt = acceptedMessage?.timestamp ?? nowIso();

    return {
      sessionId: input.sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      acceptedAt,
      clientRequestId: input.clientRequestId,
      message:
        acceptedMessage ??
        createSyntheticUserMessage(
          session.provider,
          session.providerSessionId,
          input.content,
          acceptedAt
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
    const handle =
      mode === "start"
        ? await this.providerRuntimeService.startSession(request)
        : await this.providerRuntimeService.continueSession(request);

    const snapshot = handle.getSnapshot();
    this.sessionHistoryService.persistSessionBinding(request.sessionId, request.workspaceId, snapshot);
    this.sessionStateRepository.upsert({
      sessionId: request.sessionId,
      userId,
      runningState: toStoredRunningState(snapshot.runningState),
      lastEventAt: snapshot.lastEventAt,
      completedAt: snapshot.completedAt,
      lastSeenAt:
        this.sessionStateRepository.findBySessionAndUser(request.sessionId, userId)?.lastSeenAt ?? null,
      updatedAt: nowIso()
    });

    handle.attach(async (event) => {
      await this.persistRuntimeEvent(request.sessionId, request.workspaceId, userId, event);
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

    if (event.type === "message") {
      const existing = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);

      if (existing) {
        this.sessionIndexRepository.upsert({
          ...existing,
          messageCount: existing.messageCount + 1,
          lastMessageAt: event.message.timestamp,
          updatedAt: event.message.timestamp
        });
      }

      this.sessionStateRepository.upsert({
        sessionId,
        userId,
        runningState: "running",
        lastEventAt: event.message.timestamp,
        completedAt: null,
        lastSeenAt:
          this.sessionStateRepository.findBySessionAndUser(sessionId, userId)?.lastSeenAt ?? null,
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
      lastEventAt: event.timestamp,
      completedAt,
      lastSeenAt:
        this.sessionStateRepository.findBySessionAndUser(sessionId, userId)?.lastSeenAt ?? null,
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

  private mapRuntimeEventToEnvelope(
    sessionId: string,
    event: RuntimeEvent
  ): SessionRuntimeEnvelope | null {
    if (event.type === "message") {
      return {
        type: "session.delta",
        sessionId,
        cursor: null,
        messages: [event.message]
      };
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
}

function createSyntheticUserMessage(
  provider: string,
  providerSessionId: string,
  content: string,
  timestamp: string
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
    timestamp,
    sequence: Number.MAX_SAFE_INTEGER - 1,
    rawRef: `synthetic://${provider}/${providerSessionId}/${syntheticId}`
  };
}

function toStoredRunningState(state: RuntimeRunState): SessionRunningState {
  return state === "starting" || state === "running" ? "running" : "idle";
}

function createProviderRuntimeAdapters(config: HostConfig): ProviderRuntimeAdapter[] {
  return [
    new ClaudeRuntimeAdapter({
      homeDir: config.claudeCodeHomeDir
    }),
    new CodexRuntimeAdapter()
  ];
}
