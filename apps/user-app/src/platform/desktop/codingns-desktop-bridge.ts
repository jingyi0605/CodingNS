import type { DesktopBridgeResult, DesktopPlatformInfo } from "../../config/client-config-types";
import { createPlatformAdapter } from "../platform-adapter";

export interface CodingNSDesktopBridge {
  readonly runtime: {
    isAvailable(): boolean;
    getPlatformInfo(): Promise<DesktopBridgeResult<DesktopPlatformInfo>>;
  };
  readonly fs: {
    openFile(path: string): Promise<DesktopBridgeResult>;
    revealInFileManager(path: string): Promise<DesktopBridgeResult>;
    pickDirectory(): Promise<DesktopBridgeResult<string | null>>;
  };
}

declare global {
  interface Window {
    CodingNSDesktop?: CodingNSDesktopBridge;
  }
}

let cachedDesktopBridge: CodingNSDesktopBridge | null = null;

function getBridge() {
  return createPlatformAdapter().bridge;
}

function createCodingNSDesktopBridge(): CodingNSDesktopBridge {
  return {
    runtime: {
      isAvailable() {
        return getBridge().supported;
      },
      getPlatformInfo() {
        return getBridge().getPlatformInfo();
      }
    },
    fs: {
      openFile(path: string) {
        return getBridge().openLocalFile(path);
      },
      revealInFileManager(path: string) {
        return getBridge().revealInFileManager(path);
      },
      pickDirectory() {
        return getBridge().pickDirectory();
      }
    }
  };
}

export function getCodingNSDesktopBridge(): CodingNSDesktopBridge {
  if (!cachedDesktopBridge) {
    cachedDesktopBridge = createCodingNSDesktopBridge();
  }

  return cachedDesktopBridge;
}

export function installCodingNSDesktopBridge() {
  if (typeof window === "undefined") {
    return;
  }

  if (window.self !== window.top) {
    return;
  }

  const bridge = getCodingNSDesktopBridge();
  (window as Window & { __CODINGNS_DESKTOP_BRIDGE_INSTALLED__?: boolean }).__CODINGNS_DESKTOP_BRIDGE_INSTALLED__ =
    true;
  Object.defineProperty(window, "CodingNSDesktop", {
    configurable: true,
    writable: false,
    value: bridge
  });
}

export function resetCodingNSDesktopBridgeForTest() {
  cachedDesktopBridge = null;

  if (typeof window !== "undefined") {
    delete window.CodingNSDesktop;
  }
}
