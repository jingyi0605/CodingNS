import {
  type AppLanguage,
  type ClientPermissionMode,
  type ClientRuntimeConfig,
  type ClientRuntimeConfigPatch,
  DEFAULT_HOST_PROFILE_ID,
  getActiveHost,
  type HostProfile,
  type HostProfileKind,
  type LegacyClientRuntimeConfigSnapshot,
  type LocalHostDiscoveryState,
  type RuntimePlatform
} from "./client-config-types";
import { syncRememberedLoginServerBaseUrl } from "../features/auth/store/remembered-login";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { normalizeServerBaseUrl } from "./server-config-shared";

const STORAGE_KEY = "codingns.client.runtime-config";

type RuntimeConfigPatchInput =
  | (Partial<ClientRuntimeConfig> & LegacyClientRuntimeConfigSnapshot)
  | null
  | undefined;

export function canConfigureHostBaseUrl(platform: RuntimePlatform): boolean {
  return platform === "desktop" || platform === "ios" || platform === "android";
}

function normalizeLanguage(value?: string | null): AppLanguage {
  if (value === "en" || value === "en-US") {
    return "en-US";
  }

  return "zh-CN";
}

function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") {
    return "zh-CN";
  }

  return normalizeLanguage(navigator.language);
}

function normalizePermissionMode(value?: string | null): ClientPermissionMode {
  if (value === "acceptEdits" || value === "bypassPermissions") {
    return value;
  }

  return "default";
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredConfig(): unknown {
  if (!canUseLocalStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistLocalConfig(config: ClientRuntimeConfig): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stripRuntimeConfigForPersistence(config)));
}

function readWindowOrigin(): string | null {
  if (typeof window === "undefined" || !window.location?.origin) {
    return null;
  }

  return window.location.origin;
}

function safelyNormalizeServerBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return normalizeServerBaseUrl(value);
  } catch {
    return null;
  }
}

export function resolveDefaultHostBaseUrl(platform: RuntimePlatform): string {
  if (platform === "web") {
    const windowOrigin = safelyNormalizeServerBaseUrl(readWindowOrigin());

    if (windowOrigin) {
      return windowOrigin;
    }
  }

  return normalizeServerBaseUrl("http://127.0.0.1:3002");
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function createDefaultLocalHostDiscoveryState(): LocalHostDiscoveryState {
  return {
    status: "idle",
    lastScannedAt: null,
    cooldownUntil: null,
    errorCode: null,
    errorDetail: null
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return normalizeString(value) ?? fallback;
}

function classifyHostKind(baseUrl: string): HostProfileKind {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return "local";
    }

    if (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return "lan";
    }

    return "remote";
  } catch {
    return "custom";
  }
}

function buildDefaultHostName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.host}${pathname}`;
  } catch {
    return baseUrl;
  }
}

function createHostProfile(baseUrl: string, now: string, overrides: Partial<HostProfile> = {}): HostProfile {
  const normalizedBaseUrl = normalizeServerBaseUrl(baseUrl);

  return {
    id: normalizeString(overrides.id) ?? DEFAULT_HOST_PROFILE_ID,
    name: normalizeString(overrides.name) ?? buildDefaultHostName(normalizedBaseUrl),
    baseUrl: normalizedBaseUrl,
    kind: overrides.kind ?? classifyHostKind(normalizedBaseUrl),
    createdAt: normalizeTimestamp(overrides.createdAt, now),
    updatedAt: normalizeTimestamp(overrides.updatedAt, now),
    lastConnectedAt: normalizeString(overrides.lastConnectedAt) ?? null,
    lastUserId: normalizeString(overrides.lastUserId) ?? null,
    lastUsername: normalizeString(overrides.lastUsername) ?? null
  };
}

function isHostRecord(value: unknown): value is Partial<HostProfile> {
  return typeof value === "object" && value !== null;
}

function normalizeHostProfiles(rawHosts: unknown, now: string): HostProfile[] {
  if (!Array.isArray(rawHosts)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalizedHosts: HostProfile[] = [];

  for (let index = 0; index < rawHosts.length; index += 1) {
    const rawHost = rawHosts[index];

    if (!isHostRecord(rawHost)) {
      continue;
    }

    const baseUrlInput = normalizeString(rawHost.baseUrl);

    if (!baseUrlInput) {
      continue;
    }

    try {
      const fallbackId = index === 0 ? DEFAULT_HOST_PROFILE_ID : `host-${index + 1}`;
      const host = createHostProfile(baseUrlInput, now, {
        ...rawHost,
        id: normalizeString(rawHost.id) ?? fallbackId
      });

      if (seenIds.has(host.id)) {
        continue;
      }

      seenIds.add(host.id);
      normalizedHosts.push(host);
    } catch {
      continue;
    }
  }

  return normalizedHosts;
}

function isRuntimeConfigPatchInput(value: unknown): value is RuntimeConfigPatchInput {
  return typeof value === "object" && value !== null;
}

function replaceActiveHostBaseUrl(
  baseConfig: ClientRuntimeConfig,
  hostBaseUrl: string,
  now: string
): HostProfile[] {
  const normalizedBaseUrl = normalizeServerBaseUrl(hostBaseUrl);
  const activeHost = getActiveHost(baseConfig);

  if (!activeHost) {
    return [createHostProfile(normalizedBaseUrl, now)];
  }

  return baseConfig.hosts.map((host) =>
    host.id === activeHost.id
      ? createHostProfile(normalizedBaseUrl, now, {
          ...host,
          name: buildDefaultHostName(normalizedBaseUrl),
          kind: classifyHostKind(normalizedBaseUrl),
          createdAt: host.createdAt,
          updatedAt: now
        })
      : host
  );
}

function createDefaultConfig(platform: RuntimePlatform): ClientRuntimeConfig {
  const now = nowIsoString();
  return {
    platform,
    activeHostId: DEFAULT_HOST_PROFILE_ID,
    hosts: [createHostProfile(resolveDefaultHostBaseUrl(platform), now)],
    discoveredHosts: [],
    activeDiscoveredHostId: null,
    localHostDiscovery: createDefaultLocalHostDiscoveryState(),
    releaseChannel: "stable",
    autoReconnect: true,
    autoCheckUpdate: platform === "desktop",
    language: detectBrowserLanguage(),
    defaultPermissionMode: "default"
  };
}

function mergeConfig(baseConfig: ClientRuntimeConfig, patch?: RuntimeConfigPatchInput): ClientRuntimeConfig {
  if (!patch || !isRuntimeConfigPatchInput(patch)) {
    return baseConfig;
  }

  const nextPlatform = patch.platform ?? baseConfig.platform;
  const defaultConfig = createDefaultConfig(nextPlatform);
  const now = nowIsoString();

  if (!canConfigureHostBaseUrl(nextPlatform)) {
    return {
      platform: nextPlatform,
      activeHostId: defaultConfig.activeHostId,
      hosts: defaultConfig.hosts,
      discoveredHosts: baseConfig.discoveredHosts,
      activeDiscoveredHostId: null,
      localHostDiscovery: baseConfig.localHostDiscovery,
      releaseChannel: patch.releaseChannel ?? baseConfig.releaseChannel,
      autoReconnect: patch.autoReconnect ?? baseConfig.autoReconnect,
      autoCheckUpdate: patch.autoCheckUpdate ?? baseConfig.autoCheckUpdate,
      language: normalizeLanguage(patch.language ?? baseConfig.language),
      defaultPermissionMode: normalizePermissionMode(
        patch.defaultPermissionMode ?? baseConfig.defaultPermissionMode
      )
    };
  }

  let nextHosts =
    patch.hosts !== undefined ? normalizeHostProfiles(patch.hosts, now) : baseConfig.hosts;

  if (patch.hostBaseUrl) {
    nextHosts = replaceActiveHostBaseUrl(baseConfig, patch.hostBaseUrl, now);
  }

  if (nextHosts.length === 0) {
    nextHosts = defaultConfig.hosts;
  }

  const requestedActiveHostId = patch.activeHostId ?? baseConfig.activeHostId;
  const nextActiveHostId = nextHosts.some((host) => host.id === requestedActiveHostId)
    ? requestedActiveHostId
    : nextHosts[0]?.id ?? null;

  return {
    platform: nextPlatform,
    activeHostId: nextActiveHostId,
    hosts: nextHosts,
    discoveredHosts: baseConfig.discoveredHosts,
    activeDiscoveredHostId:
      baseConfig.activeDiscoveredHostId
      && baseConfig.discoveredHosts.some((host) => host.id === baseConfig.activeDiscoveredHostId)
        ? baseConfig.activeDiscoveredHostId
        : null,
    localHostDiscovery: baseConfig.localHostDiscovery,
    releaseChannel: patch.releaseChannel ?? baseConfig.releaseChannel,
    autoReconnect: patch.autoReconnect ?? baseConfig.autoReconnect,
    autoCheckUpdate: patch.autoCheckUpdate ?? baseConfig.autoCheckUpdate,
    language: normalizeLanguage(patch.language ?? baseConfig.language),
    defaultPermissionMode: normalizePermissionMode(
      patch.defaultPermissionMode ?? baseConfig.defaultPermissionMode
    )
  };
}

function stripRuntimeConfigForPersistence(config: ClientRuntimeConfig): Omit<
  ClientRuntimeConfig,
  "discoveredHosts" | "activeDiscoveredHostId" | "localHostDiscovery"
> {
  return {
    platform: config.platform,
    activeHostId: config.activeHostId,
    hosts: config.hosts,
    releaseChannel: config.releaseChannel,
    autoReconnect: config.autoReconnect,
    autoCheckUpdate: config.autoCheckUpdate,
    language: config.language,
    defaultPermissionMode: config.defaultPermissionMode
  };
}

export function normalizeClientRuntimeConfigSnapshot(
  snapshot: unknown,
  platform: RuntimePlatform
): ClientRuntimeConfig {
  return mergeConfig(createDefaultConfig(platform), snapshot as RuntimeConfigPatchInput);
}

export async function loadClientRuntimeConfig(): Promise<ClientRuntimeConfig> {
  const adapter = createPlatformAdapter();
  const defaultConfig = createDefaultConfig(adapter.platform);
  const localConfig = readStoredConfig();
  let desktopPatch: unknown = null;

  if (adapter.isDesktop) {
    const bridgeResult = await adapter.bridge.readDesktopConfig();

    if (bridgeResult.ok && bridgeResult.value) {
      desktopPatch = bridgeResult.value;
    }
  }

  const config = mergeConfig(mergeConfig(defaultConfig, localConfig as RuntimeConfigPatchInput), desktopPatch as RuntimeConfigPatchInput);
  persistLocalConfig(config);
  return config;
}

export async function persistClientRuntimeConfig(
  config: ClientRuntimeConfig,
  patch?: ClientRuntimeConfigPatch
): Promise<ClientRuntimeConfig> {
  const normalizedConfig = mergeConfig(config, patch);
  persistLocalConfig(normalizedConfig);

  const activeHostBaseUrl = getActiveHost(normalizedConfig)?.baseUrl;

  if (activeHostBaseUrl) {
    syncRememberedLoginServerBaseUrl(activeHostBaseUrl);
  }

  const adapter = createPlatformAdapter();

  if (adapter.isDesktop) {
    await adapter.bridge.writeDesktopConfig(stripRuntimeConfigForPersistence(normalizedConfig));
  }

  return normalizedConfig;
}
