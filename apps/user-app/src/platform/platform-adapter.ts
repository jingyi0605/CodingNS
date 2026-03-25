import type {
  ClientRuntimeConfig,
  ClientRuntimeConfigPatch,
  DesktopBridgeResult,
  DesktopRuntimeInfo,
  DesktopUpdateInstallResult,
  ReleaseManifest,
  RuntimePlatform
} from "../config/client-config-types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

export interface DesktopShellBridge {
  readonly supported: boolean;
  openExternal(url: string): Promise<DesktopBridgeResult>;
  showNotification(title: string, body: string): Promise<DesktopBridgeResult>;
  setWindowState(state: "minimize" | "maximize" | "toggle-maximize" | "close"): Promise<DesktopBridgeResult>;
  readDesktopConfig(): Promise<DesktopBridgeResult<Partial<ClientRuntimeConfig>>>;
  writeDesktopConfig(config: ClientRuntimeConfigPatch): Promise<DesktopBridgeResult>;
  getRuntimeInfo(): Promise<DesktopBridgeResult<DesktopRuntimeInfo>>;
  installUpdate(manifest: ReleaseManifest): Promise<DesktopUpdateInstallResult>;
  rollbackToPreviousVersion(): Promise<DesktopBridgeResult>;
}

export interface PlatformAdapter {
  readonly platform: RuntimePlatform;
  readonly isDesktop: boolean;
  readonly isWeb: boolean;
  readonly bridge: DesktopShellBridge;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

function unsupportedResult<T = void>(detail: string): DesktopBridgeResult<T> {
  return {
    ok: false,
    errorCode: "PLATFORM_NOT_SUPPORTED",
    detail
  };
}

async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<DesktopBridgeResult<T>> {
  if (!isTauriRuntime()) {
    return unsupportedResult<T>("当前运行环境不支持桌面壳能力");
  }

  try {
    const value = await window.__TAURI_INTERNALS__!.invoke<T>(command, args);
    return {
      ok: true,
      value
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "SHELL_BRIDGE_ERROR",
      detail: error instanceof Error ? error.message : "桌面壳调用失败"
    };
  }
}

class WebDesktopShellBridge implements DesktopShellBridge {
  readonly supported = false;

  openExternal(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }

  showNotification(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }

  setWindowState(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }

  readDesktopConfig(): Promise<DesktopBridgeResult<Partial<ClientRuntimeConfig>>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }

  writeDesktopConfig(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }

  getRuntimeInfo(): Promise<DesktopBridgeResult<DesktopRuntimeInfo>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }

  installUpdate(): Promise<DesktopUpdateInstallResult> {
    return Promise.resolve({
      ok: false,
      errorCode: "PLATFORM_NOT_SUPPORTED",
      detail: "当前不是桌面端运行环境"
    });
  }

  rollbackToPreviousVersion(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境"));
  }
}

class TauriDesktopShellBridge implements DesktopShellBridge {
  readonly supported = true;

  openExternal(url: string): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("open_external", { url });
  }

  showNotification(title: string, body: string): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("show_notification", { title, body });
  }

  setWindowState(
    state: "minimize" | "maximize" | "toggle-maximize" | "close"
  ): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("set_window_state", { state });
  }

  readDesktopConfig(): Promise<DesktopBridgeResult<Partial<ClientRuntimeConfig>>> {
    return invokeDesktopCommand("read_desktop_config");
  }

  writeDesktopConfig(config: ClientRuntimeConfigPatch): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("write_desktop_config", { patch: config });
  }

  getRuntimeInfo(): Promise<DesktopBridgeResult<DesktopRuntimeInfo>> {
    return invokeDesktopCommand("get_runtime_info");
  }

  async installUpdate(manifest: ReleaseManifest): Promise<DesktopUpdateInstallResult> {
    const result = await invokeDesktopCommand<DesktopUpdateInstallResult>("install_update", {
      manifest
    });

    return result.ok
      ? result.value ?? { ok: true }
      : {
          ok: false,
          errorCode: result.errorCode,
          detail: result.detail
        };
  }

  rollbackToPreviousVersion(): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("rollback_to_previous_version");
  }
}

let cachedAdapter: PlatformAdapter | null = null;

export function resolveRuntimePlatform(): RuntimePlatform {
  return isTauriRuntime() ? "desktop" : "web";
}

export function createPlatformAdapter(): PlatformAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const platform = resolveRuntimePlatform();

  cachedAdapter = {
    platform,
    isDesktop: platform === "desktop",
    isWeb: platform === "web",
    bridge: platform === "desktop" ? new TauriDesktopShellBridge() : new WebDesktopShellBridge()
  };

  return cachedAdapter;
}
