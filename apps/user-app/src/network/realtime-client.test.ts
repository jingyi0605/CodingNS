import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { getHostBaseUrl, getHostWebSocketUrl } from "../config/env";
import { hostRuntimeStore } from "../config/host-runtime-store";
import { authStore, type AuthSession } from "../features/auth/store/auth-store";
import { setHostTransportResolverForTesting } from "./host-transport-registry";
import { RealtimeClient } from "./realtime-client";

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

describe("RealtimeClient", () => {
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

  it("会等 session.subscribed 之后再发送加载更早消息请求", () => {
    const onSubscribed = vi.fn();
    const client = new RealtimeClient({
      sessionId: "session-1",
      cursor: "cursor-1",
      limit: 50,
      onConnectionChange: () => undefined,
      onSubscribed,
      onEnvelope: () => undefined,
      onOlderHistory: () => undefined,
      onRuntimeMessage: () => undefined,
      onActivity: () => undefined,
      onRuntimeStatus: () => undefined,
      onRuntimeError: () => undefined,
      onInterrupted: () => undefined,
      onPermissionRequest: () => undefined,
      onPermissionRequestResolved: () => undefined,
      onError: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    const socket = MockWebSocket.instances[0];

    expect(socket).toBeDefined();

    socket?.open();

    expect(socket?.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session.subscribe",
        sessionId: "session-1",
        cursor: "cursor-1",
        limit: 50
      }
    ]);

    expect(client.requestOlderMessages("older-cursor-1", 20)).toBe(true);
    expect(socket?.sentPayloads).toHaveLength(1);

    socket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.subscribed",
          sessionId: "session-1"
        })
      })
    );

    expect(onSubscribed).toHaveBeenCalledTimes(1);
    expect(socket?.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session.subscribe",
        sessionId: "session-1",
        cursor: "cursor-1",
        limit: 50
      },
      {
        type: "session.load_older",
        sessionId: "session-1",
        cursor: "older-cursor-1",
        limit: 20
      }
    ]);

    client.close();
  });

  it("older 请求发出后如果连接重建，会在重新订阅后自动补发", () => {
    const client = new RealtimeClient({
      sessionId: "session-1",
      cursor: "cursor-1",
      limit: 50,
      onConnectionChange: () => undefined,
      onSubscribed: () => undefined,
      onEnvelope: () => undefined,
      onOlderHistory: () => undefined,
      onRuntimeMessage: () => undefined,
      onActivity: () => undefined,
      onRuntimeStatus: () => undefined,
      onRuntimeError: () => undefined,
      onInterrupted: () => undefined,
      onPermissionRequest: () => undefined,
      onPermissionRequestResolved: () => undefined,
      onError: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    const firstSocket = MockWebSocket.instances[0];

    expect(firstSocket).toBeDefined();

    firstSocket?.open();
    firstSocket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.subscribed",
          sessionId: "session-1"
        })
      })
    );

    expect(client.requestOlderMessages("older-cursor-1", 20)).toBe(true);
    expect(firstSocket?.sentPayloads.map((payload) => JSON.parse(payload)).at(-1)).toEqual({
      type: "session.load_older",
      sessionId: "session-1",
      cursor: "older-cursor-1",
      limit: 20
    });

    firstSocket?.close();
    client.reconnectNow();

    const secondSocket = MockWebSocket.instances[1];

    expect(secondSocket).toBeDefined();

    secondSocket?.open();
    expect(secondSocket?.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session.subscribe",
        sessionId: "session-1",
        cursor: "cursor-1",
        limit: 50
      }
    ]);

    secondSocket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.subscribed",
          sessionId: "session-1"
        })
      })
    );

    expect(secondSocket?.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session.subscribe",
        sessionId: "session-1",
        cursor: "cursor-1",
        limit: 50
      },
      {
        type: "session.load_older",
        sessionId: "session-1",
        cursor: "older-cursor-1",
        limit: 20
      }
    ]);

    client.close();
  });

  it("当前活跃入口切到 lan 时，会用 lan 地址建立实时连接", () => {
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

    const transportSocket = new MockWebSocket("transport://lan");
    const createWebSocket = vi.fn(() => transportSocket);
    setHostTransportResolverForTesting(() => ({
      fetch: vi.fn(),
      createWebSocket
    }));

    const client = new RealtimeClient({
      sessionId: "session-1",
      cursor: "cursor-1",
      limit: 50,
      onConnectionChange: () => undefined,
      onSubscribed: () => undefined,
      onEnvelope: () => undefined,
      onOlderHistory: () => undefined,
      onRuntimeMessage: () => undefined,
      onActivity: () => undefined,
      onRuntimeStatus: () => undefined,
      onRuntimeError: () => undefined,
      onInterrupted: () => undefined,
      onPermissionRequest: () => undefined,
      onPermissionRequestResolved: () => undefined,
      onError: () => undefined,
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

  it("收到 older history 响应后，后续重连不会重复补发同一个 older 请求", () => {
    const client = new RealtimeClient({
      sessionId: "session-1",
      cursor: "cursor-1",
      limit: 50,
      onConnectionChange: () => undefined,
      onSubscribed: () => undefined,
      onEnvelope: () => undefined,
      onOlderHistory: () => undefined,
      onRuntimeMessage: () => undefined,
      onActivity: () => undefined,
      onRuntimeStatus: () => undefined,
      onRuntimeError: () => undefined,
      onInterrupted: () => undefined,
      onPermissionRequest: () => undefined,
      onPermissionRequestResolved: () => undefined,
      onError: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    const firstSocket = MockWebSocket.instances[0];

    firstSocket?.open();
    firstSocket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.subscribed",
          sessionId: "session-1"
        })
      })
    );

    expect(client.requestOlderMessages("older-cursor-1", 20)).toBe(true);
    firstSocket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.history_older",
          sessionId: "session-1",
          cursor: null,
          olderCursor: "older-cursor-2",
          messages: []
        })
      })
    );

    firstSocket?.close();
    client.reconnectNow();

    const secondSocket = MockWebSocket.instances[1];

    secondSocket?.open();
    secondSocket?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.subscribed",
          sessionId: "session-1"
        })
      })
    );

    expect(secondSocket?.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session.subscribe",
        sessionId: "session-1",
        cursor: "cursor-1",
        limit: 50
      }
    ]);

    client.close();
  });

  it("可以通过自定义 Host transport 建立实时连接", () => {
    const expectedBaseUrl = getHostBaseUrl();
    const transportSocket = new MockWebSocket("transport://realtime");
    const createWebSocket = vi.fn(() => transportSocket);

    setHostTransportResolverForTesting(() => ({
      fetch: vi.fn(),
      createWebSocket
    }));

    const client = new RealtimeClient({
      sessionId: "session-1",
      cursor: "cursor-1",
      limit: 50,
      onConnectionChange: () => undefined,
      onSubscribed: () => undefined,
      onEnvelope: () => undefined,
      onOlderHistory: () => undefined,
      onRuntimeMessage: () => undefined,
      onActivity: () => undefined,
      onRuntimeStatus: () => undefined,
      onRuntimeError: () => undefined,
      onInterrupted: () => undefined,
      onPermissionRequest: () => undefined,
      onPermissionRequestResolved: () => undefined,
      onError: () => undefined,
      onUnauthorized: () => undefined
    });

    client.start();

    expect(createWebSocket).toHaveBeenCalledTimes(1);
    expect(createWebSocket).toHaveBeenCalledWith({
      path: "/ws",
      baseUrl: expectedBaseUrl,
      url: `${getHostWebSocketUrl("/ws", expectedBaseUrl)}?access_token=access-token`
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    transportSocket.open();

    expect(transportSocket.sentPayloads.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session.subscribe",
        sessionId: "session-1",
        cursor: "cursor-1",
        limit: 50
      }
    ]);

    client.close();
  });
});
