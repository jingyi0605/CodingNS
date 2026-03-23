import { spawnSync } from "node:child_process";
import path from "node:path";
import { writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { nowIso } from "../../src/shared/utils/time.js";
import {
  createGitWorkspaceFixture,
  createTestApp,
  destroyFixture,
  type GitWorkspaceFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: GitWorkspaceFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const hosted = activeServers.pop();

    if (hosted) {
      hosted.app.server.closeAllConnections?.();
      await hosted.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("spec005 Git 上下文与提交规则引擎", () => {
  it("打通 status -> diff -> stage -> unstage 受保护主链路", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const anonymousStatus = await hosted.app.inject({
      method: "GET",
      url: `/api/git/status?workspaceId=${fixture.workspaceId}`
    });
    expect(anonymousStatus.statusCode).toBe(401);

    const statusResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/git/status?workspaceId=${fixture.workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().snapshot.branch).toBe("main");
    expect(
      statusResponse.json().changes.some((item: { path: string }) => item.path === "README.md")
    ).toBe(true);

    const diffResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/git/diff?workspaceId=${fixture.workspaceId}&path=${encodeURIComponent("README.md")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(diffResponse.statusCode).toBe(200);
    expect(diffResponse.json().content).toContain("第二行改动");

    const stageResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/stage",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        targets: ["README.md"]
      }
    });
    expect(stageResponse.statusCode).toBe(200);
    expect(stageResponse.json().changes.find((item: { path: string }) => item.path === "README.md").staged).toBe(
      true
    );

    const outOfWorkspaceResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/stage",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        targets: ["../hack.txt"]
      }
    });
    expect(outOfWorkspaceResponse.statusCode).toBe(400);
    expect(outOfWorkspaceResponse.json().error_code).toBe("PATH_OUT_OF_WORKSPACE");

    const unstageResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/unstage",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        targets: ["README.md"]
      }
    });
    expect(unstageResponse.statusCode).toBe(200);
    expect(
      unstageResponse.json().changes.find((item: { path: string }) => item.path === "README.md").staged
    ).toBe(false);
  });

  it("打通规则配置、草稿生成、二次校验、提交与历史查询", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const updateRuleResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/git/rules",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        name: "严格中文规则",
        subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
        maxSubjectLength: 72,
        language: "zh",
        requireBody: true,
        requireIssue: true,
        issuePattern: "#\\d+"
      }
    });
    expect(updateRuleResponse.statusCode).toBe(200);
    expect(updateRuleResponse.json().requireBody).toBe(true);

    const stageResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/stage",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        targets: ["README.md"]
      }
    });
    expect(stageResponse.statusCode).toBe(200);

    const draftResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/commit/draft",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        mode: "ai"
      }
    });
    expect(draftResponse.statusCode).toBe(200);
    expect(draftResponse.json().draft.source).toBe("ai");
    expect(draftResponse.json().validation.passed).toBe(false);

    const invalidCommitResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/commit",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        draft: {
          subject: "chore(readme): update readme",
          body: null,
          footer: null,
          source: "manual"
        }
      }
    });
    expect(invalidCommitResponse.statusCode).toBe(400);
    expect(invalidCommitResponse.json().error_code).toBe("COMMIT_VALIDATION_FAILED");

    const validateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/commit/validate",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        draft: {
          subject: "chore(readme): 更新README",
          body: "- 调整 README.md",
          footer: "Refs: #123",
          source: "manual"
        }
      }
    });
    expect(validateResponse.statusCode).toBe(200);
    expect(validateResponse.json().validation.passed).toBe(true);

    const commitResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/commit",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        draft: {
          subject: "chore(readme): 更新README",
          body: "- 调整 README.md",
          footer: "Refs: #123",
          source: "manual"
        }
      }
    });
    expect(commitResponse.statusCode).toBe(200);
    expect(commitResponse.json().commitHash).toMatch(/^[0-9a-f]{40}$/);

    const historyResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/git/history?workspaceId=${fixture.workspaceId}&limit=10`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().items[0].subject).toBe("chore(readme): 更新README");

    const branchesResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/git/branches?workspaceId=${fixture.workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(branchesResponse.statusCode).toBe(200);
    expect(branchesResponse.json().currentBranch).toBe("main");

    const switchBranchResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/branches/switch",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        branchName: "feature/spec005",
        create: true
      }
    });
    expect(switchBranchResponse.statusCode).toBe(200);
    expect(switchBranchResponse.json().currentBranch).toBe("feature/spec005");
  });

  it("在有远程仓库时支持 fetch / publish / push / pull 的最小闭环", async () => {
    const fixture = createGitWorkspaceFixture({ withRemote: true });
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const fetchResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        action: "fetch"
      }
    });
    expect(fetchResponse.statusCode).toBe(200);

    const publishResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        action: "publish"
      }
    });
    expect(publishResponse.statusCode).toBe(200);

    const pushResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        action: "push"
      }
    });
    expect(pushResponse.statusCode).toBe(200);

    const pullResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: fixture.workspaceId,
        action: "pull"
      }
    });
    expect(pullResponse.statusCode).toBe(200);
  });

  it("在远程同步失败时返回明确错误码", async () => {
    const noRemoteFixture = createGitWorkspaceFixture();
    activeFixtures.push(noRemoteFixture);

    const noRemoteHosted = createTestApp(noRemoteFixture);
    activeServers.push(noRemoteHosted);
    await noRemoteHosted.app.ready();

    await bootstrapWorkspace(noRemoteHosted, noRemoteFixture);
    const noRemoteToken = await loginAsAdmin(noRemoteHosted);

    const remoteMissingResponse = await noRemoteHosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${noRemoteToken}`
      },
      payload: {
        workspaceId: noRemoteFixture.workspaceId,
        action: "push"
      }
    });
    expect(remoteMissingResponse.statusCode).toBe(404);
    expect(remoteMissingResponse.json().error_code).toBe("REMOTE_NOT_FOUND");

    const conflictFixture = createGitWorkspaceFixture({ withRemote: true });
    activeFixtures.push(conflictFixture);

    const conflictHosted = createTestApp(conflictFixture);
    activeServers.push(conflictHosted);
    await conflictHosted.app.ready();

    await bootstrapWorkspace(conflictHosted, conflictFixture);
    const conflictToken = await loginAsAdmin(conflictHosted);

    const publishResponse = await conflictHosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${conflictToken}`
      },
      payload: {
        workspaceId: conflictFixture.workspaceId,
        action: "publish"
      }
    });
    expect(publishResponse.statusCode).toBe(200);

    createCollaboratorCommit(conflictFixture);
    createLocalCommit(conflictFixture.repoDir);

    const pushConflictResponse = await conflictHosted.app.inject({
      method: "POST",
      url: "/api/git/remote/sync",
      headers: {
        authorization: `Bearer ${conflictToken}`
      },
      payload: {
        workspaceId: conflictFixture.workspaceId,
        action: "push"
      }
    });
    expect(pushConflictResponse.statusCode).toBe(409);
    expect(pushConflictResponse.json().error_code).toBe("BRANCH_CONFLICT");
  });
});

async function bootstrapWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  fixture: GitWorkspaceFixture
): Promise<void> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const timestamp = nowIso();

  hosted.services.repositories.workspaceRepository.create({
    id: fixture.workspaceId,
    name: "Git 工作区",
    path: fixture.workspaceDir,
    repoRoot: fixture.workspaceDir,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

async function loginAsAdmin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return loginResponse.json().accessToken as string;
}

function createCollaboratorCommit(fixture: GitWorkspaceFixture): void {
  if (!fixture.remoteDir) {
    throw new Error("缺少远程仓库，无法构造协作者提交");
  }

  const collaboratorDir = path.join(fixture.rootDir, "collaborator");

  runGitCommand(fixture.rootDir, ["clone", "--branch", "main", fixture.remoteDir, collaboratorDir]);
  runGitCommand(collaboratorDir, ["config", "user.name", "Remote Collaborator"]);
  runGitCommand(collaboratorDir, ["config", "user.email", "remote@example.com"]);
  writeFileSync(path.join(collaboratorDir, "REMOTE.md"), "来自远程的新提交\n", "utf8");
  runGitCommand(collaboratorDir, ["add", "REMOTE.md"]);
  runGitCommand(collaboratorDir, ["commit", "-m", "chore(remote): 增加远程提交"]);
  runGitCommand(collaboratorDir, ["push", "origin", "main"]);
}

function createLocalCommit(repoDir: string): void {
  writeFileSync(path.join(repoDir, "LOCAL.md"), "来自本地的新提交\n", "utf8");
  runGitCommand(repoDir, ["add", "README.md", "LOCAL.md"]);
  runGitCommand(repoDir, ["commit", "-m", "chore(local): 增加本地提交"]);
}

function runGitCommand(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 执行失败`);
  }
}
