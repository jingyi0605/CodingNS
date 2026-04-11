import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type TouchEvent as ReactTouchEvent
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { useLocalUiPreferenceSelector } from "../../../preferences/local-ui-preference-store";
import { usePlatform } from "../../../platform/platform-provider";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  forkSession,
  getProviderCapabilities,
  sendLiveMessage,
  startLiveSession,
  type HistoryMessageDto,
  type MessageAttachmentDto,
  type ProviderCapabilitiesDto,
  type ProviderId,
  type SessionSummaryDto
} from "../api/conversation-api";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ComposerPanel } from "../components/ComposerPanel";
import { MessageTimeline } from "../components/MessageTimeline";
import { MobileConversationSessionActions } from "../components/MobileConversationSessionActions";
import { PermissionRequestList } from "../components/PermissionRequestList";
import { QueuedMessageList } from "../components/QueuedMessageList";
import { SessionBranchTreePanel } from "../components/SessionBranchTreePanel";
import { SessionHeader } from "../components/SessionHeader";
import { SessionButlerActionButton } from "../components/SessionButlerActionButton";
import {
  BranchTreeActionIcon,
  ContextExpandActionIcon
} from "../components/ConversationActionIcons";
import { useWorkbenchShell } from "../components/WorkbenchLayout";
import { isRealSubagentSession } from "../session-fork-display";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";
import {
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassName
} from "../session-activity-display";
import { buildSessionTitlePresentation } from "../session-title";
import {
  createPendingMessage,
  markPendingAsFailed,
  type SessionMessageViewModel
} from "../runtime/session-runtime-machine";
import {
  buildSessionBranchTreeModel,
  hasSessionBranchRelations
} from "../components/SessionBranchTreePanel";
import {
  createDraftCapabilities as createProviderDraftCapabilities,
  getDraftTitle as getProviderDraftTitle,
  getProviderDisplayName,
  isDraftProviderSupported,
  shouldSupportRunSteering
} from "../capability/provider-ui";
import {
  buildDraftSessionPath,
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  flattenNavigationSessions,
  type WorkbenchNavigationEntry
} from "../../workbench/utils/workbench-navigation";
import { useMobileConversationBottomLayer } from "../../mobile-shell/components/MobileConversationBottomLayerContext";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { MobileCreateSessionSheet } from "../../mobile-sessions/components/MobileCreateSessionSheet";
import {
  readMobileConversationPreviewMode,
  writeMobileConversationPreviewMode,
  type MobileConversationPreviewMode
} from "../../mobile-sessions/mobile-conversation-state";
import "../../mobile-sessions/styles.css";

const RUNTIME_TIMEOUT_TOAST_DELAY_MS = 15_000;
const MOBILE_PREVIEW_DEFAULT_RATIO = 0.6;
const MOBILE_PREVIEW_MAX_RATIO = 0.6;
const MOBILE_PREVIEW_GESTURE_DIRECTION_LOCK_PX = 8;
const MOBILE_PREVIEW_OPEN_THRESHOLD_PX = 36;
const MOBILE_PREVIEW_EXPAND_THRESHOLD_PX = 48;
const MOBILE_PREVIEW_CLOSE_THRESHOLD_PX = 34;
const MOBILE_PREVIEW_EDGE_ACTIVATION_PX = 96;
const RUNTIME_THINKING_PLACEHOLDER_HIDE_DELAY_MS = 320;
const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";

interface ForkComposerDraft {
  sourceMessageId: string;
  content: string;
  sourceProvider: ProviderId;
  workspaceId: string;
  targetProvider: ProviderId;
  targetModel: string | null;
}

export function ConversationPage() {
  const { sessionId = "", workspaceId: routeWorkspaceIdParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeWorkspaceId = routeWorkspaceIdParam?.trim() || null;
  const draftContext = useMemo(
    () => parseDraftContext(sessionId, routeWorkspaceId, searchParams),
    [routeWorkspaceId, searchParams, sessionId]
  );
  const liveBootstrapMessages = useMemo(
    () => parseLiveBootstrapMessages(sessionId, location.state),
    [location.state, sessionId]
  );

  if (draftContext) {
    return <DraftConversationPage draft={draftContext} navigate={navigate} />;
  }

  return <LiveConversationPage sessionId={sessionId} bootstrapMessages={liveBootstrapMessages} />;
}

function LiveConversationPage({
  sessionId,
  bootstrapMessages
}: {
  sessionId: string;
  bootstrapMessages: HistoryMessageDto[];
}) {
  const {
    shellMode,
    navigationGroups,
    requestNavigationRefresh,
    selectWorkspace,
    setSessionWorkspace,
    markNavigationSessionSeen,
    favoriteSessions,
    archiveSession,
    unarchiveSession,
    startDraftSession,
    upsertNavigationSession
  } = useWorkbenchShell();
  const navigate = useNavigate();
  const storeRef = useRef<SessionRuntimeStore | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveFolderOpen, setArchiveFolderOpen] = useState(false);
  const [archiveRestoreSessionId, setArchiveRestoreSessionId] = useState<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [branchTreeOpen, setBranchTreeOpen] = useState(false);
  const [forkDraft, setForkDraft] = useState<ForkComposerDraft | null>(null);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const navigationSession = useMemo(
    () =>
      navigationGroups
        .flatMap((group) => group.sessions)
        .find((item) => item.sessionId === sessionId) ?? null,
    [navigationGroups, sessionId]
  );

  if (!storeRef.current || currentSessionIdRef.current !== sessionId) {
    storeRef.current?.destroy();
    storeRef.current = new SessionRuntimeStore(sessionId, {
      initialSession: navigationSession,
      bootstrapMessages,
      onSeen: (seenSessionId, seenAt) => {
        markNavigationSessionSeen(seenSessionId, seenAt);
      }
    });
    currentSessionIdRef.current = sessionId;
  }

  const store = storeRef.current;
  const { showToast, dismissToast } = useToast();
  const notifyOnPermissionRequest = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnPermissionRequest
  );
  const platform = usePlatform();
  const haptics = useHaptics();
  const lastRuntimeErrorSignatureRef = useRef<string | null>(null);
  const pendingRuntimeErrorSignatureRef = useRef<string | null>(null);
  const delayedRuntimeToastTimerRef = useRef<number | null>(null);
  const previousRunningStateRef = useRef<string | null>(navigationSession?.runningState ?? null);
  const notifiedPermissionRequestIdsRef = useRef<Set<string>>(new Set());
  const session = useSessionRuntimeStore(store, (state) => state.session);
  const capabilities = useSessionRuntimeStore(store, (state) => state.capabilities);
  const runtimeHasActiveRun = useSessionRuntimeStore(store, (state) => state.runtimeHasActiveRun);
  const runtimeCanInterrupt = useSessionRuntimeStore(store, (state) => state.runtimeCanInterrupt);
  const messages = useSessionRuntimeStore(store, (state) => state.messages);
  const permissionRequests = useSessionRuntimeStore(store, (state) => state.permissionRequests);
  const queuedMessages = useSessionRuntimeStore(store, (state) => state.queuedMessages);
  const contextUsage = useSessionRuntimeStore(store, (state) => state.contextUsage);
  const historyState = useSessionRuntimeStore(store, (state) => state.historyState);
  const runtimeErrorCode = useSessionRuntimeStore(store, (state) => state.errorCode);
  const runtimeErrorDetail = useSessionRuntimeStore(store, (state) => state.errorDetail);
  const loadingOlderMessages = useSessionRuntimeStore(
    store,
    (state) => state.loadingOlderMessages
  );
  const hasOlderMessages = useSessionRuntimeStore(store, (state) => state.hasOlderMessages);
  const connectionState = useSessionRuntimeStore(store, (state) => state.connectionState);
  const [inheritedContextExpanded, setInheritedContextExpanded] = useState(false);
  const [deletingQueueItemId, setDeletingQueueItemId] = useState<string | null>(null);
  const [steeringQueueItemId, setSteeringQueueItemId] = useState<string | null>(null);
  const isRunning = isSessionRunning(session);
  const canSteerQueuedMessage =
    isRunning &&
    shouldSupportRunSteering(capabilities) &&
    session?.provider === capabilities?.provider;
  const hasPendingQueuedMessages = queuedMessages.some(
    (item) => item.status === "queued" || item.status === "dispatching"
  );
  const runtimeThinkingPlaceholder = useStableRuntimeThinkingPlaceholder({
    sessionId,
    provider: session?.provider ?? null,
    runningState: session?.runningState ?? null,
    activityState: session?.activityState ?? null,
    runtimeHasActiveRun,
    messages
  })
    ? t("conversation.runtimeThinkingPlaceholder", {
        provider: t("conversation.providerCodex")
      })
    : null;
  const showInlineHeader = shellMode !== "mobile";
  const mobilePreview = useMobileConversationPreviewController(!showInlineHeader);
  const mobileWorkspaceId = session?.workspaceId ?? navigationSession?.workspaceId ?? null;
  const mobileFavoriteSessionIdSet = useMemo(
    () => new Set(favoriteSessions.map((item) => item.session.sessionId)),
    [favoriteSessions]
  );
  const mobileWorkspaces = useMemo(
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );
  const mobilePreviewActiveSessionId = useMemo(
    () =>
      resolveMobilePreviewActiveSessionId(
        navigationGroups,
        mobileWorkspaceId,
        sessionId
      ),
    [mobileWorkspaceId, navigationGroups, sessionId]
  );
  const mobilePreviewItems = useMemo(
    () =>
      buildMobilePreviewItems(
        navigationGroups,
        session?.workspaceId ?? navigationSession?.workspaceId ?? null,
        mobileFavoriteSessionIdSet
      ),
    [mobileFavoriteSessionIdSet, navigationGroups, navigationSession?.workspaceId, session?.workspaceId]
  );
  const mobileFavoritePreviewItems = useMemo(
    () => buildMobileFavoritePreviewItems(favoriteSessions),
    [favoriteSessions]
  );
  const mobileArchiveWorkspaceGroup = useMemo(
    () =>
      mobileWorkspaceId
        ? navigationGroups.find((group) => group.workspace.id === mobileWorkspaceId) ?? null
        : null,
    [mobileWorkspaceId, navigationGroups]
  );
  const mobileDraftProvider = session?.provider ?? navigationSession?.provider ?? null;
  const mobileSessionTitlePresentation = useMemo(
    () => buildSessionTitlePresentation((session ?? navigationSession)?.title ?? null, t("conversation.titleFallback")),
    [navigationSession, session]
  );
  const currentSessionSummary = session ?? navigationSession ?? null;
  const sessionById = useMemo(
    () =>
      new Map(
        navigationGroups.flatMap((group) => group.sessions.map((item) => [item.sessionId, item] as const))
      ),
    [navigationGroups]
  );
  const inheritedContextSource = useMemo(
    () => resolveInheritedContextSource(currentSessionSummary, messages),
    [currentSessionSummary, messages]
  );
  const inheritedContextParentTitle =
    inheritedContextSource?.parentSessionId
      ? sessionById.get(inheritedContextSource.parentSessionId)?.title?.trim()
        || t("conversation.inheritedContextParentFallback")
      : t("conversation.inheritedContextParentFallback");
  const timelineMessages = useMemo(() => {
    if (
      inheritedContextExpanded
      || !inheritedContextSource
      || inheritedContextSource.hiddenMessageCount <= 0
    ) {
      return messages;
    }

    return messages.filter(
      (message) => message.sequence > inheritedContextSource.hiddenSequenceBoundary
    );
  }, [inheritedContextExpanded, inheritedContextSource, messages]);
  const branchTreeWorkspaceId =
    currentSessionSummary?.workspaceId ?? navigationSession?.workspaceId ?? null;
  const branchTreeModel = useMemo(
    () => buildSessionBranchTreeModel(navigationGroups, branchTreeWorkspaceId, sessionId),
    [branchTreeWorkspaceId, navigationGroups, sessionId]
  );
  const hasBranchRelations = hasSessionBranchRelations(branchTreeModel);
  const canOpenBranchTree = Boolean(currentSessionSummary && branchTreeWorkspaceId && hasBranchRelations);
  const mobileArchivedSessions = useMemo(
    () =>
      mobileArchiveWorkspaceGroup?.sessions.filter(
        (item) => item.isArchived === true && !isRealSubagentSession(item)
      ) ?? [],
    [mobileArchiveWorkspaceGroup]
  );
  const mobileConversationMainRef = useRef<HTMLDivElement | null>(null);
  const mobileConversationPageRef = useRef<HTMLElement | null>(null);
  const mobileConversationHeaderRef = useRef<HTMLDivElement | null>(null);
  const [mobileComposerPanelElement, setMobileComposerPanelElement] = useState<HTMLElement | null>(null);
  const { composerPortalTarget } = useMobileConversationBottomLayer();
  useEffect(() => {
    store.applyNavigationSession(navigationSession);
  }, [navigationSession, store]);

  useEffect(() => {
    void store.initialize();

    return () => {
      store.destroy();
    };
  }, [store]);

  useEffect(() => {
    setSessionWorkspace(sessionId, session?.workspaceId ?? null);

    return () => {
      setSessionWorkspace(sessionId, null);
    };
  }, [session?.workspaceId, sessionId, setSessionWorkspace]);

  useEffect(() => {
    setBranchTreeOpen(false);
    setForkDraft(null);
    setInheritedContextExpanded(false);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!runtimeErrorCode || !runtimeErrorDetail) {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }

      pendingRuntimeErrorSignatureRef.current = null;
      lastRuntimeErrorSignatureRef.current = null;
      dismissToast("conversation-runtime-error");
      return;
    }

    const signature = `${runtimeErrorCode}:${runtimeErrorDetail}`;

    if (
      lastRuntimeErrorSignatureRef.current === signature
      || pendingRuntimeErrorSignatureRef.current === signature
    ) {
      return;
    }

    if (delayedRuntimeToastTimerRef.current !== null) {
      window.clearTimeout(delayedRuntimeToastTimerRef.current);
      delayedRuntimeToastTimerRef.current = null;
    }

    if (shouldDelayRuntimeErrorToast(session?.provider ?? null, runtimeErrorCode, runtimeErrorDetail)) {
      pendingRuntimeErrorSignatureRef.current = signature;
      delayedRuntimeToastTimerRef.current = window.setTimeout(() => {
        pendingRuntimeErrorSignatureRef.current = null;
        delayedRuntimeToastTimerRef.current = null;
        lastRuntimeErrorSignatureRef.current = signature;
        showToast({
          id: "conversation-runtime-error",
          title: t("conversation.runtimeErrorTitle"),
          description: runtimeErrorDetail,
          tone: "error",
          durationMs: null
        });
      }, RUNTIME_TIMEOUT_TOAST_DELAY_MS);
      return;
    }

    pendingRuntimeErrorSignatureRef.current = null;
    lastRuntimeErrorSignatureRef.current = signature;
    showToast({
      id: "conversation-runtime-error",
      title: t("conversation.runtimeErrorTitle"),
      description: runtimeErrorDetail,
      tone: "error",
      durationMs: null
    });
  }, [dismissToast, runtimeErrorCode, runtimeErrorDetail, session?.provider, showToast]);

  useEffect(() => {
    const previousRunningState = previousRunningStateRef.current;
    const nextRunningState = session?.runningState ?? null;
    const wasActive =
      previousRunningState === "starting"
      || previousRunningState === "running"
      || previousRunningState === "reconnecting";

    if (wasActive && nextRunningState === "completed") {
      void haptics.trigger("success");
    }

    previousRunningStateRef.current = nextRunningState;
  }, [haptics, session?.runningState]);

  useEffect(() => {
    const pendingRequests = permissionRequests.filter((request) => request.status === "pending");
    const sessionWorkspaceId = session?.workspaceId ?? navigationSession?.workspaceId ?? null;

    for (const request of pendingRequests) {
      if (notifiedPermissionRequestIdsRef.current.has(request.id)) {
        continue;
      }

      notifiedPermissionRequestIdsRef.current.add(request.id);
      if (!notifyOnPermissionRequest) {
        continue;
      }

      showToast({
        id: `permission-request-${request.id}`,
        title: t("conversation.permissionRequestToastTitle"),
        description: request.title,
        tone: "warning",
        durationMs: 8_000,
        action: sessionWorkspaceId
          ? {
              label: t("shell.contextOpenSession"),
              onClick: () => {
                navigate(buildWorkspaceSessionPath(sessionWorkspaceId, sessionId));
              }
            }
          : undefined
      });
      void platform.bridge.showNotification(
        t("conversation.permissionRequestToastTitle"),
        request.title
      );
    }
  }, [
    navigationSession?.workspaceId,
    navigate,
    notifyOnPermissionRequest,
    permissionRequests,
    platform.bridge,
    session?.workspaceId,
    sessionId,
    showToast
  ]);

  useMobileConversationComposerHeightVar(
    mobileConversationPageRef,
    mobileComposerPanelElement,
    !showInlineHeader,
    sessionId
  );
  useMobileConversationHeaderHeightVar(
    mobileConversationPageRef,
    mobileConversationHeaderRef,
    !showInlineHeader,
    sessionId
  );

  async function sendForkDraftMessage(
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: NonNullable<Parameters<typeof sendLiveMessage>[1]["attachments"]>;
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> {
    const activeForkDraft = forkDraft;

    if (!activeForkDraft) {
      await store.sendMessage(content, {
        model: options?.model,
        reasoningLevel: options?.reasoningLevel,
        attachments: options?.attachments,
        attachmentMeta: options?.attachmentMeta
      });
      requestNavigationRefresh();
      return;
    }

    let forkedSession: SessionSummaryDto | null = null;

    try {
      forkedSession = await forkSession(sessionId, {
        sourceType: "message",
        sourceMessageId: activeForkDraft.sourceMessageId,
        strategy: "auto",
        targetProvider: activeForkDraft.targetProvider
      });
      upsertNavigationSession(forkedSession);

      await sendLiveMessage(forkedSession.sessionId, {
        content,
        clientRequestId:
          globalThis.crypto?.randomUUID?.() ?? `fork-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        model: activeForkDraft.targetModel,
        reasoningLevel: options?.reasoningLevel ?? null,
        attachments: options?.attachments ?? []
      });

      setForkDraft(null);
      requestNavigationRefresh();
      selectWorkspace(forkedSession.workspaceId);
      writeMobileConversationPreviewMode("preview");
      navigate(buildWorkspaceSessionPath(forkedSession.workspaceId, forkedSession.sessionId));
      showToast({
        title: t("conversation.forkMessageSucceeded"),
        tone: "success"
      });
    } catch (error) {
      if (forkedSession) {
        upsertNavigationSession(forkedSession);
        requestNavigationRefresh();
      }

      throw error;
    }
  }

  return (
    <>
      <main
        ref={mobileConversationPageRef}
        className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page"
        data-mobile-shell={!showInlineHeader}
        data-preview-mode={!showInlineHeader ? mobilePreview.displayMode : undefined}
        data-preview-dragging={!showInlineHeader ? mobilePreview.isDragging : undefined}
        style={!showInlineHeader ? mobilePreview.pageStyle : undefined}
      >
        {showInlineHeader ? (
          <SessionHeader
            session={session ?? navigationSession}
            actions={<SessionButlerActionButton session={session ?? navigationSession} />}
          />
        ) : null}
        {!showInlineHeader ? (
          <MobileWorkspaceSwitcherHeader
            containerRef={mobileConversationHeaderRef}
            className="mobile-conversation-page-header"
            gestureHandlers={mobilePreview.mainGestureHandlers}
            currentWorkspace={mobileArchiveWorkspaceGroup?.workspace ?? mobileWorkspaces[0] ?? null}
            workspaces={mobileWorkspaces}
            heading={mobileSessionTitlePresentation.fullTitle}
            triggerAriaLabel={
              mobilePreview.displayMode === "preview"
                ? t("shell.hideSessionSidebar")
                : t("shell.showSessionSidebar")
            }
            onTriggerClick={() => {
              mobilePreview.togglePreview();
            }}
            trailing={
              <div className="mobile-conversation-toolbar-main">
                <span className="mobile-conversation-toolbar-title" title={mobileSessionTitlePresentation.fullTitle}>
                  {mobileSessionTitlePresentation.displayTitle}
                </span>
                <MobileConversationSessionActions
                  session={session ?? navigationSession}
                />
              </div>
            }
          />
        ) : null}
        {!showInlineHeader ? (
          <MobileConversationPreviewRail
            visible={mobilePreview.isVisible}
            widthPx={mobilePreview.previewWidthPx}
            isDragging={mobilePreview.isDragging}
            gestureHandlers={mobilePreview.railGestureHandlers}
            activeSessionId={mobilePreviewActiveSessionId}
            createSessionActionLabel={t("shell.createSession")}
            favoriteItems={mobileFavoritePreviewItems}
            items={mobilePreviewItems}
            workspaceSectionLabel={t("shell.mobileConversationCurrentWorkspaceSection")}
            onCreateSession={() => {
              setCreateSessionOpen(true);
            }}
            archiveCurrentActionLabel={t("shell.archiveCurrentSessionAction")}
            archiveFolderActionLabel={t("shell.archiveFolderAction")}
            onArchiveActiveSession={() => {
              setArchiveConfirmOpen(true);
            }}
            onOpenArchiveFolder={() => {
              setArchiveFolderOpen(true);
            }}
            onActivate={(entry) => {
              writeMobileConversationPreviewMode("preview");
              navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
            }}
          />
        ) : null}
        <div className="mobile-conversation-stage" {...(!showInlineHeader ? mobilePreview.mainGestureHandlers : {})}>
          <div ref={mobileConversationMainRef} className="mobile-conversation-main">
            <ConnectionBanner connectionState={connectionState} onReconnect={() => store.reconnect()} />
            <PermissionRequestList
              requests={permissionRequests}
              replyingRequestId={replyingPermissionRequestId}
              onReply={async (requestId, payload) => {
                setReplyingPermissionRequestId(requestId);

                try {
                  await store.replyPermissionRequest(requestId, payload);
                } catch (error) {
                  showToast({
                    title: t("conversation.permissionRequestReplyFailed"),
                    description: error instanceof Error ? error.message : undefined,
                    tone: "error"
                  });
                } finally {
                  setReplyingPermissionRequestId(null);
                }
              }}
            />
            {inheritedContextSource && inheritedContextSource.hiddenMessageCount > 0 ? (
              <InheritedContextBanner
                expanded={inheritedContextExpanded}
                hiddenMessageCount={inheritedContextSource.hiddenMessageCount}
                parentTitle={inheritedContextParentTitle}
                sourceType={inheritedContextSource.sourceType}
                onToggle={() => {
                  setInheritedContextExpanded((current) => !current);
                }}
                onOpenBranchTree={canOpenBranchTree ? () => setBranchTreeOpen(true) : undefined}
              />
            ) : null}
            <div className="conversation-timeline-shell">
              <MessageTimeline
                sessionId={sessionId}
                messages={timelineMessages}
                historyState={historyState}
                loadingOlderMessages={loadingOlderMessages}
                hasOlderMessages={hasOlderMessages}
                provider={session?.provider ?? null}
                runtimeThinkingPlaceholder={runtimeThinkingPlaceholder}
                onLoadOlderMessages={() => {
                  void store.loadOlderMessages();
                }}
                onRetryMessage={(clientRequestId: string) => {
                  void store.retryMessage(clientRequestId);
                }}
                onForkMessage={(message) => {
                  if (!session) {
                    return;
                  }

                  setForkDraft({
                    sourceMessageId: message.id,
                    content: message.content,
                    sourceProvider: session.provider,
                    workspaceId: session.workspaceId,
                    targetProvider: session.provider,
                    targetModel: null
                  });
                  focusComposerInput();
                }}
              />
            </div>
            <QueuedMessageList
              items={queuedMessages}
              deletingQueueItemId={deletingQueueItemId}
              steeringQueueItemId={steeringQueueItemId}
              canSteer={canSteerQueuedMessage}
              onDelete={async (queueItemId) => {
                setDeletingQueueItemId(queueItemId);

                try {
                  await store.deleteQueuedMessage(queueItemId);
                } finally {
                  setDeletingQueueItemId(null);
                }
              }}
              onSteer={async (queueItemId) => {
                setSteeringQueueItemId(queueItemId);

                try {
                  await store.steerQueuedMessage(queueItemId);
                  requestNavigationRefresh();
                } finally {
                  setSteeringQueueItemId(null);
                }
              }}
            />
            <ComposerPanel
              capabilities={capabilities}
              draftStorageId={sessionId}
              forkDraft={forkDraft}
              onClearForkDraft={() => setForkDraft(null)}
              onForkDraftChange={(nextDraft) => setForkDraft(nextDraft)}
              panelRef={!showInlineHeader ? setMobileComposerPanelElement : undefined}
              portalContainer={!showInlineHeader ? composerPortalTarget : null}
              hasActiveRun={runtimeHasActiveRun}
              contextUsage={contextUsage}
              hasPendingQueuedMessages={hasPendingQueuedMessages}
              canInterrupt={runtimeCanInterrupt}
              isSubmitting={sending}
              isRunning={isRunning}
              onInterrupt={async () => {
                await store.interrupt();
                requestNavigationRefresh();
              }}
              onSend={async (content, options) => {
                setSending(true);

                try {
                  await sendForkDraftMessage(content, {
                    model: options?.model,
                    reasoningLevel: options?.reasoningLevel,
                    attachments: options?.attachments,
                    attachmentMeta: options?.attachmentMeta
                  });
                } finally {
                  setSending(false);
                }
              }}
              onQueueSend={async (content, options) => {
                setSending(true);

                try {
                  if (forkDraft) {
                    await sendForkDraftMessage(content, {
                      model: options?.model,
                      reasoningLevel: options?.reasoningLevel,
                      attachments: options?.attachments,
                      attachmentMeta: options?.attachmentMeta
                    });
                  } else {
                    await store.enqueueMessage(content, {
                      model: options?.model,
                      reasoningLevel: options?.reasoningLevel,
                      attachments: options?.attachments,
                      attachmentMeta: options?.attachmentMeta
                    });
                  }
                } finally {
                  setSending(false);
                }
              }}
            />
          </div>
        </div>
      </main>
      <SessionBranchTreePanel
        open={branchTreeOpen}
        navigationGroups={navigationGroups}
        workspaceId={branchTreeWorkspaceId}
        sessionId={sessionId}
        onClose={() => setBranchTreeOpen(false)}
        onOpenSession={(targetSession) => {
          setBranchTreeOpen(false);
          selectWorkspace(targetSession.workspaceId);
          writeMobileConversationPreviewMode("preview");
          navigate(buildWorkspaceSessionPath(targetSession.workspaceId, targetSession.sessionId));
        }}
      />
      <ConversationArchiveConfirmModal
        open={archiveConfirmOpen}
        busy={archiveSubmitting}
        onClose={() => {
          if (archiveSubmitting) {
            return;
          }

          setArchiveConfirmOpen(false);
        }}
        onConfirm={async () => {
          if (archiveSubmitting) {
            return;
          }

          setArchiveSubmitting(true);

          try {
            await archiveSession(sessionId);
            setArchiveConfirmOpen(false);
            showToast({
              title: t("shell.archiveAdded"),
              tone: "success"
            });

            if (mobileWorkspaceId) {
              selectWorkspace(mobileWorkspaceId);
              writeMobileConversationPreviewMode("preview");
              navigate(buildWorkspaceSessionIndexPath(mobileWorkspaceId));
              return;
            }

            navigate("/workspaces");
          } catch (error) {
            showToast({
              title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
              tone: "error"
            });
          } finally {
            setArchiveSubmitting(false);
          }
        }}
      />
      <ConversationArchiveFolderModal
        open={archiveFolderOpen}
        workspaceName={mobileArchiveWorkspaceGroup?.workspace.name ?? null}
        sessions={mobileArchivedSessions}
        restoringSessionId={archiveRestoreSessionId}
        onClose={() => {
          if (archiveRestoreSessionId) {
            return;
          }

          setArchiveFolderOpen(false);
        }}
        onRestore={async (restoreSessionId) => {
          setArchiveRestoreSessionId(restoreSessionId);

          try {
            await unarchiveSession(restoreSessionId);
            showToast({
              title: t("shell.archiveRestored"),
              tone: "success"
            });
          } catch (error) {
            showToast({
              title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
              tone: "error"
            });
          } finally {
            setArchiveRestoreSessionId(null);
          }
        }}
      />
      <MobileCreateSessionSheet
        open={createSessionOpen}
        workspaces={mobileWorkspaces}
        initialWorkspaceId={mobileWorkspaceId}
        onClose={() => setCreateSessionOpen(false)}
        onSelect={(workspaceId, provider) => {
          setCreateSessionOpen(false);
          writeMobileConversationPreviewMode("immersive");
          startDraftSession(workspaceId, provider);
        }}
      />
    </>
  );
}

function shouldDelayRuntimeErrorToast(
  provider: ProviderId | null,
  errorCode: string,
  errorDetail: string
): boolean {
  if (provider !== "opencode") {
    return false;
  }

  return (
    errorCode === "OPENCODE_REQUEST_TIMEOUT"
    || errorCode === "PROVIDER_RUNTIME_TIMEOUT"
    || /\bSERVER_TIMEOUT\b/i.test(errorDetail)
    || /timeout/i.test(errorDetail)
    || /超时/.test(errorDetail)
  );
}

function focusComposerInput(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
}

function DraftConversationPage({
  draft,
  navigate
}: {
  draft: DraftConversationContext;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const {
    shellMode,
    navigationGroups,
    requestNavigationRefresh,
    selectWorkspace,
    setSessionWorkspace,
    upsertNavigationSession,
    favoriteSessions,
    startDraftSession
  } = useWorkbenchShell();
  const [sending, setSending] = useState(false);
  const [draftMessages, setDraftMessages] = useState<SessionMessageViewModel[]>([]);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const fallbackCapabilities = useMemo(
    () => createProviderDraftCapabilities(draft.provider),
    [draft.provider]
  );
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesDto>(fallbackCapabilities);
  const showInlineHeader = shellMode !== "mobile";
  const mobilePreview = useMobileConversationPreviewController(!showInlineHeader);
  const session = useMemo(() => createDraftSessionSummary(draft), [draft]);
  const mobileFavoriteSessionIdSet = useMemo(
    () => new Set(favoriteSessions.map((item) => item.session.sessionId)),
    [favoriteSessions]
  );
  const mobileWorkspaces = useMemo(
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );
  const mobileSessionTitlePresentation = useMemo(
    () => buildSessionTitlePresentation(session.title ?? null, t("conversation.titleFallback")),
    [session]
  );
  const mobilePreviewItems = useMemo(
    () => buildMobilePreviewItems(navigationGroups, draft.workspaceId, mobileFavoriteSessionIdSet),
    [draft.workspaceId, mobileFavoriteSessionIdSet, navigationGroups]
  );
  const mobileFavoritePreviewItems = useMemo(
    () => buildMobileFavoritePreviewItems(favoriteSessions),
    [favoriteSessions]
  );
  const mobileConversationMainRef = useRef<HTMLDivElement | null>(null);
  const mobileConversationPageRef = useRef<HTMLElement | null>(null);
  const mobileConversationHeaderRef = useRef<HTMLDivElement | null>(null);
  const [mobileComposerPanelElement, setMobileComposerPanelElement] = useState<HTMLElement | null>(null);
  const { composerPortalTarget } = useMobileConversationBottomLayer();

  useEffect(() => {
    setSessionWorkspace(draft.sessionId, draft.workspaceId);

    return () => {
      setSessionWorkspace(draft.sessionId, null);
    };
  }, [draft.sessionId, draft.workspaceId, setSessionWorkspace]);

  useEffect(() => {
    let disposed = false;

    // 草稿页先用本地兜底能力，随后再按 provider + workspace 拉真实模型列表。
    setCapabilities(fallbackCapabilities);

    void getProviderCapabilities(draft.provider, draft.workspaceId)
      .then((nextCapabilities) => {
        if (!disposed) {
          setCapabilities(nextCapabilities);
        }
      })
      .catch(() => {
        return;
      });

    return () => {
      disposed = true;
    };
  }, [draft.provider, draft.workspaceId, fallbackCapabilities]);

  useMobileConversationComposerHeightVar(
    mobileConversationPageRef,
    mobileComposerPanelElement,
    !showInlineHeader,
    draft.sessionId
  );
  useMobileConversationHeaderHeightVar(
    mobileConversationPageRef,
    mobileConversationHeaderRef,
    !showInlineHeader,
    draft.sessionId
  );

  return (
    <>
    <main
      ref={mobileConversationPageRef}
      className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page"
      data-mobile-shell={!showInlineHeader}
      data-preview-mode={!showInlineHeader ? mobilePreview.displayMode : undefined}
      data-preview-dragging={!showInlineHeader ? mobilePreview.isDragging : undefined}
      style={!showInlineHeader ? mobilePreview.pageStyle : undefined}
    >
      {showInlineHeader ? (
        <SessionHeader
          session={session}
        />
      ) : null}
      {!showInlineHeader ? (
        <MobileWorkspaceSwitcherHeader
          containerRef={mobileConversationHeaderRef}
          className="mobile-conversation-page-header"
          gestureHandlers={mobilePreview.mainGestureHandlers}
          currentWorkspace={mobileWorkspaces.find((workspace) => workspace.id === draft.workspaceId) ?? mobileWorkspaces[0] ?? null}
          workspaces={mobileWorkspaces}
          heading={mobileSessionTitlePresentation.fullTitle}
          triggerAriaLabel={
            mobilePreview.displayMode === "preview"
              ? t("shell.hideSessionSidebar")
              : t("shell.showSessionSidebar")
          }
          onTriggerClick={() => {
            mobilePreview.togglePreview();
          }}
          trailing={
            <span className="mobile-conversation-toolbar-title" title={mobileSessionTitlePresentation.fullTitle}>
              {mobileSessionTitlePresentation.displayTitle}
            </span>
          }
        />
      ) : null}
      {!showInlineHeader ? (
        <MobileConversationPreviewRail
          visible={mobilePreview.isVisible}
          widthPx={mobilePreview.previewWidthPx}
          isDragging={mobilePreview.isDragging}
          gestureHandlers={mobilePreview.railGestureHandlers}
          activeSessionId={draft.sessionId}
          createSessionActionLabel={t("shell.createSession")}
          favoriteItems={mobileFavoritePreviewItems}
          items={mobilePreviewItems}
          workspaceSectionLabel={t("shell.mobileConversationCurrentWorkspaceSection")}
          onCreateSession={() => {
            setCreateSessionOpen(true);
          }}
          onActivate={(entry) => {
            writeMobileConversationPreviewMode("preview");
            navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
          }}
        />
      ) : null}
      <div className="mobile-conversation-stage" {...(!showInlineHeader ? mobilePreview.mainGestureHandlers : {})}>
        <div ref={mobileConversationMainRef} className="mobile-conversation-main">
          <ConnectionBanner connectionState="closed" onReconnect={() => {}} />
            <div className="conversation-timeline-shell">
              <MessageTimeline
                sessionId={draft.sessionId}
                messages={draftMessages}
                historyState="ready"
                loadingOlderMessages={false}
                hasOlderMessages={false}
                provider={draft.provider}
                runtimeThinkingPlaceholder={null}
                onLoadOlderMessages={() => {}}
                onRetryMessage={() => {}}
              />
            </div>
          <ComposerPanel
            capabilities={capabilities}
            draftStorageId={draft.sessionId}
            panelRef={!showInlineHeader ? setMobileComposerPanelElement : undefined}
            portalContainer={!showInlineHeader ? composerPortalTarget : null}
            contextUsage={null}
            isSubmitting={sending}
            isRunning={false}
            onSend={async (content, options) => {
              const clientRequestId = createClientRequestId();
              setDraftMessages((current) => [
                ...current,
                createPendingMessage(
                  draft.sessionId,
                  content,
                  clientRequestId,
                  options?.attachmentMeta ?? [],
                  options?.attachments ?? []
                )
              ]);
              setSending(true);
              const startLiveStartedAtMs = performance.now();
              logPerfDebug("session_send.start_live.client_start", {
                draftSessionId: draft.sessionId,
                workspaceId: draft.workspaceId,
                provider: draft.provider,
                clientRequestId,
                contentLength: content.length
              });

              try {
                const permissionMode = userPreferenceStore.getState().profile.defaultPermissionMode;
                const created = await startLiveSession({
                  workspaceId: draft.workspaceId,
                  provider: draft.provider,
                  content,
                  clientRequestId,
                  model: options?.model ?? null,
                  reasoningLevel: options?.reasoningLevel ?? null,
                  permissionMode: permissionMode === "default" ? null : permissionMode,
                  attachments: options?.attachments ?? []
                });
                logPerfDebug("session_send.start_live.client_response", {
                  draftSessionId: draft.sessionId,
                  sessionId: created.sessionId,
                  workspaceId: created.session?.workspaceId ?? draft.workspaceId,
                  provider: created.provider,
                  clientRequestId,
                  durationMs: Math.round(performance.now() - startLiveStartedAtMs),
                  returnedMessageId: created.message?.messageId ?? null
                });

                if (created.session) {
                  upsertNavigationSession(created.session);
                }

                const resolvedWorkspaceId = created.session?.workspaceId?.trim() || draft.workspaceId;

                setSessionWorkspace(created.sessionId, resolvedWorkspaceId);
                writeMobileConversationPreviewMode("preview");
                navigate(buildWorkspaceSessionPath(resolvedWorkspaceId, created.sessionId), {
                  replace: true,
                  state: created.message
                    ? {
                        bootstrap: {
                          sessionId: created.sessionId,
                          messages: [created.message]
                        }
                      }
                    : null
                });
                requestNavigationRefresh();
              } catch (error) {
                logPerfDebug("session_send.start_live.client_error", {
                  draftSessionId: draft.sessionId,
                  workspaceId: draft.workspaceId,
                  provider: draft.provider,
                  clientRequestId,
                  durationMs: Math.round(performance.now() - startLiveStartedAtMs),
                  error: error instanceof Error ? error.message : String(error)
                });
                setDraftMessages((current) => markPendingAsFailed(current, clientRequestId));
                throw error;
              } finally {
                setSending(false);
              }
            }}
          />
        </div>
      </div>
    </main>
    <MobileCreateSessionSheet
      open={createSessionOpen}
      workspaces={mobileWorkspaces}
      initialWorkspaceId={draft.workspaceId}
      onClose={() => setCreateSessionOpen(false)}
      onSelect={(workspaceId, provider) => {
        setCreateSessionOpen(false);
        writeMobileConversationPreviewMode("immersive");
        startDraftSession(workspaceId, provider);
      }}
    />
    </>
  );
}

interface DraftConversationContext {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
}

function parseDraftContext(
  sessionId: string,
  routeWorkspaceId: string | null,
  searchParams: URLSearchParams,
  fallbackProvider: ProviderId | null = null
): DraftConversationContext | null {
  if (!isDraftSessionId(sessionId)) {
    return null;
  }

  const workspaceId = routeWorkspaceId ?? searchParams.get("workspaceId")?.trim() ?? null;
  const provider = searchParams.get("provider")?.trim() ?? fallbackProvider ?? null;

  if (!workspaceId || !isDraftProviderSupported(provider)) {
  return null;
}

  return {
    sessionId,
    workspaceId,
    provider: provider as ProviderId
  };
}

function createDraftSessionSummary(draft: DraftConversationContext): SessionSummaryDto {
  const timestamp = new Date().toISOString();

  return {
    sessionId: draft.sessionId,
    workspaceId: draft.workspaceId,
    provider: draft.provider,
    providerSessionId: `draft://${draft.sessionId}`,
    rawStoreRef: `draft://${draft.sessionId}`,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    title: getProviderDraftTitle(draft.provider),
    messageCount: 0,
    lastMessageAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

function buildMobilePreviewItems(
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"],
  workspaceId: string | null,
  excludedSessionIds: ReadonlySet<string>
) {
  if (!workspaceId) {
    return [] as Array<{
      entry: WorkbenchNavigationEntry;
      depth: 0 | 1;
    }>;
  }

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId);

  if (!workspaceGroup) {
    return [] as Array<{
      entry: WorkbenchNavigationEntry;
      depth: 0 | 1;
    }>;
  }

  return flattenNavigationSessions([workspaceGroup])
    .filter(
      (entry) =>
        !entry.session.isArchived
        && !isRealSubagentSession(entry.session)
        && !excludedSessionIds.has(entry.session.sessionId)
    )
    .map((entry) => ({
      entry,
      depth: 0 as const
    }));
}

function buildMobileFavoritePreviewItems(
  favoriteSessions: readonly WorkbenchNavigationEntry[]
) {
  return favoriteSessions
    .filter((item) => !isRealSubagentSession(item.session))
    .map((entry) => ({
      entry,
      depth: 0 as const
    }));
}

function resolveMobilePreviewActiveSessionId(
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"],
  workspaceId: string | null,
  sessionId: string
) {
  if (!workspaceId) {
    return sessionId;
  }

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId);

  if (!workspaceGroup) {
    return sessionId;
  }

  const sessionById = new Map(workspaceGroup.sessions.map((item) => [item.sessionId, item] as const));
  let currentSession = sessionById.get(sessionId);

  if (!currentSession) {
    return sessionId;
  }

  const visitedSessionIds = new Set<string>([currentSession.sessionId]);

  while (true) {
    const parentSessionId = currentSession.parentSessionId?.trim() || null;

    if (!parentSessionId) {
      return currentSession.sessionId;
    }

    const parentSession = sessionById.get(parentSessionId);

    if (!parentSession || visitedSessionIds.has(parentSession.sessionId)) {
      return currentSession.sessionId;
    }

    visitedSessionIds.add(parentSession.sessionId);
    currentSession = parentSession;
  }
}

function useMobileConversationComposerHeightVar(
  rootRef: RefObject<HTMLElement | null>,
  composerPanelElement: HTMLElement | null,
  enabled: boolean,
  resetKey: string
) {
  useEffect(() => {
    const rootElement = rootRef.current;

    if (!enabled || !rootElement) {
      if (rootElement) {
        rootElement.style.removeProperty("--mobile-conversation-composer-height");
      }
      return;
    }

    if (!composerPanelElement) {
      rootElement.style.removeProperty("--mobile-conversation-composer-height");
      return;
    }

    const stableRootElement = rootElement;
    const stableComposerPanel = composerPanelElement;

    function syncComposerHeight() {
      if (!rootRef.current || !stableComposerPanel.isConnected) {
        return;
      }

      stableRootElement.style.setProperty(
        "--mobile-conversation-composer-height",
        `${stableComposerPanel.offsetHeight}px`
      );
    }

    syncComposerHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncComposerHeight) : null;

    resizeObserver?.observe(stableComposerPanel);
    window.addEventListener("resize", syncComposerHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncComposerHeight);
      rootElement.style.removeProperty("--mobile-conversation-composer-height");
    };
  }, [composerPanelElement, enabled, resetKey, rootRef]);
}

function useMobileConversationHeaderHeightVar(
  rootRef: RefObject<HTMLElement | null>,
  headerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string
) {
  useEffect(() => {
    const rootElement = rootRef.current;
    const headerElement = headerRef.current;

    if (!enabled || !rootElement) {
      if (rootElement) {
        rootElement.style.removeProperty("--mobile-conversation-page-header-height");
      }
      return;
    }

    if (!headerElement) {
      rootElement.style.removeProperty("--mobile-conversation-page-header-height");
      return;
    }

    const stableRootElement = rootElement;
    const stableHeaderElement = headerElement;

    function syncHeaderHeight() {
      if (!rootRef.current || !stableHeaderElement.isConnected) {
        return;
      }

      stableRootElement.style.setProperty(
        "--mobile-conversation-page-header-height",
        `${stableHeaderElement.offsetHeight}px`
      );
    }

    syncHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeaderHeight) : null;

    resizeObserver?.observe(stableHeaderElement);
    window.addEventListener("resize", syncHeaderHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncHeaderHeight);
      rootElement.style.removeProperty("--mobile-conversation-page-header-height");
    };
  }, [enabled, headerRef, resetKey, rootRef]);
}

interface MobileConversationPreviewGestureHandlers {
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel: (event: ReactTouchEvent<HTMLElement>) => void;
}

function useMobileConversationPreviewController(enabled: boolean) {
  const haptics = useHaptics();
  const [previewMode, setPreviewMode] = useState<MobileConversationPreviewMode>(() =>
    enabled ? readMobileConversationPreviewMode() : "immersive"
  );
  const [viewportWidth, setViewportWidth] = useState(() => resolvePreviewViewportWidth());
  const [previewWidthMode, setPreviewWidthMode] = useState<"closed" | "default" | "expanded">(() =>
    enabled && readMobileConversationPreviewMode() === "preview" ? "default" : "closed"
  );
  const previewWidthModeRef = useRef(previewWidthMode);
  const gestureRef = useRef<{
    source: "main" | "rail";
    intent: "open" | "close" | "rail";
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    horizontalLocked: boolean;
  } | null>(null);

  useEffect(() => {
    previewWidthModeRef.current = previewWidthMode;
  }, [previewWidthMode]);

  useEffect(() => {
    if (!enabled) {
      gestureRef.current = null;
      previewWidthModeRef.current = "closed";
      setPreviewWidthMode("closed");
      setPreviewMode("immersive");
      return;
    }

    const storedMode = readMobileConversationPreviewMode();
    setPreviewMode(storedMode);
    setPreviewWidthMode(storedMode === "preview" ? "default" : "closed");
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    writeMobileConversationPreviewMode(previewMode);
  }, [enabled, previewMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleResize() {
      setViewportWidth(resolvePreviewViewportWidth());
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  function setPreviewWidthState(nextMode: "closed" | "default" | "expanded") {
    previewWidthModeRef.current = nextMode;
    setPreviewWidthMode(nextMode);
  }

  function openPreview(nextMode: "default" | "expanded" = "default") {
    setPreviewWidthState(nextMode);
    setPreviewMode("preview");
  }

  function closePreview() {
    setPreviewWidthState("closed");
    setPreviewMode("immersive");
  }

  function expandPreview() {
    setPreviewWidthState("expanded");
    setPreviewMode("preview");
  }

  function togglePreview() {
    if (previewWidthModeRef.current !== "closed") {
      void haptics.trigger("gesture");
      closePreview();
      return;
    }

    void haptics.trigger("gesture");
    openPreview();
  }

  function handleTouchStart(source: "main" | "rail", event: ReactTouchEvent<HTMLElement>) {
    if (!enabled || event.touches.length !== 1) {
      gestureRef.current = null;
      return;
    }

    if (shouldIgnorePreviewGestureTarget(event.target)) {
      gestureRef.current = null;
      return;
    }

    const touch = event.touches[0];

    if (!touch) {
      gestureRef.current = null;
      return;
    }

    if (source === "main") {
      if (
        previewWidthModeRef.current === "closed"
        && touch.clientX > MOBILE_PREVIEW_EDGE_ACTIVATION_PX
      ) {
        gestureRef.current = null;
        return;
      }
    } else if (previewWidthModeRef.current === "closed") {
      gestureRef.current = null;
      return;
    }

    gestureRef.current = {
      source,
      intent:
        source === "rail"
          ? "rail"
          : previewWidthModeRef.current === "closed"
            ? "open"
            : "close",
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      horizontalLocked: false
    };
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    const touch = event.touches[0];

    if (!enabled || !gesture || !touch) {
      return;
    }

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    gesture.lastX = touch.clientX;
    gesture.lastY = touch.clientY;

    if (!gesture.horizontalLocked) {
      if (
        Math.abs(deltaX) < MOBILE_PREVIEW_GESTURE_DIRECTION_LOCK_PX
        && Math.abs(deltaY) < MOBILE_PREVIEW_GESTURE_DIRECTION_LOCK_PX
      ) {
        return;
      }

      if (Math.abs(deltaX) <= Math.abs(deltaY)) {
        gestureRef.current = null;
        return;
      }

      if (gesture.intent === "open" && deltaX <= 0) {
        gestureRef.current = null;
        return;
      }

      if (gesture.intent === "close" && deltaX >= 0) {
        gestureRef.current = null;
        return;
      }

      gesture.horizontalLocked = true;
    }

  }

  function settlePreviewGesture(event?: ReactTouchEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    gestureRef.current = null;

    if (!gesture?.horizontalLocked) {
      return;
    }

    const endTouch = event?.changedTouches?.[0];

    if (endTouch) {
      gesture.lastX = endTouch.clientX;
      gesture.lastY = endTouch.clientY;
    }

    const deltaX = gesture.lastX - gesture.startX;

    if (gesture.intent === "open") {
      if (deltaX >= MOBILE_PREVIEW_OPEN_THRESHOLD_PX) {
        void haptics.trigger("gesture");
        openPreview("default");
      }
      return;
    }

    if (gesture.intent === "close") {
      if (deltaX <= -MOBILE_PREVIEW_CLOSE_THRESHOLD_PX) {
        void haptics.trigger("gesture");
        closePreview();
      }
      return;
    }

    if (deltaX <= -MOBILE_PREVIEW_CLOSE_THRESHOLD_PX) {
      void haptics.trigger("gesture");
      closePreview();
      return;
    }

    if (
      deltaX >= MOBILE_PREVIEW_EXPAND_THRESHOLD_PX
      && previewWidthModeRef.current === "default"
    ) {
      void haptics.trigger("gesture");
      expandPreview();
    }
  }

  const previewWidthRatio =
    previewWidthMode === "expanded"
      ? MOBILE_PREVIEW_MAX_RATIO
      : previewWidthMode === "default"
        ? MOBILE_PREVIEW_DEFAULT_RATIO
        : 0;
  const previewWidthPx = Math.round(viewportWidth * previewWidthRatio * 100) / 100;
  const previewProgress = previewWidthRatio === 0 ? 0 : previewWidthRatio / MOBILE_PREVIEW_MAX_RATIO;
  const pageStyle = {
    "--mobile-conversation-preview-default-width": `${Math.round(viewportWidth * MOBILE_PREVIEW_DEFAULT_RATIO * 100) / 100}px`,
    "--mobile-conversation-preview-max-width": `${Math.round(viewportWidth * MOBILE_PREVIEW_MAX_RATIO * 100) / 100}px`,
    "--mobile-conversation-preview-width": `${previewWidthPx}px`,
    "--mobile-conversation-preview-progress": previewProgress.toFixed(4)
  } as CSSProperties;

  const mainGestureHandlers: MobileConversationPreviewGestureHandlers = {
    onTouchStart: (event) => handleTouchStart("main", event),
    onTouchMove: handleTouchMove,
    onTouchEnd: settlePreviewGesture,
    onTouchCancel: settlePreviewGesture
  };
  const railGestureHandlers: MobileConversationPreviewGestureHandlers = {
    onTouchStart: (event) => handleTouchStart("rail", event),
    onTouchMove: handleTouchMove,
    onTouchEnd: settlePreviewGesture,
    onTouchCancel: settlePreviewGesture
  };

  return {
    closePreview,
    displayMode: previewWidthMode === "closed" ? "immersive" : "preview",
    isDragging: false,
    isVisible: previewWidthMode !== "closed",
    mainGestureHandlers,
    pageStyle,
    previewWidthPx,
    railGestureHandlers,
    togglePreview
  };
}

function MobileConversationPreviewRail({
  visible,
  widthPx,
  isDragging,
  gestureHandlers,
  activeSessionId,
  createSessionActionLabel,
  favoriteItems,
  items,
  workspaceSectionLabel,
  onCreateSession,
  archiveCurrentActionLabel,
  archiveFolderActionLabel,
  onArchiveActiveSession,
  onOpenArchiveFolder,
  onActivate
}: {
  visible: boolean;
  widthPx: number;
  isDragging: boolean;
  gestureHandlers: MobileConversationPreviewGestureHandlers;
  activeSessionId: string;
  createSessionActionLabel?: string;
  favoriteItems: Array<{
    entry: WorkbenchNavigationEntry;
    depth: 0 | 1;
  }>;
  items: Array<{
    entry: WorkbenchNavigationEntry;
    depth: 0 | 1;
  }>;
  workspaceSectionLabel: string;
  onCreateSession?: (() => void) | null;
  archiveCurrentActionLabel?: string;
  archiveFolderActionLabel?: string;
  onArchiveActiveSession?: (() => void | Promise<void>) | null;
  onOpenArchiveFolder?: (() => void) | null;
  onActivate: (entry: WorkbenchNavigationEntry) => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <aside
      className="mobile-conversation-preview-rail terminal-mobile-list-rail surface-card"
      data-dragging={isDragging}
      style={{ width: `${widthPx}px`, maxWidth: `${widthPx}px` }}
      {...gestureHandlers}
    >
      {createSessionActionLabel && onCreateSession ? (
        <div className="mobile-conversation-preview-topbar terminal-mobile-list-footer">
          <button
            type="button"
            className="mobile-conversation-preview-create-button workbench-import-toggle terminal-mobile-list-create"
            onClick={onCreateSession}
          >
            <span className="workbench-import-toggle-symbol" aria-hidden="true">
              +
            </span>
            <span className="workbench-import-toggle-label">{createSessionActionLabel}</span>
          </button>
        </div>
      ) : null}

      <div className="mobile-conversation-preview-body terminal-mobile-list-body">
        {favoriteItems.length > 0 ? (
          <section className="mobile-conversation-preview-group mobile-conversation-preview-list-favorites terminal-mobile-list-group terminal-mobile-list-group-pinned">
            <div className="mobile-conversation-preview-group-heading terminal-mobile-list-group-heading">
              <span>{t("shell.favoriteSectionTitle")}</span>
              <span className="workbench-section-counter">{favoriteItems.length}</span>
            </div>
            <div className="mobile-conversation-preview-list mobile-conversation-preview-list-static terminal-mobile-session-list">
              {favoriteItems.map((item) => (
                <MobileConversationPreviewEntryButton
                  key={`favorite:${item.entry.workspace.id}:${item.entry.session.sessionId}`}
                  entry={item.entry}
                  depth={item.depth}
                  activeSessionId={activeSessionId}
                  onActivate={onActivate}
                  workspaceName={item.entry.workspace.name}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mobile-conversation-preview-group mobile-conversation-preview-group-workspace terminal-mobile-list-group terminal-mobile-list-group-workspace">
          <div className="mobile-conversation-preview-group-heading terminal-mobile-list-group-heading">
            <span>{workspaceSectionLabel}</span>
            <span className="workbench-section-counter">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</div>
          ) : (
            <div
              className="mobile-conversation-preview-list terminal-mobile-session-list"
              data-preview-gesture="ignore"
            >
              {items.map((item) => (
                <MobileConversationPreviewEntryButton
                  key={`${item.entry.workspace.id}:${item.entry.session.sessionId}`}
                  entry={item.entry}
                  depth={item.depth}
                  activeSessionId={activeSessionId}
                  onActivate={onActivate}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {(archiveCurrentActionLabel && onArchiveActiveSession) || (archiveFolderActionLabel && onOpenArchiveFolder) ? (
        <div className="mobile-conversation-preview-actions terminal-mobile-list-footer">
          {archiveCurrentActionLabel && onArchiveActiveSession ? (
            <button
              type="button"
              className="mobile-conversation-preview-archive-button workbench-import-toggle"
              onClick={() => {
                void onArchiveActiveSession();
              }}
            >
              {archiveCurrentActionLabel}
            </button>
          ) : null}
          {archiveFolderActionLabel && onOpenArchiveFolder ? (
            <button
              type="button"
              className="mobile-conversation-preview-archive-button workbench-import-toggle"
              onClick={onOpenArchiveFolder}
            >
              {archiveFolderActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function MobileConversationPreviewEntryButton({
  entry,
  depth,
  activeSessionId,
  onActivate,
  workspaceName
}: {
  entry: WorkbenchNavigationEntry;
  depth: 0 | 1;
  activeSessionId: string;
  onActivate: (entry: WorkbenchNavigationEntry) => void;
  workspaceName?: string;
}) {
  const isActive = entry.session.sessionId === activeSessionId;

  return (
    <article className="mobile-conversation-preview-entry terminal-mobile-session-card" data-active={isActive}>
      <button
        type="button"
        className="mobile-conversation-preview-item terminal-mobile-session-primary"
        data-active={isActive}
        data-depth={depth}
        onClick={() => onActivate(entry)}
      >
        <span
          className={resolvePreviewIndicatorClassName(entry.session, isActive)}
          aria-hidden="true"
        />
        <div className="mobile-conversation-preview-item-body">
          <span className="mobile-conversation-preview-item-title">
            {entry.session.title || t("common.unknown")}
          </span>
          <span className="mobile-conversation-preview-item-meta">
            {formatMobilePreviewMeta(entry.session, workspaceName)}
          </span>
        </div>
      </button>
    </article>
  );
}

function resolvePreviewViewportWidth() {
  if (typeof window === "undefined") {
    return 390;
  }

  return Math.max(window.innerWidth || 390, 320);
}

function shouldIgnorePreviewGestureTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, option, label, [contenteditable='true'], [data-preview-gesture='ignore']"
    )
  );
}

function resolvePreviewIndicatorClassName(
  session: Pick<
    SessionSummaryDto,
    | "runningState"
    | "activityState"
    | "activitySource"
    | "activityResolutionSource"
    | "lastErrorCode"
    | "lastErrorDetail"
  >,
  isActive: boolean
) {
  const className = resolveSessionIndicatorClassName("mobile-conversation-preview-indicator", session);

  if (className.endsWith(" is-idle") && isActive) {
    return "mobile-conversation-preview-indicator is-active";
  }

  return className;
}

function formatMobilePreviewMeta(
  session: Pick<
    SessionSummaryDto,
    | "provider"
    | "lastMessageAt"
    | "updatedAt"
    | "runningState"
    | "activityState"
    | "activitySource"
    | "activityResolutionSource"
    | "lastErrorCode"
    | "lastErrorDetail"
  >,
  workspaceName?: string | null
) {
  const activityBadgeLabel = resolveSessionActivityBadgeLabel(session);

  return [
    workspaceName ?? null,
    getProviderDisplayName(session.provider),
    formatMobilePreviewTime(session.lastMessageAt ?? session.updatedAt),
    activityBadgeLabel
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatMobilePreviewTime(value: string | null) {
  if (!value) {
    return t("common.unknown");
  }

  return new Date(value).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function ConversationArchiveConfirmModal({
  open,
  busy,
  onClose,
  onConfirm
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        disabled={busy}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.archiveConfirmTitle")}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{t("shell.archiveConfirmTitle")}</h2>
            <p>{t("shell.archiveConfirmDescription")}</p>
          </div>
        </div>
        <div className="workbench-modal-body">
          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="secondary-button workbench-danger-button"
              disabled={busy}
              onClick={() => {
                void onConfirm();
              }}
            >
              {t("shell.archiveAction")}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ConversationArchiveFolderModal({
  open,
  workspaceName,
  sessions,
  restoringSessionId,
  onClose,
  onRestore
}: {
  open: boolean;
  workspaceName: string | null;
  sessions: SessionSummaryDto[];
  restoringSessionId: string | null;
  onClose: () => void;
  onRestore: (sessionId: string) => void | Promise<void>;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !restoringSessionId) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, restoringSessionId]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        disabled={Boolean(restoringSessionId)}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.archiveModalTitle")}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{t("shell.archiveModalTitle")}</h2>
            <p>
              {workspaceName
                ? `${workspaceName} · ${t("shell.archiveModalDescription")}`
                : t("shell.archiveModalDescription")}
            </p>
          </div>
        </div>
        <div className="workbench-modal-body">
          {sessions.length > 0 ? (
            <div className="workbench-archive-list">
              {sessions.map((session) => {
                const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));

                return (
                  <article key={session.sessionId} className="workbench-archive-item">
                    <div className="workbench-archive-item-main">
                      <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                      <p>{formatMobilePreviewMeta(session)}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={restoringSessionId === session.sessionId}
                      onClick={() => {
                        void onRestore(session.sessionId);
                      }}
                    >
                      {t("shell.unarchiveAction")}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="workbench-section-empty">{t("shell.archiveEmpty")}</p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

function InheritedContextBanner(input: {
  expanded: boolean;
  hiddenMessageCount: number;
  parentTitle: string;
  sourceType: "session" | "message";
  onToggle: () => void;
  onOpenBranchTree?: (() => void) | undefined;
}) {
  const summaryText = t("conversation.inheritedContextSummary", {
    count: input.hiddenMessageCount,
    parentTitle: input.parentTitle
  });

  return (
    <section className="conversation-inherited-context-banner">
      <div className="conversation-inherited-context-copy">
        <p title={summaryText}>
          {summaryText}
        </p>
      </div>
      <div className="conversation-inherited-context-actions">
        {input.hiddenMessageCount > 0 ? (
          <button
            type="button"
            className="conversation-inherited-context-icon-button"
            aria-label={
              input.expanded
                ? t("conversation.inheritedContextCollapse")
                : t("conversation.inheritedContextExpand")
            }
            title={
              input.expanded
                ? t("conversation.inheritedContextCollapse")
                : t("conversation.inheritedContextExpand")
            }
            onClick={input.onToggle}
          >
            <span className="conversation-header-ai-button-label" aria-hidden="true">
              <ContextExpandActionIcon expanded={input.expanded} />
            </span>
          </button>
        ) : null}
        {input.onOpenBranchTree ? (
          <button
            type="button"
            className="conversation-inherited-context-icon-button"
            aria-label={t("conversation.branchTreeAction")}
            title={t("conversation.branchTreeAction")}
            onClick={input.onOpenBranchTree}
          >
            <span className="conversation-header-ai-button-label" aria-hidden="true">
              <BranchTreeActionIcon />
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function isSessionRunning(session: SessionSummaryDto | null): boolean {
  if (!session) {
    return false;
  }

  if (session.activityState === "running") {
    return true;
  }

  return (
    session.runningState === "starting"
    || session.runningState === "running"
    || session.runningState === "reconnecting"
  );
}

function useStableRuntimeThinkingPlaceholder(input: {
  sessionId: string;
  provider: ProviderId | null;
  runningState: string | null;
  activityState: string | null | undefined;
  runtimeHasActiveRun: boolean | null;
  messages: SessionMessageViewModel[];
}): boolean {
  const visibility = resolveRuntimeThinkingPlaceholderVisibility(input);
  const [visible, setVisible] = useState(visibility === "show");
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    setVisible(visibility === "show");
  }, [input.sessionId]);

  useEffect(() => {
    if (visibility === "show") {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setVisible(true);
      return;
    }

    if (visibility === "hide_immediately") {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setVisible(false);
      return;
    }

    if (!visible || hideTimerRef.current !== null) {
      return;
    }

    // 这里专门吃掉 runtime 边界抖动，避免底部占位在一两帧内反复闪现。
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisible(false);
    }, RUNTIME_THINKING_PLACEHOLDER_HIDE_DELAY_MS);
  }, [visibility, visible]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return visible;
}

function resolveRuntimeThinkingPlaceholderVisibility(
  input: {
    provider: ProviderId | null;
    runningState: string | null;
    activityState: string | null | undefined;
    runtimeHasActiveRun: boolean | null;
    messages: SessionMessageViewModel[];
  }
): "show" | "hide_immediately" | "hide_deferred" {
  const { provider, runningState, activityState, runtimeHasActiveRun, messages } = input;

  if (provider !== "codex") {
    return "hide_immediately";
  }

  const latestUserIndex = findLatestRuntimePlaceholderUserIndex(messages);

  if (latestUserIndex < 0) {
    return "hide_immediately";
  }

  if (hasAssistantReplyAfterUser(messages, latestUserIndex)) {
    return "hide_immediately";
  }

  if (hasActiveRuntimeIndicator(runningState, activityState, runtimeHasActiveRun)) {
    return "show";
  }

  return "hide_deferred";
}

function hasActiveRuntimeIndicator(
  runningState: string | null,
  activityState: string | null | undefined,
  runtimeHasActiveRun: boolean | null
): boolean {
  return (
    runtimeHasActiveRun === true
    || activityState === "running"
    || runningState === "starting"
    || runningState === "running"
    || runningState === "reconnecting"
  );
}

function hasAssistantReplyAfterUser(
  messages: SessionMessageViewModel[],
  latestUserIndex: number
): boolean {
  return messages.slice(latestUserIndex + 1).some((message) => {
    return message.role === "assistant" && (message.kind === "text" || message.kind === "thinking");
  });
}

function findLatestRuntimePlaceholderUserIndex(
  messages: SessionMessageViewModel[]
): number {
  let latestUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "user" && message.kind === "text") {
      latestUserIndex = index;
      break;
    }
  }

  return latestUserIndex;
}

function isDraftSessionId(sessionId: string): boolean {
  return sessionId.startsWith("draft-");
}

function parseLiveBootstrapMessages(sessionId: string, state: unknown): HistoryMessageDto[] {
  if (!state || typeof state !== "object") {
    return [];
  }

  const bootstrap = (state as { bootstrap?: unknown }).bootstrap;

  if (!bootstrap || typeof bootstrap !== "object") {
    return [];
  }

  const bootstrapSessionId = (bootstrap as { sessionId?: unknown }).sessionId;
  const messages = (bootstrap as { messages?: unknown }).messages;

  if (bootstrapSessionId !== sessionId || !Array.isArray(messages)) {
    return [];
  }

  return messages.filter(isHistoryMessageDto);
}

function isHistoryMessageDto(value: unknown): value is HistoryMessageDto {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<HistoryMessageDto>;
  return (
    typeof message.messageId === "string" &&
    typeof message.provider === "string" &&
    typeof message.providerSessionId === "string" &&
    typeof message.role === "string" &&
    typeof message.content === "string" &&
    typeof message.timestamp === "string" &&
    typeof message.sequence === "number" &&
    typeof message.rawRef === "string"
  );
}

function createClientRequestId(): string {
  const nativeCrypto = globalThis.crypto;

  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return nativeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveInheritedContextSource(
  session: SessionSummaryDto | null,
  messages: SessionMessageViewModel[]
):
  | {
      parentSessionId: string;
      sourceType: "session" | "message";
      hiddenMessageCount: number;
      hiddenSequenceBoundary: number;
    }
  | null {
  if (!session) {
    return null;
  }

  const parentSessionId = session.parentSessionId?.trim() || null;

  if (!parentSessionId || isRealSubagentSession(session)) {
    return null;
  }

  const sourceType =
    session.forkSourceType === "message" || session.forkSourceType === "session"
      ? session.forkSourceType
      : session.forkSourceMessageId
        ? "message"
        : "session";
  const hiddenSequenceBoundary = Math.max(0, session.inheritedPrefixMessageCount ?? 0);
  const hiddenMessageCount = messages.filter(
    (message) => message.sequence <= hiddenSequenceBoundary
  ).length;

  if (hiddenMessageCount <= 0) {
    return null;
  }

  return {
    parentSessionId,
    sourceType,
    hiddenMessageCount,
    hiddenSequenceBoundary
  };
}
