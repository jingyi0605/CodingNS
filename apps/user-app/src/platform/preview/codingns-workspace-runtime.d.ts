import type {
  WorkspaceBridgeCapabilitiesDto,
  WorkspaceBridgeDeleteFileOptionsDto,
  WorkspaceBridgeDesktopTargetDto,
  WorkspaceBridgeDirItemDto,
  WorkspaceBridgeExistsDto,
  WorkspaceBridgeListDirOptionsDto,
  WorkspaceBridgeReadTextResultDto,
  WorkspaceBridgeReadTextsResultDto,
  WorkspaceBridgeStatDto,
  WorkspaceBridgeWatchDirOptionsDto,
  WorkspaceBridgeWatchEventDto,
  WorkspaceBridgeWriteTextOptionsDto
} from "./codingns-workspace-bridge";

export interface CodingNSWorkspacePermissionResult {
  ok: true;
  granted: true;
  scope: "workspace";
}

export interface CodingNSWorkspaceWatchHandle {
  watchId: string;
  unsubscribe(): Promise<{
    ok: true;
    watchId: string;
  }>;
}

export interface CodingNSWorkspaceBridgeProtocol {
  requestType: "codingns.workspace.request";
  responseType: "codingns.workspace.response";
  eventType: "codingns.workspace.event";
  parentOrigin: string | null;
}

export interface CodingNSWorkspaceBridge {
  capabilities(): Promise<WorkspaceBridgeCapabilitiesDto>;
  requestPermission(input?: unknown): Promise<CodingNSWorkspacePermissionResult>;
  listDir(
    relativePath: string,
    options?: WorkspaceBridgeListDirOptionsDto
  ): Promise<{
    path: string;
    items: WorkspaceBridgeDirItemDto[];
  }>;
  readText(relativePath: string, options?: Record<string, unknown>): Promise<WorkspaceBridgeReadTextResultDto>;
  readTexts(
    paths: string[],
    options?: Record<string, unknown>
  ): Promise<WorkspaceBridgeReadTextsResultDto>;
  writeText(
    relativePath: string,
    content: string,
    options?: WorkspaceBridgeWriteTextOptionsDto
  ): Promise<{
    ok: true;
    path: string;
    mtime: number;
    size: number;
  }>;
  writeTexts(): Promise<never>;
  deleteFile(
    relativePath: string,
    options?: WorkspaceBridgeDeleteFileOptionsDto
  ): Promise<{
    ok: true;
    path: string;
  }>;
  stat(relativePath: string): Promise<WorkspaceBridgeStatDto>;
  exists(relativePath: string): Promise<WorkspaceBridgeExistsDto>;
  watchDir(
    relativePath: string,
    options?: WorkspaceBridgeWatchDirOptionsDto | ((event: WorkspaceBridgeWatchEventDto) => void),
    callback?: (event: WorkspaceBridgeWatchEventDto) => void
  ): Promise<CodingNSWorkspaceWatchHandle>;
  unwatch(
    watchIdOrHandle:
      | string
      | { watchId: string }
      | CodingNSWorkspaceWatchHandle
  ): Promise<{
    ok: true;
    watchId: string;
  }>;
  openWorkspaceFile(relativePath: string): Promise<WorkspaceBridgeDesktopTargetDto>;
  revealWorkspaceFile(relativePath: string): Promise<WorkspaceBridgeDesktopTargetDto>;
  bridgeProtocol: CodingNSWorkspaceBridgeProtocol;
}

declare global {
  interface Window {
    CodingNSWorkspace?: CodingNSWorkspaceBridge;
  }
}

export {};
