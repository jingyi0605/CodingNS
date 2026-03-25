import { useEffect, useState } from "react";

import { authStore } from "../../auth/store/auth-store";
import { RealtimeClient } from "../../../network/realtime-client";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import {
  getSessionCapabilities,
  getSessionDetail,
  getSessionMessages,
  getSessionRuntime,
  interruptSession,
  markSessionSeen,
  type MessageAttachmentDto,
  sendSessionMessage,
  sendLiveMessage,
  type ImageAttachmentPayload,
  type HistoryMessageDto,
  type ProviderCapabilitiesDto,
  type SessionSummaryDto,
  type SessionRunningState
} from "../api/conversation-api";
import type {
  SessionInterruptedEvent,
  SessionRuntimeErrorEvent,
  SessionRuntimeStatusEvent
} from "../../../network/realtime-client";
import {
  createInitialRuntimeState,
  createPendingMessage,
  markPendingAsFailed,
  mergeAuthoritativeMessages,
  reconcileMessage,
  type RuntimeConnectionState,
  type SessionMessageViewModel,
  type SessionRuntimeState
} from "./session-runtime-machine";

type RuntimeListener = () => void;
type RuntimeRefreshMode = "tail" | "poll";
const INITIAL_HISTORY_LIMIT = 30;
const REALTIME_LIMIT = 40;
const SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

interface SessionRuntimeSnapshot {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  messages: SessionMessageViewModel[];
}

export class SessionRuntimeStore {
  private state: SessionRuntimeState;
  private listeners = new Set<RuntimeListener>();
  private realtimeClient: RealtimeClient | null = null;
  private markSeenTimer: number | null = null;
  private runtimeRefreshTimer: number | null = null;
  private runtimeRefreshMode: RuntimeRefreshMode | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly options: {
      bootstrapMessages?: HistoryMessageDto[];
      initialSession?: SessionSummaryDto | null;
      onSeen?: (sessionId: string, seenAt: string) => void;
    } = {}
  ) {
    const cachedSnapshot = readViewSnapshot<SessionRuntimeSnapshot>(
      buildSessionRuntimeSnapshotKey(sessionId),
      SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    const seededSession = pickFreshestSessionSummary(options.initialSession ?? null, cachedSnapshot?.session ?? null);
    const seededMessages = mergeAuthoritativeMessages(
      cachedSnapshot?.messages ?? [],
      this.sessionId,
      options.bootstrapMessages ?? []
    );

    this.state = createInitialRuntimeState({
      session: seededSession,
      capabilities: cachedSnapshot?.capabilities ?? null,
      messages: seededMessages
    });
  }

  subscribe = (listener: RuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async initialize(): Promise<void> {
    const bootstrapMessages = this.options.bootstrapMessages ?? [];
    const mergedMessages = mergeAuthoritativeMessages(this.state.messages, this.sessionId, bootstrapMessages);

    this.patch({
      messages: mergedMessages,
      historyState: "loading",
      loadingOlderMessages: false,
      olderCursor: null,
      hasOlderMessages: false,
      errorCode: null,
      errorDetail: null
    });

    if (this.shouldRefreshSessionDetail()) {
      void this.refreshSessionMetadata();
    }

    try {
      await this.loadLatestHistory();
      this.scheduleMarkSeen();
      this.startRealtime();
    } catch (error) {
      this.handleError(error);
    }
  }

  async reload(): Promise<void> {
    this.realtimeClient?.close();
    this.realtimeClient = null;
    const cachedSnapshot = readViewSnapshot<SessionRuntimeSnapshot>(
      buildSessionRuntimeSnapshotKey(this.sessionId),
      SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    this.state = createInitialRuntimeState({
      session: pickFreshestSessionSummary(this.options.initialSession ?? null, cachedSnapshot?.session ?? null),
      capabilities: cachedSnapshot?.capabilities ?? null,
      messages: mergeAuthoritativeMessages(
        cachedSnapshot?.messages ?? [],
        this.sessionId,
        this.options.bootstrapMessages ?? []
      )
    });
    this.emit();
    await this.initialize();
  }

  applyNavigationSession(session: SessionSummaryDto | null): void {
    if (!session || session.sessionId !== this.sessionId) {
      return;
    }

    const nextSession = pickFreshestSessionSummary(this.state.session, session);

    if (nextSession === this.state.session) {
      return;
    }

    this.patch({
      session: nextSession
    });
  }

  async sendMessage(
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: ImageAttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> {
    const clientRequestId = createClientRequestId();
    const pending = createPendingMessage(
      this.sessionId,
      content,
      clientRequestId,
      options?.attachmentMeta ?? [],
      options?.attachments ?? []
    );

    this.patch({
      messages: [...this.state.messages, pending],
      session: withRunningState(this.state.session, "running")
    });

    try {
      const response = await this.sendMessageWithFallback(content, clientRequestId, options);

      this.patch({
        messages: reconcileMessage(
          this.state.messages,
          this.sessionId,
          response.message,
          clientRequestId
        )
      });
      this.scheduleRuntimeRefresh("tail", "send_message");
    } catch (error) {
      this.patch({
        messages: markPendingAsFailed(this.state.messages, clientRequestId),
        session: withRunningState(this.state.session, "failed")
      });
      throw error;
    }
  }

  async retryMessage(clientRequestId: string): Promise<void> {
    const target = this.state.messages.find((item) => item.clientRequestId === clientRequestId);

    if (!target) {
      return;
    }

    this.patch({
      messages: this.state.messages.map((item) =>
        item.clientRequestId === clientRequestId
          ? {
              ...item,
              deliveryState: "sending"
            }
          : item
      )
    });

    try {
      const response = await this.sendMessageWithFallback(target.content, clientRequestId, {
        attachments: target.attachmentPayloads ?? [],
        attachmentMeta: target.attachments
      });

      this.patch({
        messages: reconcileMessage(
          this.state.messages,
          this.sessionId,
          response.message,
          clientRequestId
        )
      });
      this.scheduleRuntimeRefresh("tail", "retry_message");
    } catch (error) {
      this.patch({
        messages: markPendingAsFailed(this.state.messages, clientRequestId),
        session: withRunningState(this.state.session, "failed")
      });
      throw error;
    }
  }

  async interrupt(): Promise<void> {
    await interruptSession(this.sessionId);
    this.patch({
      session: withRunningState(this.state.session, "interrupted"),
      errorCode: null,
      errorDetail: null
    });
  }

  reconnect(): void {
    this.realtimeClient?.reconnectNow();
  }

  async loadOlderMessages(): Promise<void> {
    if (
      this.state.historyState !== "ready" ||
      this.state.loadingOlderMessages ||
      !this.state.olderCursor
    ) {
      return;
    }

    this.patch({
      loadingOlderMessages: true,
      errorCode: null,
      errorDetail: null
    });

    try {
      const page = await getSessionMessages(
        this.sessionId,
        this.state.olderCursor,
        INITIAL_HISTORY_LIMIT,
        "backward"
      );
      const merged = mergeAuthoritativeMessages(this.state.messages, this.sessionId, page.messages);

      this.patch({
        messages: merged,
        loadingOlderMessages: false,
        olderCursor: page.nextCursor,
        hasOlderMessages: Boolean(page.nextCursor),
        pagesLoaded: this.state.pagesLoaded + 1
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      this.patch({
        loadingOlderMessages: false,
        errorCode: "HISTORY_LOAD_MORE_FAILED",
        errorDetail: detail
      });
    }
  }

  destroy(): void {
    this.realtimeClient?.close();
    this.realtimeClient = null;

    if (this.markSeenTimer !== null) {
      window.clearTimeout(this.markSeenTimer);
      this.markSeenTimer = null;
    }

    if (this.runtimeRefreshTimer !== null) {
      window.clearTimeout(this.runtimeRefreshTimer);
      this.runtimeRefreshTimer = null;
    }

    this.runtimeRefreshMode = null;
  }

  private async loadLatestHistory(): Promise<void> {
    const page = await getSessionMessages(this.sessionId, null, INITIAL_HISTORY_LIMIT, "backward");
    const merged = mergeAuthoritativeMessages(this.state.messages, this.sessionId, page.messages);

    this.patch({
      messages: merged,
      historyState: "ready",
      loadingOlderMessages: false,
      olderCursor: page.nextCursor,
      hasOlderMessages: Boolean(page.nextCursor),
      lastCursor: page.cursor,
      pagesLoaded: page.messages.length > 0 ? 1 : 0,
      errorCode: null,
      errorDetail: null
    });
  }

  private startRealtime(): void {
    const accessToken = authStore.getState().session?.accessToken;

    if (!accessToken) {
      authStore.clear();
      return;
    }

    this.realtimeClient = new RealtimeClient({
      sessionId: this.sessionId,
      cursor: this.state.lastCursor,
      limit: REALTIME_LIMIT,
      onSubscribed: () => {
        this.patch({ connectionState: "connected" });
      },
      onConnectionChange: (connectionState) => {
        const previousConnectionState = this.state.connectionState;

        this.patch({
          connectionState,
          session:
            connectionState === "reconnecting" &&
            isRuntimeActiveState(this.state.session?.runningState)
              ? withRunningState(this.state.session, "reconnecting")
              : this.state.session
        });

        if (connectionState === "connected") {
          this.clearRuntimeRefreshTimer("poll");

          if (
            previousConnectionState !== "closed" &&
            previousConnectionState !== "connected"
          ) {
            this.scheduleRuntimeRefresh("tail", "reconnected");
          }

          return;
        }

        this.scheduleRuntimeRefresh("poll", "connection_state_change");
      },
      onEnvelope: (event) => {
        const merged = mergeAuthoritativeMessages(this.state.messages, this.sessionId, event.messages);
        this.patch({
          messages: merged,
          lastCursor: event.cursor,
          session: withRunningState(
            this.state.session,
            resolveEnvelopeRunningState(this.state.session?.runningState)
          )
        });
        this.realtimeClient?.updateCursor(event.cursor);
        this.scheduleMarkSeen();
        this.scheduleRuntimeRefresh("tail", "envelope");
      },
      onRuntimeStatus: (event) => {
        this.handleRuntimeStatus(event);
      },
      onRuntimeError: (event) => {
        this.handleRuntimeError(event);
      },
      onInterrupted: (event) => {
        this.handleInterrupted(event);
      },
      onError: (event) => {
        this.patch({
          errorCode: event.error_code,
          errorDetail: event.detail
        });
      },
      onUnauthorized: () => {
        authStore.clear();
      }
    });
    this.realtimeClient.start();
  }

  private patch(input: Partial<SessionRuntimeState>): void {
    this.state = {
      ...this.state,
      ...input
    };

    if (
      Object.prototype.hasOwnProperty.call(input, "session")
      || Object.prototype.hasOwnProperty.call(input, "capabilities")
      || Object.prototype.hasOwnProperty.call(input, "messages")
    ) {
      this.persistSnapshot();
    }

    this.emit();
  }

  private handleError(error: unknown): void {
    const detail = error instanceof Error ? error.message : "unknown";
    this.patch({
      historyState: "error",
      errorCode: "RUNTIME_INIT_FAILED",
      errorDetail: detail
    });
  }

  private scheduleMarkSeen(): void {
    if (this.markSeenTimer !== null) {
      return;
    }

    this.markSeenTimer = window.setTimeout(() => {
      this.markSeenTimer = null;
      const seenAt = new Date().toISOString();
      void markSessionSeen(this.sessionId)
        .then(() => {
          this.options.onSeen?.(this.sessionId, seenAt);
        })
        .catch(() => {
          return;
        });
    }, 600);
  }

  private clearRuntimeRefreshTimer(targetMode?: RuntimeRefreshMode): void {
    if (this.runtimeRefreshTimer === null) {
      return;
    }

    if (targetMode && this.runtimeRefreshMode !== targetMode) {
      return;
    }

    window.clearTimeout(this.runtimeRefreshTimer);
    this.runtimeRefreshTimer = null;
    this.runtimeRefreshMode = null;
  }

  private scheduleRuntimeRefresh(mode: RuntimeRefreshMode, reason: string): void {
    if (!isRuntimeActiveState(this.state.session?.runningState)) {
      this.clearRuntimeRefreshTimer();
      return;
    }

    if (mode === "poll" && this.state.connectionState === "connected") {
      return;
    }

    this.clearRuntimeRefreshTimer();

    this.runtimeRefreshMode = mode;

    logPerfDebug("session_runtime.refresh.schedule", {
      sessionId: this.sessionId,
      mode,
      reason,
      connectionState: this.state.connectionState,
      runningState: this.state.session?.runningState ?? null
    });

    this.runtimeRefreshTimer = window.setTimeout(() => {
      const refreshMode = this.runtimeRefreshMode ?? mode;
      this.runtimeRefreshTimer = null;
      this.runtimeRefreshMode = null;
      void this.refreshRuntimeState(refreshMode, reason);
    }, 1200);
  }

  private async refreshRuntimeState(mode: RuntimeRefreshMode, reason: string): Promise<void> {
    logPerfDebug("session_runtime.refresh.start", {
      sessionId: this.sessionId,
      mode,
      reason,
      connectionState: this.state.connectionState,
      runningState: this.state.session?.runningState ?? null
    });

    try {
      const runtime = await getSessionRuntime(this.sessionId);
      this.patch({
        session: withRunningState(this.state.session, runtime.runningState),
        errorCode: null,
        errorDetail: null
      });

      if (this.state.connectionState !== "connected") {
        await this.loadLatestHistory().catch(() => {
          return;
        });
      }

      const shouldContinuePolling =
        mode === "poll" &&
        this.state.connectionState !== "connected" &&
        isRuntimeActiveState(this.state.session?.runningState);

      logPerfDebug("session_runtime.refresh.end", {
        sessionId: this.sessionId,
        mode,
        reason,
        connectionState: this.state.connectionState,
        runningState: this.state.session?.runningState ?? null,
        continuePolling: shouldContinuePolling
      });

      if (shouldContinuePolling) {
        this.scheduleRuntimeRefresh("poll", "connection_poll");
      }
    } catch (error) {
      logPerfDebug("session_runtime.refresh.error", {
        sessionId: this.sessionId,
        mode,
        reason,
        connectionState: this.state.connectionState,
        runningState: this.state.session?.runningState ?? null,
        message: error instanceof Error ? error.message : "unknown"
      });

      if (
        mode === "poll" &&
        this.state.connectionState !== "connected" &&
        isRuntimeActiveState(this.state.session?.runningState)
      ) {
        this.scheduleRuntimeRefresh("poll", "connection_poll_retry");
      }
    }
  }

  private async refreshSessionMetadata(): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (this.state.session === null) {
      tasks.push(
        getSessionDetail(this.sessionId)
          .then((session) => {
            this.patch({
              session: pickFreshestSessionSummary(session, this.state.session)
            });
          })
          .catch(() => {
            return;
          })
      );
    }

    if (this.state.capabilities === null) {
      tasks.push(
        getSessionCapabilities(this.sessionId)
          .then((capabilities) => {
            this.patch({
              capabilities
            });
          })
          .catch(() => {
            return;
          })
      );
    }

    if (this.state.session?.runningState === null || this.state.session === null) {
      tasks.push(
        getSessionRuntime(this.sessionId)
          .then((runtime) => {
            this.patch({
              session: withRunningState(this.state.session, runtime.runningState),
              errorCode: null,
              errorDetail: null
            });
          })
          .catch(() => {
            return;
          })
      );
    }

    if (tasks.length === 0) {
      return;
    }

    await Promise.allSettled(tasks);
  }

  private shouldRefreshSessionDetail(): boolean {
    return (
      this.state.session === null
      || this.state.capabilities === null
      || this.state.session.runningState === null
    );
  }

  private async sendMessageWithFallback(
    content: string,
    clientRequestId: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: ImageAttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ) {
    try {
      return await sendLiveMessage(this.sessionId, {
        content,
        clientRequestId,
        model: options?.model ?? null,
        reasoningLevel: options?.reasoningLevel ?? null,
        attachments: options?.attachments ?? []
      });
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) {
        throw error;
      }

      if ((options?.attachments?.length ?? 0) > 0) {
        throw error;
      }

      return sendSessionMessage(this.sessionId, {
        content,
        clientRequestId
      });
    }
  }

  private handleRuntimeStatus(event: SessionRuntimeStatusEvent): void {
    this.patch({
      session: withRunningState(this.state.session, event.status),
      errorCode: null,
      errorDetail: event.detail
    });

    if (isTerminalRuntimeState(event.status)) {
      this.clearRuntimeRefreshTimer();
    }

    if (isTerminalRuntimeState(event.status)) {
      this.scheduleMarkSeen();
    }
  }

  private handleRuntimeError(event: SessionRuntimeErrorEvent): void {
    this.clearRuntimeRefreshTimer();
    this.patch({
      session: withRunningState(this.state.session, "failed"),
      errorCode: event.error_code,
      errorDetail: event.detail
    });
    this.scheduleMarkSeen();
  }

  private handleInterrupted(event: SessionInterruptedEvent): void {
    this.clearRuntimeRefreshTimer();
    this.patch({
      session: withRunningState(this.state.session, "interrupted"),
      errorCode: null,
      errorDetail: event.detail
    });
    this.scheduleMarkSeen();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private persistSnapshot(): void {
    writeViewSnapshot<SessionRuntimeSnapshot>(buildSessionRuntimeSnapshotKey(this.sessionId), {
      session: this.state.session,
      capabilities: this.state.capabilities,
      messages: buildSnapshotMessages(this.state.messages)
    });
  }
}

export function useSessionRuntimeStore<T>(
  store: SessionRuntimeStore,
  selector: (state: SessionRuntimeState) => T
) {
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    return store.subscribe(() => {
      setValue(selector(store.getState()));
    });
  }, [selector, store]);

  return value;
}

export function summarizeCapabilities(capabilities: ProviderCapabilitiesDto | null): string[] {
  if (!capabilities) {
    return [];
  }

  const summary: string[] = [];

  if (capabilities.canResumeSession) {
    summary.push(t("conversation.capabilityResume"));
  }

  if (capabilities.canSendMessage !== false) {
    summary.push(t("conversation.capabilitySend"));
  }

  if (capabilities.supportsInterrupt) {
    summary.push(t("conversation.capabilityInterrupt"));
  }

  if (capabilities.supportsStructuredToolCalls) {
    summary.push(t("conversation.capabilityTools"));
  }

  return summary;
}

export function connectionTone(state: RuntimeConnectionState) {
  return state;
}

function withRunningState<T extends { runningState: SessionRunningState | null }>(
  session: T | null,
  runningState: SessionRunningState
): T | null {
  if (!session) {
    return session;
  }

  return {
    ...session,
    runningState
  };
}

function isRuntimeActiveState(state: SessionRunningState | null | undefined): boolean {
  return state === "starting" || state === "running" || state === "reconnecting";
}

function isTerminalRuntimeState(state: SessionRunningState | null | undefined): boolean {
  return state === "completed" || state === "interrupted" || state === "failed";
}

function resolveEnvelopeRunningState(
  state: SessionRunningState | null | undefined
): SessionRunningState {
  if (state === "completed" || state === "interrupted" || state === "failed") {
    return state;
  }

  return "running";
}

function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const buffer = new Uint8Array(16);
    globalThis.crypto.getRandomValues(buffer);
    buffer[6] = (buffer[6] & 0x0f) | 0x40;
    buffer[8] = (buffer[8] & 0x3f) | 0x80;

    const hex = Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildSessionRuntimeSnapshotKey(sessionId: string) {
  return `session-runtime.snapshot.${sessionId}`;
}

function buildSnapshotMessages(messages: SessionMessageViewModel[]): SessionMessageViewModel[] {
  return messages
    .filter((message) => message.deliveryState === "sent")
    .slice(-INITIAL_HISTORY_LIMIT);
}

function pickFreshestSessionSummary(
  left: SessionSummaryDto | null,
  right: SessionSummaryDto | null
): SessionSummaryDto | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const leftTimestamp = Date.parse(left.updatedAt || left.lastMessageAt || left.createdAt);
  const rightTimestamp = Date.parse(right.updatedAt || right.lastMessageAt || right.createdAt);

  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
    return right;
  }

  return leftTimestamp >= rightTimestamp ? left : right;
}
