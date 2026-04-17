import { afterEach, describe, expect, it, vi } from "vitest";

import { beginMacOsTitlebarDragGesture } from "./window-drag";

const startDraggingMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: startDraggingMock
  })
}));

describe("window-drag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    startDraggingMock.mockReset();
    delete window.__TAURI_INTERNALS__;
  });

  it("只有鼠标真的移动超过阈值后才会开始原生窗口拖拽", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    const target = document.createElement("div");

    beginMacOsTitlebarDragGesture({
      platform: {
        isDesktop: true,
        ui: {
          osFamily: "macos",
          windowControlsStyle: "traffic-lights",
          prefersDesktopChrome: true,
          prefersOverlayTitlebar: true,
          prefersSystemFontStack: true
        }
      },
      button: 0,
      target,
      clientX: 100,
      clientY: 120
    });

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 103, clientY: 123 }));
    await Promise.resolve();
    expect(startDraggingMock).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 108, clientY: 120 }));
    await Promise.resolve();
    expect(startDraggingMock).toHaveBeenCalledTimes(1);
  });

  it("未达到拖拽阈值就松手时，不会误触发窗口拖拽", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };

    beginMacOsTitlebarDragGesture({
      platform: {
        isDesktop: true,
        ui: {
          osFamily: "macos",
          windowControlsStyle: "traffic-lights",
          prefersDesktopChrome: true,
          prefersOverlayTitlebar: true,
          prefersSystemFontStack: true
        }
      },
      button: 0,
      target: document.createElement("div"),
      clientX: 20,
      clientY: 30
    });

    window.dispatchEvent(new MouseEvent("mouseup"));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 30 }));
    await Promise.resolve();

    expect(startDraggingMock).not.toHaveBeenCalled();
  });
});
