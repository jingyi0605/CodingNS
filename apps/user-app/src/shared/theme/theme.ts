import { useSyncExternalStore } from "react";

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
  { id: "sky-blue", labelKey: "theme.skyBlue", color: "#2563eb" },
  { id: "eye-green", labelKey: "theme.eyeGreen", color: "#16a34a" }
];

const STORAGE_KEY = "codingns-theme";

export function getThemeLabel(theme: ThemeDefinition): string {
  return t(theme.labelKey);
}

function getSystemTheme(): ThemeId {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): ThemeId | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored && THEMES.some((theme) => theme.id === stored)) {
    return stored as ThemeId;
  }

  return null;
}

export function getInitialTheme(): ThemeId {
  return getStoredTheme() ?? getSystemTheme();
}

export function setTheme(themeId: ThemeId): void {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", themeId);
  localStorage.setItem(STORAGE_KEY, themeId);
}

function subscribe(callback: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

function getSnapshot(): ThemeId {
  if (typeof window === "undefined") {
    return "light";
  }

  const theme = document.documentElement.getAttribute("data-theme");
  if (theme && THEMES.some((item) => item.id === theme)) {
    return theme as ThemeId;
  }

  return getInitialTheme();
}

export function useTheme(): { theme: ThemeId; setTheme: (id: ThemeId) => void } {
  const theme = useSyncExternalStore<ThemeId>(subscribe, getSnapshot, () => "light");

  return {
    theme,
    setTheme: (id: ThemeId) => {
      setTheme(id);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    }
  };
}

export function initTheme(): void {
  setTheme(getInitialTheme());
}
