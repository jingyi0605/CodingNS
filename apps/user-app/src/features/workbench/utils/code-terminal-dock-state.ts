import {
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";

export type CodeTerminalDockOrientation = "vertical" | "horizontal";

export interface CodeTerminalDockState {
  workspaceId: string;
  open: boolean;
  lastManualClosed: boolean;
  orientation: CodeTerminalDockOrientation;
  verticalRatio: number;
  horizontalRatio: number;
  updatedAt: string;
}

const CODE_TERMINAL_DOCK_KEY_PREFIX = "workbench.code.terminal-dock.";
const CODE_TERMINAL_DOCK_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_VERTICAL_RATIO = 0.36;
const DEFAULT_HORIZONTAL_RATIO = 0.42;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

function buildCodeTerminalDockKey(workspaceId: string) {
  return `${CODE_TERMINAL_DOCK_KEY_PREFIX}${workspaceId}`;
}

function clampRatio(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export function createDefaultCodeTerminalDockState(
  workspaceId: string,
  updatedAt = new Date().toISOString()
): CodeTerminalDockState {
  return {
    workspaceId,
    open: false,
    lastManualClosed: false,
    orientation: "vertical",
    verticalRatio: DEFAULT_VERTICAL_RATIO,
    horizontalRatio: DEFAULT_HORIZONTAL_RATIO,
    updatedAt
  };
}

export function normalizeCodeTerminalDockState(
  workspaceId: string,
  snapshot: unknown
): CodeTerminalDockState {
  const fallback = createDefaultCodeTerminalDockState(workspaceId);

  if (!snapshot || typeof snapshot !== "object") {
    return fallback;
  }

  const record = snapshot as Partial<CodeTerminalDockState>;

  return {
    workspaceId,
    open: record.open === true,
    lastManualClosed: record.lastManualClosed === true,
    orientation: record.orientation === "horizontal" ? "horizontal" : "vertical",
    verticalRatio: clampRatio(record.verticalRatio, fallback.verticalRatio),
    horizontalRatio: clampRatio(record.horizontalRatio, fallback.horizontalRatio),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt
      : fallback.updatedAt
  };
}

export function readCodeTerminalDockState(
  workspaceId: string | null | undefined
): CodeTerminalDockState | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  const snapshot = readViewSnapshot<unknown>(
    buildCodeTerminalDockKey(normalizedWorkspaceId),
    CODE_TERMINAL_DOCK_CACHE_MAX_AGE_MS
  );

  if (!snapshot) {
    return null;
  }

  return normalizeCodeTerminalDockState(normalizedWorkspaceId, snapshot);
}

export function writeCodeTerminalDockState(state: CodeTerminalDockState): void {
  writeViewSnapshot<CodeTerminalDockState>(
    buildCodeTerminalDockKey(state.workspaceId),
    normalizeCodeTerminalDockState(state.workspaceId, state)
  );
}
