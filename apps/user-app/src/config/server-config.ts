import { useSyncExternalStore } from "react";

import { clientConfigStore } from "./client-config-store";
import { normalizeServerBaseUrl } from "./server-config-shared";

const HISTORY_STORAGE_KEY = "codingns.server.base-url.history";
const MAX_HISTORY_SIZE = 6;
const CUSTOM_SERVER_OPTION = "__custom__";

export interface ServerConfigState {
  baseUrl: string;
  options: string[];
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readWindowOrigin(): string | null {
  if (typeof window === "undefined" || !window.location.origin) {
    return null;
  }

  return window.location.origin;
}

function safelyNormalizeServerBaseUrl(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  try {
    return normalizeServerBaseUrl(input);
  } catch {
    return null;
  }
}

function readStoredHistory(): string[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => (typeof item === "string" ? safelyNormalizeServerBaseUrl(item) : null))
      .filter((item): item is string => Boolean(item));
  } catch {
    return [];
  }
}

function uniqOptions(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    result.push(item);
  }

  return result;
}

function buildOptions(baseUrl: string): string[] {
  const history = readStoredHistory();
  const nextOptions = uniqOptions([baseUrl, ...history, safelyNormalizeServerBaseUrl(readWindowOrigin())]);

  return nextOptions.slice(0, MAX_HISTORY_SIZE);
}

function persistHistory(options: string[]): void {
  if (canUseLocalStorage()) {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(options.slice(0, MAX_HISTORY_SIZE)));
  }
}

class ServerConfigStoreCompat {
  private state: ServerConfigState = this.createState(clientConfigStore.getState().hostBaseUrl);
  private listeners = new Set<() => void>();

  constructor() {
    clientConfigStore.subscribe(() => {
      const nextState = this.createState(clientConfigStore.getState().hostBaseUrl);

      if (
        nextState.baseUrl === this.state.baseUrl &&
        nextState.options.length === this.state.options.length &&
        nextState.options.every((item, index) => item === this.state.options[index])
      ) {
        return;
      }

      this.state = nextState;
      this.emit();
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): ServerConfigState => this.state;

  setBaseUrl(input: string): boolean {
    const nextBaseUrl = normalizeServerBaseUrl(input);
    const changed = nextBaseUrl !== clientConfigStore.getState().hostBaseUrl;
    this.state = this.createState(nextBaseUrl);
    this.emit();
    void clientConfigStore.update({ hostBaseUrl: nextBaseUrl });
    return changed;
  }

  reset(): void {
    this.state = this.createState(clientConfigStore.getState().hostBaseUrl);
    this.emit();
  }

  private createState(baseUrl: string): ServerConfigState {
    const options = buildOptions(baseUrl);
    persistHistory(options);

    return {
      baseUrl,
      options
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const serverConfigStore = new ServerConfigStoreCompat();

export function useServerConfigSelector<T>(selector: (state: ServerConfigState) => T): T {
  return useSyncExternalStore(serverConfigStore.subscribe, () => selector(serverConfigStore.getState()));
}

export function getServerSelectValue(baseUrl: string, options: string[]): string {
  return options.includes(baseUrl) ? baseUrl : CUSTOM_SERVER_OPTION;
}

export function getCustomServerOptionValue(): string {
  return CUSTOM_SERVER_OPTION;
}

export { normalizeServerBaseUrl } from "./server-config-shared";
