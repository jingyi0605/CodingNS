import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../config/client-config-store";
import { syncActiveHostAuthenticatedRuntimeConfig } from "./client-runtime-manager";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../network/http-client", () => ({
  httpClient: {
    request: requestMock
  }
}));

describe("client-runtime-manager", () => {
  beforeEach(() => {
    requestMock.mockReset();
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "Demo Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
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
  });

  it("会把当前激活 Host 的 relay 候选入口同步进本地配置", async () => {
    requestMock.mockResolvedValue({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      relayTunnel: {
        provider: "codingns_relay",
        enabled: true,
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example",
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
            endpointId: "relay:https://demo.codingns.example",
            kind: "relay",
            url: "https://demo.codingns.example",
            priority: 400,
            expiresAt: null,
            source: "host_reported"
          }
        ]
      }
    });

    await syncActiveHostAuthenticatedRuntimeConfig();

    expect(requestMock).toHaveBeenCalledWith("/api/client/runtime-config?platform=desktop");
    expect(clientConfigStore.getState().hosts[0].relayTunnel).toEqual({
      provider: "codingns_relay",
      enabled: true,
      controlBaseUrl: "https://control.codingns.example",
      tunnelDomain: "demo.codingns.example",
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
          endpointId: "relay:https://demo.codingns.example",
          kind: "relay",
          url: "https://demo.codingns.example",
          priority: 400,
          expiresAt: null,
          source: "host_reported"
        }
      ]
    });
  });

  it("绑定信息缺失时会清掉本地残留的 relay profile", async () => {
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      hosts: [
        {
          ...clientConfigStore.getState().hosts[0],
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            controlBaseUrl: "https://control.codingns.example",
            tunnelDomain: "demo.codingns.example",
            bindingId: "binding_demo",
            hostFingerprint: "SHA256:demo",
            candidateEndpoints: []
          }
        }
      ]
    });
    requestMock.mockResolvedValue({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      relayTunnel: {
        provider: "codingns_relay",
        enabled: false,
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: null,
        bindingId: null,
        hostFingerprint: "SHA256:demo",
        candidateEndpoints: [
          {
            endpointId: "host_reported:http://192.168.50.8:3002",
            kind: "lan",
            url: "http://192.168.50.8:3002",
            priority: 200,
            expiresAt: null,
            source: "host_reported"
          }
        ]
      }
    });

    await syncActiveHostAuthenticatedRuntimeConfig();

    expect(clientConfigStore.getState().hosts[0].relayTunnel).toBeNull();
  });
});
