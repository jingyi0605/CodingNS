import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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

describe("client routes", () => {
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

    const hosted = createTestApp(fixture, {
      host: "127.0.0.1",
      port: 3002,
      releaseChannel: "stable",
      releaseManifestRoot: releaseRoot
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

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
      autoCheckUpdate: true
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
