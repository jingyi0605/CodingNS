import { getHostRequestUrl } from "../../../config/env";
import type {
  HostCandidateEndpoint,
  HostCandidateEndpointKind,
  RuntimeHostProfile,
  RuntimePlatform
} from "../../../config/client-config-types";

const LOGIN_DIRECT_CANDIDATE_PROBE_TIMEOUT_MS = 350;
const MAX_LOGIN_DIRECT_CANDIDATE_ATTEMPTS = 2;
const DIRECT_CANDIDATE_KIND_PRIORITY: Record<Exclude<HostCandidateEndpointKind, "relay">, number> = {
  loopback: 0,
  lan: 1,
  tailscale: 2,
  custom: 3
};

export async function resolveLoginBaseUrlWithDirectCandidates(input: {
  host: RuntimeHostProfile;
  requestedBaseUrl?: string;
  platform: RuntimePlatform;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const requestedBaseUrl = input.requestedBaseUrl ?? input.host.baseUrl;

  if (!shouldProbeLoginDirectCandidates(input.host, requestedBaseUrl, input.platform)) {
    return requestedBaseUrl;
  }

  const candidateEndpoints = selectLoginDirectCandidateEndpoints(
    input.host.relayTunnel?.candidateEndpoints ?? [],
    requestedBaseUrl
  );

  for (const endpoint of candidateEndpoints) {
    const reachable = await probeAnonymousHostCandidateEndpoint(
      endpoint.url,
      input.fetchFn
    );

    if (reachable) {
      return endpoint.url;
    }
  }

  return requestedBaseUrl;
}

function shouldProbeLoginDirectCandidates(
  host: RuntimeHostProfile,
  requestedBaseUrl: string,
  platform: RuntimePlatform
): boolean {
  if (platform === "web") {
    return false;
  }

  const relayTunnel = host.relayTunnel;

  if (!relayTunnel?.enabled || !relayTunnel.candidateEndpoints?.length) {
    return false;
  }

  return isRelayEntryBaseUrl(requestedBaseUrl, host);
}

function selectLoginDirectCandidateEndpoints(
  candidateEndpoints: HostCandidateEndpoint[],
  requestedBaseUrl: string
): HostCandidateEndpoint[] {
  return candidateEndpoints
    .filter((endpoint): endpoint is HostCandidateEndpoint & {
      kind: Exclude<HostCandidateEndpointKind, "relay">;
    } => endpoint.kind !== "relay" && endpoint.url !== requestedBaseUrl)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      const leftKindPriority = DIRECT_CANDIDATE_KIND_PRIORITY[left.kind];
      const rightKindPriority = DIRECT_CANDIDATE_KIND_PRIORITY[right.kind];

      if (leftKindPriority !== rightKindPriority) {
        return leftKindPriority - rightKindPriority;
      }

      return left.url.localeCompare(right.url);
    })
    .slice(0, MAX_LOGIN_DIRECT_CANDIDATE_ATTEMPTS);
}

async function probeAnonymousHostCandidateEndpoint(
  baseUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const requestUrl = getHostRequestUrl("/api/public/bootstrap-status", baseUrl);
  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  const timer = globalThis.setTimeout(() => {
    abortController?.abort();
  }, LOGIN_DIRECT_CANDIDATE_PROBE_TIMEOUT_MS);

  try {
    const response = await fetchFn(requestUrl, {
      method: "GET",
      signal: abortController?.signal
    });

    if (!response.ok) {
      return false;
    }

    const payload = await readJson(response);
    return typeof payload?.initialized === "boolean";
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function isRelayEntryBaseUrl(baseUrl: string, host: RuntimeHostProfile): boolean {
  const relayTunnel = host.relayTunnel;

  if (!relayTunnel?.tunnelDomain) {
    return false;
  }

  const matchedCandidate = relayTunnel.candidateEndpoints?.find((endpoint) => endpoint.url === baseUrl);

  if (matchedCandidate) {
    return matchedCandidate.kind === "relay";
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase() === relayTunnel.tunnelDomain.trim().toLowerCase();
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const raw = await response.text();

  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
