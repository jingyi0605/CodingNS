import type { ReactNode } from "react";

import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import { AndroidWorkbenchShell } from "../android/AndroidWorkbenchShell";
import { IosWorkbenchShell } from "../ios/IosWorkbenchShell";
import { useH5ViewportState } from "../h5/useH5ViewportState";
import {
  AdaptiveMobilePaneLayout,
  resolveAdaptiveMobilePaneLayout,
  shouldDockAuxiliaryPanel,
  shouldDockNavigationPanel
} from "../layouts/AdaptiveMobilePaneLayout";
import type {
  MobileWorkbenchEntry,
  MobileWorkbenchShellProps
} from "./mobile-workbench-shell-types";

export type { MobileWorkbenchEntry } from "./mobile-workbench-shell-types";

interface MobileNavItem {
  readonly key: MobileWorkbenchEntry;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

export function MobileWorkbenchShell({
  activeEntry,
  title,
  subtitle,
  children,
  navigationPanel,
  auxiliaryPanel,
  onOpenNavigation,
  onOpenSearch,
  onOpenAuxiliary,
  onNavigateWorkspaces,
  onNavigateSessions,
  onNavigateTools,
  onNavigateSettings
}: MobileWorkbenchShellProps) {
  const platform = usePlatform();

  if (platform.platform === "ios") {
    return (
      <IosWorkbenchShell
        activeEntry={activeEntry}
        title={title}
        subtitle={subtitle}
        navigationPanel={navigationPanel}
        auxiliaryPanel={auxiliaryPanel}
        onOpenNavigation={onOpenNavigation}
        onOpenSearch={onOpenSearch}
        onOpenAuxiliary={onOpenAuxiliary}
        onNavigateWorkspaces={onNavigateWorkspaces}
        onNavigateSessions={onNavigateSessions}
        onNavigateTools={onNavigateTools}
        onNavigateSettings={onNavigateSettings}
      >
        {children}
      </IosWorkbenchShell>
    );
  }

  if (platform.platform === "android") {
    return (
      <AndroidWorkbenchShell
        activeEntry={activeEntry}
        title={title}
        subtitle={subtitle}
        navigationPanel={navigationPanel}
        auxiliaryPanel={auxiliaryPanel}
        onOpenNavigation={onOpenNavigation}
        onOpenSearch={onOpenSearch}
        onOpenAuxiliary={onOpenAuxiliary}
        onNavigateWorkspaces={onNavigateWorkspaces}
        onNavigateSessions={onNavigateSessions}
        onNavigateTools={onNavigateTools}
        onNavigateSettings={onNavigateSettings}
      >
        {children}
      </AndroidWorkbenchShell>
    );
  }

  return (
    <BrowserMobileWorkbenchShell
      activeEntry={activeEntry}
      title={title}
      subtitle={subtitle}
      navigationPanel={navigationPanel}
      auxiliaryPanel={auxiliaryPanel}
      onOpenNavigation={onOpenNavigation}
      onOpenSearch={onOpenSearch}
      onOpenAuxiliary={onOpenAuxiliary}
      onNavigateWorkspaces={onNavigateWorkspaces}
      onNavigateSessions={onNavigateSessions}
      onNavigateTools={onNavigateTools}
      onNavigateSettings={onNavigateSettings}
    >
      {children}
    </BrowserMobileWorkbenchShell>
  );
}

function BrowserMobileWorkbenchShell({
  activeEntry,
  title,
  subtitle,
  children,
  navigationPanel,
  auxiliaryPanel,
  onOpenNavigation,
  onOpenSearch,
  onOpenAuxiliary,
  onNavigateWorkspaces,
  onNavigateSessions,
  onNavigateTools,
  onNavigateSettings
}: MobileWorkbenchShellProps) {
  const platform = usePlatform();
  const h5ViewportState = useH5ViewportState(platform.platform === "web");
  const hideTabbarForKeyboard = platform.platform === "web" && h5ViewportState.keyboardOpen;
  const paneLayout = resolveAdaptiveMobilePaneLayout({
    viewportClass: platform.viewportClass,
    activeEntry,
    hasNavigationPanel: Boolean(navigationPanel),
    hasAuxiliaryPanel: Boolean(auxiliaryPanel)
  });
  const navigationDocked = shouldDockNavigationPanel(paneLayout);
  const auxiliaryDocked = shouldDockAuxiliaryPanel(paneLayout);

  // 移动端主导航只保留一级目的地，复杂操作都从页面内或顶部按钮进入。
  const navItems: MobileNavItem[] = [
    {
      key: "workspaces",
      label: t("shell.mobileWorkspacesEntry"),
      icon: <WorkspaceIcon />,
      onClick: onNavigateWorkspaces
    },
    {
      key: "sessions",
      label: t("shell.mobileSessionsEntry"),
      icon: <ConversationIcon />,
      onClick: onNavigateSessions
    },
    {
      key: "tools",
      label: t("shell.mobileToolsEntry"),
      icon: <ToolboxIcon />,
      onClick: onNavigateTools
    },
    {
      key: "settings",
      label: t("shell.mobileSettingsEntry"),
      icon: <SettingsIcon />,
      onClick: onNavigateSettings
    }
  ];

  return (
    <div
      className="mobile-workbench-shell"
      data-active-entry={activeEntry}
      data-mobile-runtime={platform.platform}
      data-mobile-keyboard-open={hideTabbarForKeyboard}
      data-pane-layout={paneLayout}
    >
      <header className="mobile-workbench-header surface-card">
        <div className="mobile-workbench-header-leading">
          {!navigationDocked ? (
            <button
              type="button"
              className="mobile-workbench-header-button"
              aria-label={t("shell.mobileNavigationAction")}
              onClick={onOpenNavigation}
            >
              <NavigationIcon />
            </button>
          ) : null}
          <div className="mobile-workbench-header-copy">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>

        <div className="mobile-workbench-header-actions">
          <button
            type="button"
            className="mobile-workbench-header-button"
            aria-label={t("shell.mobileSearchAction")}
            onClick={onOpenSearch}
          >
            <SearchIcon />
          </button>
          {!auxiliaryDocked ? (
            <button
              type="button"
              className="mobile-workbench-header-button"
              aria-label={t("shell.mobileAuxiliaryAction")}
              onClick={onOpenAuxiliary}
            >
              <PanelIcon />
            </button>
          ) : null}
        </div>
      </header>

      <div className="mobile-workbench-content">
        <AdaptiveMobilePaneLayout
          viewportClass={platform.viewportClass}
          activeEntry={activeEntry}
          hasNavigationPanel={Boolean(navigationPanel)}
          hasAuxiliaryPanel={Boolean(auxiliaryPanel)}
          navigationPanel={navigationPanel}
          auxiliaryPanel={auxiliaryPanel}
        >
          {children}
        </AdaptiveMobilePaneLayout>
      </div>

      <nav
        className="mobile-workbench-tabbar surface-card"
        aria-label={t("shell.title")}
        hidden={hideTabbarForKeyboard}
      >
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className="mobile-workbench-tabbar-item"
            data-active={item.key === activeEntry}
            aria-current={item.key === activeEntry ? "page" : undefined}
            onClick={item.onClick}
          >
            <span className="mobile-workbench-tabbar-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="mobile-workbench-tabbar-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavigationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="11" cy="11" r="6.5" />
      <line x1="20" y1="20" x2="16.6" y2="16.6" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M8 13h8" />
    </svg>
  );
}

function ConversationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ToolboxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6" />
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 12h18" />
      <path d="M10 11.5h4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.1a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.25 1 1.51h.09a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.49z" />
    </svg>
  );
}
