import { t } from "../../../shared/i18n";

import type { RuntimeConnectionState } from "../runtime/session-runtime-machine";

interface ConnectionBannerProps {
  connectionState: RuntimeConnectionState;
  onReconnect: () => void;
}

export function ConnectionBanner({ connectionState, onReconnect }: ConnectionBannerProps) {
  if (connectionState === "connected" || connectionState === "closed") {
    return null;
  }

  const description =
    connectionState === "reconnect_failed"
      ? t("conversation.reconnectFailedExplain")
      : t("conversation.reconnectExplain");

  return (
    <section className="connection-banner" aria-live="polite">
      <div>
        <strong>
          {connectionState === "reconnect_failed"
            ? t("conversation.connectionReconnectFailed")
            : t("conversation.connectionReconnecting")}
        </strong>
        <p className="status-text">{description}</p>
      </div>
      {connectionState === "reconnect_failed" ? (
        <button className="secondary-button" type="button" onClick={onReconnect}>
          {t("conversation.reconnectButton")}
        </button>
      ) : null}
    </section>
  );
}
