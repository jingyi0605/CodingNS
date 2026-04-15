export type RuntimePlatform = "desktop" | "web" | "ios" | "android";
export type ReleaseChannel = "stable" | "beta";
export type AppLanguage = "zh-CN" | "en-US";
export type ClientPermissionMode = "default" | "acceptEdits" | "bypassPermissions";
export type HostProfileKind = "local" | "lan" | "remote" | "custom";

export const DEFAULT_HOST_PROFILE_ID = "default-host";

export interface HostProfile {
  id: string;
  name: string;
  baseUrl: string;
  kind: HostProfileKind;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  lastUserId: string | null;
  lastUsername: string | null;
}

export interface ClientRuntimeConfig {
  platform: RuntimePlatform;
  activeHostId: string | null;
  hosts: HostProfile[];
  releaseChannel: ReleaseChannel;
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
  language: AppLanguage;
  defaultPermissionMode: ClientPermissionMode;
}

export interface ClientRuntimeConfigPatch extends Partial<ClientRuntimeConfig> {}

export interface LegacyClientRuntimeConfigSnapshot {
  platform?: RuntimePlatform;
  hostBaseUrl?: string;
  releaseChannel?: ReleaseChannel;
  autoReconnect?: boolean;
  autoCheckUpdate?: boolean;
  language?: AppLanguage | "en";
  defaultPermissionMode?: ClientPermissionMode;
}

export interface DesktopBridgeResult<T = void> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  detail?: string;
}

export interface MacOsTitlebarMetrics {
  overlay: boolean;
  trafficLightCenterY: number;
  trafficLightLeadingInset: number;
  trafficLightSafeZoneWidth: number;
  trafficLightButtonDiameter: number;
  titlebarHeight: number;
}

export interface DesktopWindowChromeInfo {
  macosTitlebar?: MacOsTitlebarMetrics | null;
}

export interface DesktopRuntimeInfo {
  version: string;
  appDataDir: string | null;
  windowChrome?: DesktopWindowChromeInfo | null;
}

export type ServiceUpdateCheckStatus = "ready" | "up_to_date" | "check_failed";
export type ServiceUpdateTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export interface ServiceUpdateTaskInfo {
  taskId: string;
  packageName: string;
  channel: ReleaseChannel;
  targetVersion: string | null;
  status: ServiceUpdateTaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  restartRequired: boolean;
}

export interface ManagedServicePackageInfo {
  channel: ReleaseChannel;
  packageName: string;
  registryUrl: string;
  packagePageUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  checkStatus: ServiceUpdateCheckStatus;
  checkError: string | null;
  restartRequired: boolean;
  installTask: ServiceUpdateTaskInfo | null;
}

export interface ServiceUpdateSnapshot {
  channel: ReleaseChannel;
  checkedAt: string;
  packages: ManagedServicePackageInfo[];
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

export interface AndroidApkManifest {
  channel: ReleaseChannel;
  version: string;
  versionCode: number;
  packageName: string;
  fileName: string;
  downloadUrl: string;
  sha256: string;
  publishedAt: string;
  notes: string;
  minSupportedVersionCode: number | null;
  htmlUrl: string | null;
}

export interface AndroidRuntimeInfo {
  version: string;
  versionCode: number;
  packageName: string;
}

export interface AndroidReleaseState {
  checkedAt: string;
  currentVersion: string;
  currentVersionCode: number;
  hasUpdate: boolean;
  manifest: AndroidApkManifest | null;
  runtimeInfo: AndroidRuntimeInfo;
}

export type AndroidUpdateInstallStatus =
  | "installer_started"
  | "permission_required"
  | "already_up_to_date"
  | "failed";

export interface AndroidUpdateInstallResult {
  ok: boolean;
  status: AndroidUpdateInstallStatus;
  detail?: string;
  downloadedFilePath?: string | null;
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

export function getHostProfileById(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">,
  hostId: string | null | undefined
): HostProfile | null {
  if (!hostId) {
    return null;
  }

  return config.hosts.find((host) => host.id === hostId) ?? null;
}

export function getActiveHost(config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">): HostProfile | null {
  return getHostProfileById(config, config.activeHostId) ?? config.hosts[0] ?? null;
}

export function getActiveHostBaseUrl(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">
): string | null {
  return getActiveHost(config)?.baseUrl ?? null;
}
