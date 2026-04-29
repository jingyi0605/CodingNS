import { useSyncExternalStore } from "react";

import type {
  ClientRuntimeConfig,
  ClientRuntimeConfigPatch,
  DiscoveredHostProfile,
  LegacyClientRuntimeConfigSnapshot
} from "./client-config-types";
import {
  loadClientRuntimeConfig,
  normalizeClientRuntimeConfigSnapshot,
  persistClientRuntimeConfig
} from "./client-config-service";
import { resolveRuntimePlatform } from "../platform/platform-adapter";

type Listener = () => void;

export interface ClientRuntimeStatePatch {
  activeDiscoveredHostId?: string | null;
  discoveredHosts?: DiscoveredHostProfile[];
  localHostDiscovery?: ClientRuntimeConfig["localHostDiscovery"];
}

function createFallbackState(): ClientRuntimeConfig {
  return normalizeClientRuntimeConfigSnapshot(null, resolveRuntimePlatform());
}

class ClientConfigStore {
  private state = createFallbackState();
  private initialized = false;
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  isInitialized = () => this.initialized;

  hydrate(config: ClientRuntimeConfig | LegacyClientRuntimeConfigSnapshot): void {
    this.state = normalizeClientRuntimeConfigSnapshot(config, this.state.platform);
    this.initialized = true;
    this.emit();
  }

  updateRuntime(patch: ClientRuntimeStatePatch): void {
    const nextDiscoveredHosts = patch.discoveredHosts ?? this.state.discoveredHosts;
    const nextActiveDiscoveredHostId =
      patch.activeDiscoveredHostId !== undefined
        ? patch.activeDiscoveredHostId
        : this.state.activeDiscoveredHostId;
    const resolvedActiveDiscoveredHostId =
      nextActiveDiscoveredHostId
      && nextDiscoveredHosts.some((host) => host.id === nextActiveDiscoveredHostId)
        ? nextActiveDiscoveredHostId
        : null;
    const nextLocalHostDiscovery = patch.localHostDiscovery ?? this.state.localHostDiscovery;

    if (
      nextDiscoveredHosts === this.state.discoveredHosts
      && resolvedActiveDiscoveredHostId === this.state.activeDiscoveredHostId
      && nextLocalHostDiscovery === this.state.localHostDiscovery
    ) {
      return;
    }

    this.state = {
      ...this.state,
      discoveredHosts: nextDiscoveredHosts,
      activeDiscoveredHostId: resolvedActiveDiscoveredHostId,
      localHostDiscovery: nextLocalHostDiscovery
    };
    this.emit();
  }

  async initialize(): Promise<ClientRuntimeConfig> {
    const config = await loadClientRuntimeConfig();
    this.hydrate(config);
    return config;
  }

  async update(patch: ClientRuntimeConfigPatch): Promise<ClientRuntimeConfig> {
    const nextState = await persistClientRuntimeConfig(this.state, patch);
    this.hydrate(nextState);
    return nextState;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const clientConfigStore = new ClientConfigStore();

export function useClientConfigSelector<T>(selector: (state: ClientRuntimeConfig) => T): T {
  return useSyncExternalStore(clientConfigStore.subscribe, () => selector(clientConfigStore.getState()));
}
