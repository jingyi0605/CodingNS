import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../features/auth/store/auth-store";
import { httpClient } from "./http-client";

const session: AuthSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
  user: {
    userId: "user-1",
    username: "admin",
    role: "admin"
  }
};

describe("httpClient", () => {
  beforeEach(() => {
    authStore.hydrate(session);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    authStore.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POST 无请求体时不应发送 Content-Type", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await httpClient.request<void>("/api/sessions/demo/seen", {
      method: "POST"
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(headers.has("Content-Type")).toBe(false);
    expect(headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("204 响应不应继续按 JSON 解析", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      httpClient.request<void>("/api/sessions/demo/seen", {
        method: "POST"
      })
    ).resolves.toBeUndefined();
  });

  it("有响应体时仍然返回 JSON", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    await expect(httpClient.request<{ ok: boolean }>("/api/demo")).resolves.toEqual({
      ok: true
    });
  });
});
