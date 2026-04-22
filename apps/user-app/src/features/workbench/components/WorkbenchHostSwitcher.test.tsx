import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { authStore } from "../../auth/store/auth-store";
import { httpClient } from "../../../network/http-client";
import {
  recordRelaySessionWireBytes,
  resetRelaySessionTrafficStoreForTesting
} from "../../../network/relay-session-traffic-store";
import { readRememberedLoginCredentials } from "../../auth/store/remembered-login";
import { ToastProvider } from "../../../shared/toast";
import { WorkbenchHostSwitcher } from "./WorkbenchHostSwitcher";

const switchHostMock = vi.fn();
const refreshLocalHostsMock = vi.fn();
const useActiveConnectionRouteSummaryMock = vi.fn();

vi.mock("../../../config/host-switch-coordinator", async () => {
  const actual = await vi.importActual<typeof import("../../../config/host-switch-coordinator")>(
    "../../../config/host-switch-coordinator"
  );
  return {
    ...actual,
    hostSwitchCoordinator: {
      switchHost: (...args: unknown[]) => switchHostMock(...args)
    }
  };
});

vi.mock("../../../config/local-host-discovery-store", async () => {
  const actual = (await vi.importActual(
    "../../../config/local-host-discovery-store"
  )) as typeof import("../../../config/local-host-discovery-store");
  return {
    ...actual,
    localHostDiscoveryStore: {
      ...actual.localHostDiscoveryStore,
      refresh: (...args: unknown[]) => refreshLocalHostsMock(...args),
      setActiveDiscoveredHost: vi.fn()
    }
  };
});

vi.mock("../../../config/active-connection-route", async () => {
  const actual = await vi.importActual<typeof import("../../../config/active-connection-route")>(
    "../../../config/active-connection-route"
  );
  return {
    ...actual,
    useActiveConnectionRouteSummary: () => useActiveConnectionRouteSummaryMock()
  };
});

describe("WorkbenchHostSwitcher", () => {
  beforeEach(() => {
    switchHostMock.mockReset();
    refreshLocalHostsMock.mockReset();
    useActiveConnectionRouteSummaryMock.mockReset();
    useActiveConnectionRouteSummaryMock.mockReturnValue(null);
    refreshLocalHostsMock.mockResolvedValue(undefined);
    resetRelaySessionTrafficStoreForTesting();
    window.localStorage.clear();
    vi.restoreAllMocks();
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        },
        {
          id: "host-2",
          name: "办公室 Host",
          baseUrl: "http://10.10.1.8:3002",
          kind: "lan",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-13T00:00:00.000Z",
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
    authStore.hydrate({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    });
  });

  it("会列出 HOST 并调用切换协调器", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /办公室 Host.*10\.10\.1\.8:3002/ }));

    await waitFor(() => {
      expect(switchHostMock).toHaveBeenCalledWith("host-2");
    });
  });

  it("支持在弹层里新增 HOST", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /新增 HOST/ }));
    await user.type(screen.getByLabelText("HOST 名称"), "演示机房");
    await user.type(screen.getByLabelText("HOST 地址"), "10.0.0.8:3002");
    await user.click(screen.getByRole("button", { name: "保存 HOST" }));

    await waitFor(() => {
      const nextHost = clientConfigStore.getState().hosts.find((host) => host.name === "演示机房");
      expect(nextHost?.baseUrl).toBe("http://10.0.0.8:3002");
    });
  });

  it("新增 HOST 时可以顺手保存认证信息", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /新增 HOST/ }));
    await user.type(screen.getByLabelText("HOST 名称"), "机房 Host");
    await user.type(screen.getByLabelText("HOST 地址"), "10.0.0.9:3002");
    await user.type(screen.getByLabelText("用户名"), "root");
    await user.type(screen.getByLabelText("密码"), "Secret123!");
    await user.click(screen.getByRole("button", { name: "保存 HOST" }));

    await waitFor(() => {
      const nextHost = clientConfigStore.getState().hosts.find((host) => host.name === "机房 Host");
      expect(nextHost).toBeDefined();
      expect(readRememberedLoginCredentials(nextHost?.id ?? null)).toMatchObject({
        username: "root",
        password: "Secret123!"
      });
    });
  });

  it("支持删除非当前 HOST，并清理已保存的认证信息", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    const nextHost = clientConfigStore.getState().hosts.find((host) => host.id === "host-2");
    expect(nextHost).toBeDefined();

    if (!nextHost) {
      throw new Error("host-2 should exist");
    }

    window.localStorage.setItem(
      "codingns.auth.remembered-login",
      JSON.stringify({
        [nextHost.id]: {
          hostId: nextHost.id,
          username: "tester",
          password: "Secret123!",
          savedAt: Date.now()
        }
      })
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    const deleteButton = screen.getByRole("button", { name: `删除 HOST ${nextHost.name}` });
    await user.click(deleteButton);
    expect(screen.getByRole("button", { name: `删除 HOST ${nextHost.name}` })).toHaveTextContent("确认删除");
    await user.click(screen.getByRole("button", { name: `删除 HOST ${nextHost.name}` }));

    await waitFor(() => {
      expect(clientConfigStore.getState().hosts.some((host) => host.id === "host-2")).toBe(false);
      expect(readRememberedLoginCredentials("host-2")).toBeNull();
    });
  });

  it("会把自动发现 HOST 放到单独分组里并支持切换", async () => {
    const user = userEvent.setup();

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
      ],
      localHostDiscovery: {
        status: "ready",
        lastScannedAt: "2026-04-16T00:00:00.000Z",
        cooldownUntil: "2026-04-16T00:00:10.000Z",
        errorCode: null,
        errorDetail: null
      }
    });

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));

    expect(screen.getAllByText("自动发现").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /127\.0\.0\.1:4100.*http:\/\/127\.0\.0\.1:4100/ }));

    await waitFor(() => {
      expect(switchHostMock).toHaveBeenCalledWith("local-discovered:http://127.0.0.1:4100:/tmp/demo");
    });
  });

  it("当前 relay Host 的详情浮层会显示连接状态、延时和本次会话流量", async () => {
    const user = userEvent.setup();

    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-relay",
      hosts: [
        {
          id: "host-relay",
          name: "远程 Host",
          baseUrl: "https://demo.channel.codingns.com",
          kind: "remote",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin",
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            controlBaseUrl: "https://control.codingns.com",
            tunnelDomain: "demo.channel.codingns.com",
            bindingId: "binding-1",
            hostFingerprint: "host-fingerprint",
            candidateEndpoints: [
              {
                endpointId: "relay:https://demo.channel.codingns.com",
                kind: "relay",
                url: "https://demo.channel.codingns.com",
                priority: 100,
                expiresAt: null,
                source: "host_reported"
              }
            ]
          }
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
    recordRelaySessionWireBytes("host-relay", "upstream", 1536);
    recordRelaySessionWireBytes("host-relay", "downstream", 512);
    useActiveConnectionRouteSummaryMock.mockReturnValue({
      kind: "relay",
      url: "https://demo.channel.codingns.com",
      endpointId: "relay:https://demo.channel.codingns.com",
      autoDirect: false,
      probeInProgress: false
    });
    vi.spyOn(httpClient, "request").mockResolvedValue({
      hostBaseUrl: "https://demo.channel.codingns.com"
    } as never);

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: "查看 HOST 远程 Host 连接详情" }));

    const detailPopover = await screen.findByRole("dialog", { name: "连接详情" });

    expect(within(detailPopover).getAllByText("CodingNS Connect")).toHaveLength(2);
    expect(within(detailPopover).getByText("https://demo.channel.codingns.com")).toBeInTheDocument();
    expect(within(detailPopover).getByText("2.0 KB")).toBeInTheDocument();

    await waitFor(() => {
      expect(httpClient.request).toHaveBeenCalledWith("/api/client/runtime-config");
      expect(within(detailPopover).getByText(/\d+ ms$/)).toBeInTheDocument();
    });
  });
});
