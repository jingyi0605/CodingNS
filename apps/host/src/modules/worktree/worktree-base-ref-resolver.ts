import { AppError } from "../../shared/errors/app-error.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";

const EMPTY_REPO_BOOTSTRAP_COMMIT_MESSAGE = "chore: 初始化空仓库工作树基线";
const EMPTY_REPO_BOOTSTRAP_COMMIT_ENV = {
  GIT_AUTHOR_NAME: "CodingNS",
  GIT_AUTHOR_EMAIL: "codingns@example.com",
  GIT_COMMITTER_NAME: "CodingNS",
  GIT_COMMITTER_EMAIL: "codingns@example.com"
} as const;

interface ResolveWorktreeBaseInput {
  gitCommandRunner: Pick<GitCommandRunner, "run">;
  repoRoot: string;
  workspaceId: string;
  currentBranch?: string | null;
  preferredBaseRef?: string | null;
  resolveBaseRefOperation: string;
  inspectCommitCountOperation: string;
  bootstrapInitialCommitOperation: string;
  notFoundDetail: string;
  signal?: AbortSignal;
}

export interface ResolvedWorktreeBase {
  baseRef: string;
  baseCommit: string;
  createdInitialCommit: boolean;
}

export async function resolveWorktreeBaseRef(
  input: ResolveWorktreeBaseInput
): Promise<ResolvedWorktreeBase> {
  const candidateRefs = collectCandidateRefs(input.preferredBaseRef, input.currentBranch);
  const resolved = await resolveFirstExistingRef(input, candidateRefs);

  if (resolved) {
    return {
      ...resolved,
      createdInitialCommit: false
    };
  }

  if (!(await shouldBootstrapEmptyRepository(input, candidateRefs))) {
    throw createBaseRefNotFoundError(input.notFoundDetail);
  }

  await bootstrapEmptyRepository(input);

  const resolvedAfterBootstrap = await resolveFirstExistingRef(input, candidateRefs);

  if (resolvedAfterBootstrap) {
    return {
      ...resolvedAfterBootstrap,
      createdInitialCommit: true
    };
  }

  throw createBaseRefNotFoundError(input.notFoundDetail);
}

async function resolveFirstExistingRef(
  input: ResolveWorktreeBaseInput,
  candidateRefs: string[]
): Promise<Pick<ResolvedWorktreeBase, "baseRef" | "baseCommit"> | null> {
  for (const ref of candidateRefs) {
    const commit = await resolveCommit(input, ref);

    if (commit) {
      return {
        baseRef: ref,
        baseCommit: commit
      };
    }
  }

  return null;
}

async function resolveCommit(
  input: ResolveWorktreeBaseInput,
  ref: string
): Promise<string | null> {
  const result = await input.gitCommandRunner.run(
    input.repoRoot,
    ["rev-parse", "--verify", ref],
    {
      allowNonZeroExit: true,
      workspaceId: input.workspaceId,
      operation: input.resolveBaseRefOperation,
      signal: input.signal
    }
  );
  const commit = result.stdout.trim();

  if (result.exitCode === 0 && commit) {
    return commit;
  }

  return null;
}

async function shouldBootstrapEmptyRepository(
  input: ResolveWorktreeBaseInput,
  candidateRefs: string[]
): Promise<boolean> {
  const currentBranch = input.currentBranch?.trim();
  const explicitBaseRef = input.preferredBaseRef?.trim();

  if (
    explicitBaseRef &&
    explicitBaseRef !== "HEAD" &&
    (!currentBranch || explicitBaseRef !== currentBranch)
  ) {
    return false;
  }

  if (!candidateRefs.includes("HEAD") && (!currentBranch || !candidateRefs.includes(currentBranch))) {
    return false;
  }

  const result = await input.gitCommandRunner.run(
    input.repoRoot,
    ["rev-list", "--count", "--all"],
    {
      allowNonZeroExit: true,
      workspaceId: input.workspaceId,
      operation: input.inspectCommitCountOperation,
      signal: input.signal
    }
  );

  if (result.exitCode !== 0) {
    return false;
  }

  const commitCount = Number.parseInt(result.stdout.trim() || "0", 10);
  return Number.isFinite(commitCount) && commitCount === 0;
}

async function bootstrapEmptyRepository(input: ResolveWorktreeBaseInput): Promise<void> {
  // 空仓库没有任何可解析引用，先补一个空提交，后续 worktree 才有稳定基线。
  await input.gitCommandRunner.run(
    input.repoRoot,
    ["commit", "--allow-empty", "--message", EMPTY_REPO_BOOTSTRAP_COMMIT_MESSAGE, "--no-verify"],
    {
      env: EMPTY_REPO_BOOTSTRAP_COMMIT_ENV,
      workspaceId: input.workspaceId,
      operation: input.bootstrapInitialCommitOperation,
      signal: input.signal
    }
  );
}

function collectCandidateRefs(
  preferredBaseRef: string | null | undefined,
  currentBranch: string | null | undefined
): string[] {
  const explicitBaseRef = preferredBaseRef?.trim();

  if (explicitBaseRef) {
    return [explicitBaseRef];
  }

  const refs = [currentBranch?.trim(), "HEAD"];
  const uniqueRefs = new Set<string>();

  for (const ref of refs) {
    if (!ref) {
      continue;
    }

    uniqueRefs.add(ref);
  }

  return [...uniqueRefs];
}

function createBaseRefNotFoundError(detail: string): AppError {
  return new AppError({
    statusCode: 404,
    errorCode: "WORKTREE_BASE_REF_NOT_FOUND",
    detail,
    field: "baseRef"
  });
}
