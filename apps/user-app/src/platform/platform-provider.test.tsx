import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSharedWindowRegistryStore } from "./desktop/window-registry";
import { DESKTOP_WINDOW_LIFECYCLE_EVENT } from "./desktop/window-events";
import { PlatformProvider } from "./platform-provider";

const tauriEventBridge = vi.hoisted(() => {
  const bridge = {
    handler: null as ((event: { payload: unknown }) => void) | null,
    listen: vi.fn(async (_eventName: string, handler: (event: { payload: unknown }) => void) => {
      bridge.handler = handler;
      return () => {
        if (bridge.handler === handler) {
          bridge.handler = null;
        }
      };
    })
  };

  return bridge;
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriEventBridge.listen
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onScaleChanged: vi.fn(async () => () => undefined)
  })
}));

const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");

function mockNavigator(userAgent: string, platform: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform
  });
}

function clearTitlebarVariables() {
  const keys = [
    "--desktop-macos-traffic-light-center-y",
    "--desktop-macos-traffic-light-leading-inset",
    "--desktop-macos-traffic-light-safe-zone-width",
    "--desktop-macos-titlebar-height",
    "--desktop-macos-traffic-light-button-diameter"
  ];

  for (const key of keys) {
    document.documentElement.style.removeProperty(key);
    document.body.style.removeProperty(key);
  }
}

describe("PlatformProvider", () => {
  const windowRegistry = getSharedWindowRegistryStore();

  afterEach(() => {
    vi.restoreAllMocks();
    clearTitlebarVariables();
    windowRegistry.clear();
    tauriEventBridge.handler = null;

    if (userAgentDescriptor) {
      Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
    }

    if (platformDescriptor) {
      Object.defineProperty(window.navigator, "platform", platformDescriptor);
    }

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
    } else {
      delete window.__TAURI_INTERNALS__;
    }
  });

  it("macOS 桌面端会把原生标题栏 metrics 写入 CSS 变量", async () => {
    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "MacIntel"
    );

    const invoke: NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"] = async <T,>(
      command: string
    ): Promise<T> => {
      if (command === "get_runtime_info") {
        return {
          version: "0.1.3",
          appDataDir: null,
          windowChrome: {
            macosTitlebar: {
              overlay: true,
              trafficLightCenterY: 12.5,
              trafficLightLeadingInset: 84,
              trafficLightSafeZoneWidth: 92,
              trafficLightButtonDiameter: 12,
              titlebarHeight: 30
            }
          }
        } as T;
      }

      return undefined as T;
    };

    window.__TAURI_INTERNALS__ = {
      invoke
    };

    render(
      <PlatformProvider>
        <div>platform-provider</div>
      </PlatformProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--desktop-macos-traffic-light-center-y")).toBe(
        "12.5px"
      );
      expect(document.documentElement.style.getPropertyValue("--desktop-macos-traffic-light-leading-inset")).toBe(
        "84px"
      );
    });
    expect(tauriEventBridge.listen).toHaveBeenCalledWith(
      DESKTOP_WINDOW_LIFECYCLE_EVENT,
      expect.any(Function)
    );
  });

  it("非 macOS 透明标题栏场景会清理遗留的 CSS 变量", async () => {
    document.documentElement.style.setProperty("--desktop-macos-traffic-light-center-y", "99px");
    document.body.style.setProperty("--desktop-macos-traffic-light-center-y", "99px");
    mockNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Win32"
    );
    delete window.__TAURI_INTERNALS__;

    render(
      <PlatformProvider>
        <div>platform-provider</div>
      </PlatformProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--desktop-macos-traffic-light-center-y")).toBe("");
      expect(document.body.style.getPropertyValue("--desktop-macos-traffic-light-center-y")).toBe("");
    });
  });

  it("桌面窗口生命周期事件会同步更新前端窗口注册表", async () => {
    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "MacIntel"
    );
    const invoke: NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"] = async <T,>() => {
      return {
        version: "0.1.2",
        appDataDir: null,
        windowChrome: {
          macosTitlebar: null
        }
      } as T;
    };
    window.__TAURI_INTERNALS__ = {
      invoke
    };

    render(
      <PlatformProvider>
        <div>platform-provider</div>
      </PlatformProvider>
    );

    await waitFor(() => {
      expect(tauriEventBridge.listen).toHaveBeenCalledWith(
        DESKTOP_WINDOW_LIFECYCLE_EVENT,
        expect.any(Function)
      );
    });

    tauriEventBridge.handler?.({
      payload: {
        descriptor: {
          windowId: "files-workspace-1",
          kind: "files",
          workspaceId: "workspace-1",
          sessionId: null,
          mode: "external",
          bounds: {
            x: 20,
            y: 30,
            width: 1200,
            height: 780,
            minWidth: 720,
            minHeight: 480
          },
          focusOwner: "file-context-panel"
        },
        isOpen: true
      }
    });

    await waitFor(() => {
      expect(windowRegistry.isWindowOpen("files-workspace-1")).toBe(true);
    });

    tauriEventBridge.handler?.({
      payload: {
        descriptor: {
          windowId: "files-workspace-1",
          kind: "files",
          workspaceId: "workspace-1",
          sessionId: null,
          mode: "external",
          bounds: {
            x: 28,
            y: 34,
            width: 1200,
            height: 780,
            minWidth: 720,
            minHeight: 480
          },
          focusOwner: "file-context-panel"
        },
        isOpen: false
      }
    });

    await waitFor(() => {
      expect(windowRegistry.isWindowOpen("files-workspace-1")).toBe(false);
      expect(windowRegistry.getDescriptor("files-workspace-1")?.bounds.x).toBe(28);
    });
  });
});
