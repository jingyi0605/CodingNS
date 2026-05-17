import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV } from "../../src/modules/opencli/opencli-runtime-guard.js";
import { OpenCliRuntimeBuilder } from "../../src/modules/opencli/opencli-runtime-builder.js";
import { OpenCliRuntimeProfileService } from "../../src/modules/opencli/opencli-runtime-profile-service.js";
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

describe("OpenCLI 裁剪运行时构建器", () => {
  it("会生成过滤后的 manifest、clis 目录和可执行 shim", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-builder-"));
    tempDirs.push(tempDir);
    const sourceRoot = createFakeOpenCliPackage(tempDir);
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
        now: () => "2026-04-26T05:30:00.000Z"
      }
    );
    const builder = new OpenCliRuntimeBuilder(runtimeRepository, {
      now: () => "2026-04-26T05:31:00.000Z"
    });

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
      },
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
        enabled: false,
        sortOrder: 1
      }
    ]);

    const desired = profileService.findOrCreateDesiredProfile();
    const builtProfile = builder.buildProfile(desired.profile);
    const runtimeManifest = JSON.parse(
      readFileSync(path.join(builtProfile.runtimeRootPath, "cli-manifest.json"), "utf8")
    ) as Array<{ site: string; name: string }>;

    expect(builtProfile.status).toBe("ready");
    expect(runtimeManifest.map((entry) => `${entry.site}/${entry.name}`)).toEqual(["hackernews/top"]);
    expect(lstatSync(path.join(builtProfile.runtimeRootPath, "dist")).isSymbolicLink()).toBe(true);
    expect(lstatSync(path.join(builtProfile.runtimeRootPath, "clis", "_shared")).isDirectory()).toBe(true);
    expect(lstatSync(path.join(builtProfile.runtimeRootPath, "clis", "hackernews")).isDirectory()).toBe(true);
    expect(() => lstatSync(path.join(builtProfile.runtimeRootPath, "clis", "twitter"))).toThrow();

    const listResult = await runNodeScript(path.join(builtProfile.runtimeRootPath, "bin", "opencli"), [
      "list",
      "-f",
      "json"
    ]);
    const enabledResult = await runNodeScript(path.join(builtProfile.runtimeRootPath, "bin", "opencli"), [
      "hackernews",
      "top"
    ]);
    const disabledResult = await runNodeScript(path.join(builtProfile.runtimeRootPath, "bin", "opencli"), [
      "twitter",
      "trending"
    ]);
    const envResult = await runNodeScript(
      path.join(builtProfile.runtimeRootPath, "bin", "opencli"),
      ["env", "show"],
      {
        HOME: "/isolated/home",
        USERPROFILE: "/isolated/profile",
        CODINGNS_OPENCLI_REAL_HOME: "/real/home",
        CODINGNS_OPENCLI_REAL_USERPROFILE: "/real/profile"
      }
    );
    expect(JSON.parse(listResult.stdout)).toEqual([{ site: "hackernews", name: "top", browser: false }]);
    expect(enabledResult.exitCode).toBe(0);
    expect(enabledResult.stdout).toContain("OK:hackernews/top");
    expect(disabledResult.exitCode).toBe(2);
    expect(disabledResult.stderr).toContain("COMMAND_NOT_FOUND:twitter/trending");
    expect(JSON.parse(envResult.stdout)).toEqual({
      home: "/real/home",
      userProfile: "/real/profile"
    });

    database.close();
  });

  it("工作区会话开启硬门禁后，会阻断 browser-dependent 的 OpenCLI 命令", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-builder-blocked-"));
    tempDirs.push(tempDir);
    const sourceRoot = createFakeOpenCliPackage(tempDir);
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
        now: () => "2026-04-26T05:30:00.000Z"
      }
    );
    const builder = new OpenCliRuntimeBuilder(runtimeRepository, {
      now: () => "2026-04-26T05:31:00.000Z"
    });

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
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js",
        enabled: true,
        sortOrder: 1
      }
    ]);

    const desired = profileService.findOrCreateDesiredProfile();
    const builtProfile = builder.buildProfile(desired.profile);
    const blockedResult = await runNodeScript(
      path.join(builtProfile.runtimeRootPath, "bin", "opencli"),
      ["twitter", "trending"],
      {
        [CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV]: "1"
      }
    );

    expect(blockedResult.exitCode).toBe(126);
    expect(blockedResult.stderr).toContain("BROWSER_DEPENDENT_OPENCLI_COMMAND_BLOCKED:twitter/trending");
    expect(blockedResult.stderr).toContain("executionBackend=opencli_bridge");

    database.close();
  });
});

function createFakeOpenCliPackage(rootDir: string): string {
  const packageRoot = path.join(rootDir, "opencli-source");
  const distDir = path.join(packageRoot, "dist", "src");
  const clisRoot = path.join(packageRoot, "clis");
  const nodeModulesDir = path.join(packageRoot, "node_modules");

  mkdirSync(distDir, { recursive: true });
  mkdirSync(path.join(clisRoot, "_shared"), { recursive: true });
  mkdirSync(path.join(clisRoot, "hackernews"), { recursive: true });
  mkdirSync(path.join(clisRoot, "twitter"), { recursive: true });
  mkdirSync(nodeModulesDir, { recursive: true });

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
    `${JSON.stringify([
      { site: "hackernews", name: "top", browser: false },
      { site: "twitter", name: "trending", browser: true }
    ], null, 2)}\n`,
    "utf8"
  );
  writeFileSync(path.join(clisRoot, "_shared", "shared.js"), "export const shared = true;\n", "utf8");
  writeFileSync(path.join(clisRoot, "hackernews", "top.js"), "export default {};\n", "utf8");
  writeFileSync(path.join(clisRoot, "twitter", "trending.js"), "export default {};\n", "utf8");
  writeFileSync(
    path.join(distDir, "main.js"),
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
let currentDir = path.dirname(__filename);

while (!fs.existsSync(path.join(currentDir, "package.json"))) {
  const parentDir = path.dirname(currentDir);

  if (parentDir === currentDir) {
    throw new Error("PACKAGE_ROOT_NOT_FOUND");
  }

  currentDir = parentDir;
}

const manifest = JSON.parse(fs.readFileSync(path.join(currentDir, "cli-manifest.json"), "utf8"));
const args = process.argv.slice(2);

if (args[0] === "list" && args[1] === "-f" && args[2] === "json") {
  process.stdout.write(JSON.stringify(manifest));
  process.exit(0);
}

if (args[0] === "env" && args[1] === "show") {
  process.stdout.write(JSON.stringify({
    home: process.env.HOME ?? null,
    userProfile: process.env.USERPROFILE ?? null
  }));
  process.exit(0);
}

const commandId = args.length >= 2 ? \`\${args[0]}/\${args[1]}\` : "";
const found = manifest.find((entry) => \`\${entry.site}/\${entry.name}\` === commandId);

if (!found) {
  process.stderr.write(\`COMMAND_NOT_FOUND:\${commandId}\\n\`);
  process.exit(2);
}

process.stdout.write(\`OK:\${commandId}\\n\`);
`,
    "utf8"
  );
  chmodSync(path.join(distDir, "main.js"), 0o755);

  return packageRoot;
}

function runNodeScript(
  scriptPath: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...envOverrides
      }
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr
      });
    });
  });
}
