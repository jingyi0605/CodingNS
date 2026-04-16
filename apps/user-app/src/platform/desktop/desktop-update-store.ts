import { useSyncExternalStore } from "react";

import type { DesktopReleaseState } from "../../config/client-config-types";

type Listener = () => void;

export interface DesktopUpdateStoreState {
  readonly latestState: DesktopReleaseState | null;
  readonly lastNotifiedVersion: string | null;
}

const INITIAL_STATE: DesktopUpdateStoreState = {
  latestState: null,
  lastNotifiedVersion: null
};

class DesktopUpdateStore {
  private state: DesktopUpdateStoreState = INITIAL_STATE;
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  recordState(nextState: DesktopReleaseState): void {
    this.state = {
      latestState: nextState,
      lastNotifiedVersion: nextState.hasUpdate ? this.state.lastNotifiedVersion : null
    };
    this.emit();
  }

  markVersionNotified(version: string): void {
    if (this.state.lastNotifiedVersion === version) {
      return;
    }

    this.state = {
      ...this.state,
      lastNotifiedVersion: version
    };
    this.emit();
  }

  reset(): void {
    this.state = INITIAL_STATE;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const desktopUpdateStore = new DesktopUpdateStore();

export function useDesktopUpdateSelector<T>(selector: (state: DesktopUpdateStoreState) => T): T {
  return useSyncExternalStore(desktopUpdateStore.subscribe, () => selector(desktopUpdateStore.getState()));
}

export function getDesktopUpdateSnapshot(): DesktopUpdateStoreState {
  return desktopUpdateStore.getState();
}

export function recordDesktopUpdateState(state: DesktopReleaseState): void {
  desktopUpdateStore.recordState(state);
}

export function markDesktopUpdateVersionNotified(version: string): void {
  desktopUpdateStore.markVersionNotified(version);
}

export function resetDesktopUpdateState(): void {
  desktopUpdateStore.reset();
}
