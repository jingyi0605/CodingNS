import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { I18nProvider, t } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ServiceUpdatePanel } from "./ServiceUpdatePanel";

const {
  checkForServiceUpdate,
  installServiceUpdate,
  getServiceUpdateTask
} = vi.hoisted(() => ({
  checkForServiceUpdate: vi.fn(),
  installServiceUpdate: vi.fn(),
  getServiceUpdateTask: vi.fn()
}));

vi.mock("../platform/server/service-update-manager", () => ({
  checkForServiceUpdate,
  installServiceUpdate,
  getServiceUpdateTask
}));

describe("ServiceUpdatePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("展示服务端版本并在确认后触发安装任务", async () => {
    checkForServiceUpdate
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        channel: "stable",
        checkedAt: "2026-04-15T10:02:00.000Z",
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
      status: "queued",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      restartRequired: false,
      restartScheduled: false,
      restartDelayMs: null
    });
    const user = userEvent.setup();

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <ServiceUpdatePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: t("settings.serverCheckNow") }));

    expect(await screen.findByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
    expect(screen.getByText(t("settings.serverUpdateReady"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.serverInstallWarning"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("settings.serverInstallNow") }));

    expect(screen.getByRole("dialog", {
      name: t("settings.serverInstallConfirmTitle")
    })).toBeInTheDocument();
    expect(installServiceUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: t("settings.serverInstallConfirmAction") }));

    expect(installServiceUpdate).toHaveBeenCalledWith("placeholder-server-package");
    expect(screen.getByText(t("settings.serverInstallQueued"))).toBeInTheDocument();
    expect(getServiceUpdateTask).not.toHaveBeenCalled();
  });
});
