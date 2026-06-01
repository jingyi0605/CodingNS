export type WorkbenchMode = "code" | "affairs";

export type AffairsPrimarySection = "library" | "todo" | "automation";

export type AffairsAuxiliaryTab = "detail" | "assistant";

export interface WorkbenchModeSnapshot {
  mode: WorkbenchMode;
  workspaceId: string;
  updatedAt: string;
}

export interface AffairsViewState {
  workspaceId: string;
  primarySection: AffairsPrimarySection;
  selectedNodeId: string | null;
  selectedObjectId: string | null;
  toolbarExpanded: boolean;
  detailViewerCollapsed: boolean;
  auxiliaryTab: AffairsAuxiliaryTab;
  browseMode: "folder" | "tag";
  viewMode: "grid" | "list";
  selectedFolderPath: string | null;
  selectedTagPath: string | null;
  selectedTagPaths: string[];
  selectedDocumentId: string | null;
  selectedFavoriteId: string | null;
}

export interface AffairsObjectContext {
  objectType: string;
  objectId: string;
  title: string | null;
  summary: string | null;
  sourceRef: string | null;
  assistantScope: string | null;
}
