import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import {
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  SHOW_SYSTEM_FILES_STORAGE_KEY,
  localUiPreferenceStore
} from "../../../preferences/local-ui-preference-store";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { authStore } from "../../auth/store/auth-store";
import { PlatformProvider } from "../../../platform/platform-provider";
import { I18nProvider, t } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { AppVersionProvider } from "../../../shared/version/app-version";
import { SettingsPage } from "./SettingsPage";

const originalTauriInternals = window.__TAURI_INTERNALS__;

describe("SettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    localUiPreferenceStore.setShowSystemFiles(false);
    localUiPreferenceStore.setNotificationPreferences({
      notifyOnPermissionRequest: true,
      notifyOnSessionCompleted: true,
      notifyOnSessionFailed: true
    });
    authStore.clear();
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    userPreferenceStore.hydrate(createPreferenceState());
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
      return;
    }

    delete window.__TAURI_INTERNALS__;
  });

  it("Web 桌面布局不显示服务器连接表单", () => {
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: t("settings.title") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.serverConnection"))).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: t("settings.serverAddress") })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t("settings.defaultPermissionMode") })).toBeInTheDocument();
    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.serverCheckNow") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.clientUpdate"))).not.toBeInTheDocument();
    expect(screen.queryByText("当前运行平台")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("common.logout") })).toBeInTheDocument();
    expect(screen.getByText(`CodingNS v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it("桌面端优先显示运行时版本", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: async <T,>(command: string) => {
        if (command === "get_runtime_info") {
          return {
            version: "9.9.9",
            appDataDir: null
          } as T;
        }

        return undefined as T;
      }
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByText("CodingNS v9.9.9")).toBeInTheDocument();
    });
  });

  it("H5 移动布局不再允许修改服务器地址", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: t("settings.title") })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(t("settings.serverConnection")) })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: t("settings.serverAddress") })).not.toBeInTheDocument();

    const serverView = renderSettingsPage("/settings/server-connection");

    expect(screen.queryByRole("textbox", { name: t("settings.serverAddress") })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(t("settings.serverConnection")) })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.autoReconnect"))).not.toBeInTheDocument();

    serverView.unmount();
  });

  it("iOS 客户端使用移动布局时仍然允许修改服务器地址", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "ios",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    setViewportWidth(390);

    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.serverConnection")) }));

    const addressInput = await screen.findByRole("textbox", { name: t("settings.serverAddress") });
    const saveButton = screen.getByRole("button", { name: t("common.save") });

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.8:4100");
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(clientConfigStore.getState().hostBaseUrl).toBe("http://10.10.1.8:4100");
    });
  });

  it("桌面端仍然允许修改服务器地址", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    renderSettingsPage();

    const addressInput = screen.getByRole("textbox", { name: t("settings.serverAddress") });
    const saveButton = screen.getByRole("button", { name: t("common.save") });

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.8:4100");
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(clientConfigStore.getState().hostBaseUrl).toBe("http://10.10.1.8:4100");
    });
  });

  it("H5 移动布局的软件更新分类只显示服务端更新", () => {
    setViewportWidth(390);
    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.serverCheckNow") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.autoCheckUpdate"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.clientUpdate"))).not.toBeInTheDocument();
  });

  it("桌面运行时使用移动布局时，会同时显示服务端和客户端更新", () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    setViewportWidth(390);

    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.serverCheckNow") })).toBeInTheDocument();
    expect(screen.getByText(t("settings.clientUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.autoCheckUpdate"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.releaseCheckNow") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.releaseOpenPage") })).toBeInTheDocument();
  });

  it("移动布局把默认会话权限放在安全与隐私分类下", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.securityPrivacy")) }));

    const select = await screen.findByRole("combobox", { name: t("settings.defaultPermissionMode") });

    expect(select).toHaveValue("default");

    await userEvent.selectOptions(select, "bypassPermissions");

    await waitFor(() => {
      expect(userPreferenceStore.getState().profile.defaultPermissionMode).toBe("bypassPermissions");
    });
  });

  it("移动布局不再显示运行平台检测信息", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    expect(screen.queryByText(/^Web$/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.softwareUpdate")) }));

    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("settings.releaseCheckNow") })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Web$/)).not.toBeInTheDocument();
    expect(screen.queryByText("当前运行平台")).not.toBeInTheDocument();
  });

  it("桌面布局在 Web 运行时只显示服务端更新面板", () => {
    renderSettingsPage();

    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.serverCheckNow") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.clientUpdate"))).not.toBeInTheDocument();
  });

  it("移动布局在底部固定显示退出登录按钮", () => {
    setViewportWidth(390);
    renderSettingsPage();

    expect(screen.getByRole("button", { name: t("common.logout") })).toBeInTheDocument();
  });
  it("会把显示系统文件开关写入本地 localStorage", async () => {
    renderSettingsPage();

    const checkbox = screen.getByRole("checkbox", { name: t("settings.showSystemFiles") });

    expect(checkbox).not.toBeChecked();
    expect(window.localStorage.getItem(SHOW_SYSTEM_FILES_STORAGE_KEY)).toBeNull();

    await userEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(localUiPreferenceStore.getState().showSystemFiles).toBe(true);
    expect(window.localStorage.getItem(SHOW_SYSTEM_FILES_STORAGE_KEY)).toBe("1");

    await userEvent.click(checkbox);

    expect(checkbox).not.toBeChecked();
    expect(localUiPreferenceStore.getState().showSystemFiles).toBe(false);
    expect(window.localStorage.getItem(SHOW_SYSTEM_FILES_STORAGE_KEY)).toBeNull();
  });

  it("会把会话通知行为开关写入本地 localStorage", async () => {
    renderSettingsPage();

    const permissionCheckbox = screen.getByRole("checkbox", {
      name: t("settings.notifyOnPermissionRequest")
    });
    const completionCheckbox = screen.getByRole("checkbox", {
      name: t("settings.notifyOnSessionCompleted")
    });
    const failedCheckbox = screen.getByRole("checkbox", {
      name: t("settings.notifyOnSessionFailed")
    });

    expect(permissionCheckbox).toBeChecked();
    expect(completionCheckbox).toBeChecked();
    expect(failedCheckbox).toBeChecked();

    await userEvent.click(permissionCheckbox);
    await userEvent.click(completionCheckbox);
    await userEvent.click(failedCheckbox);

    expect(localUiPreferenceStore.getState().notificationPreferences).toEqual({
      notifyOnPermissionRequest: false,
      notifyOnSessionCompleted: false,
      notifyOnSessionFailed: false
    });
    expect(window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({
        notifyOnPermissionRequest: false,
        notifyOnSessionCompleted: false,
        notifyOnSessionFailed: false
      })
    );
  });
});

function renderSettingsPage(initialEntry = "/settings") {
  return render(
    <PlatformProvider>
      <AppVersionProvider>
        <I18nProvider language={clientConfigStore.getState().language}>
          <ThemeProvider>
            <MemoryRouter initialEntries={[initialEntry]}>
              <Routes>
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/:section" element={<SettingsPage />} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </I18nProvider>
      </AppVersionProvider>
    </PlatformProvider>
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width
  });
  window.dispatchEvent(new Event("resize"));
}

function createPreferenceState(overrides?: Partial<ReturnType<typeof userPreferenceStore.getState>["profile"]>) {
  return {
    initialized: true,
    profile: {
      language: overrides?.language ?? "zh-CN",
      theme: overrides?.theme ?? "light",
      defaultPermissionMode: overrides?.defaultPermissionMode ?? "default"
    },
    providers: {
      "claude-code": {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      codex: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      opencode: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}
