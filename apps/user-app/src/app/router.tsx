import type { ComponentType, ReactNode } from "react";
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  createMemoryRouter,
  useLocation
} from "react-router-dom";

import { useClientConfigSelector } from "../config/client-config-store";
import { useHostRuntimeBoundaryKey } from "../config/host-runtime-store";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { TrustedEntryLandingPage } from "../features/auth/pages/TrustedEntryLandingPage";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { resolveWorkbenchShellMode } from "../features/workbench/components/workbench-shell-mode";
import { usePlatform } from "../platform/platform-provider";
import { shouldShowTrustedEntryLanding } from "../config/trusted-entry-mode";
import { t } from "../shared/i18n";

function RuntimeResetBoundary({
  runtimeKey,
  children
}: {
  runtimeKey: string;
  children: ReactNode;
}) {
  return <div key={runtimeKey}>{children}</div>;
}

function AuthenticatedRuntimeOutlet() {
  const runtimeKey = useHostRuntimeBoundaryKey();

  return (
    <RuntimeResetBoundary runtimeKey={runtimeKey}>
      <Outlet />
    </RuntimeResetBoundary>
  );
}

function RequireAuth() {
  const config = useClientConfigSelector((state) => state);
  const platform = usePlatform();
  const session = useAuthSelector((state) => state.session);
  const sessionReady = useAuthSelector((state) => state.sessionReady);
  const location = useLocation();

  if (shouldShowTrustedEntryLanding(config, platform.platform)) {
    return <TrustedEntryLandingPage />;
  }

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

  if (!sessionReady) {
    return <div>{t("common.loading")}</div>;
  }

  return <AuthenticatedRuntimeOutlet />;
}

function TrustedEntryAwareLoginPage() {
  const config = useClientConfigSelector((state) => state);
  const platform = usePlatform();

  if (shouldShowTrustedEntryLanding(config, platform.platform)) {
    return <TrustedEntryLandingPage />;
  }

  return <LoginPage />;
}

function WorkbenchIndexRedirect() {
  const platform = usePlatform();
  const shellMode = resolveWorkbenchShellMode(platform);

  return <Navigate to={shellMode === "mobile" ? "/workspaces" : "/landing"} replace />;
}

function lazyRouteComponent<T extends Record<string, unknown>, K extends keyof T>(
  load: () => Promise<T>,
  exportName: K
) {
  return async () => {
    const module = await load();

    return {
      Component: module[exportName] as ComponentType<object>
    };
  };
}

const appRoutes = [
  {
    path: "/bootstrap",
    lazy: lazyRouteComponent(
      () => import("../features/auth/pages/BootstrapPage"),
      "BootstrapPage"
    )
  },
  {
    path: "/login",
    element: <TrustedEntryAwareLoginPage />
  },
  {
    path: "/connect/:tunnelDomain",
    lazy: lazyRouteComponent(
      () => import("../features/auth/pages/RelayConnectEntryPage"),
      "RelayConnectEntryPage"
    )
  },
  {
    path: "/desktop-window-preview",
    lazy: lazyRouteComponent(
      () => import("../features/desktop-window/DesktopDetachPreviewPage"),
      "DesktopDetachPreviewPage"
    )
  },
  {
    path: "/",
    element: <RequireAuth />,
    children: [
      {
        path: "desktop-window/:windowId",
        lazy: lazyRouteComponent(
          () => import("../features/desktop-window/DesktopWindowPage"),
          "DesktopWindowPage"
        )
      },
      {
        lazy: lazyRouteComponent(
          () => import("../features/workbench/components/WorkbenchShellRoute"),
          "WorkbenchShellRoute"
        ),
        children: [
          {
            index: true,
            element: <WorkbenchIndexRedirect />
          },
          {
            path: "landing",
            lazy: lazyRouteComponent(
              () => import("../features/workbench/pages/WorkbenchLandingPage"),
              "WorkbenchLandingPage"
            )
          },
          {
            path: "workspaces",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-workspaces/pages/WorkspaceHomePage"),
              "WorkspaceHomePage"
            )
          },
          {
            path: "workspaces/:workspaceId",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-workspaces/pages/WorkspaceDetailPage"),
              "WorkspaceDetailPage"
            )
          },
          {
            path: "workspaces/:workspaceId/debug",
            lazy: lazyRouteComponent(
              () => import("../features/debug-target/pages/WorkspaceDebugDetailPage"),
              "WorkspaceDebugDetailPage"
            )
          },
          {
            path: "workspaces/:workspaceId/affairs",
            lazy: lazyRouteComponent(
              () => import("../features/conversation/pages/ConversationPage"),
              "ConversationPage"
            )
          },
          {
            path: "workspaces/:workspaceId/sessions",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-sessions/pages/SessionIndexPage"),
              "SessionIndexPage"
            )
          },
          {
            path: "workspaces/:workspaceId/sessions/:sessionId",
            lazy: lazyRouteComponent(
              () => import("../features/conversation/pages/ConversationPage"),
              "ConversationPage"
            )
          },
          {
            path: "workspaces/:workspaceId/tools",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-tools/ToolsHomePage"),
              "ToolsHomePage"
            )
          },
          {
            path: "workspaces/:workspaceId/tools/files",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-tools/ToolFilesPage"),
              "ToolFilesPage"
            )
          },
          {
            path: "workspaces/:workspaceId/tools/git",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-tools/ToolGitPage"),
              "ToolGitPage"
            )
          },
          {
            path: "workspaces/:workspaceId/tools/processes",
            lazy: lazyRouteComponent(
              () => import("../features/mobile-tools/ToolProcessesPage"),
              "ToolProcessesPage"
            )
          },
          {
            path: "workspaces/:workspaceId/terminals",
            lazy: lazyRouteComponent(
              () => import("../features/terminal/pages/TerminalPage"),
              "TerminalPage"
            )
          },
          {
            path: "workspaces/:workspaceId/plugins",
            lazy: lazyRouteComponent(
              () => import("../features/plugins/pages/PluginsListPage"),
              "PluginsListPage"
            )
          },
          {
            path: "workspaces/:workspaceId/plugins/:pluginId",
            lazy: lazyRouteComponent(
              () => import("../features/plugins/pages/PluginDetailPage"),
              "PluginDetailPage"
            )
          },
          {
            path: "workspaces/:workspaceId/plugins/:pluginId/run",
            lazy: lazyRouteComponent(
              () => import("../features/plugins/pages/PluginContainerPage"),
              "PluginContainerPage"
            )
          },
          {
            path: "workspaces/:workspaceId/butler",
            lazy: lazyRouteComponent(
              () => import("../features/butler/pages/AdaptiveButlerPage"),
              "AdaptiveButlerPage"
            )
          },
          {
            path: "settings",
            lazy: lazyRouteComponent(
              () => import("../features/settings/pages/SettingsPage"),
              "SettingsPage"
            )
          },
          {
            path: "settings/:section",
            lazy: lazyRouteComponent(
              () => import("../features/settings/pages/SettingsPage"),
              "SettingsPage"
            )
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
