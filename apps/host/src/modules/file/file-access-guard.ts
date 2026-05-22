import fs from "node:fs";
import path from "node:path";

import { AppError, isAppError } from "../../shared/errors/app-error.js";
import type { Workspace } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { normalizeRelativePath, resolveWorkspacePath } from "./path-normalizer.js";

interface FileAccessLogger {
  warn(bindings: Record<string, unknown>, message: string): void;
}

interface ResolvePathOptions {
  allowRoot?: boolean;
  mustExist?: boolean;
  kind?: "file" | "directory" | "any";
  allowMissingParentChain?: boolean;
}

export interface ResolvedWorkspacePath {
  workspace: Workspace;
  workspaceRealPath: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  stats: fs.Stats | null;
}

export class FileAccessGuard {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly logger: FileAccessLogger
  ) {}

  resolvePath(
    workspaceId: string,
    requestedPath: string | undefined,
    options: ResolvePathOptions = {}
  ): ResolvedWorkspacePath {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const workspaceRealPath = fs.realpathSync.native(workspace.path);

    let relativePath = "";

    try {
      relativePath = normalizeRelativePath(requestedPath, options.allowRoot ?? false);
    } catch (error) {
      if (isAppError(error) && error.errorCode === "PATH_TRAVERSAL_BLOCKED") {
        this.logger.warn(
          {
            workspaceId,
            path: requestedPath
          },
          "检测到路径穿越请求"
        );
      }

      throw error;
    }

    const absolutePath = resolveWorkspacePath(workspace.path, relativePath);
    const exists = fs.existsSync(absolutePath);
    let stats: fs.Stats | null = null;

    if (exists) {
      const targetRealPath = fs.realpathSync.native(absolutePath);
      this.ensureInsideWorkspace(workspaceRealPath, targetRealPath, workspaceId, requestedPath);
      stats = fs.statSync(absolutePath);
    } else {
      if (options.mustExist ?? true) {
        throw new AppError({
          statusCode: 404,
          errorCode: "FILE_NOT_FOUND",
          detail: "指定文件不存在",
          field: "path"
        });
      }

      const parentPath = this.findNearestExistingAncestor(path.dirname(absolutePath));

      if (!parentPath) {
        throw new AppError({
          statusCode: 400,
          errorCode: "PARENT_DIRECTORY_NOT_FOUND",
          detail: "目标目录不存在",
          field: "path"
        });
      }

      if (
        !options.allowMissingParentChain
        && parentPath !== path.dirname(absolutePath)
      ) {
        throw new AppError({
          statusCode: 400,
          errorCode: "PARENT_DIRECTORY_NOT_FOUND",
          detail: "目标目录不存在",
          field: "path"
        });
      }

      const parentRealPath = fs.realpathSync.native(parentPath);
      this.ensureInsideWorkspace(workspaceRealPath, parentRealPath, workspaceId, requestedPath);
    }

    if (stats && options.kind === "file" && !stats.isFile()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "NOT_A_FILE",
        detail: "指定路径不是文件",
        field: "path"
      });
    }

    if (stats && options.kind === "directory" && !stats.isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "NOT_A_DIRECTORY",
        detail: "指定路径不是目录",
        field: "path"
      });
    }

    return {
      workspace,
      workspaceRealPath,
      relativePath,
      absolutePath,
      exists,
      stats
    };
  }

  private ensureInsideWorkspace(
    workspaceRealPath: string,
    targetRealPath: string,
    workspaceId: string,
    requestedPath: string | undefined
  ): void {
    const relative = path.relative(workspaceRealPath, targetRealPath);

    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      this.logger.warn(
        {
          workspaceId,
          path: requestedPath,
          targetRealPath
        },
        "检测到工作区越界访问"
      );

      throw new AppError({
        statusCode: 400,
        errorCode: "PATH_OUT_OF_WORKSPACE",
        detail: "文件路径超出工作区边界",
        field: "path"
      });
    }
  }

  private findNearestExistingAncestor(inputPath: string): string | null {
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
}
