import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenCliCatalogEntryRepository } from "../../src/storage/repositories/opencli-catalog-entry-repository.js";
import { OpenCliProviderRepository } from "../../src/storage/repositories/opencli-provider-repository.js";
import { OpenCliRuntimeProfileRepository } from "../../src/storage/repositories/opencli-runtime-profile-repository.js";
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

describe("OpenCLI 存储骨架", () => {
  it("会创建 provider 状态表和目录缓存表", () => {
    const database = createDatabaseClient(":memory:");

    const providerColumns = database.db
      .prepare("PRAGMA table_info(opencli_providers)")
      .all() as Array<{ name: string }>;
    const catalogColumns = database.db
      .prepare("PRAGMA table_info(opencli_catalog_entries)")
      .all() as Array<{ name: string }>;
    const runtimeProfileColumns = database.db
      .prepare("PRAGMA table_info(opencli_runtime_profiles)")
      .all() as Array<{ name: string }>;

    database.close();

    expect(providerColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "provider_id",
        "enabled",
        "install_state",
        "health_state",
        "version",
        "install_path",
        "last_checked_at",
        "active_runtime_id",
        "last_error_code",
        "last_error_detail",
        "catalog_refreshed_at",
        "catalog_source"
      ])
    );
    expect(catalogColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "provider_id",
        "command_id",
        "site",
        "name",
        "description",
        "strategy",
        "browser",
        "module_path",
        "source_file",
        "enabled",
        "sort_order"
      ])
    );
    expect(runtimeProfileColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "version",
        "source_install_path",
        "enabled_command_ids_json",
        "runtime_root_path",
        "status",
        "content_hash",
        "created_at",
        "updated_at",
        "last_error_code",
        "last_error_detail"
      ])
    );
  });

  it("仓储可以持久化 provider 状态和目录缓存", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-repository-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const firstClient = createDatabaseClient(databasePath);
    const firstProviderRepository = new OpenCliProviderRepository(firstClient.db);
    const firstCatalogRepository = new OpenCliCatalogEntryRepository(firstClient.db);

    firstProviderRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T03:00:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T03:00:00.000Z",
      catalogSource: "manifest"
    });
    firstCatalogRepository.replaceAll("opencli", [
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "读取 Hacker News 热门列表",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js",
        enabled: true,
        sortOrder: 0
      },
      {
        providerId: "opencli",
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "读取当前趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js",
        enabled: false,
        sortOrder: 1
      }
    ]);
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondProviderRepository = new OpenCliProviderRepository(secondClient.db);
    const secondCatalogRepository = new OpenCliCatalogEntryRepository(secondClient.db);

    expect(secondProviderRepository.get()).toEqual({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T03:00:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T03:00:00.000Z",
      catalogSource: "manifest"
    });
    expect(secondCatalogRepository.list()).toEqual([
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "读取 Hacker News 热门列表",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js",
        enabled: true,
        sortOrder: 0
      },
      {
        providerId: "opencli",
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "读取当前趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js",
        enabled: false,
        sortOrder: 1
      }
    ]);

    secondClient.close();
  });

  it("默认会返回未安装且没有缓存的 provider 状态", () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);

    expect(providerRepository.get()).toEqual({
      providerId: "opencli",
      enabled: false,
      installState: "not_installed",
      healthState: "unknown",
      version: null,
      installPath: null,
      lastCheckedAt: null,
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: null,
      catalogSource: null
    });
    expect(catalogRepository.list()).toEqual([]);

    database.close();
  });

  it("仓储可以持久化运行时配置档", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-runtime-profile-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const firstClient = createDatabaseClient(databasePath);
    const firstRepository = new OpenCliRuntimeProfileRepository(firstClient.db);

    firstRepository.upsert({
      id: "opencli-runtime-abc123",
      version: "1.7.7",
      sourceInstallPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      enabledCommandIdsJson: JSON.stringify(["hackernews/top"]),
      runtimeRootPath: "/tmp/opencli-runtime-abc123",
      status: "pending",
      contentHash: "hash-001",
      createdAt: "2026-04-26T05:00:00.000Z",
      updatedAt: "2026-04-26T05:00:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondRepository = new OpenCliRuntimeProfileRepository(secondClient.db);

    expect(secondRepository.findById("opencli-runtime-abc123")).toEqual({
      id: "opencli-runtime-abc123",
      version: "1.7.7",
      sourceInstallPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      enabledCommandIdsJson: JSON.stringify(["hackernews/top"]),
      runtimeRootPath: "/tmp/opencli-runtime-abc123",
      status: "pending",
      contentHash: "hash-001",
      createdAt: "2026-04-26T05:00:00.000Z",
      updatedAt: "2026-04-26T05:00:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
    });

    secondClient.close();
  });
});
