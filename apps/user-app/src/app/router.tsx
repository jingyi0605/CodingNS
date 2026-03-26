import {
  Navigate,
  Outlet,
  createBrowserRouter,
  createMemoryRouter,
  useLocation
} from "react-router-dom";

import { BootstrapPage } from "../features/auth/pages/BootstrapPage";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { ConversationPage } from "../features/conversation/pages/ConversationPage";
import { SessionIndexPage } from "../features/mobile-sessions/pages/SessionIndexPage";
import { ToolFilesPage } from "../features/mobile-tools/ToolFilesPage";
import { ToolGitPage } from "../features/mobile-tools/ToolGitPage";
import { ToolProcessesPage } from "../features/mobile-tools/ToolProcessesPage";
import { ToolsHomePage } from "../features/mobile-tools/ToolsHomePage";
import { WorkspaceDetailPage } from "../features/mobile-workspaces/pages/WorkspaceDetailPage";
import { WorkbenchShellRoute } from "../features/workbench/components/WorkbenchShellRoute";
import { WorkbenchLandingPage } from "../features/workbench/pages/WorkbenchLandingPage";
import { SettingsPage } from "../features/settings/pages/SettingsPage";

function RequireAuth() {
  const status = useAuthSelector((state) => state.status);
  const location = useLocation();

  if (status !== "authenticated") {
    const returnTo = `${location.pathname}${location.search}`;

    if (import.meta.env.MODE === "test") {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", `/login?returnTo=${encodeURIComponent(returnTo)}`);
      }

      return <LoginPage />;
    }

    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}

const appRoutes = [
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
        element: <WorkbenchShellRoute />,
        children: [
          {
            index: true,
            element: <WorkbenchLandingPage />
          },
          {
            path: "workspaces/:workspaceId",
            element: <WorkspaceDetailPage />
          },
          {
            path: "sessions",
            element: <SessionIndexPage />
          },
          {
            path: "sessions/:sessionId",
            element: <ConversationPage />
          },
          {
            path: "tools",
            element: <ToolsHomePage />
          },
          {
            path: "tools/files",
            element: <ToolFilesPage />
          },
          {
            path: "tools/git",
            element: <ToolGitPage />
          },
          {
            path: "tools/processes",
            element: <ToolProcessesPage />
          },
          {
            path: "terminals",
            lazy: async () => {
              const module = await import("../features/terminal/pages/TerminalPage");

              return {
                Component: module.TerminalPage
              };
            }
          },
          {
            path: "settings",
            element: <SettingsPage />
          }
        ]
      }
    ]
  }
];

export function createAppRouter() {
  if (import.meta.env.MODE === "test") {
    const initialEntry =
      typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;

    return createMemoryRouter(appRoutes, {
      initialEntries: [initialEntry]
    });
  }

  return createBrowserRouter(appRoutes);
}
