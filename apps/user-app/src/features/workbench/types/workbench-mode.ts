export type WorkbenchMode = "code" | "affairs";

export type AffairsPrimarySection = "library" | "conversation" | "workbench";

export type AffairsAuxiliaryTab = "detail" | "assistant";

export type DashboardWidgetType =
  | "todo"
  | "automation"
  | "html_app"
  | "html_stat"
  | "html_embed";

export type DashboardWidgetSourceKind = "plugin_runtime" | "html_shortcut";

export interface DashboardWidgetSourceRef {
  kind: DashboardWidgetSourceKind;
  sourceId: string;
  entryId?: string;
}

export interface DashboardWidgetState {
  id: string;
  type: DashboardWidgetType;
  title: string;
  sourceRef?: DashboardWidgetSourceRef;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWidgetLayout {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardTabState {
  id: string;
  title: string;
  widgets: DashboardWidgetState[];
  layout: DashboardWidgetLayout[];
  createdAt: string;
  updatedAt: string;
}

export interface AffairsWorkbenchDashboardState {
  workspaceId: string;
  version: number;
  activeTabId: string;
  tabs: DashboardTabState[];
  updatedAt: string;
}

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
  selectedFolderEntryPath: string | null;
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
