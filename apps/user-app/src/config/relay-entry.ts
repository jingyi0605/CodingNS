import type {
  ClientRuntimeConfig,
  ClientRuntimeConfigPatch,
  HostCandidateEndpoint,
  HostProfile
} from "./client-config-types";
import { normalizeServerBaseUrl } from "./server-config-shared";

export interface RelayEntryConfigInput {
  tunnelDomain: string;
  controlBaseUrl: string;
  bindingId?: string | null;
  hostFingerprint?: string | null;
}

export function buildRelayEntryConfigPatch(
  config: ClientRuntimeConfig,
  input: RelayEntryConfigInput
): ClientRuntimeConfigPatch {
  const normalizedTunnelDomain = normalizeTunnelDomain(input.tunnelDomain);
  const normalizedControlBaseUrl = normalizeServerBaseUrl(input.controlBaseUrl);
  const relayBaseUrl = normalizeServerBaseUrl(`https://${normalizedTunnelDomain}`);
  const now = new Date().toISOString();
  const existingHost = findExistingRelayEntryHost(config.hosts, relayBaseUrl, input.bindingId ?? null);
  const relayEndpoint: HostCandidateEndpoint = {
    endpointId: `relay-entry:${relayBaseUrl}`,
    kind: "relay",
    url: relayBaseUrl,
    priority: 0,
    expiresAt: null,
    source: "user_saved"
  };
  const preservedCandidateEndpoints = (existingHost?.relayTunnel?.candidateEndpoints ?? [])
    .filter((endpoint) => endpoint.url !== relayBaseUrl);
  const nextHost: HostProfile = {
    id: existingHost?.id ?? buildRelayEntryHostId(input.bindingId ?? null, normalizedTunnelDomain),
    name: normalizedTunnelDomain,
    baseUrl: relayBaseUrl,
    kind: "remote",
    createdAt: existingHost?.createdAt ?? now,
    updatedAt: now,
    lastConnectedAt: existingHost?.lastConnectedAt ?? null,
    lastUserId: existingHost?.lastUserId ?? null,
    lastUsername: existingHost?.lastUsername ?? null,
    relayTunnel: {
      provider: "codingns_relay",
      enabled: true,
      tunnelDomain: normalizedTunnelDomain,
      controlBaseUrl: normalizedControlBaseUrl,
      bindingId: normalizeNullableText(input.bindingId ?? null),
      hostFingerprint: normalizeNullableText(input.hostFingerprint ?? null),
      candidateEndpoints: [relayEndpoint, ...preservedCandidateEndpoints]
    }
  };
  const nextHosts = existingHost
    ? config.hosts.map((host) => (host.id === existingHost.id ? nextHost : host))
    : [nextHost, ...config.hosts];

  return {
    activeHostId: nextHost.id,
    activeDiscoveredHostId: null,
    hosts: nextHosts
  };
}

function findExistingRelayEntryHost(
  hosts: HostProfile[],
  relayBaseUrl: string,
  bindingId: string | null
): HostProfile | null {
  if (bindingId) {
    const matchedByBinding = hosts.find((host) => host.relayTunnel?.bindingId === bindingId) ?? null;

    if (matchedByBinding) {
      return matchedByBinding;
    }
  }

  return hosts.find((host) => host.baseUrl === relayBaseUrl) ?? null;
}

function buildRelayEntryHostId(bindingId: string | null, tunnelDomain: string): string {
  if (bindingId) {
    return `relay-entry:${bindingId}`;
  }

  return `relay-entry:${tunnelDomain}`;
}

function normalizeTunnelDomain(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(normalized)) {
    throw new Error("隧道域名无效");
  }

  return normalized;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
