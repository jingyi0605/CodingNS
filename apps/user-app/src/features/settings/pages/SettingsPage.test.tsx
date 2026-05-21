import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { getActiveHostBaseUrl } from "../../../config/client-config-types";
import {
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  SESSION_DISPLAY_SORT_MODE_STORAGE_KEY,
  SHOW_SYSTEM_FILES_STORAGE_KEY,
  localUiPreferenceStore
} from "../../../preferences/local-ui-preference-store";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { authStore } from "../../auth/store/auth-store";
import { PlatformProvider } from "../../../platform/platform-provider";
import { resetDesktopUpdateState } from "../../../platform/desktop/desktop-update-store";
import { I18nProvider, t } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { AppVersionProvider } from "../../../shared/version/app-version";
import { SettingsPage } from "./SettingsPage";

const originalTauriInternals = window.__TAURI_INTERNALS__;
const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");

vi.mock("../../../settings/TailscalePanel", () => ({
  TailscalePanel: () => <div data-testid="tailscale-panel">tailscale-panel</div>
}));

vi.mock("../../../settings/RelayTunnelPanel", () => ({
  RelayTunnelPanel: () => <div data-testid="relay-tunnel-panel">relay-tunnel-panel</div>
}));

vi.mock("../../../settings/ModelManagementPanel", () => ({
  ModelManagementPanel: () => <div data-testid="model-management-panel">model-management-panel</div>
}));

vi.mock("../../../settings/ProviderManagementPanel", () => ({
  ProviderManagementPanel: () => <div data-testid="provider-management-panel">provider-management-panel</div>
}));

vi.mock("../../../settings/AuthDeviceManagementPanel", () => ({
  AuthDeviceManagementPanel: () => <div data-testid="auth-device-management-panel">auth-device-management-panel</div>
}));

vi.mock("../../plugins/api/plugins-api", async () => {
  const actual = await vi.importActual<typeof import("../../plugins/api/plugins-api")>("../../plugins/api/plugins-api");

  return {
    ...actual,
    listPlugins: vi.fn(async () => ({
      items: [
        {
          id: "demo.plugin",
          name: "演示插件",
          version: "1.0.0",
          enabled: true,
          installRoot: "/plugins/demo",
          hasFrontend: true,
          hasBackend: true,
          updatedAt: "2026-05-21T00:00:00.000Z"
        }
      ]
    })),
    getPlugin: vi.fn(async () => ({
      definition: {
        id: "demo.plugin",
        version: "1.0.0",
        name: "演示插件",
        installRoot: "/plugins/demo",
        manifestJson: "{}",
        hasFrontend: true,
        hasBackend: true,
        createdAt: "2026-05-21T00:00:00.000Z",
        updatedAt: "2026-05-21T00:00:00.000Z"
      },
      manifest: {
        id: "demo.plugin",
        name: "演示插件",
        version: "1.0.0",
        frontend: {
          entry: "index.html",
          mode: "static_html"
        },
        backend: {
          runtime: "node",
          mode: "on_demand",
          actions: [
            {
              id: "run-report",
              title: "运行报表",
              entry: "action.js",
              timeoutMs: 3000
            }
          ]
        },
        permissions: {
          workspaceRead: true,
          network: false,
          desktop: ["open_file"]
        }
      },
      enablement: {
        pluginId: "demo.plugin",
        enabled: true,
        enabledByUserId: "user-1",
        enabledAt: "2026-05-21T00:00:00.000Z",
        disabledByUserId: null,
        disabledAt: null,
        reason: null,
        updatedAt: "2026-05-21T00:00:00.000Z"
      },
      auditEvents: [],
      frontend: {
        basePath: "/preview/plugins/demo.plugin/frontend",
        entryUrl: "/preview/plugins/demo.plugin/frontend/index.html"
      }
    })),
    listPluginRuns: vi.fn(async () => ({
      items: [
        {
          id: "run-1",
          pluginId: "demo.plugin",
          workspaceId: "workspace-1",
          triggerKind: "frontend",
          actionId: "run-report",
          status: "succeeded",
          inputSummaryJson: null,
          outputSummaryJson: null,
          errorCode: null,
          errorMessage: null,
          startedAt: "2026-05-21T00:00:00.000Z",
          finishedAt: "2026-05-21T00:00:01.000Z",
          createdAt: "2026-05-21T00:00:00.000Z"
        }
      ]
    })),
    enablePlugin: vi.fn(async () => ({
      pluginId: "demo.plugin",
      enabled: true,
      enabledByUserId: "user-1",
      enabledAt: "2026-05-21T00:00:00.000Z",
      disabledByUserId: null,
      disabledAt: null,
      reason: null,
      updatedAt: "2026-05-21T00:00:00.000Z"
    })),
    disablePlugin: vi.fn(async () => ({
      pluginId: "demo.plugin",
      enabled: false,
      enabledByUserId: "user-1",
      enabledAt: "2026-05-21T00:00:00.000Z",
      disabledByUserId: "user-1",
      disabledAt: "2026-05-21T00:10:00.000Z",
      reason: "由用户在插件详情页停用",
      updatedAt: "2026-05-21T00:10:00.000Z"
    }))
  };
});

describe("SettingsPage", () => {
  beforeEach(() => {
    resetDesktopUpdateState();
    window.localStorage.clear();
    localUiPreferenceStore.setSessionDisplaySortMode("createdAt");
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
    global.fetch = originalFetch;
    window.matchMedia = originalMatchMedia;

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

  it("Web 桌面布局不显示服务器连接表单", () => {
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: t("settings.title") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.serverConnection"))).not.toBeInTheDocument();
    expect(screen.getByText(t("settings.abilityManagement"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.remoteAccess"))).toBeInTheDocument();
    expect(screen.queryByText(t("settings.skillManagerTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.skillManagerDescription"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.skills"))).not.toBeInTheDocument();
    expect(screen.getByTestId("model-management-panel")).toBeInTheDocument();
    expect(screen.queryByText(t("settings.modelManagementSectionSummary"))).not.toBeInTheDocument();
    expect(screen.getByTestId("provider-management-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("relay-tunnel-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tailscale-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.remoteAccessManageAction") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.tailscaleSectionTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.tailscaleSectionDescription"))).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: t("settings.serverAddress") })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t("settings.defaultPermissionMode") })).toBeInTheDocument();
    expect(screen.getByTestId("auth-device-management-panel")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: new RegExp(t("settings.remoteAccess")) })).toBeInTheDocument();
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

  it("移动布局可以进入远程访问分类并在访问方式管理中显示远程接入面板", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.remoteAccess")) }));

    expect(screen.getByRole("button", { name: t("settings.remoteAccessManageAction") })).toBeInTheDocument();
    expect(screen.queryByTestId("relay-tunnel-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tailscale-panel")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.remoteAccessManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.remoteAccessModalTitle") });

    expect(within(dialog).getByTestId("relay-tunnel-panel")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.remoteAccessTailscaleTab") }));

    expect(await within(dialog).findByTestId("tailscale-panel")).toBeInTheDocument();
  });

  it("移动布局提供能力管理分类并能进入统一页面", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.abilityManagement")) }));

    expect(await screen.findByText(t("settings.abilityManagement"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.providerManagement"))).toBeInTheDocument();
    expect(await screen.findByTestId("model-management-panel")).toBeInTheDocument();
    expect(screen.getByTestId("provider-management-panel")).toBeInTheDocument();
  });

  it("桌面设置页可以打开插件管理模态框", async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: t("settings.pluginManagementAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.pluginManagementModalTitle") });
    expect(within(dialog).getByText(t("settings.pluginManagementModalListTitle"))).toBeInTheDocument();
    expect(within(dialog).getAllByText("演示插件").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(t("plugins.runHistoryTitle"))).toBeInTheDocument();
  });

  it("移动设置页可以打开插件管理弹层", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.abilityManagement")) }));
    await userEvent.click(screen.getByRole("button", { name: t("settings.pluginManagementAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.pluginManagementModalTitle") });
    expect(within(dialog).getAllByText("演示插件").length).toBeGreaterThan(0);
  });

  it("旧的模型和 provider 路由别名会落到能力管理页", async () => {
    setViewportWidth(390);

    const modelAliasView = renderSettingsPage("/settings/model-management");

    expect(await screen.findByTestId("model-management-panel")).toBeInTheDocument();
    expect(screen.getByTestId("provider-management-panel")).toBeInTheDocument();

    modelAliasView.unmount();

    renderSettingsPage("/settings/provider-management");

    expect(await screen.findByTestId("model-management-panel")).toBeInTheDocument();
    expect(screen.getByTestId("provider-management-panel")).toBeInTheDocument();
  });

  it("移动布局不再提供 Skills 分类", () => {
    setViewportWidth(390);
    renderSettingsPage();

    expect(screen.queryByRole("button", { name: new RegExp(t("settings.skills")) })).not.toBeInTheDocument();
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
    const saveButton = screen.getAllByRole("button", { name: t("common.save") })[0]!;

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.8:4100");
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://10.10.1.8:4100");
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
    const saveButton = screen.getAllByRole("button", { name: t("common.save") })[0]!;

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.8:4100");
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://10.10.1.8:4100");
    });
  });

  it("桌面端可以通过访问方式管理弹窗切换远程访问方式", async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: t("settings.remoteAccessManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.remoteAccessModalTitle") });

    expect(within(dialog).getByTestId("relay-tunnel-panel")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("tailscale-panel")).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.remoteAccessTailscaleTab") }));

    expect(await within(dialog).findByTestId("tailscale-panel")).toBeInTheDocument();
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

  it("调试端口池只保留一个共享范围配置", async () => {
    renderSettingsPage();

    const startInput = screen.getByRole("textbox", {
      name: `${t("settings.debugPortPool")} ${t("settings.debugPortPoolStart")}`
    });
    const endInput = screen.getByRole("textbox", {
      name: `${t("settings.debugPortPool")} ${t("settings.debugPortPoolEnd")}`
    });

    expect(screen.getByText(t("settings.debugPortPoolRangeLabel"))).toBeInTheDocument();
    expect(screen.queryByText(t("settings.debugPortPoolRoleFrontend"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.debugPortPoolRoleBackend"))).not.toBeInTheDocument();
    expect(startInput).toHaveValue("43000");
    expect(endInput).toHaveValue("47999");

    await userEvent.clear(startInput);
    await userEvent.type(startInput, "48000");
    await userEvent.clear(endInput);
    await userEvent.type(endInput, "48010");
    const saveButtons = screen.getAllByRole("button", { name: t("common.save") });
    await userEvent.click(saveButtons[saveButtons.length - 1]!);

    await waitFor(() => {
      expect(userPreferenceStore.getState().profile.debugPortPools).toEqual({
        start: 48000,
        end: 48010
      });
    });
  });

  it("Android 运行时使用移动布局时，会显示 APK 直装更新面板", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (command: string) => {
        if (command === "get_android_runtime_info") {
          return {
            version: "0.3.0",
            versionCode: 3000,
            packageName: "com.codingns.userapp"
          };
        }

        return undefined;
      }) as never
    };
    authStore.hydrate(createAuthSession());
    global.fetch = vi.fn(async () =>
      createJsonResponse({
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
      })
    ) as typeof fetch;
    clientConfigStore.hydrate({
      platform: "android",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    setViewportWidth(390);

    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.clientUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.autoCheckUpdate"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseCheckNow") }));

    expect(await screen.findByText("0.3.0")).toBeInTheDocument();
    expect(screen.getByText("0.4.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("settings.releaseOpenPage") })).not.toBeInTheDocument();
  });

  it("iOS 运行时的软件更新分类会明确显示客户端更新不受支持", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5
    });
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

    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.clientUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.autoCheckUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.clientUpdateUnsupported"))).toBeInTheDocument();
  });

  it("移动布局把默认会话权限放在安全与隐私分类下", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.securityPrivacy")) }));

    const select = await screen.findByRole("combobox", { name: t("settings.defaultPermissionMode") });

    expect(select).toHaveValue("default");
    expect(screen.getByTestId("auth-device-management-panel")).toBeInTheDocument();

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

  it("会把自动主题开关写入账户偏好", async () => {
    renderSettingsPage();

    const checkbox = screen.getByRole("checkbox", { name: t("settings.autoTheme") });

    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(userPreferenceStore.getState().profile.autoTheme).toBe(true);
    });
  });

  it("点击可见开关容器也会切换自动主题", async () => {
    renderSettingsPage();

    const checkbox = screen.getByRole("checkbox", { name: t("settings.autoTheme") });
    const switchControl = checkbox.closest(".settings-mobile-switch");

    expect(switchControl).not.toBeNull();

    await userEvent.click(switchControl!);

    await waitFor(() => {
      expect(userPreferenceStore.getState().profile.autoTheme).toBe(true);
    });
  });

  it("开启自动主题后会根据系统偏好切换日夜模式", async () => {
    const mediaQuery = createMatchMediaMock(false);
    window.matchMedia = vi.fn().mockImplementation(mediaQuery.matchMedia);
    renderSettingsPage();

    const checkbox = screen.getByRole("checkbox", { name: t("settings.autoTheme") });
    await userEvent.click(checkbox);

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    mediaQuery.setMatches(true);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
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

  it("会把工作区会话排序方式写入本地 localStorage", async () => {
    renderSettingsPage();

    const select = screen.getByRole("combobox", { name: t("settings.workspaceSessionSortMode") });

    expect(select).toHaveValue("createdAt");
    expect(window.localStorage.getItem(SESSION_DISPLAY_SORT_MODE_STORAGE_KEY)).toBeNull();

    await userEvent.selectOptions(select, "updatedAt");

    expect(select).toHaveValue("updatedAt");
    expect(localUiPreferenceStore.getState().sessionDisplaySortMode).toBe("updatedAt");
    expect(window.localStorage.getItem(SESSION_DISPLAY_SORT_MODE_STORAGE_KEY)).toBe("updatedAt");

    await userEvent.selectOptions(select, "createdAt");

    expect(select).toHaveValue("createdAt");
    expect(localUiPreferenceStore.getState().sessionDisplaySortMode).toBe("createdAt");
    expect(window.localStorage.getItem(SESSION_DISPLAY_SORT_MODE_STORAGE_KEY)).toBeNull();
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

  it("桌面端高级设置可打开并关闭并行任务调试模态框", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/skills/overview") && method === "GET") {
        return createJsonResponse(createSkillOverviewResponse());
      }

      if (url.endsWith("/api/observability/runtime/session") && method === "POST") {
        return createJsonResponse({
          sessionId: "session-debug-1",
          expiresAt: "2026-04-12T09:00:20.000Z",
          ttlMs: 20_000
        });
      }

      if (url.includes("/api/observability/runtime?sessionId=session-debug-1") && method === "GET") {
        return createJsonResponse({
          observedAt: "2026-04-12T09:00:01.000Z",
          session: {
            sessionId: "session-debug-1",
            expiresAt: "2026-04-12T09:00:20.000Z",
            ttlMs: 20_000
          },
          backgroundTasks: {
            totals: {
              enqueue: 4,
              dedupe: 1,
              started: 3,
              finished: 3,
              failed: 0,
              cancelled: 0,
              timeout: 0,
              cache_hit: 2
            },
            taskTypes: {
              "workspace.discovery": {
                executionLane: "helper_process",
                counters: {
                  enqueue: 2,
                  dedupe: 0,
                  started: 2,
                  finished: 2,
                  failed: 0,
                  cancelled: 0,
                  timeout: 0,
                  cache_hit: 1
                },
                waitMs: {
                  count: 2,
                  total: 12,
                  max: 8,
                  min: 4,
                  avg: 6
                },
                runMs: {
                  count: 2,
                  total: 42,
                  max: 24,
                  min: 18,
                  avg: 21
                }
              }
            }
          },
          recentTaskActivities: [
            {
              eventId: "evt-1",
              recordedAt: "2026-04-12T09:00:01.000Z",
              eventType: "finished",
              taskId: "task-1",
              taskType: "workspace.discovery",
              key: "workspace:demo",
              executionLane: "helper_process",
              source: "settings_debug",
              status: "succeeded",
              attempt: 1,
              waitMs: 6,
              runMs: 18,
              errorMessage: null
            }
          ],
          schedulers: {
            schedulers: {
              patrol: {
                tickTotal: 4,
                idleTickTotal: 3,
                errorTotal: 0,
                taskCountTotal: 1,
                durationMs: {
                  count: 4,
                  total: 30,
                  max: 12,
                  min: 4,
                  avg: 7.5
                },
                lastTickAt: "2026-04-12T09:00:00.000Z",
                lastDurationMs: 8,
                lastTaskCount: 0,
                lastIdle: true,
                lastErrorCount: 0,
                nextDelayMs: 2000,
                idleStreak: 2
              }
            }
          },
          eventLoop: {
            enabled: true,
            resolutionMs: 20,
            minMs: 1,
            maxMs: 12,
            meanMs: 4.2,
            stddevMs: 1.4,
            p50Ms: 4,
            p95Ms: 9,
            p99Ms: 11
          }
        });
      }

      if (url.endsWith("/api/observability/runtime/session/session-debug-1") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;
    authStore.hydrate(createAuthSession());

    renderSettingsPage();

    expect(screen.getByText(t("settings.advancedSettings"))).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    await userEvent.click(screen.getByRole("button", { name: t("settings.parallelTaskDebugAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.parallelTaskDebugModalTitle") });
    expect(dialog).toBeInTheDocument();
    expect((await screen.findAllByText("workspace.discovery")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("settings.parallelTaskDebugEventLoopTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.parallelTaskDebugMetricEnqueue"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.parallelTaskDebugClose") }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          return (
            String(input).endsWith("/api/observability/runtime/session/session-debug-1") &&
            (init?.method ?? "GET").toUpperCase() === "DELETE"
          );
        })
      ).toBe(true);
    });
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

function createPreferenceState(overrides?: Partial<ReturnType<typeof userPreferenceStore.getState>["profile"]>) {
  return {
    initialized: true,
    profile: {
      language: overrides?.language ?? "zh-CN",
      theme: overrides?.theme ?? "light",
      autoTheme: overrides?.autoTheme ?? false,
      defaultPermissionMode: overrides?.defaultPermissionMode ?? "default",
      debugPortPools: overrides?.debugPortPools ?? {
        start: 43000,
        end: 47999
      }
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
      },
      gemini: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      kimi: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}

function createMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  return {
    matchMedia: () => {
      const mediaQuery = {
        media: "(prefers-color-scheme: dark)",
        get matches() {
          return matches;
        },
        onchange: null,
        addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: () => true
      } as unknown as MediaQueryList;

      return mediaQuery;
    },
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    }
  };
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

function createSkillOverviewResponse() {
  return {
    summary: {
      managedSkillCount: 1,
      managedEntryCount: 1,
      unmanagedEntryCount: 1,
      conflictedEntryCount: 0,
      diagnosticCount: 0
    },
    managedSkills: [
      {
        skill: {
          id: "skill-1",
          name: "team-helper",
          scope: "workspace",
          directoryName: "team-helper",
          sourceType: "local-import",
          sourcePath: "/tmp/skills/team-helper",
          contentHash: "hash-1",
          managedState: "active",
          createdAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:00:00.000Z"
        },
        bindings: [
          {
            skillId: "skill-1",
            targetCli: "codex",
            enabled: true,
            syncStatus: "synced",
            lastSyncedAt: "2026-04-14T10:05:00.000Z",
            lastErrorCode: null,
            lastErrorDetail: null
          }
        ],
        ssotPath: "/tmp/managed-skills/team-helper"
      }
    ],
    assistantRuntimeSkills: [
      {
        name: "codingns-assistant",
        directoryName: "codingns-assistant",
        sourcePath: "/repo/builtin-skills/codingns-assistant",
        usedByTargetCli: ["codex", "claude-code"]
      }
    ],
    managedEntries: [
      {
        targetCli: "codex",
        directoryPath: "/tmp/skills/team-helper",
        directoryName: "team-helper",
        name: "team-helper",
        contentHash: "hash-1",
        managementState: "managed",
        managedSkillId: "skill-1"
      }
    ],
    unmanagedEntries: [
      {
        targetCli: "claude-code",
        directoryPath: "/tmp/claude/skills/sample-helper",
        directoryName: "sample-helper",
        name: "sample-helper",
        contentHash: "hash-2",
        managementState: "unmanaged",
        managedSkillId: null
      }
    ],
    conflictedEntries: [],
    diagnostics: [],
    scannedAt: "2026-04-14T10:10:00.000Z"
  };
}
