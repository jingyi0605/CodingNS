import type {
  SessionSummaryDto,
  WorkbenchWorktreeNodeDto
} from "../../conversation/api/conversation-api";
import type { SessionDisplaySortMode } from "../../../preferences/local-ui-preference-store";

function compareDescendingTimestamp(left: string | null | undefined, right: string | null | undefined): number {
  return (right ?? "").localeCompare(left ?? "");
}

function compareSessionTitle(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function normalizeSessionTitle(title: string | null | undefined): string {
  return title?.trim() ?? "";
}

export function compareSessionSummaryByDisplayMode(
  left: SessionSummaryDto,
  right: SessionSummaryDto,
  mode: SessionDisplaySortMode
): number {
  if (mode === "updatedAt") {
    const updatedAtComparison = compareDescendingTimestamp(left.updatedAt, right.updatedAt);

    if (updatedAtComparison !== 0) {
      return updatedAtComparison;
    }
  }

  if (mode === "title") {
    const titleComparison = compareSessionTitle(
      normalizeSessionTitle(left.title),
      normalizeSessionTitle(right.title)
    );

    if (titleComparison !== 0) {
      return titleComparison;
    }
  } else {
    const createdAtComparison = compareDescendingTimestamp(left.createdAt, right.createdAt);

    if (createdAtComparison !== 0) {
      return createdAtComparison;
    }
  }

  const updatedAtFallbackComparison = compareDescendingTimestamp(left.updatedAt, right.updatedAt);

  if (updatedAtFallbackComparison !== 0) {
    return updatedAtFallbackComparison;
  }

  const createdAtFallbackComparison = compareDescendingTimestamp(left.createdAt, right.createdAt);

  if (createdAtFallbackComparison !== 0) {
    return createdAtFallbackComparison;
  }

  const titleFallbackComparison = compareSessionTitle(
    normalizeSessionTitle(left.title),
    normalizeSessionTitle(right.title)
  );

  if (titleFallbackComparison !== 0) {
    return titleFallbackComparison;
  }

  return left.sessionId.localeCompare(right.sessionId);
}

export function sortSessionSummaryList(
  sessions: readonly SessionSummaryDto[],
  mode: SessionDisplaySortMode
): SessionSummaryDto[] {
  return [...sessions].sort((left, right) => compareSessionSummaryByDisplayMode(left, right, mode));
}

export function sortWorkbenchWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[] | null | undefined,
  mode: SessionDisplaySortMode
): WorkbenchWorktreeNodeDto[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.map((node) => ({
    ...node,
    sessions: sortSessionSummaryList(node.sessions, mode),
    children: sortWorkbenchWorktreeNodes(node.children, mode)
  }));
}
