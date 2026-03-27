import { type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import {
  ConversationFocusQuickNav,
  type ConversationFocusQuickNavAction
} from "../components/ConversationFocusQuickNav";
import {
  resolveMobileToolHeaderState,
  resolvePreferredToolsHomeHref
} from "../components/mobile-workbench-shell-route";
import type {
  MobileWorkbenchEntry,
  MobileWorkbenchShellProps
} from "../components/mobile-workbench-shell-types";
import { AdaptiveMobilePaneLayout, resolveAdaptiveMobilePaneLayout } from "../layouts/AdaptiveMobilePaneLayout";

interface IosTabItem {
  readonly key: MobileWorkbenchEntry;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

export function IosWorkbenchShell({
  activeEntry,
  presentation = "default",
  children,
  navigationPanel,
  auxiliaryPanel,
  onNavigateWorkspaces,
  onNavigateTerminals,
  onNavigateSessions,
  onNavigateTools,
  onNavigateToolFiles,
  onNavigateToolGit,
  onNavigateToolProcesses,
  onNavigateSettings
}: MobileWorkbenchShellProps) {
  const platform = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();
  const isConversationFocus = presentation === "conversation-focus";
  const paneLayout = resolveAdaptiveMobilePaneLayout({
    viewportClass: platform.viewportClass,
    activeEntry,
    hasNavigationPanel: Boolean(navigationPanel),
    hasAuxiliaryPanel: Boolean(auxiliaryPanel)
  });
  const headerState = resolveMobileToolHeaderState({
    activeEntry,
    presentation,
    pathname: location.pathname,
    search: location.search,
    moreButtonLabel: t("shell.iosMoreAction")
  });
  const navItems: IosTabItem[] = [
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
      key: "terminals",
      label: t("shell.mobileTerminalsEntry"),
      icon: <TerminalIcon />,
      onClick: onNavigateTerminals
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
  const quickActions: ConversationFocusQuickNavAction[] = [
    {
      key: "workspaces",
      label: t("shell.mobileWorkspacesEntry"),
      icon: <WorkspaceIcon />,
      onSelect: onNavigateWorkspaces
    },
    {
      key: "terminals",
      label: t("shell.mobileTerminalsEntry"),
      icon: <TerminalIcon />,
      onSelect: onNavigateTerminals
    },
    {
      key: "files",
      label: t("shell.filesEntry"),
      icon: <FilesIcon />,
      onSelect: onNavigateToolFiles
    },
    {
      key: "git",
      label: t("shell.gitEntry"),
      icon: <GitBranchIcon />,
      onSelect: onNavigateToolGit
    },
    {
      key: "processes",
      label: t("shell.terminalManagerEntry"),
      icon: <ProcessIcon />,
      onSelect: onNavigateToolProcesses
    }
  ];

  function handleNavigateBackToToolsHome() {
    const preferredToolsHomeHref = resolvePreferredToolsHomeHref(location.pathname, location.search);

    if (!preferredToolsHomeHref) {
      onNavigateTools();
      return;
    }

    navigate(preferredToolsHomeHref, { replace: true });
  }

  return (
    <div
      className="ios-workbench-shell"
      data-active-entry={activeEntry}
      data-mobile-presentation={presentation}
      data-pane-layout={paneLayout}
      data-tabbar-open={!isConversationFocus}
    >
      {headerState ? (
        <header className="ios-workbench-nav" data-header-kind="tools">
          <div className="ios-workbench-nav-leading">
            {headerState.showBackButton ? (
              <button
                type="button"
                className="ios-workbench-back-button"
                aria-label={t("common.back")}
                onClick={handleNavigateBackToToolsHome}
              >
                <ChevronLeftIcon />
                <span>{t("common.back")}</span>
              </button>
            ) : null}
          </div>

          <div className="ios-workbench-nav-copy">
            <h1>{headerState.title}</h1>
          </div>

          <div className="ios-workbench-nav-actions">
            {headerState.showMoreButton ? (
              <button
                type="button"
                className="ios-workbench-icon-button"
                aria-label={headerState.moreButtonLabel}
                onClick={onNavigateToolProcesses}
              >
                <MoreIcon />
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="ios-workbench-content">
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

      {isConversationFocus ? <ConversationFocusQuickNav actions={quickActions} /> : null}

      {!isConversationFocus ? (
        <nav className="ios-workbench-tabbar" aria-label={t("shell.title")}>
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="ios-workbench-tabbar-item"
              data-active={item.key === activeEntry}
              aria-current={item.key === activeEntry ? "page" : undefined}
              onClick={item.onClick}
            >
              <span className="ios-workbench-tabbar-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="ios-workbench-tabbar-label">{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M8 13h8" />
    </svg>
  );
}

function ConversationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 9 3 3-3 3" />
      <path d="M12.5 15H17" />
    </svg>
  );
}

function ToolboxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6" />
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 12h18" />
      <path d="M10 11.5h4" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6.5h7l2 2H20v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 9h16" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="7" cy="6" r="2" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="17" cy="6" r="2" />
      <path d="M7 8v8a2 2 0 0 0 2 2h6" />
      <path d="M17 8v6" />
    </svg>
  );
}

function ProcessIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <path d="M16 2v3" />
      <path d="M12 2v3" />
      <path d="M8 2v3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.1a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.25 1 1.51h.09a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.49z" />
    </svg>
  );
}
