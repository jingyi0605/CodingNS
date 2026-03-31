import { useEffect, useRef, useState, type PointerEvent } from "react";

import {
  hasSessionDisplayError,
  resolveSessionActivityBadgeClassName,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassName
} from "../../conversation/session-activity-display";
import type { SessionSummaryDto } from "../../conversation/api/conversation-api";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";

const LONG_PRESS_DELAY_MS = 420;

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
  readonly depth?: 0 | 1;
  readonly variant?: "default" | "mobile";
  readonly hasSubsessions?: boolean;
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
  showActions = true,
  onActivate,
  onToggleSubsessions,
  onToggleFavorite,
  onArchive,
  onUnarchive,
  onRename
}: SessionListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const haptics = useHaptics();
  const { session, workspace } = entry;
  const title = session.title ?? session.sessionId;
  const providerLabel =
    session.provider === "codex"
      ? t("conversation.providerCodex")
      : session.provider === "opencode"
        ? t("conversation.providerOpenCode")
        : t("conversation.providerClaude");
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

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
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

  return (
    <article
      className="session-list-item"
      data-depth={depth}
      data-active={isActive}
      data-has-subsessions={hasSubsessions}
      data-variant={variant}
    >
      <button
        type="button"
        className="session-list-link"
        onClick={handleActivate}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
      >
        <span
          className={resolveSessionListIndicatorClassName(session, {
            isActive,
            hasSubsessions
          })}
          aria-hidden="true"
        />
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
            type="button"
            className="ghost-button"
            aria-expanded={menuOpen}
            onClick={() => {
              void haptics.trigger("selection");
              setMenuOpen((current) => !current);
            }}
          >
            {t("shell.sessionMoreAction")}
          </button>
          {menuOpen ? (
            <div className="session-action-menu surface-card" role="menu" aria-label={t("shell.sessionMoreAction")}>
              <button type="button" className="session-action-menu-item" role="menuitem" onClick={handleToggleFavoriteEntry}>
                {isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction")}
              </button>
              <button type="button" className="session-action-menu-item" role="menuitem" onClick={() => void handleArchiveEntry()}>
                {session.isArchived ? t("shell.unarchiveAction") : t("shell.archiveAction")}
              </button>
              <button type="button" className="session-action-menu-item" role="menuitem" onClick={() => void handleRename()}>
                {t("shell.renameAction")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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

  return t("conversation.runtimeErrorTitle");
}

function truncateSessionErrorSummary(summary: string, maxLength = 96) {
  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
