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
  openFilesExternalWindow,
  openGitExternalWindow,
  openProcessesExternalWindow
} from "../../../platform/desktop/window-openers";
import { showDesktopContextMenu } from "../../../platform/desktop/desktop-context-menu";
import { usePlatform } from "../../../platform/platform-provider";
import { useClientConfigSelector } from "../../../config/client-config-store";
import { getActiveHost } from "../../../config/client-config-types";
import { getVisibleDiscoveredHosts } from "../../../config/local-host-discovery-store";
import {
  useLocalUiPreferenceSelector,
  type SessionDisplaySortMode
} from "../../../preferences/local-ui-preference-store";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme/theme";
import { useToast } from "../../../shared/toast";
import { SkillManagementPanel } from "../../../settings/SkillManagementPanel";
import { authStore } from "../../auth/store/auth-store";
import {
  deleteSession,
  cleanupWorktree,
  createWorktree,
  getProviderCapabilities,
  getWorktreeMergePreview,
  getSessionPermissionRequests,
  getWorkbenchSnapshot,
  mergeWorktreeIntoParent,
  reorderWorkspaces,
  removeWorkspace,
  renameSessionTitle,
  updateSessionArchiveState,
  updateSessionFavoriteState,
  updateWorkspaceNavigationState,
  type ProviderId,
  type SessionSummaryDto,
  type WorkbenchSnapshotDto,
  type WorkbenchWorktreeNodeDto,
  type WorktreeMergePreviewDto,
  type WorkspaceManagementSummaryDto,
  type WorktreeMetaDto,
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
  isRealSubagentSession,
  resolveSessionForkBadgeLabel,
  resolveSessionForkBadgeTone
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
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import {
  buildDraftSessionPath,
  buildWorkspaceDebugPath,
  buildWorkspaceHomePath,
  buildWorkspaceDetailPath,
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  buildWorkspaceButlerPath,
  buildWorkspaceTerminalsPath,
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
import { WorkbenchModal as SidebarModal } from "./WorkbenchModal";
import { WorkspaceCloneModal } from "./WorkspaceCloneModal";
import { WorkspaceInboxPanel } from "./WorkspaceInboxModal";
import { WorkspaceImportBrowserModal } from "./WorkspaceImportBrowserModal";
import { WorkbenchUpdateBadge } from "./WorkbenchUpdateBadge";
import { ParallelSessionCreateModal, type ParallelSessionCreateSource } from "./ParallelSessionCreateModal";
import { useArchiveSessionSearch } from "./useArchiveSessionSearch";
import { useTransientScrollbarVisibility } from "./useTransientScrollbarVisibility";

const LEFT_PANEL_WIDTH_KEY = "workbench.left.width";
const RIGHT_PANEL_WIDTH_KEY = "workbench.right.width";
const LEFT_PANEL_COLLAPSED_KEY = "workbench.left.collapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "workbench.right.collapsed";
const LAST_SESSION_PATH_KEY = "workbench.last.session.path";
const SELECTED_WORKSPACE_ID_KEY = "workbench.workspace.selected.id";
const WORKBENCH_NOTIFICATION_SEEN_AT_KEY = "workbench.notifications.seen_at";
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
    "/workspaces/:workspaceId/tools",
    "/workspaces/:workspaceId/tools/files",
    "/workspaces/:workspaceId/tools/git",
    "/workspaces/:workspaceId/tools/processes",
    "/workspaces/:workspaceId/terminals",
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

function resolveFallbackWorkspaceRoute(pathname: string, workspaceId: string): string {
  if (matchPath("/workspaces/:workspaceId/debug", pathname)) {
    return buildWorkspaceDebugPath(workspaceId);
  }

  if (matchPath("/workspaces/:workspaceId", pathname)) {
    return buildWorkspaceDetailPath(workspaceId);
  }

  if (matchPath("/workspaces/:workspaceId/tools/files", pathname) || matchPath("/tools/files", pathname)) {
    return buildWorkspaceToolFilesPath(workspaceId);
  }

  if (matchPath("/workspaces/:workspaceId/tools/git", pathname) || matchPath("/tools/git", pathname)) {
    return buildWorkspaceToolGitPath(workspaceId);
  }

  if (matchPath("/workspaces/:workspaceId/tools/processes", pathname) || matchPath("/tools/processes", pathname)) {
    return buildWorkspaceToolProcessesPath(workspaceId);
  }

  if (matchPath("/workspaces/:workspaceId/tools", pathname) || matchPath("/tools", pathname)) {
    return buildWorkspaceToolsPath(workspaceId);
  }

  if (isTerminalsRoute(pathname)) {
    return buildWorkspaceTerminalsPath(workspaceId);
  }

  if (isButlerRoute(pathname)) {
    return buildWorkspaceButlerPath(workspaceId);
  }

  return buildWorkspaceSessionIndexPath(workspaceId);
}

function normalizeWorkbenchFilePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
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

export type WorkbenchShellMode = "desktop" | "mobile";

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
  currentSessionId: string | null;
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
    options?: { knownRevisionByPath?: Record<string, string | null | undefined> }
  ) => void;
  requestFileTreeRefresh: (
    workspaceId: string,
    paths?: string[],
    options?: { knownRevisionByPath?: Record<string, string | null | undefined> }
  ) => void;
  addFileTreeSnapshotListener: (
    listener: (snapshot: FileTreeRealtimeSnapshotDto) => void
  ) => () => void;
  subscribeGitSnapshot: (
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => void;
  requestGitRefresh: (
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => void;
  addGitSnapshotListener: (listener: (snapshot: GitRealtimeSnapshotDto) => void) => () => void;
  subscribeWorkspaceManagementSnapshot: (
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => void;
  requestWorkspaceManagementRefresh: (
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => void;
  addWorkspaceManagementSnapshotListener: (
    listener: (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void
  ) => () => void;
  workspaceManagementStateById: Record<string, WorkspaceManagementViewState>;
  subscribeTerminalManagerSnapshot: (
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => void;
  requestTerminalManagerRefresh: (
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => void;
  addTerminalManagerSnapshotListener: (
    listener: (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  ) => () => void;
  selectWorkspace: (workspaceId: string) => void;
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
  provider: ProviderId
): Promise<void> {
  const capabilities = await getProviderCapabilities(provider, workspaceId);

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

type CenterTab = "conversation" | "terminals" | "butler";
type InfoTab = "files" | "git" | "terminals";
type SearchMode = "sessions" | "code";

const WorkbenchShellContext = createContext<WorkbenchShellContextValue | null>(null);

function isSubagentSession(session: SessionSummaryDto) {
  return isRealSubagentSession(session);
}

function isArchivedSession(session: SessionSummaryDto) {
  return session.isArchived === true;
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
  sessionDisplaySortMode: SessionDisplaySortMode
): NavigationSessionTreeNode {
  const childNodes = getTreeNodeChildren(node);
  const descendantNodes = flattenSessionTreeNodes(childNodes)
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
  hiddenSessionIdSet: ReadonlySet<string> = new Set()
): WorkspaceSidebarWorktreeNode[] {
  return nodes.map((node) => {
    const scopedSessions = node.sessions.filter((session) => !hiddenSessionIdSet.has(session.sessionId));
    const visibleSessions = filterVisibleWorkspaceSessions(scopedSessions);

    return {
      workspace: node.workspace,
      meta: node.meta,
      visibleSessions,
      archivedSessions: scopedSessions.filter(
        (session) => isArchivedSession(session) && !resolveParentSessionId(session)
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
        hiddenSessionIdSet
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

function buildWorkspaceManagementSummarySnapshotKey(workspaceId: string) {
  return `workspace-management.summary.${workspaceId}`;
}

function buildGitSidebarSnapshotKey(workspaceId: string) {
  return `git-sidebar.snapshot.${workspaceId}`;
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ConversationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
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

function SkillIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M12 4.5 13.6 8l3.9.4-2.9 2.7.8 3.9L12 13.2 8.6 15l.8-3.9-2.9-2.7L10.4 8 12 4.5Z" />
      <path d="m18.5 4.5.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" />
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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

function WorkspaceSearchModal({
  open,
  mode,
  keyword,
  codeWorkspaceId,
  codeResults,
  codeLoading,
  codeError,
  workspaceOptions,
  sessionResults,
  onClose,
  onModeChange,
  onKeywordChange,
  onCodeWorkspaceChange,
  onCodeSearch,
  onOpenSession
}: {
  open: boolean;
  mode: SearchMode;
  keyword: string;
  codeWorkspaceId: string;
  codeResults: FileNodeDto[];
  codeLoading: boolean;
  codeError: string | null;
  workspaceOptions: WorkspaceDto[];
  sessionResults: NavigationSessionEntry[];
  onClose: () => void;
  onModeChange: (mode: SearchMode) => void;
  onKeywordChange: (value: string) => void;
  onCodeWorkspaceChange: (workspaceId: string) => void;
  onCodeSearch: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const canSearchCode = keyword.trim().length > 0 && codeWorkspaceId.trim().length > 0;

  return (
    <SidebarModal
      open={open}
      title={t("shell.searchModalTitle")}
      description={t("shell.searchModalDescription")}
      onClose={onClose}
    >
      <div className="workbench-search-modal">
        <div className="workbench-search-mode-switch" role="tablist" aria-label={t("shell.searchModeLabel")}>
          <button
            type="button"
            className={mode === "sessions" ? "workbench-search-mode-button active" : "workbench-search-mode-button"}
            role="tab"
            aria-selected={mode === "sessions"}
            onClick={() => onModeChange("sessions")}
          >
            {t("shell.searchModeSessions")}
          </button>
          <button
            type="button"
            className={mode === "code" ? "workbench-search-mode-button active" : "workbench-search-mode-button"}
            role="tab"
            aria-selected={mode === "code"}
            onClick={() => onModeChange("code")}
          >
            {t("shell.searchModeCode")}
          </button>
        </div>

        {mode === "sessions" ? (
          <>
            <label className="workbench-modal-field">
              <span>{t("shell.searchKeywordLabel")}</span>
              <input
                type="text"
                value={keyword}
                placeholder={t("shell.searchSessionPlaceholder")}
                autoFocus
                onChange={(event) => onKeywordChange(event.target.value)}
              />
            </label>
            <div className="workbench-search-results">
              {keyword.trim().length === 0 ? (
                <p className="workbench-search-empty">{t("shell.searchSessionHint")}</p>
              ) : sessionResults.length > 0 ? (
                sessionResults.map((item) => {
                  const titlePresentation = buildSessionTitlePresentation(item.session.title, t("common.unknown"));

                  return (
                    <button
                      key={item.session.sessionId}
                      type="button"
                      className="workbench-search-result-item"
                      onClick={() => onOpenSession(item.session.sessionId)}
                    >
                      <span className="workbench-search-result-title" title={titlePresentation.fullTitle}>
                        {titlePresentation.displayTitle}
                      </span>
                      <span className="workbench-search-result-meta">
                        {item.workspace.name} · {formatProviderLabel(item.session.provider, "full")}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="workbench-search-empty">{t("shell.searchSessionEmpty")}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <label className="workbench-modal-field">
              <span>{t("shell.searchWorkspaceLabel")}</span>
              <select
                value={codeWorkspaceId}
                onChange={(event) => onCodeWorkspaceChange(event.target.value)}
              >
                {workspaceOptions.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              className="workbench-search-code-form"
              onSubmit={(event) => {
                event.preventDefault();
                onCodeSearch();
              }}
            >
              <label className="workbench-modal-field">
                <span>{t("shell.searchKeywordLabel")}</span>
                <input
                  type="text"
                  value={keyword}
                  placeholder={t("shell.searchCodePlaceholder")}
                  autoFocus
                  onChange={(event) => onKeywordChange(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="primary-button"
                disabled={!canSearchCode || codeLoading}
              >
                {codeLoading ? t("common.loading") : t("shell.searchSubmit")}
              </button>
            </form>
            <div className="workbench-search-results">
              {codeError ? <p className="status-text" data-tone="error">{codeError}</p> : null}
              {!codeError && keyword.trim().length === 0 ? (
                <p className="workbench-search-empty">{t("shell.searchCodeHint")}</p>
              ) : null}
              {!codeError && keyword.trim().length > 0 && !codeLoading && codeResults.length === 0 ? (
                <p className="workbench-search-empty">{t("shell.searchCodeEmpty")}</p>
              ) : null}
              {codeResults.map((item) => (
                <div key={`${item.path}-${item.kind}`} className="workbench-search-result-item static">
                  <span className="workbench-search-result-title">{item.name}</span>
                  <span className="workbench-search-result-meta">{item.path}</span>
                </div>
              ))}
            </div>
          </>
        )}
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
    ? session.subagentLabel?.trim() || t("shell.subagentBadge")
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
      className="workbench-session-card"
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
  workspaceGroups,
  workspaceVisualContextMap,
  sessionDisplaySortMode,
  favoriteSessions,
  favoriteSessionIds,
  activeWorkspaceId,
  isConversationActive,
  isTerminalActive,
  isButlerActive,
  isSearchOpen,
  navigationLoading,
  navigationError,
  activeSessionId,
  onRefreshNavigation,
  onSessionUpdated,
  onNavigateConversation,
  onNavigateTerminals,
  onNavigateButler,
  onOpenSearch,
  onOpenSettings,
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
  workspaceManagementStateById,
  setWorkspaceManagementStateById,
  unreadNotificationCount,
  notificationPanelOpen,
  onToggleNotificationPanel,
  onClose,
  onToggleCollapse
}: {
  workspaceGroups: WorkspaceSidebarGroup[];
  workspaceVisualContextMap: Record<string, WorkspaceVisualContext>;
  sessionDisplaySortMode: SessionDisplaySortMode;
  favoriteSessions: NavigationSessionEntry[];
  favoriteSessionIds: ReadonlySet<string>;
  activeWorkspaceId: string | null;
  isConversationActive: boolean;
  isTerminalActive: boolean;
  isButlerActive: boolean;
  isSearchOpen: boolean;
  navigationLoading: boolean;
  navigationError: string | null;
  activeSessionId: string | null;
  onRefreshNavigation: () => Promise<void>;
  onSessionUpdated: (session: SessionSummaryDto) => void;
  onNavigateConversation: () => void;
  onNavigateTerminals: () => void;
  onNavigateButler: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string) => void;
  onStartWorkspaceReorder: () => void;
  onPreviewWorkspaceReorder: (
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    position: WorkspaceDropPosition
  ) => void;
  onCommitWorkspaceReorder: () => void;
  allowWorkspaceReorder: boolean;
  subscribeGitSnapshot: (workspaceId: string) => void;
  requestGitRefresh: (workspaceId: string) => void;
  subscribeWorkspaceManagementSnapshot: (workspaceId: string) => void;
  requestWorkspaceManagementRefresh: (workspaceId: string) => void;
  onToggleFavoriteSession: (sessionId: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onUnarchiveSession: (sessionId: string) => Promise<void>;
  workspaceManagementStateById: Record<string, WorkspaceManagementViewState>;
  setWorkspaceManagementStateById: Dispatch<SetStateAction<Record<string, WorkspaceManagementViewState>>>;
  unreadNotificationCount: number;
  notificationPanelOpen: boolean;
  onToggleNotificationPanel: () => void;
  onClose?: () => void;
  onToggleCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const macOsNativeTitlebarDragRegion = resolveMacOsNativeTitlebarDragRegion(platform);
  const { showToast } = useToast();
  const navigationBodyRef = useTransientScrollbarVisibility<HTMLDivElement>();
  const runtimeConfig = useClientConfigSelector((state) => state);
  const activeHostName = getActiveHost(runtimeConfig)?.name ?? "";
  const showHostNameBadge =
    runtimeConfig.hosts.length + getVisibleDiscoveredHosts(runtimeConfig).length > 1
    && activeHostName.length > 0;
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
  const [sessionDeletionTarget, setSessionDeletionTarget] = useState<NavigationSessionEntry | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [batchSessionDeletionTarget, setBatchSessionDeletionTarget] = useState<BatchSessionDeletionTarget | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [openSessionMenuAnchorPoint, setOpenSessionMenuAnchorPoint] = useState<ContextMenuAnchorPoint | null>(null);
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
  const [renameTitleValue, setRenameTitleValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [batchWorkspaceId, setBatchWorkspaceId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchArchiving, setBatchArchiving] = useState(false);
  const [workspaceNavigationSavingById, setWorkspaceNavigationSavingById] = useState<Record<string, boolean>>({});
  const [dragWorkspaceId, setDragWorkspaceId] = useState<string | null>(null);
  const createWorktreeBaseRefPickerRef = useRef<HTMLDivElement | null>(null);
  const createWorktreeBaseRefPopoverRef = useRef<HTMLDivElement | null>(null);
  const exportRenderRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceDragCollapseFrameRef = useRef<number | null>(null);
  const workspaceGroupElementMapRef = useRef(new Map<string, HTMLElement>());
  const workspacePointerGestureRef = useRef<WorkspacePointerReorderGesture | null>(null);
  const workspacePointerGestureCleanupRef = useRef<(() => void) | null>(null);
  const suppressWorkspaceToggleClickRef = useRef<string | null>(null);
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

  const handleWorkspaceCloned = useCallback(
    async (workspace: WorkspaceDto) => {
      await onRefreshNavigation();
      await platform.bridge.showNotification(t("shell.cloneSuccess"), workspace.path);
    },
    [onRefreshNavigation, platform.bridge]
  );

  function handleToggleManagedWorkspace(workspaceId: string) {
    const isExpanded = expandedManagedWorkspaceIds.includes(workspaceId);

    if (isExpanded) {
      setExpandedManagedWorkspaceIds((current) => current.filter((item) => item !== workspaceId));
      return;
    }

    setExpandedManagedWorkspaceIds((current) => [...current, workspaceId]);
    subscribeGitSnapshot(workspaceId);
    requestGitRefresh(workspaceId);
    subscribeWorkspaceManagementSnapshot(workspaceId);
    requestWorkspaceManagementRefresh(workspaceId);
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
          for (const node of flattenSessionTreeNodes(getTreeNodeChildren(rootNode))) {
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

    if (sessionIdsToExpand.length === 0) {
      return;
    }

    setExpandedSubagentRootIds((current) => {
      const currentSet = new Set(current);
      let changed = false;

      for (const sessionId of sessionIdsToExpand) {
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

  function renderWorkspaceActionButtons(workspaceId: string, className = "workbench-workspace-actions") {
    return (
      <div className={className}>
        <button
          type="button"
          className="workbench-workspace-icon-button"
          aria-label={t("shell.switchWorkspace")}
          title={t("shell.switchWorkspace")}
          aria-pressed={activeWorkspaceId === workspaceId}
          onClick={() => {
            onSelectWorkspace(workspaceId);
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
          onClick={() => handleStartBatchSelection(workspaceId)}
        >
          <MultiSelectIcon />
        </button>
        <button
          type="button"
          className="workbench-workspace-icon-button workbench-workspace-create"
          aria-label={t("shell.createSession")}
          title={t("shell.createSession")}
          onClick={() => setCreateSessionWorkspaceId(workspaceId)}
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
            <span>
              <strong>{node.meta.displayName || node.workspace.name}</strong>
              <span className="session-meta">{node.meta.branchName}</span>
            </span>
          </button>

          {batchWorkspaceId === node.workspace.id
            ? renderWorkspaceBatchToolbar()
            : renderWorkspaceActionButtons(node.workspace.id)}
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
    const visibleNode =
      inheritedExpanded
        ? node
        : shouldPaginateSubagentTree
          ? limitVisibleDescendantTree(
              node,
              getVisibleSubagentCount(expansionStateKey),
              sessionDisplaySortMode
            )
          : fullNode;
    const visibleChildren = showSubagentChildren ? getTreeNodeChildren(visibleNode) : [];
    const totalDescendantCount = flattenSessionTreeNodes(childNodes).length;
    const visibleDescendantCount = flattenSessionTreeNodes(visibleChildren).length;
    const hasMoreSubagents = shouldPaginateSubagentTree && visibleDescendantCount < totalDescendantCount;
    const nextAncestorHasNextSiblings =
      node.depth > 0 ? [...ancestorHasNextSiblings, hasNextSibling] : [...ancestorHasNextSiblings];
    const parallelGroupId = session.parallelGroup?.groupId?.trim() || null;
    const directParallelMemberChildren =
      session.parallelGroup?.role === "anchor" && parallelGroupId
        ? visibleChildren.filter((childNode) => childNode.item.parallelGroup?.groupId === parallelGroupId)
        : [];
    const directNonParallelChildren = visibleChildren.filter(
      (childNode) => childNode.item.parallelGroup?.groupId !== parallelGroupId
    );
    const fullParallelMemberChildren =
      session.parallelGroup?.role === "anchor" && parallelGroupId
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
              navigate(buildWorkspaceSessionPath(sessionWorkspace.id, session.sessionId));
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
        {childNodes.length > 0 && showSubagentChildren ? (
          <div className="workbench-subsession-list">
            {renderableChildren.map((childEntry, index) => {
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
                hasNextSibling: index < renderableChildren.length - 1,
                isFirstSibling: index === 0
              });
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
        ) : null}
      </div>
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
      await assertProviderCanStartDraftSession(workspaceId, provider);
      setCreateSessionWorkspaceId(null);
      navigate(buildDraftSessionPath(workspaceId, provider));
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
      const snapshot = await loadSessionExportSnapshot(session.sessionId);
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
      await deleteSession(session.sessionId);
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
          session: await updateSessionArchiveState(sessionId, true)
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
          await deleteSession(sessionId);
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
      const renamedSession = await renameSessionTitle(renameTarget.session.sessionId, nextTitle);
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
              <strong>{workspaceContext.displayName}</strong>
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
                className="secondary-button"
                onClick={() => {
                  setWorkspaceManagerOpen(false);
                  navigate(buildWorkspaceDebugPath(workspace.id));
                }}
              >
                {t("shell.workspaceDetailDebugOpenPageAction")}
              </button>
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
        </div>
      </div>

      <div
        ref={navigationBodyRef}
        className="workbench-nav-body"
        data-scrollbar-autohide="true"
      >
        <div className="workbench-nav-segment">
          <div className="workbench-nav-segment-tabs" role="tablist" aria-label={t("shell.centerTabsLabel")}>
            <div className="workbench-nav-segment-pair">
              <button
                type="button"
                className={
                  isConversationActive
                    ? "workbench-nav-segment-button active"
                    : "workbench-nav-segment-button"
                }
                data-layout="paired"
                role="tab"
                aria-selected={isConversationActive}
                onClick={onNavigateConversation}
              >
                <ConversationIcon />
                <span>{t("shell.conversationEntry")}</span>
              </button>
              <button
                type="button"
                className={
                  isButlerActive
                    ? "workbench-nav-segment-button active"
                    : "workbench-nav-segment-button"
                }
                data-layout="paired"
                role="tab"
                aria-selected={isButlerActive}
                onClick={onNavigateButler}
              >
                <ButlerIcon />
                <span>{t("shell.butlerEntry")}</span>
              </button>
            </div>
            <button
              type="button"
              className={
                isTerminalActive
                  ? "workbench-nav-segment-button active"
                  : "workbench-nav-segment-button"
              }
              role="tab"
              aria-selected={isTerminalActive}
              onClick={onNavigateTerminals}
            >
              <TerminalIcon />
              <span>{t("shell.terminalsEntry")}</span>
            </button>
          </div>
          <SkillManagementPanel
            triggerClassName="workbench-nav-segment-button"
            triggerLabel={t("shell.skillsEntry")}
            triggerLeading={<SkillIcon />}
            workspaceId={activeWorkspaceId}
            sessionId={activeSessionId}
          />
          <button
            type="button"
            className="workbench-nav-segment-button"
            data-open={isSearchOpen}
            aria-haspopup="dialog"
            aria-expanded={isSearchOpen}
            onClick={onOpenSearch}
          >
            <SearchIcon />
            <span>{t("shell.searchEntry")}</span>
          </button>
        </div>

        {navigationError ? (
          <div className="workbench-status-row">
            <p className="status-text" data-tone="error">
              {navigationError}
            </p>
          </div>
        ) : null}

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
                  <strong>{group.workspace.name}</strong>
                </button>

                {batchWorkspaceId === group.workspace.id ? (
                  renderWorkspaceBatchToolbar()
                ) : (
                  renderWorkspaceActionButtons(group.workspace.id)
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
      </div>

      <div className="workbench-nav-footer minimal">
        <div className="workbench-nav-footer-actions">
          <button
            className="settings-entry-button workbench-nav-settings-button"
            type="button"
            onClick={onOpenSettings}
            title={showHostNameBadge ? `${t("settings.title")} · ${activeHostName}` : t("settings.title")}
          >
            <SettingsIcon />
            <span className="settings-entry-label">{t("settings.title")}</span>
            {showHostNameBadge ? (
              <span className="workbench-nav-settings-host-badge" title={activeHostName}>
                {activeHostName}
              </span>
            ) : null}
          </button>
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

      <WorkspaceImportBrowserModal
        open={importBrowserOpen}
        onClose={() => setImportBrowserOpen(false)}
        onImported={handleWorkspaceImported}
      />

      <ParallelSessionCreateModal
        open={parallelCreateSource !== null}
        source={parallelCreateSource}
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
            ? `${t("shell.createSessionTarget")} · ${createSessionWorkspace.name}`
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
            workspaceId={createSessionWorkspace?.id ?? null}
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
                    <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
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
        open={renameTarget !== null}
        title={t("shell.renameModalTitle")}
        description={t("shell.renameModalDescription")}
        onClose={() => {
          if (renamingSessionId) {
            return;
          }

          setRenameTarget(null);
          setRenameTitleValue("");
        }}
      >
        <form className="workbench-rename-form" onSubmit={handleRenameSession}>
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
                setRenameTitleValue("");
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={!renameTitleValue.trim() || renamingSessionId === renameTarget?.session.sessionId}
            >
              {renamingSessionId === renameTarget?.session.sessionId
                ? t("shell.renamingSession")
                : t("common.save")}
            </button>
          </div>
        </form>
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
  navigationGroups: WorkspaceSessionGroup[];
  workspaceContext: WorkspaceVisualContext | null;
  worktreeMeta: WorktreeMetaDto | null;
  worktreeMergeState: WorktreeMergeViewState | null;
  onRefreshWorktreeMergePreview: (workspaceId: string, force?: boolean) => void;
  onApplyWorktreeMerge: (workspaceId: string) => void;
  onCleanupWorktree: (meta: WorktreeMetaDto) => void;
}) {
  const fallbackWorkspaceId = activeWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;
  const normalizedActiveWorkspaceId = activeWorkspaceId?.trim() || null;
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
  const canDetachFilesTab = canDetachTabs && Boolean(activeWorkspaceId);
  const canDetachGitTab = canDetachTabs && Boolean(fallbackWorkspaceId);
  const canDetachTerminalsTab = canDetachTabs && Boolean(fallbackWorkspaceId);
  const supportsPointerDetachGesture =
    typeof globalThis !== "undefined" && "PointerEvent" in globalThis;
  const effectiveFilesWorkspaceId = normalizedActiveWorkspaceId ?? stickyFilesWorkspaceId;
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

    if (knownWorkspaceIdSet.size === 0) {
      return;
    }

    setStickyFilesWorkspaceId((current) =>
      current && knownWorkspaceIdSet.has(current) ? current : null
    );
  }, [knownWorkspaceIdSet, normalizedActiveWorkspaceId]);

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
                externalRevealRequest={effectiveFileRevealRequest}
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
              <LazyGitSidebar workspaceId={fallbackWorkspaceId} />
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
              currentWorkspaceId={activeWorkspaceId}
              navigationGroups={navigationGroups}
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
    readWorkbenchNavigationSnapshot(WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS)
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
  const fileTreeSnapshotListenersRef = useRef(new Set<(snapshot: FileTreeRealtimeSnapshotDto) => void>());
  const gitSnapshotListenersRef = useRef(new Set<(snapshot: GitRealtimeSnapshotDto) => void>());
  const workspaceManagementSnapshotListenersRef = useRef(
    new Set<(snapshot: WorkspaceManagementRealtimeSnapshotDto) => void>()
  );
  const terminalManagerSnapshotListenersRef = useRef(
    new Set<(snapshot: TerminalManagerRealtimeSnapshotDto) => void>()
  );
  const fileTreeSubscriptionRef = useRef<{
    workspaceId: string;
    paths: string[];
    knownRevisionByPath?: Record<string, string | null | undefined>;
  } | null>(null);
  const pendingFileTreeRefreshRef = useRef<{
    workspaceId: string;
    paths?: string[];
    knownRevisionByPath?: Record<string, string | null | undefined>;
  } | null>(null);
  const gitWorkspaceSubscriptionRef = useRef<{
    workspaceId: string;
    knownRevision?: string | null | undefined;
  } | null>(null);
  const pendingGitRefreshWorkspaceIdRef = useRef<{
    workspaceId: string;
    knownRevision?: string | null | undefined;
  } | null>(null);
  const workspaceManagementSubscriptionRef = useRef<{
    workspaceId: string;
    knownRevision?: string | null | undefined;
  } | null>(null);
  const pendingWorkspaceManagementRefreshWorkspaceIdRef = useRef<{
    workspaceId: string;
    knownRevision?: string | null | undefined;
  } | null>(null);
  const terminalManagerWorkspaceSubscriptionRef = useRef<{
    workspaceId: string;
    knownRevision?: string | null | undefined;
  } | null>(null);
  const pendingTerminalManagerRefreshWorkspaceIdRef = useRef<{
    workspaceId: string;
    knownRevision?: string | null | undefined;
  } | null>(null);
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
  const sessionDisplaySortModeRef = useRef<SessionDisplaySortMode>(sessionDisplaySortMode);
  const pendingWorkspaceReorderRef = useRef<{
    originalGroups: WorkspaceSessionGroup[];
  } | null>(null);
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
  const [infoPanelReady, setInfoPanelReady] = useState(false);
  const [activeInfoTab, setActiveInfoTab] = useState<InfoTab>("files");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [customAuxiliaryPanel, setCustomAuxiliaryPanel] = useState<ReactNode | null>(null);
  const [sessionWorkspaceMap, setSessionWorkspaceMap] = useState<Record<string, string>>({});
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("sessions");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchWorkspaceId, setSearchWorkspaceId] = useState("");
  const [codeSearchLoading, setCodeSearchLoading] = useState(false);
  const [codeSearchError, setCodeSearchError] = useState<string | null>(null);
  const [codeSearchResults, setCodeSearchResults] = useState<FileNodeDto[]>([]);
  const [fileRevealRequest, setFileRevealRequest] = useState<WorkbenchFileRevealRequest | null>(null);
  const [workspaceManagementStateById, setWorkspaceManagementStateById] = useState<
    Record<string, WorkspaceManagementViewState>
  >({});
  const useMacOsNativeTitlebarDragRegion = shouldUseMacOsNativeTitlebarDragRegion(platform);
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
      const snapshot = await getWorkbenchSnapshot();

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

  const openSessionFromToast = useCallback(
    (workspaceId: string, sessionId: string) => {
      navigate(buildWorkspaceSessionPath(workspaceId, sessionId));
    },
    [navigate]
  );

  const subscribeFileTree = useCallback((
    workspaceId: string,
    paths: string[],
    options?: { knownRevisionByPath?: Record<string, string | null | undefined> }
  ) => {
    fileTreeSubscriptionRef.current = {
      workspaceId,
      paths,
      knownRevisionByPath: options?.knownRevisionByPath
    };
    workbenchRealtimeClientRef.current?.subscribeFileTree(workspaceId, paths, options);
  }, []);

  const requestFileTreeRefresh = useCallback((
    workspaceId: string,
    paths?: string[],
    options?: { knownRevisionByPath?: Record<string, string | null | undefined> }
  ) => {
    pendingFileTreeRefreshRef.current = {
      workspaceId,
      paths,
      knownRevisionByPath: options?.knownRevisionByPath
    };
    workbenchRealtimeClientRef.current?.requestFileTreeRefresh(workspaceId, paths, options);
  }, []);

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
    options?: { knownRevision?: string | null | undefined }
  ) => {
    gitWorkspaceSubscriptionRef.current = {
      workspaceId,
      knownRevision: options?.knownRevision
    };
    workbenchRealtimeClientRef.current?.subscribeGit(workspaceId, options);
  }, []);

  const requestGitRefresh = useCallback((
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => {
    pendingGitRefreshWorkspaceIdRef.current = {
      workspaceId,
      knownRevision: options?.knownRevision
    };
    workbenchRealtimeClientRef.current?.requestGitRefresh(workspaceId, options);
  }, []);

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
    options?: { knownRevision?: string | null | undefined }
  ) => {
    workspaceManagementSubscriptionRef.current = {
      workspaceId,
      knownRevision: options?.knownRevision
    };
    workbenchRealtimeClientRef.current?.subscribeWorkspaceManagement(workspaceId, options);
  }, []);

  const requestWorkspaceManagementRefresh = useCallback((
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => {
    pendingWorkspaceManagementRefreshWorkspaceIdRef.current = {
      workspaceId,
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
    workbenchRealtimeClientRef.current?.requestWorkspaceManagementRefresh(workspaceId, options);
  }, []);

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
    options?: { knownRevision?: string | null | undefined }
  ) => {
    terminalManagerWorkspaceSubscriptionRef.current = {
      workspaceId,
      knownRevision: options?.knownRevision
    };
    workbenchRealtimeClientRef.current?.subscribeTerminalManager(workspaceId, options);
  }, []);

  const requestTerminalManagerRefresh = useCallback((
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ) => {
    pendingTerminalManagerRefreshWorkspaceIdRef.current = {
      workspaceId,
      knownRevision: options?.knownRevision
    };
    workbenchRealtimeClientRef.current?.requestTerminalManagerRefresh(workspaceId, options);
  }, []);

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

  const commitNavigationArchiveState = useCallback(
    async (sessionId: string, isArchived: boolean) => {
      pendingArchiveStateBySessionIdRef.current.set(sessionId, isArchived);
      setNavigationGroups((current) =>
        updateSessionArchivedStateInGroups(current, sessionId, isArchived)
      );

      try {
        const session = await updateSessionArchiveState(sessionId, isArchived);
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
      onFileTreeSnapshot: (snapshot) => {
        fileTreeSnapshotListenersRef.current.forEach((listener) => listener(snapshot));
      },
      onGitSnapshot: (snapshot) => {
        writeViewSnapshot(buildGitSidebarSnapshotKey(snapshot.workspaceId), {
          revision: snapshot.revision ?? null,
          status: snapshot.status,
          history: snapshot.history,
          historyTotalCount: snapshot.historyTotalCount,
          historyNextCursor: snapshot.historyNextCursor,
          branches: snapshot.branches
        });
        setWorkspaceManagementStateById((current) => {
          const workspace =
            navigationGroups.find((group) => group.workspace.id === snapshot.workspaceId)?.workspace ?? null;

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
        gitSnapshotListenersRef.current.forEach((listener) => listener(snapshot));
      },
      onWorkspaceManagementSnapshot: (snapshot) => {
        writeViewSnapshot(buildWorkspaceManagementSummarySnapshotKey(snapshot.workspaceId), snapshot);
        setWorkspaceManagementStateById((current) => ({
          ...current,
          [snapshot.workspaceId]: {
            detail: snapshot,
            loading: false,
            error: null
          }
        }));
        workspaceManagementSnapshotListenersRef.current.forEach((listener) => listener(snapshot));
      },
      onTerminalManagerSnapshot: (snapshot) => {
        terminalManagerSnapshotListenersRef.current.forEach((listener) => listener(snapshot));
      },
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

    if (fileTreeSubscription) {
      client.subscribeFileTree(fileTreeSubscription.workspaceId, fileTreeSubscription.paths, {
        knownRevisionByPath: fileTreeSubscription.knownRevisionByPath
      });
    }

    if (gitWorkspaceSubscription) {
      client.subscribeGit(gitWorkspaceSubscription.workspaceId, {
        knownRevision: gitWorkspaceSubscription.knownRevision
      });
    }

    if (workspaceManagementSubscription) {
      client.subscribeWorkspaceManagement(workspaceManagementSubscription.workspaceId, {
        knownRevision: workspaceManagementSubscription.knownRevision
      });
    }

    if (terminalManagerWorkspaceSubscription) {
      client.subscribeTerminalManager(terminalManagerWorkspaceSubscription.workspaceId, {
        knownRevision: terminalManagerWorkspaceSubscription.knownRevision
      });
    }

    if (pendingFileTreeRefresh) {
      client.requestFileTreeRefresh(
        pendingFileTreeRefresh.workspaceId,
        pendingFileTreeRefresh.paths,
        {
          knownRevisionByPath: pendingFileTreeRefresh.knownRevisionByPath
        }
      );
    }

    if (pendingGitRefreshWorkspaceId) {
      client.requestGitRefresh(pendingGitRefreshWorkspaceId.workspaceId, {
        knownRevision: pendingGitRefreshWorkspaceId.knownRevision
      });
    }

    if (pendingWorkspaceManagementRefreshWorkspaceId) {
      client.requestWorkspaceManagementRefresh(
        pendingWorkspaceManagementRefreshWorkspaceId.workspaceId,
        {
          knownRevision: pendingWorkspaceManagementRefreshWorkspaceId.knownRevision
        }
      );
    }

    if (pendingTerminalManagerRefreshWorkspaceId) {
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
    };
  }, [navigate]);

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
  const flattenedSessions = useMemo(
    () => flattenNavigationSessions(navigationGroups),
    [navigationGroups]
  );
  const fullNavigationTree = useMemo(
    () => buildNavigationSessionTreeFromEntries(flattenedSessions, sessionDisplaySortMode),
    [flattenedSessions, sessionDisplaySortMode]
  );
  const knownWorkspaceIds = useMemo(
    () => collectKnownWorkspaceIds(navigationGroups),
    [navigationGroups]
  );
  const collapsedWorkspaceIdSet = useMemo(() => new Set(collapsedWorkspaceIds), [collapsedWorkspaceIds]);
  const favoriteSessionIds = useMemo(
    () =>
      flattenedSessions
        .filter((item) => item.session.isFavorite === true)
        .map((item) => item.session.sessionId),
    [flattenedSessions]
  );
  const favoriteSessionIdSet = useMemo(() => new Set(favoriteSessionIds), [favoriteSessionIds]);

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

    flattenedSessions.forEach(({ session }) => {
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

    flattenedSessions.forEach(({ session }) => {
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
    flattenedSessions,
    notifyOnSessionCompleted,
    notifyOnSessionFailed,
    openSessionFromToast
  ]);

  useEffect(() => {
    permissionWatchSessionsRef.current = flattenedSessions
      .map((item) => item.session)
      .filter((session) => session.sessionId !== currentSessionId && isPermissionWatchSession(session))
      .map((session) => ({
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        title: session.title?.trim() || t("common.unknown")
      }));
  }, [currentSessionId, flattenedSessions]);

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

            showToastRef.current({
              id: `workbench-permission-request-${request.id}`,
              title: t("conversation.permissionRequestToastTitle"),
              description,
              tone: "warning",
              durationMs: 8_000,
              action: {
                label: t("shell.contextOpenSession"),
                onClick: () => openSessionFromToast(result.session.workspaceId, result.session.sessionId)
              }
            });
            void platformBridgeRef.current.showNotification(
              t("conversation.permissionRequestToastTitle"),
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
    setSelectedWorkspaceId((current) => (current && knownWorkspaceIds.has(current) ? current : null));
  }, [knownWorkspaceIds, navigationLoading]);

  const currentSessionContext =
    flattenedSessions.find((item) => item.session.sessionId === currentSessionId) ?? null;
  const sessionWorkspaceId =
    currentSessionContext?.workspace.id ??
    (currentSessionId ? sessionWorkspaceMap[currentSessionId] ?? null : null);
  const routeWorkspaceId = resolveRouteWorkspaceId(location.pathname, location.search);
  const validatedRouteWorkspaceId =
    routeWorkspaceId && knownWorkspaceIds.has(routeWorkspaceId) ? routeWorkspaceId : null;
  const validatedSelectedWorkspaceId =
    selectedWorkspaceId && knownWorkspaceIds.has(selectedWorkspaceId) ? selectedWorkspaceId : null;
  const explicitWorkspaceId =
    sessionWorkspaceId ?? validatedRouteWorkspaceId ?? validatedSelectedWorkspaceId ?? null;
  const currentWorkspaceId =
    explicitWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;
  const findFallbackSessionEntry = useCallback((preferredWorkspaceId?: string | null): WorkbenchNavigationEntry | null => {
    if (preferredWorkspaceId) {
      const preferredEntry =
        flattenedSessions.find((item) => item.workspace.id === preferredWorkspaceId) ?? null;

      if (preferredEntry) {
        return preferredEntry;
      }
    }

    return flattenedSessions[0] ?? null;
  }, [flattenedSessions]);
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
    const storedSessionEntry =
      flattenedSessions.find((item) => item.session.sessionId === storedSessionId) ?? null;
    const storedSessionWorkspaceId =
      storedSessionMatch.workspaceId ?? storedSessionEntry?.workspace.id ?? null;

    if (
      storedSessionEntry &&
      (!preferredWorkspaceId || storedSessionWorkspaceId === preferredWorkspaceId)
    ) {
      return buildWorkspaceSessionPath(storedSessionEntry.workspace.id, storedSessionEntry.session.sessionId);
    }

    window.localStorage.removeItem(LAST_SESSION_PATH_KEY);
    return null;
  }, [flattenedSessions]);
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
      ? buildWorkspaceSessionPath(
          fallbackSessionEntry.workspace.id,
          fallbackSessionEntry.session.sessionId
        )
      : null;

    if (routeWorkspaceId && !validatedRouteWorkspaceId) {
      navigate(
        storedSessionPath
          ?? fallbackSessionPath
          ?? (fallbackWorkspaceId
            ? resolveFallbackWorkspaceRoute(location.pathname, fallbackWorkspaceId)
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
            ? buildWorkspaceSessionIndexPath(fallbackWorkspaceId)
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
  }, [
    currentSessionContext,
    currentSessionId,
    currentWorkspaceId,
    routeWorkspaceId,
    selectedWorkspaceId,
    sessionWorkspaceId
  ]);

  const activeCenterTab: CenterTab = isTerminalsRoute(location.pathname)
    ? "terminals"
    : isButlerRoute(location.pathname)
      ? "butler"
      : "conversation";
  const isMobileShell = shellMode === "mobile";
  const workbenchHomePath = resolveWorkbenchHomePath(shellMode);

  const workspaceSidebarGroups = useMemo(
    () =>
      navigationGroups.map((group) => {
        const visibleSessions = filterVisibleWorkspaceSessions(group.sessions);
        const projectedSessionIds = new Set(group.sessions.map((session) => session.sessionId));

        return {
          workspace: group.workspace,
          visibleSessions,
          archivedSessions: group.sessions.filter(
            (session) => isArchivedSession(session) && !resolveParentSessionId(session)
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
            projectedSessionIds
          ),
          isCollapsed: collapsedWorkspaceIdSet.has(group.workspace.id)
        };
      }),
    [collapsedWorkspaceIdSet, favoriteSessionIdSet, navigationGroups, sessionDisplaySortMode]
  );
  const workspaceVisualContextMap = useMemo(
    () => buildWorkspaceVisualContextMap(navigationGroups),
    [navigationGroups]
  );
  const currentWorktreeNode = useMemo(
    () => findNavigationWorktreeNodeByWorkspaceId(navigationGroups, currentWorkspaceId),
    [currentWorkspaceId, navigationGroups]
  );
  const currentToolWorkspaceId =
    currentSessionContext
      ? resolveSessionToolWorkspaceId(
        currentSessionContext.session,
        currentSessionContext.session.sessionIsolatedWorkspace
      )
      : currentWorkspaceId;
  const currentAuxiliaryWorkspaceId = currentToolWorkspaceId ?? currentWorkspaceId;
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
    () =>
      flattenedSessions.filter(
        (item) =>
          favoriteSessionIdSet.has(item.session.sessionId) &&
          !isArchivedSession(item.session) &&
          !isSubagentSession(item.session)
      ),
    [favoriteSessionIdSet, flattenedSessions]
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
    () => navigationGroups.map((group) => group.workspace),
    [navigationGroups]
  );
  const sessionSearchResults = useMemo(() => {
    const normalizedKeyword = searchKeyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return [] as NavigationSessionEntry[];
    }

    return flattenedSessions.filter((item) => {
      const sessionTitle = (item.session.title || "").toLowerCase();
      const workspaceName = item.workspace.name.toLowerCase();
      const providerName = formatProviderLabel(item.session.provider, "full").toLowerCase();

      return (
        sessionTitle.includes(normalizedKeyword) ||
        workspaceName.includes(normalizedKeyword) ||
        providerName.includes(normalizedKeyword)
      );
    });
  }, [flattenedSessions, searchKeyword]);

  useEffect(() => {
    const fallbackWorkspaceId = currentWorkspaceId ?? navigationGroups[0]?.workspace.id ?? "";

    if (!fallbackWorkspaceId) {
      return;
    }

    setSearchWorkspaceId((current) => {
      if (!current) {
        return fallbackWorkspaceId;
      }

      const exists = navigationGroups.some((group) => group.workspace.id === current);
      return exists ? current : fallbackWorkspaceId;
    });
  }, [currentWorkspaceId, navigationGroups]);

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

  function handleSelectWorkspace(workspaceId: string) {
    setSelectedWorkspaceId(workspaceId);
    ensureInfoPanelReady();

    if (isTerminalsRoute(location.pathname)) {
      const targetPath = buildWorkspaceTerminalsPath(workspaceId);

      if (location.pathname !== targetPath) {
        navigate(targetPath);
      }
      return;
    }

    // 会话上下文和工作区上下文不能混着用；切到别的工作区时先退回空白工作台。
    if (currentSessionId && sessionWorkspaceId !== workspaceId) {
      navigate(workbenchHomePath);
    }
  }

  const toggleFavoriteSession = useCallback(
    async (sessionId: string) => {
      const currentSession = flattenedSessions.find((item) => item.session.sessionId === sessionId)?.session ?? null;
      const nextFavorite = currentSession?.isFavorite !== true;

      setNavigationGroups((current) =>
        updateSessionFavoriteStateInGroups(current, sessionId, nextFavorite)
      );

      try {
        const session = await updateSessionFavoriteState(sessionId, nextFavorite);
        upsertNavigationSession(session);
        requestNavigationRefresh();
      } catch (error) {
        setNavigationGroups((current) =>
          updateSessionFavoriteStateInGroups(current, sessionId, !nextFavorite)
        );
        throw error;
      }
    },
    [flattenedSessions, requestNavigationRefresh, upsertNavigationSession]
  );

  const startDraftSession = useCallback(
    (workspaceId: string, provider: ProviderId) => {
      void assertProviderCanStartDraftSession(workspaceId, provider)
        .then(() => {
          navigate(buildDraftSessionPath(workspaceId, provider));
        })
        .catch((error) => {
          showToast({
            title: error instanceof Error ? error.message : t("shell.startSessionFailed"),
            tone: "error"
          });
        });
    },
    [navigate, showToast]
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
      const renamedSession = await renameSessionTitle(sessionId, title.trim());
      upsertNavigationSession(renamedSession);
      return renamedSession;
    },
    [upsertNavigationSession]
  );

  function openSearchModal(nextMode?: SearchMode) {
    if (nextMode) {
      setSearchMode(nextMode);
    }

    setSearchModalOpen(true);
  }

  function closeSearchModal() {
    setSearchModalOpen(false);
    setSearchMode("sessions");
    setSearchKeyword("");
    setCodeSearchError(null);
    setCodeSearchResults([]);
    setCodeSearchLoading(false);
  }

  async function handleCodeSearch() {
    const keyword = searchKeyword.trim();

    if (!keyword || !searchWorkspaceId.trim()) {
      setCodeSearchResults([]);
      setCodeSearchError(null);
      return;
    }

    setCodeSearchLoading(true);
    setCodeSearchError(null);

    try {
      const response = await searchFiles(searchWorkspaceId, keyword);
      setCodeSearchResults(response.items);
    } catch (error) {
      setCodeSearchResults([]);
      setCodeSearchError(error instanceof Error ? error.message : t("shell.searchCodeFailed"));
    } finally {
      setCodeSearchLoading(false);
    }
  }

  function applyWorkbenchShellPanelWidths(nextLeftWidth: number, nextRightWidth: number) {
    const shellElement = workbenchShellRef.current;

    if (!shellElement) {
      return;
    }

    shellElement.style.setProperty("--workbench-left-width", `${nextLeftWidth}px`);
    shellElement.style.setProperty(
      "--workbench-left-current-width",
      leftCollapsed ? "0px" : `${nextLeftWidth}px`
    );
    shellElement.style.setProperty("--workbench-right-width", `${nextRightWidth}px`);
    shellElement.style.setProperty(
      "--workbench-right-current-width",
      rightCollapsed ? "0px" : `${nextRightWidth}px`
    );
  }

  function buildNativeSidebarLayoutSnapshot(
    overrides: Partial<NativeSidebarLayout> = {}
  ): NativeSidebarLayout {
    return {
      leftWidth: overrides.leftWidth ?? (leftCollapsed ? 0 : leftPanelWidthRef.current),
      rightWidth:
        overrides.rightWidth
        ?? (shouldShowAuxiliaryPanel && !rightCollapsed ? rightPanelWidthRef.current : 0),
      leftCollapsed: overrides.leftCollapsed ?? leftCollapsed,
      rightCollapsed: overrides.rightCollapsed ?? (!shouldShowAuxiliaryPanel || rightCollapsed),
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
    if (navigateToRememberedConversation()) {
      return;
    }

    // 桌面端保留老行为：没有明确上下文时直接落到最近一条会话。
    if (flattenedSessions.length === 0) {
      navigate(workbenchHomePath);
      return;
    }

    const fallbackSessionPath = buildWorkspaceSessionPath(
      flattenedSessions[0].workspace.id,
      flattenedSessions[0].session.sessionId
    );
    navigate(fallbackSessionPath);
  }

  function goToMobileSessionsEntry() {
    if (navigateToRememberedConversation(currentWorkspaceId)) {
      return;
    }

    // 工作区已经变化时，回到当前工作区的会话列表，而不是跳回旧会话。
    if (currentWorkspaceId) {
      navigate(buildWorkspaceSessionIndexPath(currentWorkspaceId));
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
        navigate(
          currentWorkspaceId
            ? buildWorkspaceTerminalsPath(currentWorkspaceId)
            : buildWorkspaceHomePath()
        );
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
  }, [navigate, refreshNavigation, isMobileShell, goToConversationTab]);

  const contextValue = useMemo<WorkbenchShellContextValue>(
    () => ({
      shellMode,
      navigationGroups,
      navigationLoading,
      navigationError,
      currentWorkspaceId,
      currentSessionId,
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
      currentWorkspaceId,
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

  const shellStyle = {
    "--workbench-left-width": `${leftPanelWidth}px`,
    "--workbench-left-current-width": leftCollapsed ? "0px" : `${leftPanelWidth}px`,
    "--workbench-right-width": `${rightPanelWidth}px`,
    "--workbench-right-current-width":
      rightCollapsed || isParallelConversationActive ? "0px" : `${rightPanelWidth}px`,
    "--workbench-right-sidebar-duration":
      parallelConversationTransition && !rightCollapsed
        ? `${parallelConversationTransition.sidebarCollapseDurationMs}ms`
        : undefined,
    "--workbench-right-sidebar-content-duration":
      parallelConversationTransition && !rightCollapsed
        ? `${Math.max(320, parallelConversationTransition.sidebarCollapseDurationMs - 120)}ms`
        : undefined
  } as CSSProperties;
  const auxiliaryPanelContent = activeCenterTab === "butler"
    ? customAuxiliaryPanel
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
        navigationGroups={navigationGroups}
        workspaceContext={currentAuxiliaryWorkspaceContext}
        worktreeMeta={currentWorktreeMeta}
        worktreeMergeState={currentWorktreeMergeState}
        onRefreshWorktreeMergePreview={loadWorktreeMergePreview}
        onApplyWorktreeMerge={applyWorktreeMerge}
        onCleanupWorktree={applyWorktreeCleanup}
      />
    );
  const shouldShowAuxiliaryPanel = auxiliaryPanelContent !== null;
  const effectiveRightCollapsed = rightCollapsed || isParallelConversationActive;
  const shouldKeepParallelAuxiliaryMounted =
    isParallelConversationActive
    && parallelConversationTransition !== null
    && !rightCollapsed;
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
      leftWidth: leftCollapsed ? 0 : leftPanelWidth,
      rightWidth: shouldShowAuxiliaryPanel && !effectiveRightCollapsed ? rightPanelWidth : 0,
      leftCollapsed,
      rightCollapsed: !shouldShowAuxiliaryPanel || effectiveRightCollapsed,
      prefersDarkAppearance: theme !== "light",
      isResizing: activeResizeSide !== null
    }),
    [
      activeResizeSide,
      effectiveRightCollapsed,
      leftCollapsed,
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
      workspaceGroups={workspaceSidebarGroups}
      workspaceVisualContextMap={workspaceVisualContextMap}
      sessionDisplaySortMode={sessionDisplaySortMode}
      favoriteSessions={favoriteSessions}
      favoriteSessionIds={favoriteSessionIdSet}
      activeWorkspaceId={currentWorkspaceId}
      isConversationActive={activeCenterTab === "conversation"}
      isTerminalActive={activeCenterTab === "terminals"}
      isButlerActive={activeCenterTab === "butler"}
      isSearchOpen={searchModalOpen}
      navigationLoading={navigationLoading}
      navigationError={navigationError}
      activeSessionId={currentSessionId}
      onRefreshNavigation={refreshNavigation}
      onSessionUpdated={upsertNavigationSession}
      onNavigateConversation={goToConversationTab}
      onNavigateTerminals={() => {
        setMobileNavOpen(false);
        navigate(
          currentWorkspaceId
            ? buildWorkspaceTerminalsPath(currentWorkspaceId)
            : buildWorkspaceHomePath()
        );
      }}
      onNavigateButler={() => {
        setMobileNavOpen(false);
        navigate(
          currentWorkspaceId
            ? buildWorkspaceButlerPath(currentWorkspaceId)
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
      workspaceManagementStateById={workspaceManagementStateById}
      setWorkspaceManagementStateById={setWorkspaceManagementStateById}
      unreadNotificationCount={unreadNotificationCount}
      notificationPanelOpen={notificationPanelOpen}
      onToggleNotificationPanel={() => {
        setNotificationPanelOpen((current) => !current);
      }}
      onClose={() => setMobileNavOpen(false)}
    />
  ) : null;
  const mobileAuxiliaryPanel = isMobileShell && shouldShowAuxiliaryPanel ? auxiliaryPanelContent : null;

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
                  ? buildWorkspaceTerminalsPath(currentWorkspaceId)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateButler={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceButlerPath(currentWorkspaceId)
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
                  ? buildWorkspaceToolFilesPath(currentWorkspaceId)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateToolGit={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceToolGitPath(currentWorkspaceId)
                  : buildWorkspaceHomePath()
              );
            }}
            onNavigateToolProcesses={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceToolProcessesPath(currentWorkspaceId)
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
          data-left-collapsed={leftCollapsed}
          data-right-collapsed={effectiveRightCollapsed}
          data-info-ready={infoPanelReady}
          data-parallel-conversation-active={isParallelConversationActive ? "true" : undefined}
          data-parallel-sidebar-transition={shouldKeepParallelAuxiliaryMounted ? "true" : undefined}
          data-runtime-platform={platform.platform}
          data-os-family={platform.ui.osFamily}
          data-overlay-titlebar={platform.ui.prefersOverlayTitlebar}
        >
          <div className="workbench-body-shell">
            <aside className="workbench-nav surface-card" data-collapsed={leftCollapsed}>
                <SidebarContent
                  workspaceGroups={workspaceSidebarGroups}
                  workspaceVisualContextMap={workspaceVisualContextMap}
                  sessionDisplaySortMode={sessionDisplaySortMode}
                  favoriteSessions={favoriteSessions}
                favoriteSessionIds={favoriteSessionIdSet}
                activeWorkspaceId={currentWorkspaceId}
                isConversationActive={activeCenterTab === "conversation"}
                isTerminalActive={activeCenterTab === "terminals"}
                isButlerActive={activeCenterTab === "butler"}
                isSearchOpen={searchModalOpen}
                navigationLoading={navigationLoading}
                navigationError={navigationError}
                activeSessionId={currentSessionId}
                onRefreshNavigation={refreshNavigation}
                onSessionUpdated={upsertNavigationSession}
                onNavigateConversation={goToConversationTab}
                onNavigateTerminals={() =>
                  navigate(
                    currentWorkspaceId
                      ? buildWorkspaceTerminalsPath(currentWorkspaceId)
                      : buildWorkspaceHomePath()
                  )
                }
                onNavigateButler={() =>
                  navigate(
                    currentWorkspaceId
                      ? buildWorkspaceButlerPath(currentWorkspaceId)
                      : buildWorkspaceHomePath()
                  )
                }
                onOpenSearch={() => openSearchModal()}
                onOpenSettings={() => navigate("/settings")}
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
                workspaceManagementStateById={workspaceManagementStateById}
                setWorkspaceManagementStateById={setWorkspaceManagementStateById}
                unreadNotificationCount={unreadNotificationCount}
                notificationPanelOpen={notificationPanelOpen}
                onToggleNotificationPanel={() => {
                  setNotificationPanelOpen((current) => !current);
                }}
                onToggleCollapse={() => setLeftCollapsed(true)}
              />
            </aside>
            <div
              className="workbench-side-resizer"
              data-side="left"
              data-collapsed={leftCollapsed}
              role="separator"
              aria-label={t("shell.leftResizerLabel")}
              onMouseDown={
                leftCollapsed
                  ? undefined
                  : (event) => beginResize("left", event)
              }
            />

            <div className="workbench-main-shell">
              <div className="workbench-collapsed-rail" aria-hidden={!leftCollapsed && !rightCollapsed}>
                <div
                  className="workbench-collapsed-controls left"
                  data-visible={leftCollapsed}
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
                </div>

                {shouldShowAuxiliaryPanel && !isParallelConversationActive ? (
                  <div
                    className="workbench-collapsed-controls right"
                    data-visible={rightCollapsed}
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

              <Outlet />
            </div>

            {shouldShowAuxiliaryPanel ? (
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
                  {isParallelConversationActive && !shouldKeepParallelAuxiliaryMounted ? null : activeCenterTab === "butler" ? (
                    <div className="workbench-auxiliary-custom-panel">
                      {customAuxiliaryPanel}
                    </div>
                  ) : (
                    <WorkbenchInfoPanel
                      panelReady={infoPanelReady}
                      activeTab={activeInfoTab}
                      fileRevealRequest={fileRevealRequest}
                      onTabChange={(tab) => {
                        ensureInfoPanelReady();
                        setActiveInfoTab(tab);
                      }}
                      onToggleCollapse={() => setRightCollapsed(true)}
                      currentSessionId={isDraftSession ? null : currentSessionId}
                      activeWorkspaceId={currentAuxiliaryWorkspaceId}
                      navigationGroups={navigationGroups}
                      workspaceContext={currentAuxiliaryWorkspaceContext}
                      worktreeMeta={currentWorktreeMeta}
                      worktreeMergeState={currentWorktreeMergeState}
                      onRefreshWorktreeMergePreview={loadWorktreeMergePreview}
                      onApplyWorktreeMerge={applyWorktreeMerge}
                      onCleanupWorktree={requestWorktreeCleanup}
                    />
                  )}
                </aside>
              </>
            ) : null}
          </div>
        </div>
      )}

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
        mode={searchMode}
        keyword={searchKeyword}
        codeWorkspaceId={searchWorkspaceId}
        codeResults={codeSearchResults}
        codeLoading={codeSearchLoading}
        codeError={codeSearchError}
        workspaceOptions={availableSearchWorkspaces}
        sessionResults={sessionSearchResults}
        onClose={closeSearchModal}
        onModeChange={(mode) => {
          setSearchMode(mode);
          setCodeSearchError(null);
          setCodeSearchResults([]);
        }}
        onKeywordChange={(value) => {
          setSearchKeyword(value);
          if (searchMode === "code" && !value.trim()) {
            setCodeSearchResults([]);
            setCodeSearchError(null);
          }
        }}
        onCodeWorkspaceChange={(workspaceId) => setSearchWorkspaceId(workspaceId)}
        onCodeSearch={() => {
          void handleCodeSearch();
        }}
        onOpenSession={(sessionId) => {
          closeSearchModal();
          const entry = flattenedSessions.find((item) => item.session.sessionId === sessionId) ?? null;
          navigate(entry ? buildWorkspaceSessionPath(entry.workspace.id, sessionId) : buildWorkspaceHomePath());
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
      currentSessionId: null,
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

function isDraftSessionId(sessionId: string): boolean {
  return sessionId.startsWith("draft-");
}
