import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type {
  AffairsLibrarySortState,
  AffairsViewState
} from "../types/workbench-mode";

const WORKBENCH_AFFAIRS_STATE_KEY_PREFIX = "workbench.affairs.state.";
const WORKBENCH_MODE_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const DEFAULT_AFFAIRS_LIBRARY_SORT: AffairsLibrarySortState = {
  mode: "recent",
  direction: "desc"
};

const DEFAULT_AFFAIRS_STATE: Omit<AffairsViewState, "workspaceId"> = {
  primarySection: "library",
  selectedNodeId: "library",
  selectedObjectId: null,
  toolbarExpanded: false,
  detailViewerCollapsed: false,
  auxiliaryTab: "detail",
  browseMode: "folder",
  viewMode: "grid",
  librarySort: DEFAULT_AFFAIRS_LIBRARY_SORT,
  selectedFolderPath: null,
  selectedFolderEntryPath: null,
  selectedTagPath: null,
  selectedTagPaths: [],
  selectedDocumentId: null,
  selectedFavoriteId: null,
  pendingLibraryPreview: null
};


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

function normalizeAffairsLibrarySortState(
  sortState: Partial<AffairsLibrarySortState> | null | undefined
): AffairsLibrarySortState {
  const mode = sortState?.mode;
  const direction = sortState?.direction;

  return {
    mode: mode === "recent" || mode === "name" || mode === "type" || mode === "size" || mode === "createdAt"
      ? mode
      : DEFAULT_AFFAIRS_LIBRARY_SORT.mode,
    direction: direction === "asc" || direction === "desc"
      ? direction
      : DEFAULT_AFFAIRS_LIBRARY_SORT.direction
  };
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
    librarySort: normalizeAffairsLibrarySortState(snapshot.librarySort),
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
    librarySort: DEFAULT_AFFAIRS_STATE.librarySort,
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
