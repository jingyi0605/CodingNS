import { describe, expect, it, vi } from "vitest";

import {
  buildRelayEntryConfigPatch,
  resolveRelayEntryConfigInputFromBaseUrl
} from "./relay-entry";
import type { ClientRuntimeConfig } from "./client-config-types";

describe("relay-entry", () => {
  it("会为可信入口生成带 relay 配置的活动 Host", () => {
    const patch = buildRelayEntryConfigPatch(createConfig(), {
      tunnelDomain: "Demo.Channel.CodingNS.Com",
      controlBaseUrl: "https://channel.codingns.com",
      bindingId: "binding_demo",
      hostFingerprint: "SHA256:demo"
    });

    expect(patch.activeHostId).toBe("relay-entry:binding_demo");
    expect(patch.hosts?.[0]).toMatchObject({
      id: "relay-entry:binding_demo",
      name: "demo.channel.codingns.com",
      baseUrl: "https://demo.channel.codingns.com",
      relayTunnel: {
        provider: "codingns_relay",
        enabled: true,
        tunnelDomain: "demo.channel.codingns.com",
        controlBaseUrl: "https://channel.codingns.com",
        bindingId: "binding_demo",
        hostFingerprint: "SHA256:demo",
        candidateEndpoints: [
          {
            kind: "relay",
            url: "https://demo.channel.codingns.com"
          }
        ]
      }
    });
  });

  it("会继承控制站地址里的公开端口", () => {
    const patch = buildRelayEntryConfigPatch(createConfig(), {
      tunnelDomain: "Demo.Channel.CodingNS.Com",
      controlBaseUrl: "https://channel.codingns.com:1443",
      bindingId: "binding_demo",
      hostFingerprint: "SHA256:demo"
    });

    expect(patch.hosts?.[0]).toMatchObject({
      baseUrl: "https://demo.channel.codingns.com:1443",
      relayTunnel: {
        candidateEndpoints: [
          {
            kind: "relay",
            url: "https://demo.channel.codingns.com:1443"
          }
        ]
      }
    });
  });

  it("会复用已有 relay Host，避免覆盖其他保存的 Host", () => {
    const patch = buildRelayEntryConfigPatch(createConfig({
      hosts: [
        {
          id: "saved-local",
          name: "127.0.0.1:3002",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          relayTunnel: null
        },
        {
          id: "relay-entry:binding_demo",
          name: "demo.channel.codingns.com",
          baseUrl: "https://demo.channel.codingns.com",
          kind: "remote",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://old.example.com",
            bindingId: "binding_demo",
            hostFingerprint: "SHA256:old",
            candidateEndpoints: [
              {
                endpointId: "lan:http://10.0.0.8:3002",
                kind: "lan",
                url: "http://10.0.0.8:3002",
                priority: 1,
                expiresAt: null,
                source: "user_saved"
              }
            ]
          }
        }
      ]
    }), {
      tunnelDomain: "demo.channel.codingns.com",
      controlBaseUrl: "https://channel.codingns.com",
      bindingId: "binding_demo",
      hostFingerprint: "SHA256:new"
    });

    expect(patch.hosts).toHaveLength(2);
    expect(patch.hosts?.[1]).toMatchObject({
      id: "relay-entry:binding_demo",
      relayTunnel: {
        controlBaseUrl: "https://channel.codingns.com",
        hostFingerprint: "SHA256:new",
        candidateEndpoints: [
          {
            kind: "relay",
            url: "https://demo.channel.codingns.com"
          },
          {
            kind: "lan",
            url: "http://10.0.0.8:3002"
          }
        ]
      }
    });
  });

  it("支持自定义显示名称且可以只新增不切换当前活动 Host", () => {
    const patch = buildRelayEntryConfigPatch(createConfig({
      activeHostId: "saved-local",
      activeDiscoveredHostId: "discovered-1"
    }), {
      tunnelDomain: "demo.channel.codingns.com",
      controlBaseUrl: "https://channel.codingns.com:1443",
      bindingId: "binding_demo",
      hostFingerprint: "SHA256:demo"
    }, {
      activate: false,
      displayName: "机房入口"
    });

    expect(patch.activeHostId).toBe("saved-local");
    expect(patch.activeDiscoveredHostId).toBe("discovered-1");
    expect(patch.hosts?.[0]).toMatchObject({
      name: "机房入口",
      baseUrl: "https://demo.channel.codingns.com:1443"
    });
  });

  it("可以从四级域名解析出 relay 入口绑定信息", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        binding: {
          bindingId: "binding_demo",
          tunnelDomain: "demo.channel.codingns.com",
          controlBaseUrl: "https://channel.codingns.com:1443",
          hostFingerprint: "SHA256:demo",
          runtime: {
            candidateEndpoints: [
              {
                endpointId: "host_reported:http://10.0.0.8:3002",
                kind: "lan",
                url: "http://10.0.0.8:3002",
                priority: 200,
                expiresAt: null,
                source: "host_reported"
              }
            ]
          }
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      resolveRelayEntryConfigInputFromBaseUrl("https://demo.channel.codingns.com:1443", fetchMock)
    ).resolves.toEqual({
      tunnelDomain: "demo.channel.codingns.com",
      controlBaseUrl: "https://channel.codingns.com:1443",
      bindingId: "binding_demo",
      hostFingerprint: "SHA256:demo",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://10.0.0.8:3002",
          kind: "lan",
          url: "http://10.0.0.8:3002",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://channel.codingns.com:1443/api/v1/tunnels/demo.channel.codingns.com",
      {
        method: "GET"
      }
    );
  });

  it("隧道解析失败时会退回到本地推断出的 relay 入口配置", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("network failed"));

    await expect(
      resolveRelayEntryConfigInputFromBaseUrl("https://demo.channel.codingns.com:1443", fetchMock)
    ).resolves.toEqual({
      tunnelDomain: "demo.channel.codingns.com",
      controlBaseUrl: "https://channel.codingns.com:1443"
    });
  });

  it("会把 control-api 返回的 candidateEndpoints 合并进 relay Host 配置", () => {
    const patch = buildRelayEntryConfigPatch(createConfig(), {
      tunnelDomain: "demo.channel.codingns.com",
      controlBaseUrl: "https://channel.codingns.com:1443",
      bindingId: "binding_demo",
      hostFingerprint: "SHA256:demo",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://10.0.0.8:3002",
          kind: "lan",
          url: "http://10.0.0.8:3002",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        }
      ]
    });

    expect(patch.hosts?.[0]?.relayTunnel?.candidateEndpoints).toEqual([
      {
        endpointId: "relay-entry:https://demo.channel.codingns.com:1443",
        kind: "relay",
        url: "https://demo.channel.codingns.com:1443",
        priority: 0,
        expiresAt: null,
        source: "user_saved"
      },
      {
        endpointId: "host_reported:http://10.0.0.8:3002",
        kind: "lan",
        url: "http://10.0.0.8:3002",
        priority: 200,
        expiresAt: null,
        source: "host_reported"
      }
    ]);
  });
});

function createConfig(overrides?: Partial<ClientRuntimeConfig>): ClientRuntimeConfig {
  return {
    platform: "web",
    activeHostId: "saved-local",
    hosts: [
      {
        id: "saved-local",
        name: "127.0.0.1:3002",
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
    autoCheckUpdate: false,
    language: "zh-CN",
    defaultPermissionMode: "default",
    ...overrides
  };
}
