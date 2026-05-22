import { httpClient } from "../../network/http-client";

export interface WorkspaceBridgeCapabilitiesDto {
  read: boolean;
  write: boolean;
  delete: boolean;
  watch: boolean;
  batchRead: boolean;
  batchWrite: boolean;
  workspaceRootAccessible: boolean;
}

export interface WorkspaceBridgeDirItemDto {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  mtime: number;
  hidden?: boolean;
}

export interface WorkspaceBridgeListDirOptionsDto {
  kind?: "file" | "directory" | "any";
  recursive?: boolean;
  includeHidden?: boolean;
  sortBy?: "name" | "mtime" | "size";
  order?: "asc" | "desc";
  limit?: number;
}

export interface WorkspaceBridgeReadTextResultDto {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export interface WorkspaceBridgeReadTextsResultDto {
  items: Array<
    | WorkspaceBridgeReadTextResultDto
    | {
        path: string;
        error: {
          code: string;
          message: string;
          path?: string;
        };
      }
  >;
}

export interface WorkspaceBridgeWriteTextOptionsDto {
  createIfMissing?: boolean;
  overwrite?: boolean;
  ifMtime?: number;
  ensureParentDir?: boolean;
}

export interface WorkspaceBridgeDeleteFileOptionsDto {
  ifMtime?: number;
}

export interface WorkspaceBridgeStatDto {
  exists: boolean;
  path: string;
  name: string;
  kind: "file" | "directory" | null;
  size: number | null;
  mtime: number | null;
  hidden: boolean;
}

export interface WorkspaceBridgeExistsDto {
  path: string;
  exists: boolean;
}

export interface WorkspaceBridgeDesktopTargetDto {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
}

export interface WorkspaceBridgeWatchDirOptionsDto {
  recursive?: boolean;
  includeHidden?: boolean;
  kind?: "file" | "directory" | "any";
}

export interface WorkspaceBridgeWatchEventDto {
  seq: number;
  type: "created" | "changed" | "deleted";
  path: string;
  kind: "file" | "directory" | "unknown";
  mtime: number | null;
}

export interface WorkspaceBridgeWatchPollResultDto {
  watchId: string;
  events: WorkspaceBridgeWatchEventDto[];
  nextCursor: number;
}

export function getWorkspaceBridgeCapabilities(workspaceId: string) {
  const search = new URLSearchParams({ workspaceId });
  return httpClient.request<WorkspaceBridgeCapabilitiesDto>(`/api/files/workspace-bridge/capabilities?${search.toString()}`);
}

export function listWorkspaceBridgeDir(
  workspaceId: string,
  path: string,
  options?: WorkspaceBridgeListDirOptionsDto
) {
  return httpClient.request<{ path: string; items: WorkspaceBridgeDirItemDto[] }>(
    "/api/files/workspace-bridge/list-dir",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path, options })
    }
  );
}

export function readWorkspaceBridgeText(workspaceId: string, path: string) {
  return httpClient.request<WorkspaceBridgeReadTextResultDto>(
    "/api/files/workspace-bridge/read-text",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path })
    }
  );
}

export function readWorkspaceBridgeTexts(workspaceId: string, paths: string[]) {
  return httpClient.request<WorkspaceBridgeReadTextsResultDto>(
    "/api/files/workspace-bridge/read-texts",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, paths })
    }
  );
}

export function writeWorkspaceBridgeText(
  workspaceId: string,
  path: string,
  content: string,
  options?: WorkspaceBridgeWriteTextOptionsDto
) {
  return httpClient.request<{ ok: true; path: string; mtime: number; size: number }>(
    "/api/files/workspace-bridge/write-text",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path, content, options })
    }
  );
}

export function deleteWorkspaceBridgeFile(
  workspaceId: string,
  path: string,
  options?: WorkspaceBridgeDeleteFileOptionsDto
) {
  return httpClient.request<{ ok: true; path: string }>(
    "/api/files/workspace-bridge/delete-file",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path, options })
    }
  );
}

export function statWorkspaceBridgePath(workspaceId: string, path: string) {
  const search = new URLSearchParams({ workspaceId, path });
  return httpClient.request<WorkspaceBridgeStatDto>(`/api/files/workspace-bridge/stat?${search.toString()}`);
}

export function existsWorkspaceBridgePath(workspaceId: string, path: string) {
  const search = new URLSearchParams({ workspaceId, path });
  return httpClient.request<WorkspaceBridgeExistsDto>(`/api/files/workspace-bridge/exists?${search.toString()}`);
}

export function prepareWorkspaceBridgeOpenFile(workspaceId: string, path: string) {
  return httpClient.request<WorkspaceBridgeDesktopTargetDto>(
    "/api/files/workspace-bridge/open-file",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path })
    }
  );
}

export function prepareWorkspaceBridgeRevealFile(workspaceId: string, path: string) {
  return httpClient.request<WorkspaceBridgeDesktopTargetDto>(
    "/api/files/workspace-bridge/reveal-in-file-manager",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path })
    }
  );
}

export function watchWorkspaceBridgeDir(
  workspaceId: string,
  path: string,
  options?: WorkspaceBridgeWatchDirOptionsDto
) {
  return httpClient.request<{ watchId: string }>(
    "/api/files/workspace-bridge/watch-dir",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, path, options })
    }
  );
}

export function unwatchWorkspaceBridgeDir(watchId: string) {
  return httpClient.request<{ ok: true; watchId: string }>(
    "/api/files/workspace-bridge/unwatch",
    {
      method: "POST",
      body: JSON.stringify({ watchId })
    }
  );
}

export function pollWorkspaceBridgeWatchEvents(
  watchId: string,
  cursor?: number
) {
  const search = new URLSearchParams({ watchId });
  if (typeof cursor === "number" && Number.isFinite(cursor)) {
    search.set("cursor", String(Math.floor(cursor)));
  }
  return httpClient.request<WorkspaceBridgeWatchPollResultDto>(
    `/api/files/workspace-bridge/watch-events?${search.toString()}`
  );
}
