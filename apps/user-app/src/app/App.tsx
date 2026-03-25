import { RouterProvider } from "react-router-dom";

import { useClientConfigSelector } from "../config/client-config-store";
import { PlatformProvider } from "../platform/platform-provider";
import { I18nProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { appRouter } from "./router";

export function App() {
  const language = useClientConfigSelector((state) => state.language);

  return (
    <PlatformProvider>
      <I18nProvider language={language}>
        <ThemeProvider>
          <ToastProvider>
            <RouterProvider router={appRouter} />
          </ToastProvider>
        </ThemeProvider>
      </I18nProvider>
    </PlatformProvider>
  );
}
