import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { ModalActions, ModalSection } from "../../../components/ModalAtoms";
import {
  openFilesExternalWindow,
  openGitExternalWindow,
  openProcessesExternalWindow,
  openTerminalsExternalWindow
} from "../../../platform/desktop/window-openers";
import { resolveMacOsNativeTitlebarDragRegion } from "../../../platform/desktop/window-drag";
import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import type { WorkspaceVisualContext } from "../../workbench/utils/worktree-visual-context";
import {
  buildWorkspaceVisualContextMap,
  createFallbackWorkspaceVisualContext,
  createWorkspaceToneStyle
} from "../../workbench/utils/worktree-visual-context";
import {
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  buildWorkspaceTerminalsPath,
  flattenNavigationSessions
} from "../../workbench/utils/workbench-navigation";
import {
  deleteSession,
  getParallelGroupDetail,
  promoteSessionIsolatedWorkspace,
  type ParallelSessionGroupDetailDto,
  type SessionIsolatedWorkspaceSummaryDto,
  type SessionSummaryDto
} from "../api/conversation-api";
import { getProviderDisplayName } from "../capability/provider-ui";
import { ParallelSessionCreateModal } from "./ParallelSessionCreateModal";
import { ComposerPanel } from "./ComposerPanel";
import { ConnectionBanner } from "./ConnectionBanner";
import { FileContextPanel } from "./FileContextPanel";
import { GitSidebar } from "./GitSidebar";
import { MessageTimeline } from "./MessageTimeline";
import { PermissionRequestList } from "./PermissionRequestList";
import { QueuedMessageList } from "./QueuedMessageList";
import { useWorkbenchShell } from "./WorkbenchLayout";
import {
  focusComposerInput,
  useLiveSessionController
} from "../runtime/use-live-session-controller";
import { TerminalManagerPanel } from "../../workbench/components/TerminalManagerPanel";
import { TerminalPage } from "../../terminal/pages/TerminalPage";
import {
  createParallelGroupTransitionSpec,
  type ParallelGroupTransitionSpec,
  createParallelPaneStyle,
  createParallelGroupStyle,
  PARALLEL_PANE_COLOR_PRESETS,
  readParallelPaneColorOverride,
  readParallelGroupTransitionSignal,
  resolveParallelGroupLabel,
  resolveSessionNavigationWorkspaceId,
  resolveSessionToolWorkspaceId,
  resolveSessionIsolatedWorkspaceBranchName,
  writeParallelPaneColorOverride
} from "../parallel-session-display";
import {
  resolveParallelDesktopResizeTarget,
  resolveParallelMinimumPaneWidth
} from "../parallel-conversation-layout";
const PARALLEL_DESKTOP_RESIZE_DURATION_MS = 240;
const PARALLEL_TOOLS_PANEL_DEFAULT_WIDTH = 920;
const PARALLEL_TOOLS_PANEL_DEFAULT_HEIGHT = 760;
const PARALLEL_TOOLS_PANEL_MIN_WIDTH = 360;
const PARALLEL_TOOLS_PANEL_MIN_HEIGHT = 320;
const PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN = 16;
const PARALLEL_INFO_POPOVER_MAX_WIDTH = 428;
const PARALLEL_INFO_POPOVER_MIN_WIDTH = 404;
const PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN = 12;

interface ParallelToolsPanelFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ParallelInfoPopoverFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

interface ClampParallelToolsPanelFrameOptions {
  readonly minWidth?: number;
  readonly minHeight?: number;
}

interface ParallelConversationGroupViewProps {
  readonly groupId: string;
  readonly currentSessionId: string;
}

interface ParallelConversationMemberPaneProps {
  readonly entry: {
    session: SessionSummaryDto;
    workspaceId: string;
    ordinal: number;
    memberPrompt: string | null;
    model: string | null;
    sessionIsolatedWorkspace: SessionIsolatedWorkspaceSummaryDto | null;
  };
  readonly isCurrent: boolean;
  readonly workspaceContext: WorkspaceVisualContext | null;
  readonly infoOpen: boolean;
  readonly onCloseInfo: () => void;
  readonly onToggleInfo: () => void;
  readonly onPromoteWorkspace: (workspaceId: string) => void | Promise<void>;
  readonly promotingWorkspaceId: string | null;
  readonly onRemoveSession: (sessionId: string) => void | Promise<void>;
  readonly removingSessionId: string | null;
}

function clampParallelToolsPanelFrame(
  frame: ParallelToolsPanelFrame,
  options?: ClampParallelToolsPanelFrameOptions
): ParallelToolsPanelFrame {
  if (typeof window === "undefined") {
    return frame;
  }

  const viewportMaxWidth = Math.max(0, window.innerWidth - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN * 2);
  const viewportMaxHeight = Math.max(0, window.innerHeight - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN * 2);
  const minWidth = Math.min(options?.minWidth ?? PARALLEL_TOOLS_PANEL_MIN_WIDTH, viewportMaxWidth);
  const minHeight = Math.min(options?.minHeight ?? PARALLEL_TOOLS_PANEL_MIN_HEIGHT, viewportMaxHeight);
  const maxWidth = Math.max(
    minWidth,
    viewportMaxWidth
  );
  const maxHeight = Math.max(
    minHeight,
    viewportMaxHeight
  );
  const width = Math.min(Math.max(frame.width, minWidth), maxWidth);
  const height = Math.min(Math.max(frame.height, minHeight), maxHeight);
  const x = Math.min(
    Math.max(frame.x, PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN),
    Math.max(PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN, window.innerWidth - width - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN)
  );
  const y = Math.min(
    Math.max(frame.y, PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN),
    Math.max(PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN)
  );

  return {
    x,
    y,
    width,
    height
  };
}

function createDefaultParallelToolsPanelFrame(triggerRect: DOMRect | null): ParallelToolsPanelFrame {
  if (typeof window === "undefined") {
    return {
      x: PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN,
      y: PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN,
      width: PARALLEL_TOOLS_PANEL_DEFAULT_WIDTH,
      height: PARALLEL_TOOLS_PANEL_DEFAULT_HEIGHT
    };
  }

  const width = Math.min(
    PARALLEL_TOOLS_PANEL_DEFAULT_WIDTH,
    Math.max(PARALLEL_TOOLS_PANEL_MIN_WIDTH, window.innerWidth - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN * 2)
  );
  const height = Math.min(
    PARALLEL_TOOLS_PANEL_DEFAULT_HEIGHT,
    Math.max(PARALLEL_TOOLS_PANEL_MIN_HEIGHT, window.innerHeight - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN * 2)
  );

  return clampParallelToolsPanelFrame({
    x:
      (triggerRect?.right ?? window.innerWidth - PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN)
      - width
      + 28,
    y: Math.max((triggerRect?.bottom ?? 48) + 8, PARALLEL_TOOLS_PANEL_VIEWPORT_MARGIN),
    width,
    height
  });
}

function createParallelToolsPanelFrameFromPane(paneRect: DOMRect | null): ParallelToolsPanelFrame | null {
  if (!paneRect || paneRect.width <= 0 || paneRect.height <= 0) {
    return null;
  }

  return clampParallelToolsPanelFrame(
    {
      x: paneRect.left,
      y: paneRect.top,
      width: paneRect.width,
      height: paneRect.height
    },
    {
      minWidth: Math.min(PARALLEL_TOOLS_PANEL_MIN_WIDTH, paneRect.width),
      minHeight: Math.min(PARALLEL_TOOLS_PANEL_MIN_HEIGHT, paneRect.height)
    }
  );
}

function createParallelInfoPopoverFrame(triggerRect: DOMRect | null): ParallelInfoPopoverFrame {
  if (typeof window === "undefined") {
    return {
      x: PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN,
      y: PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN,
      width: PARALLEL_INFO_POPOVER_MAX_WIDTH
    };
  }

  const width = Math.min(
    PARALLEL_INFO_POPOVER_MAX_WIDTH,
    Math.max(PARALLEL_INFO_POPOVER_MIN_WIDTH, window.innerWidth - PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN * 2)
  );

  return {
    x: Math.min(
      Math.max(
        (triggerRect?.right ?? window.innerWidth - PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN) - width,
        PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN
      ),
      Math.max(
        PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN,
        window.innerWidth - width - PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN
      )
    ),
    y: Math.max(
      PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN,
      (triggerRect?.bottom ?? PARALLEL_INFO_POPOVER_VIEWPORT_MARGIN) + 8
    ),
    width
  };
}

export function ParallelConversationGroupView({
  groupId,
  currentSessionId
}: ParallelConversationGroupViewProps) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const macOsNativeTitlebarDragRegion = resolveMacOsNativeTitlebarDragRegion(platform);
  const { showToast } = useToast();
  const {
    navigationGroups,
    requestNavigationRefresh
  } = useWorkbenchShell();
  const flattenedEntries = useMemo(
    () => flattenNavigationSessions(navigationGroups),
    [navigationGroups]
  );
  const navigationEntryBySessionId = useMemo(
    () => new Map(flattenedEntries.map((entry) => [entry.session.sessionId, entry] as const)),
    [flattenedEntries]
  );
  const workspaceVisualContextMap = useMemo(
    () => buildWorkspaceVisualContextMap(navigationGroups),
    [navigationGroups]
  );
  const [detail, setDetail] = useState<ParallelSessionGroupDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openInfoSessionId, setOpenInfoSessionId] = useState<string | null>(null);
  const [promotingWorkspaceId, setPromotingWorkspaceId] = useState<string | null>(null);
  const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
  const [enteringTransition, setEnteringTransition] = useState<ParallelGroupTransitionSpec | null>(null);
  const [appendModalOpen, setAppendModalOpen] = useState(false);
  const resizedSignatureRef = useRef<string | null>(null);
  const enteringTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      setLoading(true);
      setError(null);

      try {
        const nextDetail = await getParallelGroupDetail(groupId);

        if (cancelled) {
          return;
        }

        setDetail(nextDetail);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : t("shell.parallelGroupLoadFailed"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    const transitionSignal = readParallelGroupTransitionSignal(groupId);

    if (!transitionSignal) {
      return;
    }

    triggerEnteringAnimation(transitionSignal);
  }, [groupId]);

  useEffect(() => {
    return () => {
      if (enteringTimerRef.current !== null) {
        window.clearTimeout(enteringTimerRef.current);
      }
    };
  }, []);

  const memberEntries = useMemo(() => {
    if (!detail) {
      return [];
    }

    return detail.members
      .slice()
      .sort((left, right) => left.member.ordinal - right.member.ordinal)
      .map((item) => {
        const latestEntry = navigationEntryBySessionId.get(item.session.sessionId);
        const latestSession = latestEntry?.session ?? item.session;

        return {
          session: latestSession,
          workspaceId:
            latestEntry?.workspace.id
            ?? resolveSessionNavigationWorkspaceId(
              latestSession,
              item.sessionIsolatedWorkspace
            ),
          ordinal: item.member.ordinal,
          memberPrompt: item.member.memberPrompt,
          model: item.member.model,
          sessionIsolatedWorkspace: item.sessionIsolatedWorkspace
        };
      });
  }, [detail, navigationEntryBySessionId]);

  useEffect(() => {
    if (
      !platform.isDesktop
      || (platform.ui.osFamily !== "macos" && platform.ui.osFamily !== "windows")
      || memberEntries.length < 2
    ) {
      return;
    }

    const resizeSignature = `${groupId}:${memberEntries.length}`;

    if (resizedSignatureRef.current === resizeSignature) {
      return;
    }

    resizedSignatureRef.current = resizeSignature;

    let cancelled = false;

    async function widenDesktopWindow() {
      try {
        const windowModule = await import("@tauri-apps/api/window");
        const dpiModule = await import("@tauri-apps/api/dpi");
        const appWindow = windowModule.getCurrentWindow();
        const currentSize = await appWindow.innerSize();
        const scaleFactor = await appWindow.scaleFactor();
        const monitor = await windowModule.currentMonitor();

        if (cancelled || scaleFactor <= 0) {
          return;
        }

        const currentWidth = currentSize.width / scaleFactor;
        const currentHeight = currentSize.height / scaleFactor;
        const monitorWidth = monitor ? monitor.workArea.size.width / monitor.scaleFactor : currentWidth * 1.5;
        const targetWidth = resolveParallelDesktopResizeTarget({
          memberCount: memberEntries.length,
          currentWidth,
          monitorWidth
        });

        if (targetWidth <= currentWidth + 24) {
          return;
        }

        const frameCount = 10;
        await new Promise((resolve) => window.setTimeout(resolve, 56));

        for (let index = 1; index <= frameCount; index += 1) {
          if (cancelled) {
            return;
          }

          const progress = index / frameCount;
          const easedProgress = 1 - Math.pow(1 - progress, 3);
          const nextWidth = currentWidth + (targetWidth - currentWidth) * easedProgress;

          await appWindow.setSize(new dpiModule.LogicalSize(nextWidth, currentHeight));
          await new Promise((resolve) =>
            window.setTimeout(resolve, PARALLEL_DESKTOP_RESIZE_DURATION_MS / frameCount)
          );
        }
      } catch {
        return;
      }
    }

    void widenDesktopWindow();

    return () => {
      cancelled = true;
    };
  }, [groupId, memberEntries.length, platform.isDesktop, platform.ui.osFamily]);

  async function handlePromoteWorkspace(id: string) {
    setPromotingWorkspaceId(id);

    try {
      const response = await promoteSessionIsolatedWorkspace(id);
      await requestNavigationRefresh();
      setDetail((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          members: current.members.map((item) =>
            item.sessionIsolatedWorkspace?.id === id
              ? {
                  ...item,
                  sessionIsolatedWorkspace: {
                    ...item.sessionIsolatedWorkspace,
                    workspaceId: response.workspace.id,
                    lifecycleStatus: "promoted",
                    promotedAt: response.record.promotedAt
                  }
                }
              : item
          )
        };
      });
      showToast({
        title: t("shell.parallelWorkspacePromotedBadge"),
        tone: "success"
      });
    } catch (promoteError) {
      showToast({
        title: promoteError instanceof Error ? promoteError.message : t("shell.parallelGroupLoadFailed"),
        tone: "error"
      });
    } finally {
      setPromotingWorkspaceId(null);
    }
  }

  async function handleRemoveSession(sessionId: string) {
    if (removingSessionId) {
      return;
    }

    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return;
    }

    const nextSession = memberEntries.find((item) => item.session.sessionId !== normalizedSessionId) ?? null;
    const fallbackWorkspaceId = detail?.group.workspaceId ?? nextSession?.workspaceId ?? null;

    setRemovingSessionId(normalizedSessionId);

    try {
      await deleteSession(normalizedSessionId);
      writeParallelPaneColorOverride(normalizedSessionId, null);
      setOpenInfoSessionId((current) => (current === normalizedSessionId ? null : current));
      setDetail((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          members: current.members.filter((item) => item.session.sessionId !== normalizedSessionId)
        };
      });
      await requestNavigationRefresh();

      if (currentSessionId === normalizedSessionId) {
        if (nextSession) {
          navigate(buildWorkspaceSessionPath(nextSession.workspaceId, nextSession.session.sessionId));
        } else if (fallbackWorkspaceId) {
          navigate(buildWorkspaceSessionIndexPath(fallbackWorkspaceId));
        }
      }

      showToast({
        title: t("shell.deleteSessionSuccess"),
        tone: "success"
      });
    } catch (removeError) {
      showToast({
        title: removeError instanceof Error ? removeError.message : t("shell.deleteSessionFailed"),
        tone: "error"
      });
    } finally {
      setRemovingSessionId(null);
    }
  }

  function triggerEnteringAnimation(transition: ParallelGroupTransitionSpec) {
    setEnteringTransition(transition);

    if (enteringTimerRef.current !== null) {
      window.clearTimeout(enteringTimerRef.current);
    }

    enteringTimerRef.current = window.setTimeout(() => {
      setEnteringTransition(null);
      enteringTimerRef.current = null;
    }, transition.totalDurationMs);
  }

  if (loading && !detail) {
    return (
      <main className="workbench-page conversation-page-shell parallel-conversation-page">
        <section className="parallel-conversation-empty-state">
          <strong>{t("shell.parallelCreateSubmitting")}</strong>
        </section>
      </main>
    );
  }

  if (error && !detail) {
    return (
      <main className="workbench-page conversation-page-shell parallel-conversation-page">
        <section className="parallel-conversation-empty-state error">
          <strong>{t("shell.parallelGroupLoadFailed")}</strong>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (memberEntries.length === 0) {
    return (
      <main className="workbench-page conversation-page-shell parallel-conversation-page">
        <section className="parallel-conversation-empty-state">
          <strong>{t("shell.parallelGroupEmpty")}</strong>
        </section>
      </main>
    );
  }

  const workspaceName =
    workspaceVisualContextMap[detail?.group.workspaceId ?? ""]?.displayName
    ?? detail?.group.workspaceId
    ?? t("common.unknown");
  const anchorMember =
    memberEntries.find((item) => item.session.sessionId === detail?.group.anchorSessionId)
    ?? memberEntries[0]
    ?? null;
  const canAppendMembers = memberEntries.length < 4;
  const parallelPageStyle = {
    "--parallel-pane-min-width": `${resolveParallelMinimumPaneWidth(memberEntries.length)}px`,
    ...(enteringTransition
      ? {
          "--parallel-pane-enter-delay": `${enteringTransition.paneEnterDelayMs}ms`,
          "--parallel-pane-enter-duration": `${enteringTransition.paneEnterDurationMs}ms`,
          "--parallel-grid-reveal-delay": `${enteringTransition.gridRevealDelayMs}ms`,
          "--parallel-grid-reveal-duration": `${enteringTransition.gridRevealDurationMs}ms`,
          "--parallel-shell-expand-duration": `${enteringTransition.shellExpandDurationMs}ms`,
          "--parallel-pane-stagger-delay": `${enteringTransition.paneStaggerMs}ms`
        }
      : {})
  } as CSSProperties;

  return (
    <main
      className="workbench-page conversation-page-shell parallel-conversation-page"
      data-parallel-count={memberEntries.length}
      data-parallel-entering={enteringTransition ? "true" : undefined}
      style={parallelPageStyle}
    >
      <header
        className="parallel-conversation-group-header"
        data-window-drag-handle="parallel-conversation-group-titlebar"
        data-tauri-drag-region={macOsNativeTitlebarDragRegion}
      >
        <div
          className="parallel-conversation-group-titlebar"
          data-tauri-drag-region={macOsNativeTitlebarDragRegion}
        >
          <div
            className="parallel-conversation-group-titlemain"
            data-tauri-drag-region={macOsNativeTitlebarDragRegion}
          >
            <span className="session-parallel-badge">{t("shell.parallelGroupBadge")}</span>
            <strong data-tauri-drag-region={macOsNativeTitlebarDragRegion}>
              {detail?.group.sharedPrompt?.trim() || t("common.unknown")}
            </strong>
          </div>
          <button
            type="button"
            className="secondary-button parallel-conversation-group-add-button"
            aria-label={t("shell.parallelAppendAction")}
            title={t("shell.parallelAppendAction")}
            data-window-drag="ignore"
            disabled={!canAppendMembers}
            onClick={() => {
              if (!canAppendMembers) {
                return;
              }

              setAppendModalOpen(true);
            }}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>
      <div className="parallel-conversation-grid">
        {memberEntries.map((item) => {
          const workspaceContext =
            workspaceVisualContextMap[item.workspaceId]
            ?? createFallbackWorkspaceVisualContext({
              id: item.workspaceId,
              name: item.session.workspaceId,
              path: item.session.workspaceId,
              repoRoot: item.session.workspaceId
            });

          return (
            <ParallelConversationMemberPane
              key={item.session.sessionId}
              entry={item}
              isCurrent={item.session.sessionId === currentSessionId}
              workspaceContext={workspaceContext}
              infoOpen={openInfoSessionId === item.session.sessionId}
              promotingWorkspaceId={promotingWorkspaceId}
              onCloseInfo={() => {
                setOpenInfoSessionId(null);
              }}
              onToggleInfo={() => {
                setOpenInfoSessionId((current) =>
                  current === item.session.sessionId ? null : item.session.sessionId
                );
              }}
              onPromoteWorkspace={handlePromoteWorkspace}
              onRemoveSession={handleRemoveSession}
              removingSessionId={removingSessionId}
            />
          );
        })}
      </div>
      <ParallelSessionCreateModal
        open={appendModalOpen}
        source={
          detail
            ? {
                kind: "group",
                groupId: detail.group.id,
                workspaceId: detail.group.workspaceId,
                workspaceName,
                sharedPrompt: detail.group.sharedPrompt?.trim() || "",
                currentMemberCount: memberEntries.length,
                defaultProvider: anchorMember?.session.provider ?? "codex"
              }
            : null
        }
        onClose={() => setAppendModalOpen(false)}
        onCreated={async (nextDetail) => {
          setDetail(nextDetail);
          setAppendModalOpen(false);
          triggerEnteringAnimation(createParallelGroupTransitionSpec("append"));
          await requestNavigationRefresh();
          showToast({
            title: t("shell.parallelAppendSucceeded"),
            tone: "success"
          });
        }}
      />
    </main>
  );
}

function ParallelConversationMemberPane({
  entry,
  isCurrent,
  workspaceContext,
  infoOpen,
  onCloseInfo,
  onToggleInfo,
  onPromoteWorkspace,
  promotingWorkspaceId,
  onRemoveSession,
  removingSessionId
}: ParallelConversationMemberPaneProps) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { showToast } = useToast();
  const {
    navigationGroups,
    requestNavigationRefresh,
    selectWorkspace,
    setSessionWorkspace,
    upsertNavigationSession,
    markNavigationSessionSeen
  } = useWorkbenchShell();
  const sessionId = entry.session.sessionId;
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeToolPanel, setActiveToolPanel] = useState<"files" | "git" | "processes" | "terminals">("files");
  const [toolsPinned, setToolsPinned] = useState(false);
  const [toolsFrame, setToolsFrame] = useState<ParallelToolsPanelFrame | null>(null);
  const [infoPopoverFrame, setInfoPopoverFrame] = useState<ParallelInfoPopoverFrame | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const headerLayerRef = useRef<HTMLElement | null>(null);
  const infoTriggerRef = useRef<HTMLButtonElement | null>(null);
  const infoPopoverRef = useRef<HTMLDivElement | null>(null);
  const toolsPanelRef = useRef<HTMLDivElement | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [paneColorOverride, setPaneColorOverride] = useState<string | null>(() =>
    readParallelPaneColorOverride(sessionId)
  );
  const {
    session,
    capabilities,
    messages,
    timelineMessages,
    permissionRequests,
    queuedMessages,
    contextUsage,
    historyState,
    runtimeInterruptSource,
    loadingOlderMessages,
    hasOlderMessages,
    connectionState,
    sending,
    replyingPermissionRequestId,
    deletingQueueItemId,
    steeringQueueItemId,
    forkDraft,
    setForkDraft,
    composerHasActiveRun,
    composerCanInterrupt,
    composerIsRunning,
    canSteerQueuedMessage,
    hasPendingQueuedMessages,
    runtimeThinkingPlaceholder,
    reconnect,
    loadOlderMessages,
    retryMessage,
    send,
    queue,
    interrupt,
    replyPermissionRequest,
    deleteQueuedMessage,
    steerQueuedMessage
  } = useLiveSessionController({
    sessionId,
    externalSession: entry.session,
    onSeen: (seenSessionId, seenAt) => {
      markNavigationSessionSeen(seenSessionId, seenAt);
    },
    onRequestNavigationRefresh: requestNavigationRefresh,
    onUpsertNavigationSession: upsertNavigationSession,
    onNavigateToSession: (workspaceId, targetSessionId) => {
      selectWorkspace(workspaceId);
      navigate(buildWorkspaceSessionPath(workspaceId, targetSessionId));
    },
    onBindSessionWorkspace: setSessionWorkspace,
    onResolveMissingSession: () => {
      void requestNavigationRefresh();
    },
    permissionRequestNotificationMode: "current_only",
    permissionToastIdPrefix: "parallel-permission-request",
    isCurrent,
    enableRuntimeErrorHandling: true,
    enableCompletionHaptics: false,
    enableThinkingPlaceholder: true,
    enableForkTimelineSanitizer: true
  });
  const parallelGroupStyle = createParallelGroupStyle(session?.parallelGroup ?? entry.session.parallelGroup);
  const parallelPaneStyle = createParallelPaneStyle({
    groupId: (session?.parallelGroup ?? entry.session.parallelGroup)?.groupId ?? "parallel-group",
    sessionId,
    ordinal: entry.ordinal,
    overrideColor: paneColorOverride
  });
  const parallelGroupLabel = resolveParallelGroupLabel(session?.parallelGroup ?? entry.session.parallelGroup);
  const paneSessionIsolatedWorkspace = session?.sessionIsolatedWorkspace ?? entry.sessionIsolatedWorkspace;
  const isolatedWorkspaceBranchName = resolveSessionIsolatedWorkspaceBranchName(
    paneSessionIsolatedWorkspace
  );
  const modelLabel =
    contextUsage?.modelId?.trim()
    || entry.model?.trim()
    || t("shell.parallelPaneModelFallback");
  const panePromptLabel = entry.memberPrompt?.trim() || t("shell.parallelPanePromptFallback");
  const navigationWorkspaceId = entry.workspaceId;
  const toolWorkspaceId = resolveSessionToolWorkspaceId(
    session ?? entry.session,
    paneSessionIsolatedWorkspace
  );
  const toolWorkspaceName =
    toolWorkspaceId === navigationWorkspaceId
      ? workspaceContext?.displayName ?? navigationWorkspaceId
      : isolatedWorkspaceBranchName ?? panePromptLabel;
  const isRemovingCurrentSession = removingSessionId === sessionId;
  const infoPopoverStyle: CSSProperties | undefined =
    infoOpen && infoPopoverFrame
      ? {
          ...(createWorkspaceToneStyle(workspaceContext) ?? {}),
          ...(parallelGroupStyle ?? {}),
          ...parallelPaneStyle,
          left: `${infoPopoverFrame.x}px`,
          top: `${infoPopoverFrame.y}px`,
          width: `${infoPopoverFrame.width}px`
        }
      : undefined;
  const toolsPanelStyle: CSSProperties | undefined =
    toolsOpen && toolsFrame
      ? {
          ...(createWorkspaceToneStyle(workspaceContext) ?? {}),
          ...(parallelGroupStyle ?? {}),
          ...parallelPaneStyle,
          left: `${toolsFrame.x}px`,
          top: `${toolsFrame.y}px`,
          width: `${toolsFrame.width}px`,
          height: `${toolsFrame.height}px`
        }
      : undefined;

  useEffect(() => {
    setPaneColorOverride(readParallelPaneColorOverride(sessionId));
    setToolsOpen(false);
    setToolsPinned(false);
    setToolsFrame(null);
    setInfoPopoverFrame(null);
    setActiveToolPanel("files");
  }, [sessionId]);

  useEffect(() => {
    if (!infoOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (
        headerLayerRef.current?.contains(target)
        || infoPopoverRef.current?.contains(target)
        || toolsPanelRef.current?.contains(target)
      ) {
        return;
      }

      onCloseInfo();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [infoOpen, onCloseInfo]);

  useEffect(() => {
    if (!infoOpen) {
      setInfoPopoverFrame(null);
      return;
    }

    const updateFrame = () => {
      setInfoPopoverFrame(
        createParallelInfoPopoverFrame(infoTriggerRef.current?.getBoundingClientRect() ?? null)
      );
    };

    updateFrame();
    window.addEventListener("resize", updateFrame);
    window.addEventListener("scroll", updateFrame, true);

    return () => {
      window.removeEventListener("resize", updateFrame);
      window.removeEventListener("scroll", updateFrame, true);
    };
  }, [infoOpen]);

  useEffect(() => {
    if (!toolsOpen) {
      return;
    }

    const handleResize = () => {
      setToolsFrame((current) => (current ? clampParallelToolsPanelFrame(current) : current));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [toolsOpen]);

  async function openWorkspaceTerminal() {
    if (toolWorkspaceId === navigationWorkspaceId) {
      selectWorkspace(navigationWorkspaceId);
    }

    if (platform.isDesktop && platform.bridge.supported) {
      const result = await openTerminalsExternalWindow(platform, {
        workspaceId: toolWorkspaceId,
        workspaceName: toolWorkspaceName,
        focusOwner: "terminal-page"
      });

      if (!result.ok) {
        showToast({
          title: result.detail ?? t("terminalManager.openExternalFailed"),
          tone: "error"
        });
      }
      return;
    }

    navigate(buildWorkspaceTerminalsPath(toolWorkspaceId));
  }

  async function openActiveToolInExternalWindow() {
    if (!platform.isDesktop || !platform.bridge.supported) {
      return;
    }

    if (activeToolPanel === "files") {
      const result = await openFilesExternalWindow(platform, {
        workspaceId: toolWorkspaceId,
        workspaceName: toolWorkspaceName,
        sessionId,
        focusOwner: "file-context-panel"
      });

      if (!result.ok) {
        showToast({
          title: result.detail ?? t("conversation.filePanelOpenExternalFailed"),
          tone: "error"
        });
      }
      return;
    }

    if (activeToolPanel === "git") {
      const result = await openGitExternalWindow(platform, {
        workspaceId: toolWorkspaceId,
        workspaceName: toolWorkspaceName,
        focusOwner: "git-sidebar"
      });

      if (!result.ok) {
        showToast({
          title: result.detail ?? t("git.openExternalFailed"),
          tone: "error"
        });
      }
      return;
    }

    if (activeToolPanel === "processes") {
      const result = await openProcessesExternalWindow(platform, {
        workspaceId: toolWorkspaceId,
        workspaceName: toolWorkspaceName,
        focusOwner: "terminal-manager-panel"
      });

      if (!result.ok) {
        showToast({
          title: result.detail ?? t("terminalManager.openExternalFailed"),
          tone: "error"
        });
      }
      return;
    }

    await openWorkspaceTerminal();
  }

  function openToolsPanel() {
    setToolsOpen(true);
    setToolsFrame(
      createParallelToolsPanelFrameFromPane(paneRef.current?.getBoundingClientRect() ?? null)
      ?? createDefaultParallelToolsPanelFrame(
        toolsTriggerRef.current?.getBoundingClientRect() ?? null
      )
    );
  }

  function handleToolsDragPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !toolsFrame) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = toolsFrame;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setToolsFrame(
        clampParallelToolsPanelFrame({
          ...startFrame,
          x: startFrame.x + (moveEvent.clientX - startX),
          y: startFrame.y + (moveEvent.clientY - startY)
        })
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handleToolsResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !toolsFrame) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = toolsFrame;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setToolsFrame(
        clampParallelToolsPanelFrame({
          ...startFrame,
          width: startFrame.width + (moveEvent.clientX - startX),
          height: startFrame.height + (moveEvent.clientY - startY)
        })
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  const toolsPanelOverlay =
    toolsOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={toolsPanelRef}
            className="parallel-pane-tools-popover"
            data-parallel-pane-layer={sessionId}
            data-pinned={toolsPinned ? "true" : undefined}
            data-workspace-tone={workspaceContext?.tone ?? "root"}
            style={toolsPanelStyle}
          >
            <div className="parallel-pane-tools-toolbar">
              <div
                className="parallel-pane-tools-drag-handle"
                onPointerDown={handleToolsDragPointerDown}
              >
                <span className="parallel-pane-tools-drag-dots" aria-hidden="true">
                  <PaneDragIcon />
                </span>
                <span>{t("shell.parallelPaneToolsAction")}</span>
              </div>
              <div
                className="parallel-pane-tools-tabs"
                role="tablist"
                aria-label={t("shell.parallelPaneToolsAction")}
              >
                {(["files", "git", "processes", "terminals"] as const).map((panelId) => (
                  <button
                    key={panelId}
                    type="button"
                    role="tab"
                    aria-selected={activeToolPanel === panelId}
                    className="parallel-pane-tools-tab"
                    onClick={() => {
                      setActiveToolPanel(panelId);
                    }}
                  >
                    {panelId === "files"
                      ? t("shell.filesEntry")
                      : panelId === "git"
                        ? t("shell.gitEntry")
                        : panelId === "processes"
                          ? t("shell.parallelPaneProcessesEntry")
                          : t("shell.terminalsEntry")}
                  </button>
                ))}
              </div>
              <div className="parallel-pane-tools-actions">
                <button
                  type="button"
                  className={`conversation-header-ai-button${toolsPinned ? " active" : ""}`}
                  aria-label={t("shell.parallelPanePinAction")}
                  title={t("shell.parallelPanePinAction")}
                  aria-pressed={toolsPinned}
                  onClick={() => {
                    setToolsPinned((current) => !current);
                  }}
                >
                  <span className="conversation-header-ai-button-label" aria-hidden="true">
                    <PanePinIcon />
                  </span>
                </button>
                {platform.isDesktop && platform.bridge.supported ? (
                  <button
                    type="button"
                    className="conversation-header-ai-button"
                    aria-label={t("shell.parallelPaneDetachAction")}
                    title={t("shell.parallelPaneDetachAction")}
                    onClick={() => {
                      void openActiveToolInExternalWindow();
                    }}
                  >
                    <span className="conversation-header-ai-button-label" aria-hidden="true">
                      <PaneDetachIcon />
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="conversation-header-ai-button"
                  aria-label={t("common.close")}
                  title={t("common.close")}
                  onClick={() => {
                    setToolsOpen(false);
                  }}
                >
                  <span className="conversation-header-ai-button-label" aria-hidden="true">
                    <PaneCloseIcon />
                  </span>
                </button>
              </div>
            </div>

            <div
              className="parallel-pane-tools-body"
              data-panel={activeToolPanel}
            >
              {activeToolPanel === "files" ? (
                <FileContextPanel
                  className="parallel-pane-tools-surface"
                  hideHeading
                  sessionId={sessionId}
                  workspaceId={toolWorkspaceId}
                />
              ) : activeToolPanel === "git" ? (
                <GitSidebar
                  className="parallel-pane-tools-surface"
                  panelActive
                  workspaceId={toolWorkspaceId}
                />
              ) : activeToolPanel === "processes" ? (
                <TerminalManagerPanel
                  className="parallel-pane-tools-surface parallel-pane-tools-process-panel"
                  currentWorkspaceId={toolWorkspaceId}
                  navigationGroups={navigationGroups}
                />
              ) : (
                <TerminalPage
                  embeddedMode
                  externalWindowWorkspaceId={toolWorkspaceId}
                  workbenchShellOverrides={{
                    navigationGroups,
                    currentWorkspaceId: toolWorkspaceId,
                    selectWorkspace
                  }}
                />
              )}
            </div>
            <button
              type="button"
              className="parallel-pane-tools-resize-handle"
              aria-label={t("shell.parallelPaneResizeAction")}
              title={t("shell.parallelPaneResizeAction")}
              onPointerDown={handleToolsResizePointerDown}
            >
              <span aria-hidden="true">
                <PaneResizeIcon />
              </span>
            </button>
          </div>,
          document.body
        )
      : null;

  const infoPopoverOverlay =
    infoOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={infoPopoverRef}
            className="parallel-pane-info-popover"
            data-parallel-pane-layer={sessionId}
            data-workspace-tone={workspaceContext?.tone ?? "root"}
            style={infoPopoverStyle}
          >
            <strong className="parallel-pane-info-title">{t("shell.parallelPaneInfoTitle")}</strong>
            <ModalSection>
              <dl className="parallel-pane-info-list">
                <div>
                  <dt>{t("shell.createSessionProviderLabel")}</dt>
                  <dd>{getProviderDisplayName((session ?? entry.session).provider, "full")}</dd>
                </div>
                <div>
                  <dt>{t("shell.parallelPaneModelFallback")}</dt>
                  <dd>{modelLabel}</dd>
                </div>
                <div>
                  <dt>{t("shell.parallelPaneIsolatedWorkspaceTitle")}</dt>
                  <dd>{isolatedWorkspaceBranchName ?? t("common.unknown")}</dd>
                </div>
              </dl>
            </ModalSection>

            <ModalSection
              heading={t("shell.parallelPaneColorPaletteLabel")}
              description={t("shell.parallelPaneColorPaletteDescription")}
              actions={(
                <button
                  type="button"
                  className="ghost-button parallel-pane-color-reset"
                  disabled={!paneColorOverride || isRemovingCurrentSession}
                  onClick={() => {
                    writeParallelPaneColorOverride(sessionId, null);
                    setPaneColorOverride(null);
                  }}
                >
                  {t("shell.parallelPaneColorPaletteReset")}
                </button>
              )}
            >
              <div
                className="workbench-manage-color-palette parallel-pane-color-palette"
                aria-label={t("shell.parallelPaneColorPaletteLabel")}
              >
                {PARALLEL_PANE_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="workbench-manage-color-swatch"
                    aria-label={t("shell.manageWorkspaceColorSelectSwatch", {
                      color
                    })}
                    aria-pressed={paneColorOverride === color}
                    data-selected={paneColorOverride === color}
                    disabled={isRemovingCurrentSession}
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      const nextColor = writeParallelPaneColorOverride(sessionId, color);
                      setPaneColorOverride(nextColor);
                    }}
                  />
                ))}
              </div>
            </ModalSection>

            <ModalSection
              heading={t("shell.parallelPaneIsolatedWorkspaceTitle")}
              description={
                paneSessionIsolatedWorkspace?.lifecycleStatus === "active"
                  ? t("shell.parallelPanePromoteDescription")
                  : paneSessionIsolatedWorkspace?.lifecycleStatus === "promoted"
                    ? t("shell.parallelPaneRemovePromotedDescription")
                    : t("shell.parallelPaneRemoveDescription")
              }
            >
              <ModalActions align="start" className="parallel-pane-action-row">
                {paneSessionIsolatedWorkspace?.lifecycleStatus === "active" ? (
                  <button
                    type="button"
                    className="secondary-button parallel-pane-promote-action"
                    disabled={
                      promotingWorkspaceId === paneSessionIsolatedWorkspace.id
                      || isRemovingCurrentSession
                    }
                    onClick={() => {
                      const isolatedWorkspaceId = paneSessionIsolatedWorkspace?.id;

                      if (!isolatedWorkspaceId) {
                        return;
                      }

                      void onPromoteWorkspace(isolatedWorkspaceId);
                    }}
                  >
                    {promotingWorkspaceId === paneSessionIsolatedWorkspace.id
                      ? t("shell.parallelPanePromoting")
                      : t("shell.parallelPanePromoteAction")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary-button workbench-danger-button"
                  disabled={isRemovingCurrentSession}
                  onClick={() => {
                    void onRemoveSession(sessionId);
                  }}
                >
                  {isRemovingCurrentSession
                    ? t("shell.parallelPaneRemoving")
                    : t("shell.parallelPaneRemoveAction")}
                </button>
              </ModalActions>
            </ModalSection>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <article
        ref={paneRef}
        className="parallel-conversation-pane"
        data-current={isCurrent ? "true" : undefined}
        data-workspace-tone={workspaceContext?.tone ?? "root"}
        data-parallel-role={(session?.parallelGroup ?? entry.session.parallelGroup)?.role ?? undefined}
        style={{
          "--parallel-pane-order": String(entry.ordinal),
          ...(createWorkspaceToneStyle(workspaceContext) ?? {}),
          ...(parallelGroupStyle ?? {}),
          ...parallelPaneStyle
        } as CSSProperties}
      >
        <header
          ref={headerLayerRef}
          className="parallel-conversation-pane-header"
        >
          <span className="parallel-conversation-pane-connector" aria-hidden="true" />
          <div className="parallel-conversation-pane-heading">
            {parallelGroupLabel ? <span className="session-parallel-badge">{parallelGroupLabel}</span> : null}
            <p className="parallel-conversation-pane-subtitle" title={panePromptLabel}>
              {panePromptLabel}
            </p>
            <div className="parallel-conversation-pane-meta">
              <span className={`session-provider-badge ${(session ?? entry.session).provider}`}>
                {getProviderDisplayName((session ?? entry.session).provider)}
              </span>
              <span className="parallel-conversation-pane-model">{modelLabel}</span>
            </div>
          </div>

          <div className="parallel-conversation-pane-actions">
            <button
              ref={infoTriggerRef}
              type="button"
              className="conversation-header-ai-button"
              aria-label={t("shell.parallelPaneInfoAction")}
              title={t("shell.parallelPaneInfoAction")}
              aria-expanded={infoOpen}
              onClick={() => {
                setToolsOpen(false);
                onToggleInfo();
              }}
            >
              <span className="conversation-header-ai-button-label" aria-hidden="true">
                <PaneInfoIcon />
              </span>
            </button>
            <button
              ref={toolsTriggerRef}
              type="button"
              className={`conversation-header-ai-button${toolsOpen ? " active" : ""}`}
              aria-label={t("shell.parallelPaneToolsAction")}
              title={t("shell.parallelPaneToolsAction")}
              aria-expanded={toolsOpen}
              onClick={() => {
                onCloseInfo();
                openToolsPanel();
              }}
            >
              <span className="conversation-header-ai-button-label" aria-hidden="true">
                <PaneToolsIcon />
              </span>
            </button>
          </div>
        </header>

      <div className="parallel-conversation-pane-body">
        <ConnectionBanner connectionState={connectionState} onReconnect={reconnect} />
        <PermissionRequestList
          requests={permissionRequests}
          replyingRequestId={replyingPermissionRequestId}
          onReply={replyPermissionRequest}
        />
        <div className="parallel-conversation-pane-timeline">
          <MessageTimeline
            sessionId={sessionId}
            messages={timelineMessages}
            historyState={historyState}
            loadingOlderMessages={loadingOlderMessages}
            hasOlderMessages={hasOlderMessages}
            provider={session?.provider ?? entry.session.provider}
            interruptedSource={runtimeInterruptSource}
            runtimeThinkingPlaceholder={runtimeThinkingPlaceholder}
            followTailUpdates
            onLoadOlderMessages={loadOlderMessages}
            onRetryMessage={retryMessage}
            onForkMessage={(message) => {
              const currentSession = session ?? entry.session;

              setForkDraft({
                sourceMessageId: message.id,
                sourceMessageSnapshot: {
                  role: message.role,
                  kind: message.kind ?? (message.role === "tool" ? "tool_result" : "text"),
                  content: message.content
                },
                  content: message.content,
                  sourceProvider: currentSession.provider,
                  workspaceId: currentSession.workspaceId,
                  targetProvider: currentSession.provider,
                  targetModel: null,
                  targetProviderConfigMode: currentSession.providerConfigMode ?? "global-default",
                  targetProviderPresetId: currentSession.providerPresetId ?? null
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
          onDelete={deleteQueuedMessage}
          onSteer={steerQueuedMessage}
        />
        <ComposerPanel
          capabilities={capabilities}
          draftStorageId={sessionId}
          initialModel={entry.model}
          workspaceId={(session ?? entry.session).workspaceId}
          initialProviderConfigMode={(session ?? entry.session).providerConfigMode ?? "global-default"}
          initialProviderPresetId={(session ?? entry.session).providerPresetId ?? null}
          forkDraft={forkDraft}
          onClearForkDraft={() => setForkDraft(null)}
          onForkDraftChange={(nextDraft) => setForkDraft(nextDraft)}
          hasActiveRun={composerHasActiveRun}
          contextUsage={contextUsage}
          taskProvider={(session ?? entry.session).provider}
          taskMessages={messages}
          hasPendingQueuedMessages={hasPendingQueuedMessages}
          canInterrupt={composerCanInterrupt}
          isSubmitting={sending}
          isRunning={composerIsRunning}
          onInterrupt={interrupt}
          onSend={send}
          onQueueSend={queue}
        />
      </div>
      </article>
      {infoPopoverOverlay}
      {toolsPanelOverlay}
    </>
  );
}

function PaneInfoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 6.1H8.01M7.35 7.6H8V10.3H8.65"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function PaneToolsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.2" height="4.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.3" y="2.5" width="4.2" height="4.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="9.3" width="4.2" height="4.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.3" y="9.3" width="4.2" height="4.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function PaneDragIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5" cy="4.5" r="0.9" fill="currentColor" />
      <circle cx="11" cy="4.5" r="0.9" fill="currentColor" />
      <circle cx="5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="11" cy="8" r="0.9" fill="currentColor" />
      <circle cx="5" cy="11.5" r="0.9" fill="currentColor" />
      <circle cx="11" cy="11.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

function PanePinIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10.9 3.1 12.9 5.1 10.9 6.1v2.1l-2.1 2.1v2.6l-.8-.8-.8.8v-2.6L5 8.2V6.1L3.1 5.1l2-2h5.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function PaneDetachIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 3.1H3.8A1.3 1.3 0 0 0 2.5 4.4v7.8a1.3 1.3 0 0 0 1.3 1.3h7.8a1.3 1.3 0 0 0 1.3-1.3V11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M8.1 3.1h4.4v4.4M12.3 3.3 7 8.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function PaneCloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function PaneResizeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.5 12.2 12.2 6.5M9 12.4 12.4 9M11.4 12.4 12.4 11.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function PaneTerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M5.2 6.1l1.7 1.5l-1.7 1.5M8.8 10h2.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}
