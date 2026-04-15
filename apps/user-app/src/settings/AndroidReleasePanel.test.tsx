import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { I18nProvider, t } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { authStore } from "../features/auth/store/auth-store";
import { AndroidReleasePanel } from "./AndroidReleasePanel";

const originalTauriInternals = window.__TAURI_INTERNALS__;
const originalFetch = global.fetch;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");

describe("AndroidReleasePanel", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "android",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate({
      accessToken: "token-1",
      refreshToken: "refresh-1",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "tester",
        role: "admin"
      }
    });
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    authStore.clear();

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
    } else {
      delete window.__TAURI_INTERNALS__;
    }

    if (userAgentDescriptor) {
      Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
    }

    if (platformDescriptor) {
      Object.defineProperty(window.navigator, "platform", platformDescriptor);
    }

    if (maxTouchPointsDescriptor) {
      Object.defineProperty(window.navigator, "maxTouchPoints", maxTouchPointsDescriptor);
    }
  });

  it("展示 Android 极简更新信息，并在安装前先走系统权限链路", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          channel: "stable",
          version: "0.4.0",
          versionCode: 4000,
          packageName: "com.codingns.userapp",
          fileName: "app-universal-release.apk",
          downloadUrl: "https://example.com/app-universal-release.apk",
          sha256: "abc",
          publishedAt: "2026-04-15T08:00:00.000Z",
          notes: "",
          minSupportedVersionCode: null,
          htmlUrl: null
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_android_runtime_info") {
        return {
          version: "0.3.0",
          versionCode: 3000,
          packageName: "com.codingns.userapp"
        };
      }

      if (command === "install_android_update") {
        expect(args).toMatchObject({
          manifest: expect.objectContaining({
            version: "0.4.0",
            versionCode: 4000
          })
        });

        return {
          ok: false,
          status: "permission_required",
          detail: "请先允许当前应用安装未知来源应用，然后再重试安装。"
        };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    window.__TAURI_INTERNALS__ = { invoke: invoke as never };

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <AndroidReleasePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseCheckNow") }));

    expect(await screen.findByText("0.3.0")).toBeInTheDocument();
    expect(screen.getByText("0.4.0")).toBeInTheDocument();
    expect(screen.getByText(t("settings.releaseUpdateReady"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseInstallNow") }));

    expect(
      await screen.findByText("请先允许当前应用安装未知来源应用，然后再重试安装。")
    ).toBeInTheDocument();
  });

  it("从系统安装器返回后，如果版本没有变化，会提示安装已取消并允许重试", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          channel: "stable",
          version: "0.4.0",
          versionCode: 4000,
          packageName: "com.codingns.userapp",
          fileName: "app-universal-release.apk",
          downloadUrl: "https://example.com/app-universal-release.apk",
          sha256: "abc",
          publishedAt: "2026-04-15T08:00:00.000Z",
          notes: "",
          minSupportedVersionCode: null,
          htmlUrl: null
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const invoke = vi.fn(async (command: string) => {
      if (command === "get_android_runtime_info") {
        return {
          version: "0.3.0",
          versionCode: 3000,
          packageName: "com.codingns.userapp"
        };
      }

      if (command === "install_android_update") {
        return {
          ok: true,
          status: "installer_started"
        };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    window.__TAURI_INTERNALS__ = { invoke: invoke as never };

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <AndroidReleasePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseCheckNow") }));
    await screen.findByText(t("settings.releaseUpdateReady"));

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseInstallNow") }));
    expect(await screen.findByText(t("settings.androidInstallerStarted"))).toBeInTheDocument();

    window.dispatchEvent(new Event("focus"));

    expect(await screen.findByText(t("settings.androidInstallCancelled"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.releaseInstallNow") })).toBeEnabled();
  });
});

function mockNavigator({
  userAgent,
  platform,
  maxTouchPoints = 0
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
}) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints
  });
}
