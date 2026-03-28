import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { I18nProvider, t } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ServiceUpdatePanel } from "./ServiceUpdatePanel";

const { checkForServiceUpdate } = vi.hoisted(() => ({
  checkForServiceUpdate: vi.fn()
}));

vi.mock("../platform/server/service-update-manager", () => ({
  checkForServiceUpdate
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
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
  });

  it("展示服务端版本和 npm 更新入口", async () => {
    checkForServiceUpdate.mockResolvedValue({
      channel: "stable",
      packageName: "placeholder-server-package",
      registryUrl: "https://registry.npmjs.org/placeholder-server-package",
      packagePageUrl: "https://www.npmjs.com/package/placeholder-server-package",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      hasUpdate: true,
      updateCommand: "npm install placeholder-server-package@latest"
    });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <I18nProvider language="zh-CN">
        <ThemeProvider>
          <ServiceUpdatePanel />
        </ThemeProvider>
      </I18nProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: t("settings.serverCheckNow") }));

    expect(await screen.findByText("npm install placeholder-server-package@latest")).toBeInTheDocument();
    expect(screen.getByText(t("settings.serverUpdateReady"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.serverOpenPage") }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.npmjs.com/package/placeholder-server-package",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
