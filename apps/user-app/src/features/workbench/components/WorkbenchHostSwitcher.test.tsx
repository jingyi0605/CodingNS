import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import * as relayEntryModule from "../../../config/relay-entry";
import { authStore } from "../../auth/store/auth-store";
import { httpClient } from "../../../network/http-client";
import {
  recordRelaySessionWireBytes,
  resetRelaySessionTrafficStoreForTesting
} from "../../../network/relay-session-traffic-store";
import { ApiError } from "../../../shared/network/api-error";
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
    await user.click(screen.getByRole("button", { name: /添加 Peer Host/ }));
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
    await user.click(screen.getByRole("button", { name: /添加 Peer Host/ }));
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

  it("新增四级域名 HOST 时会复用 relay 入口解析逻辑", async () => {
    const user = userEvent.setup();
    const resolveRelayEntrySpy = vi.spyOn(relayEntryModule, "resolveRelayEntryConfigInputFromBaseUrl")
      .mockResolvedValue({
        tunnelDomain: "demo.channel.codingns.com",
        controlBaseUrl: "https://channel.codingns.com:1443",
        bindingId: "binding-demo",
        hostFingerprint: "SHA256:demo"
      });

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /添加 Peer Host/ }));
    await user.type(screen.getByLabelText("HOST 名称"), "远程机房");
    await user.type(screen.getByLabelText("HOST 地址"), "https://demo.channel.codingns.com:1443");
    await user.click(screen.getByRole("button", { name: "保存 HOST" }));

    await waitFor(() => {
      const nextState = clientConfigStore.getState();
      const nextHost = nextState.hosts.find((host) => host.name === "远程机房");

      expect(nextState.activeHostId).toBe("host-1");
      expect(nextHost).toMatchObject({
        baseUrl: "https://demo.channel.codingns.com:1443",
        relayTunnel: {
          provider: "codingns_relay",
          tunnelDomain: "demo.channel.codingns.com",
          controlBaseUrl: "https://channel.codingns.com:1443",
          bindingId: "binding-demo",
          hostFingerprint: "SHA256:demo"
        }
      });
    });

    expect(resolveRelayEntrySpy).toHaveBeenCalledWith("https://demo.channel.codingns.com:1443");
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

  it("删除带 peerHostId 的 HOST 时会顺手删除后端 Peer HOST 记录", async () => {
    const user = userEvent.setup();
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      hosts: clientConfigStore.getState().hosts.map((host) =>
        host.id === "host-2"
          ? { ...host, peerHostId: "peer-2", peerEnabled: true }
          : host
      )
    });

    const requestSpy = vi.spyOn(httpClient, "request").mockImplementation(async (path: string, options?: any) => {
      if (path === "/api/peer-hosts") {
        return { items: [] } as never;
      }

      if (path === "/api/peer-hosts/peer-2" && options?.method === "DELETE") {
        return { success: true, peerHostId: "peer-2" } as never;
      }

      throw new Error(`unexpected request: ${path}`);
    });

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: "删除 HOST 办公室 Host" }));
    await user.click(screen.getByRole("button", { name: "删除 HOST 办公室 Host" }));

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalledWith("/api/peer-hosts/peer-2", { method: "DELETE" });
      expect(clientConfigStore.getState().hosts.some((host) => host.id === "host-2")).toBe(false);
    });
  });

  it("Peer HOST 状态异常时会显示手动重连按钮", async () => {
    const user = userEvent.setup();
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      hosts: clientConfigStore.getState().hosts.map((host) =>
        host.id === "host-2"
          ? { ...host, peerHostId: "peer-2", peerEnabled: false }
          : host
      )
    });

    vi.spyOn(httpClient, "request").mockImplementation(async (path: string) => {
      if (path === "/api/peer-hosts") {
        return {
          items: [buildPeerHostDto({ id: "peer-2", status: "unreachable" })]
        } as never;
      }

      throw new Error(`unexpected request: ${path}`);
    });

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await waitFor(() => {
      expect(screen.getByText("不可用")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "查看 HOST 办公室 Host 连接详情" }));

    expect(await screen.findByRole("button", { name: "手动重连" })).toBeInTheDocument();
  });

  it("后端残留旧 Peer HOST 记录时，会复用旧记录继续启用", async () => {
    const user = userEvent.setup();
    let listCount = 0;

    vi.spyOn(httpClient, "request").mockImplementation(async (path: string, options?: any) => {
      if (path === "/api/peer-hosts" && options?.method === "POST") {
        throw new ApiError(409, {
          detail: "这个 HOST 地址已经保存过了",
          error_code: "PEER_HOST_BASE_URL_EXISTS",
          field: "baseUrl"
        });
      }

      if (path === "/api/peer-hosts") {
        listCount += 1;
        return {
          items: listCount >= 2
            ? [buildPeerHostDto({ id: "peer-stale", status: "unknown" })]
            : []
        } as never;
      }

      if (path === "/api/peer-hosts/peer-stale" && options?.method === "PUT") {
        return buildPeerHostDto({ id: "peer-stale", status: "unknown" }) as never;
      }

      if (path === "/api/peer-hosts/peer-stale/check" && options?.method === "POST") {
        return buildPeerHostDto({ id: "peer-stale", status: "reachable" }) as never;
      }

      if (path === "/api/peer-hosts/peer-stale/login" && options?.method === "POST") {
        return {
          exists: true,
          username: "admin",
          remoteUserId: "remote-user-1",
          remoteUsername: "admin",
          expiresAt: "2026-06-10T01:00:00.000Z",
          savedAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z"
        } as never;
      }

      throw new Error(`unexpected request: ${path}`);
    });

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: "查看 HOST 办公室 Host 连接详情" }));
    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "Secret123!");
    await user.click(screen.getByRole("button", { name: "启用 Peer" }));

    await waitFor(() => {
      const nextHost = clientConfigStore.getState().hosts.find((host) => host.id === "host-2");
      expect(nextHost).toMatchObject({
        peerEnabled: true,
        peerHostId: "peer-stale"
      });
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
    vi.spyOn(httpClient, "request").mockImplementation(async (path: string) => {
      if (path === "/api/client/runtime-config") {
        return {
          hostBaseUrl: "https://demo.channel.codingns.com"
        } as never;
      }

      if (path === "/api/system/host/resources") {
        return {
          observedAt: "2026-06-03T00:00:00.000Z",
          cpu: {
            usedRatio: 0.42,
            logicalCoreCount: 10
          },
          memory: {
            usedBytes: 8.5 * 1024 ** 3,
            totalBytes: 16 * 1024 ** 3,
            freeBytes: 7.5 * 1024 ** 3
          },
          disk: {
            usedBytes: 300 * 1024 ** 3,
            totalBytes: 500 * 1024 ** 3,
            freeBytes: 200 * 1024 ** 3
          }
        } as never;
      }

      throw new Error(`unexpected request: ${path}`);
    });

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: "查看 HOST 远程 Host 连接详情" }));

    const detailPanel = await screen.findByRole("region", { name: "连接详情" });

    expect(within(detailPanel).getAllByText("CodingNS Connect")).toHaveLength(2);
    expect(within(detailPanel).getByText("https://demo.channel.codingns.com")).toBeInTheDocument();
    expect(within(detailPanel).getByText("2.0 KB")).toBeInTheDocument();
    expect(within(detailPanel).getAllByText("42% · 10 核").length).toBeGreaterThan(0);
    expect(within(detailPanel).getAllByText("8.5 GB / 16.0 GB").length).toBeGreaterThan(0);
    expect(within(detailPanel).getAllByText("200.0 GB / 500.0 GB").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(httpClient.request).toHaveBeenCalledWith("/api/client/runtime-config");
      expect(httpClient.request).toHaveBeenCalledWith("/api/system/host/resources");
      expect(within(detailPanel).getByText(/\d+ ms$/)).toBeInTheDocument();
    });
  });
});

function buildPeerHostDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "peer-1",
    ownerUserId: "user-1",
    name: "办公室 Host",
    alias: "HOST",
    baseUrl: "http://10.10.1.8:3002",
    normalizedBaseUrl: "http://10.10.1.8:3002",
    status: "reachable",
    remoteVersion: "0.9.8",
    remoteApiCompatibility: "peer-host-v1",
    remoteHostFingerprint: "fingerprint-1",
    lastCheckedAt: "2026-06-10T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    removedAt: null,
    ...overrides
  };
}
