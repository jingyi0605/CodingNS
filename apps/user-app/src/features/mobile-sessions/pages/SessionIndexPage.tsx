import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  flattenNavigationSessions,
  WorkbenchNavigationEntry
} from "../../workbench/utils/workbench-navigation";
import { SessionListItem } from "../components/SessionListItem";
import "../styles.css";

export function SessionIndexPage() {
  const navigate = useNavigate();
  const {
    navigationGroups,
    favoriteSessionIds,
    currentWorkspaceId,
    navigationLoading,
    toggleFavoriteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    startDraftSession
  } = useWorkbenchShell();

  const flattenedSessions = useMemo(
    () => flattenNavigationSessions(navigationGroups),
    [navigationGroups]
  );
  const favoriteSet = useMemo(() => new Set(favoriteSessionIds), [favoriteSessionIds]);
  const favoriteEntries = flattenedSessions.filter(
    (entry) => favoriteSet.has(entry.session.sessionId) && !entry.session.isArchived
  );
  const recentEntries = flattenedSessions
    .filter((entry) => !favoriteSet.has(entry.session.sessionId) && !entry.session.isArchived)
    .slice(0, 6);
  const workspaceEntries = currentWorkspaceId
    ? flattenedSessions.filter(
        (entry) =>
          entry.workspace.id === currentWorkspaceId && !entry.session.isArchived
      )
    : [];
  const workspaceName =
    currentWorkspaceId &&
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace.name;
  const fallbackWorkspaceId = currentWorkspaceId ?? navigationGroups[0]?.workspace.id ?? "";
  const canStartSession = Boolean(fallbackWorkspaceId);

  const renderSection = ({
    title,
    description,
    entries,
    emptyText
  }: {
    title: string;
    description?: string;
    entries: WorkbenchNavigationEntry[];
    emptyText: string;
  }) => (
    <section className="session-section">
      <header className="session-section-heading">
        <div>
          <h2>{title}</h2>
          {description ? (
            <p className="session-section-description">{description}</p>
          ) : null}
        </div>
        <span className="session-section-count">{entries.length}</span>
      </header>
      {entries.length === 0 ? (
        <p className="session-section-empty">{emptyText}</p>
      ) : (
        <div className="session-section-list">
          {entries.map((entry) => (
            <SessionListItem
              key={`${entry.workspace.id}:${entry.session.sessionId}`}
              entry={entry}
              isFavorite={favoriteSet.has(entry.session.sessionId)}
              onActivate={(sessionId) => navigate(`/sessions/${sessionId}`)}
              onToggleFavorite={(sessionId) => toggleFavoriteSession(sessionId)}
              onArchive={(sessionId) => archiveSession(sessionId)}
              onUnarchive={(sessionId) => unarchiveSession(sessionId)}
              onRename={(sessionId, title) => renameSession(sessionId, title)}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <main className="session-index-page">
      <div className="session-index-header">
        <div>
          <p className="session-index-subtitle">{t("shell.mobileSessionsEntry")}</p>
          <h1>{workspaceName ?? t("shell.sessionCount")}</h1>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={navigationLoading || !canStartSession}
          onClick={() => startDraftSession(fallbackWorkspaceId, "codex")}
        >
          {t("shell.createSession")}
        </button>
      </div>
      {renderSection({
        title: t("shell.sessionCount"),
        description: t("shell.mobileSessionsEntry"),
        entries: recentEntries,
        emptyText: navigationLoading ? t("shell.searchSessionHint") : t("shell.searchSessionEmpty")
      })}
      {renderSection({
        title: t("shell.favoriteSectionTitle"),
        entries: favoriteEntries,
        emptyText: t("shell.favoriteSectionEmpty")
      })}
      {renderSection({
        title: workspaceName ?? t("shell.workspaceSectionTitle"),
        description: workspaceName ? undefined : t("shell.workspaceSectionTitle"),
        entries: workspaceEntries,
        emptyText: t("shell.emptyWorkspaceSessions")
      })}
    </main>
  );
}
