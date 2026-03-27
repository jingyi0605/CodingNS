import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  buildNavigationSessionTree,
  flattenNavigationSessions
} from "../../workbench/utils/workbench-navigation";
import { SessionListItem } from "../components/SessionListItem";
import "../styles.css";

export function SessionIndexPage() {
  const navigate = useNavigate();
  const {
    navigationGroups,
    favoriteSessionIds,
    currentWorkspaceId,
    currentSessionId,
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
  const visibleTree = useMemo(
    () => buildNavigationSessionTree(flattenedSessions.filter((entry) => !entry.session.isArchived)),
    [flattenedSessions]
  );
  const favoriteTree = useMemo(
    () =>
      visibleTree.filter(
        (node) =>
          favoriteSet.has(node.entry.session.sessionId)
          || node.children.some((entry) => favoriteSet.has(entry.session.sessionId))
      ),
    [favoriteSet, visibleTree]
  );
  const recentTree = useMemo(
    () =>
      visibleTree
        .filter(
          (node) =>
            !favoriteSet.has(node.entry.session.sessionId)
            && !node.children.some((entry) => favoriteSet.has(entry.session.sessionId))
        )
        .slice(0, 6),
    [favoriteSet, visibleTree]
  );
  const workspaceTree = useMemo(
    () =>
      currentWorkspaceId
        ? visibleTree.filter(
            (node) =>
              node.entry.workspace.id === currentWorkspaceId &&
              !favoriteSet.has(node.entry.session.sessionId) &&
              !node.children.some((entry) => favoriteSet.has(entry.session.sessionId))
          )
        : [],
    [currentWorkspaceId, favoriteSet, visibleTree]
  );
  const workspaceName =
    currentWorkspaceId &&
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace.name;
  const fallbackWorkspaceId = currentWorkspaceId ?? navigationGroups[0]?.workspace.id ?? "";
  const canStartSession = Boolean(fallbackWorkspaceId);
  const [expandedSubagentRootIds, setExpandedSubagentRootIds] = useState<string[]>([]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    const rootSessionIdsToExpand = [favoriteTree, recentTree, workspaceTree]
      .flatMap((nodes) =>
        nodes
          .filter((node) => node.children.some((entry) => entry.session.sessionId === currentSessionId))
          .map((node) => node.entry.session.sessionId)
      );

    if (rootSessionIdsToExpand.length === 0) {
      return;
    }

    setExpandedSubagentRootIds((current) => {
      const currentSet = new Set(current);
      let changed = false;

      for (const sessionId of rootSessionIdsToExpand) {
        if (!currentSet.has(sessionId)) {
          currentSet.add(sessionId);
          changed = true;
        }
      }

      return changed ? Array.from(currentSet) : current;
    });
  }, [currentSessionId, favoriteTree, recentTree, workspaceTree]);

  function toggleSubagentList(sessionId: string) {
    setExpandedSubagentRootIds((current) =>
      current.includes(sessionId) ? current.filter((item) => item !== sessionId) : [...current, sessionId]
    );
  }

  const renderSection = ({
    title,
    description,
    tree,
    emptyText
  }: {
    title: string;
    description?: string;
    tree: ReturnType<typeof buildNavigationSessionTree>;
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
        <span className="session-section-count">{tree.length}</span>
      </header>
      {tree.length === 0 ? (
        <p className="session-section-empty">{emptyText}</p>
      ) : (
        <div className="session-section-list">
          {tree.map((node) => {
            const rootSessionId = node.entry.session.sessionId;
            const isExpanded = expandedSubagentRootIds.includes(rootSessionId);

            return (
              <div key={`${node.entry.workspace.id}:${rootSessionId}`} className="session-list-tree-node">
                <SessionListItem
                  entry={node.entry}
                  isFavorite={favoriteSet.has(rootSessionId)}
                  isActive={currentSessionId === rootSessionId}
                  hasSubsessions={node.children.length > 0}
                  onActivate={(sessionId) => navigate(`/sessions/${sessionId}`)}
                  onToggleSubsessions={() => toggleSubagentList(rootSessionId)}
                  onToggleFavorite={(sessionId) => {
                    void toggleFavoriteSession(sessionId);
                  }}
                  onArchive={(sessionId) => archiveSession(sessionId)}
                  onUnarchive={(sessionId) => unarchiveSession(sessionId)}
                  onRename={(sessionId, title) => renameSession(sessionId, title)}
                />
                {isExpanded && node.children.length > 0 ? (
                  <div className="session-list-children">
                    {node.children.map((entry) => (
                      <SessionListItem
                        key={`${entry.workspace.id}:${entry.session.sessionId}`}
                        entry={entry}
                        isFavorite={favoriteSet.has(entry.session.sessionId)}
                        isActive={currentSessionId === entry.session.sessionId}
                        depth={1}
                        onActivate={(sessionId) => navigate(`/sessions/${sessionId}`)}
                        onToggleFavorite={(sessionId) => {
                          void toggleFavoriteSession(sessionId);
                        }}
                        onArchive={(sessionId) => archiveSession(sessionId)}
                        onUnarchive={(sessionId) => unarchiveSession(sessionId)}
                        onRename={(sessionId, title) => renameSession(sessionId, title)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
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
        tree: recentTree,
        emptyText: navigationLoading ? t("shell.searchSessionHint") : t("shell.searchSessionEmpty")
      })}
      {renderSection({
        title: t("shell.favoriteSectionTitle"),
        tree: favoriteTree,
        emptyText: t("shell.favoriteSectionEmpty")
      })}
      {renderSection({
        title: workspaceName ?? t("shell.workspaceSectionTitle"),
        description: workspaceName ? undefined : t("shell.workspaceSectionTitle"),
        tree: workspaceTree,
        emptyText: t("shell.emptyWorkspaceSessions")
      })}
    </main>
  );
}
