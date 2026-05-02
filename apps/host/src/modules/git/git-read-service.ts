import { AppError } from "../../shared/errors/app-error.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type {
  GitBranchItem,
  GitBranchSnapshot,
  GitChangeItem,
  GitCommitChangedFile,
  GitCommitDetail,
  GitDiffResult,
  GitHistoryItem,
  GitHistoryRef,
  GitHistoryPage,
  GitRemoteItem,
  GitRepoSnapshot,
  GitTagItem
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
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<{ snapshot: GitRepoSnapshot; changes: GitChangeItem[] }> {
    let repo;

    try {
      repo = await this.workspaceRepoGuard.resolve(workspaceId);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === "NOT_GIT_REPOSITORY") {
        const workspace = this.workspaceRepoGuard.resolveConfiguredRoot(workspaceId);

        return {
          snapshot: {
            workspaceId,
            repoRoot: workspace.repoRoot,
            enabled: false,
            branch: "",
            ahead: 0,
            behind: 0,
            hasRemote: false,
            isDirty: false,
            lastFetchedAt: null
          },
          changes: []
        };
      }

      throw error;
    }

    const statusResult = await this.gitCommandRunner.run(repo.repoRoot, [
      "status",
      "--porcelain=1",
      "--branch",
      "--untracked-files=all"
    ], {
      workspaceId,
      operation: "gitRead.getStatus",
      signal
    });
    const remoteResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["remote", "get-url", "origin"],
      {
        allowNonZeroExit: true,
        workspaceId,
        operation: "gitRead.getStatus",
        signal
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
        enabled: true,
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

  async getDiff(
    workspaceId: string,
    targetPath: string,
    staged: boolean,
    signal?: AbortSignal
  ): Promise<GitDiffResult> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const relativePath = this.workspaceRepoGuard.ensureRelativePath(repo.repoRoot, targetPath);
    const diffArgs = staged
      ? ["diff", "--cached", "--", relativePath]
      : ["diff", "--", relativePath];
    const diffResult = await this.gitCommandRunner.run(repo.repoRoot, diffArgs, {
      workspaceId,
      operation: "gitRead.getDiff",
      signal
    });
    const numstatResult = await this.gitCommandRunner.run(
      repo.repoRoot,
      staged
        ? ["diff", "--cached", "--numstat", "--", relativePath]
        : ["diff", "--numstat", "--", relativePath],
      {
        workspaceId,
        operation: "gitRead.getDiff",
        signal
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

  async getCommitDetail(
    workspaceId: string,
    commitHash: string,
    signal?: AbortSignal
  ): Promise<GitCommitDetail> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const normalizedCommitHash = commitHash.trim();
    const [metadataResult, changedFilesResult, diffResult, versionResult] = await Promise.all([
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "show",
          "--no-patch",
          "--date=iso-strict",
          "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b",
          normalizedCommitHash
        ],
        {
          workspaceId,
          operation: "gitRead.getCommitDetail",
          signal
        }
      ),
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "show",
          "--format=",
          "--name-status",
          "--find-renames",
          normalizedCommitHash
        ],
        {
          workspaceId,
          operation: "gitRead.getCommitDetail",
          signal
        }
      ),
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "show",
          "--find-renames",
          "--submodule=diff",
          normalizedCommitHash
        ],
        {
          workspaceId,
          operation: "gitRead.getCommitDetail",
          signal
        }
      ),
      this.gitCommandRunner.run(
        repo.repoRoot,
        ["describe", "--tags", "--always", normalizedCommitHash],
        {
          allowNonZeroExit: true,
          workspaceId,
          operation: "gitRead.getCommitDetail",
          signal
        }
      )
    ]);
    const metadata = parseCommitDetailMetadata(metadataResult.stdout, normalizedCommitHash);
    const diffTruncated = diffResult.stdout.length > MAX_DIFF_OUTPUT;

    return {
      workspaceId,
      commitHash: metadata.commitHash,
      shortHash: metadata.shortHash,
      versionLabel: versionResult.stdout.trim() || metadata.shortHash,
      authorName: metadata.authorName,
      authorEmail: metadata.authorEmail,
      authoredAt: metadata.authoredAt,
      committerName: metadata.committerName,
      committerEmail: metadata.committerEmail,
      committedAt: metadata.committedAt,
      subject: metadata.subject,
      body: metadata.body,
      changedFiles: parseCommitChangedFiles(changedFilesResult.stdout),
      diffTruncated,
      diffContent: diffTruncated ? diffResult.stdout.slice(0, MAX_DIFF_OUTPUT) : diffResult.stdout
    };
  }

  async getHistory(
    workspaceId: string,
    cursor: string | null,
    limit: number,
    signal?: AbortSignal
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
        operation: "gitRead.getHistory",
        signal
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
          operation: "gitRead.getHistory",
          signal
        }
      ),
      this.gitCommandRunner.run(repo.repoRoot, ["rev-list", "--count", "--all"], {
        allowNonZeroExit: true,
        workspaceId,
        operation: "gitRead.getHistory",
        signal
      }),
      currentRef?.upstream
        ? this.gitCommandRunner.run(
            repo.repoRoot,
            ["rev-list", "--left-right", `${currentRef.shortName}...${currentRef.upstream}`],
            {
              allowNonZeroExit: true,
              workspaceId,
              operation: "gitRead.getHistory",
              signal
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

  async getBranches(workspaceId: string, signal?: AbortSignal): Promise<GitBranchSnapshot> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const [statusResult, localResult, remoteResult] = await Promise.all([
      this.gitCommandRunner.run(repo.repoRoot, ["status", "--porcelain=1", "--branch"], {
        workspaceId,
        operation: "gitRead.getBranches",
        signal
      }),
      this.gitCommandRunner.run(
        repo.repoRoot,
        [
          "for-each-ref",
          "--format=%(refname:short)%00%(upstream:short)%00%(HEAD)",
          "refs/heads"
        ],
        {
          workspaceId,
          operation: "gitRead.getBranches",
          signal
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
          operation: "gitRead.getBranches",
          signal
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

  async getRemotes(workspaceId: string, signal?: AbortSignal): Promise<GitRemoteItem[]> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const result = await this.gitCommandRunner.run(
      repo.repoRoot,
      ["remote", "-v"],
      {
        workspaceId,
        operation: "gitRead.getRemotes",
        signal
      }
    );

    const remotes = new Map<string, GitRemoteItem>();

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
      if (!match) continue;

      const [, name, url, kind] = match;
      const existing = remotes.get(name);
      if (existing) {
        if (kind === "push") existing.pushUrl = url;
      } else {
        remotes.set(name, {
          name,
          fetchUrl: kind === "fetch" ? url : url,
          pushUrl: kind === "push" ? url : url,
          credentialConfigured: false
        });
      }
    }

    return Array.from(remotes.values());
  }

  async getTags(workspaceId: string, signal?: AbortSignal): Promise<GitTagItem[]> {
    const repo = await this.workspaceRepoGuard.resolve(workspaceId);
    const result = await this.gitCommandRunner.run(
      repo.repoRoot,
      [
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname:short)",
        "refs/tags"
      ],
      {
        workspaceId,
        operation: "gitRead.getTags",
        signal
      }
    );

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }
}

function parseBranchHeader(headerLine: string): { branch: string; ahead: number; behind: number } {
  const header = headerLine.replace(/^##\s*/, "");
  const unbornBranch = parseUnbornBranch(header);

  if (unbornBranch) {
    return {
      branch: unbornBranch,
      ahead: 0,
      behind: 0
    };
  }

  if (header.startsWith("HEAD ")) {
    return {
      branch: "HEAD",
      ahead: 0,
      behind: 0
    };
  }

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

function parseUnbornBranch(header: string): string | null {
  const match = header.match(/^(?:No commits yet on|Initial commit on) (.+)$/);

  if (!match) {
    return null;
  }

  return match[1]?.trim() || null;
}

function parseStatusLine(line: string): GitChangeItem {
  const stagedStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  const payload = line.slice(3);
  const renameParts = payload.split(" -> ");
  const oldPath = renameParts.length === 2 ? renameParts[0] : null;
  const normalizedPath = renameParts.length === 2 ? renameParts[1] : payload;
  const normalizedStagedStatus = normalizeStatusColumn(stagedStatus, "staged");
  const normalizedWorktreeStatus = normalizeStatusColumn(worktreeStatus, "worktree");
  const combinedStatus = normalizedStagedStatus ?? normalizedWorktreeStatus ?? "?";

  return {
    path: normalizedPath,
    status: combinedStatus,
    staged: normalizedStagedStatus !== null,
    oldPath,
    binary: false,
    stagedStatus: normalizedStagedStatus,
    worktreeStatus: normalizedWorktreeStatus
  };
}

function normalizeStatusColumn(
  status: string,
  column: "staged" | "worktree"
): string | null {
  const normalized = status.trim();

  if (!normalized) {
    return null;
  }

  // `??` 表示未跟踪文件，它只属于工作区变更，不能被当作暂存区状态。
  if (normalized === "?") {
    return column === "worktree" ? normalized : null;
  }

  if (normalized === "!") {
    return null;
  }

  return normalized;
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

function parseCommitDetailMetadata(
  stdout: string,
  fallbackCommitHash: string
): {
  commitHash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  subject: string;
  body: string;
} {
  const [
    commitHash = "",
    shortHash = "",
    authorName = "",
    authorEmail = "",
    authoredAt = "",
    committerName = "",
    committerEmail = "",
    committedAt = "",
    subject = "",
    body = ""
  ] = stdout.trimEnd().split("\u001f");

  return {
    commitHash: commitHash || fallbackCommitHash,
    shortHash: shortHash || (commitHash || fallbackCommitHash).slice(0, 8),
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committerEmail,
    committedAt,
    subject,
    body: body.trim()
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

function parseCommitChangedFiles(stdout: string): GitCommitChangedFile[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseCommitChangedFileLine(line));
}

function parseCommitChangedFileLine(line: string): GitCommitChangedFile {
  const parts = line.split("\t");
  const rawStatus = parts[0] ?? "";
  const status = rawStatus.charAt(0) || "?";

  if ((status === "R" || status === "C") && parts.length >= 3) {
    return {
      status,
      oldPath: parts[1] ?? null,
      path: parts[2] ?? "",
      binary: false
    };
  }

  return {
    status,
    oldPath: null,
    path: parts[1] ?? "",
    binary: false
  };
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
  const [name = "", upstream = "", currentMarker = ""] = line.split("\u0000");

  return {
    name,
    current: currentMarker.trim() === "*",
    upstream: upstream || null,
    remote
  };
}
