import { AppError } from "../../shared/errors/app-error.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type {
  GitBranchItem,
  GitBranchSnapshot,
  GitChangeItem,
  GitDiffResult,
  GitHistoryItem,
  GitHistoryPage,
  GitRepoSnapshot
} from "./types.js";
import type { WorkspaceRepoGuard } from "./workspace-repo-guard.js";

const MAX_DIFF_OUTPUT = 200_000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

export class GitReadService {
  constructor(
    private readonly gitCommandRunner: GitCommandRunner,
    private readonly workspaceRepoGuard: WorkspaceRepoGuard
  ) {}

  async getStatus(
    workspaceId: string
  ): Promise<{ snapshot: GitRepoSnapshot; changes: GitChangeItem[] }> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const statusResult = await this.gitCommandRunner.run(repo.repoRoot, [
      "status",
      "--porcelain=1",
      "--branch",
      "--untracked-files=all"
    ]);
    const remoteResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["remote", "get-url", "origin"],
      { allowNonZeroExit: true }
    );
    const lines = statusResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const header = lines.shift() ?? "## HEAD";
    const changes = lines.map((line) => parseStatusLine(line));
    const branchMeta = parseBranchHeader(header);

    return {
      snapshot: {
        workspaceId,
        repoRoot: repo.repoRoot,
        branch: branchMeta.branch,
        ahead: branchMeta.ahead,
        behind: branchMeta.behind,
        hasRemote: remoteResult.exitCode === 0 && remoteResult.stdout.trim().length > 0,
        isDirty: changes.length > 0,
        lastFetchedAt: null
      },
      changes
    };
  }

  async getDiff(workspaceId: string, targetPath: string, staged: boolean): Promise<GitDiffResult> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const relativePath = this.workspaceRepoGuard.ensureRelativePath(repo.repoRoot, targetPath);
    const diffArgs = staged
      ? ["diff", "--cached", "--", relativePath]
      : ["diff", "--", relativePath];
    const diffResult = await this.gitCommandRunner.run(repo.repoRoot, diffArgs);
    const numstatResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      staged
        ? ["diff", "--cached", "--numstat", "--", relativePath]
        : ["diff", "--numstat", "--", relativePath]
    );
    const binary = numstatResult.stdout
      .split(/\r?\n/)
      .some((line) => line.startsWith("-\t-\t"));
    const truncated = diffResult.stdout.length > MAX_DIFF_OUTPUT;

    return {
      workspaceId,
      path: relativePath,
      staged,
      binary,
      truncated,
      content: truncated ? diffResult.stdout.slice(0, MAX_DIFF_OUTPUT) : diffResult.stdout
    };
  }

  async getHistory(
    workspaceId: string,
    cursor: string | null,
    limit: number
  ): Promise<GitHistoryPage> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const safeLimit = clampHistoryLimit(limit);
    const offset = parseCursor(cursor);
    const logResult = await this.gitCommandRunner.run(repo.repoRoot, [
      "log",
      `--skip=${offset}`,
      "-n",
      String(safeLimit + 1),
      "--date=iso-strict",
      "--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e"
    ]);
    const parsedItems = logResult.stdout
      .split("\u001e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => parseHistoryItem(entry));
    const hasMore = parsedItems.length > safeLimit;
    const items = hasMore ? parsedItems.slice(0, safeLimit) : parsedItems;

    return {
      items,
      cursor: cursor ?? "0",
      nextCursor: hasMore ? String(offset + safeLimit) : null
    };
  }

  async getBranches(workspaceId: string): Promise<GitBranchSnapshot> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const [statusResult, localResult, remoteResult] = await Promise.all([
      this.gitCommandRunner.run(repo.repoRoot, ["status", "--porcelain=1", "--branch"]),
      this.gitCommandRunner.run(repo.repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)%x1f%(upstream:short)%x1f%(HEAD)",
        "refs/heads"
      ]),
      this.gitCommandRunner.run(repo.repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/remotes"
      ])
    ]);
    const currentBranch = parseBranchHeader(
      statusResult.stdout.split(/\r?\n/).find((line) => line.startsWith("##")) ?? "## HEAD"
    ).branch;
    const local = localResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseBranchLine(line, false));
    const remote = remoteResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        name: line,
        current: false,
        upstream: null,
        remote: true
      }));

    return {
      currentBranch,
      local,
      remote
    };
  }
}

function parseBranchHeader(headerLine: string): { branch: string; ahead: number; behind: number } {
  const header = headerLine.replace(/^##\s*/, "");
  const [branchPart, trackingPart = ""] = header.split(" [", 2);
  const branch = branchPart.split("...")[0] || "HEAD";
  const aheadMatch = trackingPart.match(/ahead (\d+)/);
  const behindMatch = trackingPart.match(/behind (\d+)/);

  return {
    branch,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0
  };
}

function parseStatusLine(line: string): GitChangeItem {
  const stagedStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  const payload = line.slice(3);
  const renameParts = payload.split(" -> ");
  const oldPath = renameParts.length === 2 ? renameParts[0] : null;
  const normalizedPath = renameParts.length === 2 ? renameParts[1] : payload;
  const combinedStatus = stagedStatus !== " " && stagedStatus !== "?" ? stagedStatus : worktreeStatus;

  return {
    path: normalizedPath,
    status: combinedStatus.trim() || "?",
    staged: stagedStatus !== " " && stagedStatus !== "?",
    oldPath,
    binary: false,
    stagedStatus: stagedStatus.trim() || null,
    worktreeStatus: worktreeStatus.trim() || null
  };
}

function parseHistoryItem(entry: string): GitHistoryItem {
  const [commitHash = "", authorName = "", authoredAt = "", subject = "", body = ""] =
    entry.split("\u001f");

  return {
    commitHash,
    authorName,
    authoredAt,
    subject,
    body
  };
}

function clampHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(Math.trunc(limit), MAX_HISTORY_LIMIT);
}

function parseCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  const value = Number(cursor);

  if (!Number.isInteger(value) || value < 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_CURSOR",
      detail: "历史分页游标无效",
      field: "cursor"
    });
  }

  return value;
}

function parseBranchLine(line: string, remote: boolean): GitBranchItem {
  const [name = "", upstream = "", currentMarker = ""] = line.split("\u001f");

  return {
    name,
    current: currentMarker.trim() === "*",
    upstream: upstream || null,
    remote
  };
}
