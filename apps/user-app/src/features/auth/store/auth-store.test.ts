import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import {
  resetPageUnloadStateForTesting
} from "../../../shared/browser/page-unload-state";

const STORAGE_KEY = "codingns.auth.session";

const storedSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
  user: {
    userId: "user-1",
    username: "admin",
    role: "admin" as const
  }
};

describe("authStore", () => {
  async function setupClientConfig() {
    const { clientConfigStore } = await import("../../../config/client-config-store");

    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "127.0.0.1:3002",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        },
        {
          id: "host-2",
          name: "10.10.1.8:4100",
          baseUrl: "http://10.10.1.8:4100",
          kind: "lan",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    return clientConfigStore;
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetPageUnloadStateForTesting();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("启动时会把旧单会话迁移到当前 HOST 槽位", async () => {
    const clientConfigStore = await setupClientConfig();
    const refreshFetchMock = vi.fn(async () => createJsonResponse(storedSession));

    vi.stubGlobal("fetch", refreshFetchMock);
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: vi.fn(async () => undefined)
    }));

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        serverBaseUrl: "http://10.10.1.8:4100",
        session: storedSession
      })
    );
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-2"
    });

    const { authStore } = await import("./auth-store");

    await waitFor(() => {
      expect(authStore.getState().status).toBe("authenticated");
      expect(authStore.getState().session).toEqual(storedSession);
      expect(authStore.getState().sessionReady).toBe(true);
    });
    expect(refreshFetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).toMatchObject({
      "host-2": {
        hostId: "host-2",
        session: storedSession
      }
    });
  });

  it("桌面配置还没恢复前不会拿 fallback host 提前刷新本地 session", async () => {
    const refreshFetchMock = vi.fn(async () => createJsonResponse(storedSession));

    vi.stubGlobal("fetch", refreshFetchMock);
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: vi.fn(async () => undefined)
    }));

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "default-host": {
          hostId: "default-host",
          session: storedSession,
          savedAt: Date.now()
        }
      })
    );

    const { clientConfigStore } = await import("../../../config/client-config-store");
    const { authStore } = await import("./auth-store");

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(refreshFetchMock).not.toHaveBeenCalled();
    expect(authStore.getState().status).toBe("anonymous");

    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "default-host",
      hosts: [
        {
          id: "default-host",
          name: "127.0.0.1:3009",
          baseUrl: "http://127.0.0.1:3009",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    await waitFor(() => {
      expect(refreshFetchMock).toHaveBeenCalledTimes(1);
      expect(refreshFetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3009/api/auth/refresh");
      expect(authStore.getState().status).toBe("authenticated");
      expect(authStore.getState().sessionReady).toBe(true);
    });
  });

  it("切换 activeHostId 时会切换当前会话上下文", async () => {
    const clientConfigStore = await setupClientConfig();
    const now = Date.now();
    const refreshFetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      return createJsonResponse(
        url.startsWith("http://10.10.1.8:4100")
          ? {
              ...storedSession,
              accessToken: "host-2-token"
            }
          : storedSession
      );
    });

    vi.stubGlobal("fetch", refreshFetchMock);
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: vi.fn(async () => undefined)
    }));

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "host-1": {
          hostId: "host-1",
          session: storedSession,
          savedAt: now
        },
        "host-2": {
          hostId: "host-2",
          session: {
            ...storedSession,
            accessToken: "host-2-token"
          },
          savedAt: now
        }
      })
    );

    const { authStore } = await import("./auth-store");

    await waitFor(() => {
      expect(authStore.getState().session?.accessToken).toBe("access-token");
      expect(authStore.getState().sessionReady).toBe(true);
    });

    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-2"
    });

    await waitFor(() => {
      expect(authStore.getState().session?.accessToken).toBe("host-2-token");
      expect(authStore.getState().sessionReady).toBe(true);
    });

    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-1"
    });

    await waitFor(() => {
      expect(authStore.getState().session?.accessToken).toBe("access-token");
      expect(authStore.getState().sessionReady).toBe(true);
    });
    expect(refreshFetchMock).toHaveBeenCalledTimes(3);
  });

  it("清理登录态时只会清理当前 HOST，不会误删其他 HOST 会话", async () => {
    const clientConfigStore = await setupClientConfig();
    const { authStore } = await import("./auth-store");

    authStore.hydrate(storedSession);
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-2"
    });
    authStore.hydrate({
      ...storedSession,
      accessToken: "host-2-token"
    });

    authStore.clear();

    expect(authStore.getState().status).toBe("anonymous");
    expect(authStore.getState().session).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).toMatchObject({
      "host-1": {
        hostId: "host-1",
        session: storedSession
      }
    });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).not.toHaveProperty("host-2");
  });

  it("可以单独清理指定 HOST 的会话，不影响其他 HOST", async () => {
    const clientConfigStore = await setupClientConfig();
    const { authStore } = await import("./auth-store");

    authStore.hydrate(storedSession);
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-2"
    });
    authStore.hydrate({
      ...storedSession,
      accessToken: "host-2-token"
    });
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-1"
    });

    authStore.clearHostSession("host-2");

    expect(authStore.getState().session?.accessToken).toBe("access-token");
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).toMatchObject({
      "host-1": {
        hostId: "host-1",
        session: storedSession
      }
    });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).not.toHaveProperty("host-2");
  });

  it("启动时会直接清理已过期的当前 HOST 会话，避免误进工作台", async () => {
    await setupClientConfig();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "host-1": {
          hostId: "host-1",
          session: {
            ...storedSession,
            accessToken: "expired-token"
          },
          savedAt: Date.now() - 4000 * 1000
        }
      })
    );

    const { authStore } = await import("./auth-store");

    expect(authStore.getState().status).toBe("anonymous");
    expect(authStore.getState().session).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("启动恢复到本地残留 session 时，refresh token 无效会先清空登录态，再放页面继续", async () => {
    await setupClientConfig();

    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      detail: "refresh token 无效",
      error_code: "TOKEN_INVALID"
    }, 401)));

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "host-1": {
          hostId: "host-1",
          session: storedSession,
          savedAt: Date.now()
        }
      })
    );

    const { authStore } = await import("./auth-store");

    await waitFor(() => {
      expect(authStore.getState().status).toBe("anonymous");
      expect(authStore.getState().session).toBeNull();
      expect(authStore.getState().sessionReady).toBe(true);
    });
  });

  it("当前 HOST 登录成功后会同步认证态运行时配置", async () => {
    await setupClientConfig();
    const syncRuntimeConfigMock = vi.fn(async () => undefined);

    vi.doMock("../api/auth-api", () => ({
      loginRequest: vi.fn(async () => storedSession)
    }));
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: syncRuntimeConfigMock
    }));

    const { authStore } = await import("./auth-store");

    await authStore.login({
      username: "admin",
      password: "admin1234"
    });

    expect(authStore.getState().status).toBe("authenticated");
    await waitFor(() => {
      expect(syncRuntimeConfigMock).toHaveBeenCalledTimes(1);
    });
  });

  it("relay Host 登录前会先尝试 candidateEndpoints 里的直连地址，并把后续请求临时切到命中的直连入口", async () => {
    const clientConfigStore = await setupClientConfig();
    const syncRuntimeConfigMock = vi.fn(async () => undefined);
    const loginRequestMock = vi.fn(async () => storedSession);

    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      platform: "android",
      activeHostId: "relay-host",
      hosts: [
        {
          id: "relay-host",
          name: "demo.channel.codingns.com",
          baseUrl: "https://demo.channel.codingns.com:1443",
          kind: "remote",
          createdAt: "2026-04-23T00:00:00.000Z",
          updatedAt: "2026-04-23T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com:1443",
            bindingId: "binding_demo",
            hostFingerprint: "SHA256:demo",
            candidateEndpoints: [
              {
                endpointId: "host_reported:http://192.168.50.8:3002",
                kind: "lan",
                url: "http://192.168.50.8:3002",
                priority: 100,
                expiresAt: null,
                source: "host_reported"
              },
              {
                endpointId: "relay-entry:https://demo.channel.codingns.com:1443",
                kind: "relay",
                url: "https://demo.channel.codingns.com:1443",
                priority: 400,
                expiresAt: null,
                source: "user_saved"
              }
            ]
          }
        }
      ]
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "http://192.168.50.8:3002/api/public/bootstrap-status") {
        return new Response(JSON.stringify({ initialized: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }));

    vi.doMock("../api/auth-api", () => ({
      loginRequest: loginRequestMock
    }));
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: syncRuntimeConfigMock
    }));

    const { authStore } = await import("./auth-store");
    const { resolveHostTransportTarget } = await import("../../../network/host-transport-registry");

    await authStore.login({
      username: "admin",
      password: "admin1234"
    });

    expect(loginRequestMock).toHaveBeenCalledWith(
      {
        username: "admin",
        password: "admin1234"
      },
      "http://192.168.50.8:3002"
    );

    expect(resolveHostTransportTarget("https://demo.channel.codingns.com:1443").baseUrl).toBe(
      "http://192.168.50.8:3002"
    );
    await waitFor(() => {
      expect(syncRuntimeConfigMock).toHaveBeenCalledTimes(1);
    });
  });

  it("运行时配置同步卡住时也不会挡住当前 HOST 登录", async () => {
    await setupClientConfig();
    const syncRuntimeConfigMock = vi.fn(() => new Promise<void>(() => undefined));

    vi.doMock("../api/auth-api", () => ({
      loginRequest: vi.fn(async () => storedSession)
    }));
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: syncRuntimeConfigMock
    }));

    const { authStore } = await import("./auth-store");

    const loginResult = await Promise.race([
      authStore.login({
        username: "admin",
        password: "admin1234"
      }).then(() => "resolved"),
      new Promise<"timeout">((resolve) => {
        window.setTimeout(() => resolve("timeout"), 50);
      })
    ]);

    expect(loginResult).toBe("resolved");
    expect(authStore.getState().status).toBe("authenticated");
    await waitFor(() => {
      expect(syncRuntimeConfigMock).toHaveBeenCalledTimes(1);
    });
  });

  it("并发刷新登录态时只会请求一次 refresh 接口", async () => {
    await setupClientConfig();
    const refreshFetchMock = vi.fn(async () => createJsonResponse({
      ...storedSession,
      accessToken: "access-token-next",
      refreshToken: "refresh-token-next"
    }));

    vi.stubGlobal("fetch", refreshFetchMock);

    const { authStore } = await import("./auth-store");
    authStore.hydrate(storedSession);

    const [first, second] = await Promise.all([authStore.refresh(), authStore.refresh()]);

    expect(refreshFetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      status: "refreshed",
      session: {
        ...storedSession,
        accessToken: "access-token-next",
        refreshToken: "refresh-token-next"
      }
    });
    expect(second).toEqual(first);
    expect(authStore.getState().session?.accessToken).toBe("access-token-next");
  });

  it("页面正在 unload 时不会再发 runtime-config 后台同步", async () => {
    await setupClientConfig();
    const syncRuntimeConfigMock = vi.fn(async () => undefined);
    const pageUnloadState = await import("../../../shared/browser/page-unload-state");

    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(storedSession)));
    vi.doMock("../api/auth-api", () => ({
      loginRequest: vi.fn(async () => storedSession)
    }));
    vi.doMock("../../../platform/server/client-runtime-manager", () => ({
      syncActiveHostAuthenticatedRuntimeConfig: syncRuntimeConfigMock
    }));

    pageUnloadState.setPageUnloadStateForTesting(true);

    const { authStore } = await import("./auth-store");

    await authStore.login({
      username: "admin",
      password: "admin1234"
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(syncRuntimeConfigMock).not.toHaveBeenCalled();
  });
});

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
