import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { ThemeSwitcher } from "../../../shared/theme";
import { authStore } from "../../auth/store/auth-store";
import {
  importWorkspace,
  listWorkspaceSessions,
  listWorkspaces,
  startSession,
  type ProviderId,
  type SessionSummaryDto,
  type WorkspaceDto
} from "../api/conversation-api";

interface WorkspaceSessionGroup {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
}

interface WorkbenchAuxiliaryPanel {
  title: string;
  description?: string;
  content: ReactNode;
  defaultCollapsed?: boolean;
}

interface WorkbenchShellContextValue {
  navigationGroups: WorkspaceSessionGroup[];
  navigationLoading: boolean;
  navigationError: string | null;
  refreshNavigation: () => Promise<void>;
  setAuxiliaryPanel: (panel: WorkbenchAuxiliaryPanel | null) => void;
}

interface ImportWorkspaceFormState {
  path: string;
  name: string;
}

const WorkbenchShellContext = createContext<WorkbenchShellContextValue | null>(null);

function sortSessions(left: SessionSummaryDto, right: SessionSummaryDto) {
  return (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt);
}

function formatSessionMeta(session: SessionSummaryDto) {
  const date = session.lastMessageAt ?? session.updatedAt;
  return date ? new Date(date).toLocaleDateString() : "";
}

function SidebarContent({
  navigationGroups,
  workspaceCount,
  sessionCount,
  navigationLoading,
  navigationError,
  navigationMessage,
  onClose
}: {
  navigationGroups: WorkspaceSessionGroup[];
  workspaceCount: number;
  sessionCount: number;
  navigationLoading: boolean;
  navigationError: string | null;
  navigationMessage: string | null;
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const [importExpanded, setImportExpanded] = useState(false);
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [importForm, setImportForm] = useState<ImportWorkspaceFormState>({
    path: "",
    name: ""
  });
  const [actionWorkspaceId, setActionWorkspaceId] = useState<string | null>(null);
  const [actionProvider, setActionProvider] = useState<ProviderId | null>(null);

  async function handleImportWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPath = importForm.path.trim();

    if (!trimmedPath) return;

    setImportingWorkspace(true);
    try {
      await importWorkspace({
        path: trimmedPath,
        name: importForm.name.trim() || undefined
      });
      setImportForm({ path: "", name: "" });
      setImportExpanded(false);
      window.location.reload();
    } catch {
      // Error handled silently
    } finally {
      setImportingWorkspace(false);
    }
  }

  async function handleStartSession(workspaceId: string, provider: ProviderId) {
    setActionWorkspaceId(workspaceId);
    setActionProvider(provider);

    try {
      const session = await startSession({ workspaceId, provider });
      navigate(`/sessions/${session.sessionId}`);
      onClose?.();
    } catch {
      // Error handled silently
    } finally {
      setActionWorkspaceId(null);
      setActionProvider(null);
    }
  }

  return (
    <>
      <div className="workbench-nav-header">
        <h1>{t("shell.title")}</h1>
        <p className="status-text">{t("shell.subtitle")}</p>
      </div>

      <div className="workbench-nav-links">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            isActive ? "workbench-nav-link active" : "workbench-nav-link"
          }
          onClick={() => onClose?.()}
        >
          {t("shell.homeEntry")}
        </NavLink>
        <NavLink
          to="/terminals"
          className={({ isActive }) =>
            isActive ? "workbench-nav-link active" : "workbench-nav-link"
          }
          onClick={() => onClose?.()}
        >
          {t("home.terminalsEntry")}
        </NavLink>
      </div>

      <div className="workbench-nav-body">
        {/* Add Project Section */}
        <section className="workbench-import-card minimal">
          <button
            type="button"
            className="workbench-import-toggle"
            onClick={() => setImportExpanded((c) => !c)}
          >
            <span>{t("shell.importWorkspaceTitle")}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ transform: importExpanded ? "rotate(180deg)" : "none", transition: "transform 200ms" }}
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
                onChange={(e) => setImportForm((c) => ({ ...c, path: e.target.value }))}
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

        {/* Stats */}
        <div className="workbench-nav-stats">
          <span>{t("shell.workspaceCount")} {workspaceCount}</span>
          <span>{t("shell.sessionCount")} {sessionCount}</span>
        </div>

        {/* Messages */}
        {navigationLoading && <p className="status-text">{t("common.loading")}</p>}
        {navigationError && <p className="status-text" data-tone="error">{navigationError}</p>}
        {navigationMessage && <p className="status-text" data-tone="success">{navigationMessage}</p>}

        {/* Empty State */}
        {!navigationLoading && !navigationError && navigationGroups.length === 0 && (
          <div className="workbench-empty-state minimal">
            <p>{t("shell.emptyNavigationBody")}</p>
          </div>
        )}

        {/* Workspaces */}
        {navigationGroups.map((group) => {
          const claudeBusy = actionWorkspaceId === group.workspace.id && actionProvider === "claude-code";
          const codexBusy = actionWorkspaceId === group.workspace.id && actionProvider === "codex";

          return (
            <section key={group.workspace.id} className="workbench-workspace-group">
              <div className="workbench-workspace-header minimal">
                <strong>{group.workspace.name}</strong>
              </div>

              <div className="workbench-session-list">
                {group.sessions.map((session) => (
                  <NavLink
                    key={session.sessionId}
                    to={`/sessions/${session.sessionId}`}
                    className={({ isActive }) =>
                      isActive ? "workbench-session-link active" : "workbench-session-link"
                    }
                    onClick={() => onClose?.()}
                  >
                    <span className="session-title">{session.title || t("common.unknown")}</span>
                    <div className="session-meta-row">
                      <span className="session-meta">{formatSessionMeta(session)}</span>
                      <span className={`session-provider-badge ${session.provider}`}>
                        {session.provider === "codex" ? "Codex" : "Claude"}
                      </span>
                    </div>
                  </NavLink>
                ))}

                {group.sessions.length === 0 && (
                  <p className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</p>
                )}
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

export function WorkbenchLayout() {
  const location = useLocation();
  const requestIdRef = useRef(0);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>([]);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const [auxiliaryPanel, setAuxiliaryPanelState] = useState<WorkbenchAuxiliaryPanel | null>(null);
  const [auxiliaryCollapsed, setAuxiliaryCollapsed] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function refreshNavigation() {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setNavigationLoading(true);

    try {
      const workspaceResponse = await listWorkspaces();
      const sessionResponses = await Promise.all(
        workspaceResponse.items.map(async (workspace) => ({
          workspaceId: workspace.id,
          response: await listWorkspaceSessions(workspace.id)
        }))
      );

      if (requestId !== requestIdRef.current) return;

      const sessionsByWorkspace = new Map(
        sessionResponses.map((item) => [
          item.workspaceId,
          [...item.response.items].sort(sortSessions)
        ])
      );

      setNavigationGroups(
        workspaceResponse.items.map((workspace) => ({
          workspace,
          sessions: sessionsByWorkspace.get(workspace.id) ?? []
        }))
      );
      setNavigationError(null);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setNavigationGroups([]);
      setNavigationError(error instanceof Error ? error.message : t("shell.navigationLoadFailed"));
    } finally {
      if (requestId === requestIdRef.current) {
        setNavigationLoading(false);
      }
    }
  }

  function setAuxiliaryPanel(panel: WorkbenchAuxiliaryPanel | null) {
    setAuxiliaryPanelState(panel);
    setAuxiliaryCollapsed(panel?.defaultCollapsed ?? true);
  }

  useEffect(() => {
    void refreshNavigation();
  }, [location.pathname]);

  const contextValue = useMemo<WorkbenchShellContextValue>(
    () => ({
      navigationGroups,
      navigationLoading,
      navigationError,
      refreshNavigation,
      setAuxiliaryPanel
    }),
    [navigationError, navigationGroups, navigationLoading]
  );

  const workspaceCount = navigationGroups.length;
  const sessionCount = navigationGroups.reduce((total, item) => total + item.sessions.length, 0);

  return (
    <WorkbenchShellContext.Provider value={contextValue}>
      <div className="workbench-shell" data-aux-collapsed={auxiliaryCollapsed}>
        <aside className="workbench-nav surface-card">
          <SidebarContent
            navigationGroups={navigationGroups}
            workspaceCount={workspaceCount}
            sessionCount={sessionCount}
            navigationLoading={navigationLoading}
            navigationError={navigationError}
            navigationMessage={navigationMessage}
          />
        </aside>

        <div className="workbench-main-shell">
          <div className="mobile-header">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileNavOpen(true)}
              aria-label="菜单"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="mobile-header-title">{t("shell.title")}</span>
          </div>
          <Outlet />
        </div>

        <aside
          className={
            auxiliaryCollapsed
              ? "workbench-auxiliary surface-card is-collapsed"
              : "workbench-auxiliary surface-card"
          }
        >
          <div className="workbench-auxiliary-header">
            {!auxiliaryCollapsed && (
              <div>
                <h2>{auxiliaryPanel?.title ?? t("shell.auxiliaryTitle")}</h2>
                <p className="status-text">{auxiliaryPanel?.description ?? t("shell.auxiliarySubtitle")}</p>
              </div>
            )}
            <button
              className="auxiliary-toggle"
              type="button"
              onClick={() => setAuxiliaryCollapsed((c) => !c)}
            >
              {auxiliaryCollapsed ? "←" : "→"}
            </button>
          </div>

          {!auxiliaryCollapsed && (
            <div className="workbench-auxiliary-body">
              {auxiliaryPanel?.content ?? (
                <section className="workbench-empty-state minimal">
                  <p>{t("shell.auxiliaryEmptyBody")}</p>
                </section>
              )}
            </div>
          )}
        </aside>

        {/* Mobile Navigation Drawer */}
        <MobileNavDrawer isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)}>
          <SidebarContent
            navigationGroups={navigationGroups}
            workspaceCount={workspaceCount}
            sessionCount={sessionCount}
            navigationLoading={navigationLoading}
            navigationError={navigationError}
            navigationMessage={navigationMessage}
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
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        className={`mobile-nav-overlay ${isOpen ? "open" : ""}`}
        onClick={onClose}
        role="button"
        tabIndex={0}
        aria-label="关闭"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
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
