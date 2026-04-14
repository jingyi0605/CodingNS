import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../features/auth/store/auth-store";
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
});
