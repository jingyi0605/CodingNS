import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { Workspace, WorkspaceWorktreeRecord } from "../../types/domain.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import type { GitReadService } from "../git/git-read-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import { resolveWorktreeBaseRef } from "./worktree-base-ref-resolver.js";

const WORKTREE_CREATE_TIMEOUT_MS = 30_000;

export interface CreateWorktreeInput {
  sourceWorkspaceId: string;
  branchName: string;
  displayName?: string;
  baseRef?: string;
}

export interface WorktreeCreateResult {
  workspace: Workspace;
  meta: WorkspaceWorktreeRecord;
}

export interface WorktreeNodeView {
  workspace: Workspace;
  meta: WorkspaceWorktreeRecord;
  children: WorktreeNodeView[];
}

export class WorktreeManager {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceWorktreeRepository: WorkspaceWorktreeRepository,
    private readonly gitReadService: GitReadService,
    private readonly gitCommandRunner: GitCommandRunner,
    private readonly commandTemplateService: {
      cloneTemplatesToWorkspace(input: {
        sourceWorkspaceId: string;
        targetWorkspaceId: string;
        sourceWorkspacePath: string;
        targetWorkspacePath: string;
      }): unknown;
    }
  ) {}

  async create(input: CreateWorktreeInput, signal?: AbortSignal): Promise<WorktreeCreateResult> {
    const sourceWorkspaceId = input.sourceWorkspaceId.trim();
    const branchName = normalizeBranchName(input.branchName);

    if (!sourceWorkspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "来源工作区不能为空",
        field: "sourceWorkspaceId"
      });
    }

    const sourceWorkspace = this.workspaceService.getWorkspaceOrThrow(sourceWorkspaceId);
    const sourceMeta = this.workspaceWorktreeRepository.findByWorkspaceId(sourceWorkspaceId);
    const rootWorkspace = this.workspaceService.getWorkspaceOrThrow(
      sourceMeta?.rootWorkspaceId ?? sourceWorkspaceId
    );
    const sourceStatus = await this.gitReadService.getStatus(sourceWorkspaceId, signal);

    if (sourceStatus.snapshot.isDirty) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_SOURCE_DIRTY",
        detail: "来源工作区存在未提交改动，不能直接创建子工作树"
      });
    }

    await this.ensureBranchNameValid(sourceStatus.snapshot.repoRoot, sourceWorkspaceId, branchName, signal);
    await this.ensureBranchDoesNotExist(
      sourceStatus.snapshot.repoRoot,
      sourceWorkspaceId,
      branchName,
      signal
    );

    const baseResolution = await resolveWorktreeBaseRef({
      gitCommandRunner: this.gitCommandRunner,
      repoRoot: sourceStatus.snapshot.repoRoot,
      workspaceId: sourceWorkspaceId,
      currentBranch: sourceStatus.snapshot.branch,
      preferredBaseRef: input.baseRef,
      resolveBaseRefOperation: "worktree.create.resolveBaseRef",
      inspectCommitCountOperation: "worktree.create.inspectCommitCount",
      bootstrapInitialCommitOperation: "worktree.create.bootstrapInitialCommit",
      notFoundDetail: "指定的 baseRef 不存在，不能创建工作树",
      signal
    });
    const { baseRef, baseCommit } = baseResolution;
    const targetPath = buildTargetPath(rootWorkspace.path, branchName);

    ensureTargetPathSafe(rootWorkspace.path, targetPath);

    if (fs.existsSync(targetPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_PATH_CONFLICT",
        detail: "目标工作树目录已经存在，不能直接覆盖"
      });
    }

    const timestamp = nowIso();
    const displayName = normalizeDisplayName(input.displayName, branchName);
    let createdWorkspace: Workspace | null = null;
    let worktreeCreated = false;

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      await this.gitCommandRunner.run(
        sourceStatus.snapshot.repoRoot,
        ["worktree", "add", "-b", branchName, targetPath, baseRef],
        {
          timeoutMs: WORKTREE_CREATE_TIMEOUT_MS,
          workspaceId: sourceWorkspaceId,
          operation: "worktree.create",
          signal
        }
      );
      worktreeCreated = true;

      createdWorkspace = this.workspaceService.importWorkspace(targetPath, displayName);
      this.commandTemplateService.cloneTemplatesToWorkspace({
        sourceWorkspaceId: rootWorkspace.id,
        targetWorkspaceId: createdWorkspace.id,
        sourceWorkspacePath: rootWorkspace.path,
        targetWorkspacePath: createdWorkspace.path
      });

      const headCommit = await this.resolveHeadCommit(targetPath, createdWorkspace.id, signal);
      const meta = this.workspaceWorktreeRepository.create({
        workspaceId: createdWorkspace.id,
        rootWorkspaceId: rootWorkspace.id,
        parentWorkspaceId: sourceWorkspace.id,
        sourceWorkspaceId: sourceWorkspace.id,
        mergeTargetWorkspaceId: sourceWorkspace.id,
        branchName,
        baseRef,
        baseCommit,
        headCommit,
        displayName,
        depth: sourceMeta ? sourceMeta.depth + 1 : 1,
        lifecycleStatus: "active",
        mergedAt: null,
        removedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        workspace: createdWorkspace,
        meta
      };
    } catch (error) {
      await this.rollbackCreate(
        sourceStatus.snapshot.repoRoot,
        sourceWorkspaceId,
        branchName,
        targetPath,
        createdWorkspace,
        worktreeCreated,
        signal
      );
      throw mapCreateWorktreeError(error);
    }
  }

  getTree(rootWorkspaceId: string): WorktreeNodeView[] {
    const requestedWorkspaceId = rootWorkspaceId.trim();

    if (!requestedWorkspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "根工作区不能为空",
        field: "rootWorkspaceId"
      });
    }

    const rootMeta = this.workspaceWorktreeRepository.findByWorkspaceId(requestedWorkspaceId);
    const resolvedRootWorkspaceId = rootMeta?.rootWorkspaceId ?? requestedWorkspaceId;

    this.workspaceService.getWorkspaceOrThrow(resolvedRootWorkspaceId);

    const records = this.workspaceWorktreeRepository
      .listByRootWorkspaceId(resolvedRootWorkspaceId)
      .filter((record) => record.lifecycleStatus !== "removed");
    const nodeByWorkspaceId = new Map<string, WorktreeNodeView>();
    const roots: WorktreeNodeView[] = [];

    for (const record of records) {
      nodeByWorkspaceId.set(record.workspaceId, {
        workspace: this.workspaceService.getWorkspaceOrThrow(record.workspaceId),
        meta: record,
        children: []
      });
    }

    for (const record of records) {
      const currentNode = nodeByWorkspaceId.get(record.workspaceId);

      if (!currentNode) {
        continue;
      }

      if (record.parentWorkspaceId === resolvedRootWorkspaceId) {
        roots.push(currentNode);
        continue;
      }

      const parentNode = nodeByWorkspaceId.get(record.parentWorkspaceId);

      if (parentNode) {
        parentNode.children.push(currentNode);
        continue;
      }

      roots.push(currentNode);
    }

    return roots;
  }

  private async ensureBranchNameValid(
    repoRoot: string,
    workspaceId: string,
    branchName: string,
    signal?: AbortSignal
  ): Promise<void> {
    const result = await this.gitCommandRunner.run(
      repoRoot,
      ["check-ref-format", "--branch", branchName],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.create.validateBranch",
        signal
      }
    );

    if (result.exitCode === 0) {
      return;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "工作树分支名不合法",
      field: "branchName"
    });
  }

  private async ensureBranchDoesNotExist(
    repoRoot: string,
    workspaceId: string,
    branchName: string,
    signal?: AbortSignal
  ): Promise<void> {
    const result = await this.gitCommandRunner.run(
      repoRoot,
      ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.create.checkBranchExists",
        signal
      }
    );

    if (result.exitCode !== 0) {
      return;
    }

    throw new AppError({
      statusCode: 409,
      errorCode: "WORKTREE_BRANCH_EXISTS",
      detail: "目标分支已经存在，不能重复创建工作树"
    });
  }

  private async resolveHeadCommit(
    targetPath: string,
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<string> {
    const result = await this.gitCommandRunner.run(targetPath, ["rev-parse", "HEAD"], {
      workspaceId,
      operation: "worktree.create.resolveHeadCommit",
      signal
    });

    return result.stdout.trim();
  }

  private async rollbackCreate(
    repoRoot: string,
    workspaceId: string,
    branchName: string,
    targetPath: string,
    createdWorkspace: Workspace | null,
    worktreeCreated: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    if (createdWorkspace) {
      this.workspaceService.removeWorkspace(createdWorkspace.id);
    }

    if (worktreeCreated || fs.existsSync(targetPath)) {
      try {
        await this.gitCommandRunner.run(
          repoRoot,
          ["worktree", "remove", "--force", targetPath],
          {
            allowNonZeroExit: true,
            workspaceId,
            operation: "worktree.create.rollbackRemove",
            signal
          }
        );
      } catch {
        // 回滚阶段不再向外抛，优先保住原始错误。
      }

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    }

    try {
      await this.gitCommandRunner.run(repoRoot, ["branch", "-D", branchName], {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.create.rollbackDeleteBranch",
        signal
      });
    } catch {
      // 分支删除失败只保留残留，不能覆盖原始错误。
    }
  }
}

function normalizeBranchName(branchName: string): string {
  const normalized = branchName.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "工作树分支名不能为空",
      field: "branchName"
    });
  }

  return normalized;
}

function normalizeDisplayName(displayName: string | undefined, branchName: string): string {
  return displayName?.trim() || branchName;
}

function buildTargetPath(rootWorkspacePath: string, branchName: string): string {
  const rootPath = path.resolve(rootWorkspacePath);
  const rootParentPath = path.dirname(rootPath);
  const rootName = path.basename(rootPath);

  return path.join(rootParentPath, `${rootName}.worktrees`, sanitizePathSegment(branchName));
}

function ensureTargetPathSafe(rootWorkspacePath: string, targetPath: string): void {
  const normalizedRootPath = path.resolve(rootWorkspacePath);
  const normalizedTargetPath = path.resolve(targetPath);
  const relative = path.relative(normalizedRootPath, normalizedTargetPath);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new AppError({
      statusCode: 400,
      errorCode: "WORKTREE_PATH_INVALID",
      detail: "工作树目录不能落在根工作区目录内部"
    });
  }
}

function sanitizePathSegment(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "worktree";
}

function mapCreateWorktreeError(error: unknown): Error {
  if (!(error instanceof AppError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (error.errorCode !== "GIT_COMMAND_FAILED") {
    return error;
  }

  if (error.message.includes("already exists")) {
    return new AppError({
      statusCode: 409,
      errorCode: "WORKTREE_BRANCH_EXISTS",
      detail: "目标分支已经存在，不能重复创建工作树"
    });
  }

  if (error.message.includes("is already checked out")) {
    return new AppError({
      statusCode: 409,
      errorCode: "WORKTREE_BRANCH_IN_USE",
      detail: "目标分支已经被其他工作树占用，不能再次创建"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "WORKTREE_CREATE_FAILED",
    detail: error.message
  });
}
