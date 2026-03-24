import { useSyncExternalStore } from "react";

const FALLBACK_HOST_BASE_URL = "http://127.0.0.1:3002";
const STORAGE_KEY = "codingns.server.base-url";
const HISTORY_STORAGE_KEY = "codingns.server.base-url.history";
const MAX_HISTORY_SIZE = 6;
const CUSTOM_SERVER_OPTION = "__custom__";

export interface ServerConfigState {
  baseUrl: string;
  options: string[];
}

type Listener = () => void;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readWindowOrigin(): string | null {
  if (typeof window === "undefined" || !window.location.origin) {
    return null;
  }

  return window.location.origin;
}

function readEnvBaseUrl(): string | null {
  const envUrl = import.meta.env.VITE_HOST_BASE_URL;
  return typeof envUrl === "string" && envUrl.trim().length > 0 ? envUrl : null;
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

export function normalizeServerBaseUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("EMPTY_SERVER_URL");
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const parsed = new URL(candidate);

  if (!isHttpProtocol(parsed.protocol)) {
    throw new Error("INVALID_SERVER_PROTOCOL");
  }

  parsed.hash = "";
  parsed.search = "";

  const pathname = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
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

function getDefaultHostBaseUrl(): string {
  return (
    safelyNormalizeServerBaseUrl(readEnvBaseUrl()) ??
    safelyNormalizeServerBaseUrl(readWindowOrigin()) ??
    FALLBACK_HOST_BASE_URL
  );
}

function readStoredBaseUrl(): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  return safelyNormalizeServerBaseUrl(window.localStorage.getItem(STORAGE_KEY));
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
      .filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function uniqServerOptions(items: Array<string | null | undefined>): string[] {
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

function buildOptions(baseUrl: string, history: string[]): string[] {
  return uniqServerOptions([
    baseUrl,
    ...history,
    safelyNormalizeServerBaseUrl(readWindowOrigin()),
    safelyNormalizeServerBaseUrl(readEnvBaseUrl()),
    FALLBACK_HOST_BASE_URL
  ]).slice(0, MAX_HISTORY_SIZE);
}

function createInitialState(): ServerConfigState {
  const baseUrl = readStoredBaseUrl() ?? getDefaultHostBaseUrl();
  const history = readStoredHistory();

  return {
    baseUrl,
    options: buildOptions(baseUrl, history)
  };
}

class ServerConfigStore {
  private state = createInitialState();
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  setBaseUrl(input: string): boolean {
    const nextBaseUrl = normalizeServerBaseUrl(input);
    const changed = nextBaseUrl !== this.state.baseUrl;
    const nextOptions = buildOptions(nextBaseUrl, [nextBaseUrl, ...this.state.options]);

    this.state = {
      baseUrl: nextBaseUrl,
      options: nextOptions
    };

    if (canUseLocalStorage()) {
      window.localStorage.setItem(STORAGE_KEY, nextBaseUrl);
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextOptions));
    }

    this.emit();
    return changed;
  }

  reset(): void {
    this.state = createInitialState();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const serverConfigStore = new ServerConfigStore();

export function useServerConfigSelector<T>(selector: (state: ServerConfigState) => T): T {
  return useSyncExternalStore(serverConfigStore.subscribe, () => selector(serverConfigStore.getState()));
}

export function getServerSelectValue(baseUrl: string, options: string[]): string {
  return options.includes(baseUrl) ? baseUrl : CUSTOM_SERVER_OPTION;
}

export function getCustomServerOptionValue(): string {
  return CUSTOM_SERVER_OPTION;
}
