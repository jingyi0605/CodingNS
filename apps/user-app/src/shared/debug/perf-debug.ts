const PERF_DEBUG_STORAGE_KEY = "codingns.debug.perf";
const SESSION_MESSAGE_DEDUP_DEBUG_STORAGE_KEY = "codingns.debug.sessionMessageDedup";
const OPENCODE_ORDER_DEBUG_STORAGE_KEY = "codingns.debug.opencodeOrder";

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

export function isOpenCodeOrderDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(OPENCODE_ORDER_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function logOpenCodeOrderDebug(
  scope: string,
  detail?: Record<string, unknown>
): void {
  if (!isOpenCodeOrderDebugEnabled() || typeof performance === "undefined") {
    return;
  }

  const timestamp = Math.round(performance.now());
  const payload = {
    scope,
    timestampMs: timestamp,
    ...(detail ?? {})
  };

  try {
    const debugWindow = window as typeof window & {
      __CODINGNS_OPENCODE_ORDER_DEBUG__?: Array<Record<string, unknown>>;
    };
    const bucket = debugWindow.__CODINGNS_OPENCODE_ORDER_DEBUG__ ?? [];
    bucket.push(payload);
    if (bucket.length > 500) {
      bucket.splice(0, bucket.length - 500);
    }
    debugWindow.__CODINGNS_OPENCODE_ORDER_DEBUG__ = bucket;
  } catch {
    // 调试日志不能影响主流程。
  }

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[opencode-order-ui] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.info(`[opencode-order-ui] ${scope} ${timestamp}ms`);
}
