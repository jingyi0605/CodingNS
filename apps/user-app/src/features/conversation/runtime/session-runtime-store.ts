import { useEffect, useState } from "react";

import { authStore } from "../../auth/store/auth-store";
import { RealtimeClient } from "../../../network/realtime-client";
import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import {
  type AttachmentPayload,
  type ContextUsageDto,
  deleteSessionQueueItem,
  enqueueSessionMessage,
  getSessionCapabilities,
  getSessionDetail,
  getSessionMessages,
  getSessionPermissionRequests,
  getSessionQueue,
  type HistoryPageDto,
  type SessionInterruptSource,
  getSessionRuntime,
  interruptSession,
  markSessionSeen,
  type MessageAttachmentDto,
  replySessionPermissionRequest,
  sendSessionMessage,
  sendLiveMessage,
  steerSessionQueueItem,
  type HistoryMessageDto,
  type ProviderCapabilitiesDto,
  type SessionPermissionRequestDto,
  type SessionQueueItemDto,
  type SessionActivityState,
  type SessionActivityConfidence,
  type SessionActivityResolutionSource,
  type SessionSummaryDto,
  type SessionRuntimeDto,
  type SessionRunningState
} from "../api/conversation-api";
import { isDraftProviderSupported as isRegisteredProvider } from "../capability/provider-ui";
import type {
  SessionActivityEvent,
  SessionInterruptedEvent,
  SessionPermissionRequestEvent,
  SessionPermissionRequestResolvedEvent,
  SessionRuntimeMessageEvent,
  SessionRuntimeErrorEvent,
  SessionRuntimeStatusEvent
} from "../../../network/realtime-client";
import {
  createInitialRuntimeState,
  createPendingMessage,
  getNextOptimisticUserSequence,
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
// 首屏和历史分页都要比以前厚，否则长消息场景下一屏就会把当前页吃完。
const OLDER_HISTORY_PAGE_LIMIT = 80;
const REALTIME_LIMIT = 60;
const SNAPSHOT_HISTORY_LIMIT = 600;
const SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const SESSION_MARK_SEEN_DELAY_MS = 600;
const SESSION_MARK_SEEN_MIN_INTERVAL_MS = 5_000;
const SESSION_RUNTIME_POLL_DELAY_MS = 10_000;

interface SessionRuntimeSnapshot {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
  contextUsage: ContextUsageDto | null;
  messages: SessionMessageViewModel[];
  permissionRequests: SessionPermissionRequestDto[];
  queuedMessages: SessionQueueItemDto[];
  olderCursor: string | null;
  hasOlderMessages: boolean;
  lastCursor: string | null;
  pagesLoaded: number;
  interruptSource: SessionInterruptSource | null;
}

interface PendingReplyDebugTrace {
  mode: "send_live" | "retry_live";
  clientRequestId: string;
  startedAtMs: number;
  responseReadyAtMs: number | null;
  contentLength: number;
}

export class SessionRuntimeStore {
  private state: SessionRuntimeState;
  private listeners = new Set<RuntimeListener>();
  private realtimeClient: RealtimeClient | null = null;
  private historyBootstrapFallbackTimer: number | null = null;
  private historyBootstrapEnvelopeReceived = false;
  private markSeenTimer: number | null = null;
  private markSeenInFlight = false;
  private lastMarkSeenRequestAt = 0;
  private seenWatermark: string | null = null;
  private runtimeRefreshTimer: number | null = null;
  private runtimeRefreshMode: RuntimeRefreshMode | null = null;
  private replaceSnapshotSeedOnBackfill = false;
  private olderHistoryPrefetchCursor: string | null = null;
  private olderHistoryPrefetchPromise: Promise<HistoryPageDto | null> | null = null;
  private prefetchedOlderHistoryPage: {
    requestedCursor: string;
    page: HistoryPageDto;
  } | null = null;
  private readonly pendingReplyDebugTraces: PendingReplyDebugTrace[] = [];
  private readonly hasAuthoritativeBootstrapMessages: boolean;

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
    this.hasAuthoritativeBootstrapMessages = (options.bootstrapMessages?.length ?? 0) > 0;
    const seededSession = pickFreshestSessionSummary(options.initialSession ?? null, cachedSnapshot?.session ?? null);
    const seededMessages = mergeAuthoritativeMessages(
      cachedSnapshot?.messages ?? [],
      this.sessionId,
      options.bootstrapMessages ?? []
    );
    this.replaceSnapshotSeedOnBackfill =
      !this.hasAuthoritativeBootstrapMessages
      && (cachedSnapshot?.messages.length ?? 0) > 0
      && (cachedSnapshot?.messages.length ?? 0) <= REALTIME_LIMIT
      && (cachedSnapshot?.pagesLoaded ?? 0) <= 1;

    this.state = createInitialRuntimeState({
      session: seededSession,
      capabilities: cachedSnapshot?.capabilities ?? null,
      runtimeHasActiveRun: cachedSnapshot?.runtimeHasActiveRun ?? null,
      runtimeCanInterrupt: cachedSnapshot?.runtimeCanInterrupt ?? null,
      contextUsage: cachedSnapshot?.contextUsage ?? null,
      messages: seededMessages,
      permissionRequests: cachedSnapshot?.permissionRequests ?? [],
      queuedMessages: cachedSnapshot?.queuedMessages ?? [],
      olderCursor: cachedSnapshot?.olderCursor ?? null,
      hasOlderMessages: cachedSnapshot?.hasOlderMessages ?? false,
      lastCursor: cachedSnapshot?.lastCursor ?? null,
      interruptSource: cachedSnapshot?.interruptSource ?? null,
      pagesLoaded: cachedSnapshot?.pagesLoaded ?? 0
    });
    this.seenWatermark = seededSession?.lastSeenAt ?? null;
  }

  subscribe = (listener: RuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async initialize(): Promise<void> {
    this.historyBootstrapEnvelopeReceived = false;
    this.clearHistoryBootstrapFallbackTimer();
    this.clearOlderHistoryPrefetch();
    const bootstrapMessages = this.options.bootstrapMessages ?? [];
    const mergedMessages = mergeAuthoritativeMessages(this.state.messages, this.sessionId, bootstrapMessages);
    const hasBootstrappedMessages = this.hasAuthoritativeBootstrapMessages;

    this.patch({
      messages: mergedMessages,
      historyState: resolveInitialHistoryState(
        this.state.session,
        hasBootstrappedMessages ? mergedMessages.length : 0
      ),
      loadingOlderMessages: false,
      olderCursor: hasBootstrappedMessages ? null : this.state.olderCursor,
      hasOlderMessages: resolveHasOlderMessages({
        session: this.state.session,
        loadedMessageCount: mergedMessages.length,
        olderCursor: hasBootstrappedMessages ? null : this.state.olderCursor,
        pagesLoaded: this.state.pagesLoaded,
        currentHasOlderMessages: this.state.hasOlderMessages
      }),
      pagesLoaded: hasBootstrappedMessages ? Math.max(this.state.pagesLoaded, 1) : this.state.pagesLoaded,
      errorCode: null,
      errorDetail: null
    });

    if (this.shouldRefreshSessionDetail()) {
      void this.refreshSessionMetadata();
    }

    if (this.shouldRefreshRuntimeSnapshot()) {
      void this.refreshRuntimeSnapshot("bootstrap");
    }

    void this.refreshPermissionRequests();
    void this.refreshQueue();

    try {
      this.startRealtime();

      if (hasBootstrappedMessages) {
        this.scheduleMarkSeen();
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async reload(): Promise<void> {
    this.clearHistoryBootstrapFallbackTimer();
    this.historyBootstrapEnvelopeReceived = false;
    this.clearOlderHistoryPrefetch();
    this.realtimeClient?.close();
    this.realtimeClient = null;
    const cachedSnapshot = readViewSnapshot<SessionRuntimeSnapshot>(
      buildSessionRuntimeSnapshotKey(this.sessionId),
      SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    this.state = createInitialRuntimeState({
      session: pickFreshestSessionSummary(this.options.initialSession ?? null, cachedSnapshot?.session ?? null),
      capabilities: cachedSnapshot?.capabilities ?? null,
      runtimeHasActiveRun: cachedSnapshot?.runtimeHasActiveRun ?? null,
      runtimeCanInterrupt: cachedSnapshot?.runtimeCanInterrupt ?? null,
      contextUsage: cachedSnapshot?.contextUsage ?? null,
      messages: mergeAuthoritativeMessages(
        cachedSnapshot?.messages ?? [],
        this.sessionId,
        this.options.bootstrapMessages ?? []
      ),
      permissionRequests: cachedSnapshot?.permissionRequests ?? [],
      queuedMessages: cachedSnapshot?.queuedMessages ?? [],
      olderCursor: cachedSnapshot?.olderCursor ?? null,
      hasOlderMessages: cachedSnapshot?.hasOlderMessages ?? false,
      lastCursor: cachedSnapshot?.lastCursor ?? null,
      pagesLoaded: cachedSnapshot?.pagesLoaded ?? 0
    });
    this.seenWatermark = this.state.session?.lastSeenAt ?? null;
    this.replaceSnapshotSeedOnBackfill =
      !this.hasAuthoritativeBootstrapMessages
      && (cachedSnapshot?.messages.length ?? 0) > 0
      && (cachedSnapshot?.messages.length ?? 0) <= REALTIME_LIMIT
      && (cachedSnapshot?.pagesLoaded ?? 0) <= 1;
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
      session: nextSession,
      hasOlderMessages: resolveHasOlderMessages({
        session: nextSession,
        loadedMessageCount: this.state.messages.length,
        olderCursor: this.state.olderCursor,
        pagesLoaded: this.state.pagesLoaded,
        currentHasOlderMessages: this.state.hasOlderMessages
      })
    });
  }

  async sendMessage(
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> {
    const clientRequestId = createClientRequestId();
    this.beginPendingReplyDebugTrace("send_live", clientRequestId, content.length);
    const pending = createPendingMessage(
      this.sessionId,
      content,
      clientRequestId,
      options?.attachmentMeta ?? [],
      options?.attachments ?? [],
      getNextOptimisticUserSequence(this.state.messages)
    );

    this.patch({
      messages: [...this.state.messages, pending],
      session: withRunningState(this.state.session, "running"),
      runtimeHasActiveRun:
        shouldOptimisticallyAssumeActiveRun(this.state.session, this.state.capabilities)
          ? true
          : this.state.runtimeHasActiveRun,
      // 这次运行是由当前应用主动发起的，runtime adapter 已经持有真实子进程句柄，
      // 因此在后端回流前就应先把按钮切到可中断态，而不是继续沿用 provider 的静态能力。
      runtimeCanInterrupt:
        shouldOptimisticallyEnableInterrupt(this.state.session, this.state.capabilities)
          ? true
          : this.state.runtimeCanInterrupt
    });

    try {
      const response = await this.sendMessageWithFallback(content, clientRequestId, options);
      this.markPendingReplyDebugTraceResponseReady(clientRequestId, {
        returnedMessageId: response.message.messageId,
        returnedProviderSessionId: response.message.providerSessionId
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
      this.failPendingReplyDebugTrace(clientRequestId, error);
      this.patch({
        messages: markPendingAsFailed(this.state.messages, clientRequestId),
        session: withRunningState(this.state.session, "failed"),
        runtimeHasActiveRun: false,
        runtimeCanInterrupt: false
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
      ),
      runtimeHasActiveRun:
        shouldOptimisticallyAssumeActiveRun(this.state.session, this.state.capabilities)
          ? true
          : this.state.runtimeHasActiveRun,
      runtimeCanInterrupt:
        shouldOptimisticallyEnableInterrupt(this.state.session, this.state.capabilities)
          ? true
          : this.state.runtimeCanInterrupt
    });
    this.beginPendingReplyDebugTrace("retry_live", clientRequestId, target.content.length);

    try {
      const response = await this.sendMessageWithFallback(target.content, clientRequestId, {
        attachments: target.attachmentPayloads ?? [],
        attachmentMeta: target.attachments
      });
      this.markPendingReplyDebugTraceResponseReady(clientRequestId, {
        returnedMessageId: response.message.messageId,
        returnedProviderSessionId: response.message.providerSessionId
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
      this.failPendingReplyDebugTrace(clientRequestId, error);
      this.patch({
        messages: markPendingAsFailed(this.state.messages, clientRequestId),
        session: withRunningState(this.state.session, "failed")
      });
      throw error;
    }
  }

  async enqueueMessage(
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> {
    const clientRequestId = createClientRequestId();

    try {
      const queuedItem = await enqueueSessionMessage(this.sessionId, {
        content,
        clientRequestId,
        model: options?.model ?? null,
        reasoningLevel: options?.reasoningLevel ?? null,
        permissionMode: getDefaultSessionPermissionMode(),
        attachments: options?.attachments ?? []
      });

      this.patch({
        queuedMessages: upsertQueuedMessage(this.state.queuedMessages, queuedItem)
      });
      await this.refreshQueue();
    } catch (error) {
      throw error;
    }
  }

  async deleteQueuedMessage(queueItemId: string): Promise<void> {
    await deleteSessionQueueItem(this.sessionId, queueItemId);
    await this.refreshQueue();
  }

  async steerQueuedMessage(queueItemId: string): Promise<void> {
    await steerSessionQueueItem(this.sessionId, queueItemId);
    await this.refreshRuntimeSnapshot("queue_steer");
  }

  async interrupt(): Promise<void> {
    await interruptSession(this.sessionId);
    this.patch({
      session: withRunningState(this.state.session, "interrupted"),
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      interruptSource: "user",
      errorCode: null,
      errorDetail: null
    });
  }

  async replyPermissionRequest(
    requestId: string,
    payload: { action: string; answers?: Record<string, string[]> }
  ): Promise<void> {
    const request = this.state.permissionRequests.find((item) => item.id === requestId) ?? null;

    if (!request) {
      return;
    }

    const updated = await replySessionPermissionRequest(this.sessionId, requestId, payload);

    this.patch({
      permissionRequests: upsertPermissionRequest(this.state.permissionRequests, updated)
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
      const requestedCursor = this.state.olderCursor;
      const prefetchedPage = await this.takePrefetchedOlderHistoryPage(requestedCursor);

      if (prefetchedPage && this.state.olderCursor === requestedCursor) {
        this.applyOlderHistoryPage(prefetchedPage, "prefetch_cache");
        return;
      }

      const requested = this.realtimeClient?.requestOlderMessages(
        requestedCursor,
        OLDER_HISTORY_PAGE_LIMIT
      );

      if (!requested) {
        throw new Error("REALTIME_NOT_CONNECTED");
      }
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
    this.clearHistoryBootstrapFallbackTimer();
    this.clearOlderHistoryPrefetch();
    this.realtimeClient?.close();
    this.realtimeClient = null;
    this.pendingReplyDebugTraces.length = 0;

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
        logPerfDebug("session_send.realtime_subscribed", {
          sessionId: this.sessionId,
          lastCursor: this.state.lastCursor
        });
        this.patch({
          connectionState: "connected",
          hasOlderMessages: resolveHasOlderMessages({
            session: this.state.session,
            loadedMessageCount: this.state.messages.length,
            olderCursor: this.state.olderCursor,
            pagesLoaded: this.state.pagesLoaded,
            currentHasOlderMessages: this.state.hasOlderMessages
          })
        });
        this.scheduleHistoryBootstrapFallback();
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
            this.patch({
              errorCode: null,
              errorDetail: null
            });
          }

          return;
        }

        this.scheduleRuntimeRefresh("poll", "connection_state_change");
      },
      onEnvelope: (event) => {
        this.historyBootstrapEnvelopeReceived = true;
        this.clearHistoryBootstrapFallbackTimer();
        const shouldAttemptReplaceSnapshotSeed =
          event.type === "session.backfill" && this.replaceSnapshotSeedOnBackfill;
        const { messages: merged, replacedSnapshotSeed } = this.mergeHistoryMessages(
          event.messages,
          shouldAttemptReplaceSnapshotSeed
        );
        this.patch({
          messages: merged,
          lastCursor: event.cursor,
          historyState: "ready",
          olderCursor:
            event.type === "session.backfill" && !replacedSnapshotSeed && this.state.pagesLoaded > 1
              ? this.state.olderCursor
              : (event.olderCursor ?? this.state.olderCursor),
          hasOlderMessages:
            event.type === "session.backfill"
              ? (
                  !replacedSnapshotSeed && this.state.pagesLoaded > 1
                    ? this.state.hasOlderMessages
                    : Boolean(event.olderCursor)
                )
              : resolveHasOlderMessages({
                  session: this.state.session,
                  loadedMessageCount: merged.length,
                  olderCursor: this.state.olderCursor,
                  pagesLoaded: this.state.pagesLoaded,
                  currentHasOlderMessages: this.state.hasOlderMessages
                }),
          pagesLoaded:
            event.type === "session.backfill"
              ? (
                  !replacedSnapshotSeed && this.state.pagesLoaded > 1
                    ? this.state.pagesLoaded
                    : Math.max(this.state.pagesLoaded, merged.length > 0 ? 1 : 0)
                )
              : this.state.pagesLoaded,
          session: withRunningState(
            this.state.session,
            resolveEnvelopeRunningState(event.type, this.state.session?.runningState)
          )
        });
        this.realtimeClient?.updateCursor(event.cursor);
        this.scheduleMarkSeen();
        this.scheduleOlderHistoryPrefetch(
          event.type === "session.backfill" ? "backfill" : "delta"
        );

        if (this.state.queuedMessages.length > 0) {
          void this.refreshQueue();
        }
      },
      onOlderHistory: (event) => {
        this.applyOlderHistoryPage(
          {
            messages: event.messages,
            nextCursor: event.olderCursor
          },
          "realtime"
        );
      },
      onRuntimeMessage: (event) => {
        this.handleRuntimeMessage(event);
      },
      onActivity: (event) => {
        this.handleActivity(event);
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
      onPermissionRequest: (event) => {
        this.handlePermissionRequest(event);
      },
      onPermissionRequestResolved: (event) => {
        this.handlePermissionRequestResolved(event);
      },
      onError: (event) => {
        this.patch({
          loadingOlderMessages: false,
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
    let nextInput = input;

    if (Object.prototype.hasOwnProperty.call(input, "session")) {
      this.syncSeenWatermark(input.session ?? null);
      nextInput = {
        ...input,
        session: this.applySeenWatermark(input.session ?? null)
      };
    }

    this.state = {
      ...this.state,
      ...nextInput
    };

    if (
      Object.prototype.hasOwnProperty.call(nextInput, "session")
      || Object.prototype.hasOwnProperty.call(nextInput, "capabilities")
      || Object.prototype.hasOwnProperty.call(nextInput, "contextUsage")
      || Object.prototype.hasOwnProperty.call(nextInput, "messages")
      || Object.prototype.hasOwnProperty.call(nextInput, "permissionRequests")
      || Object.prototype.hasOwnProperty.call(nextInput, "queuedMessages")
    ) {
      this.persistSnapshot();
    }

    this.emit();
  }

  private mergeHistoryMessages(
    incoming: HistoryMessageDto[],
    replaceSnapshotSeed: boolean
  ): { messages: SessionMessageViewModel[]; replacedSnapshotSeed: boolean } {
    // 首屏 backfill 可能比本地快照更旧，例如 provider 日志尚未落盘。
    // 这种情况下只能合并，不能把已经看到的最新尾消息删掉。
    const replacedSnapshotSeed =
      replaceSnapshotSeed
      && this.replaceSnapshotSeedOnBackfill
      && shouldReplaceSnapshotSeedWithIncoming(this.state.messages, incoming);
    const baseMessages =
      replacedSnapshotSeed
        ? this.state.messages.filter((message) => message.deliveryState !== "sent")
        : this.state.messages;
    const merged = mergeAuthoritativeMessages(baseMessages, this.sessionId, incoming);

    if (replacedSnapshotSeed) {
      this.replaceSnapshotSeedOnBackfill = false;
    }

    return {
      messages: merged,
      replacedSnapshotSeed
    };
  }

  private handleError(error: unknown): void {
    this.clearHistoryBootstrapFallbackTimer();
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

    const targetSeenAt = this.getTargetSeenAt();

    if (this.markSeenInFlight || targetSeenAt === null) {
      return;
    }

    const throttleDelayMs = this.getMarkSeenThrottleDelayMs();
    const delayMs = Math.max(SESSION_MARK_SEEN_DELAY_MS, throttleDelayMs);

    this.markSeenTimer = window.setTimeout(() => {
      this.markSeenTimer = null;
      const nextTargetSeenAt = this.getTargetSeenAt();

      if (nextTargetSeenAt === null) {
        return;
      }

      logPerfDebug("session_seen.start", {
        sessionId: this.sessionId,
        targetSeenAt: nextTargetSeenAt,
        seenWatermark: this.seenWatermark
      });

      this.markSeenInFlight = true;
      this.lastMarkSeenRequestAt = Date.now();
      void markSessionSeen(this.sessionId)
        .then(() => {
          this.bumpSeenWatermark(nextTargetSeenAt);
          this.patch({
            session: withLastSeenAt(this.state.session, nextTargetSeenAt)
          });
          this.options.onSeen?.(this.sessionId, nextTargetSeenAt);
          logPerfDebug("session_seen.end", {
            sessionId: this.sessionId,
            seenWatermark: this.seenWatermark
          });
        })
        .catch(() => {
          logPerfDebug("session_seen.error", {
            sessionId: this.sessionId,
            targetSeenAt: nextTargetSeenAt
          });
          return;
        })
        .finally(() => {
          this.markSeenInFlight = false;

          if (this.shouldMarkSeen()) {
            this.scheduleMarkSeen();
          }
        });
    }, delayMs);
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

  private scheduleHistoryBootstrapFallback(): void {
    if (this.historyBootstrapEnvelopeReceived || this.historyBootstrapFallbackTimer !== null) {
      return;
    }

    this.historyBootstrapFallbackTimer = window.setTimeout(() => {
      this.historyBootstrapFallbackTimer = null;

      if (this.historyBootstrapEnvelopeReceived) {
        return;
      }

      void this.resolveHistoryBootstrapFallback();
    }, 350);
  }

  private clearHistoryBootstrapFallbackTimer(): void {
    if (this.historyBootstrapFallbackTimer === null) {
      return;
    }

    window.clearTimeout(this.historyBootstrapFallbackTimer);
    this.historyBootstrapFallbackTimer = null;
  }

  private async resolveHistoryBootstrapFallback(): Promise<void> {
    try {
      // WebSocket 首包偶发丢失时，主动拉一页最新历史兜底，避免首次点开会话看到旧快照。
      const fallbackLimit = Math.min(
        SNAPSHOT_HISTORY_LIMIT,
        Math.max(REALTIME_LIMIT, this.state.messages.length, INITIAL_HISTORY_LIMIT)
      );
      const page = await getSessionMessages(
        this.sessionId,
        null,
        fallbackLimit,
        "backward"
      );

      if (this.historyBootstrapEnvelopeReceived) {
        return;
      }

      this.historyBootstrapEnvelopeReceived = true;
      const { messages: merged, replacedSnapshotSeed } = this.mergeHistoryMessages(
        page.messages,
        this.replaceSnapshotSeedOnBackfill
      );

      this.patch({
        messages: merged,
        historyState: "ready",
        olderCursor:
          !replacedSnapshotSeed && this.state.pagesLoaded > 1
            ? this.state.olderCursor
            : page.nextCursor,
        hasOlderMessages:
          !replacedSnapshotSeed && this.state.pagesLoaded > 1
            ? this.state.hasOlderMessages
            : resolveHasOlderMessages({
                session: this.state.session,
                loadedMessageCount: merged.length,
                olderCursor: page.nextCursor,
                pagesLoaded: this.state.pagesLoaded,
                currentHasOlderMessages: this.state.hasOlderMessages
              }),
        lastCursor: page.cursor ?? this.state.lastCursor,
        pagesLoaded:
          !replacedSnapshotSeed && this.state.pagesLoaded > 1
            ? this.state.pagesLoaded
            : (
                merged.length > 0
                  ? Math.max(this.state.pagesLoaded, 1)
                  : this.state.pagesLoaded
              ),
        errorCode: null,
        errorDetail: null
      });
      this.scheduleMarkSeen();
      this.scheduleOlderHistoryPrefetch("bootstrap_fallback");
    } catch {
      // 兜底失败不打断主链路，继续沿用当前状态。
    }
  }

  private applyOlderHistoryPage(
    page: Pick<HistoryPageDto, "messages" | "nextCursor">,
    source: "realtime" | "prefetch_cache"
  ): void {
    const { messages: merged } = this.mergeHistoryMessages(page.messages, false);

    this.patch({
      messages: merged,
      historyState: "ready",
      loadingOlderMessages: false,
      olderCursor: page.nextCursor,
      hasOlderMessages: Boolean(page.nextCursor),
      pagesLoaded: this.state.pagesLoaded + 1,
      errorCode: null,
      errorDetail: null
    });
    logPerfDebug("session.history_older.applied", {
      sessionId: this.sessionId,
      source,
      messageCount: page.messages.length,
      nextCursor: page.nextCursor
    });
    this.scheduleOlderHistoryPrefetch(source);
  }

  private scheduleOlderHistoryPrefetch(reason: string): void {
    const requestedCursor = this.state.olderCursor;

    if (
      this.state.historyState !== "ready" ||
      this.state.loadingOlderMessages ||
      !requestedCursor
    ) {
      return;
    }

    if (this.prefetchedOlderHistoryPage?.requestedCursor === requestedCursor) {
      return;
    }

    if (
      this.olderHistoryPrefetchPromise &&
      this.olderHistoryPrefetchCursor === requestedCursor
    ) {
      return;
    }

    void this.prefetchOlderHistoryPage(requestedCursor, reason);
  }

  private async prefetchOlderHistoryPage(
    requestedCursor: string,
    reason: string
  ): Promise<HistoryPageDto | null> {
    if (this.prefetchedOlderHistoryPage?.requestedCursor === requestedCursor) {
      return this.prefetchedOlderHistoryPage.page;
    }

    if (
      this.olderHistoryPrefetchPromise &&
      this.olderHistoryPrefetchCursor === requestedCursor
    ) {
      return this.olderHistoryPrefetchPromise;
    }

    this.olderHistoryPrefetchCursor = requestedCursor;
    logPerfDebug("session.history_older.prefetch.start", {
      sessionId: this.sessionId,
      requestedCursor,
      reason,
      limit: OLDER_HISTORY_PAGE_LIMIT
    });

    const promise = getSessionMessages(
      this.sessionId,
      requestedCursor,
      OLDER_HISTORY_PAGE_LIMIT,
      "backward"
    )
      .then((page) => {
        if (this.state.olderCursor === requestedCursor) {
          this.prefetchedOlderHistoryPage = {
            requestedCursor,
            page
          };
        }

        logPerfDebug("session.history_older.prefetch.end", {
          sessionId: this.sessionId,
          requestedCursor,
          messageCount: page.messages.length,
          nextCursor: page.nextCursor
        });
        return page;
      })
      .catch((error) => {
        logPerfDebug("session.history_older.prefetch.error", {
          sessionId: this.sessionId,
          requestedCursor,
          message: error instanceof Error ? error.message : "unknown"
        });
        return null;
      })
      .finally(() => {
        if (this.olderHistoryPrefetchPromise === promise) {
          this.olderHistoryPrefetchPromise = null;
        }

        if (this.olderHistoryPrefetchCursor === requestedCursor) {
          this.olderHistoryPrefetchCursor = null;
        }
      });

    this.olderHistoryPrefetchPromise = promise;
    return promise;
  }

  private async takePrefetchedOlderHistoryPage(
    requestedCursor: string
  ): Promise<HistoryPageDto | null> {
    if (this.prefetchedOlderHistoryPage?.requestedCursor === requestedCursor) {
      const page = this.prefetchedOlderHistoryPage.page;
      this.prefetchedOlderHistoryPage = null;
      logPerfDebug("session.history_older.prefetch.hit", {
        sessionId: this.sessionId,
        requestedCursor,
        messageCount: page.messages.length,
        nextCursor: page.nextCursor
      });
      return page;
    }

    if (
      this.olderHistoryPrefetchPromise &&
      this.olderHistoryPrefetchCursor === requestedCursor
    ) {
      const page = await this.olderHistoryPrefetchPromise;

      if (!page || this.state.olderCursor !== requestedCursor) {
        return null;
      }

      this.prefetchedOlderHistoryPage = null;
      logPerfDebug("session.history_older.prefetch.await_hit", {
        sessionId: this.sessionId,
        requestedCursor,
        messageCount: page.messages.length,
        nextCursor: page.nextCursor
      });
      return page;
    }

    return null;
  }

  private clearOlderHistoryPrefetch(): void {
    this.olderHistoryPrefetchCursor = null;
    this.olderHistoryPrefetchPromise = null;
    this.prefetchedOlderHistoryPage = null;
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
    }, mode === "poll" ? SESSION_RUNTIME_POLL_DELAY_MS : 1200);
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
      const resolvedRuntimeHasActiveRun = resolveNextRuntimeHasActiveRun(
        this.state.runtimeHasActiveRun,
        runtime.runningState,
        runtime.hasActiveRun
      );
      const resolvedRuntimeCanInterrupt = resolveNextRuntimeCanInterrupt(
        this.state.runtimeCanInterrupt,
        runtime.runningState,
        resolvedRuntimeHasActiveRun,
        runtime.canInterrupt
      );
      this.patch({
        session: applyRuntimeActivityToSession(this.state.session, runtime),
        runtimeHasActiveRun: resolvedRuntimeHasActiveRun,
        runtimeCanInterrupt: resolvedRuntimeCanInterrupt,
        contextUsage: runtime.contextUsage,
        ...resolveRuntimeErrorState(runtime, this.state.interruptSource)
      });
      await this.refreshQueue();

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

    if (shouldRefreshCapabilities(this.state.capabilities)) {
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

    if (tasks.length === 0) {
      return;
    }

    await Promise.allSettled(tasks);
  }

  private async refreshPermissionRequests(): Promise<void> {
    try {
      const response = await getSessionPermissionRequests(this.sessionId);

      this.patch({
        permissionRequests: response.items
      });
    } catch {
      return;
    }
  }

  private shouldRefreshSessionDetail(): boolean {
    return (
      this.state.session === null
      || shouldRefreshCapabilities(this.state.capabilities)
      || this.state.session.runningState === null
    );
  }

  private shouldRefreshRuntimeSnapshot(): boolean {
    return this.state.contextUsage === null;
  }

  private async refreshRuntimeSnapshot(reason: string): Promise<void> {
    logPerfDebug("session_runtime.snapshot.start", {
      sessionId: this.sessionId,
      reason
    });

    try {
      const runtime = await getSessionRuntime(this.sessionId);
      const resolvedRuntimeHasActiveRun = resolveNextRuntimeHasActiveRun(
        this.state.runtimeHasActiveRun,
        runtime.runningState,
        runtime.hasActiveRun
      );
      const resolvedRuntimeCanInterrupt = resolveNextRuntimeCanInterrupt(
        this.state.runtimeCanInterrupt,
        runtime.runningState,
        resolvedRuntimeHasActiveRun,
        runtime.canInterrupt
      );

      this.patch({
        session: applyRuntimeActivityToSession(this.state.session, runtime),
        runtimeHasActiveRun: resolvedRuntimeHasActiveRun,
        runtimeCanInterrupt: resolvedRuntimeCanInterrupt,
        contextUsage: runtime.contextUsage,
        ...resolveRuntimeErrorState(runtime, this.state.interruptSource)
      });
      await this.refreshQueue();

      logPerfDebug("session_runtime.snapshot.end", {
        sessionId: this.sessionId,
        reason,
        hasContextUsage: runtime.contextUsage !== null
      });
    } catch (error) {
      logPerfDebug("session_runtime.snapshot.error", {
        sessionId: this.sessionId,
        reason,
        message: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  async refreshQueue(): Promise<void> {
    try {
      const response = await getSessionQueue(this.sessionId);
      this.patch({
        queuedMessages: response.items
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
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ) {
    try {
      return await sendLiveMessage(this.sessionId, {
        content,
        clientRequestId,
        model: options?.model ?? null,
        reasoningLevel: options?.reasoningLevel ?? null,
        permissionMode: getDefaultSessionPermissionMode(),
        attachments: options?.attachments ?? []
      });
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) {
        throw error;
      }

      if ((options?.attachments?.length ?? 0) > 0) {
        throw error;
      }

      logPerfDebug("session_send.live_fallback", {
        sessionId: this.sessionId,
        clientRequestId,
        reason: error.message
      });

      return sendSessionMessage(this.sessionId, {
        content,
        clientRequestId,
        permissionMode: getDefaultSessionPermissionMode()
      });
    }
  }

  private handleRuntimeStatus(event: SessionRuntimeStatusEvent): void {
    const nextRunningState = resolveRuntimeTransitionState(this.state.session?.runningState, event.status);

    this.patch({
      session: withRunningState(this.state.session, nextRunningState),
      runtimeHasActiveRun: isRuntimeActiveState(nextRunningState)
        ? (this.state.runtimeHasActiveRun ?? true)
        : false,
      runtimeCanInterrupt: isRuntimeActiveState(nextRunningState)
        ? this.state.runtimeCanInterrupt
        : false,
      interruptSource:
        nextRunningState === "interrupted"
          ? (event.interruptSource ?? this.state.interruptSource)
          : nextRunningState === "completed" || nextRunningState === "failed"
            ? null
            : this.state.interruptSource,
      errorCode: null,
      errorDetail: nextRunningState === event.status ? event.detail : this.state.errorDetail
    });

    if (isTerminalRuntimeState(nextRunningState)) {
      this.completePendingReplyDebugTraceWithoutAssistant("session_send.client_terminal_before_message", {
        status: event.status,
        detail: event.detail
      });
      this.clearRuntimeRefreshTimer();
      void this.refreshQueue();
      void this.refreshRuntimeSnapshot("runtime_terminal");
    }

  }

  private handleActivity(event: SessionActivityEvent): void {
    const resolvedRuntimeHasActiveRun = resolveNextRuntimeHasActiveRun(
      this.state.runtimeHasActiveRun,
      event.runningState,
      event.hasActiveRun
    );
    const resolvedRuntimeCanInterrupt = resolveNextRuntimeCanInterrupt(
      this.state.runtimeCanInterrupt,
      event.runningState,
      resolvedRuntimeHasActiveRun,
      event.canInterrupt
    );
    this.patch({
      session: applyRealtimeActivityToSession(this.state.session, event),
      runtimeHasActiveRun: resolvedRuntimeHasActiveRun,
      runtimeCanInterrupt: resolvedRuntimeCanInterrupt,
      ...resolveRuntimeErrorState(event, this.state.interruptSource)
    });

    if (isTerminalRuntimeState(event.runningState)) {
      this.clearRuntimeRefreshTimer();
      void this.refreshQueue();
      return;
    }

    if (event.runningState === "stale" || event.runningState === "unknown") {
      this.scheduleRuntimeRefresh("tail", "activity_watchdog");
    }
  }

  private handleRuntimeMessage(event: SessionRuntimeMessageEvent): void {
    if (event.message.role === "assistant") {
      this.completePendingReplyDebugTrace(event);
    }
    const merged = mergeAuthoritativeMessages(this.state.messages, this.sessionId, [event.message]);

    this.patch({
      messages: merged,
      historyState: "ready",
      hasOlderMessages: resolveHasOlderMessages({
        session: this.state.session,
        loadedMessageCount: merged.length,
        olderCursor: this.state.olderCursor,
        pagesLoaded: this.state.pagesLoaded,
        currentHasOlderMessages: this.state.hasOlderMessages
      }),
      session: withRunningState(
        this.state.session,
        resolveEnvelopeRunningState("session.delta", this.state.session?.runningState)
      )
    });
    this.scheduleMarkSeen();

    if (this.state.queuedMessages.length > 0) {
      void this.refreshQueue();
    }
  }

  private handleRuntimeError(event: SessionRuntimeErrorEvent): void {
    const nextRunningState = resolveRuntimeTransitionState(this.state.session?.runningState, "failed");

    this.completePendingReplyDebugTraceWithoutAssistant("session_send.client_runtime_error", {
      errorCode: event.error_code,
      detail: event.detail
    });
    this.clearRuntimeRefreshTimer();
    this.patch({
      session: withRunningState(this.state.session, nextRunningState),
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      interruptSource: null,
      errorCode: nextRunningState === "failed" ? event.error_code : this.state.errorCode,
      errorDetail: nextRunningState === "failed" ? event.detail : this.state.errorDetail
    });
    void this.refreshQueue();
  }

  private handleInterrupted(event: SessionInterruptedEvent): void {
    const nextRunningState = resolveRuntimeTransitionState(this.state.session?.runningState, "interrupted");

    this.completePendingReplyDebugTraceWithoutAssistant("session_send.client_interrupted", {
      detail: event.detail
    });
    this.clearRuntimeRefreshTimer();
    this.patch({
      session: withRunningState(this.state.session, nextRunningState),
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      interruptSource:
        nextRunningState === "interrupted"
          ? (event.interruptSource ?? this.state.interruptSource)
          : this.state.interruptSource,
      errorCode: nextRunningState === "interrupted" ? null : this.state.errorCode,
      errorDetail: nextRunningState === "interrupted" ? event.detail : this.state.errorDetail
    });
    void this.refreshQueue();
  }

  private handlePermissionRequest(event: SessionPermissionRequestEvent): void {
    this.patch({
      permissionRequests: upsertPermissionRequest(this.state.permissionRequests, event.request)
    });
  }

  private handlePermissionRequestResolved(event: SessionPermissionRequestResolvedEvent): void {
    this.patch({
      permissionRequests: upsertPermissionRequest(this.state.permissionRequests, event.request)
    });
  }

  private shouldMarkSeen(): boolean {
    return this.getTargetSeenAt() !== null;
  }

  private getTargetSeenAt(): string | null {
    const latestVisibleMessage = [...this.state.messages]
      .reverse()
      .find((message) => message.role !== "user");

    if (!latestVisibleMessage) {
      return null;
    }

    const lastSeenAt = this.seenWatermark;

    if (!lastSeenAt) {
      return latestVisibleMessage.timestamp;
    }

    return latestVisibleMessage.timestamp > lastSeenAt ? latestVisibleMessage.timestamp : null;
  }

  private syncSeenWatermark(session: SessionSummaryDto | null): void {
    if (!session?.lastSeenAt) {
      return;
    }

    this.bumpSeenWatermark(session.lastSeenAt);
  }

  private bumpSeenWatermark(nextSeenAt: string): void {
    if (this.seenWatermark && this.seenWatermark >= nextSeenAt) {
      return;
    }

    this.seenWatermark = nextSeenAt;
  }

  private getMarkSeenThrottleDelayMs(): number {
    if (this.lastMarkSeenRequestAt <= 0) {
      return 0;
    }

    return Math.max(0, SESSION_MARK_SEEN_MIN_INTERVAL_MS - (Date.now() - this.lastMarkSeenRequestAt));
  }

  private applySeenWatermark(session: SessionSummaryDto | null): SessionSummaryDto | null {
    if (!session || !this.seenWatermark) {
      return session;
    }

    return withLastSeenAt(session, this.seenWatermark);
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
      runtimeHasActiveRun: this.state.runtimeHasActiveRun,
      runtimeCanInterrupt: this.state.runtimeCanInterrupt,
      contextUsage: this.state.contextUsage,
      messages: buildSnapshotMessages(this.state.messages),
      permissionRequests: this.state.permissionRequests,
      queuedMessages: this.state.queuedMessages,
      olderCursor: this.state.olderCursor,
      hasOlderMessages: this.state.hasOlderMessages,
      lastCursor: this.state.lastCursor,
      pagesLoaded: this.state.pagesLoaded,
      interruptSource: this.state.interruptSource
    });
  }

  private beginPendingReplyDebugTrace(
    mode: PendingReplyDebugTrace["mode"],
    clientRequestId: string,
    contentLength: number
  ): void {
    const trace: PendingReplyDebugTrace = {
      mode,
      clientRequestId,
      startedAtMs: performance.now(),
      responseReadyAtMs: null,
      contentLength
    };

    this.pendingReplyDebugTraces.push(trace);
    logPerfDebug(`session_send.${mode}.client_start`, {
      sessionId: this.sessionId,
      clientRequestId,
      contentLength
    });
  }

  private markPendingReplyDebugTraceResponseReady(
    clientRequestId: string,
    detail: Record<string, unknown> = {}
  ): void {
    const trace = this.pendingReplyDebugTraces.find((item) => item.clientRequestId === clientRequestId);

    if (!trace || trace.responseReadyAtMs !== null) {
      return;
    }

    trace.responseReadyAtMs = performance.now();
    logPerfDebug(`session_send.${trace.mode}.client_response`, {
      sessionId: this.sessionId,
      clientRequestId,
      durationMs: Math.round(trace.responseReadyAtMs - trace.startedAtMs),
      ...detail
    });
  }

  private failPendingReplyDebugTrace(clientRequestId: string, error: unknown): void {
    const trace = this.pendingReplyDebugTraces.find((item) => item.clientRequestId === clientRequestId);

    if (!trace) {
      return;
    }

    logPerfDebug(`session_send.${trace.mode}.client_error`, {
      sessionId: this.sessionId,
      clientRequestId,
      durationMs: Math.round(performance.now() - trace.startedAtMs),
      error: error instanceof Error ? error.message : String(error)
    });
    this.removePendingReplyDebugTrace(trace.clientRequestId);
  }

  private completePendingReplyDebugTrace(event: SessionRuntimeMessageEvent): void {
    const trace = this.pendingReplyDebugTraces[0];

    if (!trace) {
      return;
    }

    const nowMs = performance.now();
    logPerfDebug(`session_send.${trace.mode}.first_assistant_message`, {
      sessionId: this.sessionId,
      clientRequestId: trace.clientRequestId,
      durationMs: Math.round(nowMs - trace.startedAtMs),
      responseToAssistantMs:
        trace.responseReadyAtMs === null ? null : Math.round(nowMs - trace.responseReadyAtMs),
      messageId: event.message.messageId,
      kind: event.message.kind,
      contentLength: event.message.content.length
    });
    this.removePendingReplyDebugTrace(trace.clientRequestId);
  }

  private completePendingReplyDebugTraceWithoutAssistant(
    scope: string,
    detail: Record<string, unknown> = {}
  ): void {
    const trace = this.pendingReplyDebugTraces[0];

    if (!trace) {
      return;
    }

    logPerfDebug(scope, {
      sessionId: this.sessionId,
      clientRequestId: trace.clientRequestId,
      durationMs: Math.round(performance.now() - trace.startedAtMs),
      responseReady: trace.responseReadyAtMs !== null,
      ...detail
    });
    this.removePendingReplyDebugTrace(trace.clientRequestId);
  }

  private removePendingReplyDebugTrace(clientRequestId: string): void {
    const index = this.pendingReplyDebugTraces.findIndex((item) => item.clientRequestId === clientRequestId);

    if (index < 0) {
      return;
    }

    this.pendingReplyDebugTraces.splice(index, 1);
  }
}

export function useSessionRuntimeStore<T>(
  store: SessionRuntimeStore,
  selector: (state: SessionRuntimeState) => T
) {
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    setValue(selector(store.getState()));
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

function resolveKnownMessageCount(session: SessionSummaryDto | null): number | null {
  const messageCount = session?.messageCount;
  return typeof messageCount === "number" && Number.isFinite(messageCount) ? messageCount : null;
}

function shouldReplaceSnapshotSeedWithIncoming(
  current: SessionMessageViewModel[],
  incoming: HistoryMessageDto[]
): boolean {
  const latestIncomingMessage = pickLatestHistoryMessage(incoming);

  if (!latestIncomingMessage) {
    return false;
  }

  const latestCurrentMessage = pickLatestSentViewMessage(current);

  if (!latestCurrentMessage) {
    return true;
  }

  return compareMessageOrder(
    latestIncomingMessage.sequence,
    latestIncomingMessage.timestamp,
    latestCurrentMessage.sequence,
    latestCurrentMessage.timestamp
  ) >= 0;
}

function pickLatestHistoryMessage(messages: HistoryMessageDto[]): HistoryMessageDto | null {
  let latest: HistoryMessageDto | null = null;

  for (const message of messages) {
    if (
      !latest
      || compareMessageOrder(message.sequence, message.timestamp, latest.sequence, latest.timestamp) > 0
    ) {
      latest = message;
    }
  }

  return latest;
}

function pickLatestSentViewMessage(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel | null {
  let latest: SessionMessageViewModel | null = null;

  for (const message of messages) {
    if (message.deliveryState !== "sent") {
      continue;
    }

    if (
      !latest
      || compareMessageOrder(message.sequence, message.timestamp, latest.sequence, latest.timestamp) > 0
    ) {
      latest = message;
    }
  }

  return latest;
}

function compareMessageOrder(
  leftSequence: number,
  leftTimestamp: string,
  rightSequence: number,
  rightTimestamp: string
): number {
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  return leftTimestamp.localeCompare(rightTimestamp);
}

function resolveInitialHistoryState(
  _session: SessionSummaryDto | null,
  loadedMessageCount: number
): "loading" | "ready" {
  if (loadedMessageCount > 0) {
    return "ready";
  }

  return "loading";
}

function inferHasOlderMessages(
  session: SessionSummaryDto | null,
  loadedMessageCount: number
): boolean {
  const knownMessageCount = resolveKnownMessageCount(session);

  if (knownMessageCount !== null) {
    return knownMessageCount > loadedMessageCount;
  }

  return loadedMessageCount >= REALTIME_LIMIT;
}

function resolveHasOlderMessages(input: {
  session: SessionSummaryDto | null;
  loadedMessageCount: number;
  olderCursor: string | null;
  pagesLoaded: number;
  currentHasOlderMessages: boolean;
}): boolean {
  if (input.olderCursor) {
    return true;
  }

  if (input.pagesLoaded > 1) {
    return input.currentHasOlderMessages;
  }

  return inferHasOlderMessages(input.session, input.loadedMessageCount);
}

function withRunningState<
  T extends {
    runningState: SessionRunningState | null;
    completedAt?: string | null;
    lastSeenAt?: string | null;
    activityState?: SessionActivityState;
  }
>(
  session: T | null,
  runningState: SessionRunningState
): T | null {
  if (!session) {
    return session;
  }

  return {
    ...session,
    runningState,
    activityState: resolveSessionActivityState(
      session,
      runningState,
      session.completedAt ?? null,
      isRuntimeActiveState(runningState)
    )
  };
}

function withLastSeenAt<
  T extends {
    lastSeenAt: string | null;
    activityState?: SessionActivityState;
  }
>(
  session: T | null,
  lastSeenAt: string
): T | null {
  if (!session) {
    return session;
  }

  if (session.lastSeenAt && session.lastSeenAt >= lastSeenAt) {
    return session;
  }

  return {
    ...session,
    lastSeenAt,
    activityState: session.activityState === "completed_unread" ? "idle" : session.activityState
  };
}

function applyRuntimeActivityToSession(
  session: SessionSummaryDto | null,
  runtime: SessionRuntimeDto
): SessionSummaryDto | null {
  return applySessionActivityPatch(session, {
    runningState: runtime.runningState,
    activityResolutionSource: runtime.activityResolutionSource,
    activityConfidence: runtime.activityConfidence,
    runId: runtime.runId,
    detail: runtime.detail,
    interruptSource: runtime.interruptSource,
    errorCode: runtime.errorCode,
    errorDetail: runtime.errorDetail,
    hasActiveRun: runtime.hasActiveRun,
    updatedAt: runtime.updatedAt,
    watchdogTriggeredAt: runtime.watchdogTriggeredAt
  });
}

function applyRealtimeActivityToSession(
  session: SessionSummaryDto | null,
  event: SessionActivityEvent
): SessionSummaryDto | null {
  return applySessionActivityPatch(session, event);
}

function applySessionActivityPatch(
  session: SessionSummaryDto | null,
  activity: {
    runningState: SessionRunningState;
    activityResolutionSource: SessionActivityResolutionSource;
    activityConfidence: SessionActivityConfidence;
    runId: string | null;
    detail: string | null;
    interruptSource: SessionInterruptSource | null;
    errorCode: string | null;
    errorDetail: string | null;
    hasActiveRun: boolean;
    updatedAt: string;
    watchdogTriggeredAt: string | null;
  }
): SessionSummaryDto | null {
  if (!session) {
    return session;
  }

  const activitySource = mapResolutionSourceToActivitySource(activity.activityResolutionSource);
  const completedAt =
    isTerminalRuntimeState(activity.runningState)
      ? maxIsoTimestamp(session.completedAt, activity.updatedAt)
      : null;
  const lastEventAt =
    activity.runningState === "completed" || activity.runningState === "interrupted" || activity.runningState === "failed"
      ? maxIsoTimestamp(session.lastEventAt, activity.updatedAt)
      : activity.updatedAt;

  return {
    ...session,
    runningState: activity.runningState,
    activitySource,
    activityResolutionSource: activity.activityResolutionSource,
    activityConfidence: activity.activityConfidence,
    runId: activity.runId,
    lastEventAt,
    completedAt,
    lastErrorCode:
      activity.runningState === "failed"
        ? activity.errorCode ?? session.lastErrorCode
        : null,
    lastErrorDetail:
      activity.runningState === "failed"
        ? activity.errorDetail ?? activity.detail ?? session.lastErrorDetail
        : null,
    watchdogTriggeredAt: activity.watchdogTriggeredAt,
    updatedAt: maxIsoTimestamp(session.updatedAt, activity.updatedAt) ?? activity.updatedAt,
    activityState: resolveSessionActivityState(session, activity.runningState, completedAt, activity.hasActiveRun)
  };
}

function resolveSessionActivityState(
  session: {
    activityState?: SessionActivityState;
    lastSeenAt?: string | null;
  },
  runningState: SessionRunningState,
  completedAt: string | null,
  hasActiveRun: boolean
): SessionActivityState {
  if (hasActiveRun || isRuntimeActiveState(runningState)) {
    return "running";
  }

  if (
    completedAt &&
    (!session.lastSeenAt || completedAt > session.lastSeenAt)
  ) {
    return "completed_unread";
  }

  if (session.activityState === "running" || session.activityState === "completed_unread") {
    return "idle";
  }

  return session.activityState ?? "idle";
}

function isRuntimeActiveState(state: SessionRunningState | null | undefined): boolean {
  return state === "starting" || state === "running" || state === "reconnecting";
}

function isTerminalRuntimeState(
  state: SessionRunningState | null | undefined
): state is "completed" | "interrupted" | "failed" {
  return state === "completed" || state === "interrupted" || state === "failed";
}

function shouldRefreshCapabilities(capabilities: ProviderCapabilitiesDto | null): boolean {
  if (capabilities === null) {
    return true;
  }

  const modelOptions = capabilities.modelOptions ?? [];

  if (modelOptions.length === 0) {
    return true;
  }

  return modelOptions.every((option) => option.usesProviderDefault === true);
}

function resolveEnvelopeRunningState(
  eventType: "session.backfill" | "session.delta",
  state: SessionRunningState | null | undefined
): SessionRunningState {
  if (eventType === "session.backfill") {
    return state ?? "idle";
  }

  if (state === "completed" || state === "interrupted" || state === "failed") {
    return state;
  }

  return "running";
}

function resolveRuntimeTransitionState(
  currentState: SessionRunningState | null | undefined,
  incomingState: SessionRunningState
): SessionRunningState {
  if (isTerminalRuntimeState(currentState)) {
    return currentState;
  }

  return incomingState;
}

function resolveRuntimeErrorState(runtime: {
  runningState: SessionRunningState;
  interruptSource?: SessionInterruptSource | null;
  errorCode: string | null;
  errorDetail: string | null;
  detail: string | null;
}, currentInterruptSource: SessionInterruptSource | null): {
  interruptSource: SessionInterruptSource | null;
  errorCode: string | null;
  errorDetail: string | null;
} {
  if (runtime.runningState === "failed") {
    return {
      interruptSource: null,
      errorCode: runtime.errorCode,
      errorDetail: runtime.errorDetail ?? runtime.detail
    };
  }

  if (runtime.runningState === "interrupted") {
    return {
      interruptSource: runtime.interruptSource ?? null,
      errorCode: null,
      errorDetail: runtime.detail
    };
  }

  if (runtime.runningState === "completed") {
    return {
      interruptSource: null,
      errorCode: null,
      errorDetail: runtime.detail
    };
  }

  return {
    interruptSource: currentInterruptSource,
    errorCode: null,
    errorDetail: null
  };
}

function mapResolutionSourceToActivitySource(
  source: SessionActivityResolutionSource
): SessionSummaryDto["activitySource"] {
  if (source === "authoritative_runtime" || source === "authoritative_provider_event") {
    return "runtime";
  }

  if (source === "inferred_log") {
    return "inferred";
  }

  return "none";
}

function maxIsoTimestamp(left: string | null | undefined, right: string | null | undefined): string | null {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
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

function getSessionScopedCapabilities(
  session: SessionSummaryDto | null,
  capabilities: ProviderCapabilitiesDto | null
): ProviderCapabilitiesDto | null {
  if (!capabilities) {
    return null;
  }

  // 会话详情未到时先允许使用能力快照；一旦有 session，就只接受同 provider 的能力对象。
  if (!session || session.provider === capabilities.provider) {
    return capabilities;
  }

  return null;
}

function shouldOptimisticallyAssumeActiveRun(
  session: SessionSummaryDto | null,
  capabilities: ProviderCapabilitiesDto | null
): boolean {
  const scopedCapabilities = getSessionScopedCapabilities(session, capabilities);

  if (scopedCapabilities) {
    return Boolean(scopedCapabilities.canSendMessage);
  }

  if (!session) {
    return false;
  }

  return isRegisteredProvider(session.provider);
}

function shouldOptimisticallyEnableInterrupt(
  session: SessionSummaryDto | null,
  capabilities: ProviderCapabilitiesDto | null
): boolean {
  const scopedCapabilities = getSessionScopedCapabilities(session, capabilities);

  if (scopedCapabilities) {
    if (!scopedCapabilities.supportsInterrupt) {
      return false;
    }

    // Claude 仍保留外部推断态，避免把非当前前端持有的会话误判成可中断。
    if (session?.provider === "claude-code" && session.activitySource === "inferred") {
      return false;
    }

    return true;
  }

  if (!session) {
    return false;
  }

  if (session.provider === "codex" || session.provider === "opencode") {
    return true;
  }

  return session.provider === "claude-code" && session.activitySource !== "inferred";
}

function resolveNextRuntimeHasActiveRun(
  currentHasActiveRun: boolean | null,
  incomingRunningState: SessionRunningState,
  incomingHasActiveRun: boolean
): boolean {
  if (incomingHasActiveRun) {
    return true;
  }

  return currentHasActiveRun === true && isRuntimeActiveState(incomingRunningState);
}

function resolveNextRuntimeCanInterrupt(
  currentCanInterrupt: boolean | null,
  incomingRunningState: SessionRunningState,
  incomingHasActiveRun: boolean,
  incomingCanInterrupt: boolean
): boolean {
  if (incomingCanInterrupt) {
    return true;
  }

  return currentCanInterrupt === true && (
    incomingHasActiveRun || isRuntimeActiveState(incomingRunningState)
  );
}

function buildSessionRuntimeSnapshotKey(sessionId: string) {
  return `session-runtime.snapshot.${sessionId}`;
}

function buildSnapshotMessages(messages: SessionMessageViewModel[]): SessionMessageViewModel[] {
  return messages
    .filter((message) => message.deliveryState === "sent")
    .slice(-SNAPSHOT_HISTORY_LIMIT);
}

function upsertQueuedMessage(
  current: SessionQueueItemDto[],
  incoming: SessionQueueItemDto
): SessionQueueItemDto[] {
  const next = current.filter((item) => item.id !== incoming.id);
  next.push(incoming);
  next.sort((left, right) => left.orderIndex - right.orderIndex);
  return next;
}

function upsertPermissionRequest(
  current: SessionPermissionRequestDto[],
  incoming: SessionPermissionRequestDto
): SessionPermissionRequestDto[] {
  const next = current.filter((item) => item.id !== incoming.id);
  next.push(incoming);
  next.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "pending" ? -1 : 1;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
  return next;
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

  // 导航列表里可能会收到一个只有 updatedAt 更新、但活动证据完全没变的快照。
  // 这种快照不应该把当前本地已经确认的 running 态冲回 idle。
  if (shouldPreferActiveSessionSummary(left, right)) {
    return left;
  }

  if (shouldPreferActiveSessionSummary(right, left)) {
    return right;
  }

  const leftTimestamp = Date.parse(left.updatedAt || left.lastMessageAt || left.createdAt);
  const rightTimestamp = Date.parse(right.updatedAt || right.lastMessageAt || right.createdAt);

  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
    return right;
  }

  return leftTimestamp >= rightTimestamp ? left : right;
}

function shouldPreferActiveSessionSummary(
  candidate: SessionSummaryDto,
  incoming: SessionSummaryDto
): boolean {
  return (
    isSessionSummaryActive(candidate)
    && !isSessionSummaryActive(incoming)
    && candidate.lastEventAt === incoming.lastEventAt
    && candidate.lastMessageAt === incoming.lastMessageAt
    && candidate.completedAt === incoming.completedAt
  );
}

function isSessionSummaryActive(session: SessionSummaryDto): boolean {
  return session.activityState === "running" || isRuntimeActiveState(session.runningState);
}
