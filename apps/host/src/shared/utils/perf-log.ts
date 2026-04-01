interface PerfLogOptions {
  thresholdMs?: number;
  force?: boolean;
}

const PERF_DEBUG_ENABLED = /^(1|true|yes)$/i.test(
  process.env.CODINGNS_PERF_DEBUG?.trim() ?? ""
);

export function isPerfDebugEnabled(): boolean {
  return PERF_DEBUG_ENABLED;
}

export function logPerformance(
  scope: string,
  durationMs: number,
  detail: Record<string, unknown> = {},
  options: PerfLogOptions = {}
): void {
  if (!PERF_DEBUG_ENABLED) {
    return;
  }

  const thresholdMs = options.thresholdMs ?? 500;

  if (!options.force && durationMs < thresholdMs) {
    return;
  }

  const suffix = formatPerfDetail(detail);
  const message = `[perf] ${scope} ${Math.round(durationMs)}ms${suffix ? ` ${suffix}` : ""}`;
  console.info(message);
}

function formatPerfDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, value]) => `${key}=${formatPerfValue(value)}`)
    .join(" ");
}

function formatPerfValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value)) : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
