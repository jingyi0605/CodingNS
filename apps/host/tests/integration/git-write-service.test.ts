import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { GitWriteService } from "../../src/modules/git/git-write-service.js";
import type { GitCommandRunner, GitCommandResult } from "../../src/modules/git/git-command-runner.js";
import type { GitReadService } from "../../src/modules/git/git-read-service.js";
import type { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";

describe("GitWriteService", () => {
  it("初始化 Git 工作区后会返回新的仓库状态", async () => {
    const disabledStatus = createStatus();
    disabledStatus.snapshot.enabled = false;
    disabledStatus.snapshot.branch = "";
    disabledStatus.snapshot.hasRemote = false;
    disabledStatus.snapshot.isDirty = false;

    const enabledStatus = createStatus();
    const { service, gitCommandRunner } = createWriteService(
      [
        {
          stdout: "Initialized empty Git repository\n",
          stderr: "",
          exitCode: 0
        }
      ],
      [disabledStatus, enabledStatus]
    );

    await expect(service.initializeRepository("workspace-1")).resolves.toEqual(enabledStatus);

    expect(gitCommandRunner.run).toHaveBeenCalledWith(
      "C:/repo",
      ["init"],
      {
        workspaceId: "workspace-1",
        operation: "gitWrite.initializeRepository"
      }
    );
  });

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

  it("添加到 Git 排除时会写入 .gitignore 且避免重复项", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-git-ignore-"));
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "dist\n", "utf8");
    const nextStatus = createStatus();
    const { service } = createWriteService([], [nextStatus], {
      repoRoot
    });

    await expect(service.addToGitIgnore("workspace-1", ["tmp/cache", "dist"])).resolves.toEqual(nextStatus);

    expect(fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toBe("dist\ntmp/cache\n");
    fs.rmSync(repoRoot, { recursive: true, force: true });
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

function createWriteService(
  results: GitCommandResult[],
  statuses: ReturnType<typeof createStatus>[] = [],
  options?: { repoRoot?: string }
) {
  const repoRoot = options?.repoRoot ?? "C:/repo";
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
    resolveConfiguredRoot: vi.fn(() => ({
      workspace: {
        id: "workspace-1",
        name: "Git 工作区",
        path: repoRoot,
        repoRoot,
        favorite: false,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z"
      },
      repoRoot
    })),
    resolve: vi.fn(async () => ({
      workspace: {
        id: "workspace-1",
        name: "Git 工作区",
        path: repoRoot,
        repoRoot,
        favorite: false,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z"
      },
      repoRoot
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
      enabled: true,
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
