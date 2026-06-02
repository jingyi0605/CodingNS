import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../features/auth/store/auth-store";
import { ApiError } from "../shared/network/api-error";
import { clientConfigStore } from "../config/client-config-store";
import { getHostBaseUrl, getHostRequestUrl } from "../config/env";
import { hostRuntimeStore } from "../config/host-runtime-store";
import type { HostTransport } from "./host-transport";
import { setHostTransportResolverForTesting } from "./host-transport-registry";
import { httpClient, resetLegacyCorsCompatibilityHostsForTesting } from "./http-client";

vi.mock("../platform/server/client-runtime-manager", () => ({
  syncActiveHostAuthenticatedRuntimeConfig: vi.fn(async () => undefined)
}));

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
    clientConfigStore.hydrate(createDefaultRuntimeConfig());
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

  it("成功响应不是合法 JSON 时会抛出可识别的无效响应错误", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(
      new Response("<!doctype html><html><body>offline</body></html>", {
        status: 200,
        headers: {
          "Content-Type": "text/html"
        }
      })
    );

    await expect(httpClient.request("/api/demo")).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      errorCode: "INVALID_RESPONSE"
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

  it("access token 快过期时会先刷新再发起请求", async () => {
    const fetchMock = vi.mocked(fetch);
    const now = Date.now();
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

    vi.spyOn(Date, "now").mockReturnValue(now + 3590 * 1000);
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

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-next");
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

  it("当前活跃入口已经切到 lan 时，请求会改写到 lan 地址", async () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-relay",
      hosts: [
        {
          id: "host-relay",
          name: "demo.channel.codingns.com",
          baseUrl: "https://demo.channel.codingns.com",
          kind: "remote",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://control.codingns.example",
            bindingId: "binding_demo",
            hostFingerprint: "SHA256:demo",
            candidateEndpoints: [
              {
                endpointId: "host_reported:http://192.168.50.8:3002",
                kind: "lan",
                url: "http://192.168.50.8:3002",
                priority: 200,
                expiresAt: null,
                source: "host_reported"
              },
              {
                endpointId: "relay:https://demo.channel.codingns.com",
                kind: "relay",
                url: "https://demo.channel.codingns.com",
                priority: 400,
                expiresAt: null,
                source: "host_reported"
              }
            ]
          }
        }
      ],
      discoveredHosts: [],
      activeDiscoveredHostId: null,
      localHostDiscovery: {
        status: "idle",
        lastScannedAt: null,
        cooldownUntil: null,
        errorCode: null,
        errorDetail: null
      },
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate(session);
    vi.spyOn(hostRuntimeStore, "getState").mockReturnValue({
      epoch: 1,
      activeHostId: "host-relay",
      connectionSignature: "relay",
      candidateProbeSignature: "ready",
      candidateProbePhase: "ready",
      candidateProbeStartedAt: "2026-04-21T00:00:00.000Z",
      candidateProbeFinishedAt: "2026-04-21T00:00:01.000Z",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://192.168.50.8:3002",
          kind: "lan",
          url: "http://192.168.50.8:3002",
          priority: 200,
          expiresAt: null,
          source: "host_reported",
          status: "verified",
          checkedAt: "2026-04-21T00:00:01.000Z",
          errorCode: null,
          errorDetail: null,
          responseHostBaseUrl: "http://192.168.50.8:3002",
          responseBindingId: "binding_demo",
          responseHostFingerprint: "SHA256:demo"
        }
      ],
      preferredCandidateEndpointId: "host_reported:http://192.168.50.8:3002",
      preferredDirectCandidateEndpointId: "host_reported:http://192.168.50.8:3002"
    });

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

    expect(transportFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://192.168.50.8:3002",
        url: "http://192.168.50.8:3002/api/demo"
      })
    );
    expect(getHostBaseUrl()).toBe("https://demo.channel.codingns.com");
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

function createDefaultRuntimeConfig() {
  return {
    platform: "web" as const,
    activeHostId: "default-host",
    hosts: [
      {
        id: "default-host",
        name: "127.0.0.1:3002",
        baseUrl: "http://127.0.0.1:3002",
        kind: "local" as const,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
        lastConnectedAt: null,
        lastUserId: null,
        lastUsername: null,
        relayTunnel: null
      }
    ],
    discoveredHosts: [],
    activeDiscoveredHostId: null,
    localHostDiscovery: {
      status: "idle" as const,
      lastScannedAt: null,
      cooldownUntil: null,
      errorCode: null,
      errorDetail: null
    },
    releaseChannel: "stable" as const,
    autoReconnect: true,
    autoCheckUpdate: true,
    language: "zh-CN" as const,
    defaultPermissionMode: "default" as const
  };
}
