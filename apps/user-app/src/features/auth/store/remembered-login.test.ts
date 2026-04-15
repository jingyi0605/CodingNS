import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRememberedLoginCredentials,
  persistRememberedLoginCredentials,
  readRememberedLoginCredentials,
  readRememberedLoginSnapshot,
  syncRememberedLoginServerBaseUrl,
  supportsRememberPassword
} from "./remembered-login";
import type { PlatformAdapter } from "../../../platform/platform-adapter";
import { createWindowRegistryStore } from "../../../platform/desktop/window-registry";

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
      getAndroidRuntimeInfo: async () => ({ ok: false }),
      installAndroidUpdate: async () => ({ ok: false, status: "failed" }),
      rollbackToPreviousVersion: async () => ({ ok: false }),
      pickDirectory: async () => ({ ok: false }),
      createWindow: async () => ({ ok: false }),
      closeWindow: async () => ({ ok: false }),
      focusWindow: async () => ({ ok: false }),
      listWindows: async () => ({ ok: false }),
      isWindowOpen: async () => ({ ok: false }),
      getWindowDescriptor: async () => ({ ok: false }),
      syncWindowDescriptor: async () => ({ ok: false }),
      updateWindowBounds: async () => ({ ok: false })
    },
    windows: createWindowRegistryStore(),
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

  it("能按 HOST 读写并清理已保存的登录凭据", () => {
    persistRememberedLoginCredentials({
      hostId: "host-1",
      username: "admin",
      password: "Secret123!"
    });
    persistRememberedLoginCredentials({
      hostId: "host-2",
      username: "tester",
      password: "Other456!"
    });

    expect(readRememberedLoginCredentials("host-1")).toMatchObject({
      hostId: "host-1",
      username: "admin",
      password: "Secret123!"
    });
    expect(readRememberedLoginCredentials("host-2")).toMatchObject({
      hostId: "host-2",
      username: "tester",
      password: "Other456!"
    });

    clearRememberedLoginCredentials("host-1");

    expect(readRememberedLoginCredentials("host-1")).toBeNull();
    expect(readRememberedLoginCredentials("host-2")).toMatchObject({
      hostId: "host-2",
      username: "tester"
    });
  });

  it("读取旧单条 remember password 时会迁移到当前 HOST 槽位", () => {
    window.localStorage.setItem(
      "codingns.auth.remembered-login",
      JSON.stringify({
        username: "admin",
        password: "Secret123!",
        serverBaseUrl: "10.10.1.8:4100"
      })
    );

    const snapshot = readRememberedLoginSnapshot("host-2");

    expect(snapshot.legacyServerBaseUrl).toBe("http://10.10.1.8:4100");
    expect(snapshot.credentials).toMatchObject({
      hostId: "host-2",
      username: "admin",
      password: "Secret123!"
    });
    expect(
      JSON.parse(window.localStorage.getItem("codingns.auth.remembered-login") ?? "null")
    ).toMatchObject({
      "host-2": {
        hostId: "host-2",
        username: "admin",
        password: "Secret123!"
      }
    });
  });

  it("同步服务器地址时只更新旧兼容结构，不会污染新的 HOST 凭据映射", () => {
    window.localStorage.setItem(
      "codingns.auth.remembered-login",
      JSON.stringify({
        username: "admin",
        password: "Secret123!",
        serverBaseUrl: "10.10.1.8:4100"
      })
    );

    syncRememberedLoginServerBaseUrl("http://10.10.1.9:4200");

    expect(
      JSON.parse(window.localStorage.getItem("codingns.auth.remembered-login") ?? "null")
    ).toMatchObject({
      serverBaseUrl: "http://10.10.1.9:4200"
    });

    persistRememberedLoginCredentials({
      hostId: "host-1",
      username: "admin",
      password: "Secret123!"
    });
    syncRememberedLoginServerBaseUrl("http://10.10.1.10:4300");

    expect(readRememberedLoginCredentials("host-1")).toMatchObject({
      hostId: "host-1",
      username: "admin",
      password: "Secret123!"
    });
  });
});
