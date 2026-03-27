import type { ReactNode } from "react";

export type MobileWorkbenchEntry = "workspaces" | "terminals" | "sessions" | "tools" | "settings";
export type MobileWorkbenchPresentation = "default" | "conversation-focus";

export interface MobileWorkbenchShellProps {
  readonly activeEntry: MobileWorkbenchEntry;
  readonly presentation?: MobileWorkbenchPresentation;
  readonly children: ReactNode;
  readonly navigationPanel?: ReactNode;
  readonly auxiliaryPanel?: ReactNode;
  readonly onOpenNavigation: () => void;
  readonly onOpenSearch: () => void;
  readonly onOpenAuxiliary: () => void;
  readonly onNavigateWorkspaces: () => void;
  readonly onNavigateTerminals: () => void;
  readonly onNavigateSessions: () => void;
  readonly onNavigateTools: () => void;
  readonly onNavigateToolFiles: () => void;
  readonly onNavigateToolGit: () => void;
  readonly onNavigateToolProcesses: () => void;
  readonly onNavigateSettings: () => void;
}
