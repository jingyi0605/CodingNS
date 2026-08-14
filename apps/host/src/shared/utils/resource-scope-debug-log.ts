const RESOURCE_SCOPE_DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.CODINGNS_RESOURCE_SCOPE_DEBUG?.trim() ?? ""
);

export function isResourceScopeDebugEnabled(): boolean {
  return RESOURCE_SCOPE_DEBUG_ENABLED;
}

export function logResourceScopeDebug(scope: string, detail: Record<string, unknown> = {}): void {
  if (!RESOURCE_SCOPE_DEBUG_ENABLED) {
    return;
  }

  const suffix = formatResourceScopeDetail(detail);
  const message = `[resource-scope][host] ${scope}${suffix ? ` ${suffix}` : ""}`;
  console.info(message);
}

function formatResourceScopeDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, value]) => `${key}=${formatResourceScopeValue(value)}`)
    .join(" ");
}

function formatResourceScopeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value.length > 240 ? `${value.slice(0, 240)}...` : value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    const json = JSON.stringify(value);
    return json.length > 240 ? `${json.slice(0, 240)}...` : json;
  } catch {
    return String(value);
  }
}
