const TERMINAL_DEBUG_STORAGE_KEY = "codingns.terminal.debug";

let traceSequence = 0;

export function isTerminalDebugEnabled(): boolean {
  // 调试日志已停用，保留开关键名便于后续恢复。
  return false;
}

export function terminalDebugNowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

export function createTerminalDebugTraceId(terminalId: string): string {
  traceSequence += 1;
  return `${terminalId}-${Date.now().toString(36)}-${traceSequence.toString(36)}`;
}

export function logTerminalDebug(scope: string, detail: Record<string, unknown> = {}): void {
  if (!isTerminalDebugEnabled()) {
    return;
  }

  console.info(`[terminal-debug][client] ${scope}`, detail);
}

export { TERMINAL_DEBUG_STORAGE_KEY };
