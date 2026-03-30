const TERMINAL_DEBUG_STORAGE_KEY = "codingns.terminal.debug";

let traceSequence = 0;

export function isTerminalDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(TERMINAL_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
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
