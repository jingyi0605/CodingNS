import type {
  ProviderId,
  SessionSummaryDto,
  WorkspaceDto
} from "../../conversation/api/conversation-api";

export interface WorkbenchNavigationGroup {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
}

export interface WorkbenchNavigationEntry {
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
}

export interface WorkbenchNavigationTreeNode {
  entry: WorkbenchNavigationEntry;
  children: WorkbenchNavigationEntry[];
}

export function buildWorkspaceHomePath(): string {
  return "/workspaces";
}

export function buildWorkspaceDetailPath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function buildWorkspaceSessionIndexPath(workspaceId: string): string {
  return `${buildWorkspaceDetailPath(workspaceId)}/sessions`;
}

export function buildWorkspaceSessionPath(workspaceId: string, sessionId: string): string {
  return `${buildWorkspaceSessionIndexPath(workspaceId)}/${encodeURIComponent(sessionId)}`;
}

export function buildWorkspaceToolsPath(workspaceId: string, tab?: "files" | "git"): string {
  const basePath = `${buildWorkspaceDetailPath(workspaceId)}/tools`;

  if (!tab) {
    return basePath;
  }

  const search = new URLSearchParams({
    tab
  });
  return `${basePath}?${search.toString()}`;
}

export function buildWorkspaceToolFilesPath(workspaceId: string): string {
  return `${buildWorkspaceDetailPath(workspaceId)}/tools/files`;
}

export function buildWorkspaceToolGitPath(workspaceId: string): string {
  return `${buildWorkspaceDetailPath(workspaceId)}/tools/git`;
}

export function buildWorkspaceToolProcessesPath(workspaceId: string): string {
  return `${buildWorkspaceDetailPath(workspaceId)}/tools/processes`;
}

export function buildWorkspaceTerminalsPath(workspaceId: string): string {
  return `${buildWorkspaceDetailPath(workspaceId)}/terminals`;
}

export function buildWorkspaceButlerPath(workspaceId: string, tab?: "info" | "automation"): string {
  const basePath = `${buildWorkspaceDetailPath(workspaceId)}/butler`;

  if (!tab) {
    return basePath;
  }

  const search = new URLSearchParams({
    tab
  });

  return `${basePath}?${search.toString()}`;
}

export function flattenNavigationSessions(
  groups: readonly WorkbenchNavigationGroup[]
): WorkbenchNavigationEntry[] {
  return groups
    .flatMap((group) =>
      group.sessions.map((session) => ({
        session,
        workspace: group.workspace
      }))
    )
    .sort((left, right) =>
      (right.session.lastMessageAt ?? right.session.updatedAt).localeCompare(
        left.session.lastMessageAt ?? left.session.updatedAt
      )
    );
}

export function buildNavigationSessionTree(
  entries: readonly WorkbenchNavigationEntry[]
): WorkbenchNavigationTreeNode[] {
  const entryBySessionId = new Map(entries.map((entry) => [entry.session.sessionId, entry] as const));
  const childEntriesByRootId = new Map<string, WorkbenchNavigationEntry[]>();
  const rootEntries: WorkbenchNavigationEntry[] = [];

  for (const entry of entries) {
    const topLevelSessionId = resolveTopLevelSessionId(entry, entryBySessionId);

    if (topLevelSessionId === entry.session.sessionId) {
      rootEntries.push(entry);
      continue;
    }

    const currentChildren = childEntriesByRootId.get(topLevelSessionId) ?? [];
    childEntriesByRootId.set(topLevelSessionId, [...currentChildren, entry]);
  }

  return [...rootEntries]
    .sort(sortNavigationEntries)
    .map((entry) => ({
      entry,
      children: [...(childEntriesByRootId.get(entry.session.sessionId) ?? [])].sort(sortNavigationEntries)
    }));
}

export function buildDraftSessionPath(workspaceId: string, provider: ProviderId): string {
  const draftId = createDraftSessionId();
  const search = new URLSearchParams({
    provider
  });

  return `${buildWorkspaceSessionPath(workspaceId, draftId)}?${search.toString()}`;
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

function resolveTopLevelSessionId(
  entry: WorkbenchNavigationEntry,
  entryBySessionId: ReadonlyMap<string, WorkbenchNavigationEntry>
) {
  let currentEntry = entry;
  const visitedSessionIds = new Set<string>([entry.session.sessionId]);

  while (true) {
    const parentSessionId = currentEntry.session.parentSessionId?.trim() || null;

    if (!parentSessionId) {
      return currentEntry.session.sessionId;
    }

    const parentEntry = entryBySessionId.get(parentSessionId);

    if (!parentEntry) {
      return currentEntry.session.sessionId;
    }

    if (visitedSessionIds.has(parentEntry.session.sessionId)) {
      return entry.session.sessionId;
    }

    visitedSessionIds.add(parentEntry.session.sessionId);
    currentEntry = parentEntry;
  }
}
