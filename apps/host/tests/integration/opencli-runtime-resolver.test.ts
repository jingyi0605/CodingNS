import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenCliCatalogService } from "../../src/modules/opencli/opencli-catalog-service.js";
import { OpenCliInstallDiscovery } from "../../src/modules/opencli/opencli-install-discovery.js";
import { OpenCliRuntimeBuilder } from "../../src/modules/opencli/opencli-runtime-builder.js";
import { OpenCliRuntimeProfileService } from "../../src/modules/opencli/opencli-runtime-profile-service.js";
import { OpenCliRuntimeResolver } from "../../src/modules/opencli/opencli-runtime-resolver.js";
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

describe("OpenCLI 运行时解析器", () => {
  it("provider 启用时会解析 ready 运行时并回写 activeRuntimeId", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-runtime-resolver-"));
    tempDirs.push(tempDir);
    const sourceRoot = createFakeOpenCliSource(tempDir);
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const runtimeRepository = new OpenCliRuntimeProfileRepository(database.db);
    const profileService = new OpenCliRuntimeProfileService(
      providerRepository,
      catalogRepository,
      runtimeRepository,
      {
        runtimeStorageRootPath: tempDir,
        now: () => "2026-04-26T05:40:00.000Z"
      }
    );
    const builder = new OpenCliRuntimeBuilder(runtimeRepository, {
      now: () => "2026-04-26T05:41:00.000Z"
    });
    const resolver = new OpenCliRuntimeResolver(
      providerRepository,
      runtimeRepository,
      profileService,
      builder,
      {
        env: {
          PATH: "/usr/local/bin:/usr/bin"
        },
        homeDir: "/Users/real-home",
        userProfile: "/Users/real-home"
      }
    );

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: sourceRoot,
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
        sortOrder: 0
      }
    ]);

    const resolution = resolver.resolveSessionRuntime();
    const provider = providerRepository.get();

    expect(resolution.availability).toBe("ready");
    expect(resolution.runtimeBinPath?.split(path.sep).pop()).toBe("bin");
    expect(resolution.realHome).toBe("/Users/real-home");
    expect(provider.activeRuntimeId).toBeTruthy();

    database.close();
  });

  it("provider 关闭时不会注入 runtime", () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const runtimeRepository = new OpenCliRuntimeProfileRepository(database.db);
    const profileService = new OpenCliRuntimeProfileService(
      providerRepository,
      catalogRepository,
      runtimeRepository,
      {
        runtimeStorageRootPath: "/tmp/opencli-runtimes",
        now: () => "2026-04-26T05:40:00.000Z"
      }
    );
    const builder = new OpenCliRuntimeBuilder(runtimeRepository);
    const resolver = new OpenCliRuntimeResolver(
      providerRepository,
      runtimeRepository,
      profileService,
      builder
    );

    const resolution = resolver.resolveSessionRuntime();

    expect(resolution.availability).toBe("disabled");
    expect(resolution.runtimeBinPath).toBeNull();

    database.close();
  });

  it("没有全局 opencli 时，项目自带安装仍能被发现并构建 runtime", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-runtime-discovery-"));
    tempDirs.push(tempDir);
    const sourceRoot = createFakeOpenCliSource(tempDir);
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const runtimeRepository = new OpenCliRuntimeProfileRepository(database.db);
    const catalogService = new OpenCliCatalogService(
      providerRepository,
      catalogRepository,
      new OpenCliInstallDiscovery({
        env: {
          PATH: ""
        },
        packagedInstallRootCandidates: [sourceRoot]
      }),
      {
        now: () => "2026-04-26T05:35:00.000Z"
      }
    );
    const profileService = new OpenCliRuntimeProfileService(
      providerRepository,
      catalogRepository,
      runtimeRepository,
      {
        runtimeStorageRootPath: tempDir,
        now: () => "2026-04-26T05:40:00.000Z"
      }
    );
    const builder = new OpenCliRuntimeBuilder(runtimeRepository, {
      now: () => "2026-04-26T05:41:00.000Z"
    });
    const resolver = new OpenCliRuntimeResolver(
      providerRepository,
      runtimeRepository,
      profileService,
      builder,
      {
        env: {
          PATH: "/usr/local/bin:/usr/bin"
        },
        homeDir: "/Users/real-home",
        userProfile: "/Users/real-home"
      }
    );

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
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

    const refreshResult = await catalogService.refreshCatalog();
    const resolution = resolver.resolveSessionRuntime();
    const provider = providerRepository.get();

    expect(refreshResult.refreshState).toBe("fresh");
    expect(refreshResult.provider.installState).toBe("installed");
    expect(refreshResult.provider.installPath).toBe(path.resolve(sourceRoot));
    expect(refreshResult.entries.map((entry) => entry.commandId)).toEqual(["hackernews/top"]);
    expect(resolution.availability).toBe("ready");
    expect(resolution.runtimeRootPath).toBeTruthy();
    expect(resolution.runtimeBinPath?.split(path.sep).pop()).toBe("bin");
    expect(provider.activeRuntimeId).toBeTruthy();

    database.close();
  });
});

function createFakeOpenCliSource(rootDir: string): string {
  const packageRoot = path.join(rootDir, "opencli-source");
  const packageBinDir = path.join(packageRoot, "bin");
  const distMainPath = path.join(packageRoot, "dist", "src", "main.js");
  const packagedBinaryPath = path.join(packageBinDir, "opencli");

  mkdirSync(path.dirname(distMainPath), { recursive: true });
  mkdirSync(packageBinDir, { recursive: true });
  mkdirSync(path.join(packageRoot, "clis", "_shared"), { recursive: true });
  mkdirSync(path.join(packageRoot, "clis", "hackernews"), { recursive: true });
  mkdirSync(path.join(packageRoot, "node_modules"), { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@jackwener/opencli",
      version: "1.7.7",
      type: "module",
      bin: {
        opencli: "dist/src/main.js"
      }
    }, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(packageRoot, "cli-manifest.json"),
    `${JSON.stringify([{ site: "hackernews", name: "top" }], null, 2)}\n`,
    "utf8"
  );
  writeFileSync(distMainPath, "console.log('stub');\n", "utf8");
  chmodSync(distMainPath, 0o755);
  symlinkSync(distMainPath, packagedBinaryPath);

  return packageRoot;
}
