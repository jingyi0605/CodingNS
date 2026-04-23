import { describe, expect, it, vi } from "vitest";

import { acceptRelayTunnelClientHandshake, type RelayTunnelClientHello } from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-protocol";
import { generateRelayTunnelIdentity } from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-identity-service";
import { clientConfigStore } from "../config/client-config-store";
import { connectRelayTunnelClientSessionViaEdge, connectRelayTunnelRawChannel } from "./relay-tunnel-edge-client";

class MockRelayEdgeSocket extends EventTarget {
  readyState = 0;
  sentPayloads: string[] = [];

  constructor(public readonly url: string) {
    super();
  }

  send(data: string): void {
    this.sentPayloads.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }));
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  openThenClose(code = 1012, reason = "HOST_UPSTREAM_DISCONNECTED"): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
    this.close(code, reason);
  }

  emitMessage(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function createConnectInitResponse(input: {
  hostPublicKey: string;
  hostFingerprint: string;
  relayBaseUrl?: string;
  controlBaseUrl?: string;
  sessionId?: string;
  connectTicket?: string;
}): Response {
  return new Response(
    JSON.stringify({
      bindingId: "binding_1",
      tunnelDomain: "demo.codingns.example",
      relayBaseUrl: input.relayBaseUrl ?? "https://relay.example.com",
      controlBaseUrl: input.controlBaseUrl ?? "https://control.example.com",
      hostPublicKey: input.hostPublicKey,
      hostFingerprint: input.hostFingerprint,
      status: "active",
      sessionId: input.sessionId ?? "session_demo",
      connectTicket: input.connectTicket ?? "ticket_demo",
      remainingBytes: "1024",
      sessionRateLimitBytesPerSecond: "204800",
      upstreamConnected: false,
      downstreamConnected: false,
      expiresAt: "2026-04-21T10:01:00.000Z"
    }),
    {
      status: 201,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

describe("relay-tunnel-edge-client", () => {
  it("会通过 connect-init 一次拿到建连信息，并按 downstream 角色连接 relay-edge", async () => {
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bindingId: "binding_1",
            tunnelDomain: "demo.codingns.example",
            relayBaseUrl: "https://relay.example.com",
            controlBaseUrl: "https://control.example.com",
            hostPublicKey: "PUBLIC_KEY_DEMO",
            hostFingerprint: "SHA256:demo",
            status: "active",
            sessionId: "session_demo",
            connectTicket: "ticket_demo",
            remainingBytes: "1024",
            sessionRateLimitBytesPerSecond: "204800",
            upstreamConnected: false,
            downstreamConnected: false,
            expiresAt: "2026-04-21T10:01:00.000Z"
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      );
    const socket = new MockRelayEdgeSocket(
      "wss://relay.example.com/ws?sessionId=session_demo&role=downstream&connectTicket=ticket_demo"
    );
    const connectPromise = connectRelayTunnelRawChannel(
      {
        controlBaseUrl: "https://control.example.com",
        tunnelDomain: "Demo.CodingNS.Example"
      },
      {
        fetchFn: fetchMock,
        createWebSocket: () => socket
      }
    );

    socket.open();
    const result = await connectPromise;

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://control.example.com/api/v1/tunnels/demo.codingns.example/connect-init", expect.objectContaining({
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    }));
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toMatchObject({
      clientContext: {
        runtimePlatform: "web",
        language: expect.any(String)
      }
    });
    expect(result.binding.hostPublicKey).toBe("PUBLIC_KEY_DEMO");
    expect(result.reservation.sessionId).toBe("session_demo");
    expect(socket.url).toBe("wss://relay.example.com/ws?sessionId=session_demo&role=downstream&connectTicket=ticket_demo");
  });

  it("可以通过真实 edge 原始链路驱动客户端加密会话发出 client_hello", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        createConnectInitResponse({
          hostPublicKey: hostIdentity.publicKeyPem,
          hostFingerprint: hostIdentity.keyFingerprint
        })
      );
    const socket = new MockRelayEdgeSocket(
      "wss://relay.example.com/ws?sessionId=session_demo&role=downstream&connectTicket=ticket_demo"
    );
    const connectPromise = connectRelayTunnelClientSessionViaEdge(
      {
        controlBaseUrl: "https://control.example.com",
        tunnelDomain: "demo.codingns.example"
      },
      {
        fetchFn: fetchMock,
        createWebSocket: () => socket
      }
    );

    socket.open();
    await vi.waitFor(() => {
      expect(socket.sentPayloads).toHaveLength(1);
    });

    const clientHelloEnvelope = JSON.parse(socket.sentPayloads[0]) as {
      type: "client_hello";
      hello: RelayTunnelClientHello;
    };
    const { serverHello } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello: clientHelloEnvelope.hello
    });

    socket.emitMessage(JSON.stringify({
      type: "server_hello",
      hello: serverHello
    }));

    const connected = await connectPromise;

    expect(connected.binding.hostFingerprint).toBe(hostIdentity.keyFingerprint);
    expect(connected.clientSession).toBeDefined();
  });

  it("原始链路在建立后立刻断开时会自动重试并恢复握手", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        createConnectInitResponse({
          hostPublicKey: hostIdentity.publicKeyPem,
          hostFingerprint: hostIdentity.keyFingerprint,
          sessionId: "session_retry_1",
          connectTicket: "ticket_retry_1"
        })
      )
      .mockResolvedValueOnce(
        createConnectInitResponse({
          hostPublicKey: hostIdentity.publicKeyPem,
          hostFingerprint: hostIdentity.keyFingerprint,
          sessionId: "session_retry_2",
          connectTicket: "ticket_retry_2"
        })
      );
    const firstSocket = new MockRelayEdgeSocket(
      "wss://relay.example.com/ws?sessionId=session_retry_1&role=downstream&connectTicket=ticket_retry_1"
    );
    const secondSocket = new MockRelayEdgeSocket(
      "wss://relay.example.com/ws?sessionId=session_retry_2&role=downstream&connectTicket=ticket_retry_2"
    );
    const createWebSocket = vi.fn()
      .mockReturnValueOnce(firstSocket)
      .mockReturnValueOnce(secondSocket);
    const connectPromise = connectRelayTunnelClientSessionViaEdge(
      {
        controlBaseUrl: "https://control.example.com",
        tunnelDomain: "demo.codingns.example"
      },
      {
        fetchFn: fetchMock,
        createWebSocket
      }
    );

    await vi.waitFor(() => {
      expect(createWebSocket).toHaveBeenCalledTimes(1);
    });

    firstSocket.openThenClose();

    await vi.waitFor(() => {
      expect(createWebSocket).toHaveBeenCalledTimes(2);
    });

    secondSocket.open();
    await vi.waitFor(() => {
      expect(secondSocket.sentPayloads).toHaveLength(1);
    });

    const clientHelloEnvelope = JSON.parse(secondSocket.sentPayloads[0]) as {
      type: "client_hello";
      hello: RelayTunnelClientHello;
    };
    const { serverHello } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello: clientHelloEnvelope.hello
    });

    secondSocket.emitMessage(JSON.stringify({
      type: "server_hello",
      hello: serverHello
    }));

    const connected = await connectPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(connected.reservation.sessionId).toBe("session_retry_2");
  });

  it("会保留 relayBaseUrl 里的路径前缀来 connect-init 并连接 ws", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bindingId: "binding_1",
            tunnelDomain: "demo.codingns.example",
            relayBaseUrl: "https://channel.codingns.com:1443/relay",
            controlBaseUrl: "https://channel.codingns.com:1443",
            hostPublicKey: "PUBLIC_KEY_DEMO",
            hostFingerprint: "SHA256:demo",
            status: "active",
            sessionId: "session_demo",
            connectTicket: "ticket_demo",
            remainingBytes: "1024",
            sessionRateLimitBytesPerSecond: "204800",
            upstreamConnected: false,
            downstreamConnected: false,
            expiresAt: "2026-04-21T10:01:00.000Z"
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      );
    const socket = new MockRelayEdgeSocket(
      "wss://channel.codingns.com:1443/relay/ws?sessionId=session_demo&role=downstream&connectTicket=ticket_demo"
    );
    const connectPromise = connectRelayTunnelRawChannel(
      {
        controlBaseUrl: "https://channel.codingns.com:1443",
        tunnelDomain: "demo.codingns.example"
      },
      {
        fetchFn: fetchMock,
        createWebSocket: () => socket
      }
    );

    socket.open();
    await connectPromise;

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://channel.codingns.com:1443/api/v1/tunnels/demo.codingns.example/connect-init",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(socket.url).toBe(
      "wss://channel.codingns.com:1443/relay/ws?sessionId=session_demo&role=downstream&connectTicket=ticket_demo"
    );
  });
});
