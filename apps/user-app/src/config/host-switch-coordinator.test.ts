import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "./client-config-store";
import { getHostBaseUrl, getHostWebSocketUrl } from "./env";
import { hostSwitchCoordinator, HostSwitchError } from "./host-switch-coordinator";

vi.mock("../network/host-probe", () => ({
  probeHost: vi.fn()
}));

describe("host-switch-coordinator", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "127.0.0.1:3002",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        },
        {
          id: "host-2",
          name: "10.10.1.8:4100",
          baseUrl: "http://10.10.1.8:4100",
          kind: "lan",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
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
  });

  it("探活成功后会切换 activeHostId", async () => {
    const { probeHost } = await import("../network/host-probe");
    vi.mocked(probeHost).mockResolvedValue({
      initialized: true,
      reachable: true
    });

    await hostSwitchCoordinator.switchHost("host-2");

    expect(clientConfigStore.getState().activeHostId).toBe("host-2");
    expect(getHostBaseUrl()).toBe("http://10.10.1.8:4100");
    expect(getHostWebSocketUrl("/ws")).toBe("ws://10.10.1.8:4100/ws");
  });

  it("目标 HOST 不可达时会保持原 activeHostId 不变", async () => {
    const { probeHost } = await import("../network/host-probe");
    vi.mocked(probeHost).mockResolvedValue({
      initialized: false,
      reachable: false
    });

    await expect(hostSwitchCoordinator.switchHost("host-2")).rejects.toMatchObject({
      name: "HostSwitchError",
      code: "HOST_UNREACHABLE"
    } satisfies Partial<HostSwitchError>);
    expect(clientConfigStore.getState().activeHostId).toBe("host-1");
    expect(getHostBaseUrl()).toBe("http://127.0.0.1:3002");
  });
});
