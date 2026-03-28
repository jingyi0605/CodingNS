import { t } from "../../../shared/i18n";
import { usePlatform } from "../../../platform/platform-provider";
import { buildSessionTitlePresentation } from "../session-title";

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
  const platform = usePlatform();
  const dragRegionProps = platform.isDesktop ? { "data-tauri-drag-region": true } : {};

  if (!session) {
    return (
      <header className="conversation-header conversation-header-skeleton" aria-hidden="true" {...dragRegionProps}>
        <div className="conversation-header-main" {...dragRegionProps}>
          <span className="skeleton-line short" />
          <span className="skeleton-line long" />
        </div>
      </header>
    );
  }

  const titlePresentation = buildSessionTitlePresentation(session.title, t("conversation.titleFallback"));
  const titleScale = resolveTitleScale(titlePresentation.displayTitle);

  return (
    <header className="conversation-header" {...dragRegionProps}>
      <div className="conversation-header-main" {...dragRegionProps}>
        <h1 className={`conversation-title is-${titleScale}`} title={titlePresentation.fullTitle} {...dragRegionProps}>
          {titlePresentation.displayTitle}
        </h1>
      </div>
    </header>
  );
}
