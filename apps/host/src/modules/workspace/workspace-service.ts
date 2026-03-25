import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { Workspace } from "../../types/domain.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";

interface WorkspaceDirectoryOption {
  path: string;
  name: string;
}

export interface WorkspaceDirectoryBrowseResult {
  currentPath: string;
  parentPath: string | null;
  roots: WorkspaceDirectoryOption[];
  items: WorkspaceDirectoryOption[];
}

const DIRECTORY_BROWSE_LIMIT = 200;

export class WorkspaceService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  browseDirectories(requestedPath?: string): WorkspaceDirectoryBrowseResult {
    const roots = listDirectoryRoots();
    const fallbackPath = resolveDefaultBrowsePath(roots);
    const currentPath = resolveBrowsePath(requestedPath, fallbackPath);

    if (!fs.existsSync(currentPath)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WORKSPACE_PATH",
        detail: "工作区路径不存在",
        field: "path"
      });
    }

    if (!fs.statSync(currentPath).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WORKSPACE_PATH",
        detail: "工作区路径必须是目录",
        field: "path"
      });
    }

    return {
      currentPath,
      parentPath: resolveParentPath(currentPath),
      roots,
      items: fs
        .readdirSync(currentPath, {
          withFileTypes: true
        })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .slice(0, DIRECTORY_BROWSE_LIMIT)
        .map((entry) => ({
          path: path.join(currentPath, entry.name),
          name: entry.name
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    };
  }

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

function listDirectoryRoots(): WorkspaceDirectoryOption[] {
  if (process.platform === "win32") {
    const driveLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

    return driveLetters
      .map((letter) => `${letter}:\\`)
      .filter((rootPath) => fs.existsSync(rootPath))
      .map((rootPath) => ({
        path: rootPath,
        name: rootPath
      }));
  }

  return [
    {
      path: "/",
      name: "/"
    }
  ];
}

function resolveDefaultBrowsePath(roots: WorkspaceDirectoryOption[]): string {
  const homePath = os.homedir();

  if (homePath && fs.existsSync(homePath) && fs.statSync(homePath).isDirectory()) {
    return path.resolve(homePath);
  }

  if (roots[0]?.path) {
    return roots[0].path;
  }

  return path.resolve(process.cwd());
}

function resolveBrowsePath(requestedPath: string | undefined, fallbackPath: string): string {
  const trimmedPath = requestedPath?.trim();

  if (!trimmedPath) {
    return fallbackPath;
  }

  return path.resolve(trimmedPath);
}

function resolveParentPath(currentPath: string): string | null {
  const parentPath = path.dirname(currentPath);
  const currentRoot = path.parse(currentPath).root;

  if (parentPath === currentPath || currentPath === currentRoot) {
    return null;
  }

  return parentPath;
}
