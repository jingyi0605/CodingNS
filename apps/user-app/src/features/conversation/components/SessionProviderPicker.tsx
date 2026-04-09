import { useEffect } from "react";

import type { ProviderId } from "../api/conversation-api";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import {
  getProviderDisplayName,
  getProviderIcon,
  SESSION_PROVIDER_PICKER_IDS,
  warmProviderIconCache
} from "../capability/provider-ui";

interface SessionProviderDefinition {
  provider: ProviderId;
}

interface SessionProviderPickerProps {
  disabled?: boolean;
  pendingProvider?: ProviderId | null;
  onSelect: (provider: ProviderId) => void;
}

const SESSION_PROVIDER_DEFINITIONS: SessionProviderDefinition[] =
  SESSION_PROVIDER_PICKER_IDS.map((provider) => ({ provider }));

export function SessionProviderPicker({
  disabled = false,
  pendingProvider = null,
  onSelect
}: SessionProviderPickerProps) {
  const haptics = useHaptics();

  useEffect(() => {
    warmProviderIconCache();
  }, []);

  return (
    <div className="session-provider-grid">
      {SESSION_PROVIDER_DEFINITIONS.map((item) => {
        const label = getProviderDisplayName(item.provider, "full");
        const isPending = pendingProvider === item.provider;

        return (
          <button
            key={item.provider}
            type="button"
            className="session-provider-card"
            data-provider={item.provider}
            data-pending={isPending ? "true" : "false"}
            aria-label={label}
            disabled={disabled}
            onClick={() => {
              void haptics.trigger("action");
              onSelect(item.provider);
            }}
          >
            <span className="session-provider-card-icon" aria-hidden="true">
              <img src={getProviderIcon(item.provider)} alt="" loading="eager" decoding="async" />
            </span>
            <span className="session-provider-card-copy">
              <strong>{label}</strong>
              {isPending ? (
                <span className="session-provider-card-status">{t("shell.startingSession")}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
