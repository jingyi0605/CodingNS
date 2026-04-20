import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import type { PlatformAdapter } from "../platform/platform-adapter";
import type { RelayTunnelStatusView } from "../platform/server/relay-tunnel-manager";
import { I18nProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { RelayTunnelPanel } from "./RelayTunnelPanel";

const apiMocks = vi.hoisted(() => ({
  fetchRelayTunnelStatus: vi.fn(),
  ensureRelayTunnelIdentity: vi.fn(),
  updateRelayTunnelConfig: vi.fn(),
  loginRelayControlByEmail: vi.fn(),
  bindRelayControlHost: vi.fn(),
  bindRelayTunnelHost: vi.fn(),
  enableRelayTunnel: vi.fn(),
  disableRelayTunnel: vi.fn(),
  unbindRelayTunnel: vi.fn(),
  fetchRelayTrafficWallet: vi.fn(),
  fetchRelayTrafficPackages: vi.fn(),
  fetchRelayTrafficOrders: vi.fn(),
  createRelayCheckoutSession: vi.fn()
}));

const platformMock = vi.hoisted(() => ({
  usePlatform: vi.fn()
}));

vi.mock("../platform/server/relay-tunnel-manager", () => ({
  fetchRelayTunnelStatus: apiMocks.fetchRelayTunnelStatus,
  ensureRelayTunnelIdentity: apiMocks.ensureRelayTunnelIdentity,
  updateRelayTunnelConfig: apiMocks.updateRelayTunnelConfig,
  loginRelayControlByEmail: apiMocks.loginRelayControlByEmail,
  bindRelayControlHost: apiMocks.bindRelayControlHost,
  bindRelayTunnelHost: apiMocks.bindRelayTunnelHost,
  enableRelayTunnel: apiMocks.enableRelayTunnel,
  disableRelayTunnel: apiMocks.disableRelayTunnel,
  unbindRelayTunnel: apiMocks.unbindRelayTunnel,
  fetchRelayTrafficWallet: apiMocks.fetchRelayTrafficWallet,
  fetchRelayTrafficPackages: apiMocks.fetchRelayTrafficPackages,
  fetchRelayTrafficOrders: apiMocks.fetchRelayTrafficOrders,
  createRelayCheckoutSession: apiMocks.createRelayCheckoutSession
}));

vi.mock("../platform/platform-provider", () => ({
  usePlatform: platformMock.usePlatform
}));

describe("RelayTunnelPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.usePlatform.mockReturnValue(createPlatform());
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

  it("会显示剩余流量、超额状态和最近错误原因", async () => {
    apiMocks.fetchRelayTunnelStatus.mockResolvedValue(
      createStatus({
        activated: true,
        enabled: true,
        phase: "quota_exhausted",
        tunnelDomain: "demo.channel.codingns.com",
        trafficRemainingBytes: "0",
        lastError: "该账号的公共隧道流量已经耗尽"
      })
    );

    renderPanel();

    expect(await screen.findByText("流量耗尽")).toBeInTheDocument();
    expect(screen.getByText("0 B")).toBeInTheDocument();
    expect(screen.getByText("最近错误：该账号的公共隧道流量已经耗尽")).toBeInTheDocument();
  });
});

function renderPanel() {
  return render(
    <I18nProvider language="zh-CN">
      <ThemeProvider>
        <RelayTunnelPanel />
      </ThemeProvider>
    </I18nProvider>
  );
}

function createStatus(overrides?: Partial<RelayTunnelStatusView>): RelayTunnelStatusView {
  return {
    activated: false,
    enabled: false,
    provider: "codingns_relay",
    relayBaseUrl: "wss://relay.example.com",
    controlBaseUrl: "https://channel.codingns.com",
    accountId: null,
    tunnelDomain: null,
    bindingId: null,
    hostPublicKey: null,
    hostKeyFingerprint: "SHA256:demo",
    localTargetBaseUrl: "http://127.0.0.1:3002",
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
