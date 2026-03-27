import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type { Workspace } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { GitCommandRunner } from "./git-command-runner.js";

export interface ResolvedWorkspaceRepo {
  workspace: Workspace;
  repoRoot: string;
}

export class WorkspaceRepoGuard {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly gitCommandRunner: GitCommandRunner
  ) {}

  async resolve(workspaceId: string): Promise<ResolvedWorkspaceRepo> {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const configuredRepoRoot = path.resolve(workspace.repoRoot ?? workspace.path);

    if (!fs.existsSync(configuredRepoRoot) || !fs.statSync(configuredRepoRoot).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WORKSPACE",
        detail: "工作区仓库根目录无效"
      });
    }

    const result = await this.gitCommandRunner.run(
      configuredRepoRoot,
      ["rev-parse", "--show-toplevel"],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "workspaceRepoGuard.resolve"
      }
    );

    if (result.exitCode !== 0) {
      throw new AppError({
        statusCode: 404,
        errorCode: "NOT_GIT_REPOSITORY",
        detail: "当前工作区不是 Git 仓库"
      });
    }

    const actualRepoRoot = normalizePath(result.stdout.trim());

    if (!actualRepoRoot) {
      throw new AppError({
        statusCode: 404,
        errorCode: "GIT_REPO_NOT_FOUND",
        detail: "工作区仓库根目录不存在"
      });
    }

    if (normalizePath(configuredRepoRoot) !== actualRepoRoot) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_WORKSPACE",
        detail: "工作区绑定的仓库根目录与真实 Git 根目录不一致"
      });
    }

    return {
      workspace,
      repoRoot: actualRepoRoot
    };
  }

  ensureRelativePath(repoRoot: string, targetPath: string): string {
    const normalizedTarget = targetPath.trim();

    if (!normalizedTarget) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_TARGET",
        detail: "Git 目标路径不能为空",
        field: "targets"
      });
    }

    const absoluteTarget = path.resolve(repoRoot, normalizedTarget);

    if (!isPathInside(absoluteTarget, repoRoot)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PATH_OUT_OF_WORKSPACE",
        detail: "Git 目标路径超出了工作区仓库边界",
        field: "targets"
      });
    }

    return toPosixPath(path.relative(repoRoot, absoluteTarget));
  }
}

function normalizePath(input: string): string {
  const resolved = path.resolve(input);

  if (process.platform === "win32") {
    return resolved.toLowerCase();
  }

  return resolved;
}

function isPathInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedParent = normalizePath(parent);

  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}
