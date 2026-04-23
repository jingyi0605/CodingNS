const PERF_DEBUG_STORAGE_KEY = "codingns.debug.perf";
const SESSION_MESSAGE_DEDUP_DEBUG_STORAGE_KEY = "codingns.debug.sessionMessageDedup";

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

export function isSessionMessageDedupDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SESSION_MESSAGE_DEDUP_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function logSessionMessageDedupDebug(
  scope: string,
  detail?: Record<string, unknown>
): void {
  if (!isSessionMessageDedupDebugEnabled() || typeof performance === "undefined") {
    return;
  }

  const timestamp = Math.round(performance.now());

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[session-dedup] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.info(`[session-dedup] ${scope} ${timestamp}ms`);
}
