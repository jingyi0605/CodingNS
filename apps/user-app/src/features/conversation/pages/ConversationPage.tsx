import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type TouchEvent as ReactTouchEvent
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { DesktopModal } from "../../../components/DesktopModal";
import {
  ModalActions,
  ModalEmptyState,
  ModalList,
  ModalListItem
} from "../../../components/ModalAtoms";
import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import { useLocalUiPreferenceSelector } from "../../../preferences/local-ui-preference-store";
import { usePlatform } from "../../../platform/platform-provider";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  forkSession,
  type ForkSourceMessageSnapshotDto,
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
import { ConversationSelectionActions } from "../components/ConversationSelectionActions";
import { FileContextPanel } from "../components/FileContextPanel";
import { GitSidebar } from "../components/GitSidebar";
import { MessageTimeline } from "../components/MessageTimeline";
import { MobileConversationSessionActions } from "../components/MobileConversationSessionActions";
import { ParallelConversationGroupView } from "../components/ParallelConversationGroupView";
import { ParallelSessionCreateModal } from "../components/ParallelSessionCreateModal";
import { PermissionRequestList } from "../components/PermissionRequestList";
import { QueuedMessageList } from "../components/QueuedMessageList";
import { SessionBranchTreePanel } from "../components/SessionBranchTreePanel";
import { SessionHeader } from "../components/SessionHeader";
import { SessionButlerActionButton } from "../components/SessionButlerActionButton";
import {
  BranchTreeActionIcon
} from "../components/ConversationActionIcons";
import { useWorkbenchShell } from "../components/WorkbenchLayout";
import { isRealSubagentSession } from "../session-fork-display";
import {
  resolveSessionNavigationWorkspaceId,
  resolveSessionToolWorkspaceId,
  writeParallelGroupTransitionSignal
} from "../parallel-session-display";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";
import {
  isSessionRunning,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassName
} from "../session-activity-display";
import { useSessionSendRecovery } from "../session-send-recovery";
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
  buildWorkspaceHomePath,
  buildNavigationSessionTree,
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  flattenNavigationSessions,
  resolveNavigationSessionParentId,
  type WorkbenchNavigationEntry,
  type WorkbenchNavigationTreeNode
} from "../../workbench/utils/workbench-navigation";
import { TerminalManagerPanel } from "../../workbench/components/TerminalManagerPanel";
import {
  findSessionTreeAncestorIds,
  someSessionTreeNode
} from "../../workbench/utils/session-tree";
import {
  findNavigationWorkspaceTarget,
  flattenMobileWorkspaceOptions
} from "../../workbench/utils/mobile-workspace-tree";
import {
  buildWorkspaceVisualContextMap,
  createWorkspaceToneStyle,
  createFallbackWorkspaceVisualContext
} from "../../workbench/utils/worktree-visual-context";
import { useMobileConversationBottomLayer } from "../../mobile-shell/components/MobileConversationBottomLayerContext";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { MobileCreateSessionSheet } from "../../mobile-sessions/components/MobileCreateSessionSheet";
import {
  readMobileConversationPreviewMode,
  readMobileConversationToolPanel,
  writeMobileConversationPreviewMode,
  writeMobileConversationToolPanel,
  type MobileConversationPreviewMode,
  type MobileConversationToolPanel
} from "../../mobile-sessions/mobile-conversation-state";
import {
  resolveNextMobileSessionEntry
} from "./mobile-session-archive-navigation";
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
  sourceMessageSnapshot: ForkSourceMessageSnapshotDto;
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
  const toolPanel = resolveMobileConversationToolPanel(searchParams.get("toolPanel"));
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
    return <DraftConversationPage draft={draftContext} navigate={navigate} initialToolPanel={toolPanel} />;
  }

  return (
    <LiveConversationPage
      sessionId={sessionId}
      bootstrapMessages={liveBootstrapMessages}
      initialToolPanel={toolPanel}
    />
  );
}

function LiveConversationPage({
  sessionId,
  bootstrapMessages,
  initialToolPanel
}: {
  sessionId: string;
  bootstrapMessages: HistoryMessageDto[];
  initialToolPanel: MobileConversationToolPanel | null;
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
  const [parallelCreateOpen, setParallelCreateOpen] = useState(false);
  const navigationSession = useMemo(
    () =>
      flattenNavigationSessions(navigationGroups)
        .find((entry) => entry.session.sessionId === sessionId)?.session ?? null,
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
  const runtimeInterruptSource = useSessionRuntimeStore(store, (state) => state.interruptSource);
  const loadingOlderMessages = useSessionRuntimeStore(
    store,
    (state) => state.loadingOlderMessages
  );
  const hasOlderMessages = useSessionRuntimeStore(store, (state) => state.hasOlderMessages);
  const connectionState = useSessionRuntimeStore(store, (state) => state.connectionState);
  const [deletingQueueItemId, setDeletingQueueItemId] = useState<string | null>(null);
  const [steeringQueueItemId, setSteeringQueueItemId] = useState<string | null>(null);
  const isRunning = isSessionRunning(session);
  const canSteerQueuedMessage =
    shouldSupportRunSteering(capabilities) &&
    session?.provider === capabilities?.provider;
  const hasPendingQueuedMessages = queuedMessages.some(
    (item) => item.status === "queued" || item.status === "dispatching"
  );
  const optimisticInterruptibleSendInFlight = sending && !forkDraft;
  const composerHasActiveRun =
    runtimeHasActiveRun === true || optimisticInterruptibleSendInFlight
      ? true
      : runtimeHasActiveRun;
  const composerCanInterrupt =
    runtimeCanInterrupt === true || optimisticInterruptibleSendInFlight
      ? true
      : runtimeCanInterrupt;
  const composerIsRunning = isRunning || optimisticInterruptibleSendInFlight;
  useSessionSendRecovery({
    sending,
    setSending,
    session,
    runtimeHasActiveRun,
    runtimeCanInterrupt
  });
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
  const currentSessionSummary = session ?? navigationSession ?? null;
  const currentSessionIsolatedWorkspace =
    session?.sessionIsolatedWorkspace
    ?? navigationSession?.sessionIsolatedWorkspace
    ?? null;
  const mobileNavigationWorkspaceId = currentSessionSummary
    ? resolveSessionNavigationWorkspaceId(currentSessionSummary, currentSessionIsolatedWorkspace)
    : null;
  const mobileToolWorkspaceId = currentSessionSummary
    ? resolveSessionToolWorkspaceId(currentSessionSummary, currentSessionIsolatedWorkspace)
    : null;
  const mobileToolPanel = useMobileConversationToolPanelController({
    enabled: !showInlineHeader,
    initialPanel: initialToolPanel,
    sessionId,
    workspaceId: mobileToolWorkspaceId,
    suspendMainGesture: !showInlineHeader && mobilePreview.isVisible
  });
  const mobileFavoriteSessionIdSet = useMemo(
    () => new Set(favoriteSessions.map((item) => item.session.sessionId)),
    [favoriteSessions]
  );
  const mobileWorkspaces = useMemo(
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );
  const flattenedNavigationEntries = useMemo(
    () => flattenNavigationSessions(navigationGroups),
    [navigationGroups]
  );
  const mobileWorkspaceOptions = useMemo(
    () => flattenMobileWorkspaceOptions(navigationGroups),
    [navigationGroups]
  );
  const workspaceVisualContextMap = useMemo(
    () => buildWorkspaceVisualContextMap(navigationGroups),
    [navigationGroups]
  );
  const mobilePreviewItems = useMemo(
    () =>
      buildMobilePreviewItems(
        navigationGroups,
        mobileNavigationWorkspaceId,
        mobileFavoriteSessionIdSet
      ),
    [mobileFavoriteSessionIdSet, mobileNavigationWorkspaceId, navigationGroups]
  );
  const mobileFavoritePreviewItems = useMemo(
    () => buildMobileFavoritePreviewItems(favoriteSessions, navigationGroups),
    [favoriteSessions, navigationGroups]
  );
  const [expandedMobilePreviewRootIds, setExpandedMobilePreviewRootIds] = useState<string[]>([]);
  const mobilePreviewTrees = useMemo(
    () => [...mobileFavoritePreviewItems, ...mobilePreviewItems],
    [mobileFavoritePreviewItems, mobilePreviewItems]
  );
  const currentWorkspaceEntity = useMemo(
    () =>
      mobileNavigationWorkspaceId
        ? mobileWorkspaces.find((workspace) => workspace.id === mobileNavigationWorkspaceId) ?? null
        : null,
    [mobileNavigationWorkspaceId, mobileWorkspaces]
  );
  const currentWorkspaceContext =
    (mobileNavigationWorkspaceId ? workspaceVisualContextMap[mobileNavigationWorkspaceId] ?? null : null)
    ?? (currentWorkspaceEntity ? createFallbackWorkspaceVisualContext(currentWorkspaceEntity) : null);
  const mobileWorkspaceTarget = useMemo(
    () => findNavigationWorkspaceTarget(navigationGroups, mobileNavigationWorkspaceId),
    [mobileNavigationWorkspaceId, navigationGroups]
  );
  const mobileWorkspaceSummary =
    mobileWorkspaceOptions.find((item) => item.workspace.id === mobileNavigationWorkspaceId)
    ?? (mobileWorkspaceTarget
      ? {
          workspace: mobileWorkspaceTarget.workspace,
          label: mobileWorkspaceTarget.workspace.name,
          subtitle: mobileWorkspaceTarget.workspace.path,
          depth: 0,
          kind: "workspace" as const,
          meta: null
        }
      : null);
  const nextMobileSessionEntry = useMemo(
    () => resolveNextMobileSessionEntry(navigationGroups, mobileNavigationWorkspaceId, sessionId),
    [mobileNavigationWorkspaceId, navigationGroups, sessionId]
  );
  const mobileDraftProvider = session?.provider ?? navigationSession?.provider ?? null;
  const mobileSessionTitlePresentation = useMemo(
    () => buildSessionTitlePresentation((session ?? navigationSession)?.title ?? null, t("conversation.titleFallback")),
    [navigationSession, session]
  );
  const supportsParallelSessionFeatures = showInlineHeader;
  const activeParallelGroupId =
    supportsParallelSessionFeatures ? currentSessionSummary?.parallelGroup?.groupId ?? null : null;
  const mobileMainGestureHandlers = !showInlineHeader
    ? mergeMobileGestureHandlers(mobilePreview.mainGestureHandlers, mobileToolPanel.mainGestureHandlers)
    : null;

  useEffect(() => {
    const ancestorIds = findSessionTreeAncestorIds(
      mobilePreviewTrees,
      sessionId,
      (entry) => entry.session.sessionId
    );

    if (ancestorIds.length === 0) {
      return;
    }

    setExpandedMobilePreviewRootIds((current) => {
      const nextIds = new Set(current);
      let changed = false;

      for (const ancestorId of ancestorIds) {
        if (!nextIds.has(ancestorId)) {
          nextIds.add(ancestorId);
          changed = true;
        }
      }

      return changed ? Array.from(nextIds) : current;
    });
  }, [mobilePreviewTrees, sessionId]);
  const sanitizedForkTimelineMessages = useMemo(
    () => sanitizeForkTimelineMessages(currentSessionSummary, messages),
    [currentSessionSummary, messages]
  );
  const timelineMessages = sanitizedForkTimelineMessages;
  const branchTreeWorkspaceId =
    currentSessionSummary?.workspaceId ?? navigationSession?.workspaceId ?? null;
  const branchTreeModel = useMemo(
    () => buildSessionBranchTreeModel(navigationGroups, branchTreeWorkspaceId, sessionId),
    [branchTreeWorkspaceId, navigationGroups, sessionId]
  );
  const hasBranchRelations = hasSessionBranchRelations(branchTreeModel);
  const canOpenBranchTree = Boolean(currentSessionSummary && branchTreeWorkspaceId && hasBranchRelations);
  const openBranchTree = () => {
    setBranchTreeOpen(true);
  };
  const mobileArchivedSessions = useMemo(
    () =>
      mobileWorkspaceTarget?.sessions.filter(
        (item) => item.isArchived === true && !isRealSubagentSession(item)
      ) ?? [],
    [mobileWorkspaceTarget]
  );
  const mobileConversationMainRef = useRef<HTMLDivElement | null>(null);
  const timelineSelectionContainerRef = useRef<HTMLDivElement | null>(null);
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
    if (runtimeErrorCode !== "SESSION_NOT_FOUND" && runtimeErrorCode !== "WORKSPACE_NOT_FOUND") {
      return;
    }

    dismissToast("conversation-runtime-error");

    const fallbackWorkspaceId =
      session?.workspaceId ?? navigationSession?.workspaceId ?? navigationGroups[0]?.workspace.id ?? null;
    const fallbackSessionEntry =
      (fallbackWorkspaceId
        ? flattenedNavigationEntries.find((item) => item.workspace.id === fallbackWorkspaceId) ?? null
        : null)
      ?? flattenedNavigationEntries[0]
      ?? null;

    navigate(
      fallbackSessionEntry
        ? buildWorkspaceSessionPath(fallbackSessionEntry.workspace.id, fallbackSessionEntry.session.sessionId)
        : fallbackWorkspaceId
          ? buildWorkspaceSessionIndexPath(fallbackWorkspaceId)
          : (shellMode === "mobile" ? buildWorkspaceHomePath() : "/landing"),
      { replace: true }
    );
  }, [
    dismissToast,
    flattenedNavigationEntries,
    navigate,
    navigationGroups,
    navigationSession?.workspaceId,
    runtimeErrorCode,
    session?.workspaceId,
    shellMode
  ]);

  useEffect(() => {
    if (runtimeErrorCode === "SESSION_NOT_FOUND" || runtimeErrorCode === "WORKSPACE_NOT_FOUND") {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }

      pendingRuntimeErrorSignatureRef.current = null;
      lastRuntimeErrorSignatureRef.current = null;
      dismissToast("conversation-runtime-error");
      return;
    }

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
        sourceMessageSnapshot: activeForkDraft.sourceMessageSnapshot,
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
        permissionMode: getDefaultSessionPermissionMode(),
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

  function handleMobileWorkspaceSwitch(nextWorkspaceId: string) {
    selectWorkspace(nextWorkspaceId);
    navigate(buildWorkspaceSessionIndexPath(nextWorkspaceId));
  }

  if (showInlineHeader && activeParallelGroupId) {
    return (
      <>
        <ParallelConversationGroupView
          groupId={activeParallelGroupId}
          currentSessionId={sessionId}
        />
        <ParallelSessionCreateModal
          open={parallelCreateOpen}
          source={
            currentSessionSummary
              ? {
                  kind: "session",
                  sessionId,
                  workspaceId: currentSessionSummary.workspaceId,
                  workspaceName: currentWorkspaceContext?.displayName ?? currentSessionSummary.workspaceId,
                  sessionTitle: currentSessionSummary.title,
                  defaultProvider: currentSessionSummary.provider
                }
              : null
          }
          onClose={() => setParallelCreateOpen(false)}
          onCreated={async (detail) => {
            detail.members.forEach((item) => {
              upsertNavigationSession(item.session);
            });
            writeParallelGroupTransitionSignal(detail.group.id);
            await requestNavigationRefresh();

            const anchorMember =
              detail.members.find((item) => item.session.sessionId === detail.group.anchorSessionId)
              ?? detail.members[0]
              ?? null;

            if (anchorMember) {
              const navigationWorkspaceId = resolveSessionNavigationWorkspaceId(
                anchorMember.session,
                anchorMember.sessionIsolatedWorkspace
              );
              selectWorkspace(navigationWorkspaceId);
              navigate(buildWorkspaceSessionPath(navigationWorkspaceId, anchorMember.session.sessionId));
            }

            setParallelCreateOpen(false);
            showToast({
              title: t("shell.parallelCreateSucceeded"),
              tone: "success"
            });
          }}
        />
      </>
    );
  }

  return (
    <>
      <main
        ref={mobileConversationPageRef}
        className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page"
        data-mobile-shell={!showInlineHeader}
        data-preview-mode={!showInlineHeader ? mobilePreview.displayMode : undefined}
        data-preview-dragging={!showInlineHeader ? mobilePreview.isDragging : undefined}
        data-workspace-tone={currentWorkspaceContext?.tone ?? "root"}
        data-worktree-depth={currentWorkspaceContext?.depth ?? 0}
        data-tool-panel-open={!showInlineHeader ? mobileToolPanel.isOpen : undefined}
        style={{
          ...(!showInlineHeader ? mobilePreview.pageStyle : {}),
          ...(createWorkspaceToneStyle(currentWorkspaceContext) ?? {})
        }}
      >
        {showInlineHeader ? (
          <SessionHeader
            session={session ?? navigationSession}
            workspaceContext={currentWorkspaceContext}
            actions={(
              <>
                {canOpenBranchTree ? (
                  <ConversationBranchTreeButton onOpenBranchTree={openBranchTree} />
                ) : null}
                {currentSessionSummary ? (
                  <button
                    type="button"
                    className="conversation-header-ai-button"
                    aria-label={t("shell.parallelCreateAction")}
                    title={t("shell.parallelCreateAction")}
                    onClick={() => setParallelCreateOpen(true)}
                  >
                    <span className="conversation-header-ai-button-label" aria-hidden="true">
                      <ParallelForkIcon />
                    </span>
                  </button>
                ) : null}
                <SessionButlerActionButton session={session ?? navigationSession} />
              </>
            )}
          />
        ) : null}
        {!showInlineHeader ? (
          <MobileWorkspaceSwitcherHeader
            containerRef={mobileConversationHeaderRef}
            className="mobile-conversation-page-header"
            gestureHandlers={mobileMainGestureHandlers ?? undefined}
            currentWorkspace={
              mobileWorkspaceSummary
                ? {
                    id: mobileWorkspaceSummary.workspace.id,
                    name: mobileWorkspaceSummary.label,
                    path: mobileWorkspaceSummary.subtitle
                  }
                : mobileWorkspaces[0] ?? null
            }
            workspaces={mobileWorkspaces}
            workspaceOptions={mobileWorkspaceOptions}
            onSelectWorkspace={handleMobileWorkspaceSwitch}
            heading={mobileSessionTitlePresentation.fullTitle}
            trailing={
              <div className="mobile-conversation-toolbar-main">
                <span className="mobile-conversation-toolbar-title" title={mobileSessionTitlePresentation.fullTitle}>
                  {mobileSessionTitlePresentation.displayTitle}
                </span>
                <MobileConversationSessionActions
                  session={session ?? navigationSession}
                  onOpenBranchTree={canOpenBranchTree ? openBranchTree : undefined}
                />
              </div>
            }
          />
        ) : null}
        {!showInlineHeader ? (
          <MobileConversationPreviewRail
            visible={!mobileToolPanel.isOpen && mobilePreview.isVisible}
            widthPx={mobilePreview.previewWidthPx}
            isDragging={mobilePreview.isDragging}
            gestureHandlers={mobilePreview.railGestureHandlers}
            activeSessionId={sessionId}
            createSessionActionLabel={
              mobileNavigationWorkspaceId && mobileDraftProvider ? t("shell.createSession") : undefined
            }
            favoriteItems={mobileFavoritePreviewItems}
            items={mobilePreviewItems}
            expandedRootIds={expandedMobilePreviewRootIds}
            workspaceSectionLabel={mobileWorkspaceSummary?.label ?? t("shell.mobileConversationCurrentWorkspaceSection")}
            onCreateSession={
              mobileNavigationWorkspaceId && mobileDraftProvider
                ? () => {
                    startDraftSession(mobileNavigationWorkspaceId, mobileDraftProvider);
                  }
                : undefined
            }
            archiveCurrentActionLabel={t("shell.archiveCurrentSessionAction")}
            archiveFolderActionLabel={mobileArchivedSessions.length > 0 ? t("shell.archiveFolderLabel") : undefined}
            onArchiveActiveSession={() => {
              setArchiveConfirmOpen(true);
            }}
            onOpenArchiveFolder={
              mobileArchivedSessions.length > 0
                ? () => {
                    setArchiveFolderOpen(true);
                  }
                : undefined
            }
            onToggleSubsessions={(targetSessionId) => {
              setExpandedMobilePreviewRootIds((current) =>
                current.includes(targetSessionId)
                  ? current.filter((item) => item !== targetSessionId)
                  : [...current, targetSessionId]
              );
            }}
            onActivate={(entry) => {
              mobilePreview.closePreview();
              selectWorkspace(entry.workspace.id);
              navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
            }}
          />
        ) : null}
        <div className="mobile-conversation-stage" {...(mobileMainGestureHandlers ?? {})}>
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
            <div ref={timelineSelectionContainerRef} className="conversation-timeline-shell">
              <MessageTimeline
                sessionId={sessionId}
                messages={timelineMessages}
                historyState={historyState}
                loadingOlderMessages={loadingOlderMessages}
                hasOlderMessages={hasOlderMessages}
                provider={session?.provider ?? null}
                interruptedSource={runtimeInterruptSource}
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
                    sourceMessageSnapshot: {
                      role: message.role,
                      kind: message.kind ?? (message.role === "tool" ? "tool_result" : "text"),
                      content: message.content
                    },
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
            <ConversationSelectionActions
              containerRef={timelineSelectionContainerRef}
              session={session ?? navigationSession ?? null}
              currentCapabilities={capabilities}
            />
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
            {!mobileToolPanel.isOpen ? (
              <ComposerPanel
                capabilities={capabilities}
                draftStorageId={sessionId}
                forkDraft={forkDraft}
                onClearForkDraft={() => setForkDraft(null)}
                onForkDraftChange={(nextDraft) => setForkDraft(nextDraft)}
                panelRef={!showInlineHeader ? setMobileComposerPanelElement : undefined}
                portalContainer={!showInlineHeader ? composerPortalTarget : null}
                hasActiveRun={composerHasActiveRun}
                contextUsage={contextUsage}
                taskProvider={(session ?? navigationSession)?.provider ?? null}
                taskMessages={messages}
                hasPendingQueuedMessages={hasPendingQueuedMessages}
                canInterrupt={composerCanInterrupt}
                isSubmitting={sending}
                isRunning={composerIsRunning}
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
            ) : null}
          </div>
        </div>
        {!showInlineHeader && mobileToolWorkspaceId ? (
          <MobileConversationToolPanelOverlay
            activePanel={mobileToolPanel.activePanel}
            open={mobileToolPanel.isOpen}
            sessionId={sessionId}
            workspaceId={mobileToolWorkspaceId}
            navigationGroups={navigationGroups}
            onClose={() => {
              mobileToolPanel.closePanel();
            }}
            onSelectPanel={(nextPanel) => {
              mobileToolPanel.selectPanel(nextPanel);
            }}
            onSelectPanelBySwipe={(nextPanel) => {
              if (nextPanel === null) {
                mobileToolPanel.closePanel();
                return;
              }

              mobileToolPanel.selectPanel(nextPanel);
            }}
          />
        ) : null}
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

            if (mobileNavigationWorkspaceId) {
              selectWorkspace(mobileNavigationWorkspaceId);
              writeMobileConversationPreviewMode("preview");
              if (nextMobileSessionEntry) {
                navigate(
                  buildWorkspaceSessionPath(
                    nextMobileSessionEntry.workspace.id,
                    nextMobileSessionEntry.session.sessionId
                  )
                );
                return;
              }

              navigate(buildWorkspaceSessionIndexPath(mobileNavigationWorkspaceId));
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
        workspaceName={mobileWorkspaceTarget?.workspace.name ?? null}
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
      {supportsParallelSessionFeatures ? (
        <ParallelSessionCreateModal
          open={parallelCreateOpen}
          source={
            currentSessionSummary
              ? {
                  kind: "session",
                  sessionId,
                  workspaceId: currentSessionSummary.workspaceId,
                  workspaceName: currentWorkspaceContext?.displayName ?? currentSessionSummary.workspaceId,
                  sessionTitle: currentSessionSummary.title,
                  defaultProvider: currentSessionSummary.provider
                }
              : null
          }
          onClose={() => setParallelCreateOpen(false)}
          onCreated={async (detail) => {
            detail.members.forEach((item) => {
              upsertNavigationSession(item.session);
            });
            writeParallelGroupTransitionSignal(detail.group.id);
            await requestNavigationRefresh();

            const anchorMember =
              detail.members.find((item) => item.session.sessionId === detail.group.anchorSessionId)
              ?? detail.members[0]
              ?? null;

            if (anchorMember) {
              const navigationWorkspaceId = resolveSessionNavigationWorkspaceId(
                anchorMember.session,
                anchorMember.sessionIsolatedWorkspace
              );
              selectWorkspace(navigationWorkspaceId);
              navigate(buildWorkspaceSessionPath(navigationWorkspaceId, anchorMember.session.sessionId));
            }

            setParallelCreateOpen(false);
            showToast({
              title: t("shell.parallelCreateSucceeded"),
              tone: "success"
            });
          }}
        />
      ) : null}
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
  navigate,
  initialToolPanel
}: {
  draft: DraftConversationContext;
  navigate: ReturnType<typeof useNavigate>;
  initialToolPanel: MobileConversationToolPanel | null;
}) {
  const {
    shellMode,
    navigationGroups,
    requestNavigationRefresh,
    selectWorkspace,
    setSessionWorkspace,
    upsertNavigationSession,
    favoriteSessions,
    unarchiveSession,
    startDraftSession
  } = useWorkbenchShell();
  const [sending, setSending] = useState(false);
  const [draftMessages, setDraftMessages] = useState<SessionMessageViewModel[]>([]);
  const fallbackCapabilities = useMemo(
    () => createProviderDraftCapabilities(draft.provider),
    [draft.provider]
  );
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesDto>(fallbackCapabilities);
  const showInlineHeader = shellMode !== "mobile";
  const { showToast } = useToast();
  const session = useMemo(() => createDraftSessionSummary(draft), [draft]);
  const mobilePreview = useMobileConversationPreviewController(!showInlineHeader);
  const mobileToolPanel = useMobileConversationToolPanelController({
    enabled: !showInlineHeader,
    initialPanel: initialToolPanel,
    sessionId: draft.sessionId,
    workspaceId: draft.workspaceId,
    suspendMainGesture: !showInlineHeader && mobilePreview.isVisible
  });
  const mobileFavoriteSessionIdSet = useMemo(
    () => new Set(favoriteSessions.map((item) => item.session.sessionId)),
    [favoriteSessions]
  );
  const mobileWorkspaces = useMemo(
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );
  const mobileWorkspaceOptions = useMemo(
    () => flattenMobileWorkspaceOptions(navigationGroups),
    [navigationGroups]
  );
  const workspaceVisualContextMap = useMemo(
    () => buildWorkspaceVisualContextMap(navigationGroups),
    [navigationGroups]
  );
  const currentWorkspaceEntity = useMemo(
    () => mobileWorkspaces.find((workspace) => workspace.id === draft.workspaceId) ?? null,
    [draft.workspaceId, mobileWorkspaces]
  );
  const currentWorkspaceContext =
    workspaceVisualContextMap[draft.workspaceId] ?? (
      currentWorkspaceEntity ? createFallbackWorkspaceVisualContext(currentWorkspaceEntity) : null
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
    () => buildMobileFavoritePreviewItems(favoriteSessions, navigationGroups),
    [favoriteSessions, navigationGroups]
  );
  const [expandedMobilePreviewRootIds, setExpandedMobilePreviewRootIds] = useState<string[]>([]);
  const mobilePreviewTrees = useMemo(
    () => [...mobileFavoritePreviewItems, ...mobilePreviewItems],
    [mobileFavoritePreviewItems, mobilePreviewItems]
  );
  const mobileWorkspaceTarget = useMemo(
    () => findNavigationWorkspaceTarget(navigationGroups, draft.workspaceId),
    [draft.workspaceId, navigationGroups]
  );
  const mobileArchivedSessions = useMemo(
    () =>
      mobileWorkspaceTarget?.sessions.filter(
        (item) => item.isArchived === true && !isRealSubagentSession(item)
      ) ?? [],
    [mobileWorkspaceTarget]
  );
  const mobileWorkspaceSummary =
    mobileWorkspaceOptions.find((item) => item.workspace.id === draft.workspaceId)
    ?? (mobileWorkspaceTarget
      ? {
          workspace: mobileWorkspaceTarget.workspace,
          label: mobileWorkspaceTarget.workspace.name,
          subtitle: mobileWorkspaceTarget.workspace.path,
          depth: 0,
          kind: "workspace" as const,
          meta: null
        }
      : null);
  const mobileMainGestureHandlers = !showInlineHeader
    ? mergeMobileGestureHandlers(mobilePreview.mainGestureHandlers, mobileToolPanel.mainGestureHandlers)
    : null;
  const [archiveFolderOpen, setArchiveFolderOpen] = useState(false);
  const [archiveRestoreSessionId, setArchiveRestoreSessionId] = useState<string | null>(null);
  const mobileConversationMainRef = useRef<HTMLDivElement | null>(null);
  const mobileConversationPageRef = useRef<HTMLElement | null>(null);
  const mobileConversationHeaderRef = useRef<HTMLDivElement | null>(null);
  const [mobileComposerPanelElement, setMobileComposerPanelElement] = useState<HTMLElement | null>(null);
  const { composerPortalTarget } = useMobileConversationBottomLayer();

  useEffect(() => {
    const ancestorIds = findSessionTreeAncestorIds(
      mobilePreviewTrees,
      draft.sessionId,
      (entry) => entry.session.sessionId
    );

    if (ancestorIds.length === 0) {
      return;
    }

    setExpandedMobilePreviewRootIds((current) => {
      const nextIds = new Set(current);
      let changed = false;

      for (const ancestorId of ancestorIds) {
        if (!nextIds.has(ancestorId)) {
          nextIds.add(ancestorId);
          changed = true;
        }
      }

      return changed ? Array.from(nextIds) : current;
    });
  }, [draft.sessionId, mobilePreviewTrees]);

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

  function handleMobileWorkspaceSwitch(nextWorkspaceId: string) {
    selectWorkspace(nextWorkspaceId);
    navigate(buildWorkspaceSessionIndexPath(nextWorkspaceId));
  }

  return (
    <>
    <main
      ref={mobileConversationPageRef}
      className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page"
      data-mobile-shell={!showInlineHeader}
      data-preview-mode={!showInlineHeader ? mobilePreview.displayMode : undefined}
      data-preview-dragging={!showInlineHeader ? mobilePreview.isDragging : undefined}
      data-workspace-tone={currentWorkspaceContext?.tone ?? "root"}
      data-worktree-depth={currentWorkspaceContext?.depth ?? 0}
      data-tool-panel-open={!showInlineHeader ? mobileToolPanel.isOpen : undefined}
      style={{
        ...(!showInlineHeader ? mobilePreview.pageStyle : {}),
        ...(createWorkspaceToneStyle(currentWorkspaceContext) ?? {})
      }}
    >
      {showInlineHeader ? (
        <SessionHeader
          session={session}
          workspaceContext={currentWorkspaceContext}
        />
      ) : null}
      {!showInlineHeader ? (
        <MobileWorkspaceSwitcherHeader
          containerRef={mobileConversationHeaderRef}
          className="mobile-conversation-page-header"
          gestureHandlers={mobileMainGestureHandlers ?? undefined}
          currentWorkspace={
            mobileWorkspaceSummary
              ? {
                  id: mobileWorkspaceSummary.workspace.id,
                  name: mobileWorkspaceSummary.label,
                  path: mobileWorkspaceSummary.subtitle
                }
              : mobileWorkspaces[0] ?? null
          }
          workspaces={mobileWorkspaces}
          workspaceOptions={mobileWorkspaceOptions}
          onSelectWorkspace={handleMobileWorkspaceSwitch}
          heading={mobileSessionTitlePresentation.fullTitle}
          trailing={
            <span className="mobile-conversation-toolbar-title" title={mobileSessionTitlePresentation.fullTitle}>
              {mobileSessionTitlePresentation.displayTitle}
            </span>
          }
        />
      ) : null}
      {!showInlineHeader ? (
        <MobileConversationPreviewRail
          visible={!mobileToolPanel.isOpen && mobilePreview.isVisible}
          widthPx={mobilePreview.previewWidthPx}
          isDragging={mobilePreview.isDragging}
          gestureHandlers={mobilePreview.railGestureHandlers}
          activeSessionId={draft.sessionId}
          createSessionActionLabel={t("shell.createSession")}
          favoriteItems={mobileFavoritePreviewItems}
          items={mobilePreviewItems}
          expandedRootIds={expandedMobilePreviewRootIds}
          workspaceSectionLabel={mobileWorkspaceSummary?.label ?? t("shell.mobileConversationCurrentWorkspaceSection")}
          onCreateSession={() => {
            startDraftSession(draft.workspaceId, draft.provider);
          }}
          archiveFolderActionLabel={mobileArchivedSessions.length > 0 ? t("shell.archiveFolderLabel") : undefined}
          onOpenArchiveFolder={
            mobileArchivedSessions.length > 0
              ? () => {
                  setArchiveFolderOpen(true);
                }
              : undefined
          }
          onToggleSubsessions={(targetSessionId) => {
            setExpandedMobilePreviewRootIds((current) =>
              current.includes(targetSessionId)
                ? current.filter((item) => item !== targetSessionId)
                : [...current, targetSessionId]
            );
          }}
          onActivate={(entry) => {
            mobilePreview.closePreview();
            selectWorkspace(entry.workspace.id);
            navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
          }}
        />
      ) : null}
      <div className="mobile-conversation-stage" {...(mobileMainGestureHandlers ?? {})}>
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
          {!mobileToolPanel.isOpen ? (
            <ComposerPanel
              capabilities={capabilities}
              draftStorageId={draft.sessionId}
              panelRef={!showInlineHeader ? setMobileComposerPanelElement : undefined}
              portalContainer={!showInlineHeader ? composerPortalTarget : null}
              contextUsage={null}
              taskProvider={draft.provider}
              taskMessages={draftMessages}
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
                  const created = await startLiveSession({
                    workspaceId: draft.workspaceId,
                    provider: draft.provider,
                    content,
                    clientRequestId,
                    model: options?.model ?? null,
                    reasoningLevel: options?.reasoningLevel ?? null,
                    permissionMode: getDefaultSessionPermissionMode(),
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
          ) : null}
        </div>
      </div>
      {!showInlineHeader ? (
        <MobileConversationToolPanelOverlay
          activePanel={mobileToolPanel.activePanel}
          open={mobileToolPanel.isOpen}
          sessionId={draft.sessionId}
          workspaceId={draft.workspaceId}
          navigationGroups={navigationGroups}
          onClose={() => {
            mobileToolPanel.closePanel();
          }}
          onSelectPanel={(nextPanel) => {
            mobileToolPanel.selectPanel(nextPanel);
          }}
          onSelectPanelBySwipe={(nextPanel) => {
            if (nextPanel === null) {
              mobileToolPanel.closePanel();
              return;
            }

            mobileToolPanel.selectPanel(nextPanel);
          }}
        />
      ) : null}
      <ConversationArchiveFolderModal
        open={archiveFolderOpen}
        workspaceName={mobileWorkspaceTarget?.workspace.name ?? null}
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
    </main>
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

function filterVisibleNavigationSessions(sessions: readonly SessionSummaryDto[]) {
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session] as const));
  const visibilityCache = new Map<string, boolean>();

  const isVisible = (session: SessionSummaryDto): boolean => {
    const cached = visibilityCache.get(session.sessionId);
    if (typeof cached === "boolean") {
      return cached;
    }

    if (session.isArchived) {
      visibilityCache.set(session.sessionId, false);
      return false;
    }

    const parentSessionId = resolveNavigationSessionParentId(session, {
      mode: "mobile"
    });

    if (!parentSessionId) {
      visibilityCache.set(session.sessionId, true);
      return true;
    }

    const parentSession = sessionById.get(parentSessionId);

    if (!parentSession) {
      visibilityCache.set(session.sessionId, true);
      return true;
    }

    const visible = isVisible(parentSession);
    visibilityCache.set(session.sessionId, visible);
    return visible;
  };

  return sessions.filter((session) => isVisible(session));
}

function buildMobilePreviewItems(
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"],
  workspaceId: string | null,
  excludedSessionIds: ReadonlySet<string>
): WorkbenchNavigationTreeNode[] {
  if (!workspaceId) {
    return [];
  }

  const workspaceTarget = findNavigationWorkspaceTarget(navigationGroups, workspaceId);

  if (!workspaceTarget) {
    return [];
  }

  const visibleEntries = filterVisibleNavigationSessions(workspaceTarget.sessions)
    .map((session) => ({
      session,
      workspace: workspaceTarget.workspace
    }));
  const visibleTree = buildNavigationSessionTree(visibleEntries, { mode: "mobile" });

  return visibleTree.filter(
    (node) =>
      !excludedSessionIds.has(node.item.session.sessionId)
      && !someSessionTreeNode(node.children, (entry) => excludedSessionIds.has(entry.session.sessionId))
  );
}

function buildMobileFavoritePreviewItems(
  favoriteSessions: readonly WorkbenchNavigationEntry[],
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"]
): WorkbenchNavigationTreeNode[] {
  return favoriteSessions
    .filter((item) => !isRealSubagentSession(item.session))
    .flatMap((entry) => {
      const workspaceTarget = findNavigationWorkspaceTarget(navigationGroups, entry.workspace.id);

      if (!workspaceTarget) {
        return [];
      }

      const workspaceTree = buildNavigationSessionTree(
        filterVisibleNavigationSessions(workspaceTarget.sessions).map((session) => ({
          session,
          workspace: workspaceTarget.workspace
        })),
        { mode: "mobile" }
      );
      const node = findNavigationTreeNodeBySessionId(workspaceTree, entry.session.sessionId);

      return node ? [node] : [];
    });
}

function findNavigationTreeNodeBySessionId(
  nodes: readonly WorkbenchNavigationTreeNode[],
  sessionId: string
): WorkbenchNavigationTreeNode | null {
  for (const node of nodes) {
    if (node.item.session.sessionId === sessionId) {
      return node;
    }

    const childNode = findNavigationTreeNodeBySessionId(node.children, sessionId);

    if (childNode) {
      return childNode;
    }
  }

  return null;
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

function resolveMobileConversationToolPanel(
  value: string | null | undefined
): MobileConversationToolPanel | null {
  if (value === "files" || value === "git" || value === "processes") {
    return value;
  }

  return null;
}

function mergeMobileGestureHandlers(
  ...handlersList: Array<MobileConversationPreviewGestureHandlers | null | undefined>
): MobileConversationPreviewGestureHandlers {
  const handlers = handlersList.filter(Boolean) as MobileConversationPreviewGestureHandlers[];

  return {
    onTouchStart(event) {
      handlers.forEach((item) => item.onTouchStart(event));
    },
    onTouchMove(event) {
      handlers.forEach((item) => item.onTouchMove(event));
    },
    onTouchEnd(event) {
      handlers.forEach((item) => item.onTouchEnd(event));
    },
    onTouchCancel(event) {
      handlers.forEach((item) => item.onTouchCancel(event));
    }
  };
}

function useMobileConversationToolPanelController(input: {
  enabled: boolean;
  initialPanel: MobileConversationToolPanel | null;
  sessionId: string;
  workspaceId: string | null;
  suspendMainGesture?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const haptics = useHaptics();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<MobileConversationToolPanel>(() =>
    input.initialPanel ?? readMobileConversationToolPanel()
  );
  const activePanel = input.initialPanel ?? selectedPanel;
  const isOpen = input.enabled && input.workspaceId !== null && input.initialPanel !== null;

  useEffect(() => {
    if (!input.enabled) {
      touchStartRef.current = null;
      return;
    }

    const nextPanel = input.initialPanel ?? readMobileConversationToolPanel();
    setSelectedPanel(nextPanel);
    writeMobileConversationToolPanel(nextPanel);
  }, [input.enabled, input.initialPanel]);

  function navigateToolPanel(
    nextPanel: MobileConversationToolPanel | null,
    options?: {
      replace?: boolean;
    }
  ) {
    const nextSearchParams = new URLSearchParams(location.search);

    if (nextPanel) {
      nextSearchParams.set("toolPanel", nextPanel);
      setSelectedPanel(nextPanel);
      writeMobileConversationToolPanel(nextPanel);
    } else {
      nextSearchParams.delete("toolPanel");
    }

    const nextSearch = nextSearchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : ""
      },
      { replace: options?.replace ?? false }
    );
  }

  function selectPanel(nextPanel: MobileConversationToolPanel) {
    void haptics.trigger("selection");
    navigateToolPanel(nextPanel, {
      replace: isOpen
    });
  }

  function closePanel() {
    if (!isOpen) {
      return;
    }

    void haptics.trigger("gesture");
    navigateToolPanel(null, {
      replace: true
    });
  }

  function openPanel(nextPanel?: MobileConversationToolPanel) {
    if (!input.enabled || !input.workspaceId) {
      return;
    }

    const targetPanel = nextPanel ?? activePanel;
    void haptics.trigger("gesture");
    navigateToolPanel(targetPanel);
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (!input.enabled || event.changedTouches.length !== 1) {
      touchStartRef.current = null;
      return;
    }

    if (shouldIgnoreMobileConversationToolGesture(event.target)) {
      touchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
  }

  function settleMainGesture(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;

    if (!touchStart || event.changedTouches.length !== 1 || isOpen || input.suspendMainGesture) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (
      deltaX > -56
      || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15
    ) {
      return;
    }

    openPanel();
  }

  function settlePanelGesture(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;

    if (!touchStart || event.changedTouches.length !== 1 || !isOpen) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (
      deltaX < 56
      || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15
    ) {
      return;
    }

    closePanel();
  }

  const mainGestureHandlers: MobileConversationPreviewGestureHandlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: () => undefined,
    onTouchEnd: settleMainGesture,
    onTouchCancel: () => {
      touchStartRef.current = null;
    }
  };
  const panelGestureHandlers: MobileConversationPreviewGestureHandlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: () => undefined,
    onTouchEnd: settlePanelGesture,
    onTouchCancel: () => {
      touchStartRef.current = null;
    }
  };

  return {
    activePanel,
    closePanel,
    isOpen,
    mainGestureHandlers,
    openPanel,
    panelGestureHandlers,
    selectPanel
  };
}

function MobileConversationToolPanelOverlay(props: {
  open: boolean;
  activePanel: MobileConversationToolPanel;
  workspaceId: string;
  sessionId: string;
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"];
  onClose: () => void;
  onSelectPanel: (panel: MobileConversationToolPanel) => void;
  onSelectPanelBySwipe: (panel: MobileConversationToolPanel | null) => void;
}) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  if (!props.open) {
    return null;
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      touchStartRef.current = null;
      return;
    }

    if (shouldIgnoreMobileConversationToolPanelSwipeTarget(event.target)) {
      touchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;

    if (!touchStart || event.changedTouches.length !== 1) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (
      Math.abs(deltaX) < 56
      || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15
    ) {
      return;
    }

    const panels: MobileConversationToolPanel[] = ["files", "git", "processes"];
    const activeIndex = panels.indexOf(props.activePanel);

    if (deltaX < 0) {
      props.onSelectPanelBySwipe(panels[Math.min(panels.length - 1, activeIndex + 1)] ?? props.activePanel);
      return;
    }

    if (activeIndex === 0) {
      props.onSelectPanelBySwipe(null);
      return;
    }

    props.onSelectPanelBySwipe(panels[Math.max(0, activeIndex - 1)] ?? props.activePanel);
  }

  return (
    <section
      className="mobile-conversation-tool-panel"
      data-panel={props.activePanel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        touchStartRef.current = null;
      }}
    >
      <header className="mobile-conversation-tool-panel-header" data-preview-gesture="ignore">
        <button
          type="button"
          className="mobile-conversation-tool-panel-back"
          aria-label={t("shell.mobileConversationToolCloseAction")}
          title={t("shell.mobileConversationToolCloseAction")}
          onClick={props.onClose}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div
          className="mobile-conversation-tool-panel-tabs"
          role="tablist"
          aria-label={t("shell.mobileConversationToolTabsLabel")}
        >
          {(["files", "git", "processes"] as const).map((panelId) => (
            <button
              key={panelId}
              type="button"
              role="tab"
              aria-selected={props.activePanel === panelId}
              className="mobile-conversation-tool-panel-tab"
              onClick={() => {
                props.onSelectPanel(panelId);
              }}
            >
              {panelId === "files"
                ? t("shell.filesEntry")
                : panelId === "git"
                  ? t("shell.gitEntry")
                  : t("shell.mobileConversationToolProcessesTab")}
            </button>
          ))}
        </div>
      </header>
      <div className="mobile-conversation-tool-panel-body">
        {props.activePanel === "files" ? (
          <FileContextPanel
            className="mobile-conversation-tool-surface"
            hideHeading
            sessionId={props.sessionId}
            workspaceId={props.workspaceId}
          />
        ) : props.activePanel === "git" ? (
          <GitSidebar
            className="mobile-conversation-tool-surface"
            panelActive
            workspaceId={props.workspaceId}
          />
        ) : (
          <TerminalManagerPanel
            className="mobile-conversation-tool-surface mobile-tool-native-panel mobile-tool-process-panel"
            currentWorkspaceId={props.workspaceId}
            navigationGroups={props.navigationGroups}
          />
        )}
      </div>
    </section>
  );
}

function shouldIgnoreMobileConversationToolGesture(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, option, label, button, a, [contenteditable='true'], [data-preview-gesture='ignore']"
    )
  );
}

function shouldIgnoreMobileConversationToolPanelSwipeTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, option, [contenteditable='true']"
    )
  );
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
    const touch = event.touches[0] ?? event.changedTouches[0];

    if (!enabled || !touch) {
      gestureRef.current = null;
      return;
    }

    if (shouldIgnorePreviewGestureTarget(event.target)) {
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
  expandedRootIds,
  workspaceSectionLabel,
  onCreateSession,
  archiveCurrentActionLabel,
  archiveFolderActionLabel,
  onArchiveActiveSession,
  onOpenArchiveFolder,
  onToggleSubsessions,
  onActivate
}: {
  visible: boolean;
  widthPx: number;
  isDragging: boolean;
  gestureHandlers: MobileConversationPreviewGestureHandlers;
  activeSessionId: string;
  createSessionActionLabel?: string;
  favoriteItems: WorkbenchNavigationTreeNode[];
  items: WorkbenchNavigationTreeNode[];
  expandedRootIds: readonly string[];
  workspaceSectionLabel: string;
  onCreateSession?: (() => void) | null;
  archiveCurrentActionLabel?: string;
  archiveFolderActionLabel?: string;
  onArchiveActiveSession?: (() => void | Promise<void>) | null;
  onOpenArchiveFolder?: (() => void) | null;
  onToggleSubsessions: (sessionId: string) => void;
  onActivate: (entry: WorkbenchNavigationEntry) => void;
}) {
  if (!visible) {
    return null;
  }

  function renderPreviewTreeNode(
    node: WorkbenchNavigationTreeNode,
    options?: {
      workspaceName?: string;
      ancestorExpanded?: boolean;
      ancestorHasNextSiblings?: readonly boolean[];
      hasNextSibling?: boolean;
      isFirstSibling?: boolean;
    }
  ): JSX.Element {
    const {
      workspaceName,
      ancestorExpanded = false,
      ancestorHasNextSiblings = [],
      hasNextSibling = false,
      isFirstSibling = false
    } = options ?? {};
    const sessionId = node.item.session.sessionId;
    const childNodes = node.children;
    const allowToggle = node.depth === 0 && childNodes.length > 0;
    const isExpanded = ancestorExpanded || (allowToggle && expandedRootIds.includes(sessionId));
    const nextAncestorHasNextSiblings =
      node.depth > 0 ? [...ancestorHasNextSiblings, hasNextSibling] : [...ancestorHasNextSiblings];

    return (
      <div key={`${node.item.workspace.id}:${sessionId}`} className="mobile-conversation-preview-tree-node">
        <div
          className="mobile-conversation-preview-tree-row"
          style={
            {
              "--mobile-preview-tree-depth": node.depth
            } as CSSProperties
          }
        >
          {node.depth > 0 ? (
            <div className="mobile-conversation-preview-guides" aria-hidden="true">
              {ancestorHasNextSiblings.map((continues, index) =>
                continues ? (
                  <span
                    key={`${sessionId}:ancestor:${index}`}
                    className="mobile-conversation-preview-guide-column"
                    style={
                      {
                        "--mobile-preview-tree-level": index + 1
                      } as CSSProperties
                    }
                  />
                ) : null
              )}
              <span
                className="mobile-conversation-preview-guide-branch"
                data-continue={hasNextSibling}
                data-first={isFirstSibling}
                style={
                  {
                    "--mobile-preview-tree-level": node.depth
                  } as CSSProperties
                }
              >
                <span className="mobile-conversation-preview-guide-branch-horizontal" />
              </span>
            </div>
          ) : null}
          <MobileConversationPreviewEntryButton
            entry={node.item}
            activeSessionId={activeSessionId}
            hasSubsessions={allowToggle}
            subsessionsExpanded={isExpanded}
            workspaceName={workspaceName}
            onToggleSubsessions={
              allowToggle
                ? () => {
                    onToggleSubsessions(sessionId);
                  }
                : undefined
            }
            onActivate={onActivate}
          />
        </div>
        {childNodes.length > 0 && isExpanded ? (
          <div className="mobile-conversation-preview-children">
            {childNodes.map((childNode, index) =>
              renderPreviewTreeNode(childNode, {
                workspaceName,
                ancestorExpanded: true,
                ancestorHasNextSiblings: nextAncestorHasNextSiblings,
                hasNextSibling: index < childNodes.length - 1,
                isFirstSibling: index === 0
              })
            )}
          </div>
        ) : null}
      </div>
    );
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
              {favoriteItems.map((node) => (
                <div key={`favorite:${node.item.workspace.id}:${node.item.session.sessionId}`}>
                  {renderPreviewTreeNode(node, {
                    workspaceName: node.item.workspace.name
                  })}
                </div>
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
              {items.map((node) => renderPreviewTreeNode(node))}
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
  activeSessionId,
  hasSubsessions = false,
  subsessionsExpanded = false,
  onActivate,
  onToggleSubsessions,
  workspaceName
}: {
  entry: WorkbenchNavigationEntry;
  activeSessionId: string;
  hasSubsessions?: boolean;
  subsessionsExpanded?: boolean;
  onActivate: (entry: WorkbenchNavigationEntry) => void;
  onToggleSubsessions?: () => void;
  workspaceName?: string;
}) {
  const isActive = entry.session.sessionId === activeSessionId;

  return (
    <article className="mobile-conversation-preview-entry terminal-mobile-session-card" data-active={isActive}>
      {hasSubsessions ? (
        <button
          type="button"
          className="mobile-conversation-preview-toggle"
          aria-label={subsessionsExpanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
          title={subsessionsExpanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
          aria-expanded={subsessionsExpanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSubsessions?.();
          }}
        >
          <span
            className={resolvePreviewIndicatorClassName(entry.session, {
              isActive,
              hasSubsessions
            })}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span
          className={resolvePreviewIndicatorClassName(entry.session, {
            isActive,
            hasSubsessions
          })}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        className="mobile-conversation-preview-item terminal-mobile-session-primary"
        data-active={isActive}
        onClick={() => onActivate(entry)}
      >
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
  options: {
    isActive: boolean;
    hasSubsessions: boolean;
  }
) {
  const className = resolveSessionIndicatorClassName("mobile-conversation-preview-indicator", session, {
    hasSubagents: options.hasSubsessions
  });

  if (className.endsWith(" is-idle") && options.isActive) {
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
  return (
    <DesktopModal
      open={open}
      title={t("shell.archiveConfirmTitle")}
      description={t("shell.archiveConfirmDescription")}
      size="narrow"
      layout="confirm"
      dismissible={!busy}
      showCloseButton={false}
      footer={(
        <ModalActions>
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
        </ModalActions>
      )}
      onClose={onClose}
    >
      <></>
    </DesktopModal>
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
  return (
    <DesktopModal
      open={open}
      title={t("shell.archiveModalTitle")}
      description={
        workspaceName
          ? `${workspaceName} · ${t("shell.archiveModalDescription")}`
          : t("shell.archiveModalDescription")
      }
      size="regular"
      layout="list"
      dismissible={!restoringSessionId}
      showCloseButton={false}
      onClose={onClose}
    >
      {sessions.length > 0 ? (
        <ModalList className="workbench-archive-list">
          {sessions.map((session) => {
            const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));

            return (
              <ModalListItem
                key={session.sessionId}
                className="workbench-archive-item"
                trailing={(
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
                )}
              >
                <div className="workbench-archive-item-main">
                  <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                  <p>{formatMobilePreviewMeta(session)}</p>
                </div>
              </ModalListItem>
            );
          })}
        </ModalList>
      ) : (
        <ModalEmptyState
          title={t("shell.archiveEmpty")}
          compact
          className="workbench-section-empty"
        />
      )}
    </DesktopModal>
  );
}

function ConversationBranchTreeButton(input: {
  onOpenBranchTree: () => void;
}) {
  return (
    <button
      type="button"
      className="conversation-header-ai-button"
      aria-label={t("conversation.branchTreeAction")}
      title={t("conversation.branchTreeAction")}
      onClick={input.onOpenBranchTree}
    >
      <span className="conversation-header-ai-button-label" aria-hidden="true">
        <BranchTreeActionIcon />
      </span>
    </button>
  );
}

function ParallelForkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 3.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 0 1 0-3.5Zm0 6a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 0 1 0-3.5Zm8-3a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 0 1 0-3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5.75 5h2.15c1.35 0 2.45 1.1 2.45 2.45v.1M5.75 11h2.15c1.35 0 2.45-1.1 2.45-2.45V8.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
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

function sanitizeForkTimelineMessages(
  session: SessionSummaryDto | null,
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  if (
    !session
    || session.forkSourceType !== "message"
    || typeof session.inheritedPrefixMessageCount !== "number"
    || session.inheritedPrefixMessageCount < 0
  ) {
    return messages;
  }

  const childCreatedAt = session.createdAt?.trim() || "";

  if (childCreatedAt.length === 0) {
    return messages;
  }

  const inheritedBoundary = Math.max(0, session.inheritedPrefixMessageCount);

  return messages.filter((message) => {
    if (message.sequence <= inheritedBoundary) {
      return true;
    }

    return message.timestamp >= childCreatedAt;
  });
}
