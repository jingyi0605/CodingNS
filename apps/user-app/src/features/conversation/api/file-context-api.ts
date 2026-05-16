import { httpClient } from "../../../network/http-client";

export type FileNodeKind = "file" | "directory";
export type FileOperationType =
  | "create_file"
  | "create_directory"
  | "delete"
  | "rename"
  | "move"
  | "copy";

export interface FileNodeDto {
  path: string;
  name: string;
  kind: FileNodeKind;
  size: number | null;
  updatedAt: string | null;
}

export interface FileSnapshotDto {
  workspaceId: string;
  path: string;
  content: string;
  encoding: "utf-8";
  version: string;
  size: number;
  updatedAt: string;
}

export interface FileSaveResponseDto {
  version: string;
  updatedAt: string;
}

export interface FileTransferDto {
  workspaceId: string;
  path: string;
  size: number;
  updatedAt: string;
}

export interface FileDownloadDto extends FileTransferDto {
  fileName: string;
  contentBase64: string;
}

export interface FileSearchResultDto {
  items: FileNodeDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecentFileRecordDto {
  id: string;
  workspaceId: string;
  userId: string;
  path: string;
  lastOpenedAt: string;
  pinned: boolean;
}

export type FilePreviewKind =
  | "text"
  | "markdown"
  | "html"
  | "image"
  | "pdf"
  | "binary"
  | "unsupported";

export interface FilePreviewCapabilitiesDto {
  canEdit: boolean;
  canRefresh: boolean;
  canResize: boolean;
  canZoom: boolean;
  canPaginate: boolean;
}

export interface FilePreviewDto {
  workspaceId: string;
  path: string;
  supported: boolean;
  kind: FilePreviewKind;
  reason: string | null;
  content: string | null;
  version: string | null;
  size: number;
  updatedAt: string | null;
  previewPath: string | null;
  previewUrl: string | null;
  capabilities: FilePreviewCapabilitiesDto;
}

export interface FilePreviewLinkDto {
  previewPath: string;
  previewUrl: string;
  expiresAt: string;
}

export function getOfficeArtifactPreviewLink(artifactId: string) {
  return httpClient.request<FilePreviewLinkDto>(
    `/api/office/artifacts/${encodeURIComponent(artifactId)}/preview-link`
  );
}

export function getOfficeTaskFilePreviewLink(taskId: string, fileName: string) {
  return httpClient.request<FilePreviewLinkDto>(
    `/api/office/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileName)}/preview-link`
  );
}

export interface FileContextBindingDto {
  id: string;
  sessionId: string;
  workspaceId: string;
  path: string;
  displayName: string;
  selected: boolean;
  pinned: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
  contentHash: string;
  fileVersion: string;
  attachedBy: string;
  attachedAt: string;
}

export interface AttachFileContextPayload {
  workspaceId: string;
  path: string;
  rangeStart?: number;
  rangeEnd?: number;
}

export interface OperateFilePayload {
  workspaceId: string;
  opType: FileOperationType;
  srcPath?: string;
  dstPath?: string;
  content?: string;
}

export interface UploadFilePayload {
  workspaceId: string;
  path: string;
  contentBase64: string;
}

export function getFileTree(workspaceId: string, filePath?: string) {
  const search = new URLSearchParams({ workspaceId });

  if (filePath) {
    search.set("path", filePath);
  }

  return httpClient.request<{ items: FileNodeDto[] }>(`/api/files/tree?${search.toString()}`);
}

export function getFileContent(workspaceId: string, filePath: string) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FileSnapshotDto>(`/api/files/content?${search.toString()}`);
}

export function saveFileContent(
  workspaceId: string,
  filePath: string,
  content: string,
  expectedVersion?: string | null
) {
  return httpClient.request<FileSaveResponseDto>("/api/files/content", {
    method: "PUT",
    body: JSON.stringify({
      workspaceId,
      path: filePath,
      content,
      expectedVersion: expectedVersion ?? undefined
    })
  });
}

export function operateFile(payload: OperateFilePayload) {
  return httpClient.request<{ success: true; opType: FileOperationType }>("/api/files/ops", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function uploadFile(payload: UploadFilePayload) {
  return httpClient.request<FileTransferDto>("/api/files/upload", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function downloadFile(workspaceId: string, filePath: string) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FileDownloadDto>(`/api/files/download?${search.toString()}`);
}

export function searchFiles(
  workspaceId: string,
  keyword: string,
  page = 1,
  pageSize = 20
) {
  const search = new URLSearchParams({
    workspaceId,
    keyword,
    page: String(page),
    pageSize: String(pageSize)
  });

  return httpClient.request<FileSearchResultDto>(`/api/files/search?${search.toString()}`);
}

export function getRecentFiles(workspaceId: string, limit = 10) {
  const search = new URLSearchParams({
    workspaceId,
    limit: String(limit)
  });

  return httpClient.request<{ items: RecentFileRecordDto[] }>(`/api/files/recent?${search.toString()}`);
}

export function getFilePreview(workspaceId: string, filePath: string) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FilePreviewDto>(`/api/files/preview?${search.toString()}`);
}

export function getFilePreviewLink(workspaceId: string, filePath: string) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FilePreviewLinkDto>(`/api/files/preview-link?${search.toString()}`);
}

export function listFileContextBindings(sessionId: string) {
  return httpClient.request<{ items: FileContextBindingDto[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/contexts/files`
  );
}

export function attachFileContext(
  sessionId: string,
  payload: AttachFileContextPayload
) {
  return httpClient.request<FileContextBindingDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/contexts/files`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function detachFileContext(sessionId: string, bindingId: string) {
  return httpClient.request<{ success: true }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/contexts/files/${encodeURIComponent(bindingId)}`,
    {
      method: "DELETE"
    }
  );
}
