import type {
  WorkbenchWorktreeNodeDto,
  WorkspaceDto
} from "../../conversation/api/conversation-api";

export type WorkspaceVisualTone = "root" | "worktree";

export interface WorkspaceVisualContext {
  readonly workspaceId: string;
  readonly tone: WorkspaceVisualTone;
  readonly displayName: string;
  readonly workspaceName: string;
  readonly branchName: string | null;
  readonly depth: number;
  readonly rootWorkspaceId: string;
  readonly rootDisplayName: string;
  readonly parentWorkspaceId: string | null;
  readonly parentDisplayName: string | null;
}

interface WorkspaceTreeGroupLike {
  readonly workspace: WorkspaceDto;
  readonly childWorktrees?: readonly WorkbenchWorktreeNodeDto[];
}

export function createFallbackWorkspaceVisualContext(
  workspace: WorkspaceDto
): WorkspaceVisualContext {
  return {
    workspaceId: workspace.id,
    tone: "root",
    displayName: workspace.name,
    workspaceName: workspace.name,
    branchName: null,
    depth: 0,
    rootWorkspaceId: workspace.id,
    rootDisplayName: workspace.name,
    parentWorkspaceId: null,
    parentDisplayName: null
  };
}

export function buildWorkspaceVisualContextMap(
  groups: readonly WorkspaceTreeGroupLike[]
): Record<string, WorkspaceVisualContext> {
  const contextMap = new Map<string, WorkspaceVisualContext>();

  for (const group of groups) {
    contextMap.set(group.workspace.id, createFallbackWorkspaceVisualContext(group.workspace));
    collectWorktreeContexts(
      contextMap,
      group.childWorktrees ?? [],
      group.workspace,
      group.workspace
    );
  }

  return Object.fromEntries(contextMap) as Record<string, WorkspaceVisualContext>;
}

export function resolveWorkspaceVisualContext(
  groups: readonly WorkspaceTreeGroupLike[],
  workspaceId: string | null | undefined
): WorkspaceVisualContext | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  const contextMap = buildWorkspaceVisualContextMap(groups);
  return contextMap[normalizedWorkspaceId] ?? null;
}

function collectWorktreeContexts(
  contextMap: Map<string, WorkspaceVisualContext>,
  nodes: readonly WorkbenchWorktreeNodeDto[],
  rootWorkspace: WorkspaceDto,
  parentWorkspace: WorkspaceDto,
  parentDisplayName = parentWorkspace.name
) {
  for (const node of nodes) {
    const displayName = node.meta.displayName?.trim() || node.workspace.name;

    contextMap.set(node.workspace.id, {
      workspaceId: node.workspace.id,
      tone: "worktree",
      displayName,
      workspaceName: node.workspace.name,
      branchName: node.meta.branchName || null,
      depth: node.meta.depth,
      rootWorkspaceId: rootWorkspace.id,
      rootDisplayName: rootWorkspace.name,
      parentWorkspaceId: node.meta.parentWorkspaceId || parentWorkspace.id,
      parentDisplayName
    });

    collectWorktreeContexts(
      contextMap,
      node.children,
      rootWorkspace,
      node.workspace,
      displayName
    );
  }
}
