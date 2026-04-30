import { useEffect, useMemo, useState } from "react";

import type { ProviderCatalogEntryDto, ProviderId } from "../api/conversation-api";
import { orderProviderIds } from "./provider-ui";
import { useProviderCatalog } from "./provider-catalog-store";

interface UseEnabledProviderCatalogResult {
  providerCatalog: ProviderCatalogEntryDto[] | null;
  visibleProviders: ProviderId[];
  loading: boolean;
  ready: boolean;
}

export function useEnabledProviderCatalog(
  providers: readonly ProviderId[],
  enabled = true
): UseEnabledProviderCatalogResult {
  const orderedProviders = useMemo(
    () => orderProviderIds(providers),
    [providers]
  );
  const { items: providerCatalog, loading, requested } = useProviderCatalog(enabled);

  const visibleProviders = useMemo(() => {
    if (!providerCatalog) {
      return requested && !loading ? orderedProviders : [];
    }

    const requestedProviderSet = new Set(orderedProviders);
    const enabledProviders = providerCatalog
      .filter((item) => item.enabled && requestedProviderSet.has(item.provider))
      .map((item) => item.provider);

    return orderProviderIds(enabledProviders);
  }, [orderedProviders, providerCatalog]);

  return {
    providerCatalog,
    visibleProviders,
    loading,
    ready: providerCatalog !== null || (requested && !loading)
  };
}
