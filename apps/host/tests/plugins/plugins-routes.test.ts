import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { hashPassword, hashToken } from "../../src/shared/utils/hash.js";
import { createId } from "../../src/shared/utils/id.js";
import { createServer } from "../../src/server/create-server.js";

const startedServers: Array<ReturnType<typeof createServer>> = [];

function createTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-routes-"));
  const pluginRootDir = path.join(tempDir, "plugins");
  fs.mkdirSync(pluginRootDir, { recursive: true });
  const pluginInstallRoot = path.join(pluginRootDir, "demo-plugin");
  fs.mkdirSync(pluginInstallRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginInstallRoot, "index.html"), "<html><body>demo<script src=\"/preview/plugins/runtime-sdk.js\"></script></body></html>", "utf8");
  fs.writeFileSync(path.join(pluginInstallRoot, "action.js"), "export async function run(payload){ return { ok: true, workspaceId: payload.workspaceId, echoed: payload.input ?? null }; }", "utf8");
  fs.writeFileSync(path.join(pluginInstallRoot, "plugin.json"), JSON.stringify({
    id: "demo.plugin",
    name: "演示插件",
    version: "1.0.0",
    frontend: {
      entry: "index.html"
    },
    backend: {
      runtime: "node",
      actions: [
        {
          id: "run-report",
          title: "运行报表",
          entry: "action.js",
          timeoutMs: 3000
        }
      ]
    },
    permissions: {
      workspaceRead: true,
      desktop: ["open_file", "reveal_in_file_manager"]
    }
  }, null, 2), "utf8");

  const workspaceRoot = path.join(tempDir, "workspace-a");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "report.txt"), "hello", "utf8");

  const config = resolveHostConfig({
    databasePath: path.join(tempDir, "host.sqlite"),
    pluginRootDir,
    webUiDir: null,
    demoMode: false
  });
  const server = createServer(config);
  startedServers.push(server);

  const userId = createId();
  const workspaceId = createId();
  const now = new Date().toISOString();
  server.services.repositories.authUserRepository.create({
    id: userId,
    username: "admin",
    passwordHash: hashPassword("password123"),
    role: "admin",
    createdAt: now,
    updatedAt: now
  });
  server.services.repositories.bootstrapStateRepository.markInitialized(now, userId);
  server.services.repositories.workspaceRepository.create({
    id: workspaceId,
    name: "测试工作区",
    path: workspaceRoot,
    repoRoot: workspaceRoot,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    removedAt: null
  });

  return {
    server,
    userId,
    workspaceId,
    accessToken: issueInteractiveAccessToken(server, userId)
  };
}

async function grantPluginPermission(server: ReturnType<typeof createServer>, input: {
  pluginId: string;
  workspaceId: string;
  permissionKey: "workspace.read_file" | "desktop.open_file";
  grantedByUserId: string;
  runtimeSessionId?: string | null;
  scopeType?: "workspace" | "directory" | "file";
  scopePath?: string | null;
}) {
  const timestamp = new Date().toISOString();
  server.services.repositories.pluginPermissionGrantRepository.create({
    id: createId(),
    pluginId: input.pluginId,
    workspaceId: input.workspaceId,
    permissionKey: input.permissionKey,
    scopeType: input.scopeType ?? (input.scopePath ? "file" : "workspace"),
    scopePath: input.scopePath ?? null,
    grantMode: input.runtimeSessionId ? "session" : "persistent",
    grantedByUserId: input.grantedByUserId,
    runtimeSessionId: input.runtimeSessionId ?? null,
    createdAt: timestamp,
    expiresAt: null,
    revokedAt: null
  });
}

function issueInteractiveAccessToken(server: ReturnType<typeof createServer>, userId: string): string {
  const tokenId = createId();
  const token = `token-${tokenId}`;
  const now = new Date().toISOString();
  server.services.repositories.authTokenRepository.create({
    id: tokenId,
    userId,
    tokenType: "access",
    tokenHash: hashToken(token),
    deviceSessionId: null,
    callerKind: "interactive_user",
    capabilityProfile: null,
    workspaceId: null,
    projectId: null,
    sessionId: null,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    revokedAt: null,
    createdAt: now
  });
  return token;
}

afterEach(async () => {
  while (startedServers.length > 0) {
    const item = startedServers.pop();
    if (!item) {
      continue;
    }
    await item.app.close();
  }
});

describe("plugin routes", () => {
  it("能列出和切换插件状态", async () => {
    const { server, accessToken } = createTestServer();

    const listResponse = await server.app.inject({
      method: "GET",
      url: "/api/plugins",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as { items: Array<{ id: string; enabled: boolean }> };
    expect(listPayload.items[0]?.id).toBe("demo.plugin");
    expect(listPayload.items[0]?.enabled).toBe(false);

    const enableResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(enableResponse.statusCode).toBe(200);

    const getResponse = await server.app.inject({
      method: "GET",
      url: "/api/plugins/demo.plugin",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(getResponse.statusCode).toBe(200);
    const getPayload = getResponse.json() as {
      enablement: { enabled: boolean };
      frontend: { entryUrl: string } | null;
    };
    expect(getPayload.enablement.enabled).toBe(true);
    expect(getPayload.frontend?.entryUrl).toContain("/preview/plugins/demo.plugin/frontend/index.html");
  }, 20000);

  it("能创建运行实例、执行动作，并在关闭后拒绝继续调用", async () => {
    const { server, accessToken, workspaceId, userId } = createTestServer();

    await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const createSessionResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/runtime-sessions",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId
      }
    });
    expect(createSessionResponse.statusCode).toBe(200);
    const createSessionPayload = createSessionResponse.json() as {
      runtimeSessionId: string;
      session: { workspaceId: string; status: string };
    };
    expect(createSessionPayload.session.workspaceId).toBe(workspaceId);
    expect(createSessionPayload.session.status).toBe("active");

    await grantPluginPermission(server, {
      pluginId: "demo.plugin",
      workspaceId,
      permissionKey: "workspace.read_file",
      grantedByUserId: userId
    });

    const actionResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/actions/run-report",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId: createSessionPayload.runtimeSessionId,
        input: {
          range: "today"
        }
      }
    });

    expect(actionResponse.statusCode).toBe(200);
    const actionPayload = actionResponse.json() as {
      run: { status: string; workspaceId: string };
      output: { ok: boolean; workspaceId: string; echoed: { range: string } };
    };
    expect(actionPayload.run.status).toBe("succeeded");
    expect(actionPayload.run.runtimeSessionId).toBe(createSessionPayload.runtimeSessionId);
    expect(actionPayload.output.ok).toBe(true);
    expect(actionPayload.output.workspaceId).toBe(workspaceId);

    const closeSessionResponse = await server.app.inject({
      method: "POST",
      url: `/api/plugins/demo.plugin/runtime-sessions/${createSessionPayload.runtimeSessionId}/close`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(closeSessionResponse.statusCode).toBe(200);

    const closedActionResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/actions/run-report",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId: createSessionPayload.runtimeSessionId,
        input: {
          range: "tomorrow"
        }
      }
    });
    expect(closedActionResponse.statusCode).toBe(409);

    const runsResponse = await server.app.inject({
      method: "GET",
      url: "/api/plugins/demo.plugin/runs",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(runsResponse.statusCode).toBe(200);
    const runsPayload = runsResponse.json() as { items: Array<{ actionId: string; status: string }> };
    expect(runsPayload.items[0]?.actionId).toBe("run-report");
    expect(runsPayload.items[0]?.status).toBe("succeeded");
  }, 20000);

  it("插件桌面动作会先做工作区内路径校验", async () => {
    const { server, accessToken, workspaceId, userId } = createTestServer();

    await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const createSessionResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/runtime-sessions",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId
      }
    });
    const createSessionPayload = createSessionResponse.json() as { runtimeSessionId: string };

    await grantPluginPermission(server, {
      pluginId: "demo.plugin",
      workspaceId,
      permissionKey: "desktop.open_file",
      grantedByUserId: userId,
      runtimeSessionId: createSessionPayload.runtimeSessionId,
      scopeType: "workspace",
      scopePath: null
    });

    const okResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/desktop/open-file",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId: createSessionPayload.runtimeSessionId,
        path: "report.txt"
      }
    });
    expect(okResponse.statusCode).toBe(200);
    const okPayload = okResponse.json() as { relativePath: string; absolutePath: string };
    expect(okPayload.relativePath).toBe("report.txt");
    expect(okPayload.absolutePath).toContain("report.txt");

    const rejectResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/desktop/open-file",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId: createSessionPayload.runtimeSessionId,
        path: "../outside.txt"
      }
    });
    expect(rejectResponse.statusCode).toBe(400);
  }, 20000);

  it("能创建、列出并撤销当前工作区的插件授权", async () => {
    const { server, accessToken, workspaceId } = createTestServer();

    await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const createSessionResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/runtime-sessions",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId
      }
    });
    const createSessionPayload = createSessionResponse.json() as { runtimeSessionId: string };

    const createGrantResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/permissions/grants",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId: createSessionPayload.runtimeSessionId,
        permissionKey: "desktop.open_file",
        scopeType: "directory",
        scopePath: "reports",
        grantMode: "persistent"
      }
    });
    expect(createGrantResponse.statusCode).toBe(200);
    const createGrantPayload = createGrantResponse.json() as {
      id: string;
      permissionKey: string;
      scopeType: string;
      scopePath: string | null;
      grantMode: string;
      runtimeSessionId: string | null;
      revokedAt: string | null;
    };
    expect(createGrantPayload).toMatchObject({
      permissionKey: "desktop.open_file",
      scopeType: "directory",
      scopePath: "reports",
      grantMode: "persistent",
      runtimeSessionId: null,
      revokedAt: null
    });

    const listResponse = await server.app.inject({
      method: "GET",
      url: `/api/plugins/demo.plugin/permissions/grants?workspaceId=${encodeURIComponent(workspaceId)}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as {
      items: Array<{ id: string; permissionKey: string; scopePath: string | null }>;
    };
    expect(listPayload.items).toContainEqual(expect.objectContaining({
      id: createGrantPayload.id,
      permissionKey: "desktop.open_file",
      scopePath: "reports"
    }));

    const revokeResponse = await server.app.inject({
      method: "POST",
      url: `/api/plugins/demo.plugin/permissions/grants/${encodeURIComponent(createGrantPayload.id)}/revoke`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId
      }
    });
    expect(revokeResponse.statusCode).toBe(200);
    const revokePayload = revokeResponse.json() as { id: string; revokedAt: string | null };
    expect(revokePayload.id).toBe(createGrantPayload.id);
    expect(revokePayload.revokedAt).toBeTruthy();

    const listAfterRevokeResponse = await server.app.inject({
      method: "GET",
      url: `/api/plugins/demo.plugin/permissions/grants?workspaceId=${encodeURIComponent(workspaceId)}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(listAfterRevokeResponse.statusCode).toBe(200);
    const listAfterRevokePayload = listAfterRevokeResponse.json() as {
      items: Array<{ id: string }>;
    };
    expect(listAfterRevokePayload.items.some((item) => item.id === createGrantPayload.id)).toBe(false);
  }, 20000);

  it("插件桌面动作已声明但未授权时返回正式可提示错误", async () => {
    const { server, accessToken, workspaceId } = createTestServer();

    await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const createSessionResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/runtime-sessions",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId
      }
    });
    const createSessionPayload = createSessionResponse.json() as { runtimeSessionId: string };

    const response = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/desktop/open-file",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId: createSessionPayload.runtimeSessionId,
        path: "report.txt"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error_code: "PLUGIN_PERMISSION_GRANT_REQUIRED",
      data: {
        permissionKey: "desktop.open_file",
        scopePath: "report.txt"
      }
    });
  }, 20000);

  it("插件静态资源走独立链路，禁用后不可访问", async () => {
    const { server, accessToken } = createTestServer();

    await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const assetResponse = await server.app.inject({
      method: "GET",
      url: "/preview/plugins/demo.plugin/frontend/index.html"
    });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-security-policy"]).toContain("default-src 'none'");

    const sdkResponse = await server.app.inject({
      method: "GET",
      url: "/preview/plugins/runtime-sdk.js"
    });
    expect(sdkResponse.statusCode).toBe(200);
    expect(sdkResponse.body).toContain("window.CodingNSPlugin");

    await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/disable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const disabledResponse = await server.app.inject({
      method: "GET",
      url: "/preview/plugins/demo.plugin/frontend/index.html"
    });
    expect(disabledResponse.statusCode).toBe(403);
  }, 20000);
});
