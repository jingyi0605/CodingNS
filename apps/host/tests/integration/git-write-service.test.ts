import { describe, expect, it, vi } from "vitest";

import { GitWriteService } from "../../src/modules/git/git-write-service.js";
import type { GitCommandRunner, GitCommandResult } from "../../src/modules/git/git-command-runner.js";
import type { GitReadService } from "../../src/modules/git/git-read-service.js";
import type { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";

describe("GitWriteService", () => {
  it("撤销上次提交时会返回被撤销提交的标题", async () => {
    const { service, gitCommandRunner } = createWriteService([
      {
        stdout: "abc123\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "feat: keep commit message\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "",
        stderr: "",
        exitCode: 0
      }
    ]);

    await expect(service.undoLastCommit("workspace-1")).resolves.toEqual({
      summary: "已撤销上次提交，改动保留在暂存区",
      commitHash: "abc123",
      commitSubject: "feat: keep commit message"
    });

    expect(gitCommandRunner.run).toHaveBeenNthCalledWith(
      2,
      "C:/repo",
      ["show", "-s", "--format=%s", "HEAD"],
      { allowNonZeroExit: true }
    );
  });

  it("放弃未暂存改动时不会误删已经暂存的内容", async () => {
    const initialStatus = createStatus([
      {
        path: "src/app.tsx",
        status: "M",
        staged: true,
        oldPath: null,
        binary: false,
        stagedStatus: "M",
        worktreeStatus: "M"
      }
    ]);
    const finalStatus = createStatus([
      {
        path: "src/app.tsx",
        status: "M",
        staged: true,
        oldPath: null,
        binary: false,
        stagedStatus: "M",
        worktreeStatus: null
      }
    ]);
    const { service, gitCommandRunner } = createWriteService(
      [
        {
          stdout: "",
          stderr: "",
          exitCode: 0
        }
      ],
      [initialStatus, finalStatus]
    );

    await expect(service.discard("workspace-1", ["src/app.tsx"])).resolves.toEqual(finalStatus);

    expect(gitCommandRunner.run).toHaveBeenCalledWith("C:/repo", [
      "restore",
      "--worktree",
      "--",
      "src/app.tsx"
    ]);
  });
});

function createWriteService(results: GitCommandResult[], statuses: ReturnType<typeof createStatus>[] = []) {
  const gitCommandRunner = {
    run: vi.fn(async () => {
      const next = results.shift();

      if (!next) {
        throw new Error("测试桩缺少 Git 命令返回值");
      }

      return next;
    })
  } satisfies Pick<GitCommandRunner, "run">;

  const workspaceRepoGuard = {
    ensureRelativePath: vi.fn((_repoRoot: string, target: string) => target),
    resolve: vi.fn(async () => ({
      workspace: {
        id: "workspace-1",
        name: "Git 工作区",
        path: "C:/repo",
        repoRoot: "C:/repo",
        favorite: false,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z"
      },
      repoRoot: "C:/repo"
    }))
  };

  const gitReadService = {
    getStatus: vi.fn(async () => {
      const next = statuses.shift();

      if (!next) {
        throw new Error("测试桩缺少 Git 状态返回值");
      }

      return next;
    })
  };

  return {
    service: new GitWriteService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard,
      gitReadService as unknown as GitReadService
    ),
    gitCommandRunner
  };
}

function createStatus(changes: Array<{
  path: string;
  status: string;
  staged: boolean;
  oldPath: string | null;
  binary: boolean;
  stagedStatus: string | null;
  worktreeStatus: string | null;
}>) {
  return {
    snapshot: {
      workspaceId: "workspace-1",
      repoRoot: "C:/repo",
      branch: "main",
      ahead: 0,
      behind: 0,
      hasRemote: true,
      isDirty: changes.length > 0,
      lastFetchedAt: null
    },
    changes
  };
}
