import { useSyncExternalStore } from "react";

import { authStore } from "../../auth/store/auth-store";
import { RealtimeClient } from "../../../network/realtime-client";
import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { buildScopedSnapshotKey } from "../../workbench/utils/resource-scope";
import {
  isPerfDebugEnabled,
  logPerfDebug,
  logConversationTimelineDebug,
  logSessionMessageDedupDebug,
} from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { parseMessageRichContent } from "../message-rich-content";
import {
  buildConversationTimelineSourceItems,
  type ConversationTimelineSourceItem
} from "../timeline-source-items";
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
  type SessionRuntimePermissionStatusDto,
  type SessionSummaryDto,
  type SessionRuntimeDto,
  type SessionRunningState,
  type SessionProviderConfigMode
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
  buildRuntimeOverlayKey,
  compareViewMessageOrder,
  createInitialRuntimeState,
  createPendingMessage,
  getNextOptimisticUserSequence,
  insertPendingMessage,
  markPendingAsFailed,
  mergeAuthoritativeMessages,
  mergeRuntimeOverlayMessages,
  toViewMessage,
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
const TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS = 2 * 60 * 1000;
const TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_SEQUENCE_WINDOW = 8;
const TIMELINE_INTERNAL_ATTACHMENT_DEBUG_BLOCK_PATTERN =
  /\[\[CODINGNS_IMAGE_ATTACHMENTS\]\][\s\S]*?\[\[\/CODINGNS_IMAGE_ATTACHMENTS\]\]/g;
const TIMELINE_INTERNAL_ATTACHMENT_DEBUG_TAIL_PATTERN =
  /\[\[CODINGNS_IMAGE_ATTACHMENTS\]\][\s\S]*$/g;

interface SessionRuntimeSnapshot {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
  contextUsage: ContextUsageDto | null;
  permissionStatus: SessionRuntimePermissionStatusDto | null;
  messages: SessionMessageViewModel[];
  timelineItems: ConversationTimelineSourceItem[];
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

export interface TimelineLayersState {
  authoritativeMessages: SessionMessageViewModel[];
  runtimeOverlayMessages: SessionMessageViewModel[];
  activeRuntimeOverlayKeys: string[];
  pendingMessages: SessionMessageViewModel[];
  replaceSnapshotSeedOnBackfill: boolean;
}

export type TimelineEvent =
  | {
      type: "timeline.seed";
      source: string;
      snapshotMessages: SessionMessageViewModel[];
      bootstrapMessages: HistoryMessageDto[];
      replaceSnapshotSeedOnBackfill: boolean;
    }
  | {
      type: "history.merge";
      source: string;
      messages: HistoryMessageDto[];
      replaceSnapshotSeed: boolean;
    }
  | {
      type: "runtime.message";
      source: string;
      message: SessionMessageViewModel;
    }
  | {
      type: "pending.insert";
      source: string;
      pending: SessionMessageViewModel;
    }
  | {
      type: "pending.retry";
      source: string;
      clientRequestId: string;
    }
  | {
      type: "pending.fail";
      source: string;
      clientRequestId: string;
    }
  | {
      type: "pending.resolve";
      source: string;
      clientRequestId: string;
      message: HistoryMessageDto;
    };

export interface TimelineEventResult {
  timeline: TimelineLayersState;
  previousMessages: SessionMessageViewModel[];
  messages: SessionMessageViewModel[];
  replacedSnapshotSeed: boolean;
  validationIssues: string[];
}

export class SessionRuntimeStore {
  private state: SessionRuntimeState;
  private authoritativeMessages: SessionMessageViewModel[] = [];
  private runtimeOverlayMessages: SessionMessageViewModel[] = [];
  private activeRuntimeOverlayKeys: string[] = [];
  private pendingMessages: SessionMessageViewModel[] = [];
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
      targetHostId?: string | null;
      bootstrapMessages?: HistoryMessageDto[];
      initialSession?: SessionSummaryDto | null;
      onSeen?: (sessionId: string, seenAt: string) => void;
    } = {}
  ) {
    const cachedSnapshot = readViewSnapshot<SessionRuntimeSnapshot>(
      buildSessionRuntimeSnapshotKey(sessionId, options.targetHostId),
      SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    this.hasAuthoritativeBootstrapMessages = (options.bootstrapMessages?.length ?? 0) > 0;
    const seededSession = pickFreshestSessionSummary(options.initialSession ?? null, cachedSnapshot?.session ?? null);
    const seededTimeline = applyTimelineEventToLayers(
      createEmptyTimelineLayers(),
      this.sessionId,
      {
        type: "timeline.seed",
        source: "constructor_seed",
        snapshotMessages: cachedSnapshot?.messages ?? [],
        bootstrapMessages: options.bootstrapMessages ?? [],
        replaceSnapshotSeedOnBackfill:
          !this.hasAuthoritativeBootstrapMessages
          && (cachedSnapshot?.messages.length ?? 0) > 0
          && (cachedSnapshot?.messages.length ?? 0) < REALTIME_LIMIT
          && (cachedSnapshot?.pagesLoaded ?? 0) <= 1
      }
    );
    this.authoritativeMessages = seededTimeline.timeline.authoritativeMessages;
    this.runtimeOverlayMessages = seededTimeline.timeline.runtimeOverlayMessages;
    this.activeRuntimeOverlayKeys = seededTimeline.timeline.activeRuntimeOverlayKeys;
    this.pendingMessages = seededTimeline.timeline.pendingMessages;
    this.replaceSnapshotSeedOnBackfill = seededTimeline.timeline.replaceSnapshotSeedOnBackfill;

    this.state = createInitialRuntimeState({
      session: seededSession,
      capabilities: cachedSnapshot?.capabilities ?? null,
      runtimeHasActiveRun: cachedSnapshot?.runtimeHasActiveRun ?? null,
      runtimeCanInterrupt: cachedSnapshot?.runtimeCanInterrupt ?? null,
      contextUsage: cachedSnapshot?.contextUsage ?? null,
      permissionStatus: cachedSnapshot?.permissionStatus ?? null,
      messages: seededTimeline.messages,
      timelineItems: buildConversationTimelineStateItems(
        seededSession,
        seededTimeline.messages
      ),
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
    const bootstrapTimeline = this.applyTimelineEvent({
      type: "history.merge",
      source: "initialize_bootstrap",
      messages: bootstrapMessages,
      replaceSnapshotSeed: false
    });
    const hasBootstrappedMessages = this.hasAuthoritativeBootstrapMessages;

    this.patch({
      messages: bootstrapTimeline.messages,
      historyState: resolveInitialHistoryState(
        this.state.session,
        hasBootstrappedMessages ? this.authoritativeMessages.length : 0
      ),
      loadingOlderMessages: false,
      olderCursor: hasBootstrappedMessages ? null : this.state.olderCursor,
      hasOlderMessages: resolveHasOlderMessages({
        session: this.state.session,
        loadedMessageCount: this.authoritativeMessages.length,
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
      buildSessionRuntimeSnapshotKey(this.sessionId, this.options.targetHostId),
      SESSION_RUNTIME_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    const reloadedTimeline = this.applyTimelineEvent({
      type: "timeline.seed",
      source: "reload_seed",
      snapshotMessages: cachedSnapshot?.messages ?? [],
      bootstrapMessages: this.options.bootstrapMessages ?? [],
      replaceSnapshotSeedOnBackfill:
        !this.hasAuthoritativeBootstrapMessages
        && (cachedSnapshot?.messages.length ?? 0) > 0
        && (cachedSnapshot?.messages.length ?? 0) < REALTIME_LIMIT
        && (cachedSnapshot?.pagesLoaded ?? 0) <= 1
    });
    this.state = createInitialRuntimeState({
      session: pickFreshestSessionSummary(this.options.initialSession ?? null, cachedSnapshot?.session ?? null),
      capabilities: cachedSnapshot?.capabilities ?? null,
      runtimeHasActiveRun: cachedSnapshot?.runtimeHasActiveRun ?? null,
      runtimeCanInterrupt: cachedSnapshot?.runtimeCanInterrupt ?? null,
      contextUsage: cachedSnapshot?.contextUsage ?? null,
      permissionStatus: cachedSnapshot?.permissionStatus ?? null,
      messages: reloadedTimeline.messages,
      permissionRequests: cachedSnapshot?.permissionRequests ?? [],
      queuedMessages: cachedSnapshot?.queuedMessages ?? [],
      olderCursor: cachedSnapshot?.olderCursor ?? null,
      hasOlderMessages: cachedSnapshot?.hasOlderMessages ?? false,
      lastCursor: cachedSnapshot?.lastCursor ?? null,
      pagesLoaded: cachedSnapshot?.pagesLoaded ?? 0
    });
    this.seenWatermark = this.state.session?.lastSeenAt ?? null;
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
        loadedMessageCount: this.authoritativeMessages.length,
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
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
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
      resolveNextOptimisticUserSequence(this.buildTimelineMessages("send_sequence"), this.state.session)
    );
    const pendingTimeline = this.applyTimelineEvent({
      type: "pending.insert",
      source: "send_pending",
      pending
    });

    this.patch({
      messages: pendingTimeline.messages,
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
      this.resolvePendingMessage(response.message, clientRequestId);

      this.patch({
        messages: this.buildTimelineMessages("send_resolved")
      });
    } catch (error) {
      this.failPendingReplyDebugTrace(clientRequestId, error);
      const failedTimeline = this.applyTimelineEvent({
        type: "pending.fail",
        source: "send_failed",
        clientRequestId
      });
      this.patch({
        messages: failedTimeline.messages,
        session: withRunningState(this.state.session, "failed"),
        runtimeHasActiveRun: false,
        runtimeCanInterrupt: false
      });
      throw error;
    }
  }

  async retryMessage(clientRequestId: string): Promise<void> {
    const target = this.pendingMessages.find((item) => item.clientRequestId === clientRequestId);

    if (!target) {
      return;
    }

    const retryTimeline = this.applyTimelineEvent({
      type: "pending.retry",
      source: "retry_pending",
      clientRequestId
    });
    this.patch({
      messages: retryTimeline.messages,
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
      this.resolvePendingMessage(response.message, clientRequestId);

      this.patch({
        messages: this.buildTimelineMessages("retry_resolved")
      });
    } catch (error) {
      this.failPendingReplyDebugTrace(clientRequestId, error);
      const failedTimeline = this.applyTimelineEvent({
        type: "pending.fail",
        source: "retry_failed",
        clientRequestId
      });
      this.patch({
        messages: failedTimeline.messages,
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
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
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
        attachments: options?.attachments ?? [],
        providerConfigMode: options?.providerConfigMode,
        providerPresetId: options?.providerPresetId ?? null
      }, { targetHostId: this.options.targetHostId });

      this.patch({
        queuedMessages: upsertQueuedMessage(this.state.queuedMessages, queuedItem)
      });
      await this.refreshQueue();
    } catch (error) {
      throw error;
    }
  }

  async deleteQueuedMessage(queueItemId: string): Promise<void> {
    await deleteSessionQueueItem(this.sessionId, queueItemId, { targetHostId: this.options.targetHostId });
    await this.refreshQueue();
  }

  async steerQueuedMessage(queueItemId: string): Promise<void> {
    await steerSessionQueueItem(this.sessionId, queueItemId, { targetHostId: this.options.targetHostId });
    await this.refreshRuntimeSnapshot("queue_steer");
  }

  async interrupt(): Promise<void> {
    await interruptSession(this.sessionId, { targetHostId: this.options.targetHostId });
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

    const updated = await replySessionPermissionRequest(this.sessionId, requestId, payload, {
      targetHostId: this.options.targetHostId
    });

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
      targetHostId: this.options.targetHostId,
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
            loadedMessageCount: this.authoritativeMessages.length,
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
          shouldAttemptReplaceSnapshotSeed,
          event.type === "session.backfill" ? "realtime_backfill" : "realtime_delta"
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
                  loadedMessageCount: this.authoritativeMessages.length,
                  olderCursor: this.state.olderCursor,
                  pagesLoaded: this.state.pagesLoaded,
                  currentHasOlderMessages: this.state.hasOlderMessages
                }),
          pagesLoaded:
            event.type === "session.backfill"
              ? (
                  !replacedSnapshotSeed && this.state.pagesLoaded > 1
                    ? this.state.pagesLoaded
                    : Math.max(this.state.pagesLoaded, this.authoritativeMessages.length > 0 ? 1 : 0)
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

    if (
      Object.prototype.hasOwnProperty.call(nextInput, "session")
      || Object.prototype.hasOwnProperty.call(nextInput, "messages")
    ) {
      nextInput = {
        ...nextInput,
        timelineItems: buildConversationTimelineStateItems(
          (Object.prototype.hasOwnProperty.call(nextInput, "session")
            ? nextInput.session
            : this.state.session) ?? null,
          (Object.prototype.hasOwnProperty.call(nextInput, "messages")
            ? nextInput.messages
            : this.state.messages) ?? []
        )
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
      || Object.prototype.hasOwnProperty.call(nextInput, "timelineItems")
      || Object.prototype.hasOwnProperty.call(nextInput, "permissionRequests")
      || Object.prototype.hasOwnProperty.call(nextInput, "queuedMessages")
    ) {
      this.persistSnapshot();
    }

    this.emit();
  }

  private applyTimelineEvent(event: TimelineEvent): TimelineEventResult {
    const result = applyTimelineEventToLayers(
      {
        authoritativeMessages: this.authoritativeMessages,
        runtimeOverlayMessages: this.runtimeOverlayMessages,
        activeRuntimeOverlayKeys: this.activeRuntimeOverlayKeys,
        pendingMessages: this.pendingMessages,
        replaceSnapshotSeedOnBackfill: this.replaceSnapshotSeedOnBackfill
      },
      this.sessionId,
      event
    );

    this.authoritativeMessages = result.timeline.authoritativeMessages;
    this.runtimeOverlayMessages = result.timeline.runtimeOverlayMessages;
    this.activeRuntimeOverlayKeys = result.timeline.activeRuntimeOverlayKeys;
    this.pendingMessages = result.timeline.pendingMessages;
    this.replaceSnapshotSeedOnBackfill = result.timeline.replaceSnapshotSeedOnBackfill;
    const assistantMoves = collectTimelineMessageMoves(
      result.previousMessages,
      result.messages,
      "assistant"
    );
    const eventMessages = extractTimelineEventMessages(event);
    const shouldLogEvent =
      result.validationIssues.length > 0
      || eventMessages.some((message) => message.role === "assistant")
      || assistantMoves.length > 0;

    if (shouldLogEvent) {
      logConversationTimelineDebug("timeline.event", {
        sessionId: this.sessionId,
        eventType: event.type,
        source: event.source,
        replacedSnapshotSeed: result.replacedSnapshotSeed,
        validationIssues: result.validationIssues,
        authoritativeCount: this.authoritativeMessages.length,
        runtimeOverlayCount: this.runtimeOverlayMessages.length,
        pendingCount: this.pendingMessages.length,
        eventMessages: eventMessages.map((message) => summarizeOrderDebugMessage(message)),
        assistantMoves,
        previousTail: summarizeOrderDebugMessages(result.previousMessages.slice(-6)),
        nextTail: summarizeOrderDebugMessages(result.messages.slice(-6))
      });
    }

    return result;
  }

  private mergeHistoryMessages(
    incoming: HistoryMessageDto[],
    replaceSnapshotSeed: boolean,
    source: string
  ): { messages: SessionMessageViewModel[]; replacedSnapshotSeed: boolean } {
    const result = this.applyTimelineEvent({
      type: "history.merge",
      source,
      messages: incoming,
      replaceSnapshotSeed
    });

    this.logCodexMergeDebug(
      source,
      result.previousMessages,
      incoming,
      result.messages,
      {
        replacedSnapshotSeedAttempted: replaceSnapshotSeed,
        replacedSnapshotSeed: result.replacedSnapshotSeed,
        baseMessageCount:
          result.replacedSnapshotSeed ? 0 : result.previousMessages.length
      }
    );

    return {
      messages: result.messages,
      replacedSnapshotSeed: result.replacedSnapshotSeed
    };
  }

  private buildTimelineMessages(reason: string): SessionMessageViewModel[] {
    void reason;

    return deriveTimelineMessages(
      {
        authoritativeMessages: this.authoritativeMessages,
        runtimeOverlayMessages: this.runtimeOverlayMessages,
        activeRuntimeOverlayKeys: this.activeRuntimeOverlayKeys,
        pendingMessages: this.pendingMessages,
        replaceSnapshotSeedOnBackfill: this.replaceSnapshotSeedOnBackfill
      }
    );
  }

  private clearActiveRuntimeTail(reason: string): void {
    if (this.activeRuntimeOverlayKeys.length === 0) {
      return;
    }

    this.activeRuntimeOverlayKeys = [];
    const messages = this.buildTimelineMessages(reason);
    this.patch({ messages });
  }

  private resolvePendingMessage(
    message: HistoryMessageDto,
    clientRequestId: string
  ): void {
    this.applyTimelineEvent({
      type: "pending.resolve",
      source: "pending_resolved",
      clientRequestId,
      message
    });
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
      void markSessionSeen(this.sessionId, { targetHostId: this.options.targetHostId })
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
        Math.max(REALTIME_LIMIT, this.authoritativeMessages.length, INITIAL_HISTORY_LIMIT)
      );
      const page = await getSessionMessages(
        this.sessionId,
        null,
        fallbackLimit,
        "backward",
        { targetHostId: this.options.targetHostId }
      );

      if (this.historyBootstrapEnvelopeReceived) {
        return;
      }

      this.historyBootstrapEnvelopeReceived = true;
      const { messages: merged, replacedSnapshotSeed } = this.mergeHistoryMessages(
        page.messages,
        this.replaceSnapshotSeedOnBackfill,
        "http_bootstrap_fallback"
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
                loadedMessageCount: this.authoritativeMessages.length,
                olderCursor: page.nextCursor,
                pagesLoaded: this.state.pagesLoaded,
                currentHasOlderMessages: this.state.hasOlderMessages
              }),
        lastCursor: page.cursor ?? this.state.lastCursor,
        pagesLoaded:
          !replacedSnapshotSeed && this.state.pagesLoaded > 1
            ? this.state.pagesLoaded
            : (
                this.authoritativeMessages.length > 0
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
    const { messages: merged } = this.mergeHistoryMessages(
      page.messages,
      false,
      source === "realtime" ? "older_history_realtime" : "older_history_prefetch_cache"
    );

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
      "backward",
      { targetHostId: this.options.targetHostId }
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
      const runtime = await getSessionRuntime(this.sessionId, { targetHostId: this.options.targetHostId });
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
        permissionStatus: runtime.permissionStatus,
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
        getSessionDetail(this.sessionId, { targetHostId: this.options.targetHostId })
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
        getSessionCapabilities(this.sessionId, { targetHostId: this.options.targetHostId })
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
      const response = await getSessionPermissionRequests(this.sessionId, {
        targetHostId: this.options.targetHostId
      });

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
    return this.state.contextUsage === null
      || shouldRefreshRuntimeActivity(
        this.state.session,
        this.state.runtimeHasActiveRun,
        this.state.runtimeCanInterrupt
      );
  }

  private async refreshRuntimeSnapshot(reason: string): Promise<void> {
    logPerfDebug("session_runtime.snapshot.start", {
      sessionId: this.sessionId,
      reason
    });

    try {
      const runtime = await getSessionRuntime(this.sessionId, { targetHostId: this.options.targetHostId });
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
        permissionStatus: runtime.permissionStatus,
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
      const response = await getSessionQueue(this.sessionId, { targetHostId: this.options.targetHostId });
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
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
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
        attachments: options?.attachments ?? [],
        providerConfigMode: options?.providerConfigMode,
        providerPresetId: options?.providerPresetId ?? null
      }, { targetHostId: this.options.targetHostId });
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
      }, { targetHostId: this.options.targetHostId });
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
      this.clearActiveRuntimeTail("runtime_status_terminal");
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
      this.clearActiveRuntimeTail("activity_terminal");
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
    const mergedResult = this.applyTimelineEvent({
      type: "runtime.message",
      source: event.source,
      message: toViewMessage(this.sessionId, event.message)
    });
    const merged = mergedResult.messages;

    this.logCodexMergeDebug(
      "runtime_message",
      mergedResult.previousMessages,
      [event.message],
      merged,
      {
        runtimeSource: event.source
      }
    );

    this.patch({
      messages: merged,
      historyState: "ready",
      hasOlderMessages: resolveHasOlderMessages({
        session: this.state.session,
        loadedMessageCount: this.authoritativeMessages.length,
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
    writeViewSnapshot<SessionRuntimeSnapshot>(buildSessionRuntimeSnapshotKey(this.sessionId, this.options.targetHostId), {
      session: this.state.session,
      capabilities: this.state.capabilities,
      runtimeHasActiveRun: this.state.runtimeHasActiveRun,
      runtimeCanInterrupt: this.state.runtimeCanInterrupt,
      contextUsage: this.state.contextUsage,
      permissionStatus: this.state.permissionStatus,
      messages: buildSnapshotMessages(this.authoritativeMessages),
      timelineItems: buildConversationTimelineStateItems(
        this.state.session,
        buildSnapshotMessages(this.authoritativeMessages)
      ),
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

  private logCodexMergeDebug(
    source: string,
    before: SessionMessageViewModel[],
    incoming: HistoryMessageDto[],
    after: SessionMessageViewModel[],
    extra: Record<string, unknown> = {}
  ): void {
    const codexIncoming = incoming.filter(isCodexAssistantOrToolHistoryMessage);

    if (codexIncoming.length === 0) {
      return;
    }

    const beforeDuplicates = collectCodexDuplicateDebugGroups(before);
    const afterDuplicates = collectCodexDuplicateDebugGroups(after);

    logSessionMessageDedupDebug("session.messages.merge", {
      sessionId: this.sessionId,
      source,
      beforeCount: before.length,
      incomingCount: incoming.length,
      afterCount: after.length,
      incoming: codexIncoming.slice(0, 5).map(summarizeHistoryMessageForDebug),
      beforeDuplicateGroupCount: beforeDuplicates.length,
      afterDuplicateGroupCount: afterDuplicates.length,
      afterDuplicateGroups: afterDuplicates.slice(0, 3),
      ...extra
    });
  }
}

function createEmptyTimelineLayers(): TimelineLayersState {
  return {
    authoritativeMessages: [],
    runtimeOverlayMessages: [],
    activeRuntimeOverlayKeys: [],
    pendingMessages: [],
    replaceSnapshotSeedOnBackfill: false
  };
}

function mergeAuthoritativeWithRuntimeOverlay(
  authoritative: SessionMessageViewModel[],
  runtimeOverlay: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const nextById = new Map<string, SessionMessageViewModel>();
  const authoritativeMessageIds = new Set<string>();

  for (const item of authoritative) {
    nextById.set(item.id, item);
    authoritativeMessageIds.add(item.id);
  }

  for (const message of runtimeOverlay) {
    const currentMessage = nextById.get(message.id) ?? null;
    const preferredEquivalentMessageId = findPreferredTimelineEquivalentMessageId(
      nextById,
      authoritativeMessageIds,
      message,
      currentMessage
    );

    if (preferredEquivalentMessageId) {
      const preferredEquivalentMessage = nextById.get(preferredEquivalentMessageId) ?? null;

      if (preferredEquivalentMessage) {
        logSessionMessageDedupDebug("session.messages.runtime_overlay_authoritative_bridge", {
          mode: "prefer_equivalent",
          previous: summarizeTimelineBridgeMessageForDebug(preferredEquivalentMessage),
          overlay: summarizeTimelineBridgeMessageForDebug(message),
          replacedSameId: currentMessage ? summarizeTimelineBridgeMessageForDebug(currentMessage) : null
        });
        nextById.set(
          preferredEquivalentMessageId,
          mergeTimelineBridgePreservingIdentity(preferredEquivalentMessage, message)
        );
        continue;
      }
    }

    if (currentMessage) {
      logSessionMessageDedupDebug("session.messages.runtime_overlay_authoritative_bridge", {
        mode: "same_id",
        previous: summarizeTimelineBridgeMessageForDebug(currentMessage),
        overlay: summarizeTimelineBridgeMessageForDebug(message)
      });
      nextById.set(message.id, mergeTimelineBridgePreservingIdentity(currentMessage, message));
      continue;
    }

    const equivalentCodexMessageId = findMatchingTimelineEquivalentCodexMessageId(
      nextById,
      authoritativeMessageIds,
      message
    );

    if (equivalentCodexMessageId) {
      const equivalentCodexMessage = nextById.get(equivalentCodexMessageId) ?? null;

      if (equivalentCodexMessage) {
        logSessionMessageDedupDebug("session.messages.runtime_overlay_authoritative_bridge", {
          mode: "codex_compat",
          previous: summarizeTimelineBridgeMessageForDebug(equivalentCodexMessage),
          overlay: summarizeTimelineBridgeMessageForDebug(message)
        });
        nextById.set(
          equivalentCodexMessageId,
          mergeTimelineBridgePreservingIdentity(equivalentCodexMessage, message)
        );
        continue;
      }
    }

    const equivalentOpenCodeMessageId = findMatchingTimelineEquivalentOpenCodeMessageId(
      nextById,
      message
    );

    if (
      equivalentOpenCodeMessageId
      && authoritativeMessageIds.has(equivalentOpenCodeMessageId)
    ) {
      const equivalentOpenCodeMessage = nextById.get(equivalentOpenCodeMessageId) ?? null;

      if (equivalentOpenCodeMessage) {
        logSessionMessageDedupDebug("session.messages.runtime_overlay_authoritative_bridge", {
          mode: "opencode_compat",
          previous: summarizeTimelineBridgeMessageForDebug(equivalentOpenCodeMessage),
          overlay: summarizeTimelineBridgeMessageForDebug(message)
        });
        if (isTimelineEquivalentOpenCodeToolMessage(equivalentOpenCodeMessage, message)) {
          nextById.set(
            equivalentOpenCodeMessageId,
            mergeTimelineEquivalentAuthoritativeVersion(equivalentOpenCodeMessage, message)
          );
          continue;
        }

        nextById.set(
          equivalentOpenCodeMessageId,
          mergeTimelineEquivalentAuthoritativeVersion(equivalentOpenCodeMessage, message)
        );
        continue;
      }
    }

    logSessionMessageDedupDebug("session.messages.runtime_overlay_authoritative_bridge", {
      mode: "insert",
      overlay: summarizeTimelineBridgeMessageForDebug(message)
    });
    nextById.set(message.id, message);
  }

  return sortTimelineBridgeMessagesByOrder(Array.from(nextById.values()));
}

function mergeTimelineBridgePreservingIdentity(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  const merged = mergeTimelineBridgeAuthoritativeVersion(current, {
    ...incoming,
    id: current.id,
    clientRequestId: current.clientRequestId ?? incoming.clientRequestId
  });

  return {
    ...merged,
    id: current.id,
    rawRef: current.rawRef,
    timestamp: current.timestamp,
    sequence: current.sequence,
    clientRequestId: current.clientRequestId ?? incoming.clientRequestId
  };
}

function mergeTimelineBridgeAuthoritativeVersion(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (current.id !== incoming.id) {
    return incoming;
  }

  if (isTimelineEquivalentToolLifecycleMessage(current, incoming)) {
    const mergedToolCall = mergeTimelineBridgeToolCall(current.toolCall, incoming.toolCall);
    const content = pickTimelineToolLifecycleMessageContent(
      current,
      incoming,
      mergedToolCall,
      pickTimelineBridgePreferredContent
    );
    const attachments = pickTimelineBridgePreferredAttachments(
      current.attachments,
      incoming.attachments
    );
    const stableAnchor = pickTimelineBridgeStableAuthoritativeMessage(current, incoming);
    const preferred = pickTimelineBridgeNewerAuthoritativeMessage(current, incoming);

    return {
      ...preferred,
      kind: mergedToolCall?.status === "running" ? "tool_call" : "tool_result",
      content,
      toolCall: mergedToolCall,
      attachments,
      attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
      rawRef: stableAnchor.rawRef,
      timestamp: stableAnchor.timestamp,
      sequence: stableAnchor.sequence
    };
  }

  if (current.role !== incoming.role || current.kind !== incoming.kind) {
    return pickTimelineBridgeNewerAuthoritativeMessage(current, incoming);
  }

  const mergedToolCall = mergeTimelineBridgeToolCall(current.toolCall, incoming.toolCall);
  const content =
    isTimelineCodexAuthoritativeMessage(current) && isTimelineCodexAuthoritativeMessage(incoming)
      ? pickTimelineBridgePreferredCodexEquivalentContent(current, incoming)
      : pickTimelineBridgePreferredContent(
          current.content,
          incoming.content,
          current.timestamp,
          incoming.timestamp
        );
  const attachments = pickTimelineBridgePreferredAttachments(
    current.attachments,
    incoming.attachments
  );
  const stableAnchor = pickTimelineBridgeStableAuthoritativeMessage(current, incoming);

  return {
    ...pickTimelineBridgeNewerAuthoritativeMessage(current, incoming),
    content,
    toolCall: mergedToolCall,
    attachments,
    attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
    rawRef: stableAnchor.rawRef,
    timestamp: stableAnchor.timestamp,
    sequence: stableAnchor.sequence
  };
}

function mergeTimelineEquivalentAuthoritativeVersion(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (isTimelineEquivalentToolLifecycleMessage(current, incoming)) {
    const mergedToolCall = mergeTimelineBridgeToolCall(current.toolCall, incoming.toolCall);
    const content = pickTimelineToolLifecycleMessageContent(
      current,
      incoming,
      mergedToolCall,
      pickTimelineBridgePreferredContent
    );
    const attachments = pickTimelineBridgePreferredAttachments(
      current.attachments,
      incoming.attachments
    );
    const stableAnchor = pickTimelineBridgeStableAuthoritativeMessage(current, incoming);
    const preferred = pickTimelineBridgeNewerAuthoritativeMessage(current, incoming);

    return {
      ...preferred,
      id: current.id,
      kind: mergedToolCall?.status === "running" ? "tool_call" : "tool_result",
      content,
      toolCall: mergedToolCall,
      attachments,
      attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
      rawRef: stableAnchor.rawRef,
      timestamp: stableAnchor.timestamp,
      sequence: stableAnchor.sequence,
      clientRequestId: current.clientRequestId ?? incoming.clientRequestId
    };
  }

  if (current.role !== incoming.role || current.kind !== incoming.kind) {
    const preferred = pickTimelineBridgeNewerAuthoritativeMessage(current, incoming);
    return {
      ...preferred,
      id: current.id,
      clientRequestId: current.clientRequestId ?? incoming.clientRequestId
    };
  }

  const mergedToolCall = mergeTimelineBridgeToolCall(current.toolCall, incoming.toolCall);
  const content =
    isTimelineCodexAuthoritativeMessage(current) && isTimelineCodexAuthoritativeMessage(incoming)
      ? pickTimelineBridgePreferredCodexEquivalentContent(current, incoming)
      : pickTimelineBridgePreferredContent(
          current.content,
          incoming.content,
          current.timestamp,
          incoming.timestamp
        );
  const attachments = pickTimelineBridgePreferredAttachments(
    current.attachments,
    incoming.attachments
  );
  const stableAnchor = pickTimelineBridgeStableAuthoritativeMessage(current, incoming);

  return {
    ...pickTimelineBridgeNewerAuthoritativeMessage(current, incoming),
    id: current.id,
    content,
    toolCall: mergedToolCall,
    attachments,
    attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
    rawRef: stableAnchor.rawRef,
    timestamp: stableAnchor.timestamp,
    sequence: stableAnchor.sequence,
    clientRequestId: current.clientRequestId ?? incoming.clientRequestId
  };
}

function isTimelineEquivalentToolLifecycleMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  return isTimelineEquivalentOpenCodeToolMessage(current, incoming)
    || isTimelineEquivalentCodexToolMessage(current, incoming);
}

function pickTimelineToolLifecycleMessageContent(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel,
  mergedToolCall: SessionMessageViewModel["toolCall"],
  fallback: (
    currentContent: string,
    incomingContent: string,
    currentTimestamp: string,
    incomingTimestamp: string
  ) => string
): string {
  if (mergedToolCall?.status === "running") {
    if (incoming.kind === "tool_call" && incoming.content) {
      return incoming.content;
    }

    if (current.kind === "tool_call" && current.content) {
      return current.content;
    }
  } else {
    if (incoming.kind === "tool_result" && incoming.content) {
      return incoming.content;
    }

    if (current.kind === "tool_result" && current.content) {
      return current.content;
    }

    if (mergedToolCall?.output) {
      return mergedToolCall.output;
    }
  }

  return fallback(current.content, incoming.content, current.timestamp, incoming.timestamp);
}

function findMatchingTimelineEquivalentCodexMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  candidateMessageIds: Set<string>,
  incoming: SessionMessageViewModel
): string | null {
  if (!isTimelineCodexAuthoritativeMessage(incoming)) {
    return null;
  }

  for (const [messageId, current] of messagesById.entries()) {
    if (
      messageId === incoming.id
      || !candidateMessageIds.has(messageId)
      || !isCompatibleTimelineCodexIdentityBridgeMessage(current, incoming)
    ) {
      continue;
    }

    logSessionMessageDedupDebug("session.messages.codex_identity_bridge_match", {
      previous: summarizeTimelineBridgeMessageForDebug(current),
      incoming: summarizeTimelineBridgeMessageForDebug(incoming)
    });
    return messageId;
  }

  return null;
}

function isCompatibleTimelineCodexIdentityBridgeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (!isTimelineEquivalentCodexAuthoritativeMessage(current, incoming)) {
    return false;
  }

  if (current.rawRef === incoming.rawRef) {
    return true;
  }

  if (current.kind === "tool_call" || current.kind === "tool_result") {
    return isTimelineEquivalentCodexToolMessage(current, incoming);
  }

  const currentStore = extractTimelineCodexRawRefStore(current.rawRef);
  const incomingStore = extractTimelineCodexRawRefStore(incoming.rawRef);

  if (!currentStore || !incomingStore || currentStore !== incomingStore) {
    return false;
  }

  const sequenceDistance = Math.abs(current.sequence - incoming.sequence);

  if (sequenceDistance > 1) {
    logSessionMessageDedupDebug("session.messages.codex_identity_bridge_rejected", {
      reason: "sequence_distance",
      sequenceDistance,
      previous: summarizeTimelineBridgeMessageForDebug(current),
      incoming: summarizeTimelineBridgeMessageForDebug(incoming)
    });
    return false;
  }

  return true;
}

function findMatchingTimelineEquivalentOpenCodeMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel
): string | null {
  if (!isTimelineOpenCodeAuthoritativeMessage(incoming)) {
    return null;
  }

  const incomingIdentity = extractTimelineEquivalentOpenCodeRawRefIdentity(incoming.rawRef);

  if (incomingIdentity === null) {
    return null;
  }

  const incomingTimestampMs = toTimelineBridgeTimestampMs(incoming.timestamp);
  let matchedId: string | null = null;
  let matchedScore = Number.POSITIVE_INFINITY;

  for (const [messageId, current] of messagesById.entries()) {
    if (
      messageId === incoming.id
      || !isTimelineOpenCodeAuthoritativeMessage(current)
      || current.role !== incoming.role
    ) {
      continue;
    }

    if (isTimelineEquivalentOpenCodeToolMessage(current, incoming)) {
      return messageId;
    }

    if (current.kind !== incoming.kind) {
      continue;
    }

    const currentIdentity = extractTimelineEquivalentOpenCodeRawRefIdentity(current.rawRef);

    if (currentIdentity !== incomingIdentity) {
      continue;
    }

    const currentTimestampMs = toTimelineBridgeTimestampMs(current.timestamp);
    const timestampDistance = Math.abs(currentTimestampMs - incomingTimestampMs);
    const sequenceDistance = Math.abs(current.sequence - incoming.sequence);
    const score = sequenceDistance * 60_000 + timestampDistance;

    if (score < matchedScore) {
      matchedId = messageId;
      matchedScore = score;
    }
  }

  return matchedId;
}

function shouldSuppressTimelineRuntimeEchoUserMessage(
  timeline: TimelineLayersState,
  incoming: SessionMessageViewModel,
  sessionId: string
): boolean {
  if (!isTimelineUserTextMessage(incoming)) {
    return false;
  }

  const authoritativeMatch = findMatchingTimelineUserMessage(
    timeline.authoritativeMessages,
    incoming,
    "authoritative",
    sessionId
  );

  if (authoritativeMatch) {
    logSessionMessageDedupDebug("session.messages.runtime_user_echo_suppressed", {
      sessionId,
      target: "authoritative",
      matched: summarizeTimelineBridgeMessageForDebug(authoritativeMatch),
      incoming: summarizeTimelineBridgeMessageForDebug(incoming)
    });
    return true;
  }

  const pendingMatch = findMatchingTimelineUserMessage(
    timeline.pendingMessages,
    incoming,
    "pending",
    sessionId
  );

  if (pendingMatch) {
    logSessionMessageDedupDebug("session.messages.runtime_user_echo_suppressed", {
      sessionId,
      target: "pending",
      matched: summarizeTimelineBridgeMessageForDebug(pendingMatch),
      incoming: summarizeTimelineBridgeMessageForDebug(incoming)
    });
    return true;
  }

  return false;
}

function findMatchingTimelineUserMessage(
  candidates: SessionMessageViewModel[],
  incoming: SessionMessageViewModel,
  target: "authoritative" | "pending",
  sessionId: string
): SessionMessageViewModel | null {
  const incomingTimestampMs = toTimelineBridgeTimestampMs(incoming.timestamp);
  const comparableIncomingContent = normalizeTimelineComparableCodexText(incoming.content);
  const relaxedIncomingContent = normalizeTimelineComparableUserMergeText(incoming.content);
  const incomingAttachmentSignature = buildTimelineComparableMessageAttachmentSignature(incoming);
  let matched: SessionMessageViewModel | null = null;
  let matchedScore = Number.POSITIVE_INFINITY;
  const debugCandidates: Array<Record<string, unknown>> = [];

  for (const current of candidates) {
    const matchesTarget =
      target === "authoritative"
        ? isTimelineAuthoritativeUserTextMessage(current)
        : isTimelinePendingUserMessage(current);

    if (!matchesTarget) {
      continue;
    }

    const comparableCurrentContent = normalizeTimelineComparableCodexText(current.content);
    const relaxedCurrentContent = normalizeTimelineComparableUserMergeText(current.content);
    const strictTextMatches = comparableCurrentContent === comparableIncomingContent;
    const relaxedTextMatches = relaxedCurrentContent === relaxedIncomingContent;

    if (!strictTextMatches && !relaxedTextMatches) {
      continue;
    }

    const currentTimestampMs = toTimelineBridgeTimestampMs(current.timestamp);
    const distance = Math.abs(currentTimestampMs - incomingTimestampMs);

    if (distance > 5 * 60 * 1000) {
      continue;
    }

    const sequenceDistance = Math.abs(current.sequence - incoming.sequence);
    const currentAttachmentSignature = buildTimelineComparableMessageAttachmentSignature(current);
    const attachmentCompatibility = resolveTimelineAttachmentCompatibility(
      currentAttachmentSignature,
      incomingAttachmentSignature
    );

    debugCandidates.push(
      summarizeTimelineUserMatchCandidate(current, {
        strictTextMatches,
        relaxedTextMatches,
        attachmentCompatibility,
        distanceMs: distance,
        sequenceDistance
      })
    );

    if (
      attachmentCompatibility === "conflict"
      && (strictTextMatches || comparableIncomingContent.length === 0)
    ) {
      continue;
    }

    const score =
      distance
      + sequenceDistance * 15_000
      + (strictTextMatches ? 0 : 500)
      + resolveTimelineAttachmentPenalty(attachmentCompatibility);

    if (score < matchedScore) {
      matched = current;
      matchedScore = score;
    }
  }

  if (debugCandidates.length > 0) {
    logSessionMessageDedupDebug("session.messages.runtime_user_match", {
      sessionId,
      target,
      matchedId: matched?.id ?? null,
      matchedScore: Number.isFinite(matchedScore) ? matchedScore : null,
      incoming: summarizeTimelineUserMatchInput(incoming, {
        relaxedContent: relaxedIncomingContent,
        attachmentSignature: incomingAttachmentSignature
      }),
      candidates: debugCandidates.slice(0, 5)
    });
  }

  return matched;
}

function didHistoryMergeIntroduceNewAuthoritativeUserMessage(
  currentAuthoritativeMessages: SessionMessageViewModel[],
  incomingMessages: HistoryMessageDto[],
  sessionId: string
): boolean {
  for (const message of incomingMessages) {
    if (message.role !== "user" || message.kind !== "text") {
      continue;
    }

    const incomingViewMessage = toViewMessage(sessionId, message, "sent", null);
    const matched = findMatchingTimelineUserMessage(
      currentAuthoritativeMessages,
      incomingViewMessage,
      "authoritative",
      sessionId
    );

    if (!matched) {
      return true;
    }
  }

  return false;
}

function removeResolvedPendingMessages(
  pendingMessages: SessionMessageViewModel[],
  incomingMessages: HistoryMessageDto[],
  sessionId: string
): SessionMessageViewModel[] {
  if (pendingMessages.length === 0 || incomingMessages.length === 0) {
    return pendingMessages;
  }

  const resolvedPendingIds = new Set<string>();

  for (const message of incomingMessages) {
    if (message.role !== "user" || message.kind !== "text") {
      continue;
    }

    const incomingViewMessage = toViewMessage(sessionId, message, "sent", null);
    const matched = findMatchingTimelineUserMessage(
      pendingMessages.filter((item) => !resolvedPendingIds.has(item.id)),
      incomingViewMessage,
      "pending",
      sessionId
    );

    if (matched) {
      resolvedPendingIds.add(matched.id);
    }
  }

  if (resolvedPendingIds.size === 0) {
    return pendingMessages;
  }

  return pendingMessages.filter((message) => !resolvedPendingIds.has(message.id));
}

function mergeTimelineBridgeToolCall(
  current: SessionMessageViewModel["toolCall"],
  incoming: SessionMessageViewModel["toolCall"]
): SessionMessageViewModel["toolCall"] {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  const preferred = pickTimelineBridgeHigherPriorityToolCall(current, incoming);

  return {
    ...preferred,
    input: pickTimelineBridgeLongerText(current.input, incoming.input),
    output: pickTimelineBridgeLongerNullableText(current.output, incoming.output),
    error: pickTimelineBridgeLongerNullableText(current.error, incoming.error)
  };
}

function pickTimelineBridgeHigherPriorityToolCall(
  current: NonNullable<SessionMessageViewModel["toolCall"]>,
  incoming: NonNullable<SessionMessageViewModel["toolCall"]>
): NonNullable<SessionMessageViewModel["toolCall"]> {
  const currentPriority = current.status === "running" ? 0 : 1;
  const incomingPriority = incoming.status === "running" ? 0 : 1;

  if (incomingPriority !== currentPriority) {
    return incomingPriority > currentPriority ? incoming : current;
  }

  return incoming;
}

function pickTimelineBridgePreferredContent(
  current: string,
  incoming: string,
  currentTimestamp: string,
  incomingTimestamp: string
): string {
  const normalizedCurrent = normalizeTimelineComparableCodexText(current);
  const normalizedIncoming = normalizeTimelineComparableCodexText(incoming);

  if (normalizedCurrent === normalizedIncoming) {
    return current.length >= incoming.length ? current : incoming;
  }

  if (
    normalizedCurrent.length > normalizedIncoming.length
    && normalizedCurrent.includes(normalizedIncoming)
  ) {
    return current;
  }

  if (
    normalizedIncoming.length > normalizedCurrent.length
    && normalizedIncoming.includes(normalizedCurrent)
  ) {
    return incoming;
  }

  return incomingTimestamp.localeCompare(currentTimestamp) >= 0 ? incoming : current;
}

function pickTimelineBridgePreferredCodexEquivalentContent(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): string {
  const currentContent = parseMessageRichContent(current.content);
  const incomingContent = parseMessageRichContent(incoming.content);
  const foldedAssistantContent = foldTimelineDuplicatedCodexAssistantTailText(
    current,
    incoming,
    normalizeTimelineComparableCodexText(currentContent.text),
    normalizeTimelineComparableCodexText(incomingContent.text)
  );

  if (foldedAssistantContent !== null) {
    return foldedAssistantContent;
  }

  return pickTimelineBridgePreferredContent(
    current.content,
    incoming.content,
    current.timestamp,
    incoming.timestamp
  );
}

function foldTimelineDuplicatedCodexAssistantTailText(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel,
  comparableLeftText: string,
  comparableRightText: string
): string | null {
  if (
    left.role !== "assistant"
    || right.role !== "assistant"
    || left.kind !== "text"
    || right.kind !== "text"
  ) {
    return null;
  }

  const leftFoldedText = removeTimelineRepeatedTrailingText(comparableLeftText);
  const rightFoldedText = removeTimelineRepeatedTrailingText(comparableRightText);

  if (
    leftFoldedText === comparableLeftText
    && rightFoldedText === comparableRightText
  ) {
    return null;
  }

  if (leftFoldedText === rightFoldedText) {
    if (comparableLeftText === leftFoldedText) {
      return left.content;
    }

    if (comparableRightText === rightFoldedText) {
      return right.content;
    }

    return leftFoldedText;
  }

  if (rightFoldedText.length >= 80 && comparableLeftText === rightFoldedText) {
    return left.content;
  }

  if (leftFoldedText.length >= 80 && comparableRightText === leftFoldedText) {
    return right.content;
  }

  return null;
}

function removeTimelineRepeatedTrailingText(content: string): string {
  const normalized = content.trimEnd();
  const candidateStarts = collectTimelineTrailingRepeatCandidateStarts(normalized);

  for (const start of candidateStarts) {
    const tail = normalized.slice(start);
    const beforeTail = normalized.slice(0, start).trimEnd();

    if (beforeTail.endsWith(tail)) {
      return beforeTail;
    }
  }

  return normalized;
}

function collectTimelineTrailingRepeatCandidateStarts(content: string): number[] {
  const minRepeatLength = 80;
  const minStart = Math.ceil(content.length / 2);
  const starts: number[] = [];

  for (
    let index = content.indexOf("\n\n");
    index >= 0;
    index = content.indexOf("\n\n", index + 2)
  ) {
    const start = index + 2;

    if (content.length - start >= minRepeatLength) {
      starts.push(start);
    }
  }

  for (let index = content.indexOf("\n", minStart); index >= 0; index = content.indexOf("\n", index + 1)) {
    const start = index + 1;

    if (content.length - start >= minRepeatLength) {
      starts.push(start);
    }
  }

  if (content.length - minStart >= minRepeatLength) {
    starts.push(minStart);
  }

  return starts.sort((left, right) => left - right);
}

function pickTimelineBridgePreferredAttachments(
  current: SessionMessageViewModel["attachments"],
  incoming: SessionMessageViewModel["attachments"]
): SessionMessageViewModel["attachments"] {
  const currentCount = current?.length ?? 0;
  const incomingCount = incoming?.length ?? 0;

  if (incomingCount !== currentCount) {
    return incomingCount > currentCount ? incoming : current;
  }

  return incoming ?? current;
}

function pickTimelineBridgeLongerText(current: string, incoming: string): string {
  return incoming.length > current.length ? incoming : current;
}

function pickTimelineBridgeLongerNullableText(
  current: string | null,
  incoming: string | null
): string | null {
  if (current === null) {
    return incoming;
  }

  if (incoming === null) {
    return current;
  }

  return pickTimelineBridgeLongerText(current, incoming);
}

function pickTimelineBridgeNewerAuthoritativeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (incoming.timestamp !== current.timestamp) {
    return incoming.timestamp.localeCompare(current.timestamp) >= 0 ? incoming : current;
  }

  if (incoming.sequence !== current.sequence) {
    return incoming.sequence >= current.sequence ? incoming : current;
  }

  return incoming;
}

function pickTimelineBridgeStableAuthoritativeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): Pick<SessionMessageViewModel, "timestamp" | "sequence" | "rawRef"> {
  return compareViewMessageOrder(current, incoming) <= 0 ? current : incoming;
}

function normalizeTimelineComparableCodexText(content: string): string {
  return content
    .replace(TIMELINE_INTERNAL_ATTACHMENT_DEBUG_BLOCK_PATTERN, "")
    .replace(TIMELINE_INTERNAL_ATTACHMENT_DEBUG_TAIL_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

function normalizeTimelineComparableUserMergeText(content: string): string {
  return normalizeTimelineComparableCodexText(content)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function sortTimelineBridgeMessagesByOrder(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  return collapseTimelineEquivalentCodexImageUserMessages(
    [...messages].sort((left, right) => compareViewMessageOrder(left, right))
  );
}

function collapseTimelineEquivalentCodexImageUserMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    const previous = collapsed.at(-1);

    if (!previous || !isTimelineEquivalentCodexImageUserMessage(previous, message)) {
      collapsed.push(message);
      continue;
    }

    collapsed[collapsed.length - 1] = pickTimelinePreferredCodexImageUserMessage(previous, message);
  }

  return collapsed;
}

function isTimelineEquivalentCodexImageUserMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (!isTimelineCodexImageUserTextMessage(left) || !isTimelineCodexImageUserTextMessage(right)) {
    return false;
  }

  const leftContent = parseMessageRichContent(left.content);
  const rightContent = parseMessageRichContent(right.content);

  return (
    areTimelineTimestampsNearWithinWindow(left.timestamp, right.timestamp, 2 * 60 * 1000)
    && normalizeTimelineComparableUserMergeText(leftContent.text)
      === normalizeTimelineComparableUserMergeText(rightContent.text)
    && areTimelineEquivalentInlineImages(leftContent.inlineImages, rightContent.inlineImages)
  );
}

function isTimelineCodexImageUserTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("codex://")
    && message.role === "user"
    && message.kind === "text"
    && !isTimelinePendingUserMessage(message)
    && countTimelineImageAttachmentEvidence(message) > 0
  );
}

function pickTimelinePreferredCodexImageUserMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
  const leftAttachmentCount = countTimelineImageAttachmentEvidence(left);
  const rightAttachmentCount = countTimelineImageAttachmentEvidence(right);

  if (leftAttachmentCount !== rightAttachmentCount) {
    return leftAttachmentCount > rightAttachmentCount ? left : right;
  }

  const leftContentLength = normalizeTimelineComparableUserMergeText(left.content).length;
  const rightContentLength = normalizeTimelineComparableUserMergeText(right.content).length;

  if (leftContentLength !== rightContentLength) {
    return leftContentLength <= rightContentLength ? left : right;
  }

  return compareViewMessageOrder(left, right) <= 0 ? left : right;
}

function countTimelineImageAttachmentEvidence(message: SessionMessageViewModel): number {
  const persistedCount = (message.attachments ?? []).filter((attachment) => attachment.kind === "image").length;
  const payloadCount = (message.attachmentPayloads ?? []).filter((attachment) => attachment.kind === "image").length;
  const inlineImageCount = parseMessageRichContent(message.content).inlineImages.length;

  return persistedCount + payloadCount + inlineImageCount;
}

function isTimelineCodexAuthoritativeMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("codex://")
    && (message.role === "assistant" || message.role === "tool")
  );
}

function isTimelineUserTextMessage(message: SessionMessageViewModel): boolean {
  return message.role === "user" && message.kind === "text";
}

function isTimelinePendingUserMessage(message: SessionMessageViewModel): boolean {
  return (
    isTimelineUserTextMessage(message)
    && message.deliveryState !== "failed"
    && (
      message.rawRef.startsWith("pending://")
      || message.rawRef.startsWith("synthetic://")
      || message.rawRef.includes("#synthetic")
    )
  );
}

function isTimelineAuthoritativeUserTextMessage(message: SessionMessageViewModel): boolean {
  return isTimelineUserTextMessage(message) && !isTimelinePendingUserMessage(message);
}

function isTimelineOpenCodeAuthoritativeMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("opencode://")
    && !(message.rawRef.startsWith("pending://") || message.rawRef.startsWith("synthetic://") || message.rawRef.includes("#synthetic"))
    && (message.role === "user" || message.role === "assistant" || message.role === "tool")
  );
}

function isTimelineOpenCodeToolMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("opencode://")
    && message.role === "tool"
    && (message.kind === "tool_call" || message.kind === "tool_result")
    && message.toolCall !== null
  );
}

function isTimelineEquivalentOpenCodeToolMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (!isTimelineOpenCodeToolMessage(current) || !isTimelineOpenCodeToolMessage(incoming)) {
    return false;
  }

  const currentCallId = current.toolCall?.callId.trim() ?? "";
  const incomingCallId = incoming.toolCall?.callId.trim() ?? "";

  if (currentCallId && incomingCallId) {
    return currentCallId === incomingCallId;
  }

  return extractTimelineEquivalentOpenCodeRawRefIdentity(current.rawRef)
    === extractTimelineEquivalentOpenCodeRawRefIdentity(incoming.rawRef);
}

function extractTimelineEquivalentOpenCodeRawRefIdentity(rawRef: string): string | null {
  if (!rawRef.startsWith("opencode://")) {
    return null;
  }

  const hashIndex = rawRef.indexOf("#");
  const hashSuffix = hashIndex >= 0 ? rawRef.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? rawRef.slice(0, hashIndex) : rawRef;
  const queryIndex = withoutHash.indexOf("?");

  if (queryIndex < 0) {
    return rawRef;
  }

  const base = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));

  if (!params.has("part")) {
    return rawRef;
  }

  params.delete("part");
  const nextQuery = params.toString();

  return `${base}${nextQuery ? `?${nextQuery}` : ""}${hashSuffix}`;
}

function isTimelineEquivalentCodexAuthoritativeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (!isTimelineCodexAuthoritativeMessage(current) || !isTimelineCodexAuthoritativeMessage(incoming)) {
    return false;
  }

  if (current.role !== incoming.role) {
    return false;
  }

  const isToolLifecycleMessage =
    (current.kind === "tool_call" || current.kind === "tool_result")
    && (incoming.kind === "tool_call" || incoming.kind === "tool_result");

  if (!isToolLifecycleMessage && current.kind !== incoming.kind) {
    return false;
  }

  if (isToolLifecycleMessage) {
    return isTimelineEquivalentCodexToolMessage(current, incoming);
  }

  if (
    Math.abs(current.sequence - incoming.sequence) > TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_SEQUENCE_WINDOW
    || !areTimelineTimestampsNearWithinWindow(
      current.timestamp,
      incoming.timestamp,
      TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS
    )
  ) {
    return false;
  }

  if (incoming.kind === "text" || incoming.kind === "thinking") {
    return isTimelineEquivalentCodexTextMessageWithinWindow(
      current,
      incoming,
      TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS
    );
  }

  return false;
}

function isTimelineEquivalentCodexTextMessageWithinWindow(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel,
  windowMs: number
): boolean {
  if (
    left.deliveryState !== "sent"
    || right.deliveryState !== "sent"
    || !left.rawRef.startsWith("codex://")
    || !right.rawRef.startsWith("codex://")
    || left.role !== right.role
    || left.kind !== right.kind
    || left.toolCall !== null
    || right.toolCall !== null
  ) {
    return false;
  }

  if (left.kind !== "text" && left.kind !== "thinking") {
    return false;
  }

  const leftContent = parseMessageRichContent(left.content);
  const rightContent = parseMessageRichContent(right.content);
  const comparableLeftText = normalizeTimelineComparableCodexText(leftContent.text);
  const comparableRightText = normalizeTimelineComparableCodexText(rightContent.text);

  return (
    areTimelineTimestampsNearWithinWindow(left.timestamp, right.timestamp, windowMs)
    && areTimelineEquivalentCodexAssistantTextContents(
      left,
      right,
      comparableLeftText,
      comparableRightText
    )
    && areTimelineEquivalentInlineImages(leftContent.inlineImages, rightContent.inlineImages)
  );
}

function areTimelineEquivalentCodexAssistantTextContents(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel,
  comparableLeftText: string,
  comparableRightText: string
): boolean {
  if (comparableLeftText === comparableRightText) {
    return true;
  }

  return foldTimelineDuplicatedCodexAssistantTailText(
    left,
    right,
    comparableLeftText,
    comparableRightText
  ) !== null;
}

function isTimelineEquivalentCodexToolMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (
    left.deliveryState !== "sent"
    || right.deliveryState !== "sent"
    || !left.rawRef.startsWith("codex://")
    || !right.rawRef.startsWith("codex://")
    || left.role !== "tool"
    || right.role !== "tool"
    || (left.kind !== "tool_call" && left.kind !== "tool_result")
    || (right.kind !== "tool_call" && right.kind !== "tool_result")
    || left.toolCall === null
    || right.toolCall === null
  ) {
    return false;
  }

  const leftCallId = left.toolCall.callId.trim();
  const rightCallId = right.toolCall.callId.trim();

  return leftCallId.length > 0 && leftCallId === rightCallId;
}

function extractTimelineCodexRawRefStore(rawRef: string): string | null {
  const match = rawRef.match(/^codex:\/\/(.+?)(?:#|$)/);
  return match?.[1] ?? null;
}

function areTimelineEquivalentInlineImages(
  left: ReturnType<typeof parseMessageRichContent>["inlineImages"],
  right: ReturnType<typeof parseMessageRichContent>["inlineImages"]
): boolean {
  if (left.length === 0 || right.length === 0) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item.url === right[index]?.url);
}

function areTimelineTimestampsNearWithinWindow(
  left: string,
  right: string,
  windowMs: number
): boolean {
  return Math.abs(toTimelineBridgeTimestampMs(left) - toTimelineBridgeTimestampMs(right)) <= windowMs;
}

function toTimelineBridgeTimestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

function summarizeTimelineBridgeMessageForDebug(
  message: SessionMessageViewModel
): Record<string, unknown> {
  return {
    id: message.id,
    rawRef: message.rawRef,
    role: message.role,
    kind: message.kind,
    sequence: message.sequence,
    timestamp: message.timestamp,
    callId: message.toolCall?.callId ?? null,
    contentPreview:
      message.kind === "text" || message.kind === "thinking"
        ? normalizeTimelineComparableCodexText(parseMessageRichContent(message.content).text).slice(0, 160)
        : normalizeTimelineComparableCodexText(message.content).slice(0, 160)
  };
}

function buildTimelineComparableAttachmentSignature(
  attachments: SessionMessageViewModel["attachments"]
): string {
  return (attachments ?? [])
    .map((attachment) =>
      [
        attachment.kind,
        attachment.fileName.trim().toLowerCase(),
        attachment.mimeType.trim().toLowerCase(),
        String(attachment.fileSize)
      ].join(":")
    )
    .sort()
    .join("|");
}

function buildTimelineComparableAttachmentPayloadSignature(
  attachmentPayloads: SessionMessageViewModel["attachmentPayloads"]
): string {
  return (attachmentPayloads ?? [])
    .map((attachment) =>
      [
        attachment.kind,
        attachment.fileName.trim().toLowerCase(),
        attachment.mimeType.trim().toLowerCase(),
        String(attachment.fileSize)
      ].join(":")
    )
    .sort()
    .join("|");
}

function buildTimelineComparableMessageAttachmentSignature(
  message: SessionMessageViewModel
): string {
  const persistedSignature = buildTimelineComparableAttachmentSignature(message.attachments);

  if (persistedSignature) {
    return persistedSignature;
  }

  return buildTimelineComparableAttachmentPayloadSignature(message.attachmentPayloads);
}

function resolveTimelineAttachmentCompatibility(
  currentSignature: string,
  incomingSignature: string
): "same" | "one_side_missing" | "conflict" {
  if (!currentSignature && !incomingSignature) {
    return "same";
  }

  if (!currentSignature || !incomingSignature) {
    return "one_side_missing";
  }

  return currentSignature === incomingSignature ? "same" : "conflict";
}

function resolveTimelineAttachmentPenalty(
  compatibility: ReturnType<typeof resolveTimelineAttachmentCompatibility>
): number {
  switch (compatibility) {
    case "same":
      return 0;
    case "one_side_missing":
      return 2_500;
    case "conflict":
    default:
      return 120_000;
  }
}

function summarizeTimelineUserMatchCandidate(
  message: SessionMessageViewModel,
  detail: {
    strictTextMatches: boolean;
    relaxedTextMatches: boolean;
    attachmentCompatibility: ReturnType<typeof resolveTimelineAttachmentCompatibility>;
    distanceMs: number;
    sequenceDistance: number;
  }
): Record<string, unknown> {
  return {
    ...summarizeTimelineBridgeMessageForDebug(message),
    comparableContent: normalizeTimelineComparableUserMergeText(message.content).slice(0, 160),
    attachmentSignature: buildTimelineComparableAttachmentSignature(message.attachments),
    strictTextMatches: detail.strictTextMatches,
    relaxedTextMatches: detail.relaxedTextMatches,
    attachmentCompatibility: detail.attachmentCompatibility,
    distanceMs: detail.distanceMs,
    sequenceDistance: detail.sequenceDistance
  };
}

function summarizeTimelineUserMatchInput(
  message: SessionMessageViewModel,
  detail: {
    relaxedContent: string;
    attachmentSignature: string;
  }
): Record<string, unknown> {
  return {
    ...summarizeTimelineBridgeMessageForDebug(message),
    comparableContent: detail.relaxedContent.slice(0, 160),
    attachmentSignature: detail.attachmentSignature
  };
}

function deriveTimelineMessages(
  timeline: TimelineLayersState
): SessionMessageViewModel[] {
  let merged = mergeAuthoritativeWithRuntimeOverlay(
    timeline.authoritativeMessages,
    timeline.runtimeOverlayMessages
  );

  for (const pending of timeline.pendingMessages) {
    merged = insertPendingMessage(merged, pending);
  }

  return pinActiveRuntimeLiveMessagesToTail(
    merged,
    timeline.authoritativeMessages,
    timeline.runtimeOverlayMessages,
    timeline.activeRuntimeOverlayKeys
  );
}

export function applyTimelineEventToLayers(
  current: TimelineLayersState,
  sessionId: string,
  event: TimelineEvent
): TimelineEventResult {
  const previousMessages = deriveTimelineMessages(current);
  let next = current;
  let replacedSnapshotSeed = false;

  switch (event.type) {
    case "timeline.seed": {
      next = {
        authoritativeMessages: mergeAuthoritativeMessages(
          event.snapshotMessages,
          sessionId,
          event.bootstrapMessages
        ),
        runtimeOverlayMessages: [],
        activeRuntimeOverlayKeys: [],
        pendingMessages: [],
        replaceSnapshotSeedOnBackfill: event.replaceSnapshotSeedOnBackfill
      };
      break;
    }
    case "history.merge": {
      replacedSnapshotSeed =
        event.replaceSnapshotSeed
        && current.replaceSnapshotSeedOnBackfill
        && shouldReplaceSnapshotSeedWithIncoming(current.authoritativeMessages, event.messages);
      const baseMessages = replacedSnapshotSeed ? [] : current.authoritativeMessages;
      const authoritativeMessages = mergeAuthoritativeMessages(baseMessages, sessionId, event.messages);
      next = {
        ...current,
        authoritativeMessages,
        activeRuntimeOverlayKeys: didHistoryMergeIntroduceNewAuthoritativeUserMessage(
          current.authoritativeMessages,
          event.messages,
          sessionId
        )
          ? []
          : current.activeRuntimeOverlayKeys,
        pendingMessages: removeResolvedPendingMessages(
          current.pendingMessages,
          event.messages,
          sessionId
        ),
        replaceSnapshotSeedOnBackfill:
          replacedSnapshotSeed ? false : current.replaceSnapshotSeedOnBackfill
      };
      break;
    }
    case "runtime.message": {
      if (shouldSuppressTimelineRuntimeEchoUserMessage(current, event.message, sessionId)) {
        next = current;
        break;
      }

      next = {
        ...current,
        runtimeOverlayMessages: mergeRuntimeOverlayMessages(current.runtimeOverlayMessages, [event.message]),
        activeRuntimeOverlayKeys: updateActiveRuntimeOverlayKeys(
          current,
          current.activeRuntimeOverlayKeys,
          event.message
        )
      };
      break;
    }
    case "pending.insert": {
      next = {
        ...current,
        activeRuntimeOverlayKeys:
          event.pending.role === "user" ? [] : current.activeRuntimeOverlayKeys,
        pendingMessages: insertPendingMessage(current.pendingMessages, event.pending)
      };
      break;
    }
    case "pending.retry": {
      next = {
        ...current,
        pendingMessages: current.pendingMessages.map((item) =>
          item.clientRequestId === event.clientRequestId
            ? {
                ...item,
                deliveryState: "sending"
              }
            : item
        )
      };
      break;
    }
    case "pending.fail": {
      next = {
        ...current,
        pendingMessages: markPendingAsFailed(current.pendingMessages, event.clientRequestId)
      };
      break;
    }
    case "pending.resolve": {
      const pending =
        current.pendingMessages.find((item) => item.clientRequestId === event.clientRequestId) ?? null;
      let authoritativeMessages = mergeAuthoritativeMessages(
        current.authoritativeMessages,
        sessionId,
        [event.message]
      );

      if (pending) {
        authoritativeMessages = authoritativeMessages.map((item) => {
          if (item.id !== event.message.messageId) {
            return item;
          }

          const authoritativeAttachments = item.attachments ?? [];

          return {
            ...item,
            attachments:
              authoritativeAttachments.length > 0
                ? authoritativeAttachments
                : pending.attachments ?? [],
            attachmentPayloads: pending.attachmentPayloads ?? item.attachmentPayloads ?? null,
            clientRequestId: event.clientRequestId
          };
        });
      }

      next = {
        ...current,
        authoritativeMessages,
        activeRuntimeOverlayKeys:
          event.message.role === "user" ? [] : current.activeRuntimeOverlayKeys,
        pendingMessages: current.pendingMessages.filter(
          (item) => item.clientRequestId !== event.clientRequestId
        )
      };
      break;
    }
  }

  next = {
    ...next,
    authoritativeMessages: absorbRuntimeOverlayIntoAuthoritativeMessages(
      next.authoritativeMessages,
      next.runtimeOverlayMessages
    )
  };
  next = {
    ...next,
    // runtime overlay 只保留“权威历史还没完全吸收”的那部分。
    // 否则旧 overlay 会一直参与排序，时间线迟早再次长歪。
    runtimeOverlayMessages: compactRuntimeOverlayMessages(
      next.authoritativeMessages,
      next.runtimeOverlayMessages
    )
  };
  next = {
    ...next,
    activeRuntimeOverlayKeys: compactActiveRuntimeOverlayKeys(
      next.authoritativeMessages,
      next.runtimeOverlayMessages,
      next.activeRuntimeOverlayKeys
    )
  };

  const messages = deriveTimelineMessages(next);

  return {
    timeline: next,
    previousMessages,
    messages,
    replacedSnapshotSeed,
    validationIssues: validateTimelineEventResult(current, next, event, previousMessages, messages)
  };
}

function validateTimelineEventResult(
  previous: TimelineLayersState,
  next: TimelineLayersState,
  event: TimelineEvent,
  previousMessages: SessionMessageViewModel[],
  nextMessages: SessionMessageViewModel[]
): string[] {
  const issues: string[] = [];
  const activeRuntimeTailIds = collectActiveRuntimeTailMessageIds(
    nextMessages,
    next.authoritativeMessages,
    next.runtimeOverlayMessages,
    next.activeRuntimeOverlayKeys
  );
  const renderedDuplicateIds = collectDuplicateKeys(nextMessages.map((message) => message.id));

  if (renderedDuplicateIds.length > 0) {
    issues.push(`rendered_duplicate_ids:${renderedDuplicateIds.join(",")}`);
  }

  const authoritativeDuplicateIds = collectDuplicateKeys(
    next.authoritativeMessages.map((message) => message.id)
  );

  if (authoritativeDuplicateIds.length > 0) {
    issues.push(`authoritative_duplicate_ids:${authoritativeDuplicateIds.join(",")}`);
  }

  const pendingDuplicateIds = collectDuplicateKeys(
    next.pendingMessages
      .map((message) => message.clientRequestId)
      .filter((message): message is string => Boolean(message))
  );

  if (pendingDuplicateIds.length > 0) {
    issues.push(`pending_duplicate_client_request_ids:${pendingDuplicateIds.join(",")}`);
  }

  if (!isTimelineOrdered(nextMessages, activeRuntimeTailIds)) {
    issues.push("rendered_order_not_monotonic");
  }

  if (event.type === "pending.resolve") {
    const unresolved = next.pendingMessages.some(
      (message) => message.clientRequestId === event.clientRequestId
    );

    if (unresolved) {
      issues.push(`pending_not_cleared:${event.clientRequestId}`);
    }
  }

  if (event.type === "runtime.message" && !sameMessageIdSequence(
    previous.authoritativeMessages,
    next.authoritativeMessages
  )) {
    issues.push("runtime_message_mutated_authoritative_layer");
  }

  if (
    event.type === "history.merge"
    && event.source.startsWith("older_history")
    && !didOlderHistoryPreserveTail(previous.authoritativeMessages, next.authoritativeMessages)
  ) {
    issues.push("older_history_rewound_authoritative_tail");
  }

  if (
    previousMessages.length > 0
    && nextMessages.length > 0
    && event.type === "history.merge"
    && event.source.startsWith("older_history")
    && previousMessages.at(-1)?.id !== nextMessages.at(-1)?.id
  ) {
    issues.push("older_history_changed_rendered_tail");
  }

  if (activeRuntimeTailIds.length > 0) {
    const renderedTailId = nextMessages.at(-1)?.id ?? null;

    if (!renderedTailId || !activeRuntimeTailIds.includes(renderedTailId)) {
      issues.push("runtime_live_item_not_pinned_to_tail");
    }
  }

  return issues;
}

function compactRuntimeOverlayMessages(
  authoritativeMessages: SessionMessageViewModel[],
  runtimeOverlayMessages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  if (runtimeOverlayMessages.length === 0) {
    return runtimeOverlayMessages;
  }

  const authoritativeById = new Map(authoritativeMessages.map((message) => [message.id, message]));
  const authoritativeMessageIds = new Set(authoritativeById.keys());
  const latestAuthoritativeMessage = authoritativeMessages.at(-1) ?? null;
  const next = runtimeOverlayMessages.filter((message) => {
    const authoritativeMatch = findTimelineMessageMatch(
      authoritativeById,
      authoritativeMessageIds,
      message
    );

    if (!authoritativeMatch) {
      return true;
    }

    const absorbed = isRuntimeOverlayAbsorbedByAuthoritative(authoritativeMatch, message);

    if (!absorbed && isRuntimeOverlayStaleComparedWithAuthoritativeTail(latestAuthoritativeMessage, message)) {
      logConversationTimelineDebug("timeline.runtime_overlay_stale_dropped", {
        overlay: summarizeTimelineBridgeMessageForDebug(message),
        authoritativeMatch: summarizeTimelineBridgeMessageForDebug(authoritativeMatch),
        latestAuthoritative:
          latestAuthoritativeMessage
            ? summarizeTimelineBridgeMessageForDebug(latestAuthoritativeMessage)
            : null
      });
      return false;
    }

    if (!absorbed && isRuntimePinnedTailMessage(message)) {
      logConversationTimelineDebug("timeline.runtime_overlay_not_absorbed", {
        overlay: summarizeTimelineBridgeMessageForDebug(message),
        authoritativeMatch: summarizeTimelineBridgeMessageForDebug(authoritativeMatch)
      });
    }

    return !absorbed;
  });

  return next.length === runtimeOverlayMessages.length ? runtimeOverlayMessages : next;
}

function absorbRuntimeOverlayIntoAuthoritativeMessages(
  authoritativeMessages: SessionMessageViewModel[],
  runtimeOverlayMessages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  if (authoritativeMessages.length === 0 || runtimeOverlayMessages.length === 0) {
    return authoritativeMessages;
  }

  const nextById = new Map(authoritativeMessages.map((message) => [message.id, message]));
  const authoritativeMessageIds = new Set(nextById.keys());
  let changed = false;

  for (const runtimeOverlay of runtimeOverlayMessages) {
    const authoritativeMatch = findTimelineMessageMatch(
      nextById,
      authoritativeMessageIds,
      runtimeOverlay
    );

    if (
      !authoritativeMatch
      || !isRuntimeOverlayAbsorbedByAuthoritative(authoritativeMatch, runtimeOverlay)
    ) {
      continue;
    }

    const merged = mergeTimelineBridgePreservingIdentity(authoritativeMatch, runtimeOverlay);
    nextById.set(authoritativeMatch.id, merged);
    changed = true;
  }

  if (!changed) {
    return authoritativeMessages;
  }

  return sortTimelineBridgeMessagesByOrder(Array.from(nextById.values()));
}

function pinActiveRuntimeLiveMessagesToTail(
  messages: SessionMessageViewModel[],
  authoritativeMessages: SessionMessageViewModel[],
  runtimeOverlayMessages: SessionMessageViewModel[],
  activeRuntimeOverlayKeys: string[]
): SessionMessageViewModel[] {
  const activeTailIds = collectActiveRuntimeTailMessageIds(
    messages,
    authoritativeMessages,
    runtimeOverlayMessages,
    activeRuntimeOverlayKeys
  );

  if (activeTailIds.length === 0) {
    return messages;
  }

  const activeTailIdSet = new Set(activeTailIds);
  const next = [
    ...messages.filter((message) => !activeTailIdSet.has(message.id)),
    ...messages.filter((message) => activeTailIdSet.has(message.id))
  ];

  return sameMessageIdSequence(messages, next) ? messages : next;
}

function collectActiveRuntimeTailMessageIds(
  renderedMessages: SessionMessageViewModel[],
  authoritativeMessages: SessionMessageViewModel[],
  runtimeOverlayMessages: SessionMessageViewModel[],
  activeRuntimeOverlayKeys: string[]
): string[] {
  if (
    runtimeOverlayMessages.length === 0
    || renderedMessages.length === 0
    || activeRuntimeOverlayKeys.length === 0
  ) {
    return [];
  }

  const authoritativeById = new Map(authoritativeMessages.map((message) => [message.id, message]));
  const authoritativeMessageIds = new Set(authoritativeById.keys());
  const renderedById = new Map(renderedMessages.map((message) => [message.id, message]));
  const renderedMessageIds = new Set(renderedById.keys());
  const runtimeOverlayByKey = new Map(
    runtimeOverlayMessages.map((message) => [buildRuntimeOverlayKey(message), message])
  );
  const activeTailIds: string[] = [];

  for (const overlayKey of activeRuntimeOverlayKeys) {
    const message = runtimeOverlayByKey.get(overlayKey) ?? null;

    if (!message) {
      continue;
    }

    if (!isRuntimeOverlayEligibleForTail(authoritativeMessages, message)) {
      continue;
    }

    const authoritativeMatch = findTimelineMessageMatch(
      authoritativeById,
      authoritativeMessageIds,
      message
    );

    if (authoritativeMatch && isRuntimeOverlayAbsorbedByAuthoritative(authoritativeMatch, message)) {
      continue;
    }

    const renderedMatch = findTimelineMessageMatch(renderedById, renderedMessageIds, message);

    if (!renderedMatch || activeTailIds.includes(renderedMatch.id)) {
      continue;
    }

    activeTailIds.push(renderedMatch.id);
  }

  return activeTailIds;
}

function updateActiveRuntimeOverlayKeys(
  timeline: TimelineLayersState,
  current: string[],
  message: SessionMessageViewModel
): string[] {
  if (!isRuntimeOverlayEligibleForTail(timeline.authoritativeMessages, message)) {
    return current;
  }

  const overlayKey = buildRuntimeOverlayKey(message);

  if (current.includes(overlayKey)) {
    return current;
  }

  return [...current, overlayKey];
}

function isRuntimeOverlayEligibleForTail(
  authoritativeMessages: SessionMessageViewModel[],
  message: SessionMessageViewModel
): boolean {
  if (!isRuntimePinnedTailMessage(message)) {
    return false;
  }

  return !isRuntimeOverlayStaleComparedWithAuthoritativeTail(
    authoritativeMessages.at(-1) ?? null,
    message
  );
}

function isRuntimeOverlayStaleComparedWithAuthoritativeTail(
  latestAuthoritativeMessage: SessionMessageViewModel | null,
  message: SessionMessageViewModel
): boolean {
  if (!latestAuthoritativeMessage) {
    return false;
  }

  if (isTimelineEquivalentToolLifecycleMessage(message, latestAuthoritativeMessage)) {
    return false;
  }

  return compareRuntimeOverlayFreshness(message, latestAuthoritativeMessage) < 0;
}

function compareRuntimeOverlayFreshness(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): number {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);

  if (timestampOrder !== 0) {
    return timestampOrder;
  }

  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  return compareViewMessageOrder(left, right);
}

function compactActiveRuntimeOverlayKeys(
  authoritativeMessages: SessionMessageViewModel[],
  runtimeOverlayMessages: SessionMessageViewModel[],
  activeRuntimeOverlayKeys: string[]
): string[] {
  if (activeRuntimeOverlayKeys.length === 0) {
    return activeRuntimeOverlayKeys;
  }

  const runtimeOverlayByKey = new Map(
    runtimeOverlayMessages.map((message) => [buildRuntimeOverlayKey(message), message])
  );
  const latestAuthoritativeMessage = authoritativeMessages.at(-1) ?? null;
  const next = activeRuntimeOverlayKeys.filter((overlayKey) => {
    const message = runtimeOverlayByKey.get(overlayKey) ?? null;

    if (!message) {
      return false;
    }

    const keepActive = isRuntimeOverlayEligibleForTail(authoritativeMessages, message);

    if (!keepActive) {
      logConversationTimelineDebug("timeline.runtime_overlay_tail_deactivated", {
        overlay: summarizeTimelineBridgeMessageForDebug(message),
        latestAuthoritative: latestAuthoritativeMessage
          ? summarizeTimelineBridgeMessageForDebug(latestAuthoritativeMessage)
          : null
      });
    }

    return keepActive;
  });

  return next.length === activeRuntimeOverlayKeys.length ? activeRuntimeOverlayKeys : next;
}

function findTimelineMessageMatch(
  messagesById: Map<string, SessionMessageViewModel>,
  candidateMessageIds: Set<string>,
  incoming: SessionMessageViewModel
): SessionMessageViewModel | null {
  const exactMatch = messagesById.get(incoming.id) ?? null;
  const preferredEquivalentMessageId = findPreferredTimelineEquivalentMessageId(
    messagesById,
    candidateMessageIds,
    incoming,
    exactMatch
  );

  if (preferredEquivalentMessageId) {
    return messagesById.get(preferredEquivalentMessageId) ?? null;
  }

  if (exactMatch) {
    return exactMatch;
  }

  const equivalentCodexMessageId = findMatchingTimelineEquivalentCodexMessageId(
    messagesById,
    candidateMessageIds,
    incoming
  );

  if (equivalentCodexMessageId) {
    return messagesById.get(equivalentCodexMessageId) ?? null;
  }

  const equivalentOpenCodeMessageId = findMatchingTimelineEquivalentOpenCodeMessageId(
    messagesById,
    incoming
  );

  if (equivalentOpenCodeMessageId) {
    return messagesById.get(equivalentOpenCodeMessageId) ?? null;
  }

  return null;
}

function findPreferredTimelineEquivalentMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  candidateMessageIds: Set<string>,
  incoming: SessionMessageViewModel,
  exactMatch: SessionMessageViewModel | null
): string | null {
  const equivalentRuntimeCodexMessageId = findMatchingRuntimeOverlayEquivalentCodexMessageId(
    messagesById,
    candidateMessageIds,
    incoming
  );
  const equivalentCodexMessageId = findMatchingTimelineEquivalentCodexMessageId(
    messagesById,
    candidateMessageIds,
    incoming
  );
  const equivalentOpenCodeMessageId = findMatchingTimelineEquivalentOpenCodeMessageId(
    messagesById,
    incoming
  );
  const preferredEquivalentMessageId =
    equivalentRuntimeCodexMessageId
    ?? equivalentCodexMessageId
    ?? equivalentOpenCodeMessageId;

  if (!preferredEquivalentMessageId) {
    return null;
  }

  if (!exactMatch) {
    return preferredEquivalentMessageId;
  }

  const preferredEquivalentMessage = messagesById.get(preferredEquivalentMessageId) ?? null;

  if (!preferredEquivalentMessage) {
    return null;
  }

  if (!shouldPreferEquivalentTimelineMatch(exactMatch, preferredEquivalentMessage, incoming)) {
    return null;
  }

  return preferredEquivalentMessageId;
}

function findMatchingRuntimeOverlayEquivalentCodexMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  candidateMessageIds: Set<string>,
  incoming: SessionMessageViewModel
): string | null {
  if (
    incoming.role !== "assistant"
    || (incoming.kind !== "text" && incoming.kind !== "thinking")
    || incoming.deliveryState !== "sent"
    || !incoming.rawRef.startsWith("codex://")
  ) {
    return null;
  }

  const incomingStore = extractTimelineCodexRawRefStore(incoming.rawRef);

  if (!incomingStore) {
    return null;
  }

  for (const [messageId, current] of messagesById.entries()) {
    if (
      messageId === incoming.id
      || !candidateMessageIds.has(messageId)
      || current.role !== incoming.role
      || current.kind !== incoming.kind
      || current.deliveryState !== "sent"
      || !current.rawRef.startsWith("codex://")
    ) {
      continue;
    }

    const currentStore = extractTimelineCodexRawRefStore(current.rawRef);
    const sequenceDistance = Math.abs(current.sequence - incoming.sequence);
    const storesMatch = currentStore === incomingStore;

    if (
      !currentStore
      || compareViewMessageOrder(current, incoming) < 0
      || (
        !storesMatch
        && sequenceDistance > TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_SEQUENCE_WINDOW
      )
      || !isTimelineEquivalentCodexTextMessageWithinWindow(
        current,
        incoming,
        TIMELINE_CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS
      )
    ) {
      continue;
    }

    logSessionMessageDedupDebug("session.messages.codex_runtime_overlay_bridge_match", {
      bridgeMode: storesMatch ? "same_store" : "cross_store_sequence_window",
      sequenceDistance,
      previous: summarizeTimelineBridgeMessageForDebug(current),
      incoming: summarizeTimelineBridgeMessageForDebug(incoming)
    });
    return messageId;
  }

  return null;
}

function shouldPreferEquivalentTimelineMatch(
  exactMatch: SessionMessageViewModel,
  equivalentMatch: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (
    !isTimelineEquivalentToolLifecycleMessage(exactMatch, incoming)
    || !isTimelineEquivalentToolLifecycleMessage(equivalentMatch, incoming)
  ) {
    return false;
  }

  return (
    !isRuntimeOverlayAbsorbedByAuthoritative(exactMatch, incoming)
    && isRuntimeOverlayAbsorbedByAuthoritative(equivalentMatch, incoming)
  );
}

function isRuntimePinnedTailMessage(message: SessionMessageViewModel): boolean {
  return (
    (
      message.role === "assistant"
      && (message.kind === "text" || message.kind === "thinking")
    )
    || (
      message.role === "tool"
      && (message.kind === "tool_call" || message.kind === "tool_result")
    )
  );
}

function isRuntimeOverlayAbsorbedByAuthoritative(
  authoritative: SessionMessageViewModel,
  runtimeOverlay: SessionMessageViewModel
): boolean {
  if (authoritative.role !== runtimeOverlay.role) {
    return false;
  }

  if (
    authoritative.kind !== runtimeOverlay.kind
    && !(
      isTimelineEquivalentOpenCodeToolMessage(authoritative, runtimeOverlay)
      || isTimelineEquivalentCodexToolMessage(authoritative, runtimeOverlay)
    )
  ) {
    return false;
  }

  const merged = mergeTimelineBridgeAuthoritativeVersion(authoritative, {
    ...runtimeOverlay,
    id: authoritative.id,
    clientRequestId: authoritative.clientRequestId ?? runtimeOverlay.clientRequestId
  });

  const mergedSignature = buildTimelineRenderablePayloadSignature(merged);

  return (
    mergedSignature === buildTimelineRenderablePayloadSignature(authoritative)
    || mergedSignature === buildTimelineRenderablePayloadSignature(runtimeOverlay)
  );
}

function buildTimelineRenderablePayloadSignature(
  message: SessionMessageViewModel
): string {
  const normalizedText =
    message.kind === "text" || message.kind === "thinking"
      ? normalizeTimelineComparableCodexText(parseMessageRichContent(message.content).text)
      : normalizeTimelineComparableCodexText(message.content);

  return JSON.stringify({
    role: message.role,
    kind: message.kind,
    content: normalizedText,
    attachments: buildTimelineComparableAttachmentSignature(message.attachments),
    toolCall:
      message.toolCall === null
        ? null
        : {
            callId: message.toolCall.callId,
            name: message.toolCall.name,
            status: message.toolCall.status,
            input: normalizeTimelineComparableCodexText(message.toolCall.input),
            output: normalizeTimelineComparableCodexText(message.toolCall.output ?? ""),
            error: normalizeTimelineComparableCodexText(message.toolCall.error ?? "")
          }
  });
}

function collectDuplicateKeys(values: string[]): string[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function isTimelineOrdered(
  messages: SessionMessageViewModel[],
  pinnedTailIds: string[] = []
): boolean {
  if (pinnedTailIds.length > 0) {
    const pinnedTailIdSet = new Set(pinnedTailIds);
    const tailMessages = messages.filter((message) => pinnedTailIdSet.has(message.id));

    if (tailMessages.length > 0) {
      const prefixMessages = messages.filter((message) => !pinnedTailIdSet.has(message.id));
      const renderedTail = messages.slice(-tailMessages.length);

      if (renderedTail.some((message) => !pinnedTailIdSet.has(message.id))) {
        return false;
      }

      return isTimelineOrdered(prefixMessages) && isTimelineOrdered(tailMessages);
    }
  }

  for (let index = 1; index < messages.length; index += 1) {
    if (compareViewMessageOrder(messages[index - 1], messages[index]) > 0) {
      return false;
    }
  }

  return true;
}

function sameMessageIdSequence(
  left: SessionMessageViewModel[],
  right: SessionMessageViewModel[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.id !== right[index]?.id) {
      return false;
    }
  }

  return true;
}

function didOlderHistoryPreserveTail(
  previous: SessionMessageViewModel[],
  next: SessionMessageViewModel[]
): boolean {
  const previousTail = previous.at(-1) ?? null;

  if (!previousTail) {
    return true;
  }

  const nextTail = next.at(-1) ?? null;

  if (!nextTail) {
    return false;
  }

  return previousTail.id === nextTail.id;
}

function extractTimelineEventMessages(
  event: TimelineEvent
): Array<
  Pick<
    SessionMessageViewModel,
    "id" | "role" | "kind" | "sequence" | "timestamp" | "rawRef" | "content"
  >
  | Pick<HistoryMessageDto, "messageId" | "role" | "kind" | "sequence" | "timestamp" | "rawRef" | "content">
> {
  switch (event.type) {
    case "timeline.seed":
      return [...event.snapshotMessages, ...event.bootstrapMessages];
    case "history.merge":
      return event.messages;
    case "runtime.message":
      return [event.message];
    case "pending.insert":
      return [event.pending];
    case "pending.resolve":
      return [event.message];
    case "pending.retry":
    case "pending.fail":
    default:
      return [];
  }
}

function collectTimelineMessageMoves(
  previous: SessionMessageViewModel[],
  next: SessionMessageViewModel[],
  role: SessionMessageViewModel["role"]
): Array<Record<string, unknown>> {
  const previousIndexById = new Map(previous.map((message, index) => [message.id, index]));
  const nextIndexById = new Map(next.map((message, index) => [message.id, index]));
  const previousById = new Map(previous.map((message) => [message.id, message]));
  const nextById = new Map(next.map((message) => [message.id, message]));
  const allMessageIds = new Set<string>([
    ...previous.map((message) => message.id),
    ...next.map((message) => message.id)
  ]);
  const moves: Array<Record<string, unknown>> = [];

  for (const messageId of allMessageIds) {
    const previousMessage = previousById.get(messageId) ?? null;
    const nextMessage = nextById.get(messageId) ?? null;
    const targetMessage = nextMessage ?? previousMessage;

    if (!targetMessage || targetMessage.role !== role) {
      continue;
    }

    const previousIndex = previousIndexById.get(messageId) ?? null;
    const nextIndex = nextIndexById.get(messageId) ?? null;

    if (previousIndex === nextIndex) {
      continue;
    }

    moves.push({
      messageId,
      fromIndex: previousIndex,
      toIndex: nextIndex,
      fromSequence: previousMessage?.sequence ?? null,
      toSequence: nextMessage?.sequence ?? null,
      fromRawRef: previousMessage?.rawRef ?? null,
      toRawRef: nextMessage?.rawRef ?? null,
      anchorChanged:
        previousMessage?.sequence !== nextMessage?.sequence
        || previousMessage?.timestamp !== nextMessage?.timestamp
        || previousMessage?.rawRef !== nextMessage?.rawRef
    });
  }

  return moves.slice(0, 8);
}

function summarizeOrderDebugMessage(
  message: Pick<
    SessionMessageViewModel,
    "id" | "role" | "kind" | "sequence" | "timestamp" | "rawRef" | "content"
  >
  | Pick<HistoryMessageDto, "messageId" | "role" | "kind" | "sequence" | "timestamp" | "rawRef" | "content">
): Record<string, unknown> {
  const messageId = "id" in message ? message.id : message.messageId;

  return {
    messageId,
    role: message.role,
    kind: message.kind ?? "text",
    sequence: message.sequence,
    timestamp: message.timestamp,
    rawRef: message.rawRef,
    contentPreview: normalizeOrderDebugPreview(message.content)
  };
}

function summarizeOrderDebugMessages(
  messages: Array<
    Pick<
      SessionMessageViewModel,
      "id" | "role" | "kind" | "sequence" | "timestamp" | "rawRef" | "content"
    >
    | Pick<HistoryMessageDto, "messageId" | "role" | "kind" | "sequence" | "timestamp" | "rawRef" | "content">
  >
): Array<Record<string, unknown>> {
  return messages.map((message) => summarizeOrderDebugMessage(message));
}

function normalizeOrderDebugPreview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
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

function buildConversationTimelineStateItems(
  session: SessionSummaryDto | null,
  messages: SessionMessageViewModel[]
): ConversationTimelineSourceItem[] {
  return buildConversationTimelineSourceItems({
    messages,
    sessionRunningState: session?.runningState ?? null,
    sessionSyncStatus: session?.syncStatus ?? null,
    sessionLastErrorCode: session?.lastErrorCode ?? null,
    sessionLastErrorDetail: session?.lastErrorDetail ?? null,
    sessionDetail: session?.detail ?? null
  });
}

export function connectionTone(state: RuntimeConnectionState) {
  return state;
}

function resolveKnownMessageCount(session: SessionSummaryDto | null): number | null {
  const messageCount = session?.messageCount;
  return typeof messageCount === "number" && Number.isFinite(messageCount) ? messageCount : null;
}

function resolveNextOptimisticUserSequence(
  messages: SessionMessageViewModel[],
  session: SessionSummaryDto | null
): number {
  const messageSequence = getNextOptimisticUserSequence(messages);
  const knownMessageCount = resolveKnownMessageCount(session);

  if (knownMessageCount === null) {
    return messageSequence;
  }

  return Math.max(messageSequence, knownMessageCount + 1);
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

  // OpenCode 的模型列表会跟随当前 server / provider 配置变化，不能把旧快照当成稳定真值。
  if (capabilities.provider === "opencode") {
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
  if (
    isTerminalRuntimeState(currentState)
    && (incomingState === "completed" || incomingState === "interrupted" || incomingState === "failed")
  ) {
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

function isCodexAssistantOrToolHistoryMessage(message: HistoryMessageDto): boolean {
  return (
    message.provider === "codex"
    && (message.role === "assistant" || message.role === "tool")
  );
}

function isCodexAssistantOrToolViewMessage(message: SessionMessageViewModel): boolean {
  return (
    message.rawRef.startsWith("codex://")
    && message.deliveryState === "sent"
    && (message.role === "assistant" || message.role === "tool")
  );
}

function summarizeHistoryMessageForDebug(message: HistoryMessageDto): Record<string, unknown> {
  return {
    id: message.messageId,
    rawRef: message.rawRef,
    role: message.role,
    kind: message.kind ?? (message.role === "tool" ? "tool_result" : "text"),
    sequence: message.sequence,
    timestamp: message.timestamp,
    callId: message.toolCall?.callId ?? null,
    contentPreview: buildDebugContentPreview(message.content, message.kind ?? "text")
  };
}

function summarizeViewMessageForDebug(message: SessionMessageViewModel): Record<string, unknown> {
  return {
    id: message.id,
    rawRef: message.rawRef,
    role: message.role,
    kind: message.kind,
    sequence: message.sequence,
    timestamp: message.timestamp,
    callId: message.toolCall?.callId ?? null,
    contentPreview: buildDebugContentPreview(message.content, message.kind)
  };
}

function collectCodexDuplicateDebugGroups(
  messages: SessionMessageViewModel[]
): Array<Record<string, unknown>> {
  const grouped = new Map<string, SessionMessageViewModel[]>();

  for (const message of messages) {
    if (!isCodexAssistantOrToolViewMessage(message)) {
      continue;
    }

    const signature = buildCodexDebugSignature(message);
    const bucket = grouped.get(signature);

    if (bucket) {
      bucket.push(message);
      continue;
    }

    grouped.set(signature, [message]);
  }

  const duplicates: Array<Record<string, unknown>> = [];

  for (const [signature, bucket] of grouped.entries()) {
    const sortedBucket = [...bucket].sort((left, right) => {
      if (left.sequence !== right.sequence) {
        return left.sequence - right.sequence;
      }

      return left.timestamp.localeCompare(right.timestamp);
    });

    let cluster: SessionMessageViewModel[] = [];

    for (const message of sortedBucket) {
      const previous = cluster.at(-1) ?? null;

      if (!previous || areCodexDebugMessagesNear(previous, message)) {
        cluster.push(message);
        continue;
      }

      if (cluster.length > 1) {
        duplicates.push({
          signature,
          messages: cluster.map(summarizeViewMessageForDebug)
        });
      }

      cluster = [message];
    }

    if (cluster.length > 1) {
      duplicates.push({
        signature,
        messages: cluster.map(summarizeViewMessageForDebug)
      });
    }
  }

  return duplicates;
}

function buildCodexDebugSignature(message: SessionMessageViewModel): string {
  if (message.kind === "tool_call" || message.kind === "tool_result") {
    return [
      message.role,
      message.kind,
      message.toolCall?.callId ?? "",
      message.toolCall?.name ?? ""
    ].join(":");
  }

  const richContent = parseMessageRichContent(message.content);
  const normalizedText = normalizeDebugText(richContent.text);
  const inlineImageUrls = richContent.inlineImages.map((item) => item.url).join("|");

  return [
    message.role,
    message.kind,
    normalizedText,
    inlineImageUrls
  ].join(":");
}

function areCodexDebugMessagesNear(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  const leftMs = toDebugTimestampMs(left.timestamp);
  const rightMs = toDebugTimestampMs(right.timestamp);
  return Math.abs(leftMs - rightMs) <= 2 * 60 * 1000 && Math.abs(left.sequence - right.sequence) <= 8;
}

function buildDebugContentPreview(
  content: string,
  kind: SessionMessageViewModel["kind"]
): string {
  if (kind === "text" || kind === "thinking") {
    return normalizeDebugText(parseMessageRichContent(content).text).slice(0, 160);
  }

  return normalizeDebugText(content).slice(0, 160);
}

function normalizeDebugText(content: string): string {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

function toDebugTimestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
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

function shouldRefreshRuntimeActivity(
  session: SessionSummaryDto | null,
  runtimeHasActiveRun: boolean | null,
  runtimeCanInterrupt: boolean | null
): boolean {
  if (runtimeHasActiveRun === true || runtimeCanInterrupt === true) {
    return true;
  }

  if (!session) {
    return false;
  }

  return (
    session.activityState === "running"
    || session.runningState === "starting"
    || session.runningState === "running"
    || session.runningState === "reconnecting"
    || session.runningState === "stale"
    || session.runningState === "unknown"
  );
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

function buildSessionRuntimeSnapshotKey(sessionId: string, targetHostId?: string | null) {
  const normalizedTargetHostId = targetHostId?.trim();
  return normalizedTargetHostId
    ? `session-runtime.snapshot.host.${encodeURIComponent(normalizedTargetHostId)}.${sessionId}`
    : `session-runtime.snapshot.${sessionId}`;
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

  if (shouldPreferTerminalSessionSummary(left, right)) {
    return left;
  }

  if (shouldPreferActiveSessionSummary(right, left)) {
    return right;
  }

  if (shouldPreferTerminalSessionSummary(right, left)) {
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

function shouldPreferTerminalSessionSummary(
  candidate: SessionSummaryDto,
  incoming: SessionSummaryDto
): boolean {
  if (!isTerminalSessionSummary(candidate) || isTerminalSessionSummary(incoming)) {
    return false;
  }

  const candidateTerminalAt = candidate.completedAt ?? candidate.lastEventAt ?? null;

  if (!candidateTerminalAt) {
    return false;
  }

  return (
    (!incoming.lastEventAt || incoming.lastEventAt <= candidateTerminalAt)
    && (!incoming.completedAt || incoming.completedAt <= candidateTerminalAt)
  );
}

function isSessionSummaryActive(session: SessionSummaryDto): boolean {
  return session.activityState === "running" || isRuntimeActiveState(session.runningState);
}

function isTerminalSessionSummary(session: SessionSummaryDto): boolean {
  return isTerminalRuntimeState(session.runningState);
}
