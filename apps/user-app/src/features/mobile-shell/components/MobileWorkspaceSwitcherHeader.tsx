import { createPortal } from "react-dom";
import { useState, type CSSProperties, type ReactNode, type Ref, type TouchEventHandler } from "react";
import { useNavigate } from "react-router-dom";

import { useClientConfigSelector } from "../../../config/client-config-store";
import { getActiveHost } from "../../../config/client-config-types";
import { HostSwitchError, hostSwitchCoordinator } from "../../../config/host-switch-coordinator";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  buildMobileHostSwitcherEntries,
  type MobileHostSwitcherEntry
} from "../../workbench/utils/host-workspace-switcher";
import type { MobileWorkspaceOption } from "../../workbench/utils/mobile-workspace-tree";
import { buildWorkspaceHomePath } from "../../workbench/utils/workbench-navigation";
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
  readonly onSelectWorkspace?: (workspaceId: string) => void | Promise<void>;
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
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(null);
  const haptics = useHaptics();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const runtimeConfig = useClientConfigSelector((state) => state);
  const activeHost = getActiveHost(runtimeConfig);
  const switcherItems = workspaceOptions ?? workspaces.map((workspace) => ({
    workspace: {
      ...workspace,
      repoRoot: workspace.path
    },
    label: workspace.name,
    subtitle: workspace.path,
    depth: 0,
    kind: "workspace" as const,
    meta: null
  }));
  const hostSwitcherItems = buildMobileHostSwitcherEntries(runtimeConfig, switcherItems);
  const headerTitle = currentWorkspace?.name ?? activeHost?.name ?? null;
  const headerSubtitle = currentWorkspace?.path ?? activeHost?.baseUrl ?? null;

  if (!headerTitle) {
    return null;
  }

  async function handleItemSelect(item: MobileHostSwitcherEntry): Promise<void> {
    const itemKey =
      item.kind === "host"
        ? `host:${item.host.id}`
        : `workspace:${item.host.id}:${item.workspace.id}`;

    if (pendingSelectionKey) {
      return;
    }

    setPendingSelectionKey(itemKey);

    try {
      if (item.host.id !== runtimeConfig.activeHostId) {
        void haptics.trigger("selection");
        await hostSwitchCoordinator.switchHost(item.host.id);
      }

      if (item.kind === "host") {
        navigate(buildWorkspaceHomePath());
      } else if (item.workspace.id !== currentWorkspace?.id || item.host.id !== runtimeConfig.activeHostId) {
        await onSelectWorkspace?.(item.workspace.id);
      }

      setSwitcherOpen(false);
    } catch (error) {
      showToast({
        title: resolveHostSwitchErrorMessage(error, item.host.name),
        tone: "error"
      });
    } finally {
      setPendingSelectionKey(null);
    }
  }

  return (
    <>
      <MobileTopHeaderFrame
        className={className}
        frameRef={containerRef}
        {...gestureHandlers}
      >
        <section className="mobile-workspace-home-header">
          <h1 className="mobile-workspace-switcher-heading">{heading ?? headerTitle}</h1>

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
              <span className="mobile-workspace-home-switcher-label">{triggerLabel ?? headerTitle}</span>
              <ChevronDownIcon />
            </button>

            <div className="mobile-workspace-home-toolbar-actions">
              {trailing}
            </div>
          </div>

          {headerSubtitle ? <p className="mobile-workspace-home-path">{headerSubtitle}</p> : null}
          {content}
        </section>
      </MobileTopHeaderFrame>

      {switcherOpen && !onTriggerClick
        ? renderSheet(
            <WorkspaceSwitcherSheet
              title={t("shell.hostWorkspaceSwitcherTitle")}
              onClose={() => setSwitcherOpen(false)}
            >
              <div className="mobile-workspace-home-group mobile-workspace-home-sheet-group">
                {hostSwitcherItems.map((item) => (
                  <button
                    key={
                      item.kind === "host"
                        ? `host-${item.host.id}`
                        : `workspace-${item.host.id}-${item.workspace.id}`
                    }
                    type="button"
                    className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                    data-host-entry-kind={item.kind}
                    data-host-active={item.host.id === runtimeConfig.activeHostId}
                    data-worktree-kind={item.kind === "workspace" ? item.option.kind : undefined}
                    data-worktree-depth={item.kind === "workspace" ? item.option.depth + 1 : 0}
                    disabled={pendingSelectionKey !== null}
                    onClick={() => {
                      void handleItemSelect(item);
                    }}
                  >
                    <div
                      className={
                        item.kind === "host"
                          ? "mobile-workspace-home-session-main mobile-host-workspace-switcher-host-main"
                          : "mobile-workspace-home-session-main"
                      }
                      style={
                        {
                          "--mobile-workspace-tree-depth": String(
                            item.kind === "host" ? 0 : item.option.depth + 1
                          )
                        } as CSSProperties
                      }
                    >
                      <span className="mobile-workspace-home-session-title">
                        {item.kind === "host" ? (
                          <span className="mobile-host-workspace-switcher-host-badge">
                            {t("shell.hostSwitcherNodeBadge")}
                          </span>
                        ) : null}
                        {item.kind === "workspace" && item.option.kind === "worktree" ? (
                          <span className="mobile-workspace-home-worktree-badge">
                            {t("shell.mobileWorktreeBadge")}
                          </span>
                        ) : null}
                        {item.kind === "host" ? item.host.name : item.option.label}
                      </span>
                      <span className="mobile-workspace-home-session-meta">
                        {item.kind === "host"
                          ? formatHostSummary(item.host, item.workspaceCount)
                          : item.option.subtitle}
                      </span>
                    </div>
                    <span className="mobile-workspace-home-row-trailing">
                      {item.kind === "host" && item.host.id === runtimeConfig.activeHostId ? (
                        <CheckIcon />
                      ) : item.kind === "workspace"
                        && item.workspace.id === currentWorkspace?.id
                        && item.host.id === runtimeConfig.activeHostId ? (
                          <CheckIcon />
                        ) : (
                          <ChevronRightIcon />
                        )}
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

function resolveHostSwitchErrorMessage(error: unknown, hostName: string): string {
  if (!(error instanceof HostSwitchError)) {
    return t("shell.hostSwitchFailed");
  }

  if (error.code === "HOST_UNREACHABLE") {
    return t("shell.hostSwitchUnreachable", { name: hostName });
  }

  return t("shell.hostSwitchMissing");
}

function formatHostSummary(
  host: ReturnType<typeof getActiveHost>,
  workspaceCount: number
): string {
  if (!host) {
    return "";
  }

  if (host.lastUsername) {
    return t("shell.hostSwitcherWorkspaceCountWithUser", {
      username: host.lastUsername,
      count: workspaceCount
    });
  }

  return workspaceCount > 0
    ? t("shell.hostSwitcherWorkspaceCount", { count: workspaceCount })
    : host.baseUrl;
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
