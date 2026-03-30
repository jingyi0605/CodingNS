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

function getSystemTheme(): ThemeId {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getInitialTheme(): ThemeId {
  return userPreferenceStore.getState().profile.theme ?? getSystemTheme();
}

export function setTheme(themeId: ThemeId): void {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", themeId);
  void updatePreferences({
    theme: themeId
  }).catch(() => undefined);
}

export function useTheme(): { theme: ThemeId; setTheme: (id: ThemeId) => void } {
  const theme = usePreferencesSelector((state) => state.profile.theme) as ThemeId;

  return {
    theme,
    setTheme
  };
}

export function initTheme(): void {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", getInitialTheme());
}
