import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { t } from "../shared/i18n";
import { DesktopAutoUpdateEffect } from "./DesktopAutoUpdateEffect";

describe("DesktopAutoUpdateEffect", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    vi.stubGlobal("Notification", undefined);
    delete window.__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.__TAURI_INTERNALS__;
  });

  it("桌面端开启自动检查时，会在启动后检查更新并提示新版本", async () => {
    const invoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "check_for_update") {
        return {
          checkedAt: "2026-04-15T10:00:00.000Z",
          currentVersion: "0.1.2",
          hasUpdate: true,
          manifest: {
            channel: "stable",
            platform: "macos-universal",
            version: "0.1.3",
            tagName: "v0.1.3",
            title: "v0.1.3",
            notes: "",
            packageUrl: null,
            signature: null,
            htmlUrl: "https://github.com/jingyi0605/CodingNS/releases/tag/v0.1.3",
            publishedAt: "2026-04-15T09:30:00.000Z"
          },
          runtimeInfo: {
            version: "0.1.2",
            appDataDir: null
          }
        } as T;
      }

      return undefined as T;
    });

    window.__TAURI_INTERNALS__ = {
      invoke: invoke as NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"]
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    render(<DesktopAutoUpdateEffect />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_for_update", {
        channel: "stable"
      });
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("show_notification", {
        title: t("settings.releaseUpdateReady"),
        body: "0.1.3"
      });
    });
  });
});
