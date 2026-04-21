import { getActiveHost, type ClientRuntimeConfig, type RuntimePlatform } from "./client-config-types";

export function isTrustedEntryOnlyModeEnabled(): boolean {
  return import.meta.env.VITE_TRUSTED_ENTRY_ONLY === "true";
}

export function shouldShowTrustedEntryLanding(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts" | "activeDiscoveredHostId" | "discoveredHosts">,
  platform: RuntimePlatform,
  trustedEntryOnlyMode = isTrustedEntryOnlyModeEnabled()
): boolean {
  if (!trustedEntryOnlyMode || platform !== "web") {
    return false;
  }

  const activeHost = getActiveHost(config);
  const relayTunnel = activeHost?.relayTunnel;

  return !(
    relayTunnel?.enabled
    && relayTunnel.tunnelDomain?.trim()
    && relayTunnel.controlBaseUrl?.trim()
  );
}
