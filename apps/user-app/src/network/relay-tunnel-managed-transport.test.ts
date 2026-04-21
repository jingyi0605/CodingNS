import { describe, expect, it, vi } from "vitest";

import type {
  HostTransportFetchRequest,
  HostTransportSocket,
  HostTransportWebSocketRequest
} from "./host-transport";
import type { RelayTunnelPacketSession } from "./relay-tunnel-client-session";
import { ManagedRelayTunnelHostTransport } from "./relay-tunnel-managed-transport";

class MockRelaySocket extends EventTarget implements HostTransportSocket {
  readyState = 0;
  readonly sentPayloads: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sentPayloads.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }));
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  emitMessage(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  emitClose(code: number, reason: string): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
}

class MockPacketSession implements RelayTunnelPacketSession {
  send = vi.fn<(packet: never) => void>();
  subscribe = vi.fn(() => () => undefined);
  close = vi.fn<(code?: number, reason?: string) => void>();
}

type ManagedTransportDependencies = NonNullable<
  ConstructorParameters<typeof ManagedRelayTunnelHostTransport>[1]
>;

describe("ManagedRelayTunnelHostTransport", () => {
  it("会在连接成功后延迟绑定真实 WebSocket 并转发事件", async () => {
    const socket = new MockRelaySocket();
    const clientSession = new MockPacketSession();
    const createWebSocket = vi.fn<(request: HostTransportWebSocketRequest) => HostTransportSocket>().mockReturnValue(socket);
    const connectSession = (async () => ({
      binding: {
        bindingId: "binding-1",
        tunnelDomain: "demo.codingns.example",
        hostPublicKey: "host-public-key",
        hostFingerprint: "host-fingerprint",
        relayBaseUrl: "wss://relay.codingns.example",
        controlBaseUrl: "https://control.codingns.example",
        status: "active"
      },
      reservation: {
        sessionId: "session-1",
        accountId: "account-1",
        bindingId: "binding-1",
        tunnelDomain: "demo.codingns.example",
        remainingBytes: "1024",
        upstreamConnected: true,
        downstreamConnected: true
      },
      channel: {
        send: () => undefined,
        subscribe: () => () => undefined,
        close: () => undefined
      },
      clientSession
    })) as unknown as ManagedTransportDependencies["connectSession"];
    const transport = new ManagedRelayTunnelHostTransport(
      {
        hostId: "host-1",
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example"
      },
      {
        connectSession,
        createTransport: () => ({
          fetch: vi.fn<(request: HostTransportFetchRequest) => Promise<Response>>(),
          createWebSocket,
          close: vi.fn()
        })
      }
    );

    const wrapperSocket = transport.createWebSocket({
      path: "/ws",
      baseUrl: "https://demo.codingns.example",
      url: "wss://demo.codingns.example/ws"
    });
    const opened: string[] = [];
    const receivedMessages: string[] = [];
    const closeCodes: number[] = [];

    wrapperSocket.addEventListener("open", () => {
      opened.push("open");
    });
    wrapperSocket.addEventListener("message", (event) => {
      receivedMessages.push((event as MessageEvent<string>).data);
    });
    wrapperSocket.addEventListener("close", (event) => {
      closeCodes.push((event as CloseEvent).code);
    });

    await vi.waitFor(() => {
      expect(createWebSocket).toHaveBeenCalledWith({
        path: "/ws",
        baseUrl: "https://demo.codingns.example",
        url: "wss://demo.codingns.example/ws"
      });
    });

    socket.open();
    socket.emitMessage("hello");
    socket.emitClose(1000, "done");

    expect(opened).toEqual(["open"]);
    expect(receivedMessages).toEqual(["hello"]);
    expect(closeCodes).toEqual([1000]);
  });

  it("连接失败时会把错误映射成 error 和 close 事件", async () => {
    const transport = new ManagedRelayTunnelHostTransport(
      {
        hostId: "host-1",
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example"
      },
      {
        connectSession: (async () => {
          throw new Error("connect failed");
        }) as unknown as ManagedTransportDependencies["connectSession"]
      }
    );
    const wrapperSocket = transport.createWebSocket({
      path: "/ws",
      baseUrl: "https://demo.codingns.example",
      url: "wss://demo.codingns.example/ws"
    });
    const errorListener = vi.fn<(event: ErrorEvent) => void>();
    const closeListener = vi.fn<(event: CloseEvent) => void>();

    wrapperSocket.addEventListener("error", errorListener as unknown as EventListener);
    wrapperSocket.addEventListener("close", closeListener as unknown as EventListener);

    await vi.waitFor(() => {
      expect(errorListener).toHaveBeenCalledTimes(1);
      expect(closeListener).toHaveBeenCalledTimes(1);
    });

    expect(errorListener.mock.calls[0]?.[0].message).toBe("connect failed");
    expect(closeListener.mock.calls[0]?.[0].code).toBe(1011);
  });

  it("隧道握手失败时会回退到直连 transport", async () => {
    const fallbackFetch = vi.fn<(request: HostTransportFetchRequest) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );
    const fallbackSocket = new MockRelaySocket();
    const fallbackCreateWebSocket = vi.fn<(request: HostTransportWebSocketRequest) => HostTransportSocket>()
      .mockReturnValue(fallbackSocket);
    const transport = new ManagedRelayTunnelHostTransport(
      {
        hostId: "host-1",
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example"
      },
      {
        connectSession: (async () => {
          throw new Error("connect failed");
        }) as unknown as ManagedTransportDependencies["connectSession"],
        fallbackTransport: {
          fetch: fallbackFetch,
          createWebSocket: fallbackCreateWebSocket
        }
      }
    );

    const response = await transport.fetch({
      path: "/api/demo",
      baseUrl: "http://127.0.0.1:3009",
      url: "http://127.0.0.1:3009/api/demo",
      init: {
        method: "GET"
      }
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(fallbackFetch).toHaveBeenCalledTimes(1);

    const socket = transport.createWebSocket({
      path: "/ws",
      baseUrl: "http://127.0.0.1:3009",
      url: "ws://127.0.0.1:3009/ws"
    });
    const openListener = vi.fn();

    socket.addEventListener("open", openListener);

    await vi.waitFor(() => {
      expect(fallbackCreateWebSocket).toHaveBeenCalledWith({
        path: "/ws",
        baseUrl: "http://127.0.0.1:3009",
        url: "ws://127.0.0.1:3009/ws"
      });
    });

    fallbackSocket.open();

    expect(openListener).toHaveBeenCalledTimes(1);
  });

  it("真实 socket 建立前关闭时不会继续绑定后续连接", async () => {
    let resolveConnection: ((value: unknown) => void) | null = null;
    const createWebSocket = vi.fn<(request: HostTransportWebSocketRequest) => HostTransportSocket>();
    const clientSession = new MockPacketSession();
    const transport = new ManagedRelayTunnelHostTransport(
      {
        hostId: "host-1",
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example"
      },
      {
        connectSession: (() =>
          new Promise((resolve) => {
            resolveConnection = resolve;
          })) as unknown as ManagedTransportDependencies["connectSession"],
        createTransport: () => ({
          fetch: vi.fn<(request: HostTransportFetchRequest) => Promise<Response>>(),
          createWebSocket,
          close: vi.fn()
        })
      }
    );

    const wrapperSocket = transport.createWebSocket({
      path: "/ws",
      baseUrl: "https://demo.codingns.example",
      url: "wss://demo.codingns.example/ws"
    });
    const closeListener = vi.fn<(event: CloseEvent) => void>();

    wrapperSocket.addEventListener("close", closeListener as unknown as EventListener);
    wrapperSocket.close(1000, "cancelled");

    expect(closeListener).toHaveBeenCalledTimes(1);
    expect(closeListener.mock.calls[0]?.[0].code).toBe(1000);
    expect(resolveConnection).not.toBeNull();

    if (!resolveConnection) {
      throw new Error("连接 promise 没有暴露 resolve");
    }

    (resolveConnection as (value: unknown) => void)({
      binding: {
        bindingId: "binding-1",
        tunnelDomain: "demo.codingns.example",
        hostPublicKey: "host-public-key",
        hostFingerprint: "host-fingerprint",
        relayBaseUrl: "wss://relay.codingns.example",
        controlBaseUrl: "https://control.codingns.example",
        status: "active"
      },
      reservation: {
        sessionId: "session-1",
        accountId: "account-1",
        bindingId: "binding-1",
        tunnelDomain: "demo.codingns.example",
        remainingBytes: "1024",
        upstreamConnected: true,
        downstreamConnected: true
      },
      channel: {
        send: () => undefined,
        subscribe: () => () => undefined,
        close: () => undefined
      },
      clientSession
    });

    await vi.waitFor(() => {
      expect(createWebSocket).not.toHaveBeenCalled();
    });
  });
});
