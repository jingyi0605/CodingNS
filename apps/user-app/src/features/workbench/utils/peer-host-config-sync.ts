import { clientConfigStore } from "../../../config/client-config-store";
import type { HostProfile } from "../../../config/client-config-types";
import { normalizeServerBaseUrl } from "../../../config/server-config-shared";
import { listPeerHosts, type PeerHostDto } from "../api/peer-hosts-api";
import { normalizeHostAliasLabel } from "./host-alias";

export async function syncPeerHostsIntoClientConfig(): Promise<void> {
  const response = await listPeerHosts();
  await mergePeerHostsIntoClientConfig(response.items);
}

export async function mergePeerHostsIntoClientConfig(peerHosts: readonly PeerHostDto[]): Promise<void> {
  const current = clientConfigStore.getState();
  const activeHostId = current.activeHostId ?? current.hosts[0]?.id ?? null;
  const now = new Date().toISOString();
  const existingByPeerHostId = new Map<string, HostProfile>();
  const nextHosts = current.hosts.map((host) => {
    if (host.peerHostId) {
      existingByPeerHostId.set(host.peerHostId, host);
    }
    return host;
  });
  let changed = false;

  for (const peerHost of peerHosts) {
    const existing = existingByPeerHostId.get(peerHost.id);
    const nextHost = buildHostProfileFromPeer(peerHost, existing, now);

    if (existing) {
      const index = nextHosts.findIndex((host) => host.id === existing.id);
      if (index >= 0 && !equalHostProfileForPeerSync(nextHosts[index], nextHost)) {
        nextHosts[index] = nextHost;
        changed = true;
      }
      continue;
    }

    if (nextHost.id !== activeHostId && !nextHosts.some((host) => host.id === nextHost.id)) {
      nextHosts.push(nextHost);
      changed = true;
    }
  }

  const livePeerHostIds = new Set(peerHosts.map((peerHost) => peerHost.id));
  const filteredHosts = nextHosts.filter((host) => !host.peerHostId || livePeerHostIds.has(host.peerHostId));

  if (filteredHosts.length !== nextHosts.length) {
    changed = true;
  }

  if (changed) {
    await clientConfigStore.update({ hosts: filteredHosts });
  }
}

function buildHostProfileFromPeer(peerHost: PeerHostDto, existing: HostProfile | undefined, now: string): HostProfile {
  const baseUrl = normalizeServerBaseUrl(peerHost.baseUrl);

  return {
    id: existing?.id ?? `peer-host-${peerHost.id}`,
    name: peerHost.name || buildHostName(baseUrl),
    alias: normalizeHostAliasLabel(peerHost.alias || peerHost.name),
    baseUrl,
    kind: "lan",
    peerEnabled: peerHost.status === "reachable",
    peerHostId: peerHost.id,
    createdAt: existing?.createdAt ?? peerHost.createdAt ?? now,
    updatedAt: peerHost.updatedAt ?? now,
    lastConnectedAt: existing?.lastConnectedAt ?? null,
    lastUserId: existing?.lastUserId ?? null,
    lastUsername: existing?.lastUsername ?? null,
    relayTunnel: existing?.relayTunnel ?? null
  };
}

function equalHostProfileForPeerSync(left: HostProfile, right: HostProfile): boolean {
  return left.name === right.name
    && left.alias === right.alias
    && left.baseUrl === right.baseUrl
    && left.peerEnabled === right.peerEnabled
    && left.peerHostId === right.peerHostId
    && left.updatedAt === right.updatedAt;
}

function buildHostName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
