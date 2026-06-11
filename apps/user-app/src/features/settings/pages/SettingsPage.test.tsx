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
import { ToastProvider } from "../../../shared/toast";
import { AppVersionProvider } from "../../../shared/version/app-version";
import { SettingsPage } from "./SettingsPage";

const mockUseWorkbenchShell = vi.fn();
const affairsLibraryCapabilityMock = vi.hoisted(() => ({
  state: {
    enabled: false,
    binding: null,
    loading: false,
    requested: true,
    error: null
  },
  setEnabled: vi.fn(async (enabled: boolean) => {
    affairsLibraryCapabilityMock.state = {
      ...affairsLibraryCapabilityMock.state,
      enabled,
      loading: false,
      error: null
    };
    return affairsLibraryCapabilityMock.state;
  })
}));
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

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../workbench/affairs-library-capability-store", () => ({
  useAffairsLibraryCapability: () => affairsLibraryCapabilityMock.state,
  setAffairsLibraryCapabilityEnabled: affairsLibraryCapabilityMock.setEnabled
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
    listPluginPermissionGrants: vi.fn(async () => ({
      items: [
        {
          id: "grant-1",
          pluginId: "demo.plugin",
          workspaceId: "workspace-1",
          permissionKey: "workspace.write_file",
          scopeType: "directory",
          scopePath: "reports",
          grantMode: "persistent",
          grantedByUserId: "user-1",
          runtimeSessionId: null,
          createdAt: "2026-05-21T00:00:00.000Z",
          expiresAt: null,
          revokedAt: null
        }
      ]
    })),
    revokePluginPermissionGrant: vi.fn(async () => ({
      id: "grant-1",
      pluginId: "demo.plugin",
      workspaceId: "workspace-1",
      permissionKey: "workspace.write_file",
      scopeType: "directory",
      scopePath: "reports",
      grantMode: "persistent",
      grantedByUserId: "user-1",
      runtimeSessionId: null,
      createdAt: "2026-05-21T00:00:00.000Z",
      expiresAt: null,
      revokedAt: "2026-05-21T00:05:00.000Z"
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
    affairsLibraryCapabilityMock.state = {
      enabled: false,
      binding: null,
      loading: false,
      requested: true,
      error: null
    };
    affairsLibraryCapabilityMock.setEnabled.mockClear();
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1"
          }
        }
      ]
    });
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
      autoDownloadUpdate: false,
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
      autoDownloadUpdate: false,
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
    expect(within(dialog).getByText(t("plugins.grantedPermissionTitle"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("plugins.permissionAuditTitle"))).toBeInTheDocument();
  });

  it("桌面设置页的能力管理分类会提供 ONLYOFFICE 设置入口", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const matched = matchSkillManagementPanelRequest(url, method, init);

      if (matched) {
        return matched;
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    authStore.hydrate(createAuthSession());
    renderSettingsPage();

    const trigger = screen.getByRole("button", { name: t("settings.skillOnlyOfficeOpenSettingsAction") });
    expect(trigger).toBeInTheDocument();

    await userEvent.click(trigger);

    expect(screen.queryByRole("dialog", { name: t("settings.skillConfigModalTitle") })).not.toBeInTheDocument();

    const dialog = await screen.findByRole("dialog", { name: t("settings.skillOnlyOfficeModalTitle") });
    expect(within(dialog).getByRole("textbox", { name: t("settings.skillOnlyOfficeServerUrlLabel") })).toHaveValue("http://127.0.0.1:8088");
    expect(within(dialog).getByRole("button", { name: t("settings.skillOnlyOfficeCheckAction") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.skillOnlyOfficeSaveAction") })).toBeInTheDocument();
  });

  it("桌面设置页的能力管理分类会提供 Teable 设置入口", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const matched = matchSkillManagementPanelRequest(url, method, init);

      if (matched) {
        return matched;
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    authStore.hydrate(createAuthSession());
    renderSettingsPage();

    const trigger = screen.getByRole("button", { name: t("settings.teableOpenSettingsAction") });
    expect(trigger).toBeInTheDocument();

    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: t("settings.teableModalTitle") });
    expect(within(dialog).getByRole("tab", { name: t("settings.teableTabConnectionSettings") })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: t("settings.teableTabTableSyncSettings") })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: t("settings.teableTabSyncLogs") })).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: t("settings.teableTabMirrors") })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: t("settings.teableTabFieldMappings") })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(t("settings.teableAuthRefLabel"))).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole("textbox", { name: t("settings.teableBaseUrlLabel") })).toHaveValue("https://teable.example.com");
    });
    expect(within(dialog).getByRole("button", { name: t("settings.teableTestConnectionAction") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.teableSaveBindingAction") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("common.cancel") })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.teableTabTableSyncSettings") }));
    expect(await within(dialog).findByText(t("settings.teableTableSyncListTitle"))).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: t("settings.teableTableToAddLabel") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.teableAddSyncTableAction") })).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.teableTableSyncConfigTitle"))).toBeInTheDocument();
    expect(within(dialog).getAllByText("标签镜像表").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("combobox", { name: t("settings.teableSyncSourceLabel") })).toHaveValue("tags");
    expect(within(dialog).getByText(t("settings.teableDocumentTagRootsLabel"))).toBeInTheDocument();
    expect((await within(dialog).findAllByText("标签名称")).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: t("settings.teableSaveTableSyncSettingsAction") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.teableSyncNowAction") })).toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("settings.teableSyncSourceLabel") }), "sessions");
    expect(within(dialog).getByText(t("settings.teableWorkspaceScopeAll"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.teableTabSyncLogs") }));
    await waitFor(() => {
      expect(within(dialog).getAllByText(t("settings.teableSyncLogsTitle")).length).toBeGreaterThan(0);
    });
    expect(within(dialog).getByText("本地标签变化，已同步到 Teable")).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.teableTaskState.succeeded"))).toBeInTheDocument();
  });

  it("Teable 设置弹窗可以给目标表添加字段并自动映射", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const matched = matchSkillManagementPanelRequest(url, method, init);

      if (matched) {
        return matched;
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    authStore.hydrate(createAuthSession());
    renderSettingsPage();

    await userEvent.click(await screen.findByRole("button", { name: t("settings.teableOpenSettingsAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.teableModalTitle") });
    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.teableTabTableSyncSettings") }));
    await within(dialog).findByText(t("settings.teableTableSyncListTitle"));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("settings.teableTableToAddLabel") }), "tbl_form_1");
    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.teableAddSyncTableAction") }));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("settings.teableSyncSourceLabel") }), "tags");

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.teableFieldAutoCreateAction") }));

    const fieldDialog = await screen.findByRole("dialog", { name: t("settings.teableFieldAutoCreateModalTitle") });
    expect(within(fieldDialog).getByText("标签名称")).toBeInTheDocument();
    await userEvent.click(within(fieldDialog).getByRole("button", { name: t("settings.teableFieldAutoCreateConfirmAction") }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/affairs/teable/table-fields"),
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await within(dialog).findByText(t("settings.teableFieldAutoCreateSuccess", { count: 2 }))).toBeInTheDocument();
  });

  it("Teable 设置弹窗可以保存字段映射", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const matched = matchSkillManagementPanelRequest(url, method, init);

      if (matched) {
        return matched;
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    authStore.hydrate(createAuthSession());
    renderSettingsPage();

    await userEvent.click(await screen.findByRole("button", { name: t("settings.teableOpenSettingsAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.teableModalTitle") });
    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.teableTabTableSyncSettings") }));
    await within(dialog).findByText(t("settings.teableTableSyncListTitle"));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("settings.teableTableToAddLabel") }), "tbl_form_1");
    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.teableAddSyncTableAction") }));
    expect(within(dialog).getAllByText("客户收集").length).toBeGreaterThan(0);
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("settings.teableSyncSourceLabel") }), "tags");
    const mappingSelects = await within(dialog).findAllByRole("combobox");
    await userEvent.selectOptions(mappingSelects[mappingSelects.length - 1], "fld-customer-name");
    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.teableSaveTableSyncSettingsAction") }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/affairs/teable/field-mappings"),
        expect.objectContaining({ method: "PUT" })
      );
    });
  });

  it("没有当前工作区时，Teable 设置弹窗仍然可以正常打开并展示镜像配置", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const matched = matchSkillManagementPanelRequest(url, method, init);

      if (matched) {
        return matched;
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: null,
      navigationGroups: [
        {
          workspace: {
            id: "workspace-2",
            name: "备用工作区"
          }
        }
      ]
    });

    authStore.hydrate(createAuthSession());
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: t("settings.teableOpenSettingsAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.teableModalTitle") });
    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.teableTabTableSyncSettings") }));

    expect(await within(dialog).findByText(t("settings.teableTableSyncListTitle"))).toBeInTheDocument();
    expect(within(dialog).queryByText(t("settings.teableWorkspaceScopeEmpty"))).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.teableSyncNowAction") })).toBeEnabled();
  });

  it("移动设置页可以打开插件管理弹层", async () => {
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.abilityManagement")) }));
    await userEvent.click(screen.getByRole("button", { name: t("settings.pluginManagementAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.pluginManagementModalTitle") });
    expect(within(dialog).getAllByText("演示插件").length).toBeGreaterThan(0);
  });


  it("移动设置页可以打开 Teable 设置弹层", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const matched = matchSkillManagementPanelRequest(url, method, init);

      if (matched) {
        return matched;
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    authStore.hydrate(createAuthSession());
    setViewportWidth(390);
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("settings.abilityManagement")) }));
    await userEvent.click(screen.getByRole("button", { name: t("settings.teableOpenSettingsAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.teableModalTitle") });
    expect(within(dialog).getByRole("tab", { name: t("settings.teableTabConnectionSettings") })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.teableTabTableSyncSettings") }));
    expect(await within(dialog).findByText(t("settings.teableTableSyncListTitle"))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.teableSyncNowAction") })).toBeInTheDocument();
  });

  it("插件管理弹窗里可以撤销当前工作区授权", async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole("button", { name: t("settings.pluginManagementAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.pluginManagementModalTitle") });
    await userEvent.click(await within(dialog).findByRole("button", { name: t("plugins.revokeGrantAction") }));

    expect(await screen.findByText(t("plugins.revokeGrantSuccess"))).toBeInTheDocument();
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
      autoDownloadUpdate: false,
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
      autoDownloadUpdate: false,
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

  it("桌面运行时使用移动布局时，会显示统一更新和更新选项", () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    setViewportWidth(390);

    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.updateOneClickTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.updateOptions"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.autoCheckUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.autoDownloadUpdate"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.updateCheckAll") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.updateInstallAll") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.releaseOpenPage") })).toBeInTheDocument();
    expect(screen.queryByText(t("settings.clientUpdate"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("settings.serverCheckNow") })).not.toBeInTheDocument();
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
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    setViewportWidth(390);

    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.clientUpdate"))).toBeInTheDocument();
    expect(screen.queryByText(t("settings.autoCheckUpdate"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.autoDownloadUpdate"))).not.toBeInTheDocument();

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
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    setViewportWidth(390);

    renderSettingsPage("/settings/software-update");

    expect(screen.getByText(t("settings.serverUpdate"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.clientUpdate"))).toBeInTheDocument();
    expect(screen.queryByText(t("settings.autoCheckUpdate"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.autoDownloadUpdate"))).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: t("settings.updateCheckAll") })).not.toBeInTheDocument();
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
          registeredTasks: [
            {
              taskType: "affairs.library_apply_config",
              executionLane: "helper_process",
              timeoutMs: 900000,
              concurrency: null,
              retryMaxAttempts: null,
              helperProcessHandler: "affairs.library_apply_config"
            },
            {
              taskType: "workspace.discovery",
              executionLane: "helper_process",
              timeoutMs: 30000,
              concurrency: null,
              retryMaxAttempts: null,
              helperProcessHandler: null
            }
          ],
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
    expect(screen.getByText(t("settings.parallelTaskDebugRegisteredTasksTitle"))).toBeInTheDocument();
    expect(screen.getByText("affairs.library_apply_config")).toBeInTheDocument();
    expect(
      within(dialog).getAllByText((_, element) => element?.textContent?.includes(t("settings.parallelTaskDebugTaskCategoryBuiltinIndexer")) ?? false).length
    ).toBeGreaterThan(0);
    expect(
      within(dialog).getAllByText((_, element) => element?.textContent?.includes(t("settings.parallelTaskDebugTaskRuntimeBuiltinHelper")) ?? false).length
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText("workspace.discovery")).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => element?.textContent?.includes(t("settings.parallelTaskDebugTaskTimeout")) ?? false).length).toBeGreaterThan(0);
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
            <ToastProvider>
              <MemoryRouter initialEntries={[initialEntry]}>
                <Routes>
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/:section" element={<SettingsPage />} />
                </Routes>
              </MemoryRouter>
            </ToastProvider>
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

function matchSkillManagementPanelRequest(
  url: string,
  method: string,
  init?: RequestInit
): Response | null {
  if (url.endsWith("/api/skills/overview") && method === "GET") {
    return createJsonResponse(createSkillOverviewResponse());
  }

  if (url.endsWith("/api/providers/catalog") && method === "GET") {
    return createJsonResponse({
      items: [
        {
          providerId: "codex",
          targetCli: "codex",
          displayName: "Codex",
          enabled: true
        },
        {
          providerId: "claude-code",
          targetCli: "claude-code",
          displayName: "Claude Code",
          enabled: true
        }
      ]
    });
  }

  if (url.includes("/api/office/document-templates") && method === "GET") {
    return createJsonResponse({
      items: [
        {
          id: "template-1",
          templateKey: "daily-report",
          displayName: "项目日报模板",
          templateVersion: "1.0.0",
          engine: "doct",
          status: "active",
          templateSourcePath: "/templates/daily-report.docx"
        }
      ]
    });
  }

  if (url.includes("/api/office/browser/profiles") && method === "GET") {
    return createJsonResponse({
      items: []
    });
  }

  if (url.endsWith("/api/office/browser/bridge-status") && method === "GET") {
    return createJsonResponse({
      provider: "opencli",
      availability: "ready",
      detail: null,
      checkedAt: "2026-06-03T10:00:00.000Z",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      version: "0.1.0"
    });
  }

  if (url.includes("/api/office/tasks") && method === "GET") {
    return createJsonResponse({ items: [] });
  }

  if (url.includes("/api/office/ops/targets") && method === "GET") {
    return createJsonResponse({ items: [] });
  }

  if (url.endsWith("/api/workspaces") && method === "GET") {
    return createJsonResponse({
      items: [
        {
          id: "workspace-1",
          name: "当前工作区",
          rootPath: "/tmp/workspace-1",
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z"
        }
      ]
    });
  }

  if (url.includes("/api/affairs/teable/overview") && method === "GET") {
    return createJsonResponse({
      binding: {
        binding: {
          baseUrl: "https://teable.example.com",
          spaceId: "space_demo",
          baseId: "base_demo",
          authRef: "secret://teable/main",
          enabled: true,
          mirrorMode: "manual",
          updatedAt: "2026-06-03T10:00:00.000Z"
        },
        status: "ready",
        summary: "当前事务工作台已经绑定 Teable，可继续配置推送范围和表单。",
        updatedAt: "2026-06-03T10:00:00.000Z"
      },
      syncConfigs: [
        {
          configId: "cfg-tags",
          sourceType: "tags",
          enabled: true,
          scope: { rootTagIds: ["tag-root-1"] },
          targetTableId: "tbl_tags",
          updatedAt: "2026-06-03T10:00:00.000Z"
        },
        {
          configId: "cfg-sessions",
          sourceType: "sessions",
          enabled: false,
          scope: { mode: "selected_workspaces", workspaceIds: ["workspace-1"] },
          targetTableId: null,
          updatedAt: "2026-06-03T10:00:00.000Z"
        },
        {
          configId: "cfg-todos",
          sourceType: "todos",
          enabled: true,
          scope: { includeWorkspaceTodos: true, includeAffairsTodos: true, workspaceIds: ["workspace-1"] },
          targetTableId: "tbl_todos",
          updatedAt: "2026-06-03T10:00:00.000Z"
        }
      ],
      mirrorBindings: [
        {
          mirrorType: "tags",
          tableId: "tbl_tags",
          tableName: "cn_tags",
          readOnlyMode: "unknown",
          lastSyncedAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z"
        },
        {
          mirrorType: "todos",
          tableId: "tbl_todos",
          tableName: "cn_todos",
          readOnlyMode: "unknown",
          lastSyncedAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z"
        }
      ],
      latestMirrorSyncTask: {
        taskId: "task-teable-1",
        taskType: "mirror_sync",
        state: "succeeded",
        summary: "Teable 镜像同步完成",
        lastError: null,
        updatedAt: "2026-06-03T10:01:00.000Z",
        startedAt: "2026-06-03T10:00:10.000Z",
        finishedAt: "2026-06-03T10:01:00.000Z",
        progress: null,
        result: {
          state: "succeeded",
          summary: "Teable 镜像同步完成",
          syncedMirrorTypes: ["tags", "todos"],
          failedMirrorTypes: [],
          counts: {
            tags: { created: 2, updated: 1, deleted: 0, skipped: 0 },
            sessions: { created: 0, updated: 0, deleted: 0, skipped: 0 },
            todos: { created: 3, updated: 0, deleted: 1, skipped: 0 }
          }
        }
      }
    });
  }

  if (url.endsWith("/api/affairs/teable/global-binding") && method === "GET") {
    return createJsonResponse({
      baseUrl: "https://teable.example.com",
      spaceId: "space_demo",
      baseId: "base_demo",
      authRef: "secret://teable/main",
      enabled: true,
      mirrorMode: "manual",
      updatedAt: "2026-06-03T10:00:00.000Z"
    });
  }

  if (url.includes("/api/affairs/teable/table-catalog") && method === "GET") {
    return createJsonResponse([
      { tableId: "tbl_tags", tableName: "标签镜像表" },
      { tableId: "tbl_sessions", tableName: "会话镜像表" },
      { tableId: "tbl_todos", tableName: "代办镜像表" },
      { tableId: "tbl_form_1", tableName: "客户收集" }
    ]);
  }

  if (url.includes("/api/affairs/teable/table-fields") && method === "GET") {
    const tableId = new URL(url, "http://localhost").searchParams.get("tableId");
    if (tableId === "tbl_tags") {
      return createJsonResponse([
        { fieldId: "fld-tag-name", fieldName: "标签名称", fieldType: "singleLineText", isPrimary: true },
        { fieldId: "fld-tag-path", fieldName: "标签路径", fieldType: "singleLineText", isPrimary: false }
      ]);
    }
    if (tableId === "tbl_todos") {
      return createJsonResponse([
        { fieldId: "fld-todo-title", fieldName: "标题", fieldType: "singleLineText", isPrimary: true }
      ]);
    }
    if (tableId === "tbl_form_1") {
      return createJsonResponse([
        { fieldId: "fld-customer-name", fieldName: "客户姓名", fieldType: "singleLineText", isPrimary: true },
        { fieldId: "fld-customer-phone", fieldName: "联系电话", fieldType: "singleLineText", isPrimary: false }
      ]);
    }
    return createJsonResponse([
      { fieldId: "fld-session-title", fieldName: "会话标题", fieldType: "singleLineText", isPrimary: true }
    ]);
  }

  if (url.includes("/api/affairs/teable/table-fields") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return createJsonResponse((body.fields ?? []).map((field: Record<string, unknown>, index: number) => ({
      sourceField: field.sourceField,
      targetFieldId: `fld-auto-${index + 1}`,
      targetFieldName: field.fieldName,
      required: field.required === true,
      fieldType: field.fieldType ?? "singleLineText"
    })));
  }

  if (url.includes("/api/affairs/teable/sync-logs") && method === "GET") {
    return createJsonResponse([
      {
        logId: "log-teable-1",
        triggerType: "local_change",
        sourceTypes: ["tags"],
        taskId: "task-teable-1",
        state: "succeeded",
        summary: "本地标签变化，已同步到 Teable",
        counts: {
          tags: { created: 1, updated: 0, deleted: 0, skipped: 2 }
        },
        errorDetail: null,
        reason: "tag_definition_saved:tag-root-1",
        startedAt: "2026-06-03T10:00:10.000Z",
        finishedAt: "2026-06-03T10:01:00.000Z",
        createdAt: "2026-06-03T10:00:09.000Z",
        updatedAt: "2026-06-03T10:01:00.000Z"
      }
    ]);
  }


  if (url.includes("/api/affairs/teable/field-mappings") && method === "GET") {
    return createJsonResponse({
      mappings: [
        {
          mappingId: "mapping-tags",
          configId: "cfg-tags",
          sourceType: "tags",
          targetTableId: "tbl_tags",
          items: [],
          updatedAt: "2026-06-03T10:00:00.000Z"
        },
        {
          mappingId: "mapping-todos",
          configId: "cfg-todos",
          sourceType: "todos",
          targetTableId: "tbl_todos",
          items: [],
          updatedAt: "2026-06-03T10:00:00.000Z"
        }
      ],
      sourceFieldsByType: {
        tags: [
          { key: "tagName", label: "标签名称", type: "text", required: true },
          { key: "tagPath", label: "标签路径", type: "text", required: true }
        ],
        sessions: [
          { key: "sessionTitle", label: "会话标题", type: "text", required: true }
        ],
        todos: [
          { key: "title", label: "代办标题", type: "text", required: true }
        ]
      }
    });
  }

  if (url.includes("/api/affairs/teable/field-mappings") && method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return createJsonResponse(body.items ?? []);
  }

  if (url.endsWith("/api/affairs/teable/global-binding") && method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return createJsonResponse({
      baseUrl: body.baseUrl ?? "",
      spaceId: body.spaceId ?? "",
      baseId: body.baseId ?? "",
      authRef: body.authRef ?? "",
      enabled: body.enabled === true,
      mirrorMode: body.mirrorMode ?? "manual",
      updatedAt: "2026-06-03T10:02:00.000Z"
    });
  }

  if (url.endsWith("/api/affairs/teable/workbench-sync-config") && method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return createJsonResponse(body.items ?? []);
  }

  if (url.endsWith("/api/affairs/teable/mirror-sync") && method === "POST") {
    return createJsonResponse({
      taskId: "task-teable-2",
      deduped: false,
      taskType: "mirror_sync",
      state: "queued",
      summary: "Teable 镜像同步任务已入队",
      updatedAt: "2026-06-03T10:03:00.000Z"
    });
  }

  if (url.includes("/api/workspaces/") && url.includes("/affairs/tags") && method === "GET") {
    throw new Error("Teable 设置不应该按每个工作区读取文档库标签");
  }

  if (url.includes("/api/affairs/tags") && method === "GET") {
    return createJsonResponse({
      items: [
        {
          id: "tag-root-1",
          path: "客户",
          name: "客户",
          rootType: "manual",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
          documentCount: 12,
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z"
        },
        {
          id: "tag-child-1",
          path: "客户/重点客户",
          name: "重点客户",
          rootType: "manual",
          parentId: "tag-root-1",
          parentPath: "客户",
          description: null,
          status: "active",
          documentCount: 4,
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z"
        }
      ],
      summary: {
        totalActiveTags: 2,
        totalDisabledTags: 0,
        totalRuleEnabledTags: 0,
        totalBoundDocuments: 12
      },
      status: {
        recomputeState: "idle",
        lastRecomputedAt: null,
        lastError: null
      }
    });
  }

  if (url.endsWith("/api/office/onlyoffice/settings") && method === "GET") {
    return createJsonResponse({
      enabled: true,
      serverUrl: "http://127.0.0.1:8088",
      publicBaseUrl: "http://127.0.0.1:3002",
      callbackBaseUrl: "",
      userDisplayName: "产品演示账号",
      userAvatarUrl: "https://example.com/avatar.png",
      jwtSecretConfigured: true,
      updatedAt: "2026-06-03T10:00:00.000Z"
    });
  }

  if (url.endsWith("/api/office/onlyoffice/status") && method === "GET") {
    return createJsonResponse({
      state: "ready",
      summary: "ONLYOFFICE 服务和回调地址都已通过基础检查，可以启用 Office 预览。",
      checkedAt: "2026-06-03T10:00:00.000Z",
      checks: [
        {
          key: "serverUrl",
          label: "ONLYOFFICE 服务地址",
          status: "pass",
          detail: "http://127.0.0.1:8088"
        }
      ]
    });
  }

  if (url.endsWith("/api/office/onlyoffice/settings") && method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}"));

    return createJsonResponse({
      enabled: body.enabled === true,
      serverUrl: body.serverUrl ?? null,
      publicBaseUrl: body.publicBaseUrl ?? null,
      callbackBaseUrl: body.callbackBaseUrl ?? null,
      userDisplayName: body.userDisplayName ?? null,
      userAvatarUrl: body.userAvatarUrl ?? null,
      jwtSecretConfigured: Boolean(body.jwtSecret),
      updatedAt: "2026-06-03T10:01:00.000Z"
    });
  }

  if (url.endsWith("/api/opencli/check") && method === "POST") {
    return createJsonResponse({
      ok: true,
      provider: "opencli"
    });
  }

  if (url.endsWith("/api/opencli/catalog") && method === "GET") {
    return createJsonResponse({
      version: "0.1.0",
      items: []
    });
  }

  return null;
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
