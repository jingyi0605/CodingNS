import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { readViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import {
  removeWorkspace,
  type WorkspaceManagementSummaryDto
} from "../../conversation/api/conversation-api";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { buildSessionTitlePresentation } from "../../conversation/session-title";
import {
  buildWorkspaceSessionPath,
  buildWorkspaceTerminalsPath,
  buildWorkspaceToolFilesPath,
  buildWorkspaceToolGitPath,
  buildWorkspaceToolProcessesPath
} from "../../workbench/utils/workbench-navigation";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

function getProviderLabel(provider: string) {
  return provider === "codex" ? t("conversation.providerCodex") : t("conversation.providerClaude");
}

const WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;

export function WorkspaceDetailPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    navigationGroups,
    currentWorkspaceId,
    favoriteSessionIds,
    workspaceManagementStateById,
    selectWorkspace,
    subscribeGitSnapshot,
    requestGitRefresh,
    subscribeWorkspaceManagementSnapshot,
    requestWorkspaceManagementRefresh,
    toggleFavoriteSession,
    archiveSession,
    unarchiveSession,
    startDraftSession
  } = useWorkbenchShell();
  const [removing, setRemoving] = useState(false);

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId) ?? null;
  const workspace = workspaceGroup?.workspace ?? null;
  const visibleSessions = useMemo(
    () => workspaceGroup?.sessions.filter((session) => session.isArchived !== true) ?? [],
    [workspaceGroup]
  );
  const archivedSessions = useMemo(
    () => workspaceGroup?.sessions.filter((session) => session.isArchived === true) ?? [],
    [workspaceGroup]
  );

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    selectWorkspace(workspaceId);
  }, [selectWorkspace, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    subscribeGitSnapshot(workspaceId);
    requestGitRefresh(workspaceId);
    subscribeWorkspaceManagementSnapshot(workspaceId);
    requestWorkspaceManagementRefresh(workspaceId);
  }, [
    requestGitRefresh,
    requestWorkspaceManagementRefresh,
    subscribeGitSnapshot,
    subscribeWorkspaceManagementSnapshot,
    workspaceId
  ]);

  const detailState = useMemo(() => {
    if (!workspaceId) {
      return {
        loading: false,
        error: null,
        hasMeaningfulSummary: false,
        summary: null as WorkspaceManagementSummaryDto | null
      };
    }

    const cachedSummary = readViewSnapshot<WorkspaceManagementSummaryDto>(
      buildWorkspaceManagementSummarySnapshotKey(workspaceId),
      WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
    );
    const sharedState = workspaceManagementStateById[workspaceId] ?? null;
    const summary =
      sharedState?.detail ??
      (workspace ? createWorkspaceSummaryFallback(workspace, cachedSummary) : cachedSummary ?? null);

    return {
      loading: sharedState?.loading ?? false,
      error: sharedState?.error ?? null,
      hasMeaningfulSummary: hasMeaningfulWorkspaceSummary(summary),
      summary
    };
  }, [workspace, workspaceId, workspaceManagementStateById]);

  async function handleRemoveWorkspace() {
    if (!workspace) {
      return;
    }

    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            t("shell.manageWorkspaceRemoveConfirmTarget", {
              name: workspace.name
            })
          );

    if (!confirmed) {
      return;
    }

    setRemoving(true);

    try {
      await removeWorkspace(workspace.id);
      showToast({
        title: t("shell.manageWorkspaceRemoveSuccess"),
        tone: "success"
      });
      navigate("/workspaces", { replace: true });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.manageWorkspaceRemoveFailed"),
        tone: "error"
      });
    } finally {
      setRemoving(false);
    }
  }

  if (!workspace) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.workspaceDetailMissingTitle")}</h1>
          <p>{t("shell.workspaceDetailMissingBody")}</p>
          <button type="button" className="secondary-button" onClick={() => navigate("/workspaces")}>
            {t("shell.mobileWorkspacesEntry")}
          </button>
        </article>
      </main>
    );
  }

  return (
    <main className="mobile-feature-page mobile-page-scroll-root mobile-workspace-detail-page">
      <section className="mobile-feature-hero surface-card">
        <div className="mobile-feature-hero-copy">
          <p className="mobile-feature-eyebrow">{t("shell.workspaceDetailTitle")}</p>
          <h1>{workspace.name}</h1>
          <p>{workspace.path}</p>
        </div>
        <div className="mobile-feature-hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => startDraftSession(workspace.id, "codex")}
          >
            {t("shell.createSession")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate(buildWorkspaceToolFilesPath(workspace.id));
            }}
          >
            {t("shell.filesEntry")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate(buildWorkspaceTerminalsPath(workspace.id));
            }}
          >
            {t("shell.terminalsEntry")}
          </button>
        </div>
      </section>

      <section className="mobile-feature-panel surface-card">
        <div className="mobile-feature-section-header">
          <div>
            <h2>{t("shell.workspaceDetailSummaryTitle")}</h2>
            <p>{t("shell.workspaceDetailSummaryBody")}</p>
          </div>
          {currentWorkspaceId === workspace.id ? (
            <span className="mobile-feature-badge">{t("shell.switchWorkspace")}</span>
          ) : null}
        </div>
        {detailState.loading && detailState.summary === null ? <p>{t("common.loading")}</p> : null}
        {detailState.error ? <p className="status-text" data-tone="error">{detailState.error}</p> : null}
        {detailState.summary ? (
          <div className="mobile-detail-grid">
            <div className="mobile-detail-metric">
              <span>{t("shell.manageWorkspacePathLabel")}</span>
              <strong>{detailState.summary.path}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.manageWorkspaceCurrentBranch")}</span>
              <strong>{detailState.summary.git.currentBranch ?? t("common.unknown")}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.manageWorkspaceGitCommitCount")}</span>
              <strong>{detailState.hasMeaningfulSummary ? detailState.summary.git.commitCount ?? 0 : "—"}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.manageWorkspaceCodeCompositionFiles")}</span>
              <strong>{detailState.hasMeaningfulSummary ? detailState.summary.codeComposition.scannedFileCount : "—"}</strong>
            </div>
          </div>
        ) : null}
        <div className="mobile-feature-inline-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate(buildWorkspaceToolGitPath(workspace.id));
            }}
          >
            {t("shell.gitEntry")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate(buildWorkspaceToolProcessesPath(workspace.id));
            }}
          >
            {t("shell.terminalManagerEntry")}
          </button>
          <button
            type="button"
            className="secondary-button workbench-danger-button"
            disabled={removing}
            onClick={() => {
              void handleRemoveWorkspace();
            }}
          >
            {removing ? t("shell.manageWorkspaceRemoving") : t("shell.manageWorkspaceRemoveAction")}
          </button>
        </div>
      </section>

      <section className="mobile-feature-section">
        <div className="mobile-feature-section-header">
          <div>
            <h2>{t("shell.recentSessionsSectionTitle")}</h2>
            <p>{t("shell.workspaceSessionListBody")}</p>
          </div>
          <span className="mobile-feature-counter">{visibleSessions.length}</span>
        </div>
        <div className="mobile-feature-stack">
          {visibleSessions.length === 0 ? (
            <article className="mobile-feature-empty surface-card">
              <p>{t("shell.emptyWorkspaceSessions")}</p>
            </article>
          ) : (
            visibleSessions.map((session) => {
              const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));

              return (
                <article key={session.sessionId} className="mobile-session-card surface-card">
                  <div className="mobile-session-card-main">
                    <div>
                      <h3 title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</h3>
                      <p>{getProviderLabel(session.provider)}</p>
                    </div>
                    <span className="mobile-feature-badge">{session.messageCount}</span>
                  </div>
                  <div className="mobile-feature-inline-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => navigate(buildWorkspaceSessionPath(workspace.id, session.sessionId))}
                    >
                      {t("shell.contextOpenSession")}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void toggleFavoriteSession(session.sessionId);
                      }}
                    >
                      {favoriteSessionIds.includes(session.sessionId)
                        ? t("shell.unfavoriteAction")
                        : t("shell.favoriteAction")}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void archiveSession(session.sessionId);
                      }}
                    >
                      {t("shell.archiveAction")}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {archivedSessions.length > 0 ? (
        <section className="mobile-feature-section">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.archiveModalTitle")}</h2>
              <p>{t("shell.archiveModalDescription")}</p>
            </div>
            <span className="mobile-feature-counter">{archivedSessions.length}</span>
          </div>
          <div className="mobile-feature-stack">
            {archivedSessions.map((session) => (
              <article key={session.sessionId} className="mobile-session-card surface-card">
                <div className="mobile-session-card-main">
                  <div>
                    <h3>{session.title}</h3>
                    <p>{getProviderLabel(session.provider)}</p>
                  </div>
                </div>
                <div className="mobile-feature-inline-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void unarchiveSession(session.sessionId);
                    }}
                  >
                    {t("shell.unarchiveAction")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function buildWorkspaceManagementSummarySnapshotKey(workspaceId: string) {
  return `workspace-management.summary.${workspaceId}`;
}

function createWorkspaceSummaryFallback(
  workspace: {
    id: string;
    name: string;
    path: string;
    repoRoot?: string | null;
  },
  existingSummary?: WorkspaceManagementSummaryDto | null
): WorkspaceManagementSummaryDto {
  const repoRoot = existingSummary?.git.repoRoot ?? workspace.repoRoot ?? null;

  return {
    workspaceId: workspace.id,
    name: workspace.name,
    path: workspace.path,
    git: {
      isRepository: existingSummary?.git.isRepository ?? Boolean(repoRoot),
      repoRoot,
      currentBranch: existingSummary?.git.currentBranch ?? null,
      commitCount: existingSummary?.git.commitCount ?? null,
      remotes: existingSummary?.git.remotes ?? [],
      error: existingSummary?.git.error ?? null
    },
    codeComposition: existingSummary?.codeComposition ?? {
      scannedFileCount: 0,
      truncated: false,
      items: [],
      error: null
    }
  };
}

function hasMeaningfulWorkspaceSummary(summary: WorkspaceManagementSummaryDto | null): boolean {
  if (!summary) {
    return false;
  }

  return (
    summary.git.isRepository
    || summary.git.repoRoot !== null
    || summary.git.currentBranch !== null
    || summary.git.commitCount !== null
    || summary.git.remotes.length > 0
    || summary.codeComposition.scannedFileCount > 0
    || summary.codeComposition.items.length > 0
    || summary.codeComposition.error !== null
  );
}
