import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "../shared/theme";
import { ToastProvider } from "../shared/toast";
import { appRouter } from "./router";

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={appRouter} />
      </ToastProvider>
    </ThemeProvider>
  );
}
