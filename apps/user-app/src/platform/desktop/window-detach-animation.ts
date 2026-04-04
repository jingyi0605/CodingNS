interface DesktopWindowDetachPreviewInput {
  title: string;
  x: number;
  y: number;
}

export interface DesktopWindowDetachPreviewController {
  updatePosition(x: number, y: number): void;
  complete(): Promise<void>;
  cancel(): Promise<void>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

const DETACH_PREVIEW_MIN_SCALE = 0.78;
const DETACH_PREVIEW_MAX_SCALE = 1;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

function resolvePreviewScale(originX: number, originY: number, x: number, y: number): number {
  const distance = Math.hypot(x - originX, y - originY);
  const normalized = Math.min(1, distance / 120);
  return DETACH_PREVIEW_MIN_SCALE + (DETACH_PREVIEW_MAX_SCALE - DETACH_PREVIEW_MIN_SCALE) * normalized;
}

function roundPoint(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function createTauriDetachPreview(
  input: DesktopWindowDetachPreviewInput
): DesktopWindowDetachPreviewController | null {
  if (!isTauriRuntime()) {
    return null;
  }

  const originX = roundPoint(input.x);
  const originY = roundPoint(input.y);
  let disposed = false;
  let queue = Promise.resolve();

  const enqueue = (command: string, args?: Record<string, unknown>) => {
    queue = queue
      .then(async () => {
        await window.__TAURI_INTERNALS__!.invoke(command, args);
      })
      .catch(() => undefined);

    return queue;
  };

  const closePreview = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    await enqueue("close_detach_preview");
  };

  void enqueue("show_detach_preview", {
    title: input.title,
    x: originX,
    y: originY,
    scale: DETACH_PREVIEW_MIN_SCALE
  });

  return {
    updatePosition(x: number, y: number) {
      if (disposed) {
        return;
      }

      const nextX = roundPoint(x);
      const nextY = roundPoint(y);
      void enqueue("update_detach_preview_position", {
        x: nextX,
        y: nextY,
        scale: resolvePreviewScale(originX, originY, nextX, nextY)
      });
    },
    complete() {
      return closePreview();
    },
    cancel() {
      return closePreview();
    }
  };
}

function createDomDetachPreview(
  input: DesktopWindowDetachPreviewInput
): DesktopWindowDetachPreviewController | null {
  if (typeof document === "undefined") {
    return null;
  }

  const originX = roundPoint(input.x);
  const originY = roundPoint(input.y);
  const root = document.createElement("div");
  root.className = "desktop-window-detach-animation";
  root.setAttribute("aria-hidden", "true");
  root.dataset.state = "preview";
  root.style.left = `${originX}px`;
  root.style.top = `${originY}px`;
  root.style.setProperty("--detach-preview-scale", DETACH_PREVIEW_MIN_SCALE.toFixed(3));

  const bar = document.createElement("div");
  bar.className = "desktop-window-detach-animation-bar";

  const title = document.createElement("strong");
  title.className = "desktop-window-detach-animation-title";
  title.textContent = input.title;

  const body = document.createElement("div");
  body.className = "desktop-window-detach-animation-body";

  bar.append(title);
  root.append(bar, body);
  document.body.append(root);

  let disposed = false;

  const cleanup = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    root.remove();
  };

  return {
    updatePosition(x: number, y: number) {
      if (disposed) {
        return;
      }

      const nextX = roundPoint(x);
      const nextY = roundPoint(y);
      const nextScale = resolvePreviewScale(originX, originY, nextX, nextY);
      root.style.left = `${nextX}px`;
      root.style.top = `${nextY}px`;
      root.style.setProperty("--detach-preview-scale", nextScale.toFixed(3));
    },
    async complete() {
      cleanup();
    },
    async cancel() {
      cleanup();
    }
  };
}

export function createDesktopWindowDetachPreview(
  input: DesktopWindowDetachPreviewInput
): DesktopWindowDetachPreviewController | null {
  // 桌面端优先走原生窗口预览，只有非 Tauri 环境才退回 DOM，避免测试环境被桌面命令卡死。
  return createTauriDetachPreview(input) ?? createDomDetachPreview(input);
}
