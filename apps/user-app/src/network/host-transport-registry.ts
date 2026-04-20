import { clientConfigStore } from "../config/client-config-store";
import { getRuntimeHostByBaseUrl } from "../config/client-config-types";
import { directHostTransport } from "./direct-host-transport";
import type { HostTransport, HostTransportResolver } from "./host-transport";
import { ManagedRelayTunnelHostTransport } from "./relay-tunnel-managed-transport";

const relayTransportCache = new Map<string, { signature: string; transport: ManagedRelayTunnelHostTransport }>();

const defaultHostTransportResolver: HostTransportResolver = ({ baseUrl }) => {
  const host = getRuntimeHostByBaseUrl(clientConfigStore.getState(), baseUrl);
  const relayTunnel = host?.relayTunnel;

  if (!host || !relayTunnel?.enabled) {
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
    controlBaseUrl: relayTunnel.controlBaseUrl,
    tunnelDomain: relayTunnel.tunnelDomain
  }, {
    fallbackTransport: directHostTransport
  });

  relayTransportCache.set(host.id, {
    signature,
    transport
  });
  return transport;
};

let hostTransportResolver: HostTransportResolver = defaultHostTransportResolver;

export function resolveHostTransport(baseUrl: string): HostTransport {
  return hostTransportResolver({ baseUrl });
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
