import { SessionButlerActionButton } from "./SessionButlerActionButton";

import type { SessionSummaryDto } from "../api/conversation-api";

export function MobileConversationSessionActions({
  session
}: {
  session: SessionSummaryDto | null;
}) {
  if (!session) {
    return null;
  }

  return <SessionButlerActionButton session={session} />;
}
