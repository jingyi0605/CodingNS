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

export type PlatformOsFamily = "macos" | "windows" | "linux" | "ios" | "android" | "unknown";
export type WindowControlsStyle = "traffic-lights" | "windows" | "none";
export type ViewportClass = "compact" | "medium" | "expanded";

export interface PlatformUiProfile {
  readonly osFamily: PlatformOsFamily;
  readonly windowControlsStyle: WindowControlsStyle;
  readonly prefersDesktopChrome: boolean;
  readonly prefersOverlayTitlebar: boolean;
  readonly prefersSystemFontStack: boolean;
}

export interface DesktopShellBridge {
  readonly supported: boolean;
  openExternal(url: string): Promise<DesktopBridgeResult>;
  showNotification(title: string, body: string): Promise<DesktopBridgeResult>;
  writeClipboardText(text: string): Promise<DesktopBridgeResult>;
  setWindowState(state: "minimize" | "maximize" | "toggle-maximize" | "close"): Promise<DesktopBridgeResult>;
  readDesktopConfig(): Promise<DesktopBridgeResult<Partial<ClientRuntimeConfig>>>;
  writeDesktopConfig(config: ClientRuntimeConfigPatch): Promise<DesktopBridgeResult>;
  getRuntimeInfo(): Promise<DesktopBridgeResult<DesktopRuntimeInfo>>;
  installUpdate(manifest: ReleaseManifest): Promise<DesktopUpdateInstallResult>;
  rollbackToPreviousVersion(): Promise<DesktopBridgeResult>;
  pickDirectory(): Promise<DesktopBridgeResult<string | null>>;
}

export interface PlatformAdapter {
  readonly platform: RuntimePlatform;
  readonly isDesktop: boolean;
  readonly isWeb: boolean;
  readonly isMobile: boolean;
  readonly isNativeMobile: boolean;
  readonly viewportClass: ViewportClass;
  readonly ui: PlatformUiProfile;
  readonly bridge: DesktopShellBridge;
}

interface PlatformAdapterOptions {
  readonly viewportWidth?: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

function detectOsFamily(): PlatformOsFamily {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform?.toLowerCase() ?? navigator.platform?.toLowerCase() ?? "";
  const fingerprint = `${platform} ${userAgent}`;
  const isTouchMac = platform.includes("mac") && navigator.maxTouchPoints > 1;

  if (fingerprint.includes("android")) {
    return "android";
  }

  if (
    fingerprint.includes("iphone") ||
    fingerprint.includes("ipad") ||
    fingerprint.includes("ipod") ||
    isTouchMac
  ) {
    return "ios";
  }

  if (fingerprint.includes("mac")) {
    return "macos";
  }

  if (fingerprint.includes("win")) {
    return "windows";
  }

  if (fingerprint.includes("linux")) {
    return "linux";
  }

  return "unknown";
}

function resolveViewportWidth(explicitWidth?: number): number {
  if (typeof explicitWidth === "number" && Number.isFinite(explicitWidth) && explicitWidth > 0) {
    return explicitWidth;
  }

  if (typeof window !== "undefined" && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    return window.innerWidth;
  }

  if (
    typeof document !== "undefined" &&
    Number.isFinite(document.documentElement?.clientWidth) &&
    document.documentElement.clientWidth > 0
  ) {
    return document.documentElement.clientWidth;
  }

  return 1280;
}

export function resolveViewportClass(width?: number): ViewportClass {
  const viewportWidth = resolveViewportWidth(width);

  if (viewportWidth < 768) {
    return "compact";
  }

  if (viewportWidth < 1024) {
    return "medium";
  }

  return "expanded";
}

function createUiProfile(runtimePlatform: RuntimePlatform): PlatformUiProfile {
  const osFamily = detectOsFamily();

  if (runtimePlatform === "desktop") {
    return {
      osFamily,
      windowControlsStyle:
        osFamily === "macos" ? "traffic-lights" : osFamily === "windows" ? "windows" : "none",
      prefersDesktopChrome: true,
      prefersOverlayTitlebar: osFamily === "macos",
      prefersSystemFontStack: true
    };
  }

  return {
    osFamily,
    windowControlsStyle: "none",
    prefersDesktopChrome: false,
    prefersOverlayTitlebar: false,
    prefersSystemFontStack: true
  };
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
    return unsupportedResult<T>("当前运行环境不支持桌面壳能力。");
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
      detail: error instanceof Error ? error.message : "桌面壳调用失败。"
    };
  }
}

async function showSystemNotification(title: string, body: string): Promise<DesktopBridgeResult> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return unsupportedResult("当前环境不支持系统通知。");
  }

  try {
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        return unsupportedResult("系统通知权限未授予。");
      }
    }

    if (Notification.permission !== "granted") {
      return unsupportedResult("系统通知权限未授予。");
    }

    const notification = new Notification(title, { body });
    notification.onerror = () => undefined;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      errorCode: "NOTIFICATION_FAILED",
      detail: error instanceof Error ? error.message : "系统通知发送失败。"
    };
  }
}

class WebDesktopShellBridge implements DesktopShellBridge {
  readonly supported = false;

  openExternal(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  showNotification(title: string, body: string): Promise<DesktopBridgeResult> {
    return showSystemNotification(title, body);
  }

  writeClipboardText(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  setWindowState(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  readDesktopConfig(): Promise<DesktopBridgeResult<Partial<ClientRuntimeConfig>>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  writeDesktopConfig(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  getRuntimeInfo(): Promise<DesktopBridgeResult<DesktopRuntimeInfo>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  installUpdate(): Promise<DesktopUpdateInstallResult> {
    return Promise.resolve({
      ok: false,
      errorCode: "PLATFORM_NOT_SUPPORTED",
      detail: "当前不是桌面端运行环境。"
    });
  }

  rollbackToPreviousVersion(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  pickDirectory(): Promise<DesktopBridgeResult<string | null>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }
}

class TauriDesktopShellBridge implements DesktopShellBridge {
  readonly supported = true;

  openExternal(url: string): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("open_external", { url });
  }

  async showNotification(title: string, body: string): Promise<DesktopBridgeResult> {
    const systemResult = await showSystemNotification(title, body);

    if (systemResult.ok) {
      return systemResult;
    }

    return invokeDesktopCommand("show_notification", { title, body });
  }

  writeClipboardText(text: string): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("copy_text", { text });
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

  pickDirectory(): Promise<DesktopBridgeResult<string | null>> {
    return invokeDesktopCommand("pick_directory");
  }
}

export function resolveRuntimePlatform(): RuntimePlatform {
  if (!isTauriRuntime()) {
    return "web";
  }

  const osFamily = detectOsFamily();

  if (osFamily === "ios") {
    return "ios";
  }

  if (osFamily === "android") {
    return "android";
  }

  return "desktop";
}

export function createPlatformAdapter(options: PlatformAdapterOptions = {}): PlatformAdapter {
  const platform = resolveRuntimePlatform();
  const viewportClass = resolveViewportClass(options.viewportWidth);
  const isNativeMobile = platform === "ios" || platform === "android";

  return {
    platform,
    isDesktop: platform === "desktop",
    isWeb: platform === "web",
    isMobile: isNativeMobile || viewportClass !== "expanded",
    isNativeMobile,
    viewportClass,
    ui: createUiProfile(platform),
    bridge: platform === "desktop" ? new TauriDesktopShellBridge() : new WebDesktopShellBridge()
  };
}
