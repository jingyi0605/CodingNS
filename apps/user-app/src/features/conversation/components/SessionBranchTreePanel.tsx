import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { t } from "../../../shared/i18n";
import {
  getSessionMessages,
  type HistoryMessageDto,
  type SessionSummaryDto
} from "../api/conversation-api";
import { getProviderDisplayName } from "../capability/provider-ui";
import { resolveSessionActivityBadgeLabel } from "../session-activity-display";
import { buildSessionTitlePresentation } from "../session-title";
import {
  resolveSessionForkBadgeLabel,
  resolveSessionForkBadgeTone
} from "../session-fork-display";

import type { WorkspaceSessionGroup } from "./WorkbenchLayout";

interface SessionBranchTreePanelProps {
  open: boolean;
  navigationGroups: WorkspaceSessionGroup[];
  workspaceId: string | null;
  sessionId: string;
  onClose: () => void;
  onOpenSession: (session: SessionSummaryDto) => void;
}

export interface SessionBranchTreeNode {
  session: SessionSummaryDto;
  children: SessionBranchTreeNode[];
  depth: number;
}

export interface SessionBranchTreeModel {
  root: SessionBranchTreeNode;
  current: SessionSummaryDto;
  currentPathIds: Set<string>;
  relatedSessionIds: Set<string>;
  sessionsById: Map<string, SessionSummaryDto>;
}

type PreviewStatus = "idle" | "loading" | "ready" | "error";

interface SessionPreviewEntry {
  status: PreviewStatus;
  messages: HistoryMessageDto[];
  error: string | null;
}

function sortSessions(left: SessionSummaryDto, right: SessionSummaryDto) {
  return (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt);
}

export function buildSessionBranchTreeModel(
  navigationGroups: WorkspaceSessionGroup[],
  workspaceId: string | null,
  sessionId: string
): SessionBranchTreeModel | null {
  if (!workspaceId) {
    return null;
  }

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId);

  if (!workspaceGroup) {
    return null;
  }

  const sessionsById = new Map<string, SessionSummaryDto>(
    workspaceGroup.sessions.map((session) => [session.sessionId, session] as const)
  );
  const current = sessionsById.get(sessionId) ?? null;

  if (!current) {
    return null;
  }

  const childIdsByParentId = new Map<string, string[]>();

  for (const session of workspaceGroup.sessions) {
    const parentSessionId: string | null = session.parentSessionId?.trim() || null;

    if (!parentSessionId) {
      continue;
    }

    const currentChildren: string[] = childIdsByParentId.get(parentSessionId) ?? [];
    childIdsByParentId.set(parentSessionId, [...currentChildren, session.sessionId]);
  }

  const currentPathIds = new Set<string>();
  const visitedSessionIds = new Set<string>();
  let cursor: SessionSummaryDto | null = current;
  let rootSessionId = current.sessionId;

  while (cursor && !visitedSessionIds.has(cursor.sessionId)) {
    currentPathIds.add(cursor.sessionId);
    visitedSessionIds.add(cursor.sessionId);
    rootSessionId = cursor.sessionId;

    const parentSessionId: string | null = cursor.parentSessionId?.trim() || null;
    cursor = parentSessionId ? sessionsById.get(parentSessionId) ?? null : null;
  }

  const root = buildBranchTreeNode(rootSessionId, 0, sessionsById, childIdsByParentId, new Set());
  const relatedSessionIds = collectRelatedSessionIds(root);

  return {
    root,
    current,
    currentPathIds,
    relatedSessionIds,
    sessionsById
  };
}

export function hasSessionBranchRelations(model: SessionBranchTreeModel | null): boolean {
  return (model?.relatedSessionIds.size ?? 0) > 1;
}

function buildBranchTreeNode(
  sessionId: string,
  depth: number,
  sessionsById: ReadonlyMap<string, SessionSummaryDto>,
  childIdsByParentId: ReadonlyMap<string, string[]>,
  visitedSessionIds: ReadonlySet<string>
): SessionBranchTreeNode {
  const session = sessionsById.get(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const nextVisitedSessionIds = new Set(visitedSessionIds);
  nextVisitedSessionIds.add(sessionId);
  const childSessionIds = [...(childIdsByParentId.get(sessionId) ?? [])]
    .filter((childSessionId) => !nextVisitedSessionIds.has(childSessionId))
    .sort((leftId, rightId) => {
      const left = sessionsById.get(leftId);
      const right = sessionsById.get(rightId);

      if (!left || !right) {
        return 0;
      }

      return sortSessions(left, right);
    });

  return {
    session,
    depth,
    children: childSessionIds.map((childSessionId) =>
      buildBranchTreeNode(
        childSessionId,
        depth + 1,
        sessionsById,
        childIdsByParentId,
        nextVisitedSessionIds
      )
    )
  };
}

function collectRelatedSessionIds(node: SessionBranchTreeNode): Set<string> {
  const relatedSessionIds = new Set<string>();

  function visit(currentNode: SessionBranchTreeNode) {
    relatedSessionIds.add(currentNode.session.sessionId);
    currentNode.children.forEach(visit);
  }

  visit(node);
  return relatedSessionIds;
}

function findTreeNodeBySessionId(
  node: SessionBranchTreeNode,
  sessionId: string
): SessionBranchTreeNode | null {
  if (node.session.sessionId === sessionId) {
    return node;
  }

  for (const child of node.children) {
    const matched = findTreeNodeBySessionId(child, sessionId);

    if (matched) {
      return matched;
    }
  }

  return null;
}

function formatBranchNodeMeta(session: SessionSummaryDto) {
  const activityBadgeLabel = resolveSessionActivityBadgeLabel(session);
  const time = session.lastMessageAt ?? session.updatedAt;
  const formattedTime = time
    ? new Intl.DateTimeFormat(undefined, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(time))
    : null;

  return [
    getProviderDisplayName(session.provider),
    formattedTime,
    activityBadgeLabel
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildPreviewMessages(messages: HistoryMessageDto[]) {
  return [...messages]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((message) => message.content.trim().length > 0 || message.kind === "tool_call" || message.kind === "tool_result");
}

function buildMessagePreviewText(message: HistoryMessageDto): string {
  const content = message.content.trim();

  if (content.length > 0) {
    const compact = content.replace(/\s+/g, " ").trim();
    return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
  }

  if (message.toolCall?.name) {
    return `${message.toolCall.name} ${t("conversation.branchTreeToolMessageFallback")}`;
  }

  return t("conversation.branchTreeMessageEmpty");
}

function resolvePreviewRoleLabel(message: HistoryMessageDto) {
  switch (message.role) {
    case "assistant":
      return t("conversation.roleAssistant");
    case "system":
      return t("conversation.roleSystem");
    case "tool":
      return t("conversation.roleTool");
    case "user":
    default:
      return t("conversation.roleUser");
  }
}

function BranchSmartNode({
  node,
  currentSessionId,
  currentPathIds,
  selectedSessionId,
  onSelectSession
}: {
  node: SessionBranchTreeNode;
  currentSessionId: string;
  currentPathIds: ReadonlySet<string>;
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
}) {
  const titlePresentation = buildSessionTitlePresentation(node.session.title, t("common.unknown"));
  const forkBadgeTone = resolveSessionForkBadgeTone(node.session);
  const forkBadgeLabel = resolveSessionForkBadgeLabel(node.session);
  const isCurrent = node.session.sessionId === currentSessionId;
  const isSelected = node.session.sessionId === selectedSessionId;
  const isOnCurrentPath = currentPathIds.has(node.session.sessionId);

  return (
    <div className="conversation-branch-smart-node" data-depth={node.depth}>
      <button
        type="button"
        className="conversation-branch-smart-card"
        data-current={isCurrent}
        data-selected={isSelected}
        data-current-path={isOnCurrentPath}
        onClick={() => onSelectSession(node.session.sessionId)}
      >
        <div className="conversation-branch-smart-card-main">
          <div className="conversation-branch-smart-card-title-row">
            <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
            {isCurrent ? (
              <span className="conversation-branch-current-badge">
                {t("conversation.branchTreeCurrentBadge")}
              </span>
            ) : null}
          </div>
          <p>{formatBranchNodeMeta(node.session)}</p>
          {forkBadgeLabel && forkBadgeTone ? (
            <div className="session-fork-row">
              <span className={`session-fork-badge ${forkBadgeTone}`}>{forkBadgeLabel}</span>
            </div>
          ) : null}
        </div>
      </button>

      {node.children.length > 0 ? (
        <div className="conversation-branch-smart-children">
          {node.children.map((child) => (
            <div key={child.session.sessionId} className="conversation-branch-smart-child">
              <BranchSmartNode
                node={child}
                currentSessionId={currentSessionId}
                currentPathIds={currentPathIds}
                selectedSessionId={selectedSessionId}
                onSelectSession={onSelectSession}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SessionBranchTreeExplorer({
  model,
  onOpenSession
}: {
  model: SessionBranchTreeModel;
  onOpenSession: (session: SessionSummaryDto) => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState(model.current.sessionId);
  const [previewEntries, setPreviewEntries] = useState<Record<string, SessionPreviewEntry>>({});
  const loadingSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setSelectedSessionId(model.current.sessionId);
  }, [model.current.sessionId, model.root.session.sessionId]);

  const selectedSession =
    model.sessionsById.get(selectedSessionId) ?? model.current;
  const selectedNode = useMemo(
    () => findTreeNodeBySessionId(model.root, selectedSession.sessionId),
    [model.root, selectedSession.sessionId]
  );
  const previewEntry = previewEntries[selectedSession.sessionId] ?? {
    status: "idle" as const,
    messages: [],
    error: null
  };

  useEffect(() => {
    if (!selectedSession?.sessionId) {
      return;
    }

    if (
      previewEntry.status === "ready"
      || loadingSessionIdsRef.current.has(selectedSession.sessionId)
    ) {
      return;
    }

    let cancelled = false;
    loadingSessionIdsRef.current.add(selectedSession.sessionId);

    setPreviewEntries((current) => ({
      ...current,
      [selectedSession.sessionId]: {
        status: "loading",
        messages: current[selectedSession.sessionId]?.messages ?? [],
        error: null
      }
    }));

    void getSessionMessages(selectedSession.sessionId, null, 6, "backward")
      .then((response) => {
        loadingSessionIdsRef.current.delete(selectedSession.sessionId);

        if (cancelled) {
          return;
        }

        setPreviewEntries((current) => ({
          ...current,
          [selectedSession.sessionId]: {
            status: "ready",
            messages: buildPreviewMessages(response.messages),
            error: null
          }
        }));
      })
      .catch((error) => {
        loadingSessionIdsRef.current.delete(selectedSession.sessionId);

        if (cancelled) {
          return;
        }

        setPreviewEntries((current) => ({
          ...current,
          [selectedSession.sessionId]: {
            status: "error",
            messages: current[selectedSession.sessionId]?.messages ?? [],
            error: error instanceof Error ? error.message : t("conversation.branchTreePreviewFailed")
          }
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSession.sessionId]);

  return (
    <div className="conversation-branch-explorer">
      <section className="conversation-branch-tree-pane">
        <div className="conversation-branch-tree-pane-header">
          <h3>{t("conversation.branchTreeMapTitle")}</h3>
          <p>{t("conversation.branchTreeMapDescription")}</p>
        </div>
        <div className="conversation-branch-smart-tree">
          <BranchSmartNode
            node={model.root}
            currentSessionId={model.current.sessionId}
            currentPathIds={model.currentPathIds}
            selectedSessionId={selectedSession.sessionId}
            onSelectSession={setSelectedSessionId}
          />
        </div>
      </section>

      <aside className="conversation-branch-preview-pane">
        <div className="conversation-branch-preview-header">
          <h3>{t("conversation.branchTreePreviewTitle")}</h3>
          <p>{t("conversation.branchTreePreviewDescription")}</p>
        </div>

        <div className="conversation-branch-preview-card">
          <div className="conversation-branch-preview-card-header">
            <div className="conversation-branch-preview-card-title-row">
              <strong title={buildSessionTitlePresentation(selectedSession.title, t("common.unknown")).fullTitle}>
                {buildSessionTitlePresentation(selectedSession.title, t("common.unknown")).displayTitle}
              </strong>
              {selectedSession.sessionId === model.current.sessionId ? (
                <span className="conversation-branch-current-badge">
                  {t("conversation.branchTreeCurrentBadge")}
                </span>
              ) : null}
            </div>
            <p>{formatBranchNodeMeta(selectedSession)}</p>
            {selectedNode?.session ? (
              (() => {
                const forkBadgeTone = resolveSessionForkBadgeTone(selectedNode.session);
                const forkBadgeLabel = resolveSessionForkBadgeLabel(selectedNode.session);

                if (!forkBadgeTone || !forkBadgeLabel) {
                  return null;
                }

                return (
                  <div className="session-fork-row">
                    <span className={`session-fork-badge ${forkBadgeTone}`}>{forkBadgeLabel}</span>
                  </div>
                );
              })()
            ) : null}
          </div>

          <div className="conversation-branch-preview-messages">
            {previewEntry.status === "loading" ? (
              <p className="conversation-branch-empty">{t("conversation.branchTreePreviewLoading")}</p>
            ) : previewEntry.status === "error" ? (
              <p className="conversation-branch-empty">{previewEntry.error || t("conversation.branchTreePreviewFailed")}</p>
            ) : previewEntry.messages.length > 0 ? (
              previewEntry.messages.map((message) => (
                <article key={`${selectedSession.sessionId}:${message.messageId}`} className="conversation-branch-preview-message">
                  <div className="conversation-branch-preview-message-meta">
                    <span>{resolvePreviewRoleLabel(message)}</span>
                    <span>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(message.timestamp))}</span>
                  </div>
                  <p>{buildMessagePreviewText(message)}</p>
                </article>
              ))
            ) : (
              <p className="conversation-branch-empty">{t("conversation.branchTreePreviewEmpty")}</p>
            )}
          </div>

          <div className="conversation-branch-preview-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={selectedSession.sessionId === model.current.sessionId}
              onClick={() => onOpenSession(selectedSession)}
            >
              {selectedSession.sessionId === model.current.sessionId
                ? t("conversation.branchTreeCurrentAction")
                : t("conversation.branchTreeSwitchAction")}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function SessionBranchTreePanel({
  open,
  navigationGroups,
  workspaceId,
  sessionId,
  onClose,
  onOpenSession
}: SessionBranchTreePanelProps) {
  const model = useMemo(
    () => buildSessionBranchTreeModel(navigationGroups, workspaceId, sessionId),
    [navigationGroups, sessionId, workspaceId]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || !model || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer conversation-branch-panel-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card conversation-branch-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("conversation.branchTreeTitle")}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{t("conversation.branchTreeTitle")}</h2>
            <p>{t("conversation.branchTreeDescription")}</p>
          </div>
          <button
            type="button"
            className="workbench-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="workbench-modal-body conversation-branch-panel-body">
          <SessionBranchTreeExplorer model={model} onOpenSession={onOpenSession} />
        </div>
      </section>
    </div>,
    document.body
  );
}
