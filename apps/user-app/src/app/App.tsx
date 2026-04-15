import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import { PlatformProvider } from "../platform/platform-provider";
import { usePreferencesSelector } from "../preferences/preferences-store";
import { I18nProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { AppVersionProvider } from "../shared/version/app-version";
import { DesktopAutoUpdateEffect } from "./DesktopAutoUpdateEffect";
import { createAppRouter } from "./router";
import "../settings/update-panels.css";

export function App() {
  const language = usePreferencesSelector((state) => state.profile.language);
  const router = useMemo(() => createAppRouter(), []);

  return (
    <PlatformProvider>
      <AppVersionProvider>
        <I18nProvider language={language}>
          <ThemeProvider>
            <ToastProvider>
              <DesktopAutoUpdateEffect />
              <RouterProvider router={router} />
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </AppVersionProvider>
    </PlatformProvider>
  );
}
