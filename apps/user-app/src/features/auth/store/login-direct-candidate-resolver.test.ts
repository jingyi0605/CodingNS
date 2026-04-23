import { describe, expect, it, vi } from "vitest";

import { resolveLoginBaseUrlWithDirectCandidates } from "./login-direct-candidate-resolver";
import type { RuntimeHostProfile } from "../../../config/client-config-types";

describe("login-direct-candidate-resolver", () => {
  it("会优先命中第一个可达的直连 candidate", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({ initialized: true })
    );

    await expect(
      resolveLoginBaseUrlWithDirectCandidates({
        host: createRelayHost(),
        requestedBaseUrl: "https://demo.channel.codingns.com:1443",
        platform: "android",
        fetchFn: fetchMock
      })
    ).resolves.toBe("http://127.0.0.1:3002");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/api/public/bootstrap-status",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("首个 candidate 不通时会继续尝试第二个，命中后立刻停止", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(createJsonResponse({ initialized: true }));

    await expect(
      resolveLoginBaseUrlWithDirectCandidates({
        host: createRelayHost(),
        requestedBaseUrl: "https://demo.channel.codingns.com:1443",
        platform: "ios",
        fetchFn: fetchMock
      })
    ).resolves.toBe("http://192.168.50.8:3002");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://192.168.50.8:3002/api/public/bootstrap-status");
  });

  it("只会尝试前两个直连 candidate，全部失败后回退 relay", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(createJsonResponse({ detail: "bad gateway" }, 502));

    await expect(
      resolveLoginBaseUrlWithDirectCandidates({
        host: createRelayHost({
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com:1443",
            bindingId: "binding_demo",
            hostFingerprint: "SHA256:demo",
            candidateEndpoints: [
              {
                endpointId: "host_reported:http://127.0.0.1:3002",
                kind: "loopback",
                url: "http://127.0.0.1:3002",
                priority: 100,
                expiresAt: null,
                source: "host_reported"
              },
              {
                endpointId: "host_reported:http://192.168.50.8:3002",
                kind: "lan",
                url: "http://192.168.50.8:3002",
                priority: 200,
                expiresAt: null,
                source: "host_reported"
              },
              {
                endpointId: "host_reported:http://100.64.1.9:3002",
                kind: "tailscale",
                url: "http://100.64.1.9:3002",
                priority: 300,
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
        }),
        requestedBaseUrl: "https://demo.channel.codingns.com:1443",
        platform: "desktop",
        fetchFn: fetchMock
      })
    ).resolves.toBe("https://demo.channel.codingns.com:1443");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Web 端不会做登录前直连探测", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      resolveLoginBaseUrlWithDirectCandidates({
        host: createRelayHost(),
        requestedBaseUrl: "https://demo.channel.codingns.com:1443",
        platform: "web",
        fetchFn: fetchMock
      })
    ).resolves.toBe("https://demo.channel.codingns.com:1443");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createRelayHost(
  overrides?: Partial<RuntimeHostProfile>
): RuntimeHostProfile {
  return {
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
          endpointId: "host_reported:http://127.0.0.1:3002",
          kind: "loopback",
          url: "http://127.0.0.1:3002",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:3002",
          kind: "lan",
          url: "http://192.168.50.8:3002",
          priority: 200,
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
    },
    ...overrides
  };
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
