import { describe, expect, it, beforeEach } from "vitest";

import {
  clearRememberedLoginCredentials,
  persistRememberedLoginCredentials,
  readRememberedLoginCredentials,
  syncRememberedLoginServerBaseUrl,
  supportsRememberPassword
} from "./remembered-login";
import type { PlatformAdapter } from "../../../platform/platform-adapter";

function createPlatform(
  overrides: Partial<PlatformAdapter> & {
    isDesktop?: boolean;
    isNativeMobile?: boolean;
    osFamily?: PlatformAdapter["ui"]["osFamily"];
  } = {}
): PlatformAdapter {
  return {
    platform: "web",
    isDesktop: overrides.isDesktop ?? false,
    isWeb: !(overrides.isDesktop ?? false) && !(overrides.isNativeMobile ?? false),
    isMobile: overrides.isNativeMobile ?? false,
    isNativeMobile: overrides.isNativeMobile ?? false,
    viewportClass: "expanded",
    ui: {
      osFamily: overrides.osFamily ?? "unknown",
      windowControlsStyle: "none",
      prefersDesktopChrome: false,
      prefersOverlayTitlebar: false,
      prefersSystemFontStack: true
    },
    bridge: {
      supported: false,
      openExternal: async () => ({ ok: false }),
      showNotification: async () => ({ ok: false }),
      writeClipboardText: async () => ({ ok: false }),
      setWindowState: async () => ({ ok: false }),
      readDesktopConfig: async () => ({ ok: false }),
      writeDesktopConfig: async () => ({ ok: false }),
      getRuntimeInfo: async () => ({ ok: false }),
      checkForUpdate: async () => ({ ok: false }),
      installUpdate: async () => ({ ok: false }),
      rollbackToPreviousVersion: async () => ({ ok: false }),
      pickDirectory: async () => ({ ok: false })
    },
    haptics: {
      supported: false,
      trigger: async () => undefined
    }
  };
}

describe("remembered-login", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("只在原生移动端和 Windows、macOS 客户端支持保存密码", () => {
    expect(
      supportsRememberPassword(createPlatform({ isDesktop: true, osFamily: "windows" }))
    ).toBe(true);
    expect(
      supportsRememberPassword(createPlatform({ isDesktop: true, osFamily: "macos" }))
    ).toBe(true);
    expect(
      supportsRememberPassword(createPlatform({ isDesktop: true, osFamily: "linux" }))
    ).toBe(false);
    expect(supportsRememberPassword(createPlatform({ isNativeMobile: true, osFamily: "ios" }))).toBe(
      true
    );
    expect(supportsRememberPassword(createPlatform({ osFamily: "macos" }))).toBe(false);
  });

  it("能正确读写并清理已保存的登录凭据", () => {
    persistRememberedLoginCredentials({
      username: "admin",
      password: "Secret123!",
      serverBaseUrl: "10.10.1.8:4100"
    });

    expect(readRememberedLoginCredentials()).toEqual({
      username: "admin",
      password: "Secret123!",
      serverBaseUrl: "http://10.10.1.8:4100"
    });

    clearRememberedLoginCredentials();

    expect(readRememberedLoginCredentials()).toBeNull();
  });

  it("同步服务器地址时会保留原有账号密码，只更新服务器地址", () => {
    persistRememberedLoginCredentials({
      username: "admin",
      password: "Secret123!",
      serverBaseUrl: "10.10.1.8:4100"
    });

    syncRememberedLoginServerBaseUrl("http://10.10.1.9:4200");

    expect(readRememberedLoginCredentials()).toEqual({
      username: "admin",
      password: "Secret123!",
      serverBaseUrl: "http://10.10.1.9:4200"
    });
  });
});
