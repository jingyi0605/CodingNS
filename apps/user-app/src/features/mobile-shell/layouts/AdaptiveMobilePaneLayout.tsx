import type { ReactNode } from "react";

import type { ViewportClass } from "../../../platform/platform-adapter";
import type { MobileWorkbenchEntry } from "../components/mobile-workbench-shell-types";

export type AdaptiveMobilePaneLayoutMode =
  | "compact"
  | "medium-navigation"
  | "medium-auxiliary"
  | "expanded";

interface AdaptiveMobilePaneLayoutInput {
  readonly viewportClass: ViewportClass;
  readonly activeEntry: MobileWorkbenchEntry;
  readonly hasNavigationPanel: boolean;
  readonly hasAuxiliaryPanel: boolean;
}

interface AdaptiveMobilePaneLayoutProps extends AdaptiveMobilePaneLayoutInput {
  readonly children: ReactNode;
  readonly navigationPanel?: ReactNode;
  readonly auxiliaryPanel?: ReactNode;
}

export function resolveAdaptiveMobilePaneLayout({
  viewportClass,
  activeEntry,
  hasNavigationPanel,
  hasAuxiliaryPanel
}: AdaptiveMobilePaneLayoutInput): AdaptiveMobilePaneLayoutMode {
  if (viewportClass === "compact") {
    return "compact";
  }

  if (viewportClass === "expanded" && hasNavigationPanel && hasAuxiliaryPanel) {
    return "expanded";
  }

  if (activeEntry === "tools" && hasAuxiliaryPanel) {
    return "medium-auxiliary";
  }

  if (hasNavigationPanel) {
    return "medium-navigation";
  }

  if (hasAuxiliaryPanel) {
    return "medium-auxiliary";
  }

  return "compact";
}

export function shouldDockNavigationPanel(mode: AdaptiveMobilePaneLayoutMode) {
  return mode === "medium-navigation" || mode === "expanded";
}

export function shouldDockAuxiliaryPanel(mode: AdaptiveMobilePaneLayoutMode) {
  return mode === "medium-auxiliary" || mode === "expanded";
}

export function AdaptiveMobilePaneLayout({
  viewportClass,
  activeEntry,
  hasNavigationPanel,
  hasAuxiliaryPanel,
  children,
  navigationPanel,
  auxiliaryPanel
}: AdaptiveMobilePaneLayoutProps) {
  const mode = resolveAdaptiveMobilePaneLayout({
    viewportClass,
    activeEntry,
    hasNavigationPanel,
    hasAuxiliaryPanel
  });
  const showNavigationPanel = shouldDockNavigationPanel(mode) && navigationPanel;
  const showAuxiliaryPanel = shouldDockAuxiliaryPanel(mode) && auxiliaryPanel;

  return (
    <div className="mobile-adaptive-pane-layout" data-pane-layout={mode}>
      {showNavigationPanel ? (
        <aside className="workbench-nav surface-card mobile-adaptive-pane-panel mobile-adaptive-pane-panel-navigation">
          {navigationPanel}
        </aside>
      ) : null}

      <div className="mobile-adaptive-pane-main">{children}</div>

      {showAuxiliaryPanel ? (
        <aside className="workbench-auxiliary surface-card mobile-adaptive-pane-panel mobile-adaptive-pane-panel-auxiliary">
          {auxiliaryPanel}
        </aside>
      ) : null}
    </div>
  );
}
