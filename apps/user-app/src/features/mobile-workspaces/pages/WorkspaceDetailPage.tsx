import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  getWorkspaceManagementSummary,
  removeWorkspace
} from "../../conversation/api/conversation-api";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { buildSessionTitlePresentation } from "../../conversation/session-title";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

function getProviderLabel(provider: string) {
  return provider === "codex" ? t("conversation.providerCodex") : t("conversation.providerClaude");
}

export function WorkspaceDetailPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    navigationGroups,
    currentWorkspaceId,
    favoriteSessionIds,
    selectWorkspace,
    toggleFavoriteSession,
    archiveSession,
    unarchiveSession,
    startDraftSession
  } = useWorkbenchShell();
  const [detailState, setDetailState] = useState<{
    loading: boolean;
    error: string | null;
    summary: Awaited<ReturnType<typeof getWorkspaceManagementSummary>> | null;
  }>({
    loading: true,
    error: null,
    summary: null
  });
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
    let disposed = false;

    if (!workspaceId) {
      setDetailState({
        loading: false,
        error: null,
        summary: null
      });
      return;
    }

    setDetailState({
      loading: true,
      error: null,
      summary: null
    });

    void getWorkspaceManagementSummary(workspaceId)
      .then((summary) => {
        if (disposed) {
          return;
        }

        setDetailState({
          loading: false,
          error: null,
          summary
        });
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setDetailState({
          loading: false,
          error: error instanceof Error ? error.message : t("shell.manageWorkspaceLoadFailed"),
          summary: null
        });
      });

    return () => {
      disposed = true;
    };
  }, [workspaceId]);

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
      navigate("/", { replace: true });
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
      <main className="mobile-feature-page">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.workspaceDetailMissingTitle")}</h1>
          <p>{t("shell.workspaceDetailMissingBody")}</p>
          <button type="button" className="secondary-button" onClick={() => navigate("/")}>
            {t("shell.mobileWorkspacesEntry")}
          </button>
        </article>
      </main>
    );
  }

  return (
    <main className="mobile-feature-page mobile-workspace-detail-page">
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
              navigate("/tools/files");
            }}
          >
            {t("shell.filesEntry")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate("/terminals");
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
        {detailState.loading ? <p>{t("common.loading")}</p> : null}
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
              <strong>{detailState.summary.git.commitCount ?? 0}</strong>
            </div>
            <div className="mobile-detail-metric">
              <span>{t("shell.manageWorkspaceCodeCompositionFiles")}</span>
              <strong>{detailState.summary.codeComposition.scannedFileCount}</strong>
            </div>
          </div>
        ) : null}
        <div className="mobile-feature-inline-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate("/tools/git");
            }}
          >
            {t("shell.gitEntry")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              selectWorkspace(workspace.id);
              navigate("/tools/processes");
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
                      onClick={() => navigate(`/sessions/${session.sessionId}`)}
                    >
                      {t("shell.contextOpenSession")}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => toggleFavoriteSession(session.sessionId)}
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
