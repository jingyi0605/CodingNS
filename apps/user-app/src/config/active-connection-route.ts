import {
  getActiveHost,
  type ClientRuntimeConfig,
  type HostCandidateEndpointKind,
  type RuntimeHostProfile
} from "./client-config-types";
import { useClientConfigSelector } from "./client-config-store";
import type { HostRuntimeState } from "./host-runtime-store";
import { useHostRuntimeSelector } from "./host-runtime-store";

export type ActiveConnectionRouteKind = "relay" | "lan" | "loopback" | "tailscale" | "direct";

export interface ActiveConnectionRouteSummary {
  kind: ActiveConnectionRouteKind;
  url: string;
  endpointId: string | null;
  autoDirect: boolean;
  probeInProgress: boolean;
}

export function useActiveConnectionRouteSummary(): ActiveConnectionRouteSummary | null {
  const runtimeConfig = useClientConfigSelector((state) => state);
  const runtimeState = useHostRuntimeSelector((state) => state);
  return resolveActiveConnectionRouteSummary(runtimeConfig, runtimeState);
}

export function resolveActiveConnectionRouteSummary(
  runtimeConfig: ClientRuntimeConfig,
  runtimeState: HostRuntimeState
): ActiveConnectionRouteSummary | null {
  const activeHost = getActiveHost(runtimeConfig);

  if (!activeHost) {
    return null;
  }

  const relayEnabled = Boolean(activeHost.relayTunnel?.enabled);
  const selectedEndpoint =
    runtimeState.activeHostId === activeHost.id && runtimeState.candidateProbePhase === "ready"
      ? resolveSelectedCandidateEndpoint(runtimeState)
      : null;

  if (selectedEndpoint) {
    const kind = normalizeRouteKind(selectedEndpoint.kind);

    return {
      kind,
      url: selectedEndpoint.url,
      endpointId: selectedEndpoint.endpointId,
      autoDirect: relayEnabled && kind !== "relay",
      probeInProgress: false
    };
  }

  return {
    kind: inferRouteKindFromHost(activeHost),
    url: activeHost.baseUrl,
    endpointId: null,
    autoDirect: false,
    probeInProgress:
      relayEnabled
      && runtimeState.activeHostId === activeHost.id
      && runtimeState.candidateProbePhase === "probing"
  };
}

export function resolveActiveConnectionRouteLabelKey(kind: ActiveConnectionRouteKind): string {
  switch (kind) {
    case "relay":
      return "common.connectionRouteRelay";
    case "lan":
      return "common.connectionRouteLan";
    case "loopback":
      return "common.connectionRouteLoopback";
    case "tailscale":
      return "common.connectionRouteTailscale";
    default:
      return "common.connectionRouteDirect";
  }
}

function resolveSelectedCandidateEndpoint(runtimeState: HostRuntimeState) {
  const preferredEndpointId =
    runtimeState.preferredDirectCandidateEndpointId
    ?? runtimeState.preferredCandidateEndpointId;

  if (!preferredEndpointId) {
    return null;
  }

  return runtimeState.candidateEndpoints.find(
    (endpoint) => endpoint.endpointId === preferredEndpointId && endpoint.status === "verified"
  ) ?? null;
}

function normalizeRouteKind(kind: HostCandidateEndpointKind): ActiveConnectionRouteKind {
  if (kind === "custom") {
    return "direct";
  }

  return kind;
}

function inferRouteKindFromHost(host: RuntimeHostProfile): ActiveConnectionRouteKind {
  if (host.relayTunnel?.enabled && isRelayHostBaseUrl(host.baseUrl, host.relayTunnel.tunnelDomain)) {
    return "relay";
  }

  try {
    const hostname = new URL(host.baseUrl).hostname.toLowerCase();

    if (isLoopbackHostname(hostname)) {
      return "loopback";
    }

    if (isTailscaleHostname(hostname)) {
      return "tailscale";
    }

    if (isPrivateIpv4Hostname(hostname)) {
      return "lan";
    }
  } catch {
    return "direct";
  }

  if (host.kind === "local") {
    return "loopback";
  }

  if (host.kind === "lan") {
    return "lan";
  }

  return "direct";
}

function isRelayHostBaseUrl(baseUrl: string, tunnelDomain: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === tunnelDomain.trim().toLowerCase();
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isTailscaleHostname(hostname: string): boolean {
  if (hostname.endsWith(".ts.net")) {
    return true;
  }

  const octets = hostname.split(".").map((segment) => Number(segment));

  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment))) {
    return false;
  }

  const [first, second] = octets;
  return first === 100 && second >= 64 && second <= 127;
}

function isPrivateIpv4Hostname(hostname: string): boolean {
  const octets = hostname.split(".").map((segment) => Number(segment));

  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment))) {
    return false;
  }

  const [first, second] = octets;

  return (
    first === 10
    || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31)
  );
}
