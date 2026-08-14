import { normalizeTargetHostId } from "../shared/network/target-host";

export function buildHostWsPath(targetHostId?: string | null): string {
  const normalizedTargetHostId = normalizeTargetHostId(targetHostId);

  if (!normalizedTargetHostId) {
    return "/ws";
  }

  return `/api/host-proxy/hosts/${encodeURIComponent(normalizedTargetHostId)}/ws`;
}
