import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import { useClientConfigSelector } from "../config/client-config-store";
import { PlatformProvider } from "../platform/platform-provider";
import { I18nProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { AppVersionProvider } from "../shared/version/app-version";
import { createAppRouter } from "./router";

export function App() {
  const language = useClientConfigSelector((state) => state.language);
  const router = useMemo(() => createAppRouter(), []);

  return (
    <PlatformProvider>
      <AppVersionProvider>
        <I18nProvider language={language}>
          <ThemeProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </AppVersionProvider>
    </PlatformProvider>
  );
}
