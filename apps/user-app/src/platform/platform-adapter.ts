import type {
  ClientRuntimeConfig,
  ClientRuntimeConfigPatch,
  DesktopBridgeResult,
  DesktopReleaseState,
  DesktopRuntimeInfo,
  DesktopUpdateInstallResult,
  ReleaseChannel,
  ReleaseManifest,
  RuntimePlatform
} from "../config/client-config-types";
import type { WindowBounds, WindowDescriptor } from "./desktop/window-descriptor";
import {
  getSharedWindowRegistryStore,
  type WindowRegistryApi
} from "./desktop/window-registry";

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
export type HapticPattern = "selection" | "action" | "gesture" | "success" | "warning" | "error";

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
  checkForUpdate(channel: ReleaseChannel): Promise<DesktopBridgeResult<DesktopReleaseState>>;
  installUpdate(manifest: ReleaseManifest): Promise<DesktopUpdateInstallResult>;
  rollbackToPreviousVersion(): Promise<DesktopBridgeResult>;
  pickDirectory(): Promise<DesktopBridgeResult<string | null>>;
  createWindow(descriptor: WindowDescriptor): Promise<DesktopBridgeResult>;
  closeWindow(windowId: string): Promise<DesktopBridgeResult>;
  focusWindow(windowId: string): Promise<DesktopBridgeResult>;
  listWindows(): Promise<DesktopBridgeResult<WindowDescriptor[]>>;
  isWindowOpen(windowId: string): Promise<DesktopBridgeResult<boolean>>;
  getWindowDescriptor(windowId?: string): Promise<DesktopBridgeResult<WindowDescriptor>>;
  syncWindowDescriptor(descriptor: WindowDescriptor): Promise<DesktopBridgeResult>;
  updateWindowBounds(windowId: string, bounds: WindowBounds): Promise<DesktopBridgeResult>;
}

export interface PlatformHapticsBridge {
  readonly supported: boolean;
  trigger(pattern: HapticPattern): Promise<void>;
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
  readonly windows: WindowRegistryApi;
  readonly haptics: PlatformHapticsBridge;
}

interface PlatformAdapterOptions {
  readonly viewportWidth?: number;
}

const sharedWindowRegistryStore = getSharedWindowRegistryStore();

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
  return invokeTauriCommand(command, args);
}

async function invokeTauriCommand<T>(
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

function resolveWebVibrationPattern(pattern: HapticPattern): number | number[] {
  switch (pattern) {
    case "selection":
      return 10;
    case "action":
      return [12];
    case "gesture":
      return [10, 18, 10];
    case "success":
      return [16, 30, 20];
    case "warning":
      return [20, 36, 18];
    case "error":
      return [24, 40, 24, 40, 20];
    default:
      return 10;
  }
}

function canUseNavigatorVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

async function triggerWebVibration(pattern: HapticPattern): Promise<void> {
  if (!canUseNavigatorVibrate()) {
    return;
  }

  try {
    navigator.vibrate(resolveWebVibrationPattern(pattern));
  } catch {
    return;
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

  openExternal(url: string): Promise<DesktopBridgeResult> {
    if (typeof window === "undefined") {
      return Promise.resolve(unsupportedResult("当前环境无法打开外部链接。"));
    }

    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve({ ok: true });
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

  checkForUpdate(): Promise<DesktopBridgeResult<DesktopReleaseState>> {
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

  createWindow(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  closeWindow(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  focusWindow(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  listWindows(): Promise<DesktopBridgeResult<WindowDescriptor[]>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  isWindowOpen(): Promise<DesktopBridgeResult<boolean>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  getWindowDescriptor(): Promise<DesktopBridgeResult<WindowDescriptor>> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  syncWindowDescriptor(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }

  updateWindowBounds(): Promise<DesktopBridgeResult> {
    return Promise.resolve(unsupportedResult("当前不是桌面端运行环境。"));
  }
}

class WebHapticsBridge implements PlatformHapticsBridge {
  readonly supported = canUseNavigatorVibrate();

  trigger(pattern: HapticPattern): Promise<void> {
    return triggerWebVibration(pattern);
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

  checkForUpdate(channel: ReleaseChannel): Promise<DesktopBridgeResult<DesktopReleaseState>> {
    return invokeDesktopCommand("check_for_update", { channel });
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

  createWindow(descriptor: WindowDescriptor): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("create_window", { descriptor });
  }

  closeWindow(windowId: string): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("close_window", { windowId });
  }

  focusWindow(windowId: string): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("focus_window", { windowId });
  }

  listWindows(): Promise<DesktopBridgeResult<WindowDescriptor[]>> {
    return invokeDesktopCommand("list_windows");
  }

  isWindowOpen(windowId: string): Promise<DesktopBridgeResult<boolean>> {
    return invokeDesktopCommand("is_window_open", { windowId });
  }

  getWindowDescriptor(windowId?: string): Promise<DesktopBridgeResult<WindowDescriptor>> {
    return typeof windowId === "string"
      ? invokeDesktopCommand("get_window_descriptor", { windowId })
      : invokeDesktopCommand("get_window_descriptor");
  }

  syncWindowDescriptor(descriptor: WindowDescriptor): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("sync_window_descriptor", { descriptor });
  }

  updateWindowBounds(windowId: string, bounds: WindowBounds): Promise<DesktopBridgeResult> {
    return invokeDesktopCommand("update_window_bounds", { windowId, bounds });
  }
}

class TauriMobileHapticsBridge implements PlatformHapticsBridge {
  readonly supported = true;

  async trigger(pattern: HapticPattern): Promise<void> {
    const result = await invokeTauriCommand("perform_haptic_feedback", {
      kind: pattern
    });

    if (!result.ok) {
      await triggerWebVibration(pattern);
    }
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
  const isMobileViewport = viewportClass !== "expanded";

  return {
    platform,
    isDesktop: platform === "desktop",
    isWeb: platform === "web",
    // 移动布局只看当前视口，不看设备出身。
    // 这样 iPad 横屏这类宽屏场景才不会继续混进手机布局分支。
    isMobile: isMobileViewport,
    isNativeMobile,
    viewportClass,
    ui: createUiProfile(platform),
    bridge: platform === "desktop" ? new TauriDesktopShellBridge() : new WebDesktopShellBridge(),
    windows: sharedWindowRegistryStore,
    haptics: isNativeMobile ? new TauriMobileHapticsBridge() : new WebHapticsBridge()
  };
}
