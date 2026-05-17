import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenCliCatalogService } from "../../src/modules/opencli/opencli-catalog-service.js";
import { OpenCliInstallDiscovery } from "../../src/modules/opencli/opencli-install-discovery.js";
import { OpenCliCatalogEntryRepository } from "../../src/storage/repositories/opencli-catalog-entry-repository.js";
import { OpenCliProviderRepository } from "../../src/storage/repositories/opencli-provider-repository.js";
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

describe("OpenCliInstallDiscovery", () => {
  it("可以从 PATH 里的 opencli 可执行文件反推出安装根目录", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-discovery-installed-"));
    tempDirs.push(tempDir);
    const fixture = createFakeOpenCliInstall(tempDir, [
      {
        site: "hackernews",
        name: "top",
        description: "读取热门内容",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js"
      }
    ]);
    const discovery = new OpenCliInstallDiscovery({
      env: {
        PATH: fixture.binDir
      }
    });
    const resolvedPackageRoot = realpathSync(fixture.packageRoot);

    expect(discovery.discover()).toEqual({
      installState: "installed",
      binaryPath: fixture.binaryPath,
      installPath: resolvedPackageRoot,
      version: "1.7.7",
      manifestSource: {
        kind: "manifest",
        rootPath: resolvedPackageRoot,
        manifestPath: path.join(resolvedPackageRoot, "cli-manifest.json")
      }
    });
  });

  it("未安装时会退化到本地候选目录里的 manifest", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-discovery-local-"));
    tempDirs.push(tempDir);
    const localRoot = path.join(tempDir, "opencli-local");

    mkdirSync(localRoot, { recursive: true });
    writeFileSync(path.join(localRoot, "cli-manifest.json"), "[]", "utf8");

    const discovery = new OpenCliInstallDiscovery({
      env: {
        PATH: ""
      },
      catalogRootCandidates: [localRoot]
    });

    expect(discovery.discover()).toEqual({
      installState: "not_installed",
      binaryPath: null,
      installPath: null,
      version: null,
      manifestSource: {
        kind: "local_manifest",
        rootPath: localRoot,
        manifestPath: path.join(localRoot, "cli-manifest.json")
      }
    });
  });

  it("没有全局 PATH 时会优先识别项目自带的 OpenCLI 安装", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-discovery-packaged-"));
    tempDirs.push(tempDir);
    const fixture = createFakeOpenCliInstall(tempDir, [
      {
        site: "hackernews",
        name: "top",
        description: "读取热门内容",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js"
      }
    ]);
    const discovery = new OpenCliInstallDiscovery({
      env: {
        PATH: ""
      },
      packagedInstallRootCandidates: [fixture.packageRoot]
    });
    const result = discovery.discover();
    const expectedInstallPath = path.resolve(fixture.packageRoot);

    expect(result.installState).toBe("installed");
    expect(result.version).toBe("1.7.7");
    expect(result.installPath).toBe(expectedInstallPath);
    expect(result.binaryPath).toBe(path.join(expectedInstallPath, "bin", "opencli"));
    expect(result.manifestSource).toEqual({
      kind: "manifest",
      rootPath: expectedInstallPath,
      manifestPath: path.join(expectedInstallPath, "cli-manifest.json")
    });
  });
});

describe("OpenCliCatalogService", () => {
  it("manifest 读取成功时会归一化目录、保留启用状态并按站点分组", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-catalog-manifest-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const fixture = createFakeOpenCliInstall(tempDir, [
      {
        site: "twitter",
        name: "trending",
        description: "读取趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js"
      },
      {
        site: "hackernews",
        name: "top",
        description: "读取热门内容",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js"
      }
    ]);

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.6",
      installPath: fixture.packageRoot,
      lastCheckedAt: "2026-04-26T04:50:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T04:40:00.000Z",
      catalogSource: "manifest"
    });
    catalogRepository.replaceAll("opencli", [
      {
        providerId: "opencli",
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "旧缓存",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js",
        enabled: false,
        sortOrder: 0
      }
    ]);

    const service = new OpenCliCatalogService(
      providerRepository,
      catalogRepository,
      {
        discover: () => ({
          installState: "installed",
          binaryPath: fixture.binaryPath,
          installPath: fixture.packageRoot,
          version: "1.7.7",
          manifestSource: {
            kind: "manifest",
            rootPath: fixture.packageRoot,
            manifestPath: path.join(fixture.packageRoot, "cli-manifest.json")
          }
        })
      },
      {
        now: () => "2026-04-26T05:00:00.000Z"
      }
    );

    const result = await service.refreshCatalog();

    database.close();

    expect(result.refreshState).toBe("fresh");
    expect(result.effectiveCatalogSource).toBe("manifest");
    expect(result.provider).toMatchObject({
      providerId: "opencli",
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: fixture.packageRoot,
      lastCheckedAt: "2026-04-26T05:00:00.000Z",
      catalogRefreshedAt: "2026-04-26T05:00:00.000Z",
      catalogSource: "manifest"
    });
    expect(result.summary).toEqual({
      catalogCount: 2,
      enabledCount: 1,
      browserDependentCount: 1,
      installState: "installed",
      healthState: "binary_ready"
    });
    expect(result.entries).toEqual([
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "读取热门内容",
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
        description: "读取趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js",
        enabled: false,
        sortOrder: 1
      }
    ]);
    expect(result.siteGroups).toEqual([
      {
        site: "hackernews",
        totalCount: 1,
        enabledCount: 1,
        browserDependentCount: 0,
        commands: [result.entries[0]]
      },
      {
        site: "twitter",
        totalCount: 1,
        enabledCount: 0,
        browserDependentCount: 1,
        commands: [result.entries[1]]
      }
    ]);
  });

  it("manifest 读取失败时会退化到 opencli list -f json", async () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const service = new OpenCliCatalogService(
      providerRepository,
      catalogRepository,
      {
        discover: () => ({
          installState: "installed",
          binaryPath: "/opt/homebrew/bin/opencli",
          installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
          version: "1.7.7",
          manifestSource: {
            kind: "manifest",
            rootPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
            manifestPath: "/tmp/opencli-missing-manifest.json"
          }
        })
      },
      {
        now: () => "2026-04-26T05:10:00.000Z",
        commandRunner: async () =>
          JSON.stringify([
            {
              command: "twitter/trending",
              site: "twitter",
              name: "trending",
              description: "读取趋势",
              strategy: "cookie",
              browser: true
            }
          ])
      }
    );

    const result = await service.refreshCatalog();

    database.close();

    expect(result.refreshState).toBe("fresh");
    expect(result.effectiveCatalogSource).toBe("cli_list");
    expect(result.entries).toEqual([
      {
        providerId: "opencli",
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "读取趋势",
        strategy: "cookie",
        browser: true,
        modulePath: null,
        sourceFile: null,
        enabled: true,
        sortOrder: 0
      }
    ]);
    expect(result.provider.catalogSource).toBe("cli_list");
  });

  it("刷新失败时会保留最近一次成功缓存，而不是伪造空列表", async () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T04:30:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T04:20:00.000Z",
      catalogSource: "manifest"
    });
    catalogRepository.replaceAll("opencli", [
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "读取热门内容",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js",
        enabled: true,
        sortOrder: 0
      }
    ]);

    const service = new OpenCliCatalogService(
      providerRepository,
      catalogRepository,
      {
        discover: () => ({
          installState: "installed",
          binaryPath: "/opt/homebrew/bin/opencli",
          installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
          version: "1.7.7",
          manifestSource: {
            kind: "manifest",
            rootPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
            manifestPath: "/tmp/opencli-broken-manifest.json"
          }
        })
      },
      {
        now: () => "2026-04-26T05:20:00.000Z",
        commandRunner: async () => {
          throw new Error("list failed");
        }
      }
    );

    const result = await service.refreshCatalog();

    expect(result.refreshState).toBe("cache_retained");
    expect(result.effectiveCatalogSource).toBe("cache");
    expect(result.entries).toEqual([
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "读取热门内容",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js",
        enabled: true,
        sortOrder: 0
      }
    ]);
    expect(result.errorCode).toBe("OPENCLI_CATALOG_REFRESH_FAILED");
    expect(result.errorDetail).toContain("OPENCLI_MANIFEST_READ_FAILED");
    expect(result.errorDetail).toContain("OPENCLI_LIST_FAILED");
    expect(providerRepository.get()).toMatchObject({
      providerId: "opencli",
      lastCheckedAt: "2026-04-26T05:20:00.000Z",
      lastErrorCode: "OPENCLI_CATALOG_REFRESH_FAILED",
      catalogRefreshedAt: "2026-04-26T04:20:00.000Z",
      catalogSource: "manifest"
    });

    database.close();
  });
});

function createFakeOpenCliInstall(
  rootDir: string,
  manifestEntries: readonly Array<{
    site: string;
    name: string;
    description: string;
    strategy: string;
    browser: boolean;
    modulePath: string;
    sourceFile: string;
  }>
): {
  packageRoot: string;
  binDir: string;
  binaryPath: string;
} {
  const packageRoot = path.join(rootDir, "lib", "node_modules", "@jackwener", "opencli");
  const binDir = path.join(rootDir, "bin");
  const packageBinDir = path.join(packageRoot, "bin");
  const distMainPath = path.join(packageRoot, "dist", "src", "main.js");
  const binaryPath = path.join(binDir, "opencli");
  const packagedBinaryPath = path.join(packageBinDir, "opencli");

  mkdirSync(path.dirname(distMainPath), { recursive: true });
  mkdirSync(path.join(packageRoot, "clis"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(packageBinDir, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@jackwener/opencli",
      version: "1.7.7",
      bin: {
        opencli: "dist/src/main.js"
      }
    }),
    "utf8"
  );
  writeFileSync(path.join(packageRoot, "cli-manifest.json"), JSON.stringify(manifestEntries), "utf8");
  writeFileSync(distMainPath, "#!/usr/bin/env node\n", "utf8");
  chmodSync(distMainPath, 0o755);
  symlinkSync(distMainPath, binaryPath);
  symlinkSync(distMainPath, packagedBinaryPath);

  return {
    packageRoot,
    binDir,
    binaryPath
  };
}
