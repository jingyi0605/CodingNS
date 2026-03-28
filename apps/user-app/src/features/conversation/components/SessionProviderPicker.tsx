import type { ProviderId } from "../api/conversation-api";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import codexIcon from "../../../assets/provider-icons/codex.png";
import claudeCodeIcon from "../../../assets/provider-icons/claude-code.png";
import openCodeIcon from "../../../assets/provider-icons/opencode.png";

interface SessionProviderDefinition {
  provider: ProviderId;
}

interface SessionProviderPickerProps {
  disabled?: boolean;
  pendingProvider?: ProviderId | null;
  onSelect: (provider: ProviderId) => void;
}

const SESSION_PROVIDER_DEFINITIONS: SessionProviderDefinition[] = [
  {
    provider: "codex"
  },
  {
    provider: "claude-code"
  },
  {
    provider: "opencode"
  }
];

export function SessionProviderPicker({
  disabled = false,
  pendingProvider = null,
  onSelect
}: SessionProviderPickerProps) {
  const haptics = useHaptics();

  return (
    <div className="session-provider-grid">
      {/* 统一三家 provider 的入口，避免桌面端和移动端继续各写各的。 */}
      {SESSION_PROVIDER_DEFINITIONS.map((item) => {
        const label = getProviderLabel(item.provider);
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
              <img src={getProviderIcon(item.provider)} alt="" loading="lazy" />
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

function getProviderLabel(provider: ProviderId) {
  if (provider === "codex") {
    return t("conversation.providerCodex");
  }

  if (provider === "claude-code") {
    return t("shell.providerClaudeCode");
  }

  return t("conversation.providerOpenCode");
}

function getProviderIcon(provider: ProviderId) {
  if (provider === "codex") {
    return codexIcon;
  }

  if (provider === "claude-code") {
    return claudeCodeIcon;
  }

  return openCodeIcon;
}
