import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "../shared/theme";
import { appRouter } from "./router";

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={appRouter} />
    </ThemeProvider>
  );
}
