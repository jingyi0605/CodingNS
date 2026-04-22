import { describe, expect, it } from "vitest";

import {
  acceptRelayTunnelClientHandshake,
  decryptRelayTunnelFrame as decryptRelayTunnelFrameOnHost,
  encryptRelayTunnelFrame as encryptRelayTunnelFrameOnHost
} from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-protocol";
import { generateRelayTunnelIdentity } from "../../../host/src/modules/relay-tunnel/crypto/relay-tunnel-identity-service";
import {
  createRelayTunnelClientHandshake,
  decryptRelayTunnelFrame,
  encryptRelayTunnelFrame,
  finalizeRelayTunnelClientHandshake,
  RelayTunnelProtocolError,
  type RelayTunnelServerHello
} from "./relay-tunnel-protocol";

describe("relay-tunnel-protocol", () => {
  it("user-app 客户端可以和 Host 完成握手，并双向收发加密帧", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const { pendingHandshake, clientHello } = await createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });
    const clientSession = await finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello
    });

    const clientFrame = await encryptRelayTunnelFrame(clientSession, "hello host");
    const hostFrame = encryptRelayTunnelFrameOnHost(hostSession, "hello client");

    expect(decryptRelayTunnelFrameOnHost(hostSession, clientFrame).toString("utf8")).toBe("hello host");
    expect(decodeUtf8(await decryptRelayTunnelFrame(clientSession, hostFrame))).toBe("hello client");
    expect(clientSession.sendSequence).toBe(1);
    expect(clientSession.receiveSequence).toBe(1);
  });

  it("服务端握手证明被篡改时，user-app 客户端会拒绝建立会话", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const { pendingHandshake, clientHello } = await createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });

    await expect(
      finalizeRelayTunnelClientHandshake({
        pendingHandshake,
        serverHello: {
          ...serverHello,
          proof: mutateBase64Url(serverHello.proof)
        } satisfies RelayTunnelServerHello
      })
    ).rejects.toMatchObject({
      name: "RelayTunnelProtocolError",
      code: "RELAY_TUNNEL_HANDSHAKE_PROOF_INVALID"
    } satisfies Partial<RelayTunnelProtocolError>);
  });

  it("Host 发来的加密帧被篡改时，user-app 客户端会拒绝解密", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const { pendingHandshake, clientHello } = await createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });
    const clientSession = await finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello
    });
    const hostFrame = encryptRelayTunnelFrameOnHost(hostSession, "tamper me");

    await expect(
      decryptRelayTunnelFrame(clientSession, {
        ...hostFrame,
        ciphertext: mutateBase64Url(hostFrame.ciphertext)
      })
    ).rejects.toMatchObject({
      name: "RelayTunnelProtocolError",
      code: "RELAY_TUNNEL_FRAME_AUTH_INVALID"
    } satisfies Partial<RelayTunnelProtocolError>);
  });

  it("完全相同的 Host 重放帧会被忽略，但乱序帧仍然会被拒绝", async () => {
    const hostIdentity = generateRelayTunnelIdentity("2026-04-19T00:00:00.000Z");
    const { pendingHandshake, clientHello } = await createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });
    const clientSession = await finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello
    });
    const firstFrame = encryptRelayTunnelFrameOnHost(hostSession, "first");

    expect(decodeUtf8((await decryptRelayTunnelFrame(clientSession, firstFrame))!)).toBe("first");
    await expect(decryptRelayTunnelFrame(clientSession, firstFrame)).resolves.toBeNull();

    const secondFrame = encryptRelayTunnelFrameOnHost(hostSession, "second");

    await expect(
      decryptRelayTunnelFrame(clientSession, {
        ...secondFrame,
        sequence: 1
      })
    ).rejects.toMatchObject({
      name: "RelayTunnelProtocolError",
      code: "RELAY_TUNNEL_FRAME_SEQUENCE_MISMATCH"
    } satisfies Partial<RelayTunnelProtocolError>);
  });
});

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function mutateBase64Url(value: string): string {
  const lastChar = value.slice(-1);
  const nextChar = lastChar === "A" ? "B" : "A";
  return `${value.slice(0, -1)}${nextChar}`;
}
