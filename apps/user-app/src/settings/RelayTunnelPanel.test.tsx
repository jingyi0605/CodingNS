import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostRuntimeStore } from "../config/host-runtime-store";
import { clientConfigStore } from "../config/client-config-store";
import type { PlatformAdapter } from "../platform/platform-adapter";
import type { RelayTunnelStatusView } from "../platform/server/relay-tunnel-manager";
import { I18nProvider } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { RelayTunnelPanel } from "./RelayTunnelPanel";

const apiMocks = vi.hoisted(() => ({
  fetchRelayTunnelStatus: vi.fn(),
  updateRelayTunnelConfig: vi.fn(),
  loginRelayTunnelControl: vi.fn(),
  logoutRelayTunnelControl: vi.fn(),
  checkRelayTunnelHostLabelAvailability: vi.fn(),
  bindRelayTunnelControlHost: vi.fn(),
  enableRelayTunnel: vi.fn(),
  disableRelayTunnel: vi.fn(),
  unbindRelayTunnel: vi.fn(),
  fetchRelayTunnelTrafficWallet: vi.fn()
}));

const platformMock = vi.hoisted(() => ({
  usePlatform: vi.fn()
}));

const clipboardWriteTextMock = vi.hoisted(() => vi.fn());

const relayControlSiteConfigMocks = vi.hoisted(() => ({
  canConfigureRelayControlBaseUrl: vi.fn(),
  getFixedRelayControlBaseUrl: vi.fn(),
  resolveRelayControlBaseUrl: vi.fn(),
  safelyNormalizeRelayControlBaseUrl: vi.fn()
}));

vi.mock("../platform/server/relay-tunnel-manager", () => ({
  fetchRelayTunnelStatus: apiMocks.fetchRelayTunnelStatus,
  updateRelayTunnelConfig: apiMocks.updateRelayTunnelConfig,
  loginRelayTunnelControl: apiMocks.loginRelayTunnelControl,
  logoutRelayTunnelControl: apiMocks.logoutRelayTunnelControl,
  checkRelayTunnelHostLabelAvailability: apiMocks.checkRelayTunnelHostLabelAvailability,
  bindRelayTunnelControlHost: apiMocks.bindRelayTunnelControlHost,
  enableRelayTunnel: apiMocks.enableRelayTunnel,
  disableRelayTunnel: apiMocks.disableRelayTunnel,
  unbindRelayTunnel: apiMocks.unbindRelayTunnel,
  fetchRelayTunnelTrafficWallet: apiMocks.fetchRelayTunnelTrafficWallet
}));

vi.mock("../platform/platform-provider", () => ({
  usePlatform: platformMock.usePlatform
}));

vi.mock("../config/relay-control-site-config", () => ({
  canConfigureRelayControlBaseUrl: relayControlSiteConfigMocks.canConfigureRelayControlBaseUrl,
  getFixedRelayControlBaseUrl: relayControlSiteConfigMocks.getFixedRelayControlBaseUrl,
  resolveRelayControlBaseUrl: relayControlSiteConfigMocks.resolveRelayControlBaseUrl,
  safelyNormalizeRelayControlBaseUrl: relayControlSiteConfigMocks.safelyNormalizeRelayControlBaseUrl
}));

describe("RelayTunnelPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    platformMock.usePlatform.mockReturnValue(createPlatform());
    relayControlSiteConfigMocks.canConfigureRelayControlBaseUrl.mockReturnValue(true);
    relayControlSiteConfigMocks.getFixedRelayControlBaseUrl.mockReturnValue("https://channel.codingns.com:10247");
    relayControlSiteConfigMocks.resolveRelayControlBaseUrl.mockImplementation(
      (value: string | null | undefined) => value?.trim() || "https://channel.codingns.com:10247"
    );
    relayControlSiteConfigMocks.safelyNormalizeRelayControlBaseUrl.mockImplementation(
      (value: string | null | undefined) => value?.trim() || null
    );
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-relay",
      hosts: [
        {
          id: "host-relay",
          name: "Demo Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          relayTunnel: null
        }
      ],
      discoveredHosts: [],
      activeDiscoveredHostId: null,
      localHostDiscovery: {
        status: "idle",
        lastScannedAt: null,
        cooldownUntil: null,
        errorCode: null,
        errorDetail: null
      },
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
  });

  it("会显示剩余流量和最近错误原因", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: true,
        bindingId: "binding_demo",
        accountId: "acct_demo",
        phase: "quota_exhausted",
        tunnelDomain: "demo.channel.codingns.com",
        trafficRemainingBytes: "0",
        lastError: "该账号的公共隧道流量已经耗尽"
      })
    );

    renderPanel();

    expect(await screen.findByText("远程访问已开启")).toBeInTheDocument();
    expect(screen.getAllByText("0 B")).toHaveLength(2);
    expect(screen.getByText("最近错误：该账号的公共隧道流量已经耗尽")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注销设备" })).toBeInTheDocument();
  });

  it("调试环境会显示服务地址，并允许保存", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(createStatus());
    apiMocks.updateRelayTunnelConfig.mockResolvedValue(
      createStatus({
        controlBaseUrl: "https://channel.codingns.com:4443"
      })
    );

    renderPanel();

    const addressInput = await screen.findByRole("textbox", { name: "服务地址" });
    expect(addressInput).toHaveValue("https://channel.codingns.com:10247");

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "https://channel.codingns.com:4443");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(apiMocks.updateRelayTunnelConfig).toHaveBeenCalledWith({
        controlBaseUrl: "https://channel.codingns.com:4443"
      });
    });
  });

  it("正式包会隐藏服务地址输入，并通过服务端接口登录控制站", async () => {
    relayControlSiteConfigMocks.canConfigureRelayControlBaseUrl.mockReturnValue(false);
    relayControlSiteConfigMocks.resolveRelayControlBaseUrl.mockReturnValue(
      "https://channel.codingns.com:10247"
    );
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(createStatus());
    apiMocks.loginRelayTunnelControl.mockResolvedValue(
      createStatus({
        activated: true,
        controlAccountEmail: "demo@example.com",
        controlSessionExpiresAt: "2026-04-21T00:00:00.000Z"
      })
    );
    apiMocks.fetchRelayTunnelTrafficWallet.mockResolvedValue({
      wallet: {
        accountId: "acct_demo",
        grantedBytes: "524288000",
        usedBytes: "1024",
        remainingBytes: "524286976",
        exhausted: false,
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    });

    renderPanel();

    expect(await screen.findByRole("textbox", { name: "邮箱" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "服务地址" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "邮箱" }), "demo@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(apiMocks.loginRelayTunnelControl).toHaveBeenCalledWith({
        email: "demo@example.com",
        password: "password123"
      });
    });

    expect(await screen.findByText("当前已登录：demo@example.com")).toBeInTheDocument();
  });

  it("状态读取失败时会在向导顶部显示可重试错误提示", async () => {
    apiMocks.fetchRelayTunnelStatus
      .mockRejectedValueOnce(
        new ApiError(0, {
          detail: "请求 http://127.0.0.1:3002/api/system/relay-tunnel/status 失败：Failed to fetch",
          error_code: "NETWORK_ERROR"
        })
      )
      .mockResolvedValueOnce(createStatus());

    renderPanel();

    expect(await screen.findByText("暂时无法读取远程访问状态")).toBeInTheDocument();
    expect(
      screen.getByText("当前连不上这台 Host（http://127.0.0.1:3002），远程访问状态可能不是最新的。请先确认服务器地址、端口和网络连接。")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "重新尝试" }));

    await waitFor(() => {
      expect(apiMocks.fetchRelayTunnelStatus).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText("暂时无法读取远程访问状态")).not.toBeInTheDocument();
    });
  });

  it("登录失败时会在登录步骤内保留明确错误，并且不清空已输入内容", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(createStatus());
    apiMocks.loginRelayTunnelControl.mockRejectedValue(
      new ApiError(0, {
        detail: "请求 http://127.0.0.1:3002/api/system/relay-tunnel/control/login 失败：Failed to fetch",
        error_code: "NETWORK_ERROR"
      })
    );

    renderPanel();

    const emailInput = await screen.findByRole("textbox", { name: "邮箱" });
    const passwordInput = screen.getByLabelText("密码");
    await userEvent.type(emailInput, "demo@example.com");
    await userEvent.type(passwordInput, "password123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("登录账号失败")).toBeInTheDocument();
    expect(
      screen.getByText("登录请求没有发出去，因为当前连不上这台 Host（http://127.0.0.1:3002）。请先确认服务器地址和网络连接，再重新尝试。")
    ).toBeInTheDocument();
    expect(emailInput).toHaveValue("demo@example.com");
    expect(passwordInput).toHaveValue("password123");
  });

  it("控制站拒绝访问时会直接显示带地址的后端错误", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        controlBaseUrl: "https://channel.jacksonz.cn:14441"
      })
    );
    apiMocks.loginRelayTunnelControl.mockRejectedValue(
      new ApiError(403, {
        detail:
          "控制站登录失败：控制站 https://channel.jacksonz.cn:14441 拒绝了这次请求（HTTP 403）。 请确认这是正确的控制站地址，并检查账号、密码或访问权限。 详情：invalid email or password",
        error_code: "RELAY_TUNNEL_CONTROL_ACCESS_DENIED"
      })
    );

    renderPanel();

    await userEvent.type(await screen.findByRole("textbox", { name: "邮箱" }), "demo@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("登录账号失败")).toBeInTheDocument();
    expect(
      screen.getByText(
        "控制站登录失败：控制站 https://channel.jacksonz.cn:14441 拒绝了这次请求（HTTP 403）。 请确认这是正确的控制站地址，并检查账号、密码或访问权限。 详情：invalid email or password"
      )
    ).toBeInTheDocument();
  });

  it("登录后会先检查主机名，再显示公开访问地址", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true,
        controlBaseUrl: "https://channel.codingns.com:1443"
      })
    );
    apiMocks.loginRelayTunnelControl.mockResolvedValue(
      createStatus({
        activated: true,
        controlBaseUrl: "https://channel.codingns.com:10247",
        controlAccountEmail: "demo@example.com",
        controlSessionExpiresAt: "2026-04-21T00:00:00.000Z"
      })
    );
    apiMocks.fetchRelayTunnelTrafficWallet.mockResolvedValue({
      wallet: {
        accountId: "acct_demo",
        grantedBytes: "524288000",
        usedBytes: "1024",
        remainingBytes: "524286976",
        exhausted: false,
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    });
    apiMocks.checkRelayTunnelHostLabelAvailability.mockResolvedValue({
      hostLabel: "MacMini",
      tunnelDomain: "macmini.channel.codingns.com",
      available: true,
      reason: "available"
    });

    renderPanel();

    await screen.findByText("远程访问向导");
    await userEvent.type(screen.getByRole("textbox", { name: "邮箱" }), "demo@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("textbox", { name: "Host 名称" })).toBeInTheDocument();
    expect(screen.getByText(".channel.codingns.com")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Host 名称" }), "MacMini");
    await userEvent.click(screen.getByRole("button", { name: "检查名称" }));

    await waitFor(() => {
      expect(apiMocks.checkRelayTunnelHostLabelAvailability).toHaveBeenCalledWith({
        hostLabel: "MacMini"
      });
    });

    expect(
      await screen.findByText("名称可用，公开访问地址将会是 https://macmini.channel.codingns.com:10247")
    ).toBeInTheDocument();
  });

  it("调试环境启动隧道时会继续使用调试服务里配置的地址", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(createStatus());
    apiMocks.updateRelayTunnelConfig.mockResolvedValue(
      createStatus({
        activated: true,
        controlBaseUrl: "https://channel.codingns.com:4443"
      })
    );
    apiMocks.loginRelayTunnelControl.mockResolvedValue(
      createStatus({
        activated: true,
        controlBaseUrl: "https://channel.codingns.com:4443",
        controlAccountEmail: "demo@example.com",
        controlSessionExpiresAt: "2026-04-21T00:00:00.000Z"
      })
    );
    apiMocks.fetchRelayTunnelTrafficWallet.mockResolvedValue({
      wallet: {
        accountId: "acct_demo",
        grantedBytes: "524288000",
        usedBytes: "1024",
        remainingBytes: "524286976",
        exhausted: false,
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    });
    apiMocks.checkRelayTunnelHostLabelAvailability.mockResolvedValue({
      hostLabel: "MacMini",
      tunnelDomain: "macmini.channel.codingns.com",
      available: true,
      reason: "available"
    });
    apiMocks.bindRelayTunnelControlHost.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: false,
        accountId: "acct_demo",
        controlAccountEmail: "demo@example.com",
        bindingId: "binding_demo",
        tunnelDomain: "macmini.channel.codingns.com",
        controlBaseUrl: "https://channel.codingns.com:4443"
      })
    );
    apiMocks.enableRelayTunnel.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: true,
        accountId: "acct_demo",
        controlAccountEmail: "demo@example.com",
        bindingId: "binding_demo",
        tunnelDomain: "macmini.channel.codingns.com",
        controlBaseUrl: "https://channel.codingns.com:4443"
      })
    );

    renderPanel();

    const addressInput = await screen.findByRole("textbox", { name: "服务地址" });
    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "https://channel.codingns.com:4443");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await userEvent.type(await screen.findByRole("textbox", { name: "邮箱" }), "demo@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Host 名称" }), "MacMini");
    await userEvent.click(screen.getByRole("button", { name: "检查名称" }));

    expect(
      await screen.findByText("名称可用，公开访问地址将会是 https://macmini.channel.codingns.com:4443")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "启动隧道" }));

    await waitFor(() => {
      expect(apiMocks.bindRelayTunnelControlHost).toHaveBeenCalledWith({
        hostLabel: "MacMini"
      });
      expect(apiMocks.enableRelayTunnel).toHaveBeenCalledTimes(1);
    });
  });

  it("完成后会通过服务端会话拉取流量信息，并支持退出登录", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: true,
        accountId: "acct_demo",
        controlAccountEmail: "demo@example.com",
        controlSessionExpiresAt: "2026-04-21T00:00:00.000Z",
        bindingId: "binding_demo",
        tunnelDomain: "demo.channel.codingns.com",
        controlBaseUrl: "https://channel.codingns.com:10247"
      })
    );
    apiMocks.fetchRelayTunnelTrafficWallet.mockResolvedValue({
      wallet: {
        accountId: "acct_demo",
        grantedBytes: "524288000",
        usedBytes: "2048",
        remainingBytes: "524285952",
        exhausted: false,
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    });

    renderPanel();

    expect(await screen.findByText("远程访问已开启")).toBeInTheDocument();

    await waitFor(() => {
      expect(apiMocks.fetchRelayTunnelTrafficWallet).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByText("500.0 MB")).toHaveLength(2);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注销设备" })).toBeInTheDocument();
  });

  it("远程访问地址支持复制并直接打开页面", async () => {
    const platform = createPlatform();
    platformMock.usePlatform.mockReturnValue(platform);
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: true,
        accountId: "acct_demo",
        controlAccountEmail: "demo@example.com",
        controlSessionExpiresAt: "2026-04-21T00:00:00.000Z",
        bindingId: "binding_demo",
        tunnelDomain: "test12344.channel.jacksonz.cn",
        controlBaseUrl: "https://channel.jacksonz.cn:1443"
      })
    );
    apiMocks.fetchRelayTunnelTrafficWallet.mockResolvedValue({
      wallet: {
        accountId: "acct_demo",
        grantedBytes: "21474836480",
        usedBytes: "263297024",
        remainingBytes: "21211539456",
        exhausted: false,
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    });

    renderPanel();

    const accessUrl = "https://test12344.channel.jacksonz.cn:1443";
    expect(await screen.findByText(accessUrl)).toHaveAttribute("title", accessUrl);

    await userEvent.click(screen.getByRole("button", { name: "复制地址" }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(accessUrl);
    });
    expect(await screen.findByText("访问地址已复制。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "打开页面" }));

    await waitFor(() => {
      expect(platform.bridge.openExternal).toHaveBeenCalledWith(accessUrl);
    });
  });

  it("连接设置右侧的了解按钮会打开隧道站点", async () => {
    const platform = createPlatform();
    platformMock.usePlatform.mockReturnValue(platform);
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true
      })
    );

    renderPanel();

    await screen.findByText("远程访问向导");
    await userEvent.click(screen.getByRole("button", { name: "了解隧道服务" }));

    await waitFor(() => {
      expect(platform.bridge.openExternal).toHaveBeenCalledWith(
        "https://channel.codingns.com:10247"
      );
    });
  });

  it("远程访问已开启后会展示当前客户端链路和实际访问地址", async () => {
    const getStateSpy = vi.spyOn(hostRuntimeStore, "getState").mockReturnValue({
      epoch: 1,
      activeHostId: "host-relay",
      connectionSignature: "relay",
      candidateProbeSignature: "ready",
      candidateProbePhase: "ready",
      candidateProbeStartedAt: "2026-04-21T00:00:00.000Z",
      candidateProbeFinishedAt: "2026-04-21T00:00:01.000Z",
      candidateEndpoints: [
        {
          endpointId: "host_reported:http://192.168.50.8:3002",
          kind: "lan",
          url: "http://192.168.50.8:3002",
          priority: 200,
          expiresAt: null,
          source: "host_reported",
          status: "verified",
          checkedAt: "2026-04-21T00:00:01.000Z",
          errorCode: null,
          errorDetail: null,
          responseHostBaseUrl: "http://192.168.50.8:3002",
          responseBindingId: "binding_demo",
          responseHostFingerprint: "SHA256:demo"
        }
      ],
      preferredCandidateEndpointId: "host_reported:http://192.168.50.8:3002",
      preferredDirectCandidateEndpointId: "host_reported:http://192.168.50.8:3002"
    });
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: true,
        bindingId: "binding_demo",
        tunnelDomain: "demo.channel.codingns.com",
        hostFingerprint: "SHA256:demo"
      })
    );

    renderPanel();

    expect(await screen.findByText("当前客户端链路")).toBeInTheDocument();
    expect(screen.getByText("局域网直连")).toBeInTheDocument();
    expect(screen.getByText("当前客户端地址")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.50.8:3002")).toBeInTheDocument();
    expect(
      screen.getByText("当前客户端已经切到局域网直连，这条链路更省流量；远程访问地址仍然可以继续给外部设备使用。")
    ).toBeInTheDocument();

    getStateSpy.mockRestore();
  });
});

function renderPanel() {
  return render(
    <I18nProvider language="zh-CN">
      <ThemeProvider>
        <ToastProvider>
          <RelayTunnelPanel />
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

function createStatus(overrides?: Partial<RelayTunnelStatusView>): RelayTunnelStatusView {
  return {
    activated: false,
    enabled: false,
    provider: "codingns_relay",
    relayBaseUrl: "https://channel.codingns.com:10247/relay",
    controlBaseUrl: "https://channel.codingns.com:10247",
    controlAccountEmail: null,
    controlSessionExpiresAt: null,
    accountId: null,
    tunnelDomain: null,
    bindingId: null,
    hostPublicKey: null,
    hostKeyFingerprint: "SHA256:demo",
    localTargetBaseUrl: "http://127.0.0.1:3002",
    candidateEndpoints: [
      {
        endpointId: "host_reported:http://127.0.0.1:3002",
        kind: "loopback",
        url: "http://127.0.0.1:3002",
        priority: 100,
        expiresAt: null,
        source: "host_reported"
      }
    ],
    phase: "disabled",
    connected: false,
    hostFingerprint: null,
    trafficUsedBytes: "0",
    trafficRemainingBytes: "0",
    quotaResetAt: null,
    lastError: null,
    observedAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
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
      openExternal: vi.fn(async () => ({ ok: true })),
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
