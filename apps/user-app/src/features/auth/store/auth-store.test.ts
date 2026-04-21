import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.resetModules();
  });

  it("启动时会把旧单会话迁移到当前 HOST 槽位", async () => {
    const clientConfigStore = await setupClientConfig();

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

    expect(authStore.getState().status).toBe("authenticated");
    expect(authStore.getState().session).toEqual(storedSession);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).toMatchObject({
      "host-2": {
        hostId: "host-2",
        session: storedSession
      }
    });
  });

  it("切换 activeHostId 时会切换当前会话上下文", async () => {
    const clientConfigStore = await setupClientConfig();
    const now = Date.now();

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

    expect(authStore.getState().session?.accessToken).toBe("access-token");

    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-2"
    });

    expect(authStore.getState().session?.accessToken).toBe("host-2-token");

    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      activeHostId: "host-1"
    });

    expect(authStore.getState().session?.accessToken).toBe("access-token");
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
    expect(syncRuntimeConfigMock).toHaveBeenCalledTimes(1);
  });
});
