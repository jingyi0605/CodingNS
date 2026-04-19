import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../features/auth/store/auth-store";
import { ApiError } from "../shared/network/api-error";
import { getHostBaseUrl, getHostRequestUrl } from "../config/env";
import type { HostTransport } from "./host-transport";
import { setHostTransportResolverForTesting } from "./host-transport-registry";
import { httpClient, resetLegacyCorsCompatibilityHostsForTesting } from "./http-client";

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
    setHostTransportResolverForTesting(null);
    resetLegacyCorsCompatibilityHostsForTesting();
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
    expect(headers.get("x-codingns-client-type")).toBe("web");
    expect(headers.get("x-codingns-client-instance-id")).toBeTruthy();
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
      const nextSession = {
        ...session,
        accessToken: "access-token-next"
      };
      authStore.hydrate(nextSession);

      return {
        status: "refreshed",
        session: nextSession
      };
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

  it("刷新登录态只是暂时不可用时，不会清空本地会话", async () => {
    const fetchMock = vi.mocked(fetch);
    const refreshSpy = vi.spyOn(authStore, "refresh").mockResolvedValue({
      status: "deferred",
      session,
      error: new Error("network down")
    });

    fetchMock.mockResolvedValue(
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
    );

    await expect(httpClient.request("/api/demo")).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      errorCode: "AUTH_REFRESH_UNAVAILABLE",
      message: "登录态暂时无法恢复，请稍后重试"
    } satisfies Partial<ApiError>);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(authStore.getState().status).toBe("authenticated");
    expect(authStore.getState().session).toEqual(session);
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

  it("可以改用自定义 Host transport 发送请求", async () => {
    const expectedBaseUrl = getHostBaseUrl();
    const transportFetch = vi.fn<HostTransport["fetch"]>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    setHostTransportResolverForTesting(() => ({
      fetch: transportFetch,
      createWebSocket: vi.fn()
    }));

    await expect(httpClient.request<{ ok: boolean }>("/api/demo")).resolves.toEqual({
      ok: true
    });

    expect(transportFetch).toHaveBeenCalledTimes(1);
    expect(transportFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/demo",
        baseUrl: expectedBaseUrl,
        url: getHostRequestUrl("/api/demo", expectedBaseUrl)
      })
    );
  });

  it("旧 Host 因额外客户端头触发预检失败时，会自动去掉 X-CodingNS 头重试", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
      );

    await expect(
      httpClient.request<{ ok: boolean }>("/api/demo", {
        headers: {
          "X-CodingNS-Assistant-Source": "butler-ui"
        }
      })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);

    expect(firstHeaders.get("x-codingns-client-type")).toBe("web");
    expect(firstHeaders.get("x-codingns-client-instance-id")).toBeTruthy();
    expect(firstHeaders.get("x-codingns-assistant-source")).toBe("butler-ui");
    expect(secondHeaders.has("x-codingns-client-type")).toBe(false);
    expect(secondHeaders.has("x-codingns-client-instance-id")).toBe(false);
    expect(secondHeaders.has("x-codingns-assistant-source")).toBe(false);
    expect(secondHeaders.get("Authorization")).toBe("Bearer access-token");
  });

  it("探测到旧 Host 兼容模式后，后续请求会直接省略 X-CodingNS 头", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
      );

    await httpClient.request<{ ok: boolean }>("/api/demo", {
      headers: {
        "X-CodingNS-Assistant-Source": "butler-ui"
      }
    });
    await httpClient.request<{ ok: boolean }>("/api/demo-2", {
      headers: {
        "X-CodingNS-Assistant-Source": "butler-ui"
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const cachedCompatibilityHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(cachedCompatibilityHeaders.has("x-codingns-client-type")).toBe(false);
    expect(cachedCompatibilityHeaders.has("x-codingns-client-instance-id")).toBe(false);
    expect(cachedCompatibilityHeaders.has("x-codingns-assistant-source")).toBe(false);
  });
});
