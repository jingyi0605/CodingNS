import { clientConfigStore } from "../../../config/client-config-store";
import type { HostProfile } from "../../../config/client-config-types";
import { normalizeServerBaseUrl } from "../../../config/server-config-shared";
import {
  readWorkspaceHostAssignments,
  writeWorkspaceHostAssignmentsSilently
} from "../../conversation/components/workspace-host-assignment-storage";
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
  const livePeerHostIds = new Set(peerHosts.map((peerHost) => peerHost.id));
  const existingByPeerHostId = new Map<string, HostProfile>();
  const existingByBaseUrl = new Map<string, HostProfile>();
  let nextHosts = current.hosts.map((host) => {
    if (host.peerHostId) {
      existingByPeerHostId.set(host.peerHostId, host);
    }
    existingByBaseUrl.set(normalizeServerBaseUrl(host.baseUrl), host);
    return host;
  });
  let changed = false;

  for (const peerHost of peerHosts) {
    const normalizedBaseUrl = normalizeServerBaseUrl(peerHost.baseUrl);
    const existing =
      existingByPeerHostId.get(peerHost.id)
      ?? existingByBaseUrl.get(normalizedBaseUrl);
    const nextHost = buildHostProfileFromPeer(peerHost, existing, now);

    if (existing) {
      const index = nextHosts.findIndex((host) => host.id === existing.id);
      if (index >= 0 && !equalHostProfileForPeerSync(nextHosts[index], nextHost)) {
        nextHosts[index] = nextHost;
        changed = true;
      }
      existingByPeerHostId.set(peerHost.id, nextHost);
      existingByBaseUrl.set(normalizedBaseUrl, nextHost);
      continue;
    }

    if (nextHost.id !== activeHostId && !nextHosts.some((host) => host.id === nextHost.id)) {
      nextHosts.push(nextHost);
      changed = true;
      existingByPeerHostId.set(peerHost.id, nextHost);
      existingByBaseUrl.set(normalizedBaseUrl, nextHost);
    }
  }

  nextHosts = nextHosts.map((host) => {
    if (!host.peerHostId || livePeerHostIds.has(host.peerHostId)) {
      return host;
    }

    changed = true;
    return {
      ...host,
      peerEnabled: false,
      peerHostId: null,
      updatedAt: now
    };
  });

  const filteredHosts = nextHosts.filter((host) => !host.peerHostId || livePeerHostIds.has(host.peerHostId));
  const dedupedHosts = dedupePeerHosts(filteredHosts, activeHostId);

  if (filteredHosts.length !== nextHosts.length || dedupedHosts.length !== filteredHosts.length) {
    changed = true;
  }

  if (changed) {
    await clientConfigStore.update({ hosts: dedupedHosts });
  }

  clearStaleWorkspaceAssignments(dedupedHosts);
}

function buildHostProfileFromPeer(peerHost: PeerHostDto, existing: HostProfile | undefined, now: string): HostProfile {
  const baseUrl = normalizeServerBaseUrl(peerHost.baseUrl);

  return {
    id: existing?.id ?? `peer-host-${peerHost.id}`,
    name: peerHost.name || buildHostName(baseUrl),
    alias: existing?.alias ?? normalizeHostAliasLabel(peerHost.alias || peerHost.name),
    tagColor: existing?.tagColor ?? peerHost.tagColor ?? null,
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
    && (left.tagColor ?? null) === (right.tagColor ?? null)
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

function dedupePeerHosts(hosts: readonly HostProfile[], activeHostId: string | null): HostProfile[] {
  const deduped: HostProfile[] = [];

  for (const host of hosts) {
    const duplicateIndex = deduped.findIndex((item) => isSamePeerHostEntry(item, host));
    if (duplicateIndex < 0) {
      deduped.push(host);
      continue;
    }

    if (comparePeerHostEntryPreference(host, deduped[duplicateIndex], activeHostId) > 0) {
      deduped[duplicateIndex] = host;
    }
  }

  return deduped;
}

function isSamePeerHostEntry(left: HostProfile, right: HostProfile): boolean {
  if (left.id === right.id) {
    return false;
  }

  if (left.peerHostId && right.peerHostId) {
    return left.peerHostId === right.peerHostId;
  }

  return normalizeServerBaseUrl(left.baseUrl) === normalizeServerBaseUrl(right.baseUrl);
}

function comparePeerHostEntryPreference(
  candidate: HostProfile,
  current: HostProfile,
  activeHostId: string | null
): number {
  return scorePeerHostEntry(candidate, activeHostId) - scorePeerHostEntry(current, activeHostId);
}

function scorePeerHostEntry(host: HostProfile, activeHostId: string | null): number {
  let score = 0;

  if (host.id === activeHostId) {
    score += 100;
  }
  if (!host.id.startsWith("peer-host-")) {
    score += 10;
  }
  if (host.peerEnabled) {
    score += 4;
  }
  if (host.lastConnectedAt) {
    score += 2;
  }
  if (host.lastUsername) {
    score += 1;
  }

  return score;
}

function clearStaleWorkspaceAssignments(hosts: readonly HostProfile[]): void {
  const validHostIds = new Set(
    hosts
      .filter((host) => host.peerEnabled && host.peerHostId)
      .map((host) => host.id)
  );
  const currentAssignments = readWorkspaceHostAssignments();
  let changed = false;
  const nextAssignments = Object.fromEntries(
    Object.entries(currentAssignments).map(([key, assignment]) => {
      if (
        assignment.selectedHostId
        && assignment.selectedHostId !== "current"
        && !validHostIds.has(assignment.selectedHostId)
      ) {
        changed = true;
        return [key, {
          selectedHostId: "current",
          remoteWorkspaceId: null,
          remoteWorkspacePath: null,
          remoteWorkspaceName: null
        }];
      }

      return [key, assignment];
    })
  );

  if (changed) {
    writeWorkspaceHostAssignmentsSilently(nextAssignments);
  }
}
