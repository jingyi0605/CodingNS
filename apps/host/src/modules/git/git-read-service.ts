import { AppError } from "../../shared/errors/app-error.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type {
  GitBranchItem,
  GitBranchSnapshot,
  GitChangeItem,
  GitDiffResult,
  GitHistoryItem,
  GitHistoryRef,
  GitHistoryPage,
  GitRepoSnapshot
} from "./types.js";
import type { WorkspaceRepoGuard } from "./workspace-repo-guard.js";

const MAX_DIFF_OUTPUT = 200_000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

interface ParsedGitRef {
  fullName: string;
  shortName: string;
  commitHash: string;
  kind: "local" | "remote";
  upstream: string | null;
  current: boolean;
  remoteName: string | null;
}

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
    ], {
      workspaceId,
      operation: "gitRead.getStatus"
    });
    const remoteResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["remote", "get-url", "origin"],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "gitRead.getStatus"
      }
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
    const diffResult = await this.gitCommandRunner.run(repo.repoRoot, diffArgs, {
      workspaceId,
      operation: "gitRead.getDiff"
    });
    const numstatResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      staged
        ? ["diff", "--cached", "--numstat", "--", relativePath]
        : ["diff", "--numstat", "--", relativePath],
      {
        workspaceId,
        operation: "gitRead.getDiff"
      }
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
    const refsResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      [
        "for-each-ref",
        "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(HEAD)",
        "refs/heads",
        "refs/remotes"
      ],
      {
        workspaceId,
        operation: "gitRead.getHistory"
      }
    );
    const parsedRefs = refsResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => parseGitRefLine(line));
    const refByShortName = new Map(parsedRefs.map((ref) => [ref.shortName, ref] as const));
    const currentRef = parsedRefs.find((ref) => ref.kind === "local" && ref.current) ?? null;
    const [logResult, countResult, divergenceResult] = await Promise.all([
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "log",
          "--all",
          "--topo-order",
          `--skip=${offset}`,
          "-n",
          String(safeLimit + 1),
          "--date=iso-strict",
          "--decorate=short",
          "--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1f%D%x1e"
        ],
        {
          workspaceId,
          operation: "gitRead.getHistory"
        }
      ),
      this.gitCommandRunner.run(repo.repoRoot, ["rev-list", "--count", "--all"], {
        allowNonZeroExit: true,
        workspaceId,
        operation: "gitRead.getHistory"
      }),
      currentRef?.upstream
        ? this.gitCommandRunner.run(
            repo.repoRoot,
            ["rev-list", "--left-right", `${currentRef.shortName}...${currentRef.upstream}`],
            {
              allowNonZeroExit: true,
              workspaceId,
              operation: "gitRead.getHistory"
            }
          )
        : Promise.resolve({
            stdout: "",
            stderr: "",
            exitCode: 0
          })
    ]);
    const divergenceSets = parseHistoryDivergence(divergenceResult.stdout);
    const parsedItems = logResult.stdout
      .split("\u001e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => parseHistoryItem(entry, refByShortName, divergenceSets));
    const hasMore = parsedItems.length > safeLimit;
    const items = hasMore ? parsedItems.slice(0, safeLimit) : parsedItems;
    const totalCount = parseHistoryCount(countResult.stdout);

    return {
      items,
      cursor: cursor ?? "0",
      nextCursor: hasMore ? String(offset + safeLimit) : null,
      totalCount
    };
  }

  async getBranches(workspaceId: string): Promise<GitBranchSnapshot> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const [statusResult, localResult, remoteResult] = await Promise.all([
      this.gitCommandRunner.run(repo.repoRoot, ["status", "--porcelain=1", "--branch"], {
        workspaceId,
        operation: "gitRead.getBranches"
      }),
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "for-each-ref",
          "--format=%(refname:short)%x1f%(upstream:short)%x1f%(HEAD)",
          "refs/heads"
        ],
        {
          workspaceId,
          operation: "gitRead.getBranches"
        }
      ),
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/remotes"
        ],
        {
          workspaceId,
          operation: "gitRead.getBranches"
        }
      )
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

function parseHistoryItem(
  entry: string,
  refByShortName: ReadonlyMap<string, ParsedGitRef>,
  divergenceSets: { local: ReadonlySet<string>; remote: ReadonlySet<string> }
): GitHistoryItem {
  const [commitHash = "", authorName = "", authoredAt = "", subject = "", body = "", decoration = ""] =
    entry.split("\u001f");
  const refs = parseHistoryRefs(decoration, refByShortName);

  return {
    commitHash,
    authorName,
    authoredAt,
    subject,
    body,
    commitKind: resolveHistoryCommitKind(commitHash, refs, divergenceSets),
    refs
  };
}

function parseGitRefLine(line: string): ParsedGitRef {
  const [fullName = "", shortName = "", commitHash = "", upstream = "", currentMarker = ""] =
    line.split("\u0000");
  const remoteName =
    fullName.startsWith("refs/remotes/") && shortName.includes("/")
      ? shortName.split("/")[0] || null
      : null;

  return {
    fullName,
    shortName,
    commitHash,
    kind: fullName.startsWith("refs/remotes/") ? "remote" : "local",
    upstream: upstream || null,
    current: currentMarker.trim() === "*",
    remoteName
  };
}

function parseHistoryRefs(
  decoration: string,
  refByShortName: ReadonlyMap<string, ParsedGitRef>
): GitHistoryRef[] {
  if (!decoration.trim()) {
    return [];
  }

  const refs: GitHistoryRef[] = [];
  const seen = new Set<string>();

  for (const rawToken of decoration.split(",")) {
    const token = rawToken.trim();

    if (!token || token.startsWith("tag: ")) {
      continue;
    }

    if (token.startsWith("HEAD -> ")) {
      const branchName = token.slice("HEAD -> ".length).trim();
      const key = `head:${branchName}`;

      if (!branchName || seen.has(key)) {
        continue;
      }

      refs.push({
        name: branchName,
        kind: "head",
        remoteName: null
      });
      seen.add(key);
      continue;
    }

    const parsedRef = refByShortName.get(token);

    if (!parsedRef || parsedRef.shortName.endsWith("/HEAD")) {
      continue;
    }

    const kind = parsedRef.kind;
    const key = `${kind}:${parsedRef.shortName}`;

    if (seen.has(key) || (kind === "local" && seen.has(`head:${parsedRef.shortName}`))) {
      continue;
    }

    refs.push({
      name: parsedRef.shortName,
      kind,
      remoteName: parsedRef.remoteName
    });
    seen.add(key);
  }

  return refs;
}

function parseHistoryDivergence(stdout: string): { local: ReadonlySet<string>; remote: ReadonlySet<string> } {
  const local = new Set<string>();
  const remote = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const entry = line.trim();

    if (!entry) {
      continue;
    }

    const side = entry[0];
    const hash = entry.slice(1).trim();

    if (!hash) {
      continue;
    }

    if (side === "<") {
      local.add(hash);
      continue;
    }

    if (side === ">") {
      remote.add(hash);
    }
  }

  return {
    local,
    remote
  };
}

function resolveHistoryCommitKind(
  commitHash: string,
  refs: GitHistoryRef[],
  divergenceSets: { local: ReadonlySet<string>; remote: ReadonlySet<string> }
): GitHistoryItem["commitKind"] {
  if (divergenceSets.local.has(commitHash)) {
    return "local";
  }

  if (divergenceSets.remote.has(commitHash)) {
    return "remote";
  }

  const hasLocalRef = refs.some((ref) => ref.kind === "head" || ref.kind === "local");
  const hasRemoteRef = refs.some((ref) => ref.kind === "remote");

  if (hasLocalRef && hasRemoteRef) {
    return "shared";
  }

  if (hasLocalRef) {
    return "local";
  }

  if (hasRemoteRef) {
    return "remote";
  }

  return "shared";
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

function parseHistoryCount(stdout: string): number {
  const value = Number(stdout.trim());

  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
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
