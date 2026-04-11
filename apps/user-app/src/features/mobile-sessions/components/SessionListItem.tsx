import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import {
  hasSessionDisplayError,
  resolveSessionActivityBadgeClassName,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassName
} from "../../conversation/session-activity-display";
import type { SessionSummaryDto } from "../../conversation/api/conversation-api";
import { getProviderDisplayName } from "../../conversation/capability/provider-ui";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";

const LONG_PRESS_DELAY_MS = 420;
const MENU_EDGE_PADDING_PX = 12;
const MENU_GAP_PX = 8;
const MENU_MIN_WIDTH_PX = 160;
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
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const errorSummary = getSessionErrorSummary(session);
  const errorPreview = errorSummary ? truncateSessionErrorSummary(errorSummary) : null;
  const activityBadgeLabel = variant === "mobile" ? null : resolveSessionActivityBadgeLabel(session);
  const activityBadgeClassName =
    activityBadgeLabel
      ? resolveSessionActivityBadgeClassName("session-list-activity-badge", session)
      : null;

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || typeof window === "undefined") {
      setMenuPositionStyle(null);
      return;
    }

    let animationFrameId = 0;

    const updateMenuPosition = () => {
      const triggerElement = menuTriggerRef.current;

      if (!triggerElement) {
        return;
      }

      const triggerRect = triggerElement.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxMenuWidth = Math.max(0, viewportWidth - MENU_EDGE_PADDING_PX * 2);
      const menuWidth = maxMenuWidth > 0
        ? Math.min(
            Math.max(menuRef.current?.offsetWidth ?? MENU_MIN_WIDTH_PX, MENU_MIN_WIDTH_PX),
            maxMenuWidth
          )
        : MENU_MIN_WIDTH_PX;
      const menuHeight = Math.max(menuRef.current?.offsetHeight ?? 0, MENU_ESTIMATED_HEIGHT_PX);
      const preferredLeft = triggerRect.right - menuWidth;
      const maxLeft = Math.max(MENU_EDGE_PADDING_PX, viewportWidth - menuWidth - MENU_EDGE_PADDING_PX);
      const left = Math.min(Math.max(MENU_EDGE_PADDING_PX, preferredLeft), maxLeft);
      const spaceAbove = triggerRect.top - MENU_EDGE_PADDING_PX;
      const spaceBelow = viewportHeight - triggerRect.bottom - MENU_EDGE_PADDING_PX;
      const shouldPlaceAbove = spaceBelow < menuHeight + MENU_GAP_PX && spaceAbove > spaceBelow;
      const preferredTop = shouldPlaceAbove
        ? triggerRect.top - menuHeight - MENU_GAP_PX
        : triggerRect.bottom + MENU_GAP_PX;
      const maxTop = Math.max(MENU_EDGE_PADDING_PX, viewportHeight - menuHeight - MENU_EDGE_PADDING_PX);
      const top = Math.min(Math.max(MENU_EDGE_PADDING_PX, preferredTop), maxTop);

      // 菜单挂到 body 后，必须按视口坐标夹紧，避免横向或纵向跑出屏幕。
      setMenuPositionStyle({
        position: "fixed",
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${Math.round(menuWidth)}px`,
        maxWidth: `calc(100vw - ${MENU_EDGE_PADDING_PX * 2}px)`,
        maxHeight: `${Math.max(96, viewportHeight - MENU_EDGE_PADDING_PX * 2)}px`,
        transformOrigin: shouldPlaceAbove ? "bottom right" : "top right"
      });
    };

    const requestPositionUpdate = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(updateMenuPosition);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (
        target
        && !menuRef.current?.contains(target)
        && !menuTriggerRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    requestPositionUpdate();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", requestPositionUpdate);
    window.addEventListener("scroll", requestPositionUpdate, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", requestPositionUpdate);
      window.removeEventListener("scroll", requestPositionUpdate, true);
    };
  }, [menuOpen]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!hasSubsessions || event.pointerType === "mouse") {
      return;
    }

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = true;
      void haptics.trigger("gesture");
      onToggleSubsessions?.();
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
    setMenuOpen(false);
  };

  const handleArchiveEntry = async () => {
    if (session.isArchived) {
      await onUnarchive(session.sessionId);
      setMenuOpen(false);
      return;
    }

    await onArchive(session.sessionId);
    setMenuOpen(false);
  };

  const handleToggleFavoriteEntry = () => {
    onToggleFavorite(session.sessionId);
    setMenuOpen(false);
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
      data-has-subsessions={hasSubsessions}
      data-variant={variant}
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
          <span className="session-list-subsession-toggle-icon" aria-hidden="true">
            <ChevronIcon expanded={subsessionsExpanded} />
          </span>
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
      >
        <div className="session-list-copy">
          <div className="session-list-title">{title || t("shell.searchEntry")}</div>
          <div className="session-list-meta">
            {variant === "mobile" ? (
              <span>{mobileMeta}</span>
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
          {errorPreview ? (
            <div className="session-list-error" title={errorSummary ?? undefined}>
              {errorPreview}
            </div>
          ) : null}
        </div>
      </button>
      {showActions ? (
        <div className="session-list-actions">
          <button
            ref={menuTriggerRef}
            type="button"
            className="ghost-button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => {
              void haptics.trigger("selection");
              setMenuOpen((current) => !current);
            }}
          >
            {t("shell.sessionMoreAction")}
          </button>
        </div>
      ) : null}
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
  return (
    hasSessionDisplayError(session)
    || session.syncStatus === "error"
  );
}

function getSessionErrorSummary(session: WorkbenchNavigationEntry["session"]) {
  if (!hasSessionError(session)) {
    return null;
  }

  const errorCode = session.lastErrorCode?.trim() ?? "";
  const errorDetail = session.lastErrorDetail?.replace(/\s+/g, " ").trim() ?? "";

  if (errorCode && errorDetail && !errorDetail.includes(errorCode)) {
    return `${errorCode} · ${errorDetail}`;
  }

  if (errorDetail) {
    return errorDetail;
  }

  if (errorCode) {
    return errorCode;
  }

  if (session.syncStatus === "error" && !hasSessionDisplayError(session)) {
    return t("conversation.syncStatusError");
  }

  return t("conversation.runtimeErrorTitle");
}

function truncateSessionErrorSummary(summary: string, maxLength = 96) {
  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 4.25L6 7.25L9 4.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transformOrigin: "50% 50%",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 180ms ease"
        }}
      />
    </svg>
  );
}
