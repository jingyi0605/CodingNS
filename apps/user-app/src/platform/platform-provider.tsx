import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { MacOsTitlebarMetrics } from "../config/client-config-types";
import { installCodingNSDesktopBridge } from "./desktop/codingns-desktop-bridge";
import {
  DESKTOP_WINDOW_LIFECYCLE_EVENT,
  type DesktopWindowLifecycleEventPayload
} from "./desktop/window-events";
import { installMacOsCopyShortcutFallback } from "./desktop/copy-shortcut-fallback";
import { createPlatformAdapter, type PlatformAdapter } from "./platform-adapter";

const PlatformContext = createContext<PlatformAdapter | null>(null);
const MACOS_TITLEBAR_STYLE_KEYS = [
  "--desktop-macos-traffic-light-center-y",
  "--desktop-macos-traffic-light-leading-inset",
  "--desktop-macos-traffic-light-safe-zone-width",
  "--desktop-macos-titlebar-height",
  "--desktop-macos-traffic-light-button-diameter"
] as const;

function applyPlatformDatasets(adapter: PlatformAdapter) {
  if (typeof document === "undefined") {
    return;
  }

  const { documentElement, body } = document;

  documentElement.dataset.runtimePlatform = adapter.platform;
  documentElement.dataset.osFamily = adapter.ui.osFamily;
  documentElement.dataset.windowControls = adapter.ui.windowControlsStyle;
  documentElement.dataset.viewportClass = adapter.viewportClass;
  documentElement.dataset.overlayTitlebar = String(adapter.ui.prefersOverlayTitlebar);

  if (body) {
    body.dataset.runtimePlatform = adapter.platform;
    body.dataset.osFamily = adapter.ui.osFamily;
    body.dataset.windowControls = adapter.ui.windowControlsStyle;
    body.dataset.viewportClass = adapter.viewportClass;
    body.dataset.overlayTitlebar = String(adapter.ui.prefersOverlayTitlebar);
  }
}

function clearMacOsTitlebarVariables() {
  if (typeof document === "undefined") {
    return;
  }

  for (const key of MACOS_TITLEBAR_STYLE_KEYS) {
    document.documentElement.style.removeProperty(key);
    document.body?.style.removeProperty(key);
  }
}

function applyMacOsTitlebarVariables(metrics: MacOsTitlebarMetrics | null | undefined) {
  if (typeof document === "undefined") {
    return;
  }

  if (!metrics) {
    clearMacOsTitlebarVariables();
    return;
  }

  const targets = [document.documentElement, document.body].filter(
    (node): node is HTMLElement => Boolean(node)
  );
  const styleEntries: Array<[typeof MACOS_TITLEBAR_STYLE_KEYS[number], string]> = [
    ["--desktop-macos-traffic-light-center-y", `${metrics.trafficLightCenterY}px`],
    ["--desktop-macos-traffic-light-leading-inset", `${metrics.trafficLightLeadingInset}px`],
    ["--desktop-macos-traffic-light-safe-zone-width", `${metrics.trafficLightSafeZoneWidth}px`],
    ["--desktop-macos-titlebar-height", `${metrics.titlebarHeight}px`],
    ["--desktop-macos-traffic-light-button-diameter", `${metrics.trafficLightButtonDiameter}px`]
  ];

  for (const target of targets) {
    for (const [key, value] of styleEntries) {
      target.style.setProperty(key, value);
    }
  }
}

function readViewportWidth() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.innerWidth;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [viewportWidth, setViewportWidth] = useState<number | undefined>(() => readViewportWidth());
  const adapter = useMemo(
    () => createPlatformAdapter({ viewportWidth }),
    [viewportWidth]
  );

  useEffect(() => {
    installCodingNSDesktopBridge();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    applyPlatformDatasets(adapter);
  }, [adapter]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    if (!adapter.isDesktop || adapter.ui.osFamily !== "macos" || !adapter.bridge.supported) {
      return;
    }

    return installMacOsCopyShortcutFallback({
      window,
      document,
      writeClipboardText: async (text) => {
        const result = await adapter.bridge.writeClipboardText(text);
        return result.ok;
      }
    });
  }, [adapter]);

  useEffect(() => {
    return () => {
      clearMacOsTitlebarVariables();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenWindowLifecycle: (() => void) | null = null;

    if (!adapter.isDesktop || !adapter.bridge.supported) {
      return () => {
        disposed = true;
      };
    }

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const unlisten = await listen<DesktopWindowLifecycleEventPayload>(
          DESKTOP_WINDOW_LIFECYCLE_EVENT,
          (event) => {
            const payload = event.payload;
            const descriptor = payload?.descriptor;

            if (!descriptor?.windowId) {
              return;
            }

            adapter.windows.registerDescriptor(descriptor);

            if (payload.isOpen) {
              adapter.windows.markWindowOpen(descriptor.windowId);
            } else {
              adapter.windows.markWindowClosed(descriptor.windowId);
            }
          }
        );

        if (disposed) {
          unlisten();
          return;
        }

        unlistenWindowLifecycle = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlistenWindowLifecycle?.();
    };
  }, [adapter]);

  useEffect(() => {
    let disposed = false;
    let unlistenScaleChanged: (() => void) | null = null;

    async function refreshMacOsTitlebarMetrics() {
      const runtimeResult = await adapter.bridge.getRuntimeInfo();

      if (disposed) {
        return;
      }

      applyMacOsTitlebarVariables(runtimeResult.ok ? runtimeResult.value?.windowChrome?.macosTitlebar : null);
    }

    if (!adapter.isDesktop || adapter.ui.osFamily !== "macos" || !adapter.ui.prefersOverlayTitlebar) {
      clearMacOsTitlebarVariables();
      return () => {
        disposed = true;
      };
    }

    void refreshMacOsTitlebarMetrics();

    // macOS 从一块屏拖到另一块屏时，scale factor 可能变化；这时必须重新读原生坐标。
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const unlisten = await getCurrentWindow().onScaleChanged(() => {
          void refreshMacOsTitlebarMetrics();
        });

        if (disposed) {
          unlisten();
          return;
        }

        unlistenScaleChanged = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlistenScaleChanged?.();
    };
  }, [adapter]);

  return <PlatformContext.Provider value={adapter}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  return context ?? createPlatformAdapter();
}
