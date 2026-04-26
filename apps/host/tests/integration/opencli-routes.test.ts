import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const activeDirs: string[] = [];
const originalPath = process.env.PATH ?? "";

beforeEach(() => {
  process.env.PATH = originalPath;
});

afterEach(async () => {
  process.env.PATH = originalPath;

  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }

  while (activeDirs.length > 0) {
    const target = activeDirs.pop();

    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("opencli routes", () => {
  it("可以返回概况、刷新目录并保存启用配置", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const openCliRoot = createFakeOpenCliPackage();
    activeDirs.push(path.dirname(openCliRoot));
    process.env.PATH = `${path.join(openCliRoot, "bin")}${path.delimiter}${originalPath}`;

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const checkResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/opencli/check",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(checkResponse.statusCode).toBe(200);
    expect(checkResponse.json()).toMatchObject({
      provider: {
        installState: "installed",
        healthState: "bridge_missing",
        version: "1.7.7"
      },
      summary: {
        catalogCount: 2,
        enabledCount: 2,
        browserDependentCount: 1
      },
      runtimeAvailability: "disabled"
    });

    const configResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/opencli/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        enabled: true,
        enabledCommandIds: ["hackernews/top"]
      }
    });

    expect(configResponse.statusCode).toBe(200);
    expect(configResponse.json()).toMatchObject({
      provider: {
        enabled: true,
        activeRuntimeId: expect.any(String)
      },
      summary: {
        enabledCount: 1
      },
      runtimeAvailability: "ready",
      activeRuntimeProfile: {
        status: "ready",
        enabledCommandIds: ["hackernews/top"]
      }
    });

    const overviewResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/opencli/overview",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json()).toMatchObject({
      provider: {
        enabled: true
      },
      activeRuntimeProfile: {
        status: "ready"
      }
    });

    const catalogResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/opencli/catalog",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const catalogBody = catalogResponse.json();

    expect(catalogResponse.statusCode).toBe(200);
    expect(catalogBody.siteGroups).toHaveLength(2);
    expect(catalogBody.siteGroups[0]).toMatchObject({
      site: "hackernews",
      enabledCount: 1
    });
    expect(catalogBody.siteGroups[1]).toMatchObject({
      site: "twitter",
      enabledCount: 0
    });

    const runtimeManifest = readFileSync(
      path.join(catalogBody.activeRuntimeProfile.runtimeRootPath, "cli-manifest.json"),
      "utf8"
    );

    expect(runtimeManifest).toContain("hackernews");
    expect(runtimeManifest).not.toContain("twitter");
  });

  it("会拒绝未知 commandId", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const openCliRoot = createFakeOpenCliPackage();
    activeDirs.push(path.dirname(openCliRoot));
    process.env.PATH = `${path.join(openCliRoot, "bin")}${path.delimiter}${originalPath}`;

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    await hosted.app.inject({
      method: "POST",
      url: "/api/opencli/check",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/opencli/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        enabled: true,
        enabledCommandIds: ["unknown/missing"]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "OPENCLI_UNKNOWN_COMMAND_IDS"
    });
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const setupResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  expect(setupResponse.statusCode).toBe(201);

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  expect(loginResponse.statusCode).toBe(200);

  return loginResponse.json().accessToken as string;
}

function createFakeOpenCliPackage(): string {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-routes-"));
  const packageRoot = path.join(rootDir, "opencli-source");
  const distDir = path.join(packageRoot, "dist", "src");
  const clisRoot = path.join(packageRoot, "clis");
  const nodeModulesDir = path.join(packageRoot, "node_modules");
  const binDir = path.join(packageRoot, "bin");

  mkdirSync(distDir, { recursive: true });
  mkdirSync(path.join(clisRoot, "_shared"), { recursive: true });
  mkdirSync(path.join(clisRoot, "hackernews"), { recursive: true });
  mkdirSync(path.join(clisRoot, "twitter"), { recursive: true });
  mkdirSync(nodeModulesDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

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
      {
        site: "hackernews",
        name: "top",
        description: "热门",
        strategy: "public",
        browser: false,
        modulePath: "hackernews/top.js",
        sourceFile: "hackernews/top.js"
      },
      {
        site: "twitter",
        name: "trending",
        description: "趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "twitter/trending.js",
        sourceFile: "twitter/trending.js"
      }
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

if (args[0] === "--version" || args[0] === "-V") {
  process.stdout.write("1.7.7\\n");
  process.exit(0);
}

if (args[0] === "list" && args[1] === "-f" && args[2] === "json") {
  process.stdout.write(JSON.stringify(manifest));
  process.exit(0);
}

if (args[0] === "doctor") {
  process.stdout.write("opencli v1.7.7 doctor\\n[OK] Daemon: running\\n[MISSING] Extension: not connected\\n[FAIL] Connectivity: failed (Browser Bridge extension not connected)\\n");
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
  writeFileSync(
    path.join(binDir, "opencli"),
    `#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const mainScript = path.join(path.dirname(__filename), "..", "dist", "src", "main.js");
await import(mainScript);
`,
    "utf8"
  );
  chmodSync(path.join(binDir, "opencli"), 0o755);

  return packageRoot;
}
