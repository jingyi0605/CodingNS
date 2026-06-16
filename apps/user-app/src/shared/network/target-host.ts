export function normalizeTargetHostId(targetHostId?: string | null): string | null {
  const normalized = targetHostId?.trim() || null;
  return normalized && normalized !== "current" ? normalized : null;
}
