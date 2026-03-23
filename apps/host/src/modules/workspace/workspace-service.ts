import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { Workspace } from "../../types/domain.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";

export class WorkspaceService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  importWorkspace(workspacePath: string, name?: string): Workspace {
    const resolvedPath = path.resolve(workspacePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WORKSPACE_PATH",
        detail: "工作区路径不存在",
        field: "path"
      });
    }

    if (!fs.statSync(resolvedPath).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WORKSPACE_PATH",
        detail: "工作区路径必须是目录",
        field: "path"
      });
    }

    const existing = this.workspaceRepository.findByPath(resolvedPath);

    if (existing) {
      return existing;
    }

    const timestamp = nowIso();

    return this.workspaceRepository.create({
      id: createId(),
      name: name?.trim() || path.basename(resolvedPath),
      path: resolvedPath,
      repoRoot: resolvedPath,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  list(): Workspace[] {
    return this.workspaceRepository.list();
  }

  getWorkspaceOrThrow(workspaceId: string): Workspace {
    const workspace = this.workspaceRepository.findById(workspaceId);

    if (!workspace) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "指定工作区不存在"
      });
    }

    return workspace;
  }
}
