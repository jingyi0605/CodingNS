export type AffairsPrimarySection = "library" | "conversation" | "workbench";

export type AffairsAuxiliaryTab = "detail" | "assistant";

export type AffairsLibrarySortMode = "recent" | "name" | "type" | "size" | "createdAt";

export type AffairsLibrarySortDirection = "asc" | "desc";

export interface AffairsLibrarySortState {
  mode: AffairsLibrarySortMode;
  direction: AffairsLibrarySortDirection;
}

export type DashboardWidgetType =
  | "todo"
  | "automation"
  | "html"
  | "teable";

export type DashboardHtmlWidgetVariant = "app" | "stat" | "embed";

export type DashboardWidgetSourceKind = "plugin_runtime" | "html_shortcut" | "affairs_library_html";

export type ShortcutAppSourceKind = "workspace" | "affairs_library";

export interface DashboardWidgetSourceRef {
  kind: DashboardWidgetSourceKind;
  workspaceId?: string;
  sourceId: string;
  entryId?: string;
}

export interface DashboardWidgetState {
  id: string;
  type: DashboardWidgetType;
  variant?: DashboardHtmlWidgetVariant;
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

export interface ShortcutAppState {
  id: string;
  title: string;
  sourceKind: ShortcutAppSourceKind;
  workspaceId: string;
  sourceId: string;
  entryPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AffairsWorkbenchDashboardState {
  workspaceId: string;
  version: number;
  layoutLocked: boolean;
  activeTabId: string;
  tabs: DashboardTabState[];
  shortcutApps: ShortcutAppState[];
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
  librarySort: AffairsLibrarySortState;
  selectedFolderPath: string | null;
  selectedFolderEntryPath: string | null;
  selectedTagPath: string | null;
  selectedTagPaths: string[];
  selectedDocumentId: string | null;
  selectedFavoriteId: string | null;
  pendingLibraryPreview?: {
    requestId: string;
    filePath: string;
    title: string;
  } | null;
}

export interface AffairsObjectContext {
  objectType: string;
  objectId: string;
  title: string | null;
  summary: string | null;
  sourceRef: string | null;
  assistantScope: string | null;
}
