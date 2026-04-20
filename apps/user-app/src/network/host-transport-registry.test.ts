import { beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { directHostTransport } from "./direct-host-transport";
import {
  resetHostTransportRegistryForTesting,
  resolveHostTransport
} from "./host-transport-registry";
import { ManagedRelayTunnelHostTransport } from "./relay-tunnel-managed-transport";

describe("host-transport-registry", () => {
  beforeEach(() => {
    resetHostTransportRegistryForTesting();
    clientConfigStore.hydrate(createRuntimeConfig());
  });

  it("本地直连、Tailscale 地址和公共隧道地址可以并存解析", () => {
    const localTransport = resolveHostTransport("http://127.0.0.1:3002");
    const tailscaleTransport = resolveHostTransport("http://100.88.1.9:3002");
    const relayTransport = resolveHostTransport("https://demo.channel.codingns.com");

    expect(localTransport).toBe(directHostTransport);
    expect(tailscaleTransport).toBe(directHostTransport);
    expect(relayTransport).toBeInstanceOf(ManagedRelayTunnelHostTransport);
  });

  it("同一个公共隧道 Host 重复解析时会复用同一个 transport", () => {
    const firstTransport = resolveHostTransport("https://demo.channel.codingns.com");
    const secondTransport = resolveHostTransport("https://demo.channel.codingns.com");

    expect(firstTransport).toBe(secondTransport);
  });

  it("一个公共隧道 Host 的配置变化不会影响其他访问方式", () => {
    const localTransport = resolveHostTransport("http://127.0.0.1:3002");
    const tailscaleTransport = resolveHostTransport("http://100.88.1.9:3002");
    const relayTransportA = resolveHostTransport("https://demo.channel.codingns.com");
    const relayTransportB = resolveHostTransport("https://backup.channel.codingns.com");
    const relayTransportACloseSpy = relayTransportA.close?.bind(relayTransportA);

    if (!relayTransportACloseSpy) {
      throw new Error("缺少公共隧道 transport close 方法");
    }

    const closeSpy = {
      called: 0
    };
    relayTransportA.close = () => {
      closeSpy.called += 1;
      relayTransportACloseSpy();
    };

    clientConfigStore.hydrate(createRuntimeConfig({
      hosts: [
        createHost({
          id: "local-host",
          name: "本机直连",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local"
        }),
        createHost({
          id: "tailscale-host",
          name: "Tailscale",
          baseUrl: "http://100.88.1.9:3002",
          kind: "remote"
        }),
        createHost({
          id: "relay-host-a",
          name: "公共隧道 A",
          baseUrl: "https://demo.channel.codingns.com",
          kind: "remote",
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo-v2.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com/"
          }
        }),
        createHost({
          id: "relay-host-b",
          name: "公共隧道 B",
          baseUrl: "https://backup.channel.codingns.com",
          kind: "remote",
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "backup.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com/"
          }
        })
      ]
    }));

    const nextLocalTransport = resolveHostTransport("http://127.0.0.1:3002");
    const nextTailscaleTransport = resolveHostTransport("http://100.88.1.9:3002");
    const nextRelayTransportA = resolveHostTransport("https://demo.channel.codingns.com");
    const nextRelayTransportB = resolveHostTransport("https://backup.channel.codingns.com");

    expect(nextLocalTransport).toBe(localTransport);
    expect(nextTailscaleTransport).toBe(tailscaleTransport);
    expect(nextRelayTransportA).not.toBe(relayTransportA);
    expect(nextRelayTransportB).toBe(relayTransportB);
    expect(closeSpy.called).toBe(1);
  });

  it("公共隧道关闭后会回退成直连 transport", () => {
    const relayTransport = resolveHostTransport("https://demo.channel.codingns.com");
    const relayTransportCloseSpy = relayTransport.close?.bind(relayTransport);

    if (!relayTransportCloseSpy) {
      throw new Error("缺少公共隧道 transport close 方法");
    }

    const closeSpy = {
      called: 0
    };
    relayTransport.close = () => {
      closeSpy.called += 1;
      relayTransportCloseSpy();
    };

    clientConfigStore.hydrate(createRuntimeConfig({
      hosts: [
        createHost({
          id: "local-host",
          name: "本机直连",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local"
        }),
        createHost({
          id: "tailscale-host",
          name: "Tailscale",
          baseUrl: "http://100.88.1.9:3002",
          kind: "remote"
        }),
        createHost({
          id: "relay-host-a",
          name: "公共隧道 A",
          baseUrl: "https://demo.channel.codingns.com",
          kind: "remote",
          relayTunnel: {
            provider: "codingns_relay",
            enabled: false,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com/"
          }
        }),
        createHost({
          id: "relay-host-b",
          name: "公共隧道 B",
          baseUrl: "https://backup.channel.codingns.com",
          kind: "remote",
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "backup.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com/"
          }
        })
      ]
    }));

    const nextTransport = resolveHostTransport("https://demo.channel.codingns.com");

    expect(nextTransport).toBe(directHostTransport);
    expect(closeSpy.called).toBe(1);
  });
});

function createRuntimeConfig(overrides?: {
  hosts?: ReturnType<typeof createHost>[];
}) {
  return {
    platform: "desktop" as const,
    activeHostId: "local-host",
    hosts: overrides?.hosts ?? [
      createHost({
        id: "local-host",
        name: "本机直连",
        baseUrl: "http://127.0.0.1:3002",
        kind: "local"
      }),
      createHost({
        id: "tailscale-host",
        name: "Tailscale",
        baseUrl: "http://100.88.1.9:3002",
        kind: "remote"
      }),
      createHost({
        id: "relay-host-a",
        name: "公共隧道 A",
        baseUrl: "https://demo.channel.codingns.com",
        kind: "remote",
        relayTunnel: {
          provider: "codingns_relay" as const,
          enabled: true,
          tunnelDomain: "demo.channel.codingns.com",
          controlBaseUrl: "https://channel.codingns.com/"
        }
      }),
      createHost({
        id: "relay-host-b",
        name: "公共隧道 B",
        baseUrl: "https://backup.channel.codingns.com",
        kind: "remote",
        relayTunnel: {
          provider: "codingns_relay" as const,
          enabled: true,
          tunnelDomain: "backup.channel.codingns.com",
          controlBaseUrl: "https://channel.codingns.com/"
        }
      })
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

function createHost(input: {
  id: string;
  name: string;
  baseUrl: string;
  kind: "local" | "lan" | "remote" | "custom";
  relayTunnel?: {
    provider: "codingns_relay";
    enabled: boolean;
    tunnelDomain: string;
    controlBaseUrl: string;
  };
}) {
  return {
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    kind: input.kind,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    lastConnectedAt: null,
    lastUserId: null,
    lastUsername: null,
    relayTunnel: input.relayTunnel ?? null
  };
}
