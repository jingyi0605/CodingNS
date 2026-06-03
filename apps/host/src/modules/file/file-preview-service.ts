import { readFileSync } from "node:fs";

import { AppError } from "../../shared/errors/app-error.js";
import {
  MAX_PREVIEW_FILE_BYTES,
  MAX_RESOURCE_PREVIEW_FILE_BYTES,
  MAX_TEXT_FILE_BYTES
} from "./file-constants.js";
import type { FileAccessGuard } from "./file-access-guard.js";
import type { FileContentService } from "./file-content-service.js";
import type { RecentFileService } from "./recent-file-service.js";
import {
  buildPreviewCapabilities,
  detectPreviewKind,
  type FilePreviewKind,
  type FilePreviewResult
} from "./file-preview-types.js";

export class FilePreviewService {
  constructor(
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly fileContentService: FileContentService,
    private readonly recentFileService: RecentFileService
  ) {}

  preview(workspaceId: string, requestedPath: string, userId: string): FilePreviewResult {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const previewKind = detectPreviewKind(resolved.relativePath);
    const fileSize = resolved.stats?.size ?? 0;

    if (
      isResourcePreviewKind(previewKind)
      && previewKind !== "office"
      && fileSize > MAX_RESOURCE_PREVIEW_FILE_BYTES
    ) {
      return this.buildResult({
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "unsupported",
        reason: "文件过大，当前内置资源预览暂不处理这么大的文件",
        content: null,
        version: null,
        size: fileSize,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    if (!isResourcePreviewKind(previewKind) && fileSize > MAX_PREVIEW_FILE_BYTES) {
      return this.buildResult({
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "unsupported",
        reason: "文件过大，本轮只提供轻量预览",
        content: null,
        version: null,
        size: fileSize,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    this.recentFileService.recordOpened(workspaceId, userId, resolved.relativePath);

    if (previewKind === "image" || previewKind === "pdf" || previewKind === "office") {
      return this.buildResult({
        workspaceId,
        path: resolved.relativePath,
        supported: true,
        kind: previewKind,
        reason: null,
        content: null,
        version: previewKind === "office"
          ? buildOfficeDocumentVersion(fileSize, resolved.stats?.mtime.toISOString() ?? null)
          : null,
        size: fileSize,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    const buffer = readFileSync(resolved.absolutePath);

    if (isBinaryBuffer(buffer)) {
      return this.buildResult({
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "binary",
        reason: "二进制文件暂不支持直接预览",
        content: null,
        version: null,
        size: resolved.stats?.size ?? 0,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    const textPreview = this.readTextPreview(
      workspaceId,
      requestedPath,
      userId,
      previewKind,
      fileSize || buffer.byteLength
    );

    return this.buildResult({
      workspaceId,
      path: resolved.relativePath,
      supported: true,
      kind: previewKind,
      reason: null,
      content: textPreview.content,
      version: textPreview.version,
      size: fileSize || buffer.byteLength,
      updatedAt: textPreview.updatedAt ?? resolved.stats?.mtime.toISOString() ?? null
    });
  }

  private readTextPreview(
    workspaceId: string,
    requestedPath: string,
    userId: string,
    previewKind: FilePreviewKind,
    fileSize: number
  ): {
    content: string;
    version: string | null;
    updatedAt: string | null;
  } {
    if (fileSize <= MAX_TEXT_FILE_BYTES) {
      try {
        const snapshot = this.fileContentService.readFile(workspaceId, requestedPath, userId, {
          recordRecent: false
        });

        return {
          content: snapshot.content,
          version: previewKind === "html" || previewKind === "markdown" || previewKind === "text"
            ? snapshot.version
            : null,
          updatedAt: snapshot.updatedAt
        };
      } catch (error) {
        if (!(error instanceof AppError) || error.errorCode !== "BINARY_FILE_NOT_SUPPORTED") {
          throw error;
        }
      }
    }

    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const buffer = readFileSync(resolved.absolutePath);

    if (isBinaryBuffer(buffer)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "BINARY_FILE_NOT_SUPPORTED",
        detail: "二进制文件暂不支持直接预览",
        field: "path"
      });
    }

    return {
      content: buffer.toString("utf8"),
      version: null,
      updatedAt: resolved.stats?.mtime.toISOString() ?? null
    };
  }

  private buildResult(
    input: Omit<FilePreviewResult, "previewPath" | "previewUrl" | "onlyOffice" | "capabilities">
  ): FilePreviewResult {
    return {
      ...input,
      previewPath: null,
      previewUrl: null,
      onlyOffice: null,
      capabilities: buildPreviewCapabilities(input.kind, {
        supported: input.supported,
        content: input.content,
        version: input.version
      })
    };
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function isResourcePreviewKind(kind: FilePreviewKind): boolean {
  return kind === "html" || kind === "image" || kind === "pdf" || kind === "office";
}

function buildOfficeDocumentVersion(fileSize: number, updatedAt: string | null): string | null {
  if (!updatedAt) {
    return null;
  }

  return `${updatedAt}:${fileSize}`;
}
