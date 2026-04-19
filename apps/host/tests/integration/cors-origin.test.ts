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

describe("cors origins", () => {
  it("放行 Tauri 桌面壳与本地浏览器来源", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const desktopResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status",
      headers: {
        origin: "tauri://localhost"
      }
    });

    expect(desktopResponse.statusCode).toBe(200);
    expect(desktopResponse.headers["access-control-allow-origin"]).toBe("tauri://localhost");
    expect(desktopResponse.headers["access-control-allow-credentials"]).toBe("true");

    const httpsDesktopResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status",
      headers: {
        origin: "https://tauri.localhost"
      }
    });

    expect(httpsDesktopResponse.statusCode).toBe(200);
    expect(httpsDesktopResponse.headers["access-control-allow-origin"]).toBe(
      "https://tauri.localhost"
    );

    const browserResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status",
      headers: {
        origin: "http://127.0.0.1:4174"
      }
    });

    expect(browserResponse.statusCode).toBe(200);
    expect(browserResponse.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4174");
  });

  it("允许 Tauri 登录请求通过预检", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const response = await hosted.app.inject({
      method: "OPTIONS",
      url: "/api/auth/login",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          [
            "Authorization",
            "Content-Type",
            "x-codingns-client-type",
            "x-codingns-client-instance-id",
            "x-codingns-assistant-source"
          ].join(", ")
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("tauri://localhost");
    expect(response.headers["access-control-allow-methods"]).toBe(
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    expect(response.headers["access-control-allow-headers"]).toBe(
      [
        "Authorization",
        "Content-Type",
        "x-codingns-client-type",
        "x-codingns-client-instance-id",
        "x-codingns-assistant-source",
        "x-codingns-hook-token"
      ].join(", ")
    );
  });

  it("拒绝未知远端来源", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status",
      headers: {
        origin: "https://evil.example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
