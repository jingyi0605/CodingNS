const PERMISSION_DEBUG_ENABLED = process.env.CODINGNS_PERMISSION_DEBUG !== "0";

export function isPermissionDebugEnabled(): boolean {
  return PERMISSION_DEBUG_ENABLED;
}

export function logPermissionDebug(scope: string, detail: Record<string, unknown> = {}): void {
  if (!PERMISSION_DEBUG_ENABLED) {
    return;
  }

  const suffix = formatPermissionDebugDetail(detail);
  const message = `[permission-debug][host] ${scope}${suffix ? ` ${suffix}` : ""}`;
  console.info(message);
}

function formatPermissionDebugDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, value]) => `${key}=${formatPermissionDebugValue(value)}`)
    .join(" ");
}

function formatPermissionDebugValue(value: unknown): string {
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
