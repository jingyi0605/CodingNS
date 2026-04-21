import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

beforeEach(() => {
  vi.spyOn(os, "networkInterfaces").mockReturnValue({
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8"
      }
    ],
    en0: [
      {
        address: "192.168.50.8",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:11:22:33:44:55",
        internal: false,
        cidr: "192.168.50.8/24"
      }
    ]
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

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
      activated: false,
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: null,
      controlBaseUrl: null,
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: null,
      tunnelDomain: null,
      bindingId: null,
      hostPublicKey: null,
      hostKeyFingerprint: null,
      localTargetBaseUrl: "http://127.0.0.1:4174",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4174",
          kind: "loopback",
          url: "http://127.0.0.1:4174",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4174",
          kind: "lan",
          url: "http://192.168.50.8:4174",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        }
      ],
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
        relayBaseUrl: "https://relay.codingns.example/",
        controlBaseUrl: "https://control.codingns.example/",
        localTargetBaseUrl: "http://127.0.0.1:4312/"
      }
    });

    expect(configResponse.statusCode).toBe(200);
    expect(configResponse.json()).toEqual({
      activated: false,
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: null,
      tunnelDomain: null,
      bindingId: null,
      hostPublicKey: null,
      hostKeyFingerprint: null,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4312",
          kind: "loopback",
          url: "http://127.0.0.1:4312",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4312",
          kind: "lan",
          url: "http://192.168.50.8:4312",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        }
      ],
      phase: "disabled",
      connected: false,
      hostFingerprint: null,
      trafficUsedBytes: null,
      trafficRemainingBytes: null,
      quotaResetAt: null,
      lastError: null,
      observedAt: expect.any(String),
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
      activated: false,
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4312",
          kind: "loopback",
          url: "http://127.0.0.1:4312",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4312",
          kind: "lan",
          url: "http://192.168.50.8:4312",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "relay:https://demo.codingns.example",
          kind: "relay",
          url: "https://demo.codingns.example",
          priority: 400,
          expiresAt: null,
          source: "host_reported"
        }
      ],
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
      activated: true,
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4312",
          kind: "loopback",
          url: "http://127.0.0.1:4312",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4312",
          kind: "lan",
          url: "http://192.168.50.8:4312",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "relay:https://demo.codingns.example",
          kind: "relay",
          url: "https://demo.codingns.example",
          priority: 400,
          expiresAt: null,
          source: "host_reported"
        }
      ],
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
      activated: true,
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4312",
          kind: "loopback",
          url: "http://127.0.0.1:4312",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4312",
          kind: "lan",
          url: "http://192.168.50.8:4312",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "relay:https://demo.codingns.example",
          kind: "relay",
          url: "https://demo.codingns.example",
          priority: 400,
          expiresAt: null,
          source: "host_reported"
        }
      ],
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
      activated: true,
      enabled: false,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: null,
      tunnelDomain: null,
      bindingId: null,
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4312",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4312",
          kind: "loopback",
          url: "http://127.0.0.1:4312",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4312",
          kind: "lan",
          url: "http://192.168.50.8:4312",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        }
      ],
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

  it("支持通过 Host 代理登录控制站、检查名称、绑定和读取流量信息", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    activeFixtures.push(fixture);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          accountId: "acct_demo",
          email: "demo@example.com"
        },
        accessToken: "relay_access_token",
        expiresAt: "2026-04-21T00:00:00.000Z"
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hostLabel: "MacMini",
        tunnelDomain: "macmini.channel.codingns.com",
        available: true,
        reason: "available"
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        created: true,
        binding: {
          bindingId: "binding_demo",
          tunnelDomain: "macmini.channel.codingns.com",
          hostPublicKey: "relay_public_key",
          hostFingerprint: "SHA256:relay",
          relayBaseUrl: "wss://relay.codingns.example",
          controlBaseUrl: "https://control.codingns.example",
          status: "active"
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: {
          accountId: "acct_demo",
          grantedBytes: "524288000",
          usedBytes: "2048",
          remainingBytes: "524285952",
          exhausted: false,
          updatedAt: "2026-04-20T00:00:00.000Z"
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const hosted = createTestApp(fixture, {
      databasePath,
      port: 4314
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);

    await hosted.app.inject({
      method: "PUT",
      url: "/api/system/relay-tunnel/config",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        controlBaseUrl: "https://control.codingns.example"
      }
    });

    const loginResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/control/login",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        email: "demo@example.com",
        password: "password123"
      }
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toMatchObject({
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: "demo@example.com",
      controlSessionExpiresAt: "2026-04-21T00:00:00.000Z",
      accountId: "acct_demo",
      bindingId: null
    });

    const availabilityResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/system/relay-tunnel/control/host-label-availability?hostLabel=MacMini",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(availabilityResponse.statusCode).toBe(200);
    expect(availabilityResponse.json()).toEqual({
      hostLabel: "MacMini",
      tunnelDomain: "macmini.channel.codingns.com",
      available: true,
      reason: "available"
    });

    const bindResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/control/bind",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        hostLabel: "MacMini"
      }
    });
    const bindPayload = bindResponse.json<{
      accountId: string;
      bindingId: string;
      tunnelDomain: string;
      controlAccountEmail: string;
      hostPublicKey: string;
      hostKeyFingerprint: string;
    }>();

    expect(bindResponse.statusCode).toBe(200);
    expect(bindPayload.accountId).toBe("acct_demo");
    expect(bindPayload.bindingId).toBe("binding_demo");
    expect(bindPayload.tunnelDomain).toBe("macmini.channel.codingns.com");
    expect(bindPayload.controlAccountEmail).toBe("demo@example.com");
    expect(bindPayload.hostPublicKey).toContain("BEGIN PUBLIC KEY");
    expect(bindPayload.hostKeyFingerprint).toMatch(/^SHA256:/);

    const walletResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/system/relay-tunnel/control/wallet",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(walletResponse.statusCode).toBe(200);
    expect(walletResponse.json()).toEqual({
      wallet: {
        accountId: "acct_demo",
        grantedBytes: "524288000",
        usedBytes: "2048",
        remainingBytes: "524285952",
        exhausted: false,
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/api/public/auth/login", "https://control.codingns.example/"),
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("/api/v1/hosts/availability?hostLabel=MacMini", "https://control.codingns.example/"),
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer relay_access_token"
        }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("/api/v1/hosts/bind", "https://control.codingns.example/"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer relay_access_token"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      new URL("/api/v1/traffic-wallet/me", "https://control.codingns.example/"),
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer relay_access_token"
        }
      })
    );
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
      activated: true,
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: "wss://relay.codingns.example",
      controlBaseUrl: "https://control.codingns.example",
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identityStatus.hostPublicKey,
      hostKeyFingerprint: identityStatus.hostKeyFingerprint,
      localTargetBaseUrl: "http://127.0.0.1:4174",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://127.0.0.1:4174",
          kind: "loopback",
          url: "http://127.0.0.1:4174",
          priority: 100,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "host_reported:http://192.168.50.8:4174",
          kind: "lan",
          url: "http://192.168.50.8:4174",
          priority: 200,
          expiresAt: null,
          source: "host_reported"
        },
        {
          endpointId: "relay:https://demo.codingns.example",
          kind: "relay",
          url: "https://demo.codingns.example",
          priority: 400,
          expiresAt: null,
          source: "host_reported"
        }
      ],
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
