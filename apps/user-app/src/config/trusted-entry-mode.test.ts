import { describe, expect, it } from "vitest";

import { shouldShowTrustedEntryLanding } from "./trusted-entry-mode";
import type { ClientRuntimeConfig } from "./client-config-types";

function createConfig(overrides?: Partial<ClientRuntimeConfig>): ClientRuntimeConfig {
  return {
    platform: "web",
    activeHostId: "host-1",
    hosts: [
      {
        id: "host-1",
        name: "host-1",
        baseUrl: "https://app.example.com",
        kind: "remote",
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
    defaultPermissionMode: "default",
    ...overrides
  };
}

describe("trusted entry mode", () => {
  it("关闭入口模式时不会拦截普通 Web 登录", () => {
    expect(shouldShowTrustedEntryLanding(createConfig(), "web", false)).toBe(false);
  });

  it("入口模式下没有 relay 绑定时会显示引导页", () => {
    expect(shouldShowTrustedEntryLanding(createConfig(), "web", true)).toBe(true);
  });

  it("入口模式下已有 relay 绑定时允许继续登录", () => {
    const config = createConfig({
      hosts: [
        {
          ...createConfig().hosts[0],
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com:1443"
          }
        }
      ]
    });

    expect(shouldShowTrustedEntryLanding(config, "web", true)).toBe(false);
  });

  it("非 Web 平台不走这个引导页", () => {
    expect(shouldShowTrustedEntryLanding(createConfig(), "desktop", true)).toBe(false);
  });
});
