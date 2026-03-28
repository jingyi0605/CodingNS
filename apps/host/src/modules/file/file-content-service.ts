import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileSnapshot } from "../../types/domain.js";
import type { FileContextBindingRepository } from "../../storage/repositories/file-context-binding-repository.js";
import type { RecentFileService } from "./recent-file-service.js";
import { MAX_TEXT_FILE_BYTES } from "./file-constants.js";
import type { FileAccessGuard, ResolvedWorkspacePath } from "./file-access-guard.js";
import { FileVersionChecker } from "./file-version-checker.js";

export type FileOperationType = "create_file" | "create_directory" | "delete" | "rename" | "move";

interface ReadFileOptions {
  recordRecent?: boolean;
}

interface SaveFileInput {
  workspaceId: string;
  path: string;
  content: string;
  expectedVersion?: string;
  userId: string;
}

interface UploadFileInput {
  workspaceId: string;
  path: string;
  contentBase64: string;
  userId: string;
}

interface DownloadFileResult {
  workspaceId: string;
  path: string;
  fileName: string;
  contentBase64: string;
  size: number;
  updatedAt: string;
}

interface FileOperationInput {
  workspaceId: string;
  opType: FileOperationType;
  srcPath?: string;
  dstPath?: string;
  content?: string;
}

export class FileContentService {
  constructor(
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly recentFileService: RecentFileService,
    private readonly fileContextBindingRepository: FileContextBindingRepository,
    private readonly fileVersionChecker: FileVersionChecker
  ) {}

  readFile(
    workspaceId: string,
    requestedPath: string,
    userId: string,
    options: ReadFileOptions = {}
  ): FileSnapshot {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const snapshot = this.readSnapshot(resolved);

    if (options.recordRecent ?? true) {
      this.recentFileService.recordOpened(workspaceId, userId, snapshot.path);
    }

    return snapshot;
  }

  saveFile(input: SaveFileInput): FileSnapshot {
    const resolved = this.fileAccessGuard.resolvePath(input.workspaceId, input.path, {
      mustExist: true,
      kind: "file"
    });
    const currentBuffer = fs.readFileSync(resolved.absolutePath);
    const currentVersion = this.fileVersionChecker.create(currentBuffer, fs.statSync(resolved.absolutePath));

    this.ensureEditableTextBuffer(currentBuffer);
    this.fileVersionChecker.ensure(input.expectedVersion, currentVersion.version);

    const nextBuffer = Buffer.from(input.content, "utf8");
    this.ensureWritableContent(nextBuffer);
    fs.writeFileSync(resolved.absolutePath, nextBuffer);

    const snapshot = this.readSnapshot(
      this.fileAccessGuard.resolvePath(input.workspaceId, input.path, {
        mustExist: true,
        kind: "file"
      })
    );

    this.recentFileService.recordOpened(input.workspaceId, input.userId, snapshot.path);

    return snapshot;
  }

  uploadFile(input: UploadFileInput): {
    workspaceId: string;
    path: string;
    size: number;
    updatedAt: string;
  } {
    const resolved = this.fileAccessGuard.resolvePath(input.workspaceId, input.path, {
      mustExist: false
    });

    if (resolved.exists) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FILE_ALREADY_EXISTS",
        detail: "目标文件已存在",
        field: "path"
      });
    }

    const buffer = Buffer.from(input.contentBase64, "base64");
    fs.writeFileSync(resolved.absolutePath, buffer);

    const stats = fs.statSync(resolved.absolutePath);
    this.recentFileService.recordOpened(input.workspaceId, input.userId, resolved.relativePath);

    return {
      workspaceId: resolved.workspace.id,
      path: resolved.relativePath,
      size: buffer.byteLength,
      updatedAt: stats.mtime.toISOString()
    };
  }

  downloadFile(workspaceId: string, requestedPath: string, userId: string): DownloadFileResult {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const buffer = fs.readFileSync(resolved.absolutePath);
    const stats = fs.statSync(resolved.absolutePath);

    this.recentFileService.recordOpened(workspaceId, userId, resolved.relativePath);

    return {
      workspaceId: resolved.workspace.id,
      path: resolved.relativePath,
      fileName: path.basename(resolved.relativePath) || resolved.relativePath,
      contentBase64: buffer.toString("base64"),
      size: buffer.byteLength,
      updatedAt: stats.mtime.toISOString()
    };
  }

  operate(input: FileOperationInput): { success: true; opType: FileOperationType } {
    switch (input.opType) {
      case "create_file":
        this.createFile(input.workspaceId, input.dstPath, input.content ?? "");
        break;
      case "create_directory":
        this.createDirectory(input.workspaceId, input.dstPath);
        break;
      case "delete":
        this.deletePath(input.workspaceId, input.srcPath);
        break;
      case "rename":
      case "move":
        this.movePath(input.workspaceId, input.srcPath, input.dstPath);
        break;
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_FILE_OPERATION",
          detail: "不支持的文件操作类型",
          field: "opType"
        });
    }

    return {
      success: true,
      opType: input.opType
    };
  }

  private createFile(workspaceId: string, targetPath: string | undefined, content: string): void {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, targetPath, {
      mustExist: false
    });

    if (resolved.exists) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FILE_ALREADY_EXISTS",
        detail: "目标文件已存在",
        field: "dstPath"
      });
    }

    const buffer = Buffer.from(content, "utf8");
    this.ensureWritableContent(buffer);
    fs.writeFileSync(resolved.absolutePath, buffer);
  }

  private createDirectory(workspaceId: string, targetPath: string | undefined): void {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, targetPath, {
      mustExist: false
    });

    if (resolved.exists) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FILE_ALREADY_EXISTS",
        detail: "目标目录已存在",
        field: "dstPath"
      });
    }

    fs.mkdirSync(resolved.absolutePath);
  }

  private deletePath(workspaceId: string, sourcePath: string | undefined): void {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, sourcePath, {
      mustExist: true,
      kind: "any"
    });

    if (resolved.stats?.isDirectory()) {
      fs.rmSync(resolved.absolutePath, { recursive: true, force: false });
    } else {
      fs.rmSync(resolved.absolutePath, { force: false });
    }

    this.recentFileService.deleteByPath(workspaceId, resolved.relativePath);
    this.fileContextBindingRepository.deleteByPath(workspaceId, resolved.relativePath);
  }

  private movePath(
    workspaceId: string,
    sourcePath: string | undefined,
    targetPath: string | undefined
  ): void {
    const source = this.fileAccessGuard.resolvePath(workspaceId, sourcePath, {
      mustExist: true,
      kind: "any"
    });
    const target = this.fileAccessGuard.resolvePath(workspaceId, targetPath, {
      mustExist: false,
      kind: "any"
    });

    if (target.exists) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FILE_ALREADY_EXISTS",
        detail: "目标路径已存在",
        field: "dstPath"
      });
    }

    if (source.relativePath === target.relativePath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_FILE_OPERATION",
        detail: "源路径和目标路径不能相同",
        field: "dstPath"
      });
    }

    fs.renameSync(source.absolutePath, target.absolutePath);

    try {
      this.recentFileService.renamePath(workspaceId, source.relativePath, target.relativePath);
      this.fileContextBindingRepository.renamePath(
        workspaceId,
        source.relativePath,
        target.relativePath
      );
    } catch (error) {
      fs.renameSync(target.absolutePath, source.absolutePath);
      throw error;
    }
  }

  private readSnapshot(resolved: ResolvedWorkspacePath): FileSnapshot {
    const buffer = fs.readFileSync(resolved.absolutePath);

    this.ensureEditableTextBuffer(buffer);

    const version = this.fileVersionChecker.create(buffer, fs.statSync(resolved.absolutePath));

    return {
      workspaceId: resolved.workspace.id,
      path: resolved.relativePath,
      content: buffer.toString("utf8"),
      encoding: "utf-8",
      version: version.version,
      size: version.size,
      updatedAt: version.updatedAt
    };
  }

  private ensureEditableTextBuffer(buffer: Buffer): void {
    if (buffer.byteLength > MAX_TEXT_FILE_BYTES) {
      throw new AppError({
        statusCode: 400,
        errorCode: "FILE_TOO_LARGE",
        detail: "文件过大，本轮只支持轻量文本编辑",
        field: "path"
      });
    }

    if (isBinaryBuffer(buffer)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "BINARY_FILE_NOT_SUPPORTED",
        detail: "二进制文件暂不支持直接编辑",
        field: "path"
      });
    }
  }

  private ensureWritableContent(buffer: Buffer): void {
    if (buffer.byteLength > MAX_TEXT_FILE_BYTES) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_CONTENT",
        detail: "保存内容超出当前轻量编辑大小限制",
        field: "content"
      });
    }
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}
