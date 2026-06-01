import { matchPath } from "react-router-dom";

import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type {
  AffairsViewState,
  WorkbenchMode,
  WorkbenchModeSnapshot
} from "../types/workbench-mode";

const WORKBENCH_MODE_KEY_PREFIX = "workbench.mode.workspace.";
const WORKBENCH_CODE_PATH_KEY_PREFIX = "workbench.mode.code.last-path.";
const WORKBENCH_AFFAIRS_PATH_KEY_PREFIX = "workbench.mode.affairs.last-path.";
const WORKBENCH_AFFAIRS_STATE_KEY_PREFIX = "workbench.affairs.state.";
const WORKBENCH_MODE_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const DEFAULT_AFFAIRS_STATE: Omit<AffairsViewState, "workspaceId"> = {
  primarySection: "library",
  selectedNodeId: "library",
  selectedObjectId: null,
  toolbarExpanded: false,
  detailViewerCollapsed: false,
  auxiliaryTab: "detail",
  browseMode: "folder",
  viewMode: "grid",
  selectedFolderPath: null,
  selectedTagPath: null,
  selectedTagPaths: [],
  selectedDocumentId: null,
  selectedFavoriteId: null
};

function buildModeSnapshotKey(workspaceId: string) {
  return `${WORKBENCH_MODE_KEY_PREFIX}${workspaceId}`;
}

function buildModePathKey(workspaceId: string, mode: WorkbenchMode) {
  return `${mode === "code" ? WORKBENCH_CODE_PATH_KEY_PREFIX : WORKBENCH_AFFAIRS_PATH_KEY_PREFIX}${workspaceId}`;
}

function buildAffairsStateKey(workspaceId: string) {
  return `${WORKBENCH_AFFAIRS_STATE_KEY_PREFIX}${workspaceId}`;
}

export function resolveWorkbenchModeFromPath(pathname: string): WorkbenchMode | null {
  if (matchPath("/workspaces/:workspaceId/affairs", pathname)) {
    return "affairs";
  }

  if (
    matchPath("/workspaces/:workspaceId/sessions", pathname)
    || matchPath("/workspaces/:workspaceId/sessions/:sessionId", pathname)
    || matchPath("/workspaces/:workspaceId/tools", pathname)
    || matchPath("/workspaces/:workspaceId/tools/files", pathname)
    || matchPath("/workspaces/:workspaceId/tools/git", pathname)
    || matchPath("/workspaces/:workspaceId/tools/processes", pathname)
    || matchPath("/workspaces/:workspaceId/terminals", pathname)
    || matchPath("/workspaces/:workspaceId/butler", pathname)
    || matchPath("/workspaces/:workspaceId/plugins", pathname)
    || matchPath("/workspaces/:workspaceId/plugins/:pluginId", pathname)
    || matchPath("/workspaces/:workspaceId/plugins/:pluginId/run", pathname)
  ) {
    return "code";
  }

  return null;
}

export function readWorkspaceWorkbenchMode(workspaceId: string | null | undefined): WorkbenchMode | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  return readViewSnapshot<WorkbenchModeSnapshot>(
    buildModeSnapshotKey(normalizedWorkspaceId),
    WORKBENCH_MODE_CACHE_MAX_AGE_MS
  )?.mode ?? null;
}

export function writeWorkspaceWorkbenchMode(
  workspaceId: string,
  mode: WorkbenchMode,
  updatedAt = new Date().toISOString()
): void {
  writeViewSnapshot<WorkbenchModeSnapshot>(buildModeSnapshotKey(workspaceId), {
    workspaceId,
    mode,
    updatedAt
  });
}

export function readWorkbenchModeLastPath(
  workspaceId: string | null | undefined,
  mode: WorkbenchMode
): string | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  return readViewSnapshot<string>(
    buildModePathKey(normalizedWorkspaceId, mode),
    WORKBENCH_MODE_CACHE_MAX_AGE_MS
  ) ?? null;
}

export function writeWorkbenchModeLastPath(
  workspaceId: string,
  mode: WorkbenchMode,
  path: string
): void {
  writeViewSnapshot<string>(buildModePathKey(workspaceId, mode), path);
}

export function readAffairsViewState(workspaceId: string | null | undefined): AffairsViewState | null {
  const normalizedWorkspaceId = workspaceId?.trim();

  if (!normalizedWorkspaceId) {
    return null;
  }

  const snapshot = readViewSnapshot<Partial<AffairsViewState>>(
    buildAffairsStateKey(normalizedWorkspaceId),
    WORKBENCH_MODE_CACHE_MAX_AGE_MS
  );

  if (!snapshot) {
    return null;
  }

  return {
    workspaceId: normalizedWorkspaceId,
    primarySection: snapshot.primarySection ?? DEFAULT_AFFAIRS_STATE.primarySection,
    selectedNodeId: snapshot.selectedNodeId ?? DEFAULT_AFFAIRS_STATE.selectedNodeId,
    selectedObjectId: snapshot.selectedObjectId ?? DEFAULT_AFFAIRS_STATE.selectedObjectId,
    toolbarExpanded: snapshot.toolbarExpanded ?? DEFAULT_AFFAIRS_STATE.toolbarExpanded,
    detailViewerCollapsed: snapshot.detailViewerCollapsed ?? DEFAULT_AFFAIRS_STATE.detailViewerCollapsed,
    auxiliaryTab: snapshot.auxiliaryTab ?? DEFAULT_AFFAIRS_STATE.auxiliaryTab,
    browseMode: snapshot.browseMode ?? DEFAULT_AFFAIRS_STATE.browseMode,
    viewMode: snapshot.viewMode ?? DEFAULT_AFFAIRS_STATE.viewMode,
    selectedFolderPath: snapshot.selectedFolderPath ?? DEFAULT_AFFAIRS_STATE.selectedFolderPath,
    selectedTagPath: snapshot.selectedTagPath ?? DEFAULT_AFFAIRS_STATE.selectedTagPath,
    selectedTagPaths: Array.isArray(snapshot.selectedTagPaths)
      ? snapshot.selectedTagPaths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : (snapshot.selectedTagPath?.trim() ? [snapshot.selectedTagPath.trim()] : DEFAULT_AFFAIRS_STATE.selectedTagPaths),
    selectedDocumentId: snapshot.selectedDocumentId ?? DEFAULT_AFFAIRS_STATE.selectedDocumentId,
    selectedFavoriteId: snapshot.selectedFavoriteId ?? DEFAULT_AFFAIRS_STATE.selectedFavoriteId
  };
}

export function writeAffairsViewState(state: AffairsViewState): void {
  writeViewSnapshot<AffairsViewState>(buildAffairsStateKey(state.workspaceId), state);
}

export function createDefaultAffairsViewState(workspaceId: string): AffairsViewState {
  return {
    workspaceId,
    primarySection: DEFAULT_AFFAIRS_STATE.primarySection,
    selectedNodeId: DEFAULT_AFFAIRS_STATE.selectedNodeId,
    selectedObjectId: DEFAULT_AFFAIRS_STATE.selectedObjectId,
    toolbarExpanded: DEFAULT_AFFAIRS_STATE.toolbarExpanded,
    detailViewerCollapsed: DEFAULT_AFFAIRS_STATE.detailViewerCollapsed,
    auxiliaryTab: DEFAULT_AFFAIRS_STATE.auxiliaryTab,
    browseMode: DEFAULT_AFFAIRS_STATE.browseMode,
    viewMode: DEFAULT_AFFAIRS_STATE.viewMode,
    selectedFolderPath: DEFAULT_AFFAIRS_STATE.selectedFolderPath,
    selectedTagPath: DEFAULT_AFFAIRS_STATE.selectedTagPath,
    selectedTagPaths: DEFAULT_AFFAIRS_STATE.selectedTagPaths,
    selectedDocumentId: DEFAULT_AFFAIRS_STATE.selectedDocumentId,
    selectedFavoriteId: DEFAULT_AFFAIRS_STATE.selectedFavoriteId
  };
}
