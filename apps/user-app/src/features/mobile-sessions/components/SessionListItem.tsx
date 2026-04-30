import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";

import {
  hasSessionDisplayError,
  resolveSessionActivityBadgeClassName,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassName
} from "../../conversation/session-activity-display";
import { hasSessionErrorDisplayContent } from "../../conversation/session-error-display";
import type { SessionSummaryDto } from "../../conversation/api/conversation-api";
import { getProviderDisplayName } from "../../conversation/capability/provider-ui";
import {
  createParallelGroupStyle,
  resolveParallelGroupLabel,
  resolveParallelRoleLabel
} from "../../conversation/parallel-session-display";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import {
  resolveContextMenuPosition,
  type ContextMenuAnchorPoint
} from "../../workbench/utils/context-menu-position";

const LONG_PRESS_DELAY_MS = 420;
const MENU_ESTIMATED_HEIGHT_PX = 156;

interface WorkbenchNavigationEntry {
  readonly session: Pick<
    SessionSummaryDto,
    | "sessionId"
    | "title"
    | "workspaceId"
    | "provider"
    | "lastMessageAt"
    | "updatedAt"
    | "activityState"
    | "activitySource"
    | "activityResolutionSource"
    | "syncStatus"
    | "runningState"
    | "lastErrorCode"
    | "lastErrorDetail"
    | "isArchived"
    | "parallelGroup"
    | "sessionIsolatedWorkspace"
  >;
  readonly workspace: {
    readonly id: string;
    readonly name: string;
  };
}

interface SessionListItemProps {
  readonly entry: WorkbenchNavigationEntry;
  readonly isFavorite: boolean;
  readonly isActive?: boolean;
  readonly depth?: number;
  readonly variant?: "default" | "mobile";
  readonly workspaceTone?: "root" | "worktree";
  readonly hasSubsessions?: boolean;
  readonly subsessionsExpanded?: boolean;
  readonly showActions?: boolean;
  readonly onActivate: (sessionId: string) => void;
  readonly onToggleSubsessions?: () => void;
  readonly onToggleFavorite: (sessionId: string) => void;
  readonly onArchive: (sessionId: string) => Promise<void>;
  readonly onUnarchive: (sessionId: string) => Promise<void>;
  readonly onRename: (sessionId: string, title: string) => Promise<unknown>;
}

export function SessionListItem({
  entry,
  isFavorite,
  isActive = false,
  depth = 0,
  variant = "default",
  workspaceTone = "root",
  hasSubsessions = false,
  subsessionsExpanded = false,
  showActions = true,
  onActivate,
  onToggleSubsessions,
  onToggleFavorite,
  onArchive,
  onUnarchive,
  onRename
}: SessionListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPositionStyle, setMenuPositionStyle] = useState<CSSProperties | null>(null);
  const [menuAnchorPoint, setMenuAnchorPoint] = useState<ContextMenuAnchorPoint | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const haptics = useHaptics();
  const { session, workspace } = entry;
  const title = session.title ?? session.sessionId;
  const providerLabel = getProviderDisplayName(session.provider);
  const mobileMeta = [
    providerLabel,
    formatActivityTime(session.lastMessageAt ?? session.updatedAt ?? null),
    resolveSessionActivityBadgeLabel(session)
  ]
    .filter(Boolean)
    .join(" · ");
  const activityBadgeLabel = variant === "mobile" ? null : resolveSessionActivityBadgeLabel(session);
  const activityBadgeClassName =
    activityBadgeLabel
      ? resolveSessionActivityBadgeClassName("session-list-activity-badge", session)
      : null;
  const showParallelPresentation = variant !== "mobile";
  const parallelGroupLabel = showParallelPresentation ? resolveParallelGroupLabel(session.parallelGroup) : null;
  const parallelRoleLabel = showParallelPresentation ? resolveParallelRoleLabel(session.parallelGroup) : null;
  const parallelGroupStyle = showParallelPresentation ? createParallelGroupStyle(session.parallelGroup) : undefined;

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || !menuAnchorPoint || typeof window === "undefined") {
      setMenuPositionStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const nextPosition = resolveContextMenuPosition(
        menuAnchorPoint,
        {
          width: menuRef.current?.offsetWidth ?? 0,
          height: menuRef.current?.offsetHeight ?? 0
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        },
        {
          estimatedHeightPx: MENU_ESTIMATED_HEIGHT_PX
        }
      );

      setMenuPositionStyle({
        position: "fixed",
        left: `${Math.round(nextPosition.left)}px`,
        top: `${Math.round(nextPosition.top)}px`,
        width: `${Math.round(nextPosition.width)}px`,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: `${Math.round(nextPosition.maxHeight)}px`,
        transformOrigin: nextPosition.transformOrigin
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (
        target
        && !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    updateMenuPosition();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuAnchorPoint, menuOpen]);

  function openMenu(anchorPoint: ContextMenuAnchorPoint) {
    setMenuAnchorPoint(anchorPoint);
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    setMenuAnchorPoint(null);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!showActions || event.pointerType === "mouse") {
      return;
    }

    const anchorPoint = {
      x: event.clientX,
      y: event.clientY
    };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = true;
      void haptics.trigger("gesture");
      openMenu(anchorPoint);
    }, LONG_PRESS_DELAY_MS);
  }

  function handlePointerEnd() {
    clearLongPressTimer();
  }

  function handleActivate() {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    void haptics.trigger("selection");
    onActivate(session.sessionId);
  }

  const handleRename = async () => {
    const nextTitle = window.prompt(t("shell.renameModalDescription"), title);
    if (!nextTitle) {
      return;
    }

    await onRename(session.sessionId, nextTitle.trim());
    closeMenu();
  };

  const handleArchiveEntry = async () => {
    if (session.isArchived) {
      await onUnarchive(session.sessionId);
      closeMenu();
      return;
    }

    await onArchive(session.sessionId);
    closeMenu();
  };

  const handleToggleFavoriteEntry = () => {
    onToggleFavorite(session.sessionId);
    closeMenu();
  };

  const handleKeyboardContextMenu = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    openMenu({
      x: anchorRect.right,
      y: anchorRect.bottom
    });
  };

  const sessionActionMenu =
    menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="session-action-menu surface-card"
            role="menu"
            aria-label={t("shell.sessionMoreAction")}
            style={
              menuPositionStyle ?? {
                position: "fixed",
                top: 0,
                left: 0,
                visibility: "hidden"
              }
            }
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="session-action-menu-item" role="menuitem" onClick={handleToggleFavoriteEntry}>
              {isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction")}
            </button>
            <button type="button" className="session-action-menu-item" role="menuitem" onClick={() => void handleArchiveEntry()}>
              {session.isArchived ? t("shell.unarchiveAction") : t("shell.archiveAction")}
            </button>
            <button type="button" className="session-action-menu-item" role="menuitem" onClick={() => void handleRename()}>
              {t("shell.renameAction")}
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <article
      className="session-list-item"
      data-depth={depth}
      data-active={isActive}
      data-workspace-tone={workspaceTone}
      data-has-subsessions={hasSubsessions}
      data-variant={variant}
      data-parallel-group={showParallelPresentation && session.parallelGroup ? "true" : undefined}
      data-parallel-role={showParallelPresentation ? session.parallelGroup?.role ?? undefined : undefined}
      style={parallelGroupStyle}
      onContextMenu={(event) => {
        if (!showActions) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openMenu({
          x: event.clientX,
          y: event.clientY
        });
      }}
    >
      {hasSubsessions ? (
        <button
          type="button"
          className="session-list-subsession-toggle"
          aria-label={subsessionsExpanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
          title={subsessionsExpanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
          aria-expanded={subsessionsExpanded}
          onClick={(event) => {
            event.stopPropagation();
            void haptics.trigger("selection");
            onToggleSubsessions?.();
          }}
        >
          <span
            className={resolveSessionListIndicatorClassName(session, {
              isActive,
              hasSubsessions
            })}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span
          className={resolveSessionListIndicatorClassName(session, {
            isActive,
            hasSubsessions
          })}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        className="session-list-link"
        onClick={handleActivate}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onKeyDown={handleKeyboardContextMenu}
      >
        <div className="session-list-copy">
          <div className="session-list-title-row">
            <div className="session-list-title">{title || t("shell.searchEntry")}</div>
            {parallelGroupLabel ? <span className="session-list-parallel-badge">{parallelGroupLabel}</span> : null}
            {parallelRoleLabel ? <span className="session-list-parallel-role-badge">{parallelRoleLabel}</span> : null}
          </div>
          <div className="session-list-meta">
            {variant === "mobile" ? (
              <>
                <span>{mobileMeta}</span>
              </>
            ) : (
              <>
                <span>{workspace.name}</span>
                {activityBadgeLabel && activityBadgeClassName ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={activityBadgeClassName}>{activityBadgeLabel}</span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
                <span>{providerLabel}</span>
              </>
            )}
          </div>
        </div>
      </button>
      {sessionActionMenu}
    </article>
  );
}

function resolveSessionListIndicatorClassName(
  session: WorkbenchNavigationEntry["session"],
  options: {
    isActive: boolean;
    hasSubsessions: boolean;
  }
) {
  return resolveSessionIndicatorClassName("session-list-indicator", session, {
    isActive: options.isActive,
    hasSubagents: options.hasSubsessions
  });
}

function formatActivityTime(value: string | null) {
  if (!value) {
    return t("common.unknown");
  }

  return new Date(value).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function hasSessionError(session: WorkbenchNavigationEntry["session"]) {
  return hasSessionErrorDisplayContent(session);
}
