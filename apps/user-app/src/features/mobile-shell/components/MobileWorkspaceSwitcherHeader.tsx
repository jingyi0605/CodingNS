import { createPortal } from "react-dom";
import { useState, type ReactNode, type Ref, type TouchEventHandler } from "react";

import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { MobileTopHeaderFrame } from "./MobileTopHeaderFrame";

interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

interface MobileWorkspaceSwitcherHeaderProps {
  readonly currentWorkspace: WorkspaceSummary | null;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly onSelectWorkspace?: (workspaceId: string) => void;
  readonly className?: string;
  readonly containerRef?: Ref<HTMLDivElement>;
  readonly heading?: string;
  readonly content?: ReactNode;
  readonly sheetContent?: (closeSheet: () => void) => ReactNode;
  readonly triggerLabel?: ReactNode;
  readonly triggerAriaLabel?: string;
  readonly onTriggerClick?: () => void;
  readonly trailing?: ReactNode;
  readonly gestureHandlers?: {
    readonly onTouchStart?: TouchEventHandler<HTMLDivElement>;
    readonly onTouchMove?: TouchEventHandler<HTMLDivElement>;
    readonly onTouchEnd?: TouchEventHandler<HTMLDivElement>;
    readonly onTouchCancel?: TouchEventHandler<HTMLDivElement>;
  };
}

export function MobileWorkspaceSwitcherHeader({
  currentWorkspace,
  workspaces,
  onSelectWorkspace,
  className,
  containerRef,
  heading,
  content,
  sheetContent,
  triggerLabel,
  triggerAriaLabel,
  onTriggerClick,
  trailing,
  gestureHandlers
}: MobileWorkspaceSwitcherHeaderProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const haptics = useHaptics();

  if (!currentWorkspace) {
    return null;
  }

  return (
    <>
      <MobileTopHeaderFrame
        className={className}
        frameRef={containerRef}
        {...gestureHandlers}
      >
        <section className="mobile-workspace-home-header">
          <h1 className="mobile-workspace-switcher-heading">{heading ?? currentWorkspace.name}</h1>

          <div className="mobile-workspace-home-toolbar-top">
            <button
              type="button"
              className="mobile-workspace-home-switcher"
              aria-label={triggerAriaLabel ?? t("shell.workspaceHomeSwitcherLabel")}
              onClick={() => {
                if (onTriggerClick) {
                  onTriggerClick();
                  return;
                }

                void haptics.trigger("selection");
                setSwitcherOpen(true);
              }}
            >
              <span className="mobile-workspace-home-switcher-label">{triggerLabel ?? currentWorkspace.name}</span>
              <ChevronDownIcon />
            </button>

            <div className="mobile-workspace-home-toolbar-actions">
              {trailing}
            </div>
          </div>

          <p className="mobile-workspace-home-path">{currentWorkspace.path}</p>
          {content}
        </section>
      </MobileTopHeaderFrame>

      {switcherOpen && !onTriggerClick
        ? renderSheet(
            <WorkspaceSwitcherSheet
              title={t("shell.workspaceHomeSwitcherTitle")}
              onClose={() => setSwitcherOpen(false)}
            >
              <div className="mobile-workspace-home-group mobile-workspace-home-sheet-group">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                    onClick={() => {
                      if (workspace.id !== currentWorkspace.id) {
                        void haptics.trigger("selection");
                        onSelectWorkspace?.(workspace.id);
                      }
                      setSwitcherOpen(false);
                    }}
                  >
                    <div className="mobile-workspace-home-session-main">
                      <span className="mobile-workspace-home-session-title">{workspace.name}</span>
                      <span className="mobile-workspace-home-session-meta">{workspace.path}</span>
                    </div>
                    <span className="mobile-workspace-home-row-trailing">
                      {workspace.id === currentWorkspace.id ? <CheckIcon /> : <ChevronRightIcon />}
                    </span>
                  </button>
                ))}
              </div>
              {sheetContent ? sheetContent(() => setSwitcherOpen(false)) : null}
            </WorkspaceSwitcherSheet>
          )
        : null}
    </>
  );
}

function renderSheet(content: ReactNode) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(content, document.body);
}

function WorkspaceSwitcherSheet({
  title,
  onClose,
  children
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="ios-action-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-workspace-home-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{title}</strong>
          </div>
          {children}
        </div>
        <button type="button" className="ios-action-sheet-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 6.5L8 10l4-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 3.5L10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
