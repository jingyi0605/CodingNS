export type RuntimePlatform = "desktop" | "web" | "ios" | "android";
export type ReleaseChannel = "stable" | "beta";
export type AppLanguage = "zh-CN" | "en-US";
export type ClientPermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export interface ClientRuntimeConfig {
  platform: RuntimePlatform;
  hostBaseUrl: string;
  releaseChannel: ReleaseChannel;
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
  language: AppLanguage;
  defaultPermissionMode: ClientPermissionMode;
}

export interface ClientRuntimeConfigPatch extends Partial<ClientRuntimeConfig> {
  hostBaseUrl?: string;
}

export interface DesktopBridgeResult<T = void> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  detail?: string;
}

export interface DesktopRuntimeInfo {
  version: string;
  appDataDir: string | null;
}

export interface ServiceUpdateInfo {
  channel: ReleaseChannel;
  packageName: string;
  registryUrl: string;
  packagePageUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  updateCommand: string;
}

export interface ReleaseManifest {
  channel: ReleaseChannel;
  platform: string;
  version: string;
  tagName: string;
  title: string;
  notes: string;
  packageUrl: string | null;
  signature: string | null;
  htmlUrl: string;
  publishedAt: string;
}

export interface DesktopReleaseState {
  checkedAt: string;
  currentVersion: string;
  hasUpdate: boolean;
  manifest: ReleaseManifest | null;
  runtimeInfo: DesktopRuntimeInfo;
}

export interface DesktopUpdateInstallResult {
  ok: boolean;
  errorCode?: string;
  detail?: string;
  downloadedFilePath?: string | null;
}
