import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");

  return {
    ...actual,
    spawn: ((command: string, ...args: unknown[]) => {
      const commandArgs = Array.isArray(args[0]) ? args[0] : [];
      const isPm2RestartHelper =
        command === process.execPath
        && commandArgs[0] === "-e";

      if (
        command === "npm" ||
        command === "npm.cmd" ||
        command === "pm2" ||
        command === "pm2.cmd" ||
        isPm2RestartHelper
      ) {
        return spawnMock(command, ...args);
      }

      return (actual.spawn as (...input: unknown[]) => unknown)(command, ...args);
    }) as typeof actual.spawn
  };
});

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const originalFetch = globalThis.fetch;

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
  globalThis.fetch = originalFetch;

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

describe("client routes", () => {
  it("未登录时拒绝读取运行时配置", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const setupResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    expect(setupResponse.statusCode).toBe(201);

    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/runtime-config?platform=desktop"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error_code: "UNAUTHORIZED"
    });
  });

  it("返回桌面端运行时配置与发布清单", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const releaseRoot = path.join(fixture.rootDir, "releases");
    const stableDir = path.join(releaseRoot, "stable");
    mkdirSync(stableDir, { recursive: true });
    writeFileSync(
      path.join(stableDir, "windows-x64.json"),
      JSON.stringify(
        {
          channel: "stable",
          platform: "windows-x64",
          version: "1.2.3",
          notes: "桌面端联调用清单",
          packageUrl: "https://example.invalid/codingns-desktop-1.2.3.msi",
          signature: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          publishedAt: "2026-03-25T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(stableDir, "android-apk.json"),
      JSON.stringify(
        {
          channel: "stable",
          version: "1.2.3",
          versionCode: 1230,
          packageName: "com.codingns.userapp",
          fileName: "app-universal-release.apk",
          downloadUrl: "https://example.invalid/app-universal-release.apk",
          sha256: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          publishedAt: "2026-03-25T10:00:00.000Z",
          notes: "Android 直装清单"
        },
        null,
        2
      ),
      "utf8"
    );

    const hosted = createTestApp(fixture, {
      host: "127.0.0.1",
      port: 3002,
      releaseChannel: "stable",
      releaseManifestRoot: releaseRoot
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

    await hosted.app.inject({
      method: "PUT",
      url: "/api/system/relay-tunnel/config",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        relayBaseUrl: "wss://relay.codingns.example",
        controlBaseUrl: "https://control.codingns.example",
        localTargetBaseUrl: "http://127.0.0.1:4312"
      }
    });
    await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/bind",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        accountId: "acct_demo",
        bindingId: "binding_demo",
        tunnelDomain: "demo.codingns.example"
      }
    });

    const runtimeConfigResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/runtime-config?platform=desktop",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(runtimeConfigResponse.statusCode).toBe(200);
    expect(runtimeConfigResponse.json()).toEqual({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      relayTunnel: {
        provider: "codingns_relay",
        enabled: false,
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example",
        bindingId: "binding_demo",
        hostFingerprint: expect.stringMatching(/^SHA256:/),
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
        ]
      }
    });

    const releaseManifestResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/release-manifest?channel=stable&platform=windows-x64",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(releaseManifestResponse.statusCode).toBe(200);
    expect(releaseManifestResponse.json()).toMatchObject({
      channel: "stable",
      platform: "windows-x64",
      version: "1.2.3"
    });

    const androidManifestResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/release-manifest?channel=stable&platform=android-apk",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(androidManifestResponse.statusCode).toBe(200);
    expect(androidManifestResponse.json()).toMatchObject({
      channel: "stable",
      version: "1.2.3",
      versionCode: 1230,
      packageName: "com.codingns.userapp"
    });
  });

  it("返回服务端更新信息", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "0.2.0",
            beta: "0.3.0-beta.1"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const hosted = createTestApp(fixture, {
      serverUpdatePackageName: "placeholder-server-package",
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      accessTokenTtlSeconds: 30
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/service-update?channel=stable",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      channel: "stable",
      packages: [
        expect.objectContaining({
          packageName: "placeholder-server-package",
          latestVersion: "0.2.0",
          hasUpdate: false,
          checkStatus: "up_to_date"
        })
      ]
    });
  });

  it("支持触发服务端全局 npm 安装任务，并调度 PM2 自动重启", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "0.6.1",
            beta: "0.6.1-beta.1"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;
    spawnMock.mockImplementation(() => createSuccessfulChildProcess("updated"));

    const hosted = createTestApp(fixture, {
      serverUpdatePackageName: "placeholder-server-package",
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      accessTokenTtlSeconds: 30
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const installResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/client/service-update/install",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        packageName: "placeholder-server-package",
        channel: "stable"
      }
    });

    expect(installResponse.statusCode).toBe(200);
    const task = installResponse.json() as {
      taskId: string;
      packageName: string;
      status: string;
    };
    expect(task.packageName).toBe("placeholder-server-package");

    await flushAsyncWork();

    const taskResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/client/service-update/tasks/${task.taskId}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json()).toMatchObject({
      taskId: task.taskId,
      packageName: "placeholder-server-package",
      targetVersion: "0.6.1",
      status: "succeeded",
      restartRequired: false,
      restartScheduled: true,
      restartDelayMs: 3000
    });

    const listResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/service-update?channel=stable",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      packages: [
        expect.objectContaining({
          packageName: "placeholder-server-package",
          latestVersion: "0.6.1",
          hasUpdate: true,
          restartRequired: false,
          installTask: expect.objectContaining({
            taskId: task.taskId,
            status: "succeeded",
            restartRequired: false,
            restartScheduled: true,
            restartDelayMs: 3000
          })
        })
      ]
    });
    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "-g", "placeholder-server-package@latest"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "pm2.cmd" : "pm2",
      ["describe", "codingns"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        "-e",
        expect.any(String),
        "3000",
        process.platform === "win32" ? "pm2.cmd" : "pm2",
        "codingns"
      ]),
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
        detached: true
      })
    );
  });

  it("发布清单缺失时返回 MANIFEST_NOT_FOUND", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      releaseManifestRoot: path.join(fixture.rootDir, "releases")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/release-manifest?channel=stable&platform=windows-x64",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error_code).toBe("MANIFEST_NOT_FOUND");
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>) {
  const setupResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(setupResponse.statusCode).toBe(201);

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json() as { accessToken: string };
}

function createSuccessfulChildProcess(output: string): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    unref: vi.fn()
  }) as unknown as ChildProcessWithoutNullStreams;

  queueMicrotask(() => {
    emitter.emit("spawn");
    stdout.write(output);
    stdout.end();
    stderr.end();
    emitter.emit("close", 0, null);
  });

  return child;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
