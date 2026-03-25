const PERF_DEBUG_STORAGE_KEY = "codingns.debug.perf";

export function isPerfDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(PERF_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function logPerfDebug(scope: string, detail?: Record<string, unknown>): void {
  if (!isPerfDebugEnabled() || typeof performance === "undefined") {
    return;
  }

  const timestamp = Math.round(performance.now());

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[perf-ui] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.info(`[perf-ui] ${scope} ${timestamp}ms`);
}
