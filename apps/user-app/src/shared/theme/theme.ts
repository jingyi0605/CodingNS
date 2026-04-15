import { usePreferencesSelector, updatePreferences } from "../../preferences/preferences-store";
import { userPreferenceStore } from "../../preferences/user-preference-store";
import { t } from "../i18n";

export type ThemeId = "light" | "dark" | "sky-blue" | "eye-green";

export interface ThemeDefinition {
  id: ThemeId;
  labelKey: string;
  color: string;
}

export const THEMES: ThemeDefinition[] = [
  { id: "light", labelKey: "theme.light", color: "#f6f4ef" },
  { id: "dark", labelKey: "theme.dark", color: "#1b1b1b" },
  { id: "sky-blue", labelKey: "theme.skyBlue", color: "#00f0ff" },
  { id: "eye-green", labelKey: "theme.eyeGreen", color: "#16a34a" }
];

export function getThemeLabel(theme: ThemeDefinition): string {
  return t(theme.labelKey);
}

function getSystemTheme(): Extract<ThemeId, "light" | "dark"> {
  if (typeof window === "undefined") {
    return "light";
  }

  if (typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: ThemeId, autoTheme: boolean): ThemeId {
  if (!autoTheme) {
    return theme;
  }

  return getSystemTheme();
}

export function getInitialTheme(): ThemeId {
  const { theme, autoTheme } = userPreferenceStore.getState().profile;
  return resolveTheme(theme, autoTheme);
}

export function setTheme(themeId: ThemeId): void {
  void updatePreferences({
    theme: themeId,
    autoTheme: false
  }).catch(() => undefined);
}

export function setAutoTheme(enabled: boolean): void {
  void updatePreferences({
    autoTheme: enabled
  }).catch(() => undefined);
}

export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", themeId);
}

export function useTheme(): {
  theme: ThemeId;
  selectedTheme: ThemeId;
  autoTheme: boolean;
  setTheme: (id: ThemeId) => void;
  setAutoTheme: (enabled: boolean) => void;
} {
  const selectedTheme = usePreferencesSelector((state) => state.profile.theme) as ThemeId;
  const autoTheme = usePreferencesSelector((state) => state.profile.autoTheme);
  const theme = resolveTheme(selectedTheme, autoTheme);

  return {
    theme,
    selectedTheme,
    autoTheme,
    setTheme,
    setAutoTheme
  };
}

export function initTheme(): void {
  applyThemeToDocument(getInitialTheme());
}
