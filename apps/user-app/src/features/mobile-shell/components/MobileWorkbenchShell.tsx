import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { usePlatform } from "../../../platform/platform-provider";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { AndroidWorkbenchShell } from "../android/AndroidWorkbenchShell";
import { useH5ViewportState } from "../h5/useH5ViewportState";
import { IosWorkbenchShell } from "../ios/IosWorkbenchShell";
import {
  AdaptiveMobilePaneLayout,
  resolveAdaptiveMobilePaneLayout,
  shouldPreferCompactNativeMobileLayout
} from "../layouts/AdaptiveMobilePaneLayout";
import {
  resolveMobileToolHeaderState,
  resolvePreferredToolsHomeHref
} from "./mobile-workbench-shell-route";
import { MobileConversationBottomLayerProvider } from "./MobileConversationBottomLayerContext";
import type {
  MobileWorkbenchEntry,
  MobileWorkbenchPresentation,
  MobileWorkbenchShellProps
} from "./mobile-workbench-shell-types";
import { useMeasuredConversationTabbarHeight } from "./useMeasuredConversationTabbarHeight";
import { useConversationFocusTabbar } from "./useConversationFocusTabbar";

export type { MobileWorkbenchEntry, MobileWorkbenchPresentation } from "./mobile-workbench-shell-types";

interface MobileNavItem {
  readonly key: MobileWorkbenchEntry;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

export function MobileWorkbenchShell(props: MobileWorkbenchShellProps) {
  const platform = usePlatform();

  if (platform.platform === "ios") {
    return <IosWorkbenchShell {...props} />;
  }

  if (platform.platform === "android") {
    return <AndroidWorkbenchShell {...props} />;
  }

  return <BrowserMobileWorkbenchShell {...props} />;
}

function BrowserMobileWorkbenchShell({
  activeEntry,
  presentation = "default",
  children,
  navigationPanel,
  auxiliaryPanel,
  onNavigateWorkspaces,
  onNavigateTerminals,
  onNavigateSessions,
  onNavigateButler,
  onNavigateToolProcesses,
  onNavigateSettings
}: MobileWorkbenchShellProps) {
  const platform = usePlatform();
  const haptics = useHaptics();
  const location = useLocation();
  const navigate = useNavigate();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const tabbarRef = useRef<HTMLElement | null>(null);
  const [composerPortalTarget, setComposerPortalTarget] = useState<HTMLElement | null>(null);
  const h5ViewportState = useH5ViewportState(platform.platform === "web");
  const hideTabbarForKeyboard = platform.platform === "web" && h5ViewportState.keyboardOpen;
  const isConversationFocus = presentation === "conversation-focus";
  const preferCompactLayout = shouldPreferCompactNativeMobileLayout({
    isNativeMobile: platform.isNativeMobile,
    viewportClass: platform.viewportClass
  });
  const conversationFocusTabbar = useConversationFocusTabbar({
    enabled: isConversationFocus,
    rootRef: shellRef,
    suspended: hideTabbarForKeyboard,
    resetKey: `${location.pathname}${location.search}`
  });
  const paneLayout = resolveAdaptiveMobilePaneLayout({
    viewportClass: platform.viewportClass,
    activeEntry,
    hasNavigationPanel: Boolean(navigationPanel),
    hasAuxiliaryPanel: Boolean(auxiliaryPanel),
    preferCompactLayout
  });
  const headerState = resolveMobileToolHeaderState({
    activeEntry,
    presentation,
    pathname: location.pathname,
    search: location.search,
    moreButtonLabel: t("shell.iosMoreAction")
  });
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
      key: "terminals",
      label: t("shell.mobileButlerEntry"),
      icon: <AssistantIcon />,
      onClick: onNavigateButler
    },
    {
      key: "butler",
      label: t("shell.mobileTerminalsEntry"),
      icon: <TerminalIcon />,
      onClick: onNavigateTerminals
    },
    {
      key: "settings",
      label: t("shell.mobileSettingsEntry"),
      icon: <SettingsIcon />,
      onClick: onNavigateSettings
    }
  ];
  const shellStyle = (
    isConversationFocus
      ? {
          "--mobile-conversation-tabbar-progress": conversationFocusTabbar.progress.toFixed(4)
        }
      : undefined
  ) as CSSProperties | undefined;
  useMeasuredConversationTabbarHeight(shellRef, tabbarRef, isConversationFocus);

  function handleNavigateBackToToolsHome() {
    const preferredToolsHomeHref = resolvePreferredToolsHomeHref(location.pathname, location.search);

    if (!preferredToolsHomeHref) {
      onNavigateTerminals();
      return;
    }

    navigate(preferredToolsHomeHref, { replace: true });
  }

  const tabbarContent = (
    <nav
      ref={tabbarRef}
      className="mobile-workbench-tabbar"
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
          onClick={() => {
            if (item.key !== activeEntry) {
              void haptics.trigger("selection");
            }

            item.onClick();
          }}
        >
          <span className="mobile-workbench-tabbar-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="mobile-workbench-tabbar-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <MobileConversationBottomLayerProvider
      composerPortalTarget={isConversationFocus ? composerPortalTarget : null}
    >
      <div
        ref={shellRef}
        className="mobile-workbench-shell"
        data-active-entry={activeEntry}
        data-mobile-presentation={presentation}
        data-mobile-runtime={platform.platform}
        data-mobile-keyboard-open={hideTabbarForKeyboard}
        data-pane-layout={paneLayout}
        data-tabbar-open={
          hideTabbarForKeyboard ? false : isConversationFocus ? conversationFocusTabbar.isOpen : true
        }
        data-conversation-tabbar-state={isConversationFocus ? conversationFocusTabbar.state : "default"}
        style={shellStyle}
      >
        {headerState ? (
          <header className="mobile-workbench-header" data-header-kind="tools">
            <div className="mobile-workbench-header-leading">
              {headerState.showBackButton ? (
                <button
                  type="button"
                  className="mobile-workbench-header-button"
                  aria-label={t("common.back")}
                  onClick={handleNavigateBackToToolsHome}
                >
                  <ArrowBackIcon />
                </button>
              ) : null}
              <div className="mobile-workbench-header-copy">
                <h1>{headerState.title}</h1>
              </div>
            </div>

            <div className="mobile-workbench-header-actions">
              {headerState.showMoreButton ? (
                <button
                  type="button"
                  className="mobile-workbench-header-button mobile-tools-more-button"
                  aria-label={headerState.moreButtonLabel}
                  onClick={onNavigateToolProcesses}
                >
                  <MoreIcon />
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        <div className="mobile-workbench-content">
          <AdaptiveMobilePaneLayout
            viewportClass={platform.viewportClass}
            activeEntry={activeEntry}
            hasNavigationPanel={Boolean(navigationPanel)}
            hasAuxiliaryPanel={Boolean(auxiliaryPanel)}
            preferCompactLayout={preferCompactLayout}
            navigationPanel={navigationPanel}
            auxiliaryPanel={auxiliaryPanel}
          >
            {children}
          </AdaptiveMobilePaneLayout>
        </div>

        {isConversationFocus ? (
          <div className="mobile-conversation-bottom-layer">
            <div
              ref={setComposerPortalTarget}
              className="mobile-conversation-bottom-layer-composer-slot"
            />
            <div className="mobile-conversation-bottom-layer-tabbar-shell">
              {tabbarContent}
            </div>
          </div>
        ) : (
          tabbarContent
        )}
      </div>
    </MobileConversationBottomLayerProvider>
  );
}

function ArrowBackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="m15 18-6-6 6-6" />
      <path d="M21 12H9" />
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

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 9 3 3-3 3" />
      <path d="M12.5 15H17" />
    </svg>
  );
}

function AssistantIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="5" y="7" width="14" height="10" rx="3" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      <circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M10 15c.6.5 1.2.8 2 .8s1.4-.3 2-.8" />
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
