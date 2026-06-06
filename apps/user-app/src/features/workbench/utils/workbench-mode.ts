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
  selectedFolderEntryPath: null,
  selectedTagPath: null,
  selectedTagPaths: [],
  selectedDocumentId: null,
  selectedFavoriteId: null,
  pendingLibraryPreview: null
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

function normalizeLegacyAffairsPrimarySection(
  section: AffairsViewState["primarySection"] | "todo" | "automation" | null | undefined
): AffairsViewState["primarySection"] {
  if (section === "conversation" || section === "library" || section === "workbench") {
    return section;
  }

  if (section === "todo" || section === "automation") {
    return "workbench";
  }

  return DEFAULT_AFFAIRS_STATE.primarySection;
}

function normalizeLegacyAffairsSelectedNodeId(
  section: AffairsViewState["primarySection"],
  nodeId: string | null | undefined
): string {
  const normalizedNodeId = nodeId?.trim() ?? "";

  if (section === "library") {
    return normalizedNodeId || DEFAULT_AFFAIRS_STATE.selectedNodeId || "library";
  }

  if (section === "conversation") {
    return normalizedNodeId || "conversation:home";
  }

  if (normalizedNodeId === "todo:all") {
    return "workbench:todo:all";
  }

  if (normalizedNodeId === "todo:inbox") {
    return "workbench:todo:inbox";
  }

  if (normalizedNodeId === "todo:follow_up") {
    return "workbench:todo:follow_up";
  }

  if (normalizedNodeId === "automation:all") {
    return "workbench:overview";
  }

  if (normalizedNodeId.startsWith("automation:item:")) {
    return `workbench:${normalizedNodeId}`;
  }

  if (!normalizedNodeId) {
    return "workbench:overview";
  }

  return normalizedNodeId;
}

export function resolveWorkbenchModeFromPath(pathname: string): WorkbenchMode | null {
  if (matchPath("/affairs", pathname) || matchPath("/workspaces/:workspaceId/affairs", pathname)) {
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

  const primarySection = normalizeLegacyAffairsPrimarySection(snapshot.primarySection as AffairsViewState["primarySection"] | "todo" | "automation" | null | undefined);

  return {
    workspaceId: normalizedWorkspaceId,
    primarySection,
    selectedNodeId: normalizeLegacyAffairsSelectedNodeId(primarySection, snapshot.selectedNodeId),
    selectedObjectId: snapshot.selectedObjectId ?? DEFAULT_AFFAIRS_STATE.selectedObjectId,
    toolbarExpanded: snapshot.toolbarExpanded ?? DEFAULT_AFFAIRS_STATE.toolbarExpanded,
    detailViewerCollapsed: snapshot.detailViewerCollapsed ?? DEFAULT_AFFAIRS_STATE.detailViewerCollapsed,
    auxiliaryTab: snapshot.auxiliaryTab ?? DEFAULT_AFFAIRS_STATE.auxiliaryTab,
    browseMode: snapshot.browseMode ?? DEFAULT_AFFAIRS_STATE.browseMode,
    viewMode: snapshot.viewMode ?? DEFAULT_AFFAIRS_STATE.viewMode,
    selectedFolderPath: snapshot.selectedFolderPath ?? DEFAULT_AFFAIRS_STATE.selectedFolderPath,
    selectedFolderEntryPath: snapshot.selectedFolderEntryPath ?? DEFAULT_AFFAIRS_STATE.selectedFolderEntryPath,
    selectedTagPath: snapshot.selectedTagPath ?? DEFAULT_AFFAIRS_STATE.selectedTagPath,
    selectedTagPaths: Array.isArray(snapshot.selectedTagPaths)
      ? snapshot.selectedTagPaths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : (snapshot.selectedTagPath?.trim() ? [snapshot.selectedTagPath.trim()] : DEFAULT_AFFAIRS_STATE.selectedTagPaths),
    selectedDocumentId: snapshot.selectedDocumentId ?? DEFAULT_AFFAIRS_STATE.selectedDocumentId,
    selectedFavoriteId: snapshot.selectedFavoriteId ?? DEFAULT_AFFAIRS_STATE.selectedFavoriteId,
    pendingLibraryPreview: snapshot.pendingLibraryPreview && typeof snapshot.pendingLibraryPreview === "object"
      ? {
          requestId: typeof snapshot.pendingLibraryPreview.requestId === "string" ? snapshot.pendingLibraryPreview.requestId : "",
          filePath: typeof snapshot.pendingLibraryPreview.filePath === "string" ? snapshot.pendingLibraryPreview.filePath : "",
          title: typeof snapshot.pendingLibraryPreview.title === "string" ? snapshot.pendingLibraryPreview.title : ""
        }
      : DEFAULT_AFFAIRS_STATE.pendingLibraryPreview
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
    selectedFolderEntryPath: DEFAULT_AFFAIRS_STATE.selectedFolderEntryPath,
    selectedTagPath: DEFAULT_AFFAIRS_STATE.selectedTagPath,
    selectedTagPaths: DEFAULT_AFFAIRS_STATE.selectedTagPaths,
    selectedDocumentId: DEFAULT_AFFAIRS_STATE.selectedDocumentId,
    selectedFavoriteId: DEFAULT_AFFAIRS_STATE.selectedFavoriteId,
    pendingLibraryPreview: DEFAULT_AFFAIRS_STATE.pendingLibraryPreview
  };
}

export function createDefaultAffairsLibraryLandingState(
  workspaceId: string,
  current?: Partial<AffairsViewState> | null
): AffairsViewState {
  const baseState = {
    ...createDefaultAffairsViewState(workspaceId),
    ...(current ?? {}),
    workspaceId
  };

  return {
    ...baseState,
    primarySection: "library",
    selectedNodeId: "library",
    selectedObjectId: null,
    browseMode: "folder",
    selectedFolderPath: null,
    selectedFolderEntryPath: null,
    selectedTagPath: null,
    selectedTagPaths: [],
    selectedDocumentId: null,
    selectedFavoriteId: null,
    pendingLibraryPreview: null
  };
}
