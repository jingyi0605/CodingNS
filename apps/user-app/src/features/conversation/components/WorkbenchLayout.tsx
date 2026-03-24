import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";

import { WorkbenchRealtimeClient } from "../../../network/workbench-realtime-client";
import { t } from "../../../shared/i18n";
import { ThemeSwitcher } from "../../../shared/theme";
import { useToast } from "../../../shared/toast";
import { authStore } from "../../auth/store/auth-store";
import { TerminalManagerPanel } from "../../workbench/components/TerminalManagerPanel";
import { FileContextPanel } from "./FileContextPanel";
import { GitSidebar } from "./GitSidebar";
import {
  getWorkbenchSnapshot,
  importWorkspace,
  renameSessionTitle,
  updateSessionArchiveState,
  type ProviderId,
  type SessionSummaryDto,
  type WorkspaceDto
} from "../api/conversation-api";

const LEFT_PANEL_WIDTH_KEY = "workbench.left.width";
const RIGHT_PANEL_WIDTH_KEY = "workbench.right.width";
const LEFT_PANEL_COLLAPSED_KEY = "workbench.left.collapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "workbench.right.collapsed";
const LAST_SESSION_PATH_KEY = "workbench.last.session.path";
const WORKSPACE_COLLAPSED_IDS_KEY = "workbench.workspace.collapsed.ids";
const FAVORITE_SESSION_IDS_KEY = "workbench.session.favorite.ids";

const DEFAULT_LEFT_PANEL_WIDTH = 300;
const DEFAULT_RIGHT_PANEL_WIDTH = 340;
const MIN_PANEL_WIDTH = 220;
const MAX_LEFT_PANEL_WIDTH = 520;
const MAX_RIGHT_PANEL_WIDTH = 560;
const INFO_PANEL_BOOT_DELAY_MS = 250;
const MOBILE_BREAKPOINT_PX = 720;
const SUBAGENT_PAGE_SIZE = 5;

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
  setSessionWorkspace: (sessionId: string, workspaceId: string | null) => void;
  upsertNavigationSession: (session: SessionSummaryDto) => void;
  markNavigationSessionSeen: (sessionId: string, seenAt?: string) => void;
}

interface ImportWorkspaceFormState {
  path: string;
  name: string;
}

type CenterTab = "conversation" | "terminals";
type InfoTab = "files" | "git" | "terminals";

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

function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 忽略隐私模式或测试环境里的本地存储失败。
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function SidebarHamburgerButton({
  ariaLabel,
  className = "panel-icon-button",
  onClick
}: {
  ariaLabel: string;
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
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

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
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

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
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
  onOpen,
  onRename,
  onToggleMenu,
  onToggleFavorite,
  onArchive,
  onCloseMenu
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
  onOpen: () => void;
  onRename: () => void;
  onToggleMenu: () => void;
  onToggleFavorite: () => void;
  onArchive: () => void;
  onCloseMenu: () => void;
}) {
  const subagentBadgeLabel =
    session.subagentLabel?.trim() || (isSubagentSession(session) ? t("shell.subagentBadge") : null);

  return (
    <article
      className="workbench-session-card"
      data-active={isActive}
      data-depth={depth}
      data-subagent={isSubagentSession(session)}
    >
      <button type="button" className="workbench-session-link" data-active={isActive} onClick={onOpen}>
        <div className="session-title-row">
          <span
            className={sessionStateClassName(session)}
            data-activity-source={session.activitySource}
            aria-hidden="true"
          />
          <span className="session-title">{session.title || t("common.unknown")}</span>
          {subagentBadgeLabel ? <span className="session-subagent-badge">{subagentBadgeLabel}</span> : null}
        </div>
        <div className="session-meta-row">
          <span className="session-meta">{buildSessionMeta(session, workspace, showWorkspaceName)}</span>
          <span className={`session-provider-badge ${session.provider}`}>{formatProviderLabel(session.provider)}</span>
        </div>
      </button>

      {showActions ? (
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
  workspaceCount,
  sessionCount,
  navigationLoading,
  navigationError,
  activeSessionId,
  onRefreshNavigation,
  onSessionUpdated,
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
  workspaceCount: number;
  sessionCount: number;
  navigationLoading: boolean;
  navigationError: string | null;
  activeSessionId: string | null;
  onRefreshNavigation: () => Promise<void>;
  onSessionUpdated: (session: SessionSummaryDto) => void;
  onToggleWorkspaceCollapse: (workspaceId: string) => void;
  onToggleFavoriteSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onUnarchiveSession: (sessionId: string) => Promise<void>;
  onClose?: () => void;
  onToggleCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [importExpanded, setImportExpanded] = useState(false);
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [importForm, setImportForm] = useState<ImportWorkspaceFormState>({
    path: "",
    name: ""
  });
  const [actionWorkspaceId, setActionWorkspaceId] = useState<string | null>(null);
  const [actionProvider, setActionProvider] = useState<ProviderId | null>(null);
  const [createSessionWorkspaceId, setCreateSessionWorkspaceId] = useState<string | null>(null);
  const [archiveWorkspaceId, setArchiveWorkspaceId] = useState<string | null>(null);
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [visibleSubagentCounts, setVisibleSubagentCounts] = useState<Record<string, number>>({});
  const [renameTarget, setRenameTarget] = useState<NavigationSessionEntry | null>(null);
  const [renameTitleValue, setRenameTitleValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);

  const createSessionWorkspace =
    workspaceGroups.find((group) => group.workspace.id === createSessionWorkspaceId)?.workspace ?? null;
  const archiveWorkspaceGroup =
    workspaceGroups.find((group) => group.workspace.id === archiveWorkspaceId) ?? null;

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

  async function handleImportWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPath = importForm.path.trim();

    if (!trimmedPath) {
      return;
    }

    setImportingWorkspace(true);

    try {
      await importWorkspace({
        path: trimmedPath,
        name: importForm.name.trim() || undefined
      });
      setImportForm({ path: "", name: "" });
      setImportExpanded(false);
      await onRefreshNavigation();
      showToast({
        title: t("shell.importSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.importFailed"),
        tone: "error"
      });
    } finally {
      setImportingWorkspace(false);
    }
  }

  function getVisibleSubagentCount(sessionId: string) {
    return visibleSubagentCounts[sessionId] ?? SUBAGENT_PAGE_SIZE;
  }

  function handleExpandSubagents(sessionId: string) {
    setVisibleSubagentCounts((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? SUBAGENT_PAGE_SIZE) + SUBAGENT_PAGE_SIZE
    }));
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

  return (
    <>
      <div className="workbench-nav-header">
        <div className="workbench-nav-header-main">
          <h1>{t("shell.title")}</h1>
          <p className="status-text">{t("shell.subtitle")}</p>
        </div>
        {onToggleCollapse ? (
          <SidebarHamburgerButton ariaLabel={t("shell.hideSessionSidebar")} onClick={onToggleCollapse} />
        ) : null}
      </div>

      <div className="workbench-nav-body">
        <section className="workbench-import-card minimal">
          <button
            type="button"
            className="workbench-import-toggle"
            onClick={() => setImportExpanded((current) => !current)}
          >
            <span>{t("shell.importWorkspaceTitle")}</span>
            <ChevronIcon expanded={importExpanded} />
          </button>

          {importExpanded ? (
            <form className="workbench-import-form" onSubmit={handleImportWorkspace}>
              <input
                type="text"
                value={importForm.path}
                placeholder={t("shell.importPathPlaceholder")}
                onChange={(event) =>
                  setImportForm((current) => ({ ...current, path: event.target.value }))
                }
              />
              <button
                className="primary-button"
                type="submit"
                disabled={importingWorkspace || !importForm.path.trim()}
              >
                {importingWorkspace ? t("shell.importSubmitting") : t("shell.importSubmit")}
              </button>
            </form>
          ) : null}
        </section>

        <div className="workbench-nav-stats">
          <span>
            {t("shell.workspaceCount")} {workspaceCount}
          </span>
          <span>
            {t("shell.sessionCount")} {sessionCount}
          </span>
        </div>

        {navigationError ? (
          <div className="workbench-status-row">
            <p className="status-text" data-tone="error">
              {navigationError}
            </p>
          </div>
        ) : null}

        <section className="workbench-section-block">
          <div className="workbench-section-heading">
            <div className="workbench-section-heading-main">
              <StarIcon active />
              <span>{t("shell.favoriteSectionTitle")}</span>
            </div>
            <span className="workbench-section-counter">{favoriteSessions.length}</span>
          </div>

          {favoriteSessions.length === 0 ? (
            <p className="workbench-section-empty">{t("shell.favoriteSectionEmpty")}</p>
          ) : (
            <div className="workbench-session-list">
              {favoriteSessions.map((item) => (
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
                />
              ))}
            </div>
          )}
        </section>

        {navigationLoading && workspaceGroups.length === 0 ? <SidebarNavigationSkeleton /> : null}

        {!navigationLoading && !navigationError && workspaceGroups.length === 0 ? (
          <div className="workbench-empty-state minimal">
            <p>{t("shell.emptyNavigationBody")}</p>
          </div>
        ) : null}

        {workspaceGroups.map((group) => (
          <section key={group.workspace.id} className="workbench-workspace-group">
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

              <button
                type="button"
                className="workbench-workspace-create"
                aria-label={t("shell.createSession")}
                onClick={() => setCreateSessionWorkspaceId(group.workspace.id)}
              >
                <PlusIcon />
                <span>{t("shell.createSession")}</span>
              </button>
            </div>

            {!group.isCollapsed ? (
              <>
                <div className="workbench-session-list">
                  {group.visibleSessionTree.length === 0 ? (
                    <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
                  ) : (
                    group.visibleSessionTree.map((node) => {
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
                                  onOpen={() => {
                                    navigate(`/sessions/${session.sessionId}`);
                                    onClose?.();
                                  }}
                                  onRename={() => undefined}
                                  onToggleMenu={() => undefined}
                                  onToggleFavorite={() => undefined}
                                  onArchive={() => undefined}
                                  onCloseMenu={() => undefined}
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
      </div>

      <div className="workbench-nav-footer minimal">
        <div className="workbench-footer-top">
          <ThemeSwitcher />
          <button
            className="logout-button"
            type="button"
            onClick={() => {
              authStore.clear();
              navigate("/login", { replace: true });
            }}
          >
            {t("common.logout")}
          </button>
        </div>
      </div>

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
            {archiveWorkspaceGroup.archivedSessions.map((session) => (
              <article key={session.sessionId} className="workbench-archive-item">
                <div className="workbench-archive-item-main">
                  <strong>{session.title || t("common.unknown")}</strong>
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
            ))}
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
  currentWorkspaceId,
  navigationGroups
}: {
  panelReady: boolean;
  activeTab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
  onToggleCollapse?: () => void;
  currentSessionId: string | null;
  currentWorkspaceId: string | null;
  navigationGroups: WorkspaceSessionGroup[];
}) {
  const fallbackWorkspaceId = currentWorkspaceId ?? navigationGroups[0]?.workspace.id ?? null;

  return (
    <>
      <div className="workbench-auxiliary-header">
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
        {onToggleCollapse ? (
          <SidebarHamburgerButton ariaLabel={t("shell.hideInfoSidebar")} onClick={onToggleCollapse} />
        ) : null}
      </div>

      <div className="workbench-auxiliary-body">
        {!panelReady ? <InfoPanelSkeleton /> : null}

        {panelReady && activeTab === "files" ? (
          currentSessionId && currentWorkspaceId ? (
            <FileContextPanel sessionId={currentSessionId} workspaceId={currentWorkspaceId} />
          ) : (
            <section className="workbench-empty-state minimal">
              <p>{t("shell.filesPanelEmpty")}</p>
            </section>
          )
        ) : null}

        {panelReady && activeTab === "git" ? (
          fallbackWorkspaceId ? (
            <GitSidebar workspaceId={fallbackWorkspaceId} />
          ) : (
            <section className="workbench-empty-state minimal">
              <p>{t("shell.gitPanelEmpty")}</p>
            </section>
          )
        ) : null}

        {panelReady && activeTab === "terminals" ? (
          <TerminalManagerPanel currentWorkspaceId={currentWorkspaceId} navigationGroups={navigationGroups} />
        ) : null}
      </div>
    </>
  );
}

export function WorkbenchLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const requestIdRef = useRef(0);
  const hasNavigationDataRef = useRef(false);
  const lastDraftSessionPathRef = useRef<string | null>(null);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>([]);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    readStoredNumber(LEFT_PANEL_WIDTH_KEY, DEFAULT_LEFT_PANEL_WIDTH)
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredNumber(RIGHT_PANEL_WIDTH_KEY, DEFAULT_RIGHT_PANEL_WIDTH)
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

  function applyWorkbenchSnapshot(snapshot: Awaited<ReturnType<typeof getWorkbenchSnapshot>>) {
    if (!snapshot || !Array.isArray(snapshot.items)) {
      return;
    }

    setNavigationGroups(
      snapshot.items.map((item) => ({
        workspace: item.workspace,
        sessions: [...item.sessions].sort(sortSessions)
      }))
    );
    setNavigationError(null);
  }

  const refreshNavigation = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setNavigationLoading((current) => current || navigationGroups.length === 0);

    try {
      const snapshot = await getWorkbenchSnapshot();

      if (requestId !== requestIdRef.current) {
        return;
      }

      applyWorkbenchSnapshot(snapshot);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setNavigationError(error instanceof Error ? error.message : t("shell.navigationLoadFailed"));
      showToast({
        title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
        tone: "error"
      });
    } finally {
      if (requestId === requestIdRef.current) {
        setNavigationLoading(false);
      }
    }
  }, [navigationGroups.length, showToast]);

  const upsertNavigationSession = useCallback((session: SessionSummaryDto) => {
    setNavigationGroups((current) => upsertSessionIntoGroups(current, session));
  }, []);

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
      } catch (error) {
        setNavigationGroups((current) =>
          updateSessionArchivedStateInGroups(current, sessionId, !isArchived)
        );
        throw error;
      }
    },
    [upsertNavigationSession]
  );

  const setSessionWorkspace = useCallback((sessionId: string, workspaceId: string | null) => {
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
    void refreshNavigation();
  }, []);

  useEffect(() => {
    hasNavigationDataRef.current = navigationGroups.length > 0;
  }, [navigationGroups]);

  useEffect(() => {
    const client = new WorkbenchRealtimeClient({
      onConnectionChange: (connectionState) => {
        if (connectionState === "reconnect_failed" && !hasNavigationDataRef.current) {
          setNavigationError(t("shell.navigationLoadFailed"));
          showToast({
            id: "workbench-navigation-connection",
            title: t("shell.navigationLoadFailed"),
            tone: "warning",
            durationMs: 3600
          });
        }
      },
      onSnapshot: (snapshot) => {
        applyWorkbenchSnapshot(snapshot);
        setNavigationLoading(false);
      },
      onUnauthorized: () => {
        authStore.clear();
        navigate("/login", { replace: true });
      }
    });

    client.start();

    return () => {
      client.close();
    };
  }, [navigate, showToast]);

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
    if (infoPanelReady || rightCollapsed || navigationLoading) {
      return;
    }

    const timer = window.setTimeout(() => {
      setInfoPanelReady(true);
    }, INFO_PANEL_BOOT_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [infoPanelReady, navigationLoading, rightCollapsed]);

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
  }, [flattenedSessions, navigationGroups, navigationLoading]);

  const currentSessionContext =
    flattenedSessions.find((item) => item.session.sessionId === currentSessionId) ?? null;
  const currentWorkspaceId =
    currentSessionContext?.workspace.id ??
    (currentSessionId ? sessionWorkspaceMap[currentSessionId] ?? null : null);
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

  function ensureInfoPanelReady() {
    setInfoPanelReady(true);
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
    const fallbackSessionPath = flattenedSessions[0]
      ? `/sessions/${flattenedSessions[0].session.sessionId}`
      : "/";

    navigate(storedSessionPath || fallbackSessionPath);
  }

  const contextValue = useMemo<WorkbenchShellContextValue>(
    () => ({
      navigationGroups,
      navigationLoading,
      navigationError,
      refreshNavigation,
      markNavigationSessionSeen,
      upsertNavigationSession,
      setSessionWorkspace
    }),
    [
      markNavigationSessionSeen,
      navigationError,
      navigationGroups,
      navigationLoading,
      refreshNavigation,
      setSessionWorkspace,
      upsertNavigationSession
    ]
  );

  const workspaceCount = navigationGroups.length;
  const sessionCount = navigationGroups.reduce((total, item) => total + item.sessions.length, 0);
  const shellStyle = {
    "--workbench-left-width": leftCollapsed ? "0px" : `${leftPanelWidth}px`,
    "--workbench-right-width": rightCollapsed ? "0px" : `${rightPanelWidth}px`
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
      >
        {!leftCollapsed ? (
          <>
            <aside className="workbench-nav surface-card">
              <SidebarContent
                workspaceGroups={workspaceSidebarGroups}
                favoriteSessions={favoriteSessions}
                favoriteSessionIds={favoriteSessionIdSet}
                workspaceCount={workspaceCount}
                sessionCount={sessionCount}
                navigationLoading={navigationLoading}
                navigationError={navigationError}
                activeSessionId={currentSessionId}
                onRefreshNavigation={refreshNavigation}
                onSessionUpdated={upsertNavigationSession}
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
              role="separator"
              aria-label={t("shell.leftResizerLabel")}
              onMouseDown={(event) => beginResize("left", event.clientX)}
            />
          </>
        ) : null}

        <div className="workbench-main-shell">
          {!isMobileViewport && leftCollapsed ? (
            <SidebarHamburgerButton
              className="workbench-edge-toggle left"
              ariaLabel={t("shell.showSessionSidebar")}
              onClick={openLeftPanel}
            />
          ) : null}

          {!isMobileViewport && rightCollapsed ? (
            <SidebarHamburgerButton
              className="workbench-edge-toggle right"
              ariaLabel={t("shell.showInfoSidebar")}
              onClick={openRightPanel}
            />
          ) : null}

          <div className="workbench-main-topbar surface-card">
            <div className="workbench-topbar-tabs" role="tablist" aria-label={t("shell.centerTabsLabel")}>
              <button
                className={
                  activeCenterTab === "conversation"
                    ? "workbench-topbar-tab active"
                    : "workbench-topbar-tab"
                }
                type="button"
                role="tab"
                aria-selected={activeCenterTab === "conversation"}
                onClick={goToConversationTab}
              >
                {t("shell.conversationEntry")}
              </button>
              <button
                className={
                  activeCenterTab === "terminals"
                    ? "workbench-topbar-tab active"
                    : "workbench-topbar-tab"
                }
                type="button"
                role="tab"
                aria-selected={activeCenterTab === "terminals"}
                onClick={() => navigate("/terminals")}
              >
                {t("shell.terminalsEntry")}
              </button>
            </div>
          </div>

          <Outlet />
        </div>

        {!rightCollapsed ? (
          <>
            <div
              className="workbench-side-resizer"
              role="separator"
              aria-label={t("shell.rightResizerLabel")}
              onMouseDown={(event) => beginResize("right", event.clientX)}
            />
            <aside className="workbench-auxiliary surface-card">
              <WorkbenchInfoPanel
                panelReady={infoPanelReady}
                activeTab={activeInfoTab}
                onTabChange={(tab) => {
                  ensureInfoPanelReady();
                  setActiveInfoTab(tab);
                }}
                onToggleCollapse={() => setRightCollapsed(true)}
                currentSessionId={isDraftSession ? null : currentSessionId}
                currentWorkspaceId={currentWorkspaceId}
                navigationGroups={navigationGroups}
              />
            </aside>
          </>
        ) : null}

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
            workspaceCount={workspaceCount}
            sessionCount={sessionCount}
            navigationLoading={navigationLoading}
            navigationError={navigationError}
            activeSessionId={currentSessionId}
            onRefreshNavigation={refreshNavigation}
            onSessionUpdated={upsertNavigationSession}
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
            currentWorkspaceId={currentWorkspaceId}
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

  if (!context) {
    throw new Error("Workbench shell context is unavailable.");
  }

  return context;
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
