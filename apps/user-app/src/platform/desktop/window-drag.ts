import { getCurrentWindow } from "@tauri-apps/api/window";

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

export async function startDesktopWindowDrag(): Promise<void> {
  if (typeof window === "undefined" || typeof window.__TAURI_INTERNALS__ === "undefined") {
    return;
  }

  await getCurrentWindow().startDragging();
}
