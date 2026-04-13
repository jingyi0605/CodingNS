import { useCallback, type MouseEvent, type ReactNode } from "react";

import {
  canStartDesktopWindowDragFromTarget,
  startDesktopWindowDrag
} from "../../../platform/desktop/window-drag";
import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import { buildSessionTitlePresentation } from "../session-title";

import type { SessionSummaryDto } from "../api/conversation-api";
import {
  createWorkspaceToneStyle,
  type WorkspaceVisualContext
} from "../../workbench/utils/worktree-visual-context";

interface SessionHeaderProps {
  session: SessionSummaryDto | null;
  actions?: ReactNode;
  workspaceContext?: WorkspaceVisualContext | null;
}

function resolveTitleScale(title: string) {
  const length = title.trim().length;

  if (length <= 16) {
    return "xl";
  }

  if (length <= 26) {
    return "lg";
  }

  if (length <= 38) {
    return "md";
  }

  return "sm";
}

export function SessionHeader({ session, actions, workspaceContext = null }: SessionHeaderProps) {
  const platform = usePlatform();
  const handleHeaderMouseDownCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!platform.isDesktop || platform.ui.osFamily !== "macos" || event.button !== 0) {
      return;
    }

    if (!canStartDesktopWindowDragFromTarget(event.target)) {
      return;
    }

    void startDesktopWindowDrag();
  }, [platform.isDesktop, platform.ui.osFamily]);

  if (!session) {
    return (
      <header
        className="conversation-header conversation-header-skeleton"
        aria-hidden="true"
        data-window-drag-handle="conversation-header"
        onMouseDownCapture={handleHeaderMouseDownCapture}
      >
        <div className="conversation-header-main">
          <span className="skeleton-line short" />
          <span className="skeleton-line long" />
        </div>
        {actions ? <div className="conversation-header-actions">{actions}</div> : null}
      </header>
    );
  }

  const titlePresentation = buildSessionTitlePresentation(session.title, t("conversation.titleFallback"));
  const titleScale = resolveTitleScale(titlePresentation.displayTitle);

  return (
    <header
      className="conversation-header"
      data-workspace-tone={workspaceContext?.tone ?? "root"}
      style={createWorkspaceToneStyle(workspaceContext)}
      data-window-drag-handle="conversation-header"
      onMouseDownCapture={handleHeaderMouseDownCapture}
    >
      <div className="conversation-header-main">
        <h1 className={`conversation-title is-${titleScale}`} title={titlePresentation.fullTitle}>
          {titlePresentation.displayTitle}
        </h1>
      </div>
      {actions ? <div className="conversation-header-actions">{actions}</div> : null}
    </header>
  );
}
