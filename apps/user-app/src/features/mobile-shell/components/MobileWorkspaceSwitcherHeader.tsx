import { useEffect, useState, type CSSProperties, type ReactNode, type Ref, type TouchEventHandler } from "react";
import { useNavigate } from "react-router-dom";

import { ModalList, ModalListItem, ModalTag } from "../../../components/ModalAtoms";
import { MobileSheet } from "../../../components/MobileSheet";
import { useClientConfigSelector } from "../../../config/client-config-store";
import { getActiveHost } from "../../../config/client-config-types";
import { HostSwitchError, hostSwitchCoordinator } from "../../../config/host-switch-coordinator";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  buildMobileHostSwitcherEntries,
  buildWorkspaceScopedKey,
  type MobileHostSwitcherEntry,
  type MobileHostSwitcherWorkspaceEntry
} from "../../workbench/utils/host-workspace-switcher";
import type { MobileWorkspaceOption } from "../../workbench/utils/mobile-workspace-tree";
import { buildWorkspaceHomePath } from "../../workbench/utils/workbench-navigation";
import {
  listScopedWorkspaces,
  type ScopedWorkspaceDto,
  type WorkspaceRef
} from "../../conversation/api/conversation-api";
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
  readonly scopedWorkspaces?: readonly ScopedWorkspaceDto[];
  readonly onSelectWorkspace?: (
    workspaceId: string,
    workspaceRef?: WorkspaceRef
  ) => void | Promise<void>;
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
  scopedWorkspaces,
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
  const [loadedScopedWorkspaces, setLoadedScopedWorkspaces] = useState<readonly ScopedWorkspaceDto[]>([]);
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
  const effectiveScopedWorkspaces = scopedWorkspaces ?? loadedScopedWorkspaces;
  const hostSwitcherItems = buildMobileHostSwitcherEntries(runtimeConfig, switcherItems, effectiveScopedWorkspaces);
  const headerTitle = currentWorkspace?.name ?? activeHost?.name ?? null;
  const headerSubtitle = currentWorkspace?.path ?? activeHost?.baseUrl ?? null;

  useEffect(() => {
    if (!switcherOpen || scopedWorkspaces) {
      return;
    }

    let disposed = false;

    const inactiveHosts = runtimeConfig.hosts.filter((host) => host.id !== runtimeConfig.activeHostId);

    void Promise.allSettled([
      listScopedWorkspaces(),
      ...inactiveHosts.map((host) => listScopedWorkspaces(host.id))
    ]).then((results) => {
      if (disposed) {
        return;
      }

      setLoadedScopedWorkspaces(
        results.flatMap((result) =>
          result.status === "fulfilled" && Array.isArray(result.value.items)
            ? result.value.items
            : []
        )
      );
    });

    return () => {
      disposed = true;
    };
  }, [runtimeConfig.activeHostId, runtimeConfig.hosts, scopedWorkspaces, switcherOpen]);

  if (!headerTitle) {
    return null;
  }

  async function handleItemSelect(item: MobileHostSwitcherEntry): Promise<void> {
    const itemKey = item.scopedKey;

    if (pendingSelectionKey) {
      return;
    }

    setPendingSelectionKey(itemKey);

    try {
      if (!item.available) {
        showToast({
          title: resolveHostUnavailableMessage(item),
          tone: "error"
        });
        return;
      }

      if (
        item.host.id !== runtimeConfig.activeHostId
        && (item.kind === "host" || item.source !== "scoped")
      ) {
        void haptics.trigger("selection");
        await hostSwitchCoordinator.switchHost(item.host.id);
      }

      if (item.kind === "host") {
        navigate(buildWorkspaceHomePath());
      } else if (item.scopedKey !== buildCurrentWorkspaceScopedKey(runtimeConfig.activeHostId, currentWorkspace?.id)) {
        await onSelectWorkspace?.(
          item.workspace.id,
          item.workspaceRef.hostId === "current" ? undefined : item.workspaceRef
        );
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
        ? (
            <WorkspaceSwitcherSheet
              open={switcherOpen}
              title={t("shell.hostWorkspaceSwitcherTitle")}
              onClose={() => setSwitcherOpen(false)}
            >
              <ModalList className="mobile-workspace-home-group mobile-workspace-home-sheet-group">
                {hostSwitcherItems.map((item) => (
                  <ModalListItem
                    key={item.scopedKey}
                    as="button"
                    className="mobile-workspace-home-row mobile-workspace-home-sheet-row"
                    data-host-entry-kind={item.kind}
                    data-host-active={item.host.id === runtimeConfig.activeHostId}
                    data-host-available={item.available}
                    data-worktree-kind={item.kind === "workspace" ? item.option.kind : undefined}
                    data-worktree-depth={item.kind === "workspace" ? item.option.depth + 1 : 0}
                    disabled={pendingSelectionKey !== null}
                    selected={
                      (item.kind === "host" && item.host.id === runtimeConfig.activeHostId)
                      || (item.kind === "workspace"
                        && item.scopedKey === buildCurrentWorkspaceScopedKey(runtimeConfig.activeHostId, currentWorkspace?.id))
                    }
                    trailing={
                      <span className="mobile-workspace-home-row-trailing">
                        {item.kind === "host" && item.host.id === runtimeConfig.activeHostId ? (
                          <CheckIcon />
                        ) : item.kind === "workspace"
                          && item.scopedKey === buildCurrentWorkspaceScopedKey(runtimeConfig.activeHostId, currentWorkspace?.id) ? (
                            <CheckIcon />
                          ) : !item.available ? (
                            <UnavailableIcon />
                          ) : (
                            <ChevronRightIcon />
                          )}
                      </span>
                    }
                    style={
                      {
                        "--mobile-workspace-tree-depth": String(
                          item.kind === "host" ? 0 : item.option.depth + 1
                        )
                      } as CSSProperties
                    }
                    onClick={() => {
                      void handleItemSelect(item);
                    }}
                    label={
                      <span
                        className={
                          item.kind === "host"
                            ? "mobile-workspace-home-sheet-label mobile-host-workspace-switcher-host-label"
                            : "mobile-workspace-home-sheet-label"
                        }
                      >
                        {item.kind === "host" ? (
                          <ModalTag className="mobile-host-workspace-switcher-host-badge">
                            {t("shell.hostSwitcherNodeBadge")}
                          </ModalTag>
                        ) : null}
                        {item.kind === "workspace" && item.option.kind === "worktree" ? (
                          <ModalTag className="mobile-workspace-home-worktree-badge">
                            {t("shell.mobileWorktreeBadge")}
                          </ModalTag>
                        ) : null}
                        {item.kind === "workspace" && item.host.id !== runtimeConfig.activeHostId ? (
                          <ModalTag className="mobile-host-workspace-switcher-host-badge">
                            {item.host.name}
                          </ModalTag>
                        ) : null}
                        {item.kind === "workspace" && !item.available ? (
                          <ModalTag className="mobile-host-workspace-switcher-host-badge">
                            {t("shell.hostSwitcherPeerUnavailableBadge")}
                          </ModalTag>
                        ) : null}
                        <span className="mobile-workspace-home-sheet-label-text">
                          {item.kind === "host" ? item.host.name : item.option.label}
                        </span>
                      </span>
                    }
                    description={
                      <span className="mobile-workspace-home-sheet-description">
                        {item.kind === "host"
                          ? formatHostSummary(item.host, item.workspaceCount)
                          : formatWorkspaceSummary(item)}
                      </span>
                    }
                  />
                ))}
              </ModalList>
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

function resolveHostUnavailableMessage(item: MobileHostSwitcherEntry): string {
  if (item.hostStatus === "version_mismatch") {
    return t("shell.hostSwitcherPeerVersionMismatch", { hostName: item.host.name });
  }

  if (item.hostStatus === "unauthorized") {
    return t("shell.hostSwitcherPeerUnauthorized", { hostName: item.host.name });
  }

  return t("shell.hostSwitcherPeerUnavailable", { hostName: item.host.name });
}

function buildCurrentWorkspaceScopedKey(activeHostId: string | null, workspaceId: string | null | undefined): string {
  if (!workspaceId) {
    return "";
  }

  return buildWorkspaceScopedKey(activeHostId ? "current" : "current", workspaceId);
}

function formatWorkspaceSummary(item: MobileHostSwitcherWorkspaceEntry): string {
  if (!item.available) {
    return t("shell.hostSwitcherPeerWorkspaceUnavailableDescription", {
      hostName: item.host.name
    });
  }

  if (item.hostStatus === "current") {
    return item.option.subtitle;
  }

  return t("shell.hostSwitcherPeerWorkspaceDescription", {
    hostName: item.host.name,
    path: item.option.subtitle
  });
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

function WorkspaceSwitcherSheet({
  open,
  title,
  onClose,
  children
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <MobileSheet
      open={open}
      title={title}
      kind="picker"
      height="three-quarter"
      className="mobile-host-workspace-switcher-sheet"
      bodyClassName="mobile-workspace-home-form"
      showHandle
      onClose={onClose}
    >
      {children}
    </MobileSheet>
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

function UnavailableIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 4.5l7 7M12.5 8A4.5 4.5 0 1 1 8 3.5 4.5 4.5 0 0 1 12.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
