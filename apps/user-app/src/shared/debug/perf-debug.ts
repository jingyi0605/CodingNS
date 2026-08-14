const PERF_DEBUG_STORAGE_KEY = "codingns.debug.perf";
const PERF_DEBUG_SCOPE_FILTER_STORAGE_KEY = "codingns.debug.perfScopeFilter";
const SESSION_MESSAGE_DEDUP_DEBUG_STORAGE_KEY = "codingns.debug.sessionMessageDedup";
const SESSION_MESSAGE_DEDUP_SCOPE_FILTER_STORAGE_KEY = "codingns.debug.sessionMessageDedupScopeFilter";
const OPENCODE_ORDER_DEBUG_STORAGE_KEY = "codingns.debug.opencodeOrder";
const TIMELINE_SCROLL_DEBUG_STORAGE_KEY = "codingns.debug.timelineScroll";
const TIMELINE_SCROLL_SCOPE_FILTER_STORAGE_KEY = "codingns.debug.timelineScrollScopeFilter";
const CONVERSATION_TIMELINE_DEBUG_STORAGE_KEY = "codingns.debug.conversationTimeline";
const PERF_DEBUG_BUCKET_LIMIT = 1200;

function readDebugScopeFilters(storageKey: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey) ?? "";

    return rawValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

function matchesDebugScopeFilter(scope: string, storageKey: string): boolean {
  const filters = readDebugScopeFilters(storageKey);

  if (filters.length === 0) {
    return true;
  }

  return filters.some((filter) => scope.includes(filter));
}

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
  if (
    !isPerfDebugEnabled()
    || typeof performance === "undefined"
    || !matchesDebugScopeFilter(scope, PERF_DEBUG_SCOPE_FILTER_STORAGE_KEY)
  ) {
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
      __CODINGNS_PERF_DEBUG__?: Array<Record<string, unknown>>;
    };
    const bucket = debugWindow.__CODINGNS_PERF_DEBUG__ ?? [];
    bucket.push(payload);
    if (bucket.length > PERF_DEBUG_BUCKET_LIMIT) {
      bucket.splice(0, bucket.length - PERF_DEBUG_BUCKET_LIMIT);
    }
    debugWindow.__CODINGNS_PERF_DEBUG__ = bucket;
  } catch {
    // 调试日志不能影响主流程。
  }

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[perf-ui] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.info(`[perf-ui] ${scope} ${timestamp}ms`);
}

export function emitPerfDebugProbe(scope: string, detail?: Record<string, unknown>): void {
  if (!isPerfDebugEnabled() || typeof performance === "undefined") {
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
      __CODINGNS_PERF_DEBUG__?: Array<Record<string, unknown>>;
    };
    const bucket = debugWindow.__CODINGNS_PERF_DEBUG__ ?? [];
    bucket.push(payload);
    if (bucket.length > PERF_DEBUG_BUCKET_LIMIT) {
      bucket.splice(0, bucket.length - PERF_DEBUG_BUCKET_LIMIT);
    }
    debugWindow.__CODINGNS_PERF_DEBUG__ = bucket;
  } catch {
    // 调试日志不能影响主流程。
  }

  if (detail && Object.keys(detail).length > 0) {
    console.warn(`[perf-ui-probe] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.warn(`[perf-ui-probe] ${scope} ${timestamp}ms`);
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
  if (
    !isSessionMessageDedupDebugEnabled()
    || typeof performance === "undefined"
    || !matchesDebugScopeFilter(scope, SESSION_MESSAGE_DEDUP_SCOPE_FILTER_STORAGE_KEY)
  ) {
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
      __CODINGNS_SESSION_MESSAGE_DEDUP_DEBUG__?: Array<Record<string, unknown>>;
    };
    const bucket = debugWindow.__CODINGNS_SESSION_MESSAGE_DEDUP_DEBUG__ ?? [];
    bucket.push(payload);
    if (bucket.length > 300) {
      bucket.splice(0, bucket.length - 300);
    }
    debugWindow.__CODINGNS_SESSION_MESSAGE_DEDUP_DEBUG__ = bucket;
  } catch {
    // 调试日志不能影响主流程。
  }

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

export function isConversationTimelineDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(CONVERSATION_TIMELINE_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function logConversationTimelineDebug(
  scope: string,
  detail?: Record<string, unknown>
): void {
  if (!isConversationTimelineDebugEnabled() || typeof performance === "undefined") {
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
      __CODINGNS_CONVERSATION_TIMELINE_DEBUG__?: Array<Record<string, unknown>>;
      __CODINGNS_CONVERSATION_TIMELINE_DEBUG_CLEARED__?: boolean;
      __CODINGNS_OPENCODE_ORDER_DEBUG__?: Array<Record<string, unknown>>;
      __CODINGNS_SESSION_MESSAGE_DEDUP_DEBUG__?: Array<Record<string, unknown>>;
      __CODINGNS_TIMELINE_SCROLL_DEBUG__?: Array<Record<string, unknown>>;
    };

    if (debugWindow.__CODINGNS_CONVERSATION_TIMELINE_DEBUG_CLEARED__ !== true) {
      debugWindow.__CODINGNS_OPENCODE_ORDER_DEBUG__ = [];
      debugWindow.__CODINGNS_SESSION_MESSAGE_DEDUP_DEBUG__ = [];
      debugWindow.__CODINGNS_TIMELINE_SCROLL_DEBUG__ = [];
      debugWindow.__CODINGNS_CONVERSATION_TIMELINE_DEBUG__ = [];
      debugWindow.__CODINGNS_CONVERSATION_TIMELINE_DEBUG_CLEARED__ = true;
    }

    const bucket = debugWindow.__CODINGNS_CONVERSATION_TIMELINE_DEBUG__ ?? [];
    bucket.push(payload);
    if (bucket.length > 400) {
      bucket.splice(0, bucket.length - 400);
    }
    debugWindow.__CODINGNS_CONVERSATION_TIMELINE_DEBUG__ = bucket;
  } catch {
    // 调试日志不能影响主流程。
  }

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[conversation-timeline] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.info(`[conversation-timeline] ${scope} ${timestamp}ms`);
}

export function isTimelineScrollDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(TIMELINE_SCROLL_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function logTimelineScrollDebug(
  scope: string,
  detail?: Record<string, unknown>
): void {
  if (
    !isTimelineScrollDebugEnabled()
    || typeof performance === "undefined"
    || !matchesDebugScopeFilter(scope, TIMELINE_SCROLL_SCOPE_FILTER_STORAGE_KEY)
  ) {
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
      __CODINGNS_TIMELINE_SCROLL_DEBUG__?: Array<Record<string, unknown>>;
    };
    const bucket = debugWindow.__CODINGNS_TIMELINE_SCROLL_DEBUG__ ?? [];
    bucket.push(payload);
    if (bucket.length > 300) {
      bucket.splice(0, bucket.length - 300);
    }
    debugWindow.__CODINGNS_TIMELINE_SCROLL_DEBUG__ = bucket;
  } catch {
    // 调试日志不能影响主流程。
  }

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[timeline-scroll] ${scope} ${timestamp}ms`, detail);
    return;
  }

  console.info(`[timeline-scroll] ${scope} ${timestamp}ms`);
}
