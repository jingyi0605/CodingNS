import { describe, expect, it } from "vitest";

import { buildRelayEntryConfigPatch } from "./relay-entry";
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
