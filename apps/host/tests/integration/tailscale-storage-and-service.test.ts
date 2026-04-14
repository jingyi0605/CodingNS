import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BootstrapStateRepository } from "../../src/storage/repositories/bootstrap-state-repository.js";
import { InstanceTailscaleRepository } from "../../src/storage/repositories/instance-tailscale-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { TailscaleManager } from "../../src/modules/tailscale/tailscale-manager.js";
import { TailscaleService } from "../../src/modules/tailscale/tailscale-service.js";
import type { TailscaleHelperClient } from "../../src/modules/tailscale/tailscale-helper-client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("Tailscale 存储与服务骨架", () => {
  it("会创建实例级 Tailscale 配置表和状态表", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-schema-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const client = createDatabaseClient(databasePath);

    const configColumns = client.db
      .prepare("PRAGMA table_info(instance_tailscale_config)")
      .all() as Array<{ name: string }>;
    const statusColumns = client.db
      .prepare("PRAGMA table_info(instance_tailscale_status)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(configColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "enabled",
        "control_server_url",
        "hostname",
        "state_dir",
        "updated_at"
      ])
    );
    expect(statusColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "phase",
        "connected",
        "login_url",
        "account_name",
        "tailnet_fqdn",
        "tailnet_ipv4",
        "tailnet_ipv6",
        "reachable_base_url",
        "last_error",
        "observed_at"
      ])
    );
  });

  it("仓储可以持久化实例级配置和最近状态快照", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-repository-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const firstClient = createDatabaseClient(databasePath);
    const firstRepository = new InstanceTailscaleRepository(firstClient.db);

    firstRepository.upsertConfig({
      enabled: true,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      stateDir: path.join(tempDir, "tailscale-state"),
      updatedAt: "2026-04-14T08:00:00.000Z"
    });
    firstRepository.upsertStatus({
      phase: "needs_login",
      connected: false,
      loginUrl: null,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      accountName: "user@example.com",
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: "2026-04-14T08:01:00.000Z"
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondRepository = new InstanceTailscaleRepository(secondClient.db);

    expect(secondRepository.findConfig()).toEqual({
      enabled: true,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      stateDir: path.join(tempDir, "tailscale-state"),
      updatedAt: "2026-04-14T08:00:00.000Z"
    });
    expect(secondRepository.findStatus()).toEqual({
      phase: "needs_login",
      connected: false,
      loginUrl: null,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      accountName: "user@example.com",
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: "2026-04-14T08:01:00.000Z"
    });

    secondClient.close();
  });

  it("未初始化实例启用时会进入 blocked_uninitialized，而不是假装已暴露", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-service-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const client = createDatabaseClient(databasePath);
    const bootstrapStateRepository = new BootstrapStateRepository(client.db);
    const repository = new InstanceTailscaleRepository(client.db);
    const manager = new TailscaleManager(
      bootstrapStateRepository,
      repository,
      {
        inspectStatus: async () => ({
          backendState: "needs_login",
          loginUrl: null,
          hostname: null,
          accountName: null,
          tailnetFqdn: null,
          tailnetIpv4: null,
          tailnetIpv6: null,
          lastError: null
        }),
        enable: async () => ({
          backendState: "needs_login",
          loginUrl: "https://login.tailscale.test/device/abc123",
          hostname: null,
          accountName: null,
          tailnetFqdn: null,
          tailnetIpv4: null,
          tailnetIpv6: null,
          lastError: null
        }),
        login: async () => ({
          backendState: "needs_login",
          loginUrl: "https://login.tailscale.test/device/abc123",
          hostname: null,
          accountName: null,
          tailnetFqdn: null,
          tailnetIpv4: null,
          tailnetIpv6: null,
          lastError: null
        }),
        disable: async () => ({
          backendState: "stopped",
          loginUrl: null,
          hostname: null,
          accountName: null,
          tailnetFqdn: null,
          tailnetIpv4: null,
          tailnetIpv6: null,
          lastError: null
        }),
        logout: async () => ({
          backendState: "needs_login",
          loginUrl: null,
          hostname: null,
          accountName: null,
          tailnetFqdn: null,
          tailnetIpv4: null,
          tailnetIpv6: null,
          lastError: null
        })
      } as unknown as TailscaleHelperClient,
      {
        commandPath: "tailscale",
        webUiPort: 4174
      }
    );
    const service = new TailscaleService(
      client.db,
      repository,
      manager,
      {
        databasePath
      }
    );

    const status = await service.enable();

    client.close();

    expect(status).toEqual({
      enabled: true,
      controlServerUrl: null,
      hostname: null,
      phase: "blocked_uninitialized",
      connected: false,
      loginUrl: null,
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });
  });
});
