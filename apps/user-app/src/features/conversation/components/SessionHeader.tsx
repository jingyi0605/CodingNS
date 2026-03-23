import { t } from "../../../shared/i18n";

import type {
  ProviderCapabilitiesDto,
  SessionSummaryDto
} from "../api/conversation-api";
import type { RuntimeConnectionState } from "../runtime/session-runtime-machine";

interface SessionHeaderProps {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  connectionState: RuntimeConnectionState;
  workspaceName?: string | null;
}

export function SessionHeader({
  session,
  workspaceName
}: SessionHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="conversation-header-main">
        <h1>{session?.title || t("conversation.titleFallback")}</h1>
        <p>
          {workspaceName ?? session?.workspaceId ?? t("common.unknown")}
        </p>
      </div>
    </header>
  );
}
