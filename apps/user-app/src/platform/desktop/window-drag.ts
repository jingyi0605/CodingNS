import { getCurrentWindow } from "@tauri-apps/api/window";

import type { PlatformAdapter } from "../platform-adapter";

const MACOS_TITLEBAR_DRAG_THRESHOLD_PX = 6;
const WINDOW_DRAG_BLOCK_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[contenteditable='true']",
  "[data-window-drag='ignore']"
].join(", ");

export function canStartDesktopWindowDragFromTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  return !target.closest(WINDOW_DRAG_BLOCK_SELECTOR);
}

export function canHandleMacOsTitlebarPointerGesture(
  platform: Pick<PlatformAdapter, "isDesktop" | "ui">,
  button: number,
  target: EventTarget | null
): boolean {
  return (
    platform.isDesktop &&
    platform.ui.osFamily === "macos" &&
    button === 0 &&
    canStartDesktopWindowDragFromTarget(target)
  );
}

export function shouldUseMacOsNativeTitlebarDragRegion(
  platform: Pick<PlatformAdapter, "isDesktop" | "ui">
): boolean {
  return platform.isDesktop && platform.ui.osFamily === "macos" && platform.ui.prefersOverlayTitlebar;
}

export function resolveMacOsNativeTitlebarDragRegion(
  platform: Pick<PlatformAdapter, "isDesktop" | "ui">
): "" | undefined {
  return shouldUseMacOsNativeTitlebarDragRegion(platform) ? "" : undefined;
}

export function beginMacOsTitlebarDragGesture(input: {
  platform: Pick<PlatformAdapter, "isDesktop" | "ui">;
  button: number;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
}): void {
  if (!canHandleMacOsTitlebarPointerGesture(input.platform, input.button, input.target)) {
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  const startClientX = input.clientX;
  const startClientY = input.clientY;
  let active = true;

  const cleanup = () => {
    if (!active) {
      return;
    }

    active = false;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("blur", handleWindowBlur);
  };

  const handleMouseMove = (event: globalThis.MouseEvent) => {
    if (
      Math.abs(event.clientX - startClientX) < MACOS_TITLEBAR_DRAG_THRESHOLD_PX
      && Math.abs(event.clientY - startClientY) < MACOS_TITLEBAR_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    cleanup();
    void startDesktopWindowDrag();
  };

  const handleMouseUp = () => {
    cleanup();
  };

  const handleWindowBlur = () => {
    cleanup();
  };

  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
  window.addEventListener("blur", handleWindowBlur);
}

export async function startDesktopWindowDrag(): Promise<void> {
  if (typeof window === "undefined" || typeof window.__TAURI_INTERNALS__ === "undefined") {
    return;
  }

  await getCurrentWindow().startDragging();
}
