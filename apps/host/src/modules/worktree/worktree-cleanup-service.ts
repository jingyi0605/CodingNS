import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceWorktreeRecord } from "../../types/domain.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { TerminalInstanceRepository } from "../../storage/repositories/terminal-instance-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { GitReadService } from "../git/git-read-service.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import type { WorktreeSyncService } from "./worktree-sync-service.js";

const WORKTREE_CLEANUP_TIMEOUT_MS = 30_000;

export interface WorktreeCleanupOptions {
  deleteBranch?: boolean;
}

export interface WorktreeCleanupResult {
  workspaceId: string;
  removed: boolean;
  meta: WorkspaceWorktreeRecord;
  branchDeleteRequested: boolean;
  branchDeleted: boolean;
  deletedBranchName: string | null;
  branchDeleteError: string | null;
}

export class WorktreeCleanupService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceWorktreeRepository: WorkspaceWorktreeRepository,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly terminalInstanceRepository: TerminalInstanceRepository,
    private readonly gitReadService: GitReadService,
    private readonly gitCommandRunner: GitCommandRunner,
    private readonly worktreeSyncService: WorktreeSyncService
  ) {}

  async cleanup(
    workspaceId: string,
    userId: string,
    options: WorktreeCleanupOptions = {},
    signal?: AbortSignal
  ): Promise<WorktreeCleanupResult> {
    const meta = await this.resolveCleanupCandidate(workspaceId, signal);
    const workspace = this.workspaceService.getWorkspaceOrThrow(meta.workspaceId);
    const rootWorkspace = this.workspaceService.getWorkspaceOrThrow(meta.rootWorkspaceId);
    const targetWorkspace = this.workspaceService.getWorkspaceOrThrow(meta.parentWorkspaceId);
    const activeChildren = this.workspaceWorktreeRepository
      .listByParentWorkspaceId(meta.workspaceId)
      .filter((record) => record.lifecycleStatus !== "removed");
    const deleteBranchRequestedByUser = options.deleteBranch === true;
    const shouldAutoDeleteParallelBranch =
      isParallelTemporaryBranch(meta.branchName) && meta.lifecycleStatus === "merged";

    if (activeChildren.length > 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_CLEANUP_HAS_CHILDREN",
        detail: "当前工作树下面还有子节点，必须先从叶子节点开始清理"
      });
    }

    const status = await this.gitReadService.getStatus(workspace.id, signal);

    if (status.snapshot.isDirty) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_CLEANUP_DIRTY",
        detail: "当前工作树还有未提交改动，不能直接清理"
      });
    }

    const runningSessions = this.sessionIndexRepository
      .listByWorkspace(workspace.id, userId)
      .filter((session) => session.runningState === "starting" || session.runningState === "running");

    if (runningSessions.length > 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_CLEANUP_BUSY_SESSION",
        detail: "当前工作树还有运行中的会话，先停掉再清理"
      });
    }

    const runningTerminals = this.terminalInstanceRepository
      .listByWorkspace(workspace.id)
      .filter((terminal) => terminal.status === "creating" || terminal.status === "running");

    if (runningTerminals.length > 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_CLEANUP_BUSY_TERMINAL",
        detail: "当前工作树还有活跃终端，先关闭再清理"
      });
    }

    const branchMergedIntoParent = (deleteBranchRequestedByUser || shouldAutoDeleteParallelBranch)
      ? await this.isBranchMergedIntoParent(workspace, targetWorkspace, signal)
      : false;
    const deleteBranchRequested =
      deleteBranchRequestedByUser
      || (shouldAutoDeleteParallelBranch && branchMergedIntoParent);

    if (deleteBranchRequestedByUser && !branchMergedIntoParent) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_CLEANUP_BRANCH_NOT_MERGED",
        detail: "当前分支还没有合入父工作区，不能在清理时同时删除分支"
      });
    }

    const timestamp = nowIso();
    const removingMeta = this.workspaceWorktreeRepository.update({
      ...meta,
      lifecycleStatus: "removing",
      updatedAt: timestamp
    });

    if (!removingMeta) {
      throw new AppError({
        statusCode: 500,
        errorCode: "WORKTREE_META_UPDATE_FAILED",
        detail: "工作树清理前无法写入 removing 状态"
      });
    }

    try {
      let branchDeleted = false;
      let branchDeleteError: string | null = null;

      const removeResult = await this.gitCommandRunner.run(
        rootWorkspace.path,
        ["worktree", "remove", workspace.path],
        {
          allowNonZeroExit: true,
          timeoutMs: WORKTREE_CLEANUP_TIMEOUT_MS,
          workspaceId: rootWorkspace.id,
          operation: "worktree.cleanup.remove",
          signal
        }
      );

      if (removeResult.exitCode !== 0) {
        throw new AppError({
          statusCode: 409,
          errorCode: "WORKTREE_CLEANUP_REMOVE_FAILED",
          detail: removeResult.stderr.trim() || removeResult.stdout.trim() || "工作树清理失败"
        });
      }

      await this.gitCommandRunner.run(
        rootWorkspace.path,
        ["worktree", "prune"],
        {
          allowNonZeroExit: true,
          workspaceId: rootWorkspace.id,
          operation: "worktree.cleanup.prune",
          signal
        }
      );

      if (deleteBranchRequested) {
        const deleteBranchResult = await this.gitCommandRunner.run(
          rootWorkspace.path,
          ["branch", "-d", meta.branchName],
          {
            allowNonZeroExit: true,
            workspaceId: rootWorkspace.id,
            operation: "worktree.cleanup.deleteBranch",
            signal
          }
        );

        if (deleteBranchResult.exitCode === 0) {
          branchDeleted = true;
        } else {
          branchDeleteError =
            deleteBranchResult.stderr.trim() || deleteBranchResult.stdout.trim() || "分支删除失败";
        }
      }

      const removedMeta = this.workspaceWorktreeRepository.update({
        ...removingMeta,
        lifecycleStatus: "removed",
        removedAt: timestamp,
        updatedAt: timestamp
      });

      if (!removedMeta) {
        throw new AppError({
          statusCode: 500,
          errorCode: "WORKTREE_META_UPDATE_FAILED",
          detail: "工作树目录已经删除，但 removed 状态写入失败"
        });
      }

      this.workspaceService.removeWorkspace(workspace.id);

      return {
        workspaceId: workspace.id,
        removed: true,
        meta: removedMeta,
        branchDeleteRequested: deleteBranchRequested,
        branchDeleted,
        deletedBranchName: branchDeleted ? meta.branchName : null,
        branchDeleteError
      };
    } catch (error) {
      this.workspaceWorktreeRepository.update({
        ...meta,
        lifecycleStatus: meta.lifecycleStatus,
        updatedAt: nowIso()
      });
      throw error;
    }
  }

  private async isBranchMergedIntoParent(
    sourceWorkspace: { id: string; path: string },
    targetWorkspace: { id: string; path: string },
    signal?: AbortSignal
  ): Promise<boolean> {
    const sourceHeadCommit = await this.resolveCommit(sourceWorkspace.path, sourceWorkspace.id, "HEAD", signal);
    const targetHeadCommit = await this.resolveCommit(targetWorkspace.path, targetWorkspace.id, "HEAD", signal);

    if (!sourceHeadCommit || !targetHeadCommit) {
      return false;
    }

    return this.isAncestor(
      targetWorkspace.path,
      targetWorkspace.id,
      sourceHeadCommit,
      targetHeadCommit,
      signal
    );
  }

  private async resolveCommit(
    cwd: string,
    workspaceId: string,
    ref: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["rev-parse", "--verify", ref],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.cleanup.resolveCommit",
        signal
      }
    );

    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }

  private async isAncestor(
    cwd: string,
    workspaceId: string,
    ancestorCommit: string,
    descendantCommit: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["merge-base", "--is-ancestor", ancestorCommit, descendantCommit],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.cleanup.previewAncestor",
        signal
      }
    );

    return result.exitCode === 0;
  }

  private async resolveCleanupCandidate(
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<WorkspaceWorktreeRecord> {
    const normalizedWorkspaceId = workspaceId.trim();

    if (!normalizedWorkspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "工作树 workspaceId 不能为空",
        field: "workspaceId"
      });
    }

    const meta = this.workspaceWorktreeRepository.findByWorkspaceId(normalizedWorkspaceId);

    if (!meta) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKTREE_NOT_FOUND",
        detail: "指定工作区不是子工作树"
      });
    }

    await this.worktreeSyncService.syncRoot(meta.rootWorkspaceId, signal);

    const nextMeta = this.workspaceWorktreeRepository.findByWorkspaceId(normalizedWorkspaceId);

    if (!nextMeta || nextMeta.lifecycleStatus === "removed") {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKTREE_NOT_FOUND",
        detail: "指定工作树已经不存在"
      });
    }

    return nextMeta;
  }
}

function isParallelTemporaryBranch(branchName: string): boolean {
  return branchName.trim().startsWith("parallel/");
}
