import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlatformAdapter, resolveRuntimePlatform, resolveViewportClass } from "./platform-adapter";

const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");
const vibrateDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "vibrate");

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

afterEach(() => {
  vi.restoreAllMocks();

  if (userAgentDescriptor) {
    Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
  }

  if (platformDescriptor) {
    Object.defineProperty(window.navigator, "platform", platformDescriptor);
  }

  if (maxTouchPointsDescriptor) {
    Object.defineProperty(window.navigator, "maxTouchPoints", maxTouchPointsDescriptor);
  }

  if (vibrateDescriptor) {
    Object.defineProperty(window.navigator, "vibrate", vibrateDescriptor);
  } else {
    Object.defineProperty(window.navigator, "vibrate", {
      configurable: true,
      value: undefined
    });
  }

  if (originalTauriInternals) {
    window.__TAURI_INTERNALS__ = originalTauriInternals;
    return;
  }

  window.__TAURI_INTERNALS__ = undefined;
});

describe("platform-adapter", () => {
  it("按三档宽度返回 viewport class", () => {
    expect(resolveViewportClass(390)).toBe("compact");
    expect(resolveViewportClass(768)).toBe("medium");
    expect(resolveViewportClass(960)).toBe("medium");
    expect(resolveViewportClass(1024)).toBe("expanded");
  });

  it("无 Tauri 时返回 web runtime", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    window.__TAURI_INTERNALS__ = undefined;

    expect(resolveRuntimePlatform()).toBe("web");
    expect(createPlatformAdapter({ viewportWidth: 1280 }).isMobile).toBe(false);
  });

  it("Tauri iPhone runtime 会识别成 ios 并返回移动端能力标记", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const adapter = createPlatformAdapter({ viewportWidth: 390 });

    expect(adapter.platform).toBe("ios");
    expect(adapter.ui.osFamily).toBe("ios");
    expect(adapter.isNativeMobile).toBe(true);
    expect(adapter.isMobile).toBe(true);
    expect(adapter.viewportClass).toBe("compact");
  });

  it("Tauri iPad runtime 在横屏宽度下改走非移动布局", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPad",
      maxTouchPoints: 5
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const adapter = createPlatformAdapter({ viewportWidth: 1194 });

    expect(adapter.platform).toBe("ios");
    expect(adapter.isNativeMobile).toBe(true);
    expect(adapter.viewportClass).toBe("expanded");
    expect(adapter.isMobile).toBe(false);
  });

  it("Tauri Android runtime 会识别成 android", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    expect(resolveRuntimePlatform()).toBe("android");
  });

  it("原生移动端优先走 Tauri haptic 命令", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5
    });
    window.__TAURI_INTERNALS__ = {
      invoke
    };

    const adapter = createPlatformAdapter({ viewportWidth: 390 });
    await adapter.haptics.trigger("selection");

    expect(adapter.haptics.supported).toBe(true);
    expect(invoke).toHaveBeenCalledWith("perform_haptic_feedback", {
      kind: "selection"
    });
  });

  it("Web 端在支持时退化到 navigator.vibrate", async () => {
    const vibrate = vi.fn();
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    delete window.__TAURI_INTERNALS__;
    Object.defineProperty(window.navigator, "vibrate", {
      configurable: true,
      value: vibrate
    });

    const adapter = createPlatformAdapter({ viewportWidth: 390 });
    await adapter.haptics.trigger("success");

    expect(adapter.haptics.supported).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
