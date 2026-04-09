import fs from "node:fs";
import path from "node:path";

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
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("butler profile routes", () => {
  it("未初始化时返回 initialized=false，初始化后可持久化读取", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const butlerWorkspace = path.join(fixture.rootDir, "butler-workspace");
    const agentsFilePath = path.join(butlerWorkspace, "AGENTS.md");
    activeFixtures.push(fixture);
    fs.mkdirSync(butlerWorkspace, { recursive: true });
    fs.writeFileSync(agentsFilePath, "# AGENTS.md\n你是代码助手。\n", "utf8");

    const firstHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(firstHosted);
    await firstHosted.app.ready();

    const accessToken = await bootstrapAndLogin(firstHosted);
    const emptyResponse = await firstHosted.app.inject({
      method: "GET",
      url: "/api/butler/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(emptyResponse.statusCode).toBe(200);
    expect(emptyResponse.json()).toEqual({
      initialized: false,
      profile: null
    });

    const initResponse = await firstHosted.app.inject({
      method: "POST",
      url: "/api/butler/profile/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "file",
        agentsFilePath,
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk", "blocker", "verification"],
          summaryDebounceSeconds: 300
        }
      }
    });

    expect(initResponse.statusCode).toBe(201);
    expect(initResponse.json()).toMatchObject({
      initialized: true,
      profile: {
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "file",
        agentsFilePath,
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk", "blocker", "verification"]
        }
      }
    });
    expect(initResponse.json().profile.agentsContent).toContain("你是代码助手「阿尔文」。");

    await firstHosted.app.close();
    activeServers.pop();

    const secondHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(secondHosted);
    await secondHosted.app.ready();

    const secondAccessToken = await login(secondHosted);
    const persistedResponse = await secondHosted.app.inject({
      method: "GET",
      url: "/api/butler/profile",
      headers: {
        authorization: `Bearer ${secondAccessToken}`
      }
    });

    expect(persistedResponse.statusCode).toBe(200);
    expect(persistedResponse.json()).toMatchObject({
      initialized: true,
      profile: {
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "file",
        agentsFilePath
      }
    });
  });

  it("重复初始化会返回明确错误", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const butlerWorkspace = path.join(fixture.rootDir, "butler-workspace");
    const agentsFilePath = path.join(butlerWorkspace, "AGENTS.md");
    activeFixtures.push(fixture);
    fs.mkdirSync(butlerWorkspace, { recursive: true });
    fs.writeFileSync(agentsFilePath, "# AGENTS.md\n你是代码助手。\n", "utf8");

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);

    await hosted.app.inject({
      method: "POST",
      url: "/api/butler/profile/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "file",
        agentsFilePath,
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk"]
        }
      }
    });

    const duplicateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/butler/profile/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: "贝拉",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "file",
        agentsFilePath,
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk"]
        }
      }
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toMatchObject({
      error_code: "BUTLER_PROFILE_ALREADY_INITIALIZED"
    });
  });

  it("初始化后可以更新指令模式和关注重点，provider 固定为 codex", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const butlerWorkspace = path.join(fixture.rootDir, "butler-workspace");
    const agentsFilePath = path.join(butlerWorkspace, "AGENTS.md");
    activeFixtures.push(fixture);
    fs.mkdirSync(butlerWorkspace, { recursive: true });
    fs.writeFileSync(agentsFilePath, "# AGENTS.md\n你是代码助手。\n", "utf8");

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);

    await hosted.app.inject({
      method: "POST",
      url: "/api/butler/profile/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "file",
        agentsFilePath,
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk"]
        }
      }
    });

    const updateResponse = await hosted.app.inject({
      method: "PATCH",
      url: "/api/butler/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providerId: "codex",
        agentsMode: "inline",
        agentsContent: "# AGENTS.md\n你现在按风险优先汇报。",
        focus: {
          projectIds: ["project-1"],
          riskPreference: "proactive",
          reportPriority: ["verification", "risk"]
        }
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      initialized: true,
      profile: {
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: butlerWorkspace,
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "# AGENTS.md\n你现在按风险优先汇报。",
        focus: {
          projectIds: ["project-1"],
          riskPreference: "proactive",
          reportPriority: ["verification", "risk"]
        }
      }
    });
  });

  it("未初始化时不允许更新，非法 provider 会返回 400", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const butlerWorkspace = path.join(fixture.rootDir, "butler-workspace");
    activeFixtures.push(fixture);
    fs.mkdirSync(butlerWorkspace, { recursive: true });

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const patchBeforeInit = await hosted.app.inject({
      method: "PATCH",
      url: "/api/butler/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providerId: "codex"
      }
    });

    expect(patchBeforeInit.statusCode).toBe(409);
    expect(patchBeforeInit.json()).toMatchObject({
      error_code: "BUTLER_PROFILE_NOT_INITIALIZED"
    });

    const invalidInit = await hosted.app.inject({
      method: "POST",
      url: "/api/butler/profile/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providerId: "opencode",
        workspacePath: butlerWorkspace,
        agentsMode: "inline",
        agentsContent: "# AGENTS.md\n你是代码助手。",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk"]
        }
      }
    });

    expect(invalidInit.statusCode).toBe(400);
    expect(invalidInit.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      field: "providerId"
    });
  });
});

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
  return await login(hosted);
}

async function login(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json<{ accessToken: string }>().accessToken;
}
