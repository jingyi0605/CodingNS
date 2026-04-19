import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildRelayTunnelPublicKeyFingerprint,
  RelayTunnelIdentityService
} from "../../src/modules/relay-tunnel/crypto/relay-tunnel-identity-service.js";
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

describe("RelayTunnelIdentityService", () => {
  it("会生成并持久化 Host 长期身份密钥，重复 ensure 不会重建", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-identity-service-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const database = createDatabaseClient(databasePath);
    const repository = new InstanceRelayTunnelIdentityRepository(database.db);
    const service = new RelayTunnelIdentityService(repository);

    const first = service.ensureIdentity();
    const second = service.ensureIdentity();

    expect(first.keyAlgorithm).toBe("x25519");
    expect(first.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(first.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(first.keyFingerprint).toMatch(/^SHA256:/);
    expect(second).toEqual(first);
    expect(repository.findIdentity()).toEqual(first);

    database.close();
  });

  it("同一份公钥材料生成的指纹必须稳定一致", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-identity-fingerprint-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const database = createDatabaseClient(databasePath);
    const repository = new InstanceRelayTunnelIdentityRepository(database.db);
    const service = new RelayTunnelIdentityService(repository);

    const identity = service.ensureIdentity();

    expect(buildRelayTunnelPublicKeyFingerprint(identity.publicKeyPem)).toBe(identity.keyFingerprint);
    expect(buildRelayTunnelPublicKeyFingerprint(identity.publicKeyPem)).toBe(identity.keyFingerprint);

    database.close();
  });
});
