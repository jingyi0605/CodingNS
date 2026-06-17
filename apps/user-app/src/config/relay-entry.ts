import type {
  ClientRuntimeConfig,
  ClientRuntimeConfigPatch,
  HostCandidateEndpoint,
  HostProfile
} from "./client-config-types";
import { inferRelayAccessConfig } from "./relay-control-site-config";
import { normalizeServerBaseUrl } from "./server-config-shared";

export interface RelayEntryConfigInput {
  tunnelDomain: string;
  controlBaseUrl: string;
  bindingId?: string | null;
  hostFingerprint?: string | null;
  candidateEndpoints?: HostCandidateEndpoint[];
}

export interface BuildRelayEntryConfigPatchOptions {
  activate?: boolean;
  displayName?: string | null;
}

interface RelayTunnelBindingLookupResponse {
  binding?: {
    bindingId?: string;
    tunnelDomain?: string;
    controlBaseUrl?: string;
    hostFingerprint?: string;
    runtime?: {
      candidateEndpoints?: unknown;
    } | null;
  } | null;
}

export function buildRelayEntryConfigPatch(
  config: ClientRuntimeConfig,
  input: RelayEntryConfigInput,
  options?: BuildRelayEntryConfigPatchOptions
): ClientRuntimeConfigPatch {
  const normalizedTunnelDomain = normalizeTunnelDomain(input.tunnelDomain);
  const normalizedControlBaseUrl = normalizeServerBaseUrl(input.controlBaseUrl);
  const relayBaseUrl = buildRelayAccessBaseUrl(normalizedTunnelDomain, normalizedControlBaseUrl);
  const now = new Date().toISOString();
  const existingHost = findExistingRelayEntryHost(config.hosts, relayBaseUrl, input.bindingId ?? null);
  const displayName =
    normalizeOptionalDisplayName(options?.displayName)
    ?? existingHost?.name
    ?? normalizedTunnelDomain;
  const relayEndpoint: HostCandidateEndpoint = {
    endpointId: `relay-entry:${relayBaseUrl}`,
    kind: "relay",
    url: relayBaseUrl,
    priority: 0,
    expiresAt: null,
    source: "user_saved"
  };
  const inputCandidateEndpoints = normalizeCandidateEndpoints(input.candidateEndpoints)
    .filter((endpoint) => endpoint.url !== relayBaseUrl);
  const preservedCandidateEndpoints = (existingHost?.relayTunnel?.candidateEndpoints ?? [])
    .filter((endpoint) => endpoint.url !== relayBaseUrl);
  const nextHost: HostProfile = {
    id: existingHost?.id ?? buildRelayEntryHostId(input.bindingId ?? null, normalizedTunnelDomain),
    name: displayName,
    alias: existingHost?.alias ?? buildRelayHostAlias(displayName, normalizedTunnelDomain),
    tagColor: existingHost?.tagColor ?? null,
    baseUrl: relayBaseUrl,
    kind: "remote",
    peerEnabled: existingHost?.peerEnabled ?? false,
    peerHostId: existingHost?.peerHostId ?? null,
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
      candidateEndpoints: dedupeCandidateEndpoints([
        relayEndpoint,
        ...inputCandidateEndpoints,
        ...preservedCandidateEndpoints
      ])
    }
  };
  const nextHosts = existingHost
    ? config.hosts.map((host) => (host.id === existingHost.id ? nextHost : host))
    : [nextHost, ...config.hosts];

  return {
    activeHostId: options?.activate === false ? config.activeHostId : nextHost.id,
    activeDiscoveredHostId: options?.activate === false ? config.activeDiscoveredHostId : null,
    hosts: nextHosts
  };
}

export async function resolveRelayEntryConfigInputFromBaseUrl(
  baseUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<RelayEntryConfigInput | null> {
  const inferredRelayConfig = inferRelayAccessConfig(baseUrl);

  if (!inferredRelayConfig) {
    return null;
  }

  const fallbackInput: RelayEntryConfigInput = {
    tunnelDomain: inferredRelayConfig.tunnelDomain,
    controlBaseUrl: inferredRelayConfig.controlBaseUrl
  };

  try {
    const response = await fetchFn(
      new URL(
        `/api/v1/tunnels/${encodeURIComponent(inferredRelayConfig.tunnelDomain)}`,
        ensureTrailingSlash(inferredRelayConfig.controlBaseUrl)
      ).toString(),
      {
        method: "GET"
      }
    );

    if (!response.ok) {
      return fallbackInput;
    }

    const payload = await response.json() as RelayTunnelBindingLookupResponse;
    const binding = payload.binding;

    return {
      tunnelDomain: normalizeTunnelDomain(binding?.tunnelDomain ?? inferredRelayConfig.tunnelDomain),
      controlBaseUrl: normalizeServerBaseUrl(binding?.controlBaseUrl ?? inferredRelayConfig.controlBaseUrl),
      bindingId: normalizeNullableText(binding?.bindingId ?? null),
      hostFingerprint: normalizeNullableText(binding?.hostFingerprint ?? null),
      candidateEndpoints: normalizeCandidateEndpoints(binding?.runtime?.candidateEndpoints)
    };
  } catch {
    return fallbackInput;
  }
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

function normalizeOptionalDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildRelayAccessBaseUrl(tunnelDomain: string, controlBaseUrl: string): string {
  const controlUrl = new URL(controlBaseUrl);
  controlUrl.hostname = tunnelDomain;
  controlUrl.username = "";
  controlUrl.password = "";
  controlUrl.pathname = "";
  controlUrl.search = "";
  controlUrl.hash = "";

  return normalizeServerBaseUrl(controlUrl.toString());
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeCandidateEndpoints(value: unknown): HostCandidateEndpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const endpoints: HostCandidateEndpoint[] = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }

    const endpointId = normalizeNullableText((item as { endpointId?: string | null }).endpointId);
    const kind = normalizeNullableText((item as { kind?: string | null }).kind);
    const url = normalizeNullableText((item as { url?: string | null }).url);
    const priority = (item as { priority?: unknown }).priority;
    const expiresAt = normalizeNullableText((item as { expiresAt?: string | null }).expiresAt);
    const source = normalizeNullableText((item as { source?: string | null }).source);

    if (
      !endpointId
      || !url
      || !Number.isFinite(priority)
      || !isCandidateEndpointKind(kind)
      || !isCandidateEndpointSource(source)
    ) {
      continue;
    }

    endpoints.push({
      endpointId,
      kind,
      url,
      priority: Number(priority),
      expiresAt,
      source
    });
  }

  return dedupeCandidateEndpoints(endpoints);
}

function dedupeCandidateEndpoints(endpoints: HostCandidateEndpoint[]): HostCandidateEndpoint[] {
  const uniqueEndpoints = new Map<string, HostCandidateEndpoint>();

  for (const endpoint of endpoints) {
    if (!uniqueEndpoints.has(endpoint.url)) {
      uniqueEndpoints.set(endpoint.url, endpoint);
    }
  }

  return Array.from(uniqueEndpoints.values()).sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.url.localeCompare(right.url);
  });
}

function isCandidateEndpointKind(value: string | null): value is HostCandidateEndpoint["kind"] {
  return value === "relay" || value === "lan" || value === "loopback" || value === "tailscale" || value === "custom";
}

function isCandidateEndpointSource(value: string | null): value is HostCandidateEndpoint["source"] {
  return value === "host_reported" || value === "desktop_scan" || value === "user_saved";
}

function buildRelayHostAlias(displayName: string, tunnelDomain: string): string {
  const source = displayName.trim() || tunnelDomain.trim() || "HOST";
  return Array.from(source).slice(0, 4).join("");
}
