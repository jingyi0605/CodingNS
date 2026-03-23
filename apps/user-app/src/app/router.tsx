import { Navigate, Outlet, createBrowserRouter, useLocation } from "react-router-dom";

import { BootstrapPage } from "../features/auth/pages/BootstrapPage";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { WorkbenchLayout } from "../features/conversation/components/WorkbenchLayout";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { ConversationHomePage } from "../features/conversation/pages/ConversationHomePage";
import { ConversationPage } from "../features/conversation/pages/ConversationPage";

function RequireAuth() {
  const status = useAuthSelector((state) => state.status);
  const location = useLocation();

  if (status !== "authenticated") {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}

export const appRouter = createBrowserRouter([
  {
    path: "/bootstrap",
    element: <BootstrapPage />
  },
  {
    path: "/login",
    element: <LoginPage />
  },
  {
    path: "/",
    element: <RequireAuth />,
    children: [
      {
        element: <WorkbenchLayout />,
        children: [
          {
            index: true,
            element: <ConversationHomePage />
          },
          {
            path: "sessions/:sessionId",
            element: <ConversationPage />
          },
          {
            path: "terminals",
            lazy: async () => {
              const module = await import("../features/terminal/pages/TerminalPage");

              return {
                Component: module.TerminalPage
              };
            }
          }
        ]
      }
    ]
  }
]);
