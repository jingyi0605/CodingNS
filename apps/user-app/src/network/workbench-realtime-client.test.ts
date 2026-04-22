import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { getHostBaseUrl, getHostWebSocketUrl } from "../config/env";
import { authStore, type AuthSession } from "../features/auth/store/auth-store";
import { hostRuntimeStore } from "../config/host-runtime-store";
import { setHostTransportResolverForTesting } from "./host-transport-registry";
import { WorkbenchRealtimeClient } from "./workbench-realtime-client";

const session: AuthSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
  user: {
    userId: "user-1",
    username: "admin",
    role: "admin"
  }
};

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static reset() {
    MockWebSocket.instances = [];
  }

  readyState = 0;
  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;
  sentPayloads: string[] = [];

  constructor(public readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
}

describe("WorkbenchRealtimeClient", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    authStore.hydrate(session);
    MockWebSocket.reset();
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    authStore.clear();
    global.WebSocket = originalWebSocket;
    setHostTransportResolverForTesting(null);
    vi.restoreAllMocks();
  });

  it("会在连接建立后补发右侧面板的订阅与刷新请求", () => {
    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    const socket = MockWebSocket.instances[0];

    expect(socket).toBeDefined();

    client.subscribeFileTree("workspace-1", ["src", "src/components"]);
    client.requestFileTreeRefresh("workspace-1", ["src"]);
    client.subscribeGit("workspace-1");
    client.requestGitRefresh("workspace-1");
    client.subscribeTerminalManager("workspace-1");
    client.requestTerminalManagerRefresh("workspace-1");

    expect(socket?.sentPayloads).toHaveLength(0);

    socket?.open();

    expect(socket?.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      { type: "workbench.subscribe" },
      {
        type: "fileTree.subscribe",
        workspaceId: "workspace-1",
        paths: ["src", "src/components"]
      },
      {
        type: "fileTree.refresh",
        workspaceId: "workspace-1",
        paths: ["src"]
      },
      {
        type: "git.subscribe",
        workspaceId: "workspace-1"
      },
      {
        type: "git.refresh",
        workspaceId: "workspace-1"
      },
      {
        type: "terminalManager.subscribe",
        workspaceId: "workspace-1"
      },
      {
        type: "terminalManager.refresh",
        workspaceId: "workspace-1"
      }
    ]);

    client.close();
  });

  it("收到 workbench.delta 时会在本地合并快照", () => {
    const onSnapshot = vi.fn();
    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot,
      onUnauthorized: () => undefined
    });

    client.start();

    const socket = MockWebSocket.instances[0];

    socket?.open();
    socket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "workbench.snapshot",
          revision: "rev-1",
          unchanged: false,
          snapshot: {
            items: [
              {
                workspace: {
                  id: "workspace-1",
                  name: "Workspace 1",
                  path: "/tmp/workspace-1",
                  createdAt: "2026-04-22T00:00:00.000Z",
                  updatedAt: "2026-04-22T00:00:00.000Z"
                },
                sessions: [],
                collapsed: false
              },
              {
                workspace: {
                  id: "workspace-2",
                  name: "Workspace 2",
                  path: "/tmp/workspace-2",
                  createdAt: "2026-04-22T00:00:00.000Z",
                  updatedAt: "2026-04-22T00:00:00.000Z"
                },
                sessions: [],
                collapsed: false
              }
            ]
          }
        })
      })
    );
    socket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "workbench.delta",
          baseRevision: "rev-1",
          revision: "rev-2",
          orderedWorkspaceIds: ["workspace-2", "workspace-1"],
          removedWorkspaceIds: [],
          changedItems: [
            {
              workspace: {
                id: "workspace-2",
                name: "Workspace 2 Updated",
                path: "/tmp/workspace-2",
                createdAt: "2026-04-22T00:00:00.000Z",
                updatedAt: "2026-04-22T00:00:01.000Z"
              },
              sessions: [
                {
                  sessionId: "session-2",
                  workspaceId: "workspace-2",
                  provider: "codex",
                  title: "Updated Session",
                  status: "active",
                  updatedAt: "2026-04-22T00:00:01.000Z",
                  createdAt: "2026-04-22T00:00:00.000Z",
                  lastMessageAt: "2026-04-22T00:00:01.000Z",
                  archivedAt: null,
                  pinned: false
                }
              ],
              collapsed: true
            }
          ]
        })
      })
    );

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[1]?.[0]).toMatchObject({
      revision: "rev-2",
      items: [
        {
          workspace: {
            id: "workspace-2",
            name: "Workspace 2 Updated"
          },
          sessions: [
            {
              sessionId: "session-2"
            }
          ],
          collapsed: true
        },
        {
          workspace: {
            id: "workspace-1"
          }
        }
      ]
    });

    client.close();
  });

  it("收到未授权事件时会先尝试恢复登录态，而不是立刻回登录页", async () => {
    const onUnauthorized = vi.fn();
    const refreshSpy = vi.spyOn(authStore, "refresh").mockResolvedValue({
      status: "deferred",
      session,
      error: new Error("host booting")
    });
    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot: () => undefined,
      onUnauthorized
    });

    client.start();

    const socket = MockWebSocket.instances[0];

    socket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.error",
          error_code: "UNAUTHORIZED",
          detail: "access token 无效"
        })
      })
    );

    await vi.waitFor(() => {
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
    expect(onUnauthorized).not.toHaveBeenCalled();

    client.close();
  });

  it("可以通过自定义 Host transport 建立工作台实时连接", () => {
    const expectedBaseUrl = getHostBaseUrl();
    const transportSocket = new MockWebSocket("transport://workbench");
    const createWebSocket = vi.fn(() => transportSocket);
    setHostTransportResolverForTesting(() => ({
      fetch: vi.fn(),
      createWebSocket
    }));

    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    expect(createWebSocket).toHaveBeenCalledTimes(1);
    expect(createWebSocket).toHaveBeenCalledWith({
      path: "/ws",
      baseUrl: expectedBaseUrl,
      url: `${getHostWebSocketUrl("/ws", expectedBaseUrl)}?access_token=access-token`
    });

    transportSocket.open();

    expect(transportSocket.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      { type: "workbench.subscribe" }
    ]);

    client.close();
  });

  it("当前活跃入口切到 lan 时，会用 lan 地址建立工作台实时连接", () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-relay",
      hosts: [
        {
          id: "host-relay",
          name: "demo.channel.codingns.com",
          baseUrl: "https://demo.channel.codingns.com",
          kind: "remote",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          relayTunnel: {
            provider: "codingns_relay",
            enabled: true,
            tunnelDomain: "demo.channel.codingns.com",
            controlBaseUrl: "https://control.codingns.example",
            bindingId: "binding_demo",
            hostFingerprint: "SHA256:demo",
            candidateEndpoints: [
              {
                endpointId: "host_reported:http://192.168.50.8:3002",
                kind: "lan",
                url: "http://192.168.50.8:3002",
                priority: 200,
                expiresAt: null,
                source: "host_reported"
              },
              {
                endpointId: "relay:https://demo.channel.codingns.com",
                kind: "relay",
                url: "https://demo.channel.codingns.com",
                priority: 400,
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
    authStore.hydrate(session);
    vi.spyOn(hostRuntimeStore, "getState").mockReturnValue({
      epoch: 1,
      activeHostId: "host-relay",
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
        }
      ],
      preferredCandidateEndpointId: "host_reported:http://192.168.50.8:3002",
      preferredDirectCandidateEndpointId: "host_reported:http://192.168.50.8:3002"
    });

    const transportSocket = new MockWebSocket("transport://workbench-lan");
    const createWebSocket = vi.fn(() => transportSocket);
    setHostTransportResolverForTesting(() => ({
      fetch: vi.fn(),
      createWebSocket
    }));

    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    expect(createWebSocket).toHaveBeenCalledWith({
      path: "/ws",
      baseUrl: "http://192.168.50.8:3002",
      url: "ws://192.168.50.8:3002/ws?access_token=access-token"
    });
    expect(getHostBaseUrl()).toBe("https://demo.channel.codingns.com");

    client.close();
  });
});
