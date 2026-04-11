import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import type { ProviderId } from "../../conversation/api/conversation-api";
import { isRealSubagentSession } from "../../conversation/session-fork-display";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { MobileCreateSessionSheet } from "../components/MobileCreateSessionSheet";
import {
  buildWorkspaceSessionIndexPath,
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
    selectWorkspace,
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
  const favoriteSet = useMemo(() => new Set(favoriteSessionIds), [favoriteSessionIds]);
  const currentWorkspaceEntries = useMemo(
    () =>
      currentWorkspaceGroup
        ? flattenNavigationSessions([currentWorkspaceGroup]).filter(
            (entry) => !entry.session.isArchived && !isRealSubagentSession(entry.session)
          )
        : ([] as WorkbenchNavigationEntry[]),
    [currentWorkspaceGroup]
  );
  const visibleTree = useMemo(
    () => buildNavigationSessionTree(currentWorkspaceEntries),
    [currentWorkspaceEntries]
  );
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
    writeMobileConversationPreviewMode("immersive");
    navigate(buildWorkspaceSessionPath(workspaceId, sessionId));
  }

  function handleSelectSessionProvider(workspaceId: string, provider: ProviderId) {
    setCreateSessionOpen(false);
    writeMobileConversationPreviewMode("immersive");
    startDraftSession(workspaceId, provider);
  }

  return (
    <main className="session-index-page mobile-feature-page mobile-page-scroll-root mobile-page-with-top-header">
      <MobileWorkspaceSwitcherHeader
        currentWorkspace={currentWorkspaceGroup?.workspace ?? null}
        workspaces={navigationGroups.map((group) => group.workspace)}
        onSelectWorkspace={(workspaceId) => {
          selectWorkspace(workspaceId);
          navigate(buildWorkspaceSessionIndexPath(workspaceId));
        }}
        content={
          <button
            type="button"
            className="primary-button mobile-session-index-create-button"
            disabled={navigationLoading || !canStartSession}
            onClick={() => setCreateSessionOpen(true)}
          >
            {t("shell.createSession")}
          </button>
        }
      />

      <div className="mobile-page-top-body">
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
      </div>

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
