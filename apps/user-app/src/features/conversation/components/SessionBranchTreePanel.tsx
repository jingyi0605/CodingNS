import { createPortal } from "react-dom";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type TouchEvent as ReactTouchEvent
} from "react";

import { DesktopModal } from "../../../components/DesktopModal";
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
  resolveSessionForkBadgeTone,
  resolveSessionKindBadgeLabel,
  resolveSessionKindBadgeTone
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

interface BranchTreeLayoutNode {
  node: SessionBranchTreeNode;
  children: BranchTreeLayoutNode[];
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  subtreeWidth: number;
}

interface BranchTreeLayout {
  root: BranchTreeLayoutNode;
  nodes: BranchTreeLayoutNode[];
  bySessionId: Map<string, BranchTreeLayoutNode>;
  width: number;
  height: number;
}

type PreviewStatus = "idle" | "loading" | "ready" | "error";

interface SessionPreviewEntry {
  status: PreviewStatus;
  messages: HistoryMessageDto[];
  error: string | null;
}

const BRANCH_NODE_WIDTH = 196;
const BRANCH_NODE_HEIGHT = 82;
const BRANCH_TREE_PADDING_X = 28;
const BRANCH_TREE_PADDING_Y = 24;
const BRANCH_TREE_LEVEL_GAP = 34;
const BRANCH_TREE_SIBLING_GAP = 18;
const BRANCH_TREE_POPOVER_WIDTH = 332;
const BRANCH_TREE_PREVIEW_ESTIMATED_HEIGHT = 360;
const BRANCH_TREE_DESKTOP_BREAKPOINT = 840;
const BRANCH_TREE_MOBILE_VIEWPORT_PADDING = 18;
const BRANCH_TREE_MOBILE_MIN_SCALE = 0.22;
const BRANCH_TREE_MOBILE_MAX_SCALE = 2.4;
const BRANCH_TREE_TOUCH_DRAG_THRESHOLD = 6;

interface BranchViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface DesktopBranchTreeStageLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  shellWidth: number;
  shellHeight: number;
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

function isArchivedBranchSession(session: SessionSummaryDto): boolean {
  return session.isArchived === true;
}

function buildPreviewMessages(messages: HistoryMessageDto[]) {
  return [...messages]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((message) => message.content.trim().length > 0 || message.kind === "tool_call" || message.kind === "tool_result");
}

export function resolveBranchTreeStageScale(viewportWidth: number, layoutWidth: number): number {
  if (viewportWidth <= 0 || layoutWidth <= 0) {
    return 1;
  }

  return Math.min(1, viewportWidth / layoutWidth);
}

export function resolveDesktopBranchTreeStageLayout(
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number
): DesktopBranchTreeStageLayout {
  void viewportHeight;
  const scale = resolveBranchTreeStageScale(viewportWidth, layoutWidth);
  const scaledWidth = layoutWidth * scale;
  const scaledHeight = layoutHeight * scale;
  const offsetX = scaledWidth < viewportWidth ? (viewportWidth - scaledWidth) / 2 : 0;

  return {
    scale,
    offsetX,
    offsetY: 0,
    shellWidth: Math.max(viewportWidth, scaledWidth),
    shellHeight: scaledHeight
  };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveMobileBranchTreeFitScale(
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || layoutWidth <= 0 || layoutHeight <= 0) {
    return 1;
  }

  const safeWidth = Math.max(1, viewportWidth - BRANCH_TREE_MOBILE_VIEWPORT_PADDING * 2);
  const safeHeight = Math.max(1, viewportHeight - BRANCH_TREE_MOBILE_VIEWPORT_PADDING * 2);

  return Math.min(1, safeWidth / layoutWidth, safeHeight / layoutHeight);
}

function clampMobileBranchTreeTransform(
  transform: BranchViewportTransform,
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number
): BranchViewportTransform {
  const scaledWidth = layoutWidth * transform.scale;
  const scaledHeight = layoutHeight * transform.scale;
  const centeredOffsetX = (viewportWidth - scaledWidth) / 2;
  const centeredOffsetY = (viewportHeight - scaledHeight) / 2;

  const offsetX =
    scaledWidth <= viewportWidth
      ? centeredOffsetX
      : clampValue(transform.offsetX, viewportWidth - scaledWidth, 0);
  const offsetY =
    scaledHeight <= viewportHeight
      ? centeredOffsetY
      : clampValue(transform.offsetY, viewportHeight - scaledHeight, 0);

  return {
    scale: transform.scale,
    offsetX,
    offsetY
  };
}

function resolveMobileBranchTreeInitialTransform(
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number
): BranchViewportTransform {
  const scale = resolveMobileBranchTreeFitScale(
    viewportWidth,
    viewportHeight,
    layoutWidth,
    layoutHeight
  );

  return clampMobileBranchTreeTransform(
    {
      scale,
      offsetX: (viewportWidth - layoutWidth * scale) / 2,
      offsetY: (viewportHeight - layoutHeight * scale) / 2
    },
    viewportWidth,
    viewportHeight,
    layoutWidth,
    layoutHeight
  );
}

function resolveScaledMobileBranchTreeTransform(
  transform: BranchViewportTransform,
  nextScale: number,
  anchorX: number,
  anchorY: number,
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number
): BranchViewportTransform {
  const worldX = (anchorX - transform.offsetX) / transform.scale;
  const worldY = (anchorY - transform.offsetY) / transform.scale;

  return clampMobileBranchTreeTransform(
    {
      scale: nextScale,
      offsetX: anchorX - worldX * nextScale,
      offsetY: anchorY - worldY * nextScale
    },
    viewportWidth,
    viewportHeight,
    layoutWidth,
    layoutHeight
  );
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

function measureSubtreeWidth(
  node: SessionBranchTreeNode,
  widthCache: Map<string, number>
): number {
  const cachedWidth = widthCache.get(node.session.sessionId);

  if (cachedWidth !== undefined) {
    return cachedWidth;
  }

  if (node.children.length === 0) {
    widthCache.set(node.session.sessionId, BRANCH_NODE_WIDTH);
    return BRANCH_NODE_WIDTH;
  }

  const childrenWidth = node.children.reduce((total, child, childIndex) => {
    const next = total + measureSubtreeWidth(child, widthCache);
    return childIndex === 0 ? next : next + BRANCH_TREE_SIBLING_GAP;
  }, 0);
  const subtreeWidth = Math.max(BRANCH_NODE_WIDTH, childrenWidth);

  widthCache.set(node.session.sessionId, subtreeWidth);
  return subtreeWidth;
}

function buildBranchTreeLayout(root: SessionBranchTreeNode): BranchTreeLayout {
  const widthCache = new Map<string, number>();
  const nodes: BranchTreeLayoutNode[] = [];
  const bySessionId = new Map<string, BranchTreeLayoutNode>();

  function placeNode(
    node: SessionBranchTreeNode,
    left: number,
    depth: number
  ): BranchTreeLayoutNode {
    const subtreeWidth = measureSubtreeWidth(node, widthCache);
    const centerX = left + subtreeWidth / 2;
    const y = BRANCH_TREE_PADDING_Y + depth * (BRANCH_NODE_HEIGHT + BRANCH_TREE_LEVEL_GAP);
    const x = centerX - BRANCH_NODE_WIDTH / 2;

    const childrenWidth = node.children.reduce((total, child, childIndex) => {
      const next = total + measureSubtreeWidth(child, widthCache);
      return childIndex === 0 ? next : next + BRANCH_TREE_SIBLING_GAP;
    }, 0);

    let childLeft = left + Math.max(0, (subtreeWidth - childrenWidth) / 2);
    const children = node.children.map((child) => {
      const layoutChild = placeNode(child, childLeft, depth + 1);
      childLeft += layoutChild.subtreeWidth + BRANCH_TREE_SIBLING_GAP;
      return layoutChild;
    });

    const layoutNode: BranchTreeLayoutNode = {
      node,
      children,
      x,
      y,
      centerX,
      centerY: y + BRANCH_NODE_HEIGHT / 2,
      subtreeWidth
    };

    nodes.push(layoutNode);
    bySessionId.set(node.session.sessionId, layoutNode);
    return layoutNode;
  }

  const rootLayoutNode = placeNode(root, BRANCH_TREE_PADDING_X, 0);
  const maxBottom = nodes.reduce((max, node) => Math.max(max, node.y + BRANCH_NODE_HEIGHT), 0);

  return {
    root: rootLayoutNode,
    nodes,
    bySessionId,
    width: rootLayoutNode.subtreeWidth + BRANCH_TREE_PADDING_X * 2,
    height: maxBottom + BRANCH_TREE_PADDING_Y
  };
}

function parseRgbChannel(value: string): number {
  return Math.max(0, Math.min(255, Number.parseFloat(value)));
}

function parseCssColor(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim();

  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);

    if (hex.length === 3) {
      const [r, g, b] = hex.split("").map((part) => Number.parseInt(part.repeat(2), 16));
      return { r, g, b };
    }

    if (hex.length >= 6) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16)
      };
    }
  }

  const rgbMatch = normalized.match(/rgba?\(([^)]+)\)/i);

  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1].split(",").map((part) => parseRgbChannel(part));
    return { r, g, b };
  }

  return null;
}

function withAlpha(color: string, alpha: number, fallback: string): string {
  const parsed = parseCssColor(color);

  if (!parsed) {
    return fallback;
  }

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

function drawBranchTreeCanvas(
  canvas: HTMLCanvasElement,
  layout: BranchTreeLayout,
  currentSessionId: string,
  currentPathIds: ReadonlySet<string>,
  selectedSessionId: string | null,
  transparentBackground: boolean
) {
  const drawingContext = canvas.getContext("2d");

  if (!drawingContext) {
    return;
  }

  const context = drawingContext;

  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(layout.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(layout.height * devicePixelRatio));
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, layout.width, layout.height);

  const stageStyles = window.getComputedStyle(canvas);
  const accentColor = stageStyles.getPropertyValue("--accent").trim() || "#3b82f6";
  const borderColor = stageStyles.getPropertyValue("--border-primary").trim() || "#d4d8df";
  const surfaceColor = stageStyles.getPropertyValue("--bg-surface").trim() || "#ffffff";

  if (!transparentBackground) {
    const backgroundGradient = context.createLinearGradient(0, 0, layout.width, layout.height);
    backgroundGradient.addColorStop(0, withAlpha(surfaceColor, 0.38, "rgba(255, 255, 255, 0.38)"));
    backgroundGradient.addColorStop(1, withAlpha(accentColor, 0.05, "rgba(59, 130, 246, 0.05)"));
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, layout.width, layout.height);
  }

  function drawLinks(node: BranchTreeLayoutNode) {
    for (const child of node.children) {
      const isCurrentPathLink =
        currentPathIds.has(node.node.session.sessionId)
        && currentPathIds.has(child.node.session.sessionId);
      const touchesSelected =
        node.node.session.sessionId === selectedSessionId
        || child.node.session.sessionId === selectedSessionId;

      context.beginPath();
      context.moveTo(node.centerX, node.y + BRANCH_NODE_HEIGHT - 10);
      const controlY = node.y + BRANCH_NODE_HEIGHT + BRANCH_TREE_LEVEL_GAP * 0.52;
      context.bezierCurveTo(
        node.centerX,
        controlY,
        child.centerX,
        controlY,
        child.centerX,
        child.y + 10
      );
      context.lineWidth = touchesSelected ? 3 : isCurrentPathLink ? 2.5 : 1.5;
      context.strokeStyle = touchesSelected
        ? withAlpha(accentColor, 0.52, "rgba(59, 130, 246, 0.52)")
        : isCurrentPathLink
          ? withAlpha(accentColor, 0.32, "rgba(59, 130, 246, 0.32)")
          : withAlpha(borderColor, 0.72, "rgba(148, 163, 184, 0.72)");
      context.stroke();

      context.beginPath();
      context.arc(child.centerX, child.y, touchesSelected ? 4.5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = touchesSelected
        ? withAlpha(accentColor, 0.9, "rgba(59, 130, 246, 0.9)")
        : withAlpha(borderColor, 0.78, "rgba(148, 163, 184, 0.78)");
      context.fill();

      drawLinks(child);
    }
  }

  drawLinks(layout.root);

  for (const node of layout.nodes) {
    const isCurrent = node.node.session.sessionId === currentSessionId;
    const isSelected = node.node.session.sessionId === selectedSessionId;
    const isCurrentPath = currentPathIds.has(node.node.session.sessionId);

    if (!isCurrent && !isSelected && !isCurrentPath) {
      continue;
    }

    const glowGradient = context.createRadialGradient(
      node.centerX,
      node.centerY,
      10,
      node.centerX,
      node.centerY,
      isSelected ? 90 : 64
    );
    glowGradient.addColorStop(0, withAlpha(accentColor, isSelected ? 0.22 : 0.14, "rgba(59, 130, 246, 0.22)"));
    glowGradient.addColorStop(1, "rgba(59, 130, 246, 0)");
    context.fillStyle = glowGradient;
    context.beginPath();
    context.ellipse(
      node.centerX,
      node.centerY,
      BRANCH_NODE_WIDTH * 0.72,
      BRANCH_NODE_HEIGHT * 0.9,
      0,
      0,
      Math.PI * 2
    );
    context.fill();

    if (isSelected || isCurrent) {
      context.beginPath();
      context.arc(node.centerX, node.y + 12, isSelected ? 6 : 5, 0, Math.PI * 2);
      context.fillStyle = withAlpha(accentColor, 0.94, "rgba(59, 130, 246, 0.94)");
      context.fill();
    }
  }
}

function buildPopoverStyle(
  anchorRect: DOMRect,
  viewportWidth: number,
  viewportHeight: number
): CSSProperties {
  const popoverWidth = Math.min(BRANCH_TREE_POPOVER_WIDTH, viewportWidth - 24);
  const preferredLeft = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  const clampedLeft = Math.max(
    12,
    Math.min(viewportWidth - popoverWidth - 12, preferredLeft)
  );
  const spaceBelow = viewportHeight - anchorRect.bottom - 12;
  const showAbove =
    spaceBelow < 220
    && anchorRect.top > BRANCH_TREE_PREVIEW_ESTIMATED_HEIGHT;
  const top = showAbove
    ? Math.max(12, anchorRect.top - BRANCH_TREE_PREVIEW_ESTIMATED_HEIGHT - 12)
    : Math.max(12, Math.min(viewportHeight - BRANCH_TREE_PREVIEW_ESTIMATED_HEIGHT - 12, anchorRect.bottom + 12));

  return {
    width: popoverWidth,
    left: clampedLeft,
    top,
    maxHeight: Math.min(BRANCH_TREE_PREVIEW_ESTIMATED_HEIGHT, viewportHeight - 24)
  };
}

function BranchTreePreviewPopover({
  model,
  selectedSession,
  selectedTreeNode,
  previewEntry,
  onClose,
  onOpenSession
}: {
  model: SessionBranchTreeModel;
  selectedSession: SessionSummaryDto;
  selectedTreeNode: SessionBranchTreeNode;
  previewEntry: SessionPreviewEntry;
  onClose: () => void;
  onOpenSession: (session: SessionSummaryDto) => void;
}) {
  const titlePresentation = buildSessionTitlePresentation(selectedSession.title, t("common.unknown"));
  const isCurrent = selectedSession.sessionId === model.current.sessionId;
  const isArchived = isArchivedBranchSession(selectedSession);
  const forkBadgeTone = resolveSessionForkBadgeTone(selectedTreeNode.session);
  const forkBadgeLabel = resolveSessionForkBadgeLabel(selectedTreeNode.session);
  const kindBadgeTone = resolveSessionKindBadgeTone(selectedTreeNode.session);
  const kindBadgeLabel = resolveSessionKindBadgeLabel(selectedTreeNode.session);

  return (
    <div
      className="conversation-branch-preview-popover"
      role="dialog"
      aria-label={`${t("conversation.branchTreePreviewTitle")} ${titlePresentation.fullTitle}`}
    >
        <div className="conversation-branch-preview-popover-header">
          <div className="conversation-branch-preview-card-title-row">
            <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
            {isCurrent ? (
              <span className="conversation-branch-current-badge">
                {t("conversation.branchTreeCurrentBadge")}
              </span>
            ) : null}
            {isArchived ? (
              <span className="conversation-branch-archived-badge">
                {t("conversation.branchTreeArchivedBadge")}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="conversation-branch-preview-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            x
          </button>
        </div>

        <p className="conversation-branch-preview-popover-meta">{formatBranchNodeMeta(selectedSession)}</p>

        {(forkBadgeLabel && forkBadgeTone) || (kindBadgeLabel && kindBadgeTone) ? (
          <div className="conversation-branch-badge-row">
            {kindBadgeLabel && kindBadgeTone ? (
              <span className={`session-fork-badge ${kindBadgeTone}`}>{kindBadgeLabel}</span>
            ) : null}
            {forkBadgeLabel && forkBadgeTone ? (
              <span className={`session-fork-badge ${forkBadgeTone}`}>{forkBadgeLabel}</span>
            ) : null}
          </div>
        ) : null}

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
                  <span>
                    {new Intl.DateTimeFormat(undefined, {
                      hour: "2-digit",
                      minute: "2-digit"
                    }).format(new Date(message.timestamp))}
                  </span>
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
            disabled={isCurrent}
            onClick={() => onOpenSession(selectedSession)}
          >
            {isCurrent
              ? t("conversation.branchTreeCurrentAction")
              : t("conversation.branchTreeSwitchAction")}
          </button>
        </div>
    </div>
  );
}

function BranchCanvasTree({
  layout,
  model,
  selectedSessionId,
  onSelectSession,
  onBackgroundClick,
  stageScale,
  desktopStageLayout,
  transform,
  isMobileViewport,
  viewportRef,
  onRegisterNodeElement,
  onViewportTouchStart,
  onViewportTouchMove,
  onViewportTouchEnd
}: {
  layout: BranchTreeLayout;
  model: SessionBranchTreeModel;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  onBackgroundClick?: (() => void) | undefined;
  stageScale: number;
  desktopStageLayout: DesktopBranchTreeStageLayout;
  transform?: BranchViewportTransform | null;
  isMobileViewport: boolean;
  viewportRef: RefObject<HTMLDivElement>;
  onRegisterNodeElement: (sessionId: string, element: HTMLButtonElement | null) => void;
  onViewportTouchStart?: ((event: ReactTouchEvent<HTMLDivElement>) => void) | undefined;
  onViewportTouchMove?: ((event: ReactTouchEvent<HTMLDivElement>) => void) | undefined;
  onViewportTouchEnd?: ((event: ReactTouchEvent<HTMLDivElement>) => void) | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    drawBranchTreeCanvas(
      canvas,
      layout,
      model.current.sessionId,
      model.currentPathIds,
      selectedSessionId,
      isMobileViewport
    );
  }, [isMobileViewport, layout, model.current.sessionId, model.currentPathIds, selectedSessionId]);

  return (
    <div
      ref={viewportRef}
      className="conversation-branch-canvas-viewport"
      data-scaled={stageScale < 0.999}
      data-mobile={isMobileViewport}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onBackgroundClick?.();
        }
      }}
      onTouchStart={onViewportTouchStart}
      onTouchMove={onViewportTouchMove}
      onTouchEnd={onViewportTouchEnd}
      onTouchCancel={onViewportTouchEnd}
    >
      <div
        className="conversation-branch-canvas-stage-shell"
        style={{
          width: isMobileViewport ? "100%" : desktopStageLayout.shellWidth,
          height: isMobileViewport ? "100%" : desktopStageLayout.shellHeight
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onBackgroundClick?.();
          }
        }}
      >
        <div
          className="conversation-branch-canvas-stage"
          style={{
            width: layout.width,
            height: layout.height,
            transform: transform
              ? `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`
              : `translate(${desktopStageLayout.offsetX}px, ${desktopStageLayout.offsetY}px) scale(${desktopStageLayout.scale})`,
            transformOrigin: "top left"
          }}
          onClick={() => {
            if (onBackgroundClick) {
              onBackgroundClick();
              return;
            }

            onSelectSession(null);
          }}
        >
          <canvas
            ref={canvasRef}
            className="conversation-branch-canvas"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          />

          {layout.nodes.map((layoutNode) => {
            const titlePresentation = buildSessionTitlePresentation(layoutNode.node.session.title, t("common.unknown"));
            const forkBadgeTone = resolveSessionForkBadgeTone(layoutNode.node.session);
            const forkBadgeLabel = resolveSessionForkBadgeLabel(layoutNode.node.session);
            const kindBadgeTone = resolveSessionKindBadgeTone(layoutNode.node.session);
            const kindBadgeLabel = resolveSessionKindBadgeLabel(layoutNode.node.session);
            const isCurrent = layoutNode.node.session.sessionId === model.current.sessionId;
            const isSelected = layoutNode.node.session.sessionId === selectedSessionId;
            const isCurrentPath = model.currentPathIds.has(layoutNode.node.session.sessionId);
            const isArchived = isArchivedBranchSession(layoutNode.node.session);

            return (
              <button
                key={layoutNode.node.session.sessionId}
                ref={(element) => onRegisterNodeElement(layoutNode.node.session.sessionId, element)}
                type="button"
                className="conversation-branch-smart-card conversation-branch-canvas-node"
                data-current={isCurrent}
                data-selected={isSelected}
                data-current-path={isCurrentPath}
                data-archived={isArchived}
                style={{
                  left: layoutNode.x,
                  top: layoutNode.y,
                  width: BRANCH_NODE_WIDTH,
                  minHeight: BRANCH_NODE_HEIGHT
                }}
                aria-pressed={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSession(layoutNode.node.session.sessionId);
                }}
              >
                <div className="conversation-branch-smart-card-main">
                  <div className="conversation-branch-smart-card-title-row">
                    <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                    {isCurrent ? (
                      <span className="conversation-branch-current-badge">
                        {t("conversation.branchTreeCurrentBadge")}
                      </span>
                    ) : null}
                    {isArchived ? (
                      <span className="conversation-branch-archived-badge">
                        {t("conversation.branchTreeArchivedBadge")}
                      </span>
                    ) : null}
                  </div>
                  <p>{formatBranchNodeMeta(layoutNode.node.session)}</p>
                  {(forkBadgeLabel && forkBadgeTone) || (kindBadgeLabel && kindBadgeTone) ? (
                    <div className="conversation-branch-badge-row">
                      {kindBadgeLabel && kindBadgeTone ? (
                        <span className={`session-fork-badge ${kindBadgeTone}`}>{kindBadgeLabel}</span>
                      ) : null}
                      {forkBadgeLabel && forkBadgeTone ? (
                        <span className={`session-fork-badge ${forkBadgeTone}`}>{forkBadgeLabel}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SessionBranchTreeExplorer({
  model,
  onOpenSession,
  onClose
}: {
  model: SessionBranchTreeModel;
  onOpenSession: (session: SessionSummaryDto) => void;
  onClose?: (() => void) | undefined;
}) {
  const layout = useMemo(() => buildBranchTreeLayout(model.root), [model.root]);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const nodeElementMapRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [canvasViewportWidth, setCanvasViewportWidth] = useState(0);
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(0);
  const [previewAnchorRect, setPreviewAnchorRect] = useState<DOMRect | null>(null);
  const [previewEntries, setPreviewEntries] = useState<Record<string, SessionPreviewEntry>>({});
  const loadingSessionIdsRef = useRef<Set<string>>(new Set());
  const [isMobileViewport, setIsMobileViewport] = useState(
    typeof window !== "undefined" ? window.innerWidth <= BRANCH_TREE_DESKTOP_BREAKPOINT : false
  );
  const [mobileTransform, setMobileTransform] = useState<BranchViewportTransform | null>(null);
  const touchGestureRef = useRef<{
    mode: "idle" | "pan" | "pinch";
    startDistance: number;
    startScale: number;
    startOffsetX: number;
    startOffsetY: number;
    startTouchX: number;
    startTouchY: number;
    anchorX: number;
    anchorY: number;
    moved: boolean;
  }>({
    mode: "idle",
    startDistance: 0,
    startScale: 1,
    startOffsetX: 0,
    startOffsetY: 0,
    startTouchX: 0,
    startTouchY: 0,
    anchorX: 0,
    anchorY: 0,
    moved: false
  });

  useEffect(() => {
    const viewport = canvasViewportRef.current;

    if (!viewport) {
      return;
    }

    const currentViewport = viewport;

    function syncViewportWidth() {
      setCanvasViewportWidth(currentViewport.clientWidth);
      setCanvasViewportHeight(currentViewport.clientHeight);
      setIsMobileViewport(window.innerWidth <= BRANCH_TREE_DESKTOP_BREAKPOINT);
    }

    syncViewportWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncViewportWidth);
      return () => window.removeEventListener("resize", syncViewportWidth);
    }

    const observer = new ResizeObserver(syncViewportWidth);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedSessionId(null);
  }, [model.current.sessionId, model.root.session.sessionId]);

  const stageScale = useMemo(() => {
    return resolveBranchTreeStageScale(canvasViewportWidth, layout.width);
  }, [canvasViewportWidth, layout.width]);
  const desktopStageLayout = useMemo(() => {
    return resolveDesktopBranchTreeStageLayout(
      canvasViewportWidth,
      canvasViewportHeight,
      layout.width,
      layout.height
    );
  }, [canvasViewportHeight, canvasViewportWidth, layout.height, layout.width]);

  useEffect(() => {
    if (!isMobileViewport || canvasViewportWidth <= 0 || canvasViewportHeight <= 0) {
      setMobileTransform(null);
      return;
    }

    setMobileTransform((current) => {
      if (!current) {
        return resolveMobileBranchTreeInitialTransform(
          canvasViewportWidth,
          canvasViewportHeight,
          layout.width,
          layout.height
        );
      }

      return clampMobileBranchTreeTransform(
        current,
        canvasViewportWidth,
        canvasViewportHeight,
        layout.width,
        layout.height
      );
    });
  }, [canvasViewportHeight, canvasViewportWidth, isMobileViewport, layout.height, layout.width]);

  const selectedSession = selectedSessionId
    ? model.sessionsById.get(selectedSessionId) ?? null
    : null;
  const selectedLayoutNode = selectedSession
    ? layout.bySessionId.get(selectedSession.sessionId) ?? null
    : null;
  const previewEntry =
    selectedSession
      ? previewEntries[selectedSession.sessionId] ?? {
          status: "idle" as const,
          messages: [],
          error: null
        }
      : null;
  const showMobileBareCanvas = isMobileViewport && Boolean(onClose);
  const showPaneHeader = Boolean(onClose) && !showMobileBareCanvas;

  useEffect(() => {
    if (!selectedSessionId) {
      setPreviewAnchorRect(null);
      return;
    }

    const currentSessionId = selectedSessionId;

    function syncPreviewAnchor() {
      const nodeElement = nodeElementMapRef.current.get(currentSessionId);

      if (!nodeElement) {
        setPreviewAnchorRect(null);
        return;
      }

      setPreviewAnchorRect(nodeElement.getBoundingClientRect());
    }

    syncPreviewAnchor();
    window.addEventListener("resize", syncPreviewAnchor);
    window.addEventListener("scroll", syncPreviewAnchor, true);

    return () => {
      window.removeEventListener("resize", syncPreviewAnchor);
      window.removeEventListener("scroll", syncPreviewAnchor, true);
    };
  }, [selectedSessionId, stageScale]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }

    const currentSessionId = selectedSessionId;

    if (!currentSessionId) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const nodeElement = nodeElementMapRef.current.get(currentSessionId);

      if (!nodeElement) {
        return;
      }

      setPreviewAnchorRect(nodeElement.getBoundingClientRect());
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [isMobileViewport, mobileTransform, selectedSessionId]);

  useEffect(() => {
    if (!selectedSession?.sessionId) {
      return;
    }

    if (
      previewEntry?.status === "ready"
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
  }, [selectedSession?.sessionId]);

  function updateMobileTransform(
    updater: (current: BranchViewportTransform) => BranchViewportTransform
  ) {
    if (!isMobileViewport || canvasViewportWidth <= 0 || canvasViewportHeight <= 0) {
      return;
    }

    setMobileTransform((current) => {
      const baseTransform =
        current
        ?? resolveMobileBranchTreeInitialTransform(
          canvasViewportWidth,
          canvasViewportHeight,
          layout.width,
          layout.height
        );

      return clampMobileBranchTreeTransform(
        updater(baseTransform),
        canvasViewportWidth,
        canvasViewportHeight,
        layout.width,
        layout.height
      );
    });
  }

  function handleViewportTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (!isMobileViewport) {
      return;
    }

    const viewportRect = event.currentTarget.getBoundingClientRect();

    if (event.touches.length >= 2) {
      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      const distance = Math.hypot(
        secondTouch.clientX - firstTouch.clientX,
        secondTouch.clientY - firstTouch.clientY
      );
      const centerX = (firstTouch.clientX + secondTouch.clientX) / 2 - viewportRect.left;
      const centerY = (firstTouch.clientY + secondTouch.clientY) / 2 - viewportRect.top;
      const currentTransform =
        mobileTransform
        ?? resolveMobileBranchTreeInitialTransform(
          canvasViewportWidth,
          canvasViewportHeight,
          layout.width,
          layout.height
        );

      touchGestureRef.current = {
        mode: "pinch",
        startDistance: distance,
        startScale: currentTransform.scale,
        startOffsetX: currentTransform.offsetX,
        startOffsetY: currentTransform.offsetY,
        startTouchX: centerX,
        startTouchY: centerY,
        anchorX: centerX,
        anchorY: centerY,
        moved: false
      };
      return;
    }

    const touch = event.touches[0];
    const currentTransform =
      mobileTransform
      ?? resolveMobileBranchTreeInitialTransform(
        canvasViewportWidth,
        canvasViewportHeight,
        layout.width,
        layout.height
      );

    touchGestureRef.current = {
      mode: "pan",
      startDistance: 0,
      startScale: currentTransform.scale,
      startOffsetX: currentTransform.offsetX,
      startOffsetY: currentTransform.offsetY,
      startTouchX: touch.clientX,
      startTouchY: touch.clientY,
      anchorX: 0,
      anchorY: 0,
      moved: false
    };
  }

  function handleViewportTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    if (!isMobileViewport) {
      return;
    }

    const gesture = touchGestureRef.current;

    if (event.touches.length >= 2) {
      const viewportRect = event.currentTarget.getBoundingClientRect();
      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      const distance = Math.hypot(
        secondTouch.clientX - firstTouch.clientX,
        secondTouch.clientY - firstTouch.clientY
      );

      if (distance <= 0 || gesture.startDistance <= 0) {
        return;
      }

      event.preventDefault();
      const centerX = (firstTouch.clientX + secondTouch.clientX) / 2 - viewportRect.left;
      const centerY = (firstTouch.clientY + secondTouch.clientY) / 2 - viewportRect.top;
      const nextScale = clampValue(
        gesture.startScale * (distance / gesture.startDistance),
        BRANCH_TREE_MOBILE_MIN_SCALE,
        BRANCH_TREE_MOBILE_MAX_SCALE
      );

      touchGestureRef.current = {
        ...gesture,
        mode: "pinch",
        moved: true,
        anchorX: centerX,
        anchorY: centerY
      };

      updateMobileTransform((current) =>
        resolveScaledMobileBranchTreeTransform(
          {
            ...current,
            scale: gesture.startScale,
            offsetX: gesture.startOffsetX,
            offsetY: gesture.startOffsetY
          },
          nextScale,
          centerX,
          centerY,
          canvasViewportWidth,
          canvasViewportHeight,
          layout.width,
          layout.height
        )
      );
      return;
    }

    if (gesture.mode !== "pan" || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.startTouchX;
    const deltaY = touch.clientY - gesture.startTouchY;
    const moved = gesture.moved || Math.hypot(deltaX, deltaY) >= BRANCH_TREE_TOUCH_DRAG_THRESHOLD;

    if (!moved) {
      return;
    }

    event.preventDefault();
    touchGestureRef.current = {
      ...gesture,
      moved: true
    };

    updateMobileTransform((current) => ({
      ...current,
      offsetX: gesture.startOffsetX + deltaX,
      offsetY: gesture.startOffsetY + deltaY
    }));
  }

  function handleViewportTouchEnd() {
    touchGestureRef.current = {
      mode: "idle",
      startDistance: 0,
      startScale: mobileTransform?.scale ?? 1,
      startOffsetX: mobileTransform?.offsetX ?? 0,
      startOffsetY: mobileTransform?.offsetY ?? 0,
      startTouchX: 0,
      startTouchY: 0,
      anchorX: 0,
      anchorY: 0,
      moved: false
    };
  }

  return (
    <>
      <section
        className={`conversation-branch-tree-pane${onClose ? " conversation-branch-dialog" : ""}${showMobileBareCanvas ? " conversation-branch-dialog-mobile-bare" : ""}`}
        role={onClose ? "dialog" : undefined}
        aria-modal={onClose ? "true" : undefined}
        aria-label={onClose ? t("conversation.branchTreeTitle") : undefined}
      >
        {showPaneHeader ? (
          <div className="conversation-branch-tree-pane-header">
            <div className="conversation-branch-tree-pane-topbar">
              <div className="conversation-branch-tree-pane-heading">
                <h3>{t("conversation.branchTreeMapTitle")}</h3>
                <p>{t("conversation.branchTreeMapDescription")}</p>
              </div>
              {onClose ? (
                <button
                  type="button"
                  className="conversation-branch-pane-close"
                  aria-label={t("common.close")}
                  onClick={onClose}
                >
                  x
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="conversation-branch-canvas-shell">
          {showMobileBareCanvas ? (
            <button
              type="button"
              className="conversation-branch-pane-close conversation-branch-mobile-floating-close"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              x
            </button>
          ) : null}

          {!showMobileBareCanvas ? (
            <div className="conversation-branch-canvas-tip">
              {t("conversation.branchTreePreviewDescription")}
            </div>
          ) : null}

          <BranchCanvasTree
            layout={layout}
            model={model}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
            onBackgroundClick={showMobileBareCanvas ? onClose : undefined}
            stageScale={stageScale}
            desktopStageLayout={desktopStageLayout}
            transform={isMobileViewport ? mobileTransform : null}
            isMobileViewport={isMobileViewport}
            viewportRef={canvasViewportRef}
            onRegisterNodeElement={(sessionId, element) => {
              if (element) {
                nodeElementMapRef.current.set(sessionId, element);
                return;
              }

              nodeElementMapRef.current.delete(sessionId);
            }}
            onViewportTouchStart={handleViewportTouchStart}
            onViewportTouchMove={handleViewportTouchMove}
            onViewportTouchEnd={handleViewportTouchEnd}
          />
        </div>
      </section>

      {selectedSession && selectedLayoutNode && previewEntry && previewAnchorRect && typeof document !== "undefined"
        ? createPortal(
            <div
              className="conversation-branch-preview-floating"
              style={buildPopoverStyle(previewAnchorRect, window.innerWidth, window.innerHeight)}
            >
              <BranchTreePreviewPopover
                model={model}
                selectedSession={selectedSession}
                selectedTreeNode={selectedLayoutNode.node}
                previewEntry={previewEntry}
                onClose={() => setSelectedSessionId(null)}
                onOpenSession={onOpenSession}
              />
            </div>,
            document.body
          )
        : null}
    </>
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
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    typeof window !== "undefined" ? window.innerWidth > BRANCH_TREE_DESKTOP_BREAKPOINT : true
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function syncViewportState() {
      setIsDesktopViewport(window.innerWidth > BRANCH_TREE_DESKTOP_BREAKPOINT);
    }

    syncViewportState();
    window.addEventListener("resize", syncViewportState);
    return () => window.removeEventListener("resize", syncViewportState);
  }, []);

  if (!open || !model || typeof document === "undefined") {
    return null;
  }

  if (isDesktopViewport) {
    return (
      <DesktopModal
        open={open}
        title={t("conversation.branchTreeMapTitle")}
        description={t("conversation.branchTreeMapDescription")}
        size="regular"
        layout="viewer"
        bodyClassName="conversation-branch-modal-body"
        onClose={onClose}
      >
        <SessionBranchTreeExplorer
          model={model}
          onOpenSession={onOpenSession}
        />
      </DesktopModal>
    );
  }

  return createPortal(
    <div className="workbench-modal-layer conversation-branch-panel-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <SessionBranchTreeExplorer
        model={model}
        onOpenSession={onOpenSession}
        onClose={onClose}
      />
    </div>,
    document.body
  );
}
