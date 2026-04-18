import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const CHROME_MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const SAFARI_MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

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

describe("auth device management", () => {
  it("支持当前设备设为主设备，并由主设备按设备逐个退出其他设备", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
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

    const desktopLogin = await login(hosted, {
      username: "admin",
      password: "admin1234"
    }, {
      "x-codingns-client-type": "desktop",
      "x-codingns-client-instance-id": "desktop-device-1",
      "user-agent": CHROME_MAC_USER_AGENT
    });
    expect(desktopLogin.statusCode).toBe(200);
    const desktopSession = desktopLogin.json();

    const initialDevices = await hosted.app.inject({
      method: "GET",
      url: "/api/auth/devices",
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      }
    });
    expect(initialDevices.statusCode).toBe(200);
    expect(initialDevices.json().currentDevice).toMatchObject({
      clientType: "desktop",
      displayName: "Desktop · macOS",
      browserName: "Chrome",
      browserVersion: "135",
      osName: "macOS",
      osVersion: "10.15.7",
      isPrimary: false,
      isCurrent: true
    });
    expect(initialDevices.json().otherActiveDevices).toHaveLength(0);
    expect(initialDevices.json().recentLoginRecords).toHaveLength(1);

    const invalidPrimary = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/devices/current/primary",
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      },
      payload: {
        password: "wrong-password",
        primary: true
      }
    });
    expect(invalidPrimary.statusCode).toBe(401);
    expect(invalidPrimary.json().error_code).toBe("INVALID_CREDENTIALS");

    const makePrimary = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/devices/current/primary",
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      },
      payload: {
        password: "admin1234",
        primary: true
      }
    });
    expect(makePrimary.statusCode).toBe(200);
    expect(makePrimary.json()).toMatchObject({
      clientType: "desktop",
      displayName: "Desktop · macOS",
      browserName: "Chrome",
      browserVersion: "135",
      osName: "macOS",
      osVersion: "10.15.7",
      isPrimary: true,
      isCurrent: true
    });

    const webLogin = await login(hosted, {
      username: "admin",
      password: "admin1234"
    }, {
      "x-codingns-client-type": "web",
      "x-codingns-client-instance-id": "browser-device-2",
      "user-agent": SAFARI_MAC_USER_AGENT
    });
    expect(webLogin.statusCode).toBe(200);
    const webSession = webLogin.json();

    const refreshedWebLogin = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        "x-codingns-client-type": "web",
        "x-codingns-client-instance-id": "browser-device-2",
        "user-agent": SAFARI_MAC_USER_AGENT
      },
      payload: {
        refreshToken: webSession.refreshToken
      }
    });
    expect(refreshedWebLogin.statusCode).toBe(200);
    const webRefreshedSession = refreshedWebLogin.json();

    const legacyLogin = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });
    expect(legacyLogin.statusCode).toBe(200);
    const legacySession = legacyLogin.json();

    const devicesBeforeLogoutOthers = await hosted.app.inject({
      method: "GET",
      url: "/api/auth/devices",
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      }
    });
    expect(devicesBeforeLogoutOthers.statusCode).toBe(200);
    const snapshotBeforeLogoutOthers = devicesBeforeLogoutOthers.json();
    expect(snapshotBeforeLogoutOthers.currentDevice).toMatchObject({
      clientType: "desktop",
      displayName: "Desktop · macOS",
      browserName: "Chrome",
      browserVersion: "135",
      osName: "macOS",
      osVersion: "10.15.7",
      isPrimary: true
    });
    expect(snapshotBeforeLogoutOthers.otherActiveDevices).toHaveLength(2);
    expect(
      snapshotBeforeLogoutOthers.otherActiveDevices.filter(
        (item: {
          clientType: string;
          displayName: string | null;
          browserVersion: string | null;
          osVersion: string | null;
        }) =>
          item.clientType === "web"
          && item.displayName === "Safari · macOS"
          && item.browserVersion === "17.4"
          && item.osVersion === "10.15.7"
      )
    ).toHaveLength(1);
    expect(
      snapshotBeforeLogoutOthers.recentLoginRecords.some(
        (item: {
          displayName: string | null;
          browserName: string | null;
          browserVersion: string | null;
        }) =>
          item.displayName === "Safari · macOS"
          && item.browserName === "Safari"
          && item.browserVersion === "17.4"
      )
    ).toBe(true);
    expect(
      snapshotBeforeLogoutOthers.otherActiveDevices.some((item: { isLegacy: boolean }) => item.isLegacy)
    ).toBe(true);
    expect(snapshotBeforeLogoutOthers.recentLoginRecords).toHaveLength(3);
    const currentDeviceId = snapshotBeforeLogoutOthers.currentDevice.deviceId as string;
    const webDeviceId = snapshotBeforeLogoutOthers.otherActiveDevices.find(
      (item: { clientType: string; deviceId: string | null }) => item.clientType === "web"
    )?.deviceId;
    expect(webDeviceId).toBeTruthy();

    const webLogoutDevice = await hosted.app.inject({
      method: "POST",
      url: `/api/auth/devices/${webDeviceId}/logout`,
      headers: {
        authorization: `Bearer ${webRefreshedSession.accessToken}`
      }
    });
    expect(webLogoutDevice.statusCode).toBe(403);
    expect(webLogoutDevice.json().error_code).toBe("PRIMARY_DEVICE_REQUIRED");

    const desktopLogoutCurrent = await hosted.app.inject({
      method: "POST",
      url: `/api/auth/devices/${currentDeviceId}/logout`,
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      }
    });
    expect(desktopLogoutCurrent.statusCode).toBe(400);
    expect(desktopLogoutCurrent.json().error_code).toBe("CURRENT_DEVICE_NOT_ALLOWED");

    const desktopLogoutDevice = await hosted.app.inject({
      method: "POST",
      url: `/api/auth/devices/${webDeviceId}/logout`,
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      }
    });
    expect(desktopLogoutDevice.statusCode).toBe(200);
    expect(desktopLogoutDevice.json()).toEqual({
      success: true,
      revokedSessionCount: 1
    });

    const desktopStillAuthorized = await hosted.app.inject({
      method: "GET",
      url: "/api/auth/devices",
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      }
    });
    expect(desktopStillAuthorized.statusCode).toBe(200);
    expect(desktopStillAuthorized.json().otherActiveDevices).toHaveLength(1);
    expect(
      desktopStillAuthorized.json().otherActiveDevices.every((item: { clientType: string }) => item.clientType !== "web")
    ).toBe(true);

    const webDenied = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${webRefreshedSession.accessToken}`
      }
    });
    expect(webDenied.statusCode).toBe(401);

    const legacyStillAuthorized = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${legacySession.accessToken}`
      }
    });
    expect(legacyStillAuthorized.statusCode).toBe(200);

    const desktopLogoutOthers = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/devices/logout-others",
      headers: {
        authorization: `Bearer ${desktopSession.accessToken}`
      }
    });
    expect(desktopLogoutOthers.statusCode).toBe(200);
    expect(desktopLogoutOthers.json()).toEqual({
      success: true,
      revokedDeviceCount: 1
    });

    const legacyDenied = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${legacySession.accessToken}`
      }
    });
    expect(legacyDenied.statusCode).toBe(401);
  });

  it("最近登录记录只保留 10 条", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
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

    let latestSession: { accessToken: string } | null = null;

    for (let index = 0; index < 12; index += 1) {
      const loginResponse = await login(hosted, {
        username: "admin",
        password: "admin1234"
      }, {
        "x-codingns-client-type": index % 2 === 0 ? "desktop" : "web",
        "x-codingns-client-instance-id": `device-${index}`,
        "user-agent": index % 2 === 0 ? CHROME_MAC_USER_AGENT : SAFARI_MAC_USER_AGENT
      });

      expect(loginResponse.statusCode).toBe(200);
      latestSession = loginResponse.json();
    }

    const devicesResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/auth/devices",
      headers: {
        authorization: `Bearer ${latestSession!.accessToken}`
      }
    });
    expect(devicesResponse.statusCode).toBe(200);
    expect(devicesResponse.json().recentLoginRecords).toHaveLength(10);
  });
});

async function login(
  hosted: ReturnType<typeof createTestApp>,
  payload: {
    username: string;
    password: string;
  },
  headers?: Record<string, string>
) {
  return hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers,
    payload
  });
}
