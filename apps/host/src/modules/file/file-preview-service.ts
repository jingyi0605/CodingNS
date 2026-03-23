import { AppError } from "../../shared/errors/app-error.js";
import { MAX_PREVIEW_FILE_BYTES } from "./file-constants.js";
import type { FileAccessGuard } from "./file-access-guard.js";
import type { FileContentService } from "./file-content-service.js";

export interface FilePreviewResult {
  workspaceId: string;
  path: string;
  supported: boolean;
  kind: "text" | "binary" | "unsupported";
  reason: string | null;
  content: string | null;
  version: string | null;
  size: number;
  updatedAt: string | null;
}

export class FilePreviewService {
  constructor(
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly fileContentService: FileContentService
  ) {}

  preview(workspaceId: string, requestedPath: string, userId: string): FilePreviewResult {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });

    if ((resolved.stats?.size ?? 0) > MAX_PREVIEW_FILE_BYTES) {
      return {
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "unsupported",
        reason: "文件过大，本轮只提供轻量预览",
        content: null,
        version: null,
        size: resolved.stats?.size ?? 0,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      };
    }

    try {
      const snapshot = this.fileContentService.readFile(workspaceId, requestedPath, userId);

      return {
        workspaceId,
        path: snapshot.path,
        supported: true,
        kind: "text",
        reason: null,
        content: snapshot.content,
        version: snapshot.version,
        size: snapshot.size,
        updatedAt: snapshot.updatedAt
      };
    } catch (error) {
      if (error instanceof AppError && error.errorCode === "BINARY_FILE_NOT_SUPPORTED") {
        return {
          workspaceId,
          path: resolved.relativePath,
          supported: false,
          kind: "binary",
          reason: error.message,
          content: null,
          version: null,
          size: resolved.stats?.size ?? 0,
          updatedAt: resolved.stats?.mtime.toISOString() ?? null
        };
      }

      throw error;
    }
  }
}
