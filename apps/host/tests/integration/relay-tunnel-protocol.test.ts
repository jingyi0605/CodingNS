import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acceptRelayTunnelClientHandshake,
  createRelayTunnelClientHandshake,
  decryptRelayTunnelFrame,
  encryptRelayTunnelFrame,
  finalizeRelayTunnelClientHandshake,
  RelayTunnelProtocolError
} from "../../src/modules/relay-tunnel/crypto/relay-tunnel-protocol.js";
import { RelayTunnelIdentityService } from "../../src/modules/relay-tunnel/crypto/relay-tunnel-identity-service.js";
import { InstanceRelayTunnelIdentityRepository } from "../../src/storage/repositories/instance-relay-tunnel-identity-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("RelayTunnelProtocol", () => {
  it("客户端和 Host 可以完成握手，并双向收发加密帧", () => {
    const hostIdentity = createHostIdentity();
    const { pendingHandshake, clientHello } = createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });
    const clientSession = finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello
    });

    const clientFrame = encryptRelayTunnelFrame(clientSession, "hello host");
    const hostFrame = encryptRelayTunnelFrame(hostSession, "hello client");

    expect(decryptRelayTunnelFrame(hostSession, clientFrame).toString("utf8")).toBe("hello host");
    expect(decryptRelayTunnelFrame(clientSession, hostFrame).toString("utf8")).toBe("hello client");
    expect(clientSession.sendSequence).toBe(1);
    expect(clientSession.receiveSequence).toBe(1);
    expect(hostSession.sendSequence).toBe(1);
    expect(hostSession.receiveSequence).toBe(1);
  });

  it("客户端持有的 Host 公钥和指纹不一致时，会在握手开始前直接拒绝", () => {
    const hostIdentity = createHostIdentity();

    expect(() =>
      createRelayTunnelClientHandshake({
        expectedHostPublicKey: hostIdentity.publicKeyPem,
        expectedHostFingerprint: "SHA256:wrong-fingerprint"
      })
    ).toThrowError();
    expectProtocolError(
      () =>
        createRelayTunnelClientHandshake({
          expectedHostPublicKey: hostIdentity.publicKeyPem,
          expectedHostFingerprint: "SHA256:wrong-fingerprint"
        }),
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH"
    );
  });

  it("服务端握手证明被篡改时，客户端会拒绝继续建立会话", () => {
    const hostIdentity = createHostIdentity();
    const { pendingHandshake, clientHello } = createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });

    expectProtocolError(
      () =>
        finalizeRelayTunnelClientHandshake({
          pendingHandshake,
          serverHello: {
            ...serverHello,
            proof: mutateBase64Url(serverHello.proof)
          }
        }),
      "RELAY_TUNNEL_HANDSHAKE_PROOF_INVALID"
    );
  });

  it("加密帧被篡改后会因为完整性校验失败而拒绝解密", () => {
    const hostIdentity = createHostIdentity();
    const { pendingHandshake, clientHello } = createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });
    const clientSession = finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello
    });
    const encrypted = encryptRelayTunnelFrame(clientSession, Buffer.from("tamper-me", "utf8"));

    expectProtocolError(
      () =>
        decryptRelayTunnelFrame(hostSession, {
          ...encrypted,
          ciphertext: mutateBase64Url(encrypted.ciphertext)
        }),
      "RELAY_TUNNEL_FRAME_AUTH_INVALID"
    );
  });

  it("重复帧或乱序帧会被按序号拒绝", () => {
    const hostIdentity = createHostIdentity();
    const { pendingHandshake, clientHello } = createRelayTunnelClientHandshake({
      expectedHostPublicKey: hostIdentity.publicKeyPem,
      expectedHostFingerprint: hostIdentity.keyFingerprint
    });
    const { serverHello, session: hostSession } = acceptRelayTunnelClientHandshake({
      hostIdentity,
      clientHello
    });
    const clientSession = finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello
    });
    const encrypted = encryptRelayTunnelFrame(clientSession, "first");

    expect(decryptRelayTunnelFrame(hostSession, encrypted).toString("utf8")).toBe("first");
    expectProtocolError(
      () => decryptRelayTunnelFrame(hostSession, encrypted),
      "RELAY_TUNNEL_FRAME_SEQUENCE_MISMATCH"
    );
  });
});

function createHostIdentity() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-protocol-"));
  tempDirs.push(tempDir);
  const databasePath = path.join(tempDir, "host.sqlite");
  const database = createDatabaseClient(databasePath);
  const repository = new InstanceRelayTunnelIdentityRepository(database.db);
  const identity = new RelayTunnelIdentityService(repository).ensureIdentity();

  database.close();
  return identity;
}

function expectProtocolError(
  execute: () => unknown,
  code: InstanceType<typeof RelayTunnelProtocolError>["code"]
): void {
  try {
    execute();
  } catch (error) {
    expect(error).toBeInstanceOf(RelayTunnelProtocolError);
    expect((error as RelayTunnelProtocolError).code).toBe(code);
    return;
  }

  throw new Error(`expected protocol error ${code}`);
}

function mutateBase64Url(value: string): string {
  const lastChar = value.slice(-1);
  const nextChar = lastChar === "A" ? "B" : "A";
  return `${value.slice(0, -1)}${nextChar}`;
}
