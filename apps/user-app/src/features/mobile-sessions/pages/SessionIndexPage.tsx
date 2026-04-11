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
  buildNavigationSessionTree,
  type WorkbenchNavigationEntry,
  type WorkbenchNavigationTreeNode
} from "../../workbench/utils/workbench-navigation";
import {
  findSessionTreeAncestorIds,
  flattenSessionTreeNodes,
  getSessionTreeChildren
} from "../../workbench/utils/session-tree";
import { SessionListItem } from "../components/SessionListItem";
import { writeMobileConversationPreviewMode } from "../mobile-conversation-state";
import "../styles.css";

const SUBAGENT_PAGE_SIZE = 5;

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
    () => buildNavigationSessionTree(currentWorkspaceEntries),
    [currentWorkspaceEntries]
  );
  const fallbackWorkspaceId = currentWorkspaceGroup?.workspace.id ?? "";
  const canStartSession = Boolean(fallbackWorkspaceId);
  const [expandedSubagentRootIds, setExpandedSubagentRootIds] = useState<string[]>([]);
  const [visibleSubagentCounts, setVisibleSubagentCounts] = useState<Record<string, number>>({});
  const [createSessionOpen, setCreateSessionOpen] = useState(false);

  useEffect(() => {
    setVisibleSubagentCounts((current) => {
      const next: Record<string, number> = {};

      for (const rootNode of visibleTree) {
        const descendantNodes = flattenSessionTreeNodes(getSessionTreeChildren(rootNode));

        if (descendantNodes.length === 0) {
          continue;
        }

        const activeDescendantIndex = descendantNodes.findIndex(
          (node) => node.item.session.sessionId === currentSessionId
        );

        next[rootNode.item.session.sessionId] = resolveVisibleItemCount(
          descendantNodes.length,
          SUBAGENT_PAGE_SIZE,
          current[rootNode.item.session.sessionId],
          activeDescendantIndex
        );
      }

      return isSameVisibleCountRecord(current, next) ? current : next;
    });
  }, [currentSessionId, visibleTree]);

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

  function getVisibleSubagentCount(sessionId: string) {
    return visibleSubagentCounts[sessionId] ?? SUBAGENT_PAGE_SIZE;
  }

  function handleExpandSubagents(sessionId: string) {
    setVisibleSubagentCounts((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? SUBAGENT_PAGE_SIZE) + SUBAGENT_PAGE_SIZE
    }));
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
    node: WorkbenchNavigationTreeNode,
    ancestorExpanded = false,
    ancestorHasNextSiblings: readonly boolean[] = [],
    hasNextSibling = false,
    isFirstSibling = false
  ): JSX.Element {
    const sessionId = node.item.session.sessionId;
    const childNodes = node.children;
    const allowToggle = node.depth === 0 && childNodes.length > 0;
    const isExpanded = ancestorExpanded || (allowToggle && expandedSubagentRootIds.includes(sessionId));
    const shouldPaginateSubagentTree = isExpanded && allowToggle;
    const visibleNode = shouldPaginateSubagentTree
      ? limitVisibleDescendantTree(node, getVisibleSubagentCount(sessionId))
      : node;
    const visibleChildren = isExpanded ? visibleNode.children : [];
    const totalDescendantCount = flattenSessionTreeNodes(childNodes).length;
    const visibleDescendantCount = flattenSessionTreeNodes(visibleChildren).length;
    const hasMoreSubagents = shouldPaginateSubagentTree && visibleDescendantCount < totalDescendantCount;
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
            hasSubsessions={allowToggle}
            subsessionsExpanded={isExpanded}
            onActivate={(nextSessionId) => handleActivateSession(node.item.workspace.id, nextSessionId)}
            onToggleSubsessions={allowToggle ? () => toggleSubagentList(sessionId) : undefined}
            onToggleFavorite={(nextSessionId) => {
              void toggleFavoriteSession(nextSessionId);
            }}
            onArchive={(nextSessionId) => archiveSession(nextSessionId)}
            onUnarchive={(nextSessionId) => unarchiveSession(nextSessionId)}
            onRename={(nextSessionId, title) => renameSession(nextSessionId, title)}
          />
        </div>
        {isExpanded && visibleChildren.length > 0 ? (
          <div className="session-list-children">
            {visibleChildren.map((childNode, index) =>
              renderSessionTreeNode(
                childNode,
                true,
                nextAncestorHasNextSiblings,
                index < visibleChildren.length - 1,
                index === 0
              )
            )}
          </div>
        ) : null}
        {hasMoreSubagents ? (
          <div className="session-list-children">
            <button
              type="button"
              className="secondary-button"
              onClick={() => handleExpandSubagents(sessionId)}
            >
              {t("shell.subagentExpandMore")}
            </button>
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

function limitVisibleDescendantTree(
  node: WorkbenchNavigationTreeNode,
  visibleCount: number
): WorkbenchNavigationTreeNode {
  const visibleSessionIdSet = new Set(
    flattenSessionTreeNodes(getSessionTreeChildren(node))
      .sort((left, right) =>
        (right.item.session.lastMessageAt ?? right.item.session.updatedAt).localeCompare(
          left.item.session.lastMessageAt ?? left.item.session.updatedAt
        )
      )
      .slice(0, visibleCount)
      .map((item) => item.item.session.sessionId)
  );

  return {
    ...node,
    children: filterTreeNodesByVisibleSet(getSessionTreeChildren(node), visibleSessionIdSet)
  };
}

function filterTreeNodesByVisibleSet(
  nodes: WorkbenchNavigationTreeNode[],
  visibleSessionIdSet: ReadonlySet<string>
): WorkbenchNavigationTreeNode[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterTreeNodesByVisibleSet(getSessionTreeChildren(node), visibleSessionIdSet);

    if (!visibleSessionIdSet.has(node.item.session.sessionId) && filteredChildren.length === 0) {
      return [];
    }

    return [
      {
        ...node,
        children: filteredChildren
      }
    ];
  });
}

function resolveVisibleItemCount(
  totalCount: number,
  pageSize: number,
  currentVisibleCount?: number,
  activeItemIndex = -1
) {
  if (totalCount <= 0) {
    return 0;
  }

  const minimumVisibleCount = activeItemIndex >= 0 ? Math.max(pageSize, activeItemIndex + 1) : pageSize;

  return Math.min(totalCount, Math.max(currentVisibleCount ?? 0, minimumVisibleCount));
}

function isSameVisibleCountRecord(
  currentRecord: Record<string, number>,
  nextRecord: Record<string, number>
) {
  const currentKeys = Object.keys(currentRecord);
  const nextKeys = Object.keys(nextRecord);

  if (currentKeys.length !== nextKeys.length) {
    return false;
  }

  return currentKeys.every((key) => currentRecord[key] === nextRecord[key]);
}
