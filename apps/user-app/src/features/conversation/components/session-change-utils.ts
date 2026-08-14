import { getSessionChangedFiles, type SessionChangedFileDto } from "../api/conversation-api";
import { getGitStatus, type GitChangeItemDto } from "../api/git-api";

export interface SessionChangeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: SessionChangeTreeNode[];
}

export interface SessionChangeFileNode {
  kind: "file";
  name: string;
  path: string;
  change: GitChangeItemDto;
}

export type SessionChangeTreeNode = SessionChangeDirectoryNode | SessionChangeFileNode;

interface MutableSessionChangeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: Map<string, MutableSessionChangeDirectoryNode | SessionChangeFileNode>;
}

export async function loadSessionChangedGitFiles(
  sessionId: string,
  requestWorkspaceId: string,
  options: { targetHostId?: string | null } = {}
): Promise<GitChangeItemDto[]> {
  const [gitStatus, response] = await Promise.all([
    getGitStatus(requestWorkspaceId, { targetHostId: options.targetHostId }),
    getSessionChangedFiles(sessionId, { targetHostId: options.targetHostId })
  ]);

  return filterSessionChangedGitFiles(gitStatus.changes, response.items);
}

export function filterSessionChangedGitFiles(
  changes: GitChangeItemDto[],
  changedFiles: SessionChangedFileDto[]
): GitChangeItemDto[] {
  const touchedPaths = new Set(changedFiles.map((item) => normalizePath(item.path)));

  return changes.filter(
    (change) =>
      touchedPaths.has(normalizePath(change.path)) ||
      (change.oldPath !== null && touchedPaths.has(normalizePath(change.oldPath)))
  );
}

export function buildSessionChangeTree(changes: GitChangeItemDto[]): SessionChangeTreeNode[] {
  const root = createMutableSessionDirectory("", "");

  for (const change of changes) {
    const normalizedPath = normalizePath(change.path);
    const segments = normalizedPath.split("/").filter(Boolean);
    let currentDirectory = root;

    segments.forEach((segment, index) => {
      const currentPath = segments.slice(0, index + 1).join("/");

      if (index === segments.length - 1) {
        currentDirectory.children.set(`file:${currentPath}`, {
          kind: "file",
          name: segment,
          path: normalizedPath,
          change
        });
        return;
      }

      const directoryKey = `directory:${currentPath}`;
      const existingDirectory = currentDirectory.children.get(directoryKey);

      if (existingDirectory && existingDirectory.kind === "directory") {
        currentDirectory = existingDirectory;
        return;
      }

      const nextDirectory = createMutableSessionDirectory(segment, currentPath);
      currentDirectory.children.set(directoryKey, nextDirectory);
      currentDirectory = nextDirectory;
    });
  }

  return compactSessionTreeNodes(finalizeSessionTreeNodes([...root.children.values()]));
}

export function buildSessionChangeSubtitle(change: GitChangeItemDto, deletedLabel: string): string {
  const basePath = change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path;
  return isDeletedGitChange(change) ? `${basePath} ${deletedLabel}` : basePath;
}

export function isDeletedGitChange(change: GitChangeItemDto): boolean {
  return change.status === "D" || change.stagedStatus === "D" || change.worktreeStatus === "D";
}

export function getFileName(filePath: string): string {
  return filePath.split("/").filter(Boolean).pop() ?? filePath;
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function createMutableSessionDirectory(
  name: string,
  path: string
): MutableSessionChangeDirectoryNode {
  return {
    kind: "directory",
    name,
    path,
    children: new Map()
  };
}

function finalizeSessionTreeNodes(
  nodes: Array<MutableSessionChangeDirectoryNode | SessionChangeFileNode>
): SessionChangeTreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "zh-CN");
    })
    .map((node) =>
      node.kind === "directory"
        ? {
            kind: "directory",
            name: node.name,
            path: node.path,
            children: finalizeSessionTreeNodes([...node.children.values()])
          }
        : node
    );
}

function compactSessionTreeNodes(nodes: SessionChangeTreeNode[]): SessionChangeTreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== "directory") {
      return node;
    }

    const compactedChildren = compactSessionTreeNodes(node.children);
    let nextName = node.name;
    let nextPath = node.path;
    let nextChildren = compactedChildren;

    while (nextChildren.length === 1 && nextChildren[0]?.kind === "directory") {
      const child = nextChildren[0];
      nextName = `${nextName}/${child.name}`;
      nextPath = child.path;
      nextChildren = child.children;
    }

    return {
      kind: "directory",
      name: nextName,
      path: nextPath,
      children: nextChildren
    };
  });
}
