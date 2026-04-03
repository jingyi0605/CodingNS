import type { AppLanguage, ClientPermissionMode } from "../config/client-config-types";

export type PreferenceProviderId =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "kimi";
export type PreferenceThemeId = "light" | "dark" | "sky-blue" | "eye-green";
export type PreferenceReasoningLevel = "low" | "medium" | "high" | "xhigh";

export interface AccountPreferenceProviderProfile {
  defaultModel: string | null;
  defaultReasoningLevel: PreferenceReasoningLevel | null;
}

export interface AccountPreferencesProfile {
  language: AppLanguage;
  theme: PreferenceThemeId;
  defaultPermissionMode: ClientPermissionMode;
  providers: Record<PreferenceProviderId, AccountPreferenceProviderProfile>;
  updatedAt: string | null;
}

export interface AccountPreferenceProviderPatch {
  defaultModel?: string | null;
  defaultReasoningLevel?: PreferenceReasoningLevel | null;
}

export interface AccountPreferencesPatch {
  language?: AppLanguage;
  theme?: PreferenceThemeId;
  defaultPermissionMode?: ClientPermissionMode;
  providers?: Partial<Record<PreferenceProviderId, AccountPreferenceProviderPatch>>;
}
