import type {
  ProviderId,
  SessionSummaryDto,
  WorkbenchWorktreeNodeDto,
  WorkspaceRef,
  WorkspaceDto
} from "../../conversation/api/conversation-api";
import { resolveSessionDisplayParentSessionId } from "../../conversation/parallel-session-display";
import { buildSessionTree, type SessionTreeNode } from "./session-tree";

export interface WorkbenchNavigationGroup {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
  childWorktrees?: WorkbenchWorktreeNodeDto[];
}

export interface WorkbenchNavigationEntry {
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
}

export type WorkbenchNavigationTreeNode = SessionTreeNode<WorkbenchNavigationEntry>;
export type NavigationSessionTreeMode = "default" | "mobile";

export function buildWorkspaceHomePath(): string {
  return "/workspaces";
}

function buildWorkspaceBasePath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function buildWorkspaceDetailPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(buildWorkspaceBasePath(workspaceId), workspaceRef);
}

export function buildWorkspaceDebugPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/debug`, workspaceRef);
}

export function buildWorkspaceSessionIndexPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`/workspaces/${encodeURIComponent(workspaceId)}/sessions`, workspaceRef);
}

export function buildWorkspaceSessionPath(
  workspaceId: string,
  sessionId: string,
  workspaceRef?: WorkspaceRef | null
): string {
  return appendTargetHostId(
    `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
    workspaceRef
  );
}

export function buildAffairsPath(): string {
  return "/affairs";
}

export function buildWorkspaceAffairsPath(_workspaceId: string): string {
  return buildAffairsPath();
}

export function buildWorkspaceToolsPath(workspaceId: string, tab?: "files" | "git", workspaceRef?: WorkspaceRef | null): string {
  const basePath = `${buildWorkspaceBasePath(workspaceId)}/tools`;

  if (!tab) {
    return appendTargetHostId(basePath, workspaceRef);
  }

  const search = new URLSearchParams({
    tab
  });
  return appendTargetHostId(`${basePath}?${search.toString()}`, workspaceRef);
}

export function buildWorkspaceToolFilesPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/tools/files`, workspaceRef);
}

export function buildWorkspaceToolGitPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/tools/git`, workspaceRef);
}

function appendTargetHostId(path: string, workspaceRef?: WorkspaceRef | null): string {
  const targetHostId = workspaceRef?.hostId === "current" ? null : workspaceRef?.hostId;

  if (!targetHostId) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}targetHostId=${encodeURIComponent(targetHostId)}`;
}

export function buildWorkspaceToolProcessesPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/tools/processes`, workspaceRef);
}


export function buildWorkspacePluginsPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/plugins`, workspaceRef);
}

export function buildWorkspacePluginDetailPath(workspaceId: string, pluginId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/plugins/${encodeURIComponent(pluginId)}`, workspaceRef);
}

export function buildWorkspacePluginContainerPath(workspaceId: string, pluginId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/plugins/${encodeURIComponent(pluginId)}/run`, workspaceRef);
}
export function buildWorkspaceTerminalsPath(workspaceId: string, workspaceRef?: WorkspaceRef | null): string {
  return appendTargetHostId(`${buildWorkspaceBasePath(workspaceId)}/terminals`, workspaceRef);
}

export function buildWorkspaceButlerPath(workspaceId: string, tab?: "info" | "automation" | "settings", workspaceRef?: WorkspaceRef | null): string {
  const basePath = `${buildWorkspaceBasePath(workspaceId)}/butler`;

  if (!tab) {
    return appendTargetHostId(basePath, workspaceRef);
  }

  const search = new URLSearchParams({
    tab
  });

  return appendTargetHostId(`${basePath}?${search.toString()}`, workspaceRef);
}

export function flattenNavigationSessions(
  groups: readonly WorkbenchNavigationGroup[]
): WorkbenchNavigationEntry[] {
  return dedupeNavigationEntries(
    groups.flatMap((group) =>
      [
        ...group.sessions.map((session) => ({
          session,
          workspace: group.workspace
        })),
        ...flattenWorktreeSessions(group.childWorktrees ?? [])
      ]
    )
  )
    .sort((left, right) =>
      (right.session.lastMessageAt ?? right.session.updatedAt).localeCompare(
        left.session.lastMessageAt ?? left.session.updatedAt
      )
    );
}

export function buildNavigationSessionTree(
  entries: readonly WorkbenchNavigationEntry[],
  options?: {
    mode?: NavigationSessionTreeMode;
  }
): WorkbenchNavigationTreeNode[] {
  return buildSessionTree(dedupeNavigationEntries(entries), {
    getId: (entry) => entry.session.sessionId,
    getParentId: (entry) => resolveNavigationSessionParentId(entry.session, options),
    compare: sortNavigationEntries
  });
}

export function resolveNavigationSessionParentId(
  session: Pick<SessionSummaryDto, "displayParentSessionId" | "parentSessionId">,
  options?: {
    mode?: NavigationSessionTreeMode;
  }
) {
  if (options?.mode === "mobile") {
    return session.parentSessionId?.trim() || null;
  }

  return resolveSessionDisplayParentSessionId(session);
}

export function buildDraftSessionPath(
  workspaceId: string,
  provider: ProviderId,
  workspaceRef?: WorkspaceRef | null
): string {
  const draftId = createDraftSessionId();
  const basePath = buildWorkspaceSessionPath(workspaceId, draftId, workspaceRef);
  const search = new URLSearchParams({
    provider
  });

  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${search.toString()}`;
}

function createDraftSessionId(): string {
  const nativeCrypto = globalThis.crypto;

  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return `draft-${nativeCrypto.randomUUID()}`;
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sortNavigationEntries(left: WorkbenchNavigationEntry, right: WorkbenchNavigationEntry) {
  return (right.session.lastMessageAt ?? right.session.updatedAt).localeCompare(
    left.session.lastMessageAt ?? left.session.updatedAt
  );
}

function flattenWorktreeSessions(
  nodes: readonly WorkbenchWorktreeNodeDto[]
): WorkbenchNavigationEntry[] {
  return nodes.flatMap((node) => [
    ...node.sessions.map((session) => ({
      session,
      workspace: node.workspace
    })),
    ...flattenWorktreeSessions(node.children)
  ]);
}

function dedupeNavigationEntries(
  entries: readonly WorkbenchNavigationEntry[]
): WorkbenchNavigationEntry[] {
  const uniqueEntries: WorkbenchNavigationEntry[] = [];
  const seenSessionIds = new Set<string>();

  for (const entry of entries) {
    const sessionId = entry.session.sessionId.trim();

    if (!sessionId || seenSessionIds.has(sessionId)) {
      continue;
    }

    seenSessionIds.add(sessionId);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}
