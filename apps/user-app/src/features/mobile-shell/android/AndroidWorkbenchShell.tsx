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

interface AndroidNavItem {
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

export function AndroidWorkbenchShell({
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
  const location = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const showBackButton = !isTopLevelPath(location.pathname);
  const paneLayout = resolveAdaptiveMobilePaneLayout({
    viewportClass: platform.viewportClass,
    activeEntry,
    hasNavigationPanel: Boolean(navigationPanel),
    hasAuxiliaryPanel: Boolean(auxiliaryPanel)
  });
  const navigationDocked = shouldDockNavigationPanel(paneLayout);
  const auxiliaryDocked = shouldDockAuxiliaryPanel(paneLayout);
  const allowNavigationSheetAction = !navigationDocked && showBackButton;
  const allowAuxiliarySheetAction = !auxiliaryDocked;
  const showMoreButton = allowNavigationSheetAction || allowAuxiliarySheetAction;

  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!sheetOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSheetOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sheetOpen]);

  const navItems: AndroidNavItem[] = [
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

  function closeSheet() {
    setSheetOpen(false);
  }

  function openNavigationFromSheet() {
    closeSheet();
    onOpenNavigation();
  }

  function openAuxiliaryFromSheet() {
    closeSheet();
    onOpenAuxiliary();
  }

  return (
    <div className="android-workbench-shell" data-active-entry={activeEntry}>
      <header className="android-workbench-topbar surface-card">
        <div className="android-workbench-topbar-leading">
          {showBackButton ? (
            <button
              type="button"
              className="android-workbench-icon-button"
              aria-label={t("common.back")}
              onClick={handleNavigateBack}
            >
              <ArrowBackIcon />
            </button>
          ) : !navigationDocked ? (
            <button
              type="button"
              className="android-workbench-icon-button"
              aria-label={t("shell.mobileNavigationAction")}
              onClick={onOpenNavigation}
            >
              <NavigationIcon />
            </button>
          ) : (
            <span className="android-workbench-topbar-spacer" aria-hidden="true" />
          )}

          <div className="android-workbench-topbar-copy">
            <span className="android-workbench-topbar-overline">{t("shell.title")}</span>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>

        <div className="android-workbench-topbar-actions">
          <button
            type="button"
            className="android-workbench-icon-button"
            aria-label={t("shell.mobileSearchAction")}
            onClick={onOpenSearch}
          >
            <SearchIcon />
          </button>
          {showMoreButton ? (
            <button
              type="button"
              className="android-workbench-icon-button"
              aria-label={t("shell.androidMoreAction")}
              onClick={() => setSheetOpen(true)}
            >
              <MoreVerticalIcon />
            </button>
          ) : null}
        </div>
      </header>

      <div className="android-workbench-content">
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

      <nav className="android-workbench-bottom-nav surface-card" aria-label={t("shell.title")}>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className="android-workbench-bottom-nav-item"
            data-active={item.key === activeEntry}
            aria-current={item.key === activeEntry ? "page" : undefined}
            onClick={item.onClick}
          >
            <span className="android-workbench-bottom-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="android-workbench-bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      {sheetOpen && showMoreButton && typeof document !== "undefined"
        ? createPortal(
            <div className="android-bottom-sheet-overlay" role="presentation" onClick={closeSheet}>
              <div
                className="android-bottom-sheet surface-card"
                role="dialog"
                aria-modal="true"
                aria-label={t("shell.androidMoreAction")}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="android-bottom-sheet-handle" aria-hidden="true" />
                <div className="android-bottom-sheet-header">
                  <strong>{title}</strong>
                  <span>{subtitle ?? t("shell.title")}</span>
                </div>
                {allowNavigationSheetAction ? (
                  <button type="button" className="android-bottom-sheet-action" onClick={openNavigationFromSheet}>
                    {t("shell.mobileNavigationAction")}
                  </button>
                ) : null}
                {allowAuxiliarySheetAction ? (
                  <button type="button" className="android-bottom-sheet-action" onClick={openAuxiliaryFromSheet}>
                    {t("shell.mobileAuxiliaryAction")}
                  </button>
                ) : null}
                <button type="button" className="android-bottom-sheet-close" onClick={closeSheet}>
                  {t("common.close")}
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function ArrowBackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 12H7" />
      <path d="M13 18l-6-6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="6.5" />
      <line x1="20" y1="20" x2="16.6" y2="16.6" />
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M8 13h8" />
    </svg>
  );
}

function ConversationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 9 3 3-3 3" />
      <path d="M12.5 15H17" />
    </svg>
  );
}

function ToolboxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6" />
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 12h18" />
      <path d="M10 11.5h4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.1a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.25 1 1.51h.09a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.49z" />
    </svg>
  );
}
