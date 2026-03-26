import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { authStore } from "../../auth/store/auth-store";
import { TerminalRealtimeClient } from "./terminal-realtime-client";

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];
  private readonly listeners = new Map<string, Array<(event?: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: { data?: string }) => void): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(payload: string): void {
    this.sentMessages.push(payload);
  }

  close(): void {
    this.emit("close");
  }

  emit(type: string, event?: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("terminal realtime client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://192.168.2.59:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate({
      accessToken: "token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    });
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    authStore.clear();
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it("不会把 input.accepted 和 exit 误当成 terminal.status", () => {
    const onStatus = vi.fn();
    const onError = vi.fn();
    const onOutput = vi.fn();
    const onBackfill = vi.fn();
    const onSubscribed = vi.fn();
    const onUnauthorized = vi.fn();
    const onConnectionChange = vi.fn();

    const client = new TerminalRealtimeClient({
      terminalId: "terminal-1",
      lastCursor: null,
      onConnectionChange,
      onSubscribed,
      onBackfill,
      onOutput,
      onStatus,
      onError,
      onUnauthorized
    });

    client.start();

    const socket = MockWebSocket.instances[0];

    if (!socket) {
      throw new Error("WebSocket 未创建");
    }

    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({ type: "terminal.input.accepted", terminalId: "terminal-1" })
    });
    socket.emit("message", {
      data: JSON.stringify({
        type: "terminal.exit",
        terminalId: "terminal-1",
        requestedClose: false,
        terminal: {
          id: "terminal-1",
          status: "closed",
          statusDetail: null
        }
      })
    });
    socket.emit("message", {
      data: JSON.stringify({
        type: "terminal.status",
        terminal: {
          id: "terminal-1",
          status: "running",
          statusDetail: null
        }
      })
    });

    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith({
      type: "terminal.status",
      terminal: {
        id: "terminal-1",
        status: "running",
        statusDetail: null
      }
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onOutput).not.toHaveBeenCalled();
    expect(onBackfill).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
