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
      {
        allowNonZeroExit: true,
        workspaceId: "workspace-1",
        operation: "gitWrite.undoLastCommit"
      }
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

    expect(gitCommandRunner.run).toHaveBeenCalledWith(
      "C:/repo",
      ["restore", "--worktree", "--", "src/app.tsx"],
      {
        workspaceId: "workspace-1",
        operation: "gitWrite.discard"
      }
    );
  });

  it("远程同步携带认证时会把 askpass 环境传给 Git 命令", async () => {
    const { service, gitCommandRunner, gitRemoteCredentialService } = createWriteService(
      [
        {
          stdout: "https://example.com/repo.git\n",
          stderr: "",
          exitCode: 0
        },
        {
          stdout: "",
          stderr: "",
          exitCode: 0
        }
      ],
      [createStatus()]
    );

    await expect(
      service.syncRemote("workspace-1", "push", "origin", {
        mode: "token",
        token: "secret-token"
      }, true, "user-1")
    ).resolves.toMatchObject({
      action: "push",
      summary: "已将 main 推送到 origin"
    });

    expect(gitCommandRunner.run).toHaveBeenNthCalledWith(
      2,
      "C:/repo",
      ["push", "origin", "main"],
      expect.objectContaining({
        allowNonZeroExit: true,
        timeoutMs: 60_000,
        workspaceId: "workspace-1",
        operation: "gitWrite.syncRemote",
        env: expect.objectContaining({
          CODINGNS_GIT_AUTH_SECRET: "secret-token",
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never"
        })
      })
    );

    expect(gitRemoteCredentialService.save).toHaveBeenCalledWith("user-1", "https://example.com/repo.git", {
      mode: "token",
      token: "secret-token"
    });
  });

  it("远程同步未显式传认证时会优先复用 Host 端已保存认证", async () => {
    const { service, gitCommandRunner, gitRemoteCredentialService } = createWriteService(
      [
        {
          stdout: "https://example.com/repo.git\n",
          stderr: "",
          exitCode: 0
        },
        {
          stdout: "",
          stderr: "",
          exitCode: 0
        }
      ],
      [createStatus()]
    );
    gitRemoteCredentialService.load.mockReturnValue({
      mode: "basic",
      username: "jackson",
      password: "saved-password"
    });

    await expect(service.syncRemote("workspace-1", "fetch", "origin", null, false, "user-1")).resolves.toMatchObject({
      action: "fetch",
      summary: "已完成远程抓取"
    });

    expect(gitRemoteCredentialService.load).toHaveBeenCalledWith("user-1", "https://example.com/repo.git");
    expect(gitCommandRunner.run).toHaveBeenNthCalledWith(
      2,
      "C:/repo",
      ["fetch", "origin"],
      expect.objectContaining({
        env: expect.objectContaining({
          CODINGNS_GIT_AUTH_USERNAME: "jackson",
          CODINGNS_GIT_AUTH_SECRET: "saved-password"
        })
      })
    );
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

  const gitRemoteCredentialService = {
    load: vi.fn(() => null),
    save: vi.fn()
  };

  return {
    service: new GitWriteService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard,
      gitReadService as unknown as GitReadService,
      gitRemoteCredentialService as never
    ),
    gitCommandRunner,
    gitRemoteCredentialService
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
}> = []) {
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
