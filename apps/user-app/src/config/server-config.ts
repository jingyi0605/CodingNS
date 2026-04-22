import { useSyncExternalStore } from "react";

import { clientConfigStore } from "./client-config-store";
import {
  getActiveHost,
  isDiscoveredHostProfile,
  type HostProfile,
  type HostRelayTunnelProfile
} from "./client-config-types";
import { inferRelayAccessConfig } from "./relay-control-site-config";
import { getVisibleDiscoveredHosts } from "./local-host-discovery-store";
import { normalizeServerBaseUrl } from "./server-config-shared";

const HISTORY_STORAGE_KEY = "codingns.server.base-url.history";
const MAX_HISTORY_SIZE = 6;
const CUSTOM_SERVER_OPTION = "__custom__";

export interface ServerConfigState {
  baseUrl: string;
  options: string[];
  presetOptions: ServerPresetOption[];
}

export type ServerPresetSource = "saved" | "discovered" | "history" | "origin";

export interface ServerPresetOption {
  value: string;
  source: ServerPresetSource;
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

function uniqPresetOptions(items: Array<ServerPresetOption | null | undefined>): ServerPresetOption[] {
  const seen = new Set<string>();
  const result: ServerPresetOption[] = [];

  for (const item of items) {
    if (!item || seen.has(item.value)) {
      continue;
    }

    seen.add(item.value);
    result.push(item);
  }

  return result;
}

function buildOptions(baseUrl: string, hostBaseUrls: string[]): string[] {
  const history = readStoredHistory();
  const nextOptions = uniqOptions([
    baseUrl,
    ...hostBaseUrls,
    ...history,
    safelyNormalizeServerBaseUrl(readWindowOrigin())
  ]);

  return nextOptions.slice(0, MAX_HISTORY_SIZE);
}

function buildPresetOptions(config: ReturnType<typeof clientConfigStore.getState>): ServerPresetOption[] {
  const activeHost = getActiveHost(config);
  const history = readStoredHistory().map((value) => ({
    value,
    source: "history" as const
  }));
  const origin = safelyNormalizeServerBaseUrl(readWindowOrigin());
  const savedHosts = config.hosts.map((host) => ({
    value: host.baseUrl,
    source: "saved" as const
  }));
  const discoveredHosts = getVisibleDiscoveredHosts(config).map((host) => ({
    value: host.baseUrl,
    source: "discovered" as const
  }));

  const activeOption = activeHost
    ? {
        value: activeHost.baseUrl,
        source: isDiscoveredHostProfile(activeHost) ? ("discovered" as const) : ("saved" as const)
      }
    : null;

  return uniqPresetOptions([
    activeOption,
    ...savedHosts,
    ...discoveredHosts,
    ...history,
    origin
      ? {
          value: origin,
          source: "origin" as const
        }
      : null
  ]).slice(0, MAX_HISTORY_SIZE);
}

function persistHistory(options: string[]): void {
  if (canUseLocalStorage()) {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(options.slice(0, MAX_HISTORY_SIZE)));
  }
}

class ServerConfigStoreCompat {
  private state: ServerConfigState = this.createState(clientConfigStore.getState());
  private listeners = new Set<() => void>();

  constructor() {
    clientConfigStore.subscribe(() => {
      const nextState = this.createState(clientConfigStore.getState());

      if (
        nextState.baseUrl === this.state.baseUrl &&
        nextState.options.length === this.state.options.length &&
        nextState.options.every((item, index) => item === this.state.options[index]) &&
        nextState.presetOptions.length === this.state.presetOptions.length &&
        nextState.presetOptions.every((item, index) => {
          const current = this.state.presetOptions[index];
          return current?.value === item.value && current?.source === item.source;
        })
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
    const currentConfig = clientConfigStore.getState();
    const activeHost = getActiveHost(currentConfig);

    if (!activeHost) {
      return false;
    }

    const nextBaseUrl = normalizeServerBaseUrl(input);
    const changed = nextBaseUrl !== activeHost.baseUrl;
    const nextRelayTunnel = buildRelayTunnelProfileFromBaseUrl(nextBaseUrl, activeHost);

    if (isDiscoveredHostProfile(activeHost)) {
      clientConfigStore.updateRuntime({
        discoveredHosts: currentConfig.discoveredHosts.map((host) =>
          host.id === activeHost.id
            ? {
                ...host,
                baseUrl: nextBaseUrl,
                name: new URL(nextBaseUrl).host,
                relayTunnel: nextRelayTunnel,
                updatedAt: new Date().toISOString()
              }
            : host
        )
      });
      this.state = this.createState(clientConfigStore.getState());
      this.emit();
      return changed;
    }

    const nextHosts = currentConfig.hosts.map((host) =>
      host.id === activeHost.id
        ? {
            ...host,
            baseUrl: nextBaseUrl,
            name: new URL(nextBaseUrl).host,
            relayTunnel: nextRelayTunnel,
            updatedAt: new Date().toISOString()
          }
        : host
    );

    this.state = this.createState({
      ...currentConfig,
      hosts: nextHosts
    });
    this.emit();
    void clientConfigStore.update({ hosts: nextHosts });
    return changed;
  }

  reset(): void {
    this.state = this.createState(clientConfigStore.getState());
    this.emit();
  }

  private createState(config: ReturnType<typeof clientConfigStore.getState>): ServerConfigState {
    const activeHost = getActiveHost(config);
    const baseUrl = activeHost?.baseUrl ?? "";
    const presetOptions = buildPresetOptions(config);
    const options = buildOptions(
      baseUrl,
      presetOptions.map((option) => option.value)
    );
    persistHistory(options);

    return {
      baseUrl,
      options,
      presetOptions
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

function buildRelayTunnelProfileFromBaseUrl(
  baseUrl: string,
  activeHost: Pick<HostProfile, "relayTunnel"> | null
): HostRelayTunnelProfile | null {
  const inferredRelayConfig = inferRelayAccessConfig(baseUrl);

  if (!inferredRelayConfig) {
    return null;
  }

  const currentRelayTunnel = activeHost?.relayTunnel;
  const shouldPreserveIdentity =
    currentRelayTunnel?.provider === "codingns_relay"
    && currentRelayTunnel.tunnelDomain === inferredRelayConfig.tunnelDomain
    && currentRelayTunnel.controlBaseUrl === inferredRelayConfig.controlBaseUrl;
  const preservedNonRelayEndpoints = (currentRelayTunnel?.candidateEndpoints ?? [])
    .filter((endpoint) => endpoint.kind !== "relay");

  return {
    provider: "codingns_relay",
    enabled: true,
    tunnelDomain: inferredRelayConfig.tunnelDomain,
    controlBaseUrl: inferredRelayConfig.controlBaseUrl,
    bindingId: shouldPreserveIdentity ? (currentRelayTunnel?.bindingId ?? null) : null,
    hostFingerprint: shouldPreserveIdentity ? (currentRelayTunnel?.hostFingerprint ?? null) : null,
    candidateEndpoints: [
      {
        endpointId: `relay-entry:${inferredRelayConfig.relayBaseUrl}`,
        kind: "relay",
        url: inferredRelayConfig.relayBaseUrl,
        priority: 0,
        expiresAt: null,
        source: "user_saved"
      },
      ...preservedNonRelayEndpoints
    ]
  };
}
