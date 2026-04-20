import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InstanceRelayTunnelIdentityRepository } from "../../src/storage/repositories/instance-relay-tunnel-identity-repository.js";
import { InstanceRelayTunnelRepository } from "../../src/storage/repositories/instance-relay-tunnel-repository.js";
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

describe("公共隧道实例存储", () => {
  it("会创建实例级公共隧道配置表和状态表", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-tunnel-schema-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const client = createDatabaseClient(databasePath);

    const configColumns = client.db
      .prepare("PRAGMA table_info(instance_relay_tunnel_config)")
      .all() as Array<{ name: string }>;
    const identityColumns = client.db
      .prepare("PRAGMA table_info(instance_relay_tunnel_identity)")
      .all() as Array<{ name: string }>;
    const statusColumns = client.db
      .prepare("PRAGMA table_info(instance_relay_tunnel_status)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(configColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "activated",
        "enabled",
        "provider",
        "relay_base_url",
        "control_base_url",
        "account_id",
        "tunnel_domain",
        "binding_id",
        "host_public_key",
        "host_key_fingerprint",
        "local_target_base_url",
        "updated_at"
      ])
    );
    expect(identityColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "key_algorithm",
        "private_key_pem",
        "public_key_pem",
        "key_fingerprint",
        "created_at",
        "updated_at"
      ])
    );
    expect(statusColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "phase",
        "connected",
        "binding_id",
        "tunnel_domain",
        "host_fingerprint",
        "traffic_used_bytes",
        "traffic_remaining_bytes",
        "quota_reset_at",
        "last_error",
        "observed_at"
      ])
    );
  });

  it("仓储可以持久化公共隧道配置和最近状态快照", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-tunnel-repository-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const firstClient = createDatabaseClient(databasePath);
    const firstRepository = new InstanceRelayTunnelRepository(firstClient.db);

    firstRepository.upsertConfig({
      activated: true,
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccessTokenCiphertext: null,
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: "PUBLIC_KEY_DEMO",
      hostKeyFingerprint: "SHA256:demo",
      localTargetBaseUrl: "http://127.0.0.1:4173",
      updatedAt: "2026-04-19T11:00:00.000Z"
    });
    firstRepository.upsertStatus({
      phase: "connecting",
      connected: false,
      bindingId: "binding_demo",
      tunnelDomain: "demo.codingns.example",
      hostFingerprint: "SHA256:demo",
      trafficUsedBytes: "1024",
      trafficRemainingBytes: "2048",
      quotaResetAt: "2026-04-20T00:00:00.000Z",
      lastError: null,
      observedAt: "2026-04-19T11:01:00.000Z"
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondRepository = new InstanceRelayTunnelRepository(secondClient.db);

    expect(secondRepository.findConfig()).toEqual({
      activated: true,
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccessTokenCiphertext: null,
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: "PUBLIC_KEY_DEMO",
      hostKeyFingerprint: "SHA256:demo",
      localTargetBaseUrl: "http://127.0.0.1:4173",
      updatedAt: "2026-04-19T11:00:00.000Z"
    });
    expect(secondRepository.findStatus()).toEqual({
      phase: "connecting",
      connected: false,
      bindingId: "binding_demo",
      tunnelDomain: "demo.codingns.example",
      hostFingerprint: "SHA256:demo",
      trafficUsedBytes: "1024",
      trafficRemainingBytes: "2048",
      quotaResetAt: "2026-04-20T00:00:00.000Z",
      lastError: null,
      observedAt: "2026-04-19T11:01:00.000Z"
    });

    secondClient.close();
  });

  it("身份仓储可以持久化 Host 长期密钥材料", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-tunnel-identity-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const firstClient = createDatabaseClient(databasePath);
    const firstRepository = new InstanceRelayTunnelIdentityRepository(firstClient.db);

    firstRepository.upsertIdentity({
      keyAlgorithm: "x25519",
      privateKeyPem: "PRIVATE_KEY_DEMO",
      publicKeyPem: "PUBLIC_KEY_DEMO",
      keyFingerprint: "SHA256:demo",
      createdAt: "2026-04-19T12:00:00.000Z",
      updatedAt: "2026-04-19T12:00:00.000Z"
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondRepository = new InstanceRelayTunnelIdentityRepository(secondClient.db);

    expect(secondRepository.findIdentity()).toEqual({
      keyAlgorithm: "x25519",
      privateKeyPem: "PRIVATE_KEY_DEMO",
      publicKeyPem: "PUBLIC_KEY_DEMO",
      keyFingerprint: "SHA256:demo",
      createdAt: "2026-04-19T12:00:00.000Z",
      updatedAt: "2026-04-19T12:00:00.000Z"
    });

    secondClient.close();
  });
});
