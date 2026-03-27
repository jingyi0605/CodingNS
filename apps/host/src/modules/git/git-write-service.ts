import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type {
  CommitDraft,
  GitBranchSnapshot,
  GitRemoteSyncResult,
  GitUndoCommitResult
} from "./types.js";
import type { GitReadService } from "./git-read-service.js";
import type { WorkspaceRepoGuard } from "./workspace-repo-guard.js";

export class GitWriteService {
  constructor(
    private readonly gitCommandRunner: GitCommandRunner,
    private readonly workspaceRepoGuard: WorkspaceRepoGuard,
    private readonly gitReadService: GitReadService
  ) {}

  async stage(workspaceId: string, targets: string[]) {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const relativeTargets = ensureTargets(repo.repoRoot, targets, this.workspaceRepoGuard);

    await this.gitCommandRunner.run(repo.repoRoot, ["add", "--", ...relativeTargets], {
      workspaceId,
      operation: "gitWrite.stage"
    });

    return await this.gitReadService.getStatus(workspaceId);
  }

  async unstage(workspaceId: string, targets: string[]) {
    const status = await this.gitReadService.getStatus(workspaceId);
    const relativeTargets = ensureTargets(status.snapshot.repoRoot, targets, this.workspaceRepoGuard);
    const stagedTargets = new Set(status.changes.filter((item) => item.staged).map((item) => item.path));

    for (const target of relativeTargets) {
      if (!stagedTargets.has(target)) {
        throw new AppError({
          statusCode: 409,
          errorCode: "NOT_STAGED",
          detail: `Target is not staged: ${target}`,
          field: "targets"
        });
      }
    }

    await this.gitCommandRunner.run(
      status.snapshot.repoRoot,
      ["reset", "HEAD", "--", ...relativeTargets],
      {
        workspaceId,
        operation: "gitWrite.unstage"
      }
    );

    return await this.gitReadService.getStatus(workspaceId);
  }

  async discard(workspaceId: string, targets: string[]) {
    const status = await this.gitReadService.getStatus(workspaceId);
    const repoRoot = status.snapshot.repoRoot;
    const relativeTargets = ensureTargets(repoRoot, targets, this.workspaceRepoGuard);
    const changeMap = new Map(status.changes.map((item) => [item.path, item] as const));
    const trackedTargets: string[] = [];
    const untrackedTargets: string[] = [];

    for (const target of relativeTargets) {
      const change = changeMap.get(target);

      if (!change) {
        throw new AppError({
          statusCode: 404,
          errorCode: "INVALID_TARGET",
          detail: `Git target is not present in change list: ${target}`,
          field: "targets"
        });
      }

      if (change.status === "?" && !change.staged) {
        untrackedTargets.push(target);
        continue;
      }

      if (change.worktreeStatus) {
        trackedTargets.push(target);
      }
    }

    try {
      if (trackedTargets.length > 0) {
        await this.gitCommandRunner.run(repoRoot, ["restore", "--worktree", "--", ...trackedTargets], {
          workspaceId,
          operation: "gitWrite.discard"
        });
      }

      if (untrackedTargets.length > 0) {
        await this.gitCommandRunner.run(repoRoot, ["clean", "-fd", "--", ...untrackedTargets], {
          workspaceId,
          operation: "gitWrite.discard"
        });
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError({
          statusCode: 500,
          errorCode: "GIT_DISCARD_FAILED",
          detail: error.message
        });
      }

      throw error;
    }

    return await this.gitReadService.getStatus(workspaceId);
  }

  async commit(workspaceId: string, draft: CommitDraft): Promise<{ commitHash: string }> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const stagedNames = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["diff", "--cached", "--name-only"],
      {
        workspaceId,
        operation: "gitWrite.commit"
      }
    );

    if (!stagedNames.stdout.trim()) {
      throw new AppError({
        statusCode: 409,
        errorCode: "EMPTY_STAGED_CHANGES",
        detail: "No staged changes available for commit"
      });
    }

    const messagePath = path.join(os.tmpdir(), `codingns-commit-${process.pid}-${Date.now()}.txt`);

    fs.writeFileSync(messagePath, formatCommitMessage(draft), "utf8");

    try {
      await this.gitCommandRunner.run(repo.repoRoot, ["commit", "--file", messagePath], {
        timeoutMs: 30_000,
        workspaceId,
        operation: "gitWrite.commit"
      });
      const hashResult = await this.gitCommandRunner.run(repo.repoRoot, ["rev-parse", "HEAD"], {
        workspaceId,
        operation: "gitWrite.commit"
      });

      return {
        commitHash: hashResult.stdout.trim()
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError({
          statusCode: 500,
          errorCode: "GIT_COMMIT_FAILED",
          detail: error.message
        });
      }

      throw error;
    } finally {
      fs.rmSync(messagePath, { force: true });
    }
  }

  async switchBranch(
    workspaceId: string,
    branchName: string,
    create: boolean
  ): Promise<GitBranchSnapshot> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const trimmedBranchName = branchName.trim();

    if (!trimmedBranchName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "Branch name is required",
        field: "branchName"
      });
    }

    const result = await this.gitCommandRunner.run(
      repo.repoRoot,
      create ? ["switch", "-c", trimmedBranchName] : ["switch", trimmedBranchName],
      {
        allowNonZeroExit: true,
        timeoutMs: 30_000,
        workspaceId,
        operation: "gitWrite.switchBranch"
      }
    );

    if (result.exitCode !== 0) {
      throw mapBranchSwitchError(result.stderr || result.stdout);
    }

    return await this.gitReadService.getBranches(workspaceId);
  }

  async syncRemote(
    workspaceId: string,
    action: GitRemoteSyncResult["action"]
  ): Promise<GitRemoteSyncResult> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const currentBranch = (await this.gitReadService.getStatus(workspaceId)).snapshot.branch;
    const remoteUrl = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["remote", "get-url", "origin"],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "gitWrite.syncRemote"
      }
    );

    if (remoteUrl.exitCode !== 0 || !remoteUrl.stdout.trim()) {
      throw new AppError({
        statusCode: 404,
        errorCode: "REMOTE_NOT_FOUND",
        detail: "Origin remote is not configured"
      });
    }

    const args =
      action === "fetch"
        ? ["fetch", "origin"]
        : action === "pull"
          ? ["pull", "--ff-only", "origin", currentBranch]
          : action === "push"
            ? ["push", "origin", currentBranch]
            : ["push", "--set-upstream", "origin", currentBranch];
    const result = await this.gitCommandRunner.run(repo.repoRoot, args, {
      allowNonZeroExit: true,
      timeoutMs: 60_000,
      workspaceId,
      operation: "gitWrite.syncRemote"
    });

    if (result.exitCode !== 0) {
      throw mapRemoteError(action, result.stderr || result.stdout);
    }

    return {
      action,
      summary: buildRemoteSummary(action, currentBranch),
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  }

  async undoLastCommit(workspaceId: string): Promise<GitUndoCommitResult> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const headResult = await this.gitCommandRunner.run(repo.repoRoot, ["rev-parse", "HEAD"], {
      allowNonZeroExit: true,
      workspaceId,
      operation: "gitWrite.undoLastCommit"
    });

    if (headResult.exitCode !== 0 || !headResult.stdout.trim()) {
      throw new AppError({
        statusCode: 409,
        errorCode: "GIT_UNDO_FAILED",
        detail: "No commit available to undo"
      });
    }

    const commitHash = headResult.stdout.trim();
    const commitSubjectResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["show", "-s", "--format=%s", "HEAD"],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "gitWrite.undoLastCommit"
      }
    );
    const commitSubject =
      commitSubjectResult.exitCode === 0 ? commitSubjectResult.stdout.trim() : "";
    const resetResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["reset", "--soft", "HEAD~1"],
      {
        allowNonZeroExit: true,
        timeoutMs: 30_000,
        workspaceId,
        operation: "gitWrite.undoLastCommit"
      }
    );

    if (resetResult.exitCode !== 0) {
      throw new AppError({
        statusCode: 500,
        errorCode: "GIT_UNDO_FAILED",
        detail: resetResult.stderr.trim() || resetResult.stdout.trim() || "Undo last commit failed"
      });
    }

    return {
      summary: "已撤销上次提交，改动保留在暂存区",
      commitHash,
      commitSubject
    };
  }
}

function ensureTargets(
  repoRoot: string,
  targets: string[],
  guard: WorkspaceRepoGuard
): string[] {
  const normalizedTargets = targets
    .map((target) => target.trim())
    .filter(Boolean)
    .map((target) => guard.ensureRelativePath(repoRoot, target));

  if (normalizedTargets.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_TARGET",
      detail: "At least one Git target is required",
      field: "targets"
    });
  }

  return normalizedTargets;
}

function formatCommitMessage(draft: CommitDraft): string {
  return [draft.subject.trim(), draft.body?.trim() || "", draft.footer?.trim() || ""]
    .filter((item, index) => item.length > 0 || index === 0)
    .join("\n\n");
}

function mapBranchSwitchError(detail: string): AppError {
  if (/not a valid object name|invalid reference/i.test(detail)) {
    return new AppError({
      statusCode: 404,
      errorCode: "BRANCH_NOT_FOUND",
      detail: "Target branch not found"
    });
  }

  if (/would be overwritten|local changes/i.test(detail)) {
    return new AppError({
      statusCode: 409,
      errorCode: "BRANCH_CONFLICT",
      detail: "Local changes conflict with branch switch"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "GIT_BRANCH_FAILED",
    detail: detail.trim() || "Branch switch failed"
  });
}

function mapRemoteError(action: GitRemoteSyncResult["action"], detail: string): AppError {
  if (/authentication failed|could not read from remote repository|permission denied/i.test(detail)) {
    return new AppError({
      statusCode: 401,
      errorCode: "GIT_REMOTE_AUTH_FAILED",
      detail: "Remote authentication failed"
    });
  }

  if (/couldn't find remote ref|No such remote/i.test(detail)) {
    return new AppError({
      statusCode: 404,
      errorCode: "REMOTE_NOT_FOUND",
      detail: "Remote repository or branch not found"
    });
  }

  if (/non-fast-forward|fetch first|not possible to fast-forward/i.test(detail)) {
    return new AppError({
      statusCode: 409,
      errorCode: "BRANCH_CONFLICT",
      detail: "Remote sync failed because of non-fast-forward conflict"
    });
  }

  if (/unable to access|failed to connect|connection timed out|operation timed out|could not resolve host|network is unreachable|connection reset/i.test(detail)) {
    return new AppError({
      statusCode: 502,
      errorCode: "GIT_REMOTE_FAILED",
      detail: "Remote network request failed"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode:
      action === "pull"
        ? "GIT_PULL_FAILED"
        : action === "push"
          ? "GIT_PUSH_FAILED"
          : "GIT_REMOTE_FAILED",
    detail: detail.trim() || "Remote sync failed"
  });
}

function buildRemoteSummary(action: GitRemoteSyncResult["action"], branch: string): string {
  if (action === "fetch") {
    return "已完成远程抓取";
  }

  if (action === "pull") {
    return `已从 origin/${branch} 拉取最新内容`;
  }

  if (action === "push") {
    return `已将 ${branch} 推送到 origin`;
  }

  return `已将 ${branch} 发布到 origin 并建立跟踪关系`;
}
