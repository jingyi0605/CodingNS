import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

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

describe("公共隧道系统接口", () => {
  it("未授权请求会被拒绝", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath
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
      url: "/api/system/relay-tunnel/status"
    });
    const enableResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/enable"
    });

    expect(statusResponse.statusCode).toBe(401);
    expect(enableResponse.statusCode).toBe(401);
  });

  it("支持保存配置并通过 bind/enable/disable/unbind 维护公共隧道骨架状态", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath,
      port: 4312
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const statusResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/system/relay-tunnel/status",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: null,
      controlBaseUrl: null,
      accountId: null,
      tunnelDomain: null,
      bindingId: null,
      hostPublicKey: null,
      hostKeyFingerprint: null,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      phase: "disabled",
      connected: false,
      hostFingerprint: null,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: null,
      updatedAt: null
    });

    const configResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/system/relay-tunnel/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        relayBaseUrl: "wss://relay.codingns.example/",
        controlBaseUrl: "https://control.codingns.example/",
        localTargetBaseUrl: "http://127.0.0.1:4312/"
      }
    });

    expect(configResponse.statusCode).toBe(200);
    expect(configResponse.json()).toEqual({
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      accountId: null,
      tunnelDomain: null,
      bindingId: null,
      hostPublicKey: null,
      hostKeyFingerprint: null,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      phase: "disabled",
      connected: false,
      hostFingerprint: null,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: null,
      updatedAt: expect.any(String)
    });

    const enableBeforeBindResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(enableBeforeBindResponse.statusCode).toBe(409);
    expect(enableBeforeBindResponse.json()).toMatchObject({
      error_code: "RELAY_TUNNEL_NOT_BOUND",
      detail: "当前实例还没有绑定公共隧道"
    });

    const ensureIdentityResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/identity/ensure",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const identityStatus = ensureIdentityResponse.json<{
      hostPublicKey: string;
      hostKeyFingerprint: string;
    }>();

    expect(ensureIdentityResponse.statusCode).toBe(200);
    expect(identityStatus.hostPublicKey).toContain("BEGIN PUBLIC KEY");
    expect(identityStatus.hostKeyFingerprint).toMatch(/^SHA256:/);

    const bindResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/bind",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        accountId: "acct_demo",
        bindingId: "binding_demo",
        tunnelDomain: "demo.codingns.example"
      }
    });

    expect(bindResponse.statusCode).toBe(200);
    expect(bindResponse.json()).toEqual({
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      phase: "disabled",
      connected: false,
      hostFingerprint: identityStatus.hostKeyFingerprint,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const enableResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(enableResponse.statusCode).toBe(200);
    expect(enableResponse.json()).toEqual({
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      phase: "connecting",
      connected: false,
      hostFingerprint: identityStatus.hostKeyFingerprint,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const disableResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/disable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json()).toEqual({
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      phase: "disabled",
      connected: false,
      hostFingerprint: identityStatus.hostKeyFingerprint,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const unbindResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/unbind",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(unbindResponse.statusCode).toBe(200);
    expect(unbindResponse.json()).toEqual({
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      accountId: "acct_demo",
      tunnelDomain: null,
      bindingId: null,
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      phase: "disabled",
      connected: false,
      hostFingerprint: identityStatus.hostKeyFingerprint,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: expect.any(String),
      updatedAt: expect.any(String)
    });
  });

  it("重启后会保留公共隧道配置和最近状态快照", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const firstHosted = createTestApp(fixture, {
      databasePath,
      port: 4313
    });
    activeServers.push(firstHosted);
    await firstHosted.app.ready();

    const accessToken = await bootstrapAndLogin(firstHosted);
    const ensureIdentityResponse = await firstHosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/identity/ensure",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const identityStatus = ensureIdentityResponse.json<{
      hostPublicKey: string;
      hostKeyFingerprint: string;
    }>();

    await firstHosted.app.inject({
      method: "PUT",
      url: "/api/system/relay-tunnel/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        relayBaseUrl: "wss://relay.codingns.example",
        controlBaseUrl: "https://control.codingns.example"
      }
    });
    await firstHosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/bind",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        accountId: "acct_demo",
        bindingId: "binding_demo",
        tunnelDomain: "demo.codingns.example"
      }
    });
    await firstHosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/enable",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    await firstHosted.app.close();
    activeServers.pop();

    const secondHosted = createTestApp(fixture, {
      databasePath,
      port: 4313
    });
    activeServers.push(secondHosted);
    await secondHosted.app.ready();

    const secondAccessToken = await login(secondHosted);
    const response = await secondHosted.app.inject({
      method: "GET",
      url: "/api/system/relay-tunnel/status",
      headers: {
        authorization: `Bearer ${secondAccessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4313",
      phase: "connecting",
      connected: false,
      hostFingerprint: identityStatus.hostKeyFingerprint,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
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
