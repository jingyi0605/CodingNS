import { performance } from "node:perf_hooks";

// 调试日志已停用，保留工具函数便于后续需要时快速恢复。
// const TERMINAL_DEBUG_ENABLED = process.env.CODINGNS_TERMINAL_DEBUG === "1";
const TERMINAL_DEBUG_ENABLED = false;
const EVENT_LOOP_LAG_MONITOR_INTERVAL_MS = 100;
const EVENT_LOOP_LAG_REPORT_THRESHOLD_MS = 50;

export function isTerminalDebugEnabled(): boolean {
  return TERMINAL_DEBUG_ENABLED;
}

export function terminalDebugNowMs(): number {
  return performance.now();
}

export function logTerminalDebug(scope: string, detail: Record<string, unknown> = {}): void {
  if (!TERMINAL_DEBUG_ENABLED) {
    return;
  }

  const suffix = formatTerminalDebugDetail(detail);
  const message = `[terminal-debug][host] ${scope}${suffix ? ` ${suffix}` : ""}`;
  console.info(message);
}

export function startTerminalDebugEventLoopLagMonitor(): () => void {
  if (!TERMINAL_DEBUG_ENABLED) {
    return () => {};
  }

  let expectedAt = performance.now() + EVENT_LOOP_LAG_MONITOR_INTERVAL_MS;
  const timer = setInterval(() => {
    const now = performance.now();
    const lagMs = now - expectedAt;

    if (lagMs >= EVENT_LOOP_LAG_REPORT_THRESHOLD_MS) {
      logTerminalDebug("event_loop.lag", {
        lagMs,
        intervalMs: EVENT_LOOP_LAG_MONITOR_INTERVAL_MS
      });
    }

    expectedAt = now + EVENT_LOOP_LAG_MONITOR_INTERVAL_MS;
  }, EVENT_LOOP_LAG_MONITOR_INTERVAL_MS);
  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}

function formatTerminalDebugDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, value]) => `${key}=${formatTerminalDebugValue(value)}`)
    .join(" ");
}

function formatTerminalDebugValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(1) : String(value);
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
