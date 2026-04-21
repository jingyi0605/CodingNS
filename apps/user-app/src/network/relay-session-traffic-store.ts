import { useSyncExternalStore } from "react";

import { authStore } from "../features/auth/store/auth-store";

type Listener = () => void;
type RelayWireDirection = "upstream" | "downstream";

export interface RelaySessionTrafficSummary {
  startedAt: string | null;
  updatedAt: string | null;
  upstreamBytes: number;
  downstreamBytes: number;
  totalBytes: number;
}

interface RelaySessionTrafficState {
  byHostId: Record<string, RelaySessionTrafficSummary>;
}

const EMPTY_TRAFFIC_SUMMARY: RelaySessionTrafficSummary = {
  startedAt: null,
  updatedAt: null,
  upstreamBytes: 0,
  downstreamBytes: 0,
  totalBytes: 0
};

class RelaySessionTrafficStore {
  private state: RelaySessionTrafficState = {
    byHostId: {}
  };

  private readonly listeners = new Set<Listener>();

  constructor() {
    authStore.subscribe(() => {
      if (!authStore.getState().session) {
        this.reset();
      }
    });
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSummary(hostId: string | null | undefined): RelaySessionTrafficSummary {
    if (!hostId) {
      return EMPTY_TRAFFIC_SUMMARY;
    }

    return this.state.byHostId[hostId] ?? EMPTY_TRAFFIC_SUMMARY;
  }

  recordWireBytes(hostId: string | null | undefined, direction: RelayWireDirection, bytes: number): void {
    if (!hostId || !Number.isFinite(bytes) || bytes <= 0) {
      return;
    }

    const current = this.state.byHostId[hostId] ?? EMPTY_TRAFFIC_SUMMARY;
    const updatedAt = new Date().toISOString();
    const nextSummary: RelaySessionTrafficSummary = {
      startedAt: current.startedAt ?? updatedAt,
      updatedAt,
      upstreamBytes:
        direction === "upstream"
          ? current.upstreamBytes + bytes
          : current.upstreamBytes,
      downstreamBytes:
        direction === "downstream"
          ? current.downstreamBytes + bytes
          : current.downstreamBytes,
      totalBytes: current.totalBytes + bytes
    };

    this.state = {
      byHostId: {
        ...this.state.byHostId,
        [hostId]: nextSummary
      }
    };
    this.emit();
  }

  reset(): void {
    if (Object.keys(this.state.byHostId).length === 0) {
      return;
    }

    this.state = {
      byHostId: {}
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const relaySessionTrafficStore = new RelaySessionTrafficStore();

export function recordRelaySessionWireBytes(
  hostId: string | null | undefined,
  direction: RelayWireDirection,
  bytes: number
): void {
  relaySessionTrafficStore.recordWireBytes(hostId, direction, bytes);
}

export function useRelaySessionTrafficSummary(hostId: string | null | undefined): RelaySessionTrafficSummary {
  return useSyncExternalStore(relaySessionTrafficStore.subscribe, () => relaySessionTrafficStore.getSummary(hostId));
}

export function resetRelaySessionTrafficStoreForTesting(): void {
  relaySessionTrafficStore.reset();
}
