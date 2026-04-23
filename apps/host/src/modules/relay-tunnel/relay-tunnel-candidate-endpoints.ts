import os from "node:os";

import type {
  HostCandidateEndpoint,
  HostCandidateEndpointKind,
  InstanceRelayTunnelConfig
} from "../../types/domain.js";

export function buildHostCandidateEndpoints(config: InstanceRelayTunnelConfig): HostCandidateEndpoint[] {
  const endpoints = new Map<string, HostCandidateEndpoint>();
  const relayEndpoint = buildRelayPublicUrl(config);

  if (relayEndpoint) {
    endpoints.set(relayEndpoint, {
      endpointId: `relay:${relayEndpoint}`,
      kind: "relay",
      url: relayEndpoint,
      priority: 400,
      expiresAt: null,
      source: "host_reported"
    });
  }

  for (const localCandidateUrl of buildLocalCandidateUrls(config.localTargetBaseUrl)) {
    endpoints.set(localCandidateUrl, {
      endpointId: `host_reported:${localCandidateUrl}`,
      kind: classifyCandidateEndpointKind(localCandidateUrl),
      url: localCandidateUrl,
      priority: resolveCandidateEndpointPriority(localCandidateUrl),
      expiresAt: null,
      source: "host_reported"
    });
  }

  return Array.from(endpoints.values()).sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.url.localeCompare(right.url);
  });
}

function buildRelayPublicUrl(config: InstanceRelayTunnelConfig): string | null {
  if (!config.tunnelDomain || !config.controlBaseUrl) {
    return null;
  }

  try {
    const controlUrl = new URL(config.controlBaseUrl);
    controlUrl.hostname = config.tunnelDomain.trim().toLowerCase();
    controlUrl.pathname = "/";
    controlUrl.search = "";
    controlUrl.hash = "";
    return controlUrl.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function buildLocalCandidateUrls(localTargetBaseUrl: string): string[] {
  let parsed: URL;

  try {
    parsed = new URL(localTargetBaseUrl);
  } catch {
    return [];
  }

  const candidates = new Set<string>();
  const hostname = parsed.hostname.trim().toLowerCase();

  candidates.add(normalizeUrlWithoutTrailingSlash(parsed.toString()));

  if (hostname === "0.0.0.0" || hostname === "::" || hostname === "::0") {
    for (const networkAddress of listPrivateIpv4Addresses()) {
      const candidateUrl = new URL(parsed.toString());
      candidateUrl.hostname = networkAddress;
      candidates.add(normalizeUrlWithoutTrailingSlash(candidateUrl.toString()));
    }
  }

  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
    for (const networkAddress of listPrivateIpv4Addresses()) {
      const candidateUrl = new URL(parsed.toString());
      candidateUrl.hostname = networkAddress;
      candidates.add(normalizeUrlWithoutTrailingSlash(candidateUrl.toString()));
    }
  }

  return Array.from(candidates);
}

function listPrivateIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const candidates = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      if (!isPrivateIpv4Address(entry.address)) {
        continue;
      }

      candidates.add(entry.address);
    }
  }

  return Array.from(candidates).sort();
}

function isPrivateIpv4Address(address: string): boolean {
  return (
    /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function classifyCandidateEndpointKind(candidateUrl: string): HostCandidateEndpointKind {
  try {
    const hostname = new URL(candidateUrl).hostname.toLowerCase();

    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
      return "loopback";
    }

    if (isPrivateIpv4Address(hostname)) {
      return "lan";
    }

    return "custom";
  } catch {
    return "custom";
  }
}

function resolveCandidateEndpointPriority(candidateUrl: string): number {
  const kind = classifyCandidateEndpointKind(candidateUrl);

  switch (kind) {
    case "loopback":
      return 100;
    case "lan":
      return 200;
    case "tailscale":
      return 300;
    case "relay":
      return 400;
    default:
      return 500;
  }
}

function normalizeUrlWithoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
