import { createPortal } from "react-dom";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  cloneWorkspace,
  importWorkspace,
  type CloneWorkspacePayload,
  type SessionSummaryDto
} from "../../conversation/api/conversation-api";
import { getGitStatus } from "../../conversation/api/git-api";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  buildWorkspaceDetailPath,
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  buildWorkspaceToolProcessesPath,
  buildWorkspaceTerminalsPath,
  buildWorkspaceToolsPath
} from "../../workbench/utils/workbench-navigation";
import { listWorkspaceTerminals } from "../../terminal/api/terminal-api";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

type WorkspaceActionMode = "import" | "clone" | null;
type WorkspaceSheetMode = "switcher" | "actions" | null;

interface WorkspaceDashboardState {
  readonly loading: boolean;
  readonly branch: string | null;
  readonly activeTerminalCount: number | null;
  readonly changedFileCount: number | null;
  readonly quickLaunchRunning: boolean | null;
}

interface WorkspaceSheetProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

function isVisibleSession(session: SessionSummaryDto) {
  return session.isArchived !== true && session.isSubagent !== true;
}

function isSessionRunning(session: SessionSummaryDto) {
  return (
    session.activityState === "running"
    || session.runningState === "starting"
    || session.runningState === "running"
    || session.runningState === "reconnecting"
  );
}

function isSessionWaitingForInput(session: SessionSummaryDto) {
  return session.activityState === "idle" && isSessionRunning(session) === false;
}

function isTerminalActive(status: string) {
  return status === "creating" || status === "running";
}

function getSessionActivityTime(session: SessionSummaryDto) {
  return session.lastEventAt ?? session.lastMessageAt ?? session.updatedAt ?? session.createdAt;
}

function sortSessionsByActivity(left: SessionSummaryDto, right: SessionSummaryDto) {
  return getSessionActivityTime(right).localeCompare(getSessionActivityTime(left));
}

function getProviderLabel(provider: string) {
  if (provider === "codex") {
    return t("conversation.providerCodex");
  }

  if (provider === "opencode") {
    return t("conversation.providerOpenCode");
  }

  return t("shell.providerClaudeCode");
}

function formatActivityTime(value: string | null) {
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

function renderSheet(content: ReactNode) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(content, document.body);
}

export function WorkspaceHomePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    navigationGroups,
    currentWorkspaceId,
    refreshNavigation,
    selectWorkspace,
    startDraftSession,
    subscribeTerminalManagerSnapshot,
    requestTerminalManagerRefresh,
    addTerminalManagerSnapshotListener
  } = useWorkbenchShell();
  const [actionMode, setActionMode] = useState<WorkspaceActionMode>(null);
  const [sheetMode, setSheetMode] = useState<WorkspaceSheetMode>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dashboardState, setDashboardState] = useState<WorkspaceDashboardState>({
    loading: false,
    branch: null,
    activeTerminalCount: null,
    changedFileCount: null,
    quickLaunchRunning: null
  });
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [cloneForm, setCloneForm] = useState<CloneWorkspacePayload>({
    repositoryUrl: "",
    parentPath: "",
    directoryName: "",
    name: "",
    auth: {
      mode: "none"
    }
  });

  const currentWorkspaceGroup =
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId) ??
    navigationGroups[0] ??
    null;
  const currentWorkspace = currentWorkspaceGroup?.workspace ?? null;
  const visibleSessions = [...(currentWorkspaceGroup?.sessions ?? [])]
    .filter(isVisibleSession)
    .sort(sortSessionsByActivity);
  const activeSessions = visibleSessions.filter(isSessionRunning);
  const waitingInputSessions = visibleSessions.filter(isSessionWaitingForInput);
  const unreadSessions = visibleSessions.filter((session) => session.activityState === "completed_unread");
  const favoriteSessions = visibleSessions.filter((session) => session.isFavorite === true);
  const sessionList = activeSessions.slice(0, 6);
  const favoriteSessionList = favoriteSessions.slice(0, 6);

  useEffect(() => {
    let disposed = false;
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      setDashboardState({
        loading: false,
        branch: null,
        activeTerminalCount: null,
        changedFileCount: null,
        quickLaunchRunning: null
      });
      return;
    }

    setDashboardState((current) => ({
      ...current,
      loading: true
    }));

    void Promise.allSettled([
      listWorkspaceTerminals(workspaceId),
      getGitStatus(workspaceId)
    ]).then(([terminalResult, gitResult]) => {
      if (disposed) {
        return;
      }

      setDashboardState((current) => ({
        ...current,
        loading: false,
        branch: gitResult.status === "fulfilled" ? gitResult.value.snapshot.branch : null,
        activeTerminalCount:
          terminalResult.status === "fulfilled"
            ? terminalResult.value.items.filter((terminal) => isTerminalActive(terminal.status)).length
            : null,
        changedFileCount:
          gitResult.status === "fulfilled"
            ? gitResult.value.changes.length
            : null
      }));
    });

    return () => {
      disposed = true;
    };
  }, [currentWorkspace?.id]);

  useEffect(() => {
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      setDashboardState((current) => ({
        ...current,
        quickLaunchRunning: null
      }));
      return;
    }

    subscribeTerminalManagerSnapshot(workspaceId);
    requestTerminalManagerRefresh(workspaceId);

    return addTerminalManagerSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) {
        return;
      }

      setDashboardState((current) => ({
        ...current,
        quickLaunchRunning: snapshot.templateStatuses.some((status) => status.occupied)
      }));
    });
  }, [
    addTerminalManagerSnapshotListener,
    currentWorkspace?.id,
    requestTerminalManagerRefresh,
    subscribeTerminalManagerSnapshot
  ]);

  async function handleImportWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!importPath.trim()) {
      return;
    }

    setSubmitting(true);

    try {
      const workspace = await importWorkspace({
        path: importPath.trim(),
        name: importName.trim() || undefined
      });
      await refreshNavigation();
      selectWorkspace(workspace.id);
      setImportPath("");
      setImportName("");
      setActionMode(null);
      showToast({
        title: t("shell.importSuccess"),
        description: workspace.path,
        tone: "success"
      });
      navigate(buildWorkspaceDetailPath(workspace.id));
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.importFailed"),
        tone: "error"
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloneWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!cloneForm.repositoryUrl?.trim() || !cloneForm.parentPath?.trim()) {
      return;
    }

    setSubmitting(true);

    try {
      const workspace = await cloneWorkspace({
        repositoryUrl: cloneForm.repositoryUrl.trim(),
        parentPath: cloneForm.parentPath.trim(),
        directoryName: cloneForm.directoryName?.trim() || undefined,
        name: cloneForm.name?.trim() || undefined,
        auth: cloneForm.auth
      });
      await refreshNavigation();
      selectWorkspace(workspace.id);
      setCloneForm({
        repositoryUrl: "",
        parentPath: "",
        directoryName: "",
        name: "",
        auth: {
          mode: "none"
        }
      });
      setActionMode(null);
      showToast({
        title: t("shell.cloneSuccess"),
        description: workspace.path,
        tone: "success"
      });
      navigate(buildWorkspaceDetailPath(workspace.id));
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.cloneFailed"),
        tone: "error"
      });
    } finally {
      setSubmitting(false);
    }
  }

  function openCurrentWorkspaceGit() {
    if (!currentWorkspace) {
      return;
    }

    selectWorkspace(currentWorkspace.id);
    navigate(buildWorkspaceToolsPath(currentWorkspace.id, "git"));
  }

  function openCurrentWorkspaceTerminals() {
    if (!currentWorkspace) {
      return;
    }

    selectWorkspace(currentWorkspace.id);
    navigate(buildWorkspaceTerminalsPath(currentWorkspace.id));
  }

  function openCurrentWorkspaceProcesses() {
    if (!currentWorkspace) {
      return;
    }

    selectWorkspace(currentWorkspace.id);
    navigate(buildWorkspaceToolProcessesPath(currentWorkspace.id));
  }

  function openSessionIndex() {
    if (!currentWorkspace) {
      return;
    }

    navigate(buildWorkspaceSessionIndexPath(currentWorkspace.id));
  }

  function handleStartSession() {
    if (!currentWorkspace) {
      return;
    }

    startDraftSession(currentWorkspace.id, "codex");
  }

  function handleOpenWorkspaceDetail() {
    if (!currentWorkspace) {
      return;
    }

    selectWorkspace(currentWorkspace.id);
    navigate(buildWorkspaceDetailPath(currentWorkspace.id));
  }

  function handleSelectWorkspace(workspaceId: string) {
    selectWorkspace(workspaceId);
    setSheetMode(null);
  }

  const statusRows = [
    {
      label: t("shell.workspaceHomeMetricActive"),
      value: activeSessions.length,
      onClick: visibleSessions.length > 0 ? openSessionIndex : undefined
    },
    {
      label: t("shell.workspaceHomeMetricUnread"),
      value: unreadSessions.length,
      onClick: visibleSessions.length > 0 ? openSessionIndex : undefined
    },
    {
      label: t("shell.workspaceHomeMetricTerminal"),
      value: dashboardState.loading ? "…" : dashboardState.activeTerminalCount ?? "—",
      onClick: currentWorkspace ? openCurrentWorkspaceTerminals : undefined
    },
    {
      label: t("shell.workspaceHomeMetricChanges"),
      value: dashboardState.loading ? "…" : dashboardState.changedFileCount ?? "—",
      onClick: currentWorkspace ? openCurrentWorkspaceGit : undefined
    }
  ] as const;

  const quickStatusRows = [
    {
      label: t("shell.workspaceHomeQuickLaunchStatusLabel"),
      value:
        dashboardState.quickLaunchRunning === null
          ? "…"
          : dashboardState.quickLaunchRunning
            ? t("shell.workspaceHomeQuickLaunchRunning")
            : t("shell.workspaceHomeQuickLaunchStopped"),
      onClick: currentWorkspace ? openCurrentWorkspaceProcesses : undefined
    },
    {
      label: t("shell.workspaceHomeWaitingInputLabel"),
      value: waitingInputSessions.length,
      onClick: visibleSessions.length > 0 ? openSessionIndex : undefined
    }
  ] as const;

  return (
    <main className="mobile-feature-page mobile-page-scroll-root mobile-workspace-home-page">
      {currentWorkspace ? (
        <>
          <section className="mobile-workspace-home-toolbar">
            <div className="mobile-workspace-home-toolbar-top">
              <button
                type="button"
                className="mobile-workspace-home-switcher"
                aria-label={t("shell.workspaceHomeSwitcherLabel")}
                onClick={() => setSheetMode("switcher")}
              >
                <span className="mobile-workspace-home-switcher-label">{currentWorkspace.name}</span>
                <ChevronDownIcon />
              </button>
              <div className="mobile-workspace-home-toolbar-actions">
                {dashboardState.branch ? (
                  <span
                    className="mobile-workspace-home-branch"
                    aria-label={`${t("shell.workspaceHomeCurrentBranchLabel")} ${dashboardState.branch}`}
                  >
                    {dashboardState.branch}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="mobile-workspace-home-more-button"
                  aria-label={t("shell.iosMoreAction")}
                  onClick={() => setSheetMode("actions")}
                >
                  <MoreIcon />
                </button>
              </div>
            </div>
            <p className="mobile-workspace-home-path">{currentWorkspace.path}</p>
            <div className="mobile-workspace-home-toolbar-summary" aria-label={t("shell.workspaceHomeStatusSectionTitle")}>
              {statusRows.map((row) =>
                row.onClick ? (
                  <button
                    key={row.label}
                    type="button"
                    className="mobile-workspace-home-toolbar-metric"
                    onClick={row.onClick}
                  >
                    <strong className="mobile-workspace-home-toolbar-metric-value">{row.value}</strong>
                    <span className="mobile-workspace-home-toolbar-metric-label">{row.label}</span>
                  </button>
                ) : (
                  <div key={row.label} className="mobile-workspace-home-toolbar-metric" role="listitem">
                    <strong className="mobile-workspace-home-toolbar-metric-value">{row.value}</strong>
                    <span className="mobile-workspace-home-toolbar-metric-label">{row.label}</span>
                  </div>
                )
              )}
            </div>
          </section>

          <section className="mobile-workspace-home-section">
            <div className="mobile-workspace-home-group">
              {quickStatusRows.map((row) => (
                <button
                  key={row.label}
                  type="button"
                  className="mobile-workspace-home-row"
                  onClick={row.onClick}
                >
                  <span className="mobile-workspace-home-row-label">{row.label}</span>
                  <span className="mobile-workspace-home-row-trailing">
                    <strong>{row.value}</strong>
                    <ChevronRightIcon />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mobile-workspace-home-section">
            <div className="mobile-workspace-home-section-header">
              <p className="mobile-workspace-home-section-title">{t("shell.workspaceHomeActiveSessionsSectionTitle")}</p>
              {currentWorkspace ? (
                <button
                  type="button"
                  className="mobile-workspace-home-link-button"
                  onClick={openSessionIndex}
                >
                  {t("shell.workspaceHomeViewAllAction")}
                </button>
              ) : null}
            </div>
            <div className="mobile-workspace-home-group">
              {sessionList.length === 0 ? (
                <button
                  type="button"
                  className="mobile-workspace-home-row mobile-workspace-home-empty-row"
                  onClick={handleStartSession}
                >
                  <div className="mobile-workspace-home-session-main">
                    <span className="mobile-workspace-home-session-title">{t("shell.createSession")}</span>
                    <span className="mobile-workspace-home-session-meta">{currentWorkspace.name}</span>
                  </div>
                  <span className="mobile-workspace-home-row-trailing">
                    <ChevronRightIcon />
                  </span>
                </button>
              ) : (
                sessionList.map((session) => {
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      className="mobile-workspace-home-row mobile-workspace-home-session-row"
                      onClick={() =>
                        navigate(buildWorkspaceSessionPath(currentWorkspace.id, session.sessionId))
                      }
                    >
                      <div className="mobile-workspace-home-session-main">
                        <span className="mobile-workspace-home-session-title">
                          {session.title || t("common.unknown")}
                        </span>
                        <span className="mobile-workspace-home-session-meta">
                          {getProviderLabel(session.provider)} · {formatActivityTime(getSessionActivityTime(session))}
                        </span>
                      </div>
                      <span className="mobile-workspace-home-row-trailing">
                        <ChevronRightIcon />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {favoriteSessionList.length > 0 ? (
            <section className="mobile-workspace-home-section">
              <div className="mobile-workspace-home-section-header">
                <p className="mobile-workspace-home-section-title">{t("shell.favoriteSectionTitle")}</p>
              </div>
              <div className="mobile-workspace-home-group">
                {favoriteSessionList.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className="mobile-workspace-home-row mobile-workspace-home-session-row"
                    onClick={() =>
                      navigate(buildWorkspaceSessionPath(currentWorkspace.id, session.sessionId))
                    }
                  >
                    <div className="mobile-workspace-home-session-main">
                      <span className="mobile-workspace-home-session-title">
                        {session.title || t("common.unknown")}
                      </span>
                      <span className="mobile-workspace-home-session-meta">
                        {getProviderLabel(session.provider)} · {formatActivityTime(getSessionActivityTime(session))}
                      </span>
                    </div>
                    <span className="mobile-workspace-home-row-trailing">
                      <ChevronRightIcon />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="mobile-workspace-home-section mobile-workspace-home-empty">
          <p className="mobile-workspace-home-section-title">{t("shell.workspaceHomeSwitcherTitle")}</p>
          <div className="mobile-workspace-home-group">
            <button
              type="button"
              className="mobile-workspace-home-row"
              onClick={() => setActionMode("import")}
            >
              <span className="mobile-workspace-home-row-label">{t("shell.importWorkspaceTitle")}</span>
              <span className="mobile-workspace-home-row-trailing">
                <ChevronRightIcon />
              </span>
            </button>
            <button
              type="button"
              className="mobile-workspace-home-row"
              onClick={() => setActionMode("clone")}
            >
              <span className="mobile-workspace-home-row-label">{t("shell.cloneWorkspaceTitle")}</span>
              <span className="mobile-workspace-home-row-trailing">
                <ChevronRightIcon />
              </span>
            </button>
          </div>
        </section>
      )}

      {sheetMode === "switcher"
        ? renderSheet(
            <WorkspaceHomeSheet title={t("shell.workspaceHomeSwitcherTitle")} onClose={() => setSheetMode(null)}>
              <div className="mobile-workspace-home-group mobile-workspace-home-sheet-group">
                {navigationGroups.map((group) => (
                  <button
                    key={group.workspace.id}
                    type="button"
                    className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                    onClick={() => handleSelectWorkspace(group.workspace.id)}
                  >
                    <div className="mobile-workspace-home-session-main">
                      <span className="mobile-workspace-home-session-title">{group.workspace.name}</span>
                      <span className="mobile-workspace-home-session-meta">{group.workspace.path}</span>
                    </div>
                    <span className="mobile-workspace-home-row-trailing">
                      {group.workspace.id === currentWorkspace?.id ? <CheckIcon /> : <ChevronRightIcon />}
                    </span>
                  </button>
                ))}
              </div>
            </WorkspaceHomeSheet>
          )
        : null}

      {sheetMode === "actions" && currentWorkspace
        ? renderSheet(
            <WorkspaceHomeSheet title={currentWorkspace.name} onClose={() => setSheetMode(null)}>
              <div className="mobile-workspace-home-group mobile-workspace-home-sheet-group">
                <button
                  type="button"
                  className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                  onClick={() => {
                    setSheetMode(null);
                    handleStartSession();
                  }}
                >
                  <span className="mobile-workspace-home-row-label">{t("shell.createSession")}</span>
                  <span className="mobile-workspace-home-row-trailing">
                    <ChevronRightIcon />
                  </span>
                </button>
                <button
                  type="button"
                  className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                  onClick={() => {
                    setSheetMode(null);
                    handleOpenWorkspaceDetail();
                  }}
                >
                  <span className="mobile-workspace-home-row-label">{t("shell.workspaceDetailTitle")}</span>
                  <span className="mobile-workspace-home-row-trailing">
                    <ChevronRightIcon />
                  </span>
                </button>
                <button
                  type="button"
                  className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                  onClick={() => {
                    setSheetMode(null);
                    setActionMode("import");
                  }}
                >
                  <span className="mobile-workspace-home-row-label">{t("shell.importWorkspaceTitle")}</span>
                  <span className="mobile-workspace-home-row-trailing">
                    <ChevronRightIcon />
                  </span>
                </button>
                <button
                  type="button"
                  className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                  onClick={() => {
                    setSheetMode(null);
                    setActionMode("clone");
                  }}
                >
                  <span className="mobile-workspace-home-row-label">{t("shell.cloneWorkspaceTitle")}</span>
                  <span className="mobile-workspace-home-row-trailing">
                    <ChevronRightIcon />
                  </span>
                </button>
              </div>
            </WorkspaceHomeSheet>
          )
        : null}

      {actionMode === "import"
        ? renderSheet(
            <WorkspaceHomeSheet title={t("shell.importWorkspaceTitle")} onClose={() => setActionMode(null)}>
              <form className="mobile-feature-form mobile-workspace-home-form" onSubmit={handleImportWorkspace}>
                <label className="mobile-feature-field">
                  <span>{t("shell.importPathLabel")}</span>
                  <input
                    value={importPath}
                    placeholder={t("shell.importPathPlaceholder")}
                    onChange={(event) => setImportPath(event.target.value)}
                  />
                </label>
                <label className="mobile-feature-field">
                  <span>{t("shell.importNameLabel")}</span>
                  <input
                    value={importName}
                    placeholder={t("shell.importNamePlaceholder")}
                    onChange={(event) => setImportName(event.target.value)}
                  />
                </label>
                <div className="mobile-feature-inline-actions">
                  <button type="button" className="secondary-button" onClick={() => setActionMode(null)}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={submitting || !importPath.trim()}
                  >
                    {submitting ? t("shell.importSubmitting") : t("shell.importSubmit")}
                  </button>
                </div>
              </form>
            </WorkspaceHomeSheet>
          )
        : null}

      {actionMode === "clone"
        ? renderSheet(
            <WorkspaceHomeSheet title={t("shell.cloneWorkspaceTitle")} onClose={() => setActionMode(null)}>
              <form className="mobile-feature-form mobile-workspace-home-form" onSubmit={handleCloneWorkspace}>
                <label className="mobile-feature-field">
                  <span>{t("shell.cloneRepositoryLabel")}</span>
                  <input
                    value={cloneForm.repositoryUrl ?? ""}
                    placeholder={t("shell.cloneRepositoryPlaceholder")}
                    onChange={(event) =>
                      setCloneForm((current) => ({
                        ...current,
                        repositoryUrl: event.target.value
                      }))
                    }
                  />
                </label>
                <label className="mobile-feature-field">
                  <span>{t("shell.cloneParentPathLabel")}</span>
                  <input
                    value={cloneForm.parentPath ?? ""}
                    placeholder={t("shell.cloneParentPathPlaceholder")}
                    onChange={(event) =>
                      setCloneForm((current) => ({
                        ...current,
                        parentPath: event.target.value
                      }))
                    }
                  />
                </label>
                <label className="mobile-feature-field">
                  <span>{t("shell.cloneDirectoryNameLabel")}</span>
                  <input
                    value={cloneForm.directoryName ?? ""}
                    placeholder={t("shell.cloneDirectoryNamePlaceholder")}
                    onChange={(event) =>
                      setCloneForm((current) => ({
                        ...current,
                        directoryName: event.target.value
                      }))
                    }
                  />
                </label>
                <label className="mobile-feature-field">
                  <span>{t("shell.importNameLabel")}</span>
                  <input
                    value={cloneForm.name ?? ""}
                    placeholder={t("shell.importNamePlaceholder")}
                    onChange={(event) =>
                      setCloneForm((current) => ({
                        ...current,
                        name: event.target.value
                      }))
                    }
                  />
                </label>
                <div className="mobile-feature-inline-actions">
                  <button type="button" className="secondary-button" onClick={() => setActionMode(null)}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      submitting
                      || !cloneForm.repositoryUrl?.trim()
                      || !cloneForm.parentPath?.trim()
                    }
                  >
                    {submitting ? t("shell.cloneSubmitting") : t("shell.cloneSubmit")}
                  </button>
                </div>
              </form>
            </WorkspaceHomeSheet>
          )
        : null}
    </main>
  );
}

function WorkspaceHomeSheet({ title, onClose, children }: WorkspaceSheetProps) {
  return (
    <div className="ios-action-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-workspace-home-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{title}</strong>
          </div>
          {children}
        </div>
        <button
          type="button"
          className="ios-action-sheet-cancel"
          onClick={onClose}
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 6.5L8 10l4-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 3.5L10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="13" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
