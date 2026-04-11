import { useEffect } from "react";
import { useState } from "react";

import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { listProviderCapabilities } from "../api/conversation-api";
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

const providerCapabilitiesCache = new Map<string, ProviderCapabilitiesDto>();

export function clearSessionProviderPickerCapabilityCache(): void {
  providerCapabilitiesCache.clear();
}

interface SessionProviderPickerProps {
  disabled?: boolean;
  workspaceId?: string | null;
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
  workspaceId = null,
  pendingProvider = null,
  selectedProvider = null,
  providers = SESSION_PROVIDER_PICKER_IDS,
  className,
  disabledReasons,
  statusHintByProvider,
  onSelect
}: SessionProviderPickerProps) {
  const haptics = useHaptics();
  const requiresCapabilityResolution = Boolean(workspaceId);
  const [capabilitiesByProvider, setCapabilitiesByProvider] = useState<
    Partial<Record<ProviderId, ProviderCapabilitiesDto>>
  >(() => readCachedCapabilities(providers, workspaceId));
  const sessionProviderDefinitions: SessionProviderDefinition[] = providers.map((provider) => ({ provider }));

  useEffect(() => {
    warmProviderIconCache();
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setCapabilitiesByProvider({});
      return;
    }

    const cachedCapabilities = readCachedCapabilities(providers, workspaceId);
    setCapabilitiesByProvider(cachedCapabilities);

    const missingProviders = providers.filter((provider) => !cachedCapabilities[provider]);

    if (missingProviders.length === 0) {
      return;
    }

    let cancelled = false;

    void listProviderCapabilities(missingProviders, workspaceId).then((nextCapabilities) => {
      writeCachedCapabilities(workspaceId, nextCapabilities);

      if (!cancelled) {
        setCapabilitiesByProvider((current) => ({
          ...current,
          ...nextCapabilities
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [providers, workspaceId]);

  return (
    <div className={`session-provider-grid${className ? ` ${className}` : ""}`}>
      {sessionProviderDefinitions.map((item) => {
        const label = getProviderDisplayName(item.provider, "full");
        const isPending = pendingProvider === item.provider;
        const isSelected = selectedProvider === item.provider;
        const capabilityResolved = Boolean(capabilitiesByProvider[item.provider]);
        const capabilityDisabledReason = resolveProviderDisabledReason(
          capabilitiesByProvider[item.provider] ?? null
        );
        const loadingDisabledReason =
          requiresCapabilityResolution && !capabilityResolved && !isPending
            ? t("shell.providerChecking")
            : null;
        const disabledReason =
          disabledReasons?.[item.provider]
          ?? capabilityDisabledReason
          ?? loadingDisabledReason;
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

function resolveProviderDisabledReason(capabilities: ProviderCapabilitiesDto | null): string | null {
  if (!capabilities || capabilities.canStartSession !== false) {
    return null;
  }

  return capabilities.limitations[0] ?? t("conversation.capabilityDenied");
}

function readCachedCapabilities(
  providers: readonly ProviderId[],
  workspaceId: string | null | undefined
): Partial<Record<ProviderId, ProviderCapabilitiesDto>> {
  const normalizedWorkspaceId = workspaceId?.trim() ?? "";

  if (!normalizedWorkspaceId) {
    return {};
  }

  const entries: Array<[ProviderId, ProviderCapabilitiesDto]> = [];

  for (const provider of providers) {
    const cached = providerCapabilitiesCache.get(buildCapabilityCacheKey(normalizedWorkspaceId, provider));

    if (cached) {
      entries.push([provider, cached]);
    }
  }

  return Object.fromEntries(entries) as Partial<Record<ProviderId, ProviderCapabilitiesDto>>;
}

function writeCachedCapabilities(
  workspaceId: string,
  capabilitiesByProvider: Partial<Record<ProviderId, ProviderCapabilitiesDto>>
): void {
  const normalizedWorkspaceId = workspaceId.trim();

  if (!normalizedWorkspaceId) {
    return;
  }

  for (const [provider, capabilities] of Object.entries(capabilitiesByProvider)) {
    if (!capabilities) {
      continue;
    }

    providerCapabilitiesCache.set(
      buildCapabilityCacheKey(normalizedWorkspaceId, provider as ProviderId),
      capabilities
    );
  }
}

function buildCapabilityCacheKey(workspaceId: string, provider: ProviderId): string {
  return `${workspaceId}::${provider}`;
}
