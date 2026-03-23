import { afterEach, describe, expect, it } from "vitest";

import { createId } from "../../src/shared/utils/id.js";
import { nowIso } from "../../src/shared/utils/time.js";
import { WsAuthGuard } from "../../src/ws/ws-auth-guard.js";
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

describe("spec001 host 地基主链路", () => {
  it("完成 bootstrap -> login -> protected api -> refresh -> logout", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

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
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    hosted.services.repositories.sessionBindingRepository.upsert({
      sessionId,
      workspaceId,
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "codex://provider-session-1",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    hosted.services.repositories.sessionIndexRepository.upsert({
      sessionId,
      workspaceId,
      provider: "codex",
      title: "会话索引示例",
      messageCount: 0,
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    hosted.services.repositories.sessionStatusSnapshotRepository.upsert({
      sessionId,
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: timestamp,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
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
    expect(sessionsResponse.json().items).toHaveLength(1);
    expect(sessionsResponse.json().items[0].providerSessionId).toBe("provider-session-1");
    expect(sessionsResponse.json().items[0].rawStoreRef).toBe("codex://provider-session-1");

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
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
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

  it("会话数据库边界只保留映射、索引和状态快照", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const sqliteTables = hosted.services.database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = sqliteTables.map((item) => item.name);

    expect(tableNames).toContain("session_bindings");
    expect(tableNames).toContain("session_indices");
    expect(tableNames).toContain("session_status_snapshots");
    expect(tableNames).not.toContain("session_messages");
    expect(tableNames).not.toContain("raw_messages");
  });
});
