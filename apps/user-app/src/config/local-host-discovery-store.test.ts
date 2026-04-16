import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "./client-config-store";
import {
  getVisibleDiscoveredHosts,
  localHostDiscoveryStore
} from "./local-host-discovery-store";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { probeHost } from "../network/host-probe";

vi.mock("../platform/platform-adapter", async () => {
  const actual = await vi.importActual<typeof import("../platform/platform-adapter")>(
    "../platform/platform-adapter"
  );

  return {
    ...actual,
    createPlatformAdapter: vi.fn(),
    resolveRuntimePlatform: vi.fn(() => "desktop")
  };
});

vi.mock("../network/host-probe", () => ({
  probeHost: vi.fn()
}));

function hydrateBaseConfig() {
  clientConfigStore.hydrate({
    platform: "desktop",
    activeHostId: "host-1",
    hosts: [
      {
        id: "host-1",
        name: "本地 Host",
        baseUrl: "http://127.0.0.1:3002",
        kind: "local",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        lastConnectedAt: null,
        lastUserId: null,
        lastUsername: null
      }
    ],
    releaseChannel: "stable",
    autoReconnect: true,
    autoCheckUpdate: true,
    language: "zh-CN",
    defaultPermissionMode: "default"
  });
}

describe("local-host-discovery-store", () => {
  beforeEach(() => {
    vi.mocked(createPlatformAdapter).mockReset();
    vi.mocked(probeHost).mockReset();
    hydrateBaseConfig();
  });

  it("扫描成功后会探活并写入运行时 discoveredHosts", async () => {
    vi.mocked(createPlatformAdapter).mockReturnValue({
      isDesktop: true,
      ui: {
        osFamily: "macos"
      },
      bridge: {
        scanLocalHosts: vi.fn(async () => ({
          ok: true,
          value: [
            {
              pid: 1001,
              commandLine: "node codingns.mjs start --port 3002",
              executable: "/opt/homebrew/bin/node",
              source: "node",
              baseUrl: "http://127.0.0.1:3002",
              port: 3002,
              dataDir: "/tmp/codingns-a"
            },
            {
              pid: 1002,
              commandLine: "node codingns.mjs start --port 4100",
              executable: "/opt/homebrew/bin/node",
              source: "node",
              baseUrl: "http://127.0.0.1:4100",
              port: 4100,
              dataDir: "/tmp/codingns-b"
            }
          ]
        }))
      }
    } as never);
    vi.mocked(probeHost).mockImplementation(async (baseUrl?: string) => ({
      initialized: true,
      reachable: baseUrl === "http://127.0.0.1:4100"
    }));

    await localHostDiscoveryStore.refresh({ force: true });

    const state = clientConfigStore.getState();

    expect(state.discoveredHosts).toHaveLength(1);
    expect(state.discoveredHosts[0]).toMatchObject({
      id: "local-discovered:http://127.0.0.1:4100:/tmp/codingns-b",
      baseUrl: "http://127.0.0.1:4100",
      dataDir: "/tmp/codingns-b"
    });
    expect(state.localHostDiscovery.status).toBe("ready");
  });

  it("会把与手动 HOST 相同地址的自动发现结果隐藏掉", () => {
    clientConfigStore.updateRuntime({
      discoveredHosts: [
        {
          id: "local-discovered:http://127.0.0.1:3002:/tmp/a",
          discoveryKey: "local-discovered:http://127.0.0.1:3002:/tmp/a",
          name: "127.0.0.1:3002",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          source: "desktop-process-scan",
          pid: 1001,
          executable: "/opt/homebrew/bin/node",
          dataDir: "/tmp/a",
          discoveredAt: "2026-04-16T00:00:00.000Z",
          lastReachableAt: "2026-04-16T00:00:00.000Z"
        },
        {
          id: "local-discovered:http://127.0.0.1:4100:/tmp/b",
          discoveryKey: "local-discovered:http://127.0.0.1:4100:/tmp/b",
          name: "127.0.0.1:4100",
          baseUrl: "http://127.0.0.1:4100",
          kind: "local",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          source: "desktop-process-scan",
          pid: 1002,
          executable: "/opt/homebrew/bin/node",
          dataDir: "/tmp/b",
          discoveredAt: "2026-04-16T00:00:00.000Z",
          lastReachableAt: "2026-04-16T00:00:00.000Z"
        }
      ]
    });

    const visibleHosts = getVisibleDiscoveredHosts(clientConfigStore.getState());

    expect(visibleHosts).toHaveLength(1);
    expect(visibleHosts[0].baseUrl).toBe("http://127.0.0.1:4100");
  });

  it("非桌面支持平台会直接标记为 unsupported", async () => {
    vi.mocked(createPlatformAdapter).mockReturnValue({
      isDesktop: false,
      ui: {
        osFamily: "linux"
      }
    } as never);

    await localHostDiscoveryStore.refresh({ force: true });

    expect(clientConfigStore.getState().localHostDiscovery).toMatchObject({
      status: "unsupported",
      errorCode: "PLATFORM_NOT_SUPPORTED"
    });
  });
});
