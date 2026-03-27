import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import type { ProviderId } from "../../conversation/api/conversation-api";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { MobileCreateSessionSheet } from "../components/MobileCreateSessionSheet";
import {
  buildWorkspaceSessionPath,
  buildNavigationSessionTree,
  flattenNavigationSessions,
  type WorkbenchNavigationEntry
} from "../../workbench/utils/workbench-navigation";
import { SessionListItem } from "../components/SessionListItem";
import { writeMobileConversationPreviewMode } from "../mobile-conversation-state";
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

  const currentWorkspaceGroup =
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId) ??
    navigationGroups[0] ??
    null;
  const flattenedSessions = useMemo(() => flattenNavigationSessions(navigationGroups), [navigationGroups]);
  const favoriteSet = useMemo(() => new Set(favoriteSessionIds), [favoriteSessionIds]);
  const currentWorkspaceEntries = useMemo(
    () =>
      currentWorkspaceGroup
        ? flattenNavigationSessions([currentWorkspaceGroup]).filter((entry) => !entry.session.isArchived)
        : ([] as WorkbenchNavigationEntry[]),
    [currentWorkspaceGroup]
  );
  const visibleTree = useMemo(
    () => buildNavigationSessionTree(currentWorkspaceEntries),
    [currentWorkspaceEntries]
  );
  const workspaceName = currentWorkspaceGroup?.workspace.name ?? null;
  const fallbackWorkspaceId = currentWorkspaceGroup?.workspace.id ?? "";
  const canStartSession = Boolean(fallbackWorkspaceId);
  const [expandedSubagentRootIds, setExpandedSubagentRootIds] = useState<string[]>([]);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    const rootSessionIdsToExpand = visibleTree
      .filter((node) => node.children.some((entry) => entry.session.sessionId === currentSessionId))
      .map((node) => node.entry.session.sessionId);

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
  }, [currentSessionId, visibleTree]);

  function toggleSubagentList(sessionId: string) {
    setExpandedSubagentRootIds((current) =>
      current.includes(sessionId) ? current.filter((item) => item !== sessionId) : [...current, sessionId]
    );
  }

  function handleActivateSession(workspaceId: string, sessionId: string) {
    writeMobileConversationPreviewMode("preview");
    navigate(buildWorkspaceSessionPath(workspaceId, sessionId));
  }

  function handleSelectSessionProvider(workspaceId: string, provider: ProviderId) {
    setCreateSessionOpen(false);
    startDraftSession(workspaceId, provider);
  }

  return (
    <main className="session-index-page mobile-page-scroll-root">
      <section className="session-index-sheet surface-card">
        <header className="session-index-header">
          <div>
            <p className="session-index-subtitle">{t("shell.mobileSessionsEntry")}</p>
            <h1>{workspaceName ?? t("shell.sessionCount")}</h1>
            <p className="session-index-description">{t("shell.mobileConversationCurrentWorkspaceSection")}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={navigationLoading || !canStartSession}
            onClick={() => setCreateSessionOpen(true)}
          >
            {t("shell.createSession")}
          </button>
        </header>

        <section className="session-section session-section-sheet">
          <header className="session-section-heading">
            <div>
              <h2>{t("shell.mobileConversationCurrentWorkspaceSection")}</h2>
            </div>
            <span className="session-section-count">{visibleTree.length}</span>
          </header>
          {visibleTree.length === 0 ? (
            <p className="session-section-empty">
              {navigationLoading ? t("shell.searchSessionHint") : t("shell.emptyWorkspaceSessions")}
            </p>
          ) : (
            <div className="session-current-workspace-list">
              {visibleTree.map((node) => {
                const rootSessionId = node.entry.session.sessionId;
                const isExpanded = expandedSubagentRootIds.includes(rootSessionId);

                return (
                  <div key={`${node.entry.workspace.id}:${rootSessionId}`} className="session-list-tree-node">
                    <SessionListItem
                      entry={node.entry}
                      isFavorite={favoriteSet.has(rootSessionId)}
                      isActive={currentSessionId === rootSessionId}
                      variant="mobile"
                      hasSubsessions={node.children.length > 0}
                      onActivate={(sessionId) => handleActivateSession(node.entry.workspace.id, sessionId)}
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
                            variant="mobile"
                            onActivate={(sessionId) => handleActivateSession(entry.workspace.id, sessionId)}
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
      </section>

      <MobileCreateSessionSheet
        open={createSessionOpen}
        workspaces={navigationGroups.map((group) => group.workspace)}
        initialWorkspaceId={currentWorkspaceId ?? fallbackWorkspaceId}
        onClose={() => setCreateSessionOpen(false)}
        onSelect={handleSelectSessionProvider}
      />
    </main>
  );
}
