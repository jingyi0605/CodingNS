import { useSyncExternalStore } from "react";

type Listener = () => void;

export type SessionDisplaySortMode = "createdAt" | "updatedAt" | "title";

export interface LocalNotificationPreferenceState {
  notifyOnPermissionRequest: boolean;
  notifyOnSessionCompleted: boolean;
  notifyOnSessionFailed: boolean;
}

interface LocalUiPreferenceState {
  sessionDisplaySortMode: SessionDisplaySortMode;
  showSystemFiles: boolean;
  notificationPreferences: LocalNotificationPreferenceState;
}

export const SESSION_DISPLAY_SORT_MODE_STORAGE_KEY = "codingns.workspace.session-display-sort-mode";
export const SHOW_SYSTEM_FILES_STORAGE_KEY = "codingns.file-panel.show-system-files";
export const NOTIFICATION_PREFERENCES_STORAGE_KEY = "codingns.notification.preferences";

const DEFAULT_NOTIFICATION_PREFERENCES: LocalNotificationPreferenceState = {
  notifyOnPermissionRequest: true,
  notifyOnSessionCompleted: true,
  notifyOnSessionFailed: true
};

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isSessionDisplaySortMode(value: unknown): value is SessionDisplaySortMode {
  return value === "createdAt" || value === "updatedAt" || value === "title";
}

function readSessionDisplaySortModeFromStorage(): SessionDisplaySortMode {
  if (!canUseLocalStorage()) {
    return "createdAt";
  }

  const storedValue = window.localStorage.getItem(SESSION_DISPLAY_SORT_MODE_STORAGE_KEY);
  return isSessionDisplaySortMode(storedValue) ? storedValue : "createdAt";
}

function readShowSystemFilesFromStorage(): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }

  return window.localStorage.getItem(SHOW_SYSTEM_FILES_STORAGE_KEY) === "1";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function readNotificationPreferencesFromStorage(): LocalNotificationPreferenceState {
  if (!canUseLocalStorage()) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  const rawValue = window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);

  if (!rawValue) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<LocalNotificationPreferenceState>;
    return {
      notifyOnPermissionRequest: isBoolean(parsed.notifyOnPermissionRequest)
        ? parsed.notifyOnPermissionRequest
        : DEFAULT_NOTIFICATION_PREFERENCES.notifyOnPermissionRequest,
      notifyOnSessionCompleted: isBoolean(parsed.notifyOnSessionCompleted)
        ? parsed.notifyOnSessionCompleted
        : DEFAULT_NOTIFICATION_PREFERENCES.notifyOnSessionCompleted,
      notifyOnSessionFailed: isBoolean(parsed.notifyOnSessionFailed)
        ? parsed.notifyOnSessionFailed
        : DEFAULT_NOTIFICATION_PREFERENCES.notifyOnSessionFailed
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

function areNotificationPreferencesEqual(
  left: LocalNotificationPreferenceState,
  right: LocalNotificationPreferenceState
): boolean {
  return (
    left.notifyOnPermissionRequest === right.notifyOnPermissionRequest
    && left.notifyOnSessionCompleted === right.notifyOnSessionCompleted
    && left.notifyOnSessionFailed === right.notifyOnSessionFailed
  );
}

function writeNotificationPreferencesToStorage(preferences: LocalNotificationPreferenceState): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(
    NOTIFICATION_PREFERENCES_STORAGE_KEY,
    JSON.stringify(preferences)
  );
}

class LocalUiPreferenceStore {
  private state: LocalUiPreferenceState = {
    sessionDisplaySortMode: readSessionDisplaySortModeFromStorage(),
    showSystemFiles: readShowSystemFilesFromStorage(),
    notificationPreferences: readNotificationPreferencesFromStorage()
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

  setSessionDisplaySortMode(mode: SessionDisplaySortMode): void {
    if (canUseLocalStorage()) {
      if (mode === "createdAt") {
        window.localStorage.removeItem(SESSION_DISPLAY_SORT_MODE_STORAGE_KEY);
      } else {
        window.localStorage.setItem(SESSION_DISPLAY_SORT_MODE_STORAGE_KEY, mode);
      }
    }

    if (this.state.sessionDisplaySortMode === mode) {
      return;
    }

    this.state = {
      ...this.state,
      sessionDisplaySortMode: mode
    };
    this.emit();
  }

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
      ...this.state,
      showSystemFiles: enabled
    };
    this.emit();
  }

  setNotificationPreferences(patch: Partial<LocalNotificationPreferenceState>): void {
    const nextPreferences: LocalNotificationPreferenceState = {
      ...this.state.notificationPreferences,
      ...patch
    };

    if (areNotificationPreferencesEqual(this.state.notificationPreferences, nextPreferences)) {
      return;
    }

    writeNotificationPreferencesToStorage(nextPreferences);
    this.state = {
      ...this.state,
      notificationPreferences: nextPreferences
    };
    this.emit();
  }

  private handleStorage = (event: StorageEvent) => {
    if (
      event.key !== null
      && event.key !== SESSION_DISPLAY_SORT_MODE_STORAGE_KEY
      && event.key !== SHOW_SYSTEM_FILES_STORAGE_KEY
      && event.key !== NOTIFICATION_PREFERENCES_STORAGE_KEY
    ) {
      return;
    }

    const nextSessionDisplaySortMode = readSessionDisplaySortModeFromStorage();
    const nextShowSystemFiles = readShowSystemFilesFromStorage();
    const nextNotificationPreferences = readNotificationPreferencesFromStorage();
    const sessionDisplaySortModeUnchanged =
      this.state.sessionDisplaySortMode === nextSessionDisplaySortMode;
    const showSystemFilesUnchanged = this.state.showSystemFiles === nextShowSystemFiles;
    const notificationPreferencesUnchanged = areNotificationPreferencesEqual(
      this.state.notificationPreferences,
      nextNotificationPreferences
    );

    if (
      sessionDisplaySortModeUnchanged
      && showSystemFilesUnchanged
      && notificationPreferencesUnchanged
    ) {
      return;
    }

    this.state = {
      sessionDisplaySortMode: nextSessionDisplaySortMode,
      showSystemFiles: nextShowSystemFiles,
      notificationPreferences: nextNotificationPreferences
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
