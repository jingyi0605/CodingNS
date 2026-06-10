export function buildHostWsPath(targetHostId?: string | null): string {
  const normalizedTargetHostId = targetHostId?.trim();

  if (!normalizedTargetHostId) {
    return "/ws";
  }

  return `/api/host-proxy/hosts/${encodeURIComponent(normalizedTargetHostId)}/ws`;
}
