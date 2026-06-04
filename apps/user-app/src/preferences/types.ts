import type { AppLanguage, ClientPermissionMode } from "../config/client-config-types";
import type { AffairsWorkbenchDashboardState } from "../features/workbench/types/workbench-mode";

export type PreferenceProviderId =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "kimi";
export type PreferenceThemeId = "light" | "dark" | "sky-blue" | "eye-green";
export type PreferenceReasoningLevel = "low" | "medium" | "high" | "xhigh";
export type DebugPortPoolRole = "frontend" | "backend" | "worker" | "mock" | "custom";

export interface DebugPortPoolRange {
  start: number;
  end: number;
}

export type DebugPortPoolConfig = DebugPortPoolRange;

export interface AccountPreferenceProviderProfile {
  defaultModel: string | null;
  defaultReasoningLevel: PreferenceReasoningLevel | null;
}

export interface AccountPreferencesProfile {
  language: AppLanguage;
  theme: PreferenceThemeId;
  autoTheme: boolean;
  defaultPermissionMode: ClientPermissionMode;
  providers: Record<PreferenceProviderId, AccountPreferenceProviderProfile>;
  debugPortPools?: DebugPortPoolConfig;
  affairsDashboardStatesByWorkspace?: Record<string, AffairsWorkbenchDashboardState>;
  updatedAt: string | null;
}

export interface AccountPreferenceProviderPatch {
  defaultModel?: string | null;
  defaultReasoningLevel?: PreferenceReasoningLevel | null;
}

export interface AccountPreferencesPatch {
  language?: AppLanguage;
  theme?: PreferenceThemeId;
  autoTheme?: boolean;
  defaultPermissionMode?: ClientPermissionMode;
  providers?: Partial<Record<PreferenceProviderId, AccountPreferenceProviderPatch>>;
  debugPortPools?: DebugPortPoolConfig;
  affairsDashboardStatesByWorkspace?: Record<string, AffairsWorkbenchDashboardState>;
}
