import { clientConfigStore } from "../config/client-config-store";
import { getActiveHost, getRuntimeHostByBaseUrl } from "../config/client-config-types";
import { hostRuntimeStore } from "../config/host-runtime-store";
import { directHostTransport } from "./direct-host-transport";
import type { HostTransport, HostTransportResolver } from "./host-transport";
import { ManagedRelayTunnelHostTransport } from "./relay-tunnel-managed-transport";

const relayTransportCache = new Map<string, { signature: string; transport: ManagedRelayTunnelHostTransport }>();

const defaultHostTransportResolver: HostTransportResolver = ({ baseUrl }) => {
  const host = getRuntimeHostByBaseUrl(clientConfigStore.getState(), baseUrl);
  const relayTunnel = host?.relayTunnel;

  if (!host || !relayTunnel?.enabled || !shouldUseRelayTransport(baseUrl, host.baseUrl, relayTunnel)) {
    if (host) {
      const cached = relayTransportCache.get(host.id);

      if (cached) {
        cached.transport.close();
        relayTransportCache.delete(host.id);
      }
    }

    return directHostTransport;
  }

  const signature = JSON.stringify({
    baseUrl: host.baseUrl,
    relayTunnel
  });
  const cached = relayTransportCache.get(host.id);

  if (cached && cached.signature === signature) {
    return cached.transport;
  }

  cached?.transport.close();

  const transport = new ManagedRelayTunnelHostTransport({
    hostId: host.id,
    controlBaseUrl: relayTunnel.controlBaseUrl,
    tunnelDomain: relayTunnel.tunnelDomain
  }, {
    fallbackTransport: shouldAllowRelayDirectFallback(
      clientConfigStore.getState().platform,
      host.baseUrl,
      relayTunnel.tunnelDomain
    )
      ? directHostTransport
      : undefined
  });

  relayTransportCache.set(host.id, {
    signature,
    transport
  });
  return transport;
};

let hostTransportResolver: HostTransportResolver = defaultHostTransportResolver;

export interface ResolvedHostTransportTarget {
  baseUrl: string;
  transport: HostTransport;
}

export function resolveHostTransportTarget(baseUrl: string): ResolvedHostTransportTarget {
  const resolvedBaseUrl = resolveActiveHostBaseUrl(baseUrl);

  return {
    baseUrl: resolvedBaseUrl,
    transport: hostTransportResolver({ baseUrl: resolvedBaseUrl })
  };
}

export function resolveHostTransport(baseUrl: string): HostTransport {
  return resolveHostTransportTarget(baseUrl).transport;
}

export function setHostTransportResolverForTesting(
  resolver: HostTransportResolver | null | undefined
): void {
  for (const cached of relayTransportCache.values()) {
    cached.transport.close();
  }

  relayTransportCache.clear();
  hostTransportResolver = resolver ?? (() => directHostTransport);
}

export function resetHostTransportRegistryForTesting(): void {
  for (const cached of relayTransportCache.values()) {
    cached.transport.close();
  }

  relayTransportCache.clear();
  hostTransportResolver = defaultHostTransportResolver;
}

function resolveActiveHostBaseUrl(baseUrl: string): string {
  const config = clientConfigStore.getState();
  const activeHost = getActiveHost(config);

  if (!activeHost || activeHost.baseUrl !== baseUrl) {
    return baseUrl;
  }

  if (config.platform === "web" && activeHost.relayTunnel?.enabled) {
    return baseUrl;
  }

  const runtimeState = hostRuntimeStore.getState();

  if (runtimeState.activeHostId !== activeHost.id || runtimeState.candidateProbePhase !== "ready") {
    return baseUrl;
  }

  const preferredEndpointId =
    runtimeState.preferredDirectCandidateEndpointId
    ?? runtimeState.preferredCandidateEndpointId;

  if (!preferredEndpointId) {
    return baseUrl;
  }

  const preferredEndpoint = runtimeState.candidateEndpoints.find(
    (endpoint) => endpoint.endpointId === preferredEndpointId && endpoint.status === "verified"
  );

  return preferredEndpoint?.url ?? baseUrl;
}

function shouldUseRelayTransport(
  baseUrl: string,
  hostBaseUrl: string,
  relayTunnel: NonNullable<ReturnType<typeof getRuntimeHostByBaseUrl>>["relayTunnel"]
): boolean {
  const candidateEndpoint = relayTunnel?.candidateEndpoints?.find((endpoint) => endpoint.url === baseUrl);

  if (candidateEndpoint) {
    return candidateEndpoint.kind === "relay";
  }

  if (!relayTunnel?.tunnelDomain) {
    return false;
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase() === relayTunnel.tunnelDomain.trim().toLowerCase();
  } catch {
    try {
      return new URL(hostBaseUrl).hostname.toLowerCase() === relayTunnel.tunnelDomain.trim().toLowerCase();
    } catch {
      return false;
    }
  }
}

function shouldAllowRelayDirectFallback(
  platform: "desktop" | "web" | "ios" | "android",
  hostBaseUrl: string,
  tunnelDomain: string
): boolean {
  if (platform === "web") {
    return false;
  }

  try {
    return new URL(hostBaseUrl).hostname.toLowerCase() !== tunnelDomain.trim().toLowerCase();
  } catch {
    return true;
  }
}
