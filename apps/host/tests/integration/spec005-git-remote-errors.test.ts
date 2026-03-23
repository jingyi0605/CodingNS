import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { GitWriteService } from "../../src/modules/git/git-write-service.js";
import type { GitCommandRunner, GitCommandResult } from "../../src/modules/git/git-command-runner.js";
import type { GitReadService } from "../../src/modules/git/git-read-service.js";
import type { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";

describe("spec005 远程同步错误映射", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("在 pull 非快进失败时返回分支冲突错误", async () => {
    const { service } = createRemoteSyncService([
      {
        stdout: "https://example.com/repo.git\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "",
        stderr: "fatal: Not possible to fast-forward, aborting.",
        exitCode: 128
      }
    ]);

    await expect(service.syncRemote("workspace-1", "pull")).rejects.toMatchObject({
      errorCode: "BRANCH_CONFLICT",
      statusCode: 409,
      message: "远程同步失败，存在分支冲突或非快进更新"
    });
  });

  it("在 Git 命令超时时保留超时错误码", async () => {
    const timeoutError = new AppError({
      statusCode: 504,
      errorCode: "GIT_COMMAND_TIMEOUT",
      detail: "Git 命令执行超时：git fetch origin"
    });
    const { service } = createRemoteSyncService([
      {
        stdout: "https://example.com/repo.git\n",
        stderr: "",
        exitCode: 0
      },
      timeoutError
    ]);

    await expect(service.syncRemote("workspace-1", "fetch")).rejects.toBe(timeoutError);
  });

  it("在远程网络失败时返回统一的远程失败错误", async () => {
    const { service } = createRemoteSyncService([
      {
        stdout: "https://example.com/repo.git\n",
        stderr: "",
        exitCode: 0
      },
      {
        stdout: "",
        stderr: "fatal: unable to access 'https://example.com/repo.git/': Failed to connect to example.com port 443",
        exitCode: 128
      }
    ]);

    await expect(service.syncRemote("workspace-1", "fetch")).rejects.toMatchObject({
      errorCode: "GIT_REMOTE_FAILED",
      statusCode: 502,
      message: "远程网络异常，暂时无法完成同步"
    });
  });
});

function createRemoteSyncService(results: Array<GitCommandResult | AppError>) {
  const gitCommandRunner = {
    run: vi.fn(async () => {
      const next = results.shift();

      if (!next) {
        throw new Error("测试桩缺少 Git 命令返回值");
      }

      if (next instanceof AppError) {
        throw next;
      }

      return next;
    })
  } satisfies Pick<GitCommandRunner, "run">;

  const workspaceRepoGuard = {
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
    getStatus: vi.fn(async () => ({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: false,
        lastFetchedAt: null
      },
      changes: []
    }))
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
