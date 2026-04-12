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

export interface WorktreeCleanupResult {
  workspaceId: string;
  removed: boolean;
  meta: WorkspaceWorktreeRecord;
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

  async cleanup(workspaceId: string, userId: string): Promise<WorktreeCleanupResult> {
    const meta = await this.resolveCleanupCandidate(workspaceId);
    const workspace = this.workspaceService.getWorkspaceOrThrow(meta.workspaceId);
    const rootWorkspace = this.workspaceService.getWorkspaceOrThrow(meta.rootWorkspaceId);
    const activeChildren = this.workspaceWorktreeRepository
      .listByParentWorkspaceId(meta.workspaceId)
      .filter((record) => record.lifecycleStatus !== "removed");

    if (activeChildren.length > 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKTREE_CLEANUP_HAS_CHILDREN",
        detail: "当前工作树下面还有子节点，必须先从叶子节点开始清理"
      });
    }

    const status = await this.gitReadService.getStatus(workspace.id);

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
      const removeResult = await this.gitCommandRunner.run(
        rootWorkspace.path,
        ["worktree", "remove", workspace.path],
        {
          allowNonZeroExit: true,
          timeoutMs: WORKTREE_CLEANUP_TIMEOUT_MS,
          workspaceId: rootWorkspace.id,
          operation: "worktree.cleanup.remove"
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
          operation: "worktree.cleanup.prune"
        }
      );

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
        meta: removedMeta
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

  private async resolveCleanupCandidate(workspaceId: string): Promise<WorkspaceWorktreeRecord> {
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

    await this.worktreeSyncService.syncRoot(meta.rootWorkspaceId);

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
