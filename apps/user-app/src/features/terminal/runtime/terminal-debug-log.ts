const TERMINAL_DEBUG_STORAGE_KEY = "codingns.terminal.debug";
const TERMINAL_DEBUG_ENABLED = readTerminalDebugFlag();

let traceSequence = 0;

export function isTerminalDebugEnabled(): boolean {
  return TERMINAL_DEBUG_ENABLED;
}

function readTerminalDebugFlag(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const queryFlag = new URLSearchParams(window.location.search).get("terminalDebug");

  if (queryFlag) {
    return isTruthyFlag(queryFlag);
  }

  try {
    const storedValue = window.localStorage.getItem(TERMINAL_DEBUG_STORAGE_KEY);
    return storedValue ? isTruthyFlag(storedValue) : false;
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

function isTruthyFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
