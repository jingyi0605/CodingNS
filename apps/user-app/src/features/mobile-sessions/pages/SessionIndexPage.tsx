import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import type { ProviderId } from "../../conversation/api/conversation-api";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { MobileCreateSessionSheet } from "../components/MobileCreateSessionSheet";
import {
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  type WorkbenchNavigationEntry
} from "../../workbench/utils/workbench-navigation";
import {
  buildSessionTree,
  findSessionTreeAncestorIds
} from "../../workbench/utils/session-tree";
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
        ? currentWorkspaceGroup.sessions
            .filter((session) => !session.isArchived)
            .map((session) => ({
              session,
              workspace: currentWorkspaceGroup.workspace
            }))
        : ([] as WorkbenchNavigationEntry[]),
    [currentWorkspaceGroup]
  );
  const visibleTree = useMemo(
    () =>
      buildSessionTree(
        currentWorkspaceEntries,
        {
          getId: (entry) => entry.session.sessionId,
          getParentId: (entry) => entry.session.parentSessionId?.trim() || null,
          compare: (left, right) =>
            (right.session.lastMessageAt ?? right.session.updatedAt).localeCompare(
              left.session.lastMessageAt ?? left.session.updatedAt
            )
        }
      ),
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

    const sessionIdsToExpand = findSessionTreeAncestorIds(
      visibleTree,
      currentSessionId,
      (entry) => entry.session.sessionId
    );

    if (sessionIdsToExpand.length === 0) {
      return;
    }

    setExpandedSubagentRootIds((current) => {
      const currentSet = new Set(current);
      let changed = false;

      for (const sessionId of sessionIdsToExpand) {
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

  function renderSessionTreeNode(
    node: ReturnType<typeof buildSessionTree<WorkbenchNavigationEntry>>[number],
    ancestorExpanded = false,
    ancestorHasNextSiblings: readonly boolean[] = [],
    hasNextSibling = false,
    isFirstSibling = false
  ): JSX.Element {
    const sessionId = node.item.session.sessionId;
    const isExpanded = ancestorExpanded || expandedSubagentRootIds.includes(sessionId);
    const childNodes = node.children;
    const nextAncestorHasNextSiblings =
      node.depth > 0 ? [...ancestorHasNextSiblings, hasNextSibling] : [...ancestorHasNextSiblings];

    return (
      <div key={`${node.item.workspace.id}:${sessionId}`} className="session-list-tree-node">
        <div
          className="session-list-tree-row"
          style={
            {
              "--session-tree-depth": node.depth
            } as CSSProperties
          }
        >
          {node.depth > 0 ? (
            <div
              className="session-tree-guides"
              aria-hidden="true"
              style={
                {
                  "--session-tree-depth": node.depth
                } as CSSProperties
              }
            >
              {ancestorHasNextSiblings.map((continues, index) =>
                continues ? (
                  <span
                    key={`${sessionId}:ancestor:${index}`}
                    className="session-tree-guide-column"
                    style={
                      {
                        "--session-tree-level": index + 1
                      } as CSSProperties
                    }
                  />
                ) : null
              )}
              <span
                className="session-tree-guide-branch"
                data-continue={hasNextSibling}
                data-first={isFirstSibling}
                style={
                  {
                    "--session-tree-level": node.depth
                  } as CSSProperties
                }
              >
                <span className="session-tree-guide-branch-horizontal" />
              </span>
            </div>
          ) : null}
          <SessionListItem
            entry={node.item}
            isFavorite={favoriteSet.has(sessionId)}
            isActive={currentSessionId === sessionId}
            depth={node.depth}
            variant="mobile"
            hasSubsessions={childNodes.length > 0}
            onActivate={(nextSessionId) => handleActivateSession(node.item.workspace.id, nextSessionId)}
            onToggleSubsessions={() => toggleSubagentList(sessionId)}
            onToggleFavorite={(nextSessionId) => {
              void toggleFavoriteSession(nextSessionId);
            }}
            onArchive={(nextSessionId) => archiveSession(nextSessionId)}
            onUnarchive={(nextSessionId) => unarchiveSession(nextSessionId)}
            onRename={(nextSessionId, title) => renameSession(nextSessionId, title)}
          />
        </div>
        {isExpanded && childNodes.length > 0 ? (
          <div className="session-list-children">
            {childNodes.map((childNode, index) =>
              renderSessionTreeNode(
                childNode,
                true,
                nextAncestorHasNextSiblings,
                index < childNodes.length - 1,
                index === 0
              )
            )}
          </div>
        ) : null}
      </div>
    );
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
              {visibleTree.map((node) => renderSessionTreeNode(node))}
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
