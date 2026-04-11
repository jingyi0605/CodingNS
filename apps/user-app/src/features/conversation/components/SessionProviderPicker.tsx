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
  selectedProvider?: ProviderId | null;
  providers?: ProviderId[];
  className?: string;
  disabledReasons?: Readonly<Record<string, string | undefined>>;
  statusHintByProvider?: Readonly<Record<string, string | undefined>>;
  onSelect: (provider: ProviderId) => void;
}

export function SessionProviderPicker({
  disabled = false,
  pendingProvider = null,
  selectedProvider = null,
  providers = SESSION_PROVIDER_PICKER_IDS,
  className,
  disabledReasons,
  statusHintByProvider,
  onSelect
}: SessionProviderPickerProps) {
  const haptics = useHaptics();
  const sessionProviderDefinitions: SessionProviderDefinition[] = providers.map((provider) => ({ provider }));

  useEffect(() => {
    warmProviderIconCache();
  }, []);

  return (
    <div className={`session-provider-grid${className ? ` ${className}` : ""}`}>
      {sessionProviderDefinitions.map((item) => {
        const label = getProviderDisplayName(item.provider, "full");
        const isPending = pendingProvider === item.provider;
        const isSelected = selectedProvider === item.provider;
        const disabledReason = disabledReasons?.[item.provider] ?? null;
        const statusLabel = isPending
          ? t("shell.startingSession")
          : disabledReason
            ? disabledReason
            : statusHintByProvider?.[item.provider] ?? null;

        return (
          <button
            key={item.provider}
            type="button"
            className="session-provider-card"
            data-provider={item.provider}
            data-pending={isPending ? "true" : "false"}
            data-selected={isSelected ? "true" : "false"}
            aria-label={label}
            disabled={disabled || Boolean(disabledReason)}
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
              {statusLabel ? (
                <span className="session-provider-card-status">{statusLabel}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
