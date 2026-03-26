import { describe, expect, it, vi } from "vitest";

import { GitReadService } from "../../src/modules/git/git-read-service.js";
import type { GitCommandRunner, GitCommandResult } from "../../src/modules/git/git-command-runner.js";
import type { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";

describe("GitReadService", () => {
  it("会为历史提交补充本地远程归属与远程标签", async () => {
    const gitCommandRunner = {
      run: vi.fn(async (_repoRoot: string, args: string[]) => {
        if (args[0] === "for-each-ref") {
          return createResult(
            [
              "refs/heads/main\u001fmain\u001f111\u001forigin/main\u001f*",
              "refs/heads/feature\u001ffeature\u001f333\u001forigin/feature\u001f",
              "refs/remotes/origin/main\u001forigin/main\u001f111\u001f\u001f",
              "refs/remotes/upstream/main\u001fupstream/main\u001f111\u001f\u001f",
              "refs/remotes/upstream/release\u001fupstream/release\u001f222\u001f\u001f"
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
});

function createResult(stdout: string): GitCommandResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0
  };
}
