import { RouterProvider } from "react-router-dom";

import { PlatformProvider } from "../platform/platform-provider";
import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { appRouter } from "./router";

export function App() {
  return (
    <PlatformProvider>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={appRouter} />
        </ToastProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}
