import type {
  ProviderId,
  SessionSummaryDto,
  WorkspaceDto
} from "../../conversation/api/conversation-api";
import { buildSessionTree, type SessionTreeNode } from "./session-tree";

export interface WorkbenchNavigationGroup {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
}

export interface WorkbenchNavigationEntry {
  session: SessionSummaryDto;
  workspace: WorkspaceDto;
}

export type WorkbenchNavigationTreeNode = SessionTreeNode<WorkbenchNavigationEntry>;

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
  return buildSessionTree(entries, {
    getId: (entry) => entry.session.sessionId,
    getParentId: (entry) => entry.session.parentSessionId?.trim() || null,
    compare: sortNavigationEntries
  });
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
