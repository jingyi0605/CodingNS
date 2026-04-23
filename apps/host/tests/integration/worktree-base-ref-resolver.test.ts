import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { resolveWorktreeBaseRef } from "../../src/modules/worktree/worktree-base-ref-resolver.js";
import type { GitCommandRunner, GitCommandResult } from "../../src/modules/git/git-command-runner.js";

describe("resolveWorktreeBaseRef", () => {
  it("当前分支无法解析时会回退到 HEAD", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "rev-parse" && args[2] === "missing-branch") {
          return createResult("", 1);
        }

        if (args[0] === "rev-parse" && args[2] === "HEAD") {
          return createResult("abc123\n");
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
      })
    } satisfies Pick<GitCommandRunner, "run">;

    await expect(
      resolveWorktreeBaseRef({
        gitCommandRunner,
        repoRoot: "/repo",
        workspaceId: "workspace-1",
        currentBranch: "missing-branch",
        resolveBaseRefOperation: "test.resolveBaseRef",
        inspectCommitCountOperation: "test.inspectCommitCount",
        bootstrapInitialCommitOperation: "test.bootstrapInitialCommit",
        notFoundDetail: "找不到基准"
      })
    ).resolves.toEqual({
      baseRef: "HEAD",
      baseCommit: "abc123",
      createdInitialCommit: false
    });
  });

  it("空仓库会先补一个空提交，再用当前分支作为 worktree 基线", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "rev-parse" && args[2] === "main") {
          return createResult(gitCommandRunner.run.mock.calls.length > 2 ? "def456\n" : "", gitCommandRunner.run.mock.calls.length > 2 ? 0 : 1);
        }

        if (args[0] === "rev-parse" && args[2] === "HEAD") {
          return createResult("", 1);
        }

        if (args[0] === "rev-list") {
          return createResult("0\n");
        }

        if (args[0] === "commit") {
          return createResult("[main (root-commit) def456] chore: 初始化空仓库工作树基线\n");
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
      })
    } satisfies Pick<GitCommandRunner, "run">;

    await expect(
      resolveWorktreeBaseRef({
        gitCommandRunner,
        repoRoot: "/repo",
        workspaceId: "workspace-1",
        currentBranch: "main",
        resolveBaseRefOperation: "test.resolveBaseRef",
        inspectCommitCountOperation: "test.inspectCommitCount",
        bootstrapInitialCommitOperation: "test.bootstrapInitialCommit",
        notFoundDetail: "找不到基准"
      })
    ).resolves.toEqual({
      baseRef: "main",
      baseCommit: "def456",
      createdInitialCommit: true
    });
  });

  it("显式指定了无关 baseRef 时，不会偷偷改仓库历史", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "rev-parse") {
          return createResult("", 1);
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
      })
    } satisfies Pick<GitCommandRunner, "run">;

    await expect(
      resolveWorktreeBaseRef({
        gitCommandRunner,
        repoRoot: "/repo",
        workspaceId: "workspace-1",
        currentBranch: "main",
        preferredBaseRef: "release/unknown",
        resolveBaseRefOperation: "test.resolveBaseRef",
        inspectCommitCountOperation: "test.inspectCommitCount",
        bootstrapInitialCommitOperation: "test.bootstrapInitialCommit",
        notFoundDetail: "找不到基准"
      })
    ).rejects.toMatchObject<AppError>({
      errorCode: "WORKTREE_BASE_REF_NOT_FOUND"
    });

    expect(gitCommandRunner.run).toHaveBeenCalledTimes(1);
  });
});

function createResult(stdout: string, exitCode = 0): GitCommandResult {
  return {
    stdout,
    stderr: "",
    exitCode
  };
}
