import { t } from "../../../shared/i18n";

import type {
  ProviderCapabilitiesDto,
  SessionSummaryDto
} from "../api/conversation-api";
import { connectionTone, summarizeCapabilities } from "../runtime/session-runtime-store";
import type { RuntimeConnectionState } from "../runtime/session-runtime-machine";

interface SessionHeaderProps {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  connectionState: RuntimeConnectionState;
  workspaceName?: string | null;
}

export function SessionHeader({
  session,
  capabilities,
  connectionState,
  workspaceName
}: SessionHeaderProps) {
  const capabilitySummary = summarizeCapabilities(capabilities);

  return (
    <header className="conversation-panel surface-card conversation-header">
      <div className="conversation-header-main">
        <div className="badge-row">
          <span className="badge" data-tone={connectionTone(connectionState)}>
            {connectionState === "connected"
              ? t("conversation.connectionConnected")
              : connectionState === "reconnecting"
                ? t("conversation.connectionReconnecting")
                : connectionState === "reconnect_failed"
                  ? t("conversation.connectionReconnectFailed")
                  : t("conversation.connectionClosed")}
          </span>
          <span className="badge">{session?.provider ?? t("common.unknown")}</span>
        </div>
        <h1>{session?.title || t("conversation.titleFallback")}</h1>
        <p>
          {t("conversation.headerWorkspace")} /{" "}
          {workspaceName ?? session?.workspaceId ?? t("common.unknown")}
        </p>
      </div>

      <div className="badge-row">
        {capabilitySummary.map((item) => (
          <span key={item} className="badge">
            {item}
          </span>
        ))}
        {capabilities?.limitations.slice(0, 2).map((item) => (
          <span key={item} className="badge" data-tone="error">
            {item}
          </span>
        ))}
      </div>
    </header>
  );
}
