import { useSyncExternalStore } from "react";

import type { AppLanguage, ClientPermissionMode } from "../config/client-config-types";
import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import {
  fetchPreferencesProfile,
  updatePreferencesProfile
} from "./preferences-service";
import type {
  AccountPreferenceProviderPatch,
  AccountPreferencesPatch,
  AccountPreferencesProfile,
  PreferenceProviderId,
  PreferenceReasoningLevel,
  PreferenceThemeId
} from "./types";

type Listener = () => void;
type PreferenceSource = "default" | "shadow" | "remote";

interface AccountPreferenceState {
  initialized: boolean;
  profile: {
    language: AppLanguage;
    theme: PreferenceThemeId;
    autoTheme: boolean;
    defaultPermissionMode: ClientPermissionMode;
  };
  providers: AccountPreferencesProfile["providers"];
  updatedAt: string | null;
  source: PreferenceSource;
}

interface StoredPreferenceShadow {
  profile: AccountPreferenceState["profile"];
  providers: AccountPreferenceState["providers"];
  updatedAt: string | null;
}

const PREFERENCE_PROVIDER_IDS: PreferenceProviderId[] = [
  "claude-code",
  "codex",
  "opencode",
  "gemini",
  "kimi"
];
const SHADOW_STORAGE_KEY = "codingns.account.preferences.shadow";
const LEGACY_CLIENT_CONFIG_KEY = "codingns.client.runtime-config";
const LEGACY_THEME_KEY = "codingns-theme";
const LEGACY_MODEL_KEY_PREFIX = "composer-selected-model:";
const LEGACY_REASONING_KEY_PREFIX = "composer-reasoning-level:";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeLanguage(value?: string | null): AppLanguage | null {
  if (value === "en-US" || value === "en") {
    return "en-US";
  }

  if (value === "zh-CN") {
    return "zh-CN";
  }

  return null;
}

function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") {
    return "zh-CN";
  }

  return normalizeLanguage(navigator.language) ?? "zh-CN";
}

function normalizeTheme(value?: string | null): PreferenceThemeId | null {
  if (value === "light" || value === "dark" || value === "sky-blue" || value === "eye-green") {
    return value;
  }

  return null;
}

function getSystemTheme(): PreferenceThemeId {
  if (typeof window === "undefined") {
    return "light";
  }

  if (typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeAutoTheme(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function normalizePermissionMode(value?: string | null): ClientPermissionMode | null {
  if (value === "acceptEdits" || value === "bypassPermissions" || value === "default") {
    return value;
  }

  return null;
}

function normalizeReasoningLevel(value?: string | null): PreferenceReasoningLevel | null {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }

  return null;
}

function createDefaultProviders(): AccountPreferenceState["providers"] {
  return {
    "claude-code": {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    codex: {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    opencode: {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    gemini: {
      defaultModel: null,
      defaultReasoningLevel: null
    },
    kimi: {
      defaultModel: null,
      defaultReasoningLevel: null
    }
  };
}

function createDefaultState(): AccountPreferenceState {
  return {
    initialized: true,
    profile: {
      language: detectBrowserLanguage(),
      theme: getSystemTheme(),
      autoTheme: false,
      defaultPermissionMode: "default"
    },
    providers: createDefaultProviders(),
    updatedAt: null,
    source: "default"
  };
}

function readLegacyClientConfig(): Partial<{
  language: AppLanguage;
  defaultPermissionMode: ClientPermissionMode;
}> {
  const currentConfig = clientConfigStore.getState() as Partial<{
    language: AppLanguage;
    defaultPermissionMode: ClientPermissionMode;
  }>;

  const fallback = {
    language: currentConfig.language,
    defaultPermissionMode: currentConfig.defaultPermissionMode
  };

  if (!canUseLocalStorage()) {
    return fallback;
  }

  const raw = window.localStorage.getItem(LEGACY_CLIENT_CONFIG_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as {
      language?: string;
      defaultPermissionMode?: string;
    };

    return {
      language: normalizeLanguage(parsed.language) ?? fallback.language,
      defaultPermissionMode:
        normalizePermissionMode(parsed.defaultPermissionMode) ?? fallback.defaultPermissionMode
    };
  } catch {
    return fallback;
  }
}

function readLegacyTheme(): PreferenceThemeId | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  return normalizeTheme(window.localStorage.getItem(LEGACY_THEME_KEY));
}

function readLegacyProviderPatch(): AccountPreferencesPatch["providers"] {
  if (!canUseLocalStorage()) {
    return undefined;
  }

  const providers: NonNullable<AccountPreferencesPatch["providers"]> = {};

  for (const provider of PREFERENCE_PROVIDER_IDS) {
    const defaultModel = window.localStorage.getItem(`${LEGACY_MODEL_KEY_PREFIX}${provider}`)?.trim() || null;
    const defaultReasoningLevel = normalizeReasoningLevel(
      window.localStorage.getItem(`${LEGACY_REASONING_KEY_PREFIX}${provider}`)
    );

    if (defaultModel === null && defaultReasoningLevel === null) {
      continue;
    }

    providers[provider] = {
      defaultModel,
      defaultReasoningLevel
    };
  }

  return Object.keys(providers).length > 0 ? providers : undefined;
}

function readLegacyPatch(): AccountPreferencesPatch | null {
  const clientConfig = readLegacyClientConfig();
  const theme = readLegacyTheme();
  const providers = readLegacyProviderPatch();

  const patch: AccountPreferencesPatch = {};

  if (clientConfig.language) {
    patch.language = clientConfig.language;
  }

  if (theme) {
    patch.theme = theme;
  }

  if (clientConfig.defaultPermissionMode) {
    patch.defaultPermissionMode = clientConfig.defaultPermissionMode;
  }

  if (providers) {
    patch.providers = providers;
  }

  return hasPatchContent(patch) ? patch : null;
}

function hasPatchContent(patch: AccountPreferencesPatch | null | undefined): boolean {
  if (!patch) {
    return false;
  }

  return (
    patch.language !== undefined ||
    patch.theme !== undefined ||
    patch.autoTheme !== undefined ||
    patch.defaultPermissionMode !== undefined ||
    (patch.providers !== undefined && Object.keys(patch.providers).length > 0)
  );
}

function normalizeProfile(
  input: Partial<AccountPreferencesProfile> | null | undefined
): AccountPreferencesProfile {
  const defaults = createDefaultState();
  const providers = createDefaultProviders();

  for (const provider of PREFERENCE_PROVIDER_IDS) {
    const source = input?.providers?.[provider];
    providers[provider] = {
      defaultModel: typeof source?.defaultModel === "string" ? source.defaultModel.trim() || null : null,
      defaultReasoningLevel: normalizeReasoningLevel(source?.defaultReasoningLevel) ?? null
    };
  }

  return {
    language: normalizeLanguage(input?.language) ?? defaults.profile.language,
    theme: normalizeTheme(input?.theme) ?? defaults.profile.theme,
    autoTheme: normalizeAutoTheme(input?.autoTheme) ?? defaults.profile.autoTheme,
    defaultPermissionMode:
      normalizePermissionMode(input?.defaultPermissionMode) ?? defaults.profile.defaultPermissionMode,
    providers,
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : null
  };
}

function readShadow(): StoredPreferenceShadow | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(SHADOW_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPreferenceShadow>;
    const normalized = normalizeProfile({
      language: parsed.profile?.language,
      theme: parsed.profile?.theme,
      autoTheme: parsed.profile?.autoTheme,
      defaultPermissionMode: parsed.profile?.defaultPermissionMode,
      providers: parsed.providers,
      updatedAt: parsed.updatedAt
    });

    return {
      profile: {
        language: normalized.language,
        theme: normalized.theme,
        autoTheme: normalized.autoTheme,
        defaultPermissionMode: normalized.defaultPermissionMode
      },
      providers: normalized.providers,
      updatedAt: normalized.updatedAt
    };
  } catch {
    return null;
  }
}

function writeShadow(state: AccountPreferenceState): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const shadow: StoredPreferenceShadow = {
    profile: state.profile,
    providers: state.providers,
    updatedAt: state.updatedAt
  };

  window.localStorage.setItem(SHADOW_STORAGE_KEY, JSON.stringify(shadow));
}

function createFallbackState(): AccountPreferenceState {
  const defaults = createDefaultState();
  const legacyPatch = readLegacyPatch();
  const withLegacy = legacyPatch ? applyPatch(defaults, legacyPatch, "default") : defaults;
  const shadow = readShadow();

  if (!shadow) {
    return withLegacy;
  }

  return {
    initialized: true,
    profile: shadow.profile,
    providers: shadow.providers,
    updatedAt: shadow.updatedAt,
    source: "shadow"
  };
}

function createStateFromProfile(
  profile: AccountPreferencesProfile,
  source: PreferenceSource
): AccountPreferenceState {
  return {
    initialized: true,
    profile: {
      language: profile.language,
      theme: profile.theme,
      autoTheme: profile.autoTheme,
      defaultPermissionMode: profile.defaultPermissionMode
    },
    providers: profile.providers,
    updatedAt: profile.updatedAt,
    source
  };
}

function applyPatch(
  current: AccountPreferenceState,
  patch: AccountPreferencesPatch,
  source: PreferenceSource
): AccountPreferenceState {
  const nextProviders = {
    ...current.providers
  };

  if (patch.providers) {
    for (const provider of PREFERENCE_PROVIDER_IDS) {
      const providerPatch = patch.providers[provider];

      if (!providerPatch) {
        continue;
      }

      nextProviders[provider] = {
        defaultModel:
          providerPatch.defaultModel !== undefined
            ? providerPatch.defaultModel ?? null
            : current.providers[provider].defaultModel,
        defaultReasoningLevel:
          providerPatch.defaultReasoningLevel !== undefined
            ? providerPatch.defaultReasoningLevel ?? null
            : current.providers[provider].defaultReasoningLevel
      };
    }
  }

  return {
    initialized: true,
    profile: {
      language: patch.language ?? current.profile.language,
      theme: patch.theme ?? current.profile.theme,
      autoTheme: patch.autoTheme ?? current.profile.autoTheme,
      defaultPermissionMode: patch.defaultPermissionMode ?? current.profile.defaultPermissionMode
    },
    providers: nextProviders,
    updatedAt: current.updatedAt,
    source
  };
}

async function fetchRemoteStateWithMigration(): Promise<AccountPreferenceState> {
  const remoteProfile = normalizeProfile(await fetchPreferencesProfile());

  if (remoteProfile.updatedAt === null) {
    const legacyPatch = readLegacyPatch();

    if (hasPatchContent(legacyPatch)) {
      const migrated = normalizeProfile(await updatePreferencesProfile(legacyPatch!));
      const nextState = createStateFromProfile(migrated, "remote");
      writeShadow(nextState);
      return nextState;
    }
  }

  const nextState = createStateFromProfile(remoteProfile, "remote");
  writeShadow(nextState);
  return nextState;
}

class UserPreferenceStore {
  private state: AccountPreferenceState = createFallbackState();
  private listeners = new Set<Listener>();

  constructor() {
    clientConfigStore.subscribe(() => {
      if (authStore.getState().session || this.state.source === "remote") {
        return;
      }

      this.hydrate(createFallbackState());
    });
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  hydrate(state: AccountPreferenceState): void {
    this.state = state;
    this.emit();
  }

  resetToLocalFallback(): void {
    this.hydrate(createFallbackState());
  }

  async initialize(): Promise<AccountPreferenceState> {
    if (!authStore.getState().session) {
      const nextState = createFallbackState();
      this.hydrate(nextState);
      return nextState;
    }

    return this.refreshForAuthenticatedUser();
  }

  async refreshForAuthenticatedUser(): Promise<AccountPreferenceState> {
    if (!authStore.getState().session) {
      const nextState = createFallbackState();
      this.hydrate(nextState);
      return nextState;
    }

    try {
      const nextState = await fetchRemoteStateWithMigration();
      this.hydrate(nextState);
      return nextState;
    } catch {
      const nextState = createFallbackState();
      this.hydrate(nextState);
      return nextState;
    }
  }

  async updateProfile(patch: AccountPreferencesPatch): Promise<AccountPreferenceState> {
    const previous = this.state;
    const optimistic = applyPatch(previous, patch, previous.source);
    this.hydrate(optimistic);

    if (!authStore.getState().session) {
      writeShadow(optimistic);
      return optimistic;
    }

    try {
      const remote = normalizeProfile(await updatePreferencesProfile(patch));
      const nextState = createStateFromProfile(remote, "remote");
      writeShadow(nextState);
      this.hydrate(nextState);
      return nextState;
    } catch (error) {
      this.hydrate(previous);
      throw error;
    }
  }

  async updateProviderPreference(
    provider: PreferenceProviderId,
    patch: AccountPreferenceProviderPatch
  ): Promise<AccountPreferenceState> {
    return this.updateProfile({
      providers: {
        [provider]: patch
      }
    });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const userPreferenceStore = new UserPreferenceStore();

export function useUserPreferenceSelector<T>(
  selector: (state: AccountPreferenceState) => T
): T {
  return useSyncExternalStore(
    userPreferenceStore.subscribe,
    () => selector(userPreferenceStore.getState())
  );
}

export function isPreferenceProviderId(value: string): value is PreferenceProviderId {
  return PREFERENCE_PROVIDER_IDS.includes(value as PreferenceProviderId);
}
