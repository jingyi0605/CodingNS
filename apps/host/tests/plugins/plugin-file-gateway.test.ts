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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-file-gateway-"));
  const pluginRootDir = path.join(tempDir, "plugins");
  fs.mkdirSync(pluginRootDir, { recursive: true });
  const pluginInstallRoot = path.join(pluginRootDir, "demo-plugin");
  fs.mkdirSync(pluginInstallRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginInstallRoot, "index.html"), "<html><body>demo</body></html>", "utf8");
  fs.writeFileSync(path.join(pluginInstallRoot, "plugin.json"), JSON.stringify({
    id: "demo.plugin",
    name: "演示插件",
    version: "1.0.0",
    frontend: {
      entry: "index.html"
    },
    permissions: {
      workspaceRead: true,
      workspaceWrite: true
    }
  }, null, 2), "utf8");

  const workspaceRoot = path.join(tempDir, "workspace-a");
  fs.mkdirSync(path.join(workspaceRoot, "reports"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "reports", "today.txt"), "hello", "utf8");

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
  server.services.modules.pluginRegistryService.enablePlugin("demo.plugin", userId);

  const tokenId = createId();
  const accessToken = `token-${tokenId}`;
  server.services.repositories.authTokenRepository.create({
    id: tokenId,
    userId,
    tokenType: "access",
    tokenHash: hashToken(accessToken),
    deviceSessionId: null,
    callerKind: "interactive_user",
    capabilityProfile: null,
    workspaceId: null,
    projectId: null,
    sessionId: null,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    revokedAt: null,
    createdAt: now
  });

  return { server, accessToken, workspaceId, userId, workspaceRoot };
}

async function createRuntimeSession(server: ReturnType<typeof createServer>, accessToken: string, workspaceId: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/plugins/demo.plugin/runtime-sessions",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      workspaceId
    }
  });
  const payload = response.json() as { runtimeSessionId: string };
  return payload.runtimeSessionId;
}

function grantPermission(server: ReturnType<typeof createServer>, input: {
  pluginId: string;
  workspaceId: string;
  permissionKey: "workspace.read_file" | "workspace.write_file" | "workspace.list_dir";
  grantedByUserId: string;
  runtimeSessionId?: string | null;
  scopeType?: "workspace" | "directory" | "file";
  scopePath?: string | null;
}) {
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
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null
  });
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

describe("plugin-file-gateway", () => {
  it("未授权会拒绝，授权后读文件成功", async () => {
    const { server, accessToken, workspaceId, userId } = createTestServer();
    const runtimeSessionId = await createRuntimeSession(server, accessToken, workspaceId);

    const rejectResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/files/read",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId,
        path: "reports/today.txt"
      }
    });
    expect(rejectResponse.statusCode).toBe(403);
    expect(rejectResponse.json()).toMatchObject({
      error_code: "PLUGIN_PERMISSION_GRANT_REQUIRED"
    });

    grantPermission(server, {
      pluginId: "demo.plugin",
      workspaceId,
      permissionKey: "workspace.read_file",
      grantedByUserId: userId
    });

    const okResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/files/read",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId,
        path: "reports/today.txt"
      }
    });
    expect(okResponse.statusCode).toBe(200);
    expect(okResponse.json()).toMatchObject({
      path: "reports/today.txt",
      content: "hello"
    });
  }, 20000);

  it("授权后写文件成功，越界路径仍然拒绝", async () => {
    const { server, accessToken, workspaceId, userId, workspaceRoot } = createTestServer();
    const runtimeSessionId = await createRuntimeSession(server, accessToken, workspaceId);

    grantPermission(server, {
      pluginId: "demo.plugin",
      workspaceId,
      permissionKey: "workspace.write_file",
      grantedByUserId: userId,
      scopeType: "workspace",
      scopePath: null
    });

    const writeResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/files/write",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId,
        path: "reports/output.txt",
        content: "generated"
      }
    });
    expect(writeResponse.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(workspaceRoot, "reports", "output.txt"), "utf8")).toBe("generated");

    const rejectResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/files/write",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId,
        path: "../outside.txt",
        content: "bad"
      }
    });
    expect(rejectResponse.statusCode).toBe(400);
  }, 20000);

  it("目录授权后可列目录，未声明写权限会直接拒绝", async () => {
    const { server, accessToken, workspaceId, userId } = createTestServer();
    const runtimeSessionId = await createRuntimeSession(server, accessToken, workspaceId);

    grantPermission(server, {
      pluginId: "demo.plugin",
      workspaceId,
      permissionKey: "workspace.list_dir",
      grantedByUserId: userId,
      scopeType: "directory",
      scopePath: "reports"
    });

    const listResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/files/list",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId,
        path: "reports"
      }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      items: [
        expect.objectContaining({
          path: "reports/today.txt"
        })
      ]
    });

    const denyWriteResponse = await server.app.inject({
      method: "POST",
      url: "/api/plugins/demo.plugin/files/write",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        runtimeSessionId,
        path: "reports/blocked.txt",
        content: "x"
      }
    });
    expect(denyWriteResponse.statusCode).toBe(403);
    expect(denyWriteResponse.json()).toMatchObject({
      error_code: "PLUGIN_PERMISSION_GRANT_REQUIRED"
    });
  }, 20000);
});
