import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { resetDesktopUpdateState } from "../platform/desktop/desktop-update-store";
import { I18nProvider, t } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ReleasePanel } from "./ReleasePanel";

const originalTauriInternals = window.__TAURI_INTERNALS__;

describe("ReleasePanel", () => {
  beforeEach(() => {
    resetDesktopUpdateState();
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
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
      return;
    }

    delete window.__TAURI_INTERNALS__;
  });

  it("展示极简客户端更新信息，并支持打开发布页", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "check_for_update") {
        expect(args).toEqual({ channel: "stable" });

        return {
          checkedAt: "2026-03-28T10:00:00.000Z",
          currentVersion: "0.1.0",
          hasUpdate: true,
          runtimeInfo: {
            version: "0.1.0",
            appDataDir: "/tmp/codingns"
          },
          manifest: {
            channel: "stable",
            platform: "macos-universal",
            version: "0.2.0",
            tagName: "v0.2.0",
            title: "v0.2.0",
            notes: "## 本次更新\n- 修掉旧的 manifest 检查逻辑",
            signature: null,
            htmlUrl: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.2.0",
            publishedAt: "2026-03-28T08:00:00.000Z"
          }
        };
      }

      if (command === "install_update") {
        expect(args).toEqual({ channel: "stable" });
        return {
          ok: true
        };
      }

      if (command === "restart_application") {
        return null;
      }

      if (command === "open_external") {
        expect(args).toEqual({
          url: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.2.0"
        });
        return null;
      }

      if (command === "show_notification") {
        return null;
      }

      throw new Error(`unexpected command: ${command}`);
    }) as typeof window.__TAURI_INTERNALS__ extends { invoke: infer T } ? T : never;

    window.__TAURI_INTERNALS__ = { invoke };

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <ReleasePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: t("settings.updateCheckAll") }));

    expect(await screen.findByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
    expect(screen.getByText(t("settings.releaseUpdateReady"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseInstallNow") }));

    await screen.findByText(t("settings.releaseRestartRequired"));
    expect(
      screen.getByRole("dialog", { name: t("settings.releaseRestartDialogTitle") })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseRestartConfirm") }));

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseOpenPage") }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_update", {
        channel: "stable"
      });
      expect(invoke).toHaveBeenCalledWith("restart_application");
      expect(invoke).toHaveBeenCalledWith("open_external", {
        url: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.2.0"
      });
    });
  });
  it("勾选自动下载后，检查到新版本会先下载再提示安装", async () => {
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

    const invoke = vi.fn(async (command: string) => {
      if (command === "check_for_update") {
        return {
          checkedAt: "2026-03-28T10:00:00.000Z",
          currentVersion: "0.1.0",
          hasUpdate: true,
          runtimeInfo: {
            version: "0.1.0",
            appDataDir: "/tmp/codingns"
          },
          manifest: {
            channel: "stable",
            platform: "macos-universal",
            version: "0.2.0",
            tagName: "v0.2.0",
            title: "v0.2.0",
            notes: "",
            signature: null,
            htmlUrl: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.2.0",
            publishedAt: "2026-03-28T08:00:00.000Z"
          }
        };
      }

      if (command === "download_update") {
        return {
          ok: true,
          version: "0.2.0",
          progress: {
            downloaded: 100,
            contentLength: 100,
            percent: 100
          }
        };
      }

      if (command === "install_update") {
        return { ok: true };
      }

      return null;
    }) as typeof window.__TAURI_INTERNALS__ extends { invoke: infer T } ? T : never;

    window.__TAURI_INTERNALS__ = { invoke };

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <ReleasePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: t("settings.updateCheckAll") }));

    expect(await screen.findByText(t("settings.releaseDownloadedReadyWithProgress", { percent: "100" }))).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: t("settings.releaseInstallReadyDialogTitle") })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseInstallReadyConfirm") }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("download_update", {
        channel: "stable"
      });
      expect(invoke).toHaveBeenCalledWith("install_update", {
        channel: "stable"
      });
    });
  });

});
