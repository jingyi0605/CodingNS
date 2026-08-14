import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HostApiProxyService } from "../../src/modules/peer-host/host-api-proxy-service.js";
import {
  HostHandshakeService,
  PEER_HOST_API_COMPATIBILITY,
} from "../../src/modules/peer-host/host-handshake.js";
import { HostHandshakeController } from "../../src/modules/peer-host/host-handshake-controller.js";
import {
  HostApiProxyController,
  PeerHostController,
} from "../../src/modules/peer-host/peer-host-controller.js";
import { PeerHostService } from "../../src/modules/peer-host/peer-host-service.js";
import { registerPeerHostRoutes } from "../../src/routes/peer-hosts.js";
import { registerPublicRoutes } from "../../src/routes/public.js";
import { readHostPackageVersion } from "../../src/modules/client/client-service.js";
import { encryptSecret } from "../../src/shared/utils/secret-box.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "../../src/storage/sqlite/client.js";
import {
  PeerHostRepository,
  PeerHostSessionRepository,
} from "../../src/storage/repositories/peer-host-repository.js";
import type {
  PeerHostRecord,
  PeerHostSessionRecord,
} from "../../src/types/domain.js";
import { SESSION_MESSAGE_BODY_LIMIT_BYTES } from "../../src/routes/body-limits.js";

const USER_ID = "user-1";
const SECRET = "peer-host-test-secret";

describe("Peer HOST 后端路由", () => {
  const apps: FastifyInstance[] = [];
  const databases: DatabaseClient[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }

    while (databases.length > 0) {
      databases.pop()?.close();
    }
  });

  it("公开握手接口返回产品、版本和 API 兼容标识", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    await registerPublicRoutes(
      app,
      {
        getStatus: async (_request, reply) => reply.send({ initialized: true }),
        setup: async (_request, reply) => reply.send({ success: true }),
      } as never,
      {
        handleWebhook: async (_request, reply) => reply.send({ success: true }),
      } as never,
      new HostHandshakeController(new HostHandshakeService()),
    );
    app.setErrorHandler(setErrorHandler);

    const response = await app.inject({
      method: "GET",
      url: "/api/public/host-handshake",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      product: "CodingNS",
      version: readHostPackageVersion(),
      apiCompatibility: PEER_HOST_API_COMPATIBILITY,
      hostFingerprint: null,
    });
    expect(typeof response.json().time).toBe("string");
  });

  it("检查 Peer HOST 时会把版本不一致写成 version_mismatch", async () => {
    const { app } = await createPeerHostApp({
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              product: "CodingNS",
              version: "9.9.9",
              apiCompatibility: PEER_HOST_API_COMPATIBILITY,
              hostFingerprint: null,
              time: "2026-06-09T00:00:00.000Z",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ) as typeof fetch,
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/peer-hosts",
      payload: {
        name: "远端 HOST",
        baseUrl: "http://peer.example:3002/",
      },
    });
    const peerHostId = createResponse.json().id as string;

    const checkResponse = await app.inject({
      method: "POST",
      url: `/api/peer-hosts/${peerHostId}/check`,
    });

    expect(checkResponse.statusCode).toBe(200);
    expect(checkResponse.json()).toMatchObject({
      id: peerHostId,
      status: "version_mismatch",
      remoteVersion: "9.9.9",
      remoteApiCompatibility: PEER_HOST_API_COMPATIBILITY,
      lastErrorCode: "PEER_HOST_VERSION_MISMATCH",
    });
  });

  it("代理入口拒绝认证等敏感路径", async () => {
    const { app, peerHostRepository } = await createPeerHostApp({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const peerHost = createReachablePeerHost(peerHostRepository);
    const deniedCases = [
      {
        path: "/api/auth/users",
        deniedPrefix: "/api/auth",
      },
      {
        path: "/api/public/host-handshake",
        deniedPrefix: "/api/public",
      },
      {
        path: "/api/peer-hosts",
        deniedPrefix: "/api/peer-hosts",
      },
      {
        path: "/api/host-proxy/hosts/peer-host-2/api/workspaces",
        deniedPrefix: "/api/host-proxy",
      },
    ] as const;

    for (const item of deniedCases) {
      const response = await app.inject({
        method: "GET",
        url: `/api/host-proxy/hosts/${peerHost.id}${item.path}`,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error_code: "HOST_PROXY_PATH_NOT_ALLOWED",
        data: {
          method: "GET",
          pathname: item.path,
          deniedPrefix: item.deniedPrefix,
        },
      });
    }
  });

  it("代理入口路由配置应该显式放宽 bodyLimit", async () => {
    const route = vi.fn();
    const app = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      route,
    };
    const peerHostController = {
      list: vi.fn(),
      create: vi.fn(),
      listWorkspaceBindings: vi.fn(),
      saveWorkspaceBinding: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      check: vi.fn(),
      reconnect: vi.fn(),
      login: vi.fn(),
      deleteSession: vi.fn(),
    };
    const hostApiProxyController = {
      proxy: vi.fn(),
    };

    await registerPeerHostRoutes(
      app as never,
      peerHostController as never,
      hostApiProxyController as never,
    );

    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/host-proxy/hosts/:peerHostId/*",
        bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES,
        handler: hostApiProxyController.proxy,
      }),
    );
  });

  it("代理入口允许普通业务 API 自动转发，不再按路径维护白名单", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL) =>
        new Response(JSON.stringify({ url: String(url), ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(
      peerHostSessionRepository,
      peerHost.id,
      "target-token",
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/skills/overview`,
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/skills/overview",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("代理允许读取 Peer HOST 资源和 runtime 配置", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL) =>
        new Response(JSON.stringify({ url: String(url), ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(peerHostSessionRepository, peerHost.id, "target-token");

    const resourcesResponse = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/system/host/resources`,
    });
    const runtimeResponse = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/client/runtime-config?platform=desktop`,
    });

    expect(resourcesResponse.statusCode).toBe(200);
    expect(runtimeResponse.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/system/host/resources",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/client/runtime-config?platform=desktop",
      expect.any(Object),
    );
  });

  it("代理连接不上 Peer HOST 时返回明确的不可达错误", async () => {
    const fetchMock = vi.fn(async () => {
      const cause = Object.assign(new Error("connect ECONNREFUSED 10.255.0.85:3009"), {
        code: "ECONNREFUSED",
      });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(peerHostSessionRepository, peerHost.id, "target-token");

    const response = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/workbench`,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error_code: "PEER_HOST_PROXY_UNREACHABLE",
      data: {
        peerHostId: peerHost.id,
        targetUrl: "http://peer.example:3002/api/workbench",
        causeCode: "ECONNREFUSED",
      },
    });
  });

  it("代理访问目标 HOST 时使用保存的目标 token，而不是当前 HOST token", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(
      peerHostSessionRepository,
      peerHost.id,
      "target-token",
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/workspaces?scope=all`,
      headers: {
        authorization: "Bearer current-host-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/workspaces?scope=all",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit)
      .headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer target-token");
  });

  it("代理允许读取 Peer HOST 会话的 Butler 操作上下文", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL) =>
        new Response(JSON.stringify({ url: String(url), canStart: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(peerHostSessionRepository, peerHost.id, "target-token");

    const response = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/butler/session-action-context?sessionId=session-1`,
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/butler/session-action-context?sessionId=session-1",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );
  });

  it("代理允许向 Peer HOST 创建 Butler 后续任务", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, body: init?.body }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(peerHostSessionRepository, peerHost.id, "target-token");

    const response = await app.inject({
      method: "POST",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/butler/follow-up-tasks`,
      payload: {
        sessionId: "session-1",
        prompt: "继续处理",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/butler/follow-up-tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          prompt: "继续处理",
        }),
      }),
    );
  });

  it("代理入口对大消息请求显式放宽 bodyLimit", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, size: String(init?.body).length }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(peerHostSessionRepository, peerHost.id, "target-token");
    const oversizedButAllowed = "x".repeat(2 * 1024 * 1024);

    const response = await app.inject({
      method: "POST",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/sessions/session-1/messages/live`,
      payload: {
        content: oversizedButAllowed,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peer.example:3002/api/sessions/session-1/messages/live",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          content: oversizedButAllowed,
        }),
      }),
    );
    expect(SESSION_MESSAGE_BODY_LIMIT_BYTES).toBeGreaterThan(oversizedButAllowed.length);
  });

  it("代理访问前发现目标 token 快过期时会刷新并使用新 token", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const targetUrl = String(url);

      if (targetUrl.endsWith("/api/auth/refresh")) {
        return new Response(
          JSON.stringify({
            accessToken: "target-token-next",
            refreshToken: "refresh-token-next",
            expiresIn: 3600,
            user: {
              userId: "remote-user-1",
              username: "remote-admin",
              role: "admin",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(
      peerHostSessionRepository,
      peerHost.id,
      "target-token-old",
      {
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      },
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/workspaces`,
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://peer.example:3002/api/auth/refresh",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://peer.example:3002/api/workspaces",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const headers = (fetchMock.mock.calls[1]?.[1] as RequestInit)
      .headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer target-token-next");
  });

  it("目标 token 刷新失败时会删除保存的目标登录态", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: "refresh token 无效",
            error_code: "TOKEN_INVALID",
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;
    const { app, peerHostRepository, peerHostSessionRepository } =
      await createPeerHostApp({
        fetchImpl: fetchMock,
      });
    const peerHost = createReachablePeerHost(peerHostRepository);
    createPeerHostSession(
      peerHostSessionRepository,
      peerHost.id,
      "target-token-old",
      {
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      },
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/host-proxy/hosts/${peerHost.id}/api/workspaces`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "PEER_HOST_SESSION_INVALID",
    });
    expect(peerHostSessionRepository.find(peerHost.id, USER_ID)).toBeNull();
  });

  async function createPeerHostApp(input: {
    fetchImpl: typeof fetch;
  }): Promise<{
    app: FastifyInstance;
    peerHostRepository: PeerHostRepository;
    peerHostSessionRepository: PeerHostSessionRepository;
  }> {
    const database = createDatabaseClient(":memory:");
    databases.push(database);
    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        USER_ID,
        "admin",
        "unused",
        "admin",
        "active",
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const peerHostRepository = new PeerHostRepository(database.db);
    const peerHostSessionRepository = new PeerHostSessionRepository(
      database.db,
    );
    const peerHostService = new PeerHostService(
      peerHostRepository,
      peerHostSessionRepository,
      SECRET,
      input.fetchImpl,
    );
    const hostApiProxyService = new HostApiProxyService(
      peerHostService,
      input.fetchImpl,
    );
    const app = Fastify({ logger: false });
    apps.push(app);

    app.addHook("onRequest", async (request) => {
      request.auth = {
        accessToken: "current-host-token",
        accessTokenId: "access-token-1",
        deviceSessionId: null,
        deviceId: null,
        callerKind: "interactive_user",
        capabilityProfile: null,
        workspaceId: null,
        projectId: null,
        sessionId: null,
        user: {
          userId: USER_ID,
          username: "admin",
          role: "admin",
        },
      };
    });
    await registerPeerHostRoutes(
      app,
      new PeerHostController(peerHostService),
      new HostApiProxyController(hostApiProxyService),
    );
    app.setErrorHandler(setErrorHandler);

    return { app, peerHostRepository, peerHostSessionRepository };
  }
});

function createReachablePeerHost(
  peerHostRepository: PeerHostRepository,
): PeerHostRecord {
  const now = new Date().toISOString();
  return peerHostRepository.create({
    id: "peer-host-1",
    ownerUserId: USER_ID,
    name: "远端 HOST",
    alias: "PEER",
    baseUrl: "http://peer.example:3002",
    normalizedBaseUrl: "http://peer.example:3002",
    status: "reachable",
    remoteVersion: readHostPackageVersion(),
    remoteApiCompatibility: PEER_HOST_API_COMPATIBILITY,
    remoteHostFingerprint: null,
    lastCheckedAt: now,
    lastErrorCode: null,
    lastErrorDetail: null,
    createdAt: now,
    updatedAt: now,
    removedAt: null,
  });
}

function createPeerHostSession(
  peerHostSessionRepository: PeerHostSessionRepository,
  peerHostId: string,
  accessToken: string,
  overrides: Partial<PeerHostSessionRecord> = {},
): PeerHostSessionRecord {
  const now = new Date().toISOString();
  return peerHostSessionRepository.upsert({
    peerHostId,
    ownerUserId: USER_ID,
    username: "remote-admin",
    accessTokenEncrypted: encryptSecret(SECRET, accessToken),
    refreshTokenEncrypted: encryptSecret(SECRET, "refresh-token"),
    expiresAt: null,
    remoteUserId: "remote-user-1",
    remoteUsername: "remote-admin",
    remoteHostFingerprint: null,
    savedAt: now,
    updatedAt: now,
    ...overrides,
  });
}
