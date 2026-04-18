import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { I18nProvider, t } from "../shared/i18n";
import { AuthDeviceManagementPanel } from "./AuthDeviceManagementPanel";

const originalFetch = global.fetch;

describe("AuthDeviceManagementPanel", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate(createAuthSession());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    authStore.clear();
  });

  it("支持查看设备列表、设为主设备和逐个退出其他设备", async () => {
    let currentPrimary = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/auth/devices") && method === "GET") {
        return createJsonResponse(createSnapshot(currentPrimary));
      }

      if (url.endsWith("/api/auth/devices/current/primary") && method === "POST") {
        expect(JSON.parse(String(init?.body))).toEqual({
          password: "admin1234",
          primary: true
        });
        currentPrimary = true;
        return createJsonResponse(createSnapshot(currentPrimary).currentDevice);
      }

      if (url.endsWith("/api/auth/devices/device-web/logout") && method === "POST") {
        return createJsonResponse({
          success: true,
          revokedSessionCount: 1
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel();

    expect(screen.queryByText(t("settings.authDeviceRecentTitle"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.authDeviceOpenManager") }));

    expect((await screen.findAllByText("Desktop · macOS")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Chrome · macOS").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("浏览器：Chrome 135").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("系统：macOS 10.15.7").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("检测到 1 条兼容旧登录态记录，默认已隐藏。")).toBeInTheDocument();
    expect(screen.queryByText(t("settings.authDeviceLegacyLabel"))).not.toBeInTheDocument();
    expect(screen.getByText(t("settings.authDeviceRecentTitle"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.authDeviceLegacyReveal") }));

    expect(screen.getAllByText(t("settings.authDeviceLegacyLabel")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("settings.authDeviceLegacyDevicesTitle"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.authDeviceEnablePrimary") }));

    const passwordInput = await screen.findByLabelText(t("settings.authDevicePasswordLabel"));
    await userEvent.type(passwordInput, "admin1234");
    await userEvent.click(screen.getAllByRole("button", { name: t("settings.authDeviceEnablePrimary") })[1]!);

    await waitFor(() => {
      expect(screen.getByText(t("settings.authDevicePrimaryEnabled"))).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: t("settings.authDeviceLogoutOthers") })).not.toBeInTheDocument();

    const logoutDeviceButton = screen.getByRole("button", { name: t("settings.authDeviceLogoutDevice") });
    expect(logoutDeviceButton).not.toBeDisabled();

    await userEvent.click(logoutDeviceButton);

    await waitFor(() => {
      expect(screen.getByText("已退出设备“Chrome · macOS”，共处理 1 个会话。")).toBeInTheDocument();
    });
  });
});

function renderPanel() {
  return render(
    <I18nProvider language={clientConfigStore.getState().language}>
      <AuthDeviceManagementPanel />
    </I18nProvider>
  );
}

function createAuthSession() {
  return {
    accessToken: "token-1",
    refreshToken: "refresh-1",
    expiresIn: 3600,
    user: {
      userId: "user-1",
      username: "tester",
      role: "admin" as const
    }
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function createSnapshot(currentPrimary: boolean) {
  return {
    currentDevice: {
      deviceId: "device-current",
      clientType: "desktop",
      clientInstanceId: "desktop-1",
      displayName: "Desktop · macOS",
      browserName: "Chrome",
      browserVersion: "135",
      osName: "macOS",
      osVersion: "10.15.7",
      lastSourceAddress: "127.0.0.1",
      lastSeenAt: "2026-04-18T09:00:00.000Z",
      isPrimary: currentPrimary,
      isCurrent: true,
      isLegacy: false
    },
    otherActiveDevices: [
      {
        deviceId: "device-web",
        clientType: "web",
        clientInstanceId: "web-2",
        displayName: "Chrome · macOS",
        browserName: "Chrome",
        browserVersion: "135",
        osName: "macOS",
        osVersion: "10.15.7",
        lastSourceAddress: "10.0.0.8",
        lastSeenAt: "2026-04-18T08:58:00.000Z",
        isPrimary: false,
        isCurrent: false,
        isLegacy: false
      },
      {
        deviceId: null,
        clientType: "unknown",
        clientInstanceId: null,
        displayName: null,
        browserName: null,
        browserVersion: null,
        osName: null,
        osVersion: null,
        lastSourceAddress: null,
        lastSeenAt: "2026-04-18T08:55:00.000Z",
        isPrimary: false,
        isCurrent: false,
        isLegacy: true
      }
    ],
    recentLoginRecords: [
      {
        id: "record-1",
        deviceId: "device-current",
        clientType: "desktop",
        displayName: "Desktop · macOS",
        browserName: "Chrome",
        browserVersion: "135",
        osName: "macOS",
        osVersion: "10.15.7",
        sourceAddress: "127.0.0.1",
        occurredAt: "2026-04-18T09:00:00.000Z",
        isCurrentDevice: true,
        isLegacy: false
      },
      {
        id: "record-2",
        deviceId: "device-web",
        clientType: "web",
        displayName: "Chrome · macOS",
        browserName: "Chrome",
        browserVersion: "135",
        osName: "macOS",
        osVersion: "10.15.7",
        sourceAddress: "10.0.0.8",
        occurredAt: "2026-04-18T08:58:00.000Z",
        isCurrentDevice: false,
        isLegacy: false
      }
    ]
  };
}
