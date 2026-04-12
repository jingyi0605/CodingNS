import type {
  SessionSummaryDto,
  WorkbenchWorktreeNodeDto,
  WorkspaceDto
} from "../../conversation/api/conversation-api";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";

export interface MobileWorkspaceOption {
  readonly workspace: WorkspaceDto;
  readonly label: string;
  readonly subtitle: string;
  readonly depth: number;
  readonly kind: "workspace" | "worktree";
  readonly meta: WorkbenchWorktreeNodeDto["meta"] | null;
}

export interface NavigationWorkspaceTarget {
  readonly workspace: WorkspaceDto;
  readonly sessions: SessionSummaryDto[];
  readonly childWorktrees: WorkbenchWorktreeNodeDto[];
  readonly meta: WorkbenchWorktreeNodeDto["meta"] | null;
}

export function flattenMobileWorkspaceOptions(
  groups: readonly WorkspaceSessionGroup[]
): MobileWorkspaceOption[] {
  return groups.flatMap((group) => [
    {
      workspace: group.workspace,
      label: group.workspace.name,
      subtitle: group.workspace.path,
      depth: 0,
      kind: "workspace" as const,
      meta: null
    },
    ...flattenWorktreeOptions(group.childWorktrees ?? [])
  ]);
}

export function findNavigationWorkspaceTarget(
  groups: readonly WorkspaceSessionGroup[],
  workspaceId: string | null | undefined
): NavigationWorkspaceTarget | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  for (const group of groups) {
    if (group.workspace.id === normalizedWorkspaceId) {
      return {
        workspace: group.workspace,
        sessions: group.sessions,
        childWorktrees: group.childWorktrees ?? [],
        meta: null
      };
    }

    const nestedTarget = findWorktreeTarget(group.childWorktrees ?? [], normalizedWorkspaceId);

    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}

function flattenWorktreeOptions(nodes: readonly WorkbenchWorktreeNodeDto[]): MobileWorkspaceOption[] {
  return nodes.flatMap((node) => [
    {
      workspace: node.workspace,
      label: node.meta.displayName || node.workspace.name,
      subtitle: node.workspace.path,
      depth: node.meta.depth,
      kind: "worktree" as const,
      meta: node.meta
    },
    ...flattenWorktreeOptions(node.children)
  ]);
}

function findWorktreeTarget(
  nodes: readonly WorkbenchWorktreeNodeDto[],
  workspaceId: string
): NavigationWorkspaceTarget | null {
  for (const node of nodes) {
    if (node.workspace.id === workspaceId) {
      return {
        workspace: node.workspace,
        sessions: node.sessions,
        childWorktrees: node.children,
        meta: node.meta
      };
    }

    const nestedTarget = findWorktreeTarget(node.children, workspaceId);

    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}
