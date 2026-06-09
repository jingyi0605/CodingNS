import { createPlatformAdapter } from "../platform-adapter";
import { clientConfigStore } from "../../config/client-config-store";
import type {
  DesktopReleaseState,
  DesktopUpdateDownloadResult,
  DesktopUpdateInstallResult
} from "../../config/client-config-types";
import {
  getDesktopUpdateSnapshot,
  markDesktopUpdateRestartPending,
  markDesktopUpdateVersionNotified,
  recordDesktopUpdateState
} from "./desktop-update-store";
import { t } from "../../shared/i18n";

export interface RefreshDesktopUpdateStateOptions {
  notify?: "never" | "if-new" | "always";
}

export async function checkForDesktopUpdate(): Promise<DesktopReleaseState> {
  const adapter = createPlatformAdapter();
  const config = clientConfigStore.getState();
  const result = await adapter.bridge.checkForUpdate(config.releaseChannel);

  if (!result.ok || !result.value) {
    throw new Error(result.detail ?? "更新检查失败。");
  }

  return result.value;
}

export async function refreshDesktopUpdateState(
  options: RefreshDesktopUpdateStateOptions = {}
): Promise<DesktopReleaseState> {
  const notifyMode = options.notify ?? "never";
  const state = await checkForDesktopUpdate();

  recordDesktopUpdateState(state);
  await maybeNotifyDesktopUpdate(state, notifyMode);

  return state;
}

export async function downloadDesktopUpdate(): Promise<DesktopUpdateDownloadResult> {
  const adapter = createPlatformAdapter();
  const config = clientConfigStore.getState();
  return adapter.bridge.downloadUpdate(config.releaseChannel);
}

export async function installDesktopUpdate(): Promise<DesktopUpdateInstallResult> {
  const adapter = createPlatformAdapter();
  const config = clientConfigStore.getState();
  return adapter.bridge.installUpdate(config.releaseChannel);
}

export async function rollbackDesktopUpdate() {
  const adapter = createPlatformAdapter();
  return adapter.bridge.rollbackToPreviousVersion();
}

export function markDesktopRestartRequired(version: string): void {
  markDesktopUpdateRestartPending(version);
}

export async function restartDesktopApplication(): Promise<void> {
  if (typeof window === "undefined" || typeof window.__TAURI_INTERNALS__?.invoke !== "function") {
    throw new Error("当前运行环境不支持桌面应用重启。");
  }

  try {
    await window.__TAURI_INTERNALS__.invoke("restart_application");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "重启应用失败。");
  }
}

async function maybeNotifyDesktopUpdate(
  state: DesktopReleaseState,
  notifyMode: NonNullable<RefreshDesktopUpdateStateOptions["notify"]>
): Promise<void> {
  if (!state.hasUpdate || notifyMode === "never") {
    return;
  }

  const targetVersion = state.manifest?.version?.trim() || state.currentVersion.trim();

  if (!targetVersion) {
    return;
  }

  const lastNotifiedVersion = getDesktopUpdateSnapshot().lastNotifiedVersion;
  const shouldNotify = notifyMode === "always" || lastNotifiedVersion !== targetVersion;

  if (!shouldNotify) {
    return;
  }

  try {
    const adapter = createPlatformAdapter();
    const result = await adapter.bridge.showNotification(
      t("settings.releaseUpdateReady"),
      state.manifest?.version ?? state.currentVersion
    );

    if (result.ok) {
      markDesktopUpdateVersionNotified(targetVersion);
    }
  } catch {
    // 通知失败不影响更新状态本身，用户仍可在设置页手动处理。
  }
}
