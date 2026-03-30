import { useSyncExternalStore } from "react";

type Listener = () => void;

interface LocalUiPreferenceState {
  showSystemFiles: boolean;
}

export const SHOW_SYSTEM_FILES_STORAGE_KEY = "codingns.file-panel.show-system-files";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readShowSystemFilesFromStorage(): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }

  return window.localStorage.getItem(SHOW_SYSTEM_FILES_STORAGE_KEY) === "1";
}

class LocalUiPreferenceStore {
  private state: LocalUiPreferenceState = {
    showSystemFiles: readShowSystemFilesFromStorage()
  };

  private listeners = new Set<Listener>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("storage", this.handleStorage);
    }
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  setShowSystemFiles(enabled: boolean): void {
    if (canUseLocalStorage()) {
      if (enabled) {
        window.localStorage.setItem(SHOW_SYSTEM_FILES_STORAGE_KEY, "1");
      } else {
        window.localStorage.removeItem(SHOW_SYSTEM_FILES_STORAGE_KEY);
      }
    }

    if (this.state.showSystemFiles === enabled) {
      return;
    }

    this.state = {
      showSystemFiles: enabled
    };
    this.emit();
  }

  private handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SHOW_SYSTEM_FILES_STORAGE_KEY) {
      return;
    }

    const nextValue = readShowSystemFilesFromStorage();

    if (this.state.showSystemFiles === nextValue) {
      return;
    }

    this.state = {
      showSystemFiles: nextValue
    };
    this.emit();
  };

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const localUiPreferenceStore = new LocalUiPreferenceStore();

export function useLocalUiPreferenceSelector<T>(
  selector: (state: LocalUiPreferenceState) => T
): T {
  return useSyncExternalStore(
    localUiPreferenceStore.subscribe,
    () => selector(localUiPreferenceStore.getState())
  );
}
