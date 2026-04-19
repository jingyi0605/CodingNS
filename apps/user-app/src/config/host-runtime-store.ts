import { useSyncExternalStore } from "react";

import { clientConfigStore } from "./client-config-store";
import { getActiveHost, getEffectiveActiveHostId } from "./client-config-types";

type Listener = () => void;

interface HostRuntimeState {
  epoch: number;
  activeHostId: string | null;
  connectionSignature: string;
}

class HostRuntimeStore {
  private state: HostRuntimeState = {
    epoch: 0,
    activeHostId: getEffectiveActiveHostId(clientConfigStore.getState()),
    connectionSignature: buildConnectionSignature(clientConfigStore.getState())
  };

  private listeners = new Set<Listener>();

  constructor() {
    clientConfigStore.subscribe(() => {
      const nextConfig = clientConfigStore.getState();
      const nextActiveHostId = getEffectiveActiveHostId(nextConfig);
      const nextConnectionSignature = buildConnectionSignature(nextConfig);

      if (
        nextActiveHostId === this.state.activeHostId
        && nextConnectionSignature === this.state.connectionSignature
      ) {
        return;
      }

      this.state = {
        epoch: this.state.epoch + 1,
        activeHostId: nextActiveHostId,
        connectionSignature: nextConnectionSignature
      };
      this.emit();
    });
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const hostRuntimeStore = new HostRuntimeStore();

export function useHostRuntimeBoundaryKey(): string {
  return useSyncExternalStore(hostRuntimeStore.subscribe, () => {
    const state = hostRuntimeStore.getState();
    return `${state.activeHostId ?? "anonymous"}:${state.epoch}`;
  });
}

function buildConnectionSignature(config: ReturnType<typeof clientConfigStore.getState>): string {
  const activeHost = getActiveHost(config);

  if (!activeHost) {
    return "no-host";
  }

  return JSON.stringify({
    id: activeHost.id,
    baseUrl: activeHost.baseUrl,
    relayTunnel: activeHost.relayTunnel
  });
}
