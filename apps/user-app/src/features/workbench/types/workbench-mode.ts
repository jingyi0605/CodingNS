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
  auxiliaryTab: AffairsAuxiliaryTab;
}

export interface AffairsObjectContext {
  objectType: string;
  objectId: string;
  title: string | null;
  summary: string | null;
  sourceRef: string | null;
  assistantScope: string | null;
}
