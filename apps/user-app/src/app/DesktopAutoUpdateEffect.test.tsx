import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { resetDesktopUpdateState } from "../platform/desktop/desktop-update-store";
import { DesktopAutoUpdateEffect } from "./DesktopAutoUpdateEffect";

describe("DesktopAutoUpdateEffect", () => {
  beforeEach(() => {
    resetDesktopUpdateState();
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

  it("桌面端开启自动检查时，会在启动后立即检查，并在一小时后再次检查", async () => {
    const invoke = vi.fn(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "check_for_update") {
        expect(args).toEqual({ channel: "stable" });
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

      if (command === "show_notification") {
        return {
          ok: true
        } as T;
      }

      return undefined as T;
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(
      ((..._args: Parameters<typeof window.setInterval>) =>
        1 as unknown as ReturnType<typeof window.setInterval>) as unknown as typeof window.setInterval
    );
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);

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
      expect(countCommandCalls(invoke, "check_for_update")).toBe(1);
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
  });
});

function countCommandCalls(
  invoke: ReturnType<typeof vi.fn>,
  command: string
): number {
  return invoke.mock.calls.filter(([calledCommand]) => calledCommand === command).length;
}
