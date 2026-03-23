import { useEffect, type ReactNode } from "react";

import { initTheme } from "./theme";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    initTheme();
  }, []);

  return <>{children}</>;
}
