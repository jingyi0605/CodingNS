import { useEffect, useMemo, useState } from "react";

import {
  listProviderCatalog,
  type ProviderCatalogEntryDto,
  type ProviderId
} from "../api/conversation-api";
import { orderProviderIds } from "./provider-ui";

interface UseEnabledProviderCatalogResult {
  providerCatalog: ProviderCatalogEntryDto[] | null;
  visibleProviders: ProviderId[];
  loading: boolean;
}

export function useEnabledProviderCatalog(
  providers: readonly ProviderId[],
  enabled = true
): UseEnabledProviderCatalogResult {
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntryDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const orderedProviders = useMemo(
    () => orderProviderIds(providers),
    [providers]
  );
  const providersKey = orderedProviders.join("|");

  useEffect(() => {
    if (!enabled) {
      setProviderCatalog(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);

    void listProviderCatalog()
      .then((items) => {
        if (!disposed) {
          setProviderCatalog(items);
        }
      })
      .catch(() => {
        if (!disposed) {
          setProviderCatalog(null);
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [enabled, providersKey]);

  const visibleProviders = useMemo(() => {
    if (!providerCatalog) {
      return orderedProviders;
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
    loading
  };
}
