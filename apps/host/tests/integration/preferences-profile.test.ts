import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "../../src/shared/runtime/better-sqlite3.js";

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
  affairsDashboardStatesByWorkspace: {},
  debugPortPools: {
    start: 43000,
    end: 47999
  },
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
    },
    "deepseek-harness": {
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
          },
          "deepseek-harness": {
            defaultModel: "deepseek-official:deepseek-v4-pro",
            defaultReasoningLevel: "off"
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
        },
        "deepseek-harness": {
          defaultModel: "deepseek-official:deepseek-v4-pro",
          defaultReasoningLevel: "off"
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
        },
        "deepseek-harness": {
          defaultModel: "deepseek-official:deepseek-v4-pro",
          defaultReasoningLevel: "off"
        }
      },
      updatedAt: expect.any(String)
    });
  });

  it("保存调试端口池时只需要一个共享范围", async () => {
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
      method: "PUT",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        debugPortPools: {
          start: 48000,
          end: 48099
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      debugPortPools: {
        start: 48000,
        end: 48099
      },
      updatedAt: expect.any(String)
    });
  });

  it("保存事务工作台整份布局并在重启后保留", async () => {
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
        affairsDashboardStatesByWorkspace: {
          "workspace-1": {
            workspaceId: "workspace-1",
            version: 6,
            layoutLocked: false,
            activeTabId: "tab-2",
            tabs: [
              {
                id: "tab-1",
                title: "默认",
                widgets: [],
                layout: [],
                createdAt: "2026-06-04T10:00:00.000Z",
                updatedAt: "2026-06-04T10:00:00.000Z"
              },
              {
                id: "tab-2",
                title: "项目看板",
                widgets: [],
                layout: [],
                createdAt: "2026-06-04T10:01:00.000Z",
                updatedAt: "2026-06-04T10:01:00.000Z"
              }
            ],
            shortcutApps: [
              {
                id: "shortcut-1",
                title: "会员管理",
                sourceKind: "workspace",
                workspaceId: "workspace-2",
                sourceId: "tools/report/index.html",
                entryPath: "tools/report/index.html",
                createdAt: "2026-06-04T10:00:00.000Z",
                updatedAt: "2026-06-04T10:00:00.000Z"
              }
            ],
            updatedAt: "2026-06-04T10:01:00.000Z"
          }
        }
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      affairsDashboardStatesByWorkspace: {
        "workspace-1": {
          workspaceId: "workspace-1",
          version: 6,
          layoutLocked: false,
          activeTabId: "tab-2",
          tabs: [
            {
              id: "tab-1",
              title: "默认",
              widgets: [],
              layout: [],
              createdAt: "2026-06-04T10:00:00.000Z",
              updatedAt: "2026-06-04T10:00:00.000Z"
            },
            {
              id: "tab-2",
              title: "项目看板",
              widgets: [],
              layout: [],
              createdAt: "2026-06-04T10:01:00.000Z",
              updatedAt: "2026-06-04T10:01:00.000Z"
            }
          ],
          shortcutApps: [
            {
              id: "shortcut-1",
              title: "会员管理",
              sourceKind: "workspace",
              workspaceId: "workspace-2",
              sourceId: "tools/report/index.html",
              entryPath: "tools/report/index.html",
              createdAt: "2026-06-04T10:00:00.000Z",
              updatedAt: "2026-06-04T10:00:00.000Z"
            }
          ],
          updatedAt: "2026-06-04T10:01:00.000Z"
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
      affairsDashboardStatesByWorkspace: {
        "workspace-1": {
          workspaceId: "workspace-1",
          version: 6,
          layoutLocked: false,
          activeTabId: "tab-2",
          tabs: [
            {
              id: "tab-1",
              title: "默认",
              widgets: [],
              layout: [],
              createdAt: "2026-06-04T10:00:00.000Z",
              updatedAt: "2026-06-04T10:00:00.000Z"
            },
            {
              id: "tab-2",
              title: "项目看板",
              widgets: [],
              layout: [],
              createdAt: "2026-06-04T10:01:00.000Z",
              updatedAt: "2026-06-04T10:01:00.000Z"
            }
          ],
          shortcutApps: [
            {
              id: "shortcut-1",
              title: "会员管理",
              sourceKind: "workspace",
              workspaceId: "workspace-2",
              sourceId: "tools/report/index.html",
              entryPath: "tools/report/index.html",
              createdAt: "2026-06-04T10:00:00.000Z",
              updatedAt: "2026-06-04T10:00:00.000Z"
            }
          ],
          updatedAt: "2026-06-04T10:01:00.000Z"
        }
      },
      updatedAt: expect.any(String)
    });
  });

  it("启动时会把旧快捷应用字段迁到新版工作台状态并删除旧列", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const firstHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(firstHosted);
    await firstHosted.app.ready();
    await bootstrapAndLogin(firstHosted);
    await firstHosted.app.close();
    activeServers.pop();

    const db = new Database(databasePath);
    db.exec("ALTER TABLE user_preference_profiles ADD COLUMN affairs_shortcut_apps_json TEXT NOT NULL DEFAULT '{}'");
    const adminUser = db
      .prepare("SELECT id FROM auth_users WHERE username = ? LIMIT 1")
      .get("admin") as { id: string };
    db.prepare(
      `INSERT INTO user_preference_profiles (
        user_id,
        language,
        theme,
        auto_theme,
        default_permission_mode,
        providers_json,
        debug_port_pools_json,
        affairs_dashboard_states_json,
        affairs_shortcut_apps_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        affairs_dashboard_states_json = excluded.affairs_dashboard_states_json,
        affairs_shortcut_apps_json = excluded.affairs_shortcut_apps_json,
        updated_at = excluded.updated_at`
    ).run(
      adminUser.id,
      "zh-CN",
      "light",
      0,
      "default",
      JSON.stringify(DEFAULT_PROFILE_RESPONSE.providers),
      JSON.stringify(DEFAULT_PROFILE_RESPONSE.debugPortPools),
      JSON.stringify({
        "workspace-2": {
          workspaceId: "workspace-2",
          tabs: [
            {
              id: "tab-keep",
              title: "保留现有布局",
              widgets: [],
              layout: [],
              createdAt: "2026-06-04T09:00:00.000Z",
              updatedAt: "2026-06-04T09:00:00.000Z"
            }
          ],
          activeTabId: "tab-keep",
          shortcutApps: [],
          updatedAt: "2026-06-04T09:00:00.000Z"
        }
      }),
      JSON.stringify({
        "workspace-1": [
          {
            id: "shortcut-1",
            title: "会员管理",
            sourceKind: "workspace",
            workspaceId: "workspace-2",
            sourceId: "tools/report/index.html",
            entryPath: "tools/report/index.html",
            createdAt: "2026-06-04T10:00:00.000Z",
            updatedAt: "2026-06-04T10:00:00.000Z"
          }
        ],
        "workspace-2": [
          {
            id: "shortcut-legacy-ignored",
            title: "不该覆盖已有状态",
            sourceKind: "workspace",
            workspaceId: "workspace-2",
            sourceId: "tools/legacy/index.html",
            entryPath: "tools/legacy/index.html",
            createdAt: "2026-06-04T10:02:00.000Z",
            updatedAt: "2026-06-04T10:02:00.000Z"
          }
        ]
      }),
      "2026-06-04T10:00:00.000Z",
      "2026-06-04T10:00:00.000Z"
    );
    db.close();

    const secondHosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(secondHosted);
    await secondHosted.app.ready();

    const accessToken = await login(secondHosted);
    const response = await secondHosted.app.inject({
      method: "GET",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      affairsDashboardStatesByWorkspace: {
        "workspace-1": {
          workspaceId: "workspace-1",
          shortcutApps: [
            {
              id: "shortcut-1",
              title: "会员管理",
              sourceKind: "workspace",
              workspaceId: "workspace-2",
              sourceId: "tools/report/index.html",
              entryPath: "tools/report/index.html",
              createdAt: "2026-06-04T10:00:00.000Z",
              updatedAt: "2026-06-04T10:00:00.000Z"
            }
          ]
        },
        "workspace-2": {
          workspaceId: "workspace-2",
          tabs: [
            {
              id: "tab-keep",
              title: "保留现有布局",
              widgets: [],
              layout: [],
              createdAt: "2026-06-04T09:00:00.000Z",
              updatedAt: "2026-06-04T09:00:00.000Z"
            }
          ],
          activeTabId: "tab-keep",
          shortcutApps: [],
          updatedAt: "2026-06-04T09:00:00.000Z"
        }
      },
      updatedAt: "2026-06-04T10:00:00.000Z"
    });

    await secondHosted.app.close();
    activeServers.pop();

    const migratedDb = new Database(databasePath, { readonly: true });
    const columns = migratedDb
      .prepare("PRAGMA table_info(user_preference_profiles)")
      .all() as Array<{ name: string }>;
    migratedDb.close();

    expect(columns.some((column) => column.name === "affairs_shortcut_apps_json")).toBe(false);
  });

  it("读取旧版分角色端口池配置时会归一化成单一区间", async () => {
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
      method: "PUT",
      url: "/api/preferences/profile",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        debugPortPools: {
          frontend: { start: 43000, end: 43999 },
          backend: { start: 44000, end: 44999 },
          worker: { start: 45000, end: 45999 },
          mock: { start: 46000, end: 46999 },
          custom: { start: 47000, end: 47999 }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...DEFAULT_PROFILE_RESPONSE,
      debugPortPools: {
        start: 43000,
        end: 47999
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
