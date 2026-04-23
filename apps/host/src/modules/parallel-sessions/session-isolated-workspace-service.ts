import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  SessionIsolatedWorkspaceRecord,
  SessionListItem,
  Workspace,
  WorkspaceWorktreeRecord
} from "../../types/domain.js";
import type { SessionIsolatedWorkspaceRepository } from "../../storage/repositories/session-isolated-workspace-repository.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { GitReadService } from "../git/git-read-service.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import { resolveWorktreeBaseRef } from "../worktree/worktree-base-ref-resolver.js";

const WORKTREE_CREATE_TIMEOUT_MS = 30_000;
const WORKTREE_CLEANUP_TIMEOUT_MS = 30_000;

export interface CreateSessionIsolatedWorkspaceInput {
  groupId: string;
  sourceWorkspaceId: string;
  displayName?: string | null;
  createSession: (workspaceId: string) => Promise<SessionListItem>;
  signal?: AbortSignal;
}

export interface CreateSessionIsolatedWorkspaceResult {
  session: SessionListItem;
  workspace: Workspace;
  record: SessionIsolatedWorkspaceRecord;
}

export interface PromoteSessionIsolatedWorkspaceResult {
  record: SessionIsolatedWorkspaceRecord;
  workspace: Workspace;
  worktree: WorkspaceWorktreeRecord;
}

export interface CleanupSessionIsolatedWorkspaceResult {
  record: SessionIsolatedWorkspaceRecord;
  removed: boolean;
  branchDeleted: boolean;
  deletedBranchName: string | null;
  detail: string | null;
}

export class SessionIsolatedWorkspaceService {
  constructor(
    private readonly sessionIsolatedWorkspaceRepository: SessionIsolatedWorkspaceRepository,
    private readonly workspaceWorktreeRepository: WorkspaceWorktreeRepository,
    private readonly workspaceService: Pick<
      WorkspaceService,
      "importWorkspace" | "removeWorkspace" | "getWorkspaceOrThrow"
    >,
    private readonly gitReadService: Pick<GitReadService, "getStatus">,
    private readonly gitCommandRunner: Pick<GitCommandRunner, "run">,
    private readonly commandTemplateService: {
      cloneTemplatesToWorkspace(input: {
        sourceWorkspaceId: string;
        targetWorkspaceId: string;
        sourceWorkspacePath: string;
        targetWorkspacePath: string;
      }): unknown;
    }
  ) {}

  async createForMember(
    input: CreateSessionIsolatedWorkspaceInput
  ): Promise<CreateSessionIsolatedWorkspaceResult> {
    const sourceWorkspaceId = normalizeRequiredText(input.sourceWorkspaceId, "sourceWorkspaceId");
    const sourceWorkspace = this.workspaceService.getWorkspaceOrThrow(sourceWorkspaceId);
    const sourceMeta = this.workspaceWorktreeRepository.findByWorkspaceId(sourceWorkspaceId);
    const rootWorkspace = this.workspaceService.getWorkspaceOrThrow(
      sourceMeta?.rootWorkspaceId ?? sourceWorkspaceId
    );
    const sourceStatus = await this.gitReadService.getStatus(sourceWorkspaceId, input.signal);

    if (sourceStatus.snapshot.isDirty) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_SOURCE_DIRTY",
        detail: "来源工作区存在未提交改动，不能创建临时隔离工作区"
      });
    }

    const branchName = buildTemporaryBranchName(input.groupId);
    await this.ensureBranchNameValid(sourceStatus.snapshot.repoRoot, sourceWorkspaceId, branchName, input.signal);
    await this.ensureBranchDoesNotExist(
      sourceStatus.snapshot.repoRoot,
      sourceWorkspaceId,
      branchName,
      input.signal
    );

    const baseResolution = await resolveWorktreeBaseRef({
      gitCommandRunner: this.gitCommandRunner,
      repoRoot: sourceStatus.snapshot.repoRoot,
      workspaceId: sourceWorkspaceId,
      currentBranch: sourceStatus.snapshot.branch,
      resolveBaseRefOperation: "parallel.session_isolated.create.resolveBaseRef",
      inspectCommitCountOperation: "parallel.session_isolated.create.inspectCommitCount",
      bootstrapInitialCommitOperation: "parallel.session_isolated.create.bootstrapInitialCommit",
      notFoundDetail: "临时工作区基准引用不存在，不能继续创建",
      signal: input.signal
    });
    const { baseRef, baseCommit } = baseResolution;
    const targetPath = buildTargetPath(rootWorkspace.path, branchName);
    ensureTargetPathSafe(rootWorkspace.path, targetPath);

    if (fs.existsSync(targetPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_PATH_CONFLICT",
        detail: "目标临时工作区目录已经存在，不能直接覆盖"
      });
    }

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
          operation: "parallel.session_isolated.create",
          signal: input.signal
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

      const session = await input.createSession(createdWorkspace.id);
      const timestamp = nowIso();
      const headCommit = await this.resolveCommit(
        createdWorkspace.path,
        createdWorkspace.id,
        "HEAD",
        "parallel.session_isolated.create.resolveHeadCommit",
        input.signal
      );
      const record = this.sessionIsolatedWorkspaceRepository.create({
        id: createId(),
        groupId: normalizeRequiredText(input.groupId, "groupId"),
        ownerSessionId: session.sessionId,
        workspaceId: createdWorkspace.id,
        sourceWorkspaceId,
        branchName,
        baseRef,
        baseCommit,
        headCommit,
        lifecycleStatus: "active",
        promotedAt: null,
        removedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        session,
        workspace: createdWorkspace,
        record
      };
    } catch (error) {
      await this.rollbackCreate(
        sourceStatus.snapshot.repoRoot,
        sourceWorkspaceId,
        branchName,
        targetPath,
        createdWorkspace,
        worktreeCreated,
        input.signal
      );
      throw mapCreateWorktreeError(error);
    }
  }

  promote(workspaceRecordId: string): PromoteSessionIsolatedWorkspaceResult {
    const current = this.requireRecordById(workspaceRecordId);

    if (current.lifecycleStatus !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_ISOLATED_WORKSPACE_NOT_ACTIVE",
        detail: "只有 active 状态的临时工作区才能升级"
      });
    }

    const existingWorktree = this.workspaceWorktreeRepository.findByWorkspaceId(current.workspaceId);

    if (existingWorktree) {
      const updated = this.sessionIsolatedWorkspaceRepository.update({
        ...current,
        lifecycleStatus: "promoted",
        promotedAt: current.promotedAt ?? nowIso(),
        updatedAt: nowIso()
      });

      if (!updated) {
        throw new AppError({
          statusCode: 500,
          errorCode: "SESSION_ISOLATED_WORKSPACE_UPDATE_FAILED",
          detail: "临时工作区升级时写入 promoted 状态失败"
        });
      }

      return {
        record: updated,
        workspace: this.workspaceService.getWorkspaceOrThrow(current.workspaceId),
        worktree: existingWorktree
      };
    }

    const workspace = this.workspaceService.getWorkspaceOrThrow(current.workspaceId);
    const sourceMeta = this.workspaceWorktreeRepository.findByWorkspaceId(current.sourceWorkspaceId);
    const timestamp = nowIso();
    const worktree = this.workspaceWorktreeRepository.create({
      workspaceId: current.workspaceId,
      rootWorkspaceId: sourceMeta?.rootWorkspaceId ?? current.sourceWorkspaceId,
      parentWorkspaceId: current.sourceWorkspaceId,
      sourceWorkspaceId: current.sourceWorkspaceId,
      mergeTargetWorkspaceId: current.sourceWorkspaceId,
      branchName: current.branchName,
      baseRef: current.baseRef,
      baseCommit: current.baseCommit,
      headCommit: current.headCommit,
      displayName: workspace.name,
      depth: sourceMeta ? sourceMeta.depth + 1 : 1,
      lifecycleStatus: "active",
      mergedAt: null,
      removedAt: null,
      createdAt: current.createdAt,
      updatedAt: timestamp
    });
    const updated = this.sessionIsolatedWorkspaceRepository.update({
      ...current,
      lifecycleStatus: "promoted",
      promotedAt: current.promotedAt ?? timestamp,
      updatedAt: timestamp
    });

    if (!updated) {
      throw new AppError({
        statusCode: 500,
        errorCode: "SESSION_ISOLATED_WORKSPACE_UPDATE_FAILED",
        detail: "临时工作区升级后写入 promoted 状态失败"
      });
    }

    return {
      record: updated,
      workspace,
      worktree
    };
  }

  async cleanupByOwnerSessionId(
    ownerSessionId: string,
    signal?: AbortSignal
  ): Promise<CleanupSessionIsolatedWorkspaceResult | null> {
    const record = this.sessionIsolatedWorkspaceRepository.findByOwnerSessionId(ownerSessionId.trim());

    if (!record) {
      return null;
    }

    return await this.cleanupRecord(record, signal);
  }

  private async cleanupRecord(
    record: SessionIsolatedWorkspaceRecord,
    signal?: AbortSignal
  ): Promise<CleanupSessionIsolatedWorkspaceResult> {
    if (record.lifecycleStatus === "promoted") {
      return {
        record,
        removed: false,
        branchDeleted: false,
        deletedBranchName: null,
        detail: "临时工作区已升级为正式子工作区，不会随删除动作自动清理"
      };
    }

    if (record.lifecycleStatus === "removed") {
      return {
        record,
        removed: true,
        branchDeleted: false,
        deletedBranchName: null,
        detail: null
      };
    }

    const sourceMeta = this.workspaceWorktreeRepository.findByWorkspaceId(record.sourceWorkspaceId);
    const rootWorkspace = this.workspaceService.getWorkspaceOrThrow(
      sourceMeta?.rootWorkspaceId ?? record.sourceWorkspaceId
    );
    const workspacePath = this.resolveWorkspacePath(record, rootWorkspace.path);
    const timestamp = nowIso();
    const removing = this.sessionIsolatedWorkspaceRepository.update({
      ...record,
      lifecycleStatus: "removing",
      updatedAt: timestamp
    });

    if (!removing) {
      throw new AppError({
        statusCode: 500,
        errorCode: "SESSION_ISOLATED_WORKSPACE_UPDATE_FAILED",
        detail: "临时工作区清理前无法写入 removing 状态"
      });
    }

    try {
      if (fs.existsSync(workspacePath)) {
        const removeResult = await this.gitCommandRunner.run(
          rootWorkspace.path,
          ["worktree", "remove", "--force", workspacePath],
          {
            allowNonZeroExit: true,
            timeoutMs: WORKTREE_CLEANUP_TIMEOUT_MS,
            workspaceId: rootWorkspace.id,
            operation: "parallel.session_isolated.cleanup.remove",
            signal
          }
        );

        if (removeResult.exitCode !== 0 && fs.existsSync(workspacePath)) {
          throw new AppError({
            statusCode: 409,
            errorCode: "SESSION_ISOLATED_WORKSPACE_REMOVE_FAILED",
            detail: removeResult.stderr.trim() || removeResult.stdout.trim() || "临时工作区目录删除失败"
          });
        }
      }

      await this.gitCommandRunner.run(
        rootWorkspace.path,
        ["worktree", "prune"],
        {
          allowNonZeroExit: true,
          workspaceId: rootWorkspace.id,
          operation: "parallel.session_isolated.cleanup.prune",
          signal
        }
      );

      const deleteBranchResult = await this.gitCommandRunner.run(
        rootWorkspace.path,
        ["branch", "-D", record.branchName],
        {
          allowNonZeroExit: true,
          workspaceId: rootWorkspace.id,
          operation: "parallel.session_isolated.cleanup.deleteBranch",
          signal
        }
      );
      const branchDeleted = deleteBranchResult.exitCode === 0;
      const detail = branchDeleted
        ? null
        : deleteBranchResult.stderr.trim() || deleteBranchResult.stdout.trim() || "临时分支删除失败";

      const removed = this.sessionIsolatedWorkspaceRepository.update({
        ...removing,
        lifecycleStatus: "removed",
        removedAt: timestamp,
        updatedAt: timestamp
      });

      if (!removed) {
        throw new AppError({
          statusCode: 500,
          errorCode: "SESSION_ISOLATED_WORKSPACE_UPDATE_FAILED",
          detail: "临时工作区目录已删除，但 removed 状态写入失败"
        });
      }

      try {
        this.workspaceService.removeWorkspace(record.workspaceId);
      } catch {
        // 工作区记录可能已被移除，这里继续收口元数据，不再阻断清理结果。
      }

      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, {
          recursive: true,
          force: true
        });
      }

      return {
        record: removed,
        removed: true,
        branchDeleted,
        deletedBranchName: branchDeleted ? record.branchName : null,
        detail
      };
    } catch (error) {
      this.sessionIsolatedWorkspaceRepository.update({
        ...record,
        lifecycleStatus: "active",
        updatedAt: nowIso()
      });

      return {
        record,
        removed: false,
        branchDeleted: false,
        deletedBranchName: null,
        detail: error instanceof Error ? error.message : "临时工作区清理失败"
      };
    }
  }

  private resolveWorkspacePath(record: SessionIsolatedWorkspaceRecord, rootWorkspacePath: string): string {
    try {
      return this.workspaceService.getWorkspaceOrThrow(record.workspaceId).path;
    } catch {
      return buildTargetPath(rootWorkspacePath, record.branchName);
    }
  }

  private requireRecordById(workspaceRecordId: string): SessionIsolatedWorkspaceRecord {
    const record = this.sessionIsolatedWorkspaceRepository.findById(workspaceRecordId.trim());

    if (!record) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SESSION_ISOLATED_WORKSPACE_NOT_FOUND",
        detail: "临时隔离工作区不存在"
      });
    }

    return record;
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
        operation: "parallel.session_isolated.validateBranch",
        signal
      }
    );

    if (result.exitCode === 0) {
      return;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "临时工作区分支名不合法",
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
        operation: "parallel.session_isolated.checkBranchExists",
        signal
      }
    );

    if (result.exitCode !== 0) {
      return;
    }

    throw new AppError({
      statusCode: 409,
      errorCode: "WORKTREE_BRANCH_EXISTS",
      detail: "目标分支已经存在，不能重复创建临时工作区"
    });
  }

  private async resolveCommit(
    cwd: string,
    workspaceId: string,
    ref: string,
    operation: string,
    signal?: AbortSignal
  ): Promise<string> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["rev-parse", "--verify", ref],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation,
        signal
      }
    );
    const commit = result.stdout.trim();

    if (result.exitCode === 0 && commit) {
      return commit;
    }

    throw new AppError({
      statusCode: 404,
      errorCode: "WORKTREE_BASE_REF_NOT_FOUND",
      detail: "临时工作区基准引用不存在，不能继续创建",
      field: "baseRef"
    });
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
      try {
        this.workspaceService.removeWorkspace(createdWorkspace.id);
      } catch {
        // 回滚阶段不覆盖原始错误。
      }
    }

    if (worktreeCreated || fs.existsSync(targetPath)) {
      try {
        await this.gitCommandRunner.run(
          repoRoot,
          ["worktree", "remove", "--force", targetPath],
          {
            allowNonZeroExit: true,
            workspaceId,
            operation: "parallel.session_isolated.rollbackRemove",
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
        operation: "parallel.session_isolated.rollbackDeleteBranch",
        signal
      });
    } catch {
      // 分支删除失败只保留残留，不能覆盖原始错误。
    }
  }
}

function normalizeRequiredText(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能为空`,
      field
    });
  }

  return normalized;
}

function normalizeDisplayName(displayName: string | null | undefined, branchName: string): string {
  return displayName?.trim() || `并行临时工作区-${sanitizePathSegment(branchName).slice(0, 12)}`;
}

function buildTemporaryBranchName(groupId: string): string {
  return `parallel/${groupId.slice(0, 8)}/${createId().slice(0, 8)}`;
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
      detail: "临时工作区目录不能落在根工作区目录内部"
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
      detail: "目标分支已经存在，不能重复创建临时工作区"
    });
  }

  if (error.message.includes("is already checked out")) {
    return new AppError({
      statusCode: 409,
      errorCode: "WORKTREE_BRANCH_IN_USE",
      detail: "目标分支已经被其他工作树占用，不能再次创建临时工作区"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "WORKTREE_CREATE_FAILED",
    detail: error.message
  });
}
