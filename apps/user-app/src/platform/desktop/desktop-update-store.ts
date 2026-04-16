import { useSyncExternalStore } from "react";

import type { DesktopReleaseState } from "../../config/client-config-types";

type Listener = () => void;

export interface DesktopUpdateStoreState {
  readonly latestState: DesktopReleaseState | null;
  readonly lastNotifiedVersion: string | null;
  readonly pendingRestartVersion: string | null;
}

const INITIAL_STATE: DesktopUpdateStoreState = {
  latestState: null,
  lastNotifiedVersion: null,
  pendingRestartVersion: null
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
    const pendingRestartVersion = normalizeVersion(this.state.pendingRestartVersion);
    const currentVersion = normalizeVersion(nextState.currentVersion);

    this.state = {
      latestState: nextState,
      lastNotifiedVersion: nextState.hasUpdate ? this.state.lastNotifiedVersion : null,
      pendingRestartVersion:
        pendingRestartVersion && pendingRestartVersion === currentVersion
          ? null
          : this.state.pendingRestartVersion
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

  markRestartPending(version: string): void {
    const normalizedVersion = normalizeVersion(version);

    if (!normalizedVersion || this.state.pendingRestartVersion === normalizedVersion) {
      return;
    }

    this.state = {
      ...this.state,
      pendingRestartVersion: normalizedVersion
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

function normalizeVersion(version: string | null | undefined): string | null {
  const normalizedVersion = version?.trim();
  return normalizedVersion ? normalizedVersion : null;
}

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

export function markDesktopUpdateRestartPending(version: string): void {
  desktopUpdateStore.markRestartPending(version);
}

export function resetDesktopUpdateState(): void {
  desktopUpdateStore.reset();
}
