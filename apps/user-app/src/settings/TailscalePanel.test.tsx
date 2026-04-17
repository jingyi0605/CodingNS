import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TailscaleStatusView } from "../platform/server/tailscale-manager";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { I18nProvider } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import { ThemeProvider } from "../shared/theme";
import { TailscalePanel } from "./TailscalePanel";

const apiMocks = vi.hoisted(() => ({
  fetchTailscaleStatus: vi.fn(),
  updateTailscaleConfig: vi.fn(),
  enableTailscale: vi.fn(),
  disableTailscale: vi.fn(),
  loginTailscale: vi.fn(),
  logoutTailscale: vi.fn()
}));

const platformMock = vi.hoisted(() => ({
  usePlatform: vi.fn()
}));

vi.mock("../platform/server/tailscale-manager", () => ({
  fetchTailscaleStatus: apiMocks.fetchTailscaleStatus,
  updateTailscaleConfig: apiMocks.updateTailscaleConfig,
  enableTailscale: apiMocks.enableTailscale,
  disableTailscale: apiMocks.disableTailscale,
  loginTailscale: apiMocks.loginTailscale,
  logoutTailscale: apiMocks.logoutTailscale
}));

vi.mock("../platform/platform-provider", () => ({
  usePlatform: platformMock.usePlatform
}));

describe("TailscalePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.usePlatform.mockReturnValue(createPlatform());
  });

  it("会加载实例级 Tailscale 状态并以紧凑摘要展示核心信息", async () => {
    apiMocks.fetchTailscaleStatus.mockResolvedValue(
      createStatus({
        enabled: true,
        phase: "needs_login",
        loginUrl: "https://login.tailscale.test/device/abc",
        accountName: "user@example.com",
        tailnetFqdn: "codingns.test.ts.net",
        tailnetIpv4: "100.64.0.10",
        tailnetIpv6: "fd7a:115c:a1e0::10",
        reachableBaseUrl: "http://codingns.test.ts.net:4174"
      })
    );

    renderPanel();

    expect(await screen.findByRole("button", { name: "Configure" })).toBeInTheDocument();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    expect(
      await screen.findAllByText((_, element) => element?.textContent?.includes("Waiting for login") ?? false)
    ).not.toHaveLength(0);
    expect(screen.getByText("http://codingns.test.ts.net:4174")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("100.64.0.10 / fd7a:115c:a1e0::10")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Control Server" })).not.toBeInTheDocument();
    expect(screen.queryByText("codingns.test.ts.net")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Configure" }));

    expect(await screen.findByRole("textbox", { name: "Control Server" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Hostname" })).toBeInTheDocument();
    expect(screen.queryByText("Tailnet FQDN")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://login.tailscale.test/device/abc" })
    ).toHaveAttribute("href", "https://login.tailscale.test/device/abc");
  });

  it("会先保存配置，再执行启用和绑定动作", async () => {
    apiMocks.fetchTailscaleStatus.mockResolvedValue(createStatus());
    apiMocks.updateTailscaleConfig.mockResolvedValue(
      createStatus({
        controlServerUrl: "https://headscale.example.com",
        hostname: "codingns-host"
      })
    );
    apiMocks.enableTailscale.mockResolvedValue(
      createStatus({
        enabled: true,
        controlServerUrl: "https://headscale.example.com",
        hostname: "codingns-host",
        phase: "needs_login"
      })
    );
    apiMocks.loginTailscale.mockResolvedValue(
      createStatus({
        enabled: true,
        controlServerUrl: "https://headscale.example.com",
        hostname: "codingns-host",
        phase: "needs_login",
        loginUrl: "https://login.tailscale.test/device/xyz"
      })
    );

    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Configure" }));

    expect(await screen.findByRole("dialog", { name: "Configure Tailscale" })).toBeInTheDocument();

    const controlServerInput = await screen.findByRole("textbox", {
      name: "Control Server"
    });
    const hostnameInput = screen.getByRole("textbox", {
      name: "Hostname"
    });

    await userEvent.type(controlServerInput, "https://headscale.example.com");
    await userEvent.type(hostnameInput, "codingns-host");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiMocks.updateTailscaleConfig).toHaveBeenCalledWith({
        controlServerUrl: "https://headscale.example.com",
        hostname: "codingns-host"
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Configure Tailscale" })).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Enable Tailscale" }));
    expect(apiMocks.enableTailscale).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Bind Account" }));

    await waitFor(() => {
      expect(apiMocks.loginTailscale).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByRole("link", { name: "https://login.tailscale.test/device/xyz" })
    ).toBeInTheDocument();
  });

  it("接口失败时会展示错误信息", async () => {
    apiMocks.fetchTailscaleStatus.mockRejectedValue(
      new ApiError(500, {
        detail: "tailscale exploded",
        error_code: "tailscale_failed"
      })
    );

    renderPanel();

    expect(await screen.findByText("tailscale exploded")).toBeInTheDocument();
  });

  it("刷新状态后会更新外部访问地址", async () => {
    apiMocks.fetchTailscaleStatus
      .mockResolvedValueOnce(
        createStatus({
          enabled: true,
          phase: "starting"
        })
      )
      .mockResolvedValueOnce(
        createStatus({
          enabled: true,
          phase: "running",
          accountName: "user@example.com",
          reachableBaseUrl: "http://codingns.tailnet.ts.net:4174",
          tailnetFqdn: "codingns.tailnet.ts.net",
          tailnetIpv4: "100.64.0.10"
        })
      );

    renderPanel();

    expect(await screen.findAllByText("Unavailable")).not.toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("http://codingns.tailnet.ts.net:4174")).toBeInTheDocument();
    });
  });

  it("CLI 不可用时会显示安装入口，并在安装后自动重新检测", async () => {
    apiMocks.fetchTailscaleStatus
      .mockResolvedValueOnce(
        createStatus({
          enabled: false,
          phase: "error",
          lastError: "未发现 Tailscale CLI。请先安装 Tailscale，或通过 CODINGNS_TAILSCALE_COMMAND 指定命令路径。"
        })
      )
      .mockResolvedValueOnce(
        createStatus({
          enabled: true,
          phase: "running",
          accountName: "user@example.com",
          reachableBaseUrl: "http://codingns.tailnet.ts.net:4174",
          tailnetIpv4: "100.64.0.10"
        })
      );
    const openExternal = vi.fn().mockResolvedValue({ ok: true });
    platformMock.usePlatform.mockReturnValue(createPlatform({
      ui: { osFamily: "macos" } as Partial<PlatformAdapter["ui"]>,
      bridge: { openExternal } as Partial<PlatformAdapter["bridge"]>
    }));

    renderPanel();

    await screen.findByText("未发现 Tailscale CLI。请先安装 Tailscale，或通过 CODINGNS_TAILSCALE_COMMAND 指定命令路径。");

    await userEvent.click(screen.getByRole("button", { name: "Install Tailscale" }));

    expect(openExternal).toHaveBeenCalledWith("https://tailscale.com/download/mac");

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(screen.getByText("http://codingns.tailnet.ts.net:4174")).toBeInTheDocument();
    });
  });
});

function renderPanel() {
  return render(
    <I18nProvider language="zh-CN">
      <ThemeProvider>
        <TailscalePanel />
      </ThemeProvider>
    </I18nProvider>
  );
}

function createStatus(overrides?: Partial<TailscaleStatusView>): TailscaleStatusView {
  return {
    enabled: false,
    controlServerUrl: null,
    hostname: null,
    phase: "disabled",
    connected: false,
    loginUrl: null,
    accountName: null,
    tailnetFqdn: null,
    tailnetIpv4: null,
    tailnetIpv6: null,
    reachableBaseUrl: null,
    lastError: null,
    observedAt: "2026-04-14T15:00:00.000Z",
    updatedAt: "2026-04-14T15:00:00.000Z",
    ...overrides
  };
}

function createPlatform(
  overrides?: Omit<Partial<PlatformAdapter>, "ui" | "bridge"> & {
    ui?: Partial<PlatformAdapter["ui"]>;
    bridge?: Partial<PlatformAdapter["bridge"]>;
  }
): PlatformAdapter {
  const base: PlatformAdapter = {
    platform: "web",
    isDesktop: false,
    isWeb: true,
    isMobile: false,
    isNativeMobile: false,
    viewportClass: "expanded",
    ui: {
      osFamily: "windows",
      windowControlsStyle: "none",
      prefersDesktopChrome: false,
      prefersOverlayTitlebar: false,
      prefersSystemFontStack: true
    },
    bridge: {
      supported: false,
      openExternal: async () => ({ ok: true }),
      showNotification: async () => ({ ok: true }),
      writeClipboardText: async () => ({ ok: true }),
      setWindowState: async () => ({ ok: true }),
      readDesktopConfig: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      writeDesktopConfig: async () => ({ ok: true }),
      scanLocalHosts: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      getRuntimeInfo: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      checkForUpdate: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      installUpdate: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      getAndroidRuntimeInfo: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      installAndroidUpdate: async () => ({ ok: false, status: "failed", detail: "x" }),
      rollbackToPreviousVersion: async () => ({ ok: true }),
      pickDirectory: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      createWindow: async () => ({ ok: true }),
      closeWindow: async () => ({ ok: true }),
      focusWindow: async () => ({ ok: true }),
      listWindows: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      isWindowOpen: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      getWindowDescriptor: async () => ({ ok: false, errorCode: "x", detail: "x" }),
      syncWindowDescriptor: async () => ({ ok: true }),
      updateWindowBounds: async () => ({ ok: true }),
      syncNativeSidebarLayout: async () => ({ ok: true })
    },
    windows: {
      subscribe: () => () => undefined,
      getState: () => ({
        descriptors: {},
        openWindowIds: [],
        lastActiveWindowId: null
      }),
      registerDescriptor: (descriptor) => descriptor,
      updateDescriptor: () => null,
      getDescriptor: () => null,
      getWindows: () => [],
      markWindowOpen: () => false,
      markWindowClosed: () => false,
      isWindowOpen: () => false,
      removeWindow: () => false,
      clear: () => undefined
    },
    haptics: {
      supported: false,
      trigger: async () => undefined
    }
  };

  return {
    ...base,
    ...overrides,
    ui: {
      ...base.ui,
      ...(overrides?.ui ?? {})
    } as PlatformAdapter["ui"],
    bridge: {
      ...base.bridge,
      ...(overrides?.bridge ?? {})
    } as PlatformAdapter["bridge"]
  };
}
