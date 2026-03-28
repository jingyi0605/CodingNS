import { useSyncExternalStore } from "react";

import type { ClientRuntimeConfig, ClientRuntimeConfigPatch } from "./client-config-types";
import {
  loadClientRuntimeConfig,
  persistClientRuntimeConfig,
  resolveDefaultHostBaseUrl
} from "./client-config-service";
import { resolveRuntimePlatform } from "../platform/platform-adapter";

type Listener = () => void;

function createFallbackState(): ClientRuntimeConfig {
  const platform = resolveRuntimePlatform();

  return {
    platform,
    hostBaseUrl: resolveDefaultHostBaseUrl(platform),
    releaseChannel: "stable",
    autoReconnect: true,
    autoCheckUpdate: platform === "desktop",
    language: "zh-CN",
    defaultPermissionMode: "default"
  };
}

class ClientConfigStore {
  private state = createFallbackState();
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  hydrate(config: ClientRuntimeConfig): void {
    this.state = config;
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
