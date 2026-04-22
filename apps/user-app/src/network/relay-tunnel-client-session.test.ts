import { describe, expect, it } from "vitest";

import {
  acceptRelayTunnelClientHandshake
} from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-protocol";
import { generateRelayTunnelIdentity } from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-identity-service";
import { decodeRelayTunnelEncryptedFramePayload } from "./relay-tunnel-wire";
import {
  RelayTunnelClientSession,
  type RelayTunnelRawChannel,
  type RelayTunnelRawPayload
} from "./relay-tunnel-client-session";

interface ClientHelloEnvelope {
  type: "client_hello";
  hello: Parameters<typeof acceptRelayTunnelClientHandshake>[0]["clientHello"];
}

interface ServerHelloEnvelope {
  type: "server_hello";
  hello: ReturnType<typeof acceptRelayTunnelClientHandshake>["serverHello"];
}

class FakeRelayTunnelRawChannel implements RelayTunnelRawChannel {
  readonly sentPayloads: RelayTunnelRawPayload[] = [];
  private listener: ((payload: RelayTunnelRawPayload) => void) | null = null;

  send(payload: RelayTunnelRawPayload): void {
    this.sentPayloads.push(payload);
  }

  subscribe(listener: (payload: RelayTunnelRawPayload) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  close(): void {}

  emit(payload: RelayTunnelRawPayload): void {
    this.listener?.(payload);
  }
}

describe("relay-tunnel-client-session", () => {
  it("会串行发送加密帧，避免并发请求拿到重复序号", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-22T00:00:00.000Z");
    const channel = new FakeRelayTunnelRawChannel();
    const session = new RelayTunnelClientSession(channel, {
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });

    const connectPromise = session.connect();
    await waitFor(() => channel.sentPayloads.length >= 1);
    const clientHelloEnvelope = JSON.parse(channel.sentPayloads[0] ?? "null") as ClientHelloEnvelope;
    const accepted = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello: clientHelloEnvelope.hello
    });

    channel.emit(JSON.stringify({
      type: "server_hello",
      hello: accepted.serverHello
    } satisfies ServerHelloEnvelope));
    await connectPromise;

    session.send({
      type: "http.request",
      streamId: "http-1",
      method: "GET",
      path: "/api/a",
      headers: {},
      bodyBase64Url: null
    });
    session.send({
      type: "http.request",
      streamId: "http-2",
      method: "GET",
      path: "/api/b",
      headers: {},
      bodyBase64Url: null
    });

    await waitFor(() => channel.sentPayloads.length >= 3);

    const encryptedFrames = channel.sentPayloads
      .slice(1)
      .map((payload) => decodeRelayTunnelEncryptedFramePayload(payload as Uint8Array));

    expect(encryptedFrames.map((item) => item.sequence)).toEqual([1, 2]);
  });
});

async function waitFor(assertion: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();

  while (!assertion()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("等待异步发送结果超时");
    }

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
