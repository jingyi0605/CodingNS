import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import {
  markDesktopUpdateRestartPending,
  resetDesktopUpdateState
} from "../platform/desktop/desktop-update-store";
import { t } from "../shared/i18n";
import { DesktopAutoUpdateEffect } from "./DesktopAutoUpdateEffect";

const { checkForServiceUpdate } = vi.hoisted(() => ({
  checkForServiceUpdate: vi.fn()
}));

vi.mock("../platform/server/service-update-manager", () => ({
  checkForServiceUpdate
}));

describe("DesktopAutoUpdateEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDesktopUpdateState();
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    vi.stubGlobal("Notification", undefined);
    delete window.__TAURI_INTERNALS__;
    checkForServiceUpdate.mockResolvedValue(createServiceUpdateSnapshot(false));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.__TAURI_INTERNALS__;
  });

  it("桌面端开启自动检查时，会在启动后立即检查服务端和客户端，并在一小时后再次检查", async () => {
    const invoke = vi.fn(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "check_for_update") {
        expect(args).toEqual({ channel: "stable" });
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.2",
          hasUpdate: true,
          manifest: {
            channel: "stable",
            platform: "macos-universal",
            version: "0.1.3",
            tagName: "v0.1.3",
            title: "v0.1.3",
            notes: "",
            packageUrl: null,
            signature: null,
            htmlUrl: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.1.3",
            publishedAt: "2026-04-15T09:30:00.000Z"
          },
          runtimeInfo: {
            version: "0.1.2",
            appDataDir: null
          }
        } as T;
      }

      if (command === "show_notification") {
        return {
          ok: true
        } as T;
      }

      return undefined as T;
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(
      ((..._args: Parameters<typeof window.setInterval>) =>
        1 as unknown as ReturnType<typeof window.setInterval>) as unknown as typeof window.setInterval
    );
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);

    window.__TAURI_INTERNALS__ = {
      invoke: invoke as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"]
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    render(<DesktopAutoUpdateEffect />);

    await waitFor(() => {
      expect(countCommandCalls(invoke, "check_for_update")).toBe(1);
      expect(checkForServiceUpdate).toHaveBeenCalledTimes(1);
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
  });

  it("安装完成后等待重启时，不再继续自动检查更新", async () => {
    const invoke = vi.fn();

    window.__TAURI_INTERNALS__ = {
      invoke: invoke as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"]
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    markDesktopUpdateRestartPending("0.1.3");

    render(<DesktopAutoUpdateEffect />);

    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalled();
      expect(checkForServiceUpdate).not.toHaveBeenCalled();
    });
  });
  it("服务端发现新版本时，会发送服务端更新通知", async () => {
    const invoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "check_for_update") {
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.2",
          hasUpdate: false,
          manifest: null,
          runtimeInfo: {
            version: "0.1.2",
            appDataDir: null
          }
        } as T;
      }

      if (command === "show_notification") {
        return { ok: true } as T;
      }

      return undefined as T;
    });

    checkForServiceUpdate.mockResolvedValue(createServiceUpdateSnapshot(true));
    window.__TAURI_INTERNALS__ = {
      invoke: invoke as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"]
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    render(<DesktopAutoUpdateEffect />);

    await waitFor(() => {
      expect(checkForServiceUpdate).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith("show_notification", {
        title: t("settings.serverUpdateReady"),
        body: `${t("settings.serverTargetVersion")}: 0.2.0`
      });
    });
  });
  it("开启自动下载时，发现新版本会下载更新包并发送下载完成通知", async () => {
    const invoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "check_for_update") {
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.2",
          hasUpdate: true,
          manifest: {
            channel: "stable",
            platform: "macos-universal",
            version: "0.1.3",
            tagName: "v0.1.3",
            title: "v0.1.3",
            notes: "",
            packageUrl: null,
            signature: null,
            htmlUrl: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.1.3",
            publishedAt: "2026-04-15T09:30:00.000Z"
          },
          runtimeInfo: {
            version: "0.1.2",
            appDataDir: null
          }
        } as T;
      }

      if (command === "download_update") {
        return {
          ok: true,
          version: "0.1.3",
          progress: { downloaded: 100, contentLength: 100, percent: 100 }
        } as T;
      }

      if (command === "show_notification") {
        return { ok: true } as T;
      }

      return undefined as T;
    });

    window.__TAURI_INTERNALS__ = {
      invoke: invoke as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"]
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      autoDownloadUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    render(<DesktopAutoUpdateEffect />);

    await waitFor(() => {
      expect(countCommandCalls(invoke, "download_update")).toBe(1);
      expect(countCommandCalls(invoke, "show_notification")).toBe(1);
    });
  });

});

function createServiceUpdateSnapshot(hasUpdate: boolean) {
  return {
    channel: "stable",
    checkedAt: "2026-04-15T10:00:00.000Z",
    packages: [
      {
        channel: "stable",
        packageName: "placeholder-server-package",
        registryUrl: "https://registry.npmjs.org/placeholder-server-package",
        packagePageUrl: "https://www.npmjs.com/package/placeholder-server-package",
        currentVersion: "0.1.0",
        latestVersion: hasUpdate ? "0.2.0" : "0.1.0",
        hasUpdate,
        checkStatus: "ready",
        checkError: null,
        restartRequired: false,
        installTask: null
      }
    ]
  };
}

function countCommandCalls(
  invoke: ReturnType<typeof vi.fn>,
  command: string
): number {
  return invoke.mock.calls.filter(([calledCommand]) => calledCommand === command).length;
}
