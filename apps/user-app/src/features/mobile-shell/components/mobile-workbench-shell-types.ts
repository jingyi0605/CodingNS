import type { ReactNode } from "react";

export type MobileWorkbenchEntry = "workspaces" | "terminals" | "sessions" | "tools" | "settings";

export interface MobileWorkbenchShellProps {
  readonly activeEntry: MobileWorkbenchEntry;
  readonly title: string;
  readonly subtitle?: string | null;
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
  readonly onNavigateSettings: () => void;
}
