import { matchPath } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { buildWorkspaceToolsPath } from "../../workbench/utils/workbench-navigation";
import type {
  MobileWorkbenchEntry,
  MobileWorkbenchPresentation
} from "./mobile-workbench-shell-types";

const LAST_PRIMARY_TOOL_KEY = "mobile.tools.last-primary-tool";

type MobilePrimaryToolTab = "files" | "git";

export interface MobileToolHeaderState {
  readonly title: string;
  readonly showBackButton: boolean;
  readonly showMoreButton: boolean;
  readonly moreButtonLabel: string;
}

interface MobileToolRouteMatch {
  readonly workspaceId: string | null;
  readonly routeKind: "home" | "files" | "git" | "processes";
  readonly legacy: boolean;
}

function readStoredPrimaryTool(): MobilePrimaryToolTab {
  if (typeof window === "undefined") {
    return "files";
  }

  try {
    return window.localStorage.getItem(LAST_PRIMARY_TOOL_KEY) === "git" ? "git" : "files";
  } catch {
    return "files";
  }
}

function resolveToolRouteMatch(pathname: string): MobileToolRouteMatch | null {
  const scopedRoutePatterns = [
    {
      pattern: "/workspaces/:workspaceId/tools/processes",
      routeKind: "processes" as const
    },
    {
      pattern: "/workspaces/:workspaceId/tools/files",
      routeKind: "files" as const
    },
    {
      pattern: "/workspaces/:workspaceId/tools/git",
      routeKind: "git" as const
    },
    {
      pattern: "/workspaces/:workspaceId/tools",
      routeKind: "home" as const
    }
  ];

  for (const route of scopedRoutePatterns) {
    const match = matchPath(route.pattern, pathname);
    const workspaceId = match?.params.workspaceId?.trim() ?? null;

    if (workspaceId) {
      return {
        workspaceId,
        routeKind: route.routeKind,
        legacy: false
      };
    }
  }

  const legacyRoutePatterns = [
    {
      pattern: "/tools/processes",
      routeKind: "processes" as const
    },
    {
      pattern: "/tools/files",
      routeKind: "files" as const
    },
    {
      pattern: "/tools/git",
      routeKind: "git" as const
    },
    {
      pattern: "/tools",
      routeKind: "home" as const
    }
  ];

  for (const route of legacyRoutePatterns) {
    if (matchPath(route.pattern, pathname)) {
      return {
        workspaceId: null,
        routeKind: route.routeKind,
        legacy: true
      };
    }
  }

  return null;
}

function resolvePrimaryToolTab(pathname: string, search: string): MobilePrimaryToolTab {
  const routeMatch = resolveToolRouteMatch(pathname);

  if (routeMatch?.routeKind === "git") {
    return "git";
  }

  if (routeMatch?.routeKind === "files") {
    return "files";
  }

  const searchTab = new URLSearchParams(search).get("tab");

  if (searchTab === "git") {
    return "git";
  }

  if (searchTab === "files") {
    return "files";
  }

  return readStoredPrimaryTool();
}

export function resolvePreferredToolsHomeHref(pathname: string, search: string): string | null {
  const routeMatch = resolveToolRouteMatch(pathname);

  if (routeMatch?.workspaceId) {
    return buildWorkspaceToolsPath(
      routeMatch.workspaceId,
      resolvePrimaryToolTab(pathname, search)
    );
  }

  if (routeMatch?.legacy) {
    return readStoredPrimaryTool() === "git" ? "/tools?tab=git" : "/tools?tab=files";
  }

  return null;
}

export function resolveMobileToolHeaderState({
  activeEntry,
  presentation,
  pathname,
  search,
  moreButtonLabel
}: {
  activeEntry: MobileWorkbenchEntry;
  presentation: MobileWorkbenchPresentation;
  pathname: string;
  search: string;
  moreButtonLabel: string;
}): MobileToolHeaderState | null {
  if (presentation === "conversation-focus" || activeEntry !== "tools") {
    return null;
  }

  const routeMatch = resolveToolRouteMatch(pathname);

  if (!routeMatch) {
    return null;
  }

  if (routeMatch.routeKind === "processes") {
    return {
      title: t("shell.terminalManagerEntry"),
      showBackButton: true,
      showMoreButton: false,
      moreButtonLabel
    };
  }

  if (
    routeMatch.routeKind === "home"
    || routeMatch.routeKind === "files"
    || routeMatch.routeKind === "git"
  ) {
    return null;
  }

  return null;
}
