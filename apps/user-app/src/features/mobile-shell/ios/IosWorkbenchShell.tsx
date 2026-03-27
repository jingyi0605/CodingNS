import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import type {
  MobileWorkbenchEntry,
  MobileWorkbenchShellProps
} from "../components/mobile-workbench-shell-types";
import {
  AdaptiveMobilePaneLayout,
  resolveAdaptiveMobilePaneLayout,
  shouldDockAuxiliaryPanel,
  shouldDockNavigationPanel
} from "../layouts/AdaptiveMobilePaneLayout";

interface IosTabItem {
  readonly key: MobileWorkbenchEntry;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

function isTopLevelPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/sessions" ||
    pathname === "/tools" ||
    pathname === "/settings" ||
    pathname === "/terminals"
  );
}

export function IosWorkbenchShell({
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
  onNavigateTerminals,
  onNavigateSessions,
  onNavigateTools,
  onNavigateSettings
}: MobileWorkbenchShellProps) {
  const platform = usePlatform();
  const paneLayout = resolveAdaptiveMobilePaneLayout({
    viewportClass: platform.viewportClass,
    activeEntry,
    hasNavigationPanel: Boolean(navigationPanel),
    hasAuxiliaryPanel: Boolean(auxiliaryPanel)
  });
  const location = useLocation();
  const navigate = useNavigate();
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const showBackButton = !isTopLevelPath(location.pathname);
  const navigationDocked = shouldDockNavigationPanel(paneLayout);
  const auxiliaryDocked = shouldDockAuxiliaryPanel(paneLayout);
  const allowNavigationAction = !navigationDocked && showBackButton;
  const allowAuxiliaryAction = !auxiliaryDocked;
  const showMoreButton = allowNavigationAction || allowAuxiliaryAction;

  useEffect(() => {
    setActionSheetOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!actionSheetOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActionSheetOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionSheetOpen]);

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

  function handleNavigateBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }

    onNavigateWorkspaces();
  }

  function closeActionSheet() {
    setActionSheetOpen(false);
  }

  function openNavigationFromSheet() {
    closeActionSheet();
    onOpenNavigation();
  }

  function openAuxiliaryFromSheet() {
    closeActionSheet();
    onOpenAuxiliary();
  }

  return (
    <div className="ios-workbench-shell" data-active-entry={activeEntry}>
      <header className="ios-workbench-nav surface-card">
        <div className="ios-workbench-nav-leading">
          {showBackButton ? (
            <button
              type="button"
              className="ios-workbench-back-button"
              aria-label={t("common.back")}
              onClick={handleNavigateBack}
            >
              <ChevronLeftIcon />
              <span>{t("common.back")}</span>
            </button>
          ) : !navigationDocked ? (
            <button
              type="button"
              className="ios-workbench-icon-button"
              aria-label={t("shell.mobileNavigationAction")}
              onClick={onOpenNavigation}
            >
              <NavigationIcon />
            </button>
          ) : (
            <span className="ios-workbench-nav-spacer" aria-hidden="true" />
          )}
        </div>

        <div className="ios-workbench-nav-copy">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        <div className="ios-workbench-nav-actions">
          <button
            type="button"
            className="ios-workbench-icon-button"
            aria-label={t("shell.mobileSearchAction")}
            onClick={onOpenSearch}
          >
            <SearchIcon />
          </button>
          {showMoreButton ? (
            <button
              type="button"
              className="ios-workbench-icon-button"
              aria-label={t("shell.iosMoreAction")}
              onClick={() => setActionSheetOpen(true)}
            >
              <MoreIcon />
            </button>
          ) : null}
        </div>
      </header>

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

      <nav className="ios-workbench-tabbar surface-card" aria-label={t("shell.title")}>
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

      {actionSheetOpen && showMoreButton && typeof document !== "undefined"
        ? createPortal(
            <div className="ios-action-sheet-overlay" role="presentation" onClick={closeActionSheet}>
              <div
                className="ios-action-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={t("shell.iosMoreAction")}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ios-action-sheet-group surface-card">
                  <div className="ios-action-sheet-header">
                    <strong>{title}</strong>
                    <span>{subtitle ?? t("shell.title")}</span>
                  </div>
                  {allowNavigationAction ? (
                    <button type="button" className="ios-action-sheet-button" onClick={openNavigationFromSheet}>
                      {t("shell.mobileNavigationAction")}
                    </button>
                  ) : null}
                  {allowAuxiliaryAction ? (
                    <button type="button" className="ios-action-sheet-button" onClick={openAuxiliaryFromSheet}>
                      {t("shell.mobileAuxiliaryAction")}
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ios-action-sheet-cancel surface-card"
                  onClick={closeActionSheet}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function NavigationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <circle cx="11" cy="11" r="6.5" />
      <line x1="20" y1="20" x2="16.6" y2="16.6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="8.3" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
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

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.1a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.25 1 1.51h.09a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.49z" />
    </svg>
  );
}
