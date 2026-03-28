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
import { useWorkbenchShell } from "../features/conversation/components/WorkbenchLayout";
import { SessionIndexPage } from "../features/mobile-sessions/pages/SessionIndexPage";
import { ToolFilesPage } from "../features/mobile-tools/ToolFilesPage";
import { ToolGitPage } from "../features/mobile-tools/ToolGitPage";
import { ToolProcessesPage } from "../features/mobile-tools/ToolProcessesPage";
import { ToolsHomePage } from "../features/mobile-tools/ToolsHomePage";
import { WorkspaceHomePage } from "../features/mobile-workspaces/pages/WorkspaceHomePage";
import { WorkspaceDetailPage } from "../features/mobile-workspaces/pages/WorkspaceDetailPage";
import { WorkbenchShellRoute } from "../features/workbench/components/WorkbenchShellRoute";
import { WorkbenchLandingPage } from "../features/workbench/pages/WorkbenchLandingPage";
import { SettingsPage } from "../features/settings/pages/SettingsPage";

function RequireAuth() {
  const session = useAuthSelector((state) => state.session);
  const location = useLocation();

  if (!session) {
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

function WorkbenchIndexRedirect() {
  const { shellMode } = useWorkbenchShell();

  return <Navigate to={shellMode === "mobile" ? "/workspaces" : "/landing"} replace />;
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
            element: <WorkbenchIndexRedirect />
          },
          {
            path: "landing",
            element: <WorkbenchLandingPage />
          },
          {
            path: "workspaces",
            element: <WorkspaceHomePage />
          },
          {
            path: "workspaces/:workspaceId",
            element: <WorkspaceDetailPage />
          },
          {
            path: "workspaces/:workspaceId/sessions",
            element: <SessionIndexPage />
          },
          {
            path: "workspaces/:workspaceId/sessions/:sessionId",
            element: <ConversationPage />
          },
          {
            path: "workspaces/:workspaceId/tools",
            element: <ToolsHomePage />
          },
          {
            path: "workspaces/:workspaceId/tools/files",
            element: <ToolFilesPage />
          },
          {
            path: "workspaces/:workspaceId/tools/git",
            element: <ToolGitPage />
          },
          {
            path: "workspaces/:workspaceId/tools/processes",
            element: <ToolProcessesPage />
          },
          {
            path: "workspaces/:workspaceId/terminals",
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
          },
          {
            path: "settings/:section",
            element: <SettingsPage />
          },
          {
            path: "*",
            element: <WorkbenchIndexRedirect />
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
