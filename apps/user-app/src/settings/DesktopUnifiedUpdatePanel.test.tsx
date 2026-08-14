import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { resetDesktopUpdateState } from "../platform/desktop/desktop-update-store";
import { I18nProvider, t } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { DesktopUnifiedUpdatePanel } from "./DesktopUnifiedUpdatePanel";

const {
  checkForServiceUpdate,
  fetchCurrentHostVersion,
  installServiceUpdate,
  getServiceUpdateTask
} = vi.hoisted(() => ({
  checkForServiceUpdate: vi.fn(),
  fetchCurrentHostVersion: vi.fn(),
  installServiceUpdate: vi.fn(),
  getServiceUpdateTask: vi.fn()
}));

vi.mock("../platform/server/service-update-manager", () => ({
  checkForServiceUpdate,
  fetchCurrentHostVersion,
  installServiceUpdate,
  getServiceUpdateTask
}));

describe("DesktopUnifiedUpdatePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDesktopUpdateState();
    fetchCurrentHostVersion.mockResolvedValue("0.1.0");
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
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
  });

  it("一次检查服务端和桌面端，并按服务端优先的顺序安装", async () => {
    const callOrder: string[] = [];
    const invoke = vi.fn(async (command: string) => {
      callOrder.push(command);

      if (command === "check_for_update") {
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.0",
          hasUpdate: true,
          runtimeInfo: {
            version: "0.1.0",
            appDataDir: null
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
            publishedAt: "2026-04-15T09:30:00.000Z"
          }
        };
      }

      if (command === "install_update") {
        return { ok: true };
      }

      return null;
    }) as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"];
    window.__TAURI_INTERNALS__ = { invoke };
    checkForServiceUpdate.mockResolvedValue({
      channel: "stable",
      checkedAt: "2026-04-15T10:00:00.000Z",
      packages: [
        {
          channel: "stable",
          packageName: "placeholder-server-package",
          registryUrl: "https://registry.npmjs.org/placeholder-server-package",
          packagePageUrl: "https://www.npmjs.com/package/placeholder-server-package",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
          hasUpdate: true,
          checkStatus: "ready",
          checkError: null,
          restartRequired: false,
          installTask: null
        }
      ]
    });
    installServiceUpdate.mockImplementation(async () => {
      callOrder.push("install_service_update");
      return {
        taskId: "task-1",
        packageName: "placeholder-server-package",
        channel: "stable",
        targetVersion: "0.2.0",
        status: "succeeded",
        startedAt: "2026-04-15T10:01:00.000Z",
        finishedAt: "2026-04-15T10:01:05.000Z",
        errorMessage: null,
        restartRequired: false,
        restartScheduled: false,
        restartDelayMs: null
      };
    });
    const user = userEvent.setup();

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <DesktopUnifiedUpdatePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: t("settings.updateCheckAll") }));

    expect(await screen.findByText(t("settings.updateBothReady"))).toBeInTheDocument();
    expect(screen.getAllByText("0.2.0").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: t("settings.serverInstallNow") }));

    await waitFor(() => {
      expect(callOrder).toContain("install_service_update");
    });

    await user.click(screen.getByRole("button", { name: t("settings.releaseInstallNow") }));

    await waitFor(() => {
      expect(callOrder).toContain("install_update");
      expect(callOrder.indexOf("install_service_update")).toBeLessThan(callOrder.indexOf("install_update"));
    });
  });

  it("开启自动下载后，统一面板会下载客户端更新包并提示安装", async () => {
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
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.0",
          hasUpdate: true,
          runtimeInfo: {
            version: "0.1.0",
            appDataDir: null
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
            publishedAt: "2026-04-15T09:30:00.000Z"
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
    }) as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"];
    window.__TAURI_INTERNALS__ = { invoke };
    checkForServiceUpdate.mockResolvedValue({
      channel: "stable",
      checkedAt: "2026-04-15T10:00:00.000Z",
      packages: [
        {
          channel: "stable",
          packageName: "placeholder-server-package",
          registryUrl: "https://registry.npmjs.org/placeholder-server-package",
          packagePageUrl: "https://www.npmjs.com/package/placeholder-server-package",
          currentVersion: "0.1.0",
          latestVersion: "0.1.0",
          hasUpdate: false,
          checkStatus: "ready",
          checkError: null,
          restartRequired: false,
          installTask: null
        }
      ]
    });
    const user = userEvent.setup();

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <DesktopUnifiedUpdatePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: t("settings.updateCheckAll") }));

    expect(await screen.findByRole("dialog", {
      name: t("settings.releaseInstallReadyDialogTitle")
    })).toBeInTheDocument();
    expect(screen.getByText(t("settings.releaseDownloadedReady"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("settings.releaseInstallReadyConfirm") }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("download_update", {
        channel: "stable"
      });
      expect(invoke).toHaveBeenCalledWith("install_update", {
        channel: "stable"
      });
      expect(installServiceUpdate).not.toHaveBeenCalled();
    });
  });

  it("只有服务端有更新时，只触发服务端安装", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "check_for_update") {
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.2.0",
          hasUpdate: false,
          runtimeInfo: {
            version: "0.2.0",
            appDataDir: null
          },
          manifest: null
        };
      }

      if (command === "install_update") {
        return { ok: true };
      }

      return null;
    }) as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"];
    window.__TAURI_INTERNALS__ = { invoke };
    checkForServiceUpdate.mockResolvedValue({
      channel: "stable",
      checkedAt: "2026-04-15T10:00:00.000Z",
      packages: [
        {
          channel: "stable",
          packageName: "placeholder-server-package",
          registryUrl: "https://registry.npmjs.org/placeholder-server-package",
          packagePageUrl: "https://www.npmjs.com/package/placeholder-server-package",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
          hasUpdate: true,
          checkStatus: "ready",
          checkError: null,
          restartRequired: false,
          installTask: null
        }
      ]
    });
    installServiceUpdate.mockResolvedValue({
      taskId: "task-1",
      packageName: "placeholder-server-package",
      channel: "stable",
      targetVersion: "0.2.0",
      status: "succeeded",
      startedAt: "2026-04-15T10:01:00.000Z",
      finishedAt: "2026-04-15T10:01:05.000Z",
      errorMessage: null,
      restartRequired: false,
      restartScheduled: false,
      restartDelayMs: null
    });
    const user = userEvent.setup();

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <DesktopUnifiedUpdatePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: t("settings.updateCheckAll") }));
    await user.click(screen.getByRole("button", { name: t("settings.serverInstallNow") }));

    await waitFor(() => {
      expect(installServiceUpdate).toHaveBeenCalledWith("placeholder-server-package");
      expect(invoke).not.toHaveBeenCalledWith("install_update", expect.anything());
    });
  });

  it("服务端检查失败时，仍会继续检查桌面端更新", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "check_for_update") {
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.0",
          hasUpdate: true,
          runtimeInfo: {
            version: "0.1.0",
            appDataDir: null
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
            publishedAt: "2026-04-15T09:30:00.000Z"
          }
        };
      }

      return null;
    }) as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"];
    window.__TAURI_INTERNALS__ = { invoke };
    checkForServiceUpdate.mockRejectedValue(new Error("服务端检查失败"));
    const user = userEvent.setup();

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <DesktopUnifiedUpdatePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: t("settings.updateCheckAll") }));

    expect(await screen.findByText(t("settings.updateClientReadyServiceCheckFailed"))).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("check_for_update", {
      channel: "stable"
    });
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
  });
});
