export type RuntimePlatform = "desktop" | "web" | "ios" | "android";
export type ReleaseChannel = "stable" | "beta";
export type AppLanguage = "zh-CN" | "en-US";
export type ClientPermissionMode = "default" | "acceptEdits" | "bypassPermissions";
export type HostProfileKind = "local" | "lan" | "remote" | "custom";
export type HostCandidateEndpointKind = "relay" | "lan" | "loopback" | "tailscale" | "custom";
export type LocalHostDiscoveryStatus =
  | "idle"
  | "refreshing"
  | "ready"
  | "unsupported"
  | "failed";

export const DEFAULT_HOST_PROFILE_ID = "default-host";

export interface HostProfileBase {
  id: string;
  name: string;
  alias: string | null;
  baseUrl: string;
  kind: HostProfileKind;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  lastUserId: string | null;
  lastUsername: string | null;
  peerEnabled: boolean;
  peerHostId: string | null;
  relayTunnel?: HostRelayTunnelProfile | null;
}

export interface HostProfile extends HostProfileBase {}

export interface HostRelayTunnelProfile {
  provider: "codingns_relay";
  enabled: boolean;
  tunnelDomain: string;
  controlBaseUrl: string;
  bindingId?: string | null;
  hostFingerprint?: string | null;
  candidateEndpoints?: HostCandidateEndpoint[];
}

export interface HostCandidateEndpoint {
  endpointId: string;
  kind: HostCandidateEndpointKind;
  url: string;
  priority: number;
  expiresAt: string | null;
  source: "host_reported" | "desktop_scan" | "user_saved";
}

export interface DesktopLocalHostProcessHit {
  pid: number;
  commandLine: string;
  executable: string | null;
  source: "codingns" | "npm" | "npx" | "node";
  baseUrl: string | null;
  port: number | null;
  dataDir: string | null;
}

export interface DiscoveredHostProfile extends HostProfileBase {
  discoveryKey: string;
  source: "desktop-process-scan";
  pid: number | null;
  executable: string | null;
  dataDir: string | null;
  discoveredAt: string;
  lastReachableAt: string | null;
}

export interface LocalHostDiscoveryState {
  status: LocalHostDiscoveryStatus;
  lastScannedAt: string | null;
  cooldownUntil: string | null;
  errorCode: string | null;
  errorDetail: string | null;
}

export type RuntimeHostProfile = HostProfile | DiscoveredHostProfile;

export interface ClientRuntimeConfig {
  platform: RuntimePlatform;
  activeHostId: string | null;
  hosts: HostProfile[];
  discoveredHosts: DiscoveredHostProfile[];
  activeDiscoveredHostId: string | null;
  localHostDiscovery: LocalHostDiscoveryState;
  releaseChannel: ReleaseChannel;
  betaChannelConsentAcceptedAt: string | null;
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  language: AppLanguage;
  defaultPermissionMode: ClientPermissionMode;
}

export interface ClientRuntimeConfigPatch extends Partial<ClientRuntimeConfig> {}

export interface LegacyClientRuntimeConfigSnapshot {
  platform?: RuntimePlatform;
  hostBaseUrl?: string;
  releaseChannel?: ReleaseChannel;
  betaChannelConsentAcceptedAt?: string | null;
  autoReconnect?: boolean;
  autoCheckUpdate?: boolean;
  autoDownloadUpdate?: boolean;
  language?: AppLanguage | "en";
  defaultPermissionMode?: ClientPermissionMode;
}

export interface DesktopBridgeResult<T = void> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  detail?: string;
}

export interface DesktopPlatformInfo {
  platform: "macos" | "windows" | "linux" | "unknown";
  isDesktop: boolean;
  fileManager: "finder" | "explorer" | "file-manager" | "unknown";
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
  restartScheduled: boolean;
  restartDelayMs: number | null;
}

export interface ManagedServicePackageInfo {
  channel: ReleaseChannel;
  packageName: string;
  registryUrl: string;
  packagePageUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  latestTitle: string | null;
  latestNotes: string | null;
  latestPublishedAt: string | null;
  hasUpdate: boolean;
  checkStatus: ServiceUpdateCheckStatus;
  checkError: string | null;
  restartRequired: boolean;
  installTask: ServiceUpdateTaskInfo | null;
}

/** 统一更新说明展示模型，供桌面端 / Android / 服务端更新面板共用 */
export interface UpdateNotesSummary {
  version: string;
  title?: string;
  publishedAt?: string;
  content?: string;
  channel: ReleaseChannel;
  source: "desktop" | "android" | "service";
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

export interface DesktopUpdateDownloadProgress {
  downloaded: number;
  contentLength: number | null;
  percent: number | null;
}

export interface DesktopUpdateDownloadResult {
  ok: boolean;
  errorCode?: string;
  detail?: string;
  version?: string | null;
  progress?: DesktopUpdateDownloadProgress | null;
}

export interface DesktopUpdateInstallResult {
  ok: boolean;
  errorCode?: string;
  detail?: string;
  downloadedFilePath?: string | null;
}

export function isDiscoveredHostProfile(host: RuntimeHostProfile | HostProfile | null | undefined): host is DiscoveredHostProfile {
  return Boolean(host && "discoveryKey" in host && typeof host.discoveryKey === "string");
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

export function getRuntimeHostById(
  config: Pick<ClientRuntimeConfig, "hosts"> & Partial<Pick<ClientRuntimeConfig, "discoveredHosts">>,
  hostId: string | null | undefined
): RuntimeHostProfile | null {
  if (!hostId) {
    return null;
  }

  return (
    config.hosts.find((host) => host.id === hostId)
    ?? config.discoveredHosts?.find((host) => host.id === hostId)
    ?? null
  );
}

export function getRuntimeHostByBaseUrl(
  config: Pick<ClientRuntimeConfig, "hosts"> & Partial<Pick<ClientRuntimeConfig, "discoveredHosts">>,
  baseUrl: string | null | undefined
): RuntimeHostProfile | null {
  if (!baseUrl) {
    return null;
  }

  return (
    config.hosts.find((host) => host.baseUrl === baseUrl)
    ?? config.discoveredHosts?.find((host) => host.baseUrl === baseUrl)
    ?? null
  );
}

export function getEffectiveActiveHostId(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">
    & Partial<Pick<ClientRuntimeConfig, "activeDiscoveredHostId" | "discoveredHosts">>
): string | null {
  if (
    config.activeDiscoveredHostId
    && config.discoveredHosts?.some((host) => host.id === config.activeDiscoveredHostId)
  ) {
    return config.activeDiscoveredHostId;
  }

  if (config.activeHostId && config.hosts.some((host) => host.id === config.activeHostId)) {
    return config.activeHostId;
  }

  return config.hosts[0]?.id ?? config.discoveredHosts?.[0]?.id ?? null;
}

export function getActiveHost(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">
    & Partial<Pick<ClientRuntimeConfig, "activeDiscoveredHostId" | "discoveredHosts">>
): RuntimeHostProfile | null {
  return getRuntimeHostById(config, getEffectiveActiveHostId(config));
}

export function getActiveHostBaseUrl(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">
    & Partial<Pick<ClientRuntimeConfig, "activeDiscoveredHostId" | "discoveredHosts">>
): string | null {
  return getActiveHost(config)?.baseUrl ?? null;
}
