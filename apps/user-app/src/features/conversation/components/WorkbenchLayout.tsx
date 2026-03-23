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
  return session.lastMessageAt ?? session.updatedAt;
}

export function WorkbenchLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestIdRef = useRef(0);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>([]);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [auxiliaryPanel, setAuxiliaryPanelState] = useState<WorkbenchAuxiliaryPanel | null>(null);
  const [auxiliaryCollapsed, setAuxiliaryCollapsed] = useState(true);
  const [importExpanded, setImportExpanded] = useState(false);
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [importForm, setImportForm] = useState<ImportWorkspaceFormState>({
    path: "",
    name: ""
  });
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const [actionWorkspaceId, setActionWorkspaceId] = useState<string | null>(null);
  const [actionProvider, setActionProvider] = useState<ProviderId | null>(null);

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

      if (requestId !== requestIdRef.current) {
        return;
      }

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
      if (requestId !== requestIdRef.current) {
        return;
      }

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

  async function handleImportWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPath = importForm.path.trim();
    const trimmedName = importForm.name.trim();

    if (!trimmedPath) {
      setNavigationMessage(t("shell.importPathRequired"));
      return;
    }

    setImportingWorkspace(true);
    setNavigationError(null);
    setNavigationMessage(null);

    try {
      const workspace = await importWorkspace({
        path: trimmedPath,
        name: trimmedName || undefined
      });

      await refreshNavigation();
      setImportForm({ path: "", name: "" });
      setImportExpanded(false);
      setNavigationMessage(`${t("shell.importSuccess")} ${workspace.name}`);
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : t("shell.importFailed"));
    } finally {
      setImportingWorkspace(false);
    }
  }

  async function handleStartSession(workspaceId: string, provider: ProviderId) {
    setActionWorkspaceId(workspaceId);
    setActionProvider(provider);
    setNavigationError(null);
    setNavigationMessage(null);

    try {
      const session = await startSession({
        workspaceId,
        provider
      });

      await refreshNavigation();
      setNavigationMessage(
        provider === "claude-code" ? t("shell.startClaudeSuccess") : t("shell.startCodexSuccess")
      );
      navigate(`/sessions/${session.sessionId}`);
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : t("shell.startSessionFailed"));
    } finally {
      setActionWorkspaceId(null);
      setActionProvider(null);
    }
  }

  return (
    <WorkbenchShellContext.Provider value={contextValue}>
      <div className="workbench-shell" data-aux-collapsed={auxiliaryCollapsed}>
        <aside className="workbench-nav surface-card">
          <div className="workbench-nav-header">
            <span className="badge">{t("common.appName")}</span>
            <div>
              <h1>{t("shell.title")}</h1>
              <p className="status-text">{t("shell.subtitle")}</p>
            </div>
          </div>

          <div className="workbench-nav-links">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "workbench-nav-link active" : "workbench-nav-link"
              }
            >
              {t("shell.homeEntry")}
            </NavLink>
            <NavLink
              to="/terminals"
              className={({ isActive }) =>
                isActive ? "workbench-nav-link active" : "workbench-nav-link"
              }
            >
              {t("home.terminalsEntry")}
            </NavLink>
          </div>

          <div className="workbench-nav-body">
            <div className="workbench-nav-summary">
              <span className="badge">
                {t("shell.workspaceCount")} {workspaceCount}
              </span>
              <span className="badge">
                {t("shell.sessionCount")} {sessionCount}
              </span>
            </div>

            <section className="workbench-import-card">
              <div className="workbench-import-header">
                <div>
                  <strong>{t("shell.importWorkspaceTitle")}</strong>
                  <p className="status-text">{t("shell.importWorkspaceHint")}</p>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setImportExpanded((current) => !current);
                    setNavigationError(null);
                    setNavigationMessage(null);
                  }}
                >
                  {importExpanded ? t("shell.importCollapse") : t("shell.importExpand")}
                </button>
              </div>

              {importExpanded ? (
                <form className="workbench-import-form" onSubmit={handleImportWorkspace}>
                  <label className="field-group">
                    <span>{t("shell.importPathLabel")}</span>
                    <input
                      value={importForm.path}
                      placeholder={t("shell.importPathPlaceholder")}
                      onChange={(event) =>
                        setImportForm((current) => ({ ...current, path: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-group">
                    <span>{t("shell.importNameLabel")}</span>
                    <input
                      value={importForm.name}
                      placeholder={t("shell.importNamePlaceholder")}
                      onChange={(event) =>
                        setImportForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <button className="primary-button" type="submit" disabled={importingWorkspace}>
                    {importingWorkspace ? t("shell.importSubmitting") : t("shell.importSubmit")}
                  </button>
                </form>
              ) : null}
            </section>

            {navigationLoading ? <p className="status-text">{t("common.loading")}</p> : null}
            {navigationError ? (
              <p className="status-text" data-tone="error">
                {navigationError}
              </p>
            ) : null}
            {navigationMessage ? (
              <p className="status-text" data-tone="success">
                {navigationMessage}
              </p>
            ) : null}

            {!navigationLoading && !navigationError && navigationGroups.length === 0 ? (
              <div className="workbench-empty-state">
                <strong>{t("shell.emptyNavigationTitle")}</strong>
                <p className="status-text">{t("shell.emptyNavigationBody")}</p>
              </div>
            ) : null}

            {navigationGroups.map((group) => {
              const claudeBusy =
                actionWorkspaceId === group.workspace.id && actionProvider === "claude-code";
              const codexBusy = actionWorkspaceId === group.workspace.id && actionProvider === "codex";

              return (
                <section key={group.workspace.id} className="workbench-workspace-group">
                  <div className="workbench-workspace-card">
                    <div className="workbench-workspace-header">
                      <strong>{group.workspace.name}</strong>
                      <span className="badge">{group.sessions.length}</span>
                    </div>
                    <small className="workbench-workspace-path">{group.workspace.path}</small>

                    <div className="workbench-workspace-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={Boolean(actionWorkspaceId)}
                        onClick={() => void handleStartSession(group.workspace.id, "claude-code")}
                      >
                        {claudeBusy ? t("shell.startingSession") : t("shell.startClaude")}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={Boolean(actionWorkspaceId)}
                        onClick={() => void handleStartSession(group.workspace.id, "codex")}
                      >
                        {codexBusy ? t("shell.startingSession") : t("shell.startCodex")}
                      </button>
                    </div>
                  </div>

                  <div className="workbench-session-list">
                    {group.sessions.length === 0 ? (
                      <div className="workbench-session-empty">{t("shell.emptyWorkspaceSessions")}</div>
                    ) : null}

                    {group.sessions.map((session) => (
                      <NavLink
                        key={session.sessionId}
                        to={`/sessions/${session.sessionId}`}
                        className={({ isActive }) =>
                          isActive ? "workbench-session-link active" : "workbench-session-link"
                        }
                      >
                        <span className="workbench-session-title">
                          <strong>{session.title || t("common.unknown")}</strong>
                          <span className="badge">{session.provider}</span>
                        </span>
                        <small>{formatSessionMeta(session)}</small>
                      </NavLink>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="workbench-nav-footer">
            <div className="workbench-footer-actions">
              <button className="secondary-button" type="button" onClick={() => void refreshNavigation()}>
                {t("shell.refreshNavigation")}
              </button>
              <button
                className="ghost-button"
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
        </aside>

        <div className="workbench-main-shell">
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
            {!auxiliaryCollapsed ? (
              <div>
                <h2>{auxiliaryPanel?.title ?? t("shell.auxiliaryTitle")}</h2>
                <p className="status-text">
                  {auxiliaryPanel?.description ?? t("shell.auxiliarySubtitle")}
                </p>
              </div>
            ) : null}
            <button
              className="secondary-button workbench-auxiliary-toggle"
              type="button"
              onClick={() => setAuxiliaryCollapsed((current) => !current)}
            >
              {auxiliaryCollapsed ? t("shell.expandAuxiliary") : t("shell.collapseAuxiliary")}
            </button>
          </div>

          {!auxiliaryCollapsed ? (
            <div className="workbench-auxiliary-body">
              {auxiliaryPanel?.content ?? (
                <section className="workbench-empty-state">
                  <strong>{t("shell.auxiliaryEmptyTitle")}</strong>
                  <p className="status-text">{t("shell.auxiliaryEmptyBody")}</p>
                </section>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </WorkbenchShellContext.Provider>
  );
}

export function useWorkbenchShell() {
  const context = useContext(WorkbenchShellContext);

  if (!context) {
    throw new Error("Workbench shell context is unavailable.");
  }

  return context;
}
