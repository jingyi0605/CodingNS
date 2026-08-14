import { useEffect, useSyncExternalStore } from "react";

import {
  getGlobalAffairsLibraryCapability,
  setGlobalAffairsLibraryEnabled,
  type AffairsLibraryBindingDto,
  type AffairsLibraryCapabilityDto
} from "../conversation/api/conversation-api";

interface AffairsLibraryCapabilitySnapshot {
  readonly enabled: boolean;
  readonly binding: AffairsLibraryBindingDto | null;
  readonly loading: boolean;
  readonly requested: boolean;
  readonly error: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: AffairsLibraryCapabilitySnapshot = {
  enabled: false,
  binding: null,
  loading: false,
  requested: false,
  error: null
};
let inFlight: Promise<AffairsLibraryCapabilitySnapshot> | null = null;

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: AffairsLibraryCapabilitySnapshot): void {
  snapshot = next;
  emitChange();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AffairsLibraryCapabilitySnapshot {
  return snapshot;
}

function normalizeCapability(payload: AffairsLibraryCapabilityDto): AffairsLibraryCapabilitySnapshot {
  return {
    enabled: payload.enabled === true,
    binding: payload.binding ?? null,
    loading: false,
    requested: true,
    error: null
  };
}

export function ensureAffairsLibraryCapabilityLoaded(force = false): Promise<AffairsLibraryCapabilitySnapshot> {
  if (!force) {
    if (snapshot.requested) {
      return Promise.resolve(snapshot);
    }

    if (inFlight) {
      return inFlight;
    }
  }

  setSnapshot({
    ...snapshot,
    loading: true,
    requested: true,
    error: null
  });

  inFlight = getGlobalAffairsLibraryCapability()
    .then((payload) => {
      const next = normalizeCapability(payload);
      setSnapshot(next);
      return next;
    })
    .catch((error) => {
      const next = {
        ...snapshot,
        enabled: false,
        binding: null,
        loading: false,
        requested: true,
        error: error instanceof Error ? error.message : String(error)
      };
      setSnapshot(next);
      return next;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function setAffairsLibraryCapabilityEnabled(enabled: boolean): Promise<AffairsLibraryCapabilitySnapshot> {
  setSnapshot({
    ...snapshot,
    loading: true,
    requested: true,
    error: null
  });

  try {
    const binding = await setGlobalAffairsLibraryEnabled({ enabled });
    const next = {
      enabled: binding.enabled === true,
      binding,
      loading: false,
      requested: true,
      error: null
    };
    setSnapshot(next);
    return next;
  } catch (error) {
    const next = {
      ...snapshot,
      loading: false,
      requested: true,
      error: error instanceof Error ? error.message : String(error)
    };
    setSnapshot(next);
    throw error;
  }
}

export function useAffairsLibraryCapability(autoLoad = true): AffairsLibraryCapabilitySnapshot {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    void ensureAffairsLibraryCapabilityLoaded(false);
  }, [autoLoad]);

  return current;
}

export function resetAffairsLibraryCapabilityStoreForTests(): void {
  inFlight = null;
  snapshot = {
    enabled: false,
    binding: null,
    loading: false,
    requested: false,
    error: null
  };
  emitChange();
}
