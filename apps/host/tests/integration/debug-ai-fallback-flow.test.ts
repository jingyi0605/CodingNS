import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

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

describe("debug ai fallback flow", () => {
  it("硬编码端口的 Express 服务会进入 AI 兜底记录，而不是继续自动启动", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "express-hardcoded-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "express-hardcoded-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(repoPath, "server.js"),
      [
        "const express = require('express');",
        "const app = express();",
        "const port = 3000;",
        "app.get('/', (_req, res) => res.send('ok'));",
        "app.listen(port);"
      ].join("\n"),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, repoPath, "Express Hardcoded Repo");
    const targetId = await analyzeTarget(hosted, accessToken, workspaceId, repoPath, ["node server.js"]);
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const launchPlan = launchPlanResponse.json();

    expect(launchPlan.autoStartAllowed).toBe(false);
    expect(launchPlan.services[0]).toMatchObject({
      adapterKind: "ai_fallback",
      injectionMode: "ai_fallback",
      failureStage: "ai_fallback_required",
      autoStartAllowed: false,
      aiFallback: {
        eligible: true,
        status: "PENDING",
        allowedFiles: expect.arrayContaining(["server.js"])
      }
    });
    expect(launchPlan.services[0].adapterAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "env",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "ai_fallback",
          status: "fallback_required"
        })
      ])
    );

    const runtimeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-runtimes/${launchPlan.runtimeSession.id}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toMatchObject({
      runtimeSession: {
        id: launchPlan.runtimeSession.id,
        status: "PREPARING"
      },
      services: [
        {
          aiFallbackEdits: [
            expect.objectContaining({
              status: "PENDING",
              allowedFiles: expect.arrayContaining(["server.js"])
            })
          ]
        }
      ]
    });

    const runResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/run`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runResponse.statusCode).toBe(409);
    expect(runResponse.json()).toMatchObject({
      error_code: "DEBUG_TARGET_AI_FALLBACK_REQUIRED"
    });
  }, 20000);

  it("存在未清理的 AI 兜底记录时会阻断提交，拒绝后解除阻断", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "express-ai-block-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "express-ai-block-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(repoPath, "server.js"),
      [
        "const express = require('express');",
        "const app = express();",
        "const port = 3000;",
        "app.listen(port);"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(path.join(repoPath, "README.md"), "# demo\n", "utf8");
    runGit(repoPath, ["init", "--initial-branch=main"]);
    runGit(repoPath, ["config", "user.name", "CodingNS Test"]);
    runGit(repoPath, ["config", "user.email", "codingns@example.com"]);
    runGit(repoPath, ["add", "package.json", "server.js", "README.md"]);
    runGit(repoPath, ["commit", "-m", "feat: init repo"]);
    writeFileSync(path.join(repoPath, "README.md"), "# demo\n\nsecond line\n", "utf8");

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, repoPath, "Express Ai Block Repo");
    const targetId = await analyzeTarget(hosted, accessToken, workspaceId, repoPath, ["node server.js"]);
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const editId = launchPlanResponse.json().services[0].aiFallback.editId as string;

    const stageResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/stage",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        targets: ["README.md"]
      }
    });

    expect(stageResponse.statusCode).toBe(200);

    const blockedCommitResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/commit",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        draft: {
          subject: "feat: blocked commit",
          body: null,
          footer: null,
          source: "manual"
        }
      }
    });

    expect(blockedCommitResponse.statusCode).toBe(409);
    expect(blockedCommitResponse.json()).toMatchObject({
      error_code: "AI_FALLBACK_EDIT_BLOCKING_COMMIT"
    });

    const rejectResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/ai-fallback-edits/${editId}/reject`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        rollbackRef: "manual://reject"
      }
    });

    expect(rejectResponse.statusCode).toBe(200);
    expect(rejectResponse.json()).toMatchObject({
      id: editId,
      status: "REJECTED",
      rollbackRef: "manual://reject"
    });

    const commitResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/git/commit",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        draft: {
          subject: "feat: allow commit",
          body: null,
          footer: null,
          source: "manual"
        }
      }
    });

    expect(commitResponse.statusCode).toBe(200);
    expect(commitResponse.json()).toMatchObject({
      commitHash: expect.any(String)
    });
  }, 25000);
});

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  repoPath: string,
  name: string
): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: repoPath,
      name
    }
  });

  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function analyzeTarget(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspaceId: string,
  repoPath: string,
  commandHints: string[]
): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/debug-targets/analyze",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      workspaceId,
      rootPath: repoPath,
      commandHints
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json().target.id as string;
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const setupResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(setupResponse.statusCode).toBe(201);

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json().accessToken as string;
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 执行失败`);
  }
}
