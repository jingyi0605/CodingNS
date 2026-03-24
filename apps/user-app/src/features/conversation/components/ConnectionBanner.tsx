import { useEffect } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

import type { RuntimeConnectionState } from "../runtime/session-runtime-machine";

interface ConnectionBannerProps {
  connectionState: RuntimeConnectionState;
  onReconnect: () => void;
}

export function ConnectionBanner({ connectionState, onReconnect }: ConnectionBannerProps) {
  const { showToast, dismissToast } = useToast();

  useEffect(() => {
    if (connectionState === "connected" || connectionState === "closed") {
      dismissToast("conversation-connection-state");
      return;
    }

    if (connectionState === "reconnect_failed") {
      showToast({
        id: "conversation-connection-state",
        title: t("conversation.connectionReconnectFailed"),
        description: t("conversation.reconnectFailedExplain"),
        tone: "warning",
        durationMs: null,
        action: {
          label: t("conversation.reconnectButton"),
          onClick: onReconnect
        }
      });
      return;
    }

    showToast({
      id: "conversation-connection-state",
      title: t("conversation.connectionReconnecting"),
      description: t("conversation.reconnectExplain"),
      tone: "info",
      durationMs: 3200
    });
  }, [connectionState, dismissToast, onReconnect, showToast]);

  return null;
}
