import { createPortal } from "react-dom";
import { useState, type CSSProperties, type ReactNode, type Ref, type TouchEventHandler } from "react";

import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import type { MobileWorkspaceOption } from "../../workbench/utils/mobile-workspace-tree";
import { MobileTopHeaderFrame } from "./MobileTopHeaderFrame";

interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

interface MobileWorkspaceSwitcherHeaderProps {
  readonly currentWorkspace: WorkspaceSummary | null;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly workspaceOptions?: readonly MobileWorkspaceOption[];
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
  workspaceOptions,
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
  const switcherItems = workspaceOptions ?? workspaces.map((workspace) => ({
    workspace,
    label: workspace.name,
    subtitle: workspace.path,
    depth: 0,
    kind: "workspace" as const,
    meta: null
  }));

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
                {switcherItems.map((item) => (
                  <button
                    key={item.workspace.id}
                    type="button"
                    className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                    data-worktree-kind={item.kind}
                    data-worktree-depth={item.depth}
                    onClick={() => {
                      if (item.workspace.id !== currentWorkspace.id) {
                        void haptics.trigger("selection");
                        onSelectWorkspace?.(item.workspace.id);
                      }
                      setSwitcherOpen(false);
                    }}
                  >
                    <div
                      className="mobile-workspace-home-session-main"
                      style={
                        {
                          "--mobile-workspace-tree-depth": String(item.depth)
                        } as CSSProperties
                      }
                    >
                      <span className="mobile-workspace-home-session-title">
                        {item.kind === "worktree" ? (
                          <span className="mobile-workspace-home-worktree-badge">
                            {t("shell.mobileWorktreeBadge")}
                          </span>
                        ) : null}
                        {item.label}
                      </span>
                      <span className="mobile-workspace-home-session-meta">{item.subtitle}</span>
                    </div>
                    <span className="mobile-workspace-home-row-trailing">
                      {item.workspace.id === currentWorkspace.id ? <CheckIcon /> : <ChevronRightIcon />}
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
