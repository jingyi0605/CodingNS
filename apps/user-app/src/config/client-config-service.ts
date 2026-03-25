import {
  type AppLanguage,
  type ClientRuntimeConfig,
  type ClientRuntimeConfigPatch,
  type RuntimePlatform
} from "./client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { normalizeServerBaseUrl } from "./server-config-shared";

const STORAGE_KEY = "codingns.client.runtime-config";

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

function createDefaultConfig(platform: RuntimePlatform): ClientRuntimeConfig {
  return {
    platform,
    hostBaseUrl: normalizeServerBaseUrl("http://127.0.0.1:3002"),
    releaseChannel: "stable",
    autoReconnect: true,
    autoCheckUpdate: platform === "desktop",
    language: detectBrowserLanguage()
  };
}

function mergeConfig(
  baseConfig: ClientRuntimeConfig,
  patch?: Partial<ClientRuntimeConfig> | null
): ClientRuntimeConfig {
  if (!patch) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    ...patch,
    hostBaseUrl: patch.hostBaseUrl
      ? normalizeServerBaseUrl(patch.hostBaseUrl)
      : baseConfig.hostBaseUrl,
    platform: patch.platform ?? baseConfig.platform,
    releaseChannel: patch.releaseChannel ?? baseConfig.releaseChannel,
    autoReconnect: patch.autoReconnect ?? baseConfig.autoReconnect,
    autoCheckUpdate: patch.autoCheckUpdate ?? baseConfig.autoCheckUpdate,
    language: normalizeLanguage(patch.language ?? baseConfig.language)
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
