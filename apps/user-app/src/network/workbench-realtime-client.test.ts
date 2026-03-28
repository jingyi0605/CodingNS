import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../features/auth/store/auth-store";
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
});
