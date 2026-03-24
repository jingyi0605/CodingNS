import { useEffect, useState } from "react";

import { authStore } from "../../auth/store/auth-store";
import { RealtimeClient } from "../../../network/realtime-client";
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
  type SessionRuntimeState
} from "./session-runtime-machine";

type RuntimeListener = () => void;
const INITIAL_HISTORY_LIMIT = 30;
const REALTIME_LIMIT = 40;

export class SessionRuntimeStore {
  private state: SessionRuntimeState = createInitialRuntimeState();
  private listeners = new Set<RuntimeListener>();
  private realtimeClient: RealtimeClient | null = null;
  private markSeenTimer: number | null = null;
  private runtimeRefreshTimer: number | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly options: {
      bootstrapMessages?: HistoryMessageDto[];
      onSeen?: (sessionId: string, seenAt: string) => void;
    } = {}
  ) {}

  subscribe = (listener: RuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async initialize(): Promise<void> {
    const bootstrapMessages = this.options.bootstrapMessages ?? [];

    this.patch({
      messages: mergeAuthoritativeMessages([], this.sessionId, bootstrapMessages),
      historyState: "loading",
      loadingOlderMessages: false,
      olderCursor: null,
      hasOlderMessages: false,
      errorCode: null,
      errorDetail: null
    });

    try {
      const [session, capabilities] = await Promise.all([
        getSessionDetail(this.sessionId),
        getSessionCapabilities(this.sessionId)
      ]);

      this.patch({
        session,
        capabilities
      });
      await this.refreshRuntimeState();

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
    this.state = createInitialRuntimeState();
    this.emit();
    await this.initialize();
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
        void this.refreshRuntimeState();
      },
      onConnectionChange: (connectionState) => {
        this.patch({
          connectionState,
          session:
            connectionState === "reconnecting" &&
            isRuntimeActiveState(this.state.session?.runningState)
              ? withRunningState(this.state.session, "reconnecting")
              : this.state.session
        });
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
        this.scheduleRuntimeRefresh();
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

  private scheduleRuntimeRefresh(): void {
    if (!isRuntimeActiveState(this.state.session?.runningState)) {
      return;
    }

    if (this.runtimeRefreshTimer !== null) {
      window.clearTimeout(this.runtimeRefreshTimer);
    }

    this.runtimeRefreshTimer = window.setTimeout(() => {
      this.runtimeRefreshTimer = null;
      void this.refreshRuntimeState();
    }, 1200);
  }

  private async refreshRuntimeState(): Promise<void> {
    try {
      const runtime = await getSessionRuntime(this.sessionId);
      this.patch({
        session: withRunningState(this.state.session, runtime.runningState),
        errorCode: null,
        errorDetail: null
      });
    } catch {
      return;
    }
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
      this.scheduleMarkSeen();
    }
  }

  private handleRuntimeError(event: SessionRuntimeErrorEvent): void {
    this.patch({
      session: withRunningState(this.state.session, "failed"),
      errorCode: event.error_code,
      errorDetail: event.detail
    });
    this.scheduleMarkSeen();
  }

  private handleInterrupted(event: SessionInterruptedEvent): void {
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
