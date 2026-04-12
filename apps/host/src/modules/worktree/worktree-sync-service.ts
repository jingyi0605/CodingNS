import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceWorktreeRecord } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";

export interface WorktreeSyncIssue {
  type: "workspace_missing";
  workspaceId: string;
  branchName: string;
}

export interface WorktreeSyncResult {
  rootWorkspaceId: string;
  updatedWorkspaceIds: string[];
  removedWorkspaceIds: string[];
  issues: WorktreeSyncIssue[];
}

interface ParsedWorktreeEntry {
  path: string;
  headCommit: string | null;
  branchRef: string | null;
  prunable: boolean;
}

export class WorktreeSyncService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceWorktreeRepository: WorkspaceWorktreeRepository,
    private readonly gitCommandRunner: GitCommandRunner
  ) {}

  async syncRoot(rootWorkspaceId: string): Promise<WorktreeSyncResult> {
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
    const rootWorkspace = this.workspaceService.getWorkspaceOrThrow(resolvedRootWorkspaceId);
    const listResult = await this.gitCommandRunner.run(
      rootWorkspace.path,
      ["worktree", "list", "--porcelain"],
      {
        workspaceId: resolvedRootWorkspaceId,
        operation: "worktree.sync.list"
      }
    );
    const actualEntryByPath = new Map(
      parseWorktreeList(listResult.stdout)
        .map((entry) => [normalizeWorktreePath(entry.path), entry] as const)
    );
    const syncResult: WorktreeSyncResult = {
      rootWorkspaceId: resolvedRootWorkspaceId,
      updatedWorkspaceIds: [],
      removedWorkspaceIds: [],
      issues: []
    };
    const candidateRecords = this.workspaceWorktreeRepository
      .listByRootWorkspaceId(resolvedRootWorkspaceId)
      .filter((record) => record.lifecycleStatus === "active" || record.lifecycleStatus === "removing");
    let shouldPrune = false;

    for (const record of candidateRecords) {
      let workspacePath: string;

      try {
        workspacePath = this.workspaceService.getWorkspaceOrThrow(record.workspaceId).path;
      } catch {
        syncResult.issues.push({
          type: "workspace_missing",
          workspaceId: record.workspaceId,
          branchName: record.branchName
        });
        continue;
      }

      const entry = actualEntryByPath.get(normalizeWorktreePath(workspacePath));

      if (!entry || entry.prunable || !fs.existsSync(workspacePath)) {
        shouldPrune = shouldPrune || Boolean(entry?.prunable);
        this.markWorktreeRemoved(record);
        syncResult.removedWorkspaceIds.push(record.workspaceId);
        continue;
      }

      const updated = this.updateHeadSnapshot(record, entry);

      if (updated) {
        syncResult.updatedWorkspaceIds.push(record.workspaceId);
      }
    }

    if (shouldPrune) {
      await this.gitCommandRunner.run(rootWorkspace.path, ["worktree", "prune"], {
        allowNonZeroExit: true,
        workspaceId: resolvedRootWorkspaceId,
        operation: "worktree.sync.prune"
      });
    }

    return syncResult;
  }

  private markWorktreeRemoved(record: WorkspaceWorktreeRecord): void {
    const timestamp = nowIso();

    this.workspaceWorktreeRepository.update({
      ...record,
      lifecycleStatus: "removed",
      removedAt: record.removedAt ?? timestamp,
      updatedAt: timestamp
    });

    try {
      this.workspaceService.removeWorkspace(record.workspaceId);
    } catch {
      // 工作区记录不存在时，只保留元数据修复结果。
    }
  }

  private updateHeadSnapshot(record: WorkspaceWorktreeRecord, entry: ParsedWorktreeEntry): boolean {
    const nextBranchName = entry.branchRef ? stripBranchRef(entry.branchRef) : record.branchName;
    const nextHeadCommit = entry.headCommit ?? record.headCommit;

    if (nextBranchName === record.branchName && nextHeadCommit === record.headCommit) {
      return false;
    }

    this.workspaceWorktreeRepository.update({
      ...record,
      branchName: nextBranchName,
      headCommit: nextHeadCommit,
      updatedAt: nowIso()
    });

    return true;
  }
}

function parseWorktreeList(input: string): ParsedWorktreeEntry[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const entries: ParsedWorktreeEntry[] = [];
  let current: ParsedWorktreeEntry | null = null;

  for (const line of lines) {
    if (!line) {
      if (current) {
        entries.push(current);
      }

      current = null;
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }

      current = {
        path: line.slice("worktree ".length).trim(),
        headCommit: null,
        branchRef: null,
        prunable: false
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("HEAD ")) {
      current.headCommit = line.slice("HEAD ".length).trim() || null;
      continue;
    }

    if (line.startsWith("branch ")) {
      current.branchRef = line.slice("branch ".length).trim() || null;
      continue;
    }

    if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function stripBranchRef(branchRef: string): string {
  return branchRef.startsWith("refs/heads/")
    ? branchRef.slice("refs/heads/".length)
    : branchRef;
}

function normalizeWorktreePath(input: string): string {
  const resolved = path.resolve(input);
  const realPath = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;

  if (process.platform === "win32") {
    return realPath.toLowerCase();
  }

  return realPath;
}
