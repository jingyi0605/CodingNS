import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { hostRuntimeStore } from "../config/host-runtime-store";
import { directHostTransport } from "./direct-host-transport";
import {
  resetHostTransportRegistryForTesting,
  resolveHostTransport,
  resolveHostTransportTarget
} from "./host-transport-registry";
import { ManagedRelayTunnelHostTransport } from "./relay-tunnel-managed-transport";

describe("host-transport-registry", () => {
  beforeEach(() => {
    resetHostTransportRegistryForTesting();
    clientConfigStore.hydrate(createRuntimeConfig());
    vi.spyOn(hostRuntimeStore, "getState").mockReturnValue({
      epoch: 0,
      activeHostId: "local-host",
      connectionSignature: "default",
      candidateProbeSignature: null,
      candidateProbePhase: "idle",
      candidateProbeStartedAt: null,
      candidateProbeFinishedAt: null,
      candidateEndpoints: [],
      preferredCandidateEndpointId: null,
      preferredDirectCandidateEndpointId: null
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("当前活跃 relay Host 已验身出可用 lan 入口时，会把请求目标改写到 lan", () => {
    clientConfigStore.hydrate(createRuntimeConfig({
      activeHostId: "relay-host-a"
    }));
    vi.mocked(hostRuntimeStore.getState).mockReturnValue({
      epoch: 1,
      activeHostId: "relay-host-a",
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
        },
        {
          endpointId: "relay:https://demo.channel.codingns.com",
          kind: "relay",
          url: "https://demo.channel.codingns.com",
          priority: 400,
          expiresAt: null,
          source: "host_reported",
          status: "verified",
          checkedAt: "2026-04-21T00:00:01.000Z",
          errorCode: null,
          errorDetail: null,
          responseHostBaseUrl: "https://demo.channel.codingns.com",
          responseBindingId: "binding_demo",
          responseHostFingerprint: "SHA256:demo"
        }
      ],
      preferredCandidateEndpointId: "host_reported:http://192.168.50.8:3002",
      preferredDirectCandidateEndpointId: "host_reported:http://192.168.50.8:3002"
    });

    const target = resolveHostTransportTarget("https://demo.channel.codingns.com");

    expect(target.baseUrl).toBe("http://192.168.50.8:3002");
    expect(target.transport).toBe(directHostTransport);
  });

  it("没有可用直连入口时，会继续保留 relay 作为活跃入口", () => {
    clientConfigStore.hydrate(createRuntimeConfig({
      activeHostId: "relay-host-a"
    }));
    vi.mocked(hostRuntimeStore.getState).mockReturnValue({
      epoch: 1,
      activeHostId: "relay-host-a",
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
          status: "mismatch",
          checkedAt: "2026-04-21T00:00:01.000Z",
          errorCode: "HOST_IDENTITY_MISMATCH",
          errorDetail: "候选入口返回的 Host 身份与当前激活 Host 不一致",
          responseHostBaseUrl: "http://192.168.50.9:3002",
          responseBindingId: "binding_other",
          responseHostFingerprint: "SHA256:other"
        },
        {
          endpointId: "relay:https://demo.channel.codingns.com",
          kind: "relay",
          url: "https://demo.channel.codingns.com",
          priority: 400,
          expiresAt: null,
          source: "host_reported",
          status: "verified",
          checkedAt: "2026-04-21T00:00:01.000Z",
          errorCode: null,
          errorDetail: null,
          responseHostBaseUrl: "https://demo.channel.codingns.com",
          responseBindingId: "binding_demo",
          responseHostFingerprint: "SHA256:demo"
        }
      ],
      preferredCandidateEndpointId: "relay:https://demo.channel.codingns.com",
      preferredDirectCandidateEndpointId: null
    });

    const target = resolveHostTransportTarget("https://demo.channel.codingns.com");

    expect(target.baseUrl).toBe("https://demo.channel.codingns.com");
    expect(target.transport).toBeInstanceOf(ManagedRelayTunnelHostTransport);
  });

  it("Web 可信前端即使验身出可用 lan 地址，也仍然固定使用 relay", () => {
    clientConfigStore.hydrate(createRuntimeConfig({
      platform: "web",
      activeHostId: "relay-host-a"
    }));
    vi.mocked(hostRuntimeStore.getState).mockReturnValue({
      epoch: 1,
      activeHostId: "relay-host-a",
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
        },
        {
          endpointId: "relay:https://demo.channel.codingns.com",
          kind: "relay",
          url: "https://demo.channel.codingns.com",
          priority: 400,
          expiresAt: null,
          source: "host_reported",
          status: "verified",
          checkedAt: "2026-04-21T00:00:01.000Z",
          errorCode: null,
          errorDetail: null,
          responseHostBaseUrl: "https://demo.channel.codingns.com",
          responseBindingId: "binding_demo",
          responseHostFingerprint: "SHA256:demo"
        }
      ],
      preferredCandidateEndpointId: "host_reported:http://192.168.50.8:3002",
      preferredDirectCandidateEndpointId: "host_reported:http://192.168.50.8:3002"
    });

    const target = resolveHostTransportTarget("https://demo.channel.codingns.com");

    expect(target.baseUrl).toBe("https://demo.channel.codingns.com");
    expect(target.transport).toBeInstanceOf(ManagedRelayTunnelHostTransport);
  });

  it("Web 可信前端里的 relay 主入口不允许再回退成直连 transport", async () => {
    clientConfigStore.hydrate(createRuntimeConfig({
      platform: "web",
      activeHostId: "relay-host-a"
    }));

    const target = resolveHostTransportTarget("https://demo.channel.codingns.com");

    await expect(target.transport.fetch({
      path: "/api/client/runtime-config",
      baseUrl: "https://demo.channel.codingns.com",
      url: "https://demo.channel.codingns.com/api/client/runtime-config",
      init: {
        method: "GET"
      }
    })).rejects.toThrow();
  });

  it("本地调试入口即使绑定了 relay，也不能把 4174 这种直连地址误判成 relay transport", () => {
    clientConfigStore.hydrate(createRuntimeConfig({
      platform: "web",
      activeHostId: "relay-dev-host",
      hosts: [
        createHost({
          id: "relay-dev-host",
          name: "dev-host",
          baseUrl: "http://10.255.0.83:4174",
          kind: "remote",
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "jingyi0605-02.channel.codingns.com",
            controlBaseUrl: "https://channel.codingns.com:1443"
          }
        })
      ]
    }));

    const target = resolveHostTransportTarget("http://10.255.0.83:4174");

    expect(target.baseUrl).toBe("http://10.255.0.83:4174");
    expect(target.transport).toBe(directHostTransport);
  });
});

function createRuntimeConfig(overrides?: {
  platform?: "desktop" | "web";
  activeHostId?: string;
  hosts?: ReturnType<typeof createHost>[];
}) {
  return {
    platform: overrides?.platform ?? ("desktop" as const),
    activeHostId: overrides?.activeHostId ?? "local-host",
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
