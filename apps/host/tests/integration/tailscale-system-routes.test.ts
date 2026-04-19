import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";
import { createFakeTailscaleCli } from "../helpers/fake-tailscale.js";
import { BootstrapStateRepository } from "../../src/storage/repositories/bootstrap-state-repository.js";
import { InstanceTailscaleRepository } from "../../src/storage/repositories/instance-tailscale-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
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
});

describe("Tailscale 系统接口", () => {
  it("未授权请求会被拒绝", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const fakeTailscale = createFakeTailscaleCli(path.join(fixture.rootDir, "tailscale-cli"));
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath,
      tailscaleCliPath: fakeTailscale.cliPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    const statusResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/system/tailscale/status"
    });
    const enableResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/tailscale/enable"
    });

    expect(statusResponse.statusCode).toBe(401);
    expect(enableResponse.statusCode).toBe(401);
  });

  it("支持保存配置并通过 enable/login/logout/disable 维护骨架状态", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const fakeTailscale = createFakeTailscaleCli(path.join(fixture.rootDir, "tailscale-cli"));
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath,
      tailscaleCliPath: fakeTailscale.cliPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const statusResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/system/tailscale/status",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({
      activated: false,
      enabled: false,
      controlServerUrl: null,
      hostname: null,
      phase: "disabled",
      connected: false,
      loginUrl: null,
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: null,
      updatedAt: null
    });

    const configResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/system/tailscale/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        controlServerUrl: "https://headscale.example.com/",
        hostname: "codingns-host"
      }
    });

    expect(configResponse.statusCode).toBe(200);
    expect(configResponse.json()).toEqual({
      activated: false,
      enabled: false,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      phase: "disabled",
      connected: false,
      loginUrl: null,
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: null,
      updatedAt: expect.any(String)
    });

    const enableResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/tailscale/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(enableResponse.statusCode).toBe(200);
    expect(enableResponse.json()).toEqual({
      activated: true,
      enabled: true,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      phase: "needs_login",
      connected: false,
      loginUrl: "https://login.tailscale.test/device/abc123",
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const loginResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/tailscale/login",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toEqual({
      activated: true,
      enabled: true,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      phase: "needs_login",
      connected: false,
      loginUrl: "https://login.tailscale.test/device/abc123",
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const logoutResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/tailscale/logout",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({
      activated: true,
      enabled: true,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      phase: "needs_login",
      connected: false,
      loginUrl: "https://login.tailscale.test/device/abc123",
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      reachableBaseUrl: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const disableResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/tailscale/disable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json()).toEqual({
      activated: true,
      enabled: false,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      phase: "disabled",
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

  it("重启后会保留实例级配置和最近状态快照", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const fakeTailscale = createFakeTailscaleCli(path.join(fixture.rootDir, "tailscale-cli"));
    activeFixtures.push(fixture);

    const firstHosted = createTestApp(fixture, {
      databasePath,
      tailscaleCliPath: fakeTailscale.cliPath
    });
    activeServers.push(firstHosted);
    await firstHosted.app.ready();

    const accessToken = await bootstrapAndLogin(firstHosted);
    await firstHosted.app.inject({
      method: "PUT",
      url: "/api/system/tailscale/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        controlServerUrl: "https://headscale.example.com",
        hostname: "codingns-host"
      }
    });
    await firstHosted.app.inject({
      method: "POST",
      url: "/api/system/tailscale/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    await firstHosted.app.close();
    activeServers.pop();

    const secondHosted = createTestApp(fixture, {
      databasePath,
      tailscaleCliPath: fakeTailscale.cliPath
    });
    activeServers.push(secondHosted);
    await secondHosted.app.ready();

    const secondAccessToken = await login(secondHosted);
    const response = await secondHosted.app.inject({
      method: "GET",
      url: "/api/system/tailscale/status",
      headers: {
        authorization: `Bearer ${secondAccessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      activated: true,
      enabled: true,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host",
      phase: "needs_login",
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

  it("启动时慢速 tailscale 恢复不会阻塞 app.ready", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const database = createDatabaseClient(databasePath);
    const bootstrapStateRepository = new BootstrapStateRepository(database.db);
    const repository = new InstanceTailscaleRepository(database.db);

    bootstrapStateRepository.markInitialized("2026-04-15T03:00:00.000Z", "user-1");
    repository.upsertConfig({
      activated: true,
      enabled: true,
      controlServerUrl: null,
      hostname: null,
      stateDir: path.join(fixture.rootDir, "tailscale-state"),
      updatedAt: "2026-04-15T03:00:00.000Z"
    });
    repository.upsertStatus({
      phase: "running",
      connected: true,
      loginUrl: null,
      controlServerUrl: null,
      hostname: null,
      accountName: "user@example.com",
      tailnetFqdn: "codingns-host.tailnet.ts.net",
      tailnetIpv4: "100.64.0.10",
      tailnetIpv6: "fd7a:115c:a1e0::10",
      reachableBaseUrl: "http://codingns-host.tailnet.ts.net:4174",
      lastError: null,
      observedAt: "2026-04-15T03:01:00.000Z"
    });
    database.close();

    const hosted = createTestApp(fixture, {
      databasePath,
      tailscaleCliPath: createSlowStatusTailscaleCli(
        path.join(fixture.rootDir, "slow-tailscale.js"),
        3_000
      )
    });
    activeServers.push(hosted);

    const readyStartedAt = Date.now();
    await hosted.app.ready();
    const readyDurationMs = Date.now() - readyStartedAt;

    expect(readyDurationMs).toBeLessThan(1_000);
  });
});

async function bootstrapAndLogin(
  hosted: ReturnType<typeof createTestApp>
): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return login(hosted);
}

async function login(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json<{ accessToken: string }>().accessToken;
}

function createSlowStatusTailscaleCli(cliPath: string, delayMs: number): string {
  writeFileSync(
    cliPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args[0] === "status" && args.includes("--json")) {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      BackendState: "Running",
      CurrentTailnet: { Name: "tailnet-from-state" },
      Self: {
        HostName: "codingns-host",
        DNSName: "codingns-host.tailnet.ts.net.",
        UserProfile: {
          LoginName: "user@example.com",
          DisplayName: "user@example.com"
        },
        TailscaleIPs: ["100.64.0.10", "fd7a:115c:a1e0::10"]
      }
    }));
    process.exit(0);
  }, ${delayMs});
  return;
}

if (args[0] === "set") {
  process.exit(0);
}

process.stderr.write("UNSUPPORTED_FAKE_TAILSCALE_COMMAND\\n");
process.exit(1);
`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(cliPath, 0o755);
  }

  return cliPath;
}
