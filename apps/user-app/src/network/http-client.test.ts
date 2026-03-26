import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../features/auth/store/auth-store";
import { ApiError } from "../shared/network/api-error";
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

  it("错误响应为空体时不会再抛出 JSON 解析异常", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

    await expect(httpClient.request("/api/demo")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      errorCode: "HTTP_ERROR",
      message: "请求失败（HTTP 502）"
    } satisfies Partial<ApiError>);
  });

  it("错误响应为纯文本时会保留原始错误信息", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(
      new Response("upstream proxy failed", {
        status: 502,
        headers: {
          "Content-Type": "text/plain"
        }
      })
    );

    await expect(httpClient.request("/api/demo")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      errorCode: "HTTP_ERROR",
      message: "upstream proxy failed"
    } satisfies Partial<ApiError>);
  });

  it("401 TOKEN_EXPIRED 时会先刷新登录态再重试原请求", async () => {
    const fetchMock = vi.mocked(fetch);
    const refreshSpy = vi.spyOn(authStore, "refresh").mockImplementation(async () => {
      authStore.hydrate({
        ...session,
        accessToken: "access-token-next"
      });

      return authStore.getState().session;
    });

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: "access token 已过期",
            error_code: "TOKEN_EXPIRED"
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
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

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);

    expect(firstHeaders.get("Authorization")).toBe("Bearer access-token");
    expect(secondHeaders.get("Authorization")).toBe("Bearer access-token-next");
  });

  it("403 BOOTSTRAP_REQUIRED 时会清理残留登录态", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "系统尚未初始化，请先完成 setup",
          error_code: "BOOTSTRAP_REQUIRED"
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    await expect(httpClient.request("/api/workbench")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      errorCode: "BOOTSTRAP_REQUIRED"
    } satisfies Partial<ApiError>);

    expect(authStore.getState().status).toBe("anonymous");
    expect(authStore.getState().session).toBeNull();
  });
});
