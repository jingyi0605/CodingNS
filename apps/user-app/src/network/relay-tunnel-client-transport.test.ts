import { describe, expect, it, vi } from "vitest";

import { RelayTunnelClientTransport } from "./relay-tunnel-client-transport";
import type { RelayTunnelGatewayPacket } from "./relay-tunnel-packets";

class MockRelayTunnelSession {
  readonly sentPackets: RelayTunnelGatewayPacket[] = [];
  private readonly listeners = new Set<(packet: RelayTunnelGatewayPacket) => void>();

  send(packet: RelayTunnelGatewayPacket): void {
    this.sentPackets.push(packet);
  }

  subscribe(listener: (packet: RelayTunnelGatewayPacket) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(packet: RelayTunnelGatewayPacket): void {
    for (const listener of this.listeners) {
      listener(packet);
    }
  }
}

describe("RelayTunnelClientTransport", () => {
  it("会把 HTTP 请求编码成隧道包，并等待响应包还原成 Response", async () => {
    const session = new MockRelayTunnelSession();
    const transport = new RelayTunnelClientTransport(session);
    const responsePromise = transport.fetch({
      path: "/api/demo?hello=world",
      baseUrl: "https://app.codingns.cn",
      url: "https://app.codingns.cn/api/demo?hello=world",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ ok: true })
      }
    });
    await vi.waitFor(() => {
      expect(session.sentPackets).toHaveLength(1);
    });

    const requestPacket = session.sentPackets[0];

    expect(requestPacket?.type).toBe("http.request");

    if (!requestPacket || requestPacket.type !== "http.request") {
      throw new Error("没有发出 http.request 包");
    }

    expect(requestPacket).toMatchObject({
      type: "http.request",
      method: "POST",
      path: "/api/demo?hello=world",
      headers: {
        "content-type": "application/json"
      }
    });

    expect(requestPacket.type).toBe("http.request");

    session.emit({
      type: "http.response",
      streamId: requestPacket.streamId,
      status: 200,
      headers: {
        "content-type": "application/json"
      },
      bodyBase64Url: encodeBase64Url(JSON.stringify({ accepted: true }))
    });

    const response = await responsePromise;

    await expect(response.json()).resolves.toEqual({
      accepted: true
    });
  });

  it("会把 WebSocket 打开、收发消息和关闭都映射成隧道包", async () => {
    const session = new MockRelayTunnelSession();
    const transport = new RelayTunnelClientTransport(session);
    const socket = transport.createWebSocket({
      path: "/ws",
      baseUrl: "https://app.codingns.cn",
      url: "wss://app.codingns.cn/ws"
    });

    const openPacket = session.sentPackets[0];

    expect(openPacket).toEqual({
      type: "ws.open",
      streamId: "ws-1",
      path: "/ws",
      headers: {}
    });

    const openedEvents: string[] = [];
    const receivedMessages: Array<string | Uint8Array> = [];
    let closeCode = 0;

    socket.addEventListener("open", () => {
      openedEvents.push("open");
    });
    socket.addEventListener("message", (event) => {
      const messageEvent = event as MessageEvent<string | Uint8Array>;
      receivedMessages.push(messageEvent.data);
    });
    socket.addEventListener("close", (event) => {
      closeCode = (event as CloseEvent).code;
    });

    session.emit({
      type: "ws.opened",
      streamId: "ws-1"
    });

    expect(openedEvents).toEqual(["open"]);

    socket.send("hello");

    expect(session.sentPackets[1]).toEqual({
      type: "ws.message",
      streamId: "ws-1",
      binary: false,
      dataBase64Url: encodeBase64Url("hello")
    });

    session.emit({
      type: "ws.message",
      streamId: "ws-1",
      binary: false,
      dataBase64Url: encodeBase64Url("world")
    });

    expect(receivedMessages).toEqual(["world"]);

    socket.close(1000, "done");

    expect(session.sentPackets[2]).toEqual({
      type: "ws.closed",
      streamId: "ws-1",
      code: 1000,
      reason: "done"
    });

    session.emit({
      type: "ws.closed",
      streamId: "ws-1",
      code: 1000,
      reason: "done"
    });

    expect(closeCode).toBe(1000);
  });
});

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
