import { useEffect, useSyncExternalStore } from "react";

import {
  listProviderCatalog,
  refreshProviderCatalog,
  updateProviderCatalogEntry,
  type ProviderCatalogEntryDto
} from "../api/conversation-api";
import { normalizeTargetHostId } from "../../workbench/utils/resource-scope";

interface ProviderCatalogSnapshot {
  items: ProviderCatalogEntryDto[] | null;
  loading: boolean;
  requested: boolean;
}

type Listener = () => void;

const CURRENT_HOST_KEY = "current";
const EMPTY_PROVIDER_CATALOG_SNAPSHOT: ProviderCatalogSnapshot = {
  items: null,
  loading: false,
  requested: false
};

const listeners = new Set<Listener>();
const snapshotsByHost = new Map<string, ProviderCatalogSnapshot>();
const inFlightByHost = new Map<string, Promise<ProviderCatalogEntryDto[] | null>>();

function normalizeTargetHostKey(targetHostId?: string | null): string {
  return normalizeTargetHostId(targetHostId) ?? CURRENT_HOST_KEY;
}

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(hostKey: string, next: ProviderCatalogSnapshot): void {
  snapshotsByHost.set(hostKey, next);
  emitChange();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshotForHost(targetHostId?: string | null): ProviderCatalogSnapshot {
  return snapshotsByHost.get(normalizeTargetHostKey(targetHostId)) ?? EMPTY_PROVIDER_CATALOG_SNAPSHOT;
}

export function ensureProviderCatalogLoaded(
  force = false,
  targetHostId?: string | null
): Promise<ProviderCatalogEntryDto[] | null> {
  const hostKey = normalizeTargetHostKey(targetHostId);
  const currentSnapshot = getSnapshotForHost(targetHostId);

  if (!force) {
    if (currentSnapshot.items) {
      return Promise.resolve(currentSnapshot.items);
    }

    const currentInFlight = inFlightByHost.get(hostKey);
    if (currentInFlight) {
      return currentInFlight;
    }
  }

  setSnapshot(hostKey, {
    ...currentSnapshot,
    loading: true,
    requested: true
  });

  const inFlight = listProviderCatalog({ targetHostId })
    .then((items) => {
      setSnapshot(hostKey, {
        items,
        loading: false,
        requested: true
      });
      return items;
    })
    .catch(() => {
      setSnapshot(hostKey, {
        ...getSnapshotForHost(targetHostId),
        items: null,
        loading: false,
        requested: true
      });
      return null;
    })
    .finally(() => {
      if (inFlightByHost.get(hostKey) === inFlight) {
        inFlightByHost.delete(hostKey);
      }
    });

  inFlightByHost.set(hostKey, inFlight);
  return inFlight;
}

export function refreshProviderCatalogStore(
  targetHostId?: string | null
): Promise<ProviderCatalogEntryDto[] | null> {
  const hostKey = normalizeTargetHostKey(targetHostId);
  const currentSnapshot = getSnapshotForHost(targetHostId);

  setSnapshot(hostKey, {
    ...currentSnapshot,
    loading: true,
    requested: true
  });

  const inFlight = refreshProviderCatalog({ targetHostId })
    .then((items) => {
      setSnapshot(hostKey, {
        items,
        loading: false,
        requested: true
      });
      return items;
    })
    .catch(() => {
      setSnapshot(hostKey, {
        ...getSnapshotForHost(targetHostId),
        loading: false,
        requested: true
      });
      return null;
    })
    .finally(() => {
      if (inFlightByHost.get(hostKey) === inFlight) {
        inFlightByHost.delete(hostKey);
      }
    });

  inFlightByHost.set(hostKey, inFlight);
  return inFlight;
}

export function updateProviderCatalogEntryInStore(
  entry: ProviderCatalogEntryDto,
  targetHostId?: string | null
): void {
  const hostKey = normalizeTargetHostKey(targetHostId);
  const currentSnapshot = getSnapshotForHost(targetHostId);
  const currentItems = currentSnapshot.items ?? [];
  const nextItems = replaceProviderCatalogEntry(currentItems, entry);

  setSnapshot(hostKey, {
    items: nextItems,
    loading: false,
    requested: true
  });
}

export async function setProviderCatalogEntryEnabled(
  provider: ProviderCatalogEntryDto["provider"],
  enabled: boolean,
  targetHostId?: string | null
): Promise<ProviderCatalogEntryDto> {
  const entry = await updateProviderCatalogEntry(provider, enabled, { targetHostId });
  updateProviderCatalogEntryInStore(entry, targetHostId);
  return entry;
}

export function clearProviderCatalogStore(): void {
  inFlightByHost.clear();
  snapshotsByHost.clear();
  emitChange();
}

export function useProviderCatalog(enabled = true, targetHostId?: string | null) {
  const state = useSyncExternalStore(
    subscribe,
    () => getSnapshotForHost(targetHostId),
    () => getSnapshotForHost(targetHostId)
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void ensureProviderCatalogLoaded(false, targetHostId);
  }, [enabled, targetHostId]);

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
