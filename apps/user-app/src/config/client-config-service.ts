import {
  type AppLanguage,
  type ClientPermissionMode,
  type ClientRuntimeConfig,
  type ClientRuntimeConfigPatch,
  type RuntimePlatform
} from "./client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { normalizeServerBaseUrl } from "./server-config-shared";

const STORAGE_KEY = "codingns.client.runtime-config";

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

function readStoredConfig(): Partial<ClientRuntimeConfig> | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Partial<ClientRuntimeConfig>;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistLocalConfig(config: ClientRuntimeConfig): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
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

function createDefaultConfig(platform: RuntimePlatform): ClientRuntimeConfig {
  return {
    platform,
    hostBaseUrl: resolveDefaultHostBaseUrl(platform),
    releaseChannel: "stable",
    autoReconnect: true,
    autoCheckUpdate: platform === "desktop",
    language: detectBrowserLanguage(),
    defaultPermissionMode: "default"
  };
}

function mergeConfig(
  baseConfig: ClientRuntimeConfig,
  patch?: Partial<ClientRuntimeConfig> | null
): ClientRuntimeConfig {
  if (!patch) {
    return baseConfig;
  }

  const nextPlatform = patch.platform ?? baseConfig.platform;

  return {
    ...baseConfig,
    ...patch,
    hostBaseUrl: canConfigureHostBaseUrl(nextPlatform)
      ? patch.hostBaseUrl
        ? normalizeServerBaseUrl(patch.hostBaseUrl)
        : baseConfig.hostBaseUrl
      : resolveDefaultHostBaseUrl(nextPlatform),
    platform: nextPlatform,
    releaseChannel: patch.releaseChannel ?? baseConfig.releaseChannel,
    autoReconnect: patch.autoReconnect ?? baseConfig.autoReconnect,
    autoCheckUpdate: patch.autoCheckUpdate ?? baseConfig.autoCheckUpdate,
    language: normalizeLanguage(patch.language ?? baseConfig.language),
    defaultPermissionMode: normalizePermissionMode(
      patch.defaultPermissionMode ?? baseConfig.defaultPermissionMode
    )
  };
}

export async function loadClientRuntimeConfig(): Promise<ClientRuntimeConfig> {
  const adapter = createPlatformAdapter();
  const defaultConfig = createDefaultConfig(adapter.platform);
  const localConfig = readStoredConfig();
  let desktopPatch: Partial<ClientRuntimeConfig> | null = null;

  if (adapter.isDesktop) {
    const bridgeResult = await adapter.bridge.readDesktopConfig();

    if (bridgeResult.ok && bridgeResult.value) {
      desktopPatch = bridgeResult.value;
    }
  }

  const config = mergeConfig(mergeConfig(defaultConfig, localConfig), desktopPatch);
  persistLocalConfig(config);
  return config;
}

export async function persistClientRuntimeConfig(
  config: ClientRuntimeConfig,
  patch?: ClientRuntimeConfigPatch
): Promise<ClientRuntimeConfig> {
  const normalizedConfig = mergeConfig(config, patch);
  persistLocalConfig(normalizedConfig);

  const adapter = createPlatformAdapter();

  if (adapter.isDesktop) {
    await adapter.bridge.writeDesktopConfig(normalizedConfig);
  }

  return normalizedConfig;
}
