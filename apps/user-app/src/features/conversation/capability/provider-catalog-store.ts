import { useEffect, useSyncExternalStore } from "react";

import {
  listProviderCatalog,
  refreshProviderCatalog,
  updateProviderCatalogEntry,
  type ProviderCatalogEntryDto
} from "../api/conversation-api";

interface ProviderCatalogSnapshot {
  items: ProviderCatalogEntryDto[] | null;
  loading: boolean;
  requested: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: ProviderCatalogSnapshot = {
  items: null,
  loading: false,
  requested: false
};
let inFlight: Promise<ProviderCatalogEntryDto[] | null> | null = null;

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: ProviderCatalogSnapshot): void {
  snapshot = next;
  emitChange();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ProviderCatalogSnapshot {
  return snapshot;
}

export function ensureProviderCatalogLoaded(force = false): Promise<ProviderCatalogEntryDto[] | null> {
  if (!force) {
    if (snapshot.items) {
      return Promise.resolve(snapshot.items);
    }

    if (inFlight) {
      return inFlight;
    }
  }

  setSnapshot({
    ...snapshot,
    loading: true,
    requested: true
  });

  inFlight = listProviderCatalog()
    .then((items) => {
      setSnapshot({
        items,
        loading: false,
        requested: true
      });
      return items;
    })
    .catch(() => {
      setSnapshot({
        ...snapshot,
        items: null,
        loading: false,
        requested: true
      });
      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function refreshProviderCatalogStore(): Promise<ProviderCatalogEntryDto[] | null> {
  setSnapshot({
    ...snapshot,
    loading: true,
    requested: true
  });

  inFlight = refreshProviderCatalog()
    .then((items) => {
      setSnapshot({
        items,
        loading: false,
        requested: true
      });
      return items;
    })
    .catch(() => {
      setSnapshot({
        ...snapshot,
        loading: false,
        requested: true
      });
      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function updateProviderCatalogEntryInStore(entry: ProviderCatalogEntryDto): void {
  const currentItems = snapshot.items ?? [];
  const nextItems = replaceProviderCatalogEntry(currentItems, entry);

  setSnapshot({
    items: nextItems,
    loading: false,
    requested: true
  });
}

export async function setProviderCatalogEntryEnabled(
  provider: ProviderCatalogEntryDto["provider"],
  enabled: boolean
): Promise<ProviderCatalogEntryDto> {
  const entry = await updateProviderCatalogEntry(provider, enabled);
  updateProviderCatalogEntryInStore(entry);
  return entry;
}

export function clearProviderCatalogStore(): void {
  inFlight = null;
  setSnapshot({
    items: null,
    loading: false,
    requested: false
  });
}

export function useProviderCatalog(enabled = true) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void ensureProviderCatalogLoaded();
  }, [enabled]);

  return state;
}

function replaceProviderCatalogEntry(
  current: readonly ProviderCatalogEntryDto[],
  entry: ProviderCatalogEntryDto
): ProviderCatalogEntryDto[] {
  const next = current.slice();
  const index = next.findIndex((item) => item.provider === entry.provider);

  if (index >= 0) {
    next[index] = entry;
    return next;
  }

  next.push(entry);
  return next;
}
