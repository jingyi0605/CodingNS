import {
  Suspense,
  useCallback,
  createContext,
  useContext,
  useDeferredValue,
  type Dispatch,
  useEffect,
  useId,
  useLayoutEffect,
  lazy,
  useMemo,
  useRef,
  type SetStateAction,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactNode
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";

import {
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem
} from "../../../components/ModalAtoms";
import {
  MobileWorkbenchShell,
  type MobileWorkbenchEntry
} from "../../mobile-shell/components/MobileWorkbenchShell";
import {
  resolveAdaptiveMobilePaneLayout,
  shouldPreferCompactNativeMobileLayout,
  shouldDockAuxiliaryPanel,
  shouldDockNavigationPanel
} from "../../mobile-shell/layouts/AdaptiveMobilePaneLayout";
import {
  WorkbenchRealtimeClient,
  type FileTreeRealtimeSnapshotDto,
  type GitRealtimeSnapshotDto,
  type TerminalManagerRealtimeSnapshotDto,
  type WorkspaceManagementRealtimeSnapshotDto
} from "../../../network/workbench-realtime-client";
import {
  beginMacOsTitlebarDragGesture,
  canHandleMacOsTitlebarPointerGesture,
  resolveMacOsNativeTitlebarDragRegion,
  shouldUseMacOsNativeTitlebarDragRegion,
} from "../../../platform/desktop/window-drag";
import type { NativeSidebarLayout } from "../../../platform/platform-adapter";
import {
  createDesktopWindowDetachPreview,
  type DesktopWindowDetachPreviewController
} from "../../../platform/desktop/window-detach-animation";
import {
  openCodeExternalWindow,
  openFilesExternalWindow,
  openGitExternalWindow,
  openProcessesExternalWindow
} from "../../../platform/desktop/window-openers";
import {
  showDesktopContextMenu,
  type DesktopContextMenuItem
} from "../../../platform/desktop/desktop-context-menu";
import { usePlatform } from "../../../platform/platform-provider";
import { useClientConfigSelector } from "../../../config/client-config-store";
import { getActiveHost, type HostProfile } from "../../../config/client-config-types";
import { normalizeHostAliasLabel, resolveHostAliasTag } from "../../workbench/utils/host-alias";
import {
  listWorkspaceHostBindings,
  saveWorkspaceHostBinding
} from "../../workbench/api/peer-hosts-api";
import {
  useLocalUiPreferenceSelector,
  type SessionDisplaySortMode
} from "../../../preferences/local-ui-preference-store";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type { TerminalDto } from "../../terminal/api/terminal-api";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme/theme";
import { useToast } from "../../../shared/toast";
import { authStore } from "../../auth/store/auth-store";
import {
  deleteAffairsLightweightSession,
  deleteSession,
  cleanupWorktree,
  createWorktree,
  getAffairsAssistantSessionsSnapshot,
  getAffairsLibrarySnapshot,
  getAffairsLightweightSessionMessages,
  getProviderCapabilities,
  getScopedWorkbenchSnapshot,
  getWorktreeMergePreview,
  getSessionPermissionRequests,
  getWorkbenchSnapshot,
  importWorkspace,
  listWorkspaces,
  listScopedWorkspaces,
  listAffairsLibraryDocuments,
  listAffairsLightweightSessions,
  markAffairsLightweightSessionSeen,
  mergeWorktreeIntoParent,
  reorderWorkspaces,
  removeWorkspace,
  renameAffairsLightweightSessionTitle,
  renameSessionTitle,
  updateAffairsLightweightSessionArchiveState,
  updateAffairsLightweightSessionFavoriteState,
  updateSessionArchiveState,
  updateSessionFavoriteState,
  updateWorkspaceNavigationState,
  type AffairsLibraryDocumentRecordDto,
  type AffairsLibraryTagNodeDto,
  type ProviderId,
  type SessionSummaryDto,
  type WorkbenchSnapshotDto,
  type WorkbenchWorktreeNodeDto,
  type WorktreeMergePreviewDto,
  type WorkspaceManagementSummaryDto,
  type WorktreeMetaDto,
  type WorkspaceRef,
  type WorkspaceDto
} from "../api/conversation-api";
import {
  getGitBranches,
  getGitTags,
  type GitBranchSnapshotDto,
  type GitTagItemDto
} from "../api/git-api";
import { createDraftCapabilities, getProviderDisplayName } from "../capability/provider-ui";
import { searchFiles, type FileNodeDto } from "../api/file-context-api";
import { ConversationTranscriptExport } from "./MessageTimeline";
import {
  buildConversationTimelineSourceItems,
  type ConversationTimelineSourceItem
} from "../timeline-source-items";
import {
  hasSessionDisplayError,
  resolveSessionActivityBadgeClassName,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassVariant,
  resolveSessionIndicatorClassName
} from "../session-activity-display";
import {
  type ParallelGroupTransitionSignal,
  readParallelGroupTransitionSignal,
  writeParallelGroupTransitionSignal,
  createParallelGroupStyle,
  resolveParallelGroupLabel,
  resolveSessionNavigationWorkspaceId,
  resolveSessionToolWorkspaceId,
  shouldUseParallelConversationLayout,
  resolveSessionDisplayParentSessionId
} from "../parallel-session-display";
import {
  isArchivedSessionVisibleInArchive,
  isRealSubagentSession,
  resolveArchivedChildSessionBadgeLabel,
  resolveSessionForkBadgeLabel,
  resolveSessionForkBadgeTone,
  resolveSubagentDisplayLabel
} from "../session-fork-display";
import {
  buildSessionExportFileName,
  buildSessionMarkdownExport,
  buildSessionPdfExport,
  buildStandaloneSessionExportHtml,
  downloadBinaryFile,
  downloadTextFile,
  loadSessionExportSnapshot
} from "../session-export";
import { buildSessionTitlePresentation } from "../session-title";
import { toViewMessage, type SessionMessageViewModel } from "../runtime/session-runtime-machine";
import {
  buildDraftSessionPath,
  buildWorkspaceChatIndexPath,
  buildWorkspaceChatPath,
  buildWorkspaceNewChatPath,
  buildDocumentsPath,
  buildWorkspaceHomePath,
  buildWorkspaceDetailPath,
  buildWorkspaceSessionIndexPath,
  buildWorkbenchPath,
  buildWorkspaceSessionPath,
  buildWorkspaceButlerPath,
  buildWorkspaceTerminalsPath,
  buildWorkspacePluginsPath,
  buildWorkspaceToolFilesPath,
  buildWorkspaceToolGitPath,
  buildWorkspaceToolProcessesPath,
  buildWorkspaceToolsPath,
  flattenNavigationSessions,
  type WorkbenchNavigationEntry
} from "../../workbench/utils/workbench-navigation";
import {
  buildSessionTree as buildRecursiveSessionTree,
  findSessionTreeAncestorIds,
  flattenSessionTreeNodes,
  flattenSessionTree,
  getSessionTreeChildren,
  someSessionTreeNode,
  type SessionTreeNode
} from "../../workbench/utils/session-tree";
import {
  compareSessionSummaryByDisplayMode,
  sortSessionSummaryList,
  sortWorkbenchWorktreeNodes
} from "../../workbench/utils/session-display-sort";
import {
  buildWorkspaceCompositionChartItems,
  createWorkspaceCompositionChartStyle,
  formatWorkspaceCompositionRatio
} from "../../workbench/utils/workspace-composition-chart";
import {
  buildScopedSnapshotKey,
  isSameTargetHostId,
  normalizeTargetHostId,
  readSnapshotTargetHostId
} from "../../workbench/utils/resource-scope";
import {
  resolveContextMenuPosition,
  type ContextMenuAnchorPoint
} from "../../workbench/utils/context-menu-position";
import {
  mapWorkbenchSnapshotToNavigationGroups,
  readWorkbenchNavigationSnapshot,
  WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS,
  writeWorkbenchNavigationSnapshot
} from "../../workbench/utils/workbench-navigation-snapshot";
import {
  buildWorkspaceVisualContextMap,
  createWorkspaceToneStyle,
  createFallbackWorkspaceVisualContext,
  type WorkspaceVisualContext
} from "../../workbench/utils/worktree-visual-context";
import {
  getButlerOverview,
  getButlerProfile,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerNotificationArchives,
  updateButlerNotificationArchive,
  type ButlerInboxItemDto,
  type ButlerFollowUpTaskDto,
  type ButlerOverviewDto
} from "../../butler/api/butler-api";
import {
  clearSessionProviderPickerCapabilityCache,
  SessionProviderPicker
} from "./SessionProviderPicker";
import { WorkbenchHostSwitcher } from "../../workbench/components/WorkbenchHostSwitcher";
import { SkillManagementPanel } from "../../../settings/SkillManagementPanel";
import {
  AffairsAuxiliaryPanel,
  AffairsLibraryIcon,
  AffairsLightweightConversationCreateModalLauncher,
  AffairsShortcutAppsRail,
  AffairsSidebarPanel,
  AffairsWorkbenchIcon,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView,
  type AffairsConversationDraftSelection
} from "../../workbench/components/AffairsWorkbenchView";
import { useAffairsLibraryCapability } from "../../workbench/affairs-library-capability-store";
import { CodeWorkbenchView } from "../../workbench/components/CodeWorkbenchView";
import {
  createDefaultCodeTerminalDockState,
  readCodeTerminalDockState,
  writeCodeTerminalDockState,
  type CodeTerminalDockOrientation,
  type CodeTerminalDockState
} from "../../workbench/utils/code-terminal-dock-state";
import {
  createDefaultAffairsViewState,
  createDefaultAffairsLibraryLandingState,
  readAffairsViewState,
  writeAffairsViewState
} from "../../workbench/utils/workbench-mode";
import type { AffairsViewState } from "../../workbench/types/workbench-mode";
import { WorkbenchModal as SidebarModal } from "./WorkbenchModal";
import { WorkspaceCloneModal } from "./WorkspaceCloneModal";
import { WorkspaceInboxPanel } from "./WorkspaceInboxModal";
import { WorkspaceImportBrowserModal } from "./WorkspaceImportBrowserModal";
import { WorkbenchUpdateBadge } from "./WorkbenchUpdateBadge";
import { ParallelSessionCreateModal, type ParallelSessionCreateSource } from "./ParallelSessionCreateModal";
import { useArchiveSessionSearch } from "./useArchiveSessionSearch";
import { useTransientScrollbarVisibility } from "./useTransientScrollbarVisibility";
import {
  buildWorkspaceHostAssignmentKey,
  readWorkspaceHostAssignments,
  type WorkspaceHostAssignment,
  WORKSPACE_HOST_ASSIGNMENT_CHANGED_EVENT,
  writeWorkspaceHostAssignments,
  writeWorkspaceHostAssignmentsSilently
} from "./workspace-host-assignment-storage";

const LEFT_PANEL_WIDTH_KEY = "workbench.left.width";
const RIGHT_PANEL_WIDTH_KEY = "workbench.right.width";
const LEFT_PANEL_COLLAPSED_KEY = "workbench.left.collapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "workbench.right.collapsed";
const LAST_SESSION_PATH_KEY = "workbench.last.session.path";
const SELECTED_WORKSPACE_ID_KEY = "workbench.workspace.selected.id";
const WORKBENCH_NOTIFICATION_SEEN_AT_KEY = "workbench.notifications.seen_at";

type CodeShortcutRailSide = "left" | "right";

interface CodeShortcutRailHostState {
  workspaceId: string;
  collapsed: boolean;
  side: CodeShortcutRailSide;
}

function createDefaultCodeShortcutRailHostState(workspaceId: string): CodeShortcutRailHostState {
  return {
    workspaceId,
    collapsed: false,
    side: "left"
  };
}

function resolveCodeShortcutRailHostState(
  workspaceId: string,
  workspace: WorkspaceDto | null | undefined
): CodeShortcutRailHostState {
  return {
    workspaceId,
    collapsed: workspace?.shortcutAppsCollapsed === true,
    side: workspace?.shortcutAppsSide === "right" ? "right" : "left"
  };
}
const DEFAULT_LEFT_PANEL_WIDTH = 280;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const MIN_LEFT_PANEL_WIDTH = 240;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MAX_LEFT_PANEL_WIDTH = 520;
const MAX_RIGHT_PANEL_WIDTH = 560;
const INFO_PANEL_BOOT_DELAY_MS = 200;
const FAVORITE_SESSION_PAGE_SIZE = 20;
const ROOT_SESSION_PAGE_SIZE = 40;
const SUBAGENT_PAGE_SIZE = 5;
const WORKBENCH_NOTIFICATION_POLL_INTERVAL_MS = 30_000;
const WORKBENCH_NOTIFICATION_MAX_ITEMS = 12;
const WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const WORKBENCH_PERMISSION_POLL_INTERVAL_MS = 4_000;
const SESSION_FAILURE_NOTIFICATION_DETAIL_MAX_LENGTH = 220;
const WINDOW_DETACH_DRAG_THRESHOLD_PX = 18;
const WORKSPACE_POINTER_REORDER_THRESHOLD_PX = 6;
const WORKBENCH_PANEL_RESIZING_ATTRIBUTE = "data-workbench-panel-resizing";
const WORKBENCH_WINDOW_RESIZING_ATTRIBUTE = "data-workbench-window-resizing";
const WORKBENCH_WINDOW_RESIZE_SETTLE_MS = 180;
const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";
const WORKBENCH_RUNTIME_ACTIVE_STATES: ReadonlySet<string> = new Set([
  "starting",
  "running",
  "reconnecting",
  "stale",
  "unknown"
]);
const WORKSPACE_COLOR_PRESETS = [
  "#34C759",
  "#22C55E",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#F43F5E",
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#10B981"
] as const;
const WORKBENCH_TITLEBAR_LIVE_SHIFT_VARIABLES = [
  "--workbench-titlebar-live-content-shift-y",
  "--workbench-nav-toolbar-live-shift-y",
  "--workbench-info-tabs-live-shift-y",
  "--workbench-auxiliary-toolbar-button-live-shift-y",
  "--workbench-conversation-header-main-live-shift-y",
  "--workbench-conversation-header-actions-live-shift-y",
  "--workbench-terminal-tabbar-live-shift-y",
  "--workbench-collapsed-controls-live-shift-y",
  "--workbench-collapsed-left-controls-live-shift-y",
  "--workbench-collapsed-right-controls-live-shift-y"
] as const;
const WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS = {
  navToolbar: {
    selector: ".workbench-nav-toolbar",
    variableName: "--workbench-nav-toolbar-live-shift-y"
  },
  infoTabs: {
    selector: ".workbench-info-tabs",
    variableName: "--workbench-info-tabs-live-shift-y"
  },
  auxiliaryToolbarButton: {
    selector: ".workbench-auxiliary-header > .workbench-nav-toolbar-button",
    variableName: "--workbench-auxiliary-toolbar-button-live-shift-y"
  },
  conversationHeaderMain: {
    selector: ".conversation-header-main",
    variableName: "--workbench-conversation-header-main-live-shift-y"
  },
  conversationHeaderActions: {
    selector: ".conversation-header-actions",
    variableName: "--workbench-conversation-header-actions-live-shift-y"
  },
  terminalTabbarMain: {
    selector: ".terminal-tabbar-main",
    variableName: "--workbench-terminal-tabbar-live-shift-y"
  },
  collapsedLeftControls: {
    selector: ".workbench-collapsed-controls.left[data-visible=\"true\"] .workbench-nav-toolbar-button",
    variableName: "--workbench-collapsed-left-controls-live-shift-y"
  },
  collapsedRightControls: {
    selector: ".workbench-collapsed-controls.right[data-visible=\"true\"] .workbench-nav-toolbar-button",
    variableName: "--workbench-collapsed-right-controls-live-shift-y"
  }
} as const;

function readCssNumericCustomProperty(style: CSSStyleDeclaration, propertyName: string): number | null {
  const rawValue = style.getPropertyValue(propertyName).trim();

  if (!rawValue) {
    return null;
  }

  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function roundWorkbenchLayoutValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function measureWorkbenchElementCenterY(containerRect: DOMRect, element: HTMLElement): number | null {
  const elementRect = element.getBoundingClientRect();

  if (elementRect.width <= 0 || elementRect.height <= 0) {
    return null;
  }

  const computedStyle = window.getComputedStyle(element);

  if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
    return null;
  }

  return elementRect.top - containerRect.top + elementRect.height / 2;
}

function measureWorkbenchSelectorCenterY(container: HTMLElement, selector: string): number | null {
  const containerRect = container.getBoundingClientRect();
  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));
  const centers = elements
    .map((element) => measureWorkbenchElementCenterY(containerRect, element))
    .filter((value): value is number => value !== null);

  if (centers.length === 0) {
    return null;
  }

  return centers.reduce((total, value) => total + value, 0) / centers.length;
}

function setWorkbenchLiveShiftVariable(target: HTMLElement, variableName: string, value: number | null) {
  const currentValue = target.style.getPropertyValue(variableName).trim();

  if (value === null || !Number.isFinite(value)) {
    if (currentValue) {
      target.style.removeProperty(variableName);
    }
    return;
  }

  const nextValue = `${roundWorkbenchLayoutValue(value)}px`;

  if (currentValue !== nextValue) {
    target.style.setProperty(variableName, nextValue);
  }
}

function resolveWorkbenchAbsoluteShift(
  style: CSSStyleDeclaration,
  variableName: string,
  targetCenterY: number,
  measuredCenterY: number | null
): number | null {
  if (measuredCenterY === null) {
    return null;
  }

  const currentShift = readCssNumericCustomProperty(style, variableName) ?? 0;
  return currentShift + (targetCenterY - measuredCenterY);
}

function resetWorkbenchTitlebarLiveShiftVariables(target: HTMLElement | null) {
  if (!target) {
    return;
  }

  for (const variableName of WORKBENCH_TITLEBAR_LIVE_SHIFT_VARIABLES) {
    target.style.removeProperty(variableName);
  }
}

export type WorkbenchGlobalNotificationKind =
  | "follow_up_waiting_user"
  | "todo_analyzed"
  | "todo_analyze_failed"
  | "follow_up_completed"
  | "follow_up_failed"
  | "verification_failed";

export interface WorkbenchGlobalNotification {
  id: string;
  kind: WorkbenchGlobalNotificationKind;
  title: string;
  body: string;
  routePath: string | null;
  workspaceId: string | null;
  createdAt: string;
}

function isPermissionWatchSession(session: SessionSummaryDto): boolean {
  return (
    WORKBENCH_RUNTIME_ACTIVE_STATES.has(session.runningState ?? "idle") ||
    session.activityState === "running"
  );
}

function buildPermissionRefreshSignature(
  pendingRequestIdsBySession: Map<string, Set<string>>,
  watchedSessionIdSet: Set<string>
): string {
  const parts: string[] = [];

  for (const sessionId of [...watchedSessionIdSet].sort()) {
    const requestIds = pendingRequestIdsBySession.get(sessionId);

    if (!requestIds || requestIds.size === 0) {
      continue;
    }

    parts.push(`${sessionId}:${[...requestIds].sort().join(",")}`);
  }

  return parts.join("|");
}

function normalizeSessionFailureDetail(session: SessionSummaryDto): string | null {
  const lastErrorCode = session.lastErrorCode?.trim() ?? "";
  const lastErrorDetail = session.lastErrorDetail?.trim() ?? "";
  const composed = [lastErrorCode, lastErrorDetail].filter((value) => value.length > 0).join(" · ");

  if (!composed) {
    return null;
  }

  if (composed.length <= SESSION_FAILURE_NOTIFICATION_DETAIL_MAX_LENGTH) {
    return composed;
  }

  return `${composed.slice(0, SESSION_FAILURE_NOTIFICATION_DETAIL_MAX_LENGTH - 3)}...`;
}

function buildWorkbenchGlobalNotifications(
  overview: ButlerOverviewDto,
  followUpTasks: ButlerFollowUpTaskDto[],
  inboxItems: ButlerInboxItemDto[]
): WorkbenchGlobalNotification[] {
  const projectWorkspaceIdByProjectId = new Map(
    overview.projects.map((project) => [project.id, project.workspaceId] as const)
  );
  const notifications: WorkbenchGlobalNotification[] = [];

  for (const item of inboxItems) {
    const title = item.title.trim() || item.projectName;

    if (
      item.assistantState.lifecycleStage === "analyzed"
      && !item.assistantState.linkedSessionId?.trim()
      && item.assistantState.lastAnalyzedAt
    ) {
      notifications.push({
        id: `todo-analysis-completed:${item.id}:${item.assistantState.lastAnalyzedAt}`,
        kind: "todo_analyzed",
        title: t("shell.globalNotificationTodoAnalyzedTitle", {
          title
        }),
        body:
          item.assistantState.analysisSummary?.trim()
          || item.assistantState.generatedPrompt?.trim()
          || item.content,
        routePath: buildWorkspaceButlerPath(item.workspaceId),
        workspaceId: item.workspaceId,
        createdAt: item.assistantState.lastAnalyzedAt
      });
      continue;
    }

    if (item.assistantState.lifecycleStage === "failed") {
      notifications.push({
        id: `todo-analysis-failed:${item.id}:${item.updatedAt}`,
        kind: "todo_analyze_failed",
        title: t("shell.globalNotificationTodoAnalyzeFailedTitle", {
          title
        }),
        body: item.assistantState.lastError?.trim() || item.content,
        routePath: buildWorkspaceButlerPath(item.workspaceId),
        workspaceId: item.workspaceId,
        createdAt: item.updatedAt
      });
    }
  }

  for (const task of followUpTasks) {
    const title = task.sessionTitle?.trim() || task.projectName;
    const timestamp = task.updatedAt || task.lastAutomationAt || task.createdAt;

    if (task.status === "waiting_user") {
      notifications.push({
        id: `follow-up-waiting:${task.id}`,
        kind: "follow_up_waiting_user",
        title: t("shell.globalNotificationFollowUpWaitingTitle", {
          title
        }),
        body: task.waitingReason?.trim() || task.lastAutomationSummary?.trim() || task.objective,
        routePath: buildWorkspaceSessionPath(task.workspaceId, task.sessionId),
        workspaceId: task.workspaceId,
        createdAt: timestamp
      });
      continue;
    }

    if (task.status === "completed") {
      notifications.push({
        id: `follow-up-completed:${task.id}`,
        kind: "follow_up_completed",
        title: t("shell.globalNotificationFollowUpCompletedTitle", {
          title
        }),
        body: task.lastAutomationSummary?.trim() || task.objective,
        routePath: buildWorkspaceSessionPath(task.workspaceId, task.sessionId),
        workspaceId: task.workspaceId,
        createdAt: timestamp
      });
      continue;
    }

    if (task.status === "failed") {
      notifications.push({
        id: `follow-up-failed:${task.id}`,
        kind: "follow_up_failed",
        title: t("shell.globalNotificationFollowUpFailedTitle", {
          title
        }),
        body: task.lastAutomationSummary?.trim() || task.waitingReason?.trim() || task.objective,
        routePath: buildWorkspaceSessionPath(task.workspaceId, task.sessionId),
        workspaceId: task.workspaceId,
        createdAt: timestamp
      });
    }
  }

  for (const verification of overview.verifications) {
    if (verification.status !== "failed") {
      continue;
    }

    const workspaceId = verification.projectId
      ? projectWorkspaceIdByProjectId.get(verification.projectId) ?? null
      : null;
    const title = verification.targetRef?.trim() || verification.verificationType;

    notifications.push({
      id: `verification-failed:${verification.id}`,
      kind: "verification_failed",
      title: t("shell.globalNotificationVerificationFailedTitle", {
        title
      }),
      body: verification.summary?.trim() || t("shell.globalNotificationVerificationFailedFallback"),
      routePath: workspaceId ? buildWorkspaceButlerPath(workspaceId) : null,
      workspaceId,
      createdAt: verification.finishedAt || verification.startedAt || verification.createdAt
    });
  }

  return notifications
    .sort((left, right) => {
      const priorityDelta = resolveWorkbenchNotificationPriority(left.kind) - resolveWorkbenchNotificationPriority(right.kind);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return parseWorkbenchNotificationTime(right.createdAt) - parseWorkbenchNotificationTime(left.createdAt);
    })
    .slice(0, WORKBENCH_NOTIFICATION_MAX_ITEMS);
}

function resolveWorkbenchNotificationPriority(kind: WorkbenchGlobalNotificationKind): number {
  switch (kind) {
    case "follow_up_waiting_user":
      return 0;
    case "todo_analyze_failed":
      return 1;
    case "follow_up_failed":
      return 2;
    case "verification_failed":
      return 3;
    case "todo_analyzed":
      return 4;
    case "follow_up_completed":
      return 5;
    default:
      return 9;
  }
}

function resolveWorkbenchNotificationKindLabel(kind: WorkbenchGlobalNotificationKind): string {
  switch (kind) {
    case "follow_up_waiting_user":
      return t("shell.globalNotificationKindWaitingUser");
    case "todo_analyzed":
      return t("shell.globalNotificationKindTodoAnalyzed");
    case "todo_analyze_failed":
      return t("shell.globalNotificationKindTodoAnalyzeFailed");
    case "follow_up_completed":
      return t("shell.globalNotificationKindFollowUpCompleted");
    case "follow_up_failed":
      return t("shell.globalNotificationKindFollowUpFailed");
    case "verification_failed":
      return t("shell.globalNotificationKindVerificationFailed");
    default:
      return t("shell.globalNotificationsPanelTitle");
  }
}

function parseWorkbenchNotificationTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isRecommendedWorktreeBranchName(value: string) {
  return /^(?:[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+)*$/.test(value);
}

function isRecommendedWorktreeBranchNameInput(value: string) {
  return /^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/.test(value);
}

function buildWorktreeBaseRefSuggestions(
  branches: GitBranchSnapshotDto | null,
  tags: GitTagItemDto[]
): WorktreeBaseRefSuggestions {
  const seen = new Set<string>();
  const currentBranchName = branches?.currentBranch ?? "";
  const localBranches = (branches?.local ?? [])
    .slice()
    .sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name))
    .map((item) => ({
      value: item.name,
      current: item.current,
      recommended: item.name === currentBranchName
    }))
    .filter((item) => {
      if (!item.value || seen.has(item.value)) {
        return false;
      }

      seen.add(item.value);
      return true;
    });
  const remoteBranches = (branches?.remote ?? [])
    .map((item) => ({
      value: item.name
    }))
    .filter((item) => {
      if (!item.value || seen.has(item.value)) {
        return false;
      }

      seen.add(item.value);
      return true;
    });
  const tagNames = tags
    .map((item) => ({
      value: item.name
    }))
    .filter((item) => {
      if (!item.value || seen.has(item.value)) {
        return false;
      }

      seen.add(item.value);
      return true;
    });

  return {
    localBranches,
    remoteBranches,
    tags: tagNames
  };
}

function measureFloatingPanelRect(anchor: HTMLElement): DOMRect {
  return anchor.getBoundingClientRect();
}

function isWorkbenchNotificationUnread(
  notification: WorkbenchGlobalNotification,
  seenAt: string | null
): boolean {
  if (!seenAt) {
    return true;
  }

  return parseWorkbenchNotificationTime(notification.createdAt) > parseWorkbenchNotificationTime(seenAt);
}

function formatWorkbenchNotificationTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}


function resolveRouteWorkspaceId(pathname: string, search: string): string | null {
  const workspaceRoutePatterns = [
    "/workspaces/:workspaceId",
    "/workspaces/:workspaceId/sessions",
    "/workspaces/:workspaceId/sessions/:sessionId",
    "/workspaces/:workspaceId/chats",
    "/workspaces/:workspaceId/chats/new",
    "/workspaces/:workspaceId/chats/:chatId",
    "/workspaces/:workspaceId/tools",
    "/workspaces/:workspaceId/tools/files",
    "/workspaces/:workspaceId/tools/git",
    "/workspaces/:workspaceId/tools/processes",
    "/workspaces/:workspaceId/terminals",
    "/workspaces/:workspaceId/plugins",
    "/workspaces/:workspaceId/plugins/:pluginId",
    "/workspaces/:workspaceId/plugins/:pluginId/run",
    "/workspaces/:workspaceId/butler"
  ] as const;

  for (const pattern of workspaceRoutePatterns) {
    const match = matchPath(pattern, pathname);
    const workspaceId = match?.params.workspaceId?.trim();

    if (workspaceId) {
      return workspaceId;
    }
  }

  const sessionMatch = resolveRouteSessionMatch(pathname);
  const sessionId = sessionMatch?.sessionId ?? null;

  if (!sessionId || !isDraftSessionId(sessionId)) {
    return null;
  }

  const draftWorkspaceId = new URLSearchParams(search).get("workspaceId")?.trim();
  return draftWorkspaceId || null;
}

function readWorkspaceRefFromLocation(location: Pick<Location, "pathname" | "search">): WorkspaceRef | null {
  const workspaceId = resolveRouteWorkspaceId(location.pathname, location.search);

  if (!workspaceId) {
    return null;
  }

  const targetHostId = new URLSearchParams(location.search).get("targetHostId")?.trim();

  return {
    hostId: targetHostId || "current",
    workspaceId
  };
}

function hasExplicitTargetHostScopeInLocation(location: Pick<Location, "search">): boolean {
  return normalizeTargetHostId(new URLSearchParams(location.search).get("targetHostId")) !== null;
}

function shouldRedirectMobileToWorkspaceHome(pathname: string) {
  return (
    pathname.startsWith("/sessions")
    || pathname.startsWith("/terminals")
    || pathname.startsWith("/tools")
  );
}

function resolveWorkbenchHomePath(shellMode: WorkbenchShellMode) {
  return shellMode === "mobile" ? buildWorkspaceHomePath() : "/landing";
}

function resolveRouteSessionMatch(pathname: string): {
  sessionId: string;
  workspaceId: string | null;
} | null {
  const scopedSessionMatch = matchPath("/workspaces/:workspaceId/sessions/:sessionId", pathname);
  const scopedSessionId = scopedSessionMatch?.params.sessionId?.trim();

  if (scopedSessionId) {
    return {
      sessionId: scopedSessionId,
      workspaceId: scopedSessionMatch?.params.workspaceId?.trim() ?? null
    };
  }

  const legacySessionMatch = matchPath("/sessions/:sessionId", pathname);
  const legacySessionId = legacySessionMatch?.params.sessionId?.trim();

  if (legacySessionId) {
    return {
      sessionId: legacySessionId,
      workspaceId: null
    };
  }

  return null;
}

function isSessionsRoute(pathname: string) {
  return Boolean(
    matchPath("/sessions", pathname) || matchPath("/workspaces/:workspaceId/sessions", pathname)
  );
}

function isSessionDetailRoute(pathname: string) {
  return Boolean(resolveRouteSessionMatch(pathname));
}

function resolveCodeEmbeddedAffairsSectionFromPath(pathname: string): "library" | "workbench" | null {
  if (matchPath("/documents", pathname)) {
    return "library";
  }

  if (matchPath("/workbench", pathname)) {
    return "workbench";
  }

  return null;
}

function isCodeEmbeddedAffairsRoute(pathname: string) {
  return resolveCodeEmbeddedAffairsSectionFromPath(pathname) !== null;
}

function buildCodeEmbeddedAffairsRoutePath(
  section: AffairsViewState["primarySection"]
): string | null {
  if (section === "library") {
    return buildDocumentsPath();
  }

  if (section === "workbench") {
    return buildWorkbenchPath();
  }

  return null;
}

function resolveRouteLightweightChatMatch(pathname: string): {
  chatId: string | null;
  workspaceId: string | null;
} | null {
  const newChatMatch = matchPath("/workspaces/:workspaceId/chats/new", pathname);
  const newChatWorkspaceId = newChatMatch?.params.workspaceId?.trim();

  if (newChatWorkspaceId) {
    return {
      chatId: null,
      workspaceId: newChatWorkspaceId
    };
  }

  const chatMatch = matchPath("/workspaces/:workspaceId/chats/:chatId", pathname);
  const chatWorkspaceId = chatMatch?.params.workspaceId?.trim();
  const chatId = chatMatch?.params.chatId?.trim();

  if (chatWorkspaceId && chatId) {
    return {
      chatId,
      workspaceId: chatWorkspaceId
    };
  }

  const indexMatch = matchPath("/workspaces/:workspaceId/chats", pathname);
  const indexWorkspaceId = indexMatch?.params.workspaceId?.trim();

  if (indexWorkspaceId) {
    return {
      chatId: null,
      workspaceId: indexWorkspaceId
    };
  }

  return null;
}

function isLightweightChatRoute(pathname: string) {
  return Boolean(resolveRouteLightweightChatMatch(pathname));
}

function appendLightweightChatProviderParam(path: string, provider: ProviderId): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}provider=${encodeURIComponent(provider)}`;
}

function isToolsRoute(pathname: string) {
  return Boolean(
    matchPath("/tools", pathname)
    || matchPath("/tools/files", pathname)
    || matchPath("/tools/git", pathname)
    || matchPath("/tools/processes", pathname)
    || matchPath("/workspaces/:workspaceId/tools", pathname)
    || matchPath("/workspaces/:workspaceId/tools/files", pathname)
    || matchPath("/workspaces/:workspaceId/tools/git", pathname)
    || matchPath("/workspaces/:workspaceId/tools/processes", pathname)
  );
}

function isTerminalsRoute(pathname: string) {
  return Boolean(
    matchPath("/terminals", pathname) || matchPath("/workspaces/:workspaceId/terminals", pathname)
  );
}

function isButlerRoute(pathname: string) {
  return Boolean(matchPath("/workspaces/:workspaceId/butler", pathname));
}

function isPluginsRoute(pathname: string) {
  return Boolean(
    matchPath("/workspaces/:workspaceId/plugins", pathname)
    || matchPath("/workspaces/:workspaceId/plugins/:pluginId", pathname)
    || matchPath("/workspaces/:workspaceId/plugins/:pluginId/run", pathname)
  );
}

function resolveFallbackWorkspaceRoute(
  pathname: string,
  workspaceId: string,
  workspaceRef?: WorkspaceRef | null
): string {
  if (matchPath("/workspaces/:workspaceId", pathname)) {
    return buildWorkspaceDetailPath(workspaceId, workspaceRef);
  }

  if (matchPath("/workspaces/:workspaceId/tools/files", pathname) || matchPath("/tools/files", pathname)) {
    return buildWorkspaceToolFilesPath(workspaceId, workspaceRef);
  }

  if (matchPath("/workspaces/:workspaceId/tools/git", pathname) || matchPath("/tools/git", pathname)) {
    return buildWorkspaceToolGitPath(workspaceId, workspaceRef);
  }

  if (matchPath("/workspaces/:workspaceId/tools/processes", pathname) || matchPath("/tools/processes", pathname)) {
    return buildWorkspaceToolProcessesPath(workspaceId, workspaceRef);
  }

  if (matchPath("/workspaces/:workspaceId/tools", pathname) || matchPath("/tools", pathname)) {
    return buildWorkspaceToolsPath(workspaceId, undefined, workspaceRef);
  }

  if (isTerminalsRoute(pathname)) {
    return buildWorkspaceTerminalsPath(workspaceId, workspaceRef);
  }

  if (isButlerRoute(pathname)) {
    return buildWorkspaceButlerPath(workspaceId, undefined, workspaceRef);
  }

  if (isPluginsRoute(pathname)) {
    return buildWorkspacePluginsPath(workspaceId, workspaceRef);
  }

  return buildWorkspaceSessionIndexPath(workspaceId, workspaceRef);
}

function normalizeWorkbenchFilePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

function normalizeSearchKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function splitSearchKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      const normalized = normalizeSearchKeyword(item);
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function normalizeSearchKeywordTerms(value: string | string[]): string[] {
  const rawItems = Array.isArray(value) ? value : splitSearchKeywords(value);
  const seen = new Set<string>();
  const result: string[] = [];

  rawItems.forEach((item) => {
    const normalized = normalizeSearchKeyword(item);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

const GLOBAL_SEARCH_SOURCE_TIMEOUT_MS = 6000;
const CODE_SEARCH_PAGE_SIZE = 100;
const AFFAIRS_SEARCH_DOCUMENT_PAGE_SIZE = 200;

function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs = GLOBAL_SEARCH_SOURCE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("search_timeout"));
    }, timeoutMs);

    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAffairsLibraryRootDir(rootDir: string | null | undefined): string {
  return rootDir?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
}

function buildAffairsLibraryLabel(rootDir: string | null | undefined): string {
  const normalizedRootDir = normalizeAffairsLibraryRootDir(rootDir);
  if (!normalizedRootDir) {
    return "";
  }

  const segments = normalizedRootDir.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? normalizedRootDir;
}

function sanitizeSearchSnippetText(rawText: string | null | undefined): string {
  return (rawText ?? "")
    .replace(/\u0000/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function isLikelyNoisySnippetLine(line: string): boolean {
  const compact = line.replace(/\s+/g, "");
  if (!compact) {
    return true;
  }

  const noiseChars = compact.match(/[^A-Za-z0-9\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF.,!?;:'"“”‘’()[\]{}<>《》【】\-_/+&%#@：；，。！？、]/g)?.length ?? 0;
  return noiseChars / compact.length >= 0.35;
}

function buildMatchedSnippet(
  rawText: string | null | undefined,
  keyword: string,
  options?: {
    lineCount?: number;
    maxLineLength?: number;
    maxCompactLength?: number;
  }
): string | null {
  const text = sanitizeSearchSnippetText(rawText);
  if (!text) {
    return null;
  }

  const normalizedKeywords = normalizeSearchKeywordTerms(keyword);
  const lineCount = Math.max(1, options?.lineCount ?? 2);
  const maxLineLength = Math.max(40, options?.maxLineLength ?? 96);
  const maxCompactLength = Math.max(80, options?.maxCompactLength ?? 180);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (normalizedKeywords.length === 0) {
        return !isLikelyNoisySnippetLine(line);
      }
      const normalizedLine = line.toLowerCase();
      return normalizedKeywords.some((keywordItem) => normalizedLine.includes(keywordItem)) || !isLikelyNoisySnippetLine(line);
    });

  if (lines.length === 0) {
    return null;
  }

  const truncateAroundMatch = (source: string, maxLength: number) => {
    if (source.length <= maxLength) {
      return source;
    }

    if (normalizedKeywords.length === 0) {
      return `${source.slice(0, maxLength - 1)}…`;
    }

    const lowerSource = source.toLowerCase();
    const matchIndex = normalizedKeywords.reduce((current, keywordItem) => {
      const index = lowerSource.indexOf(keywordItem);
      if (index < 0) {
        return current;
      }
      return current < 0 ? index : Math.min(current, index);
    }, -1);
    if (matchIndex < 0) {
      return `${source.slice(0, maxLength - 1)}…`;
    }

    const preferredStart = Math.max(0, matchIndex - Math.floor(maxLength * 0.35));
    const start = Math.max(0, Math.min(preferredStart, source.length - maxLength));
    const end = Math.min(source.length, start + maxLength);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < source.length ? "…" : "";
    return `${prefix}${source.slice(start, end)}${suffix}`;
  };

  const matchedLineIndex = normalizedKeywords.length > 0
    ? lines.findIndex((line) => {
      const normalizedLine = line.toLowerCase();
      return normalizedKeywords.some((keywordItem) => normalizedLine.includes(keywordItem));
    })
    : -1;
  if (matchedLineIndex >= 0) {
    return lines
      .slice(matchedLineIndex, matchedLineIndex + lineCount)
      .map((line) => truncateAroundMatch(line, maxLineLength))
      .join("\n");
  }

  const compactText = text.replace(/\s+/g, " ").trim();
  if (!compactText) {
    return null;
  }

  return truncateAroundMatch(compactText, maxCompactLength);
}

function getAffairsDocumentDisplayName(record: AffairsLibraryDocumentRecordDto): string {
  const compactPath = normalizeWorkbenchFilePath(record.path);
  const segments = compactPath.split("/").filter((segment) => segment.length > 0);
  const fileName = segments.at(-1);

  return fileName || record.title || compactPath;
}

function buildAffairsDocumentSnippet(record: AffairsLibraryDocumentRecordDto, keyword: string): string | null {
  const snippet = buildMatchedSnippet(record.summary, keyword, {
    lineCount: 2,
    maxLineLength: 110,
    maxCompactLength: 220
  });

  if (snippet) {
    return snippet;
  }

  const compactPath = normalizeWorkbenchFilePath(record.path);
  if (!compactPath) {
    return null;
  }

  return buildMatchedSnippet(compactPath, keyword, {
    lineCount: 2,
    maxLineLength: 110,
    maxCompactLength: 220
  });
}

function renderHighlightedText(
  text: string | null | undefined,
  keyword: string,
  keyPrefix: string
): ReactNode {
  const source = text ?? "";
  const normalizedKeywords = normalizeSearchKeywordTerms(keyword);
  if (!source || normalizedKeywords.length === 0) {
    return source;
  }

  const matcher = new RegExp(
    `(${normalizedKeywords.slice().sort((left, right) => right.length - left.length).map(escapeRegExp).join("|")})`,
    "ig"
  );
  const segments = source.split(matcher).filter((segment) => segment.length > 0);

  if (segments.length <= 1) {
    return source;
  }

  const highlightedKeywords = new Set(normalizedKeywords);
  return segments.map((segment, index) => (
    highlightedKeywords.has(segment.toLowerCase()) ? (
      <mark key={`${keyPrefix}:highlight:${index}`} className="workbench-search-highlight">{segment}</mark>
    ) : (
      <span key={`${keyPrefix}:text:${index}`}>{segment}</span>
    )
  ));
}

function compareCodeSearchResults(left: CodeSearchResult, right: CodeSearchResult) {
  const leftScore = left.file.matchScore ?? 0;
  const rightScore = right.file.matchScore ?? 0;
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  const rightTime = right.file.updatedAt ? Date.parse(right.file.updatedAt) : Number.NaN;
  const leftTime = left.file.updatedAt ? Date.parse(left.file.updatedAt) : Number.NaN;
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  const workspaceOrder = left.workspaceName.localeCompare(right.workspaceName, "zh-Hans-CN");
  if (workspaceOrder !== 0) {
    return workspaceOrder;
  }

  return left.file.path.localeCompare(right.file.path, "zh-Hans-CN");
}

async function listAllAffairsSearchDocuments(workspaceId: string, keyword: string) {
  const items: AffairsLibraryDocumentRecordDto[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const response = await withPromiseTimeout(listAffairsLibraryDocuments(workspaceId, {
      browseMode: "tag",
      keyword,
      offset,
      limit: AFFAIRS_SEARCH_DOCUMENT_PAGE_SIZE
    }));
    const pageItems = Array.isArray(response.items) ? response.items : [];
    total = typeof response.total === "number" && Number.isFinite(response.total)
      ? Math.max(0, response.total)
      : pageItems.length;
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }

    offset += pageItems.length;
  }

  return items;
}

function mergeCodeSearchFile(left: FileNodeDto, right: FileNodeDto): FileNodeDto {
  const snippets = [left.snippet, right.snippet]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  const mergedSnippet = Array.from(new Set(snippets)).join("\n");
  const leftScore = left.matchScore ?? 0;
  const rightScore = right.matchScore ?? 0;

  return {
    ...left,
    updatedAt: left.updatedAt ?? right.updatedAt,
    matchSource: left.matchSource === right.matchSource ? left.matchSource : "path_and_content",
    snippet: mergedSnippet || left.snippet || right.snippet || null,
    matchScore: leftScore || rightScore ? leftScore + rightScore : null
  };
}

async function listAllCodeSearchFilesForKeywords(workspaceId: string, keywords: string[]) {
  const results = await Promise.allSettled(keywords.map((keyword) => listAllCodeSearchFiles(workspaceId, keyword)));
  const fulfilled = results
    .filter((item): item is PromiseFulfilledResult<FileNodeDto[]> => item.status === "fulfilled")
    .map((item) => item.value);

  if (fulfilled.length === 0 && results.some((item) => item.status === "rejected")) {
    throw new Error("code_search_failed");
  }

  const filesByIdentity = new Map<string, FileNodeDto>();
  fulfilled.flat().forEach((file) => {
    const identity = `${file.kind}:${normalizeWorkbenchFilePath(file.path) || file.path}`;
    const existing = filesByIdentity.get(identity);
    filesByIdentity.set(identity, existing ? mergeCodeSearchFile(existing, file) : file);
  });

  return [...filesByIdentity.values()];
}

async function listAllAffairsSearchDocumentsForKeywords(workspaceId: string, keywords: string[]) {
  const results = await Promise.allSettled(keywords.map((keyword) => listAllAffairsSearchDocuments(workspaceId, keyword)));
  const fulfilled = results
    .filter((item): item is PromiseFulfilledResult<AffairsLibraryDocumentRecordDto[]> => item.status === "fulfilled")
    .map((item) => item.value);

  if (fulfilled.length === 0 && results.some((item) => item.status === "rejected")) {
    throw new Error("affairs_document_search_failed");
  }

  const documentsByIdentity = new Map<string, AffairsLibraryDocumentRecordDto>();
  fulfilled.flat().forEach((record) => {
    const identity = `${record.documentId || ""}:${normalizeWorkbenchFilePath(record.path) || record.path.trim()}`;
    if (!documentsByIdentity.has(identity)) {
      documentsByIdentity.set(identity, record);
    }
  });

  return [...documentsByIdentity.values()];
}

async function listAllCodeSearchFiles(workspaceId: string, keyword: string) {
  const items: FileNodeDto[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (items.length < total) {
    const response = await withPromiseTimeout(searchFiles(
      workspaceId,
      keyword,
      page,
      CODE_SEARCH_PAGE_SIZE
    ));
    const pageItems = Array.isArray(response.items) ? response.items : [];
    total = typeof response.total === "number" && Number.isFinite(response.total)
      ? Math.max(0, response.total)
      : pageItems.length;
    items.push(...pageItems);

    if (pageItems.length === 0 || items.length >= total) {
      break;
    }

    page += 1;
  }

  return items;
}

function resolveAffairsSearchLibraryInfo(
  workspace: WorkspaceDto,
  snapshotResult: PromiseSettledResult<Awaited<ReturnType<typeof getAffairsLibrarySnapshot>>>
) {
  if (snapshotResult.status !== "fulfilled") {
    return {
      workspaceId: workspace.id,
      libraryRootDir: "",
      libraryLabel: ""
    };
  }

  const binding = snapshotResult.value.binding;
  const libraryRootDir = normalizeAffairsLibraryRootDir(binding?.rootDir);
  return {
    workspaceId: binding?.workspaceId?.trim() || workspace.id,
    libraryRootDir,
    libraryLabel: buildAffairsLibraryLabel(libraryRootDir)
  };
}

function sortAffairsSearchResults(
  results: AffairsSearchResults,
  mode: AffairsSearchSortMode
): AffairsSearchResults {
  return {
    documents: [...results.documents].sort((left, right) => compareAffairsDocumentSearchResultsByMode(left, right, mode)),
    tags: [...results.tags].sort((left, right) => compareAffairsTagSearchResultsByMode(left, right, mode)),
    conversations: [...results.conversations].sort((left, right) => compareAffairsConversationSearchResultsByMode(left, right, mode)),
    todos: [...results.todos].sort((left, right) => compareAffairsTodoSearchResultsByMode(left, right, mode))
  };
}

function includesNormalizedSearch(
  normalizedKeyword: string | string[],
  ...values: Array<string | null | undefined>
): boolean {
  const normalizedKeywords = normalizeSearchKeywordTerms(normalizedKeyword);
  if (normalizedKeywords.length === 0) {
    return false;
  }

  const searchText = values.map((value) => value ?? "").join("\n").toLowerCase();
  return normalizedKeywords.every((keywordItem) => searchText.includes(keywordItem));
}

function countNormalizedSearchMatches(normalizedKeyword: string, value: string | null | undefined): number {
  if (!normalizedKeyword) {
    return 0;
  }

  const source = value?.toLowerCase() ?? "";
  if (!source) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (startIndex < source.length) {
    const index = source.indexOf(normalizedKeyword, startIndex);
    if (index < 0) {
      break;
    }
    count += 1;
    startIndex = index + normalizedKeyword.length;
  }

  return count;
}

function scoreNormalizedSearchValue(
  normalizedKeyword: string | string[],
  value: string | null | undefined,
  weights: {
    exact: number;
    prefix: number;
    includes: number;
    occurrence: number;
  }
) {
  const normalizedKeywords = normalizeSearchKeywordTerms(normalizedKeyword);
  const source = value?.trim().toLowerCase() ?? "";

  if (normalizedKeywords.length === 0 || !source) {
    return 0;
  }

  return normalizedKeywords.reduce((totalScore, keywordItem) => {
    let score = 0;
    if (source === keywordItem) {
      score += weights.exact;
    } else if (source.startsWith(keywordItem)) {
      score += weights.prefix;
    } else if (source.includes(keywordItem)) {
      score += weights.includes;
    }

    return totalScore + score + countNormalizedSearchMatches(keywordItem, source) * weights.occurrence;
  }, 0);
}

function compareAffairsTagSearchResults(left: AffairsSearchTagResult, right: AffairsSearchTagResult) {
  if (right.searchScore !== left.searchScore) {
    return right.searchScore - left.searchScore;
  }

  if (left.tag.depth !== right.tag.depth) {
    return left.tag.depth - right.tag.depth;
  }

  return left.tag.path.localeCompare(right.tag.path, "zh-Hans-CN");
}

function compareAffairsTagSearchResultsByMode(
  left: AffairsSearchTagResult,
  right: AffairsSearchTagResult,
  mode: AffairsSearchSortMode
) {
  if (mode === "title_asc") {
    return left.tag.name.localeCompare(right.tag.name, "zh-Hans-CN")
      || left.tag.path.localeCompare(right.tag.path, "zh-Hans-CN");
  }

  if (mode === "updated_desc") {
    return right.tag.documentCount - left.tag.documentCount
      || left.tag.name.localeCompare(right.tag.name, "zh-Hans-CN")
      || left.tag.path.localeCompare(right.tag.path, "zh-Hans-CN");
  }

  return compareAffairsTagSearchResults(left, right);
}

function compareAffairsDocumentSearchResults(left: AffairsSearchDocumentResult, right: AffairsSearchDocumentResult) {
  if (right.searchScore !== left.searchScore) {
    return right.searchScore - left.searchScore;
  }

  const rightTime = Date.parse(right.record.updatedAt);
  const leftTime = Date.parse(left.record.updatedAt);
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return left.record.path.localeCompare(right.record.path, "zh-Hans-CN");
}

function compareAffairsDocumentSearchResultsByMode(
  left: AffairsSearchDocumentResult,
  right: AffairsSearchDocumentResult,
  mode: AffairsSearchSortMode
) {
  if (mode === "title_asc") {
    return getAffairsDocumentDisplayName(left.record).localeCompare(getAffairsDocumentDisplayName(right.record), "zh-Hans-CN")
      || left.record.path.localeCompare(right.record.path, "zh-Hans-CN");
  }

  if (mode === "updated_desc") {
    const rightTime = Date.parse(right.record.updatedAt);
    const leftTime = Date.parse(left.record.updatedAt);
    if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    if (right.searchScore !== left.searchScore) {
      return right.searchScore - left.searchScore;
    }
    return left.record.path.localeCompare(right.record.path, "zh-Hans-CN");
  }

  return compareAffairsDocumentSearchResults(left, right);
}

function compareAffairsConversationSearchResults(
  left: AffairsSearchConversationResult,
  right: AffairsSearchConversationResult
) {
  if (right.searchScore !== left.searchScore) {
    return right.searchScore - left.searchScore;
  }

  const rightTime = Date.parse(right.session.lastMessageAt ?? right.session.updatedAt);
  const leftTime = Date.parse(left.session.lastMessageAt ?? left.session.updatedAt);
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return left.session.title.localeCompare(right.session.title, "zh-Hans-CN");
}

function compareAffairsConversationSearchResultsByMode(
  left: AffairsSearchConversationResult,
  right: AffairsSearchConversationResult,
  mode: AffairsSearchSortMode
) {
  if (mode === "title_asc") {
    return left.session.title.localeCompare(right.session.title, "zh-Hans-CN");
  }

  if (mode === "updated_desc") {
    const rightTime = Date.parse(right.session.lastMessageAt ?? right.session.updatedAt);
    const leftTime = Date.parse(left.session.lastMessageAt ?? left.session.updatedAt);
    if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    if (right.searchScore !== left.searchScore) {
      return right.searchScore - left.searchScore;
    }
    return left.session.title.localeCompare(right.session.title, "zh-Hans-CN");
  }

  return compareAffairsConversationSearchResults(left, right);
}

function compareAffairsTodoSearchResults(left: AffairsSearchTodoResult, right: AffairsSearchTodoResult) {
  if (right.searchScore !== left.searchScore) {
    return right.searchScore - left.searchScore;
  }

  const rightTime = Date.parse(right.updatedAt);
  const leftTime = Date.parse(left.updatedAt);
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return left.title.localeCompare(right.title, "zh-Hans-CN");
}

function compareAffairsTodoSearchResultsByMode(
  left: AffairsSearchTodoResult,
  right: AffairsSearchTodoResult,
  mode: AffairsSearchSortMode
) {
  if (mode === "title_asc") {
    return left.title.localeCompare(right.title, "zh-Hans-CN");
  }

  if (mode === "updated_desc") {
    const rightTime = Date.parse(right.updatedAt);
    const leftTime = Date.parse(left.updatedAt);
    if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    if (right.searchScore !== left.searchScore) {
      return right.searchScore - left.searchScore;
    }
    return left.title.localeCompare(right.title, "zh-Hans-CN");
  }

  return compareAffairsTodoSearchResults(left, right);
}

function getParentFolderPathFromFilePath(filePath: string | null | undefined): string | null {
  const normalizedPath = normalizeWorkbenchFilePath(filePath ?? "");

  if (!normalizedPath) {
    return null;
  }

  const index = normalizedPath.lastIndexOf("/");
  return index >= 0 ? normalizedPath.slice(0, index) : null;
}

function mergeWorkspaceCatalogs(...workspaceGroups: Array<WorkspaceDto[] | null | undefined>) {
  const seen = new Set<string>();
  const result: WorkspaceDto[] = [];

  workspaceGroups.forEach((items) => {
    items?.forEach((workspace) => {
      if (seen.has(workspace.id)) {
        return;
      }
      seen.add(workspace.id);
      result.push(workspace);
    });
  });

  return result;
}

const LazyFileContextPanel = lazy(async () => {
  const module = await import("./FileContextPanel");

  return {
    default: module.FileContextPanel
  };
});

const LazyGitSidebar = lazy(async () => {
  const module = await import("./GitSidebar");

  return {
    default: module.GitSidebar
  };
});

const LazyTerminalManagerPanel = lazy(async () => {
  const module = await import("../../workbench/components/TerminalManagerPanel");

  return {
    default: module.TerminalManagerPanel
  };
});

export interface WorkspaceSessionGroup {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
  childWorktrees: WorkbenchWorktreeNodeDto[];
}

interface NavigationSessionEntry {
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
}

interface LightweightChatSessionEntry {
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
}

type FavoriteSidebarEntry =
  | (NavigationSessionEntry & { favoriteEntryKind?: "workspace-session" })
  | (LightweightChatSessionEntry & { favoriteEntryKind: "lightweight-chat" });

interface BatchSessionDeletionTarget {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
}

interface WorkspaceSidebarGroup {
  workspace: WorkspaceDto;
  visibleSessions: SessionSummaryDto[];
  archivedSessions: SessionSummaryDto[];
  visibleSessionTree: NavigationSessionTreeNode[];
  childWorktrees: WorkspaceSidebarWorktreeNode[];
  isCollapsed: boolean;
}

interface WorkspaceSidebarWorktreeNode {
  workspace: WorkspaceDto;
  meta: WorkbenchWorktreeNodeDto["meta"];
  visibleSessions: SessionSummaryDto[];
  archivedSessions: SessionSummaryDto[];
  visibleSessionTree: NavigationSessionTreeNode[];
  children: WorkspaceSidebarWorktreeNode[];
}

interface PeerWorkspaceNavigationView {
  localWorkspaceId: string;
  activeHostId: string;
  remoteWorkspaceId: string;
  targetHostId: string;
  sessions: SessionSummaryDto[];
}

function buildPeerWorkspaceSummaryStateKey(
  activeHostId: string,
  localWorkspaceId: string,
  targetHostId: string
): string {
  return `${activeHostId}::${localWorkspaceId}::${targetHostId}`;
}

interface WorktreeNodeExpansionState {
  expandedWorkspaceIds: string[];
  collapsedWorkspaceIds: string[];
}

type NavigationSessionTreeNode = SessionTreeNode<SessionSummaryDto>;
type RenderableSessionTreeNode = {
  node: NavigationSessionTreeNode;
  fullNode: NavigationSessionTreeNode;
  branchKey?: string;
  subagentStateKey?: string;
  showParallelBadge?: boolean;
  forceInactive?: boolean;
};

type SubagentRenderGroup = {
  key: "open" | "closed";
  nodes: RenderableSessionTreeNode[];
  count: number;
  collapsedToggle?: {
    stateKey: string;
    expanded: boolean;
  };
};

export type WorkbenchShellMode = "desktop" | "mobile";

interface WorkbenchRealtimeTargetOptions {
  targetHostId?: string | null;
}

interface WorkbenchRealtimeKnownRevisionOptions extends WorkbenchRealtimeTargetOptions {
  knownRevision?: string | null | undefined;
  skipKnownRevision?: boolean;
}

interface WorkbenchRealtimeFileTreeOptions extends WorkbenchRealtimeTargetOptions {
  knownRevisionByPath?: Record<string, string | null | undefined>;
}

function hasValidTreeNodeSession(
  node: NavigationSessionTreeNode | null | undefined
): node is NavigationSessionTreeNode {
  return Boolean(node?.item ?? (node as { session?: SessionSummaryDto } | null | undefined)?.session);
}

export function getTreeNodeChildren(
  node: Pick<NavigationSessionTreeNode, "children"> | null | undefined
): NavigationSessionTreeNode[] {
  return getSessionTreeChildren(node);
}

function getTreeNodeSession(node: NavigationSessionTreeNode | { session?: SessionSummaryDto } | null | undefined) {
  return node && "item" in node ? node.item : node?.session ?? null;
}

function isClosedSubagentSession(session: SessionSummaryDto): boolean {
  return (
    isRealSubagentSession(session)
    && (session.runningState === "completed"
      || session.runningState === "interrupted"
      || session.runningState === "failed"
      || session.activityState === "completed_unread"
      || Boolean(session.completedAt))
  );
}

export function getVisibleSessionTreeNodes(
  group: Pick<WorkspaceSidebarGroup, "visibleSessionTree"> | null | undefined
): NavigationSessionTreeNode[] {
  if (!Array.isArray(group?.visibleSessionTree)) {
    return [];
  }

  return group.visibleSessionTree.filter(hasValidTreeNodeSession);
}

interface WorkbenchShellContextValue {
  shellMode: WorkbenchShellMode;
  navigationGroups: WorkspaceSessionGroup[];
  navigationLoading: boolean;
  navigationError: string | null;
  currentWorkspaceId: string | null;
  currentWorkspaceRef: WorkspaceRef | null;
  currentTargetHostId: string | null;
  currentSessionId: string | null;
  findCanonicalSessionEntryByScope: (
    sessionId: string | null | undefined,
    options?: {
      displayWorkspaceId?: string | null;
      targetHostId?: string | null;
    }
  ) => WorkbenchNavigationEntry | null;
  findVisibleSessionEntryByScope: (
    sessionId: string | null | undefined,
    options?: {
      displayWorkspaceId?: string | null;
      targetHostId?: string | null;
    }
  ) => WorkbenchNavigationEntry | null;
  resolveNavigationWorkspaceRef: (workspaceId: string, options?: {
    preferredTargetHostId?: string | null;
    fallbackToCurrent?: boolean;
  }) => WorkspaceRef | null;
  favoriteSessionIds: string[];
  favoriteSessions: WorkbenchNavigationEntry[];
  globalNotifications: WorkbenchGlobalNotification[];
  archivedNotificationIds: string[];
  showArchivedNotifications: boolean;
  unreadNotificationCount: number;
  refreshNavigation: () => Promise<void>;
  requestNavigationRefresh: () => void;
  openNotificationPanel: () => void;
  closeNotificationPanel: () => void;
  setShowArchivedNotifications: (checked: boolean) => void;
  archiveNotification: (notificationId: string) => void;
  unarchiveNotification: (notificationId: string) => void;
  setAuxiliaryPanel: (panel: ReactNode | null) => void;
  subscribeFileTree: (
    workspaceId: string,
    paths: string[],
    options?: WorkbenchRealtimeFileTreeOptions
  ) => void;
  requestFileTreeRefresh: (
    workspaceId: string,
    paths?: string[],
    options?: WorkbenchRealtimeFileTreeOptions
  ) => void;
  addFileTreeSnapshotListener: (
    listener: (snapshot: FileTreeRealtimeSnapshotDto) => void
  ) => () => void;
  subscribeGitSnapshot: (
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => void;
  requestGitRefresh: (
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => void;
  addGitSnapshotListener: (listener: (snapshot: GitRealtimeSnapshotDto) => void) => () => void;
  subscribeWorkspaceManagementSnapshot: (
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => void;
  requestWorkspaceManagementRefresh: (
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => void;
  addWorkspaceManagementSnapshotListener: (
    listener: (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void
  ) => () => void;
  workspaceManagementStateById: Record<string, WorkspaceManagementViewState>;
  subscribeTerminalManagerSnapshot: (
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => void;
  requestTerminalManagerRefresh: (
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => void;
  addTerminalManagerSnapshotListener: (
    listener: (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  ) => () => void;
  selectWorkspace: (workspaceId: string, workspaceRef?: WorkspaceRef | null) => void;
  toggleFavoriteSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<SessionSummaryDto>;
  startDraftSession: (workspaceId: string, provider: ProviderId) => void;
  setSessionWorkspace: (sessionId: string, workspaceId: string | null) => void;
  upsertNavigationSession: (session: SessionSummaryDto) => void;
  markNavigationSessionSeen: (sessionId: string, seenAt?: string) => void;
  revealWorkspaceFile: (input: {
    workspaceId?: string | null;
    filePath: string;
    openViewer?: boolean;
  }) => boolean;
}

async function assertProviderCanStartDraftSession(
  workspaceId: string,
  provider: ProviderId,
  targetHostId?: string | null
): Promise<void> {
  const capabilities = await getProviderCapabilities(provider, workspaceId, undefined, {
    targetHostId: targetHostId ?? undefined
  });

  if (capabilities.canStartSession !== false) {
    return;
  }

  throw new Error(capabilities.limitations[0] ?? t("conversation.capabilityDenied"));
}

export interface WorkbenchFileRevealRequest {
  requestId: number;
  workspaceId: string;
  filePath: string;
  openViewer: boolean;
}

interface WorkspaceManagementViewState {
  detail: WorkspaceManagementSummaryDto | null;
  loading: boolean;
  error: string | null;
}

interface WorktreeMergeViewState {
  preview: WorktreeMergePreviewDto | null;
  loading: boolean;
  applying: boolean;
  cleaning: boolean;
  error: string | null;
}

interface WorktreeBaseRefOption {
  value: string;
  current?: boolean;
  recommended?: boolean;
}

interface WorktreeBaseRefSuggestions {
  localBranches: WorktreeBaseRefOption[];
  remoteBranches: WorktreeBaseRefOption[];
  tags: WorktreeBaseRefOption[];
}

interface WorktreeBaseRefOptionGroup {
  key: "localBranches" | "remoteBranches" | "tags";
  label: string;
  items: WorktreeBaseRefOption[];
}

type CenterTab = "conversation" | "butler";
type InfoTab = "files" | "git" | "terminals";
type AffairsSearchSortMode = "relevance" | "updated_desc" | "title_asc";

interface CodeSearchResult {
  workspaceId: string;
  workspaceName: string;
  file: FileNodeDto;
}

type SearchScope = "code" | "affairs" | "all";

interface AffairsSearchDocumentResult {
  kind: "document";
  workspaceId: string;
  libraryRootDir: string;
  libraryLabel: string;
  record: AffairsLibraryDocumentRecordDto;
  searchScore: number;
  snippet: string | null;
  dedupePath: string;
}

interface AffairsSearchTagResult {
  kind: "tag";
  workspaceId: string;
  libraryRootDir: string;
  libraryLabel: string;
  tag: AffairsLibraryTagNodeDto;
  searchScore: number;
}

interface AffairsSearchConversationResult {
  kind: "conversation";
  workspaceId: string;
  workspaceName: string;
  session: SessionSummaryDto;
  conversationKind: "lightweight" | "agent";
  searchScore: number;
}

interface AffairsSearchTodoResult {
  kind: "todo";
  workspaceId: string;
  workspaceName: string;
  todoKind: "inbox" | "follow_up";
  id: string;
  title: string;
  summary: string;
  statusLabel: string;
  updatedAt: string;
  searchScore: number;
}

interface AffairsSearchResults {
  documents: AffairsSearchDocumentResult[];
  tags: AffairsSearchTagResult[];
  conversations: AffairsSearchConversationResult[];
  todos: AffairsSearchTodoResult[];
}

const EMPTY_AFFAIRS_SEARCH_RESULTS: AffairsSearchResults = {
  documents: [],
  tags: [],
  conversations: [],
  todos: []
};


const WorkbenchShellContext = createContext<WorkbenchShellContextValue | null>(null);

function isSubagentSession(session: SessionSummaryDto) {
  return isRealSubagentSession(session);
}

function isArchivedSession(session: SessionSummaryDto) {
  return isArchivedSessionVisibleInArchive(session);
}

function resolveParentSessionId(session: SessionSummaryDto) {
  return resolveSessionDisplayParentSessionId(session);
}

function buildSessionTree(
  sessions: SessionSummaryDto[],
  sessionDisplaySortMode: SessionDisplaySortMode
) {
  return buildRecursiveSessionTree(sessions, {
    getId: (session) => session.sessionId,
    getParentId: resolveParentSessionId,
    compare: (left, right) =>
      compareSessionSummaryByDisplayMode(left, right, sessionDisplaySortMode)
  });
}

function buildNavigationSessionTreeFromGroups(
  groups: readonly WorkspaceSidebarGroup[],
  sessionDisplaySortMode: SessionDisplaySortMode
): NavigationSessionTreeNode[] {
  const entries = flattenSidebarNavigationEntries(groups);

  return buildNavigationSessionTreeFromEntries(entries, sessionDisplaySortMode);
}

function buildNavigationSessionTreeFromEntries(
  entries: readonly NavigationSessionEntry[],
  sessionDisplaySortMode: SessionDisplaySortMode
): NavigationSessionTreeNode[] {
  const dedupedEntries = dedupeNavigationSessionEntries(entries);

  return buildRecursiveSessionTree(dedupedEntries, {
    getId: (entry) => entry.session.sessionId,
    getParentId: (entry) => resolveParentSessionId(entry.session),
    compare: (left, right) =>
      compareSessionSummaryByDisplayMode(left.session, right.session, sessionDisplaySortMode)
  }).map((node) => projectNavigationEntryTreeNode(node));
}

function flattenSidebarNavigationEntries(
  groups: readonly WorkspaceSidebarGroup[]
): NavigationSessionEntry[] {
  return groups.flatMap((group) => [
    ...group.visibleSessions.map((session) => ({
      session,
      workspace: group.workspace
    })),
    ...flattenSidebarWorktreeNavigationEntries(group.childWorktrees)
  ]);
}

function flattenSidebarWorktreeNavigationEntries(
  nodes: readonly WorkspaceSidebarWorktreeNode[]
): NavigationSessionEntry[] {
  return nodes.flatMap((node) => [
    ...node.visibleSessions.map((session) => ({
      session,
      workspace: node.workspace
    })),
    ...flattenSidebarWorktreeNavigationEntries(node.children)
  ]);
}

function dedupeNavigationSessionEntries(
  entries: readonly NavigationSessionEntry[]
): NavigationSessionEntry[] {
  const uniqueEntries: NavigationSessionEntry[] = [];
  const seenSessionIds = new Set<string>();

  for (const entry of entries) {
    const sessionId = entry.session.sessionId.trim();

    if (!sessionId || seenSessionIds.has(sessionId)) {
      continue;
    }

    seenSessionIds.add(sessionId);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

function projectNavigationEntryTreeNode(
  node: SessionTreeNode<NavigationSessionEntry>,
  depth = 0
): NavigationSessionTreeNode {
  return {
    item: node.item.session,
    depth,
    children: node.children.map((childNode) => projectNavigationEntryTreeNode(childNode, depth + 1))
  };
}

function offsetNavigationTreeDepth(
  node: NavigationSessionTreeNode,
  offset: number
): NavigationSessionTreeNode {
  if (offset === 0) {
    return node;
  }

  return {
    ...node,
    depth: node.depth + offset,
    children: getTreeNodeChildren(node).map((childNode) => offsetNavigationTreeDepth(childNode, offset))
  };
}

function buildParallelAnchorProjectionKey(sessionId: string) {
  return `${sessionId}::parallel-anchor-member`;
}

function buildClosedSubagentStateKey(sessionId: string) {
  return `${sessionId}::closed-subagents`;
}

function createProjectedNavigationTreeNode(input: {
  session: SessionSummaryDto;
  depth: number;
  children: readonly NavigationSessionTreeNode[];
}): NavigationSessionTreeNode {
  const { session, depth, children } = input;

  return {
    item: session,
    depth,
    children: [...children]
  };
}

function findNavigationTreeNodeBySessionId(
  nodes: readonly NavigationSessionTreeNode[],
  sessionId: string
): NavigationSessionTreeNode | null {
  for (const node of nodes) {
    if (node.item.sessionId === sessionId) {
      return node;
    }

    const nestedMatch = findNavigationTreeNodeBySessionId(getTreeNodeChildren(node), sessionId);

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function findParallelAncestorGroupId(
  nodes: readonly NavigationSessionTreeNode[],
  sessionId: string
): string | null {
  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    return null;
  }

  for (const node of nodes) {
    const groupId = findParallelAncestorGroupIdInNode(node, normalizedSessionId, null);

    if (groupId) {
      return groupId;
    }
  }

  return null;
}

function findParallelAncestorGroupIdInNode(
  node: NavigationSessionTreeNode,
  sessionId: string,
  inheritedGroupId: string | null
): string | null {
  const nextInheritedGroupId = node.item.parallelGroup?.groupId?.trim() || inheritedGroupId;

  if (node.item.sessionId === sessionId) {
    return nextInheritedGroupId;
  }

  for (const childNode of getTreeNodeChildren(node)) {
    const groupId = findParallelAncestorGroupIdInNode(childNode, sessionId, nextInheritedGroupId);

    if (groupId) {
      return groupId;
    }
  }

  return null;
}

function filterVisibleWorkspaceSessions(sessions: SessionSummaryDto[]) {
  return sessions.filter((session) => {
    if (isArchivedSession(session)) {
      return false;
    }

    const parentSessionId = resolveParentSessionId(session);

    if (!parentSessionId) {
      return true;
    }

    const parentSession = sessions.find((item) => item.sessionId === parentSessionId);

    if (!parentSession) {
      return true;
    }

    if (isArchivedSession(parentSession)) {
      return !isSubagentSession(session);
    }

    return true;
  });
}

export function flattenVisibleSessionTree(nodes: NavigationSessionTreeNode[]) {
  return nodes.flatMap((node) => {
    const session = getTreeNodeSession(node);
    return session ? [session, ...flattenSessionTree(getTreeNodeChildren(node))] : [];
  });
}

function limitVisibleDescendantTree(
  node: NavigationSessionTreeNode,
  visibleCount: number,
  sessionDisplaySortMode: SessionDisplaySortMode,
  shouldCountNode: (node: NavigationSessionTreeNode) => boolean = () => true
): NavigationSessionTreeNode {
  const childNodes = getTreeNodeChildren(node);
  const descendantNodes = flattenSessionTreeNodes(childNodes)
    .filter(shouldCountNode)
    .sort((left, right) =>
      compareSessionSummaryByDisplayMode(left.item, right.item, sessionDisplaySortMode)
    );
  const shouldPrioritizeDirectParallelChildren =
    node.item.parallelGroup?.role === "anchor"
    && childNodes.some((childNode) => childNode.item.parallelGroup?.groupId === node.item.parallelGroup?.groupId);

  if (!shouldPrioritizeDirectParallelChildren) {
    const visibleSessionIdSet = new Set(
      descendantNodes
        .slice(0, Math.max(0, visibleCount))
        .map((item) => item.item.sessionId)
    );

    return {
      ...node,
      children: filterTreeNodesByVisibleSet(childNodes, visibleSessionIdSet)
    };
  }

  const directChildNodes = childNodes
    .slice()
    .sort((left, right) => compareSessionSummaryByDisplayMode(left.item, right.item, sessionDisplaySortMode));
  const directParallelChildSessionIds = directChildNodes
    .filter((item) => item.item.parallelGroup?.groupId === node.item.parallelGroup?.groupId)
    .map((item) => item.item.sessionId);
  const directNonParallelChildSessionIds = directChildNodes
    .filter((item) => item.item.parallelGroup?.groupId !== node.item.parallelGroup?.groupId)
    .map((item) => item.item.sessionId);
  const prioritizedDirectChildSessionIds = [
    ...directParallelChildSessionIds,
    ...directNonParallelChildSessionIds
  ];
  const remainingVisibleCount = Math.max(0, visibleCount - prioritizedDirectChildSessionIds.length);
  const visibleSessionIdSet = new Set<string>(prioritizedDirectChildSessionIds);

  for (const item of descendantNodes) {
    if (visibleSessionIdSet.size >= prioritizedDirectChildSessionIds.length + remainingVisibleCount) {
      break;
    }

    visibleSessionIdSet.add(item.item.sessionId);
  }

  return {
    ...node,
    children: filterTreeNodesByVisibleSet(childNodes, visibleSessionIdSet)
  };
}

function filterTreeNodesByVisibleSet(
  nodes: NavigationSessionTreeNode[],
  visibleSessionIdSet: ReadonlySet<string>
): NavigationSessionTreeNode[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterTreeNodesByVisibleSet(getTreeNodeChildren(node), visibleSessionIdSet);

    if (!visibleSessionIdSet.has(node.item.sessionId) && filteredChildren.length === 0) {
      return [];
    }

    return [
      {
        ...node,
        children: filteredChildren
      }
    ];
  });
}

function resolveVisibleItemCount(
  totalCount: number,
  pageSize: number,
  currentVisibleCount?: number,
  activeItemIndex = -1
) {
  if (totalCount <= 0) {
    return 0;
  }

  const minimumVisibleCount = activeItemIndex >= 0 ? Math.max(pageSize, activeItemIndex + 1) : pageSize;

  return Math.min(totalCount, Math.max(currentVisibleCount ?? 0, minimumVisibleCount));
}

function isSameVisibleCountRecord(
  currentRecord: Record<string, number>,
  nextRecord: Record<string, number>
) {
  const currentKeys = Object.keys(currentRecord);
  const nextKeys = Object.keys(nextRecord);

  if (currentKeys.length !== nextKeys.length) {
    return false;
  }

  return currentKeys.every((key) => currentRecord[key] === nextRecord[key]);
}

function formatSessionMeta(session: SessionSummaryDto) {
  const date = session.lastMessageAt ?? session.updatedAt;
  return date ? new Date(date).toLocaleDateString() : "";
}

function formatProviderLabel(provider: ProviderId, mode: "compact" | "full" = "compact") {
  return getProviderDisplayName(provider, mode);
}

const sessionLinkLayerStyle: CSSProperties = {
  position: "relative",
  zIndex: 0
};

const subagentToggleLayerStyle: CSSProperties = {
  zIndex: 1
};

function buildSessionMeta(
  session: SessionSummaryDto,
  workspace: WorkspaceDto,
  includeWorkspaceName: boolean,
  workspaceLabel?: string
) {
  const metaParts: string[] = [];
  const resolvedWorkspaceLabel = workspaceLabel?.trim() || workspace.name;

  if (includeWorkspaceName) {
    metaParts.push(resolvedWorkspaceLabel);
  }

  const dateLabel = formatSessionMeta(session);

  if (dateLabel) {
    metaParts.push(dateLabel);
  }

  return metaParts.join(" · ") || resolvedWorkspaceLabel;
}

function sessionStateClassName(
  session: SessionSummaryDto,
  options?: {
    hasSubagents?: boolean;
    isActive?: boolean;
  }
) {
  return resolveSessionIndicatorClassName("session-state-indicator", session, options);
}

function sessionStateVariantName(
  session: SessionSummaryDto,
  options?: {
    hasSubagents?: boolean;
    isActive?: boolean;
  }
) {
  return resolveSessionIndicatorClassVariant(session, options);
}

function readStoredNumber(key: string, fallback: number) {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const raw = window.localStorage.getItem(key);

    if (raw === null) {
      return fallback;
    }

    return raw === "true";
  } catch {
    return fallback;
  }
}

function readStoredString(key: string) {
  try {
    const raw = window.localStorage.getItem(key)?.trim();
    return raw ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 忽略隐私模式或测试环境里的本地存储失败。
  }
}

function removeStoredValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 忽略隐私模式或测试环境里的本地存储失败。
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readCssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMacOsUnifiedTitlebarGestureHeight(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  const titlebarHeight = readCssPixelValue(styles.getPropertyValue("--desktop-macos-titlebar-height"));
  const headerMinHeight = readCssPixelValue(styles.getPropertyValue("--workbench-header-min-height"));
  const paddingTop = readCssPixelValue(styles.getPropertyValue("--workbench-macos-titlebar-padding-top"));
  const paddingBottom = readCssPixelValue(styles.getPropertyValue("--workbench-macos-titlebar-padding-bottom"));

  return Math.max(titlebarHeight, headerMinHeight, 40) + paddingTop + paddingBottom + 8;
}

function isMacOsUnifiedTitlebarGesture(eventClientY: number, shellElement: HTMLElement): boolean {
  const shellRect = shellElement.getBoundingClientRect();

  return (
    eventClientY >= shellRect.top &&
    eventClientY <= shellRect.top + resolveMacOsUnifiedTitlebarGestureHeight(shellElement)
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

function focusComposer() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
}

function findWorkbenchWorktreeNodeByWorkspaceId(
  nodes: readonly WorkbenchWorktreeNodeDto[],
  workspaceId: string | null | undefined
): WorkbenchWorktreeNodeDto | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  for (const node of nodes) {
    if (node.workspace.id === normalizedWorkspaceId) {
      return node;
    }

    const nested = findWorkbenchWorktreeNodeByWorkspaceId(node.children, normalizedWorkspaceId);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function findNavigationWorktreeNodeByWorkspaceId(
  groups: readonly WorkspaceSessionGroup[],
  workspaceId: string | null | undefined
): WorkbenchWorktreeNodeDto | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  for (const group of groups) {
    const matched = findWorkbenchWorktreeNodeByWorkspaceId(group.childWorktrees, normalizedWorkspaceId);

    if (matched) {
      return matched;
    }
  }

  return null;
}

function collectWorkbenchWorktreeWorkspaceIds(nodes: readonly WorkbenchWorktreeNodeDto[]): string[] {
  return nodes.flatMap((node) => [
    node.workspace.id,
    ...collectWorkbenchWorktreeWorkspaceIds(node.children)
  ]);
}

function collectKnownWorkspaceIds(groups: readonly WorkspaceSessionGroup[]): Set<string> {
  return new Set(
    groups.flatMap((group) => [
      group.workspace.id,
      ...collectWorkbenchWorktreeWorkspaceIds(group.childWorktrees)
    ])
  );
}

function extractCollapsedWorkspaceIds(snapshot: WorkbenchSnapshotDto | null | undefined): string[] {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    return [];
  }

  return snapshot.items
    .filter((item) => item.collapsed === true && item.workspace?.id)
    .map((item) => item.workspace.id);
}

function createWorkbenchSnapshotFromGroups(
  groups: WorkspaceSessionGroup[],
  collapsedWorkspaceIds: readonly string[]
): WorkbenchSnapshotDto {
  const collapsedWorkspaceIdSet = new Set(collapsedWorkspaceIds);

  return {
    items: groups.map((group) => ({
      workspace: group.workspace,
      sessions: group.sessions,
      childWorktrees: group.childWorktrees,
      collapsed: collapsedWorkspaceIdSet.has(group.workspace.id)
    }))
  };
}

function buildWorkspaceSidebarWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[],
  favoriteSessionIdSet: ReadonlySet<string>,
  sessionDisplaySortMode: SessionDisplaySortMode,
  hiddenSessionIdSet: ReadonlySet<string> = new Set(),
  resolvePeerNavigationForWorkspace?: (workspace: WorkspaceDto) => PeerWorkspaceNavigationView | null
): WorkspaceSidebarWorktreeNode[] {
  return nodes.map((node) => {
    const peerNavigation = resolvePeerNavigationForWorkspace?.(node.workspace);
    const scopedSessions = (peerNavigation?.sessions ?? node.sessions).filter(
      (session) => !hiddenSessionIdSet.has(session.sessionId)
    );
    const visibleSessions = filterVisibleWorkspaceSessions(scopedSessions);

    return {
      workspace: node.workspace,
      meta: node.meta,
      visibleSessions,
      archivedSessions: scopedSessions.filter(
        (session) => isArchivedSession(session)
      ),
      visibleSessionTree: buildSessionTree(visibleSessions, sessionDisplaySortMode).filter(
        (treeNode) =>
          !favoriteSessionIdSet.has(treeNode.item.sessionId)
          && !someSessionTreeNode(
            getTreeNodeChildren(treeNode),
            (session) => favoriteSessionIdSet.has(session.sessionId)
          )
      ),
      children: buildWorkspaceSidebarWorktreeNodes(
        node.children,
        favoriteSessionIdSet,
        sessionDisplaySortMode,
        hiddenSessionIdSet,
        resolvePeerNavigationForWorkspace
      )
    };
  });
}

function collectSidebarWorktreeWorkspaceIds(nodes: readonly WorkspaceSidebarWorktreeNode[]): string[] {
  return nodes.flatMap((node) => [node.workspace.id, ...collectSidebarWorktreeWorkspaceIds(node.children)]);
}

function collectSidebarVisibleSessionTrees(
  nodes: readonly WorkspaceSidebarWorktreeNode[]
): NavigationSessionTreeNode[] {
  return nodes.flatMap((node) => [...node.visibleSessionTree, ...collectSidebarVisibleSessionTrees(node.children)]);
}

function collectSidebarWorktreeNodes(
  nodes: readonly WorkspaceSidebarWorktreeNode[]
): WorkspaceSidebarWorktreeNode[] {
  return nodes.flatMap((node) => [node, ...collectSidebarWorktreeNodes(node.children)]);
}

function collectSidebarWorkspaces(
  groups: readonly WorkspaceSessionGroup[]
): WorkspaceDto[] {
  return groups.flatMap((group) => [
    group.workspace,
    ...collectSidebarWorktreeWorkspaceDtos(group.childWorktrees)
  ]);
}

function collectSidebarWorktreeWorkspaceDtos(
  nodes: readonly WorkbenchWorktreeNodeDto[]
): WorkspaceDto[] {
  return nodes.flatMap((node) => [
    node.workspace,
    ...collectSidebarWorktreeWorkspaceDtos(node.children)
  ]);
}

function findSidebarBatchTarget(
  workspaceGroups: readonly WorkspaceSidebarGroup[],
  workspaceId: string | null
): { workspace: WorkspaceDto; visibleSessionTree: NavigationSessionTreeNode[] } | null {
  if (!workspaceId) {
    return null;
  }

  for (const group of workspaceGroups) {
    if (group.workspace.id === workspaceId) {
      return {
        workspace: group.workspace,
        visibleSessionTree: getVisibleSessionTreeNodes(group)
      };
    }

    const nestedTarget = findSidebarBatchTargetInWorktreeNodes(group.childWorktrees, workspaceId);

    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}

function findSidebarVisibleSessionNode(
  nodes: readonly WorkspaceSidebarWorktreeNode[],
  sessionId: string
): NavigationSessionTreeNode | null {
  for (const worktreeNode of nodes) {
    const matchedNode = flattenSessionTreeNodes(worktreeNode.visibleSessionTree).find(
      (treeNode) => treeNode.item.sessionId === sessionId
    );

    if (matchedNode) {
      return matchedNode;
    }

    const nestedMatch = findSidebarVisibleSessionNode(worktreeNode.children, sessionId);

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function findSidebarBatchTargetInWorktreeNodes(
  nodes: readonly WorkspaceSidebarWorktreeNode[],
  workspaceId: string
): { workspace: WorkspaceDto; visibleSessionTree: NavigationSessionTreeNode[] } | null {
  for (const node of nodes) {
    if (node.workspace.id === workspaceId) {
      return {
        workspace: node.workspace,
        visibleSessionTree: node.visibleSessionTree
      };
    }

    const nestedTarget = findSidebarBatchTargetInWorktreeNodes(node.children, workspaceId);

    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}

function findSidebarArchiveTarget(
  workspaceGroups: readonly WorkspaceSidebarGroup[],
  workspaceId: string | null
): { workspace: WorkspaceDto; archivedSessions: SessionSummaryDto[] } | null {
  if (!workspaceId) {
    return null;
  }

  for (const group of workspaceGroups) {
    if (group.workspace.id === workspaceId) {
      return {
        workspace: group.workspace,
        archivedSessions: group.archivedSessions
      };
    }

    const nestedTarget = findSidebarArchiveTargetInWorktreeNodes(group.childWorktrees, workspaceId);

    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}

function findSidebarWorkspaceById(
  workspaceGroups: readonly WorkspaceSidebarGroup[],
  workspaceId: string | null
): WorkspaceDto | null {
  if (!workspaceId) {
    return null;
  }

  for (const group of workspaceGroups) {
    if (group.workspace.id === workspaceId) {
      return group.workspace;
    }

    const nestedWorkspace = findSidebarWorkspaceByIdInWorktreeNodes(group.childWorktrees, workspaceId);

    if (nestedWorkspace) {
      return nestedWorkspace;
    }
  }

  return null;
}

function findSidebarArchiveTargetInWorktreeNodes(
  nodes: readonly WorkspaceSidebarWorktreeNode[],
  workspaceId: string
): { workspace: WorkspaceDto; archivedSessions: SessionSummaryDto[] } | null {
  for (const node of nodes) {
    if (node.workspace.id === workspaceId) {
      return {
        workspace: node.workspace,
        archivedSessions: node.archivedSessions
      };
    }

    const nestedTarget = findSidebarArchiveTargetInWorktreeNodes(node.children, workspaceId);

    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}

function findSidebarWorkspaceByIdInWorktreeNodes(
  nodes: readonly WorkspaceSidebarWorktreeNode[],
  workspaceId: string
): WorkspaceDto | null {
  for (const node of nodes) {
    if (node.workspace.id === workspaceId) {
      return node.workspace;
    }

    const nestedWorkspace = findSidebarWorkspaceByIdInWorktreeNodes(node.children, workspaceId);

    if (nestedWorkspace) {
      return nestedWorkspace;
    }
  }

  return null;
}

function findSidebarWorktreePathByWorkspaceId(
  nodes: readonly WorkspaceSidebarWorktreeNode[],
  workspaceId: string
): string[] {
  for (const node of nodes) {
    if (node.workspace.id === workspaceId) {
      return [node.workspace.id];
    }

    const childPath = findSidebarWorktreePathByWorkspaceId(node.children, workspaceId);

    if (childPath.length > 0) {
      return [node.workspace.id, ...childPath];
    }
  }

  return [];
}

function hasSidebarWorktreeWorkspace(
  nodes: readonly WorkspaceSidebarWorktreeNode[],
  workspaceId: string | null
): boolean {
  if (!workspaceId) {
    return false;
  }

  return findSidebarWorktreePathByWorkspaceId(nodes, workspaceId).length > 0;
}

function collectManagedWorkspaceIds(
  groups: readonly Pick<WorkspaceSidebarGroup, "workspace" | "childWorktrees">[]
): string[] {
  return groups.flatMap((group) => [group.workspace.id, ...collectManagedWorktreeIds(group.childWorktrees)]);
}

function collectManagedWorktreeIds(nodes: readonly WorkspaceSidebarWorktreeNode[]): string[] {
  return nodes.flatMap((node) => [node.workspace.id, ...collectManagedWorktreeIds(node.children)]);
}

function buildManagedWorkspaceTreePath(
  workspaceContext: WorkspaceVisualContext,
  ancestorDisplayNames: readonly string[] = []
): string {
  if (workspaceContext.tone !== "worktree") {
    return workspaceContext.rootDisplayName;
  }

  if (ancestorDisplayNames.length > 0) {
    return ancestorDisplayNames.join(" / ");
  }

  const segments = [workspaceContext.rootDisplayName];

  if (
    workspaceContext.parentDisplayName
    && workspaceContext.parentDisplayName !== workspaceContext.rootDisplayName
  ) {
    segments.push(workspaceContext.parentDisplayName);
  }

  return segments.join(" / ");
}

type WorkspaceDropPosition = "before" | "after";

interface WorkspacePointerReorderGesture {
  pointerId: number;
  workspaceId: string;
  startX: number;
  startY: number;
  pointerTarget: HTMLButtonElement;
  dragging: boolean;
}

export function reorderWorkspaceGroups(
  groups: WorkspaceSessionGroup[],
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  position: WorkspaceDropPosition
): WorkspaceSessionGroup[] {
  if (sourceWorkspaceId === targetWorkspaceId) {
    return groups;
  }

  const sourceIndex = groups.findIndex((group) => group.workspace.id === sourceWorkspaceId);
  const targetIndex = groups.findIndex((group) => group.workspace.id === targetWorkspaceId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return groups;
  }

  const nextGroups = [...groups];
  const [sourceGroup] = nextGroups.splice(sourceIndex, 1);

  if (!sourceGroup) {
    return groups;
  }

  const nextTargetIndex = nextGroups.findIndex((group) => group.workspace.id === targetWorkspaceId);

  if (nextTargetIndex < 0) {
    return groups;
  }

  nextGroups.splice(position === "before" ? nextTargetIndex : nextTargetIndex + 1, 0, sourceGroup);

  return nextGroups.every((group, index) => group.workspace.id === groups[index]?.workspace.id)
    ? groups
    : nextGroups;
}

function applyPendingArchiveStateToSnapshot(
  snapshot: WorkbenchSnapshotDto,
  pendingArchiveStateBySessionId: ReadonlyMap<string, boolean>
): WorkbenchSnapshotDto {
  if (!Array.isArray(snapshot.items) || pendingArchiveStateBySessionId.size === 0) {
    return snapshot;
  }

  let changed = false;

  const nextItems = snapshot.items.map((item) => {
    let itemChanged = false;
    const nextSessions = item.sessions.map((session) => {
      const pendingArchivedState = pendingArchiveStateBySessionId.get(session.sessionId);

      if (pendingArchivedState === undefined || isArchivedSession(session) === pendingArchivedState) {
        return session;
      }

      changed = true;
      itemChanged = true;
      return {
        ...session,
        isArchived: pendingArchivedState
      };
    });
    const nextChildWorktrees = applyPendingArchiveStateToWorktreeNodes(
      item.childWorktrees ?? [],
      pendingArchiveStateBySessionId,
      (value) => {
        if (value) {
          changed = true;
          itemChanged = true;
        }
      }
    );

    return itemChanged
      ? {
          ...item,
          sessions: nextSessions,
          childWorktrees: nextChildWorktrees
        }
      : item;
  });

  return changed
    ? {
        ...snapshot,
        items: nextItems
      }
    : snapshot;
}

function settlePendingArchiveStateFromSnapshot(
  pendingArchiveStateBySessionId: Map<string, boolean>,
  snapshot: WorkbenchSnapshotDto
) {
  if (!Array.isArray(snapshot.items) || pendingArchiveStateBySessionId.size === 0) {
    return;
  }

  for (const item of snapshot.items) {
    for (const session of item.sessions) {
      const pendingArchivedState = pendingArchiveStateBySessionId.get(session.sessionId);

      if (pendingArchivedState === undefined) {
        continue;
      }

      if (isArchivedSession(session) === pendingArchivedState) {
        pendingArchiveStateBySessionId.delete(session.sessionId);
      }
    }

    settlePendingArchiveStateFromWorktreeNodes(
      pendingArchiveStateBySessionId,
      item.childWorktrees ?? []
    );
  }
}

function upsertSessionIntoGroups(
  groups: WorkspaceSessionGroup[],
  session: SessionSummaryDto,
  sessionDisplaySortMode: SessionDisplaySortMode
): WorkspaceSessionGroup[] {
  let changed = false;

  const nextGroups = groups.map((group) => {
    if (group.workspace.id !== session.workspaceId) {
      const { nodes, changed: childChanged } = upsertSessionIntoWorktreeNodes(
        group.childWorktrees,
        session,
        sessionDisplaySortMode
      );

      if (!childChanged) {
        return group;
      }

      changed = true;

      return {
        ...group,
        childWorktrees: nodes
      };
    }

    const existingIndex = group.sessions.findIndex((item) => item.sessionId === session.sessionId);
    const nextSessions =
      existingIndex >= 0
        ? group.sessions.map((item, index) => (index === existingIndex ? session : item))
        : [session, ...group.sessions];

    changed = true;

    return {
      ...group,
      sessions: sortSessionSummaryList(nextSessions, sessionDisplaySortMode)
    };
  });

  return changed ? nextGroups : groups;
}

function markSessionSeenInGroups(
  groups: WorkspaceSessionGroup[],
  sessionId: string,
  seenAt: string
): WorkspaceSessionGroup[] {
  let changed = false;

  const nextGroups = groups.map((group) => {
    let groupChanged = false;
    const nextSessions = group.sessions.map((session) => {
      if (session.sessionId !== sessionId) {
        return session;
      }

      changed = true;
      groupChanged = true;
      return {
        ...session,
        lastSeenAt:
          session.lastSeenAt && session.lastSeenAt > seenAt
            ? session.lastSeenAt
            : seenAt,
        activityState:
          session.activityState === "completed_unread" ? "idle" : session.activityState
      };
    });
    const worktreeResult = mapWorktreeNodes(group.childWorktrees, (session) => {
      if (session.sessionId !== sessionId) {
        return session;
      }

      changed = true;
      groupChanged = true;
      return {
        ...session,
        lastSeenAt:
          session.lastSeenAt && session.lastSeenAt > seenAt
            ? session.lastSeenAt
            : seenAt,
        activityState:
          session.activityState === "completed_unread" ? "idle" : session.activityState
      };
    });

    return groupChanged
      ? {
          ...group,
          sessions: nextSessions,
          childWorktrees: worktreeResult
        }
      : group;
  });

  return changed ? nextGroups : groups;
}

function updateSessionArchivedStateInGroups(
  groups: WorkspaceSessionGroup[],
  sessionId: string,
  isArchived: boolean
): WorkspaceSessionGroup[] {
  let changed = false;

  const nextGroups = groups.map((group) => {
    let groupChanged = false;
    const nextSessions = group.sessions.map((session) => {
      if (session.sessionId !== sessionId) {
        return session;
      }

      if (session.isArchived === isArchived) {
        return session;
      }

      changed = true;
      groupChanged = true;
      return {
        ...session,
        isArchived
      };
    });
    const worktreeResult = mapWorktreeNodes(group.childWorktrees, (session) => {
      if (session.sessionId !== sessionId) {
        return session;
      }

      if (session.isArchived === isArchived) {
        return session;
      }

      changed = true;
      groupChanged = true;
      return {
        ...session,
        isArchived
      };
    });

    return groupChanged
      ? {
          ...group,
          sessions: nextSessions,
          childWorktrees: worktreeResult
        }
      : group;
  });

  return changed ? nextGroups : groups;
}

function updateSessionFavoriteStateInGroups(
  groups: WorkspaceSessionGroup[],
  sessionId: string,
  isFavorite: boolean
): WorkspaceSessionGroup[] {
  let changed = false;

  const nextGroups = groups.map((group) => {
    let groupChanged = false;
    const nextSessions = group.sessions.map((session) => {
      if (session.sessionId !== sessionId) {
        return session;
      }

      if ((session.isFavorite === true) === isFavorite) {
        return session;
      }

      changed = true;
      groupChanged = true;
      return {
        ...session,
        isFavorite
      };
    });
    const worktreeResult = mapWorktreeNodes(group.childWorktrees, (session) => {
      if (session.sessionId !== sessionId) {
        return session;
      }

      if ((session.isFavorite === true) === isFavorite) {
        return session;
      }

      changed = true;
      groupChanged = true;
      return {
        ...session,
        isFavorite
      };
    });

    return groupChanged
      ? {
          ...group,
          sessions: nextSessions,
          childWorktrees: worktreeResult
        }
      : group;
  });

  return changed ? nextGroups : groups;
}

function toggleStoredId(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

function shortenCommit(commit: string | null | undefined) {
  return commit ? commit.slice(0, 8) : "--";
}

function setStoredIdPresence(items: string[], id: string, present: boolean) {
  if (present) {
    return items.includes(id) ? items : [...items, id];
  }

  return items.includes(id) ? items.filter((item) => item !== id) : items;
}

function retainKnownIds(items: string[], knownIds: ReadonlySet<string>) {
  const nextItems = items.filter((item) => knownIds.has(item));
  return nextItems.length === items.length ? items : nextItems;
}

function mapWorkbenchWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[] | null | undefined,
  sessionDisplaySortMode: SessionDisplaySortMode
): WorkbenchWorktreeNodeDto[] {
  return sortWorkbenchWorktreeNodes(nodes, sessionDisplaySortMode);
}

function applyPendingArchiveStateToWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[],
  pendingArchiveStateBySessionId: ReadonlyMap<string, boolean>,
  markChanged: (changed: boolean) => void
): WorkbenchWorktreeNodeDto[] {
  return nodes.map((node) => {
    let nodeChanged = false;
    const nextSessions = node.sessions.map((session) => {
      const pendingArchivedState = pendingArchiveStateBySessionId.get(session.sessionId);

      if (pendingArchivedState === undefined || isArchivedSession(session) === pendingArchivedState) {
        return session;
      }

      nodeChanged = true;
      return {
        ...session,
        isArchived: pendingArchivedState
      };
    });
    const nextChildren = applyPendingArchiveStateToWorktreeNodes(
      node.children,
      pendingArchiveStateBySessionId,
      (changed) => {
        if (changed) {
          nodeChanged = true;
        }
      }
    );

    markChanged(nodeChanged);

    return nodeChanged
      ? {
          ...node,
          sessions: nextSessions,
          children: nextChildren
        }
      : node;
  });
}

function settlePendingArchiveStateFromWorktreeNodes(
  pendingArchiveStateBySessionId: Map<string, boolean>,
  nodes: readonly WorkbenchWorktreeNodeDto[]
) {
  for (const node of nodes) {
    for (const session of node.sessions) {
      const pendingArchivedState = pendingArchiveStateBySessionId.get(session.sessionId);

      if (pendingArchivedState !== undefined && isArchivedSession(session) === pendingArchivedState) {
        pendingArchiveStateBySessionId.delete(session.sessionId);
      }
    }

    settlePendingArchiveStateFromWorktreeNodes(pendingArchiveStateBySessionId, node.children);
  }
}

function upsertSessionIntoWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[],
  session: SessionSummaryDto,
  sessionDisplaySortMode: SessionDisplaySortMode
): { nodes: WorkbenchWorktreeNodeDto[]; changed: boolean } {
  let changed = false;

  const nextNodes = nodes.map((node) => {
    if (node.workspace.id === session.workspaceId) {
      const existingIndex = node.sessions.findIndex((item) => item.sessionId === session.sessionId);
      const nextSessions =
        existingIndex >= 0
          ? node.sessions.map((item, index) => (index === existingIndex ? session : item))
          : [session, ...node.sessions];

      changed = true;

      return {
        ...node,
        sessions: sortSessionSummaryList(nextSessions, sessionDisplaySortMode)
      };
    }

    const nextChildResult = upsertSessionIntoWorktreeNodes(
      node.children,
      session,
      sessionDisplaySortMode
    );

    if (!nextChildResult.changed) {
      return node;
    }

    changed = true;

    return {
      ...node,
      children: nextChildResult.nodes
    };
  });

  return {
    nodes: changed ? nextNodes : [...nodes],
    changed
  };
}

function sortWorkspaceSessionGroups(
  groups: readonly WorkspaceSessionGroup[],
  sessionDisplaySortMode: SessionDisplaySortMode
): WorkspaceSessionGroup[] {
  return groups.map((group) => ({
    ...group,
    sessions: sortSessionSummaryList(group.sessions, sessionDisplaySortMode),
    childWorktrees: sortWorkbenchWorktreeNodes(group.childWorktrees, sessionDisplaySortMode)
  }));
}

function mapWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[],
  updater: (session: SessionSummaryDto) => SessionSummaryDto
): WorkbenchWorktreeNodeDto[] {
  let changed = false;

  const nextNodes = nodes.map((node) => {
    let nodeChanged = false;
    const nextSessions = node.sessions.map((session) => {
      const nextSession = updater(session);

      if (nextSession !== session) {
        nodeChanged = true;
        changed = true;
      }

      return nextSession;
    });
    const nextChildren = mapWorktreeNodes(node.children, updater);

    if (nextChildren !== node.children) {
      nodeChanged = true;
      changed = true;
    }

    return nodeChanged
      ? {
          ...node,
          sessions: nextSessions,
          children: nextChildren
        }
      : node;
  });

  return changed ? nextNodes : [...nodes];
}

function buildWorkspaceManagementSummarySnapshotKey(workspaceId: string, targetHostId?: string | null) {
  return buildScopedSnapshotKey("workspace-management.summary", {
    workspaceId,
    targetHostId
  });
}

function buildGitSidebarSnapshotKey(workspaceId: string, targetHostId?: string | null) {
  return buildScopedSnapshotKey("git-sidebar.snapshot", {
    workspaceId,
    targetHostId
  });
}

function buildTerminalManagerSnapshotKey(workspaceId: string, targetHostId?: string | null) {
  return buildScopedSnapshotKey("terminal-manager.snapshot", {
    workspaceId,
    targetHostId
  });
}

function buildWorkbenchRealtimeScopeKey(workspaceId?: string | null, targetHostId?: string | null): string | null {
  const normalizedWorkspaceId = workspaceId?.trim() || null;

  if (!normalizedWorkspaceId) {
    return null;
  }

  return buildScopedSnapshotKey("workbench-realtime.scope", {
    workspaceId: normalizedWorkspaceId,
    targetHostId
  });
}

type WorkbenchRealtimeScopeBindingBase = {
  workspaceId: string;
  scopeKey: string | null;
  targetHostId?: string | null;
};

type WorkbenchRealtimeFileTreeBinding = WorkbenchRealtimeScopeBindingBase & {
  paths: string[];
  knownRevisionByPath?: Record<string, string | null | undefined>;
};

type WorkbenchRealtimeFileTreeRefreshBinding = WorkbenchRealtimeScopeBindingBase & {
  paths?: string[];
  knownRevisionByPath?: Record<string, string | null | undefined>;
};

type WorkbenchRealtimeKnownRevisionBinding = WorkbenchRealtimeScopeBindingBase & {
  knownRevision?: string | null | undefined;
}

function createWorkspaceManagementFallback(
  workspace: WorkspaceDto,
  existingDetail?: WorkspaceManagementSummaryDto | null
): WorkspaceManagementSummaryDto {
  const repoRoot = existingDetail?.git.repoRoot ?? workspace.repoRoot ?? null;

  return {
    workspaceId: workspace.id,
    name: workspace.name,
    path: workspace.path,
    git: {
      isRepository: existingDetail?.git.isRepository ?? Boolean(repoRoot),
      repoRoot,
      currentBranch: existingDetail?.git.currentBranch ?? null,
      commitCount: existingDetail?.git.commitCount ?? null,
      remotes: existingDetail?.git.remotes ?? [],
      error: existingDetail?.git.error ?? null
    },
    codeComposition: existingDetail?.codeComposition ?? {
      scannedFileCount: 0,
      truncated: false,
      items: [],
      error: null
    }
  };
}

function mergeWorkspaceManagementDetailWithWorkspace(
  detail: WorkspaceManagementSummaryDto,
  workspace: WorkspaceDto
): WorkspaceManagementSummaryDto {
  const repoRoot = detail.git.repoRoot ?? workspace.repoRoot ?? null;

  return {
    ...detail,
    workspaceId: workspace.id,
    name: workspace.name,
    path: workspace.path,
    git: {
      ...detail.git,
      isRepository: detail.git.isRepository || Boolean(repoRoot),
      repoRoot
    }
  };
}

function mergeWorkspaceManagementDetailWithGitSnapshot(
  detail: WorkspaceManagementSummaryDto,
  snapshot: GitRealtimeSnapshotDto
): WorkspaceManagementSummaryDto {
  const repositoryEnabled = snapshot.status?.snapshot.enabled !== false;
  const repoRoot = repositoryEnabled
    ? snapshot.status?.snapshot.repoRoot ?? detail.git.repoRoot
    : detail.git.repoRoot;
  const currentBranch =
    repositoryEnabled
      ? snapshot.status?.snapshot.branch ?? snapshot.branches?.currentBranch ?? detail.git.currentBranch ?? null
      : detail.git.currentBranch ?? null;

  return {
    ...detail,
    git: {
      ...detail.git,
      isRepository: repositoryEnabled && (detail.git.isRepository || Boolean(repoRoot)),
      repoRoot,
      currentBranch,
      error: null
    }
  };
}

function SkeletonLines({
  count,
  className = "workbench-skeleton-lines"
}: {
  count: number;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skeleton-line" />
      ))}
    </div>
  );
}

function SidebarNavigationSkeleton() {
  return (
    <div className="workbench-nav-loading" aria-hidden="true">
      {Array.from({ length: 3 }, (_, sectionIndex) => (
        <section key={sectionIndex} className="workbench-skeleton-card">
          <div className="workbench-skeleton-heading">
            <span className="skeleton-line short" />
            <span className="skeleton-line tiny" />
          </div>
          <div className="workbench-skeleton-list">
            {Array.from({ length: 3 }, (_, itemIndex) => (
              <div key={itemIndex} className="workbench-skeleton-session">
                <span className="workbench-skeleton-dot" />
                <SkeletonLines count={2} className="workbench-skeleton-lines compact" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function InfoPanelSkeleton() {
  return (
    <section className="workbench-info-skeleton" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <article key={index} className="workbench-info-skeleton-card">
          <span className="skeleton-line short" />
          <SkeletonLines count={3} />
        </article>
      ))}
    </section>
  );
}

function SidebarPanelIcon({
  side,
  collapsed
}: {
  side: "left" | "right";
  collapsed: boolean;
}) {
  const dividerX = side === "left" ? 8.5 : 15.5;
  const chevronPoints =
    side === "left"
      ? collapsed
        ? "12 9 15 12 12 15"
        : "15 9 12 12 15 15"
      : collapsed
        ? "12 9 9 12 12 15"
        : "9 9 12 12 9 15";

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1={dividerX} y1="4" x2={dividerX} y2="20" />
      <polyline points={chevronPoints} />
    </svg>
  );
}

function SidebarDockButton({
  ariaLabel,
  side,
  collapsed,
  className = "panel-icon-button",
  onClick
}: {
  ariaLabel: string;
  side: "left" | "right";
  collapsed: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={className}
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
    >
      <SidebarPanelIcon side={side} collapsed={collapsed} />
    </button>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={expanded ? "workbench-chevron" : "workbench-chevron collapsed"}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function WorkspaceManageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="12" y2="14" />
      <circle cx="17.5" cy="15.5" r="2.5" />
    </svg>
  );
}

function NotificationBellIcon() {
  return (
    <svg className="workbench-toolbar-icon workbench-toolbar-icon-notification" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M7.5 10.2a4.5 4.5 0 1 1 9 0v3.1c0 .8.3 1.6.9 2.2l.8.8H5.8l.8-.8c.6-.6.9-1.4.9-2.2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 18.5a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

function WorkbenchNotificationButton(props: {
  unreadCount: number;
  open: boolean;
  onToggle: () => void;
  collapsed?: boolean;
}) {
  return (
    <div className="workbench-notification-anchor">
      <button
        type="button"
        className={
          props.collapsed
            ? "workbench-nav-toolbar-button workbench-collapsed-button"
            : "workbench-nav-toolbar-button"
        }
        aria-label={t("shell.globalNotificationsAction")}
        title={t("shell.globalNotificationsAction")}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <NotificationBellIcon />
        {props.unreadCount > 0 ? (
          <span className="workbench-notification-badge" aria-label={t("shell.globalNotificationsUnreadAria", {
            count: String(props.unreadCount)
          })}>
            {props.unreadCount > 99 ? "99+" : props.unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function WorkbenchNotificationModal(props: {
  open: boolean;
  notifications: WorkbenchGlobalNotification[];
  archivedNotificationIds: ReadonlySet<string>;
  showArchivedNotifications: boolean;
  onClose: () => void;
  onToggleShowArchivedNotifications: (checked: boolean) => void;
  onArchiveNotification: (notificationId: string) => void;
  onUnarchiveNotification: (notificationId: string) => void;
  onSelectNotification: (notification: WorkbenchGlobalNotification) => void;
  preferredWorkspaceId?: string | null;
  preferredSessionId?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<"notifications" | "inbox">("notifications");

  useEffect(() => {
    if (props.open) {
      setActiveTab("notifications");
    }
  }, [props.open]);

  const visibleNotifications = useMemo(
    () =>
      props.notifications.filter(
        (notification) =>
          props.showArchivedNotifications || !props.archivedNotificationIds.has(notification.id)
      ),
    [props.archivedNotificationIds, props.notifications, props.showArchivedNotifications]
  );

  return (
    <SidebarModal
      open={props.open}
      title={t("shell.globalNotificationsPanelTitle")}
      description={t("shell.globalNotificationsPanelDescription")}
      className="workbench-notification-modal-card workspace-inbox-modal-card"
      showCloseButton={false}
      onClose={props.onClose}
    >
      <div className="workbench-notification-tabs" role="tablist" aria-label={t("shell.globalNotificationsPanelTitle")}>
        <button
          type="button"
          className={activeTab === "notifications" ? "workbench-notification-tab active" : "workbench-notification-tab"}
          role="tab"
          aria-selected={activeTab === "notifications"}
          onClick={() => setActiveTab("notifications")}
        >
          {t("shell.globalNotificationsAction")}
        </button>
        <button
          type="button"
          className={activeTab === "inbox" ? "workbench-notification-tab active" : "workbench-notification-tab"}
          role="tab"
          aria-selected={activeTab === "inbox"}
          onClick={() => setActiveTab("inbox")}
        >
          {t("shell.butlerInboxAction")}
        </button>
      </div>

      <div className="workbench-notification-content" data-tab={activeTab}>
        {activeTab === "notifications" ? (
          <div className="workbench-notification-pane" role="tabpanel" aria-label={t("shell.globalNotificationsAction")}>
            <div className="workbench-notification-toolbar">
              <label className="workbench-notification-filter">
                <input
                  type="checkbox"
                  checked={props.showArchivedNotifications}
                  onChange={(event) => props.onToggleShowArchivedNotifications(event.target.checked)}
                />
                <span>{t("shell.globalNotificationsShowArchived")}</span>
              </label>
            </div>
            {visibleNotifications.length > 0 ? (
              <div className="workbench-notification-list">
                {visibleNotifications.map((notification) => {
                  const archived = props.archivedNotificationIds.has(notification.id);

                  return (
                    <article
                      key={notification.id}
                      className="workbench-notification-item"
                      data-archived={archived}
                    >
                      <button
                        type="button"
                        className="workbench-notification-item-content"
                        onClick={() => {
                          props.onSelectNotification(notification);
                        }}
                      >
                        <span className="workbench-notification-item-kind">
                          {resolveWorkbenchNotificationKindLabel(notification.kind)}
                        </span>
                        <strong>{notification.title}</strong>
                        <p>{notification.body}</p>
                      </button>
                      <div className="workbench-notification-item-side">
                        <time>{formatWorkbenchNotificationTime(notification.createdAt)}</time>
                        <button
                          type="button"
                          className="secondary-button workbench-notification-item-action-button"
                          onClick={() => {
                            if (archived) {
                              props.onUnarchiveNotification(notification.id);
                              return;
                            }

                            props.onArchiveNotification(notification.id);
                          }}
                        >
                          {archived
                            ? t("shell.globalNotificationsRemoveArchiveAction")
                            : t("shell.globalNotificationsArchiveAction")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="workbench-notification-empty">{t("shell.globalNotificationsEmpty")}</p>
            )}
          </div>
        ) : (
          <div className="workbench-notification-pane" role="tabpanel" aria-label={t("shell.butlerInboxAction")}>
            <WorkspaceInboxPanel
              active={props.open && activeTab === "inbox"}
              preferredWorkspaceId={props.preferredWorkspaceId}
              preferredSessionId={props.preferredSessionId}
            />
          </div>
        )}
      </div>

      <div className="workbench-modal-actions workbench-notification-footer-actions">
        <button type="button" className="secondary-button" onClick={props.onClose}>
          {t("common.close")}
        </button>
      </div>
    </SidebarModal>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="10.5" cy="10.5" r="5.75" />
      <path d="m15 15 4 4" strokeLinecap="round" />
    </svg>
  );
}


function ConversationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M7 6.5h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H11l-4.5 3v-3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ButlerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <circle cx="9" cy="11" r="1" />
      <circle cx="15" cy="11" r="1" />
      <path d="M8 15h8" />
      <path d="M12 5V3" />
    </svg>
  );
}

function SidebarCollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <polyline points="14 9 11 12 14 15" />
    </svg>
  );
}

function CloneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M6 9v6a3 3 0 0 0 3 3h3" />
      <line x1="18" y1="9" x2="18" y2="15" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="workbench-toolbar-icon workbench-toolbar-icon-settings" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.1a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.25 1 1.51h.09a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.49z" />
    </svg>
  );
}

function MultiSelectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="6" height="6" rx="1.5" />
      <rect x="14" y="5" width="6" height="6" rx="1.5" />
      <rect x="4" y="13" width="6" height="6" rx="1.5" />
      <path d="M14 16l2 2 4-4" />
    </svg>
  );
}

function WorkspaceSwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="6" width="10" height="12" rx="2" />
      <path d="M10 12h8" />
      <path d="M15 8l4 4-4 4" />
    </svg>
  );
}

function SelectionMarkerIcon({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="M8 12.5l2.8 2.8L16.5 9.5" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="4" />
    </svg>
  );
}

function StarIcon({ active, className }: { active: boolean; className?: string }) {
  if (active) {
    return (
      <svg
        className={className}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <polygon points="12 3 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9" />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <polygon points="12 3 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7h18" />
      <path d="M5 7l1 12h12l1-12" />
      <path d="M9 11h6" />
      <path d="M8 4h8l1 3H7l1-3z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function ExportMenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4v10" />
      <path d="M8.5 7.5L12 4l3.5 3.5" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function FolderArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M9 13h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9.4a2.5 2.5 0 1 1 4.1 2c-.8.7-1.8 1.2-1.8 2.6" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CodeShortcutTerminalIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.75" y="4" width="18.5" height="16" rx="4.25" />
      <path d="M7 8.5h2.5" opacity="0.78" />
      <path d="m8 11.5 3.4 3-3.4 3" />
      <path d="M13.75 17H17.5" />
    </svg>
  );
}

function CodeShortcutSkillIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.75 14 9.5l6.75 2.5L14 14.5l-2.5 6.75L9 14.5 2.25 12 9 9.5l2.5-6.75Z" />
      <path d="m18.5 15.5.95 2.55 2.55.95-2.55.95-1 2.55-.95-2.55-2.55-.95 2.55-.95.95-2.55Z" strokeWidth="1.7" />
    </svg>
  );
}

function SearchResultTypeBadge({
  label,
  kind
}: {
  label: string;
  kind: "session" | "code" | "document" | "tag" | "todo";
}) {
  return (
    <span className="workbench-search-result-type" data-kind={kind}>
      {label}
    </span>
  );
}

function SearchResultRow({
  title,
  titleAttribute,
  meta,
  snippet,
  keyword,
  keyPrefix,
  typeLabel,
  typeKind,
  onOpen,
  locateLabel,
  locateTitle,
  onLocate
}: {
  title: string;
  titleAttribute?: string;
  meta: string;
  snippet?: string | null;
  keyword: string;
  keyPrefix: string;
  typeLabel: string;
  typeKind: "session" | "code" | "document" | "tag" | "todo";
  onOpen: () => void;
  locateLabel?: string;
  locateTitle?: string;
  onLocate?: () => void;
}) {
  return (
    <div className="workbench-search-result-item">
      <button
        type="button"
        className="workbench-search-result-main"
        onClick={onOpen}
      >
        <span className="workbench-search-result-title" title={titleAttribute}>
          {renderHighlightedText(title, keyword, `${keyPrefix}:title`)}
        </span>
        <span className="workbench-search-result-meta">
          {renderHighlightedText(meta, keyword, `${keyPrefix}:meta`)}
        </span>
        {snippet ? (
          <span className="workbench-search-result-snippet">
            {renderHighlightedText(snippet, keyword, `${keyPrefix}:snippet`)}
          </span>
        ) : null}
      </button>
      <span className="workbench-search-result-side">
        <SearchResultTypeBadge label={typeLabel} kind={typeKind} />
        {onLocate ? (
          <button
            type="button"
            className="workbench-search-result-locate"
            aria-label={locateTitle ?? locateLabel}
            title={locateTitle ?? locateLabel}
            onClick={onLocate}
          >
            {locateLabel}
          </button>
        ) : null}
      </span>
    </div>
  );
}

function WorkspaceSearchModal({
  open,
  scope,
  keyword,
  affairsSortMode,
  sessionResults,
  codeResults,
  codeLoading,
  codeError,
  affairsResults,
  affairsLoading,
  affairsError,
  onClose,
  onKeywordChange,
  onAffairsSortModeChange,
  onClearSearch,
  onSubmitSearch,
  onOpenSession,
  onOpenCodeFile,
  onOpenAffairsDocument,
  onLocateAffairsDocument,
  onOpenAffairsTag,
  onOpenAffairsConversation,
  onOpenAffairsTodo
}: {
  open: boolean;
  scope: SearchScope | null;
  keyword: string;
  affairsSortMode: AffairsSearchSortMode;
  sessionResults: NavigationSessionEntry[];
  codeResults: CodeSearchResult[];
  codeLoading: boolean;
  codeError: string | null;
  affairsResults: AffairsSearchResults;
  affairsLoading: boolean;
  affairsError: string | null;
  onClose: () => void;
  onKeywordChange: (value: string) => void;
  onAffairsSortModeChange: (mode: AffairsSearchSortMode) => void;
  onClearSearch: () => void;
  onSubmitSearch: (scope: SearchScope) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenCodeFile: (item: CodeSearchResult) => void;
  onOpenAffairsDocument: (item: AffairsSearchDocumentResult) => void;
  onLocateAffairsDocument: (item: AffairsSearchDocumentResult) => void;
  onOpenAffairsTag: (item: AffairsSearchTagResult) => void;
  onOpenAffairsConversation: (item: AffairsSearchConversationResult) => void;
  onOpenAffairsTodo: (item: AffairsSearchTodoResult) => void;
}) {
  const showsCodeResults = scope === "code" || scope === "all";
  const showsAffairsResults = scope === "affairs" || scope === "all";
  const isSearching = scope === "all"
    ? codeLoading || affairsLoading
    : scope === "affairs"
      ? affairsLoading
      : codeLoading;
  const hasAffairsResults =
    affairsResults.documents.length > 0
    || affairsResults.tags.length > 0
    || affairsResults.conversations.length > 0
    || affairsResults.todos.length > 0;
  const hasCodeResults = sessionResults.length > 0 || codeResults.length > 0;
  const hasAnyResults = (showsCodeResults && hasCodeResults) || (showsAffairsResults && hasAffairsResults);
  const activeError = scope === "all"
    ? null
    : scope === "affairs"
      ? affairsError
      : codeError;
  const trimmedKeyword = keyword.trim();
  const canClearSearch = Boolean(trimmedKeyword || scope || hasAnyResults || codeError || affairsError || codeLoading || affairsLoading);

  return (
    <SidebarModal
      open={open}
      title={t("shell.searchModalTitle")}
      description={t("shell.searchModalDescription")}
      onClose={onClose}
    >
      <div className="workbench-search-modal">
        <label className="workbench-modal-field">
          <span>{t("shell.searchKeywordLabel")}</span>
          <input
            type="text"
            value={keyword}
            placeholder={t("shell.searchPlaceholder")}
            autoFocus
            onChange={(event) => onKeywordChange(event.target.value)}
          />
        </label>
        {trimmedKeyword ? (
          <div className="workbench-search-actions" role="group" aria-label={t("shell.searchActionLabel")}>
            <button
              type="button"
              className="workbench-secondary-button"
              onClick={() => onSubmitSearch("code")}
            >
              {t("shell.searchActionCode")}
            </button>
            <button
              type="button"
              className="workbench-secondary-button"
              onClick={() => onSubmitSearch("affairs")}
            >
              {t("shell.searchActionAffairs")}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => onSubmitSearch("all")}
            >
              {t("shell.searchActionAll")}
            </button>
            {canClearSearch ? (
              <button
                type="button"
                className="workbench-secondary-button"
                onClick={onClearSearch}
              >
                {t("shell.searchClearAction")}
              </button>
            ) : null}
          </div>
        ) : null}
        {!trimmedKeyword && canClearSearch ? (
          <div className="workbench-search-actions" role="group" aria-label={t("shell.searchActionLabel")}>
            <button
              type="button"
              className="workbench-secondary-button"
              onClick={onClearSearch}
            >
              {t("shell.searchClearAction")}
            </button>
          </div>
        ) : null}
        {showsAffairsResults ? (
          <label className="workbench-modal-field">
            <span>{t("shell.searchSortLabel")}</span>
            <select
              value={affairsSortMode}
              onChange={(event) => onAffairsSortModeChange(event.target.value as AffairsSearchSortMode)}
            >
              <option value="relevance">{t("shell.searchSortRelevance")}</option>
              <option value="updated_desc">{t("shell.searchSortUpdated")}</option>
              <option value="title_asc">{t("shell.searchSortTitle")}</option>
            </select>
          </label>
        ) : null}
        <div className="workbench-search-results">
          {activeError ? <p className="status-text" data-tone="error">{activeError}</p> : null}
          {scope === "all" && codeError ? <p className="status-text" data-tone="error">{codeError}</p> : null}
          {scope === "all" && affairsError ? <p className="status-text" data-tone="error">{affairsError}</p> : null}
          {!activeError && trimmedKeyword.length === 0 ? (
            <p className="workbench-search-empty">{t("shell.searchHint")}</p>
          ) : null}
          {!activeError && trimmedKeyword.length > 0 && !scope ? (
            <p className="workbench-search-empty">{t("shell.searchChooseActionHint")}</p>
          ) : null}
          {!activeError && trimmedKeyword.length > 0 && Boolean(scope) && isSearching ? (
            <p className="workbench-search-empty">{t("shell.searchLoading")}</p>
          ) : null}
          {!activeError && trimmedKeyword.length > 0 && Boolean(scope) && !isSearching && !hasAnyResults ? (
            <p className="workbench-search-empty">{t("shell.searchEmpty")}</p>
          ) : null}
          {showsCodeResults && sessionResults.length > 0 ? (
            <div className="workbench-search-result-group">
              <div className="workbench-search-result-group-title">{t("shell.searchSessionsGroup")}</div>
              {sessionResults.map((item) => {
                const titlePresentation = buildSessionTitlePresentation(item.session.title, t("common.unknown"));

                return (
                  <SearchResultRow
                    key={item.session.sessionId}
                    title={titlePresentation.displayTitle}
                    titleAttribute={titlePresentation.fullTitle}
                    meta={`${item.workspace.name} · ${formatProviderLabel(item.session.provider, "full")}`}
                    keyword={keyword}
                    keyPrefix={`session:${item.session.sessionId}`}
                    typeLabel={t("shell.searchResultTypeSession")}
                    typeKind="session"
                    onOpen={() => onOpenSession(item.session.sessionId)}
                  />
                );
              })}
            </div>
          ) : null}
          {showsCodeResults && codeResults.length > 0 ? (
            <div className="workbench-search-result-group">
              <div className="workbench-search-result-group-title">{t("shell.searchCodeGroup")}</div>
              {codeResults.map((item) => (
                <SearchResultRow
                  key={`${item.workspaceId}:${item.file.path}:${item.file.kind}`}
                  title={item.file.name}
                  meta={`${item.workspaceName} · ${item.file.path}`}
                  snippet={item.file.snippet}
                  keyword={keyword}
                  keyPrefix={`code:${item.workspaceId}:${item.file.path}`}
                  typeLabel={t("shell.searchResultTypeCode")}
                  typeKind="code"
                  onOpen={() => onOpenCodeFile(item)}
                />
              ))}
            </div>
          ) : null}
          {showsAffairsResults && affairsResults.documents.length > 0 ? (
            <div className="workbench-search-result-group">
              <div className="workbench-search-result-group-title">{t("shell.searchAffairsDocumentsGroup")}</div>
              {affairsResults.documents.map((item) => {
                const documentTitle = getAffairsDocumentDisplayName(item.record);
                const documentMeta = item.libraryLabel
                  ? `${item.libraryLabel} · ${item.record.path}`
                  : item.record.path;
                return (
                  <SearchResultRow
                    key={`${item.libraryRootDir || item.workspaceId}:${item.dedupePath}`}
                    title={documentTitle}
                    meta={documentMeta}
                    snippet={item.snippet}
                    keyword={keyword}
                    keyPrefix={`document:${item.workspaceId}:${item.dedupePath}`}
                    typeLabel={t("shell.searchResultTypeDocument")}
                    typeKind="document"
                    onOpen={() => onOpenAffairsDocument(item)}
                    locateLabel={t("shell.searchResultLocateDocument")}
                    locateTitle={t("shell.searchResultLocateDocumentTitle")}
                    onLocate={() => onLocateAffairsDocument(item)}
                  />
                );
              })}
            </div>
          ) : null}
          {showsAffairsResults && affairsResults.tags.length > 0 ? (
            <div className="workbench-search-result-group">
              <div className="workbench-search-result-group-title">{t("shell.searchAffairsTagsGroup")}</div>
              {affairsResults.tags.map((item) => (
                <SearchResultRow
                  key={`${item.libraryRootDir || item.workspaceId}:${item.tag.path}`}
                  title={item.tag.name}
                  meta={item.libraryLabel ? `${item.libraryLabel} · ${item.tag.path}` : item.tag.path}
                  keyword={keyword}
                  keyPrefix={`tag:${item.workspaceId}:${item.tag.path}`}
                  typeLabel={t("shell.searchResultTypeAffairsTag")}
                  typeKind="tag"
                  onOpen={() => onOpenAffairsTag(item)}
                />
              ))}
            </div>
          ) : null}
          {showsAffairsResults && affairsResults.conversations.length > 0 ? (
            <div className="workbench-search-result-group">
              <div className="workbench-search-result-group-title">{t("shell.searchAffairsConversationsGroup")}</div>
              {affairsResults.conversations.map((item) => {
                const titlePresentation = buildSessionTitlePresentation(item.session.title, t("common.unknown"));
                return (
                  <SearchResultRow
                    key={`${item.workspaceId}:${item.conversationKind}:${item.session.sessionId}`}
                    title={titlePresentation.displayTitle}
                    titleAttribute={titlePresentation.fullTitle}
                    meta={`${item.workspaceName} · ${item.conversationKind === "agent"
                      ? t("shell.affairsConversationKindAgent")
                      : t("shell.affairsConversationKindLightweight")}`}
                    keyword={keyword}
                    keyPrefix={`affairs-conversation:${item.workspaceId}:${item.session.sessionId}`}
                    typeLabel={t("shell.searchResultTypeSession")}
                    typeKind="session"
                    onOpen={() => onOpenAffairsConversation(item)}
                  />
                );
              })}
            </div>
          ) : null}
          {showsAffairsResults && affairsResults.todos.length > 0 ? (
            <div className="workbench-search-result-group">
              <div className="workbench-search-result-group-title">{t("shell.searchAffairsTodosGroup")}</div>
              {affairsResults.todos.map((item) => (
                <SearchResultRow
                  key={`${item.workspaceId}:${item.id}`}
                  title={item.title}
                  meta={`${item.workspaceName} · ${item.statusLabel}`}
                  snippet={item.summary ? buildMatchedSnippet(item.summary, keyword) ?? item.summary : null}
                  keyword={keyword}
                  keyPrefix={`todo:${item.workspaceId}:${item.id}`}
                  typeLabel={t("shell.searchResultTypeTodo")}
                  typeKind="todo"
                  onOpen={() => onOpenAffairsTodo(item)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </SidebarModal>
  );
}

type SessionExportFormat = "md" | "pdf" | "html";
const STANDALONE_SESSION_EXPORT_OVERRIDES = `
html,
body {
  width: 100% !important;
  height: auto !important;
  min-height: auto !important;
  overflow: visible !important;
  overflow-x: visible !important;
}

body {
  margin: 0 !important;
  padding: 0 !important;
}

.session-export-document-root {
  position: static !important;
  inset: auto !important;
  z-index: auto !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  overflow: visible !important;
}

.session-export-document-root,
.session-export-document-root * {
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  letter-spacing: normal !important;
  word-spacing: normal !important;
  text-align: left !important;
  -webkit-text-fill-color: currentColor !important;
  text-fill-color: currentColor !important;
  -webkit-background-clip: border-box !important;
  background-clip: border-box !important;
  text-shadow: none !important;
  mix-blend-mode: normal !important;
}

.session-export-document-root .markdown-content p,
.session-export-document-root .markdown-content blockquote,
.session-export-document-root .markdown-content td {
  display: block !important;
}

.session-export-document-root .markdown-content li {
  display: list-item !important;
}

.session-export-document-root .markdown-content code,
.session-export-document-root .markdown-content pre,
.session-export-document-root .code-block pre,
.session-export-document-root .tool-call-section pre,
.session-export-document-root .tool-call-input-preview,
.session-export-document-root .apply-patch-line-content,
.session-export-document-root .apply-patch-summary-file {
  font-family:
    var(--font-mono, "SF Mono", "Consolas", "Cascadia Code", "Courier New", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace) !important;
}

.session-export-document-root .thinking-message-label,
.session-export-document-root .thinking-status-text {
  background: none !important;
  color: var(--text-secondary, #475569) !important;
  -webkit-text-fill-color: currentColor !important;
  animation: none !important;
}

@media print {
  body * {
    visibility: hidden;
  }

  .session-export-document-root,
  .session-export-document-root * {
    visibility: visible;
  }

  .session-export-document-root {
    position: static !important;
  }

  .session-export-document-root .session-export-print-shell {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
  }

  .session-export-document-root .message-timeline-export,
  .session-export-document-root .message-timeline-export .message-list-export {
    overflow: visible;
    height: auto;
    max-height: none;
  }

  .session-export-document-root .tool-call-header,
  .session-export-document-root .tool-call-info,
  .session-export-document-root .task-tool-header,
  .session-export-document-root .task-tool-heading,
  .session-export-document-root .task-tool-heading-main,
  .session-export-document-root .task-tool-list-item,
  .session-export-document-root .assistant-capability-header,
  .session-export-document-root .assistant-capability-heading,
  .session-export-document-root .assistant-capability-heading-main,
  .session-export-document-root .assistant-capability-row,
  .session-export-document-root .apply-patch-summary-row,
  .session-export-document-root .rules-message-toggle {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: flex-start !important;
    justify-content: flex-start !important;
  }

  .session-export-document-root .task-tool-list-item,
  .session-export-document-root .assistant-capability-row,
  .session-export-document-root .apply-patch-summary-row {
    row-gap: 4px !important;
  }

  .session-export-document-root .tool-call-input-preview,
  .session-export-document-root .rules-message-summary,
  .session-export-document-root .task-tool-summary-text,
  .session-export-document-root .task-tool-item-title,
  .session-export-document-root .task-tool-item-detail,
  .session-export-document-root .task-tool-item-status,
  .session-export-document-root .assistant-capability-heading-main strong,
  .session-export-document-root .assistant-capability-summary,
  .session-export-document-root .assistant-capability-row-label,
  .session-export-document-root .assistant-capability-row-value,
  .session-export-document-root .apply-patch-summary-file,
  .session-export-document-root .apply-patch-summary-stats,
  .session-export-document-root .session-title,
  .session-export-document-root .message-text,
  .session-export-document-root .markdown-content,
  .session-export-document-root .thinking-message-text,
  .session-export-document-root .thinking-message-text :where(p, li, blockquote, strong, em, a, span),
  .session-export-document-root .thinking-message-label,
  .session-export-document-root .thinking-status-text {
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: clip !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
  }

  .session-export-document-root .assistant-capability-summary {
    display: inline !important;
  }

  .session-export-document-root .task-tool-list {
    list-style: decimal !important;
    padding-left: 24px !important;
  }

  .session-export-document-root .message-timeline-export .conversation-scroll-to-bottom-button,
  .session-export-document-root .message-timeline-export .message-metadata-bar,
  .session-export-document-root .message-timeline-export .retry-button,
  .session-export-document-root .message-timeline-export .code-copy-button,
  .session-export-document-root .message-timeline-export .rules-message-action,
  .session-export-document-root .message-timeline-export .message-origin-detail-popover {
    display: none !important;
  }

  .session-export-document-root .message-item,
  .session-export-document-root .tool-message-row,
  .session-export-document-root .rules-message-row {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

interface SessionExportLayoutSnapshot {
  shellWidthPx: number | null;
}

function SessionCard({
  menuKey,
  cardClassName,
  session,
  workspace,
  workspaceContext,
  isActive,
  isFavorite,
  menuOpen,
  menuAnchorPoint,
  showWorkspaceName,
  depth = 0,
  showActions = true,
  exportDisabled = false,
  hasSubagents = false,
  subagentListExpanded = false,
  showParallelBadge = true,
  hideMetaRow = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onToggleSubagents,
  onOpen,
  onRename,
  onOpenContextMenu,
  onExport,
  onToggleFavorite,
  onArchive,
  onDelete,
  onCloseMenu
}: {
  menuKey: string;
  cardClassName?: string;
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
  workspaceContext: WorkspaceVisualContext;
  isActive: boolean;
  isFavorite: boolean;
  menuOpen: boolean;
  menuAnchorPoint: ContextMenuAnchorPoint | null;
  showWorkspaceName: boolean;
  depth?: number;
  showActions?: boolean;
  exportDisabled?: boolean;
  hasSubagents?: boolean;
  subagentListExpanded?: boolean;
  showParallelBadge?: boolean;
  hideMetaRow?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onToggleSubagents?: () => void;
  onOpen: () => void;
  onRename: () => void;
  onOpenContextMenu?: (anchorPoint: ContextMenuAnchorPoint) => void;
  onExport: (format: SessionExportFormat) => void;
  onToggleFavorite: () => void;
  onArchive: () => void;
  onDelete?: () => void;
  onCloseMenu: () => void;
}) {
  const platform = usePlatform();
  const supportsSessionDelete = createDraftCapabilities(session.provider).supportsSessionDelete === true;
  const showWebExportMenu = !platform.isDesktop && !platform.isMobile;
  const subagentBadgeLabel = isSubagentSession(session)
    ? resolveSubagentDisplayLabel(session)
    : null;
  const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));
  const sessionActivityBadgeLabel = resolveSessionActivityBadgeLabel(session);
  const sessionActivityBadgeClassName =
    sessionActivityBadgeLabel
      ? resolveSessionActivityBadgeClassName("session-activity-badge", session)
      : null;
  const sessionForkBadgeTone = resolveSessionForkBadgeTone(session);
  const sessionForkBadgeLabel = resolveSessionForkBadgeLabel(session);
  const parallelGroupLabel =
    showParallelBadge && session.parallelGroup?.role === "anchor"
      ? resolveParallelGroupLabel(session.parallelGroup)
      : null;
  const parallelGroupStyle = createParallelGroupStyle(session.parallelGroup);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPositionStyle, setMenuPositionStyle] = useState<CSSProperties | null>(null);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) {
      setExportSubmenuOpen(false);
    }
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (platform.isDesktop || !menuOpen || !menuAnchorPoint || typeof window === "undefined") {
      setMenuPositionStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const nextPosition = resolveContextMenuPosition(
        menuAnchorPoint,
        {
          width: menuRef.current?.offsetWidth ?? 0,
          height: menuRef.current?.offsetHeight ?? 0
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        },
        {
          estimatedHeightPx: supportsSessionDelete && onDelete ? 216 : 168
        }
      );
      setMenuPositionStyle({
        position: "fixed",
        top: `${Math.round(nextPosition.top)}px`,
        left: `${Math.round(nextPosition.left)}px`,
        width: `${Math.round(nextPosition.width)}px`,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: `${Math.round(nextPosition.maxHeight)}px`,
        transformOrigin: nextPosition.transformOrigin
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuAnchorPoint, menuOpen, platform.isDesktop]);

  async function openDesktopSessionMenu() {
    await showDesktopContextMenu([
      {
        id: `rename:${session.sessionId}`,
        label: t("shell.renameAction"),
        onSelect: onRename
      },
      {
        id: `export:${session.sessionId}`,
        label: t("conversation.exportAction"),
        disabled: exportDisabled,
        items: [
          {
            id: `export-markdown:${session.sessionId}`,
            label: t("conversation.exportMarkdownAction"),
            onSelect: () => onExport("md")
          },
          {
            id: `export-pdf:${session.sessionId}`,
            label: t("conversation.exportPdfAction"),
            onSelect: () => onExport("pdf")
          },
          {
            id: `export-html:${session.sessionId}`,
            label: t("conversation.exportHtmlAction"),
            onSelect: () => onExport("html")
          }
        ]
      },
      {
        id: `favorite:${session.sessionId}`,
        label: isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction"),
        onSelect: onToggleFavorite
      },
      {
        id: `archive:${session.sessionId}`,
        label: t("shell.archiveAction"),
        onSelect: onArchive
      },
      ...(supportsSessionDelete && onDelete
        ? [
            {
              id: `delete:${session.sessionId}`,
              label: t("shell.deleteSessionAction"),
              onSelect: onDelete
            }
          ]
        : [])
    ]);
  }

  const sessionMenu =
    !platform.isDesktop && menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="workbench-session-menu"
            data-menu-key={menuKey}
            role="menu"
            aria-label={t("shell.sessionMoreAction")}
            onClick={(event) => event.stopPropagation()}
            style={
              menuPositionStyle ?? {
                position: "fixed",
                top: 0,
                left: 0,
                visibility: "hidden"
              }
            }
          >
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                onRename();
                onCloseMenu();
              }}
            >
              <PencilIcon />
              <span>{t("shell.renameAction")}</span>
            </button>
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                onToggleFavorite();
                onCloseMenu();
              }}
            >
              <StarIcon active={isFavorite} />
              <span>{isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction")}</span>
            </button>
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                onArchive();
                onCloseMenu();
              }}
            >
              <ArchiveIcon />
              <span>{t("shell.archiveAction")}</span>
            </button>
            {showWebExportMenu ? (
              <div className="workbench-session-submenu" data-open={exportSubmenuOpen}>
                <button
                  type="button"
                  className="workbench-session-menu-item"
                  aria-haspopup="menu"
                  aria-expanded={exportSubmenuOpen}
                  onClick={() => {
                    setExportSubmenuOpen((current) => !current);
                  }}
                >
                  <ExportMenuIcon />
                  <span>{t("conversation.exportAction")}</span>
                  <span className="workbench-session-submenu-caret" aria-hidden="true">
                    <ChevronIcon expanded={exportSubmenuOpen} />
                  </span>
                </button>
                {exportSubmenuOpen ? (
                  <div className="workbench-session-submenu-panel" role="menu" aria-label={t("conversation.exportAction")}>
                    <button
                      type="button"
                      className="workbench-session-menu-item"
                      role="menuitem"
                      disabled={exportDisabled}
                      onClick={() => {
                        onExport("md");
                        onCloseMenu();
                      }}
                    >
                      <span>{t("conversation.exportMarkdownAction")}</span>
                    </button>
                    <button
                      type="button"
                      className="workbench-session-menu-item"
                      role="menuitem"
                      disabled={exportDisabled}
                      onClick={() => {
                        onExport("pdf");
                        onCloseMenu();
                      }}
                    >
                      <span>{t("conversation.exportPdfAction")}</span>
                    </button>
                    <button
                      type="button"
                      className="workbench-session-menu-item"
                      role="menuitem"
                      disabled={exportDisabled}
                      onClick={() => {
                        onExport("html");
                        onCloseMenu();
                      }}
                    >
                      <span>{t("conversation.exportHtmlAction")}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {supportsSessionDelete && onDelete ? (
              <button
                type="button"
                className="workbench-session-menu-item"
                onClick={() => {
                  onDelete();
                  onCloseMenu();
                }}
              >
                <TrashIcon />
                <span>{t("shell.deleteSessionAction")}</span>
              </button>
            ) : null}
          </div>,
          document.body
        )
      : null;

  return (
    <article
      className={["workbench-session-card", cardClassName].filter(Boolean).join(" ")}
      data-active={isActive}
      data-depth={depth}
      data-subagent={isSubagentSession(session)}
      data-workspace-tone={workspaceContext.tone}
      data-worktree-depth={workspaceContext.depth}
      data-has-subagents={hasSubagents}
      data-selecting={selectionMode}
      data-selected={selected}
      data-parallel-group={session.parallelGroup ? "true" : undefined}
      data-parallel-role={session.parallelGroup?.role ?? undefined}
      data-parallel-color-token={session.parallelGroup?.colorToken ?? undefined}
      style={{
        ...(createWorkspaceToneStyle(workspaceContext) ?? {}),
        ...(parallelGroupStyle ?? {})
      }}
      onContextMenu={(event) => {
        if (selectionMode || !showActions || !onOpenContextMenu) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (platform.isDesktop) {
          void openDesktopSessionMenu();
          return;
        }

        onOpenContextMenu({
          x: event.clientX,
          y: event.clientY
        });
      }}
    >
      <div className="workbench-session-main">
        {selectionMode ? (
          <span className="workbench-session-selection-indicator" data-selected={selected} aria-hidden="true">
            <SelectionMarkerIcon selected={selected} />
          </span>
        ) : hasSubagents ? (
          <button
            type="button"
            className="workbench-session-subagent-toggle"
            style={subagentToggleLayerStyle}
            data-indicator-variant={sessionStateVariantName(session, {
              hasSubagents: true,
              isActive
            })}
            aria-label={subagentListExpanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
            title={subagentListExpanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
            aria-expanded={subagentListExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSubagents?.();
            }}
          >
            <span
              className={sessionStateClassName(session, {
                hasSubagents: true,
                isActive
              })}
              data-activity-source={session.activitySource}
              aria-hidden="true"
            />
            <span className="workbench-session-subagent-toggle-icon" aria-hidden="true">
              <ChevronIcon expanded={subagentListExpanded} />
            </span>
          </button>
        ) : (
          <span
            className={sessionStateClassName(session, { isActive })}
            data-activity-source={session.activitySource}
            aria-hidden="true"
          />
        )}

        <button
          type="button"
          className="workbench-session-link"
          style={hasSubagents ? sessionLinkLayerStyle : undefined}
          data-active={isActive}
          aria-pressed={selectionMode ? selected : undefined}
          onClick={selectionMode ? onToggleSelect : onOpen}
          onKeyDown={(event) => {
            if (
              selectionMode
              || !showActions
              || !onOpenContextMenu
              || (
                event.key !== "ContextMenu"
                && !(event.shiftKey && event.key === "F10")
              )
            ) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (platform.isDesktop) {
              void openDesktopSessionMenu();
              return;
            }

            const anchorRect = event.currentTarget.getBoundingClientRect();
            onOpenContextMenu({
              x: anchorRect.right,
              y: anchorRect.bottom
            });
          }}
        >
          <div className="workbench-session-link-copy">
            <div className="session-title-row">
              <span className="session-title" title={titlePresentation.fullTitle}>
                {titlePresentation.displayTitle}
              </span>
              {subagentBadgeLabel ? <span className="session-subagent-badge">{subagentBadgeLabel}</span> : null}
              {parallelGroupLabel ? <span className="session-parallel-badge">{parallelGroupLabel}</span> : null}
              {!parallelGroupLabel && sessionForkBadgeLabel && sessionForkBadgeTone ? (
                <span className={`session-fork-badge ${sessionForkBadgeTone}`}>
                  {sessionForkBadgeLabel}
                </span>
              ) : null}
            </div>
            {!hideMetaRow ? (
              <div className="session-meta-row">
                <span className="session-meta">
                  {buildSessionMeta(
                    session,
                    workspace,
                    showWorkspaceName,
                    workspaceContext.displayName
                  )}
                </span>
                {sessionActivityBadgeLabel && sessionActivityBadgeClassName ? (
                  <span className={sessionActivityBadgeClassName}>{sessionActivityBadgeLabel}</span>
                ) : null}
                <span className={`session-provider-badge ${session.provider}`}>{formatProviderLabel(session.provider)}</span>
              </div>
            ) : null}
          </div>
        </button>
      </div>

      {sessionMenu}
    </article>
  );
}

async function waitForSessionExportRender(root: HTMLElement | null, doc: Document = document): Promise<void> {
  await waitForSessionExportAnimationFrame();
  await waitForSessionExportAnimationFrame();
  await waitForSessionExportTimeout(420);
  await waitForSessionExportFonts(doc, 1800);

  if (!root) {
    return;
  }

  await waitForSessionExportImages(root, 1800);
}

async function printSessionExportHtmlDocument(html: string): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error(t("conversation.exportPrintFailed"));
  }

  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    let settled = false;
    let fallbackTimer: number | null = null;

    const cleanup = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
      }

      iframe.remove();
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    iframe.onload = () => {
      const printWindow = iframe.contentWindow;
      const printDocument = iframe.contentDocument;

      if (!printWindow || !printDocument) {
        settle(() => reject(new Error(t("conversation.exportPrintFailed"))));
        return;
      }

      void waitForSessionExportRender(printDocument.body, printDocument).then(() => {
        const finish = () => settle(resolve);

        try {
          printWindow.addEventListener("afterprint", finish, { once: true });
          fallbackTimer = window.setTimeout(finish, 2500);
          printWindow.focus();
          printWindow.print();
        } catch (error) {
          settle(() => reject(error instanceof Error ? error : new Error(t("conversation.exportPrintFailed"))));
        }
      });
    };

    iframe.onerror = () => {
      settle(() => reject(new Error(t("conversation.exportPrintFailed"))));
    };

    document.body.append(iframe);
    iframe.srcdoc = html;
  });
}

async function buildSessionExportPdfPrintDocument(input: {
  title: string;
  bodyHtml: string;
  styleText: string;
  shellWidthPx: number;
  shellHeightPx: number;
  htmlAttributes?: Record<string, string>;
  bodyAttributes?: Record<string, string>;
  htmlStyle?: string | null;
  bodyStyle?: string | null;
}): Promise<string> {
  const rasterCanvas = await rasterizeSessionExportMarkupToCanvas(input);
  const pageImages = sliceSessionExportCanvasPages(rasterCanvas, input.shellWidthPx, input.shellHeightPx);

  if (pageImages.length === 0) {
    throw new Error(t("conversation.exportPrintFailed"));
  }

  const bodyHtml = pageImages
    .map(
      (pageImage, index) => [
        `<section class="session-export-pdf-page"${index < pageImages.length - 1 ? ' data-page-break="true"' : ""}>`,
        `<img src="${pageImage}" alt="" />`,
        "</section>"
      ].join("")
    )
    .join("");

  return buildStandaloneSessionExportHtml({
    title: input.title,
    bodyHtml,
    styleText: `
html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  background: #ffffff;
}

body {
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
}

.session-export-pdf-page {
  width: 100%;
  margin: 0;
  padding: 0;
  break-after: page;
  page-break-after: always;
}

.session-export-pdf-page:last-child {
  break-after: auto;
  page-break-after: auto;
}

.session-export-pdf-page img {
  display: block;
  width: 100%;
  height: auto;
}

@page {
  size: auto;
  margin: 12mm;
}

@media print {
  html,
  body {
    background: #ffffff;
  }
}
`
  });
}

function collectSessionExportStyles(): string {
  if (typeof document === "undefined") {
    return "";
  }

  const styleChunks: string[] = [];

  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const rules = styleSheet.cssRules;

      if (!rules || rules.length === 0) {
        continue;
      }

      styleChunks.push(Array.from(rules).map((rule) => rule.cssText).join("\n"));
    } catch {
      continue;
    }
  }

  return styleChunks.join("\n");
}

function collectSessionExportAttributes(element: HTMLElement): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === "style") {
      continue;
    }

    attributes[attribute.name] = attribute.value;
  }

  return attributes;
}

async function rasterizeSessionExportMarkupToCanvas(input: {
  bodyHtml: string;
  styleText: string;
  shellWidthPx: number;
  shellHeightPx: number;
  htmlAttributes?: Record<string, string>;
  bodyAttributes?: Record<string, string>;
  htmlStyle?: string | null;
  bodyStyle?: string | null;
}): Promise<HTMLCanvasElement> {
  if (typeof document === "undefined") {
    throw new Error(t("conversation.exportPrintFailed"));
  }

  const svgMarkup = buildSessionExportSvgDocument(input);
  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadSessionExportRasterImage(objectUrl);
    const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(t("conversation.exportPrintFailed"));
    }

    canvas.width = Math.max(1, Math.ceil(input.shellWidthPx * scale));
    canvas.height = Math.max(1, Math.ceil(input.shellHeightPx * scale));

    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, input.shellWidthPx, input.shellHeightPx);
    context.drawImage(image, 0, 0, input.shellWidthPx, input.shellHeightPx);

    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function buildSessionExportSvgDocument(input: {
  bodyHtml: string;
  styleText: string;
  shellWidthPx: number;
  shellHeightPx: number;
  htmlAttributes?: Record<string, string>;
  bodyAttributes?: Record<string, string>;
  htmlStyle?: string | null;
  bodyStyle?: string | null;
}): string {
  const wrapperAttributes = serializeSessionExportSvgAttributes(
    {
      ...(input.htmlAttributes ?? {}),
      ...(input.bodyAttributes ?? {})
    },
    [
      `width:${input.shellWidthPx}px`,
      `min-height:${input.shellHeightPx}px`,
      "background:#ffffff",
      input.htmlStyle ?? "",
      input.bodyStyle ?? ""
    ].filter((value) => value.trim().length > 0).join("; ")
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${input.shellWidthPx}" height="${input.shellHeightPx}" viewBox="0 0 ${input.shellWidthPx} ${input.shellHeightPx}">`,
    `<foreignObject x="0" y="0" width="${input.shellWidthPx}" height="${input.shellHeightPx}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml"${wrapperAttributes}>`,
    `<style>${input.styleText}</style>`,
    `<div class="session-export-document-root">${input.bodyHtml}</div>`,
    "</div>",
    "</foreignObject>",
    "</svg>"
  ].join("");
}

function serializeSessionExportSvgAttributes(attributes?: Record<string, string>, style?: string | null): string {
  const entries = Object.entries(attributes ?? {}).filter(([, value]) => value.trim().length > 0);

  if (style?.trim()) {
    entries.push(["style", style.trim()]);
  }

  if (entries.length === 0) {
    return "";
  }

  return ` ${entries
    .map(([name, value]) => `${name}="${escapeSessionExportAttribute(value)}"`)
    .join(" ")}`;
}

function escapeSessionExportAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadSessionExportRasterImage(objectUrl: string): Promise<HTMLImageElement> {
  await new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve(undefined));
  });

  return await new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("conversation.exportPrintFailed")));
    image.src = objectUrl;
  });
}

function sliceSessionExportCanvasPages(
  canvas: HTMLCanvasElement,
  shellWidthPx: number,
  shellHeightPx: number
): string[] {
  if (typeof document === "undefined") {
    return [];
  }

  const scale = canvas.width / Math.max(1, shellWidthPx);
  const pageHeightPx = Math.max(1, Math.floor(shellWidthPx * (297 / 210)));
  const pages: string[] = [];

  for (let offsetTop = 0; offsetTop < shellHeightPx; offsetTop += pageHeightPx) {
    const currentPageHeightPx = Math.min(pageHeightPx, shellHeightPx - offsetTop);
    const pageCanvas = document.createElement("canvas");
    const pageContext = pageCanvas.getContext("2d");

    if (!pageContext) {
      continue;
    }

    pageCanvas.width = Math.max(1, Math.ceil(shellWidthPx * scale));
    pageCanvas.height = Math.max(1, Math.ceil(currentPageHeightPx * scale));

    pageContext.fillStyle = "#ffffff";
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageContext.drawImage(
      canvas,
      0,
      Math.floor(offsetTop * scale),
      pageCanvas.width,
      pageCanvas.height,
      0,
      0,
      pageCanvas.width,
      pageCanvas.height
    );
    pages.push(pageCanvas.toDataURL("image/png"));
  }

  return pages;
}

function waitForSessionExportAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function waitForSessionExportTimeout(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

async function waitForSessionExportFonts(doc: Document, timeoutMs: number): Promise<void> {
  const fontFaceSet = doc.fonts;

  if (!fontFaceSet || typeof fontFaceSet.ready === "undefined") {
    return;
  }

  await Promise.race([
    fontFaceSet.ready.catch(() => undefined),
    waitForSessionExportTimeout(timeoutMs)
  ]);
}

async function waitForSessionExportImages(root: HTMLElement, timeoutMs: number): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));

  if (images.length === 0) {
    return;
  }

  await Promise.race([
    Promise.all(images.map((image) => waitForSessionExportImage(image))),
    waitForSessionExportTimeout(timeoutMs)
  ]);
}


function normalizeHostAlias(value: string | null | undefined, fallback: string): string {
  return normalizeHostAliasLabel(value || fallback);
}

function createHostAliasFallback(host: Pick<HostProfile, "name" | "baseUrl"> | null | undefined): string {
  const rawName = host?.name?.trim();

  if (rawName) {
    return rawName;
  }

  try {
    return new URL(host?.baseUrl ?? "").hostname || "HOST";
  } catch {
    return host?.baseUrl?.trim() || "HOST";
  }
}

function getHostAlias(host: Pick<HostProfile, "alias" | "name" | "baseUrl"> | null | undefined): string {
  return normalizeHostAlias(host?.alias ?? null, createHostAliasFallback(host));
}

function applyRemoteWorkspaceHostBindings(
  localAssignments: Record<string, WorkspaceHostAssignment>,
  activeHostId: string,
  bindings: readonly {
    workspaceKey: string;
    selectedHostId: string;
    remoteWorkspaceId?: string | null;
    remoteWorkspacePath?: string | null;
    remoteWorkspaceName?: string | null;
  }[]
): Record<string, WorkspaceHostAssignment> {
  const next = { ...localAssignments };

  for (const binding of bindings) {
    const key = `${activeHostId}::${binding.workspaceKey}`;
    if (binding.selectedHostId === "current") {
      delete next[key];
    } else {
      next[key] = {
        selectedHostId: binding.selectedHostId,
        remoteWorkspaceId: binding.remoteWorkspaceId ?? null,
        remoteWorkspacePath: binding.remoteWorkspacePath ?? null,
        remoteWorkspaceName: binding.remoteWorkspaceName ?? null
      };
    }
  }

  return next;
}

function makeWorkspaceRef(workspaceId: string, hostId: string): WorkspaceRef {
  return {
    hostId: hostId === "current" ? "current" : hostId,
    workspaceId
  };
}

function resolveWorkspaceHostAssignment(
  assignments: Record<string, WorkspaceHostAssignment>,
  activeHostId: string,
  workspace: Pick<WorkspaceDto, "id"> & Partial<Pick<WorkspaceDto, "path">>
): WorkspaceHostAssignment | null {
  return assignments[`${activeHostId}::${buildWorkspaceHostAssignmentKey(workspace.id, workspace.path)}`] ?? null;
}

function WorkspaceHostBadge({
  host,
  hostId,
  className = ""
}: {
  host: Pick<HostProfile, "id" | "alias" | "name" | "baseUrl" | "tagColor"> | null | undefined;
  hostId: string;
  className?: string;
}) {
  const colorHostId = host?.id?.trim() || hostId;
  const aliasTag = resolveHostAliasTag(
    host ? { id: colorHostId, alias: host.alias, name: host.name, tagColor: host.tagColor } : null
  );
  const alias = aliasTag?.label ?? getHostAlias(host);
  const title = host?.name?.trim() || host?.baseUrl?.trim() || alias;
  const classNames = ["workspace-host-badge", className].filter(Boolean).join(" ");

  return (
    <span
      className={classNames}
      style={aliasTag ? { "--workspace-host-badge-color": aliasTag.color } as CSSProperties : undefined}
      title={title}
    >
      {alias}
    </span>
  );
}

function captureSessionExportLayoutSnapshot(): SessionExportLayoutSnapshot {
  if (typeof document === "undefined") {
    return { shellWidthPx: null };
  }

  const selectors = [
    ".conversation-timeline-shell",
    ".conversation-main",
    ".conversation-panel"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (!(element instanceof HTMLElement)) {
      continue;
    }

    const rect = element.getBoundingClientRect();

    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      continue;
    }

    return {
      shellWidthPx: Math.round(rect.width)
    };
  }

  return { shellWidthPx: null };
}

function measureSessionExportShell(root: HTMLElement | null): { width: number; height: number } | null {
  const shell = root?.querySelector(".session-export-print-shell");

  if (!(shell instanceof HTMLElement)) {
    return null;
  }

  const rect = shell.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(Math.max(rect.width, shell.scrollWidth)));
  const height = Math.max(1, Math.ceil(Math.max(rect.height, shell.scrollHeight)));

  return { width, height };
}

function waitForSessionExportImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finalize = () => {
      image.removeEventListener("load", finalize);
      image.removeEventListener("error", finalize);
      resolve();
    };

    image.addEventListener("load", finalize);
    image.addEventListener("error", finalize);
  });
}

function SidebarContent({
  navigationGroups,
  workspaceGroups,
  workspaceVisualContextMap,
  sessionDisplaySortMode,
  favoriteSessions,
  favoriteSessionIds,
  activeWorkspaceId,
  codeEmbeddedAffairsState,
  onCodeEmbeddedAffairsStateChange,
  affairsLibraryEnabled,
  lightweightChatSessionsByWorkspaceId,
  lightweightArchivedChatSessionsByWorkspaceId,
  activeLightweightChatId,
  isConversationActive,
  isButlerActive,
  isSearchOpen,
  navigationLoading,
  navigationError,
  activeSessionId,
  currentTargetHostId,
  onRefreshNavigation,
  onSessionUpdated,
  onNavigateConversation,
  onOpenTerminalDock,
  onNavigateButler,
  onOpenSearch,
  onOpenSettings,
  onOpenCodeEmbeddedAffairsSection,
  onOpenLightweightChat,
  onCreateLightweightChat,
  onSelectWorkspace,
  onToggleWorkspaceCollapse,
  onStartWorkspaceReorder,
  onPreviewWorkspaceReorder,
  onCommitWorkspaceReorder,
  allowWorkspaceReorder,
  subscribeGitSnapshot,
  requestGitRefresh,
  subscribeWorkspaceManagementSnapshot,
  requestWorkspaceManagementRefresh,
  onToggleFavoriteSession,
  onArchiveSession,
  onUnarchiveSession,
  onToggleLightweightChatFavorite,
  onArchiveLightweightChat,
  onUnarchiveLightweightChat,
  onRenameLightweightChat,
  onDeleteLightweightChat,
  workspaceManagementStateById,
  setWorkspaceManagementStateById,
  unreadNotificationCount,
  notificationPanelOpen,
  onToggleNotificationPanel,
  onClose,
  onToggleCollapse,
  codeShortcutRailSlot
}: {
  navigationGroups: WorkspaceSessionGroup[];
  workspaceGroups: WorkspaceSidebarGroup[];
  workspaceVisualContextMap: Record<string, WorkspaceVisualContext>;
  sessionDisplaySortMode: SessionDisplaySortMode;
  favoriteSessions: FavoriteSidebarEntry[];
  favoriteSessionIds: ReadonlySet<string>;
  activeWorkspaceId: string | null;
  codeEmbeddedAffairsState?: AffairsViewState | null;
  onCodeEmbeddedAffairsStateChange?: (nextState: AffairsViewState) => void;
  affairsLibraryEnabled: boolean;
  lightweightChatSessionsByWorkspaceId: Record<string, SessionSummaryDto[]>;
  lightweightArchivedChatSessionsByWorkspaceId: Record<string, SessionSummaryDto[]>;
  activeLightweightChatId: string | null;
  isConversationActive: boolean;
  isButlerActive: boolean;
  isSearchOpen: boolean;
  navigationLoading: boolean;
  navigationError: string | null;
  activeSessionId: string | null;
  currentTargetHostId?: string | null;
  onRefreshNavigation: () => Promise<void>;
  onSessionUpdated: (session: SessionSummaryDto) => void;
  onNavigateConversation: () => void;
  onOpenTerminalDock: (workspaceId?: string | null, workspaceRef?: WorkspaceRef | null) => void;
  onNavigateButler: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenCodeEmbeddedAffairsSection: (section: AffairsViewState["primarySection"]) => void;
  onOpenLightweightChat: (workspace: WorkspaceDto, session: SessionSummaryDto) => void;
  onCreateLightweightChat: (workspace: WorkspaceDto) => void;
  onSelectWorkspace: (workspaceId: string, workspaceRef?: WorkspaceRef | null) => void;
  onToggleWorkspaceCollapse: (workspaceId: string) => void;
  onStartWorkspaceReorder: () => void;
  onPreviewWorkspaceReorder: (
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    position: WorkspaceDropPosition
  ) => void;
  onCommitWorkspaceReorder: () => void;
  allowWorkspaceReorder: boolean;
  subscribeGitSnapshot: (workspaceId: string, options?: WorkbenchRealtimeKnownRevisionOptions) => void;
  requestGitRefresh: (workspaceId: string, options?: WorkbenchRealtimeKnownRevisionOptions) => void;
  subscribeWorkspaceManagementSnapshot: (workspaceId: string, options?: WorkbenchRealtimeKnownRevisionOptions) => void;
  requestWorkspaceManagementRefresh: (workspaceId: string, options?: WorkbenchRealtimeKnownRevisionOptions) => void;
  onToggleFavoriteSession: (sessionId: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onUnarchiveSession: (sessionId: string) => Promise<void>;
  onToggleLightweightChatFavorite: (workspace: WorkspaceDto, session: SessionSummaryDto) => Promise<void>;
  onArchiveLightweightChat: (workspace: WorkspaceDto, session: SessionSummaryDto) => Promise<void>;
  onUnarchiveLightweightChat: (workspace: WorkspaceDto, sessionId: string) => Promise<void>;
  onRenameLightweightChat: (workspace: WorkspaceDto, sessionId: string, title: string) => Promise<SessionSummaryDto>;
  onDeleteLightweightChat: (workspace: WorkspaceDto, session: SessionSummaryDto) => Promise<void>;
  workspaceManagementStateById: Record<string, WorkspaceManagementViewState>;
  setWorkspaceManagementStateById: Dispatch<SetStateAction<Record<string, WorkspaceManagementViewState>>>;
  unreadNotificationCount: number;
  notificationPanelOpen: boolean;
  onToggleNotificationPanel: () => void;
  onClose?: () => void;
  onToggleCollapse?: () => void;
  codeShortcutRailSlot?: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const platform = usePlatform();
  const macOsNativeTitlebarDragRegion = resolveMacOsNativeTitlebarDragRegion(platform);
  const { showToast } = useToast();
  const navigationBodyRef = useTransientScrollbarVisibility<HTMLDivElement>();
  const routeCodeEmbeddedAffairsSection = resolveCodeEmbeddedAffairsSectionFromPath(location.pathname);
  const routeWorkspaceRef = useMemo(
    () => readWorkspaceRefFromLocation(location),
    [location.pathname, location.search]
  );
  const runtimeConfig = useClientConfigSelector((state) => state);
  const activeHost = getActiveHost(runtimeConfig);
  const activeHostId = runtimeConfig.activeHostId ?? activeHost?.id ?? "current";
  const selectableWorkspaceHosts = useMemo(() => {
    const activeEntry = activeHost
      ? [{ id: "current", host: activeHost }]
      : [];
    const peerEntries = runtimeConfig.hosts
      .filter((host) => host.id !== activeHostId && host.peerEnabled === true && Boolean(host.peerHostId?.trim()))
      .map((host) => ({ id: host.id, host }));

    return [...activeEntry, ...peerEntries];
  }, [activeHost, activeHostId, runtimeConfig.hosts]);
  const selectableWorkspaceHostById = useMemo(() => {
    const entries = new Map<string, HostProfile>();

    for (const item of selectableWorkspaceHosts) {
      entries.set(item.id, item.host);
    }

    return entries;
  }, [selectableWorkspaceHosts]);
  const [workspaceHostAssignments, setWorkspaceHostAssignments] = useState<Record<string, WorkspaceHostAssignment>>(() =>
    readWorkspaceHostAssignments()
  );
  const [remoteWorkspaceSelectionTarget, setRemoteWorkspaceSelectionTarget] = useState<{
    workspace: Pick<WorkspaceDto, "id" | "name" | "path">;
    hostId: string;
    peerHostId: string;
  } | null>(null);

  const currentAffairsWorkspace = useMemo(
    () => (
      activeWorkspaceId
        ? workspaceGroups.find((group) => group.workspace.id === activeWorkspaceId)?.workspace ?? null
        : null
    ),
    [activeWorkspaceId, workspaceGroups]
  );
  const embeddedAffairsSidebarState = useMemo(() => {
    if (!activeWorkspaceId) {
      return null;
    }

    const targetSection = routeCodeEmbeddedAffairsSection
      ?? (
        codeEmbeddedAffairsState?.primarySection === "library"
        || codeEmbeddedAffairsState?.primarySection === "workbench"
          ? codeEmbeddedAffairsState.primarySection
          : null
      );

    if (!targetSection) {
      return null;
    }

    if (
      codeEmbeddedAffairsState
      && codeEmbeddedAffairsState.workspaceId === activeWorkspaceId
      && codeEmbeddedAffairsState.primarySection === targetSection
    ) {
      return codeEmbeddedAffairsState;
    }

    const baseState =
      (codeEmbeddedAffairsState && codeEmbeddedAffairsState.workspaceId === activeWorkspaceId
        ? codeEmbeddedAffairsState
        : readAffairsViewState(activeWorkspaceId))
      ?? createDefaultAffairsViewState(activeWorkspaceId);

    if (targetSection === "library") {
      return createDefaultAffairsLibraryLandingState(activeWorkspaceId, baseState);
    }

    return {
      ...baseState,
      workspaceId: activeWorkspaceId,
      primarySection: "workbench" as const,
      selectedNodeId: "workbench:overview",
      selectedObjectId: null,
      selectedDocumentId: null,
      pendingLibraryPreview: null
    };
  }, [
    activeWorkspaceId,
    codeEmbeddedAffairsState,
    routeCodeEmbeddedAffairsSection
  ]);
  const embeddedAffairsSidebarContent =
    activeWorkspaceId && embeddedAffairsSidebarState && onCodeEmbeddedAffairsStateChange
      ? (
        <AffairsWorkbenchProvider
          workspaceId={activeWorkspaceId}
          workspaceName={currentAffairsWorkspace?.name ?? null}
          navigationGroups={navigationGroups}
          state={embeddedAffairsSidebarState}
          onStateChange={onCodeEmbeddedAffairsStateChange}
          onRefreshNavigation={onRefreshNavigation}
          forceRoute={false}
          targetHostId={currentTargetHostId}
        >
          <AffairsSidebarPanel />
        </AffairsWorkbenchProvider>
      )
      : null;

  useEffect(() => {
    let cancelled = false;

    void listWorkspaceHostBindings().then((response) => {
      if (cancelled) {
        return;
      }

      const nextAssignments = applyRemoteWorkspaceHostBindings(
        readWorkspaceHostAssignments(),
        activeHostId,
        response.items
          .filter((item) => item.activeHostId === activeHostId)
          .map((item) => ({
            ...item,
            selectedHostId: item.selectedHostId === "current"
              ? "current"
              : resolveSelectableHostId(item.selectedHostId) ?? item.selectedHostId
          }))
      );
      writeWorkspaceHostAssignmentsSilently(nextAssignments);
      setWorkspaceHostAssignments(nextAssignments);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeHostId]);

  function resolveWorkspaceHostAssignmentKey(workspace: Pick<WorkspaceDto, "id"> & Partial<Pick<WorkspaceDto, "path">>): string {
    return `${activeHostId}::${buildWorkspaceHostAssignmentKey(workspace.id, workspace.path)}`;
  }

  function resolveWorkspaceHostId(workspace: Pick<WorkspaceDto, "id" | "path">): string {
    const assignment = workspaceHostAssignments[resolveWorkspaceHostAssignmentKey(workspace)];
    const resolvedAssignedHostId = resolveSelectableHostId(assignment?.selectedHostId);

    if (resolvedAssignedHostId) {
      return resolvedAssignedHostId;
    }

    if (routeWorkspaceRef?.workspaceId === workspace.id && routeWorkspaceRef.hostId !== "current") {
      return resolveSelectableHostId(routeWorkspaceRef.hostId) ?? "current";
    }

    return "current";
  }

  function resolveSelectableHostId(hostId: string | null | undefined): string | null {
    if (!hostId) {
      return null;
    }

    if (selectableWorkspaceHostById.has(hostId)) {
      return hostId;
    }

    const matchedPeerHost = selectableWorkspaceHosts.find((item) => item.host.peerHostId === hostId);
    return matchedPeerHost?.id ?? null;
  }

  function resolveRemoteSelectedHostId(hostId: string): string {
    if (hostId === "current") {
      return "current";
    }

    return selectableWorkspaceHostById.get(hostId)?.peerHostId ?? hostId;
  }

  function resolveWorkspaceRefForHost(workspace: Pick<WorkspaceDto, "id">, hostId: string): WorkspaceRef | null {
    const assignment = workspaceHostAssignments[resolveWorkspaceHostAssignmentKey(workspace)];
    const remoteWorkspaceId =
      hostId !== "current" && assignment?.selectedHostId === hostId
        ? assignment.remoteWorkspaceId?.trim() || null
        : null;
    if (hostId !== "current" && !remoteWorkspaceId) {
      return null;
    }

    return makeWorkspaceRef(remoteWorkspaceId || workspace.id, resolveRemoteSelectedHostId(hostId));
  }

  function resolveWorkspaceRefForTargetHost(
    workspace: Pick<WorkspaceDto, "id"> & Partial<Pick<WorkspaceDto, "path">>,
    targetHostId: string
  ): WorkspaceRef | null {
    if (targetHostId === "current") {
      return makeWorkspaceRef(workspace.id, "current");
    }

    const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, workspace);
    const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
    const selectedTargetHostId = selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;
    const remoteWorkspaceId =
      selectedTargetHostId === targetHostId
        ? assignment?.remoteWorkspaceId?.trim() || null
        : null;

    return remoteWorkspaceId
      ? makeWorkspaceRef(remoteWorkspaceId, targetHostId)
      : null;
  }

  function resolveWorkspaceHost(workspace: Pick<WorkspaceDto, "id" | "path">): HostProfile | null {
    return selectableWorkspaceHostById.get(resolveWorkspaceHostId(workspace)) ?? activeHost ?? null;
  }

  function renderWorkspaceHostBadge(workspace: Pick<WorkspaceDto, "id" | "path">, className = "") {
    if (selectableWorkspaceHosts.length <= 1) {
      return null;
    }

    const hostId = resolveWorkspaceHostId(workspace);
    return (
      <WorkspaceHostBadge
        host={selectableWorkspaceHostById.get(hostId) ?? activeHost}
        hostId={hostId}
        className={className}
      />
    );
  }

  function commitWorkspaceHostAssignment(
    workspace: Pick<WorkspaceDto, "id" | "name" | "path">,
    hostId: string,
    remoteWorkspace?: Pick<WorkspaceDto, "id" | "name" | "path"> | null
  ) {
    const nextHostId = selectableWorkspaceHostById.has(hostId) ? hostId : "current";
    const localAssignmentKey = resolveWorkspaceHostAssignmentKey(workspace);
    const remoteWorkspaceKey = buildWorkspaceHostAssignmentKey(workspace.id, workspace.path);

    setWorkspaceHostAssignments((current) => {
      const next = { ...current };

      if (nextHostId === "current") {
        delete next[localAssignmentKey];
      } else {
        next[localAssignmentKey] = {
          selectedHostId: nextHostId,
          remoteWorkspaceId: remoteWorkspace?.id ?? null,
          remoteWorkspacePath: remoteWorkspace?.path ?? null,
          remoteWorkspaceName: remoteWorkspace?.name ?? null
        };
      }

      writeWorkspaceHostAssignments(next);
      return next;
    });

    void saveWorkspaceHostBinding(remoteWorkspaceKey, {
      activeHostId,
      selectedHostId: resolveRemoteSelectedHostId(nextHostId),
      remoteWorkspaceId: nextHostId === "current" ? null : remoteWorkspace?.id ?? null,
      remoteWorkspacePath: nextHostId === "current" ? null : remoteWorkspace?.path ?? null,
      remoteWorkspaceName: nextHostId === "current" ? null : remoteWorkspace?.name ?? null
    }).catch(() => undefined);

    if (activeWorkspaceId === workspace.id) {
      onSelectWorkspace(
        workspace.id,
        nextHostId === "current"
          ? makeWorkspaceRef(workspace.id, "current")
          : remoteWorkspace?.id
            ? makeWorkspaceRef(remoteWorkspace.id, resolveRemoteSelectedHostId(nextHostId))
            : null
      );
    }
  }

  async function handleChangeWorkspaceHost(workspace: Pick<WorkspaceDto, "id" | "name" | "path">, hostId: string) {
    const nextHostId = selectableWorkspaceHostById.has(hostId) ? hostId : "current";

    if (nextHostId === "current") {
      commitWorkspaceHostAssignment(workspace, nextHostId, null);
      return;
    }

    const peerHostId = resolveRemoteSelectedHostId(nextHostId);

    try {
      const response = await listScopedWorkspaces(peerHostId);
      const normalizedName = workspace.name.trim().toLowerCase();
      const matchedWorkspace =
        response.items
          .map((item) => item.workspace)
          .find((item) => item.name.trim().toLowerCase() === normalizedName)
        ?? null;

      if (matchedWorkspace) {
        commitWorkspaceHostAssignment(workspace, nextHostId, matchedWorkspace);
        return;
      }
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
        tone: "error"
      });
      return;
    }

    setRemoteWorkspaceSelectionTarget({
      workspace,
      hostId: nextHostId,
      peerHostId
    });
  }

  const openCodeInExternalWindow = useCallback(async (workspaceId: string) => {
    const routePath = buildWorkspaceSessionIndexPath(workspaceId);
    const result = await openCodeExternalWindow(platform, {
      workspaceId,
      focusOwner: "code-workbench",
      routePath
    });

    if (!result.ok) {
      showToast({
        title: result.detail ?? t("desktopWindow.invalidCodeTarget"),
        tone: "error"
      });
    }
  }, [platform, showToast]);

  const [importBrowserOpen, setImportBrowserOpen] = useState(false);
  const [cloneBrowserOpen, setCloneBrowserOpen] = useState(false);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [expandedManagedWorkspaceIds, setExpandedManagedWorkspaceIds] = useState<string[]>([]);
  const [workspaceRemovalTarget, setWorkspaceRemovalTarget] = useState<WorkspaceDto | null>(null);
  const [removingWorkspaceId, setRemovingWorkspaceId] = useState<string | null>(null);
  const [actionWorkspaceId, setActionWorkspaceId] = useState<string | null>(null);
  const [actionProvider, setActionProvider] = useState<ProviderId | null>(null);
  const [createSessionWorkspaceId, setCreateSessionWorkspaceId] = useState<string | null>(null);
  const [parallelCreateSource, setParallelCreateSource] = useState<ParallelSessionCreateSource | null>(null);
  const [createSessionWorkspaceDraft, setCreateSessionWorkspaceDraft] = useState<WorkspaceDto | null>(null);
  const [createWorktreeFormOpen, setCreateWorktreeFormOpen] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [createWorktreeBranchName, setCreateWorktreeBranchName] = useState("");
  const [createWorktreeDisplayName, setCreateWorktreeDisplayName] = useState("");
  const [createWorktreeBaseRef, setCreateWorktreeBaseRef] = useState("");
  const [createWorktreeBaseRefSuggestions, setCreateWorktreeBaseRefSuggestions] =
    useState<WorktreeBaseRefSuggestions>({
      localBranches: [],
      remoteBranches: [],
      tags: []
    });
  const [createWorktreeBaseRefPickerOpen, setCreateWorktreeBaseRefPickerOpen] = useState(false);
  const [createWorktreeBaseRefHighlightedIndex, setCreateWorktreeBaseRefHighlightedIndex] = useState(-1);
  const [createWorktreeHelpOpen, setCreateWorktreeHelpOpen] = useState(false);
  const [createWorktreeBaseRefSuggestionsLoading, setCreateWorktreeBaseRefSuggestionsLoading] =
    useState(false);
  const [createWorktreeBaseRefSuggestionsError, setCreateWorktreeBaseRefSuggestionsError] =
    useState<string | null>(null);
  const [createWorktreeBaseRefPopoverRect, setCreateWorktreeBaseRefPopoverRect] =
    useState<{ top: number; left: number; width: number } | null>(null);
  const [createWorktreeBaseRefPopoverHeight, setCreateWorktreeBaseRefPopoverHeight] = useState<number | null>(null);
  const [archiveWorkspaceId, setArchiveWorkspaceId] = useState<string | null>(null);
  const [lightweightChatArchiveWorkspaceId, setLightweightChatArchiveWorkspaceId] = useState<string | null>(null);
  const [sessionDeletionTarget, setSessionDeletionTarget] = useState<NavigationSessionEntry | null>(null);
  const [lightweightChatDeletionTarget, setLightweightChatDeletionTarget] = useState<LightweightChatSessionEntry | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [batchSessionDeletionTarget, setBatchSessionDeletionTarget] = useState<BatchSessionDeletionTarget | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [openSessionMenuAnchorPoint, setOpenSessionMenuAnchorPoint] = useState<ContextMenuAnchorPoint | null>(null);
  const [openWorkspaceMenuState, setOpenWorkspaceMenuState] = useState<{
    workspace: WorkspaceDto;
    anchorPoint: ContextMenuAnchorPoint;
    pinDisabled: boolean;
  } | null>(null);
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);
  const [exportRenderJob, setExportRenderJob] = useState<{
    session: SessionSummaryDto;
    items: ConversationTimelineSourceItem[];
    shellWidthPx: number | null;
  } | null>(null);
  const [visibleFavoriteCount, setVisibleFavoriteCount] = useState(FAVORITE_SESSION_PAGE_SIZE);
  const [visibleWorkspaceSessionCounts, setVisibleWorkspaceSessionCounts] = useState<Record<string, number>>({});
  const [visibleSubagentCounts, setVisibleSubagentCounts] = useState<Record<string, number>>({});
  const [expandedSubagentRootIds, setExpandedSubagentRootIds] = useState<string[]>([]);
  const [worktreeNodeExpansionState, setWorktreeNodeExpansionState] = useState<WorktreeNodeExpansionState>({
    expandedWorkspaceIds: [],
    collapsedWorkspaceIds: []
  });
  const [renameTarget, setRenameTarget] = useState<NavigationSessionEntry | null>(null);
  const [lightweightChatRenameTarget, setLightweightChatRenameTarget] = useState<LightweightChatSessionEntry | null>(null);
  const [renameTitleValue, setRenameTitleValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [batchWorkspaceId, setBatchWorkspaceId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchArchiving, setBatchArchiving] = useState(false);
  const [workspaceNavigationSavingById, setWorkspaceNavigationSavingById] = useState<Record<string, boolean>>({});
  const [managedWorkspaceCatalog, setManagedWorkspaceCatalog] = useState<WorkspaceDto[]>([]);
  const [dragWorkspaceId, setDragWorkspaceId] = useState<string | null>(null);
  const createWorktreeBaseRefPickerRef = useRef<HTMLDivElement | null>(null);
  const createWorktreeBaseRefPopoverRef = useRef<HTMLDivElement | null>(null);
  const exportRenderRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceDragCollapseFrameRef = useRef<number | null>(null);
  const workspaceGroupElementMapRef = useRef(new Map<string, HTMLElement>());
  const workspacePointerGestureRef = useRef<WorkspacePointerReorderGesture | null>(null);
  const workspacePointerGestureCleanupRef = useRef<(() => void) | null>(null);
  const suppressWorkspaceToggleClickRef = useRef<string | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const [workspaceMenuPositionStyle, setWorkspaceMenuPositionStyle] = useState<CSSProperties | null>(null);
  const [workspaceSubmenuPositionById, setWorkspaceSubmenuPositionById] = useState<Record<string, CSSProperties>>({});
  const [openWorkspaceMenuSubmenuId, setOpenWorkspaceMenuSubmenuId] = useState<string | null>(null);
  const expandedWorktreeNodeIdSet = useMemo(
    () => new Set(worktreeNodeExpansionState.expandedWorkspaceIds),
    [worktreeNodeExpansionState.expandedWorkspaceIds]
  );
  const collapsedWorktreeNodeIdSet = useMemo(
    () => new Set(worktreeNodeExpansionState.collapsedWorkspaceIds),
    [worktreeNodeExpansionState.collapsedWorkspaceIds]
  );
  const workspaceReorderDragging = dragWorkspaceId !== null;
  const enableWorkspacePointerReorder =
    allowWorkspaceReorder && platform.isDesktop && platform.ui.osFamily === "macos";
  const sidebarNavigationTree = useMemo(
    () => buildNavigationSessionTreeFromGroups(workspaceGroups, sessionDisplaySortMode),
    [workspaceGroups, sessionDisplaySortMode]
  );
  const visibleSessionTreeByWorkspaceId = useMemo(() => {
    const nextMap = new Map<string, NavigationSessionTreeNode[]>();

    for (const group of workspaceGroups) {
      nextMap.set(
        group.workspace.id,
        getVisibleSessionTreeNodes(group).map((node) =>
          findNavigationTreeNodeBySessionId(sidebarNavigationTree, node.item.sessionId) ?? node
        )
      );

      for (const worktreeNode of collectSidebarWorktreeNodes(group.childWorktrees)) {
        const mappedVisibleSessionTree = worktreeNode.visibleSessionTree
          .map((node) => findNavigationTreeNodeBySessionId(sidebarNavigationTree, node.item.sessionId) ?? node)
          .filter((node) => node.item.workspaceId === worktreeNode.workspace.id && node.depth === 0);

        nextMap.set(
          worktreeNode.workspace.id,
          mappedVisibleSessionTree
        );
      }
    }

    return nextMap;
  }, [sidebarNavigationTree, workspaceGroups]);
  const closeSessionMenu = useCallback(() => {
    setOpenSessionMenuKey(null);
    setOpenSessionMenuAnchorPoint(null);
  }, []);
  const openSessionMenu = useCallback((menuKey: string, anchorPoint: ContextMenuAnchorPoint) => {
    setOpenSessionMenuKey(menuKey);
    setOpenSessionMenuAnchorPoint(anchorPoint);
  }, []);
  const closeWorkspaceMenu = useCallback(() => {
    setOpenWorkspaceMenuState(null);
    setOpenWorkspaceMenuSubmenuId(null);
    setWorkspaceSubmenuPositionById({});
  }, []);

  const createSessionWorkspace =
    findSidebarWorkspaceById(workspaceGroups, createSessionWorkspaceId)
    ?? (createSessionWorkspaceDraft?.id === createSessionWorkspaceId ? createSessionWorkspaceDraft : null);
  const createWorktreeBaseRefFilter = createWorktreeBaseRef.trim().toLowerCase();
  const createWorktreeBaseRefOptionGroups = useMemo<WorktreeBaseRefOptionGroup[]>(
    () => {
      const groups: WorktreeBaseRefOptionGroup[] = [
        {
          key: "localBranches",
          label: t("shell.createWorktreeBaseRefLocalGroup"),
          items: createWorktreeBaseRefSuggestions.localBranches
        },
        {
          key: "remoteBranches",
          label: t("shell.createWorktreeBaseRefRemoteGroup"),
          items: createWorktreeBaseRefSuggestions.remoteBranches
        },
        {
          key: "tags",
          label: t("shell.createWorktreeBaseRefTagGroup"),
          items: createWorktreeBaseRefSuggestions.tags
        }
      ];

      return groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            createWorktreeBaseRefFilter ? item.value.toLowerCase().includes(createWorktreeBaseRefFilter) : true
          )
        }))
        .filter((group) => group.items.length > 0);
    },
    [createWorktreeBaseRefFilter, createWorktreeBaseRefSuggestions]
  );
  const createWorktreeBaseRefOptions = useMemo(
    () => createWorktreeBaseRefOptionGroups.flatMap((group) => group.items),
    [createWorktreeBaseRefOptionGroups]
  );
  const createWorktreeBaseRefListboxId = createSessionWorkspace
    ? `create-worktree-base-ref-listbox-${createSessionWorkspace.id}`
    : "create-worktree-base-ref-listbox";
  const archiveWorkspaceGroup = findSidebarArchiveTarget(workspaceGroups, archiveWorkspaceId);
  const archiveWorkspaceContext =
    archiveWorkspaceGroup ? getWorkspaceContext(archiveWorkspaceGroup.workspace) : null;
  const archiveSessions = archiveWorkspaceGroup?.archivedSessions ?? [];
  const {
    searchOpen: archiveSearchOpen,
    searchKeyword: archiveSearchKeyword,
    filteredSessions: filteredArchiveSessions,
    summaryLoading: archiveSummaryLoading,
    summaryError: archiveSummaryError,
    summaryBySessionId: archiveSummaryBySessionId,
    setSearchKeyword: setArchiveSearchKeyword,
    toggleSearch: toggleArchiveSearch
  } = useArchiveSessionSearch(archiveWorkspaceGroup !== null, archiveSessions);
  const archiveSearchInputId = useId();
  const lightweightChatArchiveWorkspace =
    lightweightChatArchiveWorkspaceId
      ? workspaceGroups.find((group) => group.workspace.id === lightweightChatArchiveWorkspaceId)?.workspace ?? null
      : null;
  const lightweightArchivedSessions =
    lightweightChatArchiveWorkspaceId
      ? lightweightArchivedChatSessionsByWorkspaceId[lightweightChatArchiveWorkspaceId] ?? []
      : [];
  const {
    searchOpen: lightweightArchiveSearchOpen,
    searchKeyword: lightweightArchiveSearchKeyword,
    filteredSessions: filteredLightweightArchivedSessions,
    summaryLoading: lightweightArchiveSummaryLoading,
    summaryError: lightweightArchiveSummaryError,
    summaryBySessionId: lightweightArchiveSummaryBySessionId,
    setSearchKeyword: setLightweightArchiveSearchKeyword,
    toggleSearch: toggleLightweightArchiveSearch
  } = useArchiveSessionSearch(Boolean(lightweightChatArchiveWorkspaceId), lightweightArchivedSessions);
  const lightweightArchiveSearchInputId = useId();
  const activeBatchWorkspaceTarget = useMemo(
    () => findSidebarBatchTarget(workspaceGroups, batchWorkspaceId),
    [batchWorkspaceId, workspaceGroups]
  );
  const batchSelectableSessions = useMemo(
    () => (
      activeBatchWorkspaceTarget
        ? flattenVisibleSessionTree(activeBatchWorkspaceTarget.visibleSessionTree)
        : []
    ),
    [activeBatchWorkspaceTarget]
  );
  const batchSelectableSessionIds = useMemo(
    () => batchSelectableSessions.map((session) => session.sessionId),
    [batchSelectableSessions]
  );
  const batchSelectableSessionIdSet = useMemo(
    () => new Set(batchSelectableSessionIds),
    [batchSelectableSessionIds]
  );
  const selectedSessionIdSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds]);
  const allBatchSessionsSelected =
    batchSelectableSessionIds.length > 0 && selectedSessionIds.length === batchSelectableSessionIds.length;

  useEffect(() => {
    setWorkspaceManagementStateById((current) => {
      const allManagedWorkspaceIds = collectManagedWorkspaceIds(workspaceGroups);
      const knownWorkspaceIds = new Set(allManagedWorkspaceIds);
      const nextState: Record<string, WorkspaceManagementViewState> = {};

      Object.entries(current).forEach(([workspaceId, state]) => {
        if (knownWorkspaceIds.has(workspaceId)) {
          nextState[workspaceId] = state;
        }
      });

      allManagedWorkspaceIds.forEach((workspaceId) => {
        const workspace = findSidebarWorkspaceById(workspaceGroups, workspaceId);

        if (!workspace) {
          return;
        }

        const cachedDetail = readViewSnapshot<WorkspaceManagementSummaryDto>(
          buildWorkspaceManagementSummarySnapshotKey(workspaceId),
          WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
        );
        const cachedGitSnapshot = readViewSnapshot<Pick<GitRealtimeSnapshotDto, "status" | "branches">>(
          buildGitSidebarSnapshotKey(workspaceId),
          WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
        );
        const currentState = nextState[workspaceId];
        let nextDetail = mergeWorkspaceManagementDetailWithWorkspace(
          currentState?.detail ?? cachedDetail ?? createWorkspaceManagementFallback(workspace),
          workspace
        );

        if (cachedGitSnapshot?.status || cachedGitSnapshot?.branches) {
          nextDetail = mergeWorkspaceManagementDetailWithGitSnapshot(nextDetail, {
            workspaceId,
            status: cachedGitSnapshot.status ?? null,
            history: [],
            historyTotalCount: 0,
            historyNextCursor: null,
            branches: cachedGitSnapshot.branches ?? null
          });
        }

        nextState[workspaceId] = {
          detail: nextDetail,
          loading: false,
          error: null
        };
      });

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextState);

      if (
        currentKeys.length === nextKeys.length
        && nextKeys.every((workspaceId) => current[workspaceId] === nextState[workspaceId])
      ) {
        return current;
      }

      return nextState;
    });
  }, [workspaceGroups]);

  const handleWorkspaceImported = useCallback(
    async (workspace: WorkspaceDto) => {
      await onRefreshNavigation();
      await platform.bridge.showNotification(t("shell.importSuccess"), workspace.path);
    },
    [onRefreshNavigation, platform.bridge]
  );

  const handleRemoteWorkspacePathSelected = useCallback(
    async (path: string) => {
      const target = remoteWorkspaceSelectionTarget;

      if (!target) {
        return;
      }

      const workspace = await importWorkspace({ path }, { targetHostId: target.peerHostId });
      commitWorkspaceHostAssignment(target.workspace, target.hostId, workspace);
      setRemoteWorkspaceSelectionTarget(null);
    },
    [remoteWorkspaceSelectionTarget]
  );

  const handleWorkspaceCloned = useCallback(
    async (workspace: WorkspaceDto) => {
      await onRefreshNavigation();
      await platform.bridge.showNotification(t("shell.cloneSuccess"), workspace.path);
    },
    [onRefreshNavigation, platform.bridge]
  );

  useEffect(() => {
    if (!workspaceManagerOpen) {
      return;
    }

    let disposed = false;

    void listWorkspaces({ includeHidden: true })
      .then((response) => {
        if (disposed) {
          return;
        }

        setManagedWorkspaceCatalog(Array.isArray(response.items) ? response.items : []);
      })
      .catch(() => {
        if (disposed) {
          return;
        }

        setManagedWorkspaceCatalog([]);
      });

    return () => {
      disposed = true;
    };
  }, [workspaceGroups, workspaceManagerOpen]);

  function handleToggleManagedWorkspace(workspaceId: string) {
    const isExpanded = expandedManagedWorkspaceIds.includes(workspaceId);

    if (isExpanded) {
      setExpandedManagedWorkspaceIds((current) => current.filter((item) => item !== workspaceId));
      return;
    }

    setExpandedManagedWorkspaceIds((current) => [...current, workspaceId]);

    const workspace = workspaceGroups.find((item) => item.workspace.id === workspaceId)?.workspace ?? null;
    const workspaceHostId = workspace ? resolveWorkspaceHostId(workspace) : "current";
    const workspaceRef = workspace ? resolveWorkspaceRefForHost(workspace, workspaceHostId) : makeWorkspaceRef(workspaceId, "current");

    if (!workspaceRef) {
      return;
    }

    const targetHostId = workspaceRef.hostId === "current" ? null : workspaceRef.hostId;
    subscribeGitSnapshot(workspaceRef.workspaceId, { targetHostId });
    requestGitRefresh(workspaceRef.workspaceId, { targetHostId });
    subscribeWorkspaceManagementSnapshot(workspaceRef.workspaceId, { targetHostId });
    requestWorkspaceManagementRefresh(workspaceRef.workspaceId, { targetHostId });
  }

  async function handlePinWorkspaceToTop(workspaceId: string) {
    const workspaceIds = workspaceGroups.map((group) => group.workspace.id);

    if (workspaceIds.length <= 1 || workspaceIds[0] === workspaceId) {
      return;
    }

    try {
      await reorderWorkspaces({
        workspaceIds: [workspaceId, ...workspaceIds.filter((item) => item !== workspaceId)]
      });
      await onRefreshNavigation();
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.workspaceReorderFailed"),
        tone: "error"
      });
    }
  }

  async function handleOpenWorkspaceTerminals(workspace: WorkspaceDto) {
    const workspaceHostId = resolveWorkspaceHostId(workspace);
    const workspaceRef = resolveWorkspaceRefForHost(workspace, workspaceHostId);
    onOpenTerminalDock(workspace.id, workspaceRef);
    onClose?.();
  }

  async function handleOpenWorkspaceFiles(workspace: WorkspaceDto) {
    const workspaceRef = resolveWorkspaceRefForHost(workspace, resolveWorkspaceHostId(workspace));
    navigate(buildWorkspaceToolFilesPath(workspace.id, workspaceRef));
    onClose?.();
  }

  async function handleOpenWorkspaceGit(workspace: WorkspaceDto) {
    const workspaceRef = resolveWorkspaceRefForHost(workspace, resolveWorkspaceHostId(workspace));
    navigate(buildWorkspaceToolGitPath(workspace.id, workspaceRef));
    onClose?.();
  }

  async function handleOpenWorkspaceProcesses(workspace: WorkspaceDto) {
    const workspaceRef = resolveWorkspaceRefForHost(workspace, resolveWorkspaceHostId(workspace));
    navigate(buildWorkspaceToolProcessesPath(workspace.id, workspaceRef));
    onClose?.();
  }

  async function handleUpdateWorkspaceHiddenState(workspace: WorkspaceDto, hidden: boolean) {
    if (workspaceNavigationSavingById[workspace.id]) {
      return;
    }

    setWorkspaceNavigationSavingById((current) => ({
      ...current,
      [workspace.id]: true
    }));

    try {
      await updateWorkspaceNavigationState(workspace.id, { hidden });
      setExpandedManagedWorkspaceIds((current) => current.filter((item) => item !== workspace.id));
      await onRefreshNavigation();
      const response = await listWorkspaces({ includeHidden: true });
      setManagedWorkspaceCatalog(Array.isArray(response.items) ? response.items : []);
      showToast({
        title: hidden ? t("shell.workspaceHideSuccess") : t("shell.workspaceUnhideSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error
          ? error.message
          : hidden
            ? t("shell.workspaceHideFailed")
            : t("shell.workspaceUnhideFailed"),
        tone: "error"
      });
    } finally {
      setWorkspaceNavigationSavingById((current) => ({
        ...current,
        [workspace.id]: false
      }));
    }
  }

  function buildWorkspaceContextMenuItems(
    workspace: WorkspaceDto,
    options?: { pinDisabled?: boolean }
  ): DesktopContextMenuItem[] {
    const currentHostId = resolveWorkspaceHostId(workspace);
    const hostMenuItems = selectableWorkspaceHosts.length > 1
      ? selectableWorkspaceHosts.map((item) => ({
          id: `switch-host:${workspace.id}:${item.id}`,
          label: item.id === "current"
            ? t("shell.manageWorkspaceHostCurrentOption", { alias: getHostAlias(item.host) })
            : t("shell.manageWorkspaceHostPeerOption", { alias: getHostAlias(item.host) }),
          disabled: item.id === currentHostId,
          onSelect: () => {
            void handleChangeWorkspaceHost(workspace, item.id);
          }
        }))
      : [];

    return [
      {
        id: `pin:${workspace.id}`,
        label: t("shell.workspacePinToTopAction"),
        disabled: options?.pinDisabled === true,
        onSelect: () => {
          void handlePinWorkspaceToTop(workspace.id);
        }
      },
      ...(hostMenuItems.length > 0
        ? [{
            id: `switch:${workspace.id}`,
            label: t("shell.workspaceSwitchHostAction"),
            items: hostMenuItems
          }]
        : []),
      {
        id: `terminals:${workspace.id}`,
        label: t("shell.terminalsEntry"),
        onSelect: () => {
          void handleOpenWorkspaceTerminals(workspace);
        }
      },
      {
        id: `tools:${workspace.id}`,
        label: t("shell.parallelPaneToolsAction"),
        onSelect: () => {
          void handleOpenWorkspaceFiles(workspace);
        }
      },
      {
        id: `hide:${workspace.id}`,
        label: t("shell.workspaceHideAction"),
        disabled: workspaceNavigationSavingById[workspace.id] === true,
        onSelect: () => {
          void handleUpdateWorkspaceHiddenState(workspace, true);
        }
      },
      {
        id: `remove:${workspace.id}`,
        label: t("shell.manageWorkspaceRemoveAction"),
        disabled: Boolean(removingWorkspaceId),
        onSelect: () => setWorkspaceRemovalTarget(workspace)
      }
    ];
  }

  function openWorkspaceSubmenuFromElement(submenuId: string, element: HTMLElement) {
    if (typeof window === "undefined") {
      setOpenWorkspaceMenuSubmenuId(submenuId);
      return;
    }

    const itemRect = element.getBoundingClientRect();
    const parentMenuRect = workspaceMenuRef.current?.getBoundingClientRect();
    const parentMenuWidth = parentMenuRect?.width ?? 180;
    const submenuWidth = 188;
    const viewportMargin = 8;
    const gap = 4;
    const openLeft = itemRect.right + gap + submenuWidth > window.innerWidth - viewportMargin
      && itemRect.left - gap - submenuWidth >= viewportMargin;
    const left = openLeft
      ? itemRect.left - gap - submenuWidth
      : itemRect.right + gap;
    const top = Math.min(
      Math.max(itemRect.top - 6, viewportMargin),
      Math.max(viewportMargin, window.innerHeight - viewportMargin - 96)
    );

    setWorkspaceSubmenuPositionById((current) => ({
      ...current,
      [submenuId]: {
        position: "fixed",
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        width: `${submenuWidth}px`,
        maxWidth: `min(${submenuWidth}px, calc(100vw - ${viewportMargin * 2}px))`,
        transformOrigin: `${openLeft ? "right" : "left"} top`,
        ["--workbench-submenu-bridge-left" as string]: openLeft ? `${submenuWidth}px` : `-${parentMenuWidth + gap}px`,
        ["--workbench-submenu-bridge-width" as string]: `${Math.max(parentMenuWidth + gap, gap)}px`
      }
    }));
    setOpenWorkspaceMenuSubmenuId(submenuId);
  }

  async function openWorkspaceContextMenu(
    workspace: WorkspaceDto,
    options?: { pinDisabled?: boolean },
    anchorPoint?: ContextMenuAnchorPoint
  ) {
    const items = buildWorkspaceContextMenuItems(workspace, options);

    if (platform.isDesktop) {
      await showDesktopContextMenu(items);
      return;
    }

    if (!anchorPoint) {
      return;
    }

    setOpenWorkspaceMenuSubmenuId(null);
    setWorkspaceSubmenuPositionById({});
    setOpenWorkspaceMenuState({
      workspace,
      anchorPoint,
      pinDisabled: options?.pinDisabled === true
    });
  }

  async function handleUpdateWorkspaceBackgroundColor(workspaceId: string, backgroundColor: string | null) {
    if (workspaceNavigationSavingById[workspaceId]) {
      return;
    }

    const normalizedBackgroundColor = backgroundColor?.trim().toUpperCase() ?? null;

    setWorkspaceNavigationSavingById((current) => ({
      ...current,
      [workspaceId]: true
    }));

    try {
      await updateWorkspaceNavigationState(workspaceId, {
        backgroundColor: normalizedBackgroundColor
      });
      await onRefreshNavigation();
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.manageWorkspaceColorSaveFailed"),
        tone: "error"
      });
    } finally {
      setWorkspaceNavigationSavingById((current) => ({
        ...current,
        [workspaceId]: false
      }));
    }
  }

  async function handleConfirmWorkspaceRemoval() {
    if (!workspaceRemovalTarget || removingWorkspaceId) {
      return;
    }

    setRemovingWorkspaceId(workspaceRemovalTarget.id);

    try {
      await removeWorkspace(workspaceRemovalTarget.id);
      setExpandedManagedWorkspaceIds((current) =>
        current.filter((workspaceId) => workspaceId !== workspaceRemovalTarget.id)
      );
      setWorkspaceManagementStateById((current) => {
        const next = { ...current };
        delete next[workspaceRemovalTarget.id];
        return next;
      });
      setWorkspaceRemovalTarget(null);
      await onRefreshNavigation();
      showToast({
        title: t("shell.manageWorkspaceRemoveSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.manageWorkspaceRemoveFailed"),
        tone: "error"
      });
    } finally {
      setRemovingWorkspaceId(null);
    }
  }

  useEffect(() => {
    if (!openSessionMenuKey) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest(".workbench-session-menu")) {
        return;
      }

      closeSessionMenu();
    }

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeSessionMenu, openSessionMenuKey]);

  useLayoutEffect(() => {
    if (platform.isDesktop || !openWorkspaceMenuState || typeof window === "undefined") {
      setWorkspaceMenuPositionStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const nextPosition = resolveContextMenuPosition(
        openWorkspaceMenuState.anchorPoint,
        {
          width: workspaceMenuRef.current?.offsetWidth ?? 0,
          height: workspaceMenuRef.current?.offsetHeight ?? 0
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        },
        {
          estimatedHeightPx: 280
        }
      );

      setWorkspaceMenuPositionStyle({
        position: "fixed",
        top: `${Math.round(nextPosition.top)}px`,
        left: `${Math.round(nextPosition.left)}px`,
        width: `${Math.round(nextPosition.width)}px`,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: `${Math.round(nextPosition.maxHeight)}px`,
        transformOrigin: nextPosition.transformOrigin
      });
    };

    const handleViewportChanged = () => {
      if (openWorkspaceMenuSubmenuId !== null) {
        setOpenWorkspaceMenuSubmenuId(null);
        setWorkspaceSubmenuPositionById({});
      }
      updateMenuPosition();
    };

    updateMenuPosition();
    window.addEventListener("resize", handleViewportChanged);
    window.addEventListener("scroll", handleViewportChanged, true);

    return () => {
      window.removeEventListener("resize", handleViewportChanged);
      window.removeEventListener("scroll", handleViewportChanged, true);
    };
  }, [openWorkspaceMenuState, platform.isDesktop]);

  useEffect(() => {
    if (!openWorkspaceMenuState) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest(".workbench-workspace-menu")) {
        return;
      }

      closeWorkspaceMenu();
    }

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeWorkspaceMenu, openWorkspaceMenuState]);

  const workspaceMenu =
    !platform.isDesktop && openWorkspaceMenuState && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={workspaceMenuRef}
            className="workbench-session-menu workbench-workspace-menu"
            role="menu"
            aria-label={t("shell.manageWorkspaceTitle")}
            onClick={(event) => event.stopPropagation()}
            style={
              workspaceMenuPositionStyle ?? {
                position: "fixed",
                top: 0,
                left: 0,
                visibility: "hidden"
              }
            }
          >
            {buildWorkspaceContextMenuItems(openWorkspaceMenuState.workspace, {
              pinDisabled: openWorkspaceMenuState.pinDisabled
            }).map((item) => {
              if ("items" in item) {
                const submenuOpen = openWorkspaceMenuSubmenuId === item.id;

                return (
                  <div
                    key={item.id}
                    className="workbench-session-submenu workbench-workspace-submenu"
                    data-open={submenuOpen}
                    onPointerEnter={(event) => {
                      openWorkspaceSubmenuFromElement(item.id, event.currentTarget);
                    }}
                    onFocusCapture={(event) => {
                      openWorkspaceSubmenuFromElement(item.id, event.currentTarget);
                    }}
                  >
                    <button
                      type="button"
                      className="workbench-session-menu-item"
                      aria-haspopup="menu"
                      aria-expanded={submenuOpen}
                      disabled={item.disabled}
                      onClick={(event) => {
                        openWorkspaceSubmenuFromElement(item.id, event.currentTarget);
                      }}
                    >
                      <span>{item.label}</span>
                      <span className="workbench-session-submenu-caret" aria-hidden="true">
                        ›
                      </span>
                    </button>
                    <div
                      className="workbench-session-submenu-panel workbench-workspace-submenu-panel"
                      role="menu"
                      aria-label={item.label}
                      data-floating="true"
                      data-open={submenuOpen}
                      aria-hidden={!submenuOpen}
                      style={workspaceSubmenuPositionById[item.id]}
                    >
                        {item.items.map((child) => {
                          if ("items" in child) {
                            return null;
                          }

                          return (
                            <button
                              key={child.id}
                              type="button"
                              className="workbench-session-menu-item"
                              role="menuitem"
                              disabled={child.disabled}
                              onClick={() => {
                                void child.onSelect();
                                closeWorkspaceMenu();
                              }}
                            >
                              <span>{child.label}</span>
                            </button>
                          );
                        })}
                      </div>
                  </div>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  className="workbench-session-menu-item"
                  role="menuitem"
                  disabled={item.disabled}
                  onPointerEnter={() => {
                    if (openWorkspaceMenuSubmenuId !== null) {
                      setOpenWorkspaceMenuSubmenuId(null);
                    }
                  }}
                  onFocus={() => {
                    if (openWorkspaceMenuSubmenuId !== null) {
                      setOpenWorkspaceMenuSubmenuId(null);
                    }
                  }}
                  onClick={() => {
                    void item.onSelect();
                    closeWorkspaceMenu();
                  }}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  useEffect(() => {
    if (!batchWorkspaceId) {
      if (selectedSessionIds.length > 0) {
        setSelectedSessionIds([]);
      }
      if (batchSessionDeletionTarget) {
        setBatchSessionDeletionTarget(null);
      }
      return;
    }

    if (!activeBatchWorkspaceTarget) {
      setBatchWorkspaceId(null);
      setSelectedSessionIds([]);
      setBatchSessionDeletionTarget(null);
      return;
    }

    setSelectedSessionIds((current) => retainKnownIds(current, batchSelectableSessionIdSet));
  }, [
    activeBatchWorkspaceTarget,
    batchSessionDeletionTarget,
    batchSelectableSessionIdSet,
    batchWorkspaceId,
    selectedSessionIds.length
  ]);

  useEffect(() => {
    if (batchWorkspaceId && batchSelectableSessionIds.length === 0) {
      setBatchWorkspaceId(null);
      setSelectedSessionIds([]);
      setBatchSessionDeletionTarget(null);
    }
  }, [batchSelectableSessionIds.length, batchWorkspaceId]);

  useEffect(() => {
    const knownWorkspaceIdSet = new Set(collectManagedWorkspaceIds(workspaceGroups));
    const knownWorktreeWorkspaceIdSet = new Set(
      workspaceGroups.flatMap((group) => collectSidebarWorktreeWorkspaceIds(group.childWorktrees))
    );

    setExpandedManagedWorkspaceIds((current) => current.filter((workspaceId) => knownWorkspaceIdSet.has(workspaceId)));
    setWorktreeNodeExpansionState((current) => ({
      expandedWorkspaceIds: current.expandedWorkspaceIds.filter((workspaceId) =>
        knownWorktreeWorkspaceIdSet.has(workspaceId)
      ),
      collapsedWorkspaceIds: current.collapsedWorkspaceIds.filter((workspaceId) =>
        knownWorktreeWorkspaceIdSet.has(workspaceId)
      )
    }));
    setWorkspaceRemovalTarget((current) => (current && knownWorkspaceIdSet.has(current.id) ? current : null));
    setWorkspaceNavigationSavingById((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([workspaceId, saving]) => saving && knownWorkspaceIdSet.has(workspaceId))
      )
    );
  }, [workspaceGroups]);

  useEffect(() => {
    const activeFavoriteIndex = favoriteSessions.findIndex((item) => item.session.sessionId === activeSessionId);

    setVisibleFavoriteCount((current) => {
      const nextCount = resolveVisibleItemCount(
        favoriteSessions.length,
        FAVORITE_SESSION_PAGE_SIZE,
        current,
        activeFavoriteIndex
      );

      return nextCount === current ? current : nextCount;
    });
  }, [activeSessionId, favoriteSessions]);

  useEffect(() => {
    setVisibleWorkspaceSessionCounts((current) => {
      const next: Record<string, number> = {};

      for (const group of workspaceGroups) {
        const visibleSessionTree = getVisibleSessionTreeNodes(group);
        const activeRootSessionIndex = visibleSessionTree.findIndex(
          (node) =>
            node.item.sessionId === activeSessionId ||
            findSessionTreeAncestorIds([node], activeSessionId ?? "", (session) => session.sessionId).length > 0
        );

        next[group.workspace.id] = resolveVisibleItemCount(
          visibleSessionTree.length,
          ROOT_SESSION_PAGE_SIZE,
          current[group.workspace.id],
          activeRootSessionIndex
        );

        for (const worktreeNode of collectSidebarVisibleSessionTrees(group.childWorktrees)) {
          const activeWorktreeRootSessionIndex =
            worktreeNode.item.sessionId === activeSessionId
            || findSessionTreeAncestorIds(
              [worktreeNode],
              activeSessionId ?? "",
              (session) => session.sessionId
            ).length > 0
              ? 0
              : -1;
          const workspaceId = worktreeNode.item.workspaceId;

          if (next[workspaceId] !== undefined) {
            continue;
          }

          const workspaceVisibleSessionTree = collectSidebarVisibleSessionTrees(group.childWorktrees).filter(
            (node) => node.item.workspaceId === workspaceId && node.depth === 0
          );
          const workspaceActiveRootSessionIndex = workspaceVisibleSessionTree.findIndex(
            (node) =>
              node.item.sessionId === activeSessionId ||
              findSessionTreeAncestorIds([node], activeSessionId ?? "", (session) => session.sessionId).length > 0
          );

          next[workspaceId] = resolveVisibleItemCount(
            workspaceVisibleSessionTree.length,
            ROOT_SESSION_PAGE_SIZE,
            current[workspaceId],
            workspaceActiveRootSessionIndex
          );
        }
      }

      return isSameVisibleCountRecord(current, next) ? current : next;
    });
  }, [activeSessionId, workspaceGroups]);

  useEffect(() => {
    setVisibleSubagentCounts((current) => {
      const next: Record<string, number> = {};

      for (const group of workspaceGroups) {
        for (const rootNode of [
          ...getVisibleSessionTreeNodes(group),
          ...collectSidebarVisibleSessionTrees(group.childWorktrees)
        ]) {
          for (const node of [rootNode, ...flattenSessionTreeNodes(getTreeNodeChildren(rootNode))]) {
            const childNodes = getTreeNodeChildren(node);

            if (childNodes.length === 0) {
              continue;
            }

            // 这里必须按整棵后代树来维护可见数量，不能只看直属孩子。
            // 否则用户手动“展开更多”以后，只要导航树刷新一次，
            // effect 就会把可见数量缩回直属孩子数，看起来像系统自动收起了会话。
            const descendantNodes = flattenSessionTreeNodes(childNodes);
            const activeDescendantIndex = descendantNodes.findIndex(
              (childNode) => childNode.item.sessionId === activeSessionId
            );

            next[node.item.sessionId] = resolveVisibleItemCount(
              descendantNodes.length,
              SUBAGENT_PAGE_SIZE,
              current[node.item.sessionId],
              activeDescendantIndex
            );

            const closedDescendantNodes = descendantNodes.filter((childNode) =>
              isClosedSubagentSession(childNode.item)
            );
            const activeClosedDescendantIndex = closedDescendantNodes.findIndex(
              (childNode) => childNode.item.sessionId === activeSessionId
            );

            if (closedDescendantNodes.length > 0) {
              const closedStateKey = buildClosedSubagentStateKey(node.item.sessionId);

              next[closedStateKey] = resolveVisibleItemCount(
                closedDescendantNodes.length,
                SUBAGENT_PAGE_SIZE,
                current[closedStateKey],
                activeClosedDescendantIndex
              );
            }
          }
        }
      }

      return isSameVisibleCountRecord(current, next) ? current : next;
    });
  }, [activeSessionId, workspaceGroups]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const sessionIdsToExpand = workspaceGroups.flatMap((group) =>
      [
        ...findSessionTreeAncestorIds(
          getVisibleSessionTreeNodes(group),
          activeSessionId,
          (session) => session.sessionId
        ),
        ...collectSidebarVisibleSessionTrees(group.childWorktrees).flatMap((rootNode) =>
          findSessionTreeAncestorIds([rootNode], activeSessionId, (session) => session.sessionId)
        )
      ]
    );
    const closedSubagentGroupIdsToExpand = workspaceGroups.flatMap((group) =>
      [
        ...getVisibleSessionTreeNodes(group),
        ...collectSidebarVisibleSessionTrees(group.childWorktrees)
      ].flatMap((rootNode) =>
        [rootNode, ...flattenSessionTreeNodes(getTreeNodeChildren(rootNode))]
          .filter((node) =>
            getTreeNodeChildren(node).some((childNode) =>
              isClosedSubagentSession(childNode.item) && childNode.item.sessionId === activeSessionId
            )
          )
          .map((node) => buildClosedSubagentStateKey(node.item.sessionId))
      )
    );
    const expandedIds = [...sessionIdsToExpand, ...closedSubagentGroupIdsToExpand];

    if (expandedIds.length === 0) {
      return;
    }

    setExpandedSubagentRootIds((current) => {
      const currentSet = new Set(current);
      let changed = false;

      for (const sessionId of expandedIds) {
        if (!currentSet.has(sessionId)) {
          currentSet.add(sessionId);
          changed = true;
        }
      }

      return changed ? Array.from(currentSet) : current;
    });
  }, [activeSessionId, workspaceGroups]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    const worktreeNodeIdsToExpand: string[] = [];

    for (const group of workspaceGroups) {
      const worktreePath = findSidebarWorktreePathByWorkspaceId(group.childWorktrees, activeWorkspaceId);

      if (worktreePath.length === 0) {
        continue;
      }

      worktreeNodeIdsToExpand.push(...worktreePath);
    }

    if (worktreeNodeIdsToExpand.length > 0) {
      setWorktreeNodeExpansionState((current) => {
        const currentSet = new Set(current.expandedWorkspaceIds);
        let changed = false;

        for (const workspaceId of worktreeNodeIdsToExpand) {
          if (!currentSet.has(workspaceId)) {
            currentSet.add(workspaceId);
            changed = true;
          }
        }

        if (!changed) {
          return current;
        }

        return {
          expandedWorkspaceIds: Array.from(currentSet),
          collapsedWorkspaceIds: current.collapsedWorkspaceIds
        };
      });
    }
  }, [activeWorkspaceId, workspaceGroups]);

  useEffect(() => {
    if (!createSessionWorkspaceId) {
      setCreateSessionWorkspaceDraft(null);
      setCreateWorktreeFormOpen(false);
      setCreatingWorktree(false);
      setCreateWorktreeBranchName("");
      setCreateWorktreeDisplayName("");
      setCreateWorktreeBaseRef("");
      setCreateWorktreeBaseRefPickerOpen(false);
      setCreateWorktreeBaseRefHighlightedIndex(-1);
      setCreateWorktreeHelpOpen(false);
      setCreateWorktreeBaseRefSuggestions({
        localBranches: [],
        remoteBranches: [],
        tags: []
      });
      setCreateWorktreeBaseRefSuggestionsLoading(false);
      setCreateWorktreeBaseRefSuggestionsError(null);
      return;
    }

    setCreateWorktreeFormOpen(false);
    setCreateWorktreeBranchName("");
    setCreateWorktreeDisplayName("");
    setCreateWorktreeBaseRef("");
    setCreateWorktreeBaseRefPickerOpen(false);
    setCreateWorktreeBaseRefHighlightedIndex(-1);
    setCreateWorktreeHelpOpen(false);
    setCreateWorktreeBaseRefSuggestions({
      localBranches: [],
      remoteBranches: [],
      tags: []
    });
    setCreateWorktreeBaseRefSuggestionsLoading(false);
    setCreateWorktreeBaseRefSuggestionsError(null);
  }, [createSessionWorkspaceId]);

  useEffect(() => {
    const createSessionWorkspaceValue = createSessionWorkspace;

    if (!createWorktreeFormOpen || !createSessionWorkspaceValue) {
      return;
    }

    let cancelled = false;
    const workspaceId = createSessionWorkspaceValue.id;
    setCreateWorktreeBaseRefSuggestionsLoading(true);
    setCreateWorktreeBaseRefSuggestionsError(null);

    void Promise.all([
      getGitBranches(workspaceId),
      getGitTags(workspaceId)
    ])
      .then(([branches, tags]) => {
        if (cancelled) {
          return;
        }

        setCreateWorktreeBaseRefSuggestions(buildWorktreeBaseRefSuggestions(branches, tags));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setCreateWorktreeBaseRefSuggestions({
          localBranches: [],
          remoteBranches: [],
          tags: []
        });
        setCreateWorktreeBaseRefSuggestionsError(t("shell.createWorktreeBaseRefLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) {
          setCreateWorktreeBaseRefSuggestionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [createSessionWorkspace?.id, createWorktreeFormOpen]);

  useLayoutEffect(() => {
    if (!createWorktreeBaseRefPickerOpen || !createWorktreeBaseRefPickerRef.current) {
      setCreateWorktreeBaseRefPopoverRect(null);
      setCreateWorktreeBaseRefPopoverHeight(null);
      return;
    }

    const updateRect = () => {
      const anchor = createWorktreeBaseRefPickerRef.current;

      if (!anchor) {
        return;
      }

      const rect = measureFloatingPanelRect(anchor);
      setCreateWorktreeBaseRefPopoverRect({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width
      });
    };

    updateRect();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (createWorktreeBaseRefPickerRef.current?.contains(target)) {
        return;
      }

      if (createWorktreeBaseRefPopoverRef.current?.contains(target)) {
        return;
      }

      setCreateWorktreeBaseRefPickerOpen(false);
      setCreateWorktreeBaseRefHighlightedIndex(-1);
    };

    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [createWorktreeBaseRefOptions.length, createWorktreeBaseRefPickerOpen]);

  useLayoutEffect(() => {
    if (!createWorktreeBaseRefPickerOpen || !createWorktreeBaseRefPopoverRef.current) {
      setCreateWorktreeBaseRefPopoverHeight(null);
      return;
    }

    const popover = createWorktreeBaseRefPopoverRef.current;

    const updateHeight = () => {
      const nextHeight = Math.ceil(popover.getBoundingClientRect().height);
      setCreateWorktreeBaseRefPopoverHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(popover);

    return () => {
      observer.disconnect();
    };
  }, [
    createWorktreeBaseRefPickerOpen,
    createWorktreeBaseRefOptionGroups,
    createWorktreeBaseRefSuggestionsLoading,
    createWorktreeBaseRefSuggestionsError
  ]);

  function handleOpenDirectoryBrowser() {
    setImportBrowserOpen(true);
  }

  function handleOpenCloneWorkspace() {
    setCloneBrowserOpen(true);
  }

  function handleOpenParallelCreateFromWorkspace(workspace: WorkspaceDto) {
    resetCreateWorktreeForm();
    setCreateSessionWorkspaceId(null);
    setParallelCreateSource({
      kind: "workspace",
      workspaceId: workspace.id,
      workspaceName: workspace.name
    });
  }

  function resetCreateWorktreeForm() {
    setCreateWorktreeFormOpen(false);
    setCreateWorktreeBranchName("");
    setCreateWorktreeDisplayName("");
    setCreateWorktreeBaseRef("");
    setCreateWorktreeBaseRefPickerOpen(false);
    setCreateWorktreeBaseRefHighlightedIndex(-1);
    setCreateWorktreeHelpOpen(false);
  }

  function resolveWorkspaceDropPosition(target: HTMLElement, clientY: number): WorkspaceDropPosition {
    const rect = target.getBoundingClientRect();
    return clientY <= rect.top + rect.height / 2 ? "before" : "after";
  }

  function clearWorkspaceDragState() {
    if (workspaceDragCollapseFrameRef.current !== null) {
      cancelAnimationFrame(workspaceDragCollapseFrameRef.current);
      workspaceDragCollapseFrameRef.current = null;
    }

    setDragWorkspaceId(null);
  }

  function clearWorkspacePointerGesture(options?: {
    commit?: boolean;
    preserveClickSuppression?: boolean;
  }) {
    const commit = options?.commit ?? false;
    const preserveClickSuppression = options?.preserveClickSuppression ?? false;
    const gesture = workspacePointerGestureRef.current;
    const cleanup = workspacePointerGestureCleanupRef.current;

    workspacePointerGestureRef.current = null;
    workspacePointerGestureCleanupRef.current = null;
    cleanup?.();

    if (gesture?.dragging) {
      clearWorkspaceDragState();

      if (commit) {
        onCommitWorkspaceReorder();
      }

      if (!preserveClickSuppression && suppressWorkspaceToggleClickRef.current === gesture.workspaceId) {
        suppressWorkspaceToggleClickRef.current = null;
      }
    }
  }

  function handleWorkspaceToggleClick(workspaceId: string) {
    if (suppressWorkspaceToggleClickRef.current === workspaceId) {
      suppressWorkspaceToggleClickRef.current = null;
      return;
    }

    onToggleWorkspaceCollapse(workspaceId);
  }

  function setWorkspaceGroupElement(workspaceId: string, element: HTMLElement | null) {
    if (element) {
      workspaceGroupElementMapRef.current.set(workspaceId, element);
      return;
    }

    workspaceGroupElementMapRef.current.delete(workspaceId);
  }

  function resolveWorkspacePointerDropTarget(clientX: number, clientY: number) {
    for (const [workspaceId, element] of workspaceGroupElementMapRef.current) {
      const rect = element.getBoundingClientRect();

      if (
        clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      ) {
        return {
          workspaceId,
          element
        };
      }
    }

    return null;
  }

  function handleWorkspacePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    workspaceId: string
  ) {
    if (!enableWorkspacePointerReorder || event.button !== 0) {
      return;
    }

    clearWorkspacePointerGesture();

    const pointerTarget = event.currentTarget;
    const gesture: WorkspacePointerReorderGesture = {
      pointerId: event.pointerId,
      workspaceId,
      startX: event.clientX,
      startY: event.clientY,
      pointerTarget,
      dragging: false
    };

    workspacePointerGestureRef.current = gesture;
    pointerTarget.setPointerCapture?.(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      previewWorkspacePointerReorder(moveEvent);
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      finishWorkspacePointerGesture(pointerEvent.pointerId, {
        commit: true,
        preserveClickSuppression: true
      });
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      finishWorkspacePointerGesture(pointerEvent.pointerId, {
        commit: false,
        preserveClickSuppression: false
      });
    };

    workspacePointerGestureCleanupRef.current = () => {
      pointerTarget.removeEventListener("pointermove", handlePointerMove);
      pointerTarget.removeEventListener("pointerup", handlePointerUp);
      pointerTarget.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };

    pointerTarget.addEventListener("pointermove", handlePointerMove);
    pointerTarget.addEventListener("pointerup", handlePointerUp);
    pointerTarget.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  }

  function previewWorkspacePointerReorder(event: {
    pointerId: number;
    clientX: number;
    clientY: number;
    preventDefault: () => void;
  }) {
    const currentGesture = workspacePointerGestureRef.current;

    if (!currentGesture || currentGesture.pointerId !== event.pointerId) {
      return;
    }

    if (!currentGesture.dragging) {
      const distance = Math.hypot(event.clientX - currentGesture.startX, event.clientY - currentGesture.startY);

      if (distance < WORKSPACE_POINTER_REORDER_THRESHOLD_PX) {
        return;
      }

      currentGesture.dragging = true;
      suppressWorkspaceToggleClickRef.current = currentGesture.workspaceId;
      onStartWorkspaceReorder();
      setDragWorkspaceId(currentGesture.workspaceId);
    }

    event.preventDefault();

    const target = resolveWorkspacePointerDropTarget(event.clientX, event.clientY);

    if (!target || target.workspaceId === currentGesture.workspaceId) {
      return;
    }

    onPreviewWorkspaceReorder(
      currentGesture.workspaceId,
      target.workspaceId,
      resolveWorkspaceDropPosition(target.element, event.clientY)
    );
  }

  function finishWorkspacePointerGesture(
    pointerId: number,
    options: {
      commit: boolean;
      preserveClickSuppression: boolean;
    }
  ) {
    const currentGesture = workspacePointerGestureRef.current;

    if (!currentGesture || currentGesture.pointerId !== pointerId) {
      return;
    }

    currentGesture.pointerTarget.releasePointerCapture?.(pointerId);
    clearWorkspacePointerGesture(options);
  }

  function handleWorkspacePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    previewWorkspacePointerReorder(event);
  }

  function handleWorkspacePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    finishWorkspacePointerGesture(event.pointerId, {
      commit: true,
      preserveClickSuppression: true
    });
  }

  function handleWorkspacePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    finishWorkspacePointerGesture(event.pointerId, {
      commit: false,
      preserveClickSuppression: false
    });
  }

  function handleWorkspaceDragStart(
    event: ReactDragEvent<HTMLButtonElement>,
    workspaceId: string
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", workspaceId);
    onStartWorkspaceReorder();

    if (workspaceDragCollapseFrameRef.current !== null) {
      cancelAnimationFrame(workspaceDragCollapseFrameRef.current);
    }

    // 让浏览器先稳定建立拖拽源，再统一临时收起全部工作区。
    // 否则拖拽非第一项时，上方分组瞬间收起会导致源节点跳位，原生拖拽很容易直接失效。
    workspaceDragCollapseFrameRef.current = requestAnimationFrame(() => {
      workspaceDragCollapseFrameRef.current = null;
      setDragWorkspaceId(workspaceId);
    });
  }

  function handleWorkspaceDragOver(
    event: ReactDragEvent<HTMLElement>,
    workspaceId: string
  ) {
    const sourceWorkspaceId = dragWorkspaceId || event.dataTransfer.getData("text/plain");

    if (!sourceWorkspaceId || sourceWorkspaceId === workspaceId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onPreviewWorkspaceReorder(
      sourceWorkspaceId,
      workspaceId,
      resolveWorkspaceDropPosition(event.currentTarget, event.clientY)
    );
  }

  function handleWorkspaceDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
  }

  function handleWorkspaceDragEnd() {
    clearWorkspaceDragState();
    onCommitWorkspaceReorder();
  }

  useEffect(() => () => {
    clearWorkspacePointerGesture();
  }, []);

  function getVisibleSubagentCount(sessionId: string) {
    return visibleSubagentCounts[sessionId] ?? SUBAGENT_PAGE_SIZE;
  }

  function isSubagentListExpanded(sessionId: string) {
    return expandedSubagentRootIds.includes(sessionId);
  }

  function getVisibleWorkspaceSessionCount(workspaceId: string) {
    return visibleWorkspaceSessionCounts[workspaceId] ?? ROOT_SESSION_PAGE_SIZE;
  }

  function handleExpandFavoriteSessions() {
    setVisibleFavoriteCount((current) => Math.min(favoriteSessions.length, current + FAVORITE_SESSION_PAGE_SIZE));
  }

  function handleExpandWorkspaceSessions(workspaceId: string, totalCount: number) {
    setVisibleWorkspaceSessionCounts((current) => ({
      ...current,
      [workspaceId]: Math.min(totalCount, (current[workspaceId] ?? ROOT_SESSION_PAGE_SIZE) + ROOT_SESSION_PAGE_SIZE)
    }));
  }

  function handleExpandSubagents(sessionId: string) {
    setVisibleSubagentCounts((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? SUBAGENT_PAGE_SIZE) + SUBAGENT_PAGE_SIZE
    }));
  }

  function handleToggleSubagentList(sessionId: string) {
    setExpandedSubagentRootIds((current) =>
      current.includes(sessionId) ? current.filter((item) => item !== sessionId) : [...current, sessionId]
    );
  }

  function renderSubagentTreeChildren(input: {
    groups: SubagentRenderGroup[];
    workspace: WorkspaceDto;
    workspaceContext: WorkspaceVisualContext;
    menuKeyPrefix: string;
    showWorkspaceName: boolean;
    selectionMode: boolean;
    favoriteEnabled: boolean;
    nextAncestorHasNextSiblings: readonly boolean[];
    hasMoreSubagents: boolean;
    expansionStateKey: string;
    ancestorExpanded: boolean;
  }) {
    const {
      groups,
      workspace,
      workspaceContext,
      menuKeyPrefix,
      showWorkspaceName,
      selectionMode,
      favoriteEnabled,
      nextAncestorHasNextSiblings,
      hasMoreSubagents,
      expansionStateKey,
      ancestorExpanded
    } = input;
    const visibleChildCount = groups.reduce((count, group) => {
      if (group.key === "closed" && group.collapsedToggle && !group.collapsedToggle.expanded) {
        return count;
      }

      return count + group.nodes.length;
    }, 0);
    let renderedIndex = 0;

    return (
      <div className="workbench-subsession-list">
        {groups.flatMap((group) => {
          if (group.key === "closed" && group.collapsedToggle) {
            const { stateKey, expanded } = group.collapsedToggle;
            const toggleElement = (
              <div key={`${stateKey}:toggle`} className="workbench-session-tree-node">
                <div
                  className="workbench-session-tree-row workbench-closed-subagent-toggle-row"
                  style={
                    {
                      "--workbench-session-tree-depth": 1
                    } as CSSProperties
                  }
                >
                  <div className="workbench-session-tree-guides" aria-hidden="true">
                    <span
                      className="workbench-session-tree-guide-branch"
                      data-continue={visibleChildCount > 0}
                      data-first="true"
                      style={
                        {
                          "--workbench-session-tree-level": 1
                        } as CSSProperties
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="workbench-subsession-expand workbench-closed-subagent-toggle ghost-button"
                    aria-expanded={expanded}
                    onClick={() => handleToggleSubagentList(stateKey)}
                  >
                    <span>{t("shell.closedSubagentToggle")}</span>
                    <span className="workbench-section-counter">{group.count}</span>
                  </button>
                </div>
              </div>
            );

            if (!expanded) {
              return [toggleElement];
            }

            return [
              toggleElement,
              ...group.nodes.map((childEntry) => renderSubagentTreeNode(childEntry, renderedIndex++, visibleChildCount, {
                workspace,
                workspaceContext,
                menuKeyPrefix,
                showWorkspaceName,
                selectionMode,
                favoriteEnabled,
                nextAncestorHasNextSiblings,
                ancestorExpanded
              }))
            ];
          }

          return group.nodes.map((childEntry) => renderSubagentTreeNode(childEntry, renderedIndex++, visibleChildCount, {
            workspace,
            workspaceContext,
            menuKeyPrefix,
            showWorkspaceName,
            selectionMode,
            favoriteEnabled,
            nextAncestorHasNextSiblings,
            ancestorExpanded
          }));
        })}
        {hasMoreSubagents ? (
          <button
            type="button"
            className="workbench-subsession-expand ghost-button"
            onClick={() => handleExpandSubagents(expansionStateKey)}
          >
            {t("shell.subagentExpandMore")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderSubagentTreeNode(
    childEntry: RenderableSessionTreeNode,
    siblingIndex: number,
    visibleChildCount: number,
    input: {
      workspace: WorkspaceDto;
      workspaceContext: WorkspaceVisualContext;
      menuKeyPrefix: string;
      showWorkspaceName: boolean;
      selectionMode: boolean;
      favoriteEnabled: boolean;
      nextAncestorHasNextSiblings: readonly boolean[];
      ancestorExpanded: boolean;
    }
  ) {
    const {
      workspace,
      workspaceContext,
      menuKeyPrefix,
      showWorkspaceName,
      selectionMode,
      favoriteEnabled,
      nextAncestorHasNextSiblings,
      ancestorExpanded
    } = input;

    return renderSessionTreeBranch({
      node: childEntry.node,
      fullNode: childEntry.fullNode,
      branchKey: childEntry.branchKey,
      subagentStateKey: childEntry.subagentStateKey,
      workspace,
      workspaceContext,
      menuKeyPrefix,
      showWorkspaceName,
      selectionMode,
      favoriteEnabled,
      showParallelBadge: childEntry.showParallelBadge,
      forceInactive: childEntry.forceInactive,
      allowToggle: true,
      ancestorHasNextSiblings: nextAncestorHasNextSiblings,
      ancestorExpanded,
      hasNextSibling: siblingIndex < visibleChildCount - 1,
      isFirstSibling: siblingIndex === 0
    });
  }

  function isWorktreeNodeExpanded(workspaceId: string, containsActiveWorkspace: boolean) {
    if (collapsedWorktreeNodeIdSet.has(workspaceId)) {
      return false;
    }

    return containsActiveWorkspace || expandedWorktreeNodeIdSet.has(workspaceId);
  }

  function handleToggleWorktreeNode(workspaceId: string, containsActiveWorkspace: boolean) {
    const nextExpanded = !isWorktreeNodeExpanded(workspaceId, containsActiveWorkspace);

    setWorktreeNodeExpansionState((current) => {
      const expandedWorkspaceIds = current.expandedWorkspaceIds.filter((item) => item !== workspaceId);
      const collapsedWorkspaceIds = current.collapsedWorkspaceIds.filter((item) => item !== workspaceId);

      if (nextExpanded) {
        return {
          expandedWorkspaceIds: [...expandedWorkspaceIds, workspaceId],
          collapsedWorkspaceIds
        };
      }

      return {
        expandedWorkspaceIds,
        collapsedWorkspaceIds: [...collapsedWorkspaceIds, workspaceId]
      };
    });
  }

  function getFavoriteChildSessions(sessionId: string) {
    const node =
      flattenSessionTreeNodes(sidebarNavigationTree).find((item) => item.item.sessionId === sessionId) ?? null;

    return node ? getTreeNodeChildren(node) : [];
  }

  function renderArchiveFolder(workspace: WorkspaceDto, archivedSessions: readonly SessionSummaryDto[]) {
    const workspaceContext = getWorkspaceContext(workspace);

    return (
      <button
        type="button"
        className="workbench-archive-folder"
        data-workspace-tone={workspaceContext.tone}
        style={createWorkspaceToneStyle(workspaceContext)}
        onClick={() => setArchiveWorkspaceId(workspace.id)}
      >
        <span className="workbench-archive-folder-main">
          <FolderArchiveIcon />
          <span>{t("shell.archiveFolderLabel")}</span>
        </span>
        <span className="workbench-section-counter">{archivedSessions.length}</span>
      </button>
    );
  }

  function renderWorkspaceBatchToolbar() {
    return (
      <div className="workbench-workspace-batch-toolbar">
        <span className="workbench-workspace-batch-label">{t("shell.batchSelectionMode")}</span>
        <span className="workbench-workspace-batch-counter">
          {selectedSessionIds.length}/{batchSelectableSessionIds.length}
        </span>
        <button
          type="button"
          className="workbench-workspace-batch-action"
          onClick={handleToggleSelectAllSessions}
        >
          {allBatchSessionsSelected ? t("shell.clearSelectedSessions") : t("shell.selectAllSessions")}
        </button>
        <button
          type="button"
          className="workbench-workspace-batch-action primary"
          disabled={selectedSessionIds.length === 0 || batchArchiving || batchDeleting}
          onClick={() => {
            void handleArchiveSelectedSessions();
          }}
        >
          {batchArchiving ? t("shell.batchArchiving") : t("shell.batchArchiveAction")}
        </button>
        <button
          type="button"
          className="workbench-workspace-batch-action danger"
          disabled={selectedSessionIds.length === 0 || batchArchiving || batchDeleting}
          onClick={handleRequestBatchDeletion}
        >
          {batchDeleting ? t("shell.batchDeleting") : t("shell.batchDeleteAction")}
        </button>
        <button
          type="button"
          className="workbench-workspace-batch-action"
          onClick={handleStopBatchSelection}
        >
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  function renderWorkspaceActionButtons(workspace: WorkspaceDto, className = "workbench-workspace-actions") {
    const workspaceHostId = resolveWorkspaceHostId(workspace);
    const workspaceRef = resolveWorkspaceRefForHost(workspace, workspaceHostId);

    return (
      <div className={className}>
        <button
          type="button"
          className="workbench-workspace-icon-button"
          aria-label={t("shell.switchWorkspace")}
          title={t("shell.switchWorkspace")}
          aria-pressed={activeWorkspaceId === workspace.id}
          onClick={() => {
            onSelectWorkspace(workspace.id, workspaceRef);
            onClose?.();
          }}
        >
          <WorkspaceSwitchIcon />
        </button>
        <button
          type="button"
          className="workbench-workspace-icon-button"
          aria-label={t("shell.batchSelectSessions")}
          title={t("shell.batchSelectSessions")}
          onClick={() => handleStartBatchSelection(workspace.id)}
        >
          <MultiSelectIcon />
        </button>
        <button
          type="button"
          className="workbench-workspace-icon-button workbench-workspace-create"
          aria-label={t("shell.createSession")}
          title={t("shell.createSession")}
          onClick={() => setCreateSessionWorkspaceId(workspace.id)}
        >
          <PlusIcon />
        </button>
      </div>
    );
  }

  function renderWorktreeNode(node: WorkspaceSidebarWorktreeNode): JSX.Element {
    const visibleSessionTree =
      visibleSessionTreeByWorkspaceId.get(node.workspace.id) ?? node.visibleSessionTree;
    const childWorkspaceIdSet = new Set(collectSidebarWorktreeWorkspaceIds(node.children));
    const hasActiveChildWorkspace = childWorkspaceIdSet.has(activeWorkspaceId ?? "");
    const containsActiveWorkspace = node.workspace.id === activeWorkspaceId || hasActiveChildWorkspace;
    const isCollapsed =
      workspaceReorderDragging || !isWorktreeNodeExpanded(node.workspace.id, containsActiveWorkspace);
    const workspaceContext = getWorkspaceContext(node.workspace);

    return (
      <section
        key={node.workspace.id}
        className="workbench-workspace-group"
        data-worktree-node="true"
        data-batch-active={batchWorkspaceId === node.workspace.id}
        data-worktree-depth={node.meta.depth}
        data-workspace-tone="worktree"
        style={createWorkspaceToneStyle(workspaceContext)}
      >
        <div className="workbench-workspace-header minimal">
          <button
            type="button"
            className="workbench-workspace-toggle"
            aria-label={isCollapsed ? t("shell.worktreeExpand") : t("shell.worktreeCollapse")}
            onClick={() => handleToggleWorktreeNode(node.workspace.id, containsActiveWorkspace)}
          >
            <span className="workbench-workspace-toggle-icon" aria-hidden="true">
              <ChevronIcon expanded={!isCollapsed} />
            </span>
              <span
                className="workbench-workspace-title-copy"
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void openWorkspaceContextMenu(
                    node.workspace,
                    { pinDisabled: true },
                    { x: event.clientX, y: event.clientY }
                  );
                }}
              >
              <span className="workbench-workspace-title-line">
                <strong>{node.meta.displayName || node.workspace.name}</strong>
                {renderWorkspaceHostBadge(node.workspace)}
              </span>
              <span className="session-meta">{node.meta.branchName}</span>
            </span>
          </button>

          {batchWorkspaceId === node.workspace.id
            ? renderWorkspaceBatchToolbar()
            : renderWorkspaceActionButtons(node.workspace)}
        </div>

        {!isCollapsed ? (
          <>
            <div
              className="workbench-session-list"
              data-workspace-tone={workspaceContext.tone}
              style={createWorkspaceToneStyle(workspaceContext)}
            >
              {visibleSessionTree.length === 0 ? (
                <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
              ) : (
                visibleSessionTree
                  .slice(0, getVisibleWorkspaceSessionCount(node.workspace.id))
                  .map((treeNode) =>
                    renderSessionTreeBranch({
                      node: treeNode,
                      workspace: node.workspace,
                      workspaceContext,
                      menuKeyPrefix: `worktree:${node.workspace.id}`,
                      showWorkspaceName: false,
                      selectionMode: batchWorkspaceId === node.workspace.id,
                      favoriteEnabled: true
                    })
                  )
              )}
              {visibleSessionTree.length > getVisibleWorkspaceSessionCount(node.workspace.id) ? (
                <button
                  type="button"
                  className="workbench-subsession-expand ghost-button"
                  onClick={() => handleExpandWorkspaceSessions(node.workspace.id, visibleSessionTree.length)}
                >
                  {t("shell.sessionExpandMore")}
                </button>
              ) : null}
            </div>

            {node.children.length > 0 ? (
              <div className="workbench-session-list workbench-worktree-child-list">
                {node.children.map((childNode) => renderWorktreeNode(childNode))}
              </div>
            ) : null}

            {renderArchiveFolder(node.workspace, node.archivedSessions)}
          </>
        ) : null}
      </section>
    );
  }

  function renderSessionTreeBranch(input: {
    node: NavigationSessionTreeNode;
    fullNode?: NavigationSessionTreeNode;
    branchKey?: string;
    subagentStateKey?: string;
    workspace: WorkspaceDto;
    workspaceContext: WorkspaceVisualContext;
    menuKeyPrefix: string;
    showWorkspaceName: boolean;
    selectionMode: boolean;
    favoriteEnabled: boolean;
    showParallelBadge?: boolean;
    forceInactive?: boolean;
    ancestorExpanded?: boolean;
    allowToggle?: boolean;
    ancestorHasNextSiblings?: readonly boolean[];
    hasNextSibling?: boolean;
    isFirstSibling?: boolean;
  }): JSX.Element {
    const {
      node,
      fullNode = node,
      branchKey,
      subagentStateKey,
      workspace,
      workspaceContext,
      menuKeyPrefix,
      showWorkspaceName,
      selectionMode,
      favoriteEnabled,
      showParallelBadge = true,
      forceInactive = false,
      ancestorExpanded = false,
      allowToggle = node.depth === 0,
      ancestorHasNextSiblings = [],
      hasNextSibling = false,
      isFirstSibling = false
    } = input;
    const session = node.item;
    const sessionWorkspace =
      findSidebarWorkspaceById(workspaceGroups, session.workspaceId) ?? workspace;
    const sessionWorkspaceContext = getWorkspaceContext(sessionWorkspace);
    const childNodes = getTreeNodeChildren(fullNode);
    const expansionStateKey = subagentStateKey ?? session.sessionId;
    const locallyExpanded = isSubagentListExpanded(expansionStateKey);
    const inheritedExpanded = ancestorExpanded && getTreeNodeChildren(node).length > 0;
    const subagentListExpanded = locallyExpanded;
    const showSubagentChildren = inheritedExpanded || subagentListExpanded;
    // 只让真正的展开根节点负责子会话分页，递归子节点只消费父节点已经裁好的树，
    // 否则同一棵树会被重复裁剪，冒出多个“展开更多子会话”按钮。
    const shouldPaginateSubagentTree = locallyExpanded && allowToggle;
    const shouldHideClosedSubagentsBehindToggle = showSubagentChildren && allowToggle;
    const visibleNode =
      inheritedExpanded
        ? node
        : shouldPaginateSubagentTree
          ? limitVisibleDescendantTree(
              node,
              getVisibleSubagentCount(expansionStateKey),
              sessionDisplaySortMode,
              shouldHideClosedSubagentsBehindToggle
                ? (candidateNode) => !isClosedSubagentSession(candidateNode.item)
                : undefined
            )
          : fullNode;
    const visibleChildren = showSubagentChildren ? getTreeNodeChildren(visibleNode) : [];
    const totalDescendantCount = flattenSessionTreeNodes(childNodes).filter((childNode) =>
      !shouldHideClosedSubagentsBehindToggle || !isClosedSubagentSession(childNode.item)
    ).length;
    const visibleDescendantCount = flattenSessionTreeNodes(visibleChildren).filter((childNode) =>
      !shouldHideClosedSubagentsBehindToggle || !isClosedSubagentSession(childNode.item)
    ).length;
    const hasMoreSubagents = shouldPaginateSubagentTree && visibleDescendantCount < totalDescendantCount;
    const nextAncestorHasNextSiblings =
      node.depth > 0 ? [...ancestorHasNextSiblings, hasNextSibling] : [...ancestorHasNextSiblings];
    const parallelGroupId = session.parallelGroup?.groupId?.trim() || null;
    const shouldProjectParallelAnchorChildren =
      session.parallelGroup?.role === "anchor"
      && session.parallelGroup?.sourceType === "new"
      && Boolean(parallelGroupId);
    const directParallelMemberChildren =
      shouldProjectParallelAnchorChildren && parallelGroupId
        ? visibleChildren.filter((childNode) => childNode.item.parallelGroup?.groupId === parallelGroupId)
        : [];
    const directNonParallelChildren = visibleChildren.filter(
      (childNode) => childNode.item.parallelGroup?.groupId !== parallelGroupId
    );
    const fullParallelMemberChildren =
      shouldProjectParallelAnchorChildren && parallelGroupId
        ? childNodes.filter((childNode) => childNode.item.parallelGroup?.groupId === parallelGroupId)
        : [];
    const fullNonParallelChildren = childNodes.filter(
      (childNode) => childNode.item.parallelGroup?.groupId !== parallelGroupId
    );
    const anchorProjectionChildren =
      directParallelMemberChildren.length > 0 ? directNonParallelChildren : [];
    const renderableChildren: RenderableSessionTreeNode[] =
      directParallelMemberChildren.length > 0
        ? [
            createProjectedNavigationTreeNode({
              session,
              depth: node.depth + 1,
              children: anchorProjectionChildren.map((childNode) => offsetNavigationTreeDepth(childNode, 1))
            }),
            ...directParallelMemberChildren
          ].map((childNode, index) => {
            const isAnchorProjection = index === 0;
            const fullProjectionNode = createProjectedNavigationTreeNode({
              session,
              depth: node.depth + 1,
              children: fullNonParallelChildren.map((fullChildNode) => offsetNavigationTreeDepth(fullChildNode, 1))
            });
            return {
              node: childNode,
              fullNode: isAnchorProjection
                ? fullProjectionNode
                : fullParallelMemberChildren.find((fullChildNode) => fullChildNode.item.sessionId === childNode.item.sessionId)
                  ?? childNode,
              branchKey: isAnchorProjection ? buildParallelAnchorProjectionKey(session.sessionId) : undefined,
              subagentStateKey: isAnchorProjection
                ? buildParallelAnchorProjectionKey(session.sessionId)
                : undefined,
              showParallelBadge: !isAnchorProjection,
              forceInactive: isAnchorProjection
            };
          })
        : visibleChildren.map((childNode) => ({
            node: childNode,
            fullNode: childNodes.find((item) => item.item.sessionId === childNode.item.sessionId) ?? childNode
          }));
    const closedSubagentStateKey = buildClosedSubagentStateKey(expansionStateKey);
    const closedSubagentExpanded = isSubagentListExpanded(closedSubagentStateKey);
    const closedChildren = childNodes
      .filter((childNode) => isClosedSubagentSession(childNode.item))
      .map((childNode) => ({
        node: childNode,
        fullNode: childNode
      }));
    const openChildren = renderableChildren.filter((childEntry) => !isClosedSubagentSession(childEntry.node.item));
    const subagentGroups: SubagentRenderGroup[] = [
      ...(closedChildren.length > 0
        ? [{
            key: "closed" as const,
            nodes: closedChildren,
            count: closedChildren.length,
            collapsedToggle: {
              stateKey: closedSubagentStateKey,
              expanded: closedSubagentExpanded
            }
          }]
        : []),
      ...(openChildren.length > 0
        ? [{
            key: "open" as const,
            nodes: openChildren,
            count: openChildren.length
          }]
        : [])
    ];

    return (
      <div key={branchKey ?? session.sessionId} className="workbench-session-tree-node">
        <div
          className="workbench-session-tree-row"
          style={
            {
              "--workbench-session-tree-depth": node.depth
            } as CSSProperties
          }
        >
          {node.depth > 0 ? (
            <div className="workbench-session-tree-guides" aria-hidden="true">
              {ancestorHasNextSiblings.map((continues, index) =>
                continues ? (
                  <span
                    key={`${session.sessionId}:ancestor:${index}`}
                    className="workbench-session-tree-guide-column"
                    style={
                      {
                        "--workbench-session-tree-level": index + 1
                      } as CSSProperties
                    }
                  />
                ) : null
              )}
              <span
                className="workbench-session-tree-guide-branch"
                data-continue={hasNextSibling}
                data-first={isFirstSibling}
                style={
                  {
                    "--workbench-session-tree-level": node.depth
                  } as CSSProperties
                }
              >
                <span className="workbench-session-tree-guide-branch-horizontal" />
              </span>
            </div>
          ) : null}
          <SessionCard
            menuKey={`${menuKeyPrefix}:${branchKey ?? session.sessionId}`}
            session={session}
            workspace={sessionWorkspace}
            workspaceContext={sessionWorkspaceContext}
            isActive={!forceInactive && session.sessionId === activeSessionId}
            isFavorite={favoriteEnabled && favoriteSessionIds.has(session.sessionId)}
            menuOpen={openSessionMenuKey === `${menuKeyPrefix}:${branchKey ?? session.sessionId}`}
            showWorkspaceName={showWorkspaceName}
            depth={node.depth}
            showActions={favoriteEnabled}
            exportDisabled={exportingSessionId !== null}
            hasSubagents={allowToggle && childNodes.length > 0}
            subagentListExpanded={subagentListExpanded}
            showParallelBadge={showParallelBadge}
            selectionMode={selectionMode}
            selected={selectedSessionIdSet.has(session.sessionId)}
            onToggleSelect={() => handleToggleSessionSelection(session.sessionId)}
            onToggleSubagents={() => handleToggleSubagentList(expansionStateKey)}
            onOpen={() => {
              const targetWorkspaceHostId = resolveWorkspaceHostId(sessionWorkspace);
              const targetWorkspaceRef = resolveWorkspaceRefForHost(sessionWorkspace, targetWorkspaceHostId) ?? undefined;
              onSelectWorkspace(sessionWorkspace.id, targetWorkspaceRef);
              navigate(buildWorkspaceSessionPath(sessionWorkspace.id, session.sessionId, targetWorkspaceRef));
              onClose?.();
            }}
            onRename={() => handleOpenRenameSession(session, sessionWorkspace)}
            menuAnchorPoint={
              openSessionMenuKey === `${menuKeyPrefix}:${branchKey ?? session.sessionId}`
                ? openSessionMenuAnchorPoint
                : null
            }
            onOpenContextMenu={(anchorPoint) =>
              openSessionMenu(`${menuKeyPrefix}:${branchKey ?? session.sessionId}`, anchorPoint)
            }
            onExport={(format) => handleExportSession(session, format)}
            onToggleFavorite={() => handleToggleFavorite(session.sessionId)}
            onArchive={() => handleArchive(session.sessionId)}
            onDelete={
                      createDraftCapabilities(session.provider).supportsSessionDelete === true
                        ? () => {
                            closeSessionMenu();
                            setSessionDeletionTarget({
                              session,
                              workspace: sessionWorkspace
                            });
                          }
                        : undefined
            }
            onCloseMenu={closeSessionMenu}
          />
        </div>
        {childNodes.length > 0 && showSubagentChildren
          ? renderSubagentTreeChildren({
              groups: subagentGroups,
              workspace,
              workspaceContext,
              menuKeyPrefix,
              showWorkspaceName,
              selectionMode,
              favoriteEnabled,
              nextAncestorHasNextSiblings,
              hasMoreSubagents,
              expansionStateKey,
              ancestorExpanded: showSubagentChildren
            })
          : null}
      </div>
    );
  }

  function renderLightweightChatSection() {
    const workspace =
      (activeWorkspaceId ? workspaceGroups.find((group) => group.workspace.id === activeWorkspaceId)?.workspace ?? null : null)
      ?? workspaceGroups[0]?.workspace
      ?? null;
    const sessions = workspace
      ? (lightweightChatSessionsByWorkspaceId[workspace.id] ?? []).filter((session) => session.isFavorite !== true)
      : [];
    const archivedSessions = workspace ? lightweightArchivedChatSessionsByWorkspaceId[workspace.id] ?? [] : [];
    const workspaceContext = workspace ? getWorkspaceContext(workspace) : null;

    return (
      <section className="workbench-section-block workbench-workspace-section workbench-chat-section" aria-label={t("shell.chatSectionTitle")}>
        <div className="workbench-section-heading">
          <div className="workbench-section-heading-main">
            <span>{t("shell.chatSectionTitle")}</span>
          </div>
          <div className="workbench-section-actions">
            {workspace ? (
              <button
                type="button"
                className="workbench-workspace-icon-button"
                aria-label={t("shell.chatNewAction")}
                title={t("shell.chatNewAction")}
                onClick={() => {
                  onCreateLightweightChat(workspace);
                  onClose?.();
                }}
              >
                <PlusIcon />
              </button>
            ) : null}
          </div>
        </div>
	        <div className="workbench-session-list workbench-chat-list">
	          {!workspace || sessions.length === 0 ? (
	            <p className="workbench-session-empty">{t("shell.chatSectionEmpty")}</p>
	          ) : sessions.map((session) => {
	            const titlePresentation = buildSessionTitlePresentation(session.title, t("shell.untitledSession"));
	            const active = activeLightweightChatId === session.sessionId;
              const menuKey = `lightweight-chat:${workspace.id}:${session.sessionId}`;
              const lightweightEntry = {
                session,
                workspace
              } satisfies LightweightChatSessionEntry;

	            return (
                <div key={session.sessionId}>
                  <SessionCard
                    menuKey={menuKey}
                    cardClassName="workbench-chat-card"
                    session={session}
                    workspace={workspace}
                    workspaceContext={workspaceContext ?? createFallbackWorkspaceVisualContext(workspace)}
                    isActive={active}
                    isFavorite={session.isFavorite === true}
                    menuOpen={openSessionMenuKey === menuKey}
                    showWorkspaceName={false}
                    hideMetaRow
                    depth={0}
                    showActions
                    exportDisabled
                    onExport={() => undefined}
                    menuAnchorPoint={openSessionMenuKey === menuKey ? openSessionMenuAnchorPoint : null}
                    onOpenContextMenu={(anchorPoint) => openSessionMenu(menuKey, anchorPoint)}
                    onOpen={() => {
                      onOpenLightweightChat(workspace, session);
                      onClose?.();
                    }}
                    onRename={() => {
                      closeSessionMenu();
                      setLightweightChatRenameTarget(lightweightEntry);
                      setRenameTitleValue(session.title);
                    }}
                    onToggleFavorite={async () => {
                      try {
                        await onToggleLightweightChatFavorite(workspace, session);
                      } catch (error) {
                        showToast({
                          title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
                          tone: "error"
                        });
                      }
                    }}
                    onArchive={async () => {
                      try {
                        await onArchiveLightweightChat(workspace, session);
                      } catch (error) {
                        showToast({
                          title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
                          tone: "error"
                        });
                      }
                    }}
                    onDelete={() => {
                      closeSessionMenu();
                      setLightweightChatDeletionTarget(lightweightEntry);
                    }}
                    onCloseMenu={closeSessionMenu}
                  />
	                </div>
	            );
	          })}
            {workspace && archivedSessions.length > 0
              ? (
                <button
                  type="button"
                  className="workbench-archive-folder"
                  data-workspace-tone={workspaceContext?.tone ?? "root"}
                  style={createWorkspaceToneStyle(workspaceContext)}
                  onClick={() => setLightweightChatArchiveWorkspaceId(workspace.id)}
                >
                  <span className="workbench-archive-folder-main">
                    <FolderArchiveIcon />
                    <span>{t("shell.archiveFolderLabel")}</span>
                  </span>
                  <span className="workbench-section-counter">{archivedSessions.length}</span>
                </button>
              )
              : null}
	        </div>
	      </section>
	    );
  }

  function handleStartBatchSelection(workspaceId: string) {
    closeSessionMenu();
    setBatchWorkspaceId(workspaceId);
    setSelectedSessionIds([]);
    setBatchSessionDeletionTarget(null);
  }

  function handleStopBatchSelection() {
    setBatchWorkspaceId(null);
    setSelectedSessionIds([]);
    setBatchSessionDeletionTarget(null);
  }

  function handleToggleSessionSelection(sessionId: string) {
    setSelectedSessionIds((current) => toggleStoredId(current, sessionId));
  }

  function handleToggleSelectAllSessions() {
    setSelectedSessionIds((current) =>
      current.length === batchSelectableSessionIds.length ? [] : batchSelectableSessionIds
    );
  }

  function handleRequestBatchDeletion() {
    if (!activeBatchWorkspaceTarget || selectedSessionIds.length === 0 || batchArchiving || batchDeleting) {
      return;
    }

    const sessionById = new Map(batchSelectableSessions.map((session) => [session.sessionId, session] as const));
    const targetSessions = selectedSessionIds.flatMap((sessionId) => {
      const session = sessionById.get(sessionId);
      return session ? [session] : [];
    });

    if (targetSessions.length === 0) {
      return;
    }

    closeSessionMenu();
    setBatchSessionDeletionTarget({
      workspace: activeBatchWorkspaceTarget.workspace,
      sessions: targetSessions
    });
  }

  async function handleStartSession(workspaceId: string, provider: ProviderId) {
    setActionWorkspaceId(workspaceId);
    setActionProvider(provider);

    try {
      const workspace = workspaceGroups.find((item) => item.workspace.id === workspaceId)?.workspace ?? null;
      const workspaceRef = workspace
        ? resolveWorkspaceRefForHost(workspace, resolveWorkspaceHostId(workspace))
        : null;
      const targetHostId = workspaceRef?.hostId && workspaceRef.hostId !== "current" ? workspaceRef.hostId : null;
      const targetWorkspaceId = workspaceRef?.workspaceId?.trim() || workspaceId;

      await assertProviderCanStartDraftSession(targetWorkspaceId, provider, targetHostId);
      setCreateSessionWorkspaceId(null);
      navigate(
        buildDraftSessionPath(
          workspaceId,
          provider,
          workspaceRef
        )
      );
      onClose?.();
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.startSessionFailed"),
        tone: "error"
      });
    } finally {
      setActionWorkspaceId(null);
      setActionProvider(null);
    }
  }

  async function handleCreateChildWorktree(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createSessionWorkspace || creatingWorktree) {
      return;
    }

    const branchName = createWorktreeBranchName.trim();
    const displayName = createWorktreeDisplayName.trim();
    const baseRef = createWorktreeBaseRef.trim();

    if (!branchName) {
      showToast({
        title: t("shell.createWorktreeBranchRequired"),
        tone: "error"
      });
      return;
    }

    if (!isRecommendedWorktreeBranchName(branchName)) {
      showToast({
        title: t("shell.createWorktreeBranchInvalid"),
        tone: "error"
      });
      return;
    }

    setCreatingWorktree(true);

    try {
      const created = await createWorktree({
        sourceWorkspaceId: createSessionWorkspace.id,
        branchName,
        displayName: displayName || undefined,
        baseRef: baseRef || undefined
      });

      setCreateSessionWorkspaceDraft(created.workspace);
      onSelectWorkspace(created.workspace.id);
      await onRefreshNavigation();
      setCreateSessionWorkspaceId(created.workspace.id);
      resetCreateWorktreeForm();
      showToast({
        title: t("shell.createWorktreeSucceeded", {
          name: created.meta.displayName || created.workspace.name
        }),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.createWorktreeFailed"),
        tone: "error"
      });
    } finally {
      setCreatingWorktree(false);
    }
  }

  async function handleToggleFavorite(sessionId: string) {
    const isFavorite = favoriteSessionIds.has(sessionId);
    closeSessionMenu();

    try {
      await onToggleFavoriteSession(sessionId);
      showToast({
        title: isFavorite ? t("shell.favoriteRemoved") : t("shell.favoriteAdded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.favoriteToggleFailed"),
        tone: "error"
      });
    }
  }

  async function handleArchive(sessionId: string) {
    closeSessionMenu();

    try {
      await onArchiveSession(sessionId);
      showToast({
        title: t("shell.archiveAdded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
        tone: "error"
      });
    }
  }

  async function handleExportSession(session: SessionSummaryDto, format: SessionExportFormat) {
    if (exportingSessionId) {
      return;
    }

    closeSessionMenu();
    setExportingSessionId(session.sessionId);

    try {
      const snapshot = await loadSessionExportSnapshot(session.sessionId, currentTargetHostId);
      const exportLayout = captureSessionExportLayoutSnapshot();

      if (format === "md") {
        const fileName = buildSessionExportFileName(session, "md");
        const markdown = buildSessionMarkdownExport(session, snapshot.messages);
        downloadTextFile(fileName, markdown, "text/markdown;charset=utf-8");
        showToast({
          title: t("conversation.exportMarkdownSuccess"),
          tone: "success"
        });
        return;
      }

      flushSync(() => {
        setExportRenderJob({
          session,
          items: buildConversationTimelineSourceItems({
            messages: snapshot.messages
          }),
          shellWidthPx: exportLayout.shellWidthPx
        });
      });

      await waitForSessionExportRender(exportRenderRootRef.current);

      const exportMarkup = exportRenderRootRef.current?.innerHTML.trim() ?? "";

      if (!exportMarkup) {
        throw new Error(t("conversation.exportLoadFailed"));
      }

      const htmlAttributes = collectSessionExportAttributes(document.documentElement);
      const bodyAttributes = document.body ? collectSessionExportAttributes(document.body) : {};
      const htmlStyle = document.documentElement.getAttribute("style");
      const bodyStyle = document.body?.getAttribute("style") ?? null;
      const exportStyleText = `${collectSessionExportStyles()}\n${STANDALONE_SESSION_EXPORT_OVERRIDES}`;
      const htmlDocument = buildStandaloneSessionExportHtml({
        title: session.title || t("conversation.titleFallback"),
        bodyHtml: `<div class="session-export-document-root">${exportMarkup}</div>`,
        styleText: exportStyleText,
        htmlAttributes,
        bodyAttributes,
        htmlStyle,
        bodyStyle
      });

      if (format === "html") {
        const fileName = buildSessionExportFileName(session, "html");
        downloadTextFile(fileName, htmlDocument, "text/html;charset=utf-8");
        showToast({
          title: t("conversation.exportHtmlSuccess"),
          tone: "success"
        });
        return;
      }

      const fileName = buildSessionExportFileName(session, "pdf");
      const pdfBytes = buildSessionPdfExport(session, snapshot.messages);
      downloadBinaryFile(fileName, pdfBytes, "application/pdf");
      showToast({
        title: t("conversation.exportPdfPreparing"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.exportLoadFailed"),
        tone: "error"
      });
    } finally {
      flushSync(() => {
        setExportRenderJob(null);
      });
      setExportingSessionId(null);
    }
  }

  async function handleConfirmSessionDeletion() {
    if (!sessionDeletionTarget || deletingSessionId) {
      return;
    }

    const { session, workspace } = sessionDeletionTarget;
    setDeletingSessionId(session.sessionId);
    closeSessionMenu();

    try {
      await deleteSession(session.sessionId, { targetHostId: currentTargetHostId });
      setSelectedSessionIds((current) => current.filter((item) => item !== session.sessionId));
      setSessionDeletionTarget(null);

      if (activeSessionId === session.sessionId) {
        navigate(
          workspace.id
            ? buildWorkspaceSessionIndexPath(workspace.id)
            : buildWorkspaceHomePath()
        );
      }
      await onRefreshNavigation();
      showToast({
        title: t("shell.deleteSessionSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.deleteSessionFailed"),
        tone: "error"
      });
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleArchiveSelectedSessions() {
    if (selectedSessionIds.length === 0 || batchArchiving || batchDeleting) {
      return;
    }

    closeSessionMenu();
    setBatchArchiving(true);

    try {
      const targetSessionIds = [...selectedSessionIds];
      const results = await Promise.allSettled(
        targetSessionIds.map(async (sessionId) => ({
          sessionId,
          session: await updateSessionArchiveState(sessionId, true, { targetHostId: currentTargetHostId })
        }))
      );

      const succeededSessionIds: string[] = [];
      let failedCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          succeededSessionIds.push(result.value.sessionId);
          onSessionUpdated(result.value.session);
          continue;
        }

        failedCount += 1;
      }

      if (succeededSessionIds.length > 0) {
        await onRefreshNavigation();
        setSelectedSessionIds((current) =>
          current.filter((sessionId) => !succeededSessionIds.includes(sessionId))
        );
      }

      if (failedCount > 0) {
        showToast({
          title:
            succeededSessionIds.length > 0
              ? t("shell.batchArchivePartialFailed")
              : t("shell.batchArchiveFailed"),
          tone: "error"
        });
      } else {
        showToast({
          title: t("shell.batchArchiveSuccess"),
          tone: "success"
        });
      }
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.batchArchiveFailed"),
        tone: "error"
      });
    } finally {
      setBatchArchiving(false);
    }
  }

  async function handleConfirmBatchDeletion() {
    if (!batchSessionDeletionTarget || batchDeleting) {
      return;
    }

    const { workspace, sessions } = batchSessionDeletionTarget;
    const targetSessionIds = sessions.map((session) => session.sessionId);

    if (targetSessionIds.length === 0) {
      setBatchSessionDeletionTarget(null);
      return;
    }

    setBatchDeleting(true);
    closeSessionMenu();

    try {
      const results = await Promise.allSettled(
        targetSessionIds.map(async (sessionId) => {
          await deleteSession(sessionId, { targetHostId: currentTargetHostId });
          return sessionId;
        })
      );

      const succeededSessionIds: string[] = [];
      let failedCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          succeededSessionIds.push(result.value);
          continue;
        }

        failedCount += 1;
      }

      if (succeededSessionIds.length > 0) {
        if (activeSessionId && succeededSessionIds.includes(activeSessionId)) {
          navigate(
            workspace.id
              ? buildWorkspaceSessionIndexPath(workspace.id)
              : buildWorkspaceHomePath()
          );
        }

        setSelectedSessionIds((current) => current.filter((sessionId) => !succeededSessionIds.includes(sessionId)));
        await onRefreshNavigation();
      }

      if (failedCount > 0) {
        setBatchSessionDeletionTarget((current) => {
          if (!current) {
            return current;
          }

          const remainingSessions = current.sessions.filter(
            (session) => !succeededSessionIds.includes(session.sessionId)
          );

          return remainingSessions.length > 0
            ? {
                ...current,
                sessions: remainingSessions
              }
            : null;
        });
        showToast({
          title:
            succeededSessionIds.length > 0
              ? t("shell.batchDeletePartialFailed")
              : t("shell.batchDeleteFailed"),
          tone: "error"
        });
        return;
      }

      setBatchSessionDeletionTarget(null);
      showToast({
        title: t("shell.batchDeleteSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.batchDeleteFailed"),
        tone: "error"
      });
    } finally {
      setBatchDeleting(false);
    }
  }

  async function handleUnarchive(sessionId: string) {
    closeSessionMenu();

    try {
      await onUnarchiveSession(sessionId);
      showToast({
        title: t("shell.archiveRestored"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
        tone: "error"
      });
    }
  }

  async function handleUnarchiveLightweightChat(sessionId: string) {
    const workspaceId = lightweightChatArchiveWorkspaceId;

    if (!workspaceId) {
      return;
    }

    closeSessionMenu();

    try {
      const workspace =
        workspaceGroups.find((group) => group.workspace.id === workspaceId)?.workspace ?? null;

      if (!workspace) {
        return;
      }

      await onUnarchiveLightweightChat(workspace, sessionId);
      showToast({
        title: t("shell.archiveRestored"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
        tone: "error"
      });
    }
  }

  function handleOpenRenameSession(session: SessionSummaryDto, workspace: WorkspaceDto) {
    closeSessionMenu();
    setRenameTarget({ session, workspace });
    setRenameTitleValue(session.title);
  }

  async function handleRenameSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!renameTarget) {
      return;
    }

    const nextTitle = renameTitleValue.trim();

    if (!nextTitle) {
      return;
    }

    setRenamingSessionId(renameTarget.session.sessionId);

    try {
      const renamedSession = await renameSessionTitle(renameTarget.session.sessionId, nextTitle, { targetHostId: currentTargetHostId });
      onSessionUpdated(renamedSession);
      setRenameTarget(null);
      setRenameTitleValue("");
      showToast({
        title: t("shell.renameSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.renameFailed"),
        tone: "error"
      });
    } finally {
      setRenamingSessionId(null);
    }
  }

  async function handleRenameLightweightChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!lightweightChatRenameTarget) {
      return;
    }

    const nextTitle = renameTitleValue.trim();

    if (!nextTitle) {
      return;
    }

    setRenamingSessionId(lightweightChatRenameTarget.session.sessionId);

    try {
      await onRenameLightweightChat(
        lightweightChatRenameTarget.workspace,
        lightweightChatRenameTarget.session.sessionId,
        nextTitle
      );
      setLightweightChatRenameTarget(null);
      setRenameTitleValue("");
      showToast({
        title: t("shell.renameSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.renameFailed"),
        tone: "error"
      });
    } finally {
      setRenamingSessionId(null);
    }
  }

  async function handleConfirmLightweightChatDeletion() {
    if (!lightweightChatDeletionTarget || deletingSessionId) {
      return;
    }

    const { session, workspace } = lightweightChatDeletionTarget;
    setDeletingSessionId(session.sessionId);
    closeSessionMenu();

    try {
      await onDeleteLightweightChat(workspace, session);
      setLightweightChatDeletionTarget(null);

      if (activeLightweightChatId === session.sessionId) {
        navigate(buildWorkspaceChatIndexPath(workspace.id));
      }

      showToast({
        title: t("shell.deleteSessionSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.deleteSessionFailed"),
        tone: "error"
      });
    } finally {
      setDeletingSessionId(null);
    }
  }

  const visibleFavoriteSessions = favoriteSessions.slice(0, visibleFavoriteCount);
  const hasMoreFavoriteSessions = visibleFavoriteSessions.length < favoriteSessions.length;

  function getWorkspaceContext(workspace: WorkspaceDto) {
    return workspaceVisualContextMap[workspace.id] ?? createFallbackWorkspaceVisualContext(workspace);
  }

  function renderManagedWorkspaceItem(
    workspace: WorkspaceDto,
    ownSessionCount: number,
    childNodes: readonly WorkspaceSidebarWorktreeNode[],
    isWorktree: boolean,
    ancestorDisplayNames: readonly string[] = []
  ): JSX.Element {
    const isExpanded = expandedManagedWorkspaceIds.includes(workspace.id);
    const managementState = workspaceManagementStateById[workspace.id] ?? {
      detail: null,
      loading: false,
      error: null
    };
    const isRemovingCurrentWorkspace = removingWorkspaceId === workspace.id;
    const isSavingColor = workspaceNavigationSavingById[workspace.id] === true;
    const remoteSummary =
      managementState.detail?.git.remotes.length
        ? managementState.detail.git.remotes
            .map((remote) => `${remote.name}: ${remote.url}`)
            .join(" · ")
        : t("shell.manageWorkspaceNoRemote");
    const compositionChartItems = managementState.detail
      ? buildWorkspaceCompositionChartItems(
          managementState.detail.codeComposition.items,
          t("shell.manageWorkspaceCodeCompositionOther")
        )
      : [];
    const compositionChartStyle =
      compositionChartItems.length > 0
        ? createWorkspaceCompositionChartStyle(compositionChartItems)
        : undefined;
    const workspaceContext = getWorkspaceContext(workspace);
    const treePathLabel = buildManagedWorkspaceTreePath(workspaceContext, ancestorDisplayNames);
    const nextAncestorDisplayNames = [...ancestorDisplayNames, workspaceContext.displayName];

    return (
      <article
        key={workspace.id}
        className="workbench-manage-item"
        data-workspace-tone={workspaceContext.tone}
        data-worktree-node={isWorktree}
        style={createWorkspaceToneStyle(workspaceContext)}
      >
        <button
          type="button"
          className="workbench-manage-item-toggle"
          aria-expanded={isExpanded}
          onClick={() => handleToggleManagedWorkspace(workspace.id)}
        >
          <span className="workbench-manage-item-heading">
            <ChevronIcon expanded={isExpanded} />
            <span className="workbench-manage-item-heading-copy">
              <span className="workbench-manage-item-title-line">
                <strong>{workspaceContext.displayName}</strong>
                {renderWorkspaceHostBadge(workspace, "workspace-host-badge--manage")}
              </span>
              <span className="workbench-manage-item-tree-path">{treePathLabel}</span>
            </span>
          </span>
          <span className="workbench-section-counter">{ownSessionCount}</span>
        </button>

        {isExpanded ? (
          <div className="workbench-manage-item-body">
            <div className="workbench-manage-detail-block">
              <span className="workbench-manage-detail-label">
                {t("shell.manageWorkspacePathLabel")}
              </span>
              <p className="workbench-manage-detail-value">{workspace.path}</p>
            </div>

            <div className="workbench-manage-detail-block">
              <div className="workbench-manage-detail-header">
                <span className="workbench-manage-detail-label">
                  {t("shell.manageWorkspaceHostLabel")}
                </span>
                {renderWorkspaceHostBadge(workspace, "workspace-host-badge--inline")}
              </div>
              <label className="workbench-manage-host-select-row">
                <span className="sr-only">{t("shell.manageWorkspaceHostSelectLabel")}</span>
                <select
                  className="workbench-manage-host-select"
                  value={resolveWorkspaceHostId(workspace)}
                  onChange={(event) => {
                    void handleChangeWorkspaceHost(workspace, event.currentTarget.value);
                  }}
                >
                  {selectableWorkspaceHosts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id === "current"
                        ? t("shell.manageWorkspaceHostCurrentOption", { alias: getHostAlias(item.host) })
                        : t("shell.manageWorkspaceHostPeerOption", { alias: getHostAlias(item.host) })}
                    </option>
                  ))}
                </select>
              </label>
              <p className="workbench-manage-hint">
                {t("shell.manageWorkspaceHostHint", { hostName: resolveWorkspaceHost(workspace)?.name ?? getHostAlias(resolveWorkspaceHost(workspace)) })}
              </p>
            </div>

            {isWorktree ? (
              <div className="workbench-manage-detail-block">
                <div className="workbench-manage-detail-header">
                  <span className="workbench-manage-detail-label">
                    {t("shell.manageWorkspaceColorLabel")}
                  </span>
                  <div className="workbench-manage-color-actions">
                    <div className="workbench-manage-color-palette" aria-label={t("shell.manageWorkspaceColorLabel")}>
                      {WORKSPACE_COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="workbench-manage-color-swatch"
                          aria-label={t("shell.manageWorkspaceColorSelectSwatch", {
                            color
                          })}
                          aria-pressed={workspace.backgroundColor === color}
                          disabled={isSavingColor}
                          data-selected={workspace.backgroundColor === color}
                          style={{ backgroundColor: color }}
                          onClick={() => {
                            void handleUpdateWorkspaceBackgroundColor(workspace.id, color);
                          }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={isSavingColor || !workspace.backgroundColor}
                      onClick={() => {
                        void handleUpdateWorkspaceBackgroundColor(workspace.id, null);
                      }}
                    >
                      {t("shell.manageWorkspaceColorClearAction")}
                    </button>
                  </div>
                </div>
                <p className="workbench-manage-hint">
                  {workspace.backgroundColor ?? t("shell.manageWorkspaceColorUnset")}
                </p>
              </div>
            ) : null}

            {managementState.loading && managementState.detail === null ? (
              <p className="workbench-manage-status status-text">
                {t("shell.manageWorkspaceLoading")}
              </p>
            ) : null}

            {managementState.error ? (
              <p className="workbench-manage-status status-text" data-tone="error">
                {managementState.error}
              </p>
            ) : null}

            {managementState.detail ? (
              <>
                <div className="workbench-manage-detail-block">
                  <div className="workbench-manage-detail-header">
                    <span className="workbench-manage-detail-label">
                      {t("shell.manageWorkspaceGitCommitCount")}
                    </span>
                    <strong className="workbench-manage-detail-accent">
                      {managementState.detail.git.commitCount ?? "--"}
                    </strong>
                  </div>
                </div>

                <div className="workbench-manage-detail-block">
                  <span className="workbench-manage-detail-label">
                    {t("shell.manageWorkspaceGitInfoLabel")}
                  </span>
                  {managementState.detail.git.isRepository ? (
                    <div className="workbench-manage-kv-list">
                      <div className="workbench-manage-kv-item">
                        <span>{t("shell.manageWorkspaceRepoRoot")}</span>
                        <span>{managementState.detail.git.repoRoot ?? "--"}</span>
                      </div>
                      <div className="workbench-manage-kv-item">
                        <span>{t("shell.manageWorkspaceCurrentBranch")}</span>
                        <span>{managementState.detail.git.currentBranch ?? "--"}</span>
                      </div>
                      <div className="workbench-manage-kv-item">
                        <span>{t("shell.manageWorkspaceRemoteLabel")}</span>
                        <span>{remoteSummary}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="workbench-section-empty">
                      {managementState.detail.git.error ?? t("shell.manageWorkspaceNotGit")}
                    </p>
                  )}
                </div>

                <div className="workbench-manage-detail-block">
                  <span className="workbench-manage-detail-label">
                    {t("shell.manageWorkspaceCodeCompositionLabel")}
                  </span>
                  {compositionChartItems.length > 0 ? (
                    <div className="workbench-manage-type-chart">
                      <div
                        className="workbench-manage-type-chart-ring"
                        style={compositionChartStyle}
                        aria-hidden="true"
                      >
                        <strong className="workbench-manage-type-chart-total">
                          {managementState.detail.codeComposition.scannedFileCount}
                        </strong>
                        <span className="workbench-manage-type-chart-caption">
                          {t("shell.manageWorkspaceCodeCompositionFiles")}
                        </span>
                      </div>

                      <div className="workbench-manage-type-list">
                        {compositionChartItems.map((item) => (
                          <div key={item.key} className="workbench-manage-type-item">
                            <span className="workbench-manage-type-meta">
                              <span
                                className="workbench-manage-type-swatch"
                                style={{ backgroundColor: item.color }}
                                aria-hidden="true"
                              />
                              <span className="workbench-manage-type-name">{item.type}</span>
                            </span>
                            <span>
                              {item.count} · {formatWorkspaceCompositionRatio(item)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="workbench-section-empty">
                      {managementState.detail.codeComposition.error ??
                        t("shell.manageWorkspaceNoCodeComposition")}
                    </p>
                  )}
                  {managementState.detail.codeComposition.truncated ? (
                    <p className="workbench-manage-hint">
                      {t("shell.manageWorkspaceCodeTruncated", {
                        count: managementState.detail.codeComposition.scannedFileCount
                      })}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="workbench-modal-actions">
              <button
                type="button"
                className="secondary-button workbench-danger-button"
                disabled={Boolean(removingWorkspaceId)}
                onClick={() => setWorkspaceRemovalTarget(workspace)}
              >
                {isRemovingCurrentWorkspace
                  ? t("shell.manageWorkspaceRemoving")
                  : t("shell.manageWorkspaceRemoveAction")}
              </button>
            </div>
          </div>
        ) : null}

        {childNodes.length > 0 ? (
          <div className="workbench-manage-children">
            {childNodes.map((childNode) =>
              renderManagedWorkspaceItem(
                childNode.workspace,
                childNode.visibleSessions.length + childNode.archivedSessions.length,
                childNode.children,
                true,
                nextAncestorDisplayNames
              )
            )}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <>
      <div
        className="workbench-nav-header"
        data-window-drag-handle="workbench-nav-header"
        data-tauri-drag-region={macOsNativeTitlebarDragRegion}
      >
        <div
          className="workbench-nav-toolbar"
          data-tauri-drag-region={macOsNativeTitlebarDragRegion}
        >
          {onToggleCollapse ? (
            <button
              type="button"
              className="workbench-nav-toolbar-button"
              aria-label={t("shell.hideSessionSidebar")}
              title={t("shell.hideSessionSidebar")}
              onClick={onToggleCollapse}
            >
              <SidebarCollapseIcon />
            </button>
          ) : null}
          <WorkbenchHostSwitcher />
          <WorkbenchNotificationButton
            unreadCount={unreadNotificationCount}
            open={notificationPanelOpen}
            onToggle={onToggleNotificationPanel}
          />
          <button
            type="button"
            className="workbench-nav-toolbar-button"
            aria-label={t("settings.title")}
            title={t("settings.title")}
            onClick={onOpenSettings}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      <div
        ref={navigationBodyRef}
        className="workbench-nav-body"
        data-scrollbar-autohide="true"
      >
        <div className="workbench-nav-segment">
          <div className="workbench-nav-segment-tabs" role="tablist" aria-label={t("shell.workbenchModeTabsLabel")}>
            <div className="workbench-nav-code-entries">
              <button
                type="button"
                className={
                  isConversationActive && !codeEmbeddedAffairsState
                    ? "workbench-nav-segment-button active"
                    : "workbench-nav-segment-button"
                }
                role="tab"
                aria-selected={isConversationActive && !codeEmbeddedAffairsState}
                onClick={onNavigateConversation}
              >
                <ConversationIcon />
                <span>{t("shell.conversationEntry")}</span>
              </button>
              <button
                type="button"
                className={
                  isSearchOpen
                    ? "workbench-nav-segment-button active"
                    : "workbench-nav-segment-button"
                }
                aria-haspopup="dialog"
                aria-expanded={isSearchOpen}
                onClick={onOpenSearch}
              >
                <SearchIcon />
                <span>{t("shell.searchEntry")}</span>
              </button>
              {affairsLibraryEnabled ? (
                <button
                  type="button"
                  className={
                    codeEmbeddedAffairsState?.primarySection === "library"
                      ? "workbench-nav-segment-button active"
                      : "workbench-nav-segment-button"
                  }
                  role="tab"
                  aria-selected={codeEmbeddedAffairsState?.primarySection === "library"}
                  onClick={() => onOpenCodeEmbeddedAffairsSection("library")}
                >
                  <AffairsLibraryIcon />
                  <span>{t("shell.affairsLibraryNav")}</span>
                </button>
              ) : null}
              <button
                type="button"
                className={
                  codeEmbeddedAffairsState?.primarySection === "workbench"
                    ? "workbench-nav-segment-button active"
                    : "workbench-nav-segment-button"
                }
                role="tab"
                aria-selected={codeEmbeddedAffairsState?.primarySection === "workbench"}
                onClick={() => onOpenCodeEmbeddedAffairsSection("workbench")}
              >
                <AffairsWorkbenchIcon />
                <span>{t("shell.affairsWorkbenchNav")}</span>
              </button>
            </div>
          </div>
        </div>

        {navigationError ? (
          <div className="workbench-status-row">
            <p className="status-text" data-tone="error">
              {navigationError}
            </p>
          </div>
        ) : null}

        {embeddedAffairsSidebarContent ?? (
          <>
            {favoriteSessions.length > 0 ? (
              <section className="workbench-section-block workbench-favorite-section">
            <div className="workbench-section-heading">
              <div className="workbench-section-heading-main">
                <StarIcon active className="workbench-favorite-heading-icon" />
                <span>{t("shell.favoriteSectionTitle")}</span>
              </div>
              <span className="workbench-section-counter">{favoriteSessions.length}</span>
            </div>
	            <div className="workbench-session-list">
	              {visibleFavoriteSessions.map((item) => {
                  if (item.favoriteEntryKind === "lightweight-chat") {
                    const menuKey = `favorite:lightweight-chat:${item.workspace.id}:${item.session.sessionId}`;
                    const workspaceContext = getWorkspaceContext(item.workspace);

                    return (
                      <div key={`favorite:lightweight:${item.session.sessionId}`}>
                        <SessionCard
                          menuKey={menuKey}
                          cardClassName="workbench-chat-card"
                          session={item.session}
                          workspace={item.workspace}
                          workspaceContext={workspaceContext}
                          isActive={activeLightweightChatId === item.session.sessionId}
                          isFavorite
                          menuOpen={openSessionMenuKey === menuKey}
                          showWorkspaceName
                          hideMetaRow
                          depth={0}
                          showActions
                          exportDisabled
                          onExport={() => undefined}
                          menuAnchorPoint={openSessionMenuKey === menuKey ? openSessionMenuAnchorPoint : null}
                          onOpenContextMenu={(anchorPoint) => openSessionMenu(menuKey, anchorPoint)}
                          onOpen={() => {
                            onOpenLightweightChat(item.workspace, item.session);
                            onClose?.();
                          }}
                          onRename={() => {
                            closeSessionMenu();
                            setLightweightChatRenameTarget({
                              session: item.session,
                              workspace: item.workspace
                            });
                            setRenameTitleValue(item.session.title);
                          }}
                          onToggleFavorite={async () => {
                            try {
                              await onToggleLightweightChatFavorite(item.workspace, item.session);
                            } catch (error) {
                              showToast({
                                title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
                                tone: "error"
                              });
                            }
                          }}
                          onArchive={async () => {
                            try {
                              await onArchiveLightweightChat(item.workspace, item.session);
                            } catch (error) {
                              showToast({
                                title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
                                tone: "error"
                              });
                            }
                          }}
                          onDelete={() => {
                            closeSessionMenu();
                            setLightweightChatDeletionTarget({
                              session: item.session,
                              workspace: item.workspace
                            });
                          }}
                          onCloseMenu={closeSessionMenu}
                        />
                      </div>
                    );
                  }

	                const childSessions = getFavoriteChildSessions(item.session.sessionId);

	                return (
                  <div key={item.session.sessionId}>
                    {renderSessionTreeBranch({
                      node: {
                        item: item.session,
                        depth: 0,
                        children: childSessions
                      },
                      workspace: item.workspace,
                      workspaceContext: getWorkspaceContext(item.workspace),
                      menuKeyPrefix: "favorite",
                      showWorkspaceName: true,
                      selectionMode: false,
                      favoriteEnabled: true
                    })}
                  </div>
                );
              })}
              {hasMoreFavoriteSessions ? (
                <button
                  type="button"
                  className="workbench-subsession-expand ghost-button"
                  onClick={handleExpandFavoriteSessions}
                >
                  {t("shell.favoriteExpandMore")}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {navigationLoading && workspaceGroups.length === 0 ? <SidebarNavigationSkeleton /> : null}

        {!navigationLoading && !navigationError && workspaceGroups.length === 0 ? (
          <div className="workbench-empty-state minimal">
            <p>{t("shell.emptyNavigationBody")}</p>
          </div>
        ) : null}

        <section className="workbench-section-block workbench-workspace-section">
          <div className="workbench-section-heading">
            <div className="workbench-section-heading-main">
              <span>{t("shell.workspaceSectionTitle")}</span>
            </div>
            <div className="workbench-section-actions">
              <button
                type="button"
                className="workbench-workspace-icon-button"
                aria-label={t("shell.manageWorkspaceAction")}
                title={t("shell.manageWorkspaceAction")}
                onClick={() => setWorkspaceManagerOpen(true)}
              >
                <WorkspaceManageIcon />
              </button>
              <button
                type="button"
                className="workbench-workspace-icon-button"
                aria-label={t("shell.importWorkspaceTitle")}
                title={t("shell.importWorkspaceTitle")}
                onClick={handleOpenDirectoryBrowser}
              >
                <ImportIcon />
              </button>
              <button
                type="button"
                className="workbench-workspace-icon-button"
                aria-label={t("shell.cloneWorkspaceTitle")}
                title={t("shell.cloneWorkspaceTitle")}
                onClick={handleOpenCloneWorkspace}
              >
                <CloneIcon />
              </button>
            </div>
          </div>

      {workspaceGroups.map((group) => {
          const visibleSessionTree =
            visibleSessionTreeByWorkspaceId.get(group.workspace.id) ?? getVisibleSessionTreeNodes(group);
          const isDraggedWorkspace = dragWorkspaceId === group.workspace.id;
          const isWorkspaceCollapsed = group.isCollapsed || workspaceReorderDragging;

          return (
            <section
              key={group.workspace.id}
              className="workbench-workspace-group"
              ref={(element) => setWorkspaceGroupElement(group.workspace.id, element)}
              data-workspace-group-id={group.workspace.id}
              data-batch-active={batchWorkspaceId === group.workspace.id}
              data-dragging={isDraggedWorkspace}
              onDragOver={(event) => handleWorkspaceDragOver(event, group.workspace.id)}
              onDrop={handleWorkspaceDrop}
            >
              <div className="workbench-workspace-header minimal">
                <button
                  type="button"
                  className="workbench-workspace-toggle"
                  aria-label={isWorkspaceCollapsed ? t("shell.workspaceExpand") : t("shell.workspaceCollapse")}
                  draggable={allowWorkspaceReorder && !enableWorkspacePointerReorder}
                  onClick={() => handleWorkspaceToggleClick(group.workspace.id)}
                  onPointerDown={
                    enableWorkspacePointerReorder
                      ? (event) => handleWorkspacePointerDown(event, group.workspace.id)
                      : undefined
                  }
                  onPointerMove={enableWorkspacePointerReorder ? handleWorkspacePointerMove : undefined}
                  onPointerUp={enableWorkspacePointerReorder ? handleWorkspacePointerUp : undefined}
                  onPointerCancel={enableWorkspacePointerReorder ? handleWorkspacePointerCancel : undefined}
                  onDragStart={
                    allowWorkspaceReorder && !enableWorkspacePointerReorder
                      ? (event) => handleWorkspaceDragStart(event, group.workspace.id)
                      : undefined
                  }
                  onDragEnd={allowWorkspaceReorder && !enableWorkspacePointerReorder ? handleWorkspaceDragEnd : undefined}
                  data-reorder-enabled={allowWorkspaceReorder ? "true" : undefined}
                >
                  <span className="workbench-workspace-toggle-icon" aria-hidden="true">
                    <ChevronIcon expanded={!isWorkspaceCollapsed} />
                  </span>
                  <span
                    className="workbench-workspace-title-copy"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void openWorkspaceContextMenu(group.workspace, {
                        pinDisabled: workspaceGroups[0]?.workspace.id === group.workspace.id
                      }, {
                        x: event.clientX,
                        y: event.clientY
                      });
                    }}
                  >
                    <span className="workbench-workspace-title-line">
                      <strong>{group.workspace.name}</strong>
                      {renderWorkspaceHostBadge(group.workspace)}
                    </span>
                  </span>
                </button>

                {batchWorkspaceId === group.workspace.id ? (
                  renderWorkspaceBatchToolbar()
                ) : (
                  renderWorkspaceActionButtons(group.workspace)
                )}
              </div>

              {!isWorkspaceCollapsed ? (
                <>
                  <div className="workbench-session-list">
                    {visibleSessionTree.length === 0 ? (
                      <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
                    ) : (
                      visibleSessionTree
                        .slice(0, getVisibleWorkspaceSessionCount(group.workspace.id))
                        .map((node) =>
                          renderSessionTreeBranch({
                            node,
                            workspace: group.workspace,
                            workspaceContext: getWorkspaceContext(group.workspace),
                            menuKeyPrefix: `workspace:${group.workspace.id}`,
                            showWorkspaceName: false,
                            selectionMode: batchWorkspaceId === group.workspace.id,
                            favoriteEnabled: true
                          })
                        )
                    )}
                    {visibleSessionTree.length > getVisibleWorkspaceSessionCount(group.workspace.id) ? (
                      <button
                        type="button"
                        className="workbench-subsession-expand ghost-button"
                        onClick={() =>
                          handleExpandWorkspaceSessions(group.workspace.id, visibleSessionTree.length)
                        }
                      >
                        {t("shell.sessionExpandMore")}
                      </button>
                    ) : null}
                  </div>

                  {group.childWorktrees.length > 0 ? (
                    <div className="workbench-session-list workbench-worktree-child-list">
                      {group.childWorktrees.map((node) => renderWorktreeNode(node))}
                    </div>
                  ) : null}

                  {renderArchiveFolder(group.workspace, group.archivedSessions)}
                </>
              ) : null}
            </section>
          );
        })}
        </section>

            {renderLightweightChatSection()}
          </>
        )}
      </div>

      <div className="workbench-nav-footer minimal">
        {!embeddedAffairsSidebarContent ? codeShortcutRailSlot ?? null : null}
        <div className="workbench-nav-footer-actions">
          <WorkbenchUpdateBadge onOpenSoftwareUpdate={() => navigate("/settings/software-update")} />
        </div>
      </div>

      <SidebarModal
        open={workspaceManagerOpen}
        title={t("shell.manageWorkspaceTitle")}
        className="workbench-manage-workspaces-modal"
        description={t("shell.manageWorkspaceDescription")}
        headerActions={
          <>
            <button
              type="button"
              className="secondary-button workbench-manage-modal-action"
              onClick={handleOpenDirectoryBrowser}
            >
              {t("shell.manageWorkspaceImportAction")}
            </button>
            <button
              type="button"
              className="secondary-button workbench-manage-modal-action"
              onClick={handleOpenCloneWorkspace}
            >
              {t("shell.manageWorkspaceCloneAction")}
            </button>
          </>
        }
        onClose={() => {
          if (removingWorkspaceId) {
            return;
          }

          setWorkspaceManagerOpen(false);
        }}
      >
        {workspaceGroups.length > 0 ? (
          <div className="workbench-manage-list">
            {workspaceGroups.map((group) =>
              renderManagedWorkspaceItem(
                group.workspace,
                group.visibleSessions.length + group.archivedSessions.length,
                group.childWorktrees,
                false
              )
            )}
          </div>
        ) : (
          <p className="workbench-section-empty">{t("shell.manageWorkspaceEmpty")}</p>
        )}
        {managedWorkspaceCatalog.filter((workspace) => workspace.hidden).length > 0 ? (
          <div className="workbench-manage-list">
            <div className="workbench-section-heading">
              <div className="workbench-section-heading-main">
                <span>{t("shell.manageWorkspaceHiddenSectionTitle")}</span>
              </div>
              <span className="workbench-section-counter">{managedWorkspaceCatalog.filter((workspace) => workspace.hidden).length}</span>
            </div>
            {managedWorkspaceCatalog
              .filter((workspace) => workspace.hidden)
              .map((workspace) => {
                const workspaceContext = createFallbackWorkspaceVisualContext(workspace);
                const saving = workspaceNavigationSavingById[workspace.id] === true;

                return (
                  <article
                    key={`hidden:${workspace.id}`}
                    className="workbench-manage-item workbench-manage-item--hidden"
                    data-workspace-tone={workspaceContext.tone}
                    style={createWorkspaceToneStyle(workspaceContext)}
                  >
                    <div className="workbench-manage-item-body">
                      <div className="workbench-manage-detail-block">
                        <div className="workbench-manage-detail-header">
                          <span className="workbench-manage-detail-label">{workspace.name}</span>
                          {renderWorkspaceHostBadge(workspace, "workspace-host-badge--inline")}
                        </div>
                        <p className="workbench-manage-detail-value">{workspace.path}</p>
                      </div>
                      <div className="workbench-manage-hidden-action-row">
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={saving}
                          onClick={() => {
                            void handleUpdateWorkspaceHiddenState(workspace, false);
                          }}
                        >
                          {t("shell.workspaceUnhideAction")}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        ) : null}
      </SidebarModal>

      <SidebarModal
        open={sessionDeletionTarget !== null}
        title={t("shell.deleteSessionConfirmTitle")}
        description={t("shell.deleteSessionConfirmDescription")}
        onClose={() => {
          if (deletingSessionId) {
            return;
          }

          setSessionDeletionTarget(null);
        }}
      >
        <p className="workbench-section-empty">
          {sessionDeletionTarget ? sessionDeletionTarget.session.title : ""}
        </p>
        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(deletingSessionId)}
            onClick={() => setSessionDeletionTarget(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="secondary-button workbench-danger-button"
            disabled={Boolean(deletingSessionId)}
            onClick={() => {
              void handleConfirmSessionDeletion();
            }}
          >
            {deletingSessionId ? t("common.loading") : t("shell.deleteSessionAction")}
          </button>
        </div>
      </SidebarModal>

      <SidebarModal
        open={batchSessionDeletionTarget !== null}
        title={t("shell.batchDeleteConfirmTitle")}
        description={t("shell.batchDeleteConfirmDescription", {
          count: `${batchSessionDeletionTarget?.sessions.length ?? 0}`
        })}
        onClose={() => {
          if (batchDeleting) {
            return;
          }

          setBatchSessionDeletionTarget(null);
        }}
      >
        <p className="workbench-section-empty">
          {batchSessionDeletionTarget
            ? t("shell.batchDeleteSelectionSummary", {
                count: `${batchSessionDeletionTarget.sessions.length}`
              })
            : ""}
        </p>
        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={batchDeleting}
            onClick={() => setBatchSessionDeletionTarget(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="secondary-button workbench-danger-button"
            disabled={batchDeleting}
            onClick={() => {
              void handleConfirmBatchDeletion();
            }}
          >
            {batchDeleting ? t("shell.batchDeleting") : t("shell.batchDeleteAction")}
          </button>
        </div>
      </SidebarModal>

      <SidebarModal
        open={workspaceRemovalTarget !== null}
        title={t("shell.manageWorkspaceRemoveConfirmTitle")}
        description={t("shell.manageWorkspaceRemoveConfirmDescription")}
        onClose={() => {
          if (removingWorkspaceId) {
            return;
          }

          setWorkspaceRemovalTarget(null);
        }}
      >
        <p className="workbench-section-empty">
          {workspaceRemovalTarget
            ? t("shell.manageWorkspaceRemoveConfirmTarget", {
                name: workspaceRemovalTarget.name
              })
            : ""}
        </p>
        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(removingWorkspaceId)}
            onClick={() => setWorkspaceRemovalTarget(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="secondary-button workbench-danger-button"
            disabled={Boolean(removingWorkspaceId)}
            onClick={() => {
              void handleConfirmWorkspaceRemoval();
            }}
          >
            {removingWorkspaceId
              ? t("shell.manageWorkspaceRemoving")
              : t("shell.manageWorkspaceRemoveConfirmAction")}
          </button>
        </div>
      </SidebarModal>

      <WorkspaceCloneModal
        open={cloneBrowserOpen}
        onClose={() => setCloneBrowserOpen(false)}
        onCloned={handleWorkspaceCloned}
      />

      {workspaceMenu}

      <WorkspaceImportBrowserModal
        open={importBrowserOpen}
        onClose={() => setImportBrowserOpen(false)}
        onImported={handleWorkspaceImported}
      />

      <WorkspaceImportBrowserModal
        open={remoteWorkspaceSelectionTarget !== null}
        mode="select-directory"
        targetHostId={remoteWorkspaceSelectionTarget?.peerHostId ?? null}
        title={t("shell.manageWorkspaceRemotePathTitle")}
        description={t("shell.manageWorkspaceRemotePathDescription", {
          name: remoteWorkspaceSelectionTarget?.workspace.name ?? ""
        })}
        submitLabel={t("shell.manageWorkspaceRemotePathSubmit")}
        onClose={() => setRemoteWorkspaceSelectionTarget(null)}
        onSelectedPath={handleRemoteWorkspacePathSelected}
      />

      <ParallelSessionCreateModal
        open={parallelCreateSource !== null}
        source={parallelCreateSource}
        targetHostId={currentTargetHostId}
        onClose={() => setParallelCreateSource(null)}
        onCreated={async (detail) => {
          detail.members.forEach((item) => {
            onSessionUpdated(item.session);
          });
          writeParallelGroupTransitionSignal(detail.group.id);
          await onRefreshNavigation();

          const anchorMember =
            detail.members.find((item) => item.session.sessionId === detail.group.anchorSessionId)
            ?? detail.members[0]
            ?? null;

          if (anchorMember) {
            navigate(
              buildWorkspaceSessionPath(
                resolveSessionNavigationWorkspaceId(
                  anchorMember.session,
                  anchorMember.sessionIsolatedWorkspace
                ),
                anchorMember.session.sessionId
              )
            );
          }

          setParallelCreateSource(null);
          showToast({
            title: t("shell.parallelCreateSucceeded"),
            tone: "success"
          });
        }}
      />

      <SidebarModal
        open={createSessionWorkspace !== null}
        title={t("shell.createSessionModalTitle")}
        className="workbench-create-session-modal"
        description={
          createSessionWorkspace
            ? (
                <span className="create-session-modal-target">
                  <span>{t("shell.createSessionTarget")} · </span>
                  {renderWorkspaceHostBadge(createSessionWorkspace, "workspace-host-badge--create-session")}
                  <span>{createSessionWorkspace.name}</span>
                </span>
              )
            : t("shell.createSessionModalDescription")
        }
        headerActions={
          <>
            <button
              type="button"
              className="primary-button create-session-parallel-trigger"
              disabled={creatingWorktree || Boolean(actionWorkspaceId) || !createSessionWorkspace}
              onClick={() => {
                if (!createSessionWorkspace) {
                  return;
                }

                handleOpenParallelCreateFromWorkspace(createSessionWorkspace);
              }}
            >
              {t("shell.parallelCreateAction")}
            </button>
            <button
              type="button"
              className="primary-button create-session-worktree-trigger"
              disabled={creatingWorktree || Boolean(actionWorkspaceId)}
              onClick={() => setCreateWorktreeFormOpen(true)}
            >
              {t("shell.createWorktreeAction")}
            </button>
          </>
        }
        onClose={() => setCreateSessionWorkspaceId(null)}
      >
        <section className="create-session-modal-section">
          <div className="create-session-modal-section-header">
            <strong>{t("shell.createSessionProviderLabel")}</strong>
          </div>
          <SessionProviderPicker
            disabled={Boolean(actionWorkspaceId) || creatingWorktree}
            workspaceId={
              createSessionWorkspace
                ? resolveWorkspaceRefForHost(
                  createSessionWorkspace,
                  resolveWorkspaceHostId(createSessionWorkspace)
                )?.workspaceId ?? createSessionWorkspace.id
                : null
            }
            targetHostId={
              createSessionWorkspace
                ? resolveRemoteSelectedHostId(resolveWorkspaceHostId(createSessionWorkspace))
                : null
            }
            pendingProvider={
              actionWorkspaceId === createSessionWorkspace?.id ? actionProvider ?? null : null
            }
            onSelect={(provider) => {
              if (!createSessionWorkspace) {
                return;
              }

              void handleStartSession(createSessionWorkspace.id, provider);
            }}
          />
        </section>
      </SidebarModal>

      <SidebarModal
        open={createSessionWorkspace !== null && createWorktreeFormOpen}
        title={t("shell.createWorktreeAction")}
        className="workbench-create-worktree-modal"
        headerActions={
          <button
            type="button"
            className={createWorktreeHelpOpen ? "workbench-modal-help-button active" : "workbench-modal-help-button"}
            aria-label={t("shell.createWorktreeHelpAction")}
            title={t("shell.createWorktreeHelpAction")}
            aria-pressed={createWorktreeHelpOpen}
            onClick={() => setCreateWorktreeHelpOpen((current) => !current)}
          >
            <QuestionIcon />
          </button>
        }
        description={
          createSessionWorkspace
            ? `${t("shell.createWorktreeSectionDescription")} ${t("shell.createSessionTarget")} · ${createSessionWorkspace.name}`
            : t("shell.createWorktreeSectionDescription")
        }
        onClose={resetCreateWorktreeForm}
      >
        <form className="create-session-worktree-form" onSubmit={handleCreateChildWorktree}>
          {createWorktreeHelpOpen ? (
            <section className="create-session-worktree-help-card" aria-label={t("shell.createWorktreeHelpTitle")}>
              <strong>{t("shell.createWorktreeHelpTitle")}</strong>
              <div className="create-session-worktree-help-grid">
                <article>
                  <h3>{t("shell.createWorktreeHelpBranchTitle")}</h3>
                  <p>{t("shell.createWorktreeHelpBranchBody")}</p>
                </article>
                <article>
                  <h3>{t("shell.createWorktreeHelpDisplayNameTitle")}</h3>
                  <p>{t("shell.createWorktreeHelpDisplayNameBody")}</p>
                </article>
                <article>
                  <h3>{t("shell.createWorktreeHelpBaseRefTitle")}</h3>
                  <p>{t("shell.createWorktreeHelpBaseRefBody")}</p>
                </article>
              </div>
            </section>
          ) : null}
          <label className="create-session-worktree-field">
            <span>{t("shell.createWorktreeBranchLabel")}</span>
            <input
              className="settings-text-input"
              value={createWorktreeBranchName}
              placeholder={t("shell.createWorktreeBranchPlaceholder")}
              onChange={(event) => {
                const nextValue = event.target.value;

                if (isRecommendedWorktreeBranchNameInput(nextValue)) {
                  setCreateWorktreeBranchName(nextValue);
                }
              }}
            />
          </label>
          <label className="create-session-worktree-field">
            <span>{t("shell.createWorktreeDisplayNameLabel")}</span>
            <input
              className="settings-text-input"
              value={createWorktreeDisplayName}
              placeholder={t("shell.createWorktreeDisplayNamePlaceholder")}
              onChange={(event) => setCreateWorktreeDisplayName(event.target.value)}
            />
          </label>
          <label className="create-session-worktree-field">
            <span>{t("shell.createWorktreeBaseRefLabel")}</span>
            <div
              className="create-session-worktree-combobox"
              ref={createWorktreeBaseRefPickerRef}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget;

                if (nextTarget instanceof Node) {
                  if (createWorktreeBaseRefPickerRef.current?.contains(nextTarget)) {
                    return;
                  }

                  if (createWorktreeBaseRefPopoverRef.current?.contains(nextTarget)) {
                    return;
                  }
                }

                setCreateWorktreeBaseRefPickerOpen(false);
                setCreateWorktreeBaseRefHighlightedIndex(-1);
              }}
            >
              <div className="create-session-worktree-combobox-input-wrap">
                <input
                  className="settings-text-input create-session-worktree-combobox-input"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={createWorktreeBaseRefPickerOpen}
                  aria-controls={createWorktreeBaseRefListboxId}
                  value={createWorktreeBaseRef}
                  placeholder={t("shell.createWorktreeBaseRefPlaceholder")}
                  onFocus={() => {
                    setCreateWorktreeBaseRefPickerOpen(true);
                    setCreateWorktreeBaseRefHighlightedIndex(createWorktreeBaseRefOptions.length > 0 ? 0 : -1);
                  }}
                  onChange={(event) => {
                    setCreateWorktreeBaseRef(event.target.value);
                    setCreateWorktreeBaseRefPickerOpen(true);
                    setCreateWorktreeBaseRefHighlightedIndex(createWorktreeBaseRefOptions.length > 0 ? 0 : -1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();

                      if (!createWorktreeBaseRefPickerOpen) {
                        setCreateWorktreeBaseRefPickerOpen(true);
                        return;
                      }

                      if (createWorktreeBaseRefOptions.length > 0) {
                        setCreateWorktreeBaseRefHighlightedIndex((current) =>
                          current >= createWorktreeBaseRefOptions.length - 1 ? 0 : current + 1
                        );
                      }
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();

                      if (!createWorktreeBaseRefPickerOpen) {
                        setCreateWorktreeBaseRefPickerOpen(true);
                        return;
                      }

                      if (createWorktreeBaseRefOptions.length > 0) {
                        setCreateWorktreeBaseRefHighlightedIndex((current) =>
                          current <= 0 ? createWorktreeBaseRefOptions.length - 1 : current - 1
                        );
                      }
                      return;
                    }

                    if (
                      event.key === "Enter"
                      && createWorktreeBaseRefPickerOpen
                      && createWorktreeBaseRefHighlightedIndex >= 0
                    ) {
                      event.preventDefault();
                      const selectedValue = createWorktreeBaseRefOptions[createWorktreeBaseRefHighlightedIndex];

                      if (selectedValue) {
                        setCreateWorktreeBaseRef(selectedValue.value);
                        setCreateWorktreeBaseRefPickerOpen(false);
                        setCreateWorktreeBaseRefHighlightedIndex(-1);
                      }
                      return;
                    }

                    if (event.key === "Escape") {
                      setCreateWorktreeBaseRefPickerOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="create-session-worktree-combobox-toggle"
                  aria-label={t("shell.createWorktreeBaseRefToggle")}
                  aria-expanded={createWorktreeBaseRefPickerOpen}
                  onClick={() => {
                    setCreateWorktreeBaseRefPickerOpen((current) => !current);
                    setCreateWorktreeBaseRefHighlightedIndex(
                      !createWorktreeBaseRefPickerOpen && createWorktreeBaseRefOptions.length > 0 ? 0 : -1
                    );
                  }}
                >
                  <ChevronIcon expanded={createWorktreeBaseRefPickerOpen} />
                </button>
              </div>
            </div>
            <span className="create-session-worktree-field-hint">
              {createWorktreeBaseRefSuggestionsLoading
                ? t("shell.createWorktreeBaseRefLoading")
                : createWorktreeBaseRefSuggestionsError
                  ? createWorktreeBaseRefSuggestionsError
                  : t("shell.createWorktreeBaseRefHint", {
                      localCount: createWorktreeBaseRefSuggestions.localBranches.length,
                      remoteCount: createWorktreeBaseRefSuggestions.remoteBranches.length,
                      tagCount: createWorktreeBaseRefSuggestions.tags.length
                    })}
            </span>
          </label>
          {createWorktreeBaseRefPickerOpen && createWorktreeBaseRefPopoverRect && typeof document !== "undefined"
            ? createPortal(
                <div className="create-session-worktree-combobox-floating-layer">
                  <div
                    className="create-session-worktree-combobox-floating-backdrop"
                    style={
                      {
                        "--create-worktree-combobox-top": `${createWorktreeBaseRefPopoverRect.top}px`,
                        "--create-worktree-combobox-left": `${createWorktreeBaseRefPopoverRect.left}px`,
                        "--create-worktree-combobox-width": `${createWorktreeBaseRefPopoverRect.width}px`,
                        "--create-worktree-combobox-height": `${createWorktreeBaseRefPopoverHeight ?? 0}px`
                      } as CSSProperties
                    }
                  />
                  <div
                    ref={createWorktreeBaseRefPopoverRef}
                    className="create-session-worktree-combobox-popover floating"
                    style={
                      {
                        "--create-worktree-combobox-top": `${createWorktreeBaseRefPopoverRect.top}px`,
                        "--create-worktree-combobox-left": `${createWorktreeBaseRefPopoverRect.left}px`,
                        "--create-worktree-combobox-width": `${createWorktreeBaseRefPopoverRect.width}px`
                      } as CSSProperties
                    }
                  >
                    {createWorktreeBaseRefSuggestionsLoading ? (
                      <p className="create-session-worktree-combobox-empty">
                        {t("shell.createWorktreeBaseRefLoading")}
                      </p>
                    ) : createWorktreeBaseRefSuggestionsError ? (
                      <p className="create-session-worktree-combobox-empty">
                        {createWorktreeBaseRefSuggestionsError}
                      </p>
                    ) : createWorktreeBaseRefOptionGroups.length > 0 ? (
                      <div
                        id={createWorktreeBaseRefListboxId}
                        className="create-session-worktree-combobox-list"
                        role="listbox"
                      >
                        {createWorktreeBaseRefOptionGroups.map((group) => (
                          <section
                            key={group.key}
                            className="create-session-worktree-combobox-group"
                            aria-label={group.label}
                          >
                            <header className="create-session-worktree-combobox-group-title">
                              {group.label}
                            </header>
                            <div className="create-session-worktree-combobox-group-options">
                              {group.items.map((item) => {
                                const optionIndex = createWorktreeBaseRefOptions.findIndex(
                                  (candidate) => candidate.value === item.value
                                );
                                const selected = createWorktreeBaseRef === item.value;
                                const highlighted = createWorktreeBaseRefHighlightedIndex === optionIndex;

                                return (
                                  <button
                                    key={`${group.key}:${item.value}`}
                                    type="button"
                                    role="option"
                                    className="create-session-worktree-combobox-option"
                                    aria-selected={selected}
                                    data-highlighted={highlighted}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setCreateWorktreeBaseRefHighlightedIndex(optionIndex)}
                                    onClick={() => {
                                      setCreateWorktreeBaseRef(item.value);
                                      setCreateWorktreeBaseRefPickerOpen(false);
                                      setCreateWorktreeBaseRefHighlightedIndex(-1);
                                    }}
                                  >
                                    <span className="create-session-worktree-combobox-option-label">
                                      {item.value}
                                    </span>
                                    <span className="create-session-worktree-combobox-option-badges">
                                      {item.current ? (
                                        <span className="create-session-worktree-combobox-badge">
                                          {t("shell.createWorktreeBaseRefCurrentBadge")}
                                        </span>
                                      ) : null}
                                      {item.recommended ? (
                                        <span className="create-session-worktree-combobox-badge recommended">
                                          {t("shell.createWorktreeBaseRefRecommendedBadge")}
                                        </span>
                                      ) : null}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <p className="create-session-worktree-combobox-empty">
                        {t("shell.createWorktreeBaseRefEmpty")}
                      </p>
                    )}
                  </div>
                </div>,
                document.body
              )
            : null}
          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={creatingWorktree}
              onClick={resetCreateWorktreeForm}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary-button" disabled={creatingWorktree}>
              {creatingWorktree ? t("shell.createWorktreeSubmitting") : t("shell.createWorktreeSubmit")}
            </button>
          </div>
        </form>
      </SidebarModal>

      <SidebarModal
        open={archiveWorkspaceGroup !== null}
        title={t("shell.archiveModalTitle")}
        description={
          archiveWorkspaceGroup
            ? `${archiveWorkspaceGroup.workspace.name} · ${t("shell.archiveModalDescription")}`
            : t("shell.archiveModalDescription")
        }
        headerActions={archiveSessions.length > 0 ? (
          <button
            type="button"
            className="secondary-button"
            aria-pressed={archiveSearchOpen}
            onClick={toggleArchiveSearch}
          >
            {t("shell.archiveSearchAction")}
          </button>
        ) : undefined}
        onClose={() => setArchiveWorkspaceId(null)}
      >
        {archiveSearchOpen ? (
          <div className="workbench-archive-search-panel">
            <ModalField label={t("shell.archiveSearchLabel")} htmlFor={archiveSearchInputId}>
              <input
                id={archiveSearchInputId}
                type="text"
                value={archiveSearchKeyword}
                placeholder={t("shell.archiveSearchPlaceholder")}
                autoFocus
                onChange={(event) => setArchiveSearchKeyword(event.target.value)}
              />
            </ModalField>
            {archiveSummaryLoading ? (
              <p className="workbench-archive-search-status">{t("shell.archiveSearchSummaryLoading")}</p>
            ) : null}
            {archiveSummaryError ? (
              <p className="workbench-archive-search-status status-text" data-tone="warning">{archiveSummaryError}</p>
            ) : null}
          </div>
        ) : null}
        {archiveWorkspaceGroup && filteredArchiveSessions.length > 0 ? (
          <ModalList
            className="workbench-archive-list"
            data-workspace-tone={archiveWorkspaceContext?.tone ?? "root"}
            style={createWorkspaceToneStyle(archiveWorkspaceContext)}
          >
            {filteredArchiveSessions.map((session) => {
              const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));
              const archiveSummary = archiveSummaryBySessionId[session.sessionId]?.trim() ?? "";
              const childBadgeLabel = resolveArchivedChildSessionBadgeLabel(session);

              return (
                <ModalListItem
                  key={session.sessionId}
                  className="workbench-archive-item"
                  data-workspace-tone={archiveWorkspaceContext?.tone ?? "root"}
                  style={createWorkspaceToneStyle(archiveWorkspaceContext)}
                  trailing={(
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleUnarchive(session.sessionId)}
                    >
                      {t("shell.unarchiveAction")}
                    </button>
                  )}
                >
                  <div className="workbench-archive-item-main">
                    <div className="workbench-archive-title-row">
                      <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                      {childBadgeLabel ? (
                        <span className="session-fork-badge archive-child">{childBadgeLabel}</span>
                      ) : null}
                    </div>
                    <p>
                      {buildSessionMeta(session, archiveWorkspaceGroup.workspace, false)} ·{" "}
                      {formatProviderLabel(session.provider)}
                    </p>
                    {archiveSearchOpen && archiveSummary ? (
                      <p className="workbench-archive-item-summary">{archiveSummary}</p>
                    ) : null}
                  </div>
                </ModalListItem>
              );
            })}
          </ModalList>
        ) : (
          <ModalEmptyState
            title={
              archiveSessions.length > 0 && archiveSearchKeyword.trim().length > 0
                ? t("shell.archiveSearchEmpty")
                : t("shell.archiveEmpty")
            }
            compact
            className="workbench-section-empty"
          />
        )}
      </SidebarModal>

      <SidebarModal
        open={Boolean(lightweightChatArchiveWorkspaceId)}
        title={t("shell.archiveModalTitle")}
        description={
          lightweightChatArchiveWorkspace
            ? `${lightweightChatArchiveWorkspace.name} · ${t("shell.archiveModalDescription")}`
            : t("shell.archiveModalDescription")
        }
        headerActions={lightweightArchivedSessions.length > 0 ? (
          <button
            type="button"
            className="secondary-button"
            aria-pressed={lightweightArchiveSearchOpen}
            onClick={toggleLightweightArchiveSearch}
          >
            {t("shell.archiveSearchAction")}
          </button>
        ) : undefined}
        onClose={() => setLightweightChatArchiveWorkspaceId(null)}
      >
        {lightweightArchiveSearchOpen ? (
          <div className="workbench-archive-search-panel">
            <ModalField label={t("shell.archiveSearchLabel")} htmlFor={lightweightArchiveSearchInputId}>
              <input
                id={lightweightArchiveSearchInputId}
                type="text"
                value={lightweightArchiveSearchKeyword}
                placeholder={t("shell.archiveSearchPlaceholder")}
                autoFocus
                onChange={(event) => setLightweightArchiveSearchKeyword(event.target.value)}
              />
            </ModalField>
            {lightweightArchiveSummaryLoading ? (
              <p className="workbench-archive-search-status">{t("shell.archiveSearchSummaryLoading")}</p>
            ) : null}
            {lightweightArchiveSummaryError ? (
              <p className="workbench-archive-search-status status-text" data-tone="warning">
                {lightweightArchiveSummaryError}
              </p>
            ) : null}
          </div>
        ) : null}
        {lightweightChatArchiveWorkspace && filteredLightweightArchivedSessions.length > 0 ? (
          <ModalList
            className="workbench-archive-list"
            data-workspace-tone={getWorkspaceContext(lightweightChatArchiveWorkspace).tone}
            style={createWorkspaceToneStyle(getWorkspaceContext(lightweightChatArchiveWorkspace))}
          >
            {filteredLightweightArchivedSessions.map((session) => {
              const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));
              const archiveSummary = lightweightArchiveSummaryBySessionId[session.sessionId]?.trim() ?? "";

              return (
                <ModalListItem
                  key={session.sessionId}
                  className="workbench-archive-item"
                  trailing={(
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleUnarchiveLightweightChat(session.sessionId)}
                    >
                      {t("shell.unarchiveAction")}
                    </button>
                  )}
                >
                  <div className="workbench-archive-item-main">
                    <div className="workbench-archive-title-row">
                      <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                    </div>
                    {lightweightArchiveSearchOpen && archiveSummary ? (
                      <p className="workbench-archive-item-summary">{archiveSummary}</p>
                    ) : null}
                  </div>
                </ModalListItem>
              );
            })}
          </ModalList>
        ) : (
          <ModalEmptyState
            title={
              lightweightArchivedSessions.length > 0 && lightweightArchiveSearchKeyword.trim().length > 0
                ? t("shell.archiveSearchEmpty")
                : t("shell.archiveEmpty")
            }
            compact
            className="workbench-section-empty"
          />
        )}
      </SidebarModal>

      <SidebarModal
        open={renameTarget !== null || lightweightChatRenameTarget !== null}
        title={t("shell.renameModalTitle")}
        description={t("shell.renameModalDescription")}
        onClose={() => {
          if (renamingSessionId) {
            return;
          }

          setRenameTarget(null);
          setLightweightChatRenameTarget(null);
          setRenameTitleValue("");
        }}
      >
        <form
          className="workbench-rename-form"
          onSubmit={lightweightChatRenameTarget ? handleRenameLightweightChat : handleRenameSession}
        >
          <label className="workbench-modal-field">
            <span>{t("shell.renameInputLabel")}</span>
            <input
              type="text"
              value={renameTitleValue}
              placeholder={t("shell.renameInputPlaceholder")}
              maxLength={120}
              autoFocus
              onChange={(event) => setRenameTitleValue(event.target.value)}
            />
          </label>
          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(renamingSessionId)}
              onClick={() => {
                setRenameTarget(null);
                setLightweightChatRenameTarget(null);
                setRenameTitleValue("");
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={
                !renameTitleValue.trim()
                || renamingSessionId === renameTarget?.session.sessionId
                || renamingSessionId === lightweightChatRenameTarget?.session.sessionId
              }
            >
              {renamingSessionId === renameTarget?.session.sessionId
                || renamingSessionId === lightweightChatRenameTarget?.session.sessionId
                ? t("shell.renamingSession")
                : t("common.save")}
            </button>
          </div>
        </form>
      </SidebarModal>

      <SidebarModal
        open={lightweightChatDeletionTarget !== null}
        title={t("shell.deleteSessionConfirmTitle")}
        description={t("shell.deleteSessionConfirmDescription")}
        onClose={() => {
          if (deletingSessionId) {
            return;
          }

          setLightweightChatDeletionTarget(null);
        }}
      >
        <p className="workbench-section-empty">
          {lightweightChatDeletionTarget ? lightweightChatDeletionTarget.session.title : ""}
        </p>
        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(deletingSessionId)}
            onClick={() => setLightweightChatDeletionTarget(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="secondary-button workbench-danger-button"
            disabled={Boolean(deletingSessionId)}
            onClick={() => {
              void handleConfirmLightweightChatDeletion();
            }}
          >
            {deletingSessionId ? t("common.loading") : t("shell.deleteSessionAction")}
          </button>
        </div>
      </SidebarModal>

      {exportRenderJob ? (
        <div ref={exportRenderRootRef} className="session-export-print-root" aria-hidden="true">
          <div
            className="session-export-print-shell"
            style={
              exportRenderJob.shellWidthPx
                ? {
                    width: `${exportRenderJob.shellWidthPx}px`,
                    maxWidth: "100%"
                  }
                : undefined
            }
          >
            <header className="session-export-print-header">
              <h1>{exportRenderJob.session.title || t("conversation.titleFallback")}</h1>
              <p>{t("conversation.exportAction")}</p>
            </header>
            <ConversationTranscriptExport
              sessionId={exportRenderJob.session.sessionId}
              items={exportRenderJob.items}
              provider={exportRenderJob.session.provider}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function WorkbenchInfoPanel({
  panelReady,
  activeTab,
  fileRevealRequest,
  onTabChange,
  onToggleCollapse,
  currentSessionId,
  activeWorkspaceId,
  requestWorkspaceId,
  currentWorkspaceRef,
  currentTargetHostId,
  navigationGroups,
  workspaceContext,
  worktreeMeta,
  worktreeMergeState,
  onRefreshWorktreeMergePreview,
  onApplyWorktreeMerge,
  onCleanupWorktree
}: {
  panelReady: boolean;
  activeTab: InfoTab;
  fileRevealRequest: WorkbenchFileRevealRequest | null;
  onTabChange: (tab: InfoTab) => void;
  onToggleCollapse?: () => void;
  currentSessionId: string | null;
  activeWorkspaceId: string | null;
  requestWorkspaceId?: string | null;
  currentWorkspaceRef?: WorkspaceRef | null;
  currentTargetHostId?: string | null;
  navigationGroups: WorkspaceSessionGroup[];
  workspaceContext: WorkspaceVisualContext | null;
  worktreeMeta: WorktreeMetaDto | null;
  worktreeMergeState: WorktreeMergeViewState | null;
  onRefreshWorktreeMergePreview: (workspaceId: string, force?: boolean) => void;
  onApplyWorktreeMerge: (workspaceId: string) => void;
  onCleanupWorktree: (meta: WorktreeMetaDto) => void;
}) {
  const fallbackWorkspaceId =
    currentTargetHostId
      ? requestWorkspaceId?.trim() || null
      : requestWorkspaceId ?? activeWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;
  const normalizedActiveWorkspaceId =
    currentTargetHostId
      ? requestWorkspaceId?.trim() || null
      : (requestWorkspaceId ?? activeWorkspaceId)?.trim() || null;
  const knownWorkspaceIdSet = useMemo(
    () => collectKnownWorkspaceIds(navigationGroups),
    [navigationGroups]
  );
  const [stickyFilesWorkspaceId, setStickyFilesWorkspaceId] = useState<string | null>(
    () => normalizedActiveWorkspaceId
  );
  const platform = usePlatform();
  const macOsNativeTitlebarDragRegion = resolveMacOsNativeTitlebarDragRegion(platform);
  const { showToast } = useToast();
  const auxiliaryBodyRef = useTransientScrollbarVisibility<HTMLDivElement>();
  const detachGestureRef = useRef<{
    tab: InfoTab;
    startX: number;
    startY: number;
    workspaceId: string;
    sessionId: string | null;
    detached: boolean;
    preview: DesktopWindowDetachPreviewController | null;
  } | null>(null);
  const suppressClickTabRef = useRef<InfoTab | null>(null);
  const canDetachTabs = platform.isDesktop && platform.bridge.supported;
  const canDetachFilesTab = canDetachTabs && Boolean(normalizedActiveWorkspaceId);
  const canDetachGitTab = canDetachTabs && Boolean(fallbackWorkspaceId);
  const canDetachTerminalsTab = canDetachTabs && Boolean(fallbackWorkspaceId);
  const supportsPointerDetachGesture =
    typeof globalThis !== "undefined" && "PointerEvent" in globalThis;
  const effectiveFilesWorkspaceId = normalizedActiveWorkspaceId ?? (currentTargetHostId ? null : stickyFilesWorkspaceId);
  const effectiveFilesSessionId =
    effectiveFilesWorkspaceId && effectiveFilesWorkspaceId === normalizedActiveWorkspaceId
      ? currentSessionId
      : null;
  const effectiveFileRevealRequest =
    effectiveFilesWorkspaceId && effectiveFilesWorkspaceId === normalizedActiveWorkspaceId
      ? fileRevealRequest
      : null;

  useEffect(() => {
    if (normalizedActiveWorkspaceId) {
      setStickyFilesWorkspaceId((current) =>
        current === normalizedActiveWorkspaceId ? current : normalizedActiveWorkspaceId
      );
      return;
    }

    if (currentTargetHostId) {
      setStickyFilesWorkspaceId(null);
      return;
    }

    if (knownWorkspaceIdSet.size === 0) {
      return;
    }

    setStickyFilesWorkspaceId((current) =>
      current && knownWorkspaceIdSet.has(current) ? current : null
    );
  }, [currentTargetHostId, knownWorkspaceIdSet, normalizedActiveWorkspaceId]);

  const openDetachedWindowByTab = useCallback(async (
    tab: InfoTab,
    workspaceId: string,
    sessionId: string | null
  ) => {
    if (tab === "files") {
      const result = await openFilesExternalWindow(platform, {
        workspaceId,
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

    if (tab === "git") {
      const result = await openGitExternalWindow(platform, {
        workspaceId,
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

    const result = await openProcessesExternalWindow(platform, {
      workspaceId,
      focusOwner: "terminal-manager-panel"
    });

    if (!result.ok) {
      showToast({
        title: result.detail ?? t("terminalManager.openExternalFailed"),
        tone: "error"
      });
    }
  }, [platform, showToast]);

  const handleInfoTabMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, tab: InfoTab) => {
      if (event.button !== 0 || !canDetachTabs) {
        return;
      }

      const workspaceId =
        tab === "files"
          ? activeWorkspaceId
          : tab === "git" || tab === "terminals"
            ? fallbackWorkspaceId
            : null;

      if (!workspaceId) {
        return;
      }

      const sessionId = tab === "files" ? currentSessionId : null;
      detachGestureRef.current = {
        tab,
        startX: event.clientX,
        startY: event.clientY,
        workspaceId,
        sessionId,
        detached: false,
        preview: null
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const gesture = detachGestureRef.current;

        if (!gesture) {
          return;
        }

        const movedX = Math.abs(moveEvent.clientX - gesture.startX);
        const movedY = Math.abs(moveEvent.clientY - gesture.startY);

        if (!gesture.detached && Math.max(movedX, movedY) < WINDOW_DETACH_DRAG_THRESHOLD_PX) {
          return;
        }

        if (!gesture.detached) {
          gesture.detached = true;
          suppressClickTabRef.current = gesture.tab;
          gesture.preview = createDesktopWindowDetachPreview({
            title:
              gesture.tab === "files"
                ? t("shell.filesEntry")
                : gesture.tab === "git"
                  ? t("shell.gitEntry")
                  : t("shell.terminalManagerEntry"),
            x: moveEvent.clientX,
            y: moveEvent.clientY
          });
        }

        gesture.preview?.updatePosition(moveEvent.clientX, moveEvent.clientY);
      };

      const clearGesture = (cancelPreview: boolean) => {
        const preview = detachGestureRef.current?.preview;
        if (cancelPreview) {
          void preview?.cancel();
        }

        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("blur", handleWindowBlur);
        detachGestureRef.current = null;
      };

      const handleMouseUp = async () => {
        const gesture = detachGestureRef.current;
        clearGesture(false);

        if (!gesture?.detached) {
          return;
        }

        await gesture.preview?.complete();
        await openDetachedWindowByTab(gesture.tab, gesture.workspaceId, gesture.sessionId);
      };

      const handleWindowBlur = () => {
        clearGesture(true);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleWindowBlur);
    },
    [
      activeWorkspaceId,
      canDetachTabs,
      currentSessionId,
      fallbackWorkspaceId,
      openDetachedWindowByTab
    ]
  );

  const handleInfoTabPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, tab: InfoTab) => {
      if (event.button !== 0 || !canDetachTabs) {
        return;
      }

      const workspaceId =
        tab === "files"
          ? activeWorkspaceId
          : tab === "git" || tab === "terminals"
            ? fallbackWorkspaceId
            : null;

      if (!workspaceId) {
        return;
      }

      const pointerTarget = event.currentTarget;
      const pointerId = event.pointerId;
      pointerTarget.setPointerCapture(pointerId);
      const sessionId = tab === "files" ? currentSessionId : null;
      detachGestureRef.current = {
        tab,
        startX: event.clientX,
        startY: event.clientY,
        workspaceId,
        sessionId,
        detached: false,
        preview: null
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }

        const gesture = detachGestureRef.current;

        if (!gesture) {
          return;
        }

        const movedX = Math.abs(moveEvent.clientX - gesture.startX);
        const movedY = Math.abs(moveEvent.clientY - gesture.startY);

        if (!gesture.detached && Math.max(movedX, movedY) < WINDOW_DETACH_DRAG_THRESHOLD_PX) {
          return;
        }

        if (!gesture.detached) {
          gesture.detached = true;
          suppressClickTabRef.current = gesture.tab;
          gesture.preview = createDesktopWindowDetachPreview({
            title:
              gesture.tab === "files"
                ? t("shell.filesEntry")
                : gesture.tab === "git"
                  ? t("shell.gitEntry")
                  : t("shell.terminalManagerEntry"),
            x: moveEvent.clientX,
            y: moveEvent.clientY
          });
        }

        gesture.preview?.updatePosition(moveEvent.clientX, moveEvent.clientY);
      };

      const clearGesture = (cancelPreview: boolean) => {
        const preview = detachGestureRef.current?.preview;
        if (cancelPreview) {
          void preview?.cancel();
        }

        pointerTarget.removeEventListener("pointermove", handlePointerMove);
        pointerTarget.removeEventListener("pointerup", handlePointerUp);
        pointerTarget.removeEventListener("pointercancel", handlePointerCancel);
        pointerTarget.removeEventListener("lostpointercapture", handlePointerCancel);
        window.removeEventListener("blur", handleWindowBlur);
        detachGestureRef.current = null;

        if (pointerTarget.hasPointerCapture(pointerId)) {
          pointerTarget.releasePointerCapture(pointerId);
        }
      };

      const handlePointerUp = async (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }

        const gesture = detachGestureRef.current;
        clearGesture(false);

        if (!gesture?.detached) {
          return;
        }

        await gesture.preview?.complete();
        await openDetachedWindowByTab(gesture.tab, gesture.workspaceId, gesture.sessionId);
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return;
        }

        clearGesture(true);
      };

      const handleWindowBlur = () => {
        clearGesture(true);
      };

      pointerTarget.addEventListener("pointermove", handlePointerMove);
      pointerTarget.addEventListener("pointerup", handlePointerUp);
      pointerTarget.addEventListener("pointercancel", handlePointerCancel);
      pointerTarget.addEventListener("lostpointercapture", handlePointerCancel);
      window.addEventListener("blur", handleWindowBlur);
    },
    [
      activeWorkspaceId,
      canDetachTabs,
      currentSessionId,
      fallbackWorkspaceId,
      openDetachedWindowByTab
    ]
  );

  const handleInfoTabClick = useCallback((tab: InfoTab) => {
    if (suppressClickTabRef.current === tab) {
      suppressClickTabRef.current = null;
      return;
    }

    onTabChange(tab);
  }, [onTabChange]);

  return (
    <>
      <div
        className="workbench-auxiliary-header"
        data-workspace-tone={workspaceContext?.tone ?? "root"}
        style={createWorkspaceToneStyle(workspaceContext)}
        data-window-drag-handle="workbench-auxiliary-header"
        data-tauri-drag-region={macOsNativeTitlebarDragRegion}
      >
        {onToggleCollapse ? (
          <button
            type="button"
            className="workbench-nav-toolbar-button"
            aria-label={t("shell.hideInfoSidebar")}
            title={t("shell.hideInfoSidebar")}
            onClick={onToggleCollapse}
        >
            <SidebarCollapseIcon />
          </button>
        ) : null}
        <div
          className="workbench-info-tabs"
          role="tablist"
          aria-label={t("shell.infoTabsLabel")}
          data-tauri-drag-region={macOsNativeTitlebarDragRegion}
        >
          <button
            className={activeTab === "files" ? "workbench-info-tab active" : "workbench-info-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === "files"}
            title={canDetachFilesTab ? "拖拽标签到独立窗口" : undefined}
            onPointerDown={(event) => handleInfoTabPointerDown(event, "files")}
            onMouseDown={
              supportsPointerDetachGesture
                ? undefined
                : (event) => handleInfoTabMouseDown(event, "files")
            }
            onClick={() => handleInfoTabClick("files")}
          >
            {t("shell.filesEntry")}
          </button>
          <button
            className={activeTab === "git" ? "workbench-info-tab active" : "workbench-info-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === "git"}
            title={canDetachGitTab ? "拖拽标签到独立窗口" : undefined}
            onPointerDown={(event) => handleInfoTabPointerDown(event, "git")}
            onMouseDown={
              supportsPointerDetachGesture
                ? undefined
                : (event) => handleInfoTabMouseDown(event, "git")
            }
            onClick={() => handleInfoTabClick("git")}
          >
            {t("shell.gitEntry")}
          </button>
          <button
            className={activeTab === "terminals" ? "workbench-info-tab active" : "workbench-info-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === "terminals"}
            title={canDetachTerminalsTab ? "拖拽标签到独立窗口" : undefined}
            onPointerDown={(event) => handleInfoTabPointerDown(event, "terminals")}
            onMouseDown={
              supportsPointerDetachGesture
                ? undefined
                : (event) => handleInfoTabMouseDown(event, "terminals")
            }
            onClick={() => handleInfoTabClick("terminals")}
          >
            {t("shell.terminalManagerEntry")}
          </button>
        </div>
      </div>

      <div
        ref={auxiliaryBodyRef}
        className="workbench-auxiliary-body"
        data-scrollbar-autohide="true"
      >
        {!panelReady ? <InfoPanelSkeleton /> : null}

        {panelReady && activeTab === "git" && worktreeMeta ? (
          <WorktreeMergePanel
            meta={worktreeMeta}
            state={worktreeMergeState}
            onRefresh={() => onRefreshWorktreeMergePreview(worktreeMeta.workspaceId, true)}
            onApply={() => onApplyWorktreeMerge(worktreeMeta.workspaceId)}
            onCleanup={() => onCleanupWorktree(worktreeMeta)}
          />
        ) : null}

        {panelReady && activeTab === "files" ? (
          effectiveFilesWorkspaceId ? (
            <Suspense fallback={<InfoPanelSkeleton />}>
              <LazyFileContextPanel
                sessionId={effectiveFilesSessionId}
                workspaceId={effectiveFilesWorkspaceId}
                requestWorkspaceId={requestWorkspaceId ?? effectiveFilesWorkspaceId}
                externalRevealRequest={effectiveFileRevealRequest}
                workbenchShellOverrides={{
                  currentTargetHostId,
                  currentRequestWorkspaceId: requestWorkspaceId ?? effectiveFilesWorkspaceId
                }}
              />
            </Suspense>
          ) : (
            <section className="workbench-empty-state minimal">
              <p>{t("shell.filesPanelEmpty")}</p>
            </section>
          )
        ) : null}

        {panelReady && activeTab === "git" ? (
          fallbackWorkspaceId ? (
            <Suspense fallback={<InfoPanelSkeleton />}>
              <LazyGitSidebar
                workspaceId={fallbackWorkspaceId}
                requestWorkspaceId={requestWorkspaceId ?? fallbackWorkspaceId}
                workbenchShellOverrides={{
                  currentTargetHostId,
                  currentRequestWorkspaceId: requestWorkspaceId ?? fallbackWorkspaceId
                }}
              />
            </Suspense>
          ) : (
            <section className="workbench-empty-state minimal">
              <p>{t("shell.gitPanelEmpty")}</p>
            </section>
          )
        ) : null}

        {panelReady && activeTab === "terminals" ? (
          <Suspense fallback={<InfoPanelSkeleton />}>
            <LazyTerminalManagerPanel
              currentWorkspaceId={fallbackWorkspaceId}
              requestWorkspaceId={requestWorkspaceId ?? fallbackWorkspaceId}
              navigationGroups={navigationGroups}
              workbenchShellOverrides={{
                currentWorkspaceRef,
                currentTargetHostId
              }}
            />
          </Suspense>
        ) : null}
      </div>
    </>
  );
}

function WorktreeMergePanel({
  meta,
  state,
  onRefresh,
  onApply,
  onCleanup
}: {
  meta: WorktreeMetaDto;
  state: WorktreeMergeViewState | null;
  onRefresh: () => void;
  onApply: () => void;
  onCleanup: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = state?.preview ?? null;
  const loading = state?.loading ?? false;
  const applying = state?.applying ?? false;
  const cleaning = state?.cleaning ?? false;
  const hasPreview = preview !== null;
  // “是否已经合回父工作区”只能信预检结果，不能拿本地生命周期状态瞎猜。
  const isMerged = preview?.alreadyMerged === true;
  const blockerCodeSet = new Set(preview?.blockers.map((item) => item.code) ?? []);
  const hasBlockingIssues = blockerCodeSet.size > 0 || Boolean(state?.error);
  const showMergedState = isMerged && !hasBlockingIssues;
  const canApply = preview?.canMerge === true && !loading && !applying && !cleaning && !showMergedState;
  const canCleanup =
    showMergedState
    && !loading
    && !applying
    && !cleaning
    && !blockerCodeSet.has("SOURCE_DIRTY")
    && !blockerCodeSet.has("HAS_ACTIVE_CHILDREN");
  const statusTone =
    loading || applying || cleaning
      ? "loading"
      : hasBlockingIssues
        ? "blocked"
        : showMergedState
        ? "merged"
        : preview?.canMerge
          ? "ready"
          : hasPreview
            ? "blocked"
            : "idle";
  const targetWorkspaceName = preview?.targetWorkspace.name ?? t("common.unknown");
  const currentBranchName = preview?.sourceBranchName ?? meta.branchName;
  const parentBranchName = preview?.targetBranchName ?? meta.baseRef ?? t("common.unknown");
  const checklistItems = buildWorktreeMergeChecklistItems({
    t,
    hasPreview,
    showMergedState,
    isMerged,
    canMerge: preview?.canMerge === true,
    ahead: preview?.ahead ?? 0,
    blockerCodeSet
  });
  const statusLabel = loading
    ? t("shell.worktreeMergePreviewLoading")
    : applying
      ? t("shell.worktreeMergeApplying")
      : cleaning
        ? t("shell.worktreeCleanupRunning")
        : showMergedState
          ? t("shell.worktreeMergeAlreadyMerged")
          : preview?.canMerge
            ? t("shell.worktreeMergeReady")
            : hasPreview
              ? t("shell.worktreeMergeBlocked")
              : t("shell.worktreeMergePreviewIdle");
  const summaryMetaItems = [
    t("shell.worktreeMergeCurrentBranch", { branch: currentBranchName }),
    t("shell.worktreeMergeParentBranch", { branch: parentBranchName }),
    t("shell.worktreeMergeTargetWorkspace", { name: targetWorkspaceName }),
    preview
      ? t("shell.worktreeMergeAheadBehind", { ahead: preview.ahead, behind: preview.behind })
      : t("shell.worktreeMergeAheadBehindPending"),
    preview?.mergeBaseCommit
      ? t("shell.worktreeMergeBaseCommit", { commit: shortenCommit(preview.mergeBaseCommit) })
      : null
  ].filter((item): item is string => Boolean(item));
  const detailsId = `worktree-merge-panel-details-${meta.workspaceId}`;
  const summaryToggleLabel = expanded
    ? t("shell.worktreeMergeCollapseDetails")
    : t("shell.worktreeMergeExpandDetails");
  const compactStatusLabels = resolveWorktreeMergeCompactStatusLabels({
    t,
    loading,
    applying,
    cleaning,
    hasPreview,
    canMerge: preview?.canMerge === true,
    showMergedState,
    blockerCodeSet
  });

  useEffect(() => {
    setExpanded(false);
  }, [meta.workspaceId]);

  return (
    <section className="worktree-merge-panel" data-state={statusTone}>
      <button
        type="button"
        className="worktree-merge-panel-summary"
        aria-label={summaryToggleLabel}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        <span className="worktree-merge-panel-summary-label">{t("shell.worktreeMergePanelLabel")}</span>
        <span className="worktree-merge-panel-summary-main">
          <span className="worktree-merge-panel-summary-tags">
            {compactStatusLabels.map((label) => (
              <span key={label} className="worktree-merge-panel-summary-tag" data-state={statusTone}>
                {label}
              </span>
            ))}
          </span>
        </span>
        <span className="worktree-merge-panel-summary-toggle">
          {summaryToggleLabel}
        </span>
      </button>

      {expanded ? (
        <div id={detailsId} className="worktree-merge-panel-details">
          <div className="worktree-merge-panel-detail-head">
            <span className="worktree-merge-panel-status" data-state={statusTone}>
              {statusLabel}
            </span>
          </div>
          <div className="worktree-merge-panel-meta">
            {summaryMetaItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>

          {hasPreview ? (
            <div className="worktree-merge-panel-checklist" aria-label={t("shell.worktreeMergeChecklistTitle")}>
              {checklistItems.map((item) => (
                <div
                  key={item.key}
                  className="worktree-merge-panel-checklist-item"
                  data-state={item.state}
                >
                  <span className="worktree-merge-panel-checklist-marker" aria-hidden="true">
                    {item.state === "done" ? "✓" : item.state === "blocked" ? "!" : "·"}
                  </span>
                  <span className="worktree-merge-panel-checklist-copy">
                    <strong>{item.label}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {state?.error ? (
            <p className="worktree-merge-panel-error status-text" data-tone="error">
              {state.error}
            </p>
          ) : null}

          {preview?.conflictPaths.length ? (
            <div className="worktree-merge-panel-conflicts">
              <span className="worktree-merge-panel-conflicts-label">
                {t("shell.worktreeMergeConflictLabel")}
              </span>
              <div className="worktree-merge-panel-conflict-list">
                {preview.conflictPaths.map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </div>
            </div>
          ) : null}

          <div className="worktree-merge-panel-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={loading || applying || cleaning}
              onClick={onRefresh}
            >
              {hasPreview
                ? t("shell.worktreeMergePreviewRefresh")
                : t("shell.worktreeMergePreviewAction")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canApply}
              onClick={onApply}
            >
              {applying ? t("shell.worktreeMergeApplying") : t("shell.worktreeMergeApplyAction")}
            </button>
            <button
              type="button"
              className="secondary-button worktree-merge-panel-cleanup-button"
              disabled={!canCleanup}
              onClick={onCleanup}
            >
              {cleaning ? t("shell.worktreeCleanupRunning") : t("shell.worktreeCleanupAction")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function resolveWorktreeMergeCompactStatusLabels(input: {
  t: (key: string) => string;
  loading: boolean;
  applying: boolean;
  cleaning: boolean;
  hasPreview: boolean;
  canMerge: boolean;
  showMergedState: boolean;
  blockerCodeSet: ReadonlySet<string>;
}) {
  const { t, loading, applying, cleaning, hasPreview, canMerge, showMergedState, blockerCodeSet } = input;

  if (loading) {
    return [t("shell.worktreeMergeCompactChecking")];
  }

  if (applying) {
    return [t("shell.worktreeMergeCompactMerging")];
  }

  if (cleaning) {
    return [t("shell.worktreeMergeCompactCleaning")];
  }

  const labels: string[] = [];

  if (blockerCodeSet.has("SOURCE_NOT_ACTIVE")) {
    labels.push(t("shell.worktreeMergeCompactInactive"));
  }

  if (blockerCodeSet.has("SOURCE_DIRTY")) {
    labels.push(t("shell.worktreeMergeCompactDirty"));
  }

  if (blockerCodeSet.has("TARGET_DIRTY")) {
    labels.push(t("shell.worktreeMergeCompactTargetDirty"));
  }

  if (blockerCodeSet.has("HAS_CONFLICTS")) {
    labels.push(t("shell.worktreeMergeCompactConflict"));
  }

  if (blockerCodeSet.has("HAS_ACTIVE_CHILDREN")) {
    labels.push(t("shell.worktreeMergeCompactChildren"));
  }

  if (labels.length > 0) {
    return labels;
  }

  if (canMerge) {
    return [t("shell.worktreeMergeCompactReady")];
  }

  if (showMergedState) {
    return [t("shell.worktreeMergeCompactMerged")];
  }

  if (!hasPreview) {
    return [t("shell.worktreeMergeCompactPending")];
  }

  if (blockerCodeSet.has("NO_COMMITS_TO_MERGE")) {
    return [t("shell.worktreeMergeCompactNoCommits")];
  }

  return [t("shell.worktreeMergeCompactBlocked")];
}

function buildWorktreeMergeChecklistItems(input: {
  t: (key: string) => string;
  hasPreview: boolean;
  showMergedState: boolean;
  isMerged: boolean;
  canMerge: boolean;
  ahead: number;
  blockerCodeSet: ReadonlySet<string>;
}) {
  const { t, hasPreview, showMergedState, isMerged, canMerge, ahead, blockerCodeSet } = input;
  const hasSourceInactive = blockerCodeSet.has("SOURCE_NOT_ACTIVE");
  const hasSourceDirty = blockerCodeSet.has("SOURCE_DIRTY");
  const hasTargetDirty = blockerCodeSet.has("TARGET_DIRTY");
  const hasChildren = blockerCodeSet.has("HAS_ACTIVE_CHILDREN");
  const hasConflicts = blockerCodeSet.has("HAS_CONFLICTS");
  const hasNoCommits = hasPreview && !isMerged && (blockerCodeSet.has("NO_COMMITS_TO_MERGE") || ahead <= 0);
  const resultItem = showMergedState
    ? {
      key: "merge-result",
      label: t("shell.worktreeMergeChecklistResultMerged"),
      detail: t("shell.worktreeMergeMergedHint"),
      state: "done"
    }
    : canMerge
      ? {
        key: "merge-result",
        label: t("shell.worktreeMergeChecklistResultReady"),
        detail: t("shell.worktreeMergeChecklistResultReadyDetail"),
        state: "done"
      }
      : hasPreview
        ? {
          key: "merge-result",
          label: t("shell.worktreeMergeChecklistResultBlocked"),
          detail: t("shell.worktreeMergeChecklistResultBlockedDetail"),
          state: "blocked"
        }
        : {
          key: "merge-result",
          label: t("shell.worktreeMergeChecklistResultPending"),
          detail: null,
          state: "pending"
        };

  return [
    {
      key: "source-state",
      label: t("shell.worktreeMergeChecklistSourceState"),
      detail:
        !hasPreview
          ? null
          : hasSourceInactive
            ? t("shell.worktreeMergeChecklistSourceStateBlocked")
            : null,
      state: !hasPreview ? "pending" : hasSourceInactive ? "blocked" : "done"
    },
    {
      key: "clean-source",
      label: t("shell.worktreeMergeChecklistSourceClean"),
      detail: !hasPreview ? null : hasSourceDirty ? t("shell.worktreeMergeChecklistSourceCleanBlocked") : null,
      state: !hasPreview ? "pending" : hasSourceDirty ? "blocked" : "done"
    },
    {
      key: "clean-target",
      label: t("shell.worktreeMergeChecklistTargetClean"),
      detail: !hasPreview ? null : hasTargetDirty ? t("shell.worktreeMergeChecklistTargetCleanBlocked") : null,
      state: !hasPreview ? "pending" : hasTargetDirty ? "blocked" : "done"
    },
    {
      key: "children",
      label: t("shell.worktreeMergeChecklistChildren"),
      detail: !hasPreview ? null : hasChildren ? t("shell.worktreeMergeChecklistChildrenBlocked") : null,
      state: !hasPreview ? "pending" : hasChildren ? "blocked" : "done"
    },
    {
      key: "commits",
      label: t("shell.worktreeMergeChecklistCommits"),
      detail:
        hasNoCommits
          ? isMerged
            ? t("shell.worktreeMergeMergedDirtyHint")
            : t("shell.worktreeMergeChecklistCommitsBlocked")
          : null,
      state: hasNoCommits ? (isMerged ? "done" : "blocked") : hasPreview ? "done" : "pending"
    },
    {
      key: "conflicts",
      label: t("shell.worktreeMergeChecklistConflicts"),
      detail: hasConflicts ? t("shell.worktreeMergeChecklistConflictsBlocked") : null,
      state: hasConflicts ? "blocked" : hasPreview ? "done" : "pending"
    },
    resultItem
  ];
}

export function WorkbenchLayout({
  shellMode = "desktop"
}: {
  shellMode?: WorkbenchShellMode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const platform = usePlatform();
  const { showToast } = useToast();
  const sessionDisplaySortMode = useLocalUiPreferenceSelector((state) => state.sessionDisplaySortMode);
  const notifyOnPermissionRequest = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnPermissionRequest
  );
  const notifyOnSessionCompleted = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnSessionCompleted
  );
  const notifyOnSessionFailed = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnSessionFailed
  );
  const initialWorkbenchSnapshotRef = useRef<WorkbenchSnapshotDto | null>(
    readWorkbenchNavigationSnapshot(
      WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS,
      undefined,
      readWorkspaceRefFromLocation(location)?.hostId === "current"
        ? null
        : readWorkspaceRefFromLocation(location)?.hostId
    )
  );
  const requestIdRef = useRef(0);
  const hasNavigationDataRef = useRef(
    (initialWorkbenchSnapshotRef.current?.items?.length ?? 0) > 0
  );
  const pendingArchiveStateBySessionIdRef = useRef(new Map<string, boolean>());
  const hasReceivedWorkbenchSnapshotRef = useRef(false);
  const lastDraftSessionPathRef = useRef<string | null>(null);
  const fileRevealRequestIdRef = useRef(0);
  const navigationBootstrapFallbackTimerRef = useRef<number | null>(null);
  const workbenchRealtimeClientRef = useRef<WorkbenchRealtimeClient | null>(null);
  const peerWorkbenchRealtimeClientByHostRef = useRef(new Map<string, WorkbenchRealtimeClient>());
  const fileTreeSnapshotListenersRef = useRef(new Set<(snapshot: FileTreeRealtimeSnapshotDto) => void>());
  const gitSnapshotListenersRef = useRef(new Set<(snapshot: GitRealtimeSnapshotDto) => void>());
  const workspaceManagementSnapshotListenersRef = useRef(
    new Set<(snapshot: WorkspaceManagementRealtimeSnapshotDto) => void>()
  );
  const terminalManagerSnapshotListenersRef = useRef(
    new Set<(snapshot: TerminalManagerRealtimeSnapshotDto) => void>()
  );
  const fileTreeSubscriptionRef = useRef<WorkbenchRealtimeFileTreeBinding | null>(null);
  const pendingFileTreeRefreshRef = useRef<WorkbenchRealtimeFileTreeRefreshBinding | null>(null);
  const gitWorkspaceSubscriptionRef = useRef<WorkbenchRealtimeKnownRevisionBinding | null>(null);
  const pendingGitRefreshWorkspaceIdRef = useRef<WorkbenchRealtimeKnownRevisionBinding | null>(null);
  const workspaceManagementSubscriptionRef = useRef<WorkbenchRealtimeKnownRevisionBinding | null>(null);
  const pendingWorkspaceManagementRefreshWorkspaceIdRef = useRef<WorkbenchRealtimeKnownRevisionBinding | null>(null);
  const terminalManagerWorkspaceSubscriptionRef = useRef<WorkbenchRealtimeKnownRevisionBinding | null>(null);
  const pendingTerminalManagerRefreshWorkspaceIdRef = useRef<WorkbenchRealtimeKnownRevisionBinding | null>(null);
  const activeWorkbenchRealtimeScopeKeyRef = useRef<string | null>(null);
  const activeWorkbenchRealtimeTargetHostIdRef = useRef<string | null>(null);
  const notificationRefreshRequestIdRef = useRef(0);
  const notificationArchiveMutationRequestIdRef = useRef(0);
  const showToastRef = useRef(showToast);
  const platformBridgeRef = useRef(platform.bridge);
  const workbenchShellRef = useRef<HTMLDivElement | null>(null);
  const leftPanelWidthRef = useRef(0);
  const rightPanelWidthRef = useRef(0);
  const resizeAnimationFrameIdRef = useRef<number | null>(null);
  const pendingResizeWidthRef = useRef<number | null>(null);
  const windowResizeSettleTimerRef = useRef<number | null>(null);
  const isWindowLiveResizingRef = useRef(false);
  const pendingTitlebarAlignmentAfterResizeRef = useRef(false);
  const completionBaselineReadyRef = useRef(false);
  const previousSessionCompletionStateRef = useRef(
    new Map<
      string,
      {
        activityState: SessionSummaryDto["activityState"];
        completedAt: string | null;
        runningState: SessionSummaryDto["runningState"];
      }
    >()
  );
  const permissionPollBaselineReadyRef = useRef(false);
  const pendingPermissionRequestIdsBySessionRef = useRef(new Map<string, Set<string>>());
  const permissionRefreshSignatureRef = useRef<string>("");
  const permissionWatchSessionsRef = useRef<
    Array<{ sessionId: string; workspaceId: string; title: string }>
  >([]);
  const affairsSearchRequestIdRef = useRef(0);
  const sessionDisplaySortModeRef = useRef<SessionDisplaySortMode>(sessionDisplaySortMode);
  const pendingWorkspaceReorderRef = useRef<{
    originalGroups: WorkspaceSessionGroup[];
  } | null>(null);
  const routeScopedWorkspaceRef = useMemo(
    () => readWorkspaceRefFromLocation(location),
    [location.pathname, location.search]
  );
  const routeWorkspaceId = resolveRouteWorkspaceId(location.pathname, location.search);
  const runtimeConfig = useClientConfigSelector((state) => state);
  const activeHost = getActiveHost(runtimeConfig);
  const activeHostId = runtimeConfig.activeHostId ?? activeHost?.id ?? "current";
  const selectableWorkspaceHosts = useMemo(() => {
    const activeEntry = activeHost
      ? [{ id: "current", host: activeHost }]
      : [];
    const peerEntries = runtimeConfig.hosts
      .filter((host) => host.id !== activeHostId && host.peerEnabled === true && Boolean(host.peerHostId?.trim()))
      .map((host) => ({ id: host.id, host }));

    return [...activeEntry, ...peerEntries];
  }, [activeHost, activeHostId, runtimeConfig.hosts]);
  const selectableWorkspaceHostById = useMemo(() => {
    const entries = new Map<string, HostProfile>();

    for (const item of selectableWorkspaceHosts) {
      entries.set(item.id, item.host);
    }

    return entries;
  }, [selectableWorkspaceHosts]);
  const resolveSelectableHostId = useCallback((hostId: string | null | undefined): string | null => {
    if (!hostId) {
      return null;
    }

    if (selectableWorkspaceHostById.has(hostId)) {
      return hostId;
    }

    const matchedPeerHost = selectableWorkspaceHosts.find((item) => item.host.peerHostId === hostId);
    return matchedPeerHost?.id ?? null;
  }, [selectableWorkspaceHostById, selectableWorkspaceHosts]);
  const resolveRemoteSelectedHostId = useCallback((hostId: string): string => {
    if (hostId === "current") {
      return "current";
    }

    return selectableWorkspaceHostById.get(hostId)?.peerHostId ?? hostId;
  }, [selectableWorkspaceHostById]);
  const [workspaceHostAssignments, setWorkspaceHostAssignments] = useState<Record<string, WorkspaceHostAssignment>>(() =>
    readWorkspaceHostAssignments()
  );
  const resolveWorkspaceRefForTargetHost = useCallback((
    workspace: Pick<WorkspaceDto, "id"> & Partial<Pick<WorkspaceDto, "path">>,
    targetHostId: string
  ): WorkspaceRef | null => {
    if (targetHostId === "current") {
      return makeWorkspaceRef(workspace.id, "current");
    }

    const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, workspace);
    const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
    const selectedTargetHostId = selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;
    const remoteWorkspaceId =
      selectedTargetHostId === targetHostId
        ? assignment?.remoteWorkspaceId?.trim() || null
        : null;
    return remoteWorkspaceId
      ? makeWorkspaceRef(remoteWorkspaceId, targetHostId)
      : null;
  }, [
    activeHostId,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    workspaceHostAssignments
  ]);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>(() =>
    mapWorkbenchSnapshotToNavigationGroups(
      initialWorkbenchSnapshotRef.current,
      sessionDisplaySortMode
    )
  );
  const navigationGroupsRef = useRef<WorkspaceSessionGroup[]>(navigationGroups);
  const [navigationLoading, setNavigationLoading] = useState(
    () => (initialWorkbenchSnapshotRef.current?.items?.length ?? 0) === 0
  );
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    clamp(
      readStoredNumber(LEFT_PANEL_WIDTH_KEY, DEFAULT_LEFT_PANEL_WIDTH),
      MIN_LEFT_PANEL_WIDTH,
      MAX_LEFT_PANEL_WIDTH
    )
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    clamp(
      readStoredNumber(RIGHT_PANEL_WIDTH_KEY, DEFAULT_RIGHT_PANEL_WIDTH),
      MIN_RIGHT_PANEL_WIDTH,
      MAX_RIGHT_PANEL_WIDTH
    )
  );
  const [leftCollapsed, setLeftCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  );
  const [rightCollapsed, setRightCollapsed] = useState(() =>
    readStoredBoolean(RIGHT_PANEL_COLLAPSED_KEY, false)
  );
  const [parallelConversationTransition, setParallelConversationTransition] =
    useState<ParallelGroupTransitionSignal | null>(null);
  const [activeResizeSide, setActiveResizeSide] = useState<"left" | "right" | null>(null);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState(() =>
    extractCollapsedWorkspaceIds(initialWorkbenchSnapshotRef.current)
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() =>
    readStoredString(SELECTED_WORKSPACE_ID_KEY)
  );
  const [selectedWorkspaceRef, setSelectedWorkspaceRef] = useState<WorkspaceRef | null>(() =>
    readWorkspaceRefFromLocation(location)
  );
  const routeHasExplicitWorkspaceScope = hasExplicitTargetHostScopeInLocation(location);
  const activeTargetHostId =
    routeScopedWorkspaceRef?.hostId && routeScopedWorkspaceRef.hostId !== "current"
      ? routeScopedWorkspaceRef.hostId
      : !routeHasExplicitWorkspaceScope && selectedWorkspaceRef?.hostId && selectedWorkspaceRef.hostId !== "current"
        ? selectedWorkspaceRef.hostId
        : null;
  const [infoPanelReady, setInfoPanelReady] = useState(false);
  const [activeInfoTab, setActiveInfoTab] = useState<InfoTab>("files");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [customAuxiliaryPanel, setCustomAuxiliaryPanel] = useState<ReactNode | null>(null);
  const [codeTerminalDockState, setCodeTerminalDockState] = useState<CodeTerminalDockState | null>(null);
  const [codeEmbeddedAffairsState, setCodeEmbeddedAffairsState] = useState<AffairsViewState | null>(null);
  const [codeShortcutAffairsState, setCodeShortcutAffairsState] = useState<AffairsViewState | null>(null);
  const [lightweightChatCreateWorkspace, setLightweightChatCreateWorkspace] = useState<WorkspaceDto | null>(null);
  const [lightweightChatCreateAffairsState, setLightweightChatCreateAffairsState] = useState<AffairsViewState | null>(null);
  const [codeShortcutRailHostState, setCodeShortcutRailHostState] = useState<CodeShortcutRailHostState | null>(null);
  const [currentWorkspaceTerminalCount, setCurrentWorkspaceTerminalCount] = useState(0);
  const [sessionWorkspaceMap, setSessionWorkspaceMap] = useState<Record<string, string>>({});
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchRequest, setSearchRequest] = useState<{ keyword: string; scope: SearchScope } | null>(null);
  const [affairsSearchSortMode, setAffairsSearchSortMode] = useState<AffairsSearchSortMode>("relevance");
  const [searchWorkspaceCatalog, setSearchWorkspaceCatalog] = useState<WorkspaceDto[] | null>(null);
  const [codeSearchLoading, setCodeSearchLoading] = useState(false);
  const [codeSearchError, setCodeSearchError] = useState<string | null>(null);
  const [codeSearchResults, setCodeSearchResults] = useState<CodeSearchResult[]>([]);
  const [affairsSearchLoading, setAffairsSearchLoading] = useState(false);
  const [affairsSearchError, setAffairsSearchError] = useState<string | null>(null);
  const [affairsSearchResults, setAffairsSearchResults] = useState<AffairsSearchResults>(EMPTY_AFFAIRS_SEARCH_RESULTS);
  const affairsLibraryCapability = useAffairsLibraryCapability(true);
  const [lightweightChatSessionsByWorkspaceId, setLightweightChatSessionsByWorkspaceId] = useState<Record<string, SessionSummaryDto[]>>({});
  const [lightweightArchivedChatSessionsByWorkspaceId, setLightweightArchivedChatSessionsByWorkspaceId] = useState<Record<string, SessionSummaryDto[]>>({});
  const [fileRevealRequest, setFileRevealRequest] = useState<WorkbenchFileRevealRequest | null>(null);
  const [workspaceManagementStateById, setWorkspaceManagementStateById] = useState<
    Record<string, WorkspaceManagementViewState>
  >({});
  const [peerWorkspaceNavigationByWorkspaceId, setPeerWorkspaceNavigationByWorkspaceId] = useState<
    Record<string, PeerWorkspaceNavigationView>
  >({});
  const useMacOsNativeTitlebarDragRegion = shouldUseMacOsNativeTitlebarDragRegion(platform);

  useEffect(() => {
    if (affairsLibraryCapability.enabled || codeEmbeddedAffairsState?.primarySection !== "library") {
      return;
    }

    setCodeEmbeddedAffairsState((current) => (
      current?.primarySection === "library"
        ? {
            ...current,
            primarySection: "workbench",
            selectedNodeId: "workbench:overview",
            selectedObjectId: null,
            selectedDocumentId: null,
            pendingLibraryPreview: null
          }
        : current
    ));
  }, [affairsLibraryCapability.enabled, codeEmbeddedAffairsState?.primarySection]);

  useEffect(() => {
    let cancelled = false;

    void listWorkspaceHostBindings().then((response) => {
      if (cancelled) {
        return;
      }

      const nextAssignments = applyRemoteWorkspaceHostBindings(
        readWorkspaceHostAssignments(),
        activeHostId,
        response.items
          .filter((item) => item.activeHostId === activeHostId)
          .map((item) => ({
            ...item,
            selectedHostId: item.selectedHostId === "current"
              ? "current"
              : resolveSelectableHostId(item.selectedHostId) ?? item.selectedHostId
          }))
      );
      writeWorkspaceHostAssignments(nextAssignments);
      setWorkspaceHostAssignments(nextAssignments);
    }).catch(() => undefined);

    function handleWorkspaceHostAssignmentChanged() {
      setWorkspaceHostAssignments(readWorkspaceHostAssignments());
    }

    window.addEventListener(WORKSPACE_HOST_ASSIGNMENT_CHANGED_EVENT, handleWorkspaceHostAssignmentChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_HOST_ASSIGNMENT_CHANGED_EVENT, handleWorkspaceHostAssignmentChanged);
    };
  }, [activeHostId, resolveSelectableHostId]);

  const handleUnifiedTitlebarMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (useMacOsNativeTitlebarDragRegion) {
      return;
    }

    const shellElement = workbenchShellRef.current;

    if (!shellElement) {
      return;
    }

    if (
      !canHandleMacOsTitlebarPointerGesture(platform, event.button, event.target)
      || !isMacOsUnifiedTitlebarGesture(event.clientY, shellElement)
    ) {
      return;
    }

    beginMacOsTitlebarDragGesture({
      platform,
      button: event.button,
      target: event.target,
      clientX: event.clientX,
      clientY: event.clientY
    });
  }, [platform, useMacOsNativeTitlebarDragRegion]);
  const handleUnifiedTitlebarDoubleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (useMacOsNativeTitlebarDragRegion) {
      return;
    }

    const shellElement = workbenchShellRef.current;

    if (!shellElement) {
      return;
    }

    if (
      !canHandleMacOsTitlebarPointerGesture(platform, event.button, event.target)
      || !isMacOsUnifiedTitlebarGesture(event.clientY, shellElement)
    ) {
      return;
    }

    void platform.bridge.setWindowState("toggle-zoom");
  }, [platform, useMacOsNativeTitlebarDragRegion]);
  const [worktreeMergeStateById, setWorktreeMergeStateById] = useState<
    Record<string, WorktreeMergeViewState>
  >({});
  const [worktreeCleanupTarget, setWorktreeCleanupTarget] = useState<WorktreeMetaDto | null>(null);
  const [cleanupDeleteBranch, setCleanupDeleteBranch] = useState(false);
  const [globalNotifications, setGlobalNotifications] = useState<WorkbenchGlobalNotification[]>([]);
  const [archivedNotificationIds, setArchivedNotificationIds] = useState<Set<string>>(() => new Set());
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [showArchivedNotifications, setShowArchivedNotifications] = useState(false);
  const [windowResizeSettleVersion, setWindowResizeSettleVersion] = useState(0);
  const [notificationSeenAt, setNotificationSeenAt] = useState<string | null>(() =>
    readStoredString(WORKBENCH_NOTIFICATION_SEEN_AT_KEY)
  );
  const prefersMacOsWorkbenchVibrancy =
    shellMode === "desktop"
    && platform.isDesktop
    && platform.ui.osFamily === "macos"
    && platform.ui.prefersOverlayTitlebar;
  const { theme } = useTheme();

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const { documentElement, body } = document;
    const root = document.getElementById("root");

    if (!prefersMacOsWorkbenchVibrancy) {
      documentElement.removeAttribute("data-workbench-macos-vibrancy");
      body?.removeAttribute("data-workbench-macos-vibrancy");
      return;
    }

    const previousDocumentBackground = documentElement.style.background;
    const previousBodyBackground = body?.style.background ?? "";
    const previousRootBackground = root?.style.background ?? "";

    documentElement.setAttribute("data-workbench-macos-vibrancy", "true");
    body?.setAttribute("data-workbench-macos-vibrancy", "true");
    documentElement.style.background = "transparent";
    body?.style.setProperty("background", "transparent");
    root?.style.setProperty("background", "transparent");

    return () => {
      documentElement.removeAttribute("data-workbench-macos-vibrancy");
      body?.removeAttribute("data-workbench-macos-vibrancy");
      documentElement.style.background = previousDocumentBackground;

      if (body) {
        body.style.background = previousBodyBackground;
      }

      if (root instanceof HTMLElement) {
        root.style.background = previousRootBackground;
      }
    };
  }, [prefersMacOsWorkbenchVibrancy]);

  useEffect(() => {
    return () => {
      if (windowResizeSettleTimerRef.current !== null) {
        window.clearTimeout(windowResizeSettleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const { documentElement, body } = document;

    if (!activeResizeSide) {
      documentElement.removeAttribute(WORKBENCH_PANEL_RESIZING_ATTRIBUTE);
      body?.removeAttribute(WORKBENCH_PANEL_RESIZING_ATTRIBUTE);
      return;
    }

    const previousDocumentCursor = documentElement.style.cursor;
    const previousBodyCursor = body?.style.cursor ?? "";

    documentElement.setAttribute(WORKBENCH_PANEL_RESIZING_ATTRIBUTE, activeResizeSide);
    body?.setAttribute(WORKBENCH_PANEL_RESIZING_ATTRIBUTE, activeResizeSide);
    documentElement.style.cursor = "col-resize";
    body?.style.setProperty("cursor", "col-resize");
    window.getSelection()?.removeAllRanges();

    return () => {
      documentElement.removeAttribute(WORKBENCH_PANEL_RESIZING_ATTRIBUTE);
      body?.removeAttribute(WORKBENCH_PANEL_RESIZING_ATTRIBUTE);
      documentElement.style.cursor = previousDocumentCursor;

      if (body) {
        body.style.cursor = previousBodyCursor;
      }
    };
  }, [activeResizeSide]);

  useEffect(() => {
    sessionDisplaySortModeRef.current = sessionDisplaySortMode;
    setNavigationGroups((current) => sortWorkspaceSessionGroups(current, sessionDisplaySortMode));
  }, [sessionDisplaySortMode]);

  useEffect(() => {
    navigationGroupsRef.current = navigationGroups;
  }, [navigationGroups]);

  useEffect(() => {
    platformBridgeRef.current = platform.bridge;
  }, [platform.bridge]);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);

  useEffect(() => {
    rightPanelWidthRef.current = rightPanelWidth;
  }, [rightPanelWidth]);

  useEffect(() => {
    return () => {
      if (resizeAnimationFrameIdRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameIdRef.current);
      }
    };
  }, []);

  const refreshGlobalNotifications = useCallback(async () => {
    const requestId = notificationRefreshRequestIdRef.current + 1;
    notificationRefreshRequestIdRef.current = requestId;

    try {
      const profileResponse = await getButlerProfile();

      if (requestId !== notificationRefreshRequestIdRef.current) {
        return;
      }

      if (!profileResponse.initialized) {
        setGlobalNotifications([]);
        setArchivedNotificationIds(new Set());
        return;
      }

      const [overviewResponse, followUpResponse, inboxResponse, notificationArchiveResponse] = await Promise.all([
        getButlerOverview(),
        listButlerFollowUpTasks(),
        listButlerInboxItems(),
        listButlerNotificationArchives()
      ]);

      if (requestId !== notificationRefreshRequestIdRef.current) {
        return;
      }

      setGlobalNotifications(
        buildWorkbenchGlobalNotifications(
          overviewResponse.overview,
          followUpResponse.items,
          inboxResponse.items
        )
      );
      setArchivedNotificationIds(
        new Set(notificationArchiveResponse.items.map((item) => item.notificationId))
      );
    } catch {
      if (requestId !== notificationRefreshRequestIdRef.current) {
        return;
      }

      setGlobalNotifications([]);
      setArchivedNotificationIds(new Set());
    }
  }, []);

  const markGlobalNotificationsSeen = useCallback((notifications: WorkbenchGlobalNotification[]) => {
    const latestTimestamp = notifications
      .map((item) => item.createdAt)
      .sort((left, right) => parseWorkbenchNotificationTime(right) - parseWorkbenchNotificationTime(left))[0] ?? null;

    if (!latestTimestamp) {
      return;
    }

    setNotificationSeenAt((current) => {
      if (current && parseWorkbenchNotificationTime(current) >= parseWorkbenchNotificationTime(latestTimestamp)) {
        return current;
      }

      return latestTimestamp;
    });
  }, []);

  useEffect(() => {
    if (!notificationSeenAt) {
      return;
    }

    writeStoredValue(WORKBENCH_NOTIFICATION_SEEN_AT_KEY, notificationSeenAt);
  }, [notificationSeenAt]);

  useEffect(() => {
    void refreshGlobalNotifications();

    const timer = window.setInterval(() => {
      void refreshGlobalNotifications();
    }, WORKBENCH_NOTIFICATION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshGlobalNotifications]);

  useEffect(() => {
    logPerfDebug("workbench.layout_mounted", {
      path: location.pathname,
      search: location.search
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    logPerfDebug("workbench.cached_snapshot_loaded", {
      cached: Boolean(initialWorkbenchSnapshotRef.current),
      workspaceCount: initialWorkbenchSnapshotRef.current?.items.length ?? 0,
      sessionCount:
        initialWorkbenchSnapshotRef.current?.items.reduce(
          (total, item) => total + item.sessions.length,
          0
        ) ?? 0
    });
  }, []);

  function applyWorkbenchSnapshot(snapshot: WorkbenchSnapshotDto) {
    if (!snapshot || !Array.isArray(snapshot.items)) {
      return;
    }

    settlePendingArchiveStateFromSnapshot(pendingArchiveStateBySessionIdRef.current, snapshot);
    const snapshotWithPendingArchiveState = applyPendingArchiveStateToSnapshot(
      snapshot,
      pendingArchiveStateBySessionIdRef.current
    );

    logPerfDebug("workbench.apply_snapshot", {
      workspaceCount: snapshotWithPendingArchiveState.items.length,
      sessionCount: snapshotWithPendingArchiveState.items.reduce(
        (total, item) => total + item.sessions.length,
        0
      ),
      currentSessionId: resolveRouteSessionMatch(location.pathname)?.sessionId ?? null
    });

    const nextGroups = mapWorkbenchSnapshotToNavigationGroups(
      snapshotWithPendingArchiveState,
      sessionDisplaySortModeRef.current
    );

    initialWorkbenchSnapshotRef.current = snapshotWithPendingArchiveState;
    writeWorkbenchNavigationSnapshot(snapshotWithPendingArchiveState);
    navigationGroupsRef.current = nextGroups;
    setNavigationGroups(nextGroups);
    setCollapsedWorkspaceIds(extractCollapsedWorkspaceIds(snapshotWithPendingArchiveState));
    setNavigationError(null);
  }

  const refreshNavigation = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setNavigationLoading((current) => current || !hasNavigationDataRef.current);
    logPerfDebug("workbench.refresh_navigation.start", {
      requestId,
      hasNavigationData: hasNavigationDataRef.current
    });

    try {
      const snapshot = await getWorkbenchSnapshot({
        refresh: true,
        // 导航刷新不能等待 workspace discovery。
        // Codex 归档历史很大时，等待 discovery 会把页面刷新绑到后端重扫描上，表现成前端长时间无响应。
        awaitDiscovery: false
      });

      if (requestId !== requestIdRef.current) {
        logPerfDebug("workbench.refresh_navigation.stale", { requestId });
        return;
      }

      applyWorkbenchSnapshot(snapshot);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setNavigationError(error instanceof Error ? error.message : t("shell.navigationLoadFailed"));
      showToastRef.current({
        title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
        tone: "error"
      });
    } finally {
      logPerfDebug("workbench.refresh_navigation.end", {
        requestId,
        success: requestId === requestIdRef.current
      });
      if (requestId === requestIdRef.current) {
        setNavigationLoading(false);
      }
    }
  }, []);

  const upsertNavigationSession = useCallback((session: SessionSummaryDto) => {
    setNavigationGroups((current) => {
      const nextGroups = upsertSessionIntoGroups(
        current,
        session,
        sessionDisplaySortModeRef.current
      );
      navigationGroupsRef.current = nextGroups;
      return nextGroups;
    });
  }, []);

  const requestNavigationRefresh = useCallback(() => {
    workbenchRealtimeClientRef.current?.requestRefresh();
  }, []);

  function openSessionFromToast(workspaceId: string, sessionId: string) {
    const workspaceRef = resolveNavigationWorkspaceRef(workspaceId, {
      preferredTargetHostId: currentTargetHostId,
      fallbackToCurrent: true
    });
    handleSelectWorkspace(workspaceId, workspaceRef);
    navigate(buildWorkspaceSessionPath(workspaceId, sessionId, workspaceRef));
  }

  const dispatchFileTreeSnapshot = useCallback((snapshot: FileTreeRealtimeSnapshotDto, targetHostId?: string | null) => {
    fileTreeSnapshotListenersRef.current.forEach((listener) => listener({
      ...snapshot,
      targetHostId: targetHostId ?? null
    } as FileTreeRealtimeSnapshotDto));
  }, []);

  const dispatchGitSnapshot = useCallback((snapshot: GitRealtimeSnapshotDto, targetHostId?: string | null) => {
    const snapshotTargetHostId = targetHostId ?? null;
    writeViewSnapshot(buildGitSidebarSnapshotKey(snapshot.workspaceId, snapshotTargetHostId), {
      revision: snapshot.revision ?? null,
      status: snapshot.status,
      history: snapshot.history,
      historyTotalCount: snapshot.historyTotalCount,
      historyNextCursor: snapshot.historyNextCursor,
      branches: snapshot.branches
    });

    if (!snapshotTargetHostId) {
      setWorkspaceManagementStateById((current) => {
        const workspace =
          navigationGroupsRef.current.find((group) => group.workspace.id === snapshot.workspaceId)?.workspace ?? null;

        if (!workspace) {
          return current;
        }

        const currentState = current[snapshot.workspaceId];
        const nextDetail = mergeWorkspaceManagementDetailWithGitSnapshot(
          mergeWorkspaceManagementDetailWithWorkspace(
            currentState?.detail ?? createWorkspaceManagementFallback(workspace),
            workspace
          ),
          snapshot
        );

        writeViewSnapshot(
          buildWorkspaceManagementSummarySnapshotKey(snapshot.workspaceId),
          nextDetail
        );

        return {
          ...current,
          [snapshot.workspaceId]: {
            detail: nextDetail,
            loading: false,
            error: null
          }
        };
      });
    }

    gitSnapshotListenersRef.current.forEach((listener) => listener({
      ...snapshot,
      targetHostId: snapshotTargetHostId
    } as GitRealtimeSnapshotDto));
  }, []);

  const dispatchWorkspaceManagementSnapshot = useCallback((snapshot: WorkspaceManagementRealtimeSnapshotDto, targetHostId?: string | null) => {
    if (!targetHostId) {
      writeViewSnapshot(buildWorkspaceManagementSummarySnapshotKey(snapshot.workspaceId), snapshot);
      setWorkspaceManagementStateById((current) => ({
        ...current,
        [snapshot.workspaceId]: {
          detail: snapshot,
          loading: false,
          error: null
        }
      }));
    }

    workspaceManagementSnapshotListenersRef.current.forEach((listener) => listener({
      ...snapshot,
      targetHostId: targetHostId ?? null
    } as WorkspaceManagementRealtimeSnapshotDto));
  }, []);

  const dispatchTerminalManagerSnapshot = useCallback((snapshot: TerminalManagerRealtimeSnapshotDto, targetHostId?: string | null) => {
    terminalManagerSnapshotListenersRef.current.forEach((listener) => listener({
      ...snapshot,
      targetHostId: targetHostId ?? null
    } as TerminalManagerRealtimeSnapshotDto));
  }, []);

  const getWorkbenchRealtimeClientForTargetHost = useCallback((targetHostId?: string | null): WorkbenchRealtimeClient | null => {
    const normalizedTargetHostId = normalizeTargetHostId(targetHostId);

    if (!normalizedTargetHostId) {
      return workbenchRealtimeClientRef.current;
    }

    const existing = peerWorkbenchRealtimeClientByHostRef.current.get(normalizedTargetHostId);
    if (existing) {
      return existing;
    }

    const client = new WorkbenchRealtimeClient({
      targetHostId: normalizedTargetHostId,
      onConnectionChange: () => undefined,
      onSnapshot: () => undefined,
      onFileTreeSnapshot: (snapshot) => dispatchFileTreeSnapshot(snapshot, normalizedTargetHostId),
      onGitSnapshot: (snapshot) => dispatchGitSnapshot(snapshot, normalizedTargetHostId),
      onWorkspaceManagementSnapshot: (snapshot) => dispatchWorkspaceManagementSnapshot(snapshot, normalizedTargetHostId),
      onTerminalManagerSnapshot: (snapshot) => dispatchTerminalManagerSnapshot(snapshot, normalizedTargetHostId),
      onUnauthorized: () => undefined
    });

    peerWorkbenchRealtimeClientByHostRef.current.set(normalizedTargetHostId, client);
    client.start();
    return client;
  }, [
    dispatchFileTreeSnapshot,
    dispatchGitSnapshot,
    dispatchTerminalManagerSnapshot,
    dispatchWorkspaceManagementSnapshot
  ]);

  const clearWorkbenchRealtimeBindings = useCallback((scopeKey?: string | null) => {
    const shouldClearBinding = (binding: { scopeKey: string | null } | null) =>
      Boolean(binding) && (!scopeKey || binding?.scopeKey === scopeKey);

    if (shouldClearBinding(fileTreeSubscriptionRef.current)) {
      fileTreeSubscriptionRef.current = null;
    }

    if (shouldClearBinding(pendingFileTreeRefreshRef.current)) {
      pendingFileTreeRefreshRef.current = null;
    }

    if (shouldClearBinding(gitWorkspaceSubscriptionRef.current)) {
      gitWorkspaceSubscriptionRef.current = null;
    }

    if (shouldClearBinding(pendingGitRefreshWorkspaceIdRef.current)) {
      pendingGitRefreshWorkspaceIdRef.current = null;
    }

    if (shouldClearBinding(workspaceManagementSubscriptionRef.current)) {
      workspaceManagementSubscriptionRef.current = null;
    }

    if (shouldClearBinding(pendingWorkspaceManagementRefreshWorkspaceIdRef.current)) {
      pendingWorkspaceManagementRefreshWorkspaceIdRef.current = null;
    }

    if (shouldClearBinding(terminalManagerWorkspaceSubscriptionRef.current)) {
      terminalManagerWorkspaceSubscriptionRef.current = null;
    }

    if (shouldClearBinding(pendingTerminalManagerRefreshWorkspaceIdRef.current)) {
      pendingTerminalManagerRefreshWorkspaceIdRef.current = null;
    }
  }, []);

  const subscribeFileTree = useCallback((
    workspaceId: string,
    paths: string[],
    options?: WorkbenchRealtimeFileTreeOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    fileTreeSubscriptionRef.current = {
      workspaceId,
      paths,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevisionByPath: options?.knownRevisionByPath
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.subscribeFileTree(workspaceId, paths, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const requestFileTreeRefresh = useCallback((
    workspaceId: string,
    paths?: string[],
    options?: WorkbenchRealtimeFileTreeOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    pendingFileTreeRefreshRef.current = {
      workspaceId,
      paths,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevisionByPath: options?.knownRevisionByPath
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.requestFileTreeRefresh(workspaceId, paths, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const addFileTreeSnapshotListener = useCallback(
    (listener: (snapshot: FileTreeRealtimeSnapshotDto) => void) => {
      fileTreeSnapshotListenersRef.current.add(listener);
      return () => {
        fileTreeSnapshotListenersRef.current.delete(listener);
      };
    },
    []
  );

  const subscribeGitSnapshot = useCallback((
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    gitWorkspaceSubscriptionRef.current = {
      workspaceId,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevision: options?.knownRevision
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.subscribeGit(workspaceId, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const requestGitRefresh = useCallback((
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    pendingGitRefreshWorkspaceIdRef.current = {
      workspaceId,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevision: options?.knownRevision
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.requestGitRefresh(workspaceId, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const addGitSnapshotListener = useCallback(
    (listener: (snapshot: GitRealtimeSnapshotDto) => void) => {
      gitSnapshotListenersRef.current.add(listener);
      return () => {
        gitSnapshotListenersRef.current.delete(listener);
      };
    },
    []
  );

  const subscribeWorkspaceManagementSnapshot = useCallback((
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    workspaceManagementSubscriptionRef.current = {
      workspaceId,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevision: options?.knownRevision
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.subscribeWorkspaceManagement(workspaceId, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const requestWorkspaceManagementRefresh = useCallback((
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    pendingWorkspaceManagementRefreshWorkspaceIdRef.current = {
      workspaceId,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevision: options?.knownRevision
    };
    setWorkspaceManagementStateById((current) => ({
      ...current,
      [workspaceId]: {
        detail: current[workspaceId]?.detail ?? null,
        loading: true,
        error: null
      }
    }));
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.requestWorkspaceManagementRefresh(workspaceId, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const addWorkspaceManagementSnapshotListener = useCallback(
    (listener: (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void) => {
      workspaceManagementSnapshotListenersRef.current.add(listener);
      return () => {
        workspaceManagementSnapshotListenersRef.current.delete(listener);
      };
    },
    []
  );

  const loadWorktreeMergePreview = useCallback(async (workspaceId: string, force = false) => {
    const normalizedWorkspaceId = workspaceId.trim();

    if (!normalizedWorkspaceId) {
      return;
    }

    let shouldRequest = true;
    setWorktreeMergeStateById((current) => {
      const existing = current[normalizedWorkspaceId];

      if (!force && existing?.loading) {
        shouldRequest = false;
        return current;
      }

      return {
        ...current,
        [normalizedWorkspaceId]: {
          preview: existing?.preview ?? null,
          loading: true,
          applying: existing?.applying ?? false,
          cleaning: existing?.cleaning ?? false,
          error: null
        }
      };
    });

    if (!shouldRequest) {
      return;
    }

    try {
      const preview = await getWorktreeMergePreview(normalizedWorkspaceId);

      setWorktreeMergeStateById((current) => ({
        ...current,
        [normalizedWorkspaceId]: {
          preview,
          loading: false,
          applying: current[normalizedWorkspaceId]?.applying ?? false,
          cleaning: current[normalizedWorkspaceId]?.cleaning ?? false,
          error: null
        }
      }));
    } catch (error) {
      setWorktreeMergeStateById((current) => ({
        ...current,
        [normalizedWorkspaceId]: {
          preview: current[normalizedWorkspaceId]?.preview ?? null,
          loading: false,
          applying: current[normalizedWorkspaceId]?.applying ?? false,
          cleaning: current[normalizedWorkspaceId]?.cleaning ?? false,
          error: error instanceof Error ? error.message : t("shell.worktreeMergePreviewFailed")
        }
      }));
    }
  }, []);

  const applyWorktreeMerge = useCallback(async (workspaceId: string) => {
    const normalizedWorkspaceId = workspaceId.trim();

    if (!normalizedWorkspaceId) {
      return;
    }

    setWorktreeMergeStateById((current) => ({
      ...current,
      [normalizedWorkspaceId]: {
        preview: current[normalizedWorkspaceId]?.preview ?? null,
        loading: false,
        applying: true,
        cleaning: current[normalizedWorkspaceId]?.cleaning ?? false,
        error: null
      }
    }));

    try {
      const result = await mergeWorktreeIntoParent(normalizedWorkspaceId);

      setWorktreeMergeStateById((current) => ({
        ...current,
        [normalizedWorkspaceId]: {
          preview: result.preview,
          loading: false,
          applying: false,
          cleaning: current[normalizedWorkspaceId]?.cleaning ?? false,
          error: null
        }
      }));
      requestNavigationRefresh();
      void refreshNavigation();
      void loadWorktreeMergePreview(normalizedWorkspaceId, true);
      void requestGitRefresh(result.preview.targetWorkspace.id);
      showToastRef.current({
        title: result.applied
          ? t("shell.worktreeMergeApplySuccess")
          : t("shell.worktreeMergeAlreadyMerged"),
        tone: "success"
      });
    } catch (error) {
      setWorktreeMergeStateById((current) => ({
        ...current,
        [normalizedWorkspaceId]: {
          preview: current[normalizedWorkspaceId]?.preview ?? null,
          loading: false,
          applying: false,
          cleaning: current[normalizedWorkspaceId]?.cleaning ?? false,
          error: error instanceof Error ? error.message : t("shell.worktreeMergeApplyFailed")
        }
      }));
      showToastRef.current({
        title: error instanceof Error ? error.message : t("shell.worktreeMergeApplyFailed"),
        tone: "error"
      });
    }
  }, [loadWorktreeMergePreview, refreshNavigation, requestGitRefresh, requestNavigationRefresh]);

  const applyWorktreeCleanup = useCallback(async (meta: WorktreeMetaDto) => {
    const workspaceId = meta.workspaceId;
    const allowDeleteBranch =
      cleanupDeleteBranch && worktreeMergeStateById[workspaceId]?.preview?.alreadyMerged === true;

    setWorktreeMergeStateById((current) => ({
      ...current,
      [workspaceId]: {
        preview: current[workspaceId]?.preview ?? null,
        loading: false,
        applying: false,
        cleaning: true,
        error: null
      }
    }));

    try {
      const result = await cleanupWorktree(workspaceId, {
        deleteBranch: allowDeleteBranch
      });
      setWorktreeMergeStateById((current) => ({
        ...current,
        [workspaceId]: {
          preview: current[workspaceId]?.preview ?? null,
          loading: false,
          applying: false,
          cleaning: false,
          error: null
        }
      }));
      setCleanupDeleteBranch(false);
      setWorktreeCleanupTarget((current) => (current?.workspaceId === workspaceId ? null : current));
      requestNavigationRefresh();
      await refreshNavigation();
      navigate(buildWorkspaceDetailPath(meta.parentWorkspaceId), { replace: true });

      if (result.branchDeleted) {
        showToastRef.current({
          title: t("shell.worktreeCleanupDeleteBranchSuccess", {
            branch: result.deletedBranchName || meta.branchName
          }),
          tone: "success"
        });
        return;
      }

      if (result.branchDeleteRequested) {
        showToastRef.current({
          title: t("shell.worktreeCleanupDeleteBranchPartialFailed", {
            branch: meta.branchName
          }),
          description: result.branchDeleteError || undefined,
          tone: "warning"
        });
        return;
      }

      showToastRef.current({
        title: t("shell.worktreeCleanupSuccess"),
        tone: "success"
      });
    } catch (error) {
      setWorktreeMergeStateById((current) => ({
        ...current,
        [workspaceId]: {
          preview: current[workspaceId]?.preview ?? null,
          loading: false,
          applying: false,
          cleaning: false,
          error: error instanceof Error ? error.message : t("shell.worktreeCleanupFailed")
        }
      }));
      showToastRef.current({
        title: error instanceof Error ? error.message : t("shell.worktreeCleanupFailed"),
        tone: "error"
      });
    }
  }, [cleanupDeleteBranch, navigate, refreshNavigation, requestNavigationRefresh, worktreeMergeStateById]);

  const requestWorktreeCleanup = useCallback((meta: WorktreeMetaDto) => {
    setCleanupDeleteBranch(false);
    setWorktreeCleanupTarget(meta);
  }, []);

  const subscribeTerminalManagerSnapshot = useCallback((
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    terminalManagerWorkspaceSubscriptionRef.current = {
      workspaceId,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevision: options?.knownRevision
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.subscribeTerminalManager(workspaceId, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const requestTerminalManagerRefresh = useCallback((
    workspaceId: string,
    options?: WorkbenchRealtimeKnownRevisionOptions
  ) => {
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    pendingTerminalManagerRefreshWorkspaceIdRef.current = {
      workspaceId,
      scopeKey: buildWorkbenchRealtimeScopeKey(workspaceId, normalizedTargetHostId),
      targetHostId: normalizedTargetHostId,
      knownRevision: options?.knownRevision
    };
    getWorkbenchRealtimeClientForTargetHost(normalizedTargetHostId)?.requestTerminalManagerRefresh(workspaceId, options);
  }, [getWorkbenchRealtimeClientForTargetHost]);

  const addTerminalManagerSnapshotListener = useCallback(
    (listener: (snapshot: TerminalManagerRealtimeSnapshotDto) => void) => {
      terminalManagerSnapshotListenersRef.current.add(listener);
      return () => {
        terminalManagerSnapshotListenersRef.current.delete(listener);
      };
    },
    []
  );

  const markNavigationSessionSeen = useCallback((sessionId: string, seenAt?: string) => {
    setNavigationGroups((current) =>
      markSessionSeenInGroups(current, sessionId, seenAt ?? new Date().toISOString())
    );
  }, []);

  const currentTargetHostIdRef = useRef<string | null>(null);

  const commitNavigationArchiveState = useCallback(
    async (sessionId: string, isArchived: boolean) => {
      pendingArchiveStateBySessionIdRef.current.set(sessionId, isArchived);
      setNavigationGroups((current) =>
        updateSessionArchivedStateInGroups(current, sessionId, isArchived)
      );

      try {
        const session = await updateSessionArchiveState(sessionId, isArchived, { targetHostId: currentTargetHostIdRef.current });
        const nextArchivedState = isArchivedSession(session);

        if (nextArchivedState === isArchived) {
          pendingArchiveStateBySessionIdRef.current.set(sessionId, nextArchivedState);
        } else {
          pendingArchiveStateBySessionIdRef.current.delete(sessionId);
        }

        upsertNavigationSession(session);
        requestNavigationRefresh();
        void refreshNavigation();
      } catch (error) {
        pendingArchiveStateBySessionIdRef.current.delete(sessionId);
        setNavigationGroups((current) =>
          updateSessionArchivedStateInGroups(current, sessionId, !isArchived)
        );
        throw error;
      }
    },
    [refreshNavigation, requestNavigationRefresh, upsertNavigationSession]
  );

  const setSessionWorkspace = useCallback((sessionId: string, workspaceId: string | null) => {
    logPerfDebug("workbench.set_session_workspace", {
      sessionId,
      workspaceId
    });
    setSessionWorkspaceMap((current) => {
      if (!workspaceId) {
        if (!(sessionId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[sessionId];
        return next;
      }

      if (current[sessionId] === workspaceId) {
        return current;
      }

      return {
        ...current,
        [sessionId]: workspaceId
      };
    });
  }, []);

  useEffect(() => {
    hasNavigationDataRef.current = navigationGroups.length > 0;
  }, [navigationGroups]);

  useEffect(() => {
    const peerBindings = collectSidebarWorkspaces(navigationGroups).flatMap((workspace) => {
      const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, workspace);
      const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
      const targetHostId = selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;
      const remoteWorkspaceId = assignment?.remoteWorkspaceId?.trim() || null;

      if (!targetHostId || targetHostId === "current" || !remoteWorkspaceId) {
        return [];
      }

      return [{
        summaryKey: buildPeerWorkspaceSummaryStateKey(activeHostId, workspace.id, targetHostId),
        localWorkspaceId: workspace.id,
        remoteWorkspaceId,
        targetHostId
      }];
    });

    if (peerBindings.length === 0) {
      setPeerWorkspaceNavigationByWorkspaceId({});
      return;
    }

    const grouped = new Map<string, Array<{ summaryKey: string; localWorkspaceId: string; remoteWorkspaceId: string }>>();
    peerBindings.forEach((item) => {
      const bucket = grouped.get(item.targetHostId) ?? [];
      bucket.push({
        summaryKey: item.summaryKey,
        localWorkspaceId: item.localWorkspaceId,
        remoteWorkspaceId: item.remoteWorkspaceId
      });
      grouped.set(item.targetHostId, bucket);
    });

    let disposed = false;

    const load = async () => {
      const nextNavigationState: Record<string, PeerWorkspaceNavigationView> = {};

      await Promise.allSettled(
        [...grouped.entries()].map(async ([targetHostId, items]) => {
          const snapshotResponse = await getScopedWorkbenchSnapshot(targetHostId, {
            awaitDiscovery: false
          });
          const itemByRemoteWorkspaceId = new Map(items.map((item) => [item.remoteWorkspaceId, item] as const));

          snapshotResponse.items.forEach((item) => {
            const binding = itemByRemoteWorkspaceId.get(item.workspace.id);

            if (!binding) {
              return;
            }

            nextNavigationState[binding.summaryKey] = {
              localWorkspaceId: binding.localWorkspaceId,
              activeHostId,
              remoteWorkspaceId: item.workspace.id,
              targetHostId,
              sessions: item.sessions
            };
          });
        })
      );

      if (disposed) {
        return;
      }

      setPeerWorkspaceNavigationByWorkspaceId(nextNavigationState);
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 30_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    activeHostId,
    navigationGroups,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    workspaceHostAssignments
  ]);

  useEffect(() => {
    logPerfDebug("workbench.navigation_state", {
      navigationLoading,
      workspaceCount: navigationGroups.length,
      sessionCount: navigationGroups.reduce((total, item) => total + item.sessions.length, 0)
    });
  }, [navigationGroups, navigationLoading]);

  useEffect(() => {
    if (navigationBootstrapFallbackTimerRef.current !== null) {
      window.clearTimeout(navigationBootstrapFallbackTimerRef.current);
    }

    navigationBootstrapFallbackTimerRef.current = window.setTimeout(() => {
      navigationBootstrapFallbackTimerRef.current = null;

      if (hasReceivedWorkbenchSnapshotRef.current || hasNavigationDataRef.current) {
        return;
      }

      logPerfDebug("workbench.refresh_navigation.ws_fallback_triggered");
      workbenchRealtimeClientRef.current?.requestRefresh();
    }, 1200);

    const client = new WorkbenchRealtimeClient({
      targetHostId: null,
      onConnectionChange: (connectionState) => {
        if (connectionState === "connected") {
          clearSessionProviderPickerCapabilityCache();
        }

        if (connectionState === "reconnect_failed" && !hasNavigationDataRef.current) {
          setNavigationError(t("shell.navigationLoadFailed"));
          showToastRef.current({
            id: "workbench-navigation-connection",
            title: t("shell.navigationLoadFailed"),
            tone: "warning",
            durationMs: 3600
          });
        }
      },
      onSnapshot: (snapshot) => {
        hasReceivedWorkbenchSnapshotRef.current = true;
        logPerfDebug("workbench.ws_snapshot_received", {
          workspaceCount: snapshot.items.length,
          sessionCount: snapshot.items.reduce((total, item) => total + item.sessions.length, 0)
        });
        if (navigationBootstrapFallbackTimerRef.current !== null) {
          window.clearTimeout(navigationBootstrapFallbackTimerRef.current);
          navigationBootstrapFallbackTimerRef.current = null;
        }
        applyWorkbenchSnapshot(snapshot);
        setNavigationLoading(false);
      },
      onFileTreeSnapshot: (snapshot) => dispatchFileTreeSnapshot(snapshot, null),
      onGitSnapshot: (snapshot) => dispatchGitSnapshot(snapshot, null),
      onWorkspaceManagementSnapshot: (snapshot) => dispatchWorkspaceManagementSnapshot(snapshot, null),
      onTerminalManagerSnapshot: (snapshot) => dispatchTerminalManagerSnapshot(snapshot, null),
      onUnauthorized: () => {
        authStore.clear();
        navigate("/login", { replace: true });
      }
    });
    client.primeWorkbenchSnapshot(initialWorkbenchSnapshotRef.current);

    workbenchRealtimeClientRef.current = client;
    const fileTreeSubscription = fileTreeSubscriptionRef.current;
    const pendingFileTreeRefresh = pendingFileTreeRefreshRef.current;
    const gitWorkspaceSubscription = gitWorkspaceSubscriptionRef.current;
    const pendingGitRefreshWorkspaceId = pendingGitRefreshWorkspaceIdRef.current;
    const workspaceManagementSubscription = workspaceManagementSubscriptionRef.current;
    const pendingWorkspaceManagementRefreshWorkspaceId =
      pendingWorkspaceManagementRefreshWorkspaceIdRef.current;
    const terminalManagerWorkspaceSubscription = terminalManagerWorkspaceSubscriptionRef.current;
    const pendingTerminalManagerRefreshWorkspaceId =
      pendingTerminalManagerRefreshWorkspaceIdRef.current;

    if (fileTreeSubscription && !fileTreeSubscription.targetHostId) {
      client.subscribeFileTree(fileTreeSubscription.workspaceId, fileTreeSubscription.paths, {
        knownRevisionByPath: fileTreeSubscription.knownRevisionByPath
      });
    }

    if (gitWorkspaceSubscription && !gitWorkspaceSubscription.targetHostId) {
      client.subscribeGit(gitWorkspaceSubscription.workspaceId, {
        knownRevision: gitWorkspaceSubscription.knownRevision
      });
    }

    if (workspaceManagementSubscription && !workspaceManagementSubscription.targetHostId) {
      client.subscribeWorkspaceManagement(workspaceManagementSubscription.workspaceId, {
        knownRevision: workspaceManagementSubscription.knownRevision
      });
    }

    if (terminalManagerWorkspaceSubscription && !terminalManagerWorkspaceSubscription.targetHostId) {
      client.subscribeTerminalManager(terminalManagerWorkspaceSubscription.workspaceId, {
        knownRevision: terminalManagerWorkspaceSubscription.knownRevision
      });
    }

    if (pendingFileTreeRefresh && !pendingFileTreeRefresh.targetHostId) {
      client.requestFileTreeRefresh(
        pendingFileTreeRefresh.workspaceId,
        pendingFileTreeRefresh.paths,
        {
          knownRevisionByPath: pendingFileTreeRefresh.knownRevisionByPath
        }
      );
    }

    if (pendingGitRefreshWorkspaceId && !pendingGitRefreshWorkspaceId.targetHostId) {
      client.requestGitRefresh(pendingGitRefreshWorkspaceId.workspaceId, {
        knownRevision: pendingGitRefreshWorkspaceId.knownRevision
      });
    }

    if (pendingWorkspaceManagementRefreshWorkspaceId && !pendingWorkspaceManagementRefreshWorkspaceId.targetHostId) {
      client.requestWorkspaceManagementRefresh(
        pendingWorkspaceManagementRefreshWorkspaceId.workspaceId,
        {
          knownRevision: pendingWorkspaceManagementRefreshWorkspaceId.knownRevision
        }
      );
    }

    if (pendingTerminalManagerRefreshWorkspaceId && !pendingTerminalManagerRefreshWorkspaceId.targetHostId) {
      client.requestTerminalManagerRefresh(
        pendingTerminalManagerRefreshWorkspaceId.workspaceId,
        {
          knownRevision: pendingTerminalManagerRefreshWorkspaceId.knownRevision
        }
      );
    }

    client.start();

    return () => {
      if (navigationBootstrapFallbackTimerRef.current !== null) {
        window.clearTimeout(navigationBootstrapFallbackTimerRef.current);
        navigationBootstrapFallbackTimerRef.current = null;
      }

      if (workbenchRealtimeClientRef.current === client) {
        workbenchRealtimeClientRef.current = null;
      }
      client.close();
      peerWorkbenchRealtimeClientByHostRef.current.forEach((peerClient) => peerClient.close());
      peerWorkbenchRealtimeClientByHostRef.current.clear();
      activeWorkbenchRealtimeScopeKeyRef.current = null;
      activeWorkbenchRealtimeTargetHostIdRef.current = null;
    };
  }, [
    dispatchFileTreeSnapshot,
    dispatchGitSnapshot,
    dispatchTerminalManagerSnapshot,
    dispatchWorkspaceManagementSnapshot,
    navigate
  ]);

  useEffect(() => {
    writeStoredValue(LEFT_PANEL_WIDTH_KEY, String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    writeStoredValue(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    writeStoredValue(LEFT_PANEL_COLLAPSED_KEY, String(leftCollapsed));
  }, [leftCollapsed]);

  useEffect(() => {
    writeStoredValue(RIGHT_PANEL_COLLAPSED_KEY, String(rightCollapsed));
  }, [rightCollapsed]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      removeStoredValue(SELECTED_WORKSPACE_ID_KEY);
      return;
    }

    writeStoredValue(SELECTED_WORKSPACE_ID_KEY, selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (infoPanelReady || rightCollapsed) {
      return;
    }

    const timer = window.setTimeout(() => {
      setInfoPanelReady(true);
    }, INFO_PANEL_BOOT_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [infoPanelReady, rightCollapsed]);

  const routeSessionMatch = resolveRouteSessionMatch(location.pathname);
  const currentSessionId = routeSessionMatch?.sessionId ?? null;
  const isDraftSession = currentSessionId ? isDraftSessionId(currentSessionId) : false;
  const scopedNavigationGroups = useMemo(
    () =>
      navigationGroups.map((group) => {
        const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, group.workspace);
        const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
        const targetHostId = selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;
        const peerNavigation =
          targetHostId && targetHostId !== "current"
            ? peerWorkspaceNavigationByWorkspaceId[
              buildPeerWorkspaceSummaryStateKey(activeHostId, group.workspace.id, targetHostId)
            ] ?? null
            : null;

        return {
          ...group,
          sessions: peerNavigation?.sessions ?? group.sessions
        };
      }),
    [
      activeHostId,
      navigationGroups,
      peerWorkspaceNavigationByWorkspaceId,
      resolveRemoteSelectedHostId,
      resolveSelectableHostId,
      workspaceHostAssignments
    ]
  );
  const flattenedCanonicalSessions = useMemo(
    () => flattenNavigationSessions(scopedNavigationGroups),
    [scopedNavigationGroups]
  );
  const flattenedVisibleSessions = useMemo(
    () => flattenNavigationSessions(scopedNavigationGroups),
    [scopedNavigationGroups]
  );
  const fullNavigationTree = useMemo(
    () => buildNavigationSessionTreeFromEntries(flattenedCanonicalSessions, sessionDisplaySortMode),
    [flattenedCanonicalSessions, sessionDisplaySortMode]
  );
  const knownWorkspaceIds = useMemo(
    () => collectKnownWorkspaceIds(navigationGroups),
    [navigationGroups]
  );
  const collapsedWorkspaceIdSet = useMemo(() => new Set(collapsedWorkspaceIds), [collapsedWorkspaceIds]);
  const favoriteSessionIds = useMemo(
    () =>
      flattenedCanonicalSessions
        .filter((item) => item.session.isFavorite === true)
        .map((item) => item.session.sessionId),
    [flattenedCanonicalSessions]
  );
  const favoriteSessionIdSet = useMemo(() => new Set(favoriteSessionIds), [favoriteSessionIds]);
  const workspaceIdSignature = useMemo(
    () => navigationGroups.map((group) => group.workspace.id).sort((left, right) => left.localeCompare(right)).join("|"),
    [navigationGroups]
  );

  useEffect(() => {
    const workspaceIds = workspaceIdSignature
      ? workspaceIdSignature.split("|").filter((workspaceId) => workspaceId.length > 0)
      : [];

    if (workspaceIds.length === 0) {
      setLightweightChatSessionsByWorkspaceId({});
      setLightweightArchivedChatSessionsByWorkspaceId({});
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    void Promise.allSettled(
      workspaceIds.map(async (workspaceId) => {
        const response = await listAffairsLightweightSessions(workspaceId, {
          signal: abortController.signal
        });
        return {
          workspaceId,
          sessions: response.items.filter((session) => !session.isArchived),
          archivedSessions: response.items.filter((session) => session.isArchived)
        };
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }

      setLightweightChatSessionsByWorkspaceId((current) => {
        const next: Record<string, SessionSummaryDto[]> = {};

        for (const workspaceId of workspaceIds) {
          next[workspaceId] = current[workspaceId] ?? [];
        }

        for (const result of results) {
          if (result.status === "fulfilled") {
            next[result.value.workspaceId] = result.value.sessions;
          }
        }

        return next;
      });
      setLightweightArchivedChatSessionsByWorkspaceId((current) => {
        const next: Record<string, SessionSummaryDto[]> = {};

        for (const workspaceId of workspaceIds) {
          next[workspaceId] = current[workspaceId] ?? [];
        }

        for (const result of results) {
          if (result.status === "fulfilled") {
            next[result.value.workspaceId] = result.value.archivedSessions;
          }
        }

        return next;
      });
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [workspaceIdSignature]);

  const applyNavigationGroupsSnapshot = useCallback((groups: WorkspaceSessionGroup[]) => {
    const nextSnapshot = createWorkbenchSnapshotFromGroups(groups, collapsedWorkspaceIds);

    initialWorkbenchSnapshotRef.current = nextSnapshot;
    writeWorkbenchNavigationSnapshot(nextSnapshot);
    navigationGroupsRef.current = groups;
    setNavigationGroups(groups);
  }, [collapsedWorkspaceIds]);

  const handleToggleWorkspaceCollapse = useCallback((workspaceId: string) => {
    const nextCollapsed = !collapsedWorkspaceIdSet.has(workspaceId);
    const nextCollapsedWorkspaceIds = setStoredIdPresence(
      collapsedWorkspaceIds,
      workspaceId,
      nextCollapsed
    );
    const nextSnapshot = createWorkbenchSnapshotFromGroups(navigationGroups, nextCollapsedWorkspaceIds);

    initialWorkbenchSnapshotRef.current = nextSnapshot;
    writeWorkbenchNavigationSnapshot(nextSnapshot);
    setCollapsedWorkspaceIds(nextCollapsedWorkspaceIds);
    void updateWorkspaceNavigationState(workspaceId, {
      collapsed: nextCollapsed
    }).catch((error) => {
      const revertedCollapsedWorkspaceIds = setStoredIdPresence(
        nextCollapsedWorkspaceIds,
        workspaceId,
        !nextCollapsed
      );
      const revertedSnapshot = createWorkbenchSnapshotFromGroups(
        navigationGroups,
        revertedCollapsedWorkspaceIds
      );

      initialWorkbenchSnapshotRef.current = revertedSnapshot;
      writeWorkbenchNavigationSnapshot(revertedSnapshot);
      setCollapsedWorkspaceIds(revertedCollapsedWorkspaceIds);
      showToastRef.current({
        title: error instanceof Error ? error.message : t("shell.workspaceCollapseStateSaveFailed"),
        tone: "error"
      });
    });
  }, [collapsedWorkspaceIdSet, collapsedWorkspaceIds, navigationGroups]);

  const handleStartWorkspaceReorder = useCallback(() => {
    pendingWorkspaceReorderRef.current = {
      originalGroups: navigationGroupsRef.current
    };
  }, []);

  const handlePreviewWorkspaceReorder = useCallback((
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    position: WorkspaceDropPosition
  ) => {
    const currentGroups = navigationGroupsRef.current;
    const nextGroups = reorderWorkspaceGroups(
      currentGroups,
      sourceWorkspaceId,
      targetWorkspaceId,
      position
    );

    if (nextGroups === currentGroups) {
      return;
    }

    applyNavigationGroupsSnapshot(nextGroups);
  }, [applyNavigationGroupsSnapshot]);

  const handleCommitWorkspaceReorder = useCallback(() => {
    const pendingReorder = pendingWorkspaceReorderRef.current;
    pendingWorkspaceReorderRef.current = null;
    const currentGroups = navigationGroupsRef.current;

    if (!pendingReorder) {
      return;
    }

    if (
      pendingReorder.originalGroups.length === currentGroups.length
      && pendingReorder.originalGroups.every(
        (group, index) => group.workspace.id === currentGroups[index]?.workspace.id
      )
    ) {
      return;
    }

    void reorderWorkspaces({
      workspaceIds: currentGroups.map((group) => group.workspace.id)
    }).catch((error) => {
      applyNavigationGroupsSnapshot(pendingReorder.originalGroups);
      showToastRef.current({
        title: error instanceof Error ? error.message : t("shell.workspaceReorderFailed"),
        tone: "error"
      });
    });
  }, [applyNavigationGroupsSnapshot]);

  useEffect(() => {
    const nextState = new Map<
      string,
      {
        activityState: SessionSummaryDto["activityState"];
        completedAt: string | null;
        runningState: SessionSummaryDto["runningState"];
      }
    >();

    flattenedCanonicalSessions.forEach(({ session }) => {
      nextState.set(session.sessionId, {
        activityState: session.activityState,
        completedAt: session.completedAt ?? null,
        runningState: session.runningState ?? null
      });
    });

    if (!completionBaselineReadyRef.current) {
      completionBaselineReadyRef.current = true;
      previousSessionCompletionStateRef.current = nextState;
      return;
    }

    flattenedCanonicalSessions.forEach(({ session }) => {
      if (session.sessionId === currentSessionId) {
        return;
      }

      const previousState = previousSessionCompletionStateRef.current.get(session.sessionId);

      if (!previousState) {
        return;
      }

      const becameUnreadCompleted =
        previousState.activityState !== "completed_unread" && session.activityState === "completed_unread";

      const sessionTitle = session.title?.trim() || t("common.unknown");
      if (notifyOnSessionCompleted && becameUnreadCompleted) {
        const description = t("conversation.backgroundCompletionToastDescription", {
          title: sessionTitle
        });

        showToastRef.current({
          id: `workbench-session-completed-${session.sessionId}-${session.completedAt ?? "unknown"}`,
          title: t("conversation.backgroundCompletionToastTitle"),
          description,
          tone: "success",
          durationMs: 8_000,
          action: {
            label: t("shell.contextOpenSession"),
            onClick: () => openSessionFromToast(session.workspaceId, session.sessionId)
          }
        });
        void platformBridgeRef.current.showNotification(
          t("conversation.backgroundCompletionToastTitle"),
          description
        );
      }

      const becameFailed =
        previousState.runningState !== "failed"
        && (session.runningState ?? null) === "failed";

      if (notifyOnSessionFailed && becameFailed) {
        const detail = normalizeSessionFailureDetail(session) ?? t("conversation.runtimeFailed");
        const description = t("conversation.backgroundFailureToastDescription", {
          title: sessionTitle,
          detail
        });

        showToastRef.current({
          id: `workbench-session-failed-${session.sessionId}-${session.updatedAt}`,
          title: t("conversation.backgroundFailureToastTitle"),
          description,
          tone: "error",
          durationMs: 8_000,
          action: {
            label: t("shell.contextOpenSession"),
            onClick: () => openSessionFromToast(session.workspaceId, session.sessionId)
          }
        });
        void platformBridgeRef.current.showNotification(
          t("conversation.backgroundFailureToastTitle"),
          description
        );
      }
    });

    previousSessionCompletionStateRef.current = nextState;
  }, [
    currentSessionId,
    flattenedCanonicalSessions,
    notifyOnSessionCompleted,
    notifyOnSessionFailed,
    openSessionFromToast
  ]);

  useEffect(() => {
    permissionWatchSessionsRef.current = flattenedCanonicalSessions
      .map((item) => item.session)
      .filter((session) => session.sessionId !== currentSessionId && isPermissionWatchSession(session))
      .map((session) => ({
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        title: session.title?.trim() || t("common.unknown")
      }));
  }, [currentSessionId, flattenedCanonicalSessions]);

  useEffect(() => {
    let disposed = false;
    let pollTimer: number | null = null;

    const scheduleNextPoll = () => {
      pollTimer = window.setTimeout(() => {
        void pollPermissionRequests().finally(() => {
          if (!disposed) {
            scheduleNextPoll();
          }
        });
      }, WORKBENCH_PERMISSION_POLL_INTERVAL_MS);
    };

    const pollPermissionRequests = async () => {
      const watchedSessions = permissionWatchSessionsRef.current;

      if (watchedSessions.length === 0) {
        if (!permissionPollBaselineReadyRef.current) {
          permissionPollBaselineReadyRef.current = true;
        }
        permissionRefreshSignatureRef.current = "";
        return;
      }

      const watchedSessionIdSet = new Set(watchedSessions.map((session) => session.sessionId));
      const results = await Promise.all(
        watchedSessions.map(async (session) => {
          try {
            const response = await getSessionPermissionRequests(session.sessionId);
            return {
              session,
              items: response.items
            };
          } catch {
            return {
              session,
              items: null
            };
          }
        })
      );

      if (disposed) {
        return;
      }

      for (const result of results) {
        if (!result.items) {
          continue;
        }

        const pendingRequests = result.items.filter((request) => request.status === "pending");
        const nextPendingRequestIds = new Set(pendingRequests.map((request) => request.id));
        const previousPendingRequestIds =
          pendingPermissionRequestIdsBySessionRef.current.get(result.session.sessionId) ?? new Set<string>();

        if (permissionPollBaselineReadyRef.current) {
          pendingRequests.forEach((request) => {
            if (previousPendingRequestIds.has(request.id)) {
              return;
            }

            if (!notifyOnPermissionRequest) {
              return;
            }

            const description = t("conversation.backgroundPermissionToastDescription", {
              title: result.session.title,
              requestTitle: request.title
            });
            const toastTitle = request.kind === "user_input"
              ? t("conversation.permissionQuestionToastTitle")
              : t("conversation.permissionRequestToastTitle");

            showToastRef.current({
              id: `workbench-permission-request-${request.id}`,
              title: toastTitle,
              description,
              tone: "warning",
              durationMs: 8_000,
              action: {
                label: t("shell.contextOpenSession"),
                onClick: () => openSessionFromToast(result.session.workspaceId, result.session.sessionId)
              }
            });
            void platformBridgeRef.current.showNotification(
              toastTitle,
              description
            );
          });
        }

        pendingPermissionRequestIdsBySessionRef.current.set(
          result.session.sessionId,
          nextPendingRequestIds
        );
      }

      for (const [sessionId, requestIds] of pendingPermissionRequestIdsBySessionRef.current.entries()) {
        if (!watchedSessionIdSet.has(sessionId) && requestIds.size === 0) {
          pendingPermissionRequestIdsBySessionRef.current.delete(sessionId);
        }
      }

      const nextRefreshSignature = buildPermissionRefreshSignature(
        pendingPermissionRequestIdsBySessionRef.current,
        watchedSessionIdSet
      );

      if (
        permissionPollBaselineReadyRef.current &&
        nextRefreshSignature !== permissionRefreshSignatureRef.current
      ) {
        workbenchRealtimeClientRef.current?.requestRefresh();
      }

      permissionRefreshSignatureRef.current = nextRefreshSignature;

      permissionPollBaselineReadyRef.current = true;
    };

    void pollPermissionRequests().finally(() => {
      if (!disposed) {
        scheduleNextPoll();
      }
    });

    return () => {
      disposed = true;

      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [notifyOnPermissionRequest, openSessionFromToast]);

  useEffect(() => {
    if (navigationLoading && navigationGroups.length === 0) {
      return;
    }

    // 工作区选择必须跟随当前快照收敛，否则会指向已经不存在的工作区。
    setCollapsedWorkspaceIds((current) => retainKnownIds(current, knownWorkspaceIds));
    setSelectedWorkspaceId((current) => {
      if (!current) {
        return null;
      }

      if (knownWorkspaceIds.has(current)) {
        return current;
      }

      // Peer HOST 的远端 workspaceId 不在主 HOST 的导航快照里。
      // 这里不能把它清掉，否则右侧工作区会立刻退回主 HOST 的默认项目。
      if (
        (selectedWorkspaceRef?.hostId && selectedWorkspaceRef.hostId !== "current" && selectedWorkspaceRef.workspaceId === current)
        || (routeScopedWorkspaceRef?.hostId && routeScopedWorkspaceRef.hostId !== "current" && routeScopedWorkspaceRef.workspaceId === current)
      ) {
        return current;
      }

      return null;
    });
  }, [knownWorkspaceIds, navigationLoading, routeScopedWorkspaceRef, selectedWorkspaceRef]);

  const findSessionEntryByScopeFromEntries = useCallback((
    entries: WorkbenchNavigationEntry[],
    sessionId: string | null | undefined,
    options?: {
      displayWorkspaceId?: string | null;
      targetHostId?: string | null;
    }
  ): WorkbenchNavigationEntry | null => {
    const normalizedSessionId = sessionId?.trim() || "";

    if (!normalizedSessionId) {
      return null;
    }

    const normalizedDisplayWorkspaceId = options?.displayWorkspaceId?.trim() || null;
    const normalizedTargetHostId = normalizeTargetHostId(options?.targetHostId);
    const candidates = entries.filter((item) => item.session.sessionId === normalizedSessionId);

    if (candidates.length === 0) {
      return null;
    }

    if (normalizedDisplayWorkspaceId) {
      const workspaceMatched = candidates.filter((item) => item.workspace.id === normalizedDisplayWorkspaceId);

      if (workspaceMatched.length === 1) {
        return workspaceMatched[0] ?? null;
      }

      if (workspaceMatched.length > 1 && normalizedTargetHostId !== null) {
        const hostMatched = workspaceMatched.find((item) =>
          isSameTargetHostId(
            normalizeScopeTargetHostId(resolveWorkspaceRefForTargetHost(item.workspace, normalizedTargetHostId)),
            normalizedTargetHostId
          )
        );

        if (hostMatched) {
          return hostMatched;
        }
      }
    }

    if (normalizedTargetHostId !== null) {
      const hostMatched = candidates.find((item) =>
        isSameTargetHostId(
          normalizeScopeTargetHostId(resolveWorkspaceRefForTargetHost(item.workspace, normalizedTargetHostId)),
          normalizedTargetHostId
        )
      );

      if (hostMatched) {
        return hostMatched;
      }
    }

    return candidates[0] ?? null;
  }, [resolveWorkspaceRefForTargetHost]);
  const findCanonicalSessionEntryByScope = useCallback((
    sessionId: string | null | undefined,
    options?: {
      displayWorkspaceId?: string | null;
      targetHostId?: string | null;
    }
  ): WorkbenchNavigationEntry | null => {
    const matchedEntry = findSessionEntryByScopeFromEntries(flattenedCanonicalSessions, sessionId, options);

    if (!matchedEntry) {
      logPerfDebug("resource_scope.find_session_entry.miss", {
        sessionId: sessionId?.trim() || "",
        displayWorkspaceId: options?.displayWorkspaceId?.trim() || null,
        targetHostId: normalizeTargetHostId(options?.targetHostId)
      });
      return null;
    }

    return matchedEntry;
  }, [findSessionEntryByScopeFromEntries, flattenedCanonicalSessions]);
  const findVisibleSessionEntryByScope = useCallback((
    sessionId: string | null | undefined,
    options?: {
      displayWorkspaceId?: string | null;
      targetHostId?: string | null;
    }
  ): WorkbenchNavigationEntry | null => {
    const matchedEntry = findSessionEntryByScopeFromEntries(flattenedVisibleSessions, sessionId, options);

    logPerfDebug("resource_scope.find_visible_session_entry", {
      sessionId: sessionId?.trim() || "",
      displayWorkspaceId: options?.displayWorkspaceId?.trim() || null,
      targetHostId: normalizeTargetHostId(options?.targetHostId),
      matched: matchedEntry !== null,
      matchedWorkspaceId: matchedEntry?.workspace.id ?? null,
      matchedSessionWorkspaceId: matchedEntry?.session.workspaceId ?? null,
      matchedSessionId: matchedEntry?.session.sessionId ?? null
    });

    return matchedEntry;
  }, [
    findSessionEntryByScopeFromEntries,
    flattenedVisibleSessions
  ]);

  const resolveSessionEntryWorkspaceRef = useCallback((entry: WorkbenchNavigationEntry | null): WorkspaceRef | null => {
    if (!entry) {
      return null;
    }

    if (entry.workspace.id === routeWorkspaceId && entry.session.sessionId === currentSessionId) {
      const routeTargetHostId = normalizeScopeTargetHostId(routeScopedWorkspaceRef) ?? activeTargetHostId;

      if (routeTargetHostId) {
        const routeRef = resolveWorkspaceRefForTargetHost(entry.workspace, routeTargetHostId);
        logPerfDebug("resource_scope.resolve_session_entry_workspace_ref", {
          sessionId: entry.session.sessionId,
          entryWorkspaceId: entry.workspace.id,
          routeWorkspaceId,
          routeTargetHostId,
          resolvedHostId: routeRef?.hostId ?? null,
          resolvedWorkspaceId: routeRef?.workspaceId ?? null,
          source: "route"
        });
        return routeRef;
      }

      return makeWorkspaceRef(entry.workspace.id, "current");
    }

    const entryAssignment = resolveWorkspaceHostAssignment(
      workspaceHostAssignments,
      activeHostId,
      entry.workspace
    );
    const entrySelectedHostId = resolveSelectableHostId(entryAssignment?.selectedHostId);
    const assignedTargetHostId = entrySelectedHostId ? resolveRemoteSelectedHostId(entrySelectedHostId) : null;
    const peerNavigation =
      assignedTargetHostId && assignedTargetHostId !== "current"
        ? peerWorkspaceNavigationByWorkspaceId[
          buildPeerWorkspaceSummaryStateKey(activeHostId, entry.workspace.id, assignedTargetHostId)
        ] ?? null
        : null;
    const sessionBelongsToPeerNavigation = Boolean(
      peerNavigation?.sessions.some((session) => session.sessionId === entry.session.sessionId)
    );
    const scopedWorkspaceRef =
      sessionBelongsToPeerNavigation && assignedTargetHostId
        ? resolveWorkspaceRefForTargetHost(entry.workspace, assignedTargetHostId)
        : makeWorkspaceRef(entry.workspace.id, "current");
    logPerfDebug("resource_scope.resolve_session_entry_workspace_ref", {
      sessionId: entry.session.sessionId,
      entryWorkspaceId: entry.workspace.id,
      routeWorkspaceId,
      activeTargetHostId: activeTargetHostId ?? null,
      selectedHostId: entrySelectedHostId ?? null,
      assignedTargetHostId: assignedTargetHostId ?? null,
      peerNavigationSessionCount: peerNavigation?.sessions.length ?? 0,
      sessionBelongsToPeerNavigation,
      resolvedHostId: scopedWorkspaceRef?.hostId ?? null,
      resolvedWorkspaceId: scopedWorkspaceRef?.workspaceId ?? null,
      source: sessionBelongsToPeerNavigation ? "peer_navigation" : "current"
    });
    return scopedWorkspaceRef ?? makeWorkspaceRef(entry.workspace.id, "current");
  }, [
    activeTargetHostId,
    activeHostId,
    peerWorkspaceNavigationByWorkspaceId,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    resolveWorkspaceRefForTargetHost,
    currentSessionId,
    routeScopedWorkspaceRef,
    routeWorkspaceId,
    workspaceHostAssignments
  ]);

  const buildSessionEntryPath = useCallback((entry: WorkbenchNavigationEntry | null): string | null => {
    if (!entry) {
      return null;
    }

    const workspaceRef = resolveSessionEntryWorkspaceRef(entry);
    const path = buildWorkspaceSessionPath(
      entry.workspace.id,
      entry.session.sessionId,
      workspaceRef
    );
    logPerfDebug("resource_scope.build_session_entry_path", {
      sessionId: entry.session.sessionId,
      entryWorkspaceId: entry.workspace.id,
      path,
      hostId: workspaceRef?.hostId ?? null,
      requestWorkspaceId: workspaceRef?.workspaceId ?? null
    });
    return path;
  }, [resolveSessionEntryWorkspaceRef]);

  const currentSessionContext = findCanonicalSessionEntryByScope(currentSessionId, {
    displayWorkspaceId: routeWorkspaceId,
    targetHostId: normalizeScopeTargetHostId(routeScopedWorkspaceRef) ?? activeTargetHostId
  });
  const sessionWorkspaceId =
    currentSessionContext?.workspace.id ??
    (currentSessionId ? sessionWorkspaceMap[currentSessionId] ?? null : null);
  const validatedRouteWorkspaceId =
    routeWorkspaceId && (
      knownWorkspaceIds.has(routeWorkspaceId)
      || (routeScopedWorkspaceRef?.hostId && routeScopedWorkspaceRef.hostId !== "current")
    )
      ? routeWorkspaceId
      : null;
  const validatedSelectedWorkspaceId =
    selectedWorkspaceId && (
      knownWorkspaceIds.has(selectedWorkspaceId)
      || (
        selectedWorkspaceRef?.hostId
        && selectedWorkspaceRef.hostId !== "current"
        && selectedWorkspaceRef.workspaceId === selectedWorkspaceId
      )
    )
      ? selectedWorkspaceId
      : null;
  const explicitWorkspaceId =
    validatedRouteWorkspaceId ?? sessionWorkspaceId ?? validatedSelectedWorkspaceId ?? null;
  const currentWorkspaceId =
    explicitWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;
  const currentWorkspace = useMemo(
    () => navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace ?? null,
    [currentWorkspaceId, navigationGroups]
  );
  const currentWorkspaceAssignedTargetHostId = useMemo(() => {
    if (!currentWorkspace) {
      return null;
    }

    const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, currentWorkspace);
    const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
    return selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;
  }, [
    activeHostId,
    currentWorkspace,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    workspaceHostAssignments
  ]);
  const currentWorkspaceRef = useMemo<WorkspaceRef | null>(() => {
    if (!currentWorkspaceId) {
      return null;
    }

    if (routeHasExplicitWorkspaceScope && routeScopedWorkspaceRef?.workspaceId === currentWorkspaceId) {
      if (routeScopedWorkspaceRef.hostId === "current") {
        return routeScopedWorkspaceRef;
      }

      if (currentWorkspace) {
        return resolveWorkspaceRefForTargetHost(currentWorkspace, routeScopedWorkspaceRef.hostId);
      }

      return null;
    }

    if (
      selectedWorkspaceRef
      && (
        selectedWorkspaceRef.workspaceId === currentWorkspaceId
        || (
          selectedWorkspaceId === currentWorkspaceId
          && selectedWorkspaceRef.hostId !== "current"
          && !routeHasExplicitWorkspaceScope
        )
      )
    ) {
      if (selectedWorkspaceRef.hostId !== "current") {
        if (currentWorkspace) {
          return resolveWorkspaceRefForTargetHost(currentWorkspace, selectedWorkspaceRef.hostId);
        }

        return null;
      }

      if (currentWorkspaceAssignedTargetHostId) {
        // 普通工作区路由里读出来的 current 引用可能已经过期。
        // 只要当前工作区已经绑定到 Peer HOST，就不能让这条本地选择把作用域压回主 HOST。
        if (currentWorkspace) {
          const assignedWorkspaceRef = resolveWorkspaceRefForTargetHost(currentWorkspace, currentWorkspaceAssignedTargetHostId);

          if (assignedWorkspaceRef) {
            return assignedWorkspaceRef;
          }
        }
      }

      return selectedWorkspaceRef;
    }

    if (activeTargetHostId) {
      return currentWorkspace
        ? resolveWorkspaceRefForTargetHost(currentWorkspace, activeTargetHostId)
        : null;
    }

    if (currentWorkspace && currentWorkspaceAssignedTargetHostId) {
      const assignedWorkspaceRef = resolveWorkspaceRefForTargetHost(currentWorkspace, currentWorkspaceAssignedTargetHostId);

      if (assignedWorkspaceRef) {
        return assignedWorkspaceRef;
      }
    }

    return makeWorkspaceRef(currentWorkspaceId, "current");
  }, [
    activeTargetHostId,
    activeHostId,
    currentWorkspace,
    currentWorkspaceAssignedTargetHostId,
    currentWorkspaceId,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    resolveWorkspaceRefForTargetHost,
    routeHasExplicitWorkspaceScope,
    routeScopedWorkspaceRef,
    selectedWorkspaceId,
    selectedWorkspaceRef,
    workspaceHostAssignments
  ]);
  const currentTargetHostId =
    currentWorkspaceRef && currentWorkspaceRef.hostId !== "current"
      ? currentWorkspaceRef.hostId
      : activeTargetHostId;
  currentTargetHostIdRef.current = currentTargetHostId;
  const currentWorkspaceName = useMemo(
    () => currentWorkspace?.name ?? null,
    [currentWorkspace]
  );
  const currentToolWorkspaceId =
    currentSessionContext
      ? resolveSessionToolWorkspaceId(
        currentSessionContext.session,
        currentSessionContext.session.sessionIsolatedWorkspace
      )
      : currentWorkspaceId;
  const currentAuxiliaryWorkspaceId = currentToolWorkspaceId ?? currentWorkspaceId;
  const currentRequestWorkspaceId =
    currentTargetHostId
      ? currentSessionContext
        ? currentToolWorkspaceId ?? currentWorkspaceRef?.workspaceId ?? null
        : currentWorkspaceRef?.workspaceId ?? null
      : currentWorkspaceRef?.workspaceId ?? currentAuxiliaryWorkspaceId;
  const currentWorkbenchRealtimeScopeKey = useMemo(
    () => buildWorkbenchRealtimeScopeKey(currentRequestWorkspaceId, currentTargetHostId),
    [currentRequestWorkspaceId, currentTargetHostId]
  );
  const currentTerminalSnapshotCacheKey = useMemo(
    () => currentRequestWorkspaceId ? buildTerminalManagerSnapshotKey(currentRequestWorkspaceId, currentTargetHostId) : null,
    [currentRequestWorkspaceId, currentTargetHostId]
  );
  const refreshTerminalManagerSnapshot = useCallback((
    workspaceId: string | null | undefined,
    targetHostId?: string | null
  ) => {
    const normalizedWorkspaceId = workspaceId?.trim() || null;

    if (!normalizedWorkspaceId) {
      return;
    }

    const normalizedTargetHostId = normalizeTargetHostId(targetHostId);
    const cacheKey = buildTerminalManagerSnapshotKey(normalizedWorkspaceId, normalizedTargetHostId);
    const cachedSnapshot = readViewSnapshot<{ revision?: string | null }>(cacheKey, 60 * 1000);
    const knownRevision = typeof cachedSnapshot?.revision === "string" ? cachedSnapshot.revision : null;

    subscribeTerminalManagerSnapshot(normalizedWorkspaceId, {
      knownRevision,
      skipKnownRevision: true,
      targetHostId: normalizedTargetHostId
    });
    requestTerminalManagerRefresh(normalizedWorkspaceId, {
      knownRevision,
      skipKnownRevision: true,
      targetHostId: normalizedTargetHostId
    });
  }, [
    requestTerminalManagerRefresh,
    subscribeTerminalManagerSnapshot
  ]);
  useEffect(() => {
    const previousScopeKey = activeWorkbenchRealtimeScopeKeyRef.current;
    const previousTargetHostId = activeWorkbenchRealtimeTargetHostIdRef.current;
    const nextTargetHostId = normalizeTargetHostId(currentTargetHostId);

    if (previousScopeKey === currentWorkbenchRealtimeScopeKey) {
      return;
    }

    if (previousScopeKey) {
      clearWorkbenchRealtimeBindings(previousScopeKey);
    }

    if (previousTargetHostId && previousTargetHostId !== nextTargetHostId) {
      const previousPeerClient = peerWorkbenchRealtimeClientByHostRef.current.get(previousTargetHostId);
      previousPeerClient?.close();
      peerWorkbenchRealtimeClientByHostRef.current.delete(previousTargetHostId);
    }

    activeWorkbenchRealtimeScopeKeyRef.current = currentWorkbenchRealtimeScopeKey;
    activeWorkbenchRealtimeTargetHostIdRef.current = nextTargetHostId;
  }, [clearWorkbenchRealtimeBindings, currentTargetHostId, currentWorkbenchRealtimeScopeKey]);
  const isMobileShell = shellMode === "mobile";
  const workbenchHomePath = resolveWorkbenchHomePath(shellMode);
  const routeCodeEmbeddedAffairsSection = resolveCodeEmbeddedAffairsSectionFromPath(location.pathname);

  useEffect(() => {
    if (!currentWorkspaceId || !isLightweightChatRoute(location.pathname)) {
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    void listAffairsLightweightSessions(currentWorkspaceId, {
      signal: abortController.signal
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setLightweightChatSessionsByWorkspaceId((current) => ({
          ...current,
          [currentWorkspaceId]: response.items.filter((session) => !session.isArchived)
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [currentWorkspaceId, location.pathname]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setCodeTerminalDockState(null);
      return;
    }

    setCodeTerminalDockState(
      readCodeTerminalDockState(currentWorkspaceId)
      ?? createDefaultCodeTerminalDockState(currentWorkspaceId)
    );
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setCodeEmbeddedAffairsState(null);
      setCodeShortcutAffairsState(null);
      return;
    }

    if (!routeCodeEmbeddedAffairsSection) {
      setCodeEmbeddedAffairsState(null);
    }

    setCodeShortcutAffairsState(createDefaultAffairsViewState(currentWorkspaceId));
  }, [currentWorkspaceId, routeCodeEmbeddedAffairsSection]);

  useEffect(() => {
    if (!currentWorkspaceId || !routeCodeEmbeddedAffairsSection) {
      return;
    }

    if (
      codeEmbeddedAffairsState?.workspaceId === currentWorkspaceId
      && codeEmbeddedAffairsState.primarySection === routeCodeEmbeddedAffairsSection
    ) {
      return;
    }

    const currentState =
      readAffairsViewState(currentWorkspaceId)
      ?? codeEmbeddedAffairsState
      ?? createDefaultAffairsViewState(currentWorkspaceId);
    const nextState = routeCodeEmbeddedAffairsSection === "library"
      ? createDefaultAffairsLibraryLandingState(currentWorkspaceId, currentState)
      : {
          ...currentState,
          workspaceId: currentWorkspaceId,
          primarySection: "workbench" as const,
          selectedNodeId: "workbench:overview",
          selectedObjectId: null,
          selectedDocumentId: null,
          pendingLibraryPreview: null
        };

    setRightCollapsed(nextState.primarySection === "workbench");
    setCodeEmbeddedAffairsState(nextState);
  }, [
    codeEmbeddedAffairsState,
    currentWorkspaceId,
    routeCodeEmbeddedAffairsSection
  ]);

  useEffect(() => {
    if (!codeEmbeddedAffairsState) {
      return;
    }

    if (
      isSessionDetailRoute(location.pathname)
      || isSessionsRoute(location.pathname)
      || isCodeEmbeddedAffairsRoute(location.pathname)
    ) {
      return;
    }

    setCodeEmbeddedAffairsState(null);
  }, [codeEmbeddedAffairsState, location.pathname]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setCodeShortcutRailHostState(null);
      return;
    }

    setCodeShortcutRailHostState(resolveCodeShortcutRailHostState(currentWorkspaceId, currentWorkspace));
  }, [
    currentWorkspace,
    currentWorkspace?.shortcutAppsCollapsed,
    currentWorkspace?.shortcutAppsSide,
    currentWorkspaceId
  ]);

  const updateCodeTerminalDockState = useCallback((
    updater: (current: CodeTerminalDockState) => CodeTerminalDockState
  ) => {
    if (!currentWorkspaceId) {
      return;
    }

    setCodeTerminalDockState((current) => {
      const baseState = current?.workspaceId === currentWorkspaceId
        ? current
        : readCodeTerminalDockState(currentWorkspaceId)
          ?? createDefaultCodeTerminalDockState(currentWorkspaceId);
      const nextState = updater(baseState);
      writeCodeTerminalDockState(nextState);
      return nextState;
    });
  }, [currentWorkspaceId]);

  const updateCodeShortcutRailHostState = useCallback((
    updater: (current: CodeShortcutRailHostState) => CodeShortcutRailHostState
  ) => {
    if (!currentWorkspaceId) {
      return;
    }

    setCodeShortcutRailHostState((current) => {
      const baseState = current?.workspaceId === currentWorkspaceId
        ? current
        : resolveCodeShortcutRailHostState(currentWorkspaceId, currentWorkspace);
      const nextState = updater(baseState);

      void updateWorkspaceNavigationState(currentWorkspaceId, {
        shortcutAppsCollapsed: nextState.collapsed,
        shortcutAppsSide: nextState.side
      }).catch((error) => {
        setCodeShortcutRailHostState((latest) =>
          latest?.workspaceId === currentWorkspaceId ? baseState : latest
        );
        showToastRef.current({
          title: error instanceof Error ? error.message : t("shell.codeShortcutRailStateSaveFailed"),
          tone: "error"
        });
      });

      return nextState;
    });
  }, [currentWorkspace, currentWorkspaceId]);

  const activeCenterTab: CenterTab = isButlerRoute(location.pathname)
    ? "butler"
    : "conversation";

  const openCodeTerminalDock = useCallback((workspaceId?: string | null, workspaceRef?: WorkspaceRef | null) => {
    const nextWorkspaceId = workspaceId?.trim() || currentWorkspaceId;
    const nextWorkspaceRef = workspaceRef === undefined
      ? nextWorkspaceId
        ? workspaceId === undefined && currentWorkspaceRef
          ? currentWorkspaceRef
          : currentWorkspaceRef?.workspaceId === nextWorkspaceId
          ? currentWorkspaceRef
          : ({
              hostId: "current",
              workspaceId: nextWorkspaceId
            } satisfies WorkspaceRef)
        : null
      : workspaceRef;

    if (!nextWorkspaceId || !nextWorkspaceRef) {
      return;
    }

    const nextTargetHostId = nextWorkspaceRef.hostId !== "current" ? nextWorkspaceRef.hostId : activeTargetHostId;
    const nextRequestWorkspaceId =
      nextTargetHostId && nextWorkspaceRef.hostId === nextTargetHostId
        ? nextWorkspaceRef.workspaceId?.trim() || nextWorkspaceId
        : nextWorkspaceId;

    logPerfDebug("resource_scope.open_terminal_dock", {
      pathname: location.pathname,
      currentWorkspaceId: currentWorkspaceId ?? null,
      currentWorkspaceRefHostId: currentWorkspaceRef?.hostId ?? null,
      currentWorkspaceRefWorkspaceId: currentWorkspaceRef?.workspaceId ?? null,
      requestedWorkspaceId: workspaceId ?? null,
      resolvedWorkspaceId: nextWorkspaceId,
      resolvedWorkspaceRefHostId: nextWorkspaceRef.hostId,
      resolvedWorkspaceRefWorkspaceId: nextWorkspaceRef.workspaceId,
      nextTargetHostId: nextTargetHostId ?? null,
      nextRequestWorkspaceId
    });

    refreshTerminalManagerSnapshot(nextRequestWorkspaceId, nextTargetHostId);

    setSelectedWorkspaceId(nextWorkspaceId);
    setSelectedWorkspaceRef(nextWorkspaceRef);

    if (!isSessionDetailRoute(location.pathname) && !isSessionsRoute(location.pathname)) {
      if (!isMobileShell && isTerminalsRoute(location.pathname)) {
        navigate(workbenchHomePath, { replace: true });
      } else {
        goToConversationTab();
      }
    }

    setCodeTerminalDockState((current) => {
      const baseState = current?.workspaceId === nextWorkspaceId
        ? current
        : readCodeTerminalDockState(nextWorkspaceId)
          ?? createDefaultCodeTerminalDockState(nextWorkspaceId);
      const nextState = {
        ...baseState,
        workspaceId: nextWorkspaceId,
        open: true,
        lastManualClosed: false,
        orientation: "vertical" as const,
        updatedAt: new Date().toISOString()
      };
      writeCodeTerminalDockState(nextState);
      return nextState;
    });
  }, [
    activeTargetHostId,
    currentWorkspaceId,
    currentWorkspaceRef,
    goToConversationTab,
    isMobileShell,
    location.pathname,
    navigate,
    refreshTerminalManagerSnapshot,
    workbenchHomePath
  ]);
  const closeCodeTerminalDock = useCallback(() => {
    updateCodeTerminalDockState((current) => ({
      ...current,
      open: false,
      lastManualClosed: true,
      updatedAt: new Date().toISOString()
    }));
  }, [updateCodeTerminalDockState]);

  const changeCodeTerminalDockOrientation = useCallback((orientation: CodeTerminalDockOrientation) => {
    updateCodeTerminalDockState((current) => ({
      ...current,
      open: true,
      lastManualClosed: false,
      orientation,
      updatedAt: new Date().toISOString()
    }));
  }, [updateCodeTerminalDockState]);

  const resizeCodeTerminalDock = useCallback((ratio: number) => {
    updateCodeTerminalDockState((current) => ({
      ...current,
      open: true,
      lastManualClosed: false,
      verticalRatio: current.orientation === "vertical" ? ratio : current.verticalRatio,
      horizontalRatio: current.orientation === "horizontal" ? ratio : current.horizontalRatio,
      updatedAt: new Date().toISOString()
    }));
  }, [updateCodeTerminalDockState]);
  const codeShortcutRailSide = codeShortcutRailHostState?.side ?? "left";
  const codeShortcutSystemItems = useMemo(() => (
    currentWorkspaceId
      ? [
          {
            id: "terminal",
            title: t("shell.codeShortcutTerminalTitle"),
            iconText: <CodeShortcutTerminalIcon />,
            active: codeTerminalDockState?.open === true,
            badge: currentWorkspaceTerminalCount > 99 ? "99+" : String(currentWorkspaceTerminalCount),
            badgeLabel: `${t("terminalManager.terminalCountLabel")}: ${currentWorkspaceTerminalCount}`,
            actionLabel: t("shell.codeShortcutTerminalAction"),
            onClick: () => openCodeTerminalDock()
          },
          {
            id: "skills",
            title: t("shell.codeShortcutSkillsTitle"),
            iconText: <CodeShortcutSkillIcon />,
            actionLabel: t("settings.skillManageAction"),
            renderTrigger: ({ className, children, title }: { className: string; children: ReactNode; title: string }) => (
              <SkillManagementPanel
                triggerClassName={className}
                triggerLabel={title}
                triggerContent={children}
                workspaceId={currentWorkspaceId}
                sessionId={currentSessionId}
              />
            )
          }
        ]
      : []
  ), [
    currentSessionId,
    codeTerminalDockState?.open,
    currentWorkspaceId,
    currentWorkspaceTerminalCount,
    openCodeTerminalDock
  ]);
  const codeShortcutRailSlot = useMemo(() => {
    if (!currentWorkspaceId || !codeShortcutAffairsState) {
      return null;
    }

    return (
      <AffairsWorkbenchProvider
        workspaceId={currentWorkspaceId}
        workspaceName={currentWorkspaceName}
        navigationGroups={navigationGroups}
        state={codeShortcutAffairsState}
        onStateChange={(nextState) => setCodeShortcutAffairsState(nextState)}
        onRefreshNavigation={refreshNavigation}
        targetHostId={currentTargetHostId}
      >
        <AffairsShortcutAppsRail
          systemItems={codeShortcutSystemItems}
          mountMode="footer"
          collapsed={codeShortcutRailHostState?.collapsed ?? false}
          onCollapsedChange={(collapsed) => {
            updateCodeShortcutRailHostState((current) => ({
              ...current,
              collapsed
            }));
          }}
          moveDirection={codeShortcutRailSide === "left" ? "right" : "left"}
          onMoveSide={() => {
            updateCodeShortcutRailHostState((current) => ({
              ...current,
              side: current.side === "left" ? "right" : "left"
            }));
          }}
          emptyText={t("shell.affairsShortcutRailEmpty")}
        />
      </AffairsWorkbenchProvider>
    );
  }, [
    codeShortcutAffairsState,
    codeShortcutRailHostState?.collapsed,
    codeShortcutRailSide,
    codeShortcutSystemItems,
    currentWorkspaceId,
    currentWorkspaceName,
    navigationGroups,
    refreshNavigation,
    updateCodeShortcutRailHostState
  ]);
  const openCodeEmbeddedAffairsState = useCallback((nextState: AffairsViewState, options?: { closeSearchModal?: boolean }) => {
    if (options?.closeSearchModal !== false) {
      setSearchModalOpen(false);
    }

    const workspaceId = nextState.workspaceId || currentWorkspaceId;

    if (!workspaceId) {
      return;
    }

    setSelectedWorkspaceId(workspaceId);
    flushSync(() => {
      setRightCollapsed(nextState.primarySection === "workbench");
      setCodeEmbeddedAffairsState({
        ...nextState,
        workspaceId
      });
    });

    const targetPath = buildCodeEmbeddedAffairsRoutePath(nextState.primarySection);

    if (targetPath && `${location.pathname}${location.search}` !== targetPath) {
      navigate(targetPath);
    }
  }, [currentWorkspaceId, currentWorkspaceRef, location.pathname, location.search, navigate]);

  const openCodeEmbeddedAffairsSection = useCallback((section: AffairsViewState["primarySection"]) => {
    if (!currentWorkspaceId) {
      return;
    }

    if (section === "library" && !affairsLibraryCapability.enabled) {
      return;
    }

    const currentState =
      readAffairsViewState(currentWorkspaceId)
      ?? codeEmbeddedAffairsState
      ?? createDefaultAffairsViewState(currentWorkspaceId);
    const nextState =
      section === "library"
        ? createDefaultAffairsLibraryLandingState(currentWorkspaceId, currentState)
        : {
            ...currentState,
            workspaceId: currentWorkspaceId,
            primarySection: section,
            selectedNodeId: section === "conversation" ? "conversation:home" : "workbench:overview",
            selectedObjectId: null,
            selectedDocumentId: null,
            auxiliaryTab: section === "conversation" ? "detail" : currentState.auxiliaryTab,
            pendingLibraryPreview: null
          };

    openCodeEmbeddedAffairsState(nextState, { closeSearchModal: false });
  }, [affairsLibraryCapability.enabled, codeEmbeddedAffairsState, currentWorkspaceId, openCodeEmbeddedAffairsState]);

  const codeWorkbenchContent = useMemo(() => {
    if (!currentWorkspaceId || !codeEmbeddedAffairsState) {
      return <Outlet />;
    }

    if (
      codeEmbeddedAffairsState.primarySection !== "library"
      && codeEmbeddedAffairsState.primarySection !== "workbench"
    ) {
      return <Outlet />;
    }

    return (
      <AffairsWorkbenchProvider
        workspaceId={currentWorkspaceId}
        workspaceName={currentWorkspaceName}
        navigationGroups={navigationGroups}
        state={codeEmbeddedAffairsState}
        onStateChange={setCodeEmbeddedAffairsState}
        onRefreshNavigation={refreshNavigation}
        forceRoute={false}
        targetHostId={currentTargetHostId}
      >
        <AffairsWorkbenchView workspaceId={currentWorkspaceId} />
      </AffairsWorkbenchProvider>
    );
  }, [
    codeEmbeddedAffairsState,
    currentWorkspaceId,
    currentWorkspaceName,
    navigationGroups,
    refreshNavigation
  ]);
  const codeShortcutRailLeftSlot = codeShortcutRailSide === "left" ? codeShortcutRailSlot : null;
  const codeShortcutRailRightSlot = codeShortcutRailSide === "right" ? codeShortcutRailSlot : null;
  const findFallbackSessionEntry = useCallback((preferredWorkspaceId?: string | null): WorkbenchNavigationEntry | null => {
    if (preferredWorkspaceId) {
      const preferredEntry =
        flattenedCanonicalSessions.find((item) => item.workspace.id === preferredWorkspaceId) ?? null;

      if (preferredEntry) {
        return preferredEntry;
      }
    }

    return flattenedCanonicalSessions[0] ?? null;
  }, [flattenedCanonicalSessions]);
  const resolveStoredConversationPath = useCallback((preferredWorkspaceId?: string | null): string | null => {
    const storedSessionPath =
      typeof window === "undefined" ? null : window.localStorage.getItem(LAST_SESSION_PATH_KEY);

    if (!storedSessionPath) {
      return null;
    }

    const storedPathname = storedSessionPath.split("?")[0] ?? storedSessionPath;
    const storedSessionMatch = resolveRouteSessionMatch(storedPathname);

    if (!storedSessionMatch) {
      window.localStorage.removeItem(LAST_SESSION_PATH_KEY);
      return null;
    }

    const storedSessionId = storedSessionMatch.sessionId;
    const storedSearch = storedSessionPath.includes("?") ? `?${storedSessionPath.split("?")[1] ?? ""}` : "";
    const storedTargetHostId = new URLSearchParams(storedSearch).get("targetHostId")?.trim() || null;
    const storedSessionEntry = findCanonicalSessionEntryByScope(storedSessionId, {
      displayWorkspaceId: storedSessionMatch.workspaceId,
      targetHostId: storedTargetHostId
    });
    const storedSessionWorkspaceId =
      storedSessionMatch.workspaceId ?? storedSessionEntry?.workspace.id ?? null;

    if (
      storedSessionEntry &&
      (!preferredWorkspaceId || storedSessionWorkspaceId === preferredWorkspaceId)
    ) {
      const resolvedPath = buildSessionEntryPath(storedSessionEntry);
      logPerfDebug("resource_scope.resolve_stored_conversation_path.hit", {
        preferredWorkspaceId: preferredWorkspaceId ?? null,
        storedSessionId,
        storedRouteWorkspaceId: storedSessionMatch.workspaceId ?? null,
        storedTargetHostId,
        resolvedWorkspaceId: storedSessionEntry.workspace.id,
        resolvedPath
      });
      return resolvedPath;
    }

    logPerfDebug("resource_scope.resolve_stored_conversation_path.clear", {
      preferredWorkspaceId: preferredWorkspaceId ?? null,
      storedSessionId,
      storedRouteWorkspaceId: storedSessionMatch.workspaceId ?? null,
      storedTargetHostId,
      foundEntry: storedSessionEntry !== null
    });
    window.localStorage.removeItem(LAST_SESSION_PATH_KEY);
    return null;
  }, [buildSessionEntryPath, findCanonicalSessionEntryByScope]);
  const activeNotifications = useMemo(
    () => globalNotifications.filter((item) => !archivedNotificationIds.has(item.id)),
    [archivedNotificationIds, globalNotifications]
  );
  const unreadNotificationCount = useMemo(
    () => activeNotifications.filter((item) => isWorkbenchNotificationUnread(item, notificationSeenAt)).length,
    [activeNotifications, notificationSeenAt]
  );

  useEffect(() => {
    if (!notificationPanelOpen) {
      return;
    }

    markGlobalNotificationsSeen(activeNotifications);
  }, [activeNotifications, markGlobalNotificationsSeen, notificationPanelOpen]);

  const handleSelectNotification = useCallback((notification: WorkbenchGlobalNotification) => {
    setNotificationPanelOpen(false);

    if (notification.routePath) {
      navigate(notification.routePath);
    }
  }, [navigate]);
  const openLightweightChat = useCallback((workspace: WorkspaceDto, session: SessionSummaryDto) => {
    navigate(buildWorkspaceChatPath(workspace.id, session.sessionId, workspace.id === currentWorkspaceId ? currentWorkspaceRef : null));
  }, [currentWorkspaceId, currentWorkspaceRef, navigate]);
  const createLightweightChat = useCallback((workspace: WorkspaceDto) => {
    setLightweightChatCreateWorkspace(workspace);
    setLightweightChatCreateAffairsState({
      ...createDefaultAffairsViewState(workspace.id),
      primarySection: "conversation",
      selectedNodeId: null,
      selectedObjectId: null,
      selectedDocumentId: null,
      pendingLibraryPreview: null
    });
  }, []);
  const closeLightweightChatCreateModal = useCallback(() => {
    setLightweightChatCreateWorkspace(null);
    setLightweightChatCreateAffairsState(null);
  }, []);
  const handleLightweightChatDraftSelected = useCallback((draft: AffairsConversationDraftSelection) => {
    if (!lightweightChatCreateWorkspace || draft.kind !== "lightweight") {
      return;
    }

    const workspaceRef = lightweightChatCreateWorkspace.id === currentWorkspaceId ? currentWorkspaceRef : null;
    const newChatPath = buildWorkspaceNewChatPath(lightweightChatCreateWorkspace.id, workspaceRef);
    navigate(appendLightweightChatProviderParam(newChatPath, draft.provider));
    closeLightweightChatCreateModal();
  }, [closeLightweightChatCreateModal, currentWorkspaceId, currentWorkspaceRef, lightweightChatCreateWorkspace, navigate]);

  const toggleNotificationArchive = useCallback(async (notificationId: string, archived: boolean) => {
    const requestId = notificationArchiveMutationRequestIdRef.current + 1;
    notificationArchiveMutationRequestIdRef.current = requestId;

    try {
      const response = await updateButlerNotificationArchive(notificationId, archived);

      if (requestId !== notificationArchiveMutationRequestIdRef.current) {
        return;
      }

      setArchivedNotificationIds((current) => {
        const next = new Set(current);

        if (response.item) {
          next.add(response.item.notificationId);
        } else {
          next.delete(notificationId);
        }

        return next;
      });
    } catch (error) {
      if (requestId !== notificationArchiveMutationRequestIdRef.current) {
        return;
      }

      showToastRef.current({
        title: t("shell.globalNotificationsArchiveFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionWorkspaceId) {
      return;
    }

    setSelectedWorkspaceId((current) => (current === sessionWorkspaceId ? current : sessionWorkspaceId));
  }, [sessionWorkspaceId]);

  useEffect(() => {
    if (navigationLoading) {
      return;
    }

    const fallbackWorkspaceId = navigationGroups[0]?.workspace.id ?? null;
    const fallbackSessionWorkspaceId =
      validatedRouteWorkspaceId ?? fallbackWorkspaceId ?? validatedSelectedWorkspaceId;
    const fallbackSessionEntry =
      currentSessionId && !isDraftSession
        ? findFallbackSessionEntry(fallbackSessionWorkspaceId)
        : null;
    const storedSessionPath =
      currentSessionId && !isDraftSession
        ? resolveStoredConversationPath(fallbackSessionWorkspaceId)
        : null;
    const fallbackSessionPath = fallbackSessionEntry
      ? buildSessionEntryPath(fallbackSessionEntry)
      : null;
    const fallbackWorkspaceRef = currentWorkspaceRef;

    if (routeWorkspaceId && !validatedRouteWorkspaceId) {
      navigate(
        storedSessionPath
          ?? fallbackSessionPath
          ?? (fallbackWorkspaceId
            ? resolveFallbackWorkspaceRoute(location.pathname, fallbackWorkspaceId, fallbackWorkspaceRef)
            : resolveWorkbenchHomePath(shellMode)),
        { replace: true }
      );
      return;
    }

    if (currentSessionId && !isDraftSession && !sessionWorkspaceId) {
      navigate(
        storedSessionPath
          ?? fallbackSessionPath
          ?? (fallbackWorkspaceId
            ? buildWorkspaceSessionIndexPath(fallbackWorkspaceId, fallbackWorkspaceRef)
            : resolveWorkbenchHomePath(shellMode)),
        { replace: true }
      );
      return;
    }
  }, [
    currentSessionId,
    findFallbackSessionEntry,
    isDraftSession,
    location.pathname,
    navigate,
    navigationGroups,
    navigationLoading,
    buildSessionEntryPath,
    resolveStoredConversationPath,
    routeWorkspaceId,
    sessionWorkspaceId,
    shellMode,
    validatedSelectedWorkspaceId,
    validatedRouteWorkspaceId,
  ]);

  useEffect(() => {
    logPerfDebug("workbench.current_workspace_resolved", {
      currentSessionId,
      sessionWorkspaceId,
      routeWorkspaceId,
      currentWorkspaceId,
      source: sessionWorkspaceId
        ? currentSessionContext
          ? "navigation"
          : "sessionWorkspaceMap"
        : routeWorkspaceId
          ? "route"
        : selectedWorkspaceId
          ? "workspaceSelection"
          : "navigationFallback"
    });
    logPerfDebug("resource_scope.current_scope", {
      pathname: location.pathname,
      search: location.search,
      currentSessionId,
      routeWorkspaceId,
      sessionWorkspaceId,
      selectedWorkspaceId,
      currentWorkspaceId,
      currentWorkspaceRefHostId: currentWorkspaceRef?.hostId ?? null,
      currentWorkspaceRefWorkspaceId: currentWorkspaceRef?.workspaceId ?? null,
      currentTargetHostId: currentTargetHostId ?? null,
      currentRequestWorkspaceId: currentRequestWorkspaceId ?? null,
      routeScopedWorkspaceRefHostId: routeScopedWorkspaceRef?.hostId ?? null,
      routeScopedWorkspaceRefWorkspaceId: routeScopedWorkspaceRef?.workspaceId ?? null,
      selectedWorkspaceRefHostId: selectedWorkspaceRef?.hostId ?? null,
      selectedWorkspaceRefWorkspaceId: selectedWorkspaceRef?.workspaceId ?? null
    });
  }, [
    currentRequestWorkspaceId,
    currentSessionContext,
    currentSessionId,
    currentTargetHostId,
    currentWorkspaceId,
    currentWorkspaceRef,
    location.pathname,
    location.search,
    routeWorkspaceId,
    routeScopedWorkspaceRef,
    selectedWorkspaceId,
    selectedWorkspaceRef,
    sessionWorkspaceId
  ]);

  const resolvePeerNavigationForWorkspace = useCallback((workspace: WorkspaceDto): PeerWorkspaceNavigationView | null => {
    const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, workspace);
    const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
    const targetHostId = selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;

    if (!targetHostId || targetHostId === "current") {
      return null;
    }

    return peerWorkspaceNavigationByWorkspaceId[
      buildPeerWorkspaceSummaryStateKey(activeHostId, workspace.id, targetHostId)
    ] ?? null;
  }, [
    activeHostId,
    peerWorkspaceNavigationByWorkspaceId,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    workspaceHostAssignments
  ]);
  const resolveNavigationWorkspaceRef = useCallback((
    workspaceId: string,
    options?: {
      preferredTargetHostId?: string | null;
      fallbackToCurrent?: boolean;
    }
  ): WorkspaceRef | null => {
    const normalizedWorkspaceId = workspaceId.trim();

    if (!normalizedWorkspaceId) {
      return null;
    }

    const workspace =
      navigationGroups.find((group) => group.workspace.id === normalizedWorkspaceId)?.workspace
      ?? null;
    const preferredTargetHostId = normalizeTargetHostId(options?.preferredTargetHostId);
    const fallbackToCurrent = options?.fallbackToCurrent !== false;

    if (preferredTargetHostId && workspace) {
      const preferredWorkspaceRef = resolveWorkspaceRefForTargetHost(workspace, preferredTargetHostId);

      if (preferredWorkspaceRef) {
        return preferredWorkspaceRef;
      }
    }

    if (workspace) {
      const assignment = resolveWorkspaceHostAssignment(workspaceHostAssignments, activeHostId, workspace);
      const selectedHostId = resolveSelectableHostId(assignment?.selectedHostId);
      const assignedTargetHostId = selectedHostId ? resolveRemoteSelectedHostId(selectedHostId) : null;

      if (assignedTargetHostId && assignedTargetHostId !== "current") {
        const assignedWorkspaceRef = resolveWorkspaceRefForTargetHost(workspace, assignedTargetHostId);

        if (assignedWorkspaceRef) {
          return assignedWorkspaceRef;
        }
      }
    }

    return fallbackToCurrent ? makeWorkspaceRef(normalizedWorkspaceId, "current") : null;
  }, [
    activeHostId,
    navigationGroups,
    resolveRemoteSelectedHostId,
    resolveSelectableHostId,
    resolveWorkspaceRefForTargetHost,
    workspaceHostAssignments
  ]);
  const workspaceSidebarGroups = useMemo(
    () =>
      navigationGroups.map((group) => {
        const peerNavigation = resolvePeerNavigationForWorkspace(group.workspace);
        const scopedSessions = peerNavigation?.sessions ?? group.sessions;
        const visibleSessions = filterVisibleWorkspaceSessions(scopedSessions);
        const projectedSessionIds = new Set(scopedSessions.map((session) => session.sessionId));

        return {
          workspace: group.workspace,
          visibleSessions,
          archivedSessions: scopedSessions.filter(
            (session) => isArchivedSession(session)
          ),
          visibleSessionTree: buildSessionTree(visibleSessions, sessionDisplaySortMode).filter(
            (node) =>
              !favoriteSessionIdSet.has(node.item.sessionId)
              && !someSessionTreeNode(getTreeNodeChildren(node), (session) => favoriteSessionIdSet.has(session.sessionId))
          ),
          childWorktrees: buildWorkspaceSidebarWorktreeNodes(
            group.childWorktrees,
            favoriteSessionIdSet,
            sessionDisplaySortMode,
            projectedSessionIds,
            resolvePeerNavigationForWorkspace
          ),
          isCollapsed: collapsedWorkspaceIdSet.has(group.workspace.id)
        };
      }),
    [
      collapsedWorkspaceIdSet,
      favoriteSessionIdSet,
      navigationGroups,
      peerWorkspaceNavigationByWorkspaceId,
      resolvePeerNavigationForWorkspace,
      sessionDisplaySortMode
    ]
  );
  const workspaceVisualContextMap = useMemo(
    () => buildWorkspaceVisualContextMap(navigationGroups),
    [navigationGroups]
  );
  const currentWorktreeNode = useMemo(
    () => findNavigationWorktreeNodeByWorkspaceId(navigationGroups, currentWorkspaceId),
    [currentWorkspaceId, navigationGroups]
  );
  useEffect(() => {
    if (!currentTerminalSnapshotCacheKey) {
      setCurrentWorkspaceTerminalCount(0);
      return;
    }

    const cachedSnapshot = readViewSnapshot<{ terminals?: TerminalDto[] }>(
      currentTerminalSnapshotCacheKey,
      60 * 1000
    );
    setCurrentWorkspaceTerminalCount(Array.isArray(cachedSnapshot?.terminals) ? cachedSnapshot.terminals.length : 0);
  }, [currentTerminalSnapshotCacheKey]);

  useEffect(() => {
    if (!currentRequestWorkspaceId) {
      setCurrentWorkspaceTerminalCount(0);
      return;
    }

    return addTerminalManagerSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== currentRequestWorkspaceId || !isSameTargetHostId(readSnapshotTargetHostId(snapshot), currentTargetHostId)) {
        return;
      }

      const terminalCount = Array.isArray(snapshot.terminals) ? snapshot.terminals.length : 0;
      setCurrentWorkspaceTerminalCount(terminalCount);

      if (currentTerminalSnapshotCacheKey) {
        writeViewSnapshot(currentTerminalSnapshotCacheKey, {
          revision: snapshot.revision ?? null,
          terminals: snapshot.terminals,
          templates: snapshot.templates,
          templateStatuses: snapshot.templateStatuses,
          shellOptions: snapshot.shellOptions,
          targetHostId: currentTargetHostId ?? null
        });
      }
    });
  }, [
    addTerminalManagerSnapshotListener,
    currentRequestWorkspaceId,
    currentTargetHostId,
    currentTerminalSnapshotCacheKey
  ]);

  useEffect(() => {
    if (!currentRequestWorkspaceId) {
      return;
    }

    const cachedSnapshot = currentTerminalSnapshotCacheKey
      ? readViewSnapshot<{ revision?: string | null }>(currentTerminalSnapshotCacheKey, 60 * 1000)
      : null;
    const knownRevision = typeof cachedSnapshot?.revision === "string" ? cachedSnapshot.revision : null;

    subscribeTerminalManagerSnapshot(currentRequestWorkspaceId, {
      knownRevision,
      targetHostId: currentTargetHostId
    });
    requestTerminalManagerRefresh(currentRequestWorkspaceId, {
      knownRevision,
      targetHostId: currentTargetHostId
    });
  }, [
    currentRequestWorkspaceId,
    currentTargetHostId,
    currentTerminalSnapshotCacheKey,
    requestTerminalManagerRefresh,
    subscribeTerminalManagerSnapshot
  ]);

  const currentAuxiliaryWorktreeNode = useMemo(
    () => findNavigationWorktreeNodeByWorkspaceId(navigationGroups, currentAuxiliaryWorkspaceId),
    [currentAuxiliaryWorkspaceId, navigationGroups]
  );
  const currentWorkspaceEntity = useMemo(
    () =>
      currentWorkspaceId
        ? currentWorktreeNode?.workspace
          ?? navigationGroups
            .map((group) => group.workspace)
            .find((workspace) => workspace.id === currentWorkspaceId)
          ?? null
        : null,
    [currentWorkspaceId, currentWorktreeNode, navigationGroups]
  );
  const currentAuxiliaryWorkspaceEntity = useMemo(
    () =>
      currentAuxiliaryWorkspaceId
        ? currentAuxiliaryWorktreeNode?.workspace
          ?? navigationGroups
            .map((group) => group.workspace)
            .find((workspace) => workspace.id === currentAuxiliaryWorkspaceId)
          ?? null
        : null,
    [currentAuxiliaryWorkspaceId, currentAuxiliaryWorktreeNode, navigationGroups]
  );
  const currentWorktreeMeta: WorktreeMetaDto | null = currentAuxiliaryWorktreeNode?.meta ?? null;
  const currentWorkspaceContext =
    (currentWorkspaceId ? workspaceVisualContextMap[currentWorkspaceId] ?? null : null)
    ?? (currentWorkspaceEntity ? createFallbackWorkspaceVisualContext(currentWorkspaceEntity) : null);
  const currentAuxiliaryWorkspaceContext =
    (currentAuxiliaryWorkspaceId ? workspaceVisualContextMap[currentAuxiliaryWorkspaceId] ?? null : null)
    ?? (currentAuxiliaryWorkspaceEntity
      ? createFallbackWorkspaceVisualContext(currentAuxiliaryWorkspaceEntity)
      : currentWorkspaceContext);
  const currentWorktreeMergeState =
    (currentWorktreeMeta ? worktreeMergeStateById[currentWorktreeMeta.workspaceId] ?? null : null);
  const activeParallelConversationGroupId = useMemo(() => {
    if (!currentSessionId) {
      return null;
    }

    const currentGroupId = currentSessionContext?.session?.parallelGroup?.groupId?.trim() || null;

    if (currentGroupId) {
      return currentGroupId;
    }

    return findParallelAncestorGroupId(fullNavigationTree, currentSessionId);
  }, [currentSessionContext?.session?.parallelGroup?.groupId, currentSessionId, fullNavigationTree]);
  const isParallelConversationActive =
    activeCenterTab === "conversation"
    && Boolean(activeParallelConversationGroupId);

  useEffect(() => {
    if (typeof window === "undefined" || !isParallelConversationActive || !activeParallelConversationGroupId) {
      setParallelConversationTransition(null);
      return;
    }

    const transitionSignal = readParallelGroupTransitionSignal(activeParallelConversationGroupId);

    if (!transitionSignal || transitionSignal.sidebarCollapseDurationMs <= 0) {
      setParallelConversationTransition(null);
      return;
    }

    setParallelConversationTransition(transitionSignal);

    const elapsedMs = Date.now() - transitionSignal.createdAt;
    const remainingMs = transitionSignal.totalDurationMs - elapsedMs;

    if (remainingMs <= 0) {
      setParallelConversationTransition(null);
      return;
    }

    const timerId = window.setTimeout(() => {
      setParallelConversationTransition(null);
    }, remainingMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [activeParallelConversationGroupId, isParallelConversationActive]);

  useEffect(() => {
    logPerfDebug("workbench.info_panel_state", {
      infoPanelReady,
      rightCollapsed: rightCollapsed || isParallelConversationActive,
      currentWorkspaceId,
      sessionWorkspaceId,
      currentSessionId
    });
  }, [
    currentSessionId,
    currentWorkspaceId,
    infoPanelReady,
    isParallelConversationActive,
    rightCollapsed,
    sessionWorkspaceId
  ]);

  const favoriteSessions = useMemo(
    () => {
      const workspaceSessionFavorites = flattenedCanonicalSessions
        .filter(
          (item) =>
            favoriteSessionIdSet.has(item.session.sessionId) &&
            !isArchivedSession(item.session) &&
            !isSubagentSession(item.session)
        )
        .map((item) => ({
          ...item,
          favoriteEntryKind: "workspace-session" as const
        }));
      const seenLightweightFavoriteKeys = new Set<string>();
      const lightweightFavorites = Object.entries(lightweightChatSessionsByWorkspaceId).flatMap(([workspaceId, sessions]) => {
        const workspace = navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace ?? null;

        if (!workspace) {
          return [];
        }

        return sessions.flatMap((session) => {
          if (session.isFavorite !== true || session.isArchived) {
            return [];
          }

          const dedupeKey = `${workspace.id}:${session.sessionId}`;
          if (seenLightweightFavoriteKeys.has(dedupeKey)) {
            return [];
          }
          seenLightweightFavoriteKeys.add(dedupeKey);

          return [{
            session,
            workspace,
            favoriteEntryKind: "lightweight-chat" as const
          }];
        });
      });

      return [...workspaceSessionFavorites, ...lightweightFavorites];
    },
    [favoriteSessionIdSet, flattenedCanonicalSessions, lightweightChatSessionsByWorkspaceId, navigationGroups]
  );
  const mobileActiveEntry: MobileWorkbenchEntry = location.pathname.startsWith("/settings")
    ? "settings"
    : isButlerRoute(location.pathname)
      ? "terminals"
    : isTerminalsRoute(location.pathname)
      ? "butler"
    : isToolsRoute(location.pathname)
      ? location.pathname.endsWith("/tools/processes") || location.pathname === "/tools/processes"
        ? "butler"
        : "sessions"
    : isSessionsRoute(location.pathname) || isSessionDetailRoute(location.pathname)
      ? "sessions"
        : "workspaces";
  const showCodeTerminalDock = activeCenterTab === "conversation";
  const isMobileConversationFocus =
    isMobileShell
    && (
      (mobileActiveEntry === "sessions" && isSessionDetailRoute(location.pathname))
      || isButlerRoute(location.pathname)
    );
  const preferCompactMobilePaneLayout = shouldPreferCompactNativeMobileLayout({
    isNativeMobile: platform.isNativeMobile,
    viewportClass: platform.viewportClass
  });
  const mobilePaneLayout = resolveAdaptiveMobilePaneLayout({
    viewportClass: platform.viewportClass,
    activeEntry: mobileActiveEntry,
    hasNavigationPanel: isMobileShell,
    hasAuxiliaryPanel: isMobileShell,
    preferCompactLayout: preferCompactMobilePaneLayout
  });
  const mobileNavigationDocked = isMobileShell && shouldDockNavigationPanel(mobilePaneLayout);
  const mobileAuxiliaryDocked = isMobileShell && shouldDockAuxiliaryPanel(mobilePaneLayout);
  const availableSearchWorkspaces = useMemo(
    () => mergeWorkspaceCatalogs(
      searchWorkspaceCatalog,
      navigationGroups.map((group) => group.workspace)
    ),
    [navigationGroups, searchWorkspaceCatalog]
  );
  const currentWorkspaceGroup = useMemo(
    () => navigationGroups.find((group) => group.workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, navigationGroups]
  );
  const searchScope = searchRequest?.scope ?? null;
  const submittedSearchKeyword = searchRequest?.keyword ?? "";
  const sessionSearchResults = useMemo(() => {
    if (searchScope !== "code" && searchScope !== "all") {
      return [] as NavigationSessionEntry[];
    }

    const normalizedKeyword = normalizeSearchKeyword(submittedSearchKeyword);

    if (!normalizedKeyword) {
      return [] as NavigationSessionEntry[];
    }

    return flattenedCanonicalSessions.filter((item) => includesNormalizedSearch(
      normalizedKeyword,
      item.session.title,
      item.workspace.name,
      formatProviderLabel(item.session.provider, "full")
    ));
  }, [flattenedCanonicalSessions, searchScope, submittedSearchKeyword]);
  const displayedAffairsSearchResults = useMemo(
    () => sortAffairsSearchResults(affairsSearchResults, affairsSearchSortMode),
    [affairsSearchResults, affairsSearchSortMode]
  );
  useEffect(() => {
    if (!searchModalOpen) {
      return;
    }

    let disposed = false;

    void listWorkspaces()
      .then((response) => {
        if (disposed) {
          return;
        }

        setSearchWorkspaceCatalog(Array.isArray(response.items) ? response.items : []);
      })
      .catch(() => {
        if (disposed) {
          return;
        }

        // 工作区目录拉取失败时退回导航快照，别把整个搜索做死。
        setSearchWorkspaceCatalog((current) => current);
      });

    return () => {
      disposed = true;
    };
  }, [searchModalOpen]);
  useEffect(() => {
    if (!searchModalOpen) {
      setCodeSearchLoading(false);
      setAffairsSearchLoading(false);
      return;
    }

    const normalizedKeyword = normalizeSearchKeyword(submittedSearchKeyword);
    const searchKeywords = splitSearchKeywords(submittedSearchKeyword);

    if (searchKeywords.length === 0) {
      setCodeSearchError(null);
      setCodeSearchResults([]);
      setCodeSearchLoading(false);
      setAffairsSearchError(null);
      setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
      setAffairsSearchLoading(false);
      return;
    }

    if (!searchScope) {
      setCodeSearchLoading(false);
      setAffairsSearchLoading(false);
      return;
    }

    if (availableSearchWorkspaces.length === 0) {
      setCodeSearchError(null);
      setCodeSearchResults([]);
      setCodeSearchLoading(false);
      setAffairsSearchError(null);
      setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
      setAffairsSearchLoading(false);
      return;
    }

    let disposed = false;
    const requestId = affairsSearchRequestIdRef.current + 1;
    affairsSearchRequestIdRef.current = requestId;

    const trimmedKeyword = submittedSearchKeyword.trim();
    const runCodeSearch = async () => {
      const workspaceSearches = availableSearchWorkspaces.map((workspace) =>
        listAllCodeSearchFilesForKeywords(workspace.id, searchKeywords)
          .then((items) => ({
            workspace,
            items
          }))
      );

      const results = await Promise.allSettled(workspaceSearches);
      if (disposed || requestId !== affairsSearchRequestIdRef.current) {
        return;
      }

      const fulfilled = results
        .filter((item): item is PromiseFulfilledResult<{ workspace: WorkspaceDto; items: FileNodeDto[] }> => item.status === "fulfilled")
        .map((item) => item.value);
      const codeResults = fulfilled
        .flatMap((item) => item.items
          .filter((file) => includesNormalizedSearch(normalizedKeyword, file.name, file.path, file.snippet))
          .map<CodeSearchResult>((file) => ({
            workspaceId: item.workspace.id,
            workspaceName: item.workspace.name,
            file
          })))
        .sort(compareCodeSearchResults);
      const hasFailure = results.some((item) => item.status === "rejected");

      setCodeSearchResults(codeResults);
      setCodeSearchError(fulfilled.length === 0 && hasFailure ? t("shell.searchCodeFailed") : null);
      setCodeSearchLoading(false);
    };

    const runAffairsSearch = async () => {
      const workspaceSearches = availableSearchWorkspaces.map((workspace) =>
        Promise.allSettled([
          withPromiseTimeout(getAffairsLibrarySnapshot(workspace.id)),
          listAllAffairsSearchDocumentsForKeywords(workspace.id, searchKeywords),
          withPromiseTimeout(listAffairsLightweightSessions(workspace.id)),
          withPromiseTimeout(getAffairsAssistantSessionsSnapshot(workspace.id)),
          withPromiseTimeout(listButlerInboxItems({ workspaceId: workspace.id }))
        ]).then(([snapshotResult, documentResult, lightweightResult, agentResult, inboxResult]) => ({
          workspace,
          snapshotResult,
          documentResult,
          lightweightResult,
          agentResult,
          inboxResult
        }))
      );

      const results = await Promise.allSettled([
        withPromiseTimeout(listButlerFollowUpTasks()),
        ...workspaceSearches
      ]);
      if (disposed || requestId !== affairsSearchRequestIdRef.current) {
        return;
      }

        const followUpItems = results[0]?.status === "fulfilled" && Array.isArray(results[0].value.items)
          ? results[0].value.items
          : [];
        const workspaceResults = results
          .slice(1)
          .filter((item): item is PromiseFulfilledResult<{
            workspace: WorkspaceDto;
            snapshotResult: PromiseSettledResult<Awaited<ReturnType<typeof getAffairsLibrarySnapshot>>>;
            documentResult: PromiseSettledResult<AffairsLibraryDocumentRecordDto[]>;
            lightweightResult: PromiseSettledResult<Awaited<ReturnType<typeof listAffairsLightweightSessions>>>;
            agentResult: PromiseSettledResult<Awaited<ReturnType<typeof getAffairsAssistantSessionsSnapshot>>>;
            inboxResult: PromiseSettledResult<Awaited<ReturnType<typeof listButlerInboxItems>>>;
          }> => item.status === "fulfilled")
          .map((item) => item.value);

        const documentsByIdentity = new Map<string, AffairsSearchDocumentResult>();
        workspaceResults.forEach((result) => {
          const libraryInfo = resolveAffairsSearchLibraryInfo(result.workspace, result.snapshotResult);
          const documentItems = result.documentResult.status === "fulfilled" && Array.isArray(result.documentResult.value)
            ? result.documentResult.value
            : [];
          documentItems.forEach((record) => {
            if (!includesNormalizedSearch(
              normalizedKeyword,
              getAffairsDocumentDisplayName(record),
              record.title,
              record.path,
              record.summary,
              record.tags.join(" "),
              record.derivedTags.join(" ")
            )) {
              return;
            }

            const dedupePath = normalizeWorkbenchFilePath(record.path) || record.path.trim();
            const candidate: AffairsSearchDocumentResult = {
              kind: "document",
              workspaceId: libraryInfo.workspaceId,
              libraryRootDir: libraryInfo.libraryRootDir,
              libraryLabel: libraryInfo.libraryLabel,
              record,
              searchScore:
                scoreNormalizedSearchValue(normalizedKeyword, record.title, {
                  exact: 74,
                  prefix: 54,
                  includes: 36,
                  occurrence: 6
                })
                + scoreNormalizedSearchValue(normalizedKeyword, record.path, {
                  exact: 42,
                  prefix: 30,
                  includes: 18,
                  occurrence: 4
                })
                + scoreNormalizedSearchValue(normalizedKeyword, record.summary, {
                  exact: 20,
                  prefix: 14,
                  includes: 9,
                  occurrence: 2
                })
                + scoreNormalizedSearchValue(normalizedKeyword, record.tags.join(" "), {
                  exact: 8,
                  prefix: 6,
                  includes: 4,
                  occurrence: 1
                })
                + scoreNormalizedSearchValue(normalizedKeyword, record.derivedTags.join(" "), {
                  exact: 6,
                  prefix: 4,
                  includes: 3,
                  occurrence: 1
                }),
              snippet: buildAffairsDocumentSnippet(record, trimmedKeyword),
              dedupePath
            };
            const identity = `${libraryInfo.libraryRootDir || libraryInfo.workspaceId}::${dedupePath}`;
            const existing = documentsByIdentity.get(identity);
            if (!existing || compareAffairsDocumentSearchResults(candidate, existing) < 0) {
              documentsByIdentity.set(identity, candidate);
            }
          });
        });
        const documents = [...documentsByIdentity.values()].sort(compareAffairsDocumentSearchResults);

        const seenTagKeys = new Set<string>();
        const tags = workspaceResults
          .flatMap((result) => {
            const libraryInfo = resolveAffairsSearchLibraryInfo(result.workspace, result.snapshotResult);
            const snapshotTags = result.snapshotResult.status === "fulfilled" && Array.isArray(result.snapshotResult.value.tags)
              ? result.snapshotResult.value.tags
              : [];
            return snapshotTags
              .filter((tag) => includesNormalizedSearch(normalizedKeyword, tag.name, tag.path, tag.rootType))
              .map<AffairsSearchTagResult>((tag) => ({
                kind: "tag",
                workspaceId: libraryInfo.workspaceId,
                libraryRootDir: libraryInfo.libraryRootDir,
                libraryLabel: libraryInfo.libraryLabel,
                tag,
                searchScore:
                  scoreNormalizedSearchValue(normalizedKeyword, tag.name, {
                    exact: 68,
                    prefix: 48,
                    includes: 30,
                    occurrence: 6
                  })
                  + scoreNormalizedSearchValue(normalizedKeyword, tag.path, {
                    exact: 26,
                    prefix: 18,
                    includes: 10,
                    occurrence: 2
                  })
                  + scoreNormalizedSearchValue(normalizedKeyword, tag.rootType, {
                    exact: 4,
                    prefix: 3,
                    includes: 2,
                    occurrence: 1
                  })
              }));
          })
          .filter((item) => {
            const identity = `${item.libraryRootDir || item.workspaceId}::${item.tag.path}`;
            if (seenTagKeys.has(identity)) {
              return false;
            }
            seenTagKeys.add(identity);
            return true;
          })
          .sort(compareAffairsTagSearchResults);

        const conversations = workspaceResults
          .flatMap((result) => {
            const lightweightItems = result.lightweightResult.status === "fulfilled" && Array.isArray(result.lightweightResult.value.items)
              ? result.lightweightResult.value.items
              : [];
            const agentItems = result.agentResult.status === "fulfilled" && Array.isArray(result.agentResult.value.item.sessions)
              ? result.agentResult.value.item.sessions
              : [];

            return [
              ...lightweightItems
                .filter((session) => includesNormalizedSearch(
                  normalizedKeyword,
                  session.title,
                  result.workspace.name,
                  formatProviderLabel(session.provider, "full")
                ))
                .map<AffairsSearchConversationResult>((session) => ({
                  kind: "conversation",
                  workspaceId: result.workspace.id,
                  workspaceName: result.workspace.name,
                  session,
                  conversationKind: "lightweight",
                  searchScore:
                    scoreNormalizedSearchValue(normalizedKeyword, session.title, {
                      exact: 72,
                      prefix: 52,
                      includes: 34,
                      occurrence: 6
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, result.workspace.name, {
                      exact: 10,
                      prefix: 7,
                      includes: 5,
                      occurrence: 1
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, formatProviderLabel(session.provider, "full"), {
                      exact: 4,
                      prefix: 3,
                      includes: 2,
                      occurrence: 1
                    })
                })),
              ...agentItems
                .filter((session) => includesNormalizedSearch(
                  normalizedKeyword,
                  session.title,
                  result.workspace.name,
                  formatProviderLabel(session.provider, "full")
                ))
                .map<AffairsSearchConversationResult>((session) => ({
                  kind: "conversation",
                  workspaceId: result.workspace.id,
                  workspaceName: result.workspace.name,
                  session,
                  conversationKind: "agent",
                  searchScore:
                    scoreNormalizedSearchValue(normalizedKeyword, session.title, {
                      exact: 72,
                      prefix: 52,
                      includes: 34,
                      occurrence: 6
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, result.workspace.name, {
                      exact: 10,
                      prefix: 7,
                      includes: 5,
                      occurrence: 1
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, formatProviderLabel(session.provider, "full"), {
                      exact: 4,
                      prefix: 3,
                      includes: 2,
                      occurrence: 1
                    })
                }))
            ];
          })
          .sort(compareAffairsConversationSearchResults);

        const todos = workspaceResults
          .flatMap((result) => {
            const inboxItems = result.inboxResult.status === "fulfilled" && Array.isArray(result.inboxResult.value.items)
              ? result.inboxResult.value.items
              : [];
            return [
              ...inboxItems
                .filter((item) => item.workspaceId === result.workspace.id)
                .filter((item) => includesNormalizedSearch(normalizedKeyword, item.title, item.content, item.projectName))
                .map<AffairsSearchTodoResult>((item) => ({
                  kind: "todo",
                  workspaceId: result.workspace.id,
                  workspaceName: result.workspace.name,
                  todoKind: "inbox",
                  id: `inbox:${item.id}`,
                  title: item.title,
                  summary: item.content,
                  statusLabel: item.status,
                  updatedAt: item.updatedAt,
                  searchScore:
                    scoreNormalizedSearchValue(normalizedKeyword, item.title, {
                      exact: 72,
                      prefix: 52,
                      includes: 34,
                      occurrence: 6
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, item.content, {
                      exact: 26,
                      prefix: 18,
                      includes: 12,
                      occurrence: 3
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, item.projectName, {
                      exact: 8,
                      prefix: 6,
                      includes: 4,
                      occurrence: 1
                    })
                })),
              ...followUpItems
                .filter((item) => item.workspaceId === result.workspace.id)
                .filter((item) => includesNormalizedSearch(
                  normalizedKeyword,
                  item.sessionTitle,
                  item.objective,
                  item.projectName,
                  item.waitingReason,
                  item.lastAutomationSummary
                ))
                .map<AffairsSearchTodoResult>((item) => ({
                  kind: "todo",
                  workspaceId: result.workspace.id,
                  workspaceName: result.workspace.name,
                  todoKind: "follow_up",
                  id: `follow-up:${item.id}`,
                  title: item.sessionTitle?.trim() || item.projectName,
                  summary: item.objective,
                  statusLabel: item.status,
                  updatedAt: item.updatedAt,
                  searchScore:
                    scoreNormalizedSearchValue(normalizedKeyword, item.sessionTitle?.trim() || item.projectName, {
                      exact: 72,
                      prefix: 52,
                      includes: 34,
                      occurrence: 6
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, item.objective, {
                      exact: 26,
                      prefix: 18,
                      includes: 12,
                      occurrence: 3
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, item.waitingReason, {
                      exact: 14,
                      prefix: 10,
                      includes: 6,
                      occurrence: 2
                    })
                    + scoreNormalizedSearchValue(normalizedKeyword, item.lastAutomationSummary, {
                      exact: 10,
                      prefix: 7,
                      includes: 5,
                      occurrence: 1
                    })
                }))
            ];
          })
          .sort(compareAffairsTodoSearchResults);

        const hasAffairsFailure = workspaceResults.some((result) =>
          result.snapshotResult.status === "rejected"
          || result.documentResult.status === "rejected"
          || result.lightweightResult.status === "rejected"
          || result.inboxResult.status === "rejected"
        ) || results[0]?.status === "rejected";
        const hasAffairsSuccess = workspaceResults.some((result) =>
          result.snapshotResult.status === "fulfilled"
          || result.documentResult.status === "fulfilled"
          || result.lightweightResult.status === "fulfilled"
          || result.inboxResult.status === "fulfilled"
        );

        setAffairsSearchResults({
          documents,
          tags,
          conversations,
          todos
        });
        setAffairsSearchError(!hasAffairsSuccess && hasAffairsFailure ? t("shell.searchAffairsFailed") : null);
        setAffairsSearchLoading(false);
    };

    if (searchScope === "code") {
      setAffairsSearchError(null);
      setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
      setAffairsSearchLoading(false);
      setCodeSearchLoading(true);
      setCodeSearchError(null);
      void runCodeSearch().catch((error) => {
        if (disposed || requestId !== affairsSearchRequestIdRef.current) {
          return;
        }
        setCodeSearchResults([]);
        setCodeSearchError(error instanceof Error ? error.message : t("shell.searchCodeFailed"));
        setCodeSearchLoading(false);
      });
    } else if (searchScope === "affairs") {
      setCodeSearchError(null);
      setCodeSearchResults([]);
      setCodeSearchLoading(false);
      setAffairsSearchLoading(true);
      setAffairsSearchError(null);
      void runAffairsSearch().catch((error) => {
        if (disposed || requestId !== affairsSearchRequestIdRef.current) {
          return;
        }
        setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
        setAffairsSearchError(error instanceof Error ? error.message : t("shell.searchAffairsFailed"));
        setAffairsSearchLoading(false);
      });
    } else {
      setCodeSearchLoading(true);
      setCodeSearchError(null);
      setAffairsSearchLoading(true);
      setAffairsSearchError(null);
      void runCodeSearch().catch((error) => {
        if (disposed || requestId !== affairsSearchRequestIdRef.current) {
          return;
        }
        setCodeSearchResults([]);
        setCodeSearchError(error instanceof Error ? error.message : t("shell.searchCodeFailed"));
        setCodeSearchLoading(false);
      });
      void runAffairsSearch().catch((error) => {
        if (disposed || requestId !== affairsSearchRequestIdRef.current) {
          return;
        }
        setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
        setAffairsSearchError(error instanceof Error ? error.message : t("shell.searchAffairsFailed"));
        setAffairsSearchLoading(false);
      });
    }

    return () => {
      disposed = true;
    };
  }, [
    availableSearchWorkspaces,
    navigationGroups,
    searchScope,
    submittedSearchKeyword,
    searchModalOpen
  ]);

  useEffect(() => {
    if (currentSessionId && !isDraftSession && sessionWorkspaceId) {
      writeStoredValue(LAST_SESSION_PATH_KEY, `${location.pathname}${location.search}`);
    }
  }, [currentSessionId, isDraftSession, location.pathname, location.search, sessionWorkspaceId]);

  useEffect(() => {
    if (currentSessionId && isDraftSession) {
      lastDraftSessionPathRef.current = `${location.pathname}${location.search}`;
      return;
    }

    if (currentSessionId && !isDraftSession) {
      lastDraftSessionPathRef.current = null;
    }
  }, [currentSessionId, isDraftSession, location.pathname, location.search]);

  useEffect(() => {
    if (isMobileShell) {
      return;
    }

    setMobileNavOpen(false);
    setMobileInfoOpen(false);
  }, [isMobileShell]);

  useEffect(() => {
    if (!isMobileShell || navigationLoading) {
      return;
    }

    if (!shouldRedirectMobileToWorkspaceHome(location.pathname) || explicitWorkspaceId) {
      return;
    }

    setMobileNavOpen(false);
    setMobileInfoOpen(false);
    navigate(workbenchHomePath, { replace: true });
  }, [explicitWorkspaceId, isMobileShell, location.pathname, navigate, navigationLoading, workbenchHomePath]);

  useEffect(() => {
    if (isMobileShell || !isTerminalsRoute(location.pathname) || navigationLoading) {
      return;
    }

    const targetWorkspaceId = routeWorkspaceId ?? currentWorkspaceId;
    const targetWorkspaceRef = routeScopedWorkspaceRef ?? currentWorkspaceRef;

    if (!targetWorkspaceId || !targetWorkspaceRef) {
      return;
    }

    openCodeTerminalDock(targetWorkspaceId, targetWorkspaceRef);
  }, [
    currentWorkspaceId,
    currentWorkspaceRef,
    isMobileShell,
    location.pathname,
    navigationLoading,
    openCodeTerminalDock,
    routeScopedWorkspaceRef,
    routeWorkspaceId
  ]);

  function openLeftPanel() {
    if (isMobileShell) {
      setMobileNavOpen(true);
      return;
    }

    setLeftCollapsed(false);
  }

  function openRightPanel() {
    if (isParallelConversationActive) {
      return;
    }

    ensureInfoPanelReady();

    if (isMobileShell) {
      setMobileInfoOpen(true);
      return;
    }

    setRightCollapsed(false);
  }

  function toggleLeftPanel() {
    if (isMobileShell) {
      setMobileNavOpen((current) => !current);
      return;
    }

    setLeftCollapsed((current) => !current);
  }

  function toggleRightPanel() {
    if (isParallelConversationActive) {
      return;
    }

    ensureInfoPanelReady();

    if (isMobileShell) {
      setMobileInfoOpen((current) => !current);
      return;
    }

    setRightCollapsed((current) => !current);
  }

  function ensureInfoPanelReady() {
    setInfoPanelReady(true);
  }

  function handleSelectWorkspace(workspaceId: string, workspaceRef?: WorkspaceRef | null) {
    const effectiveWorkspaceRef = workspaceRef === undefined ? {
      hostId: "current",
      workspaceId
    } : workspaceRef;
    const nextTargetHostId = normalizeScopeTargetHostId(effectiveWorkspaceRef);
    const routeTargetHostId = normalizeScopeTargetHostId(routeScopedWorkspaceRef);

    logPerfDebug("resource_scope.select_workspace", {
      pathname: location.pathname,
      currentSessionId: currentSessionId ?? null,
      sessionWorkspaceId: sessionWorkspaceId ?? null,
      currentWorkspaceId: currentWorkspaceId ?? null,
      currentWorkspaceRefHostId: currentWorkspaceRef?.hostId ?? null,
      currentWorkspaceRefWorkspaceId: currentWorkspaceRef?.workspaceId ?? null,
      currentTargetHostId: currentTargetHostId ?? null,
      selectedWorkspaceId: workspaceId,
      selectedWorkspaceRefHostId: effectiveWorkspaceRef?.hostId ?? null,
      selectedWorkspaceRefWorkspaceId: effectiveWorkspaceRef?.workspaceId ?? null,
      isTerminalsRoute: isTerminalsRoute(location.pathname),
      isMobileShell
    });

    setSelectedWorkspaceId(workspaceId);
    setSelectedWorkspaceRef(effectiveWorkspaceRef);
    ensureInfoPanelReady();

    if (!effectiveWorkspaceRef) {
      return;
    }

    if (isMobileShell && isTerminalsRoute(location.pathname)) {
      const targetPath = buildWorkspaceTerminalsPath(workspaceId, effectiveWorkspaceRef);

      if (location.pathname !== targetPath) {
        navigate(targetPath);
      }
      return;
    }

    // 桌面端如果还停在旧的终端路由，routeScopedWorkspaceRef 会继续把整个页面压在旧 HOST 上。
    // 这里必须立刻退出旧 terminal route，不能只改选中态。
    if (isTerminalsRoute(location.pathname)) {
      navigate(buildWorkspaceSessionIndexPath(workspaceId, effectiveWorkspaceRef));
      return;
    }

    // 同一个工作区只切 HOST 作用域时，也必须立刻把 targetHostId 写回路由。
    // 否则地址栏仍停在主 HOST，页面内部却已经切到 PeerHOST，请求作用域会继续打架。
    if (!isSameTargetHostId(routeTargetHostId, nextTargetHostId)) {
      navigate(buildWorkspaceSessionIndexPath(workspaceId, effectiveWorkspaceRef));
      return;
    }

    // 会话上下文和工作区上下文不能混着用；切到别的工作区时先退回空白工作台。
    if (currentSessionId && sessionWorkspaceId !== workspaceId) {
      navigate(buildWorkspaceSessionIndexPath(workspaceId, effectiveWorkspaceRef));
    }
  }

  const toggleFavoriteSession = useCallback(
    async (sessionId: string) => {
      const currentSessionEntry = findCanonicalSessionEntryByScope(sessionId, {
        displayWorkspaceId: currentWorkspaceId,
        targetHostId: currentTargetHostId
      });
      const currentSession = currentSessionEntry?.session ?? null;
      const nextFavorite = currentSession?.isFavorite !== true;
      const targetHostId = normalizeScopeTargetHostId(resolveSessionEntryWorkspaceRef(currentSessionEntry));

      setNavigationGroups((current) =>
        updateSessionFavoriteStateInGroups(current, sessionId, nextFavorite)
      );

      try {
        const session = await updateSessionFavoriteState(sessionId, nextFavorite, { targetHostId });
        upsertNavigationSession(session);
        requestNavigationRefresh();
      } catch (error) {
        setNavigationGroups((current) =>
          updateSessionFavoriteStateInGroups(current, sessionId, !nextFavorite)
        );
        throw error;
      }
    },
    [
      currentTargetHostId,
      currentWorkspaceId,
      findCanonicalSessionEntryByScope,
      requestNavigationRefresh,
      resolveSessionEntryWorkspaceRef,
      upsertNavigationSession
    ]
  );

  const startDraftSession = useCallback(
    (workspaceId: string, provider: ProviderId) => {
      const workspace = navigationGroups.find((item) => item.workspace.id === workspaceId)?.workspace ?? null;
      const workspaceRef =
        workspace ? resolveWorkspaceRefForTargetHost(workspace, activeTargetHostId ?? "current") : currentWorkspaceRef;
      const targetHostId = workspaceRef?.hostId && workspaceRef.hostId !== "current" ? workspaceRef.hostId : null;
      const targetWorkspaceId = workspaceRef?.workspaceId?.trim() || workspaceId;

      void assertProviderCanStartDraftSession(targetWorkspaceId, provider, targetHostId)
        .then(() => {
          navigate(
            buildDraftSessionPath(
              workspaceId,
              provider,
              workspaceRef
            )
          );
        })
        .catch((error) => {
          showToast({
            title: error instanceof Error ? error.message : t("shell.startSessionFailed"),
            tone: "error"
          });
        });
    },
    [activeTargetHostId, currentWorkspaceRef, navigate, navigationGroups, showToast]
  );

  const revealWorkspaceFile = useCallback(
    (input: { workspaceId?: string | null; filePath: string; openViewer?: boolean }) => {
      const targetWorkspaceId = input.workspaceId?.trim() || currentWorkspaceId;
      const normalizedFilePath = normalizeWorkbenchFilePath(input.filePath);

      if (!targetWorkspaceId || !normalizedFilePath) {
        return false;
      }

      ensureInfoPanelReady();
      setActiveInfoTab("files");

      if (isMobileShell) {
        setMobileNavOpen(false);
        setMobileInfoOpen(true);
      } else {
        setRightCollapsed(false);
      }

      // 即使路径没变，也要允许用户再次点击后重新定位。
      setFileRevealRequest({
        requestId: fileRevealRequestIdRef.current + 1,
        workspaceId: targetWorkspaceId,
        filePath: normalizedFilePath,
        openViewer: input.openViewer === true
      });
      fileRevealRequestIdRef.current += 1;

      return true;
    },
    [currentWorkspaceId, isMobileShell]
  );

  const renameNavigationSession = useCallback(
    async (sessionId: string, title: string) => {
      const renamedSession = await renameSessionTitle(sessionId, title.trim(), { targetHostId: currentTargetHostId });
      upsertNavigationSession(renamedSession);
      return renamedSession;
    },
    [upsertNavigationSession, currentTargetHostId]
  );

  const toggleLightweightChatFavorite = useCallback(
    async (workspace: WorkspaceDto, session: SessionSummaryDto) => {
      const nextFavorite = session.isFavorite !== true;
      const previousSessions = lightweightChatSessionsByWorkspaceId[workspace.id] ?? [];

      setLightweightChatSessionsByWorkspaceId((current) => ({
        ...current,
        [workspace.id]: (current[workspace.id] ?? []).map((item) =>
          item.sessionId === session.sessionId
            ? {
                ...item,
                isFavorite: nextFavorite
              }
            : item
        )
      }));

      try {
        const updatedSession = await updateAffairsLightweightSessionFavoriteState(
          workspace.id,
          session.sessionId,
          nextFavorite
        );
        setLightweightChatSessionsByWorkspaceId((current) => ({
          ...current,
          [workspace.id]: (current[workspace.id] ?? []).map((item) =>
            item.sessionId === session.sessionId ? updatedSession : item
          )
        }));
      } catch (error) {
        setLightweightChatSessionsByWorkspaceId((current) => ({
          ...current,
          [workspace.id]: previousSessions
        }));
        throw error;
      }
    },
    [lightweightChatSessionsByWorkspaceId]
  );

  const archiveLightweightChat = useCallback(async (workspace: WorkspaceDto, session: SessionSummaryDto) => {
    await updateAffairsLightweightSessionArchiveState(workspace.id, session.sessionId, true);
    setLightweightChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: (current[workspace.id] ?? []).filter((item) => item.sessionId !== session.sessionId)
    }));
    setLightweightArchivedChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: [
        {
          ...session,
          isArchived: true
        },
        ...(current[workspace.id] ?? []).filter((item) => item.sessionId !== session.sessionId)
      ]
    }));
  }, []);

  const unarchiveLightweightChat = useCallback(async (workspace: WorkspaceDto, sessionId: string) => {
    const restoredSession = await updateAffairsLightweightSessionArchiveState(workspace.id, sessionId, false);
    setLightweightChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: [restoredSession, ...(current[workspace.id] ?? [])]
    }));
    setLightweightArchivedChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: (current[workspace.id] ?? []).filter((item) => item.sessionId !== sessionId)
    }));
  }, []);

  const renameLightweightChat = useCallback(async (workspace: WorkspaceDto, sessionId: string, title: string) => {
    const renamedSession = await renameAffairsLightweightSessionTitle(workspace.id, sessionId, title.trim());
    setLightweightChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: (current[workspace.id] ?? []).map((item) =>
        item.sessionId === renamedSession.sessionId ? renamedSession : item
      )
    }));
    return renamedSession;
  }, []);

  const deleteLightweightChat = useCallback(async (workspace: WorkspaceDto, session: SessionSummaryDto) => {
    await deleteAffairsLightweightSession(workspace.id, session.sessionId);
    setLightweightChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: (current[workspace.id] ?? []).filter((item) => item.sessionId !== session.sessionId)
    }));
    setLightweightArchivedChatSessionsByWorkspaceId((current) => ({
      ...current,
      [workspace.id]: (current[workspace.id] ?? []).filter((item) => item.sessionId !== session.sessionId)
    }));
  }, []);

  const openSearchModal = useCallback(() => {
    setSearchModalOpen(true);
  }, []);

  const closeSearchModal = useCallback(() => {
    setSearchModalOpen(false);
  }, []);

  const clearSearchState = useCallback(() => {
    setSearchKeyword("");
    setSearchRequest(null);
    setCodeSearchError(null);
    setCodeSearchResults([]);
    setCodeSearchLoading(false);
    setAffairsSearchError(null);
    setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
    setAffairsSearchLoading(false);
  }, []);

  const openAffairsSearchState = useCallback((workspaceId: string, nextState: AffairsViewState, options?: { closeSearchModal?: boolean }) => {
    openCodeEmbeddedAffairsState({
      ...nextState,
      workspaceId
    }, options);
  }, [openCodeEmbeddedAffairsState]);

  useEffect(() => {
    if (!codeEmbeddedAffairsState) {
      return;
    }

    writeAffairsViewState(codeEmbeddedAffairsState);
  }, [codeEmbeddedAffairsState]);
  function applyWorkbenchShellPanelWidths(nextLeftWidth: number, nextRightWidth: number) {
    const shellElement = workbenchShellRef.current;

    if (!shellElement) {
      return;
    }

    shellElement.style.setProperty("--workbench-left-width", `${nextLeftWidth}px`);
    shellElement.style.setProperty(
      "--workbench-left-current-width",
      effectiveLeftCollapsed ? "0px" : `${nextLeftWidth}px`
    );
    shellElement.style.setProperty("--workbench-right-width", `${nextRightWidth}px`);
    shellElement.style.setProperty(
      "--workbench-right-current-width",
      effectiveRightCollapsed ? "0px" : `${nextRightWidth}px`
    );
  }

  function buildNativeSidebarLayoutSnapshot(
    overrides: Partial<NativeSidebarLayout> = {}
  ): NativeSidebarLayout {
    return {
      leftWidth: overrides.leftWidth ?? (effectiveLeftCollapsed ? 0 : leftPanelWidthRef.current),
      rightWidth:
        overrides.rightWidth
        ?? (shouldShowAuxiliaryPanel && !effectiveRightCollapsed ? rightPanelWidthRef.current : 0),
      leftCollapsed: overrides.leftCollapsed ?? effectiveLeftCollapsed,
      rightCollapsed: overrides.rightCollapsed ?? (!shouldShowAuxiliaryPanel || effectiveRightCollapsed),
      prefersDarkAppearance: overrides.prefersDarkAppearance ?? theme !== "light",
      isResizing: overrides.isResizing ?? activeResizeSide !== null
    };
  }

  function beginResize(side: "left" | "right", startEvent: ReactMouseEvent<HTMLDivElement>) {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    window.getSelection()?.removeAllRanges();

    const startClientX = startEvent.clientX;
    const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;
    setActiveResizeSide(side);

    const commitPendingResizeWidth = () => {
      const pendingWidth = pendingResizeWidthRef.current;
      pendingResizeWidthRef.current = null;

      if (pendingWidth === null) {
        return;
      }

      if (side === "left") {
        leftPanelWidthRef.current = pendingWidth;
        setLeftPanelWidth((current) => (current === pendingWidth ? current : pendingWidth));
        applyWorkbenchShellPanelWidths(pendingWidth, rightPanelWidthRef.current);
        return;
      }

      rightPanelWidthRef.current = pendingWidth;
      setRightPanelWidth((current) => (current === pendingWidth ? current : pendingWidth));
      applyWorkbenchShellPanelWidths(leftPanelWidthRef.current, pendingWidth);
    };

    function handlePointerMove(event: globalThis.MouseEvent) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      const delta = event.clientX - startClientX;
      const nextWidth = side === "left"
        ? clamp(startWidth + delta, MIN_LEFT_PANEL_WIDTH, MAX_LEFT_PANEL_WIDTH)
        : clamp(startWidth - delta, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH);
      const currentWidth = side === "left" ? leftPanelWidthRef.current : rightPanelWidthRef.current;

      if (nextWidth === currentWidth && pendingResizeWidthRef.current === null) {
        return;
      }

      pendingResizeWidthRef.current = nextWidth;

      if (resizeAnimationFrameIdRef.current !== null) {
        return;
      }

      resizeAnimationFrameIdRef.current = window.requestAnimationFrame(() => {
        resizeAnimationFrameIdRef.current = null;
        commitPendingResizeWidth();
      });
    }

    function stopResize() {
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("mouseup", stopResize);

      if (resizeAnimationFrameIdRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameIdRef.current);
        resizeAnimationFrameIdRef.current = null;
      }

      commitPendingResizeWidth();
      setActiveResizeSide((current) => (current === side ? null : current));
      const finalLayout = buildNativeSidebarLayoutSnapshot({ isResizing: false });
      nativeSidebarLayoutRef.current = finalLayout;
      void platform.bridge.syncNativeSidebarLayout(finalLayout);
    }

    document.addEventListener("mousemove", handlePointerMove, { passive: false });
    document.addEventListener("mouseup", stopResize);
  }

  function goToConversationTab() {
    setRightCollapsed(false);
    setCodeEmbeddedAffairsState(null);

    if (navigateToRememberedConversation()) {
      return;
    }

    // 桌面端保留老行为：没有明确上下文时直接落到最近一条会话。
    if (flattenedCanonicalSessions.length === 0) {
      navigate(currentWorkspaceId ? buildWorkspaceSessionIndexPath(currentWorkspaceId, currentWorkspaceRef) : workbenchHomePath);
      return;
    }

  const fallbackSessionPath = buildWorkspaceSessionPath(
    flattenedCanonicalSessions[0].workspace.id,
    flattenedCanonicalSessions[0].session.sessionId,
    currentWorkspaceRef
  );
    navigate(fallbackSessionPath);
  }

  function goToMobileSessionsEntry() {
    if (navigateToRememberedConversation(currentWorkspaceId)) {
      return;
    }

    // 工作区已经变化时，回到当前工作区的会话列表，而不是跳回旧会话。
    if (currentWorkspaceId) {
      navigate(buildWorkspaceSessionIndexPath(currentWorkspaceId, currentWorkspaceRef));
      return;
    }

    navigate(workbenchHomePath);
  }

  function navigateToRememberedConversation(preferredWorkspaceId?: string | null) {
    if (currentSessionId && sessionWorkspaceId) {
      if (
        preferredWorkspaceId
        && sessionWorkspaceId
        && sessionWorkspaceId !== preferredWorkspaceId
      ) {
        return false;
      }

      navigate(`${location.pathname}${location.search}`);
      return true;
    }

    if (lastDraftSessionPathRef.current) {
      if (preferredWorkspaceId) {
        const [draftPathname, draftSearch = ""] = lastDraftSessionPathRef.current.split("?");
        const draftWorkspaceId = resolveRouteWorkspaceId(
          draftPathname ?? lastDraftSessionPathRef.current,
          draftSearch ? `?${draftSearch}` : ""
        );

        if (draftWorkspaceId && draftWorkspaceId !== preferredWorkspaceId) {
          return false;
        }
      }

      navigate(lastDraftSessionPathRef.current);
      return true;
    }

    const storedSessionPath = resolveStoredConversationPath(preferredWorkspaceId);

    if (storedSessionPath) {
      navigate(storedSessionPath);
      return true;
    }

    return false;
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const hasModifier = event.metaKey || event.ctrlKey;

      if (!hasModifier) {
        if (event.key === "Escape") {
          setMobileNavOpen(false);
          setMobileInfoOpen(false);
        }
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();

      if (!event.shiftKey && normalizedKey === "b") {
        event.preventDefault();
        toggleLeftPanel();
        return;
      }

      if (event.shiftKey && normalizedKey === "i") {
        event.preventDefault();
        toggleRightPanel();
        return;
      }

      if (!event.shiftKey && normalizedKey === ",") {
        event.preventDefault();
        navigate("/settings");
        return;
      }

      if (!event.shiftKey && normalizedKey === "1") {
        event.preventDefault();
        goToConversationTab();
        return;
      }

      if (!event.shiftKey && normalizedKey === "2") {
        event.preventDefault();
        openCodeTerminalDock();
        return;
      }

      if (!event.shiftKey && normalizedKey === "f" && platform.isDesktop) {
        event.preventDefault();
        openSearchModal();
        return;
      }

      if (!event.shiftKey && normalizedKey === "k") {
        event.preventDefault();
        focusComposer();
        return;
      }

      if (event.shiftKey && normalizedKey === "r") {
        event.preventDefault();
        void refreshNavigation();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentWorkspaceId, goToConversationTab, isMobileShell, navigate, openCodeTerminalDock, openSearchModal, platform.isDesktop, refreshNavigation]);

  const contextValue = useMemo<WorkbenchShellContextValue>(
    () => ({
      shellMode,
      navigationGroups,
      navigationLoading,
      navigationError,
      currentWorkspaceId,
      currentWorkspaceRef,
      currentTargetHostId,
      currentSessionId,
      findCanonicalSessionEntryByScope,
      findVisibleSessionEntryByScope,
      resolveNavigationWorkspaceRef,
      favoriteSessionIds,
      favoriteSessions,
      globalNotifications,
      archivedNotificationIds: Array.from(archivedNotificationIds),
      showArchivedNotifications,
      unreadNotificationCount,
      refreshNavigation,
      requestNavigationRefresh,
      openNotificationPanel: () => {
        setNotificationPanelOpen(true);
      },
      closeNotificationPanel: () => {
        setNotificationPanelOpen(false);
      },
      setShowArchivedNotifications,
      archiveNotification: (notificationId: string) => {
        void toggleNotificationArchive(notificationId, true);
      },
      unarchiveNotification: (notificationId: string) => {
        void toggleNotificationArchive(notificationId, false);
      },
      setAuxiliaryPanel: setCustomAuxiliaryPanel,
      subscribeFileTree,
      requestFileTreeRefresh,
      addFileTreeSnapshotListener,
      subscribeGitSnapshot,
      requestGitRefresh,
      addGitSnapshotListener,
      subscribeWorkspaceManagementSnapshot,
      requestWorkspaceManagementRefresh,
      addWorkspaceManagementSnapshotListener,
      workspaceManagementStateById,
      subscribeTerminalManagerSnapshot,
      requestTerminalManagerRefresh,
      addTerminalManagerSnapshotListener,
      selectWorkspace: handleSelectWorkspace,
      toggleFavoriteSession,
      archiveSession: (sessionId: string) => commitNavigationArchiveState(sessionId, true),
      unarchiveSession: (sessionId: string) => commitNavigationArchiveState(sessionId, false),
      renameSession: renameNavigationSession,
      startDraftSession,
      markNavigationSessionSeen,
      upsertNavigationSession,
      setSessionWorkspace,
      revealWorkspaceFile
    }),
    [
      addFileTreeSnapshotListener,
      addGitSnapshotListener,
      addWorkspaceManagementSnapshotListener,
      addTerminalManagerSnapshotListener,
      commitNavigationArchiveState,
      currentSessionId,
      currentTargetHostId,
      currentWorkspaceRef,
      currentWorkspaceId,
      findCanonicalSessionEntryByScope,
      findVisibleSessionEntryByScope,
      resolveNavigationWorkspaceRef,
      globalNotifications,
      favoriteSessionIds,
      favoriteSessions,
      handleSelectWorkspace,
      archivedNotificationIds,
      markNavigationSessionSeen,
      navigationError,
      navigationGroups,
      navigationLoading,
      unreadNotificationCount,
      requestFileTreeRefresh,
      requestGitRefresh,
      requestWorkspaceManagementRefresh,
      refreshNavigation,
      requestNavigationRefresh,
      setShowArchivedNotifications,
      setCustomAuxiliaryPanel,
      requestTerminalManagerRefresh,
      renameNavigationSession,
      showArchivedNotifications,
      workspaceManagementStateById,
      shellMode,
      startDraftSession,
      setSessionWorkspace,
      subscribeFileTree,
      subscribeGitSnapshot,
      subscribeWorkspaceManagementSnapshot,
      subscribeTerminalManagerSnapshot,
      toggleNotificationArchive,
      toggleFavoriteSession,
      upsertNavigationSession,
      revealWorkspaceFile
    ]
  );

  const defaultAuxiliaryPanelContent = activeCenterTab === "butler"
    ? (
      <div className="workbench-auxiliary-custom-panel">
        {customAuxiliaryPanel}
      </div>
    )
    : (
      <WorkbenchInfoPanel
        panelReady={infoPanelReady}
        activeTab={activeInfoTab}
        fileRevealRequest={fileRevealRequest}
        onTabChange={(tab) => {
          ensureInfoPanelReady();
          setActiveInfoTab(tab);
        }}
        currentSessionId={isDraftSession ? null : currentSessionId}
        activeWorkspaceId={currentAuxiliaryWorkspaceId}
        requestWorkspaceId={currentRequestWorkspaceId}
        currentWorkspaceRef={currentWorkspaceRef}
        currentTargetHostId={currentTargetHostId}
        navigationGroups={navigationGroups}
        workspaceContext={currentAuxiliaryWorkspaceContext}
        worktreeMeta={currentWorktreeMeta}
        worktreeMergeState={currentWorktreeMergeState}
        onRefreshWorktreeMergePreview={loadWorktreeMergePreview}
        onApplyWorktreeMerge={applyWorktreeMerge}
        onCleanupWorktree={requestWorktreeCleanup}
      />
    );
  const codeEmbeddedAffairsAuxiliaryPanelContent =
    currentWorkspaceId && codeEmbeddedAffairsState
      ? (
        <AffairsWorkbenchProvider
          workspaceId={currentWorkspaceId}
          workspaceName={currentWorkspaceName}
          navigationGroups={navigationGroups}
          state={codeEmbeddedAffairsState}
          onStateChange={setCodeEmbeddedAffairsState}
          onRefreshNavigation={refreshNavigation}
          forceRoute={false}
          targetHostId={currentTargetHostId}
        >
          <AffairsAuxiliaryPanel workspaceId={currentWorkspaceId} onToggleCollapse={() => setRightCollapsed(true)} />
        </AffairsWorkbenchProvider>
      )
      : null;
  const shouldRenderCodeEmbeddedAffairs = Boolean(
      currentWorkspaceId
      && codeEmbeddedAffairsState
      && (
        codeEmbeddedAffairsState.primarySection === "library"
        || codeEmbeddedAffairsState.primarySection === "workbench"
      )
    );
  const isLightweightChatActive = isLightweightChatRoute(location.pathname);
  const effectiveAuxiliaryPanelContent = shouldRenderCodeEmbeddedAffairs
    ? codeEmbeddedAffairsAuxiliaryPanelContent
    : defaultAuxiliaryPanelContent;
  const codeRightCollapsed = rightCollapsed || isParallelConversationActive;
  const shouldAllowAuxiliaryPanel = effectiveAuxiliaryPanelContent !== null && !isLightweightChatActive;
  const shouldShowAuxiliaryPanel = shouldAllowAuxiliaryPanel && !codeRightCollapsed;
  const effectiveLeftCollapsed = leftCollapsed;
  const effectiveRightCollapsed = codeRightCollapsed;
  const shellRightCollapsed = effectiveRightCollapsed;
  const shouldKeepParallelAuxiliaryMounted =
    isParallelConversationActive
    && parallelConversationTransition !== null
    && !rightCollapsed;
  const shouldRenderAuxiliaryPanel =
    shouldAllowAuxiliaryPanel
    && (
      !shouldRenderCodeEmbeddedAffairs
      || !effectiveRightCollapsed
      || shouldKeepParallelAuxiliaryMounted
    );
  const shellStyle = {
    "--workbench-left-width": `${leftPanelWidth}px`,
    "--workbench-left-current-width": effectiveLeftCollapsed ? "0px" : `${leftPanelWidth}px`,
    "--workbench-right-width": `${rightPanelWidth}px`,
    "--workbench-right-current-width":
      effectiveRightCollapsed ? "0px" : `${rightPanelWidth}px`,
    "--workbench-right-sidebar-duration":
      parallelConversationTransition && !rightCollapsed
        ? `${parallelConversationTransition.sidebarCollapseDurationMs}ms`
        : undefined,
    "--workbench-right-sidebar-content-duration":
      parallelConversationTransition && !rightCollapsed
        ? `${Math.max(320, parallelConversationTransition.sidebarCollapseDurationMs - 120)}ms`
        : undefined
  } as CSSProperties;
  const shouldUseMacOsOverlayTitlebarAlignment =
    platform.isDesktop && platform.ui.osFamily === "macos" && platform.ui.prefersOverlayTitlebar;


  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const { documentElement, body } = document;
    const clearWindowLiveResizeState = () => {
      if (windowResizeSettleTimerRef.current !== null) {
        window.clearTimeout(windowResizeSettleTimerRef.current);
        windowResizeSettleTimerRef.current = null;
      }

      const hadLiveResize = isWindowLiveResizingRef.current;
      isWindowLiveResizingRef.current = false;
      documentElement.removeAttribute(WORKBENCH_WINDOW_RESIZING_ATTRIBUTE);
      body?.removeAttribute(WORKBENCH_WINDOW_RESIZING_ATTRIBUTE);

      if (hadLiveResize && pendingTitlebarAlignmentAfterResizeRef.current) {
        pendingTitlebarAlignmentAfterResizeRef.current = false;
        setWindowResizeSettleVersion((value) => value + 1);
      }
    };

    if (!shouldUseMacOsOverlayTitlebarAlignment) {
      clearWindowLiveResizeState();
      return;
    }

    const handleWindowResize = () => {
      isWindowLiveResizingRef.current = true;
      documentElement.setAttribute(WORKBENCH_WINDOW_RESIZING_ATTRIBUTE, "true");
      body?.setAttribute(WORKBENCH_WINDOW_RESIZING_ATTRIBUTE, "true");

      if (windowResizeSettleTimerRef.current !== null) {
        window.clearTimeout(windowResizeSettleTimerRef.current);
      }

      windowResizeSettleTimerRef.current = window.setTimeout(() => {
        clearWindowLiveResizeState();
      }, WORKBENCH_WINDOW_RESIZE_SETTLE_MS);
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      clearWindowLiveResizeState();
    };
  }, [shouldUseMacOsOverlayTitlebarAlignment]);

  const nativeSidebarLayout = useMemo(
    () => ({
      leftWidth: effectiveLeftCollapsed ? 0 : leftPanelWidth,
      rightWidth: shouldShowAuxiliaryPanel && !effectiveRightCollapsed ? rightPanelWidth : 0,
      leftCollapsed: effectiveLeftCollapsed,
      rightCollapsed: !shouldShowAuxiliaryPanel || effectiveRightCollapsed,
      prefersDarkAppearance: theme !== "light",
      isResizing: activeResizeSide !== null
    }),
    [
      activeResizeSide,
      effectiveRightCollapsed,
      effectiveLeftCollapsed,
      leftPanelWidth,
      rightPanelWidth,
      shouldShowAuxiliaryPanel,
      theme
    ]
  );
  const deferredNativeSidebarLayout = useDeferredValue(nativeSidebarLayout);
  const nativeSidebarSyncLayout =
    activeResizeSide === null ? deferredNativeSidebarLayout : nativeSidebarLayout;
  const nativeSidebarLayoutRef = useRef(nativeSidebarLayout);

  useEffect(() => {
    nativeSidebarLayoutRef.current = nativeSidebarLayout;
  }, [nativeSidebarLayout]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let animationFrameId: number | null = null;

    const syncNativeSidebarLayout = () => {
      animationFrameId = null;
      void platform.bridge.syncNativeSidebarLayout(nativeSidebarSyncLayout);
    };

    const scheduleSync = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(syncNativeSidebarLayout);
    };

    if (!prefersMacOsWorkbenchVibrancy) {
      void platform.bridge.syncNativeSidebarLayout({
        leftWidth: 0,
        rightWidth: 0,
        leftCollapsed: true,
        rightCollapsed: true,
        prefersDarkAppearance: false,
        isResizing: false
      });
      return () => {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
        }
      };
    }

    scheduleSync();

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [
    nativeSidebarSyncLayout,
    platform.bridge,
    prefersMacOsWorkbenchVibrancy
  ]);

  useLayoutEffect(() => {
    const shellElement = workbenchShellRef.current;

    if (!shellElement || !shouldUseMacOsOverlayTitlebarAlignment || typeof window === "undefined") {
      resetWorkbenchTitlebarLiveShiftVariables(shellElement);
      return;
    }

    let animationFrameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const observedElements = new Set<HTMLElement>([shellElement]);

    const measureAndApplyAlignment = () => {
      pendingTitlebarAlignmentAfterResizeRef.current = false;
      const computedStyle = window.getComputedStyle(shellElement);
      const trafficLightCenterY = readCssNumericCustomProperty(
        computedStyle,
        "--desktop-macos-traffic-light-center-y"
      );

      if (trafficLightCenterY === null) {
        resetWorkbenchTitlebarLiveShiftVariables(shellElement);
        return;
      }

      const measuredCenters = {
        navToolbar: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.navToolbar.selector
        ),
        infoTabs: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.infoTabs.selector
        ),
        auxiliaryToolbarButton: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.auxiliaryToolbarButton.selector
        ),
        conversationHeaderMain: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.conversationHeaderMain.selector
        ),
        conversationHeaderActions: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.conversationHeaderActions.selector
        ),
        terminalTabbarMain: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.terminalTabbarMain.selector
        ),
        collapsedLeftControls: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.collapsedLeftControls.selector
        ),
        collapsedRightControls: measureWorkbenchSelectorCenterY(
          shellElement,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.collapsedRightControls.selector
        )
      } as const;
      const contentCenters = [
        measuredCenters.infoTabs,
        measuredCenters.conversationHeaderMain,
        measuredCenters.conversationHeaderActions,
        measuredCenters.terminalTabbarMain
      ].filter((value): value is number => value !== null);
      const collapsedCenters = [
        measuredCenters.collapsedLeftControls,
        measuredCenters.collapsedRightControls
      ].filter((value): value is number => value !== null);
      const collapsedShift =
        collapsedCenters.length > 0
          ? resolveWorkbenchAbsoluteShift(
              computedStyle,
              "--workbench-collapsed-controls-live-shift-y",
              trafficLightCenterY,
              collapsedCenters.reduce((total, value) => total + value, 0) / collapsedCenters.length
            )
          : null;
      const contentShift =
        contentCenters.length > 0
          ? resolveWorkbenchAbsoluteShift(
              computedStyle,
              "--workbench-titlebar-live-content-shift-y",
              trafficLightCenterY,
              contentCenters.reduce((total, value) => total + value, 0) / contentCenters.length
            )
          : null;

      setWorkbenchLiveShiftVariable(shellElement, "--workbench-titlebar-live-content-shift-y", contentShift);
      setWorkbenchLiveShiftVariable(shellElement, "--workbench-collapsed-controls-live-shift-y", collapsedShift);
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.navToolbar.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.navToolbar.variableName,
          trafficLightCenterY,
          measuredCenters.navToolbar
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.infoTabs.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.infoTabs.variableName,
          trafficLightCenterY,
          measuredCenters.infoTabs
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.auxiliaryToolbarButton.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.auxiliaryToolbarButton.variableName,
          trafficLightCenterY,
          measuredCenters.auxiliaryToolbarButton
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.conversationHeaderMain.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.conversationHeaderMain.variableName,
          trafficLightCenterY,
          measuredCenters.conversationHeaderMain
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.conversationHeaderActions.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.conversationHeaderActions.variableName,
          trafficLightCenterY,
          measuredCenters.conversationHeaderActions
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.terminalTabbarMain.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.terminalTabbarMain.variableName,
          trafficLightCenterY,
          measuredCenters.terminalTabbarMain
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.collapsedLeftControls.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.collapsedLeftControls.variableName,
          trafficLightCenterY,
          measuredCenters.collapsedLeftControls
        )
      );
      setWorkbenchLiveShiftVariable(
        shellElement,
        WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.collapsedRightControls.variableName,
        resolveWorkbenchAbsoluteShift(
          computedStyle,
          WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS.collapsedRightControls.variableName,
          trafficLightCenterY,
          measuredCenters.collapsedRightControls
        )
      );
    };

    const scheduleMeasure = () => {
      if (isWindowLiveResizingRef.current) {
        pendingTitlebarAlignmentAfterResizeRef.current = true;
        return;
      }

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        measureAndApplyAlignment();
      });
    };

    scheduleMeasure();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });

      for (const target of Object.values(WORKBENCH_TITLEBAR_ALIGNMENT_TARGETS)) {
        for (const element of shellElement.querySelectorAll<HTMLElement>(target.selector)) {
          observedElements.add(element);
        }
      }

      for (const element of observedElements) {
        resizeObserver.observe(element);
      }
    }

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, [
    activeCenterTab,
    infoPanelReady,
    leftCollapsed,
    location.pathname,
    location.search,
    rightCollapsed,
    shouldShowAuxiliaryPanel,
    shouldUseMacOsOverlayTitlebarAlignment,
    windowResizeSettleVersion
  ]);
  const mobileNavigationPanel = isMobileShell ? (
    <SidebarContent
      navigationGroups={navigationGroups}
      workspaceGroups={workspaceSidebarGroups}
      workspaceVisualContextMap={workspaceVisualContextMap}
      sessionDisplaySortMode={sessionDisplaySortMode}
      favoriteSessions={favoriteSessions}
      favoriteSessionIds={favoriteSessionIdSet}
      activeWorkspaceId={currentWorkspaceId}
      codeEmbeddedAffairsState={codeEmbeddedAffairsState}
      onCodeEmbeddedAffairsStateChange={setCodeEmbeddedAffairsState}
      affairsLibraryEnabled={affairsLibraryCapability.enabled}
      lightweightChatSessionsByWorkspaceId={lightweightChatSessionsByWorkspaceId}
      lightweightArchivedChatSessionsByWorkspaceId={lightweightArchivedChatSessionsByWorkspaceId}
      activeLightweightChatId={resolveRouteLightweightChatMatch(location.pathname)?.chatId ?? null}
      isConversationActive={activeCenterTab === "conversation"}
      isButlerActive={activeCenterTab === "butler"}
      isSearchOpen={searchModalOpen}
      navigationLoading={navigationLoading}
      navigationError={navigationError}
      activeSessionId={currentSessionId}
      currentTargetHostId={currentTargetHostId}
      onRefreshNavigation={refreshNavigation}
      onSessionUpdated={upsertNavigationSession}
      onNavigateConversation={goToConversationTab}
      onOpenTerminalDock={() => {
        setMobileNavOpen(false);
        openCodeTerminalDock();
      }}
      onNavigateButler={() => {
        setMobileNavOpen(false);
        navigate(
          currentWorkspaceId
            ? buildWorkspaceButlerPath(currentWorkspaceId, undefined, currentWorkspaceRef)
            : buildWorkspaceHomePath()
        );
      }}
      onOpenSearch={() => {
        setMobileNavOpen(false);
        openSearchModal();
      }}
      onOpenSettings={() => {
        setMobileNavOpen(false);
        navigate("/settings");
      }}
      onOpenCodeEmbeddedAffairsSection={openCodeEmbeddedAffairsSection}
      onOpenLightweightChat={openLightweightChat}
      onCreateLightweightChat={createLightweightChat}
      onSelectWorkspace={handleSelectWorkspace}
      onToggleWorkspaceCollapse={handleToggleWorkspaceCollapse}
      onStartWorkspaceReorder={handleStartWorkspaceReorder}
      onPreviewWorkspaceReorder={handlePreviewWorkspaceReorder}
      onCommitWorkspaceReorder={handleCommitWorkspaceReorder}
      allowWorkspaceReorder={false}
      subscribeGitSnapshot={subscribeGitSnapshot}
      requestGitRefresh={requestGitRefresh}
      subscribeWorkspaceManagementSnapshot={subscribeWorkspaceManagementSnapshot}
      requestWorkspaceManagementRefresh={requestWorkspaceManagementRefresh}
      onToggleFavoriteSession={toggleFavoriteSession}
      onArchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, true)}
      onUnarchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, false)}
      onToggleLightweightChatFavorite={toggleLightweightChatFavorite}
      onArchiveLightweightChat={archiveLightweightChat}
      onUnarchiveLightweightChat={unarchiveLightweightChat}
      onRenameLightweightChat={renameLightweightChat}
      onDeleteLightweightChat={deleteLightweightChat}
      workspaceManagementStateById={workspaceManagementStateById}
      setWorkspaceManagementStateById={setWorkspaceManagementStateById}
      unreadNotificationCount={unreadNotificationCount}
      notificationPanelOpen={notificationPanelOpen}
      onToggleNotificationPanel={() => {
        setNotificationPanelOpen((current) => !current);
      }}
      onClose={() => setMobileNavOpen(false)}
      codeShortcutRailSlot={codeShortcutRailLeftSlot}
    />
  ) : null;
  const mobileAuxiliaryPanel = isMobileShell && shouldShowAuxiliaryPanel ? effectiveAuxiliaryPanelContent : null;

  return (
    <WorkbenchShellContext.Provider value={contextValue}>
      {isMobileShell ? (
        <>
          <MobileWorkbenchShell
            activeEntry={mobileActiveEntry}
            presentation={isMobileConversationFocus ? "conversation-focus" : "default"}
            navigationPanel={mobileNavigationPanel}
            auxiliaryPanel={mobileAuxiliaryPanel}
            onOpenNavigation={() => {
              setMobileInfoOpen(false);
              setMobileNavOpen(true);
            }}
            onOpenSearch={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              openSearchModal();
            }}
            onOpenAuxiliary={() => {
              if (!shouldShowAuxiliaryPanel) {
                return;
              }
              ensureInfoPanelReady();
              setMobileNavOpen(false);
              setMobileInfoOpen(true);
            }}
            onNavigateWorkspaces={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(buildWorkspaceHomePath());
            }}
            onNavigateTerminals={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceTerminalsPath(currentWorkspaceId, currentWorkspaceRef)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateButler={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceButlerPath(currentWorkspaceId, undefined, currentWorkspaceRef)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateSessions={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              goToMobileSessionsEntry();
            }}
            onNavigateToolFiles={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceToolFilesPath(currentWorkspaceId, currentWorkspaceRef)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateToolGit={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceToolGitPath(currentWorkspaceId, currentWorkspaceRef)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateToolProcesses={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceToolProcessesPath(currentWorkspaceId, currentWorkspaceRef)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateSettings={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate("/settings");
            }}
          >
            <Outlet />
          </MobileWorkbenchShell>
        </>
      ) : (
        <div
          className="workbench-shell"
          ref={workbenchShellRef}
          style={shellStyle}
          onMouseDownCapture={handleUnifiedTitlebarMouseDownCapture}
          onDoubleClickCapture={handleUnifiedTitlebarDoubleClickCapture}
          data-nav-loading={navigationLoading}
          data-left-collapsed={effectiveLeftCollapsed}
          data-right-collapsed={shellRightCollapsed}
          data-info-ready={infoPanelReady}
          data-parallel-conversation-active={isParallelConversationActive ? "true" : undefined}
          data-parallel-sidebar-transition={shouldKeepParallelAuxiliaryMounted ? "true" : undefined}
          data-workbench-mode="code"
          data-runtime-platform={platform.platform}
          data-os-family={platform.ui.osFamily}
          data-overlay-titlebar={platform.ui.prefersOverlayTitlebar}
        >
          <div className="workbench-body-shell">
            <>
                <aside className="workbench-nav surface-card" data-collapsed={effectiveLeftCollapsed}>
                  <SidebarContent
                    navigationGroups={navigationGroups}
                    workspaceGroups={workspaceSidebarGroups}
                    workspaceVisualContextMap={workspaceVisualContextMap}
                    sessionDisplaySortMode={sessionDisplaySortMode}
                    favoriteSessions={favoriteSessions}
                  favoriteSessionIds={favoriteSessionIdSet}
                    activeWorkspaceId={currentWorkspaceId}
                    codeEmbeddedAffairsState={codeEmbeddedAffairsState}
                    onCodeEmbeddedAffairsStateChange={setCodeEmbeddedAffairsState}
                    affairsLibraryEnabled={affairsLibraryCapability.enabled}
                    lightweightChatSessionsByWorkspaceId={lightweightChatSessionsByWorkspaceId}
                    lightweightArchivedChatSessionsByWorkspaceId={lightweightArchivedChatSessionsByWorkspaceId}
                    activeLightweightChatId={resolveRouteLightweightChatMatch(location.pathname)?.chatId ?? null}
                    isConversationActive={activeCenterTab === "conversation"}
                    isButlerActive={activeCenterTab === "butler"}
                    isSearchOpen={searchModalOpen}
                    navigationLoading={navigationLoading}
                    navigationError={navigationError}
                    activeSessionId={currentSessionId}
                    currentTargetHostId={currentTargetHostId}
                    onRefreshNavigation={refreshNavigation}
                    onSessionUpdated={upsertNavigationSession}
                    onNavigateConversation={goToConversationTab}
                    onOpenTerminalDock={openCodeTerminalDock}
                    onNavigateButler={() =>
                      navigate(
                        currentWorkspaceId
                          ? buildWorkspaceButlerPath(currentWorkspaceId, undefined, currentWorkspaceRef)
                          : buildWorkspaceHomePath()
                      )
                    }
                    onOpenSearch={() => openSearchModal()}
                    onOpenSettings={() => navigate("/settings")}
                    onOpenCodeEmbeddedAffairsSection={openCodeEmbeddedAffairsSection}
                    onOpenLightweightChat={openLightweightChat}
                    onCreateLightweightChat={createLightweightChat}
                    onSelectWorkspace={handleSelectWorkspace}
                    onToggleWorkspaceCollapse={handleToggleWorkspaceCollapse}
                    onStartWorkspaceReorder={handleStartWorkspaceReorder}
                    onPreviewWorkspaceReorder={handlePreviewWorkspaceReorder}
                    onCommitWorkspaceReorder={handleCommitWorkspaceReorder}
                    allowWorkspaceReorder
                    subscribeGitSnapshot={subscribeGitSnapshot}
                    requestGitRefresh={requestGitRefresh}
                    subscribeWorkspaceManagementSnapshot={subscribeWorkspaceManagementSnapshot}
                    requestWorkspaceManagementRefresh={requestWorkspaceManagementRefresh}
                    onToggleFavoriteSession={toggleFavoriteSession}
                    onArchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, true)}
                    onUnarchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, false)}
                    onToggleLightweightChatFavorite={toggleLightweightChatFavorite}
                    onArchiveLightweightChat={archiveLightweightChat}
                    onUnarchiveLightweightChat={unarchiveLightweightChat}
                    onRenameLightweightChat={renameLightweightChat}
                    onDeleteLightweightChat={deleteLightweightChat}
                    workspaceManagementStateById={workspaceManagementStateById}
                    setWorkspaceManagementStateById={setWorkspaceManagementStateById}
                    unreadNotificationCount={unreadNotificationCount}
                    notificationPanelOpen={notificationPanelOpen}
                    onToggleNotificationPanel={() => {
                      setNotificationPanelOpen((current) => !current);
                    }}
                    onToggleCollapse={() => {
                      setLeftCollapsed(true);
                    }}
                    codeShortcutRailSlot={codeShortcutRailLeftSlot}
                  />
                </aside>
                <div
                  className="workbench-side-resizer"
                  data-side="left"
                  data-collapsed={effectiveLeftCollapsed}
                  role="separator"
                  aria-label={t("shell.leftResizerLabel")}
                  onMouseDown={
                    effectiveLeftCollapsed
                      ? undefined
                      : (event) => beginResize("left", event)
                  }
                />

                <div className="workbench-main-shell">
                  <div className="workbench-collapsed-rail" aria-hidden={!effectiveLeftCollapsed && !rightCollapsed}>
                    <div
                      className="workbench-collapsed-controls left"
                      data-visible={effectiveLeftCollapsed}
                    >
                      <SidebarDockButton
                        className="workbench-nav-toolbar-button workbench-collapsed-button"
                        ariaLabel={t("shell.showSessionSidebar")}
                        side="left"
                        collapsed={true}
                        onClick={openLeftPanel}
                      />
                      <WorkbenchHostSwitcher collapsed />
                      <WorkbenchNotificationButton
                        unreadCount={unreadNotificationCount}
                        open={notificationPanelOpen}
                        onToggle={() => {
                          setNotificationPanelOpen((current) => !current);
                        }}
                        collapsed
                      />
                      <button
                        type="button"
                        className="workbench-nav-toolbar-button workbench-collapsed-button"
                        data-open={searchModalOpen}
                        aria-label={t("shell.searchEntry")}
                        title={t("shell.searchEntry")}
                        aria-haspopup="dialog"
                        aria-expanded={searchModalOpen}
                        onClick={() => openSearchModal()}
                      >
                        <SearchIcon />
                      </button>
                    </div>

                    {shouldAllowAuxiliaryPanel && effectiveRightCollapsed && !isParallelConversationActive ? (
                      <div
                        className="workbench-collapsed-controls right"
                        data-visible={effectiveRightCollapsed}
                      >
                        <SidebarDockButton
                          className="workbench-nav-toolbar-button workbench-collapsed-button"
                          ariaLabel={t("shell.showInfoSidebar")}
                          side="right"
                          collapsed={true}
                          onClick={openRightPanel}
                        />
                      </div>
                    ) : null}
                  </div>

                  <CodeWorkbenchView
                    workspaceId={currentWorkspaceId}
                    workspaceName={currentWorkspaceName}
                    terminalDockState={codeTerminalDockState}
                    terminalDockVisible={showCodeTerminalDock}
                    onCloseTerminalDock={closeCodeTerminalDock}
                    onChangeTerminalDockOrientation={changeCodeTerminalDockOrientation}
                    onResizeTerminalDock={resizeCodeTerminalDock}
                    terminalWorkbenchShellOverrides={{
                      navigationGroups,
                      currentWorkspaceId,
                      currentWorkspaceRef,
                      currentTargetHostId,
                      selectWorkspace: handleSelectWorkspace,
                      subscribeTerminalManagerSnapshot,
                      requestTerminalManagerRefresh,
                      addTerminalManagerSnapshotListener
                    }}
                  >
                    {codeWorkbenchContent}
                  </CodeWorkbenchView>
                </div>

                {shouldRenderAuxiliaryPanel ? (
                  <>
                    <div
                      className="workbench-side-resizer"
                      data-side="right"
                      data-collapsed={effectiveRightCollapsed}
                      data-auto-hidden={isParallelConversationActive ? "true" : undefined}
                      role="separator"
                      aria-label={t("shell.rightResizerLabel")}
                      onMouseDown={
                        effectiveRightCollapsed
                          ? undefined
                          : (event) => beginResize("right", event)
                      }
                    />
                    <aside
                      className="workbench-auxiliary surface-card"
                      data-workspace-tone={currentAuxiliaryWorkspaceContext?.tone ?? "root"}
                      data-worktree-depth={currentAuxiliaryWorkspaceContext?.depth ?? 0}
                      data-collapsed={effectiveRightCollapsed}
                      data-auto-hidden={isParallelConversationActive ? "true" : undefined}
                      data-custom-panel={activeCenterTab === "butler"}
                      data-parallel-transition={shouldKeepParallelAuxiliaryMounted ? "true" : undefined}
                      aria-hidden={effectiveRightCollapsed && !shouldKeepParallelAuxiliaryMounted}
                      style={createWorkspaceToneStyle(currentAuxiliaryWorkspaceContext)}
                    >
                      {isParallelConversationActive && !shouldKeepParallelAuxiliaryMounted ? null : effectiveAuxiliaryPanelContent}
                      {!shouldRenderCodeEmbeddedAffairs && codeShortcutRailRightSlot ? (
                        <div className="workbench-auxiliary-footer">
                          {codeShortcutRailRightSlot}
                        </div>
                      ) : null}
                    </aside>
                  </>
                ) : null}
              </>
          </div>
        </div>
      )}

      {lightweightChatCreateWorkspace && lightweightChatCreateAffairsState ? (
        <AffairsWorkbenchProvider
          workspaceId={lightweightChatCreateWorkspace.id}
          workspaceName={lightweightChatCreateWorkspace.name ?? null}
          navigationGroups={navigationGroups}
          state={lightweightChatCreateAffairsState}
          onStateChange={setLightweightChatCreateAffairsState}
          onRefreshNavigation={refreshNavigation}
          onConversationDraftSelected={handleLightweightChatDraftSelected}
          forceRoute={false}
          targetHostId={currentTargetHostId}
        >
          <AffairsLightweightConversationCreateModalLauncher onClose={closeLightweightChatCreateModal} />
        </AffairsWorkbenchProvider>
      ) : null}

      <WorkbenchNotificationModal
        open={notificationPanelOpen}
        notifications={globalNotifications}
        archivedNotificationIds={archivedNotificationIds}
        showArchivedNotifications={showArchivedNotifications}
        onClose={() => setNotificationPanelOpen(false)}
        onToggleShowArchivedNotifications={setShowArchivedNotifications}
        onArchiveNotification={(notificationId) => {
          void toggleNotificationArchive(notificationId, true);
        }}
        onUnarchiveNotification={(notificationId) => {
          void toggleNotificationArchive(notificationId, false);
        }}
        onSelectNotification={handleSelectNotification}
        preferredWorkspaceId={currentWorkspaceId}
        preferredSessionId={isDraftSession ? null : currentSessionId}
      />

      <WorkspaceSearchModal
        open={searchModalOpen}
        scope={searchScope}
        keyword={searchKeyword}
        affairsSortMode={affairsSearchSortMode}
        sessionResults={sessionSearchResults}
        codeResults={codeSearchResults}
        codeLoading={codeSearchLoading}
        codeError={codeSearchError}
        affairsResults={displayedAffairsSearchResults}
        affairsLoading={affairsSearchLoading}
        affairsError={affairsSearchError}
        onClose={closeSearchModal}
        onKeywordChange={(value) => {
          setSearchKeyword(value);
          setSearchRequest(null);
          setCodeSearchResults([]);
          setCodeSearchError(null);
          setCodeSearchLoading(false);
          setAffairsSearchError(null);
          setAffairsSearchResults(EMPTY_AFFAIRS_SEARCH_RESULTS);
          setAffairsSearchLoading(false);
        }}
        onAffairsSortModeChange={setAffairsSearchSortMode}
        onClearSearch={clearSearchState}
        onSubmitSearch={(scope) => {
          const trimmedKeyword = searchKeyword.trim();
          if (!trimmedKeyword) {
            return;
          }
          setSearchRequest({
            keyword: trimmedKeyword,
            scope
          });
        }}
        onOpenSession={(sessionId) => {
          closeSearchModal();
          const entry = findCanonicalSessionEntryByScope(sessionId, {
            displayWorkspaceId: currentWorkspaceId,
            targetHostId: currentTargetHostId
          });
          const workspaceRef = resolveSessionEntryWorkspaceRef(entry);
          if (entry) {
            handleSelectWorkspace(entry.workspace.id, workspaceRef);
          }
          navigate(buildSessionEntryPath(entry) ?? buildWorkspaceHomePath());
        }}
        onOpenCodeFile={(item) => {
          closeSearchModal();
          setSelectedWorkspaceId(item.workspaceId);
          revealWorkspaceFile({
            workspaceId: item.workspaceId,
            filePath: item.file.path,
            openViewer: item.file.kind === "file"
          });
          const targetPath = resolveStoredConversationPath(item.workspaceId)
            ?? buildWorkspaceSessionIndexPath(item.workspaceId, currentWorkspaceRef);
          if (location.pathname !== targetPath) {
            navigate(targetPath);
          }
        }}
        onOpenAffairsDocument={(item) => {
          const currentState = readAffairsViewState(item.workspaceId) ?? createDefaultAffairsViewState(item.workspaceId);
          const baseState = currentState.primarySection === "library"
            ? currentState
            : createDefaultAffairsLibraryLandingState(item.workspaceId, currentState);
          openAffairsSearchState(item.workspaceId, {
            ...baseState,
            workspaceId: item.workspaceId,
            primarySection: "library",
            pendingLibraryPreview: {
              requestId: `${item.record.documentId || item.dedupePath}:${Date.now()}`,
              filePath: item.record.path,
              title: getAffairsDocumentDisplayName(item.record)
            }
          }, { closeSearchModal: false });
        }}
        onLocateAffairsDocument={(item) => {
          const parentFolderPath = getParentFolderPathFromFilePath(item.record.path);
          openAffairsSearchState(item.workspaceId, {
            ...createDefaultAffairsLibraryLandingState(
              item.workspaceId,
              readAffairsViewState(item.workspaceId) ?? createDefaultAffairsViewState(item.workspaceId)
            ),
            workspaceId: item.workspaceId,
            primarySection: "library",
            browseMode: "folder",
            selectedNodeId: parentFolderPath ? `library:folder:${parentFolderPath}` : "library:all",
            selectedFolderPath: parentFolderPath,
            selectedFolderEntryPath: null,
            selectedTagPath: null,
            selectedTagPaths: [],
            selectedFavoriteId: null,
            selectedObjectId: item.record.documentId,
            selectedDocumentId: item.record.documentId,
            auxiliaryTab: "detail",
            pendingLibraryPreview: null
          });
        }}
        onOpenAffairsTag={(item) => {
          openAffairsSearchState(item.workspaceId, {
            ...createDefaultAffairsLibraryLandingState(
              item.workspaceId,
              readAffairsViewState(item.workspaceId) ?? createDefaultAffairsViewState(item.workspaceId)
            ),
            workspaceId: item.workspaceId,
            primarySection: "library",
            browseMode: "tag",
            selectedNodeId: `library:tag:${item.tag.path}`,
            selectedFolderPath: null,
            selectedFolderEntryPath: null,
            selectedTagPath: item.tag.path,
            selectedTagPaths: [item.tag.path],
            selectedFavoriteId: null,
            selectedObjectId: null,
            selectedDocumentId: null,
            auxiliaryTab: "detail",
            pendingLibraryPreview: null
          });
        }}
        onOpenAffairsConversation={(item) => {
          const selectedNodeId = item.conversationKind === "agent"
            ? `conversation:agent:session:${item.session.sessionId}`
            : `conversation:lightweight:session:${item.session.sessionId}`;
          openAffairsSearchState(item.workspaceId, {
            ...createDefaultAffairsViewState(item.workspaceId),
            workspaceId: item.workspaceId,
            primarySection: "conversation",
            selectedNodeId,
            selectedObjectId: null,
            selectedDocumentId: null,
            auxiliaryTab: "detail",
            pendingLibraryPreview: null
          });
        }}
        onOpenAffairsTodo={(item) => {
          const selectedNodeId = item.todoKind === "follow_up"
            ? "workbench:todo:follow_up"
            : "workbench:todo:inbox";
          openAffairsSearchState(item.workspaceId, {
            ...createDefaultAffairsViewState(item.workspaceId),
            workspaceId: item.workspaceId,
            primarySection: "workbench",
            selectedNodeId,
            selectedObjectId: item.id,
            selectedDocumentId: null,
            auxiliaryTab: "detail",
            pendingLibraryPreview: null
          });
        }}
      />

      <SidebarModal
        open={worktreeCleanupTarget !== null}
        title={t("shell.worktreeCleanupModalTitle")}
        description={t("shell.worktreeCleanupModalDescription")}
        onClose={() => {
          if (worktreeCleanupTarget && worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.cleaning) {
            return;
          }

          setCleanupDeleteBranch(false);
          setWorktreeCleanupTarget(null);
        }}
      >
        <p className="workbench-section-empty">
          {worktreeCleanupTarget
            ? t("shell.worktreeCleanupConfirm", {
                name: worktreeCleanupTarget.displayName || worktreeCleanupTarget.branchName
              })
            : ""}
        </p>
        {worktreeCleanupTarget ? (
          <div className="worktree-cleanup-modal-options">
            <label className="conversation-selection-checkbox worktree-cleanup-modal-option">
              <input
                type="checkbox"
                checked={cleanupDeleteBranch}
                disabled={
                  Boolean(worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.cleaning)
                  || worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.preview?.alreadyMerged !== true
                }
                onChange={(event) => setCleanupDeleteBranch(event.target.checked)}
              />
              <span>
                {t("shell.worktreeCleanupDeleteBranchLabel", {
                  branch: worktreeCleanupTarget.branchName
                })}
              </span>
            </label>
            {worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.preview?.alreadyMerged !== true ? (
              <p className="conversation-selection-hint worktree-cleanup-modal-hint">
                {t("shell.worktreeCleanupDeleteBranchHint")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(worktreeCleanupTarget && worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.cleaning)}
            onClick={() => {
              setCleanupDeleteBranch(false);
              setWorktreeCleanupTarget(null);
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={
              cleanupDeleteBranch && worktreeCleanupTarget
                ? (
                    worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.preview?.alreadyMerged === true
                      ? "secondary-button workbench-danger-button"
                      : "primary-button"
                  )
                : "primary-button"
            }
            disabled={!worktreeCleanupTarget || Boolean(worktreeCleanupTarget && worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.cleaning)}
            onClick={() => {
              if (!worktreeCleanupTarget) {
                return;
              }

              void applyWorktreeCleanup(worktreeCleanupTarget);
            }}
          >
            {worktreeCleanupTarget && worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.cleaning
              ? t("shell.worktreeCleanupRunning")
              : cleanupDeleteBranch && worktreeCleanupTarget
                && worktreeMergeStateById[worktreeCleanupTarget.workspaceId]?.preview?.alreadyMerged === true
                  ? t("shell.worktreeCleanupDeleteBranchAction")
                  : t("shell.worktreeCleanupAction")}
          </button>
        </div>
      </SidebarModal>

      {isMobileShell ? (
        <>
          {!mobileNavigationDocked ? (
            <MobileNavDrawer isOpen={mobileNavOpen} side="left" onClose={() => setMobileNavOpen(false)}>
              {mobileNavigationPanel}
            </MobileNavDrawer>
          ) : null}

          {!mobileAuxiliaryDocked ? (
            <MobileNavDrawer isOpen={mobileInfoOpen} side="right" onClose={() => setMobileInfoOpen(false)}>
              {mobileAuxiliaryPanel}
            </MobileNavDrawer>
          ) : null}
        </>
      ) : null}
    </WorkbenchShellContext.Provider>
  );
}

export function MobileNavDrawer({
  isOpen,
  side,
  onClose,
  children,
  className,
  overlayClassName
}: {
  isOpen: boolean;
  side: "left" | "right";
  onClose: () => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}) {
  if (!isOpen) {
    return null;
  }

  const content = (
    <>
      <div
        className={["mobile-nav-overlay", "open", overlayClassName].filter(Boolean).join(" ")}
        onClick={onClose}
        role="button"
        tabIndex={0}
        aria-label={t("common.back")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
      />
      <div className={["mobile-nav-drawer", side, "open", className].filter(Boolean).join(" ")}>{children}</div>
    </>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}

export function useWorkbenchShell(): WorkbenchShellContextValue {
  const context = useContext(WorkbenchShellContext);
  return (
    context ?? {
      navigationGroups: [],
      navigationLoading: false,
      navigationError: null,
      shellMode: "desktop",
      currentWorkspaceId: null,
      currentWorkspaceRef: null,
      currentTargetHostId: null,
      currentSessionId: null,
      findCanonicalSessionEntryByScope: () => null,
      findVisibleSessionEntryByScope: () => null,
      resolveNavigationWorkspaceRef: () => null,
      favoriteSessionIds: [],
      favoriteSessions: [],
      globalNotifications: [],
      archivedNotificationIds: [],
      showArchivedNotifications: false,
      unreadNotificationCount: 0,
      refreshNavigation: async () => undefined,
      requestNavigationRefresh: () => undefined,
      openNotificationPanel: () => undefined,
      closeNotificationPanel: () => undefined,
      setShowArchivedNotifications: () => undefined,
      archiveNotification: () => undefined,
      unarchiveNotification: () => undefined,
      setAuxiliaryPanel: () => undefined,
      subscribeFileTree: () => undefined,
      requestFileTreeRefresh: () => undefined,
      addFileTreeSnapshotListener: () => () => undefined,
      subscribeGitSnapshot: () => undefined,
      requestGitRefresh: () => undefined,
      addGitSnapshotListener: () => () => undefined,
      subscribeWorkspaceManagementSnapshot: () => undefined,
      requestWorkspaceManagementRefresh: () => undefined,
      addWorkspaceManagementSnapshotListener: () => () => undefined,
      workspaceManagementStateById: {},
      subscribeTerminalManagerSnapshot: () => undefined,
      requestTerminalManagerRefresh: () => undefined,
      addTerminalManagerSnapshotListener: () => () => undefined,
      selectWorkspace: () => undefined,
      toggleFavoriteSession: async () => undefined,
      archiveSession: async () => undefined,
      unarchiveSession: async () => undefined,
      renameSession: async () => {
        throw new Error("workbench shell unavailable");
      },
      startDraftSession: () => undefined,
      setSessionWorkspace: () => undefined,
      upsertNavigationSession: () => undefined,
      markNavigationSessionSeen: () => undefined,
      revealWorkspaceFile: () => false
    }
  );
}

function normalizeScopeTargetHostId(workspaceRef?: WorkspaceRef | null): string | null {
  if (!workspaceRef) {
    return null;
  }

  return workspaceRef.hostId !== "current" ? workspaceRef.hostId : null;
}

function isDraftSessionId(sessionId: string): boolean {
  return sessionId.startsWith("draft-");
}
