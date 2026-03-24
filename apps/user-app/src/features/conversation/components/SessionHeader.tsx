import { t } from "../../../shared/i18n";

import type { SessionSummaryDto } from "../api/conversation-api";

interface SessionHeaderProps {
  session: SessionSummaryDto | null;
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

export function SessionHeader({ session }: SessionHeaderProps) {
  if (!session) {
    return (
      <header className="conversation-header conversation-header-skeleton" aria-hidden="true">
        <div className="conversation-header-main">
          <span className="skeleton-line short" />
          <span className="skeleton-line long" />
        </div>
      </header>
    );
  }

  const title = session.title || t("conversation.titleFallback");
  const titleScale = resolveTitleScale(title);

  return (
    <header className="conversation-header">
      <div className="conversation-header-main">
        <h1 className={`conversation-title is-${titleScale}`} title={title}>
          {title}
        </h1>
      </div>
    </header>
  );
}
