import fs from "node:fs";
import path from "node:path";

import { AppError, isAppError } from "../../shared/errors/app-error.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { FileAccessGuard } from "./file-access-guard.js";
import { normalizeRelativePath, resolveWorkspacePath } from "./path-normalizer.js";
import type {
  WorkspaceFileBridgeWatchDirOptions,
  WorkspaceFileBridgeWatchEvent
} from "./workspace-file-bridge-watch-service.js";
import type { WorkspaceFileBridgeWatchService } from "./workspace-file-bridge-watch-service.js";

const MAX_BRIDGE_TEXT_FILE_BYTES = 1024 * 1024;
const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 2000;
const DEFAULT_BATCH_READ_LIMIT = 200;

interface WorkspaceBridgeLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export interface WorkspaceFileBridgeCapabilities {
  read: boolean;
  write: boolean;
  delete: boolean;
  watch: boolean;
  batchRead: boolean;
  batchWrite: boolean;
  workspaceRootAccessible: boolean;
}

export interface WorkspaceFileBridgeErrorShape {
  code: string;
  message: string;
  path?: string;
}

export interface WorkspaceFileBridgeDirItem {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  mtime: number;
  hidden: boolean;
}

export interface WorkspaceFileBridgeListDirOptions {
  kind?: "file" | "directory" | "any";
  recursive?: boolean;
  includeHidden?: boolean;
  sortBy?: "name" | "mtime" | "size";
  order?: "asc" | "desc";
  limit?: number;
}

export interface WorkspaceFileBridgeWriteTextOptions {
  createIfMissing?: boolean;
  overwrite?: boolean;
  ifMtime?: number;
  ensureParentDir?: boolean;
}

export interface WorkspaceFileBridgeDeleteFileOptions {
  ifMtime?: number;
}

export interface WorkspaceFileBridgeWatchPollResult {
  watchId: string;
  events: WorkspaceFileBridgeWatchEvent[];
  nextCursor: number;
}

export interface WorkspaceFileBridgeStatResult {
  exists: boolean;
  path: string;
  name: string;
  kind: "file" | "directory" | null;
  size: number | null;
  mtime: number | null;
  hidden: boolean;
}

export interface WorkspaceFileBridgeDesktopTarget {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
}

type WorkspaceBridgeMutationKind = "upsert" | "delete";

interface WorkspaceBridgeMutationEvent {
  workspaceId: string;
  absolutePath: string;
  relativePath: string;
  kind: WorkspaceBridgeMutationKind;
}

type WorkspaceBridgeMutationHook = (event: WorkspaceBridgeMutationEvent) => void;

export class WorkspaceFileBridgeService {
  private mutationHook: WorkspaceBridgeMutationHook | null = null;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly logger: WorkspaceBridgeLogger,
    private readonly watchService: WorkspaceFileBridgeWatchService
  ) {}

  setMutationHook(hook: WorkspaceBridgeMutationHook | null): void {
    this.mutationHook = hook;
  }

  getCapabilities(): WorkspaceFileBridgeCapabilities {
    return {
      read: true,
      write: true,
      delete: true,
      watch: true,
      batchRead: true,
      batchWrite: false,
      workspaceRootAccessible: true
    };
  }

  listDir(
    workspaceId: string,
    requestedPath: string | undefined,
    options: WorkspaceFileBridgeListDirOptions = {}
  ): { path: string; items: WorkspaceFileBridgeDirItem[] } {
    const normalizedRequestedPath = this.normalizeDirectoryPath(requestedPath);

    let resolved;
    try {
      resolved = this.fileAccessGuard.resolvePath(workspaceId, normalizedRequestedPath, {
        allowRoot: true,
        mustExist: true,
        kind: "directory"
      });
    } catch (error) {
      throw this.remapDirectoryErrors(error, normalizedRequestedPath);
    }

    const items: WorkspaceFileBridgeDirItem[] = [];
    const includeHidden = options.includeHidden ?? false;
    const recursive = options.recursive ?? false;
    const kindFilter = options.kind ?? "any";
    const limit = clampListLimit(options.limit);

    const walk = (absoluteDirPath: string, relativeDirPath: string): void => {
      const entries = fs.readdirSync(absoluteDirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }

        const hidden = isHiddenName(entry.name);
        if (!includeHidden && hidden) {
          continue;
        }

        const childAbsolutePath = path.join(absoluteDirPath, entry.name);
        const childStats = fs.statSync(childAbsolutePath);
        const childRelativePath = relativeDirPath ? `${relativeDirPath}/${entry.name}` : entry.name;
        const kind = entry.isDirectory() ? "directory" : "file";

        if (kindFilter === "any" || kindFilter === kind) {
          items.push({
            name: entry.name,
            path: childRelativePath.replace(/\\/g, "/"),
            kind,
            size: kind === "file" ? childStats.size : null,
            mtime: toEpochMillis(childStats.mtimeMs),
            hidden
          });
        }

        if (recursive && entry.isDirectory()) {
          if (items.length >= limit) {
            return;
          }
          walk(childAbsolutePath, childRelativePath);
        }

        if (items.length >= limit) {
          return;
        }
      }
    };

    walk(resolved.absolutePath, resolved.relativePath);

    return {
      path: resolved.relativePath,
      items: sortDirectoryItems(items.slice(0, limit), options)
    };
  }

  readText(workspaceId: string, requestedPath: string): {
    path: string;
    content: string;
    mtime: number;
    size: number;
  } {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const buffer = fs.readFileSync(resolved.absolutePath);
    this.ensureUtf8TextBuffer(buffer, resolved.relativePath);

    if (buffer.byteLength > MAX_BRIDGE_TEXT_FILE_BYTES) {
      throw new AppError({
        statusCode: 413,
        errorCode: "FILE_TOO_LARGE",
        detail: `文件过大，当前桥接单次最多读取 ${MAX_BRIDGE_TEXT_FILE_BYTES} 字节`,
        field: "path"
      });
    }

    return {
      path: resolved.relativePath,
      content: buffer.toString("utf8"),
      mtime: toEpochMillis(resolved.stats?.mtimeMs ?? Date.now()),
      size: buffer.byteLength
    };
  }

  readTexts(
    workspaceId: string,
    paths: string[]
  ): {
    items: Array<
      | {
          path: string;
          content: string;
          mtime: number;
          size: number;
        }
      | {
          path: string;
          error: WorkspaceFileBridgeErrorShape;
        }
    >;
  } {
    const safePaths = Array.isArray(paths) ? paths.slice(0, DEFAULT_BATCH_READ_LIMIT) : [];

    return {
      items: safePaths.map((requestedPath) => {
        const safePath = typeof requestedPath === "string" ? requestedPath : "";

        try {
          return this.readText(workspaceId, safePath);
        } catch (error) {
          return {
            path: safePath,
            error: toBridgeErrorShape(error, safePath)
          };
        }
      })
    };
  }

  writeText(
    workspaceId: string,
    requestedPath: string,
    content: string,
    options: WorkspaceFileBridgeWriteTextOptions = {}
  ): {
    ok: true;
    path: string;
    mtime: number;
    size: number;
  } {
    const target = this.resolveWritableTarget(workspaceId, requestedPath, options.ensureParentDir ?? false);
    const createIfMissing = options.createIfMissing ?? true;
    const overwrite = options.overwrite ?? true;

    if (!target.exists && !createIfMissing) {
      throw new AppError({
        statusCode: 404,
        errorCode: "FILE_NOT_FOUND",
        detail: "目标文件不存在",
        field: "path"
      });
    }

    if (target.exists && !overwrite) {
      throw new AppError({
        statusCode: 409,
        errorCode: "CONFLICT",
        detail: "目标文件已存在，当前请求不允许覆盖",
        field: "path"
      });
    }

    if (typeof options.ifMtime === "number") {
      if (!target.exists) {
        throw new AppError({
          statusCode: 409,
          errorCode: "CONFLICT",
          detail: "目标文件不存在，无法通过 ifMtime 校验",
          field: "ifMtime"
        });
      }

      const currentMtime = toEpochMillis(target.stats?.mtimeMs ?? 0);
      if (currentMtime !== toEpochMillis(options.ifMtime)) {
        throw new AppError({
          statusCode: 409,
          errorCode: "CONFLICT",
          detail: "目标文件已被其他修改覆盖，请先刷新后再写入",
          field: "ifMtime"
        });
      }
    }

    if (!target.exists && options.ensureParentDir) {
      fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
    }

    const buffer = Buffer.from(typeof content === "string" ? content : "", "utf8");

    if (buffer.byteLength > MAX_BRIDGE_TEXT_FILE_BYTES) {
      throw new AppError({
        statusCode: 413,
        errorCode: "WRITE_FAILED",
        detail: `文件过大，当前桥接单次最多写入 ${MAX_BRIDGE_TEXT_FILE_BYTES} 字节`,
        field: "content"
      });
    }

    atomicWriteFile(target.absolutePath, buffer);
    const nextStats = fs.statSync(target.absolutePath);

    this.logger.info(
      {
        workspaceId,
        path: target.relativePath,
        size: nextStats.size,
        operation: "workspace_file_bridge.write_text"
      },
      "静态 HTML 预览通过桥接写入工作区文件"
    );

    this.reportMutation({
      workspaceId,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      kind: "upsert"
    });

    return {
      ok: true,
      path: target.relativePath,
      mtime: toEpochMillis(nextStats.mtimeMs),
      size: nextStats.size
    };
  }

  deleteFile(
    workspaceId: string,
    requestedPath: string,
    options: WorkspaceFileBridgeDeleteFileOptions = {}
  ): {
    ok: true;
    path: string;
  } {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });

    if (typeof options.ifMtime === "number") {
      const currentMtime = toEpochMillis(resolved.stats?.mtimeMs ?? 0);
      if (currentMtime !== toEpochMillis(options.ifMtime)) {
        throw new AppError({
          statusCode: 409,
          errorCode: "CONFLICT",
          detail: "目标文件已被其他修改覆盖，请先刷新后再删除",
          field: "ifMtime"
        });
      }
    }

    try {
      fs.rmSync(resolved.absolutePath, { force: false });
    } catch (error) {
      throw new AppError({
        statusCode: 500,
        errorCode: "DELETE_FAILED",
        detail: error instanceof Error ? error.message : "删除文件失败"
      });
    }

    this.logger.info(
      {
        workspaceId,
        path: resolved.relativePath,
        operation: "workspace_file_bridge.delete_file"
      },
      "静态 HTML 预览通过桥接删除工作区文件"
    );

    this.reportMutation({
      workspaceId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      kind: "delete"
    });

    return {
      ok: true,
      path: resolved.relativePath
    };
  }

  stat(workspaceId: string, requestedPath: string | undefined): WorkspaceFileBridgeStatResult {
    const normalizedRequestedPath = this.normalizeDirectoryPath(requestedPath);
    const allowRoot = normalizedRequestedPath.length === 0;
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, normalizedRequestedPath, {
      allowRoot,
      mustExist: false,
      kind: "any",
      allowMissingParentChain: true
    });

    if (!resolved.exists) {
      return {
        exists: false,
        path: resolved.relativePath,
        name: path.posix.basename(resolved.relativePath || "/"),
        kind: null,
        size: null,
        mtime: null,
        hidden: isHiddenName(path.posix.basename(resolved.relativePath))
      };
    }

    return {
      exists: true,
      path: resolved.relativePath,
      name: path.posix.basename(resolved.relativePath || resolved.workspace.name),
      kind: resolved.stats?.isDirectory() ? "directory" : "file",
      size: resolved.stats?.isFile() ? resolved.stats.size : null,
      mtime: toEpochMillis(resolved.stats?.mtimeMs ?? Date.now()),
      hidden: isHiddenName(path.posix.basename(resolved.relativePath))
    };
  }

  exists(workspaceId: string, requestedPath: string | undefined): { path: string; exists: boolean } {
    const snapshot = this.stat(workspaceId, requestedPath);
    return {
      path: snapshot.path,
      exists: snapshot.exists
    };
  }

  prepareOpenWorkspaceFile(
    workspaceId: string,
    requestedPath: string
  ): WorkspaceFileBridgeDesktopTarget {
    return this.resolveDesktopFileTarget(workspaceId, requestedPath);
  }

  prepareRevealWorkspaceFile(
    workspaceId: string,
    requestedPath: string
  ): WorkspaceFileBridgeDesktopTarget {
    return this.resolveDesktopFileTarget(workspaceId, requestedPath);
  }

  async watchDir(
    workspaceId: string,
    requestedPath: string | undefined,
    options: WorkspaceFileBridgeWatchDirOptions = {}
  ): Promise<{ watchId: string }> {
    return await this.watchService.watchDir(workspaceId, requestedPath, options);
  }

  unwatch(watchId: string): { ok: true; watchId: string } {
    return this.watchService.unwatch(watchId);
  }

  pollWatchEvents(
    watchId: string,
    cursor: number | undefined
  ): WorkspaceFileBridgeWatchPollResult {
    return this.watchService.pollEvents(watchId, cursor);
  }

  private resolveDesktopFileTarget(
    workspaceId: string,
    requestedPath: string
  ): WorkspaceFileBridgeDesktopTarget {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });

    return {
      workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath
    };
  }

  private resolveWritableTarget(
    workspaceId: string,
    requestedPath: string,
    ensureParentDir: boolean
  ) {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const relativePath = normalizeRelativePath(requestedPath, false);
    const absolutePath = resolveWorkspacePath(workspace.path, relativePath);
    const workspaceRealPath = fs.realpathSync.native(workspace.path);

    const existingAncestor = findNearestExistingAncestor(
      ensureParentDir ? path.dirname(absolutePath) : path.dirname(absolutePath)
    );

    if (!existingAncestor) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PARENT_DIRECTORY_NOT_FOUND",
        detail: "目标目录不存在",
        field: "path"
      });
    }

    const ancestorRealPath = fs.realpathSync.native(existingAncestor);
    this.ensureInsideWorkspace(workspaceRealPath, ancestorRealPath, requestedPath);

    const exists = fs.existsSync(absolutePath);
    let stats: fs.Stats | null = null;

    if (exists) {
      const targetRealPath = fs.realpathSync.native(absolutePath);
      this.ensureInsideWorkspace(workspaceRealPath, targetRealPath, requestedPath);
      stats = fs.statSync(absolutePath);
      if (!stats.isFile()) {
        throw new AppError({
          statusCode: 400,
          errorCode: "NOT_A_FILE",
          detail: "指定路径不是文件",
          field: "path"
        });
      }
    } else if (!ensureParentDir && !fs.existsSync(path.dirname(absolutePath))) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PARENT_DIRECTORY_NOT_FOUND",
        detail: "目标目录不存在",
        field: "path"
      });
    }

    return {
      workspace,
      relativePath,
      absolutePath,
      exists,
      stats
    };
  }

  private ensureInsideWorkspace(workspaceRealPath: string, targetRealPath: string, requestedPath: string): void {
    const relative = path.relative(workspaceRealPath, targetRealPath);

    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PATH_OUT_OF_WORKSPACE",
        detail: "文件路径超出工作区边界",
        field: "path"
      });
    }
  }

  private ensureUtf8TextBuffer(buffer: Buffer, requestedPath: string): void {
    if (buffer.includes(0)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "UNSUPPORTED_ENCODING",
        detail: "当前桥接只支持 UTF-8 文本文件",
        field: "path",
        data: {
          path: requestedPath
        }
      });
    }
  }

  private normalizeDirectoryPath(requestedPath: string | undefined): string {
    return typeof requestedPath === "string" ? requestedPath.trim() : "";
  }

  private remapDirectoryErrors(error: unknown, requestedPath: string): Error {
    if (!isAppError(error) || error.errorCode !== "FILE_NOT_FOUND") {
      return error as Error;
    }

    return new AppError({
      statusCode: 404,
      errorCode: "DIRECTORY_NOT_FOUND",
      detail: requestedPath ? "目标目录不存在" : "工作区根目录不存在"
    });
  }

  private reportMutation(event: WorkspaceBridgeMutationEvent): void {
    this.mutationHook?.(event);
  }
}

function atomicWriteFile(targetPath: string, buffer: Buffer): void {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.codingns-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }
    } catch {
      // ignore cleanup failure
    }

    throw new AppError({
      statusCode: 500,
      errorCode: "WRITE_FAILED",
      detail: error instanceof Error ? error.message : "写入文件失败"
    });
  }
}

function clampListLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)));
}

function sortDirectoryItems(
  items: WorkspaceFileBridgeDirItem[],
  options: WorkspaceFileBridgeListDirOptions
): WorkspaceFileBridgeDirItem[] {
  const sortBy = options.sortBy ?? "name";
  const direction = options.order === "desc" ? -1 : 1;

  return items.sort((left, right) => {
    if (sortBy === "mtime") {
      const byMtime = (left.mtime - right.mtime) * direction;
      if (byMtime !== 0) {
        return byMtime;
      }
    }

    if (sortBy === "size") {
      const leftSize = left.size ?? -1;
      const rightSize = right.size ?? -1;
      const bySize = (leftSize - rightSize) * direction;
      if (bySize !== 0) {
        return bySize;
      }
    }

    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, "zh-CN") * direction;
  });
}

function toEpochMillis(value: number): number {
  return Math.floor(value);
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function findNearestExistingAncestor(inputPath: string): string | null {
  let currentPath = path.resolve(inputPath);

  while (true) {
    if (fs.existsSync(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function toBridgeErrorShape(error: unknown, requestedPath: string): WorkspaceFileBridgeErrorShape {
  if (isAppError(error)) {
    return {
      code: error.errorCode,
      message: error.message,
      path: requestedPath
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || "内部错误",
      path: requestedPath
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "内部错误",
    path: requestedPath
  };
}
