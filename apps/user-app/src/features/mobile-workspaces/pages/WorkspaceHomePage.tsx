import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";
import {
  type ProviderId,
  type SessionSummaryDto,
  type WorkspaceDto
} from "../../conversation/api/conversation-api";
import { WorkspaceCloneModal } from "../../conversation/components/WorkspaceCloneModal";
import { WorkspaceImportBrowserModal } from "../../conversation/components/WorkspaceImportBrowserModal";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  buildWorkspaceDetailPath,
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  buildWorkspaceToolProcessesPath,
  buildWorkspaceTerminalsPath,
  buildWorkspaceToolsPath
} from "../../workbench/utils/workbench-navigation";
import { t } from "../../../shared/i18n";
import { MobileCreateSessionSheet } from "../../mobile-sessions/components/MobileCreateSessionSheet";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";

type WorkspaceActionMode = "import" | "clone" | null;

interface WorkspaceDashboardState {
  readonly gitLoading: boolean;
  readonly terminalLoading: boolean;
  readonly branch: string | null;
  readonly activeTerminalCount: number | null;
  readonly changedFileCount: number | null;
  readonly quickLaunchRunning: boolean | null;
}

interface WorkspaceHomeGitSnapshotCache {
  readonly status: {
    readonly snapshot: {
      readonly branch: string | null;
    };
    readonly changes: Array<{ path: string }>;
  } | null;
}

interface WorkspaceHomeTerminalManagerSnapshotCache {
  readonly terminals: Array<{
    readonly status: string;
  }>;
  readonly templates: unknown[];
  readonly templateStatuses: Array<{
    readonly occupied: boolean;
  }>;
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

const WORKSPACE_HOME_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;

export function WorkspaceHomePage() {
  const navigate = useNavigate();
  const {
    navigationGroups,
    currentWorkspaceId,
    refreshNavigation,
    selectWorkspace,
    startDraftSession,
    subscribeGitSnapshot,
    requestGitRefresh,
    addGitSnapshotListener,
    subscribeTerminalManagerSnapshot,
    requestTerminalManagerRefresh,
    addTerminalManagerSnapshotListener
  } = useWorkbenchShell();
  const [actionMode, setActionMode] = useState<WorkspaceActionMode>(null);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [dashboardState, setDashboardState] = useState<WorkspaceDashboardState>({
    gitLoading: false,
    terminalLoading: false,
    branch: null,
    activeTerminalCount: null,
    changedFileCount: null,
    quickLaunchRunning: null
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
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      setDashboardState({
        gitLoading: false,
        terminalLoading: false,
        branch: null,
        activeTerminalCount: null,
        changedFileCount: null,
        quickLaunchRunning: null
      });
      return;
    }

    const cachedSnapshot = readViewSnapshot<WorkspaceHomeGitSnapshotCache>(
      buildGitSidebarSnapshotKey(workspaceId),
      WORKSPACE_HOME_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    setDashboardState((current) => ({
      ...current,
      gitLoading: cachedSnapshot === null,
      branch: cachedSnapshot?.status?.snapshot.branch ?? null,
      changedFileCount: cachedSnapshot?.status?.changes.length ?? null
    }));
  }, [currentWorkspace?.id]);

  useEffect(() => {
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      return;
    }

    return addGitSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) {
        return;
      }

      writeViewSnapshot(buildGitSidebarSnapshotKey(workspaceId), snapshot);
      setDashboardState((current) => ({
        ...current,
        gitLoading: false,
        branch: snapshot.status?.snapshot.branch ?? snapshot.branches?.currentBranch ?? null,
        changedFileCount: snapshot.status?.changes.length ?? null
      }));
    });
  }, [addGitSnapshotListener, currentWorkspace?.id]);

  useEffect(() => {
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      setDashboardState((current) => ({
        ...current,
        gitLoading: false,
        branch: null,
        changedFileCount: null,
      }));
      return;
    }

    const cachedSnapshot = readViewSnapshot<WorkspaceHomeTerminalManagerSnapshotCache>(
      buildTerminalManagerSnapshotKey(workspaceId),
      WORKSPACE_HOME_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    setDashboardState((current) => ({
      ...current,
      terminalLoading: cachedSnapshot === null,
      activeTerminalCount: cachedSnapshot
        ? cachedSnapshot.terminals.filter((terminal) => isTerminalActive(terminal.status)).length
        : null,
      quickLaunchRunning: cachedSnapshot
        ? cachedSnapshot.templateStatuses.some((status) => status.occupied)
        : null
    }));
  }, [currentWorkspace?.id]);

  useEffect(() => {
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      setDashboardState((current) => ({
        ...current,
        terminalLoading: false,
        activeTerminalCount: null,
        quickLaunchRunning: null
      }));
      return;
    }

    return addTerminalManagerSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) {
        return;
      }

      writeViewSnapshot<WorkspaceHomeTerminalManagerSnapshotCache>(
        buildTerminalManagerSnapshotKey(workspaceId),
        {
          terminals: snapshot.terminals,
          templates: snapshot.templates,
          templateStatuses: snapshot.templateStatuses
        }
      );
      setDashboardState((current) => ({
        ...current,
        terminalLoading: false,
        activeTerminalCount: snapshot.terminals.filter((terminal) => isTerminalActive(terminal.status)).length,
        quickLaunchRunning: snapshot.templateStatuses.some((status) => status.occupied)
      }));
    });
  }, [addTerminalManagerSnapshotListener, currentWorkspace?.id]);

  useEffect(() => {
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      return;
    }

    const hasCachedSnapshot =
      readViewSnapshot<WorkspaceHomeGitSnapshotCache>(
        buildGitSidebarSnapshotKey(workspaceId),
        WORKSPACE_HOME_SNAPSHOT_CACHE_MAX_AGE_MS
      ) !== null;

    subscribeGitSnapshot(workspaceId);

    if (hasCachedSnapshot) {
      return;
    }

    requestGitRefresh(workspaceId);
  }, [
    currentWorkspace?.id,
    requestGitRefresh,
    subscribeGitSnapshot
  ]);

  useEffect(() => {
    const workspaceId = currentWorkspace?.id ?? null;

    if (!workspaceId) {
      return;
    }

    const hasCachedSnapshot =
      readViewSnapshot<WorkspaceHomeTerminalManagerSnapshotCache>(
        buildTerminalManagerSnapshotKey(workspaceId),
        WORKSPACE_HOME_SNAPSHOT_CACHE_MAX_AGE_MS
      ) !== null;

    subscribeTerminalManagerSnapshot(workspaceId);

    if (hasCachedSnapshot) {
      return;
    }

    requestTerminalManagerRefresh(workspaceId);
  }, [
    currentWorkspace?.id,
    requestTerminalManagerRefresh,
    subscribeTerminalManagerSnapshot
  ]);

  async function handleWorkspaceImported(workspace: WorkspaceDto) {
    await refreshNavigation();
    selectWorkspace(workspace.id);
    setActionMode(null);
    navigate(buildWorkspaceDetailPath(workspace.id));
  }

  async function handleWorkspaceCloned(workspace: WorkspaceDto) {
    await refreshNavigation();
    selectWorkspace(workspace.id);
    setActionMode(null);
    navigate(buildWorkspaceDetailPath(workspace.id));
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

    setCreateSessionOpen(true);
  }

  function handleSelectSessionProvider(workspaceId: string, provider: ProviderId) {
    setCreateSessionOpen(false);
    startDraftSession(workspaceId, provider);
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
      value: dashboardState.terminalLoading ? "…" : dashboardState.activeTerminalCount ?? "—",
      onClick: currentWorkspace ? openCurrentWorkspaceTerminals : undefined
    },
    {
      label: t("shell.workspaceHomeMetricChanges"),
      value: dashboardState.gitLoading ? "…" : dashboardState.changedFileCount ?? "—",
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
          <MobileWorkspaceSwitcherHeader
            currentWorkspace={currentWorkspace}
            workspaces={navigationGroups.map((group) => group.workspace)}
            onSelectWorkspace={handleSelectWorkspace}
            content={
              <div
                className="mobile-workspace-home-toolbar-summary"
                aria-label={t("shell.workspaceHomeStatusSectionTitle")}
              >
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
            }
            sheetContent={(closeSheet) => (
              <div className="mobile-workspace-home-group mobile-workspace-home-sheet-group">
                <button
                  type="button"
                  className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                  onClick={() => {
                    closeSheet();
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
                    closeSheet();
                    setActionMode("clone");
                  }}
                >
                  <span className="mobile-workspace-home-row-label">{t("shell.cloneWorkspaceTitle")}</span>
                  <span className="mobile-workspace-home-row-trailing">
                    <ChevronRightIcon />
                  </span>
                </button>
              </div>
            )}
          />

          <section className="mobile-workspace-home-section">
            <div className="mobile-workspace-home-primary-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={handleOpenWorkspaceDetail}
              >
                {t("shell.workspaceDetailTitle")}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleStartSession}
              >
                {t("shell.createSession")}
              </button>
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

      <WorkspaceImportBrowserModal
        open={actionMode === "import"}
        onClose={() => setActionMode(null)}
        onImported={handleWorkspaceImported}
      />

      <WorkspaceCloneModal
        open={actionMode === "clone"}
        onClose={() => setActionMode(null)}
        onCloned={handleWorkspaceCloned}
      />

      <MobileCreateSessionSheet
        open={createSessionOpen}
        workspaces={navigationGroups.map((group) => group.workspace)}
        initialWorkspaceId={currentWorkspace?.id ?? currentWorkspaceId ?? null}
        onClose={() => setCreateSessionOpen(false)}
        onSelect={handleSelectSessionProvider}
      />
    </main>
  );
}

function buildGitSidebarSnapshotKey(workspaceId: string) {
  return `git-sidebar.snapshot.${workspaceId}`;
}

function buildTerminalManagerSnapshotKey(workspaceId: string) {
  return `terminal-manager.snapshot.${workspaceId}`;
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
