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
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("启动时不会因为客户端配置稍后才恢复，就误删桌面端已保存登录态", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        serverBaseUrl: "http://10.10.1.8:4100",
        session: storedSession
      })
    );

    const { authStore } = await import("./auth-store");

    expect(authStore.getState().status).toBe("authenticated");
    expect(authStore.getState().session).toEqual(storedSession);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
