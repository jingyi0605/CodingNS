const STORAGE_KEY = "codingns.user-app.terminal-page";
const STORAGE_SCHEMA_VERSION = 3;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MAX_TERMINAL_COLS = 400;
const MAX_TERMINAL_ROWS = 200;
const MAX_TERMINAL_VIEWPORT_Y = 200_000;
const MAX_TERMINAL_SNAPSHOT_CHARS = 120_000;
const MAX_PERSISTED_TERMINAL_PAGE_CHARS = 750_000;
const MAX_PERSISTED_WORKSPACE_RECORD_COUNT = 256;
const MAX_PERSISTED_TERMINAL_CURSOR_COUNT = 512;
const MAX_PERSISTED_TERMINAL_VIEW_STATE_COUNT = 12;
const MIN_TERMINAL_ZOOM_SCALE = 0.7;
const MAX_TERMINAL_ZOOM_SCALE = 2;

type PersistTerminalPageStateResult = "success" | "quota_exceeded" | "failed";

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
  pinnedTerminalIdsByWorkspace: Record<string, PersistedValueEnvelope<string[]>>;
  cursorByTerminalId: Record<string, PersistedValueEnvelope<string>>;
  viewStateByTerminalId: Record<string, PersistedValueEnvelope<PersistedTerminalViewState>>;
  zoomScale: PersistedValueEnvelope<number> | null;
}

export interface PersistedTerminalViewState {
  content: string;
  cursor: string | null;
  cols: number;
  rows: number;
  viewportY: number;
  historyBeforeSeq: number | null;
  historyHasOlder: boolean;
}

export interface TerminalRecoveryState {
  resumeCursor: string | null;
  viewState: PersistedTerminalViewState | null;
}

const EMPTY_STATE: PersistedTerminalPageState = {
  selectedWorkspaceId: null,
  activeTerminalIdByWorkspace: {},
  pinnedTerminalIdsByWorkspace: {},
  cursorByTerminalId: {},
  viewStateByTerminalId: {},
  zoomScale: null
};

export function readPersistedTerminalPageState(): {
  selectedWorkspaceId: string | null;
  activeTerminalIdByWorkspace: Record<string, string>;
  pinnedTerminalIdsByWorkspace: Record<string, string[]>;
  cursorByTerminalId: Record<string, string>;
  viewStateByTerminalId: Record<string, PersistedTerminalViewState>;
  zoomScale: number | null;
} {
  const state = readRawPersistedTerminalPageState();

  return {
    selectedWorkspaceId: state.selectedWorkspaceId?.value ?? null,
    activeTerminalIdByWorkspace: unwrapValueRecord(state.activeTerminalIdByWorkspace),
    pinnedTerminalIdsByWorkspace: unwrapValueRecord(state.pinnedTerminalIdsByWorkspace),
    cursorByTerminalId: unwrapValueRecord(state.cursorByTerminalId),
    viewStateByTerminalId: unwrapValueRecord(state.viewStateByTerminalId),
    zoomScale: state.zoomScale?.value ?? null
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

export function readPinnedTerminalIds(workspaceId: string): string[] {
  return readRawPersistedTerminalPageState().pinnedTerminalIdsByWorkspace[workspaceId]?.value ?? [];
}

export function persistPinnedTerminalIds(workspaceId: string, terminalIds: string[]): void {
  updatePersistedTerminalPageState((current, updatedAt) => {
    const nextState: PersistedTerminalPageState = {
      ...current,
      pinnedTerminalIdsByWorkspace: {
        ...current.pinnedTerminalIdsByWorkspace
      }
    };
    const normalizedIds = uniqStrings(terminalIds);

    if (normalizedIds.length === 0) {
      delete nextState.pinnedTerminalIdsByWorkspace[workspaceId];
      return nextState;
    }

    nextState.pinnedTerminalIdsByWorkspace[workspaceId] = {
      value: normalizedIds,
      updatedAt
    };

    return nextState;
  });
}

export function readPersistedTerminalZoomScale(): number | null {
  return readRawPersistedTerminalPageState().zoomScale?.value ?? null;
}

export function persistTerminalZoomScale(zoomScale: number): void {
  updatePersistedTerminalPageState((current, updatedAt) => ({
    ...current,
    zoomScale: {
      value: clampZoomScale(zoomScale),
      updatedAt
    }
  }));
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
  const compactedState = compactPersistedTerminalPageState(nextState);
  const initialResult = tryPersistTerminalPageState(compactedState);

  if (initialResult !== "quota_exceeded") {
    return;
  }

  // localStorage 与应用内其他配置共用配额。超限时逐个淘汰最旧快照，
  // 游标仍然保留，页面可以从 Host 继续补回终端输出。
  const fallbackState: PersistedTerminalPageState = {
    ...compactedState,
    viewStateByTerminalId: {
      ...compactedState.viewStateByTerminalId
    }
  };

  for (const terminalId of listEnvelopeKeysByOldest(fallbackState.viewStateByTerminalId)) {
    delete fallbackState.viewStateByTerminalId[terminalId];

    const fallbackResult = tryPersistTerminalPageState(fallbackState);

    if (fallbackResult !== "quota_exceeded") {
      return;
    }
  }
}

function compactPersistedTerminalPageState(
  state: PersistedTerminalPageState
): PersistedTerminalPageState {
  const compactedState: PersistedTerminalPageState = {
    ...state,
    activeTerminalIdByWorkspace: keepNewestEnvelopes(
      state.activeTerminalIdByWorkspace,
      MAX_PERSISTED_WORKSPACE_RECORD_COUNT
    ),
    pinnedTerminalIdsByWorkspace: keepNewestEnvelopes(
      state.pinnedTerminalIdsByWorkspace,
      MAX_PERSISTED_WORKSPACE_RECORD_COUNT
    ),
    cursorByTerminalId: keepNewestEnvelopes(
      state.cursorByTerminalId,
      MAX_PERSISTED_TERMINAL_CURSOR_COUNT
    ),
    viewStateByTerminalId: keepNewestEnvelopes(
      state.viewStateByTerminalId,
      MAX_PERSISTED_TERMINAL_VIEW_STATE_COUNT
    )
  };

  for (const terminalId of listEnvelopeKeysByOldest(compactedState.viewStateByTerminalId)) {
    if (serializePersistedTerminalPageState(compactedState).length <= MAX_PERSISTED_TERMINAL_PAGE_CHARS) {
      break;
    }

    delete compactedState.viewStateByTerminalId[terminalId];
  }

  return compactedState;
}

function keepNewestEnvelopes<T>(
  record: Record<string, PersistedValueEnvelope<T>>,
  maxCount: number
): Record<string, PersistedValueEnvelope<T>> {
  const entries = Object.entries(record);

  if (entries.length <= maxCount) {
    return { ...record };
  }

  return Object.fromEntries(
    entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (left, right) =>
          right.entry[1].updatedAt - left.entry[1].updatedAt || right.index - left.index
      )
      .slice(0, maxCount)
      .map(({ entry }) => entry)
  );
}

function listEnvelopeKeysByOldest<T>(
  record: Record<string, PersistedValueEnvelope<T>>
): string[] {
  return Object.entries(record)
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        left.entry[1].updatedAt - right.entry[1].updatedAt || left.index - right.index
    )
    .map(({ entry: [key] }) => key);
}

function serializePersistedTerminalPageState(state: PersistedTerminalPageState): string {
  return JSON.stringify({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    state
  } satisfies PersistedTerminalPageStateEnvelope);
}

function tryPersistTerminalPageState(
  state: PersistedTerminalPageState
): PersistTerminalPageStateResult {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializePersistedTerminalPageState(state));
    return "success";
  } catch (error) {
    return isQuotaExceededError(error) ? "quota_exceeded" : "failed";
  }
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
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
      pinnedTerminalIdsByWorkspace: normalizeValueRecord(
        rawState.pinnedTerminalIdsByWorkspace,
        normalizeStringArray
      ),
      cursorByTerminalId: normalizeValueRecord(rawState.cursorByTerminalId, normalizeString),
      viewStateByTerminalId: normalizeValueRecord(rawState.viewStateByTerminalId, normalizeViewState),
      zoomScale: normalizeNullableValueEnvelopeNumber(rawState.zoomScale)
    };
  } catch {
    return EMPTY_STATE;
  }
}

function normalizeNullableValueEnvelopeNumber(
  input: unknown
): PersistedValueEnvelope<number> | null {
  if (input === null) {
    return null;
  }

  const envelope = normalizeValueEnvelope(input, normalizeZoomScale);
  return envelope ?? null;
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

function normalizeStringArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const normalized = uniqStrings(input.filter((item): item is string => typeof item === "string"));
  return normalized;
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
    !Number.isInteger(candidate.viewportY) ||
    (candidate.historyBeforeSeq !== null &&
      candidate.historyBeforeSeq !== undefined &&
      !Number.isInteger(candidate.historyBeforeSeq)) ||
    (candidate.historyHasOlder !== undefined && typeof candidate.historyHasOlder !== "boolean")
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
    viewportY,
    historyBeforeSeq:
      typeof candidate.historyBeforeSeq === "number" ? candidate.historyBeforeSeq : null,
    historyHasOlder: typeof candidate.historyHasOlder === "boolean" ? candidate.historyHasOlder : true
  };
}

function normalizeZoomScale(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return null;
  }

  return clampZoomScale(input);
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

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clampZoomScale(value: number): number {
  return Math.min(MAX_TERMINAL_ZOOM_SCALE, Math.max(MIN_TERMINAL_ZOOM_SCALE, value));
}
