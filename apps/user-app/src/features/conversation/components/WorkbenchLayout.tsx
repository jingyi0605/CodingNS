import {
  Suspense,
  useCallback,
  createContext,
  useContext,
  type Dispatch,
  useEffect,
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
import { createPortal } from "react-dom";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";

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
import { showDesktopContextMenu } from "../../../platform/desktop/desktop-context-menu";
import {
  canStartDesktopWindowDragFromTarget,
  startDesktopWindowDrag
} from "../../../platform/desktop/window-drag";
import {
  createDesktopWindowDetachPreview,
  type DesktopWindowDetachPreviewController
} from "../../../platform/desktop/window-detach-animation";
import {
  openFilesExternalWindow,
  openGitExternalWindow,
  openProcessesExternalWindow
} from "../../../platform/desktop/window-openers";
import { usePlatform } from "../../../platform/platform-provider";
import { useLocalUiPreferenceSelector } from "../../../preferences/local-ui-preference-store";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { authStore } from "../../auth/store/auth-store";
import {
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
import { getProviderDisplayName } from "../capability/provider-ui";
import { searchFiles, type FileNodeDto } from "../api/file-context-api";
import {
  hasSessionDisplayError,
  resolveSessionActivityBadgeClassName,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassVariant,
  resolveSessionIndicatorClassName
} from "../session-activity-display";
import {
  isRealSubagentSession,
  resolveSessionForkBadgeLabel,
  resolveSessionForkBadgeTone
} from "../session-fork-display";
import { buildSessionTitlePresentation } from "../session-title";
import {
  buildDraftSessionPath,
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
  buildWorkspaceCompositionChartItems,
  createWorkspaceCompositionChartStyle,
  formatWorkspaceCompositionRatio
} from "../../workbench/utils/workspace-composition-chart";
import {
  buildWorkspaceVisualContextMap,
  createFallbackWorkspaceVisualContext,
  type WorkspaceVisualContext
} from "../../workbench/utils/worktree-visual-context";
import {
  getButlerOverview,
  getButlerProfile,
  listButlerFollowUpTasks,
  listButlerNotificationArchives,
  updateButlerNotificationArchive,
  type ButlerFollowUpTaskDto,
  type ButlerOverviewDto
} from "../../butler/api/butler-api";
import {
  clearSessionProviderPickerCapabilityCache,
  SessionProviderPicker
} from "./SessionProviderPicker";
import { WorkbenchModal as SidebarModal } from "./WorkbenchModal";
import { WorkspaceCloneModal } from "./WorkspaceCloneModal";
import { WorkspaceInboxPanel } from "./WorkspaceInboxModal";
import { WorkspaceImportBrowserModal } from "./WorkspaceImportBrowserModal";

const LEFT_PANEL_WIDTH_KEY = "workbench.left.width";
const RIGHT_PANEL_WIDTH_KEY = "workbench.right.width";
const LEFT_PANEL_COLLAPSED_KEY = "workbench.left.collapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "workbench.right.collapsed";
const LAST_SESSION_PATH_KEY = "workbench.last.session.path";
const SELECTED_WORKSPACE_ID_KEY = "workbench.workspace.selected.id";
const WORKBENCH_NAVIGATION_SNAPSHOT_KEY = "workbench.navigation.snapshot";
const WORKBENCH_NOTIFICATION_SEEN_AT_KEY = "workbench.notifications.seen_at";
const DEFAULT_LEFT_PANEL_WIDTH = 280;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const MIN_PANEL_WIDTH = 208;
const MAX_LEFT_PANEL_WIDTH = 520;
const MAX_RIGHT_PANEL_WIDTH = 560;
const INFO_PANEL_BOOT_DELAY_MS = 200;
const FAVORITE_SESSION_PAGE_SIZE = 20;
const ROOT_SESSION_PAGE_SIZE = 40;
const SUBAGENT_PAGE_SIZE = 5;
const WORKBENCH_NOTIFICATION_POLL_INTERVAL_MS = 30_000;
const WORKBENCH_NOTIFICATION_MAX_ITEMS = 12;
const WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const WORKBENCH_PERMISSION_POLL_INTERVAL_MS = 4_000;
const SESSION_FAILURE_NOTIFICATION_DETAIL_MAX_LENGTH = 220;
const WINDOW_DETACH_DRAG_THRESHOLD_PX = 18;
const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";
const WORKBENCH_RUNTIME_ACTIVE_STATES: ReadonlySet<string> = new Set([
  "starting",
  "running",
  "reconnecting",
  "stale",
  "unknown"
]);

export type WorkbenchGlobalNotificationKind =
  | "follow_up_waiting_user"
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
  followUpTasks: ButlerFollowUpTaskDto[]
): WorkbenchGlobalNotification[] {
  const projectWorkspaceIdByProjectId = new Map(
    overview.projects.map((project) => [project.id, project.workspaceId] as const)
  );
  const notifications: WorkbenchGlobalNotification[] = [];

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
    case "follow_up_completed":
      return 1;
    case "follow_up_failed":
      return 2;
    case "verification_failed":
      return 3;
    default:
      return 9;
  }
}

function resolveWorkbenchNotificationKindLabel(kind: WorkbenchGlobalNotificationKind): string {
  switch (kind) {
    case "follow_up_waiting_user":
      return t("shell.globalNotificationKindWaitingUser");
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

type NavigationSessionTreeNode = SessionTreeNode<SessionSummaryDto>;

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
  subscribeFileTree: (workspaceId: string, paths: string[]) => void;
  requestFileTreeRefresh: (workspaceId: string, paths?: string[]) => void;
  addFileTreeSnapshotListener: (
    listener: (snapshot: FileTreeRealtimeSnapshotDto) => void
  ) => () => void;
  subscribeGitSnapshot: (workspaceId: string) => void;
  requestGitRefresh: (workspaceId: string) => void;
  addGitSnapshotListener: (listener: (snapshot: GitRealtimeSnapshotDto) => void) => () => void;
  subscribeWorkspaceManagementSnapshot: (workspaceId: string) => void;
  requestWorkspaceManagementRefresh: (workspaceId: string) => void;
  addWorkspaceManagementSnapshotListener: (
    listener: (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void
  ) => () => void;
  workspaceManagementStateById: Record<string, WorkspaceManagementViewState>;
  subscribeTerminalManagerSnapshot: (workspaceId: string) => void;
  requestTerminalManagerRefresh: (workspaceId: string) => void;
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

function sortSessions(left: SessionSummaryDto, right: SessionSummaryDto) {
  return (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt);
}

function isSubagentSession(session: SessionSummaryDto) {
  return isRealSubagentSession(session);
}

function isArchivedSession(session: SessionSummaryDto) {
  return session.isArchived === true;
}

function resolveParentSessionId(session: SessionSummaryDto) {
  return session.parentSessionId?.trim() || null;
}

function buildSessionTree(sessions: SessionSummaryDto[]) {
  return buildRecursiveSessionTree(sessions, {
    getId: (session) => session.sessionId,
    getParentId: resolveParentSessionId,
    compare: sortSessions
  });
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
    return !parentSession || !isArchivedSession(parentSession);
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
  visibleCount: number
): NavigationSessionTreeNode {
  const visibleSessionIdSet = new Set(
    flattenSessionTreeNodes(getTreeNodeChildren(node))
      .sort((left, right) => sortSessions(left.item, right.item))
      .slice(0, visibleCount)
      .map((item) => item.item.sessionId)
  );

  return {
    ...node,
    children: filterTreeNodesByVisibleSet(getTreeNodeChildren(node), visibleSessionIdSet)
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

function hasSessionError(session: SessionSummaryDto) {
  return (
    hasSessionDisplayError(session)
    || session.syncStatus === "error"
  );
}

function getSessionErrorSummary(session: SessionSummaryDto) {
  if (!hasSessionError(session)) {
    return null;
  }

  const errorCode = session.lastErrorCode?.trim() ?? "";
  const errorDetail = session.lastErrorDetail?.replace(/\s+/g, " ").trim() ?? "";

  if (errorCode && errorDetail && !errorDetail.includes(errorCode)) {
    return `${errorCode} · ${errorDetail}`;
  }

  if (errorDetail) {
    return errorDetail;
  }

  if (errorCode) {
    return errorCode;
  }

  if (session.syncStatus === "error" && !hasSessionDisplayError(session)) {
    return t("conversation.syncStatusError");
  }

  return t("conversation.runtimeErrorTitle");
}

function truncateSessionErrorSummary(summary: string, maxLength = 110) {
  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function mapWorkbenchSnapshotToGroups(snapshot: WorkbenchSnapshotDto | null | undefined) {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    return [];
  }

  return snapshot.items.map((item) => ({
    workspace: item.workspace,
    sessions: [...item.sessions].sort(sortSessions),
    childWorktrees: mapWorkbenchWorktreeNodes(item.childWorktrees)
  }));
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
  favoriteSessionIdSet: ReadonlySet<string>
): WorkspaceSidebarWorktreeNode[] {
  return nodes.map((node) => {
    const visibleSessions = filterVisibleWorkspaceSessions(node.sessions);

    return {
      workspace: node.workspace,
      meta: node.meta,
      visibleSessions,
      archivedSessions: node.sessions.filter(
        (session) => isArchivedSession(session) && !resolveParentSessionId(session)
      ),
      visibleSessionTree: buildSessionTree(visibleSessions).filter(
        (treeNode) =>
          !favoriteSessionIdSet.has(treeNode.item.sessionId)
          && !someSessionTreeNode(
            getTreeNodeChildren(treeNode),
            (session) => favoriteSessionIdSet.has(session.sessionId)
          )
      ),
      children: buildWorkspaceSidebarWorktreeNodes(node.children, favoriteSessionIdSet)
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

type WorkspaceDropPosition = "before" | "after";

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

function readCachedWorkbenchSnapshot() {
  return readViewSnapshot<WorkbenchSnapshotDto>(
    WORKBENCH_NAVIGATION_SNAPSHOT_KEY,
    WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS
  );
}

function upsertSessionIntoGroups(
  groups: WorkspaceSessionGroup[],
  session: SessionSummaryDto
): WorkspaceSessionGroup[] {
  let changed = false;

  const nextGroups = groups.map((group) => {
    if (group.workspace.id !== session.workspaceId) {
      const { nodes, changed: childChanged } = upsertSessionIntoWorktreeNodes(
        group.childWorktrees,
        session
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
      sessions: [...nextSessions].sort(sortSessions)
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
  nodes: readonly WorkbenchWorktreeNodeDto[] | null | undefined
): WorkbenchWorktreeNodeDto[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.map((node) => ({
    ...node,
    sessions: [...node.sessions].sort(sortSessions),
    children: mapWorkbenchWorktreeNodes(node.children)
  }));
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
  session: SessionSummaryDto
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
        sessions: [...nextSessions].sort(sortSessions)
      };
    }

    const nextChildResult = upsertSessionIntoWorktreeNodes(node.children, session);

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
  const repoRoot = snapshot.status?.snapshot.repoRoot ?? detail.git.repoRoot;
  const currentBranch =
    snapshot.status?.snapshot.branch ?? snapshot.branches?.currentBranch ?? detail.git.currentBranch ?? null;

  return {
    ...detail,
    git: {
      ...detail.git,
      isRepository: detail.git.isRepository || Boolean(repoRoot),
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
                        <div className="workbench-notification-item-header">
                          <span className="workbench-notification-item-kind">
                            {resolveWorkbenchNotificationKindLabel(notification.kind)}
                          </span>
                          <time>{formatWorkbenchNotificationTime(notification.createdAt)}</time>
                        </div>
                        <strong>{notification.title}</strong>
                        <p>{notification.body}</p>
                      </button>
                      <div className="workbench-notification-item-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={(event) => {
                            event.stopPropagation();

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

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
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

function StarIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12 3 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
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

function SessionCard({
  menuKey,
  session,
  workspace,
  workspaceContext,
  isActive,
  isFavorite,
  menuOpen,
  showWorkspaceName,
  depth = 0,
  showActions = true,
  hasSubagents = false,
  subagentListExpanded = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onToggleSubagents,
  onOpen,
  onRename,
  onToggleMenu,
  onToggleFavorite,
  onArchive,
  onCloseMenu,
  onContextMenu
}: {
  menuKey: string;
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
  workspaceContext: WorkspaceVisualContext;
  isActive: boolean;
  isFavorite: boolean;
  menuOpen: boolean;
  showWorkspaceName: boolean;
  depth?: number;
  showActions?: boolean;
  hasSubagents?: boolean;
  subagentListExpanded?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onToggleSubagents?: () => void;
  onOpen: () => void;
  onRename: () => void;
  onToggleMenu: () => void;
  onToggleFavorite: () => void;
  onArchive: () => void;
  onCloseMenu: () => void;
  onContextMenu?: () => void;
}) {
  const subagentBadgeLabel = isSubagentSession(session)
    ? session.subagentLabel?.trim() || t("shell.subagentBadge")
    : null;
  const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));
  const sessionErrorSummary = getSessionErrorSummary(session);
  const sessionErrorPreview = sessionErrorSummary
    ? truncateSessionErrorSummary(sessionErrorSummary)
    : null;
  const sessionActivityBadgeLabel = resolveSessionActivityBadgeLabel(session);
  const sessionActivityBadgeClassName =
    sessionActivityBadgeLabel
      ? resolveSessionActivityBadgeClassName("session-activity-badge", session)
      : null;
  const sessionForkBadgeTone = resolveSessionForkBadgeTone(session);
  const sessionForkBadgeLabel = resolveSessionForkBadgeLabel(session);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuPositionStyle, setMenuPositionStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPositionStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const triggerElement = menuTriggerRef.current;

      if (!triggerElement) {
        return;
      }

      const triggerRect = triggerElement.getBoundingClientRect();
      setMenuPositionStyle({
        top: `${triggerRect.bottom}px`,
        left: `${triggerRect.right}px`
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  const sessionMenu =
    menuOpen && typeof document !== "undefined" && menuPositionStyle
      ? createPortal(
          <div
            className="workbench-session-menu"
            data-menu-key={menuKey}
            onClick={(event) => event.stopPropagation()}
            style={menuPositionStyle}
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
      onContextMenu={(event) => {
        if (selectionMode || !onContextMenu) {
          return;
        }

        event.preventDefault();
        onContextMenu();
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
        >
          <div className="workbench-session-link-copy">
            <div className="session-title-row">
              <span className="session-title" title={titlePresentation.fullTitle}>
                {titlePresentation.displayTitle}
              </span>
              {subagentBadgeLabel ? <span className="session-subagent-badge">{subagentBadgeLabel}</span> : null}
              {sessionForkBadgeLabel && sessionForkBadgeTone ? (
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
            {sessionErrorPreview ? (
              <div className="session-error-row" title={sessionErrorSummary ?? undefined}>
                <span className="session-error-text">{sessionErrorPreview}</span>
              </div>
            ) : null}
          </div>
        </button>
      </div>

      {showActions && !selectionMode ? (
        <div className="workbench-session-actions" data-open={menuOpen}>
          <button
            ref={menuTriggerRef}
            type="button"
            className="workbench-session-menu-trigger"
            data-open={menuOpen}
            aria-label={t("shell.sessionMoreAction")}
            title={t("shell.sessionMoreAction")}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMenu();
            }}
          >
            <MoreIcon />
          </button>
        </div>
      ) : null}
      {sessionMenu}
    </article>
  );
}

function SidebarContent({
  workspaceGroups,
  workspaceVisualContextMap,
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
  const { showToast } = useToast();
  const handleHeaderMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!platform.isDesktop || platform.ui.osFamily !== "macos" || event.button !== 0) {
      return;
    }

    if (!canStartDesktopWindowDragFromTarget(event.target)) {
      return;
    }

    void startDesktopWindowDrag();
  }, [platform.isDesktop, platform.ui.osFamily]);
  const [importBrowserOpen, setImportBrowserOpen] = useState(false);
  const [cloneBrowserOpen, setCloneBrowserOpen] = useState(false);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [expandedManagedWorkspaceIds, setExpandedManagedWorkspaceIds] = useState<string[]>([]);
  const [workspaceRemovalTarget, setWorkspaceRemovalTarget] = useState<WorkspaceDto | null>(null);
  const [removingWorkspaceId, setRemovingWorkspaceId] = useState<string | null>(null);
  const [actionWorkspaceId, setActionWorkspaceId] = useState<string | null>(null);
  const [actionProvider, setActionProvider] = useState<ProviderId | null>(null);
  const [createSessionWorkspaceId, setCreateSessionWorkspaceId] = useState<string | null>(null);
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
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [visibleFavoriteCount, setVisibleFavoriteCount] = useState(FAVORITE_SESSION_PAGE_SIZE);
  const [visibleWorkspaceSessionCounts, setVisibleWorkspaceSessionCounts] = useState<Record<string, number>>({});
  const [visibleSubagentCounts, setVisibleSubagentCounts] = useState<Record<string, number>>({});
  const [expandedSubagentRootIds, setExpandedSubagentRootIds] = useState<string[]>([]);
  const [expandedWorktreeSectionWorkspaceIds, setExpandedWorktreeSectionWorkspaceIds] = useState<string[]>([]);
  const [expandedWorktreeNodeIds, setExpandedWorktreeNodeIds] = useState<string[]>([]);
  const [renameTarget, setRenameTarget] = useState<NavigationSessionEntry | null>(null);
  const [renameTitleValue, setRenameTitleValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [batchWorkspaceId, setBatchWorkspaceId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchArchiving, setBatchArchiving] = useState(false);
  const [dragWorkspaceId, setDragWorkspaceId] = useState<string | null>(null);
  const createWorktreeBaseRefPickerRef = useRef<HTMLDivElement | null>(null);
  const createWorktreeBaseRefPopoverRef = useRef<HTMLDivElement | null>(null);

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
  const activeBatchWorkspaceGroup =
    workspaceGroups.find((group) => group.workspace.id === batchWorkspaceId) ?? null;
  const batchSelectableSessions = useMemo(
    () => (activeBatchWorkspaceGroup ? flattenVisibleSessionTree(getVisibleSessionTreeNodes(activeBatchWorkspaceGroup)) : []),
    [activeBatchWorkspaceGroup]
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
      const knownWorkspaceIds = new Set(workspaceGroups.map((group) => group.workspace.id));
      const nextState: Record<string, WorkspaceManagementViewState> = {};

      Object.entries(current).forEach(([workspaceId, state]) => {
        if (knownWorkspaceIds.has(workspaceId)) {
          nextState[workspaceId] = state;
        }
      });

      workspaceGroups.forEach((group) => {
        const cachedDetail = readViewSnapshot<WorkspaceManagementSummaryDto>(
          buildWorkspaceManagementSummarySnapshotKey(group.workspace.id),
          WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
        );
        const cachedGitSnapshot = readViewSnapshot<Pick<GitRealtimeSnapshotDto, "status" | "branches">>(
          buildGitSidebarSnapshotKey(group.workspace.id),
          WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
        );
        const currentState = nextState[group.workspace.id];
        let nextDetail = mergeWorkspaceManagementDetailWithWorkspace(
          currentState?.detail ?? cachedDetail ?? createWorkspaceManagementFallback(group.workspace),
          group.workspace
        );

        if (cachedGitSnapshot?.status || cachedGitSnapshot?.branches) {
          nextDetail = mergeWorkspaceManagementDetailWithGitSnapshot(nextDetail, {
            workspaceId: group.workspace.id,
            status: cachedGitSnapshot.status ?? null,
            history: [],
            historyTotalCount: 0,
            historyNextCursor: null,
            branches: cachedGitSnapshot.branches ?? null
          });
        }

        nextState[group.workspace.id] = {
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

      if (
        target instanceof HTMLElement
        && (target.closest(".workbench-session-actions") || target.closest(".workbench-session-menu"))
      ) {
        return;
      }

      setOpenSessionMenuKey(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openSessionMenuKey]);

  useEffect(() => {
    if (!batchWorkspaceId) {
      if (selectedSessionIds.length > 0) {
        setSelectedSessionIds([]);
      }
      return;
    }

    if (!activeBatchWorkspaceGroup) {
      setBatchWorkspaceId(null);
      setSelectedSessionIds([]);
      return;
    }

    setSelectedSessionIds((current) => retainKnownIds(current, batchSelectableSessionIdSet));
  }, [
    activeBatchWorkspaceGroup,
    batchSelectableSessionIdSet,
    batchWorkspaceId,
    selectedSessionIds.length
  ]);

  useEffect(() => {
    if (batchWorkspaceId && batchSelectableSessionIds.length === 0) {
      setBatchWorkspaceId(null);
      setSelectedSessionIds([]);
    }
  }, [batchSelectableSessionIds.length, batchWorkspaceId]);

  useEffect(() => {
    const knownWorkspaceIdSet = new Set(workspaceGroups.map((group) => group.workspace.id));
    const knownWorktreeWorkspaceIdSet = new Set(
      workspaceGroups.flatMap((group) => collectSidebarWorktreeWorkspaceIds(group.childWorktrees))
    );

    setExpandedManagedWorkspaceIds((current) => current.filter((workspaceId) => knownWorkspaceIdSet.has(workspaceId)));
    setExpandedWorktreeSectionWorkspaceIds((current) =>
      current.filter((workspaceId) => knownWorkspaceIdSet.has(workspaceId))
    );
    setExpandedWorktreeNodeIds((current) =>
      current.filter((workspaceId) => knownWorktreeWorkspaceIdSet.has(workspaceId))
    );
    setWorkspaceRemovalTarget((current) =>
      current && knownWorkspaceIdSet.has(current.id) ? current : null
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

    const workspaceSectionIdsToExpand: string[] = [];
    const worktreeNodeIdsToExpand: string[] = [];

    for (const group of workspaceGroups) {
      const worktreePath = findSidebarWorktreePathByWorkspaceId(group.childWorktrees, activeWorkspaceId);

      if (worktreePath.length === 0) {
        continue;
      }

      workspaceSectionIdsToExpand.push(group.workspace.id);
      worktreeNodeIdsToExpand.push(...worktreePath);
    }

    if (workspaceSectionIdsToExpand.length > 0) {
      setExpandedWorktreeSectionWorkspaceIds((current) => {
        const currentSet = new Set(current);
        let changed = false;

        for (const workspaceId of workspaceSectionIdsToExpand) {
          if (!currentSet.has(workspaceId)) {
            currentSet.add(workspaceId);
            changed = true;
          }
        }

        return changed ? Array.from(currentSet) : current;
      });
    }

    if (worktreeNodeIdsToExpand.length > 0) {
      setExpandedWorktreeNodeIds((current) => {
        const currentSet = new Set(current);
        let changed = false;

        for (const workspaceId of worktreeNodeIdsToExpand) {
          if (!currentSet.has(workspaceId)) {
            currentSet.add(workspaceId);
            changed = true;
          }
        }

        return changed ? Array.from(currentSet) : current;
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
    setDragWorkspaceId(null);
  }

  function handleWorkspaceDragStart(
    event: ReactDragEvent<HTMLButtonElement>,
    workspaceId: string
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", workspaceId);
    onStartWorkspaceReorder();
    setDragWorkspaceId(workspaceId);
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

  function isWorktreeSectionExpanded(workspaceId: string) {
    return expandedWorktreeSectionWorkspaceIds.includes(workspaceId);
  }

  function handleToggleWorktreeSection(workspaceId: string) {
    setExpandedWorktreeSectionWorkspaceIds((current) =>
      current.includes(workspaceId) ? current.filter((item) => item !== workspaceId) : [...current, workspaceId]
    );
  }

  function isWorktreeNodeExpanded(workspaceId: string) {
    return expandedWorktreeNodeIds.includes(workspaceId);
  }

  function handleToggleWorktreeNode(workspaceId: string) {
    setExpandedWorktreeNodeIds((current) =>
      current.includes(workspaceId) ? current.filter((item) => item !== workspaceId) : [...current, workspaceId]
    );
  }

  function getFavoriteChildSessions(sessionId: string) {
    for (const group of workspaceGroups) {
      const node =
        flattenSessionTreeNodes(buildSessionTree(group.visibleSessions)).find(
          (item) => item.item.sessionId === sessionId
        ) ?? findSidebarVisibleSessionNode(group.childWorktrees, sessionId);

      if (node) {
        return getTreeNodeChildren(node);
      }
    }

    return [];
  }

  function renderArchiveFolder(workspace: WorkspaceDto, archivedSessions: readonly SessionSummaryDto[]) {
    return (
      <button
        type="button"
        className="workbench-archive-folder"
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

  function renderWorktreeNode(node: WorkspaceSidebarWorktreeNode): JSX.Element {
    const visibleSessionTree = node.visibleSessionTree;
    const childWorkspaceIdSet = new Set(collectSidebarWorktreeWorkspaceIds(node.children));
    const hasActiveChildWorkspace = childWorkspaceIdSet.has(activeWorkspaceId ?? "");
    const containsActiveWorkspace = node.workspace.id === activeWorkspaceId || hasActiveChildWorkspace;
    const isCollapsed = !containsActiveWorkspace && !isWorktreeNodeExpanded(node.workspace.id);
    const childWorktreeSectionExpanded =
      node.children.length > 0
      && (hasActiveChildWorkspace || isWorktreeSectionExpanded(node.workspace.id));

    return (
      <section
        key={node.workspace.id}
        className="workbench-workspace-group"
        data-worktree-node="true"
        data-worktree-depth={node.meta.depth}
      >
        <div className="workbench-workspace-header minimal">
          <button
            type="button"
            className="workbench-workspace-toggle"
            aria-label={isCollapsed ? t("shell.worktreeExpand") : t("shell.worktreeCollapse")}
            onClick={() => handleToggleWorktreeNode(node.workspace.id)}
          >
            <span className="workbench-workspace-toggle-icon" aria-hidden="true">
              <ChevronIcon expanded={!isCollapsed} />
            </span>
            <span>
              <strong>{node.meta.displayName || node.workspace.name}</strong>
              <span className="session-meta">{node.meta.branchName}</span>
            </span>
          </button>

          <div className="workbench-workspace-actions minimal">
            <button
              type="button"
              className="workbench-workspace-icon-button"
              aria-label={t("shell.switchWorkspace")}
              title={t("shell.switchWorkspace")}
              aria-pressed={activeWorkspaceId === node.workspace.id}
              onClick={() => {
                onSelectWorkspace(node.workspace.id);
                onClose?.();
              }}
            >
              <WorkspaceSwitchIcon />
            </button>
            <button
              type="button"
              className="workbench-workspace-icon-button workbench-workspace-create"
              aria-label={t("shell.createSession")}
              title={t("shell.createSession")}
              onClick={() => setCreateSessionWorkspaceId(node.workspace.id)}
            >
              <PlusIcon />
            </button>
          </div>
        </div>

        {!isCollapsed ? (
          <>
            <div className="workbench-session-list">
              {visibleSessionTree.length === 0 ? (
                <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
              ) : (
                visibleSessionTree
                  .slice(0, getVisibleWorkspaceSessionCount(node.workspace.id))
                  .map((treeNode) =>
                    renderSessionTreeBranch({
                      node: treeNode,
                      workspace: node.workspace,
                      workspaceContext: getWorkspaceContext(node.workspace),
                      menuKeyPrefix: `worktree:${node.workspace.id}`,
                      showWorkspaceName: false,
                      selectionMode: false,
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
              <section className="workbench-section-block">
                <button
                  type="button"
                  className="workbench-section-heading workbench-section-heading-button"
                  aria-label={
                    childWorktreeSectionExpanded
                      ? t("shell.worktreeSectionCollapse")
                      : t("shell.worktreeSectionExpand")
                  }
                  aria-expanded={childWorktreeSectionExpanded}
                  onClick={() => handleToggleWorktreeSection(node.workspace.id)}
                >
                  <span className="workbench-section-heading-main">
                    <ChevronIcon expanded={childWorktreeSectionExpanded} />
                    <span>{t("shell.worktreeSectionTitle")}</span>
                  </span>
                  <span className="workbench-section-counter">{node.children.length}</span>
                </button>
                {childWorktreeSectionExpanded ? (
                  <div className="workbench-session-list">
                    {node.children.map((childNode) => renderWorktreeNode(childNode))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {renderArchiveFolder(node.workspace, node.archivedSessions)}
          </>
        ) : null}
      </section>
    );
  }

  function renderSessionTreeBranch(input: {
    node: NavigationSessionTreeNode;
    workspace: WorkspaceDto;
    workspaceContext: WorkspaceVisualContext;
    menuKeyPrefix: string;
    showWorkspaceName: boolean;
    selectionMode: boolean;
    favoriteEnabled: boolean;
    ancestorExpanded?: boolean;
    allowToggle?: boolean;
    ancestorHasNextSiblings?: readonly boolean[];
    hasNextSibling?: boolean;
    isFirstSibling?: boolean;
  }): JSX.Element {
    const {
      node,
      workspace,
      workspaceContext,
      menuKeyPrefix,
      showWorkspaceName,
      selectionMode,
      favoriteEnabled,
      ancestorExpanded = false,
      allowToggle = node.depth === 0,
      ancestorHasNextSiblings = [],
      hasNextSibling = false,
      isFirstSibling = false
    } = input;
    const session = node.item;
    const childNodes = getTreeNodeChildren(node);
    const subagentListExpanded = ancestorExpanded || isSubagentListExpanded(session.sessionId);
    // 只让真正的展开根节点负责子会话分页，递归子节点只消费父节点已经裁好的树，
    // 否则同一棵树会被重复裁剪，冒出多个“展开更多子会话”按钮。
    const shouldPaginateSubagentTree = subagentListExpanded && allowToggle;
    const visibleNode = shouldPaginateSubagentTree
      ? limitVisibleDescendantTree(node, getVisibleSubagentCount(session.sessionId))
      : node;
    const visibleChildren = subagentListExpanded ? getTreeNodeChildren(visibleNode) : [];
    const totalDescendantCount = flattenSessionTreeNodes(childNodes).length;
    const visibleDescendantCount = flattenSessionTreeNodes(visibleChildren).length;
    const hasMoreSubagents = shouldPaginateSubagentTree && visibleDescendantCount < totalDescendantCount;
    const nextAncestorHasNextSiblings =
      node.depth > 0 ? [...ancestorHasNextSiblings, hasNextSibling] : [...ancestorHasNextSiblings];

    return (
      <div key={session.sessionId} className="workbench-session-tree-node">
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
            menuKey={`${menuKeyPrefix}:${session.sessionId}`}
            session={session}
            workspace={workspace}
            workspaceContext={workspaceContext}
            isActive={session.sessionId === activeSessionId}
            isFavorite={favoriteEnabled && favoriteSessionIds.has(session.sessionId)}
            menuOpen={openSessionMenuKey === `${menuKeyPrefix}:${session.sessionId}`}
            showWorkspaceName={showWorkspaceName}
            depth={node.depth}
            showActions={favoriteEnabled}
            hasSubagents={allowToggle && childNodes.length > 0}
            subagentListExpanded={subagentListExpanded}
            selectionMode={selectionMode}
            selected={selectedSessionIdSet.has(session.sessionId)}
            onToggleSelect={() => handleToggleSessionSelection(session.sessionId)}
            onToggleSubagents={() => handleToggleSubagentList(session.sessionId)}
            onOpen={() => {
              navigate(buildWorkspaceSessionPath(workspace.id, session.sessionId));
              onClose?.();
            }}
            onRename={() => handleOpenRenameSession(session, workspace)}
            onToggleMenu={() =>
              setOpenSessionMenuKey((current) =>
                current === `${menuKeyPrefix}:${session.sessionId}` ? null : `${menuKeyPrefix}:${session.sessionId}`
              )
            }
            onToggleFavorite={() => handleToggleFavorite(session.sessionId)}
            onArchive={() => handleArchive(session.sessionId)}
            onCloseMenu={() => setOpenSessionMenuKey(null)}
            onContextMenu={
              platform.isDesktop
                ? () => {
                    void handleSessionContextMenu({
                      session,
                      workspace
                    });
                  }
                : undefined
            }
          />
        </div>
        {childNodes.length > 0 && subagentListExpanded ? (
          <div className="workbench-subsession-list">
            {visibleChildren.map((childNode, index) =>
              renderSessionTreeBranch({
                node: childNode,
                workspace,
                workspaceContext,
                menuKeyPrefix,
                showWorkspaceName,
                selectionMode,
                favoriteEnabled,
                ancestorExpanded: true,
                allowToggle: false,
                ancestorHasNextSiblings: nextAncestorHasNextSiblings,
                hasNextSibling: index < visibleChildren.length - 1,
                isFirstSibling: index === 0
              })
            )}
            {hasMoreSubagents ? (
              <button
                type="button"
                className="workbench-subsession-expand ghost-button"
                onClick={() => handleExpandSubagents(session.sessionId)}
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
    setOpenSessionMenuKey(null);
    setBatchWorkspaceId(workspaceId);
    setSelectedSessionIds([]);
  }

  function handleStopBatchSelection() {
    setBatchWorkspaceId(null);
    setSelectedSessionIds([]);
  }

  function handleToggleSessionSelection(sessionId: string) {
    setSelectedSessionIds((current) => toggleStoredId(current, sessionId));
  }

  function handleToggleSelectAllSessions() {
    setSelectedSessionIds((current) =>
      current.length === batchSelectableSessionIds.length ? [] : batchSelectableSessionIds
    );
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
    setOpenSessionMenuKey(null);

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
    setOpenSessionMenuKey(null);

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

  async function handleArchiveSelectedSessions() {
    if (selectedSessionIds.length === 0 || batchArchiving) {
      return;
    }

    setOpenSessionMenuKey(null);
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

  async function handleUnarchive(sessionId: string) {
    setOpenSessionMenuKey(null);

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
    setOpenSessionMenuKey(null);
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

  async function handleSessionContextMenu(entry: NavigationSessionEntry) {
    if (!platform.isDesktop) {
      return;
    }

    const isFavorite = favoriteSessionIds.has(entry.session.sessionId);

    await showDesktopContextMenu([
      {
        id: `open-${entry.session.sessionId}`,
        label: t("shell.contextOpenSession"),
        onSelect: () => {
          navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
          onClose?.();
        }
      },
      {
        id: `rename-${entry.session.sessionId}`,
        label: t("shell.renameAction"),
        onSelect: () => handleOpenRenameSession(entry.session, entry.workspace)
      },
      {
        id: `favorite-${entry.session.sessionId}`,
        label: isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction"),
        onSelect: () => handleToggleFavorite(entry.session.sessionId)
      },
      {
        id: `archive-${entry.session.sessionId}`,
        label: t("shell.archiveAction"),
        onSelect: () => {
          void handleArchive(entry.session.sessionId);
        }
      }
    ]);
  }

  const visibleFavoriteSessions = favoriteSessions.slice(0, visibleFavoriteCount);
  const hasMoreFavoriteSessions = visibleFavoriteSessions.length < favoriteSessions.length;

  function getWorkspaceContext(workspace: WorkspaceDto) {
    return workspaceVisualContextMap[workspace.id] ?? createFallbackWorkspaceVisualContext(workspace);
  }

  return (
    <>
      <div
        className="workbench-nav-header"
        data-window-drag-handle="workbench-nav-header"
        onMouseDownCapture={handleHeaderMouseDownCapture}
      >
        <div className="workbench-nav-toolbar">
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
          <WorkbenchNotificationButton
            unreadCount={unreadNotificationCount}
            open={notificationPanelOpen}
            onToggle={onToggleNotificationPanel}
          />
          <button
            type="button"
            className="workbench-nav-toolbar-button"
            aria-label={t("shell.goBack")}
            title={t("shell.goBack")}
            onClick={() => navigate(-1)}
          >
            <ArrowLeftIcon />
          </button>
          <button
            type="button"
            className="workbench-nav-toolbar-button"
            aria-label={t("shell.goForward")}
            title={t("shell.goForward")}
            onClick={() => navigate(1)}
          >
            <ArrowRightIcon />
          </button>
        </div>
      </div>

      <div className="workbench-nav-body">
        <div className="workbench-nav-segment" role="tablist" aria-label={t("shell.centerTabsLabel")}>
          <button
            type="button"
            className={
              isConversationActive
                ? "workbench-nav-segment-button active"
                : "workbench-nav-segment-button"
            }
            role="tab"
            aria-selected={isConversationActive}
            onClick={onNavigateConversation}
          >
            <ConversationIcon />
            {t("shell.conversationEntry")}
          </button>
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
            {t("shell.terminalsEntry")}
          </button>
          <button
            type="button"
            className={
              isButlerActive
                ? "workbench-nav-segment-button active"
                : "workbench-nav-segment-button"
            }
            role="tab"
            aria-selected={isButlerActive}
            onClick={onNavigateButler}
          >
            <ButlerIcon />
            {t("shell.butlerEntry")}
          </button>
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
          <section className="workbench-section-block">
            <div className="workbench-section-heading">
              <div className="workbench-section-heading-main">
                <StarIcon active />
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
          const visibleSessionTree = getVisibleSessionTreeNodes(group);
          const isDraggedWorkspace = dragWorkspaceId === group.workspace.id;
          const hasActiveChildWorkspace = hasSidebarWorktreeWorkspace(group.childWorktrees, activeWorkspaceId);
          const containsActiveWorkspace =
            group.workspace.id === activeWorkspaceId || hasActiveChildWorkspace;
          const isWorkspaceCollapsed =
            (!containsActiveWorkspace && group.isCollapsed) || isDraggedWorkspace;
          const worktreeSectionExpanded =
            group.childWorktrees.length > 0
            && (hasActiveChildWorkspace || isWorktreeSectionExpanded(group.workspace.id));

          return (
            <section
              key={group.workspace.id}
              className="workbench-workspace-group"
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
                  draggable={allowWorkspaceReorder}
                  onClick={() => onToggleWorkspaceCollapse(group.workspace.id)}
                  onDragStart={
                    allowWorkspaceReorder
                      ? (event) => handleWorkspaceDragStart(event, group.workspace.id)
                      : undefined
                  }
                  onDragEnd={allowWorkspaceReorder ? handleWorkspaceDragEnd : undefined}
                  data-reorder-enabled={allowWorkspaceReorder ? "true" : undefined}
                >
                  <span className="workbench-workspace-toggle-icon" aria-hidden="true">
                    <ChevronIcon expanded={!isWorkspaceCollapsed} />
                  </span>
                  <strong>{group.workspace.name}</strong>
                </button>

                {batchWorkspaceId === group.workspace.id ? (
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
                      disabled={selectedSessionIds.length === 0 || batchArchiving}
                      onClick={() => {
                        void handleArchiveSelectedSessions();
                      }}
                    >
                      {batchArchiving ? t("shell.batchArchiving") : t("shell.batchArchiveAction")}
                    </button>
                    <button
                      type="button"
                      className="workbench-workspace-batch-action"
                      onClick={handleStopBatchSelection}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : (
                  <div className="workbench-workspace-actions">
                    <button
                      type="button"
                      className="workbench-workspace-icon-button"
                      aria-label={t("shell.switchWorkspace")}
                      title={t("shell.switchWorkspace")}
                      aria-pressed={activeWorkspaceId === group.workspace.id}
                      onClick={() => {
                        onSelectWorkspace(group.workspace.id);
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
                      onClick={() => handleStartBatchSelection(group.workspace.id)}
                    >
                      <MultiSelectIcon />
                    </button>
                    <button
                      type="button"
                      className="workbench-workspace-icon-button workbench-workspace-create"
                      aria-label={t("shell.createSession")}
                      title={t("shell.createSession")}
                      onClick={() => setCreateSessionWorkspaceId(group.workspace.id)}
                    >
                      <PlusIcon />
                    </button>
                  </div>
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
                    <section className="workbench-section-block">
                      <button
                        type="button"
                        className="workbench-section-heading workbench-section-heading-button"
                        aria-label={
                          worktreeSectionExpanded
                            ? t("shell.worktreeSectionCollapse")
                            : t("shell.worktreeSectionExpand")
                        }
                        aria-expanded={worktreeSectionExpanded}
                        onClick={() => handleToggleWorktreeSection(group.workspace.id)}
                      >
                        <span className="workbench-section-heading-main">
                          <ChevronIcon expanded={worktreeSectionExpanded} />
                          <span>{t("shell.worktreeSectionTitle")}</span>
                        </span>
                        <span className="workbench-section-counter">{group.childWorktrees.length}</span>
                      </button>
                      {worktreeSectionExpanded ? (
                        <div className="workbench-session-list">
                          {group.childWorktrees.map((node) => renderWorktreeNode(node))}
                        </div>
                      ) : null}
                    </section>
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
        <button
          className="settings-entry-button workbench-nav-settings-button"
          type="button"
          onClick={onOpenSettings}
          title={t("settings.title")}
        >
          <SettingsIcon />
          <span className="settings-entry-label">{t("settings.title")}</span>
        </button>
      </div>

      <SidebarModal
        open={workspaceManagerOpen}
        title={t("shell.manageWorkspaceTitle")}
        description={t("shell.manageWorkspaceDescription")}
        onClose={() => {
          if (removingWorkspaceId) {
            return;
          }

          setWorkspaceManagerOpen(false);
        }}
      >
        {workspaceGroups.length > 0 ? (
          <div className="workbench-manage-list">
            {workspaceGroups.map((group) => {
              const isExpanded = expandedManagedWorkspaceIds.includes(group.workspace.id);
              const managementState = workspaceManagementStateById[group.workspace.id] ?? {
                detail: null,
                loading: false,
                error: null
              };
              const isRemovingCurrentWorkspace = removingWorkspaceId === group.workspace.id;
              const remoteSummary =
                managementState.detail?.git.remotes.length
                  ? managementState.detail.git.remotes
                      .map((remote) => `${remote.name}: ${remote.url}`)
                      .join(" · ")
                  : t("shell.manageWorkspaceNoRemote");
              const workspaceSessionCount =
                group.visibleSessions.length + group.archivedSessions.length;
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

              return (
                <article key={group.workspace.id} className="workbench-manage-item">
                  <button
                    type="button"
                    className="workbench-manage-item-toggle"
                    aria-expanded={isExpanded}
                    onClick={() => handleToggleManagedWorkspace(group.workspace.id)}
                  >
                    <span className="workbench-manage-item-heading">
                      <ChevronIcon expanded={isExpanded} />
                      <strong>{group.workspace.name}</strong>
                    </span>
                    <span className="workbench-section-counter">{workspaceSessionCount}</span>
                  </button>

                  {isExpanded ? (
                    <div className="workbench-manage-item-body">
                      <div className="workbench-manage-detail-block">
                        <span className="workbench-manage-detail-label">
                          {t("shell.manageWorkspacePathLabel")}
                        </span>
                        <p className="workbench-manage-detail-value">{group.workspace.path}</p>
                      </div>

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
                          onClick={() => setWorkspaceRemovalTarget(group.workspace)}
                        >
                          {isRemovingCurrentWorkspace
                            ? t("shell.manageWorkspaceRemoving")
                            : t("shell.manageWorkspaceRemoveAction")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="workbench-section-empty">{t("shell.manageWorkspaceEmpty")}</p>
        )}
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
          <button
            type="button"
            className="secondary-button create-session-worktree-trigger"
            disabled={creatingWorktree || Boolean(actionWorkspaceId)}
            onClick={() => setCreateWorktreeFormOpen(true)}
          >
            {t("shell.createWorktreeAction")}
          </button>
        }
        onClose={() => setCreateSessionWorkspaceId(null)}
      >
        <section className="create-session-modal-section">
          <div className="create-session-modal-section-header">
            <strong>{t("shell.createSessionProviderLabel")}</strong>
            <span>{t("shell.providerOptionHint")}</span>
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
        onClose={() => setArchiveWorkspaceId(null)}
      >
        {archiveWorkspaceGroup && archiveWorkspaceGroup.archivedSessions.length > 0 ? (
          <div className="workbench-archive-list">
            {archiveWorkspaceGroup.archivedSessions.map((session) => {
              const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));

              return (
                <article key={session.sessionId} className="workbench-archive-item">
                  <div className="workbench-archive-item-main">
                    <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                    <p>
                      {buildSessionMeta(session, archiveWorkspaceGroup.workspace, false)} ·{" "}
                      {formatProviderLabel(session.provider)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleUnarchive(session.sessionId)}
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
  const platform = usePlatform();
  const { showToast } = useToast();
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

  const handleHeaderMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!platform.isDesktop || platform.ui.osFamily !== "macos" || event.button !== 0) {
      return;
    }

    if (!canStartDesktopWindowDragFromTarget(event.target)) {
      return;
    }

    void startDesktopWindowDrag();
  }, [platform.isDesktop, platform.ui.osFamily]);

  return (
    <>
      <div
        className="workbench-auxiliary-header"
        data-workspace-tone={workspaceContext?.tone ?? "root"}
        data-window-drag-handle="workbench-auxiliary-header"
        onMouseDownCapture={handleHeaderMouseDownCapture}
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

      <div className="workbench-auxiliary-body">
        {!panelReady ? <InfoPanelSkeleton /> : null}

        {panelReady && worktreeMeta ? (
          <WorktreeMergePanel
            meta={worktreeMeta}
            state={worktreeMergeState}
            onRefresh={() => onRefreshWorktreeMergePreview(worktreeMeta.workspaceId, true)}
            onApply={() => onApplyWorktreeMerge(worktreeMeta.workspaceId)}
            onCleanup={() => onCleanupWorktree(worktreeMeta)}
          />
        ) : null}

        {panelReady && activeTab === "files" ? (
          activeWorkspaceId ? (
            <Suspense fallback={<InfoPanelSkeleton />}>
              <LazyFileContextPanel
                sessionId={currentSessionId}
                workspaceId={activeWorkspaceId}
                externalRevealRequest={fileRevealRequest}
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
  const preview = state?.preview ?? null;
  const loading = state?.loading ?? false;
  const applying = state?.applying ?? false;
  const cleaning = state?.cleaning ?? false;
  const hasPreview = preview !== null;
  const isMerged = meta.lifecycleStatus === "merged" || preview?.alreadyMerged === true;
  const canApply = preview?.canMerge === true && !loading && !applying && !cleaning && !isMerged;
  const canCleanup = isMerged && !loading && !applying && !cleaning;
  const statusTone =
    loading || applying || cleaning
      ? "loading"
      : isMerged
        ? "merged"
        : preview?.canMerge
          ? "ready"
          : hasPreview
            ? "blocked"
            : "idle";
  const targetWorkspaceName = preview?.targetWorkspace.name ?? t("common.unknown");
  const blockerDetails = preview?.blockers.map((item) => item.detail) ?? [];

  return (
    <section className="worktree-merge-panel" data-state={statusTone}>
      <div className="worktree-merge-panel-header">
        <div>
          <span className="worktree-merge-panel-label">{t("shell.worktreeMergePanelLabel")}</span>
          <h3>{t("shell.worktreeMergePanelTitle")}</h3>
        </div>
        <span className="worktree-merge-panel-status">
          {loading
            ? t("shell.worktreeMergePreviewLoading")
            : applying
              ? t("shell.worktreeMergeApplying")
              : cleaning
                ? t("shell.worktreeCleanupRunning")
                : isMerged
                  ? t("shell.worktreeMergeAlreadyMerged")
                  : preview?.canMerge
                  ? t("shell.worktreeMergeReady")
                  : hasPreview
                    ? t("shell.worktreeMergeBlocked")
                    : t("shell.worktreeMergePreviewIdle")}
        </span>
      </div>

      <p className="worktree-merge-panel-copy">
        {t("shell.worktreeMergePanelSummary", {
          source: meta.displayName || meta.branchName,
          target: targetWorkspaceName
        })}
      </p>

      <div className="worktree-merge-panel-meta">
        <span>{t("shell.worktreeMergeSourceBranch", { branch: meta.branchName })}</span>
        <span>{t("shell.worktreeMergeTargetWorkspace", { name: targetWorkspaceName })}</span>
        {preview ? (
          <span>{t("shell.worktreeMergeAheadBehind", { ahead: preview.ahead, behind: preview.behind })}</span>
        ) : null}
        {preview?.mergeBaseCommit ? (
          <span>{t("shell.worktreeMergeBaseCommit", { commit: shortenCommit(preview.mergeBaseCommit) })}</span>
        ) : null}
      </div>

      {state?.error ? (
        <p className="worktree-merge-panel-error status-text" data-tone="error">
          {state.error}
        </p>
      ) : null}

      {blockerDetails.length > 0 ? (
        <div className="worktree-merge-panel-blockers">
          {blockerDetails.map((detail) => (
            <p key={detail} className="worktree-merge-panel-blocker">
              {detail}
            </p>
          ))}
        </div>
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

      {isMerged ? (
        <p className="worktree-merge-panel-hint">{t("shell.worktreeMergeMergedHint")}</p>
      ) : null}

      <div className="worktree-merge-panel-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={loading || applying}
          onClick={onRefresh}
        >
          {hasPreview ? t("shell.worktreeMergePreviewRefresh") : t("shell.worktreeMergePreviewAction")}
        </button>
        {isMerged ? (
          <button
            type="button"
            className="secondary-button worktree-merge-panel-cleanup-button"
            disabled={!canCleanup}
            onClick={onCleanup}
          >
            {cleaning ? t("shell.worktreeCleanupRunning") : t("shell.worktreeCleanupAction")}
          </button>
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={!canApply}
          onClick={onApply}
        >
          {applying ? t("shell.worktreeMergeApplying") : t("shell.worktreeMergeApplyAction")}
        </button>
      </div>
    </section>
  );
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
  const notifyOnPermissionRequest = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnPermissionRequest
  );
  const notifyOnSessionCompleted = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnSessionCompleted
  );
  const notifyOnSessionFailed = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnSessionFailed
  );
  const initialWorkbenchSnapshotRef = useRef<WorkbenchSnapshotDto | null>(readCachedWorkbenchSnapshot());
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
  const fileTreeSubscriptionRef = useRef<{ workspaceId: string; paths: string[] } | null>(null);
  const pendingFileTreeRefreshRef = useRef<{ workspaceId: string; paths?: string[] } | null>(null);
  const gitWorkspaceSubscriptionRef = useRef<string | null>(null);
  const pendingGitRefreshWorkspaceIdRef = useRef<string | null>(null);
  const workspaceManagementSubscriptionRef = useRef<string | null>(null);
  const pendingWorkspaceManagementRefreshWorkspaceIdRef = useRef<string | null>(null);
  const terminalManagerWorkspaceSubscriptionRef = useRef<string | null>(null);
  const pendingTerminalManagerRefreshWorkspaceIdRef = useRef<string | null>(null);
  const notificationRefreshRequestIdRef = useRef(0);
  const notificationArchiveMutationRequestIdRef = useRef(0);
  const showToastRef = useRef(showToast);
  const platformBridgeRef = useRef(platform.bridge);
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
  const permissionWatchSessionsRef = useRef<
    Array<{ sessionId: string; workspaceId: string; title: string }>
  >([]);
  const pendingWorkspaceReorderRef = useRef<{
    originalGroups: WorkspaceSessionGroup[];
  } | null>(null);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>(() =>
    mapWorkbenchSnapshotToGroups(initialWorkbenchSnapshotRef.current)
  );
  const navigationGroupsRef = useRef<WorkspaceSessionGroup[]>(navigationGroups);
  const [navigationLoading, setNavigationLoading] = useState(
    () => (initialWorkbenchSnapshotRef.current?.items?.length ?? 0) === 0
  );
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    clamp(readStoredNumber(LEFT_PANEL_WIDTH_KEY, DEFAULT_LEFT_PANEL_WIDTH), MIN_PANEL_WIDTH, MAX_LEFT_PANEL_WIDTH)
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    clamp(
      readStoredNumber(RIGHT_PANEL_WIDTH_KEY, DEFAULT_RIGHT_PANEL_WIDTH),
      MIN_PANEL_WIDTH,
      MAX_RIGHT_PANEL_WIDTH
    )
  );
  const [leftCollapsed, setLeftCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  );
  const [rightCollapsed, setRightCollapsed] = useState(() =>
    readStoredBoolean(RIGHT_PANEL_COLLAPSED_KEY, false)
  );
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
  const [worktreeMergeStateById, setWorktreeMergeStateById] = useState<
    Record<string, WorktreeMergeViewState>
  >({});
  const [globalNotifications, setGlobalNotifications] = useState<WorkbenchGlobalNotification[]>([]);
  const [archivedNotificationIds, setArchivedNotificationIds] = useState<Set<string>>(() => new Set());
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [showArchivedNotifications, setShowArchivedNotifications] = useState(false);
  const [notificationSeenAt, setNotificationSeenAt] = useState<string | null>(() =>
    readStoredString(WORKBENCH_NOTIFICATION_SEEN_AT_KEY)
  );

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    navigationGroupsRef.current = navigationGroups;
  }, [navigationGroups]);

  useEffect(() => {
    platformBridgeRef.current = platform.bridge;
  }, [platform.bridge]);

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

      const [overviewResponse, followUpResponse, notificationArchiveResponse] = await Promise.all([
        getButlerOverview(),
        listButlerFollowUpTasks(),
        listButlerNotificationArchives()
      ]);

      if (requestId !== notificationRefreshRequestIdRef.current) {
        return;
      }

      setGlobalNotifications(
        buildWorkbenchGlobalNotifications(overviewResponse.overview, followUpResponse.items)
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

    const nextGroups = mapWorkbenchSnapshotToGroups(snapshotWithPendingArchiveState);

    initialWorkbenchSnapshotRef.current = snapshotWithPendingArchiveState;
    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, snapshotWithPendingArchiveState);
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
      const nextGroups = upsertSessionIntoGroups(current, session);
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

  const subscribeFileTree = useCallback((workspaceId: string, paths: string[]) => {
    fileTreeSubscriptionRef.current = {
      workspaceId,
      paths
    };
    workbenchRealtimeClientRef.current?.subscribeFileTree(workspaceId, paths);
  }, []);

  const requestFileTreeRefresh = useCallback((workspaceId: string, paths?: string[]) => {
    pendingFileTreeRefreshRef.current = {
      workspaceId,
      paths
    };
    workbenchRealtimeClientRef.current?.requestFileTreeRefresh(workspaceId, paths);
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

  const subscribeGitSnapshot = useCallback((workspaceId: string) => {
    gitWorkspaceSubscriptionRef.current = workspaceId;
    workbenchRealtimeClientRef.current?.subscribeGit(workspaceId);
  }, []);

  const requestGitRefresh = useCallback((workspaceId: string) => {
    pendingGitRefreshWorkspaceIdRef.current = workspaceId;
    workbenchRealtimeClientRef.current?.requestGitRefresh(workspaceId);
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

  const subscribeWorkspaceManagementSnapshot = useCallback((workspaceId: string) => {
    workspaceManagementSubscriptionRef.current = workspaceId;
    workbenchRealtimeClientRef.current?.subscribeWorkspaceManagement(workspaceId);
  }, []);

  const requestWorkspaceManagementRefresh = useCallback((workspaceId: string) => {
    pendingWorkspaceManagementRefreshWorkspaceIdRef.current = workspaceId;
    setWorkspaceManagementStateById((current) => ({
      ...current,
      [workspaceId]: {
        detail: current[workspaceId]?.detail ?? null,
        loading: true,
        error: null
      }
    }));
    workbenchRealtimeClientRef.current?.requestWorkspaceManagementRefresh(workspaceId);
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
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            t("shell.worktreeCleanupConfirm", {
              name: meta.displayName || meta.branchName
            })
          );

    if (!confirmed) {
      return;
    }

    const workspaceId = meta.workspaceId;

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
      await cleanupWorktree(workspaceId);
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
      requestNavigationRefresh();
      await refreshNavigation();
      navigate(buildWorkspaceDetailPath(meta.parentWorkspaceId), { replace: true });
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
  }, [navigate, refreshNavigation, requestNavigationRefresh]);

  const subscribeTerminalManagerSnapshot = useCallback((workspaceId: string) => {
    terminalManagerWorkspaceSubscriptionRef.current = workspaceId;
    workbenchRealtimeClientRef.current?.subscribeTerminalManager(workspaceId);
  }, []);

  const requestTerminalManagerRefresh = useCallback((workspaceId: string) => {
    pendingTerminalManagerRefreshWorkspaceIdRef.current = workspaceId;
    workbenchRealtimeClientRef.current?.requestTerminalManagerRefresh(workspaceId);
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
      client.subscribeFileTree(fileTreeSubscription.workspaceId, fileTreeSubscription.paths);
    }

    if (gitWorkspaceSubscription) {
      client.subscribeGit(gitWorkspaceSubscription);
    }

    if (workspaceManagementSubscription) {
      client.subscribeWorkspaceManagement(workspaceManagementSubscription);
    }

    if (terminalManagerWorkspaceSubscription) {
      client.subscribeTerminalManager(terminalManagerWorkspaceSubscription);
    }

    if (pendingFileTreeRefresh) {
      client.requestFileTreeRefresh(pendingFileTreeRefresh.workspaceId, pendingFileTreeRefresh.paths);
    }

    if (pendingGitRefreshWorkspaceId) {
      client.requestGitRefresh(pendingGitRefreshWorkspaceId);
    }

    if (pendingWorkspaceManagementRefreshWorkspaceId) {
      client.requestWorkspaceManagementRefresh(pendingWorkspaceManagementRefreshWorkspaceId);
    }

    if (pendingTerminalManagerRefreshWorkspaceId) {
      client.requestTerminalManagerRefresh(pendingTerminalManagerRefreshWorkspaceId);
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
    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, nextSnapshot);
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
    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, nextSnapshot);
    setCollapsedWorkspaceIds(nextCollapsedWorkspaceIds);
    void updateWorkspaceNavigationState(workspaceId, nextCollapsed).catch((error) => {
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
      writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, revertedSnapshot);
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
        return;
      }

      // 后台会话在运行时，主动拉一次工作台快照，避免完成态只在切回会话时才可见。
      workbenchRealtimeClientRef.current?.requestRefresh();

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

    const knownWorkspaceIds = new Set(navigationGroups.map((group) => group.workspace.id));

    // 工作区选择必须跟随当前快照收敛，否则会指向已经不存在的工作区。
    setCollapsedWorkspaceIds((current) => retainKnownIds(current, knownWorkspaceIds));
    setSelectedWorkspaceId((current) => (current && knownWorkspaceIds.has(current) ? current : null));
  }, [navigationGroups, navigationLoading]);

  const currentSessionContext =
    flattenedSessions.find((item) => item.session.sessionId === currentSessionId) ?? null;
  const sessionWorkspaceId =
    currentSessionContext?.workspace.id ??
    (currentSessionId ? sessionWorkspaceMap[currentSessionId] ?? null : null);
  const routeWorkspaceId = resolveRouteWorkspaceId(location.pathname, location.search);
  const explicitWorkspaceId = sessionWorkspaceId ?? routeWorkspaceId ?? selectedWorkspaceId ?? null;
  const currentWorkspaceId =
    explicitWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;
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

  useEffect(() => {
    logPerfDebug("workbench.info_panel_state", {
      infoPanelReady,
      rightCollapsed,
      currentWorkspaceId,
      sessionWorkspaceId,
      currentSessionId
    });
  }, [currentSessionId, currentWorkspaceId, infoPanelReady, rightCollapsed, sessionWorkspaceId]);
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

        return {
          workspace: group.workspace,
          visibleSessions,
          archivedSessions: group.sessions.filter(
            (session) => isArchivedSession(session) && !resolveParentSessionId(session)
          ),
          visibleSessionTree: buildSessionTree(visibleSessions).filter(
            (node) =>
              !favoriteSessionIdSet.has(node.item.sessionId)
              && !someSessionTreeNode(getTreeNodeChildren(node), (session) => favoriteSessionIdSet.has(session.sessionId))
          ),
          childWorktrees: buildWorkspaceSidebarWorktreeNodes(group.childWorktrees, favoriteSessionIdSet),
          isCollapsed: collapsedWorkspaceIdSet.has(group.workspace.id)
        };
      }),
    [collapsedWorkspaceIdSet, favoriteSessionIdSet, navigationGroups]
  );
  const workspaceVisualContextMap = useMemo(
    () => buildWorkspaceVisualContextMap(navigationGroups),
    [navigationGroups]
  );
  const currentWorktreeNode = useMemo(
    () => findNavigationWorktreeNodeByWorkspaceId(navigationGroups, currentWorkspaceId),
    [currentWorkspaceId, navigationGroups]
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
  const currentWorktreeMeta: WorktreeMetaDto | null = currentWorktreeNode?.meta ?? null;
  const currentWorkspaceContext =
    (currentWorkspaceId ? workspaceVisualContextMap[currentWorkspaceId] ?? null : null)
    ?? (currentWorkspaceEntity ? createFallbackWorkspaceVisualContext(currentWorkspaceEntity) : null);
  const currentWorktreeMergeState =
    (currentWorktreeMeta ? worktreeMergeStateById[currentWorktreeMeta.workspaceId] ?? null : null);

  useEffect(() => {
    if (!currentWorktreeMeta) {
      return;
    }

    if (currentWorktreeMeta.lifecycleStatus !== "active" && currentWorktreeMeta.lifecycleStatus !== "merged") {
      return;
    }

    if (
      currentWorktreeMergeState?.preview
      || currentWorktreeMergeState?.loading
      || currentWorktreeMergeState?.error
    ) {
      return;
    }

    void loadWorktreeMergePreview(currentWorktreeMeta.workspaceId);
  }, [currentWorktreeMergeState, currentWorktreeMeta, loadWorktreeMergePreview]);

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
    : isTerminalsRoute(location.pathname)
      ? "terminals"
    : isToolsRoute(location.pathname)
      ? "tools"
    : isSessionsRoute(location.pathname) || isSessionDetailRoute(location.pathname)
      ? "sessions"
        : "workspaces";
  const isMobileConversationFocus =
    isMobileShell && mobileActiveEntry === "sessions" && isSessionDetailRoute(location.pathname);
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
    if (currentSessionId && !isDraftSession) {
      writeStoredValue(LAST_SESSION_PATH_KEY, `${location.pathname}${location.search}`);
    }
  }, [currentSessionId, isDraftSession, location.pathname, location.search]);

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

  function beginResize(side: "left" | "right", startClientX: number) {
    const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;

    function handlePointerMove(event: globalThis.MouseEvent) {
      const delta = event.clientX - startClientX;

      if (side === "left") {
        setLeftPanelWidth(clamp(startWidth + delta, MIN_PANEL_WIDTH, MAX_LEFT_PANEL_WIDTH));
        return;
      }

      setRightPanelWidth(clamp(startWidth - delta, MIN_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH));
    }

    function stopResize() {
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("mouseup", stopResize);
    }

    document.addEventListener("mousemove", handlePointerMove);
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
    if (currentSessionId) {
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

    const storedSessionPath =
      typeof window === "undefined" ? null : window.localStorage.getItem(LAST_SESSION_PATH_KEY);

    // 验证存储的会话路径是否还有效（会话是否还存在于列表中）
    if (storedSessionPath) {
      const storedPathname = storedSessionPath.split("?")[0] ?? storedSessionPath;
      const storedSessionMatch = resolveRouteSessionMatch(storedPathname);

      if (storedSessionMatch) {
        const storedSessionId = storedSessionMatch.sessionId;
        const storedSessionEntry =
          flattenedSessions.find((item) => item.session.sessionId === storedSessionId) ?? null;
        const storedSessionWorkspaceId =
          storedSessionMatch.workspaceId ?? storedSessionEntry?.workspace.id ?? null;
        const sessionExists = storedSessionEntry !== null;

        if (
          sessionExists
          && (!preferredWorkspaceId || storedSessionWorkspaceId === preferredWorkspaceId)
        ) {
          navigate(storedSessionPath);
          return true;
        }
      }
      // 存储的会话已不存在，清除无效的存储
      window.localStorage.removeItem(LAST_SESSION_PATH_KEY);
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
    "--workbench-right-current-width": rightCollapsed ? "0px" : `${rightPanelWidth}px`
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
        activeWorkspaceId={currentWorkspaceId}
        navigationGroups={navigationGroups}
        workspaceContext={currentWorkspaceContext}
        worktreeMeta={currentWorktreeMeta}
        worktreeMergeState={currentWorktreeMergeState}
        onRefreshWorktreeMergePreview={loadWorktreeMergePreview}
        onApplyWorktreeMerge={applyWorktreeMerge}
        onCleanupWorktree={applyWorktreeCleanup}
      />
    );
  const shouldShowAuxiliaryPanel = auxiliaryPanelContent !== null;
  const mobileNavigationPanel = isMobileShell ? (
    <SidebarContent
      workspaceGroups={workspaceSidebarGroups}
      workspaceVisualContextMap={workspaceVisualContextMap}
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
            onNavigateSessions={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              goToMobileSessionsEntry();
            }}
            onNavigateTools={() => {
              setMobileNavOpen(false);
              setMobileInfoOpen(false);
              navigate(
                currentWorkspaceId
                  ? buildWorkspaceToolsPath(currentWorkspaceId)
                  : buildWorkspaceHomePath()
              );
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
          style={shellStyle}
          data-nav-loading={navigationLoading}
          data-left-collapsed={leftCollapsed}
          data-right-collapsed={rightCollapsed}
          data-info-ready={infoPanelReady}
          data-runtime-platform={platform.platform}
          data-os-family={platform.ui.osFamily}
          data-overlay-titlebar={platform.ui.prefersOverlayTitlebar}
        >
          <div className="workbench-body-shell">
            <aside className="workbench-nav surface-card" data-collapsed={leftCollapsed}>
                <SidebarContent
                  workspaceGroups={workspaceSidebarGroups}
                  workspaceVisualContextMap={workspaceVisualContextMap}
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
                  : (event) => beginResize("left", event.clientX)
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
                    aria-label={t("shell.goBack")}
                    title={t("shell.goBack")}
                    onClick={() => navigate(-1)}
                  >
                    <ArrowLeftIcon />
                  </button>
                  <button
                    type="button"
                    className="workbench-nav-toolbar-button workbench-collapsed-button"
                    aria-label={t("shell.goForward")}
                    title={t("shell.goForward")}
                    onClick={() => navigate(1)}
                  >
                    <ArrowRightIcon />
                  </button>
                </div>

                {shouldShowAuxiliaryPanel ? (
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
                  data-collapsed={rightCollapsed}
                  role="separator"
                  aria-label={t("shell.rightResizerLabel")}
                  onMouseDown={
                    rightCollapsed
                      ? undefined
                      : (event) => beginResize("right", event.clientX)
                  }
                />
                <aside
                  className="workbench-auxiliary surface-card"
                  data-workspace-tone={currentWorkspaceContext?.tone ?? "root"}
                  data-worktree-depth={currentWorkspaceContext?.depth ?? 0}
                  data-collapsed={rightCollapsed}
                  data-custom-panel={activeCenterTab === "butler"}
                >
                  {activeCenterTab === "butler" ? (
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
                      activeWorkspaceId={currentWorkspaceId}
                      navigationGroups={navigationGroups}
                      workspaceContext={currentWorkspaceContext}
                      worktreeMeta={currentWorktreeMeta}
                      worktreeMergeState={currentWorktreeMergeState}
                      onRefreshWorktreeMergePreview={loadWorktreeMergePreview}
                      onApplyWorktreeMerge={applyWorktreeMerge}
                      onCleanupWorktree={applyWorktreeCleanup}
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
