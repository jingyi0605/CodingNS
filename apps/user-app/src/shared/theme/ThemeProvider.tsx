import { useEffect, type ReactNode } from "react";

import { usePreferencesSelector } from "../../preferences/preferences-store";
import { initTheme } from "./theme";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const preferenceTheme = usePreferencesSelector((state) => state.profile.theme);

  useEffect(() => {
    initTheme();
  }, [preferenceTheme]);

  return <>{children}</>;
}
