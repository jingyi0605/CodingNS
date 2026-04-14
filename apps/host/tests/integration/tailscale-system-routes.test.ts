import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";
import { createFakeTailscaleCli } from "../helpers/fake-tailscale.js";

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
