import { describe, expect, it, vi } from "vitest";

import { GitReadService } from "../../src/modules/git/git-read-service.js";
import type { GitCommandRunner, GitCommandResult } from "../../src/modules/git/git-command-runner.js";
import type { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";
import { AppError } from "../../src/shared/errors/app-error.js";

describe("GitReadService", () => {
  it("未跟踪文件只应出现在工作区变更中，不能被误算进暂存区", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "status") {
          return createResult(["## main", "?? apps/user-app/src/new-file.ts"].join("\n"));
        }

        if (args[0] === "remote") {
          return createResult("origin\n");
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
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
    } satisfies Pick<WorkspaceRepoGuard, "resolve">;

    const service = new GitReadService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard
    );

    await expect(service.getStatus("workspace-1")).resolves.toEqual({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        enabled: true,
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [
        {
          path: "apps/user-app/src/new-file.ts",
          status: "?",
          staged: false,
          oldPath: null,
          binary: false,
          stagedStatus: null,
          worktreeStatus: "?"
        }
      ]
    });
  });

  it("当前目录还不是 Git 仓库时，会返回未启用状态而不是直接抛错", async () => {
    const gitCommandRunner = {
      run: vi.fn()
    } satisfies Pick<GitCommandRunner, "run">;

    const workspaceRepoGuard = {
      resolve: vi.fn(async () => {
        throw new Error("不该走到这里");
      }),
      resolveConfiguredRoot: vi.fn(() => ({
        workspace: {
          id: "workspace-1",
          name: "普通目录",
          path: "C:/repo",
          repoRoot: null,
          favorite: false,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z"
        },
        repoRoot: "C:/repo"
      }))
    } satisfies Pick<WorkspaceRepoGuard, "resolve" | "resolveConfiguredRoot">;

    vi.mocked(workspaceRepoGuard.resolve).mockRejectedValueOnce(
      new AppError({
        statusCode: 404,
        errorCode: "NOT_GIT_REPOSITORY",
        detail: "当前工作区不是 Git 仓库"
      })
    );

    const service = new GitReadService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard
    );

    await expect(service.getStatus("workspace-1")).resolves.toEqual({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        enabled: false,
        branch: "",
        ahead: 0,
        behind: 0,
        hasRemote: false,
        isDirty: false,
        lastFetchedAt: null
      },
      changes: []
    });
    expect(gitCommandRunner.run).not.toHaveBeenCalled();
  });

  it("getStatus 会把 AbortSignal 透传给 gitCommandRunner", async () => {
    const controller = new AbortController();
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[], options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal);

        if (args[0] === "status") {
          return createResult("## main\n");
        }

        if (args[0] === "remote") {
          return createResult("origin\n");
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
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
    } satisfies Pick<WorkspaceRepoGuard, "resolve">;

    const service = new GitReadService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard
    );

    await service.getStatus("workspace-1", controller.signal);
    expect(gitCommandRunner.run).toHaveBeenCalledTimes(2);
  });

  it("会为历史提交补充本地远程归属与远程标签", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "for-each-ref") {
          return createResult(
            [
              "refs/heads/main\u0000main\u0000111\u0000origin/main\u0000*",
              "refs/heads/feature\u0000feature\u0000333\u0000origin/feature\u0000",
              "refs/remotes/origin/main\u0000origin/main\u0000111\u0000\u0000 ",
              "refs/remotes/upstream/main\u0000upstream/main\u0000111\u0000\u0000 ",
              "refs/remotes/upstream/release\u0000upstream/release\u0000222\u0000\u0000 "
            ].join("\n")
          );
        }

        if (args[0] === "log") {
          return createResult(
            [
              "333\u001fLinus\u001f2026-03-26T00:00:00.000Z\u001ffeat: local only\u001f\u001ffeature",
              "222\u001fLinus\u001f2026-03-25T00:00:00.000Z\u001ffix: remote release\u001f\u001fupstream/release",
              "111\u001fLinus\u001f2026-03-24T00:00:00.000Z\u001fchore: synced main\u001f\u001fHEAD -> main, origin/main, upstream/main, main",
              "000\u001fLinus\u001f2026-03-23T00:00:00.000Z\u001fdocs: shared base\u001f\u001f"
            ].join("\u001e") + "\u001e"
          );
        }

        if (args[0] === "rev-list" && args[1] === "--count") {
          return createResult("4\n");
        }

        if (args[0] === "rev-list" && args[1] === "--left-right") {
          return createResult("");
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
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
    } satisfies Pick<WorkspaceRepoGuard, "resolve">;

    const service = new GitReadService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard
    );

    await expect(service.getHistory("workspace-1", null, 10)).resolves.toEqual({
      items: [
        {
          commitHash: "333",
          authorName: "Linus",
          authoredAt: "2026-03-26T00:00:00.000Z",
          subject: "feat: local only",
          body: "",
          commitKind: "local",
          refs: [
            {
              name: "feature",
              kind: "local",
              remoteName: null
            }
          ]
        },
        {
          commitHash: "222",
          authorName: "Linus",
          authoredAt: "2026-03-25T00:00:00.000Z",
          subject: "fix: remote release",
          body: "",
          commitKind: "remote",
          refs: [
            {
              name: "upstream/release",
              kind: "remote",
              remoteName: "upstream"
            }
          ]
        },
        {
          commitHash: "111",
          authorName: "Linus",
          authoredAt: "2026-03-24T00:00:00.000Z",
          subject: "chore: synced main",
          body: "",
          commitKind: "shared",
          refs: [
            {
              name: "main",
              kind: "head",
              remoteName: null
            },
            {
              name: "origin/main",
              kind: "remote",
              remoteName: "origin"
            },
            {
              name: "upstream/main",
              kind: "remote",
              remoteName: "upstream"
            }
          ]
        },
        {
          commitHash: "000",
          authorName: "Linus",
          authoredAt: "2026-03-23T00:00:00.000Z",
          subject: "docs: shared base",
          body: "",
          commitKind: "shared",
          refs: []
        }
      ],
      cursor: "0",
      nextCursor: null,
      totalCount: 4
    });
  });

  it("可以读取单个提交的文件列表、版本号和完整 diff", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "show" && args.includes("--no-patch")) {
          return createResult(
            "abc123456789\u001fabc12345\u001fLinus\u001flinus@example.com\u001f2026-04-14T10:00:00.000Z\u001fLinus\u001flinus@example.com\u001f2026-04-14T10:05:00.000Z\u001ffeat: add commit tools\u001f补充最近版本菜单\n"
          );
        }

        if (args[0] === "show" && args.includes("--name-status")) {
          return createResult(
            [
              "M\tapps/user-app/src/features/conversation/components/GitSidebar.tsx",
              "R100\tapps/host/src/modules/git/old.ts\tapps/host/src/modules/git/new.ts"
            ].join("\n")
          );
        }

        if (args[0] === "show" && !args.includes("--name-status") && !args.includes("--no-patch")) {
          return createResult(
            [
              "commit abc123456789",
              "Author: Linus <linus@example.com>",
              "",
              "    feat: add commit tools",
              "",
              "diff --git a/apps/user-app/src/features/conversation/components/GitSidebar.tsx b/apps/user-app/src/features/conversation/components/GitSidebar.tsx",
              "+const added = true;"
            ].join("\n")
          );
        }

        if (args[0] === "describe") {
          return createResult("v1.2.3-4-gabc12345\n");
        }

        throw new Error(`未预期的 Git 命令: ${args.join(" ")}`);
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
    } satisfies Pick<WorkspaceRepoGuard, "resolve">;

    const service = new GitReadService(
      gitCommandRunner as unknown as GitCommandRunner,
      workspaceRepoGuard as unknown as WorkspaceRepoGuard
    );

    await expect(service.getCommitDetail("workspace-1", "abc123456789")).resolves.toEqual({
      workspaceId: "workspace-1",
      commitHash: "abc123456789",
      shortHash: "abc12345",
      versionLabel: "v1.2.3-4-gabc12345",
      authorName: "Linus",
      authorEmail: "linus@example.com",
      authoredAt: "2026-04-14T10:00:00.000Z",
      committerName: "Linus",
      committerEmail: "linus@example.com",
      committedAt: "2026-04-14T10:05:00.000Z",
      subject: "feat: add commit tools",
      body: "补充最近版本菜单",
      changedFiles: [
        {
          path: "apps/user-app/src/features/conversation/components/GitSidebar.tsx",
          oldPath: null,
          status: "M",
          binary: false
        },
        {
          path: "apps/host/src/modules/git/new.ts",
          oldPath: "apps/host/src/modules/git/old.ts",
          status: "R",
          binary: false
        }
      ],
      diffTruncated: false,
      diffContent: [
        "commit abc123456789",
        "Author: Linus <linus@example.com>",
        "",
        "    feat: add commit tools",
        "",
        "diff --git a/apps/user-app/src/features/conversation/components/GitSidebar.tsx b/apps/user-app/src/features/conversation/components/GitSidebar.tsx",
        "+const added = true;"
      ].join("\n")
    });
  });
});

function createResult(stdout: string): GitCommandResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0
  };
}
