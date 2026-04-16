import { t } from "../../../shared/i18n";
import { BranchTreeActionIcon } from "./ConversationActionIcons";
import { SessionButlerActionButton } from "./SessionButlerActionButton";

import type { SessionSummaryDto } from "../api/conversation-api";

export function MobileConversationSessionActions({
  session,
  onOpenBranchTree
}: {
  session: SessionSummaryDto | null;
  onOpenBranchTree?: (() => void) | undefined;
}) {
  if (!session) {
    return null;
  }

  return (
    <div className="mobile-conversation-session-actions">
      {onOpenBranchTree ? (
        <button
          type="button"
          className="conversation-header-ai-button"
          aria-label={t("conversation.branchTreeAction")}
          title={t("conversation.branchTreeAction")}
          onClick={onOpenBranchTree}
        >
          <span className="conversation-header-ai-button-label" aria-hidden="true">
            <BranchTreeActionIcon />
          </span>
        </button>
      ) : null}
      <SessionButlerActionButton session={session} />
    </div>
  );
}
