import { describe, expect, it, vi } from "vitest";

import {
  acceptRelayTunnelClientHandshake,
  decryptRelayTunnelFrame as decryptRelayTunnelFrameOnHost,
  encryptRelayTunnelFrame as encryptRelayTunnelFrameOnHost,
  type RelayTunnelClientHello
} from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-protocol";
import { generateRelayTunnelIdentity } from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-identity-service";
import {
  deserializeRelayTunnelPacket,
  serializeRelayTunnelPacket,
  type RelayTunnelGatewayPacket,
  type RelayTunnelHttpResponsePacket,
  type RelayTunnelWsMessagePacket
} from "./relay-tunnel-packets";
import { RelayTunnelClientSession } from "./relay-tunnel-client-session";
import { RelayTunnelClientTransport } from "./relay-tunnel-client-transport";

class MockRawChannel {
  private readonly listeners = new Set<(payload: string) => void>();
  sentPayloads: string[] = [];

  send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  subscribe(listener: (payload: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(payload: string): void {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  close(): void {}
}

describe("RelayTunnelClientSession", () => {
  it("可以在原始链路上完成握手，并收发加密业务包", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const channel = new MockRawChannel();
    const wireSamples: Array<{ direction: "upstream" | "downstream"; bytes: number }> = [];
    const clientSession = new RelayTunnelClientSession(channel, {
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint,
      onWireBytes: (direction, bytes) => {
        wireSamples.push({ direction, bytes });
      }
    });
    const connectPromise = clientSession.connect();
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(1);
    });

    const clientHelloEnvelope = JSON.parse(channel.sentPayloads[0]) as {
      type: "client_hello";
      hello: RelayTunnelClientHello;
    };
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello: clientHelloEnvelope.hello
    });

    channel.emit(
      JSON.stringify({
        type: "server_hello",
        hello: serverHello
      })
    );
    await connectPromise;

    const receivedPackets: RelayTunnelGatewayPacket[] = [];
    clientSession.subscribe((packet) => {
      receivedPackets.push(packet);
    });

    clientSession.send({
      type: "http.request",
      streamId: "http-1",
      method: "GET",
      path: "/api/demo",
      headers: {},
      bodyBase64Url: null
    });
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(2);
    });

    const encryptedEnvelope = JSON.parse(channel.sentPayloads[1]) as {
      type: "encrypted_frame";
      frame: Parameters<typeof decryptRelayTunnelFrameOnHost>[1];
    };
    const decryptedOnHost = deserializeRelayTunnelPacket(
      decryptRelayTunnelFrameOnHost(hostSession, encryptedEnvelope.frame).toString("utf8")
    );

    expect(decryptedOnHost).toEqual({
      type: "http.request",
      streamId: "http-1",
      method: "GET",
      path: "/api/demo",
      headers: {},
      bodyBase64Url: null
    });

    const hostFrame = encryptRelayTunnelFrameOnHost(
      hostSession,
      serializeRelayTunnelPacket({
        type: "http.response",
        streamId: "http-1",
        status: 200,
        headers: {
          "content-type": "application/json"
        },
        bodyBase64Url: toBase64Url(JSON.stringify({ ok: true }))
      } satisfies RelayTunnelHttpResponsePacket)
    );

    channel.emit(
      JSON.stringify({
        type: "encrypted_frame",
        frame: hostFrame
      })
    );
    await vi.waitFor(() => {
      expect(receivedPackets).toHaveLength(1);
    });

    expect(receivedPackets).toEqual([
      {
        type: "http.response",
        streamId: "http-1",
        status: 200,
        headers: {
          "content-type": "application/json"
        },
        bodyBase64Url: toBase64Url(JSON.stringify({ ok: true }))
      }
    ]);
    expect(wireSamples).toEqual([
      {
        direction: "upstream",
        bytes: new TextEncoder().encode(channel.sentPayloads[0]).byteLength
      },
      {
        direction: "downstream",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            type: "server_hello",
            hello: serverHello
          })
        ).byteLength
      },
      {
        direction: "upstream",
        bytes: new TextEncoder().encode(channel.sentPayloads[1]).byteLength
      },
      {
        direction: "downstream",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            type: "encrypted_frame",
            frame: hostFrame
          })
        ).byteLength
      }
    ]);
  });

  it("握手完成前连续收到 server_hello 和首个业务帧时，不会因为竞态把会话打坏", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const channel = new MockRawChannel();
    const clientSession = new RelayTunnelClientSession(channel, {
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const connectPromise = clientSession.connect();
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(1);
    });

    const clientHelloEnvelope = JSON.parse(channel.sentPayloads[0]) as {
      type: "client_hello";
      hello: RelayTunnelClientHello;
    };
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello: clientHelloEnvelope.hello
    });
    const receivedPackets: RelayTunnelGatewayPacket[] = [];

    clientSession.subscribe((packet) => {
      receivedPackets.push(packet);
    });

    channel.emit(JSON.stringify({
      type: "server_hello",
      hello: serverHello
    }));
    channel.emit(JSON.stringify({
      type: "encrypted_frame",
      frame: encryptRelayTunnelFrameOnHost(
        hostSession,
        serializeRelayTunnelPacket({
          type: "http.response",
          streamId: "http-early",
          status: 204,
          headers: {},
          bodyBase64Url: null
        } satisfies RelayTunnelHttpResponsePacket)
      )
    }));

    await connectPromise;
    await vi.waitFor(() => {
      expect(receivedPackets).toEqual([
        {
          type: "http.response",
          streamId: "http-early",
          status: 204,
          headers: {},
          bodyBase64Url: null
        }
      ]);
    });
  });

  it("握手失败后会向上抛出真实错误，而不是继续伪装成未就绪", async () => {
    const channel = new MockRawChannel();
    const clientSession = new RelayTunnelClientSession(channel, {
      expectedHostPublicKey: "PUBLIC_KEY_DEMO",
      expectedHostFingerprint: "SHA256:demo"
    });

    channel.emit(JSON.stringify({
      type: "error",
      errorCode: "HANDSHAKE_REQUIRED",
      detail: "当前会话还没有完成握手"
    }));
    await vi.waitFor(() => {
      expect(() => {
        clientSession.send({
          type: "http.request",
          streamId: "http-1",
          method: "GET",
          path: "/api/demo",
          headers: {},
          bodyBase64Url: null
        });
      }).toThrowError("HANDSHAKE_REQUIRED: 当前会话还没有完成握手");
    });
  });

  it("可以把加密会话直接挂给 RelayTunnelClientTransport 使用", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const channel = new MockRawChannel();
    const clientSession = new RelayTunnelClientSession(channel, {
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const connectPromise = clientSession.connect();
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(1);
    });
    const clientHelloEnvelope = JSON.parse(channel.sentPayloads[0]) as {
      type: "client_hello";
      hello: RelayTunnelClientHello;
    };
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello: clientHelloEnvelope.hello
    });

    channel.emit(JSON.stringify({ type: "server_hello", hello: serverHello }));
    await connectPromise;

    const transport = new RelayTunnelClientTransport(clientSession);
    const responsePromise = transport.fetch({
      path: "/api/demo",
      baseUrl: "https://app.codingns.cn",
      url: "https://app.codingns.cn/api/demo",
      init: {}
    });
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(2);
    });

    const requestEnvelope = JSON.parse(channel.sentPayloads[1]) as {
      type: "encrypted_frame";
      frame: Parameters<typeof decryptRelayTunnelFrameOnHost>[1];
    };
    const requestPacket = deserializeRelayTunnelPacket(
      decryptRelayTunnelFrameOnHost(hostSession, requestEnvelope.frame).toString("utf8")
    );

    if (requestPacket.type !== "http.request") {
      throw new Error("期望拿到 http.request 包");
    }

    expect(requestPacket).toMatchObject({
      type: "http.request",
      path: "/api/demo"
    });

    channel.emit(
      JSON.stringify({
        type: "encrypted_frame",
        frame: encryptRelayTunnelFrameOnHost(
          hostSession,
          serializeRelayTunnelPacket({
            type: "http.response",
            streamId: requestPacket.streamId,
            status: 204,
            headers: {},
            bodyBase64Url: null
          } satisfies RelayTunnelHttpResponsePacket)
        )
      })
    );

    await expect(responsePromise).resolves.toMatchObject({
      status: 204
    });

    const socket = transport.createWebSocket({
      path: "/ws",
      baseUrl: "https://app.codingns.cn",
      url: "wss://app.codingns.cn/ws"
    });
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(3);
    });

    const wsOpenEnvelope = JSON.parse(channel.sentPayloads[2]) as {
      type: "encrypted_frame";
      frame: Parameters<typeof decryptRelayTunnelFrameOnHost>[1];
    };
    const wsOpenPacket = deserializeRelayTunnelPacket(
      decryptRelayTunnelFrameOnHost(hostSession, wsOpenEnvelope.frame).toString("utf8")
    );

    expect(wsOpenPacket).toEqual({
      type: "ws.open",
      streamId: "ws-2",
      path: "/ws",
      headers: {}
    });

    const opened: string[] = [];
    const messages: string[] = [];
    socket.addEventListener("open", () => opened.push("open"));
    socket.addEventListener("message", (event) => {
      messages.push((event as MessageEvent<string>).data);
    });

    channel.emit(
      JSON.stringify({
        type: "encrypted_frame",
        frame: encryptRelayTunnelFrameOnHost(
          hostSession,
          serializeRelayTunnelPacket({
            type: "ws.opened",
            streamId: "ws-2"
          })
        )
      })
    );
    await vi.waitFor(() => {
      expect(opened).toEqual(["open"]);
    });
    socket.send("hello");
    await vi.waitFor(() => {
      expect(channel.sentPayloads).toHaveLength(4);
    });

    const wsMessageEnvelope = JSON.parse(channel.sentPayloads[3]) as {
      type: "encrypted_frame";
      frame: Parameters<typeof decryptRelayTunnelFrameOnHost>[1];
    };
    const wsMessagePacket = deserializeRelayTunnelPacket(
      decryptRelayTunnelFrameOnHost(hostSession, wsMessageEnvelope.frame).toString("utf8")
    ) as RelayTunnelWsMessagePacket;

    expect(opened).toEqual(["open"]);
    expect(wsMessagePacket).toEqual({
      type: "ws.message",
      streamId: "ws-2",
      binary: false,
      dataBase64Url: toBase64Url("hello")
    });

    channel.emit(
      JSON.stringify({
        type: "encrypted_frame",
        frame: encryptRelayTunnelFrameOnHost(
          hostSession,
          serializeRelayTunnelPacket({
            type: "ws.message",
            streamId: "ws-2",
            binary: false,
            dataBase64Url: toBase64Url("world")
          } satisfies RelayTunnelWsMessagePacket)
        )
      })
    );
    await vi.waitFor(() => {
      expect(messages).toEqual(["world"]);
    });

    expect(messages).toEqual(["world"]);
  });
});

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
