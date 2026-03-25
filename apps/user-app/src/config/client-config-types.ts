export type RuntimePlatform = "desktop" | "web";
export type ReleaseChannel = "stable" | "beta";

export interface ClientRuntimeConfig {
  platform: RuntimePlatform;
  hostBaseUrl: string;
  releaseChannel: ReleaseChannel;
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
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

export interface ReleaseManifest {
  channel: ReleaseChannel;
  platform: string;
  version: string;
  notes: string;
  packageUrl: string;
  signature: string;
  publishedAt: string;
}

export interface DesktopUpdateInstallResult {
  ok: boolean;
  errorCode?: string;
  detail?: string;
  downloadedFilePath?: string | null;
}
