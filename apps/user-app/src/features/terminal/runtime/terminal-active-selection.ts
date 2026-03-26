import type { TerminalDto } from "../api/terminal-api";

interface PickActiveTerminalInput {
  terminals: TerminalDto[];
  preferredTerminalId?: string | null;
  currentActiveTerminalId?: string | null;
  persistedTerminalId?: string | null;
}

export function pickActiveTerminalAfterReload({
  terminals,
  preferredTerminalId,
  currentActiveTerminalId,
  persistedTerminalId
}: PickActiveTerminalInput): TerminalDto | null {
  const preferredTerminal = findTerminalById(terminals, preferredTerminalId);
  const currentActiveTerminal = findTerminalById(terminals, currentActiveTerminalId);
  const persistedTerminal = findTerminalById(terminals, persistedTerminalId);
  const firstRunningTerminal = terminals.find((terminal) => terminal.status === "running") ?? null;

  return (
    pickRunningTerminal(preferredTerminal) ??
    pickRunningTerminal(currentActiveTerminal) ??
    pickRunningTerminal(persistedTerminal) ??
    firstRunningTerminal ??
    preferredTerminal ??
    currentActiveTerminal ??
    persistedTerminal ??
    terminals[0] ??
    null
  );
}

function findTerminalById(terminals: TerminalDto[], terminalId?: string | null): TerminalDto | null {
  if (!terminalId) {
    return null;
  }

  return terminals.find((terminal) => terminal.id === terminalId) ?? null;
}

function pickRunningTerminal(terminal: TerminalDto | null): TerminalDto | null {
  if (!terminal || terminal.status !== "running") {
    return null;
  }

  return terminal;
}
