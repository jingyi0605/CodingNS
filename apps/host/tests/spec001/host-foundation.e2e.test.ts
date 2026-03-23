import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { createId } from "../../src/shared/utils/id.js";
import { nowIso } from "../../src/shared/utils/time.js";
import { createServer } from "../../src/server/create-server.js";
import { WsAuthGuard } from "../../src/ws/ws-auth-guard.js";

const activeServers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }
});

describe("spec001 host 地基主链路", () => {
  it("完成 bootstrap -> login -> protected api -> refresh -> logout", async () => {
    const hosted = await createTestHost();

    const bootstrapStatus = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status"
    });
    expect(bootstrapStatus.statusCode).toBe(200);
    expect(bootstrapStatus.json()).toEqual({ initialized: false });

    const unauthorizedBeforeSetup = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces"
    });
    expect(unauthorizedBeforeSetup.statusCode).toBe(403);
    expect(unauthorizedBeforeSetup.json().error_code).toBe("BOOTSTRAP_REQUIRED");

    const setupResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });
    expect(setupResponse.statusCode).toBe(201);
    expect(setupResponse.json().initialized).toBe(true);

    const repeatedSetup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });
    expect(repeatedSetup.statusCode).toBe(409);
    expect(repeatedSetup.json().error_code).toBe("BOOTSTRAP_ALREADY_DONE");

    const anonymousAfterSetup = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces"
    });
    expect(anonymousAfterSetup.statusCode).toBe(401);
    expect(anonymousAfterSetup.json().error_code).toBe("UNAUTHORIZED");

    const loginResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });
    expect(loginResponse.statusCode).toBe(200);
    const loginBody = loginResponse.json();
    expect(loginBody.user.username).toBe("admin");

    const workspaceId = createId();
    const sessionId = createId();
    const timestamp = nowIso();

    hosted.services.repositories.workspaceRepository.create({
      id: workspaceId,
      name: "默认工作区",
      path: "C:\\Code\\CodingNS",
      repoRoot: "C:\\Code\\CodingNS",
      favorite: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    hosted.services.repositories.sessionIndexRepository.create({
      id: sessionId,
      workspaceId,
      provider: "codex",
      providerSessionId: "provider-session-1",
      title: "会话索引示例",
      status: "idle",
      lastMessageAt: timestamp,
      rawRef: "codex://provider-session-1",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const workspacesResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`
      }
    });
    expect(workspacesResponse.statusCode).toBe(200);
    expect(workspacesResponse.json().items).toHaveLength(1);

    const sessionsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`
      }
    });
    expect(sessionsResponse.statusCode).toBe(200);
    expect(sessionsResponse.json().items[0].rawRef).toBe("codex://provider-session-1");

    const refreshResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refreshToken: loginBody.refreshToken
      }
    });
    expect(refreshResponse.statusCode).toBe(200);
    const refreshBody = refreshResponse.json();
    expect(refreshBody.accessToken).not.toBe(loginBody.accessToken);

    const logoutResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`
      },
      payload: {
        refreshToken: refreshBody.refreshToken
      }
    });
    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ success: true });

    const deniedAfterLogout = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`
      }
    });
    expect(deniedAfterLogout.statusCode).toBe(401);
  });

  it("统一拦截错误的 WebSocket 握手", async () => {
    const hosted = await createTestHost();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    const loginResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });
    const loginBody = loginResponse.json();

    const wsAuthGuard = new WsAuthGuard(hosted.services.modules.authService);

    const okContext = wsAuthGuard.authenticate({
      headers: {},
      url: `/ws?access_token=${loginBody.accessToken}`
    } as never);
    expect(okContext.user.username).toBe("admin");

    expect(() =>
      wsAuthGuard.authenticate({
        headers: {},
        url: "/ws"
      } as never)
    ).toThrow("WebSocket 缺少 access token");

    expect(() =>
      wsAuthGuard.authenticate({
        headers: {},
        url: "/ws?access_token=bad-token"
      } as never)
    ).toThrow("access token 无效");
  });

  it("会话消息读取必须经过 provider gateway，且只更新状态快照", async () => {
    const hosted = await createTestHost({
      providerReaders: {
        codex: {
          readHistory: async ({ session, cursor, limit }) => ({
            items: [
              {
                id: `${session.providerSessionId}-1`,
                role: "assistant",
                content: `cursor=${cursor ?? "null"} limit=${limit}`,
                timestamp: nowIso(),
                rawRef: `${session.rawRef}#1`
              }
            ],
            nextCursor: "cursor-2"
          })
        }
      }
    });

    const loginBody = await bootstrapAndLogin(hosted);
    const seeded = seedWorkspaceAndSession(hosted);

    const messagesResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${seeded.sessionId}/messages?limit=20`,
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`
      }
    });

    expect(messagesResponse.statusCode).toBe(200);
    expect(messagesResponse.json().items[0].rawRef).toBe("codex://provider-session-1#1");
    expect(messagesResponse.json().nextCursor).toBe("cursor-2");

    const state = hosted.services.repositories.sessionStateRepository.findBySessionId(
      seeded.sessionId
    );
    expect(state?.syncCursor).toBe("cursor-2");
    expect(state?.syncErrorCode).toBeNull();

    const sqliteTables = hosted.services.database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = sqliteTables.map((item) => item.name);

    expect(tableNames).toContain("session_indexes");
    expect(tableNames).toContain("session_states");
    expect(tableNames).not.toContain("session_messages");
    expect(tableNames).not.toContain("raw_messages");
  });
});

async function createTestHost(overrides?: Parameters<typeof createServer>[1]) {
  const hosted = createServer(
    resolveHostConfig({
      databasePath: ":memory:",
      accessTokenTtlSeconds: 2,
      refreshTokenTtlSeconds: 30
    }),
    overrides
  );

  activeServers.push(hosted);
  await hosted.app.ready();

  return hosted;
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createServer>) {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return response.json();
}

function seedWorkspaceAndSession(hosted: ReturnType<typeof createServer>) {
  const workspaceId = createId();
  const sessionId = createId();
  const timestamp = nowIso();

  hosted.services.repositories.workspaceRepository.create({
    id: workspaceId,
    name: "默认工作区",
    path: "C:\\Code\\CodingNS",
    repoRoot: "C:\\Code\\CodingNS",
    favorite: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  hosted.services.repositories.sessionIndexRepository.create({
    id: sessionId,
    workspaceId,
    provider: "codex",
    providerSessionId: "provider-session-1",
    title: "消息读取示例",
    status: "idle",
    lastMessageAt: timestamp,
    rawRef: "codex://provider-session-1",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return {
    workspaceId,
    sessionId
  };
}
