const STORAGE_KEY = "codingns.user-app.terminal-page";
const STORAGE_SCHEMA_VERSION = 2;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MAX_TERMINAL_COLS = 400;
const MAX_TERMINAL_ROWS = 200;
const MAX_TERMINAL_VIEWPORT_Y = 200_000;
const MAX_TERMINAL_SNAPSHOT_CHARS = 120_000;

interface PersistedTerminalPageStateEnvelope {
  schemaVersion: number;
  state: PersistedTerminalPageState;
}

interface PersistedValueEnvelope<T> {
  value: T;
  updatedAt: number;
}

interface PersistedTerminalPageState {
  selectedWorkspaceId: PersistedValueEnvelope<string | null> | null;
  activeTerminalIdByWorkspace: Record<string, PersistedValueEnvelope<string>>;
  cursorByTerminalId: Record<string, PersistedValueEnvelope<string>>;
  viewStateByTerminalId: Record<string, PersistedValueEnvelope<PersistedTerminalViewState>>;
}

export interface PersistedTerminalViewState {
  content: string;
  cursor: string | null;
  cols: number;
  rows: number;
  viewportY: number;
}

export interface TerminalRecoveryState {
  resumeCursor: string | null;
  viewState: PersistedTerminalViewState | null;
}

const EMPTY_STATE: PersistedTerminalPageState = {
  selectedWorkspaceId: null,
  activeTerminalIdByWorkspace: {},
  cursorByTerminalId: {},
  viewStateByTerminalId: {}
};

export function readPersistedTerminalPageState(): {
  selectedWorkspaceId: string | null;
  activeTerminalIdByWorkspace: Record<string, string>;
  cursorByTerminalId: Record<string, string>;
  viewStateByTerminalId: Record<string, PersistedTerminalViewState>;
} {
  const state = readRawPersistedTerminalPageState();

  return {
    selectedWorkspaceId: state.selectedWorkspaceId?.value ?? null,
    activeTerminalIdByWorkspace: unwrapValueRecord(state.activeTerminalIdByWorkspace),
    cursorByTerminalId: unwrapValueRecord(state.cursorByTerminalId),
    viewStateByTerminalId: unwrapValueRecord(state.viewStateByTerminalId)
  };
}

export function persistSelectedWorkspaceId(workspaceId: string | null): void {
  updatePersistedTerminalPageState((current, updatedAt) => ({
    ...current,
    selectedWorkspaceId: {
      value: workspaceId,
      updatedAt
    }
  }));
}

export function readPersistedActiveTerminalId(workspaceId: string): string | null {
  return readRawPersistedTerminalPageState().activeTerminalIdByWorkspace[workspaceId]?.value ?? null;
}

export function persistActiveTerminalId(workspaceId: string, terminalId: string | null): void {
  updatePersistedTerminalPageState((current, updatedAt) => {
    const nextState: PersistedTerminalPageState = {
      ...current,
      activeTerminalIdByWorkspace: {
        ...current.activeTerminalIdByWorkspace
      }
    };

    if (terminalId) {
      nextState.activeTerminalIdByWorkspace[workspaceId] = {
        value: terminalId,
        updatedAt
      };
    } else {
      delete nextState.activeTerminalIdByWorkspace[workspaceId];
    }

    return nextState;
  });
}

export function readPersistedTerminalCursor(terminalId: string): string | null {
  return readRawPersistedTerminalPageState().cursorByTerminalId[terminalId]?.value ?? null;
}

export function persistTerminalCursor(terminalId: string, cursor: string | null): void {
  updatePersistedTerminalPageState((current, updatedAt) => {
    const nextState: PersistedTerminalPageState = {
      ...current,
      cursorByTerminalId: {
        ...current.cursorByTerminalId
      }
    };

    if (!cursor) {
      delete nextState.cursorByTerminalId[terminalId];
      return nextState;
    }

    nextState.cursorByTerminalId[terminalId] = pickNewerCursorEnvelope(
      current.cursorByTerminalId[terminalId],
      {
        value: cursor,
        updatedAt
      }
    );

    return nextState;
  });
}

export function readPersistedTerminalViewState(
  terminalId: string
): PersistedTerminalViewState | null {
  return readRawPersistedTerminalPageState().viewStateByTerminalId[terminalId]?.value ?? null;
}

export function readTerminalRecoveryState(terminalId: string): TerminalRecoveryState {
  const state = readRawPersistedTerminalPageState();
  const persistedViewState = state.viewStateByTerminalId[terminalId]?.value ?? null;
  const persistedCursor = state.cursorByTerminalId[terminalId]?.value ?? null;

  if (!persistedViewState) {
    return {
      resumeCursor: persistedCursor,
      viewState: null
    };
  }

  if (persistedViewState.cursor && persistedCursor && isCursorNewer(persistedCursor, persistedViewState.cursor)) {
    return {
      resumeCursor: persistedCursor,
      viewState: null
    };
  }

  return {
    resumeCursor: persistedViewState.cursor ?? persistedCursor,
    viewState: persistedViewState
  };
}

export function persistTerminalViewState(
  terminalId: string,
  viewState: PersistedTerminalViewState | null
): void {
  updatePersistedTerminalPageState((current, updatedAt) => {
    const nextState: PersistedTerminalPageState = {
      ...current,
      cursorByTerminalId: {
        ...current.cursorByTerminalId
      },
      viewStateByTerminalId: {
        ...current.viewStateByTerminalId
      }
    };

    if (!viewState) {
      delete nextState.viewStateByTerminalId[terminalId];
      return nextState;
    }

    nextState.viewStateByTerminalId[terminalId] = pickNewerViewStateEnvelope(
      current.viewStateByTerminalId[terminalId],
      {
        value: viewState,
        updatedAt
      }
    );

    if (viewState.cursor) {
      nextState.cursorByTerminalId[terminalId] = pickNewerCursorEnvelope(
        current.cursorByTerminalId[terminalId],
        {
          value: viewState.cursor,
          updatedAt
        }
      );
    }

    return nextState;
  });
}

function updatePersistedTerminalPageState(
  updater: (current: PersistedTerminalPageState, updatedAt: number) => PersistedTerminalPageState
): void {
  if (typeof window === "undefined") {
    return;
  }

  const currentState = readRawPersistedTerminalPageState();
  const updatedAt = Date.now();
  const nextState = updater(currentState, updatedAt);

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      state: nextState
    } satisfies PersistedTerminalPageStateEnvelope)
  );
}

function readRawPersistedTerminalPageState(): PersistedTerminalPageState {
  if (typeof window === "undefined") {
    return EMPTY_STATE;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return EMPTY_STATE;
    }

    const parsed = JSON.parse(rawValue) as
      | Partial<PersistedTerminalPageStateEnvelope>
      | Partial<PersistedTerminalPageState>;

    const rawState: Partial<PersistedTerminalPageState> =
      parsed &&
      typeof parsed === "object" &&
      "state" in parsed &&
      parsed.state &&
      typeof parsed.state === "object"
        ? parsed.state
        : (parsed as Partial<PersistedTerminalPageState>);

    return {
      selectedWorkspaceId: normalizeNullableValueEnvelope(rawState.selectedWorkspaceId),
      activeTerminalIdByWorkspace: normalizeValueRecord(rawState.activeTerminalIdByWorkspace, normalizeString),
      cursorByTerminalId: normalizeValueRecord(rawState.cursorByTerminalId, normalizeString),
      viewStateByTerminalId: normalizeValueRecord(rawState.viewStateByTerminalId, normalizeViewState)
    };
  } catch {
    return EMPTY_STATE;
  }
}

function normalizeNullableValueEnvelope(
  input: unknown
): PersistedValueEnvelope<string | null> | null {
  if (input === null) {
    return null;
  }

  const envelope = normalizeValueEnvelope(input, normalizeNullableString);
  return envelope ?? null;
}

function normalizeValueRecord<T>(
  input: unknown,
  normalizer: (value: unknown) => T | null
): Record<string, PersistedValueEnvelope<T>> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const record: Record<string, PersistedValueEnvelope<T>> = {};

  for (const [key, value] of Object.entries(input)) {
    const envelope = normalizeValueEnvelope(value, normalizer);

    if (key && envelope) {
      record[key] = envelope;
    }
  }

  return record;
}

function normalizeValueEnvelope<T>(
  input: unknown,
  normalizer: (value: unknown) => T | null
): PersistedValueEnvelope<T> | null {
  const legacyValue = normalizer(input);

  if (legacyValue !== null) {
    return {
      value: legacyValue,
      updatedAt: 0
    };
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<PersistedValueEnvelope<unknown>>;
  const normalizedValue = normalizer(candidate.value);

  if (normalizedValue === null) {
    return null;
  }

  return {
    value: normalizedValue,
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : 0
  };
}

function normalizeString(input: unknown): string | null {
  return typeof input === "string" && input ? input : null;
}

function normalizeNullableString(input: unknown): string | null {
  if (input === null) {
    return null;
  }

  return typeof input === "string" ? input : null;
}

function normalizeViewState(input: unknown): PersistedTerminalViewState | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<PersistedTerminalViewState>;

  if (
    typeof candidate.content !== "string" ||
    candidate.content.length === 0 ||
    candidate.content.length > MAX_TERMINAL_SNAPSHOT_CHARS ||
    (candidate.cursor !== null && candidate.cursor !== undefined && typeof candidate.cursor !== "string") ||
    !Number.isInteger(candidate.cols) ||
    !Number.isInteger(candidate.rows) ||
    !Number.isInteger(candidate.viewportY)
  ) {
    return null;
  }

  const cols = candidate.cols as number;
  const rows = candidate.rows as number;
  const viewportY = candidate.viewportY as number;

  if (
    cols < MIN_TERMINAL_COLS ||
    cols > MAX_TERMINAL_COLS ||
    rows < MIN_TERMINAL_ROWS ||
    rows > MAX_TERMINAL_ROWS ||
    viewportY < 0 ||
    viewportY > MAX_TERMINAL_VIEWPORT_Y
  ) {
    return null;
  }

  return {
    content: candidate.content,
    cursor: typeof candidate.cursor === "string" ? candidate.cursor : null,
    cols,
    rows,
    viewportY
  };
}

function unwrapValueRecord<T>(input: Record<string, PersistedValueEnvelope<T>>): Record<string, T> {
  const record: Record<string, T> = {};

  for (const [key, envelope] of Object.entries(input)) {
    record[key] = envelope.value;
  }

  return record;
}

function pickNewerCursorEnvelope(
  current: PersistedValueEnvelope<string> | undefined,
  incoming: PersistedValueEnvelope<string>
): PersistedValueEnvelope<string> {
  if (!current) {
    return incoming;
  }

  if (isCursorNewer(incoming.value, current.value)) {
    return incoming;
  }

  if (isCursorNewer(current.value, incoming.value)) {
    return current;
  }

  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

function pickNewerViewStateEnvelope(
  current: PersistedValueEnvelope<PersistedTerminalViewState> | undefined,
  incoming: PersistedValueEnvelope<PersistedTerminalViewState>
): PersistedValueEnvelope<PersistedTerminalViewState> {
  if (!current) {
    return incoming;
  }

  const currentCursor = current.value.cursor;
  const incomingCursor = incoming.value.cursor;

  if (incomingCursor && currentCursor && isCursorNewer(incomingCursor, currentCursor)) {
    return incoming;
  }

  if (incomingCursor && currentCursor && isCursorNewer(currentCursor, incomingCursor)) {
    return current;
  }

  if (incoming.value.content.length !== current.value.content.length) {
    return incoming.value.content.length > current.value.content.length ? incoming : current;
  }

  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

function isCursorNewer(left: string, right: string): boolean {
  const leftCursor = Number(left);
  const rightCursor = Number(right);

  if (!Number.isInteger(leftCursor) || !Number.isInteger(rightCursor)) {
    return false;
  }

  return leftCursor > rightCursor;
}
