import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { Workspace, WorkspaceWorktreeRecord } from "../../types/domain.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { GitReadService } from "../git/git-read-service.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import type { WorktreeSyncService } from "./worktree-sync-service.js";

const WORKTREE_MERGE_TIMEOUT_MS = 60_000;

export type WorktreeMergeBlockerCode =
  | "SOURCE_NOT_ACTIVE"
  | "SOURCE_DIRTY"
  | "TARGET_DIRTY"
  | "HAS_ACTIVE_CHILDREN"
  | "NO_COMMITS_TO_MERGE"
  | "HAS_CONFLICTS";

export interface WorktreeMergeBlocker {
  code: WorktreeMergeBlockerCode;
  detail: string;
}

export interface WorktreeMergePreviewResult {
  workspaceId: string;
  sourceWorkspace: Workspace;
  targetWorkspace: Workspace;
  meta: WorkspaceWorktreeRecord;
  sourceBranchName: string;
  targetBranchName: string;
  sourceHeadCommit: string | null;
  targetHeadCommit: string | null;
  mergeBaseCommit: string | null;
  ahead: number;
  behind: number;
  hasConflicts: boolean;
  conflictPaths: string[];
  alreadyMerged: boolean;
  canMerge: boolean;
  blockers: WorktreeMergeBlocker[];
}

export interface WorktreeMergeApplyResult {
  preview: WorktreeMergePreviewResult;
  applied: boolean;
  mergeCommit: string | null;
  meta: WorkspaceWorktreeRecord;
}

export class WorktreeMergeService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceWorktreeRepository: WorkspaceWorktreeRepository,
    private readonly gitReadService: GitReadService,
    private readonly gitCommandRunner: GitCommandRunner,
    private readonly worktreeSyncService: WorktreeSyncService
  ) {}

  async preview(workspaceId: string): Promise<WorktreeMergePreviewResult> {
    const meta = await this.resolveActiveWorktreeMeta(workspaceId);
    const sourceWorkspace = this.workspaceService.getWorkspaceOrThrow(meta.workspaceId);
    const targetWorkspace = this.workspaceService.getWorkspaceOrThrow(meta.parentWorkspaceId);
    const [sourceStatus, targetStatus] = await Promise.all([
      this.gitReadService.getStatus(sourceWorkspace.id),
      this.gitReadService.getStatus(targetWorkspace.id)
    ]);
    const sourceHeadCommit = await this.resolveCommit(sourceWorkspace.path, sourceWorkspace.id, "HEAD");
    const targetHeadCommit = await this.resolveCommit(targetWorkspace.path, targetWorkspace.id, "HEAD");
    const mergeBaseCommit =
      sourceHeadCommit && targetHeadCommit
        ? await this.resolveMergeBase(targetWorkspace.path, targetWorkspace.id, targetHeadCommit, sourceHeadCommit)
        : null;
    const { ahead, behind } =
      sourceHeadCommit && targetHeadCommit
        ? await this.resolveAheadBehind(targetWorkspace.path, targetWorkspace.id, targetHeadCommit, sourceHeadCommit)
        : { ahead: 0, behind: 0 };
    const alreadyMerged =
      Boolean(sourceHeadCommit)
      && Boolean(targetHeadCommit)
      && await this.isAncestor(targetWorkspace.path, targetWorkspace.id, sourceHeadCommit ?? "", targetHeadCommit ?? "");
    const childRecords = this.workspaceWorktreeRepository
      .listByParentWorkspaceId(meta.workspaceId)
      .filter((record) => record.lifecycleStatus === "active" || record.lifecycleStatus === "removing");
    const blockers: WorktreeMergeBlocker[] = [];
    const normalizedMeta = this.normalizePreviewMeta(meta, alreadyMerged);

    if (!alreadyMerged && normalizedMeta.lifecycleStatus !== "active") {
      blockers.push({
        code: "SOURCE_NOT_ACTIVE",
        detail: "当前子工作树不是活跃状态，不能继续合并"
      });
    }

    if (sourceStatus.snapshot.isDirty) {
      blockers.push({
        code: "SOURCE_DIRTY",
        detail: "当前子工作树存在未提交改动，先提交或清理后再合并"
      });
    }

    if (targetStatus.snapshot.isDirty) {
      blockers.push({
        code: "TARGET_DIRTY",
        detail: "直接父工作区存在未提交改动，不能接收合并"
      });
    }

    if (childRecords.length > 0) {
      blockers.push({
        code: "HAS_ACTIVE_CHILDREN",
        detail: "当前子工作树下面还有活跃子节点，必须先从叶子节点开始回收"
      });
    }

    if (!alreadyMerged && ahead === 0) {
      blockers.push({
        code: "NO_COMMITS_TO_MERGE",
        detail: "当前子工作树没有领先父工作区的提交"
      });
    }

    const conflictPaths =
      !alreadyMerged
      && ahead > 0
      && blockers.every((item) => item.code !== "SOURCE_DIRTY" && item.code !== "TARGET_DIRTY")
        ? await this.detectConflictPaths(targetWorkspace.path, targetWorkspace.id, targetHeadCommit, sourceHeadCommit)
        : [];

    if (conflictPaths.length > 0) {
      blockers.push({
        code: "HAS_CONFLICTS",
        detail: `检测到合并冲突：${conflictPaths.join("、")}`
      });
    }

    return {
      workspaceId: meta.workspaceId,
      sourceWorkspace,
      targetWorkspace,
      meta: normalizedMeta,
      sourceBranchName: sourceStatus.snapshot.branch,
      targetBranchName: targetStatus.snapshot.branch,
      sourceHeadCommit,
      targetHeadCommit,
      mergeBaseCommit,
      ahead,
      behind,
      hasConflicts: conflictPaths.length > 0,
      conflictPaths,
      alreadyMerged,
      canMerge: blockers.length === 0 && !alreadyMerged,
      blockers
    };
  }

  async apply(workspaceId: string): Promise<WorktreeMergeApplyResult> {
    const preview = await this.preview(workspaceId);
    const meta = preview.meta;

    if (!preview.alreadyMerged && preview.blockers.length > 0) {
      const blocker = preview.blockers[0];
      throw new AppError({
        statusCode: 409,
        errorCode: `WORKTREE_MERGE_${blocker.code}`,
        detail: blocker.detail
      });
    }

    const targetWorkspace = preview.targetWorkspace;
    const timestamp = nowIso();
    let applied = false;

    if (!preview.alreadyMerged) {
      const mergeResult = await this.gitCommandRunner.run(
        targetWorkspace.path,
        ["merge", "--no-ff", "--no-edit", preview.meta.branchName],
        {
          allowNonZeroExit: true,
          timeoutMs: WORKTREE_MERGE_TIMEOUT_MS,
          workspaceId: targetWorkspace.id,
          operation: "worktree.merge.apply"
        }
      );

      if (mergeResult.exitCode !== 0) {
        await this.gitCommandRunner.run(
          targetWorkspace.path,
          ["merge", "--abort"],
          {
            allowNonZeroExit: true,
            workspaceId: targetWorkspace.id,
            operation: "worktree.merge.abort"
          }
        );
        throw new AppError({
          statusCode: 409,
          errorCode: "WORKTREE_MERGE_APPLY_FAILED",
          detail: mergeResult.stderr.trim() || mergeResult.stdout.trim() || "合并执行失败"
        });
      }

      applied = true;
    }

    const mergeCommit = await this.resolveCommit(targetWorkspace.path, targetWorkspace.id, "HEAD");
    const nextMeta = this.workspaceWorktreeRepository.update({
      ...meta,
      lifecycleStatus: "merged",
      mergedAt: meta.mergedAt ?? timestamp,
      updatedAt: timestamp
    });

    if (!nextMeta) {
      throw new AppError({
        statusCode: 500,
        errorCode: "WORKTREE_META_UPDATE_FAILED",
        detail: "工作树合并成功，但元数据更新失败"
      });
    }

    const parentMeta = this.workspaceWorktreeRepository.findByWorkspaceId(targetWorkspace.id);

    if (parentMeta) {
      this.workspaceWorktreeRepository.update({
        ...parentMeta,
        headCommit: mergeCommit,
        updatedAt: timestamp
      });
    }

    return {
      preview: {
        ...preview,
        meta: nextMeta,
        alreadyMerged: true,
        canMerge: false,
        blockers: [],
        targetHeadCommit: mergeCommit
      },
      applied,
      mergeCommit,
      meta: nextMeta
    };
  }

  private async resolveActiveWorktreeMeta(workspaceId: string): Promise<WorkspaceWorktreeRecord> {
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

  private normalizePreviewMeta(
    meta: WorkspaceWorktreeRecord,
    alreadyMerged: boolean
  ): WorkspaceWorktreeRecord {
    if (alreadyMerged) {
      if (meta.lifecycleStatus === "merged" && meta.mergedAt) {
        return meta;
      }

      return (
        this.workspaceWorktreeRepository.update({
          ...meta,
          lifecycleStatus: "merged",
          mergedAt: meta.mergedAt ?? nowIso(),
          updatedAt: nowIso()
        }) ?? meta
      );
    }

    if (meta.lifecycleStatus === "active") {
      return meta;
    }

    return (
      this.workspaceWorktreeRepository.update({
        ...meta,
        lifecycleStatus: "active",
        mergedAt: null,
        updatedAt: nowIso()
      }) ?? meta
    );
  }

  private async resolveCommit(
    cwd: string,
    workspaceId: string,
    ref: string
  ): Promise<string | null> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["rev-parse", "--verify", ref],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.merge.resolveCommit"
      }
    );

    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }

  private async resolveMergeBase(
    cwd: string,
    workspaceId: string,
    targetHeadCommit: string,
    sourceHeadCommit: string
  ): Promise<string | null> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["merge-base", targetHeadCommit, sourceHeadCommit],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.merge.previewBase"
      }
    );

    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }

  private async resolveAheadBehind(
    cwd: string,
    workspaceId: string,
    targetHeadCommit: string,
    sourceHeadCommit: string
  ): Promise<{ ahead: number; behind: number }> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["rev-list", "--left-right", "--count", `${targetHeadCommit}...${sourceHeadCommit}`],
      {
        workspaceId,
        operation: "worktree.merge.previewAheadBehind"
      }
    );
    const [behindRaw, aheadRaw] = result.stdout.trim().split(/\s+/);

    return {
      ahead: Number(aheadRaw ?? "0") || 0,
      behind: Number(behindRaw ?? "0") || 0
    };
  }

  private async isAncestor(
    cwd: string,
    workspaceId: string,
    ancestorCommit: string,
    descendantCommit: string
  ): Promise<boolean> {
    const result = await this.gitCommandRunner.run(
      cwd,
      ["merge-base", "--is-ancestor", ancestorCommit, descendantCommit],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.merge.previewAncestor"
      }
    );

    return result.exitCode === 0;
  }

  private async detectConflictPaths(
    cwd: string,
    workspaceId: string,
    targetHeadCommit: string | null,
    sourceHeadCommit: string | null
  ): Promise<string[]> {
    if (!targetHeadCommit || !sourceHeadCommit) {
      return [];
    }

    const result = await this.gitCommandRunner.run(
      cwd,
      ["merge-tree", "--write-tree", targetHeadCommit, sourceHeadCommit],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "worktree.merge.previewConflicts"
      }
    );

    if (result.exitCode === 0) {
      return [];
    }

    return Array.from(parseMergeConflictPaths(result.stdout, result.stderr));
  }
}

function parseMergeConflictPaths(stdout: string, stderr: string): Set<string> {
  const paths = new Set<string>();
  const content = `${stdout}\n${stderr}`;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const stageMatch = trimmed.match(/^\d{6}\s+[0-9a-f]{40}\s+\d\t(.+)$/i);

    if (stageMatch?.[1]) {
      paths.add(stageMatch[1]);
      continue;
    }

    const conflictMatch = trimmed.match(/Merge conflict in (.+)$/i);

    if (conflictMatch?.[1]) {
      paths.add(conflictMatch[1]);
    }
  }

  return paths;
}
