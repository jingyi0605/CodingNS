import {
  Suspense,
  useCallback,
  createContext,
  useContext,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";

import {
  WorkbenchRealtimeClient,
  type FileTreeRealtimeSnapshotDto,
  type GitRealtimeSnapshotDto,
  type TerminalManagerRealtimeSnapshotDto
} from "../../../network/workbench-realtime-client";
import { showDesktopContextMenu } from "../../../platform/desktop/desktop-context-menu";
import { usePlatform } from "../../../platform/platform-provider";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { authStore } from "../../auth/store/auth-store";
import {
  browseWorkspaceDirectories,
  cloneWorkspace,
  getWorkbenchSnapshot,
  importWorkspace,
  renameSessionTitle,
  updateSessionArchiveState,
  type ProviderId,
  type SessionSummaryDto,
  type WorkbenchSnapshotDto,
  type WorkspaceDirectoryOptionDto,
  type WorkspaceDto
} from "../api/conversation-api";
import { searchFiles, type FileNodeDto } from "../api/file-context-api";
import { buildSessionTitlePresentation } from "../session-title";

const LEFT_PANEL_WIDTH_KEY = "workbench.left.width";
const RIGHT_PANEL_WIDTH_KEY = "workbench.right.width";
const LEFT_PANEL_COLLAPSED_KEY = "workbench.left.collapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "workbench.right.collapsed";
const LAST_SESSION_PATH_KEY = "workbench.last.session.path";
const WORKSPACE_COLLAPSED_IDS_KEY = "workbench.workspace.collapsed.ids";
const SELECTED_WORKSPACE_ID_KEY = "workbench.workspace.selected.id";
const FAVORITE_SESSION_IDS_KEY = "workbench.session.favorite.ids";
const WORKBENCH_NAVIGATION_SNAPSHOT_KEY = "workbench.navigation.snapshot";

const DEFAULT_LEFT_PANEL_WIDTH = 280;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const MIN_PANEL_WIDTH = 208;
const MAX_LEFT_PANEL_WIDTH = 520;
const MAX_RIGHT_PANEL_WIDTH = 560;
const INFO_PANEL_BOOT_DELAY_MS = 200;
const MOBILE_BREAKPOINT_PX = 720;
const FAVORITE_SESSION_PAGE_SIZE = 20;
const ROOT_SESSION_PAGE_SIZE = 40;
const SUBAGENT_PAGE_SIZE = 5;
const WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";

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
  isCollapsed: boolean;
}

interface NavigationSessionTreeNode {
  session: SessionSummaryDto;
  children: SessionSummaryDto[];
}

interface WorkbenchShellContextValue {
  navigationGroups: WorkspaceSessionGroup[];
  navigationLoading: boolean;
  navigationError: string | null;
  refreshNavigation: () => Promise<void>;
  requestNavigationRefresh: () => void;
  subscribeFileTree: (workspaceId: string, paths: string[]) => void;
  requestFileTreeRefresh: (workspaceId: string, paths?: string[]) => void;
  addFileTreeSnapshotListener: (
    listener: (snapshot: FileTreeRealtimeSnapshotDto) => void
  ) => () => void;
  subscribeGitSnapshot: (workspaceId: string) => void;
  requestGitRefresh: (workspaceId: string) => void;
  addGitSnapshotListener: (listener: (snapshot: GitRealtimeSnapshotDto) => void) => () => void;
  subscribeTerminalManagerSnapshot: (workspaceId: string) => void;
  requestTerminalManagerRefresh: (workspaceId: string) => void;
  addTerminalManagerSnapshotListener: (
    listener: (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  ) => () => void;
  setSessionWorkspace: (sessionId: string, workspaceId: string | null) => void;
  upsertNavigationSession: (session: SessionSummaryDto) => void;
  markNavigationSessionSeen: (sessionId: string, seenAt?: string) => void;
}

interface ImportWorkspaceFormState {
  path: string;
  name: string;
}

interface CloneWorkspaceFormState {
  repositoryUrl: string;
  parentPath: string;
  directoryName: string;
  name: string;
  authMode: "none" | "basic" | "token";
  username: string;
  password: string;
  token: string;
}

type DirectoryBrowserMode = "import" | "clone";

type CenterTab = "conversation" | "terminals";
type InfoTab = "files" | "git" | "terminals";
type SearchMode = "sessions" | "code";

const WorkbenchShellContext = createContext<WorkbenchShellContextValue | null>(null);

function sortSessions(left: SessionSummaryDto, right: SessionSummaryDto) {
  return (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt);
}

function isSubagentSession(session: SessionSummaryDto) {
  return session.isSubagent === true;
}

function isArchivedSession(session: SessionSummaryDto) {
  return session.isArchived === true;
}

function resolveParentSessionId(session: SessionSummaryDto) {
  return session.parentSessionId?.trim() || null;
}

function resolveTopLevelSessionId(
  session: SessionSummaryDto,
  sessionById: ReadonlyMap<string, SessionSummaryDto>
) {
  let currentSession = session;
  const visitedSessionIds = new Set<string>([session.sessionId]);

  while (true) {
    const parentSessionId = resolveParentSessionId(currentSession);

    if (!parentSessionId) {
      return currentSession.sessionId;
    }

    const parentSession = sessionById.get(parentSessionId);

    if (!parentSession) {
      return currentSession.sessionId;
    }

    if (visitedSessionIds.has(parentSession.sessionId)) {
      return session.sessionId;
    }

    visitedSessionIds.add(parentSession.sessionId);
    currentSession = parentSession;
  }
}

function buildSessionTree(sessions: SessionSummaryDto[]) {
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session] as const));
  const childSessionsByRootId = new Map<string, SessionSummaryDto[]>();
  const rootSessions: SessionSummaryDto[] = [];

  for (const session of sessions) {
    const topLevelSessionId = resolveTopLevelSessionId(session, sessionById);

    if (topLevelSessionId === session.sessionId) {
      rootSessions.push(session);
      continue;
    }

    const currentChildren = childSessionsByRootId.get(topLevelSessionId) ?? [];
    childSessionsByRootId.set(topLevelSessionId, [...currentChildren, session]);
  }

  return [...rootSessions]
    .sort(sortSessions)
    .map((session) => ({
      session,
      children: [...(childSessionsByRootId.get(session.sessionId) ?? [])].sort(sortSessions)
    }));
}

function flattenVisibleSessionTree(nodes: NavigationSessionTreeNode[]) {
  return nodes.flatMap((node) => [node.session, ...node.children]);
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
  if (provider === "codex") {
    return t("conversation.providerCodex");
  }

  return mode === "full" ? t("shell.providerClaudeCode") : t("conversation.providerClaude");
}

function buildSessionMeta(
  session: SessionSummaryDto,
  workspace: WorkspaceDto,
  includeWorkspaceName: boolean
) {
  const metaParts: string[] = [];

  if (includeWorkspaceName) {
    metaParts.push(workspace.name);
  }

  const dateLabel = formatSessionMeta(session);

  if (dateLabel) {
    metaParts.push(dateLabel);
  }

  return metaParts.join(" · ") || workspace.name;
}

function sessionStateClassName(session: SessionSummaryDto) {
  if (session.activityState === "running") {
    if (session.activitySource === "inferred") {
      return "session-state-indicator is-running-inferred";
    }

    return "session-state-indicator is-running";
  }

  if (session.activityState === "completed_unread") {
    return "session-state-indicator is-unread";
  }

  return "session-state-indicator is-idle";
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

function readStoredStringArray(key: string) {
  try {
    const raw = window.localStorage.getItem(key);

    if (!raw) {
      return [] as string[];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [] as string[];
    }

    const uniqueValues: string[] = [];

    for (const value of parsed) {
      if (typeof value === "string" && !uniqueValues.includes(value)) {
        uniqueValues.push(value);
      }
    }

    return uniqueValues;
  } catch {
    return [] as string[];
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

function flattenSessions(groups: WorkspaceSessionGroup[]) {
  return groups
    .flatMap((group) =>
      group.sessions.map((session) => ({
        session,
        workspace: group.workspace
      }))
    )
    .sort((left, right) => sortSessions(left.session, right.session));
}

function mapWorkbenchSnapshotToGroups(snapshot: WorkbenchSnapshotDto | null | undefined) {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    return [];
  }

  return snapshot.items.map((item) => ({
    workspace: item.workspace,
    sessions: [...item.sessions].sort(sortSessions)
  }));
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
      return group;
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

    return groupChanged
      ? {
          ...group,
          sessions: nextSessions
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

    return groupChanged
      ? {
          ...group,
          sessions: nextSessions
        }
      : group;
  });

  return changed ? nextGroups : groups;
}

function toggleStoredId(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

function retainKnownIds(items: string[], knownIds: ReadonlySet<string>) {
  const nextItems = items.filter((item) => knownIds.has(item));
  return nextItems.length === items.length ? items : nextItems;
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

function MacTrafficLights() {
  return (
    <div className="macos-traffic-lights" aria-hidden="true">
      <span className="macos-traffic-light close" />
      <span className="macos-traffic-light minimize" />
      <span className="macos-traffic-light maximize" />
    </div>
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

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="5" width="14" height="14" rx="2" />
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

function WorkbenchDesktopTitlebar({
  activeCenterTab,
  currentWorkspaceName,
  currentSessionTitle,
  workspaceCount,
  sessionCount,
  leftCollapsed,
  rightCollapsed,
  isDesktop,
  showTrafficLightsPadding,
  showWindowsControls,
  onNavigateConversation,
  onNavigateTerminals,
  onRefreshNavigation,
  onToggleLeftPanel,
  onToggleRightPanel,
  onOpenSettings,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow
}: {
  activeCenterTab: CenterTab;
  currentWorkspaceName: string | null;
  currentSessionTitle: string | null;
  workspaceCount: number;
  sessionCount: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  isDesktop: boolean;
  showTrafficLightsPadding: boolean;
  showWindowsControls: boolean;
  onNavigateConversation: () => void;
  onNavigateTerminals: () => void;
  onRefreshNavigation: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onOpenSettings: () => void;
  onMinimizeWindow: () => void;
  onToggleMaximizeWindow: () => void;
  onCloseWindow: () => void;
}) {
  const titlePresentation = buildSessionTitlePresentation(
    currentSessionTitle,
    t("workbench.emptyTitle")
  );

  return (
    <header className="workbench-desktop-titlebar surface-card">
      <div
        className={`workbench-titlebar-leading ${showTrafficLightsPadding ? "traffic-lights-offset" : ""}`}
        data-tauri-drag-region={isDesktop ? true : undefined}
      >
        <div className="workbench-titlebar-brand">
          <img src="/logo.svg" alt="CodingNS" className="workbench-titlebar-logo" />
          {isDesktop ? (
            <div className="workbench-titlebar-brand-text">
              <strong>CodingNS</strong>
              <span>{t("shell.desktopChromeLabel")}</span>
            </div>
          ) : null}
        </div>
        <div className="workbench-titlebar-context">
          <span className="workbench-titlebar-pill">
            {currentWorkspaceName ?? t("conversation.headerWorkspaceUnknown")}
          </span>
          <h1
            className="workbench-titlebar-title"
            data-testid="workbench-current-session-title"
            title={titlePresentation.fullTitle}
          >
            {titlePresentation.displayTitle}
          </h1>
        </div>
      </div>

      <div className="workbench-titlebar-center" data-tauri-drag-region={isDesktop ? true : undefined}>
        <div className="workbench-desktop-segment" role="tablist" aria-label={t("shell.centerTabsLabel")}>
          <button
            className={activeCenterTab === "conversation" ? "workbench-topbar-tab active" : "workbench-topbar-tab"}
            type="button"
            role="tab"
            aria-selected={activeCenterTab === "conversation"}
            onClick={onNavigateConversation}
          >
            {t("shell.conversationEntry")}
          </button>
          <button
            className={activeCenterTab === "terminals" ? "workbench-topbar-tab active" : "workbench-topbar-tab"}
            type="button"
            role="tab"
            aria-selected={activeCenterTab === "terminals"}
            onClick={onNavigateTerminals}
          >
            {t("shell.terminalsEntry")}
          </button>
        </div>
      </div>

      <div className="workbench-titlebar-trailing">
        <div className="workbench-titlebar-stats" data-tauri-drag-region={isDesktop ? true : undefined}>
          <span>{t("shell.workspaceCount")} {workspaceCount}</span>
          <span>{t("shell.sessionCount")} {sessionCount}</span>
        </div>
        <div className="workbench-titlebar-actions">
          <button
            type="button"
            className="workbench-toolbar-button"
            aria-pressed={!leftCollapsed}
            aria-label={leftCollapsed ? t("shell.showSessionSidebar") : t("shell.hideSessionSidebar")}
            onClick={onToggleLeftPanel}
            title="Ctrl/Cmd+B"
          >
            <svg
              className="workbench-toolbar-glyph"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <button
            type="button"
            className="workbench-toolbar-button"
            aria-pressed={!rightCollapsed}
            aria-label={rightCollapsed ? t("shell.showInfoSidebar") : t("shell.hideInfoSidebar")}
            onClick={onToggleRightPanel}
            title="Ctrl/Cmd+Shift+I"
          >
            <span className="workbench-toolbar-label">{t("shell.auxiliaryTitle")}</span>
          </button>
          <button
            type="button"
            className="workbench-toolbar-button"
            aria-label={t("shell.refreshNavigation")}
            onClick={onRefreshNavigation}
            title="Ctrl/Cmd+Shift+R"
          >
            <span className="workbench-toolbar-label">{t("shell.refreshNavigation")}</span>
          </button>
          <button
            type="button"
            className="workbench-toolbar-button"
            aria-label={t("settings.title")}
            onClick={onOpenSettings}
            title="Ctrl/Cmd+,"
          >
            <span className="workbench-toolbar-label">{t("settings.title")}</span>
          </button>
        </div>

        {showWindowsControls ? (
          <div className="workbench-window-controls">
            <button type="button" className="workbench-window-control" onClick={onMinimizeWindow} aria-label={t("shell.windowMinimize")}>
              <MinusIcon />
            </button>
            <button type="button" className="workbench-window-control" onClick={onToggleMaximizeWindow} aria-label={t("shell.windowMaximize")}>
              <MaximizeIcon />
            </button>
            <button type="button" className="workbench-window-control close" onClick={onCloseWindow} aria-label={t("shell.windowClose")}>
              <CloseIcon />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function MobileSidebarHandle({
  side,
  isOpen,
  onToggle
}: {
  side: "left" | "right";
  isOpen: boolean;
  onToggle: () => void;
}) {
  const pointerStartRef = useRef<number | null>(null);
  const pointerHandledRef = useRef(false);

  function resetGesture() {
    pointerStartRef.current = null;
    pointerHandledRef.current = false;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    pointerStartRef.current = event.clientX;
    pointerHandledRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (pointerStartRef.current === null || pointerHandledRef.current) {
      return;
    }

    const delta = event.clientX - pointerStartRef.current;
    const shouldToggle =
      side === "left"
        ? (!isOpen && delta >= 28) || (isOpen && delta <= -28)
        : (!isOpen && delta <= -28) || (isOpen && delta >= 28);

    if (!shouldToggle) {
      return;
    }

    pointerHandledRef.current = true;
    onToggle();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!pointerHandledRef.current) {
      onToggle();
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetGesture();
  }

  return (
    <button
      className={`mobile-sidebar-handle ${side} ${isOpen ? "open" : "closed"}`}
      type="button"
      aria-label={
        isOpen
          ? t(`shell.hide${side === "left" ? "Session" : "Info"}Sidebar`)
          : t(`shell.show${side === "left" ? "Session" : "Info"}Sidebar`)
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
    >
      <span className="mobile-sidebar-handle-shape" aria-hidden="true">
        <span className="mobile-sidebar-handle-chevron" />
      </span>
    </button>
  );
}

function SidebarModal({
  open,
  title,
  description,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <section className="workbench-modal-card surface-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            className="workbench-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="workbench-modal-body">{children}</div>
      </section>
    </div>,
    document.body
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
  isActive,
  isFavorite,
  menuOpen,
  showWorkspaceName,
  depth = 0,
  showActions = true,
  selectionMode = false,
  selected = false,
  onToggleSelect,
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
  isActive: boolean;
  isFavorite: boolean;
  menuOpen: boolean;
  showWorkspaceName: boolean;
  depth?: 0 | 1;
  showActions?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpen: () => void;
  onRename: () => void;
  onToggleMenu: () => void;
  onToggleFavorite: () => void;
  onArchive: () => void;
  onCloseMenu: () => void;
  onContextMenu?: () => void;
}) {
  const subagentBadgeLabel =
    session.subagentLabel?.trim() || (isSubagentSession(session) ? t("shell.subagentBadge") : null);
  const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));

  return (
    <article
      className="workbench-session-card"
      data-active={isActive}
      data-depth={depth}
      data-subagent={isSubagentSession(session)}
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
      <button
        type="button"
        className={selectionMode ? "workbench-session-link is-selecting" : "workbench-session-link"}
        data-active={isActive}
        aria-pressed={selectionMode ? selected : undefined}
        onClick={selectionMode ? onToggleSelect : onOpen}
      >
        {selectionMode ? (
          <span className="workbench-session-selection-indicator" data-selected={selected} aria-hidden="true">
            <SelectionMarkerIcon selected={selected} />
          </span>
        ) : null}
        <div className="workbench-session-link-copy">
          <div className="session-title-row">
            <span
              className={sessionStateClassName(session)}
              data-activity-source={session.activitySource}
              aria-hidden="true"
            />
            <span className="session-title" title={titlePresentation.fullTitle}>
              {titlePresentation.displayTitle}
            </span>
            {subagentBadgeLabel ? <span className="session-subagent-badge">{subagentBadgeLabel}</span> : null}
          </div>
          <div className="session-meta-row">
            <span className="session-meta">{buildSessionMeta(session, workspace, showWorkspaceName)}</span>
            <span className={`session-provider-badge ${session.provider}`}>{formatProviderLabel(session.provider)}</span>
          </div>
        </div>
      </button>

      {showActions && !selectionMode ? (
        <div className="workbench-session-actions" data-open={menuOpen}>
        <button
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

        {menuOpen ? (
          <div
            className="workbench-session-menu"
            data-menu-key={menuKey}
            onClick={(event) => event.stopPropagation()}
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
          </div>
        ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SidebarContent({
  workspaceGroups,
  favoriteSessions,
  favoriteSessionIds,
  activeWorkspaceId,
  isConversationActive,
  isTerminalActive,
  isSearchOpen,
  navigationLoading,
  navigationError,
  activeSessionId,
  onRefreshNavigation,
  onSessionUpdated,
  onNavigateConversation,
  onNavigateTerminals,
  onOpenSearch,
  onOpenSettings,
  onSelectWorkspace,
  onToggleWorkspaceCollapse,
  onToggleFavoriteSession,
  onArchiveSession,
  onUnarchiveSession,
  onClose,
  onToggleCollapse
}: {
  workspaceGroups: WorkspaceSidebarGroup[];
  favoriteSessions: NavigationSessionEntry[];
  favoriteSessionIds: ReadonlySet<string>;
  activeWorkspaceId: string | null;
  isConversationActive: boolean;
  isTerminalActive: boolean;
  isSearchOpen: boolean;
  navigationLoading: boolean;
  navigationError: string | null;
  activeSessionId: string | null;
  onRefreshNavigation: () => Promise<void>;
  onSessionUpdated: (session: SessionSummaryDto) => void;
  onNavigateConversation: () => void;
  onNavigateTerminals: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string) => void;
  onToggleFavoriteSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onUnarchiveSession: (sessionId: string) => Promise<void>;
  onClose?: () => void;
  onToggleCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { showToast } = useToast();
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [cloningWorkspace, setCloningWorkspace] = useState(false);
  const [importForm, setImportForm] = useState<ImportWorkspaceFormState>({
    path: "",
    name: ""
  });
  const [cloneWorkspaceOpen, setCloneWorkspaceOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState<CloneWorkspaceFormState>({
    repositoryUrl: "",
    parentPath: "",
    directoryName: "",
    name: "",
    authMode: "none",
    username: "",
    password: "",
    token: ""
  });
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false);
  const [directoryBrowserMode, setDirectoryBrowserMode] = useState<DirectoryBrowserMode>("import");
  const [directoryBrowserLoading, setDirectoryBrowserLoading] = useState(false);
  const [directoryBrowserError, setDirectoryBrowserError] = useState<string | null>(null);
  const [directoryBrowserCurrentPath, setDirectoryBrowserCurrentPath] = useState("");
  const [directoryBrowserInputPath, setDirectoryBrowserInputPath] = useState("");
  const [directoryBrowserParentPath, setDirectoryBrowserParentPath] = useState<string | null>(null);
  const [directoryBrowserRoots, setDirectoryBrowserRoots] = useState<WorkspaceDirectoryOptionDto[]>([]);
  const [directoryBrowserItems, setDirectoryBrowserItems] = useState<WorkspaceDirectoryOptionDto[]>([]);
  const [actionWorkspaceId, setActionWorkspaceId] = useState<string | null>(null);
  const [actionProvider, setActionProvider] = useState<ProviderId | null>(null);
  const [createSessionWorkspaceId, setCreateSessionWorkspaceId] = useState<string | null>(null);
  const [archiveWorkspaceId, setArchiveWorkspaceId] = useState<string | null>(null);
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [visibleFavoriteCount, setVisibleFavoriteCount] = useState(FAVORITE_SESSION_PAGE_SIZE);
  const [visibleWorkspaceSessionCounts, setVisibleWorkspaceSessionCounts] = useState<Record<string, number>>({});
  const [visibleSubagentCounts, setVisibleSubagentCounts] = useState<Record<string, number>>({});
  const [renameTarget, setRenameTarget] = useState<NavigationSessionEntry | null>(null);
  const [renameTitleValue, setRenameTitleValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [batchWorkspaceId, setBatchWorkspaceId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchArchiving, setBatchArchiving] = useState(false);

  const createSessionWorkspace =
    workspaceGroups.find((group) => group.workspace.id === createSessionWorkspaceId)?.workspace ?? null;
  const archiveWorkspaceGroup =
    workspaceGroups.find((group) => group.workspace.id === archiveWorkspaceId) ?? null;
  const activeBatchWorkspaceGroup =
    workspaceGroups.find((group) => group.workspace.id === batchWorkspaceId) ?? null;
  const batchSelectableSessions = useMemo(
    () => (activeBatchWorkspaceGroup ? flattenVisibleSessionTree(activeBatchWorkspaceGroup.visibleSessionTree) : []),
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
  const workspaceActionPending = importingWorkspace || cloningWorkspace;

  const notifyWorkspaceImported = useCallback(
    async (workspacePath: string) => {
      showToast({
        title: t("shell.importSuccess"),
        description: workspacePath,
        tone: "success"
      });
      await platform.bridge.showNotification(t("shell.importSuccess"), workspacePath);
    },
    [platform.bridge, showToast]
  );

  const notifyWorkspaceCloned = useCallback(
    async (workspacePath: string) => {
      showToast({
        title: t("shell.cloneSuccess"),
        description: workspacePath,
        tone: "success"
      });
      await platform.bridge.showNotification(t("shell.cloneSuccess"), workspacePath);
    },
    [platform.bridge, showToast]
  );

  const commitWorkspaceImport = useCallback(
    async (workspacePath: string, workspaceName?: string) => {
      const trimmedPath = workspacePath.trim();

      if (!trimmedPath) {
        return false;
      }

      setImportingWorkspace(true);

      try {
        await importWorkspace({
          path: trimmedPath,
          name: workspaceName?.trim() || undefined
        });
        setImportForm({ path: "", name: "" });
        setDirectoryBrowserOpen(false);
        await onRefreshNavigation();
        await notifyWorkspaceImported(trimmedPath);
        return true;
      } catch (error) {
        showToast({
          title: error instanceof Error ? error.message : t("shell.importFailed"),
          tone: "error"
        });
        return false;
      } finally {
        setImportingWorkspace(false);
      }
    },
    [notifyWorkspaceImported, onRefreshNavigation, showToast]
  );

  const commitWorkspaceClone = useCallback(async () => {
    const repositoryUrl = cloneForm.repositoryUrl.trim();
    const parentPath = cloneForm.parentPath.trim();

    if (!repositoryUrl) {
      showToast({
        title: t("shell.cloneRepoRequired"),
        tone: "error"
      });
      return false;
    }

    if (!parentPath) {
      showToast({
        title: t("shell.clonePathRequired"),
        tone: "error"
      });
      return false;
    }

    setCloningWorkspace(true);

    try {
      const workspace = await cloneWorkspace({
        repositoryUrl,
        parentPath,
        directoryName: cloneForm.directoryName.trim() || undefined,
        name: cloneForm.name.trim() || undefined,
        auth:
          cloneForm.authMode === "none"
            ? { mode: "none" }
            : cloneForm.authMode === "basic"
              ? {
                  mode: "basic",
                  username: cloneForm.username.trim(),
                  password: cloneForm.password
                }
              : {
                  mode: "token",
                  username: cloneForm.username.trim() || undefined,
                  token: cloneForm.token
                }
      });

      setCloneForm({
        repositoryUrl: "",
        parentPath: "",
        directoryName: "",
        name: "",
        authMode: "none",
        username: "",
        password: "",
        token: ""
      });
      setCloneWorkspaceOpen(false);
      setDirectoryBrowserOpen(false);
      await onRefreshNavigation();
      await notifyWorkspaceCloned(workspace.path);
      return true;
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.cloneFailed"),
        tone: "error"
      });
      return false;
    } finally {
      setCloningWorkspace(false);
    }
  }, [cloneForm, notifyWorkspaceCloned, onRefreshNavigation, showToast]);

  useEffect(() => {
    if (!openSessionMenuKey) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest(".workbench-session-actions")) {
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
        const activeRootSessionIndex = group.visibleSessionTree.findIndex(
          (node) =>
            node.session.sessionId === activeSessionId ||
            node.children.some((session) => session.sessionId === activeSessionId)
        );

        next[group.workspace.id] = resolveVisibleItemCount(
          group.visibleSessionTree.length,
          ROOT_SESSION_PAGE_SIZE,
          current[group.workspace.id],
          activeRootSessionIndex
        );
      }

      return isSameVisibleCountRecord(current, next) ? current : next;
    });
  }, [activeSessionId, workspaceGroups]);

  useEffect(() => {
    setVisibleSubagentCounts((current) => {
      const next: Record<string, number> = {};

      for (const group of workspaceGroups) {
        for (const node of group.visibleSessionTree) {
          if (node.children.length === 0) {
            continue;
          }

          const activeChildIndex = node.children.findIndex((session) => session.sessionId === activeSessionId);

          next[node.session.sessionId] = resolveVisibleItemCount(
            node.children.length,
            SUBAGENT_PAGE_SIZE,
            current[node.session.sessionId],
            activeChildIndex
          );
        }
      }

      return isSameVisibleCountRecord(current, next) ? current : next;
    });
  }, [activeSessionId, workspaceGroups]);

  async function loadDirectoryBrowser(targetPath?: string) {
    setDirectoryBrowserLoading(true);
    setDirectoryBrowserError(null);

    try {
      const snapshot = await browseWorkspaceDirectories(targetPath);
      setDirectoryBrowserCurrentPath(snapshot.currentPath);
      setDirectoryBrowserInputPath(snapshot.currentPath);
      setDirectoryBrowserParentPath(snapshot.parentPath);
      setDirectoryBrowserRoots(snapshot.roots);
      setDirectoryBrowserItems(snapshot.items);
      if (directoryBrowserMode === "clone") {
        setCloneForm((current) => ({
          ...current,
          parentPath: snapshot.currentPath
        }));
      } else {
        setImportForm((current) => ({
          ...current,
          path: snapshot.currentPath
        }));
      }
    } catch (error) {
      setDirectoryBrowserCurrentPath("");
      setDirectoryBrowserParentPath(null);
      setDirectoryBrowserItems([]);
      setDirectoryBrowserError(error instanceof Error ? error.message : t("shell.importBrowserBrowseFailed"));
    } finally {
      setDirectoryBrowserLoading(false);
    }
  }

  function handleOpenDirectoryBrowser() {
    setDirectoryBrowserMode("import");
    setDirectoryBrowserOpen(true);
    void loadDirectoryBrowser(importForm.path || undefined);
  }

  function handleOpenCloneWorkspace() {
    setCloneWorkspaceOpen(true);
  }

  function handleCloseCloneWorkspace() {
    if (cloningWorkspace) {
      return;
    }

    setCloneWorkspaceOpen(false);
  }

  function handleOpenCloneDirectoryBrowser() {
    setDirectoryBrowserMode("clone");
    setDirectoryBrowserOpen(true);
    void loadDirectoryBrowser(cloneForm.parentPath || undefined);
  }

  function handleCloseDirectoryBrowser() {
    if (workspaceActionPending) {
      return;
    }

    setDirectoryBrowserOpen(false);
    setDirectoryBrowserError(null);
  }

  async function handleDirectoryBrowserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadDirectoryBrowser(directoryBrowserInputPath);
  }

  async function handleImportCurrentDirectory() {
    await commitWorkspaceImport(directoryBrowserCurrentPath, importForm.name);
  }

  function handleApplyCurrentDirectory() {
    if (directoryBrowserMode === "clone") {
      setCloneForm((current) => ({
        ...current,
        parentPath: directoryBrowserCurrentPath
      }));
      setDirectoryBrowserOpen(false);
      setDirectoryBrowserError(null);
      return;
    }

    void handleImportCurrentDirectory();
  }

  function getVisibleSubagentCount(sessionId: string) {
    return visibleSubagentCounts[sessionId] ?? SUBAGENT_PAGE_SIZE;
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

  function handleToggleFavorite(sessionId: string) {
    const isFavorite = favoriteSessionIds.has(sessionId);
    setOpenSessionMenuKey(null);
    onToggleFavoriteSession(sessionId);
    showToast({
      title: isFavorite ? t("shell.favoriteRemoved") : t("shell.favoriteAdded"),
      tone: "success"
    });
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
          navigate(`/sessions/${entry.session.sessionId}`);
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

  return (
    <>
      <div className="workbench-nav-header">
        <div className="workbench-nav-toolbar">
          {platform.isDesktop && platform.ui.windowControlsStyle === "traffic-lights" ? (
            <MacTrafficLights />
          ) : null}
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
              {visibleFavoriteSessions.map((item) => (
                <SessionCard
                  menuKey={`favorite:${item.session.sessionId}`}
                  key={item.session.sessionId}
                  session={item.session}
                  workspace={item.workspace}
                  isActive={item.session.sessionId === activeSessionId}
                  isFavorite={favoriteSessionIds.has(item.session.sessionId)}
                  menuOpen={openSessionMenuKey === `favorite:${item.session.sessionId}`}
                  showWorkspaceName
                  onOpen={() => {
                    navigate(`/sessions/${item.session.sessionId}`);
                    onClose?.();
                  }}
                  onRename={() => handleOpenRenameSession(item.session, item.workspace)}
                  onToggleMenu={() =>
                    setOpenSessionMenuKey((current) =>
                      current === `favorite:${item.session.sessionId}`
                        ? null
                        : `favorite:${item.session.sessionId}`
                    )
                  }
                  onToggleFavorite={() => handleToggleFavorite(item.session.sessionId)}
                  onArchive={() => handleArchive(item.session.sessionId)}
                  onCloseMenu={() => setOpenSessionMenuKey(null)}
                  onContextMenu={
                    platform.isDesktop
                      ? () => {
                          void handleSessionContextMenu(item);
                        }
                      : undefined
                  }
                />
              ))}
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
                aria-label={importingWorkspace ? t("shell.importSubmitting") : t("shell.importWorkspaceTitle")}
                title={importingWorkspace ? t("shell.importSubmitting") : t("shell.importWorkspaceTitle")}
                disabled={workspaceActionPending}
                onClick={handleOpenDirectoryBrowser}
              >
                <ImportIcon />
              </button>
              <button
                type="button"
                className="workbench-workspace-icon-button"
                aria-label={cloningWorkspace ? t("shell.cloneSubmitting") : t("shell.cloneWorkspaceTitle")}
                title={cloningWorkspace ? t("shell.cloneSubmitting") : t("shell.cloneWorkspaceTitle")}
                disabled={workspaceActionPending}
                onClick={handleOpenCloneWorkspace}
              >
                <CloneIcon />
              </button>
            </div>
          </div>

        {workspaceGroups.map((group) => (
          <section
            key={group.workspace.id}
            className="workbench-workspace-group"
            data-batch-active={batchWorkspaceId === group.workspace.id}
          >
            <div className="workbench-workspace-header minimal">
              <button
                type="button"
                className="workbench-workspace-toggle"
                aria-label={group.isCollapsed ? t("shell.workspaceExpand") : t("shell.workspaceCollapse")}
                onClick={() => onToggleWorkspaceCollapse(group.workspace.id)}
              >
                <ChevronIcon expanded={!group.isCollapsed} />
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

            {!group.isCollapsed ? (
              <>
                <div className="workbench-session-list">
                  {group.visibleSessionTree.length === 0 ? (
                    <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
                  ) : (
                    group.visibleSessionTree
                      .slice(0, getVisibleWorkspaceSessionCount(group.workspace.id))
                      .map((node) => {
                      const visibleChildren = node.children.slice(
                        0,
                        getVisibleSubagentCount(node.session.sessionId)
                      );
                      const hasMoreSubagents = visibleChildren.length < node.children.length;

                      return (
                        <div key={node.session.sessionId} className="workbench-session-tree-node">
                          <SessionCard
                            menuKey={`workspace:${group.workspace.id}:${node.session.sessionId}`}
                            session={node.session}
                            workspace={group.workspace}
                            isActive={node.session.sessionId === activeSessionId}
                            isFavorite={favoriteSessionIds.has(node.session.sessionId)}
                            menuOpen={
                              openSessionMenuKey === `workspace:${group.workspace.id}:${node.session.sessionId}`
                            }
                            showWorkspaceName={false}
                            selectionMode={batchWorkspaceId === group.workspace.id}
                            selected={selectedSessionIdSet.has(node.session.sessionId)}
                            onToggleSelect={() => handleToggleSessionSelection(node.session.sessionId)}
                            onOpen={() => {
                              navigate(`/sessions/${node.session.sessionId}`);
                              onClose?.();
                            }}
                            onRename={() => handleOpenRenameSession(node.session, group.workspace)}
                            onToggleMenu={() =>
                              setOpenSessionMenuKey((current) =>
                                current === `workspace:${group.workspace.id}:${node.session.sessionId}`
                                  ? null
                                  : `workspace:${group.workspace.id}:${node.session.sessionId}`
                              )
                            }
                            onToggleFavorite={() => handleToggleFavorite(node.session.sessionId)}
                            onArchive={() => handleArchive(node.session.sessionId)}
                            onCloseMenu={() => setOpenSessionMenuKey(null)}
                            onContextMenu={
                              platform.isDesktop
                                ? () => {
                                    void handleSessionContextMenu({
                                      session: node.session,
                                      workspace: group.workspace
                                    });
                                  }
                                : undefined
                            }
                          />

                          {node.children.length > 0 ? (
                            <div className="workbench-subsession-list">
                              {visibleChildren.map((session) => (
                                <SessionCard
                                  menuKey={`workspace:${group.workspace.id}:${session.sessionId}`}
                                  key={session.sessionId}
                                  session={session}
                                  workspace={group.workspace}
                                  isActive={session.sessionId === activeSessionId}
                                  isFavorite={false}
                                  menuOpen={false}
                                  showWorkspaceName={false}
                                  depth={1}
                                  showActions={false}
                                  selectionMode={batchWorkspaceId === group.workspace.id}
                                  selected={selectedSessionIdSet.has(session.sessionId)}
                                  onToggleSelect={() => handleToggleSessionSelection(session.sessionId)}
                                  onOpen={() => {
                                    navigate(`/sessions/${session.sessionId}`);
                                    onClose?.();
                                  }}
                                  onRename={() => undefined}
                                  onToggleMenu={() => undefined}
                                  onToggleFavorite={() => undefined}
                                  onArchive={() => undefined}
                                  onCloseMenu={() => undefined}
                                  onContextMenu={
                                    platform.isDesktop
                                      ? () => {
                                          void handleSessionContextMenu({
                                            session,
                                            workspace: group.workspace
                                          });
                                        }
                                      : undefined
                                  }
                                />
                              ))}
                              {hasMoreSubagents ? (
                                <button
                                  type="button"
                                  className="workbench-subsession-expand ghost-button"
                                  onClick={() => handleExpandSubagents(node.session.sessionId)}
                                >
                                  {t("shell.subagentExpandMore")}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        );
                      })
                  )}
                  {group.visibleSessionTree.length > getVisibleWorkspaceSessionCount(group.workspace.id) ? (
                    <button
                      type="button"
                      className="workbench-subsession-expand ghost-button"
                      onClick={() =>
                        handleExpandWorkspaceSessions(group.workspace.id, group.visibleSessionTree.length)
                      }
                    >
                      {t("shell.sessionExpandMore")}
                    </button>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="workbench-archive-folder"
                  onClick={() => setArchiveWorkspaceId(group.workspace.id)}
                >
                  <span className="workbench-archive-folder-main">
                    <FolderArchiveIcon />
                    <span>{t("shell.archiveFolderLabel")}</span>
                  </span>
                  <span className="workbench-section-counter">{group.archivedSessions.length}</span>
                </button>
              </>
            ) : null}
          </section>
        ))}
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
        open={cloneWorkspaceOpen}
        title={t("shell.cloneWorkspaceTitle")}
        description={t("shell.cloneWorkspaceHint")}
        onClose={handleCloseCloneWorkspace}
      >
        <form
          className="workbench-clone-form"
          onSubmit={(event) => {
            event.preventDefault();
            void commitWorkspaceClone();
          }}
        >
          <label className="workbench-modal-field">
            <span>{t("shell.cloneRepositoryLabel")}</span>
            <input
              type="text"
              value={cloneForm.repositoryUrl}
              placeholder={t("shell.cloneRepositoryPlaceholder")}
              onChange={(event) =>
                setCloneForm((current) => ({
                  ...current,
                  repositoryUrl: event.target.value
                }))
              }
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.cloneParentPathLabel")}</span>
            <div className="workbench-modal-inline-field">
              <input
                type="text"
                value={cloneForm.parentPath}
                placeholder={t("shell.cloneParentPathPlaceholder")}
                onChange={(event) =>
                  setCloneForm((current) => ({
                    ...current,
                    parentPath: event.target.value
                  }))
                }
              />
              <button
                type="button"
                className="secondary-button"
                disabled={workspaceActionPending}
                onClick={handleOpenCloneDirectoryBrowser}
              >
                {t("shell.clonePickDirectory")}
              </button>
            </div>
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.cloneDirectoryNameLabel")}</span>
            <input
              type="text"
              value={cloneForm.directoryName}
              placeholder={t("shell.cloneDirectoryNamePlaceholder")}
              onChange={(event) =>
                setCloneForm((current) => ({
                  ...current,
                  directoryName: event.target.value
                }))
              }
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.importNameLabel")}</span>
            <input
              type="text"
              value={cloneForm.name}
              placeholder={t("shell.importNamePlaceholder")}
              onChange={(event) =>
                setCloneForm((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.cloneAuthModeLabel")}</span>
            <select
              value={cloneForm.authMode}
              onChange={(event) =>
                setCloneForm((current) => ({
                  ...current,
                  authMode: event.target.value as CloneWorkspaceFormState["authMode"]
                }))
              }
            >
              <option value="none">{t("shell.cloneAuthModeNone")}</option>
              <option value="basic">{t("shell.cloneAuthModeBasic")}</option>
              <option value="token">{t("shell.cloneAuthModeToken")}</option>
            </select>
          </label>

          {cloneForm.authMode === "basic" ? (
            <>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneUsernameLabel")}</span>
                <input
                  type="text"
                  value={cloneForm.username}
                  placeholder={t("shell.cloneUsernamePlaceholder")}
                  autoComplete="username"
                  onChange={(event) =>
                    setCloneForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                />
              </label>
              <label className="workbench-modal-field">
                <span>{t("shell.clonePasswordLabel")}</span>
                <input
                  type="password"
                  value={cloneForm.password}
                  placeholder={t("shell.clonePasswordPlaceholder")}
                  autoComplete="current-password"
                  onChange={(event) =>
                    setCloneForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          {cloneForm.authMode === "token" ? (
            <>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneUsernameLabel")}</span>
                <input
                  type="text"
                  value={cloneForm.username}
                  placeholder={t("shell.cloneTokenUsernamePlaceholder")}
                  onChange={(event) =>
                    setCloneForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                />
              </label>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneTokenLabel")}</span>
                <input
                  type="password"
                  value={cloneForm.token}
                  placeholder={t("shell.cloneTokenPlaceholder")}
                  onChange={(event) =>
                    setCloneForm((current) => ({
                      ...current,
                      token: event.target.value
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          <p className="workbench-import-hint">{t("shell.cloneHint")}</p>

          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={workspaceActionPending}
              onClick={handleCloseCloneWorkspace}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary-button" disabled={workspaceActionPending}>
              {cloningWorkspace ? t("shell.cloneSubmitting") : t("shell.cloneSubmit")}
            </button>
          </div>
        </form>
      </SidebarModal>

      <SidebarModal
        open={directoryBrowserOpen}
        title={directoryBrowserMode === "clone" ? t("shell.cloneBrowserTitle") : t("shell.importBrowserTitle")}
        description={
          directoryBrowserMode === "clone"
            ? t("shell.cloneBrowserDescription")
            : t("shell.importBrowserDescription")
        }
        onClose={handleCloseDirectoryBrowser}
      >
        <form className="workbench-directory-browser-form" onSubmit={handleDirectoryBrowserSubmit}>
          <label className="workbench-modal-field">
            <span>{t("shell.importBrowserCurrentPath")}</span>
            <input
              type="text"
              value={directoryBrowserInputPath}
              placeholder={t("shell.importPathPlaceholder")}
              onChange={(event) => setDirectoryBrowserInputPath(event.target.value)}
            />
          </label>
          <div className="workbench-directory-browser-toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={directoryBrowserLoading || !directoryBrowserParentPath}
              onClick={() => {
                if (!directoryBrowserParentPath) {
                  return;
                }

                void loadDirectoryBrowser(directoryBrowserParentPath);
              }}
            >
              {t("shell.importBrowserOpenParent")}
            </button>
            <button type="submit" className="secondary-button" disabled={directoryBrowserLoading}>
              {t("shell.importBrowserOpenPath")}
            </button>
          </div>
        </form>

        <section className="workbench-directory-browser-panel">
          <div className="workbench-directory-browser-section">
            <span className="workbench-directory-browser-section-title">{t("shell.importBrowserRoots")}</span>
            <div className="workbench-directory-browser-root-list">
              {directoryBrowserRoots.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workbench-directory-browser-chip"
                  disabled={directoryBrowserLoading}
                  onClick={() => {
                    void loadDirectoryBrowser(item.path);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="workbench-directory-browser-current-path">{directoryBrowserCurrentPath}</div>

          {directoryBrowserError ? (
            <p className="workbench-directory-browser-status status-text" data-tone="error">
              {directoryBrowserError}
            </p>
          ) : null}

          {directoryBrowserLoading ? (
            <p className="workbench-directory-browser-status status-text">{t("common.loading")}</p>
          ) : directoryBrowserItems.length > 0 ? (
            <div className="workbench-directory-browser-list">
              {directoryBrowserItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workbench-directory-browser-item"
                  onClick={() => {
                    void loadDirectoryBrowser(item.path);
                  }}
                >
                  <span className="workbench-directory-browser-item-name">{item.name}</span>
                  <span className="workbench-directory-browser-item-path">{item.path}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="workbench-directory-browser-status status-text">{t("shell.importBrowserEmpty")}</p>
          )}
        </section>

        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={workspaceActionPending}
            onClick={handleCloseDirectoryBrowser}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={workspaceActionPending || directoryBrowserLoading || !directoryBrowserCurrentPath}
            onClick={handleApplyCurrentDirectory}
          >
            {directoryBrowserMode === "clone"
              ? t("shell.cloneBrowserSubmit")
              : importingWorkspace
                ? t("shell.importSubmitting")
                : t("shell.importBrowserSubmit")}
          </button>
        </div>
      </SidebarModal>

      <SidebarModal
        open={createSessionWorkspace !== null}
        title={t("shell.createSessionModalTitle")}
        description={
          createSessionWorkspace
            ? `${t("shell.createSessionTarget")} · ${createSessionWorkspace.name}`
            : t("shell.createSessionModalDescription")
        }
        onClose={() => setCreateSessionWorkspaceId(null)}
      >
        <div className="workbench-provider-grid">
          <button
            type="button"
            className="workbench-provider-option"
            disabled={Boolean(actionWorkspaceId)}
            onClick={() =>
              createSessionWorkspace
                ? void handleStartSession(createSessionWorkspace.id, "codex")
                : undefined
            }
          >
            <span className="workbench-provider-badge">{formatProviderLabel("codex", "full")}</span>
            <strong>{formatProviderLabel("codex", "full")}</strong>
            <p>{t("shell.providerCodexDescription")}</p>
            <span className="workbench-provider-hint">
              {actionWorkspaceId === createSessionWorkspace?.id && actionProvider === "codex"
                ? t("shell.startingSession")
                : t("shell.providerOptionHint")}
            </span>
          </button>

          <button
            type="button"
            className="workbench-provider-option"
            disabled={Boolean(actionWorkspaceId)}
            onClick={() =>
              createSessionWorkspace
                ? void handleStartSession(createSessionWorkspace.id, "claude-code")
                : undefined
            }
          >
            <span className="workbench-provider-badge">
              {formatProviderLabel("claude-code", "full")}
            </span>
            <strong>{formatProviderLabel("claude-code", "full")}</strong>
            <p>{t("shell.providerClaudeDescription")}</p>
            <span className="workbench-provider-hint">
              {actionWorkspaceId === createSessionWorkspace?.id &&
              actionProvider === "claude-code"
                ? t("shell.startingSession")
                : t("shell.providerOptionHint")}
            </span>
          </button>
        </div>
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
  onTabChange,
  onToggleCollapse,
  currentSessionId,
  activeWorkspaceId,
  navigationGroups
}: {
  panelReady: boolean;
  activeTab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
  onToggleCollapse?: () => void;
  currentSessionId: string | null;
  activeWorkspaceId: string | null;
  navigationGroups: WorkspaceSessionGroup[];
}) {
  const fallbackWorkspaceId = activeWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;

  return (
    <>
      <div className="workbench-auxiliary-header">
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
        <div className="workbench-info-tabs" role="tablist" aria-label={t("shell.infoTabsLabel")}>
          <button
            className={activeTab === "files" ? "workbench-info-tab active" : "workbench-info-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === "files"}
            onClick={() => onTabChange("files")}
          >
            {t("shell.filesEntry")}
          </button>
          <button
            className={activeTab === "git" ? "workbench-info-tab active" : "workbench-info-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === "git"}
            onClick={() => onTabChange("git")}
          >
            {t("shell.gitEntry")}
          </button>
          <button
            className={activeTab === "terminals" ? "workbench-info-tab active" : "workbench-info-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === "terminals"}
            onClick={() => onTabChange("terminals")}
          >
            {t("shell.terminalManagerEntry")}
          </button>
        </div>
      </div>

      <div className="workbench-auxiliary-body">
        {!panelReady ? <InfoPanelSkeleton /> : null}

        {panelReady && activeTab === "files" ? (
          activeWorkspaceId ? (
            <Suspense fallback={<InfoPanelSkeleton />}>
              <LazyFileContextPanel
                sessionId={currentSessionId}
                workspaceId={activeWorkspaceId}
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

export function WorkbenchLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const platform = usePlatform();
  const { showToast } = useToast();
  const initialWorkbenchSnapshotRef = useRef<WorkbenchSnapshotDto | null>(readCachedWorkbenchSnapshot());
  const requestIdRef = useRef(0);
  const hasNavigationDataRef = useRef(
    (initialWorkbenchSnapshotRef.current?.items?.length ?? 0) > 0
  );
  const hasReceivedWorkbenchSnapshotRef = useRef(false);
  const lastDraftSessionPathRef = useRef<string | null>(null);
  const navigationBootstrapFallbackTimerRef = useRef<number | null>(null);
  const workbenchRealtimeClientRef = useRef<WorkbenchRealtimeClient | null>(null);
  const fileTreeSnapshotListenersRef = useRef(new Set<(snapshot: FileTreeRealtimeSnapshotDto) => void>());
  const gitSnapshotListenersRef = useRef(new Set<(snapshot: GitRealtimeSnapshotDto) => void>());
  const terminalManagerSnapshotListenersRef = useRef(
    new Set<(snapshot: TerminalManagerRealtimeSnapshotDto) => void>()
  );
  const fileTreeSubscriptionRef = useRef<{ workspaceId: string; paths: string[] } | null>(null);
  const pendingFileTreeRefreshRef = useRef<{ workspaceId: string; paths?: string[] } | null>(null);
  const gitWorkspaceSubscriptionRef = useRef<string | null>(null);
  const pendingGitRefreshWorkspaceIdRef = useRef<string | null>(null);
  const terminalManagerWorkspaceSubscriptionRef = useRef<string | null>(null);
  const pendingTerminalManagerRefreshWorkspaceIdRef = useRef<string | null>(null);
  const showToastRef = useRef(showToast);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>(() =>
    mapWorkbenchSnapshotToGroups(initialWorkbenchSnapshotRef.current)
  );
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
    readStoredStringArray(WORKSPACE_COLLAPSED_IDS_KEY)
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() =>
    readStoredString(SELECTED_WORKSPACE_ID_KEY)
  );
  const [favoriteSessionIds, setFavoriteSessionIds] = useState(() =>
    readStoredStringArray(FAVORITE_SESSION_IDS_KEY)
  );
  const [infoPanelReady, setInfoPanelReady] = useState(false);
  const [activeInfoTab, setActiveInfoTab] = useState<InfoTab>("files");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT_PX : false
  );
  const [sessionWorkspaceMap, setSessionWorkspaceMap] = useState<Record<string, string>>({});
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("sessions");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchWorkspaceId, setSearchWorkspaceId] = useState("");
  const [codeSearchLoading, setCodeSearchLoading] = useState(false);
  const [codeSearchError, setCodeSearchError] = useState<string | null>(null);
  const [codeSearchResults, setCodeSearchResults] = useState<FileNodeDto[]>([]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

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

    logPerfDebug("workbench.apply_snapshot", {
      workspaceCount: snapshot.items.length,
      sessionCount: snapshot.items.reduce((total, item) => total + item.sessions.length, 0),
      currentSessionId: matchPath("/sessions/:sessionId", location.pathname)?.params.sessionId ?? null
    });

    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, snapshot);
    setNavigationGroups(mapWorkbenchSnapshotToGroups(snapshot));
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
    setNavigationGroups((current) => upsertSessionIntoGroups(current, session));
  }, []);

  const requestNavigationRefresh = useCallback(() => {
    workbenchRealtimeClientRef.current?.requestRefresh();
  }, []);

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
      setNavigationGroups((current) =>
        updateSessionArchivedStateInGroups(current, sessionId, isArchived)
      );

      try {
        const session = await updateSessionArchiveState(sessionId, isArchived);
        upsertNavigationSession(session);
        requestNavigationRefresh();
      } catch (error) {
        setNavigationGroups((current) =>
          updateSessionArchivedStateInGroups(current, sessionId, !isArchived)
        );
        throw error;
      }
    },
    [requestNavigationRefresh, upsertNavigationSession]
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

      logPerfDebug("workbench.refresh_navigation.fallback_triggered");
      void refreshNavigation();
    }, 1200);

    const client = new WorkbenchRealtimeClient({
      onConnectionChange: (connectionState) => {
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
        gitSnapshotListenersRef.current.forEach((listener) => listener(snapshot));
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
    const terminalManagerWorkspaceSubscription = terminalManagerWorkspaceSubscriptionRef.current;
    const pendingTerminalManagerRefreshWorkspaceId =
      pendingTerminalManagerRefreshWorkspaceIdRef.current;

    if (fileTreeSubscription) {
      client.subscribeFileTree(fileTreeSubscription.workspaceId, fileTreeSubscription.paths);
    }

    if (gitWorkspaceSubscription) {
      client.subscribeGit(gitWorkspaceSubscription);
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
  }, [navigate, refreshNavigation]);

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
    writeStoredValue(WORKSPACE_COLLAPSED_IDS_KEY, JSON.stringify(collapsedWorkspaceIds));
  }, [collapsedWorkspaceIds]);

  useEffect(() => {
    writeStoredValue(FAVORITE_SESSION_IDS_KEY, JSON.stringify(favoriteSessionIds));
  }, [favoriteSessionIds]);

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

  const sessionMatch = matchPath("/sessions/:sessionId", location.pathname);
  const currentSessionId = sessionMatch?.params.sessionId ?? null;
  const isDraftSession = currentSessionId ? isDraftSessionId(currentSessionId) : false;
  const flattenedSessions = useMemo(() => flattenSessions(navigationGroups), [navigationGroups]);
  const collapsedWorkspaceIdSet = useMemo(() => new Set(collapsedWorkspaceIds), [collapsedWorkspaceIds]);
  const favoriteSessionIdSet = useMemo(() => new Set(favoriteSessionIds), [favoriteSessionIds]);

  useEffect(() => {
    if (navigationLoading && navigationGroups.length === 0) {
      return;
    }

    const knownWorkspaceIds = new Set(navigationGroups.map((group) => group.workspace.id));
    const knownSessionIds = new Set(flattenedSessions.map((item) => item.session.sessionId));

    // 只保留当前快照里还存在的偏好状态，避免历史垃圾状态越积越多。
    setCollapsedWorkspaceIds((current) => retainKnownIds(current, knownWorkspaceIds));
    setFavoriteSessionIds((current) => retainKnownIds(current, knownSessionIds));
    setSelectedWorkspaceId((current) => (current && knownWorkspaceIds.has(current) ? current : null));
  }, [flattenedSessions, navigationGroups, navigationLoading]);

  const currentSessionContext =
    flattenedSessions.find((item) => item.session.sessionId === currentSessionId) ?? null;
  const sessionWorkspaceId =
    currentSessionContext?.workspace.id ??
    (currentSessionId ? sessionWorkspaceMap[currentSessionId] ?? null : null);
  const currentWorkspaceId =
    sessionWorkspaceId ?? selectedWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;

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
      currentWorkspaceId,
      source: sessionWorkspaceId
        ? currentSessionContext
          ? "navigation"
          : "sessionWorkspaceMap"
        : selectedWorkspaceId
          ? "workspaceSelection"
          : "navigationFallback"
    });
  }, [currentSessionContext, currentSessionId, currentWorkspaceId, selectedWorkspaceId, sessionWorkspaceId]);

  useEffect(() => {
    logPerfDebug("workbench.info_panel_state", {
      infoPanelReady,
      rightCollapsed,
      currentWorkspaceId,
      sessionWorkspaceId,
      currentSessionId
    });
  }, [currentSessionId, currentWorkspaceId, infoPanelReady, rightCollapsed, sessionWorkspaceId]);
  const activeCenterTab: CenterTab = location.pathname.startsWith("/terminals")
    ? "terminals"
    : "conversation";

  const workspaceSidebarGroups = useMemo(
    () =>
      navigationGroups.map((group) => ({
        workspace: group.workspace,
        visibleSessions: group.sessions.filter((session) => !isArchivedSession(session)),
        archivedSessions: group.sessions.filter((session) => isArchivedSession(session)),
        visibleSessionTree: buildSessionTree(
          group.sessions.filter((session) => {
            if (isArchivedSession(session)) {
              return false;
            }

            const parentSessionId = resolveParentSessionId(session);

            if (!parentSessionId) {
              return true;
            }

            const parentSession = group.sessions.find((item) => item.sessionId === parentSessionId);
            return !parentSession || !isArchivedSession(parentSession);
          })
        ),
        isCollapsed: collapsedWorkspaceIdSet.has(group.workspace.id)
      })),
    [collapsedWorkspaceIdSet, navigationGroups]
  );

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
    if (typeof window === "undefined") {
      return;
    }

    function handleResize() {
      setIsMobileViewport(window.innerWidth <= MOBILE_BREAKPOINT_PX);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (isMobileViewport) {
      return;
    }

    setMobileNavOpen(false);
    setMobileInfoOpen(false);
  }, [isMobileViewport]);

  function openLeftPanel() {
    if (isMobileViewport) {
      setMobileNavOpen(true);
      return;
    }

    setLeftCollapsed(false);
  }

  function openRightPanel() {
    ensureInfoPanelReady();

    if (isMobileViewport) {
      setMobileInfoOpen(true);
      return;
    }

    setRightCollapsed(false);
  }

  function toggleLeftPanel() {
    if (isMobileViewport) {
      setMobileNavOpen((current) => !current);
      return;
    }

    setLeftCollapsed((current) => !current);
  }

  function toggleRightPanel() {
    ensureInfoPanelReady();

    if (isMobileViewport) {
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
      navigate("/");
    }
  }

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

    function handlePointerMove(event: MouseEvent) {
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
    if (currentSessionId) {
      navigate(`${location.pathname}${location.search}`);
      return;
    }

    if (lastDraftSessionPathRef.current) {
      navigate(lastDraftSessionPathRef.current);
      return;
    }

    const storedSessionPath =
      typeof window === "undefined" ? null : window.localStorage.getItem(LAST_SESSION_PATH_KEY);

    // 验证存储的会话路径是否还有效（会话是否还存在于列表中）
    if (storedSessionPath) {
      const match = storedSessionPath.match(/^\/sessions\/([^/]+)$/);
      if (match) {
        const storedSessionId = match[1];
        const sessionExists = flattenedSessions.some(
          (item) => item.session.sessionId === storedSessionId
        );
        if (sessionExists) {
          navigate(storedSessionPath);
          return;
        }
      }
      // 存储的会话已不存在，清除无效的存储
      window.localStorage.removeItem(LAST_SESSION_PATH_KEY);
    }

    // 如果没有任何会话记录，导航到空白页
    if (flattenedSessions.length === 0) {
      navigate("/");
      return;
    }

    const fallbackSessionPath = `/sessions/${flattenedSessions[0].session.sessionId}`;
    navigate(fallbackSessionPath);
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
        navigate("/terminals");
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
  }, [navigate, refreshNavigation, isMobileViewport, goToConversationTab]);

  const contextValue = useMemo<WorkbenchShellContextValue>(
    () => ({
      navigationGroups,
      navigationLoading,
      navigationError,
      refreshNavigation,
      requestNavigationRefresh,
      subscribeFileTree,
      requestFileTreeRefresh,
      addFileTreeSnapshotListener,
      subscribeGitSnapshot,
      requestGitRefresh,
      addGitSnapshotListener,
      subscribeTerminalManagerSnapshot,
      requestTerminalManagerRefresh,
      addTerminalManagerSnapshotListener,
      markNavigationSessionSeen,
      upsertNavigationSession,
      setSessionWorkspace
    }),
    [
      addFileTreeSnapshotListener,
      addGitSnapshotListener,
      addTerminalManagerSnapshotListener,
      markNavigationSessionSeen,
      navigationError,
      navigationGroups,
      navigationLoading,
      requestFileTreeRefresh,
      requestGitRefresh,
      refreshNavigation,
      requestNavigationRefresh,
      requestTerminalManagerRefresh,
      setSessionWorkspace,
      subscribeFileTree,
      subscribeGitSnapshot,
      subscribeTerminalManagerSnapshot,
      upsertNavigationSession
    ]
  );

  const shellStyle = {
    "--workbench-left-width": `${leftPanelWidth}px`,
    "--workbench-left-current-width": leftCollapsed ? "0px" : `${leftPanelWidth}px`,
    "--workbench-right-width": `${rightPanelWidth}px`,
    "--workbench-right-current-width": rightCollapsed ? "0px" : `${rightPanelWidth}px`
  } as CSSProperties;

  return (
    <WorkbenchShellContext.Provider value={contextValue}>
      <div
        className="workbench-shell"
        style={shellStyle}
        data-nav-loading={navigationLoading}
        data-left-collapsed={leftCollapsed}
        data-right-collapsed={rightCollapsed}
        data-info-ready={infoPanelReady}
        data-runtime-platform={platform.platform}
        data-os-family={platform.ui.osFamily}
      >
        <div className="workbench-body-shell">
          {!isMobileViewport ? (
            <>
              <aside className="workbench-nav surface-card" data-collapsed={leftCollapsed}>
                <SidebarContent
                  workspaceGroups={workspaceSidebarGroups}
                  favoriteSessions={favoriteSessions}
                  favoriteSessionIds={favoriteSessionIdSet}
                  activeWorkspaceId={currentWorkspaceId}
                  isConversationActive={activeCenterTab === "conversation"}
                  isTerminalActive={activeCenterTab === "terminals"}
                  isSearchOpen={searchModalOpen}
                  navigationLoading={navigationLoading}
                  navigationError={navigationError}
                  activeSessionId={currentSessionId}
                  onRefreshNavigation={refreshNavigation}
                  onSessionUpdated={upsertNavigationSession}
                  onNavigateConversation={goToConversationTab}
                  onNavigateTerminals={() => navigate("/terminals")}
                  onOpenSearch={() => openSearchModal()}
                  onOpenSettings={() => navigate("/settings")}
                  onSelectWorkspace={handleSelectWorkspace}
                  onToggleWorkspaceCollapse={(workspaceId) =>
                    setCollapsedWorkspaceIds((current) => toggleStoredId(current, workspaceId))
                  }
                  onToggleFavoriteSession={(sessionId) =>
                    setFavoriteSessionIds((current) => toggleStoredId(current, sessionId))
                  }
                  onArchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, true)}
                  onUnarchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, false)}
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
            </>
          ) : null}

          <div className="workbench-main-shell">
            {!isMobileViewport ? (
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
              </div>
            ) : null}

            <Outlet />
          </div>

          {!isMobileViewport ? (
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
              <aside className="workbench-auxiliary surface-card" data-collapsed={rightCollapsed}>
                <WorkbenchInfoPanel
                  panelReady={infoPanelReady}
                  activeTab={activeInfoTab}
                  onTabChange={(tab) => {
                    ensureInfoPanelReady();
                    setActiveInfoTab(tab);
                  }}
                  onToggleCollapse={() => setRightCollapsed(true)}
                  currentSessionId={isDraftSession ? null : currentSessionId}
                  activeWorkspaceId={currentWorkspaceId}
                  navigationGroups={navigationGroups}
                />
              </aside>
            </>
          ) : null}
        </div>

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
            navigate(`/sessions/${sessionId}`);
          }}
        />

        {isMobileViewport ? (
          <>
            {!mobileInfoOpen ? (
              <MobileSidebarHandle
                side="left"
                isOpen={mobileNavOpen}
                onToggle={() => {
                  if (mobileNavOpen) {
                    setMobileNavOpen(false);
                    return;
                  }

                  setMobileInfoOpen(false);
                  setMobileNavOpen(true);
                }}
              />
            ) : null}
            {!mobileNavOpen ? (
              <MobileSidebarHandle
                side="right"
                isOpen={mobileInfoOpen}
                onToggle={() => {
                  ensureInfoPanelReady();

                  if (mobileInfoOpen) {
                    setMobileInfoOpen(false);
                    return;
                  }

                  setMobileNavOpen(false);
                  setMobileInfoOpen(true);
                }}
              />
            ) : null}
          </>
        ) : null}

        <MobileNavDrawer isOpen={mobileNavOpen} side="left" onClose={() => setMobileNavOpen(false)}>
          <SidebarContent
            workspaceGroups={workspaceSidebarGroups}
            favoriteSessions={favoriteSessions}
            favoriteSessionIds={favoriteSessionIdSet}
            activeWorkspaceId={currentWorkspaceId}
            isConversationActive={activeCenterTab === "conversation"}
            isTerminalActive={activeCenterTab === "terminals"}
            isSearchOpen={searchModalOpen}
            navigationLoading={navigationLoading}
            navigationError={navigationError}
            activeSessionId={currentSessionId}
            onRefreshNavigation={refreshNavigation}
            onSessionUpdated={upsertNavigationSession}
            onNavigateConversation={goToConversationTab}
            onNavigateTerminals={() => {
              setMobileNavOpen(false);
              navigate("/terminals");
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
            onToggleWorkspaceCollapse={(workspaceId) =>
              setCollapsedWorkspaceIds((current) => toggleStoredId(current, workspaceId))
            }
            onToggleFavoriteSession={(sessionId) =>
              setFavoriteSessionIds((current) => toggleStoredId(current, sessionId))
            }
            onArchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, true)}
            onUnarchiveSession={(sessionId) => commitNavigationArchiveState(sessionId, false)}
            onClose={() => setMobileNavOpen(false)}
          />
        </MobileNavDrawer>

        <MobileNavDrawer isOpen={mobileInfoOpen} side="right" onClose={() => setMobileInfoOpen(false)}>
          <WorkbenchInfoPanel
            panelReady={infoPanelReady}
            activeTab={activeInfoTab}
            onTabChange={(tab) => {
              ensureInfoPanelReady();
              setActiveInfoTab(tab);
            }}
            currentSessionId={isDraftSession ? null : currentSessionId}
            activeWorkspaceId={currentWorkspaceId}
            navigationGroups={navigationGroups}
          />
        </MobileNavDrawer>
      </div>
    </WorkbenchShellContext.Provider>
  );
}

function MobileNavDrawer({
  isOpen,
  side,
  onClose,
  children
}: {
  isOpen: boolean;
  side: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="mobile-nav-overlay open"
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
      <div className={`mobile-nav-drawer ${side} open`}>{children}</div>
    </>
  );
}

export function useWorkbenchShell() {
  const context = useContext(WorkbenchShellContext);
  return (
    context ?? {
      navigationGroups: [],
      navigationLoading: false,
      navigationError: null,
      refreshNavigation: async () => undefined,
      requestNavigationRefresh: () => undefined,
      subscribeFileTree: () => undefined,
      requestFileTreeRefresh: () => undefined,
      addFileTreeSnapshotListener: () => () => undefined,
      subscribeGitSnapshot: () => undefined,
      requestGitRefresh: () => undefined,
      addGitSnapshotListener: () => () => undefined,
      subscribeTerminalManagerSnapshot: () => undefined,
      requestTerminalManagerRefresh: () => undefined,
      addTerminalManagerSnapshotListener: () => () => undefined,
      setSessionWorkspace: () => undefined,
      upsertNavigationSession: () => undefined,
      markNavigationSessionSeen: () => undefined
    }
  );
}

function buildDraftSessionPath(workspaceId: string, provider: ProviderId): string {
  const draftId = createDraftSessionId();
  const search = new URLSearchParams({
    workspaceId,
    provider
  });

  return `/sessions/${draftId}?${search.toString()}`;
}

function createDraftSessionId(): string {
  const nativeCrypto = globalThis.crypto;

  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return `draft-${nativeCrypto.randomUUID()}`;
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isDraftSessionId(sessionId: string): boolean {
  return sessionId.startsWith("draft-");
}
