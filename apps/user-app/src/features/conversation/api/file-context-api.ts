import { httpClient } from "../../../network/http-client";

interface FileRequestOptions {
  targetHostId?: string | null;
}

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
  matchSource?: "path" | "content" | "path_and_content";
  snippet?: string | null;
  matchScore?: number | null;
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

export interface RecentModifiedFileRecordDto {
  path: string;
  name: string;
  updatedAt: string;
  size: number;
}

export type FilePreviewKind =
  | "text"
  | "markdown"
  | "html"
  | "image"
  | "pdf"
  | "office"
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
  onlyOffice: {
    apiScriptUrl: string;
    editorMode: "edit" | "view";
    documentUrl: string;
    callbackUrl: string;
    editorConfig: Record<string, unknown>;
  } | null;
  capabilities: FilePreviewCapabilitiesDto;
}

export interface FilePreviewLinkDto {
  previewPath: string;
  previewUrl: string;
  expiresAt: string;
}

export interface FilePreviewRequestOptions {
  officeDisplayMode?: "default" | "reading";
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

export function getFileTree(workspaceId: string, filePath?: string, options?: FileRequestOptions) {
  const search = new URLSearchParams({ workspaceId });

  if (filePath) {
    search.set("path", filePath);
  }

  return httpClient.request<{ items: FileNodeDto[] }>(`/api/files/tree?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function getFileContent(workspaceId: string, filePath: string, options?: FileRequestOptions) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FileSnapshotDto>(`/api/files/content?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function saveFileContent(
  workspaceId: string,
  filePath: string,
  content: string,
  expectedVersion?: string | null,
  options?: FileRequestOptions
) {
  return httpClient.request<FileSaveResponseDto>("/api/files/content", {
    method: "PUT",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify({
      workspaceId,
      path: filePath,
      content,
      expectedVersion: expectedVersion ?? undefined
    })
  });
}

export function operateFile(payload: OperateFilePayload, options?: FileRequestOptions) {
  return httpClient.request<{ success: true; opType: FileOperationType }>("/api/files/ops", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify(payload)
  });
}

export function uploadFile(payload: UploadFilePayload, options?: FileRequestOptions) {
  return httpClient.request<FileTransferDto>("/api/files/upload", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify(payload)
  });
}

export function downloadFile(workspaceId: string, filePath: string, options?: FileRequestOptions) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FileDownloadDto>(`/api/files/download?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function searchFiles(
  workspaceId: string,
  keyword: string,
  page = 1,
  pageSize = 20,
  options?: FileRequestOptions
) {
  const search = new URLSearchParams({
    workspaceId,
    keyword,
    page: String(page),
    pageSize: String(pageSize)
  });

  return httpClient.request<FileSearchResultDto>(`/api/files/search?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function getRecentFiles(workspaceId: string, limit = 10, options?: FileRequestOptions) {
  const search = new URLSearchParams({
    workspaceId,
    limit: String(limit)
  });

  return httpClient.request<{ items: RecentFileRecordDto[] }>(`/api/files/recent?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function getRecentModifiedFiles(
  workspaceId: string,
  input?: {
    limit?: number;
    keyword?: string;
  },
  options?: FileRequestOptions
) {
  const search = new URLSearchParams({
    workspaceId,
    limit: String(input?.limit ?? 10)
  });

  if (input?.keyword?.trim()) {
    search.set("keyword", input.keyword.trim());
  }

  return httpClient.request<{ items: RecentModifiedFileRecordDto[] }>(
    `/api/files/recent-modified?${search.toString()}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function getFilePreview(
  workspaceId: string,
  filePath: string,
  options?: FilePreviewRequestOptions & FileRequestOptions
) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  if (options?.officeDisplayMode === "reading") {
    search.set("displayMode", "reading");
  }

  return httpClient.request<FilePreviewDto>(`/api/files/preview?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function getFilePreviewLink(workspaceId: string, filePath: string, options?: FileRequestOptions) {
  const search = new URLSearchParams({
    workspaceId,
    path: filePath
  });

  return httpClient.request<FilePreviewLinkDto>(`/api/files/preview-link?${search.toString()}`, {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function listFileContextBindings(sessionId: string, options?: FileRequestOptions) {
  return httpClient.request<{ items: FileContextBindingDto[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/contexts/files`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function attachFileContext(
  sessionId: string,
  payload: AttachFileContextPayload,
  options?: FileRequestOptions
) {
  return httpClient.request<FileContextBindingDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/contexts/files`,
    {
      method: "POST",
      targetHostId: options?.targetHostId ?? undefined,
      body: JSON.stringify(payload)
    }
  );
}

export function detachFileContext(sessionId: string, bindingId: string, options?: FileRequestOptions) {
  return httpClient.request<{ success: true }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/contexts/files/${encodeURIComponent(bindingId)}`,
    {
      method: "DELETE",
      targetHostId: options?.targetHostId ?? undefined
    }
  );
}
