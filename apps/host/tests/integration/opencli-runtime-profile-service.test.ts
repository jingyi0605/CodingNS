import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OpenCliRuntimeProfileService,
  computeOpenCliRuntimeProfileHash
} from "../../src/modules/opencli/opencli-runtime-profile-service.js";
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

describe("OpenCLI 运行时配置档服务", () => {
  it("会按稳定顺序生成内容哈希并复用现有配置档", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-profile-service-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const runtimeRepository = new OpenCliRuntimeProfileRepository(database.db);
    const service = new OpenCliRuntimeProfileService(
      providerRepository,
      catalogRepository,
      runtimeRepository,
      {
        runtimeStorageRootPath: tempDir,
        now: () => "2026-04-26T05:10:00.000Z"
      }
    );

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T05:00:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T05:00:00.000Z",
      catalogSource: "manifest"
    });
    catalogRepository.replaceAll("opencli", [
      {
        providerId: "opencli",
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js",
        enabled: true,
        sortOrder: 10
      },
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "热门",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js",
        enabled: true,
        sortOrder: 1
      },
      {
        providerId: "opencli",
        commandId: "reddit/hot",
        site: "reddit",
        name: "hot",
        description: "热帖",
        strategy: "public",
        browser: false,
        modulePath: "reddit/hot.js",
        sourceFile: "reddit/hot.js",
        enabled: false,
        sortOrder: 2
      }
    ]);

    const first = service.findOrCreateDesiredProfile();
    const second = service.findOrCreateDesiredProfile();

    expect(first.enabledCommandIds).toEqual(["hackernews/top", "twitter/trending"]);
    expect(first.contentHash).toBe(
      computeOpenCliRuntimeProfileHash({
        version: "1.7.7",
        sourceInstallPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
        enabledCommandIds: ["hackernews/top", "twitter/trending"]
      })
    );
    expect(first.profile).toEqual(second.profile);
    expect(runtimeRepository.list()).toHaveLength(1);

    database.close();
  });

  it("会把旧安装版本生成的配置档标成 stale", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-profile-stale-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const runtimeRepository = new OpenCliRuntimeProfileRepository(database.db);
    const service = new OpenCliRuntimeProfileService(
      providerRepository,
      catalogRepository,
      runtimeRepository,
      {
        runtimeStorageRootPath: tempDir,
        now: () => "2026-04-26T05:20:00.000Z"
      }
    );

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T05:00:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T05:00:00.000Z",
      catalogSource: "manifest"
    });
    catalogRepository.replaceAll("opencli", [
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "热门",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js",
        enabled: true,
        sortOrder: 1
      }
    ]);
    runtimeRepository.upsert({
      id: "opencli-runtime-old",
      version: "1.7.6",
      sourceInstallPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      enabledCommandIdsJson: JSON.stringify(["hackernews/top"]),
      runtimeRootPath: path.join(tempDir, "opencli-runtimes", "opencli-runtime-old"),
      status: "ready",
      contentHash: "hash-old",
      createdAt: "2026-04-25T05:00:00.000Z",
      updatedAt: "2026-04-25T05:00:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
    });

    const result = service.findOrCreateDesiredProfile();

    expect(runtimeRepository.findById("opencli-runtime-old")?.status).toBe("stale");
    expect(result.profile.status).toBe("pending");
    expect(result.profile.version).toBe("1.7.7");

    database.close();
  });
});
