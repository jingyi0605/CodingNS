import { useEffect, useRef, useState, type PointerEvent } from "react";

import { t } from "../../../shared/i18n";

const LONG_PRESS_DELAY_MS = 420;

interface WorkbenchNavigationEntry {
  readonly session: {
    readonly sessionId: string;
    readonly title: string | null;
    readonly workspaceId: string;
    readonly provider: string;
    readonly activityState?: string | null;
    readonly isArchived?: boolean;
  };
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
  readonly hasSubsessions?: boolean;
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
  hasSubsessions = false,
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
  const { session, workspace } = entry;
  const title = session.title ?? session.sessionId;
  const providerLabel =
    session.provider === "codex"
      ? t("conversation.providerCodex")
      : session.provider === "opencode"
        ? t("conversation.providerOpenCode")
        : t("conversation.providerClaude");

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
          className={resolveSessionListIndicatorClassName({
            activityState: session.activityState ?? null,
            isActive,
            hasSubsessions
          })}
          aria-hidden="true"
        />
        <div className="session-list-copy">
          <div className="session-list-title">{title || t("shell.searchEntry")}</div>
          <div className="session-list-meta">
            <span>{workspace.name}</span>
            <span aria-hidden="true">·</span>
            <span>{providerLabel}</span>
          </div>
        </div>
      </button>
      <div className="session-list-actions">
        <button
          type="button"
          className="ghost-button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
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
    </article>
  );
}

function resolveSessionListIndicatorClassName(input: {
  activityState: string | null;
  isActive: boolean;
  hasSubsessions: boolean;
}) {
  if (input.hasSubsessions) {
    if (input.activityState === "running" || input.isActive) {
      return "session-list-indicator is-subagent-running";
    }

    return "session-list-indicator is-subagent";
  }

  if (input.activityState === "running") {
    return "session-list-indicator is-running";
  }

  return "session-list-indicator is-idle";
}
