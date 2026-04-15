import { useEffect, type ReactNode } from "react";

import { usePreferencesSelector } from "../../preferences/preferences-store";
import { applyThemeToDocument, initTheme } from "./theme";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const preferenceTheme = usePreferencesSelector((state) => state.profile.theme);
  const autoTheme = usePreferencesSelector((state) => state.profile.autoTheme);

  useEffect(() => {
    initTheme();
  }, [preferenceTheme, autoTheme]);

  useEffect(() => {
    if (!autoTheme || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyThemeToDocument(mediaQuery.matches ? "dark" : "light");
    };

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [autoTheme]);

  return <>{children}</>;
}
