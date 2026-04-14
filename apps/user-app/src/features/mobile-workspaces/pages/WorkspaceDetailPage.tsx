import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { readViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import {
  removeWorkspace,
  type ProviderId,
  type SessionSummaryDto,
  type WorkspaceManagementSummaryDto
} from "../../conversation/api/conversation-api";
import { getProviderDisplayName } from "../../conversation/capability/provider-ui";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { DebugReadinessView } from "../../debug-target/components/DebugReadinessView";
import { useDebugReadiness } from "../../debug-target/hooks/useDebugReadiness";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { MobileCreateSessionSheet } from "../../mobile-sessions/components/MobileCreateSessionSheet";
import { buildSessionTitlePresentation } from "../../conversation/session-title";
import { isRealSubagentSession } from "../../conversation/session-fork-display";
import {
  buildWorkspaceCompositionChartItems,
  createWorkspaceCompositionChartStyle,
  formatWorkspaceCompositionRatio
} from "../../workbench/utils/workspace-composition-chart";
import {
  buildWorkspaceDetailPath,
  buildWorkspaceSessionPath,
  buildWorkspaceTerminalsPath,
  buildWorkspaceToolFilesPath,
  buildWorkspaceToolGitPath,
  buildWorkspaceToolProcessesPath
} from "../../workbench/utils/workbench-navigation";
import {
  findNavigationWorkspaceTarget,
  flattenMobileWorkspaceOptions
} from "../../workbench/utils/mobile-workspace-tree";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

function isVisibleSession(session: SessionSummaryDto) {
  return session.isArchived !== true && !isRealSubagentSession(session);
}

function isArchivedSession(session: SessionSummaryDto) {
  return session.isArchived === true && !isRealSubagentSession(session);
}

const WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;
const ARCHIVED_SESSIONS_PAGE_SIZE = 10;

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
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [visibleArchivedCount, setVisibleArchivedCount] = useState(ARCHIVED_SESSIONS_PAGE_SIZE);

  const workspaceOptions = flattenMobileWorkspaceOptions(navigationGroups);
  const workspaceTarget = findNavigationWorkspaceTarget(navigationGroups, workspaceId);
  const workspace = workspaceTarget?.workspace ?? null;
  const workspaceSummary =
    workspaceOptions.find((item) => item.workspace.id === workspace?.id)
    ?? (workspace
      ? {
          workspace,
          label: workspace.name,
          subtitle: workspace.path,
          depth: 0,
          kind: "workspace" as const,
          meta: null
        }
      : null);
  const visibleSessions = useMemo(
    () => [...(workspaceTarget?.sessions ?? [])].filter(isVisibleSession),
    [workspaceTarget]
  );
  const archivedSessions = useMemo(
    () => [...(workspaceTarget?.sessions ?? [])].filter(isArchivedSession),
    [workspaceTarget]
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
    subscribeWorkspaceManagementSnapshot(workspaceId);

    const hasCachedGitSnapshot =
      readViewSnapshot<{ status: unknown }>(
        buildGitSidebarSnapshotKey(workspaceId),
        WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
      )
      !== null;
    const hasCachedManagementSnapshot =
      readViewSnapshot<WorkspaceManagementSummaryDto>(
        buildWorkspaceManagementSummarySnapshotKey(workspaceId),
        WORKSPACE_MANAGEMENT_SNAPSHOT_CACHE_MAX_AGE_MS
      ) !== null;

    if (!hasCachedGitSnapshot) {
      requestGitRefresh(workspaceId);
    }

    if (!hasCachedManagementSnapshot) {
      requestWorkspaceManagementRefresh(workspaceId);
    }
  }, [
    requestGitRefresh,
    requestWorkspaceManagementRefresh,
    subscribeGitSnapshot,
    subscribeWorkspaceManagementSnapshot,
    workspaceId
  ]);

  useEffect(() => {
    setVisibleArchivedCount(ARCHIVED_SESSIONS_PAGE_SIZE);
  }, [workspaceId]);

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
  const compositionChartItems = useMemo(
    () =>
      detailState.summary
        ? buildWorkspaceCompositionChartItems(
            detailState.summary.codeComposition.items,
            t("shell.manageWorkspaceCodeCompositionOther")
          )
        : [],
    [detailState.summary]
  );
  const compositionChartStyle = useMemo(
    () => (compositionChartItems.length > 0 ? createWorkspaceCompositionChartStyle(compositionChartItems) : undefined),
    [compositionChartItems]
  );
  const visibleArchivedSessions = useMemo(
    () => archivedSessions.slice(0, visibleArchivedCount),
    [archivedSessions, visibleArchivedCount]
  );
  const debugReadinessState = useDebugReadiness(
    workspace ? { id: workspace.id, path: workspace.path, name: workspace.name } : null
  );

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

  function handleSelectSessionProvider(targetWorkspaceId: string, provider: ProviderId) {
    setCreateSessionOpen(false);
    startDraftSession(targetWorkspaceId, provider);
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
    <main className="mobile-feature-page mobile-page-scroll-root mobile-page-with-top-header mobile-workspace-detail-page">
      <MobileWorkspaceSwitcherHeader
        currentWorkspace={
          workspaceSummary
            ? {
                id: workspaceSummary.workspace.id,
                name: workspaceSummary.label,
                path: workspaceSummary.subtitle
              }
            : null
        }
        workspaces={navigationGroups.map((group) => group.workspace)}
        workspaceOptions={workspaceOptions}
        heading={t("shell.workspaceDetailTitle")}
        triggerLabel={workspaceSummary?.label ?? workspace.name}
        onSelectWorkspace={(targetWorkspaceId) => {
          selectWorkspace(targetWorkspaceId);
          navigate(buildWorkspaceDetailPath(targetWorkspaceId));
        }}
        content={
          <div className="mobile-workspace-detail-header-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setCreateSessionOpen(true)}
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
        }
      />

      <div className="mobile-page-top-body mobile-workspace-detail-body">
        <section className="mobile-feature-panel surface-card mobile-workspace-detail-summary-panel">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.workspaceDetailSummaryTitle")}</h2>
            </div>
            {currentWorkspaceId !== workspace.id ? (
              <button
                type="button"
                className="secondary-button mobile-workspace-detail-switch-button"
                onClick={() => selectWorkspace(workspace.id)}
              >
                {t("shell.switchWorkspace")}
              </button>
            ) : null}
          </div>
          {detailState.loading && detailState.summary === null ? <p>{t("common.loading")}</p> : null}
          {detailState.error ? <p className="status-text" data-tone="error">{detailState.error}</p> : null}
          {detailState.summary ? (
            <div className="mobile-detail-grid mobile-workspace-detail-grid">
              <div className="mobile-detail-metric mobile-detail-metric-wide">
                <span>{t("shell.manageWorkspacePathLabel")}</span>
                <strong title={detailState.summary.path}>{detailState.summary.path}</strong>
              </div>
              <div className="mobile-detail-metric">
                <span>{t("shell.manageWorkspaceCurrentBranch")}</span>
                <strong title={detailState.summary.git.currentBranch ?? t("common.unknown")}>
                  {detailState.summary.git.currentBranch ?? t("common.unknown")}
                </strong>
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
          <div className="mobile-feature-inline-actions mobile-workspace-detail-summary-actions">
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

        <DebugReadinessView
          workspace={workspace ? { id: workspace.id, path: workspace.path, name: workspace.name } : null}
          state={debugReadinessState}
          variant="mobile"
        />

        <section className="mobile-feature-panel surface-card mobile-workspace-composition-panel">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.manageWorkspaceCodeCompositionLabel")}</h2>
            </div>
            {detailState.summary ? (
              <span className="mobile-feature-counter">
                {detailState.summary.codeComposition.scannedFileCount}
              </span>
            ) : null}
          </div>
          {detailState.loading && detailState.summary === null ? <p>{t("common.loading")}</p> : null}
          {detailState.summary ? (
            compositionChartItems.length > 0 ? (
              <div className="workbench-manage-type-chart">
                <div
                  className="workbench-manage-type-chart-ring"
                  style={compositionChartStyle}
                  aria-hidden="true"
                >
                  <strong className="workbench-manage-type-chart-total">
                    {detailState.summary.codeComposition.scannedFileCount}
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
              <p>{detailState.summary.codeComposition.error ?? t("shell.manageWorkspaceNoCodeComposition")}</p>
            )
          ) : null}
          {detailState.summary?.codeComposition.truncated ? (
            <p className="mobile-workspace-composition-note">
              {t("shell.manageWorkspaceCodeTruncated", {
                count: detailState.summary.codeComposition.scannedFileCount
              })}
            </p>
          ) : null}
        </section>

        <section className="mobile-feature-section">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.recentSessionsSectionTitle")}</h2>
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
                const isFavorite = favoriteSessionIds.includes(session.sessionId);

                return (
                  <article key={session.sessionId} className="mobile-session-row surface-card">
                    <button
                      type="button"
                      className="mobile-session-row-primary"
                      onClick={() => navigate(buildWorkspaceSessionPath(workspace.id, session.sessionId))}
                    >
                      <span className="mobile-session-row-title" title={titlePresentation.fullTitle}>
                        {titlePresentation.displayTitle}
                      </span>
                      <span className="mobile-session-row-provider">{getProviderDisplayName(session.provider)}</span>
                    </button>
                    <div className="mobile-session-row-actions">
                      <span className="mobile-feature-badge mobile-session-row-count">{session.messageCount}</span>
                      <button
                        type="button"
                        className="mobile-session-row-action"
                        aria-label={isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction")}
                        title={isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction")}
                        onClick={() => {
                          void toggleFavoriteSession(session.sessionId);
                        }}
                      >
                        <FavoriteIcon active={isFavorite} />
                      </button>
                      <button
                        type="button"
                        className="mobile-session-row-action"
                        aria-label={t("shell.archiveAction")}
                        title={t("shell.archiveAction")}
                        onClick={() => {
                          void archiveSession(session.sessionId);
                        }}
                      >
                        <ArchiveIcon />
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
              </div>
              <span className="mobile-feature-counter">{archivedSessions.length}</span>
            </div>
            <div className="mobile-feature-stack">
              {visibleArchivedSessions.map((session) => (
                <article key={session.sessionId} className="mobile-session-row surface-card">
                  <div className="mobile-session-row-primary mobile-session-row-primary-static">
                    <span className="mobile-session-row-title" title={session.title}>{session.title}</span>
                    <span className="mobile-session-row-provider">{getProviderDisplayName(session.provider)}</span>
                  </div>
                  <div className="mobile-session-row-actions">
                    <button
                      type="button"
                      className="secondary-button mobile-session-row-restore"
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
            {visibleArchivedSessions.length < archivedSessions.length ? (
              <button
                type="button"
                className="secondary-button mobile-workspace-detail-expand-button"
                onClick={() => {
                  setVisibleArchivedCount((current) => current + ARCHIVED_SESSIONS_PAGE_SIZE);
                }}
              >
                {t("shell.archiveExpandMore")}
              </button>
            ) : null}
          </section>
        ) : null}
      </div>

      <MobileCreateSessionSheet
        open={createSessionOpen}
        workspaces={navigationGroups.map((group) => group.workspace)}
        workspaceOptions={workspaceOptions}
        initialWorkspaceId={currentWorkspaceId ?? workspace.id}
        onClose={() => setCreateSessionOpen(false)}
        onSelect={handleSelectSessionProvider}
      />
    </main>
  );
}

function FavoriteIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
      <path d="m12 3.6 2.6 5.2 5.7.8-4.1 4 1 5.7L12 16.5 6.8 19.3l1-5.7-4.1-4 5.7-.8Z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7.5h16" />
      <path d="M6.4 7.5h11.2l-.9 10.2a2 2 0 0 1-2 1.8H9.3a2 2 0 0 1-2-1.8Z" />
      <path d="M8 4.5h8a1.5 1.5 0 0 1 1.5 1.5v1.5h-11V6A1.5 1.5 0 0 1 8 4.5Z" />
      <path d="M10 11.5h4" />
    </svg>
  );
}

function buildWorkspaceManagementSummarySnapshotKey(workspaceId: string) {
  return `workspace-management.summary.${workspaceId}`;
}

function buildGitSidebarSnapshotKey(workspaceId: string) {
  return `git-sidebar.snapshot.${workspaceId}`;
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
