import { useSyncExternalStore } from "react";

import { clientConfigStore } from "./client-config-store";
import { getEffectiveActiveHostId } from "./client-config-types";

type Listener = () => void;

interface HostRuntimeState {
  epoch: number;
  activeHostId: string | null;
}

class HostRuntimeStore {
  private state: HostRuntimeState = {
    epoch: 0,
    activeHostId: getEffectiveActiveHostId(clientConfigStore.getState())
  };

  private listeners = new Set<Listener>();

  constructor() {
    clientConfigStore.subscribe(() => {
      const nextActiveHostId = getEffectiveActiveHostId(clientConfigStore.getState());

      if (nextActiveHostId === this.state.activeHostId) {
        return;
      }

      this.state = {
        epoch: this.state.epoch + 1,
        activeHostId: nextActiveHostId
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
