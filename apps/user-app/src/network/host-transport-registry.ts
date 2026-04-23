import { clientConfigStore } from "../config/client-config-store";
import { getActiveHost, getRuntimeHostByBaseUrl } from "../config/client-config-types";
import { hostLoginRouteHintStore } from "../config/host-login-route-hint-store";
import { hostRuntimeStore } from "../config/host-runtime-store";
import { inferRelayAccessConfig } from "../config/relay-control-site-config";
import { directHostTransport } from "./direct-host-transport";
import type { HostTransport, HostTransportResolver } from "./host-transport";
import { ManagedRelayTunnelHostTransport } from "./relay-tunnel-managed-transport";

const relayTransportCache = new Map<string, { signature: string; transport: ManagedRelayTunnelHostTransport }>();
const inferredRelayTransportCache = new Map<string, ManagedRelayTunnelHostTransport>();

const defaultHostTransportResolver: HostTransportResolver = ({ baseUrl }) => {
  const host = getRuntimeHostByBaseUrl(clientConfigStore.getState(), baseUrl);
  const relayTunnel = host?.relayTunnel;

  if (host && relayTunnel?.enabled && shouldUseRelayTransport(baseUrl, host.baseUrl, relayTunnel)) {
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
      fallbackTransport: resolveRelayDirectFallbackTransport(
        clientConfigStore.getState().platform,
        host.baseUrl,
        relayTunnel.tunnelDomain
      )
    });

    relayTransportCache.set(host.id, {
      signature,
      transport
    });
    return transport;
  }

  if (host) {
    const cached = relayTransportCache.get(host.id);

    if (cached) {
      cached.transport.close();
      relayTransportCache.delete(host.id);
    }

    if (relayTunnel?.provider === "codingns_relay" && !relayTunnel.enabled) {
      return directHostTransport;
    }
  }

  const inferredRelay = inferRelayAccessConfig(baseUrl);

  if (inferredRelay) {
    const cacheKey = JSON.stringify({
      tunnelDomain: inferredRelay.tunnelDomain,
      controlBaseUrl: inferredRelay.controlBaseUrl
    });
    const cachedTransport = inferredRelayTransportCache.get(cacheKey);

    if (cachedTransport) {
      return cachedTransport;
    }

    const transport = new ManagedRelayTunnelHostTransport({
      hostId: `inferred:${inferredRelay.tunnelDomain}`,
      controlBaseUrl: inferredRelay.controlBaseUrl,
      tunnelDomain: inferredRelay.tunnelDomain
    }, {
      // 手填四级域名时，native 客户端需要在 relay 建连失败后继续尝试同地址直连。
      fallbackTransport: resolveRelayDirectFallbackTransport(
        clientConfigStore.getState().platform,
        baseUrl,
        inferredRelay.tunnelDomain
      )
    });

    inferredRelayTransportCache.set(cacheKey, transport);
    return transport;
  }

  return directHostTransport;
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
  closeCachedRelayTransports();
  hostTransportResolver = resolver ?? (() => directHostTransport);
}

export function resetHostTransportRegistryForTesting(): void {
  closeCachedRelayTransports();
  hostTransportResolver = defaultHostTransportResolver;
}

function closeCachedRelayTransports(): void {
  for (const cached of relayTransportCache.values()) {
    cached.transport.close();
  }

  relayTransportCache.clear();

  for (const cached of inferredRelayTransportCache.values()) {
    cached.close();
  }

  inferredRelayTransportCache.clear();
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
    const loginRouteHint = hostLoginRouteHintStore.get(activeHost.id);
    return loginRouteHint?.baseUrl ?? baseUrl;
  }

  const preferredEndpointId =
    runtimeState.preferredDirectCandidateEndpointId
    ?? runtimeState.preferredCandidateEndpointId;

  if (!preferredEndpointId) {
    const loginRouteHint = hostLoginRouteHintStore.get(activeHost.id);
    return loginRouteHint?.baseUrl ?? baseUrl;
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

function resolveRelayDirectFallbackTransport(
  platform: "desktop" | "web" | "ios" | "android",
  _hostBaseUrl: string,
  _tunnelDomain: string
): HostTransport | undefined {
  if (platform === "web") {
    return undefined;
  }

  // native 端允许把四级域名继续当普通 Host API 入口尝试一次，
  // 避免 relay 尚未接起时直接把可用的反向代理入口误判成不可达。
  return directHostTransport;
}
