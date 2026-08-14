import { useEffect } from "react";
import { useState } from "react";

import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { getProviderCapabilities } from "../api/conversation-api";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { normalizeTargetHostId } from "../../workbench/utils/resource-scope";
import {
  createDraftCapabilities,
  getProviderDisplayName,
  getProviderIcon,
  SESSION_PROVIDER_PICKER_IDS,
  warmProviderIconCache
} from "../capability/provider-ui";
import { useEnabledProviderCatalog } from "../capability/use-enabled-provider-catalog";

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
  targetHostId?: string | null;
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
  targetHostId = null,
  pendingProvider = null,
  selectedProvider = null,
  providers = SESSION_PROVIDER_PICKER_IDS,
  className,
  disabledReasons,
  statusHintByProvider,
  onSelect
}: SessionProviderPickerProps) {
  const haptics = useHaptics();
  /**
   * "current" 只是缓存 key 的约定值，不是有效的 peer host ID。
   * 传给 httpClient 时必须归一化为 null，否则 buildTargetHostProxyPath
   * 会拼出 /api/host-proxy/hosts/current/... 导致 404。
   */
  const targetHostIdForRequest = normalizeTargetHostId(targetHostId);

  const { visibleProviders, ready: providerCatalogReady } = useEnabledProviderCatalog(
    providers,
    true,
    targetHostIdForRequest
  );
  const requiresCapabilityResolution = Boolean(workspaceId);
  const [capabilitiesByProvider, setCapabilitiesByProvider] = useState<
    Partial<Record<ProviderId, ProviderCapabilitiesDto>>
  >(() => readCachedCapabilities(visibleProviders, workspaceId, targetHostIdForRequest));
  const sessionProviderDefinitions: SessionProviderDefinition[] = visibleProviders.map((provider) => ({ provider }));

  useEffect(() => {
    warmProviderIconCache();
  }, []);

  useEffect(() => {
    if (!providerCatalogReady) {
      setCapabilitiesByProvider({});
      return;
    }

    if (!workspaceId) {
      setCapabilitiesByProvider({});
      return;
    }

    const cachedCapabilities = readCachedCapabilities(visibleProviders, workspaceId, targetHostIdForRequest);
    setCapabilitiesByProvider(cachedCapabilities);

    const missingProviders = visibleProviders.filter((provider) => !cachedCapabilities[provider]);

    if (missingProviders.length === 0) {
      return;
    }

    let cancelled = false;

    // 每个供应商单独请求，完成一个刷新一个，不用等最慢的
    for (const provider of missingProviders) {
      void getProviderCapabilities(provider, workspaceId, undefined, {
        targetHostId: targetHostIdForRequest
      }).then((capabilities) => {
        if (cancelled) return;

        writeCachedCapabilities(workspaceId, targetHostIdForRequest, { [provider]: capabilities });
        setCapabilitiesByProvider((current) => ({
          ...current,
          [provider]: capabilities
        }));
      }).catch(() => {
        if (cancelled) return;

        // 单个供应商请求失败，用 fallback 让卡片从"检查中"变为可操作
        const fallback = createDraftCapabilities(provider);
        writeCachedCapabilities(workspaceId, targetHostIdForRequest, { [provider]: fallback });
        setCapabilitiesByProvider((current) => ({
          ...current,
          [provider]: fallback
        }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [providerCatalogReady, targetHostIdForRequest, visibleProviders, workspaceId]);

  if (!providerCatalogReady) {
    return (
      <div className={`session-provider-grid${className ? ` ${className}` : ""}`}>
        <div className="session-provider-card" aria-hidden="true" data-placeholder="true">
          <span className="session-provider-card-copy">
            <strong>{t("shell.providerChecking")}</strong>
          </span>
        </div>
      </div>
    );
  }

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
        const disabledReason =
          disabledReasons?.[item.provider]
          ?? capabilityDisabledReason;
        const statusLabel = isPending
          ? t("shell.startingSession")
          : disabledReason
            ? disabledReason
            : statusHintByProvider?.[item.provider]
              ?? (requiresCapabilityResolution && !capabilityResolved && !isPending
                ? t("shell.providerChecking")
                : null);

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
  workspaceId: string | null | undefined,
  targetHostId: string | null | undefined
): Partial<Record<ProviderId, ProviderCapabilitiesDto>> {
  const normalizedWorkspaceId = workspaceId?.trim() ?? "";
  const normalizedTargetHostId = normalizeTargetHostId(targetHostId) ?? "current";

  if (!normalizedWorkspaceId) {
    return {};
  }

  const entries: Array<[ProviderId, ProviderCapabilitiesDto]> = [];

  for (const provider of providers) {
    const cached = providerCapabilitiesCache.get(
      buildCapabilityCacheKey(normalizedWorkspaceId, normalizedTargetHostId, provider)
    );

    if (cached) {
      entries.push([provider, cached]);
    }
  }

  return Object.fromEntries(entries) as Partial<Record<ProviderId, ProviderCapabilitiesDto>>;
}

function writeCachedCapabilities(
  workspaceId: string,
  targetHostId: string | null | undefined,
  capabilitiesByProvider: Partial<Record<ProviderId, ProviderCapabilitiesDto>>
): void {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedTargetHostId = normalizeTargetHostId(targetHostId) ?? "current";

  if (!normalizedWorkspaceId) {
    return;
  }

  for (const [provider, capabilities] of Object.entries(capabilitiesByProvider)) {
    if (!capabilities) {
      continue;
    }

    providerCapabilitiesCache.set(
      buildCapabilityCacheKey(normalizedWorkspaceId, normalizedTargetHostId, provider as ProviderId),
      capabilities
    );
  }
}

function buildCapabilityCacheKey(workspaceId: string, targetHostId: string, provider: ProviderId): string {
  return `${targetHostId}::${workspaceId}::${provider}`;
}
