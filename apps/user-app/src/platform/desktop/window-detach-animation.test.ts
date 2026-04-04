import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopWindowDetachPreview } from "./window-detach-animation";

const originalTauriInternals = window.__TAURI_INTERNALS__;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();

  if (originalTauriInternals) {
    window.__TAURI_INTERNALS__ = originalTauriInternals;
    return;
  }

  delete window.__TAURI_INTERNALS__;
});

describe("window-detach-animation", () => {
  it("桌面端优先调用 Tauri 原生预览窗口命令", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    window.__TAURI_INTERNALS__ = { invoke };

    const preview = createDesktopWindowDetachPreview({
      title: "文件",
      x: 24,
      y: 36
    });

    expect(preview).not.toBeNull();
    await Promise.resolve();

    preview?.updatePosition(80, 96);
    await preview?.complete();

    expect(invoke).toHaveBeenNthCalledWith(1, "show_detach_preview", {
      title: "文件",
      x: 24,
      y: 36,
      scale: 0.78
    });
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "update_detach_preview_position",
      expect.objectContaining({
        x: 80,
        y: 96
      })
    );
    expect(invoke).toHaveBeenNthCalledWith(3, "close_detach_preview", undefined);
  });

  it("非桌面环境会退回 DOM 预览，并在关闭后清理节点", async () => {
    delete window.__TAURI_INTERNALS__;

    const preview = createDesktopWindowDetachPreview({
      title: "Git",
      x: 18,
      y: 20
    });

    expect(document.querySelector(".desktop-window-detach-animation")).not.toBeNull();

    preview?.updatePosition(56, 62);
    await preview?.cancel();

    expect(document.querySelector(".desktop-window-detach-animation")).toBeNull();
  });
});
