import { clientConfigStore } from "../../config/client-config-store";
import {
  getActiveHost,
  isDiscoveredHostProfile,
  type HostCandidateEndpoint,
  type HostRelayTunnelProfile
} from "../../config/client-config-types";
import { httpClient } from "../../network/http-client";

export interface ClientRuntimeRelayTunnelView {
  provider: "codingns_relay";
  enabled: boolean;
  controlBaseUrl: string | null;
  tunnelDomain: string | null;
  bindingId: string | null;
  hostFingerprint: string | null;
  candidateEndpoints: HostCandidateEndpoint[];
}

export interface ClientRuntimeConfigView {
  platform: "desktop" | "web";
  hostBaseUrl: string;
  releaseChannel: "stable" | "beta";
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
  relayTunnel: ClientRuntimeRelayTunnelView | null;
}

export async function fetchAuthenticatedClientRuntimeConfig(): Promise<ClientRuntimeConfigView> {
  const runtimePlatform = clientConfigStore.getState().platform;
  const platform = runtimePlatform === "desktop" ? "desktop" : "web";

  return await httpClient.request<ClientRuntimeConfigView>(
    `/api/client/runtime-config?platform=${encodeURIComponent(platform)}`
  );
}

export async function syncActiveHostAuthenticatedRuntimeConfig(): Promise<void> {
  const runtimeConfig = clientConfigStore.getState();
  const activeHost = getActiveHost(runtimeConfig);

  if (!activeHost) {
    return;
  }

  const remoteConfig = await fetchAuthenticatedClientRuntimeConfig();
  const nextRelayTunnel = buildRelayTunnelProfile(remoteConfig.relayTunnel);

  if (equalRelayTunnelProfile(activeHost.relayTunnel ?? null, nextRelayTunnel)) {
    return;
  }

  const updatedAt = new Date().toISOString();

  if (isDiscoveredHostProfile(activeHost)) {
    clientConfigStore.updateRuntime({
      discoveredHosts: runtimeConfig.discoveredHosts.map((host) =>
        host.id === activeHost.id
          ? {
              ...host,
              relayTunnel: nextRelayTunnel,
              updatedAt
            }
          : host
      )
    });
    return;
  }

  await clientConfigStore.update({
    hosts: runtimeConfig.hosts.map((host) =>
      host.id === activeHost.id
        ? {
            ...host,
            relayTunnel: nextRelayTunnel,
            updatedAt
          }
        : host
    )
  });
}

function buildRelayTunnelProfile(
  relayTunnel: ClientRuntimeRelayTunnelView | null
): HostRelayTunnelProfile | null {
  if (
    !relayTunnel
    || relayTunnel.provider !== "codingns_relay"
    || !relayTunnel.controlBaseUrl
    || !relayTunnel.tunnelDomain
    || !relayTunnel.bindingId
  ) {
    return null;
  }

  return {
    provider: relayTunnel.provider,
    enabled: relayTunnel.enabled,
    controlBaseUrl: relayTunnel.controlBaseUrl,
    tunnelDomain: relayTunnel.tunnelDomain.trim().toLowerCase(),
    bindingId: relayTunnel.bindingId,
    hostFingerprint: relayTunnel.hostFingerprint,
    candidateEndpoints: relayTunnel.candidateEndpoints
  };
}

function equalRelayTunnelProfile(
  left: HostRelayTunnelProfile | null,
  right: HostRelayTunnelProfile | null
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  if (
    left.provider !== right.provider
    || left.enabled !== right.enabled
    || left.controlBaseUrl !== right.controlBaseUrl
    || left.tunnelDomain !== right.tunnelDomain
    || (left.bindingId ?? null) !== (right.bindingId ?? null)
    || (left.hostFingerprint ?? null) !== (right.hostFingerprint ?? null)
  ) {
    return false;
  }

  const leftEndpoints = left.candidateEndpoints ?? [];
  const rightEndpoints = right.candidateEndpoints ?? [];

  if (leftEndpoints.length !== rightEndpoints.length) {
    return false;
  }

  return leftEndpoints.every((endpoint, index) => {
    const other = rightEndpoints[index];

    return (
      endpoint.endpointId === other?.endpointId
      && endpoint.kind === other.kind
      && endpoint.url === other.url
      && endpoint.priority === other.priority
      && endpoint.expiresAt === other.expiresAt
      && endpoint.source === other.source
    );
  });
}
