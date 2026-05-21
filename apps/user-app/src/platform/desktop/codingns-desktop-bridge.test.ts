import { afterEach, describe, expect, it, vi } from "vitest";

import { installCodingNSDesktopBridge, resetCodingNSDesktopBridgeForTest } from "./codingns-desktop-bridge";

const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const topDescriptor = Object.getOwnPropertyDescriptor(window, "top");
const selfDescriptor = Object.getOwnPropertyDescriptor(window, "self");

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

describe("CodingNSDesktop bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetCodingNSDesktopBridgeForTest();

    if (userAgentDescriptor) {
      Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
    }

    if (platformDescriptor) {
      Object.defineProperty(window.navigator, "platform", platformDescriptor);
    }

    if (topDescriptor) {
      Object.defineProperty(window, "top", topDescriptor);
    }

    if (selfDescriptor) {
      Object.defineProperty(window, "self", selfDescriptor);
    }

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
    } else {
      delete window.__TAURI_INTERNALS__;
    }
  });

  it("会把稳定的全局对象挂到 window 上", () => {
    delete window.__TAURI_INTERNALS__;
    installCodingNSDesktopBridge();

    expect(window.CodingNSDesktop).toBeDefined();
    expect(window.CodingNSDesktop?.runtime.isAvailable()).toBe(false);
  });

  it("iframe 环境不会给插件 frame 挂桌面桥", () => {
    delete window.__TAURI_INTERNALS__;
    const fakeTop = {} as Window;
    Object.defineProperty(window, "top", {
      configurable: true,
      value: fakeTop
    });
    Object.defineProperty(window, "self", {
      configurable: true,
      value: window
    });

    installCodingNSDesktopBridge();

    expect(window.CodingNSDesktop).toBeUndefined();
  });

  it("非桌面环境会优雅失败", async () => {
    delete window.__TAURI_INTERNALS__;
    installCodingNSDesktopBridge();

    const openResult = await window.CodingNSDesktop!.fs.openFile("/tmp/demo.txt");
    const platformResult = await window.CodingNSDesktop!.runtime.getPlatformInfo();

    expect(openResult).toEqual({
      ok: false,
      errorCode: "PLATFORM_NOT_SUPPORTED",
      detail: "当前不是桌面端运行环境。"
    });
    expect(platformResult).toEqual({
      ok: false,
      errorCode: "PLATFORM_NOT_SUPPORTED",
      detail: "当前不是桌面端运行环境。"
    });
  });

  it("桌面环境会把文件能力请求转给统一 bridge", async () => {
    const invoke = vi.fn(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "get_platform_info") {
        return {
          platform: "macos",
          isDesktop: true,
          fileManager: "finder"
        } as T;
      }

      return undefined as T;
    });

    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "MacIntel"
    );
    window.__TAURI_INTERNALS__ = { invoke };
    installCodingNSDesktopBridge();

    expect(window.CodingNSDesktop!.runtime.isAvailable()).toBe(true);

    await window.CodingNSDesktop!.fs.openFile("/Users/jackson/Documents/中文 空格.pdf");
    await window.CodingNSDesktop!.fs.revealInFileManager("/Users/jackson/Documents/中文 空格.pdf");
    await window.CodingNSDesktop!.fs.pickDirectory();
    const platformResult = await window.CodingNSDesktop!.runtime.getPlatformInfo();

    expect(invoke).toHaveBeenNthCalledWith(1, "open_local_file", {
      path: "/Users/jackson/Documents/中文 空格.pdf"
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "reveal_in_file_manager", {
      path: "/Users/jackson/Documents/中文 空格.pdf"
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "pick_directory", undefined);
    expect(invoke).toHaveBeenNthCalledWith(4, "get_platform_info", undefined);
    expect(platformResult).toEqual({
      ok: true,
      value: {
        platform: "macos",
        isDesktop: true,
        fileManager: "finder"
      }
    });
  });
});
