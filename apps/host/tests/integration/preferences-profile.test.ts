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

const DEFAULT_PROFILE_RESPONSE = {
  language: "zh-CN",
  theme: "light",
  autoTheme: false,
  defaultPermissionMode: "default",
  providers: {
    "claude-code": {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    codex: {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    opencode: {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    gemini: {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    kimi: {
      defaultModel: null,
      defaultReasoningLevel: null
    }
  },
  updatedAt: null
} as const;

describe("偏好 profile 接口", () => {
  it("未授权的请求会被拒绝", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    const getResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/preferences/profile"
    });

    expect(getResponse.statusCode).toBe(401);

    const putResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/preferences/profile",
      payload: {
        language: "en-US"
      }
    });

    expect(putResponse.statusCode).toBe(401);
  });

  it("没有记录时会返回规范化默认结构", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(DEFAULT_PROFILE_RESPONSE);
  });

  it("保存语言、主题和默认会话权限", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const updateResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        language: "en-US",
        theme: "dark",
        autoTheme: true,
        defaultPermissionMode: "bypassPermissions"
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      language: "en-US",
      theme: "dark",
      autoTheme: true,
      defaultPermissionMode: "bypassPermissions",
      updatedAt: expect.any(String)
    });

    const getResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      language: "en-US",
      theme: "dark",
      autoTheme: true,
      defaultPermissionMode: "bypassPermissions",
      updatedAt: expect.any(String)
    });
  });

  it("保存 provider 偏好并在重启后保留", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const firstHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(firstHosted);
    await firstHosted.app.ready();

    const accessToken = await bootstrapAndLogin(firstHosted);
    const updateResponse = await firstHosted.app.inject({
      method: "PUT",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providers: {
          "claude-code": {
            defaultModel: "sonnet",
            defaultReasoningLevel: "low"
          },
          codex: {
            defaultReasoningLevel: "xhigh"
          }
        }
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      providers: {
        ...DEFAULT_PROFILE_RESPONSE.providers,
        "claude-code": {
          defaultModel: "sonnet",
          defaultReasoningLevel: "low"
        },
        codex: {
          defaultModel: null,
          defaultReasoningLevel: "xhigh"
        }
      },
      updatedAt: expect.any(String)
    });

    await firstHosted.app.close();
    activeServers.pop();

    const secondHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(secondHosted);
    await secondHosted.app.ready();

    const secondAccessToken = await login(secondHosted);
    const getResponse = await secondHosted.app.inject({
      method: "GET",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${secondAccessToken}`
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      providers: {
        ...DEFAULT_PROFILE_RESPONSE.providers,
        "claude-code": {
          defaultModel: "sonnet",
          defaultReasoningLevel: "low"
        },
        codex: {
          defaultModel: null,
          defaultReasoningLevel: "xhigh"
        }
      },
      updatedAt: expect.any(String)
    });
  });

  it("非法输入返回 400", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const languageResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        language: "fr-FR"
      }
    });

    expect(languageResponse.statusCode).toBe(400);
    expect(languageResponse.json().error_code).toBe("INVALID_INPUT");
    expect(languageResponse.json().field).toBe("language");

    const providerResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providers: {
          unknown: {
            defaultModel: "test"
          }
        }
      }
    });

    expect(providerResponse.statusCode).toBe(400);
    expect(providerResponse.json().error_code).toBe("INVALID_INPUT");
    expect(providerResponse.json().field).toBe("providers");
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return await login(hosted);
}

async function login(hosted: ReturnType<typeof createTestApp>): Promise<string> {
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
