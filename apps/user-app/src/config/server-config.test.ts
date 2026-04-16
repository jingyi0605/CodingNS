import { beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "./client-config-store";
import { getActiveHostBaseUrl } from "./client-config-types";
import { serverConfigStore } from "./server-config";
import { normalizeServerBaseUrl } from "./server-config";

describe("normalizeServerBaseUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("保留前端代理地址 4174，不强行改写到后端端口", () => {
    expect(normalizeServerBaseUrl("http://10.255.0.85:4174")).toBe(
      "http://10.255.0.85:4174"
    );
  });

  it("保留已经是 host 端口的地址", () => {
    expect(normalizeServerBaseUrl("http://10.255.0.85:3002")).toBe(
      "http://10.255.0.85:3002"
    );
  });

  it("兼容层会从多 HOST 配置里暴露当前激活 HOST，并允许只修改当前 HOST 地址", async () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-2",
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

    expect(serverConfigStore.getState().baseUrl).toBe("http://10.10.1.8:4100");
    expect(serverConfigStore.getState().options).toContain("http://10.10.1.8:4100");
    expect(serverConfigStore.getState().options).toContain("http://127.0.0.1:3002");

    expect(serverConfigStore.setBaseUrl("10.10.1.9:4200")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://10.10.1.9:4200");
    expect(clientConfigStore.getState().hosts).toHaveLength(2);
    expect(clientConfigStore.getState().hosts[0].baseUrl).toBe("http://127.0.0.1:3002");
  });

  it("服务器配置列表会包含自动发现 HOST，并标记来源为自动发现", () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "127.0.0.1:3002",
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
    clientConfigStore.updateRuntime({
      discoveredHosts: [
        {
          id: "local-discovered:http://127.0.0.1:4100:/tmp/demo",
          discoveryKey: "local-discovered:http://127.0.0.1:4100:/tmp/demo",
          name: "127.0.0.1:4100",
          baseUrl: "http://127.0.0.1:4100",
          kind: "local",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          source: "desktop-process-scan",
          pid: 1001,
          executable: "/opt/homebrew/bin/node",
          dataDir: "/tmp/demo",
          discoveredAt: "2026-04-16T00:00:00.000Z",
          lastReachableAt: "2026-04-16T00:00:00.000Z"
        }
      ]
    });

    const state = serverConfigStore.getState();

    expect(state.options).toContain("http://127.0.0.1:4100");
    expect(state.presetOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "http://127.0.0.1:4100",
          source: "discovered"
        })
      ])
    );
  });
});
