import { useSyncExternalStore } from "react";

export type ThemeId = "light" | "dark" | "sky-blue" | "eye-green";

export const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: "light", label: "浅色", color: "#ffffff" },
  { id: "dark", label: "深色", color: "#1a1a2e" },
  { id: "sky-blue", label: "天空蓝", color: "#2563eb" },
  { id: "eye-green", label: "护眼绿", color: "#16a34a" }
];

const STORAGE_KEY = "codingns-theme";

function getSystemTheme(): ThemeId {
  if (typeof window === "undefined") return "light";
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function getStoredTheme(): ThemeId | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && THEMES.some((t) => t.id === stored)) {
    return stored as ThemeId;
  }
  return null;
}

export function getInitialTheme(): ThemeId {
  return getStoredTheme() ?? getSystemTheme();
}

export function setTheme(themeId: ThemeId): void {
  if (typeof window === "undefined") return;
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
  if (typeof window === "undefined") return "light";
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme && THEMES.some((t) => t.id === theme)) {
    return theme as ThemeId;
  }
  return getInitialTheme();
}

export function useTheme(): { theme: ThemeId; setTheme: (id: ThemeId) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "light");

  return {
    theme,
    setTheme: (id: ThemeId) => {
      setTheme(id);
      window.dispatchEvent(new Event("storage"));
    }
  };
}

export function initTheme(): void {
  const theme = getInitialTheme();
  setTheme(theme);
}
