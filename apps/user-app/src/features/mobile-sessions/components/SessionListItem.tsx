import { useState } from "react";

import { t } from "../../../shared/i18n";

interface WorkbenchNavigationEntry {
  readonly session: {
    readonly sessionId: string;
    readonly title: string | null;
    readonly workspaceId: string;
    readonly provider: string;
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
  readonly onActivate: (sessionId: string) => void;
  readonly onToggleFavorite: (sessionId: string) => void;
  readonly onArchive: (sessionId: string) => Promise<void>;
  readonly onUnarchive: (sessionId: string) => Promise<void>;
  readonly onRename: (sessionId: string, title: string) => Promise<unknown>;
}

export function SessionListItem({
  entry,
  isFavorite,
  onActivate,
  onToggleFavorite,
  onArchive,
  onUnarchive,
  onRename
}: SessionListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { session, workspace } = entry;
  const title = session.title ?? session.sessionId;
  const providerLabel = session.provider === "codex" ? t("conversation.providerCodex") : t("conversation.providerClaude");
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
    <article className="session-list-item">
      <button
        type="button"
        className="session-list-link"
        onClick={() => onActivate(session.sessionId)}
      >
        <div className="session-list-title">{title || t("shell.searchEntry")}</div>
        <div className="session-list-meta">
          <span>{workspace.name}</span>
          <span aria-hidden="true">·</span>
          <span>{providerLabel}</span>
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
