import {
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
import {
  Outlet,
  matchPath,
  useLocation,
  useNavigate
} from "react-router-dom";

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
  startSession,
  type ProviderId,
  type SessionSummaryDto,
  type WorkspaceDto
} from "../api/conversation-api";

const LEFT_PANEL_WIDTH_KEY = "workbench.left.width";
const RIGHT_PANEL_WIDTH_KEY = "workbench.right.width";
const LEFT_PANEL_COLLAPSED_KEY = "workbench.left.collapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "workbench.right.collapsed";
const LAST_SESSION_PATH_KEY = "workbench.last.session.path";

const DEFAULT_LEFT_PANEL_WIDTH = 300;
const DEFAULT_RIGHT_PANEL_WIDTH = 340;
const MIN_PANEL_WIDTH = 220;
const MAX_LEFT_PANEL_WIDTH = 520;
const MAX_RIGHT_PANEL_WIDTH = 560;
const INFO_PANEL_BOOT_DELAY_MS = 250;

export interface WorkspaceSessionGroup {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
}

interface WorkbenchShellContextValue {
  navigationGroups: WorkspaceSessionGroup[];
  navigationLoading: boolean;
  navigationError: string | null;
  refreshNavigation: () => Promise<void>;
  setSessionWorkspace: (sessionId: string, workspaceId: string | null) => void;
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

function formatSessionMeta(session: SessionSummaryDto) {
  const date = session.lastMessageAt ?? session.updatedAt;
  return date ? new Date(date).toLocaleDateString() : "";
}

function sessionStateClassName(session: SessionSummaryDto) {
  if (session.activityState === "running") {
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

function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode or tests.
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

function SidebarContent({
  navigationGroups,
  workspaceCount,
  sessionCount,
  navigationLoading,
  navigationError,
  activeSessionId,
  onRefreshNavigation,
  onClose,
  onToggleCollapse
}: {
  navigationGroups: WorkspaceSessionGroup[];
  workspaceCount: number;
  sessionCount: number;
  navigationLoading: boolean;
  navigationError: string | null;
  activeSessionId: string | null;
  onRefreshNavigation: () => Promise<void>;
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

  async function handleStartSession(workspaceId: string, provider: ProviderId) {
    setActionWorkspaceId(workspaceId);
    setActionProvider(provider);

    try {
      const session = await startSession({ workspaceId, provider });
      await onRefreshNavigation();
      showToast({
        title: provider === "codex" ? t("shell.startCodexSuccess") : t("shell.startClaudeSuccess"),
        tone: "success"
      });
      navigate(`/sessions/${session.sessionId}`);
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

  return (
    <>
      <div className="workbench-nav-header">
        <div className="workbench-nav-header-main">
          <h1>{t("shell.title")}</h1>
          <p className="status-text">{t("shell.subtitle")}</p>
        </div>
        {onToggleCollapse ? (
          <button
            className="panel-toggle-button"
            type="button"
            onClick={onToggleCollapse}
          >
            {t("shell.hideSessionSidebar")}
          </button>
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: importExpanded ? "rotate(180deg)" : "none",
                transition: "transform 200ms"
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {importExpanded && (
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
          )}
        </section>

        <div className="workbench-nav-stats">
          <span>{t("shell.workspaceCount")} {workspaceCount}</span>
          <span>{t("shell.sessionCount")} {sessionCount}</span>
        </div>



        {!navigationLoading && !navigationError && navigationGroups.length === 0 ? (
          <div className="workbench-empty-state minimal">
            <p>{t("shell.emptyNavigationBody")}</p>
          </div>
        ) : null}

        {navigationGroups.map((group) => {
          const claudeBusy =
            actionWorkspaceId === group.workspace.id && actionProvider === "claude-code";
          const codexBusy = actionWorkspaceId === group.workspace.id && actionProvider === "codex";

          return (
            <section key={group.workspace.id} className="workbench-workspace-group">
              <div className="workbench-workspace-header minimal">
                <strong>{group.workspace.name}</strong>
              </div>

              <div className="workbench-session-list">
                {group.sessions.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className="workbench-session-link"
                    data-active={session.sessionId === activeSessionId}
                    onClick={() => {
                      navigate(`/sessions/${session.sessionId}`);
                      onClose?.();
                    }}
                  >
                    <div className="session-title-row">
                      <span className={sessionStateClassName(session)} aria-hidden="true" />
                      <span className="session-title">{session.title || t("common.unknown")}</span>
                    </div>
                    <div className="session-meta-row">
                      <span className="session-meta">{formatSessionMeta(session)}</span>
                      <span className={`session-provider-badge ${session.provider}`}>
                        {session.provider === "codex" ? "Codex" : "Claude"}
                      </span>
                    </div>
                  </button>
                ))}

                {group.sessions.length === 0 ? (
                  <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
                ) : null}
              </div>

              <div className="workbench-workspace-actions minimal">
                <button
                  type="button"
                  disabled={Boolean(actionWorkspaceId)}
                  onClick={() => void handleStartSession(group.workspace.id, "claude-code")}
                >
                  {claudeBusy ? "..." : `+ ${t("shell.startClaude")}`}
                </button>
                <button
                  type="button"
                  disabled={Boolean(actionWorkspaceId)}
                  onClick={() => void handleStartSession(group.workspace.id, "codex")}
                >
                  {codexBusy ? "..." : `+ ${t("shell.startCodex")}`}
                </button>
              </div>
            </section>
          );
        })}
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
  onToggleCollapse: () => void;
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
        <button className="panel-toggle-button" type="button" onClick={onToggleCollapse}>
          {t("shell.hideInfoSidebar")}
        </button>
      </div>

      <div className="workbench-auxiliary-body">
        {!panelReady ? (
          <section className="workbench-empty-state minimal">
            <p>{t("shell.infoPanelDeferred")}</p>
          </section>
        ) : null}

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
          <TerminalManagerPanel
            currentWorkspaceId={fallbackWorkspaceId}
            navigationGroups={navigationGroups}
          />
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
  const realtimeClientRef = useRef<WorkbenchRealtimeClient | null>(null);
  const hasNavigationDataRef = useRef(false);
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
  const [infoPanelReady, setInfoPanelReady] = useState(false);
  const [activeInfoTab, setActiveInfoTab] = useState<InfoTab>("files");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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

  async function refreshNavigation() {
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
  }

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

    realtimeClientRef.current = client;
    client.start();

    return () => {
      realtimeClientRef.current = null;
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
  const flattenedSessions = useMemo(() => flattenSessions(navigationGroups), [navigationGroups]);
  const currentSessionContext =
    flattenedSessions.find((item) => item.session.sessionId === currentSessionId) ?? null;
  const currentWorkspaceId =
    currentSessionContext?.workspace.id ??
    (currentSessionId ? sessionWorkspaceMap[currentSessionId] ?? null : null);
  const activeCenterTab: CenterTab = location.pathname.startsWith("/terminals")
    ? "terminals"
    : "conversation";

  useEffect(() => {
    if (currentSessionId) {
      writeStoredValue(LAST_SESSION_PATH_KEY, `/sessions/${currentSessionId}`);
    }
  }, [currentSessionId]);

  function openLeftPanel() {
    if (window.innerWidth <= 720) {
      setMobileNavOpen(true);
      return;
    }

    setLeftCollapsed(false);
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
      navigate(`/sessions/${currentSessionId}`);
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
      setSessionWorkspace: (sessionId: string, workspaceId: string | null) => {
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
      }
    }),
    [navigationError, navigationGroups, navigationLoading]
  );

  const workspaceCount = navigationGroups.length;
  const sessionCount = navigationGroups.reduce((total, item) => total + item.sessions.length, 0);
  const shellStyle = {
    "--workbench-left-width": leftCollapsed ? "0px" : `${leftPanelWidth}px`,
    "--workbench-right-width": rightCollapsed ? "0px" : `${rightPanelWidth}px`
  } as CSSProperties;

  return (
    <WorkbenchShellContext.Provider value={contextValue}>
      <div className="workbench-shell" style={shellStyle}>
        {!leftCollapsed ? (
          <>
            <aside className="workbench-nav surface-card">
              <SidebarContent
                navigationGroups={navigationGroups}
                workspaceCount={workspaceCount}
                sessionCount={sessionCount}
                navigationLoading={navigationLoading}
                navigationError={navigationError}
                activeSessionId={currentSessionId}
                onRefreshNavigation={refreshNavigation}
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
          <div className="workbench-main-topbar surface-card">
            <div className="workbench-topbar-actions">
              <button
                className="panel-toggle-button"
                type="button"
                onClick={() => {
                  if (leftCollapsed) {
                    openLeftPanel();
                  } else {
                    setLeftCollapsed(true);
                  }
                }}
              >
                {leftCollapsed ? t("shell.showSessionSidebar") : t("shell.hideSessionSidebar")}
              </button>
            </div>

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

            <div className="workbench-topbar-actions">
              <button
                className="panel-toggle-button"
                type="button"
                onClick={() => {
                  if (rightCollapsed) {
                    ensureInfoPanelReady();
                    setRightCollapsed(false);
                    return;
                  }

                  setRightCollapsed(true);
                }}
              >
                {rightCollapsed ? t("shell.showInfoSidebar") : t("shell.hideInfoSidebar")}
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
                currentSessionId={currentSessionId}
                currentWorkspaceId={currentWorkspaceId}
                navigationGroups={navigationGroups}
              />
            </aside>
          </>
        ) : null}

        <MobileNavDrawer isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)}>
          <SidebarContent
            navigationGroups={navigationGroups}
            workspaceCount={workspaceCount}
            sessionCount={sessionCount}
            navigationLoading={navigationLoading}
            navigationError={navigationError}
            navigationMessage={navigationMessage}
            activeSessionId={currentSessionId}
            onRefreshNavigation={refreshNavigation}
            onClose={() => setMobileNavOpen(false)}
          />
        </MobileNavDrawer>
      </div>
    </WorkbenchShellContext.Provider>
  );
}

function MobileNavDrawer({
  isOpen,
  onClose,
  children
}: {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div
        className={`mobile-nav-overlay ${isOpen ? "open" : ""}`}
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
      <div className={`mobile-nav-drawer ${isOpen ? "open" : ""}`}>{children}</div>
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
