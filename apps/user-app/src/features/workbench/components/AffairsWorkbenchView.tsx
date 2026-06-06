import {
  Component,
  useCallback,
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  type Location,
  type Navigator
} from "react-router-dom";

import { DesktopModal } from "../../../components/DesktopModal";
import { ModalActions, ModalEmptyState, ModalField, ModalList, ModalListItem, ModalSection, ModalTag } from "../../../components/ModalAtoms";
import { MobileSheet } from "../../../components/MobileSheet";
import { getHostBaseUrl, getHostRequestUrl } from "../../../config/env";
import { resolveHostTransportTarget } from "../../../network/host-transport-registry";
import { t } from "../../../shared/i18n";
import { SettingsSwitch } from "../../../settings/SettingsSwitch";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import {
  createDefaultAffairsDashboardState,
  createAffairsDashboardWidgetState,
  createAffairsShortcutAppState,
  createEmptyAffairsDashboardTabState,
  isWorkspaceHtmlEntryPath,
  normalizeAffairsDashboardState,
  readAffairsDashboardState,
  writeAffairsDashboardState
} from "../utils/affairs-dashboard-state";
import { buildAffairsPath } from "../utils/workbench-navigation";
import type {
  AssistantAutomationRunDto,
  AssistantAutomationTaskDto,
  ButlerControlSessionDto,
  ButlerManagedSessionDto,
  ButlerProfilePayload,
  ButlerFollowUpTaskDto,
  ButlerInboxItemDto
} from "../../butler/api/butler-api";
import {
  listAssistantAutomations,
  listButlerControlSessions,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listRecentAssistantAutomationRuns,
  resumeButlerProjectSession
} from "../../butler/api/butler-api";
import { ButlerAnchoredPopover } from "../../butler/components/ButlerAnchoredPopover";
import {
  ButlerInitForm,
  type ButlerInitFormState,
  type ButlerReportPriorityPresetId,
  DEFAULT_BUTLER_INIT_FORM_STATE
} from "../../butler/components/ButlerInitForm";
import { ButlerRuntimeStore, useButlerRuntimeStore } from "../../butler/runtime/butler-runtime-store";
import type {
  AffairsDocumentTagDetailsDto,
  AffairsFolderTagDetailsDto,
  HistoryMessageDto,
  AffairsLibraryBindingDto,
  AffairsLibraryConfigDto,
  AffairsLibraryDocumentListDto,
  AffairsLibraryDocumentRecordDto,
  AffairsLibraryFavoriteRecordDto,
  AffairsLibraryFolderNodeDto,
  AffairsLibraryIndexStatusDto,
  AffairsLibrarySnapshotDto,
  AffairsTaskSnapshotDto,
  AffairsLibraryTagNodeDto,
  AffairsTagRecoveryStatusDto,
  AffairsTagDetailWithRulesDto,
  AffairsTagNodeDto,
  AffairsTagRuleDto,
  ProviderCapabilitiesDto,
  ProviderId,
  SessionSummaryDto,
  WorkspaceDto,
} from "../../conversation/api/conversation-api";
import {
  deleteAffairsLightweightSession,
  deleteSession,
  createAffairsTag,
  createWorkspaceDirectory,
  deleteAffairsTag,
  getAffairsLightweightSessionMessages,
  getAffairsLightweightSession,
  getAffairsAssistantSessionsSnapshot,
  getAffairsDocumentTagDetails,
  getAffairsDocumentTagTask,
  getGlobalAffairsDashboardState,
  getAffairsTagRecoveryStatus,
  getAffairsFolderTagTask,
  getAffairsFolderTagDetails,
  getAffairsTagDetail,
  getGlobalAffairsLibraryBinding,
  listAffairsTags,
  listAffairsLightweightSessions,
  markAffairsLightweightSessionSeen,
  getAffairsLibraryConfig,
  getAffairsLibraryPreview,
  getAffairsLibraryPreviewWithOptions,
  getAffairsLibrarySnapshot,
  downloadAffairsLibraryFile,
  listAffairsLibraryFiles,
  listAffairsLibraryDocuments,
  operateAffairsLibraryFile,
  requestAffairsLibraryRefresh,
  requestAffairsTagRecoveryRecompute,
  renameAffairsLightweightSessionTitle,
  renameSessionTitle,
  saveAffairsDocumentTags,
  saveAffairsDocumentTagsWithCreate,
  saveAffairsFolderTags,
  saveAffairsFolderTagsWithCreate,
  saveGlobalAffairsLibraryBinding,
  saveAffairsLibraryConfig,
  sendAffairsLightweightSessionMessage,
  sendAffairsLightweightSessionMessageStream,
  markSessionSeen,
  setGlobalAffairsLibraryEnabled,
  startAffairsLightweightSession,
  startAffairsLightweightSessionStream,
  updateAffairsLightweightSessionArchiveState,
  updateAffairsLightweightSessionFavoriteState,
  updateSessionArchiveState,
  updateSessionFavoriteState,
  updateAffairsTag,
  updateGlobalAffairsDashboardState,
  updateGlobalAffairsLibraryFavorites
} from "../../conversation/api/conversation-api";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { FileViewerPanel } from "../../conversation/components/FileViewerModal";
import { ConversationTranscriptExport, MessageTimeline } from "../../conversation/components/MessageTimeline";
import { PermissionRequestList } from "../../conversation/components/PermissionRequestList";
import { SessionProviderPicker } from "../../conversation/components/SessionProviderPicker";
import { SessionHeader } from "../../conversation/components/SessionHeader";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import { WorkspaceImportBrowserModal } from "../../conversation/components/WorkspaceImportBrowserModal";
import { resolveSessionActivityBadgeClassName, resolveSessionActivityBadgeLabel, resolveSessionIndicatorClassName } from "../../conversation/session-activity-display";
import {
  buildSessionExportFileName,
  buildSessionMarkdownExport,
  buildSessionPdfExport,
  buildStandaloneSessionExportHtml,
  downloadBinaryFile,
  downloadTextFile,
  loadSessionExportSnapshot
} from "../../conversation/session-export";
import {
  getDraftTitle,
  getProviderDisplayName,
  isDraftProviderSupported
} from "../../conversation/capability/provider-ui";
import { getPathLeafName } from "../../conversation/components/file-entry-visibility";
import {
  getFilePreview,
  getFilePreviewLink,
  getFileTree,
  type FileNodeDto
} from "../../conversation/api/file-context-api";
import {
  resolveFileTreeIconKind,
  resolveFileTreeIconLabel
} from "../../conversation/components/file-tree-icon";
import { buildConversationTimelineSourceItems } from "../../conversation/timeline-source-items";
import {
  createPendingMessage,
  markPendingAsFailed,
  type SessionMessageViewModel
} from "../../conversation/runtime/session-runtime-machine";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import {
  showDesktopContextMenu,
  type DesktopContextMenuItem
} from "../../../platform/desktop/desktop-context-menu";
import { usePlatform } from "../../../platform/platform-provider";
import { listWorkspaceBridgeDir } from "../../../platform/preview/codingns-workspace-bridge";
import { createHtmlPreviewWorkspaceBridge } from "../../../platform/preview/html-preview-workspace-bridge";
import { resolveContextMenuPosition } from "../utils/context-menu-position";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import {
  AFFAIRS_GRID_COLUMN_GAP,
  AFFAIRS_GRID_ITEM_HEIGHT,
  AFFAIRS_GRID_ROW_GAP,
  AFFAIRS_GRID_TRACK_MIN_WIDTH,
  computeVirtualGridMetrics,
  resolveAffairsGridColumnCount,
  shouldVirtualizeAffairsGrid
} from "../utils/affairs-grid";
import {
  resolveAffairsDocumentExtension,
  resolveAffairsDocumentVisual,
  type AffairsDocumentKind
} from "../utils/affairs-document-visual";
import type {
  AffairsWorkbenchDashboardState,
  AffairsAuxiliaryTab,
  DashboardHtmlWidgetVariant,
  AffairsObjectContext,
  AffairsPrimarySection,
  AffairsViewState,
  DashboardTabState,
  DashboardWidgetLayout,
  DashboardWidgetSourceRef,
  DashboardWidgetState,
  DashboardWidgetType,
  ShortcutAppSourceKind,
  ShortcutAppState
} from "../types/workbench-mode";

interface AffairsWorkbenchProviderProps {
  workspaceId: string;
  workspaceName: string | null;
  navigationGroups: WorkspaceSessionGroup[];
  state: AffairsViewState;
  onStateChange: (nextState: AffairsViewState) => void;
  onRefreshNavigation?: () => Promise<void>;
  children: ReactNode;
}

interface AffairsWorkbenchViewProps {
  workspaceId: string;
}

interface AffairsAuxiliaryPanelProps {
  workspaceId: string;
  onToggleCollapse?: () => void;
}

type TagApplyOperation = "attach" | "remove" | "update";

interface FolderTagApplyTaskMonitorState {
  folderPath: string;
  taskId: string;
  snapshot: AffairsTaskSnapshotDto | null;
  operation: TagApplyOperation;
}

interface DocumentTagApplyTaskMonitorState {
  documentId: string;
  documentTitle: string;
  taskId: string;
  snapshot: AffairsTaskSnapshotDto | null;
  operation: TagApplyOperation;
}

interface RecentAffairsTagTaskRecord {
  id: string;
  targetType: "folder" | "document";
  targetKey: string;
  targetLabel: string;
  taskId: string;
  snapshot: AffairsTaskSnapshotDto | null;
  operation: TagApplyOperation;
  createdAt: number;
}

interface IndexStatusPopoverRow {
  label: string;
  value: string;
  multiline?: boolean;
}

interface IndexStatusPopoverMetric {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
}

interface IndexStatusPopoverSection {
  title: string;
  rows: IndexStatusPopoverRow[];
}

interface IndexStatusPopoverModel {
  summaryMetrics: IndexStatusPopoverMetric[];
  primaryRows: IndexStatusPopoverRow[];
  technicalSections: IndexStatusPopoverSection[];
}

interface FullTagRecomputeTaskMonitorState {
  taskId: string;
  snapshot: AffairsTaskSnapshotDto | null;
}

const LIBRARY_STAGE_PAGE_SIZE = 120;
const DETAIL_VIEWER_MOUNT_DELAY_MS = 220;
const FILE_REPEAT_ACTIVATION_MS = 450;
const TAG_TREE_CHILDREN_VISIBLE_LIMIT = 5;
const TAG_TREE_ROOT_OVERFLOW_KEY = "__root__";
const AFFAIRS_TAG_TREE_STATE_STORAGE_KEY_PREFIX = "codingns.affairs.tag-tree.state.";
const LIST_ITEM_HEIGHT = 40;
const LIST_VIRTUAL_OVERSCAN_ROWS = 2;
const AFFAIRS_LIBRARY_STATUS_POLL_ACTIVE_MS = 3_000;
const AFFAIRS_LIBRARY_STATUS_POLL_IDLE_MS = 12_000;
const AFFAIRS_LIBRARY_DIRECTORY_POLL_ACTIVE_MS = 3_000;
const AFFAIRS_LIBRARY_DIRECTORY_POLL_IDLE_MS = 12_000;
const AFFAIRS_LIBRARY_DIRECTORY_POLL_PAUSED_DURING_INDEX_MS = 30_000;
const AFFAIRS_FOLDER_TAG_TASK_POLL_RUNNING_MS = 1_200;
const AFFAIRS_FOLDER_TAG_TASK_POLL_TERMINAL_HIDE_MS = 8_000;
const AFFAIRS_FULL_TAG_RECOMPUTE_TASK_POLL_RUNNING_MS = 1_200;
const AFFAIRS_FULL_TAG_RECOMPUTE_TASK_POLL_TERMINAL_HIDE_MS = 8_000;
const AFFAIRS_TAG_SAVE_SNAPSHOT_POLL_MS = 600;
const AFFAIRS_TAG_SAVE_SNAPSHOT_TIMEOUT_MS = 8_000;
const AFFAIRS_LIBRARY_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const AFFAIRS_CONVERSATION_SESSION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const AFFAIRS_DASHBOARD_REMOTE_SYNC_DEBOUNCE_MS = 600;
const AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID = "affairs-global";
const AFFAIRS_LIBRARY_PRESET_EXTENSIONS = [
  ".md", ".mdx", ".txt", ".rtf", ".html", ".htm", ".xml", ".json", ".yaml", ".yml", ".tsv",
  ".pdf", ".doc", ".docx", ".odt", ".wps",
  ".ppt", ".pptx", ".odp", ".key",
  ".xls", ".xlsx", ".ods", ".et", ".numbers",
  ".csv"
] as const;

type LibrarySortMode = "recent" | "name" | "type" | "size" | "createdAt";
type LibrarySortDirection = "asc" | "desc";
type FinderColumnKey = "name" | "size" | "updatedAt" | "type" | "createdAt";

type LibrarySortState = {
  mode: LibrarySortMode;
  direction: LibrarySortDirection;
};

const FINDER_COLUMN_MIN_WIDTHS: Record<FinderColumnKey, number> = {
  name: 240,
  size: 88,
  updatedAt: 156,
  type: 120,
  createdAt: 156
};

const DEFAULT_FINDER_COLUMN_WIDTHS: Record<FinderColumnKey, number> = {
  name: 320,
  size: 96,
  updatedAt: 176,
  type: 132,
  createdAt: 176
};

type AffairsSidebarNode = {
  id: string;
  label: string;
  summary?: string;
  count?: number;
  tone?: "default" | "favorite" | "tag" | "source" | "automation" | "conversation" | "workbench";
};

type DocumentRecord = {
  id: string;
  title: string;
  displayName: string;
  filePath: string;
  fullPath: string | null;
  summary: string;
  isFavorite: boolean;
  tags: string[];
  derivedTags: string[];
  createdAt: string | null;
  sizeBytes: number | null;
  updatedAt: string;
};

type AffairsLibraryViewerState = {
  filePath: string;
  title: string;
} | null;

type LocalMirrorTarget = {
  absolutePath: string;
  mirrorRoot: string;
} | null;

type TagRecord = {
  id: string;
  label: string;
  path: string;
  rootType: string;
  parentPath: string | null;
  depth: number;
  count: number;
};

type StoredAffairsTagTreeState = {
  expandedPaths?: string[];
  expandedOverflowPaths?: string[];
  accessCounts?: Record<string, number>;
};

type FolderRecord = {
  id: string;
  label: string;
  path: string;
  parentPath: string | null;
  depth: number;
  directCount: number;
  count: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type TagTreeVisibilityRecord = {
  nodeMap: Map<string, TagTreeNodeRecord>;
  visiblePathSet: Set<string>;
};

type LibraryEntry =
  | {
      id: string;
      kind: "folder";
      title: string;
      path: string;
      count: number;
      isFavorite: boolean;
      createdAt: string | null;
      updatedAt: string | null;
    }
  | {
      id: string;
      kind: "document";
      title: string;
      path: string;
      updatedAt: string;
      createdAt: string | null;
      sizeBytes: number | null;
      summary: string;
      isFavorite: boolean;
      documentId: string;
    };

type VirtualLibraryEntrySlot = {
  index: number;
  entry: LibraryEntry | null;
};

type LibraryContextMenuTarget =
  | {
      kind: "document";
      entry: Extract<LibraryEntry, { kind: "document" }>;
      record: DocumentRecord;
    }
  | {
      kind: "folder";
      entry: Extract<LibraryEntry, { kind: "folder" }>;
      record: FolderRecord | null;
    }
  | {
      kind: "blank";
      folderPath: string | null;
    };

type LibraryFileSystemTarget = Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>;

type LibraryContextMenuState = {
  left: number;
  top: number;
  target: LibraryContextMenuTarget;
};

type LibrarySubmenuKey = "copy" | "new";

type PendingLibraryCreateState = {
  folderPath: string | null;
  kind: "directory" | "markdown" | "text" | "custom";
  fileName: string;
} | null;

type PendingLibraryCreateKind = NonNullable<PendingLibraryCreateState>["kind"];

type PendingTagAssignmentTarget =
  | {
      kind: "document";
      title: string;
      documentId: string;
      existingTagIds: string[];
      resolvedTagPaths: string[];
    }
  | {
      kind: "folder";
      title: string;
      folderPath: string;
      existingTagIds: string[];
    };

type LibraryClipboardState = {
  mode: "copy" | "cut";
  target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>;
};

type TodoRecord = {
  id: string;
  kind: "inbox" | "follow_up";
  title: string;
  summary: string;
  statusLabel: string;
  detail: string;
  sourceSessionId: string | null;
  updatedAt: string;
  sourceLabel: string;
  sourceDescription: string;
};

type AutomationRecord = {
  id: string;
  title: string;
  summary: string;
  statusLabel: string;
  triggerLabel: string;
  targetSessionLabel: string;
  updatedAt: string;
  lastRunSummary: string | null;
  lastRunStatusLabel: string | null;
};

type AffairsConversationKind = "lightweight" | "agent";

type AffairsConversationDraftSelection = {
  kind: AffairsConversationKind;
  provider: ProviderId;
};

type AffairsConversationCreateModalMode = "all" | "agent-only";

type AffairsConversationSessionSelection = {
  kind: AffairsConversationKind;
  sessionId: string;
};

type AffairsConversationRuntimeSeed = {
  kind: AffairsConversationKind;
  session: SessionSummaryDto;
  bootstrapMessages: HistoryMessageDto[];
} | null;

type AffairsLightweightStreamingToolStatus = {
  label: string;
  detail: string | null;
  phase: "running" | "completed" | "failed";
};

type AffairsLightweightRuntimeSnapshot = {
  session: SessionSummaryDto | null;
  messages: SessionMessageViewModel[];
  historyState: "loading" | "ready";
  sending: boolean;
  streamingToolStatus: AffairsLightweightStreamingToolStatus | null;
};

type AffairsConversationListItem = {
  id: string;
  kind: AffairsConversationKind;
  session: SessionSummaryDto;
};

type AffairsConversationRenameTarget = {
  kind: AffairsConversationKind;
  session: SessionSummaryDto;
} | null;

type AffairsConversationDeleteTarget = {
  kind: AffairsConversationKind;
  session: SessionSummaryDto;
} | null;

type AffairsConversationExportFormat = "md" | "pdf" | "html";

type AffairsConversationExportRenderJob = {
  session: SessionSummaryDto;
  items: ReturnType<typeof buildConversationTimelineSourceItems>;
  shellWidthPx: number | null;
} | null;

type AffairsInitGuardSnapshot = {
  loading: boolean;
  initialized: boolean;
  butlerInitialized: boolean;
  unavailable: boolean;
  errorMessage: string | null;
  profile: {
    displayName: string;
    providerId: "codex" | "claude-code";
    personaTone: "direct" | "steady" | "friendly";
  } | null;
};

type AffairsSelectedObject =
  | {
      section: "library";
      record: DocumentRecord | null;
    }
  | {
      section: "workbench";
      record: null;
    }
  | {
      section: "conversation";
      record: null;
    }
  | {
      section: "todo";
      record: TodoRecord | null;
    }
  | {
      section: "automation";
      record: AutomationRecord | null;
    };

interface AffairsWorkbenchContextValue {
  workspaceId: string;
  workspaceName: string | null;
  navigationGroups: WorkspaceSessionGroup[];
  agentWorkspaceId: string | null;
  agentProjectId: string | null;
  agentWorkspacePath: string | null;
  state: AffairsViewState;
  activeSection: AffairsPrimarySection;
  initGuard: AffairsInitGuardSnapshot;
  loading: boolean;
  error: string | null;
  libraryLoading: boolean;
  libraryDocumentsLoading: boolean;
  libraryRefreshPending: boolean;
  libraryDocumentTotal: number;
  libraryVisibleEntryTotal: number;
  libraryDocumentHasMore: boolean;
  binding: AffairsLibraryBindingDto | null;
  globalLibraryBinding: AffairsLibraryBindingDto | null;
  libraryConfig: AffairsLibraryConfigDto | null;
  indexStatus: AffairsLibraryIndexStatusDto | null;
  currentDirectoryStatus: AffairsLibraryDocumentListDto["directoryStatus"];
  documentRecords: DocumentRecord[];
  filteredDocuments: DocumentRecord[];
  favoriteDocuments: DocumentRecord[];
  favoriteEntries: AffairsLibraryFavoriteRecordDto[];
  tagRecords: TagRecord[];
  selectedTagPaths: string[];
  libraryTagFacetCounts: Record<string, number>;
  folderRecords: FolderRecord[];
  todoRecords: TodoRecord[];
  filteredTodoRecords: TodoRecord[];
  automationRecords: AutomationRecord[];
  selectedObject: AffairsSelectedObject;
  assistantContext: AffairsObjectContext | null;
  automationRuns: AssistantAutomationRunDto[];
  sidebarNodes: AffairsSidebarNode[];
  auxiliaryTab: AffairsAuxiliaryTab;
  toolbarExpanded: boolean;
  detailViewerCollapsed: boolean;
  initializeButlerProfile: (payload: ButlerProfilePayload) => Promise<void>;
  updateButlerProfile: (payload: ButlerProfilePayload) => Promise<void>;
  reloadButlerProfile: () => Promise<void>;
  openLibraryViewer: (record: DocumentRecord) => void;
  selectSection: (section: AffairsPrimarySection) => void;
  openInitializedSection: (section: AffairsPrimarySection) => void;
  selectSidebarNode: (nodeId: string) => void;
  selectObject: (objectId: string | null) => void;
  selectAuxiliaryTab: (tab: AffairsAuxiliaryTab) => void;
  setLibraryBrowseMode: (mode: "folder" | "tag") => void;
  setLibraryViewMode: (mode: "grid" | "list") => void;
  selectLibraryFolderEntry: (folderPath: string | null) => void;
  navigateLibraryFolder: (folderPath: string | null) => void;
  navigateLibraryTag: (tagPath: string | null) => void;
  toggleDetailViewerCollapsed: () => void;
  toggleToolbarExpanded: () => void;
  saveLibraryBinding: (rootDir: string) => Promise<void>;
  setLibraryEnabled: (enabled: boolean) => Promise<void>;
  saveLibraryConfig: (input: {
    mirrorRoot: string | null;
    allowedExtensions: string[];
    includedHiddenPaths: string[];
    folderOpenBehavior?: "single_click" | "double_click";
  }) => Promise<AffairsLibraryConfigDto>;
  refreshLibrary: () => Promise<void>;
  toggleFavorite: (favorite: AffairsLibraryFavoriteRecordDto) => Promise<void>;
  loadMoreLibraryDocuments: () => Promise<void>;
  tagManagementOpen: boolean;
  openTagManagement: () => void;
  closeTagManagement: () => void;
  managedTags: AffairsTagNodeDto[];
  selectedManagedTag: AffairsTagDetailWithRulesDto | null;
  documentTagDetails: AffairsDocumentTagDetailsDto | null;
  folderTagDetails: AffairsFolderTagDetailsDto | null;
  folderTagTaskMonitor: FolderTagApplyTaskMonitorState | null;
  recentTagTasks: RecentAffairsTagTaskRecord[];
  fullTagRecomputeTaskMonitor: FullTagRecomputeTaskMonitorState | null;
  tagRecoveryStatus: AffairsTagRecoveryStatusDto | null;
  reloadTagManagement: () => Promise<void>;
  selectManagedTag: (tagId: string | null) => Promise<void>;
  saveManagedTag: (input: {
    tagId?: string;
    name: string;
    parentId?: string | null;
    description?: string | null;
    status?: "active" | "disabled";
    smartRules?: AffairsTagRuleDto[];
  }) => Promise<AffairsTagDetailWithRulesDto>;
  deleteManagedTag: (tagId: string) => Promise<{ deletedTagIds: string[]; deletedPaths: string[] }>;
  requestFullTagRecompute: () => Promise<{ taskId: string; deduped: boolean; status: "queued"; scope: "full" }>;
  saveDocumentTagSelection: (
    documentId: string,
    tagIds: string[],
    createTagPaths?: string[],
    previousTagIds?: string[],
    documentTitle?: string,
  ) => Promise<void>;
  saveFolderTagSelection: (folderPath: string, tagIds: string[], createTagPaths?: string[], previousTagIds?: string[]) => Promise<void>;
  conversationCreateModalOpen: boolean;
  conversationCreateModalMode: AffairsConversationCreateModalMode;
  openConversationCreateModal: (input?: { mode?: AffairsConversationCreateModalMode }) => void;
  closeConversationCreateModal: () => void;
  prepareAssistantConversation: (provider: "codex" | "claude-code") => Promise<void>;
  rememberConversationDraft: (draft: AffairsConversationDraftSelection) => void;
  rememberConversationSession: (input: {
    kind: AffairsConversationKind;
    session: SessionSummaryDto;
    bootstrapMessages: HistoryMessageDto[];
  }) => void;
  butlerStore: ButlerRuntimeStore;
  archiveConversationSession: (input: { kind: AffairsConversationKind; session: SessionSummaryDto }) => Promise<void>;
  unarchiveConversationSession: (input: { kind: AffairsConversationKind; session: SessionSummaryDto }) => Promise<void>;
  toggleConversationSessionFavorite: (input: { kind: AffairsConversationKind; session: SessionSummaryDto }) => Promise<void>;
  markConversationSessionSeen: (kind: AffairsConversationKind, sessionId: string, seenAt?: string) => void;
  openConversationRenameModal: (input: { kind: AffairsConversationKind; session: SessionSummaryDto }) => void;
  openConversationDeleteModal: (input: { kind: AffairsConversationKind; session: SessionSummaryDto }) => void;
  renameConversationSession: (input: { kind: AffairsConversationKind; session: SessionSummaryDto; title: string }) => Promise<SessionSummaryDto>;
  deleteConversationSession: (input: { kind: AffairsConversationKind; session: SessionSummaryDto }) => Promise<void>;
  exportConversationSession: (input: { session: SessionSummaryDto; format: "md" | "pdf" | "html" }) => Promise<void>;
  selectedConversationDraft: AffairsConversationDraftSelection | null;
  selectConversationDraft: (draft: AffairsConversationDraftSelection) => void;
  selectedConversationSession: AffairsConversationSessionSelection | null;
  conversationRuntimeSeed: AffairsConversationRuntimeSeed;
  lightweightRuntimeBySessionId: Record<string, AffairsLightweightRuntimeSnapshot>;
  setLightweightRuntimeSnapshot: (
    sessionId: string,
    updater: AffairsLightweightRuntimeSnapshot | null | ((current: AffairsLightweightRuntimeSnapshot | null) => AffairsLightweightRuntimeSnapshot | null)
  ) => void;
  lightweightConversationSessions: SessionSummaryDto[];
  lightweightConversationSessionsLoading: boolean;
  reloadLightweightConversationSessions: () => Promise<void>;
  agentConversationSessions: SessionSummaryDto[];
  agentConversationSessionsReady: boolean;
  agentConversationSessionsLoading: boolean;
  reloadAgentConversationSessions: () => Promise<void>;
  activateConversationSession: (input: {
    kind: AffairsConversationKind;
    session: SessionSummaryDto;
    bootstrapMessages: HistoryMessageDto[];
  }) => void;
}

type DashboardWidgetSizePreset = "small" | "medium" | "large";
type DashboardWidgetPaletteType = "todo" | "automation" | "html";
const AFFAIRS_HTML_SOURCE_CURRENT_LIBRARY = "__affairs_current_library__";

type WorkspaceHtmlSourceScopeOption =
  | {
      value: string;
      label: string;
      kind: "workspace";
      workspaceId: string;
    }
  | {
      value: typeof AFFAIRS_HTML_SOURCE_CURRENT_LIBRARY;
      label: string;
      kind: "affairs_library";
      workspaceId: string;
      rootDir: string;
    };

type WorkspaceHtmlSourceOption = {
  path: string;
  title: string;
  updatedAt: number | null;
  size: number | null;
};

interface AffairsDashboardContextValue {
  dashboardState: AffairsWorkbenchDashboardState;
  activeDashboardTab: DashboardTabState | null;
  layoutLocked: boolean;
  selectDashboardTab: (tabId: string) => void;
  addDashboardTab: () => void;
  renameDashboardTab: (tabId: string, title: string) => void;
  removeDashboardTab: (tabId: string) => void;
  toggleDashboardLayoutLocked: () => void;
  addDashboardWidget: (input: {
    type: DashboardWidgetType;
    variant?: DashboardHtmlWidgetVariant;
    title?: string;
    sourceRef?: DashboardWidgetSourceRef;
    config?: Record<string, unknown>;
  }) => void;
  updateDashboardWidgetConfig: (widgetId: string, patch: Record<string, unknown>) => void;
  setDashboardWidgetLayout: (widgetId: string, nextLayout: Partial<DashboardWidgetLayout>) => void;
  removeDashboardWidget: (widgetId: string) => void;
  resetActiveDashboardLayout: () => void;
  addShortcutApp: (input: { title?: string; sourceKind?: ShortcutAppSourceKind; workspaceId: string; entryPath: string }) => void;
  updateShortcutApp: (shortcutId: string, input: { title?: string; sourceKind?: ShortcutAppSourceKind; workspaceId: string; entryPath: string }) => void;
  removeShortcutApp: (shortcutId: string) => void;
}

const DASHBOARD_GRID_COLUMNS = 12;
const DASHBOARD_GRID_ROW_HEIGHT_PX = 44;
const DASHBOARD_GRID_GAP_PX = 12;
const DASHBOARD_GRID_SNAP_THRESHOLD_COLS = 0.6;
const DASHBOARD_GRID_SNAP_THRESHOLD_ROWS = 0.6;

const DASHBOARD_WIDGET_SIZE_PRESETS: Record<DashboardWidgetSizePreset, Omit<DashboardWidgetLayout, "widgetId" | "x" | "y">> = {
  small: {
    w: 4,
    h: 4,
    minW: 4,
    minH: 3
  },
  medium: {
    w: 6,
    h: 5,
    minW: 4,
    minH: 3
  },
  large: {
    w: 12,
    h: 7,
    minW: 6,
    minH: 4
  }
};

const DEFAULT_HTML_PREVIEW_SANDBOX = "allow-forms allow-modals allow-scripts";
const CROSS_ORIGIN_HTML_PREVIEW_SANDBOX = `${DEFAULT_HTML_PREVIEW_SANDBOX} allow-same-origin`;

const AffairsDashboardContext = createContext<AffairsDashboardContextValue | null>(null);

function resolveDashboardHtmlWidgetVariant(
  widget: Pick<DashboardWidgetState, "type" | "variant">
): DashboardHtmlWidgetVariant | null {
  if (widget.type !== "html") {
    return null;
  }

  return widget.variant ?? "embed";
}

function resolveDefaultDashboardWidgetSize(widget: Pick<DashboardWidgetState, "type" | "variant">): DashboardWidgetSizePreset {
  const htmlVariant = resolveDashboardHtmlWidgetVariant(widget);
  if (htmlVariant === "stat") {
    return "small";
  }

  if (htmlVariant === "app" || htmlVariant === "embed") {
    return "large";
  }

  return "medium";
}

function buildDefaultDashboardLayoutDraft(
  widgets: DashboardWidgetState[],
  previousLayoutByWidgetId: Map<string, DashboardWidgetLayout>,
  forceDefaultSize: boolean
): DashboardWidgetLayout[] {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  return widgets.map((widget) => {
    const fallbackPreset = DASHBOARD_WIDGET_SIZE_PRESETS[resolveDefaultDashboardWidgetSize(widget)];
    const previousLayout = previousLayoutByWidgetId.get(widget.id);
    const width = Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, forceDefaultSize ? fallbackPreset.w : (previousLayout?.w ?? fallbackPreset.w)));
    const height = Math.max(3, forceDefaultSize ? fallbackPreset.h : (previousLayout?.h ?? fallbackPreset.h));
    const minW = Math.max(1, Math.min(width, forceDefaultSize ? (fallbackPreset.minW ?? width) : (previousLayout?.minW ?? fallbackPreset.minW ?? width)));
    const minH = Math.max(1, Math.min(height, forceDefaultSize ? (fallbackPreset.minH ?? height) : (previousLayout?.minH ?? fallbackPreset.minH ?? height)));

    if (cursorX > 0 && cursorX + width > DASHBOARD_GRID_COLUMNS) {
      cursorY += rowHeight;
      cursorX = 0;
      rowHeight = 0;
    }

    const layout: DashboardWidgetLayout = {
      widgetId: widget.id,
      x: cursorX,
      y: cursorY,
      w: width,
      h: height,
      minW,
      minH
    };

    cursorX += width;
    rowHeight = Math.max(rowHeight, height);

    if (cursorX >= DASHBOARD_GRID_COLUMNS) {
      cursorY += rowHeight;
      cursorX = 0;
      rowHeight = 0;
    }

    return layout;
  });
}

function clampDashboardWidgetLayout(layout: DashboardWidgetLayout): DashboardWidgetLayout {
  const width = Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, layout.w));
  const height = Math.max(1, layout.h);
  const minW = Math.max(1, Math.min(width, layout.minW ?? width));
  const minH = Math.max(1, Math.min(height, layout.minH ?? height));

  return {
    ...layout,
    x: Math.max(0, Math.min(DASHBOARD_GRID_COLUMNS - width, layout.x)),
    y: Math.max(0, layout.y),
    w: width,
    h: height,
    minW,
    minH
  };
}

function doDashboardWidgetLayoutsOverlap(left: DashboardWidgetLayout, right: DashboardWidgetLayout): boolean {
  return !(
    left.x + left.w <= right.x
    || right.x + right.w <= left.x
    || left.y + left.h <= right.y
    || right.y + right.h <= left.y
  );
}

function resolveDashboardSnapDelta(value: number, guides: number[], threshold: number): number {
  let bestDelta = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const guide of guides) {
    const delta = guide - value;
    const distance = Math.abs(delta);
    if (distance > threshold || distance >= bestDistance) {
      continue;
    }
    bestDelta = delta;
    bestDistance = distance;
  }

  return Number.isFinite(bestDistance) ? bestDelta : 0;
}

function buildDashboardSnapGuides(layouts: DashboardWidgetLayout[], widgetId: string): {
  x: number[];
  y: number[];
} {
  const xGuides = [0, DASHBOARD_GRID_COLUMNS];
  const yGuides = [0];

  layouts.forEach((layout) => {
    if (layout.widgetId === widgetId) {
      return;
    }
    xGuides.push(layout.x, layout.x + layout.w);
    yGuides.push(layout.y, layout.y + layout.h);
  });

  return {
    x: xGuides,
    y: yGuides
  };
}

function applyDashboardMoveSnap(
  layout: Pick<DashboardWidgetLayout, "x" | "y" | "w" | "h">,
  guides: { x: number[]; y: number[] }
): { x: number; y: number } {
  const leftDelta = resolveDashboardSnapDelta(layout.x, guides.x, DASHBOARD_GRID_SNAP_THRESHOLD_COLS);
  const rightDelta = resolveDashboardSnapDelta(layout.x + layout.w, guides.x, DASHBOARD_GRID_SNAP_THRESHOLD_COLS);
  const topDelta = resolveDashboardSnapDelta(layout.y, guides.y, DASHBOARD_GRID_SNAP_THRESHOLD_ROWS);
  const bottomDelta = resolveDashboardSnapDelta(layout.y + layout.h, guides.y, DASHBOARD_GRID_SNAP_THRESHOLD_ROWS);

  return {
    x: layout.x + (Math.abs(leftDelta) <= Math.abs(rightDelta) ? leftDelta : rightDelta),
    y: layout.y + (Math.abs(topDelta) <= Math.abs(bottomDelta) ? topDelta : bottomDelta)
  };
}

function applyDashboardResizeSnap(
  layout: Pick<DashboardWidgetLayout, "x" | "y" | "w" | "h">,
  guides: { x: number[]; y: number[] },
  resizeMode: "x" | "y" | "xy"
): { w: number; h: number } {
  const rightDelta = resizeMode === "x" || resizeMode === "xy"
    ? resolveDashboardSnapDelta(layout.x + layout.w, guides.x, DASHBOARD_GRID_SNAP_THRESHOLD_COLS)
    : 0;
  const bottomDelta = resizeMode === "y" || resizeMode === "xy"
    ? resolveDashboardSnapDelta(layout.y + layout.h, guides.y, DASHBOARD_GRID_SNAP_THRESHOLD_ROWS)
    : 0;

  return {
    w: layout.w + rightDelta,
    h: layout.h + bottomDelta
  };
}

function resolveDashboardWidgetLayouts(
  widgets: DashboardWidgetState[],
  draftLayouts: DashboardWidgetLayout[],
  priorityWidgetId?: string | null
): DashboardWidgetLayout[] {
  const widgetIdSet = new Set(widgets.map((widget) => widget.id));
  const layoutsByWidgetId = new Map(
    draftLayouts
      .filter((layout) => widgetIdSet.has(layout.widgetId))
      .map((layout) => [layout.widgetId, clampDashboardWidgetLayout(layout)] as const)
  );
  const preferredOrder = [
    ...(priorityWidgetId ? [priorityWidgetId] : []),
    ...widgets.map((widget) => widget.id).filter((widgetId) => widgetId !== priorityWidgetId)
  ];
  const placedLayouts: DashboardWidgetLayout[] = [];

  for (const widgetId of preferredOrder) {
    const baseLayout = layoutsByWidgetId.get(widgetId);
    if (!baseLayout) {
      continue;
    }

    const nextLayout = {
      ...baseLayout
    };

    while (placedLayouts.some((layout) => doDashboardWidgetLayoutsOverlap(layout, nextLayout))) {
      const overlappedBottom = placedLayouts
        .filter((layout) => doDashboardWidgetLayoutsOverlap(layout, nextLayout))
        .reduce((maxValue, layout) => Math.max(maxValue, layout.y + layout.h), nextLayout.y + 1);
      nextLayout.y = overlappedBottom;
    }

    placedLayouts.push(nextLayout);
  }

  const resolvedByWidgetId = new Map(placedLayouts.map((layout) => [layout.widgetId, layout] as const));
  return widgets.map((widget) => resolvedByWidgetId.get(widget.id)).filter((layout): layout is DashboardWidgetLayout => Boolean(layout));
}

function buildDashboardWidgetLayout(
  widgets: DashboardWidgetState[],
  previousLayout: DashboardWidgetLayout[] = [],
  forceDefaultSize = false,
  priorityWidgetId?: string | null
): DashboardWidgetLayout[] {
  const previousLayoutByWidgetId = new Map(previousLayout.map((item) => [item.widgetId, item] as const));
  const defaultDrafts = buildDefaultDashboardLayoutDraft(widgets, previousLayoutByWidgetId, forceDefaultSize);
  const nextDrafts = widgets.map((widget, index) => {
    const fallbackDraft = defaultDrafts[index];
    if (forceDefaultSize) {
      return fallbackDraft;
    }

    const previous = previousLayoutByWidgetId.get(widget.id);
    if (!previous) {
      return fallbackDraft;
    }

    return clampDashboardWidgetLayout({
      ...fallbackDraft,
      ...previous,
      widgetId: widget.id,
      minW: previous.minW ?? fallbackDraft.minW,
      minH: previous.minH ?? fallbackDraft.minH
    });
  });

  return resolveDashboardWidgetLayouts(widgets, nextDrafts, priorityWidgetId);
}

function updateDashboardTabById(
  state: AffairsWorkbenchDashboardState,
  tabId: string,
  updater: (tab: DashboardTabState, timestamp: string) => DashboardTabState
): AffairsWorkbenchDashboardState {
  const timestamp = new Date().toISOString();
  let matched = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== tabId) {
      return tab;
    }
    matched = true;
    return updater(tab, timestamp);
  });

  if (!matched) {
    return state;
  }

  return {
    ...state,
    tabs,
    updatedAt: timestamp
  };
}

function buildDashboardPreviewUrl(
  preview: string | { previewPath?: string | null; previewUrl?: string | null },
  isDesktop = false
): string {
  const previewUrl = resolveDashboardPreviewAccessUrl(preview, isDesktop);

  if (typeof window === "undefined" || !window.location?.origin) {
    return `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}_preview=0`;
  }

  try {
    const url = new URL(previewUrl, window.location.origin);
    url.searchParams.set("_preview", "0");
    url.searchParams.set("_cns_parent_origin", window.location.origin);
    return url.toString();
  } catch {
    return `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}_preview=0`;
  }
}

function resolveDashboardPreviewAccessUrl(
  preview: string | { previewPath?: string | null; previewUrl?: string | null },
  isDesktop: boolean
): string {
  if (typeof preview === "string") {
    return preview;
  }

  const previewPath = preview.previewPath?.trim() ?? "";

  if (previewPath) {
    if (!isDesktop && typeof window !== "undefined" && window.location?.origin) {
      return new URL(previewPath, window.location.origin).toString();
    }

    if (isDesktop) {
      const desktopPreviewUrl = buildDashboardDesktopPreviewUrl(previewPath);

      if (desktopPreviewUrl) {
        return desktopPreviewUrl;
      }
    }
  }

  const previewUrl = preview.previewUrl?.trim() ?? "";

  if (!previewUrl) {
    throw new Error(t("shell.affairsWorkbenchHtmlSourceLoadFailed"));
  }

  return previewUrl;
}

function buildDashboardDesktopPreviewUrl(previewPath: string): string | null {
  try {
    const resolvedBaseUrl = resolveHostTransportTarget(getHostBaseUrl()).baseUrl;
    return getHostRequestUrl(previewPath, resolvedBaseUrl);
  } catch {
    return null;
  }
}

function resolveDashboardHtmlPreviewSandbox(src: string): string {
  if (typeof window === "undefined" || !window.location?.origin) {
    return DEFAULT_HTML_PREVIEW_SANDBOX;
  }

  try {
    const previewUrl = new URL(src, window.location.origin);
    if (previewUrl.origin !== window.location.origin) {
      return CROSS_ORIGIN_HTML_PREVIEW_SANDBOX;
    }
  } catch {
    return DEFAULT_HTML_PREVIEW_SANDBOX;
  }

  return DEFAULT_HTML_PREVIEW_SANDBOX;
}

function resolveErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message?.trim() || fallbackMessage;
  }

  if (error instanceof Error) {
    return error.message?.trim() || fallbackMessage;
  }

  return fallbackMessage;
}

function resolveWorkspaceHtmlSourceTitle(path: string, title?: string | null): string {
  const nextTitle = title?.trim() ?? "";
  if (nextTitle) {
    return nextTitle;
  }
  return getPathLeafName(path.trim()) || path.trim();
}

function resolveInitialDashboardState(
  legacyWorkspaceId: string
): AffairsWorkbenchDashboardState {
  const globalState = readAffairsDashboardState(AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID);
  if (globalState) {
    return globalState;
  }

  const legacyWorkspaceState = readAffairsDashboardState(legacyWorkspaceId);
  if (legacyWorkspaceState) {
    return normalizeGlobalDashboardState(legacyWorkspaceState);
  }

  return createDefaultAffairsDashboardState(AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID);
}

function normalizeGlobalDashboardState(snapshot: unknown): AffairsWorkbenchDashboardState {
  return normalizeAffairsDashboardState(AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID, snapshot)
    ?? createDefaultAffairsDashboardState(AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID);
}

function isEmptyDashboardStatePayload(snapshot: unknown): boolean {
  return typeof snapshot === "object"
    && snapshot !== null
    && !Array.isArray(snapshot)
    && Object.keys(snapshot).length === 0;
}

function writeGlobalDashboardStateSnapshot(state: AffairsWorkbenchDashboardState): void {
  writeAffairsDashboardState(normalizeGlobalDashboardState(state));
}

function resolveShortcutAppIconText(title: string): string {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return "应用";
  }

  const cjkChars = Array.from(normalizedTitle).filter((char) => /[㐀-鿿]/.test(char));
  if (cjkChars.length > 0) {
    return cjkChars.slice(0, 2).join("");
  }

  const wordChars = normalizedTitle
    .split(/[\s\-_/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .filter(Boolean);
  if (wordChars.length > 0) {
    return wordChars.slice(0, 2).join("");
  }

  return Array.from(normalizedTitle).slice(0, 2).join("").toUpperCase();
}

function resolveShortcutAppIconStyle(title: string): CSSProperties {
  const normalizedTitle = title.trim() || "快捷应用";
  let hash = 0;
  for (const char of normalizedTitle) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const accentHue = (hue + 28) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 82% 91%), hsl(${accentHue} 78% 85%))`,
    color: `hsl(${hue} 46% 20%)`
  };
}

async function validateWorkspaceHtmlSource(workspaceId: string, entryPath: string): Promise<{ path: string; title: string }> {
  const normalizedPath = entryPath.trim();

  if (!isWorkspaceHtmlEntryPath(normalizedPath)) {
    throw new Error(t("shell.affairsWorkbenchHtmlSourceInvalid"));
  }

  const preview = await getFilePreview(workspaceId, normalizedPath);
  if (!preview.supported || preview.kind !== "html" || !preview.previewUrl) {
    throw new Error(t("shell.affairsWorkbenchHtmlSourceUnsupported"));
  }

  return {
    path: normalizedPath,
    title: resolveWorkspaceHtmlSourceTitle(normalizedPath)
  };
}

async function validateWorkspaceShortcutSource(workspaceId: string, entryPath: string): Promise<{ path: string; title: string }> {
  const normalizedPath = entryPath.trim();

  if (!normalizedPath) {
    throw new Error(t("shell.affairsShortcutRailSourceInvalid"));
  }

  const preview = await getFilePreview(workspaceId, normalizedPath);
  if (!preview.supported) {
    throw new Error(t("shell.affairsShortcutRailSourceUnsupported"));
  }

  return {
    path: normalizedPath,
    title: resolveWorkspaceHtmlSourceTitle(normalizedPath)
  };
}

async function validateAffairsLibraryHtmlSource(workspaceId: string, entryPath: string): Promise<{ path: string; title: string }> {
  const normalizedPath = entryPath.trim();

  if (!isWorkspaceHtmlEntryPath(normalizedPath)) {
    throw new Error(t("shell.affairsWorkbenchHtmlSourceInvalid"));
  }

  const preview = await getAffairsLibraryPreview(workspaceId, normalizedPath);
  if (!preview.supported || preview.kind !== "html" || !preview.previewUrl) {
    throw new Error(t("shell.affairsWorkbenchHtmlSourceUnsupported"));
  }

  return {
    path: normalizedPath,
    title: resolveWorkspaceHtmlSourceTitle(normalizedPath)
  };
}

async function validateAffairsLibraryShortcutSource(workspaceId: string, entryPath: string): Promise<{ path: string; title: string }> {
  const normalizedPath = entryPath.trim();

  if (!normalizedPath) {
    throw new Error(t("shell.affairsShortcutRailSourceInvalid"));
  }

  const preview = await getAffairsLibraryPreview(workspaceId, normalizedPath);
  if (!preview.supported) {
    throw new Error(t("shell.affairsShortcutRailSourceUnsupported"));
  }

  return {
    path: normalizedPath,
    title: resolveWorkspaceHtmlSourceTitle(normalizedPath)
  };
}

async function validateHtmlSourceSelection(
  source: WorkspaceHtmlSourceScopeOption | null,
  entryPath: string
): Promise<{ path: string; title: string }> {
  if (!source) {
    throw new Error(t("shell.affairsWorkbenchHtmlSourceInvalid"));
  }
  if (source.kind === "affairs_library") {
    return validateAffairsLibraryHtmlSource(source.workspaceId, entryPath);
  }
  return validateWorkspaceHtmlSource(source.workspaceId, entryPath);
}

async function validateShortcutSourceSelection(
  source: WorkspaceHtmlSourceScopeOption | null,
  entryPath: string
): Promise<{ path: string; title: string }> {
  if (!source) {
    throw new Error(t("shell.affairsShortcutRailSourceInvalid"));
  }
  if (source.kind === "affairs_library") {
    return validateAffairsLibraryShortcutSource(source.workspaceId, entryPath);
  }
  return validateWorkspaceShortcutSource(source.workspaceId, entryPath);
}

function buildWorkspaceHtmlSourceWorkspaceOptions(
  navigationGroups: WorkspaceSessionGroup[],
  currentWorkspaceId: string,
  currentLibraryWorkspace?: WorkspaceHtmlSourceScopeOption | null
): WorkspaceHtmlSourceScopeOption[] {
  const seenWorkspaceIds = new Set<string>();
  const options: WorkspaceHtmlSourceScopeOption[] = [];
  const appendOption = (workspaceId: string, label: string) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId || seenWorkspaceIds.has(normalizedWorkspaceId)) {
      return;
    }
    seenWorkspaceIds.add(normalizedWorkspaceId);
    options.push({
      value: normalizedWorkspaceId,
      workspaceId: normalizedWorkspaceId,
      label,
      kind: "workspace"
    });
  };

  if (currentLibraryWorkspace) {
    options.push(currentLibraryWorkspace);
  }

  navigationGroups.forEach((group) => {
    const workspaceId = group.workspace.id.trim();
    if (!workspaceId || seenWorkspaceIds.has(workspaceId)) {
      return;
    }
    appendOption(workspaceId, group.workspace.name?.trim() || group.workspace.path || workspaceId);
  });

  if (!seenWorkspaceIds.has(currentWorkspaceId)) {
    options.unshift({
      value: currentWorkspaceId,
      workspaceId: currentWorkspaceId,
      label: navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace.name?.trim() || currentWorkspaceId,
      kind: "workspace"
    });
  }

  return options;
}

function resolveAffairsLibrarySourceWorkspaceOption(
  binding: AffairsLibraryBindingDto | null,
  currentWorkspaceId: string | null | undefined
): WorkspaceHtmlSourceScopeOption | null {
  const rootDir = binding?.rootDir?.trim() ?? "";
  const workspaceId = binding?.workspaceId?.trim() || currentWorkspaceId?.trim() || AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID;
  if (!rootDir || !workspaceId) {
    return null;
  }
  return {
    value: AFFAIRS_HTML_SOURCE_CURRENT_LIBRARY,
    kind: "affairs_library",
    workspaceId,
    rootDir,
    label: t("shell.affairsWorkbenchHtmlSourceWorkspaceCurrentLibraryOption")
  };
}

function resolveWorkspaceHtmlSourceDefaultWorkspaceId(input: {
  currentWorkspaceId: string | null | undefined;
  currentLibraryWorkspace: WorkspaceHtmlSourceScopeOption | null;
  options: WorkspaceHtmlSourceScopeOption[];
}): string {
  const currentLibraryWorkspaceValue = input.currentLibraryWorkspace?.value?.trim() ?? "";
  if (currentLibraryWorkspaceValue && input.options.some((option) => option.value === currentLibraryWorkspaceValue)) {
    return currentLibraryWorkspaceValue;
  }

  const currentWorkspaceId = input.currentWorkspaceId?.trim() ?? "";
  if (currentWorkspaceId && input.options.some((option) => option.value === currentWorkspaceId)) {
    return currentWorkspaceId;
  }

  return input.options[0]?.value ?? currentWorkspaceId;
}

function resolveDashboardSourceWorkspaceId(
  sourceRef: DashboardWidgetSourceRef | undefined,
  fallbackWorkspaceId: string
): string {
  return sourceRef?.workspaceId?.trim() || fallbackWorkspaceId;
}

function resolveHtmlSourceScopeOption(
  options: WorkspaceHtmlSourceScopeOption[],
  value: string
): WorkspaceHtmlSourceScopeOption | null {
  const normalizedValue = value.trim();
  return options.find((option) => option.value === normalizedValue) ?? null;
}

const AFFAIRS_LIGHTWEIGHT_PROVIDER_IDS: ProviderId[] = ["codex", "claude-code"];
const AFFAIRS_ASSISTANT_PROVIDER_IDS: ProviderId[] = ["codex", "claude-code"];
const FALLBACK_ROUTER_LOCATION: Location = {
  pathname: "",
  search: "",
  hash: "",
  state: null,
  key: "affairs-workbench-fallback"
};

const AffairsWorkbenchContext = createContext<AffairsWorkbenchContextValue | null>(null);

export function AffairsWorkbenchProvider({
  workspaceId,
  workspaceName,
  navigationGroups,
  state,
  onStateChange,
  onRefreshNavigation,
  children
}: AffairsWorkbenchProviderProps) {
  const navigationContext = useContext(UNSAFE_NavigationContext) as { navigator?: Navigator } | null;
  const locationContext = useContext(UNSAFE_LocationContext) as { location?: Location } | null;
  const navigate = useCallback((to: string) => {
    navigationContext?.navigator?.push(to);
  }, [navigationContext]);
  const location = locationContext?.location ?? FALLBACK_ROUTER_LOCATION;
  const workspaceGroup = useMemo(
    () => navigationGroups.find((item) => item.workspace.id === workspaceId) ?? null,
    [navigationGroups, workspaceId]
  );
  const workspaceSessions = workspaceGroup?.sessions ?? [];
  const workspaceSessionIdSet = useMemo(
    () => new Set(workspaceSessions.map((session) => session.sessionId)),
    [workspaceSessions]
  );
  const workspaceSessionIdSignature = useMemo(
    () => workspaceSessions
      .map((session) => session.sessionId.trim())
      .filter((sessionId) => sessionId.length > 0)
      .sort((left, right) => left.localeCompare(right))
      .join("|"),
    [workspaceSessions]
  );
  const sessionTitleById = useMemo(
    () => Object.fromEntries(workspaceSessions.map((session) => [session.sessionId, session.title?.trim() || session.sessionId])),
    [workspaceSessions]
  );
  const lastConversationNodeIdRef = useRef<string | null>(null);
  const [conversationCreateModalOpen, setConversationCreateModalOpen] = useState(false);
  const [conversationCreateModalMode, setConversationCreateModalMode] = useState<AffairsConversationCreateModalMode>("all");
  const [selectedConversationDraft, setSelectedConversationDraft] = useState<AffairsConversationDraftSelection | null>(null);
  const [selectedConversationSession, setSelectedConversationSession] = useState<AffairsConversationSessionSelection | null>(null);
  const [conversationRuntimeSeed, setConversationRuntimeSeed] = useState<AffairsConversationRuntimeSeed>(null);
  const [conversationRenameTarget, setConversationRenameTarget] = useState<AffairsConversationRenameTarget>(null);
  const [conversationRenameValue, setConversationRenameValue] = useState("");
  const [conversationRenamingSessionId, setConversationRenamingSessionId] = useState<string | null>(null);
  const [conversationDeleteTarget, setConversationDeleteTarget] = useState<AffairsConversationDeleteTarget>(null);
  const [conversationDeletingSessionId, setConversationDeletingSessionId] = useState<string | null>(null);
  const [conversationExportingSessionId, setConversationExportingSessionId] = useState<string | null>(null);
  const [conversationExportRenderJob, setConversationExportRenderJob] = useState<AffairsConversationExportRenderJob>(null);
  const [lightweightRuntimeBySessionId, setLightweightRuntimeBySessionId] = useState<Record<string, AffairsLightweightRuntimeSnapshot>>({});
  const initialLightweightConversationSessions = useMemo(
    () => readCachedAffairsLightweightConversationSessions(workspaceId) ?? [],
    [workspaceId]
  );
  const [agentProjectId, setAgentProjectId] = useState<string | null>(null);
  const [snapshotAgentProjectWorkspaceId, setSnapshotAgentProjectWorkspaceId] = useState<string | null>(null);
  const [lightweightConversationSessions, setLightweightConversationSessions] = useState<SessionSummaryDto[]>(
    initialLightweightConversationSessions
  );
  const [lightweightConversationSessionsLoading, setLightweightConversationSessionsLoading] = useState(false);
  const [agentConversationSessions, setAgentConversationSessions] = useState<SessionSummaryDto[]>([]);
  const [agentConversationSessionsReady, setAgentConversationSessionsReady] = useState(false);
  const [agentConversationSessionsLoading, setAgentConversationSessionsLoading] = useState(false);
  const [lastObjectAssistantContext, setLastObjectAssistantContext] = useState<AffairsObjectContext | null>(null);
  const conversationExportRenderRootRef = useRef<HTMLDivElement | null>(null);
  const lightweightConversationSessionCacheScopeRef = useRef<string | null>(null);
  const activeLightweightConversationSessionIds = useMemo(
    () => new Set(lightweightConversationSessions.map((session) => session.sessionId)),
    [lightweightConversationSessions]
  );
  const initialLibrarySnapshot = useMemo(
    () => readCachedLibrarySnapshot(workspaceId),
    [workspaceId]
  );
  const initialLibraryConfig = useMemo(
    () => readCachedLibraryConfig(workspaceId),
    [workspaceId]
  );
  const initialLibraryDocumentPage = useMemo(
    () => readCachedLibraryDocumentPage(workspaceId, state),
    [workspaceId, state]
  );
  const activeSection = normalizeSection(state.primarySection);
  const [libraryLoading, setLibraryLoading] = useState(initialLibrarySnapshot === null);
  const [todoLoading, setTodoLoading] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [globalLibraryBinding, setGlobalLibraryBinding] = useState<AffairsLibraryBindingDto | null>(null);
  const [librarySnapshot, setLibrarySnapshot] = useState<AffairsLibrarySnapshotDto | null>(initialLibrarySnapshot);
  const [libraryConfig, setLibraryConfig] = useState<AffairsLibraryConfigDto | null>(initialLibraryConfig);
  const [libraryDocumentPage, setLibraryDocumentPage] = useState<AffairsLibraryDocumentListDto | null>(initialLibraryDocumentPage);
  const [libraryDocumentsLoading, setLibraryDocumentsLoading] = useState(false);
  const [libraryRefreshPending, setLibraryRefreshPending] = useState(false);
  const [viewerState, setViewerState] = useState<AffairsLibraryViewerState>(null);
  const [tagManagementOpen, setTagManagementOpen] = useState(false);
  const [managedTags, setManagedTags] = useState<AffairsTagNodeDto[]>([]);
  const [selectedManagedTag, setSelectedManagedTag] = useState<AffairsTagDetailWithRulesDto | null>(null);
  const [documentTagDetails, setDocumentTagDetails] = useState<AffairsDocumentTagDetailsDto | null>(null);
  const [folderTagDetails, setFolderTagDetails] = useState<AffairsFolderTagDetailsDto | null>(null);
  const [folderTagTaskMonitor, setFolderTagTaskMonitor] = useState<FolderTagApplyTaskMonitorState | null>(null);
  const [documentTagTaskMonitor, setDocumentTagTaskMonitor] = useState<DocumentTagApplyTaskMonitorState | null>(null);
  const [recentTagTasks, setRecentTagTasks] = useState<RecentAffairsTagTaskRecord[]>([]);
  const [fullTagRecomputeTaskMonitor, setFullTagRecomputeTaskMonitor] = useState<FullTagRecomputeTaskMonitorState | null>(null);
  const [tagRecoveryStatus, setTagRecoveryStatus] = useState<AffairsTagRecoveryStatusDto | null>(null);
  const [inboxItems, setInboxItems] = useState<ButlerInboxItemDto[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<ButlerFollowUpTaskDto[]>([]);
  const [automations, setAutomations] = useState<AssistantAutomationTaskDto[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AssistantAutomationRunDto[]>([]);
  const [dashboardState, setDashboardState] = useState<AffairsWorkbenchDashboardState>(() => (
    resolveInitialDashboardState(workspaceId)
  ));
  const [dashboardRemoteReady, setDashboardRemoteReady] = useState(false);
  const dashboardSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedDashboardSerializedRef = useRef<string | null>(null);
  const activeDashboardTab = useMemo(
    () => dashboardState.tabs.find((tab) => tab.id === dashboardState.activeTabId) ?? dashboardState.tabs[0] ?? null,
    [dashboardState]
  );
  const binding = librarySnapshot?.binding ?? null;
  const agentWorkspacePath = useMemo(
    () => resolveAffairsAgentWorkspacePath(binding),
    [binding]
  );
  const matchedAgentWorkspaceId = useMemo(
    () => resolveAffairsAgentWorkspaceId(agentWorkspacePath, navigationGroups),
    [agentWorkspacePath, navigationGroups]
  );
  const agentWorkspaceId = useMemo(
    () => matchedAgentWorkspaceId ?? snapshotAgentProjectWorkspaceId,
    [matchedAgentWorkspaceId, snapshotAgentProjectWorkspaceId]
  );
  const butlerStore = useMemo(
    () => new ButlerRuntimeStore(agentWorkspaceId),
    [agentWorkspaceId]
  );
  const butlerInitLoading = useButlerRuntimeStore(butlerStore, (value) => value.loading);
  const butlerInitialized = useButlerRuntimeStore(butlerStore, (value) => value.initialized);
  const affairsSetupCompleted = useButlerRuntimeStore(
    butlerStore,
    (value) => value.affairsSetupCompleted ?? value.initialized
  );
  const butlerBootstrapErrorCode = useButlerRuntimeStore(
    butlerStore,
    (value) => value.bootstrapErrorCode
  );
  const butlerInitError = useButlerRuntimeStore(butlerStore, (value) => value.error);
  const butlerProfile = useButlerRuntimeStore(butlerStore, (value) => value.profile);
  const butlerActiveProvider = useButlerRuntimeStore(butlerStore, (value) => value.activeProvider);
  const butlerControlSession = useButlerRuntimeStore(butlerStore, (value) => value.controlSession);
  const { showToast } = useToast();
  const butlerHostUnavailable =
    butlerBootstrapErrorCode === "NETWORK_ERROR"
    || butlerBootstrapErrorCode === "INVALID_RESPONSE";
  const indexStatus = librarySnapshot?.status ?? null;
  const currentDirectoryStatus = libraryDocumentPage?.directoryStatus ?? null;
  const initGuard = useMemo<AffairsInitGuardSnapshot>(() => ({
    loading: butlerInitLoading,
    initialized: affairsSetupCompleted,
    butlerInitialized,
    unavailable: !butlerInitLoading && butlerHostUnavailable,
    errorMessage: butlerInitError,
    profile: butlerProfile
      ? {
          displayName: butlerProfile.displayName,
          providerId: butlerProfile.providerId,
          personaTone: butlerProfile.persona.tone
        }
      : null
  }), [affairsSetupCompleted, butlerHostUnavailable, butlerInitError, butlerInitLoading, butlerInitialized, butlerProfile]);
  const isAffairsRoute = location.pathname === buildAffairsPath();
  const ensureAffairsRoute = useCallback(() => {
    if (isAffairsRoute) {
      return;
    }
    navigate(buildAffairsPath());
  }, [isAffairsRoute, navigate, workspaceId]);
  const recentFileActivationRef = useRef<{ path: string; timestamp: number } | null>(null);
  const librarySnapshotRef = useRef<AffairsLibrarySnapshotDto | null>(initialLibrarySnapshot);
  const directoryHintKeyRef = useRef<string | null>(null);
  const directoryHintBootstrappedRef = useRef(false);

  const effectiveAuxiliaryTab = resolveAffairsAuxiliaryTabForSection(activeSection, state.auxiliaryTab);

  useEffect(() => {
    if (typeof butlerStore.initialize === "function") {
      void butlerStore.initialize();
    }
  }, [butlerStore]);

  useEffect(() => () => {
    butlerStore.dispose();
  }, [butlerStore]);

  useEffect(() => {
    setLastObjectAssistantContext(null);
  }, [workspaceId]);

  useEffect(() => {
    lightweightConversationSessionCacheScopeRef.current = null;
    setLightweightConversationSessions(initialLightweightConversationSessions);
    setAgentProjectId(null);
    setSnapshotAgentProjectWorkspaceId(null);
    setAgentConversationSessions([]);
    setAgentConversationSessionsReady(false);
    setAgentConversationSessionsLoading(false);
    setLightweightRuntimeBySessionId({});
  }, [initialLightweightConversationSessions, workspaceId]);

  useEffect(() => {
    librarySnapshotRef.current = librarySnapshot;
  }, [librarySnapshot]);

  useEffect(() => {
    if (lightweightConversationSessionCacheScopeRef.current !== workspaceId) {
      lightweightConversationSessionCacheScopeRef.current = workspaceId;
      return;
    }
    writeCachedAffairsLightweightConversationSessions(workspaceId, lightweightConversationSessions);
  }, [lightweightConversationSessions, workspaceId]);

  useEffect(() => {
    setSelectedConversationDraft(parseAffairsConversationDraftSelection(state.selectedNodeId));
    setSelectedConversationSession(parseAffairsConversationSessionSelection(state.selectedNodeId));
  }, [state.selectedNodeId]);

  useEffect(() => {
    if (state.selectedNodeId?.startsWith("conversation:")) {
      lastConversationNodeIdRef.current = state.selectedNodeId;
    }
  }, [state.selectedNodeId]);

  useEffect(() => {
    if (!selectedConversationSession) {
      return;
    }

    setConversationRuntimeSeed((current) => {
      if (!current || current.session.sessionId === selectedConversationSession.sessionId) {
        return current;
      }
      return null;
    });
  }, [selectedConversationSession]);

  const setLightweightRuntimeSnapshot = useCallback((
    sessionId: string,
    updater: AffairsLightweightRuntimeSnapshot | null | ((current: AffairsLightweightRuntimeSnapshot | null) => AffairsLightweightRuntimeSnapshot | null)
  ) => {
    setLightweightRuntimeBySessionId((current) => {
      const currentSnapshot = current[sessionId] ?? null;
      const nextSnapshot = typeof updater === "function"
        ? updater(currentSnapshot)
        : updater;

      if (!nextSnapshot) {
        if (!(sessionId in current)) {
          return current;
        }
        const { [sessionId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [sessionId]: nextSnapshot
      };
    });
  }, []);

  const clearSelectedConversationSession = useCallback((input: {
    kind: AffairsConversationKind;
    sessionId: string;
  }) => {
    setSelectedConversationSession((current) => (
      current?.sessionId === input.sessionId && current.kind === input.kind ? null : current
    ));
    setConversationRuntimeSeed((current) => (
      current?.session.sessionId === input.sessionId ? null : current
    ));
    setLightweightRuntimeSnapshot(input.sessionId, null);
    if (lastConversationNodeIdRef.current === buildAffairsConversationSessionNodeId(input.kind, input.sessionId)) {
      lastConversationNodeIdRef.current = null;
    }
    if (state.selectedNodeId === buildAffairsConversationSessionNodeId(input.kind, input.sessionId)) {
      onStateChange({
        ...state,
        primarySection: "conversation",
        selectedNodeId: null,
        selectedObjectId: null,
        selectedDocumentId: null
      });
    }
  }, [onStateChange, setLightweightRuntimeSnapshot, state]);

  useEffect(() => {
    if (!selectedConversationSession) {
      return;
    }

    if (conversationRuntimeSeed?.session.sessionId === selectedConversationSession.sessionId) {
      return;
    }

    if (selectedConversationSession.kind === "lightweight") {
      if (lightweightConversationSessions.some((item) => item.sessionId === selectedConversationSession.sessionId)) {
        return;
      }
    } else {
      if (!agentConversationSessionsReady) {
        return;
      }
      if (agentConversationSessions.some((item) => item.sessionId === selectedConversationSession.sessionId)) {
        return;
      }
    }

    clearSelectedConversationSession(selectedConversationSession);
  }, [
    agentConversationSessions,
    agentConversationSessionsReady,
    clearSelectedConversationSession,
    conversationRuntimeSeed?.session.sessionId,
    lightweightConversationSessions,
    selectedConversationSession
  ]);

  const reloadLightweightConversationSessions = useCallback(async () => {
    setLightweightConversationSessionsLoading(true);
    try {
      const response = await listAffairsLightweightSessions(workspaceId);
      setLightweightConversationSessions(response.items);
    } catch (error) {
      showToast({
        tone: "error",
        title: t("shell.affairsConversationLightweightLoadFailed"),
        description: getErrorMessage(error, t("shell.affairsConversationLightweightLoadFailed"))
      });
    } finally {
      setLightweightConversationSessionsLoading(false);
    }
  }, [showToast, workspaceId]);

  useEffect(() => {
    if (activeSection !== "conversation") {
      return;
    }
    void reloadLightweightConversationSessions();
  }, [activeSection, reloadLightweightConversationSessions]);

  const reloadAgentConversationSessions = useCallback(async () => {
    setAgentConversationSessionsLoading(true);
    try {
      const response = await getAffairsAssistantSessionsSnapshot(workspaceId, {
        refresh: true
      });
      setAgentProjectId(response.item.projectId);
      setSnapshotAgentProjectWorkspaceId(response.item.projectWorkspaceId);
      setAgentConversationSessions((current) => mergeSnapshotBackedAgentConversationSessions(
        current,
        response.item.sessions
      ));
      setAgentConversationSessionsReady(true);
    } catch (error) {
      showToast({
        tone: "error",
        title: t("shell.affairsConversationAgentLoadFailed"),
        description: getErrorMessage(error, t("shell.affairsConversationAgentLoadFailed"))
      });
    } finally {
      setAgentConversationSessionsLoading(false);
    }
  }, [showToast, workspaceId]);

  useEffect(() => {
    if (activeSection !== "conversation") {
      return;
    }
    void reloadAgentConversationSessions();
  }, [activeSection, reloadAgentConversationSessions]);

  const upsertRecentTagTask = useCallback((record: RecentAffairsTagTaskRecord) => {
    setRecentTagTasks((previous) => {
      const next = [
        record,
        ...previous.filter((item) => item.id !== record.id),
      ];
      return next
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 5);
    });
  }, []);

  const syncFolderTaskRecord = useCallback((monitor: FolderTagApplyTaskMonitorState | null) => {
    if (!monitor) {
      return;
    }
    upsertRecentTagTask({
      id: `folder:${monitor.folderPath}`,
      targetType: "folder",
      targetKey: monitor.folderPath,
      targetLabel: monitor.folderPath === "."
        ? t("shell.affairsLibraryDirectoryStatusRootPath")
        : getPathLeafName(monitor.folderPath) || monitor.folderPath,
      taskId: monitor.taskId,
      snapshot: monitor.snapshot,
      operation: monitor.operation,
      createdAt: monitor.snapshot?.enqueuedAt ?? Date.now(),
    });
  }, [upsertRecentTagTask]);

  const syncDocumentTaskRecord = useCallback((monitor: DocumentTagApplyTaskMonitorState | null) => {
    if (!monitor) {
      return;
    }
    upsertRecentTagTask({
      id: `document:${monitor.documentId}`,
      targetType: "document",
      targetKey: monitor.documentId,
      targetLabel: monitor.documentTitle || monitor.documentId,
      taskId: monitor.taskId,
      snapshot: monitor.snapshot,
      operation: monitor.operation,
      createdAt: monitor.snapshot?.enqueuedAt ?? Date.now(),
    });
  }, [upsertRecentTagTask]);

  useEffect(() => {
    if (!folderTagTaskMonitor) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollTask = async () => {
      try {
        const snapshot = await getAffairsFolderTagTask(workspaceId, folderTagTaskMonitor.folderPath);
        if (disposed) {
          return;
        }
        setFolderTagTaskMonitor((previous) => {
          if (!previous || previous.taskId !== folderTagTaskMonitor.taskId || previous.folderPath !== folderTagTaskMonitor.folderPath) {
            return previous;
          }
          if (areAffairsTaskSnapshotsEqual(previous.snapshot, snapshot)) {
            return previous;
          }
          const nextMonitor = {
            ...previous,
            snapshot,
          };
          syncFolderTaskRecord(nextMonitor);
          return nextMonitor;
        });
        if (!snapshot || isTerminalAffairsTaskStatus(snapshot.status)) {
          return;
        }
      } catch {
        if (disposed) {
          return;
        }
      }

      if (!disposed) {
        timer = setTimeout(() => {
          void pollTask();
        }, AFFAIRS_FOLDER_TAG_TASK_POLL_RUNNING_MS);
      }
    };

    void pollTask();

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [folderTagTaskMonitor?.folderPath, folderTagTaskMonitor?.taskId, syncFolderTaskRecord, workspaceId]);

  useEffect(() => {
    if (!documentTagTaskMonitor) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollTask = async () => {
      try {
        const snapshot = await getAffairsDocumentTagTask(workspaceId, documentTagTaskMonitor.documentId);
        if (disposed) {
          return;
        }
        setDocumentTagTaskMonitor((previous) => {
          if (!previous || previous.taskId !== documentTagTaskMonitor.taskId || previous.documentId !== documentTagTaskMonitor.documentId) {
            return previous;
          }
          if (areAffairsTaskSnapshotsEqual(previous.snapshot, snapshot)) {
            return previous;
          }
          const nextMonitor = {
            ...previous,
            snapshot,
          };
          syncDocumentTaskRecord(nextMonitor);
          return nextMonitor;
        });
        if (!snapshot || isTerminalAffairsTaskStatus(snapshot.status)) {
          return;
        }
      } catch {
        if (disposed) {
          return;
        }
      }

      if (!disposed) {
        timer = setTimeout(() => {
          void pollTask();
        }, AFFAIRS_FOLDER_TAG_TASK_POLL_RUNNING_MS);
      }
    };

    void pollTask();

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [documentTagTaskMonitor?.documentId, documentTagTaskMonitor?.taskId, syncDocumentTaskRecord, workspaceId]);

  useEffect(() => {
    if (!fullTagRecomputeTaskMonitor) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollTask = async () => {
      try {
        const recoveryStatus = await getAffairsTagRecoveryStatus(workspaceId);
        const snapshot = recoveryStatus.task;
        if (disposed) {
          return;
        }
        setTagRecoveryStatus((previous) => areAffairsTagRecoveryStatusEqual(previous, recoveryStatus) ? previous : recoveryStatus);
        setFullTagRecomputeTaskMonitor((previous) => {
          if (!previous || previous.taskId !== fullTagRecomputeTaskMonitor.taskId) {
            return previous;
          }
          if (areAffairsTaskSnapshotsEqual(previous.snapshot, snapshot)) {
            return previous;
          }
          return {
            ...previous,
            snapshot,
          };
        });
        if (snapshot && isTerminalAffairsTaskStatus(snapshot.status)) {
          return;
        }
      } catch {
        if (disposed) {
          return;
        }
      }

      if (!disposed) {
        timer = setTimeout(() => {
          void pollTask();
        }, AFFAIRS_FULL_TAG_RECOMPUTE_TASK_POLL_RUNNING_MS);
      }
    };

    void pollTask();

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [fullTagRecomputeTaskMonitor?.taskId, workspaceId]);

  useEffect(() => {
    if (!folderTagTaskMonitor?.snapshot || !isTerminalAffairsTaskStatus(folderTagTaskMonitor.snapshot.status)) {
      return;
    }
    const currentTaskId = folderTagTaskMonitor.taskId;
    const timer = setTimeout(() => {
      setFolderTagTaskMonitor((previous) => previous?.taskId === currentTaskId ? null : previous);
    }, AFFAIRS_FOLDER_TAG_TASK_POLL_TERMINAL_HIDE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [folderTagTaskMonitor?.snapshot?.status, folderTagTaskMonitor?.taskId]);

  useEffect(() => {
    if (!documentTagTaskMonitor?.snapshot || !isTerminalAffairsTaskStatus(documentTagTaskMonitor.snapshot.status)) {
      return;
    }
    const currentTaskId = documentTagTaskMonitor.taskId;
    const timer = setTimeout(() => {
      setDocumentTagTaskMonitor((previous) => previous?.taskId === currentTaskId ? null : previous);
    }, AFFAIRS_FOLDER_TAG_TASK_POLL_TERMINAL_HIDE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [documentTagTaskMonitor?.snapshot?.status, documentTagTaskMonitor?.taskId]);

  useEffect(() => {
    if (!tagManagementOpen) {
      return;
    }
    let disposed = false;
    void getAffairsTagRecoveryStatus(workspaceId)
      .then((recoveryStatus) => {
        if (disposed) {
          return;
        }
        setTagRecoveryStatus((previous) => areAffairsTagRecoveryStatusEqual(previous, recoveryStatus) ? previous : recoveryStatus);
        if (!recoveryStatus.task || fullTagRecomputeTaskMonitor) {
          return;
        }
        setFullTagRecomputeTaskMonitor({
          taskId: recoveryStatus.task.taskId,
          snapshot: recoveryStatus.task,
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [fullTagRecomputeTaskMonitor, tagManagementOpen, workspaceId]);

  useEffect(() => {
    if (!fullTagRecomputeTaskMonitor?.snapshot || !isTerminalAffairsTaskStatus(fullTagRecomputeTaskMonitor.snapshot.status)) {
      return;
    }
    const currentTaskId = fullTagRecomputeTaskMonitor.taskId;
    const timer = setTimeout(() => {
      setFullTagRecomputeTaskMonitor((previous) => previous?.taskId === currentTaskId ? null : previous);
    }, AFFAIRS_FULL_TAG_RECOMPUTE_TASK_POLL_TERMINAL_HIDE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [fullTagRecomputeTaskMonitor?.snapshot?.status, fullTagRecomputeTaskMonitor?.taskId]);

  const reloadTagManagement = async () => {
    if (!binding?.enabled) {
      setManagedTags([]);
      return;
    }
    try {
      const tagTree = await listAffairsTags(workspaceId);
      setManagedTags(tagTree.items);
    } catch {
      setManagedTags([]);
    }
  };

  const syncLibrarySnapshotAfterManagedTagSave = async (
    previousPath: string | null,
    nextPath: string,
  ) => {
    const normalizedPreviousPath = previousPath?.trim() || null;
    const normalizedNextPath = nextPath.trim();
    if (!normalizedNextPath) {
      return;
    }

    const deadlineAt = Date.now() + AFFAIRS_TAG_SAVE_SNAPSHOT_TIMEOUT_MS;
    let latestSnapshot: AffairsLibrarySnapshotDto | null = null;
    while (Date.now() <= deadlineAt) {
      try {
        const snapshot = await getAffairsLibrarySnapshot(workspaceId);
        latestSnapshot = snapshot;
        setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
        writeCachedLibrarySnapshot(workspaceId, snapshot);
        const tagPathSet = new Set((snapshot.tags ?? []).map((item) => item.path));
        const hasNextPath = tagPathSet.has(normalizedNextPath);
        const oldPathCleared = !normalizedPreviousPath
          || normalizedPreviousPath === normalizedNextPath
          || !tagPathSet.has(normalizedPreviousPath);
        if (hasNextPath && oldPathCleared) {
          break;
        }
      } catch {
        // 标签保存后的左侧树刷新失败时先静默重试，不打断保存主流程。
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, AFFAIRS_TAG_SAVE_SNAPSHOT_POLL_MS);
      });
    }

    if (
      normalizedPreviousPath
      && normalizedPreviousPath !== normalizedNextPath
      && state.browseMode === "tag"
      && (
        state.selectedTagPath === normalizedPreviousPath
        || selectedTagPaths.includes(normalizedPreviousPath)
      )
    ) {
      const nextSelectedTagPaths = Array.from(new Set(
        selectedTagPaths.map((tagPath) => tagPath === normalizedPreviousPath ? normalizedNextPath : tagPath),
      ));
      onStateChange({
        ...state,
        selectedTagPath: state.selectedTagPath === normalizedPreviousPath
          ? normalizedNextPath
          : nextSelectedTagPaths[nextSelectedTagPaths.length - 1] ?? null,
        selectedTagPaths: nextSelectedTagPaths,
      });
    }

    if (latestSnapshot && state.browseMode === "tag") {
      const nextPage = await listAffairsLibraryDocuments(workspaceId, {
        browseMode: "tag",
        selectedFolderPath: state.selectedFolderPath,
        selectedTagPath: normalizedPreviousPath && state.selectedTagPath === normalizedPreviousPath
          ? normalizedNextPath
          : state.selectedTagPath,
        selectedTagPaths: normalizedPreviousPath
          ? selectedTagPaths.map((tagPath) => tagPath === normalizedPreviousPath ? normalizedNextPath : tagPath)
          : selectedTagPaths,
        selectedFavoriteId: state.selectedFavoriteId,
        offset: 0,
        limit: LIBRARY_STAGE_PAGE_SIZE,
      }).catch(() => null);
      if (nextPage) {
        setLibraryDocumentPage((previous) => areLibraryDocumentPagesEqual(previous, nextPage) ? previous : nextPage);
        writeCachedLibraryDocumentPage(workspaceId, {
          ...state,
          selectedTagPath: normalizedPreviousPath && state.selectedTagPath === normalizedPreviousPath
            ? normalizedNextPath
            : state.selectedTagPath,
          selectedTagPaths: normalizedPreviousPath
            ? selectedTagPaths.map((tagPath) => tagPath === normalizedPreviousPath ? normalizedNextPath : tagPath)
            : selectedTagPaths,
        }, nextPage);
      }
    }
  };

  useEffect(() => {
    if (activeSection !== "library" || !binding?.enabled || state.browseMode !== "folder") {
      return;
    }

    const nextDirectoryHintKey = buildDirectoryHintKey(
      activeSection,
      state.browseMode,
      state.selectedFolderPath,
      null
    );
    if (directoryHintKeyRef.current === nextDirectoryHintKey) {
      return;
    }

    if (!directoryHintBootstrappedRef.current) {
      directoryHintBootstrappedRef.current = true;
      directoryHintKeyRef.current = nextDirectoryHintKey;
      return;
    }

    directoryHintKeyRef.current = nextDirectoryHintKey;
    void Promise.resolve(requestAffairsLibraryRefresh(workspaceId, {
      reason: "directory_hint",
      targetPath: state.selectedFolderPath?.trim() || null
    })).catch(() => {
      // 目录 hint 刷新失败不影响当前快照展示，后面还有轮询和手动刷新兜底。
    });
  }, [
    activeSection,
    binding?.enabled,
    state.browseMode,
    state.selectedFolderPath,
    workspaceId
  ]);

  useEffect(() => {
    let disposed = false;
    const cachedSnapshot = readCachedLibrarySnapshot(workspaceId);
    const cachedConfig = readCachedLibraryConfig(workspaceId);
    setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, cachedSnapshot) ? previous : cachedSnapshot);
    setLibraryConfig((previous) => areLibraryConfigsEqual(previous, cachedConfig) ? previous : cachedConfig);
    setLibraryLoading(cachedSnapshot === null);
    setLibraryError(null);
    void getAffairsLibrarySnapshot(workspaceId)
      .then((libraryResponse) => {
        if (disposed) {
          return;
        }
        setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, libraryResponse) ? previous : libraryResponse);
        writeCachedLibrarySnapshot(workspaceId, libraryResponse);
        setLibraryLoading(false);
      })
      .catch((requestError) => {
        if (disposed) {
          return;
        }
        setLibraryError(requestError instanceof Error ? requestError.message : t("shell.navigationLoadFailed"));
        setLibraryLoading(false);
      });

    void getAffairsLibraryConfig(workspaceId)
      .then((configResponse) => {
        if (disposed) {
          return;
        }
        setLibraryConfig((previous) => areLibraryConfigsEqual(previous, configResponse) ? previous : configResponse);
        writeCachedLibraryConfig(workspaceId, configResponse);
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        if (!cachedConfig) {
          setLibraryConfig(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    let disposed = false;

    void getGlobalAffairsLibraryBinding()
      .then((bindingResponse) => {
        if (disposed) {
          return;
        }
        setGlobalLibraryBinding((previous) => (
          areAffairsLibraryBindingsEqual(previous, bindingResponse) ? previous : bindingResponse
        ));
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        setGlobalLibraryBinding(null);
      });

    return () => {
      disposed = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    void reloadTagManagement();
  }, [binding?.enabled, workspaceId]);

  useEffect(() => {
    if (!librarySnapshot?.binding?.enabled) {
      return;
    }

    const pollIntervalMs = librarySnapshot.status.state === "fresh"
      ? AFFAIRS_LIBRARY_STATUS_POLL_IDLE_MS
      : AFFAIRS_LIBRARY_STATUS_POLL_ACTIVE_MS;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      timer = setTimeout(() => {
        void pollSnapshot();
      }, pollIntervalMs);
    };

    const pollSnapshot = async () => {
      try {
        const snapshot = await getAffairsLibrarySnapshot(workspaceId);
        if (disposed) {
          return;
        }
        setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
        writeCachedLibrarySnapshot(workspaceId, snapshot);
      } catch {
        if (disposed) {
          return;
        }
      }

      if (!disposed) {
        scheduleNext();
      }
    };

    scheduleNext();
    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    librarySnapshot?.binding?.enabled,
    librarySnapshot?.status?.state,
    workspaceId
  ]);

  useEffect(() => {
    let disposed = false;

    setTodoLoading(true);
    setTodoError(null);
    void Promise.all([listButlerInboxItems({ workspaceId }), listButlerFollowUpTasks()])
      .then(([inboxResponse, followUpResponse]) => {
        if (disposed) {
          return;
        }
        setInboxItems(inboxResponse.items.filter((item) => item.workspaceId === workspaceId));
        setFollowUpTasks(followUpResponse.items.filter((item) => item.workspaceId === workspaceId));
        setTodoLoading(false);
      })
      .catch((requestError) => {
        if (disposed) {
          return;
        }
        setTodoError(requestError instanceof Error ? requestError.message : t("shell.navigationLoadFailed"));
        setTodoLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    let disposed = false;

    setAutomationLoading(true);
    setAutomationError(null);
    void Promise.all([listAssistantAutomations({ limit: 200 }), listRecentAssistantAutomationRuns({ limit: 200 })])
      .then(([automationResponse, automationRunResponse]) => {
        if (disposed) {
          return;
        }
        setAutomations(
          automationResponse.payload.items.filter((item) => {
            const targetSessionId = item.actionConfig.targetSessionId?.trim() ?? "";
            const controlSessionId = item.controlSession?.sessionId?.trim() ?? "";
            return (
              workspaceSessionIdSet.size === 0
              || workspaceSessionIdSet.has(targetSessionId)
              || workspaceSessionIdSet.has(controlSessionId)
            );
          })
        );
        setAutomationRuns(automationRunResponse.payload.items);
        setAutomationLoading(false);
      })
      .catch((requestError) => {
        if (disposed) {
          return;
        }
        setAutomationError(requestError instanceof Error ? requestError.message : t("shell.navigationLoadFailed"));
        setAutomationLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [workspaceId, workspaceSessionIdSet, workspaceSessionIdSignature]);

  const libraryDocumentItems = libraryDocumentPage?.items ?? [];
  const documentRecords = useMemo(
    () => buildDocumentRecordsFromSnapshot(libraryDocumentItems, binding?.rootDir ?? null),
    [binding?.rootDir, libraryDocumentItems]
  );
  const favoriteDocuments = useMemo(
    () => documentRecords.filter((record) => record.isFavorite),
    [documentRecords]
  );
  const tagRecords = useMemo(
    () => buildTagRecordsFromSnapshot(librarySnapshot?.tags ?? []).filter(isVisibleTagRecord),
    [librarySnapshot?.tags]
  );
  const folderRecords = useMemo(() => buildFolderRecordsFromSnapshot(librarySnapshot?.folders ?? []), [librarySnapshot?.folders]);
  const favoriteEntries = useMemo(() => librarySnapshot?.favorites ?? [], [librarySnapshot?.favorites]);
  const favoriteFolderPathSet = useMemo(
    () => new Set(favoriteEntries.filter((item) => item.kind === "folder").map((item) => item.path)),
    [favoriteEntries]
  );
  const selectedTagPaths = useMemo(
    () => resolveSelectedTagPaths(state),
    [state.selectedTagPath, state.selectedTagPaths]
  );
  const libraryTagFacetCounts = useMemo(
    () => libraryDocumentPage?.tagFacetCounts ?? {},
    [libraryDocumentPage?.tagFacetCounts]
  );
  const effectiveSelectedFolderPath = useMemo(
    () => state.selectedFolderPath?.trim() || null,
    [state.selectedFolderPath]
  );
  const libraryDocumentAutoReloadVersion = useMemo(
    () => state.browseMode === "folder" ? librarySnapshot?.status?.lastCompletedAt ?? null : null,
    [librarySnapshot?.status?.lastCompletedAt, state.browseMode]
  );

  useEffect(() => {
    if (activeSection !== "library" || !binding?.enabled || state.browseMode !== "folder") {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const indexRunning = indexStatus?.state === "running";
    const pollIntervalMs = indexRunning
      ? AFFAIRS_LIBRARY_DIRECTORY_POLL_PAUSED_DURING_INDEX_MS
      : (
        currentDirectoryStatus?.state === "queued"
        || currentDirectoryStatus?.state === "running"
          ? AFFAIRS_LIBRARY_DIRECTORY_POLL_ACTIVE_MS
          : AFFAIRS_LIBRARY_DIRECTORY_POLL_IDLE_MS
      );

    const pollDirectory = async () => {
      if (indexRunning) {
        if (!disposed) {
          timer = setTimeout(() => {
            void pollDirectory();
          }, pollIntervalMs);
        }
        return;
      }

      try {
        const response = await listAffairsLibraryDocuments(workspaceId, {
          browseMode: "folder",
          selectedFolderPath: effectiveSelectedFolderPath,
          selectedTagPath: state.selectedTagPath,
          selectedTagPaths,
          selectedFavoriteId: state.selectedFavoriteId,
          offset: 0,
          limit: LIBRARY_STAGE_PAGE_SIZE
        });
        if (!disposed) {
          setLibraryDocumentPage((previous) => areLibraryDocumentPagesEqual(previous, response) ? previous : response);
          writeCachedLibraryDocumentPage(workspaceId, state, response);
        }
      } catch {
        // 目录实时轮询失败不打断当前页面，下一轮继续尝试。
      }

      if (!disposed) {
        timer = setTimeout(() => {
          void pollDirectory();
        }, pollIntervalMs);
      }
    };

    timer = setTimeout(() => {
      void pollDirectory();
    }, pollIntervalMs);

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    activeSection,
    binding?.enabled,
    currentDirectoryStatus?.state,
    indexStatus?.state,
    selectedTagPaths,
    state.browseMode,
    state.selectedFavoriteId,
    state.selectedFolderEntryPath,
    state.selectedFolderPath,
    state.selectedTagPath,
    effectiveSelectedFolderPath,
    workspaceId
  ]);

  const filteredDocuments = useMemo(() => {
    if (activeSection !== "library" || !binding) {
      return [];
    }
    return documentRecords;
  }, [
    activeSection,
    binding,
    documentRecords,
  ]);

  const refreshLibraryNow = async () => {
    setLibraryRefreshPending(true);
    try {
      await requestAffairsLibraryRefresh(workspaceId, { reason: "manual_refresh" });
      const snapshot = await getAffairsLibrarySnapshot(workspaceId);
      setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
      writeCachedLibrarySnapshot(workspaceId, snapshot);
      if (activeSection === "library" && binding) {
        setLibraryDocumentsLoading(true);
        try {
          const response = await listAffairsLibraryDocuments(workspaceId, {
            browseMode: state.browseMode,
            selectedFolderPath: effectiveSelectedFolderPath,
            selectedTagPath: state.selectedTagPath,
            selectedTagPaths,
            selectedFavoriteId: state.selectedFavoriteId,
            offset: 0,
            limit: LIBRARY_STAGE_PAGE_SIZE
          });
          setLibraryDocumentPage((previous) => areLibraryDocumentPagesEqual(previous, response) ? previous : response);
          writeCachedLibraryDocumentPage(workspaceId, state, response);
        } finally {
          setLibraryDocumentsLoading(false);
        }
      }
      showToast({
        title: t("shell.affairsLibraryRefreshQueued"),
        description: t("shell.affairsLibraryRefreshQueuedDescription"),
        tone: "success"
      });
    } catch (requestError) {
      showToast({
        title: t("shell.affairsLibraryRefreshFailed"),
        description: requestError instanceof Error ? requestError.message : t("shell.affairsLibraryRefreshFailed"),
        tone: "error"
      });
      throw requestError;
    } finally {
      setLibraryRefreshPending(false);
    }
  };

  useEffect(() => {
    if (activeSection !== "library" || !binding?.enabled) {
      setLibraryDocumentPage(null);
      setLibraryDocumentsLoading(false);
      return;
    }

    let disposed = false;
    const cachedPage = readCachedLibraryDocumentPage(workspaceId, state);
    if (cachedPage) {
      setLibraryDocumentPage((previous) => areLibraryDocumentPagesEqual(previous, cachedPage) ? previous : cachedPage);
      setLibraryDocumentsLoading(false);
    } else {
      setLibraryDocumentPage(null);
      setLibraryDocumentsLoading(true);
    }
    void listAffairsLibraryDocuments(workspaceId, {
      browseMode: state.browseMode,
      selectedFolderPath: effectiveSelectedFolderPath,
      selectedTagPath: state.selectedTagPath,
      selectedTagPaths,
      selectedFavoriteId: state.selectedFavoriteId,
      offset: 0,
      limit: LIBRARY_STAGE_PAGE_SIZE
    })
      .then((response) => {
        if (disposed) {
          return;
        }
        const nextPage = mergeInitialLibraryDocumentPage(cachedPage, response);
        setLibraryDocumentPage((previous) => areLibraryDocumentPagesEqual(previous, nextPage) ? previous : nextPage);
        writeCachedLibraryDocumentPage(workspaceId, state, nextPage);
        setLibraryDocumentsLoading(false);
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        if (!cachedPage) {
          setLibraryDocumentPage({
            total: 0,
            offset: 0,
            limit: LIBRARY_STAGE_PAGE_SIZE,
            items: []
          });
        }
        setLibraryDocumentsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [
    activeSection,
    binding?.enabled,
    libraryDocumentAutoReloadVersion,
    state.browseMode,
    state.selectedFavoriteId,
    state.selectedFolderEntryPath,
    state.selectedFolderPath,
    state.selectedTagPath,
    selectedTagPaths,
    effectiveSelectedFolderPath,
    workspaceId
  ]);

  const loadMoreLibraryDocuments = async () => {
    if (activeSection !== "library" || !binding || libraryDocumentsLoading) {
      return;
    }

    const currentPage = libraryDocumentPage;
    const currentCount = currentPage?.items.length ?? 0;
    const total = currentPage?.total ?? 0;
    if (currentPage && currentCount >= total) {
      return;
    }

    setLibraryDocumentsLoading(true);
    try {
      const response = await listAffairsLibraryDocuments(workspaceId, {
        browseMode: state.browseMode,
        selectedFolderPath: effectiveSelectedFolderPath,
        selectedTagPath: state.selectedTagPath,
        selectedTagPaths,
        selectedFavoriteId: state.selectedFavoriteId,
        offset: currentCount,
        limit: LIBRARY_STAGE_PAGE_SIZE
      });
      setLibraryDocumentPage((previous) => {
        const nextPage = mergePagedLibraryDocumentPage(previous, response);
        writeCachedLibraryDocumentPage(workspaceId, state, nextPage);
        return areLibraryDocumentPagesEqual(previous, nextPage) ? previous : nextPage;
      });
    } finally {
      setLibraryDocumentsLoading(false);
    }
  };

  const todoRecords = useMemo(() => buildTodoRecords(inboxItems, followUpTasks), [followUpTasks, inboxItems]);
  const activeWorkbenchNodeId = useMemo(
    () => activeSection === "workbench" ? normalizeWorkbenchNodeId(state.selectedNodeId) : state.selectedNodeId,
    [activeSection, state.selectedNodeId]
  );

  const filteredTodoRecords = useMemo(() => {
    if (activeSection !== "workbench") {
      return [];
    }

    if (
      !activeWorkbenchNodeId
      || activeWorkbenchNodeId === "workbench:overview"
      || activeWorkbenchNodeId === "workbench:todo:all"
    ) {
      return todoRecords;
    }

    if (activeWorkbenchNodeId === "workbench:todo:inbox") {
      return todoRecords.filter((item) => item.kind === "inbox");
    }

    if (activeWorkbenchNodeId === "workbench:todo:follow_up") {
      return todoRecords.filter((item) => item.kind === "follow_up");
    }

    return todoRecords;
  }, [activeSection, activeWorkbenchNodeId, todoRecords]);
  const automationRecords = useMemo(
    () => buildAutomationRecords(automations, sessionTitleById),
    [automations, sessionTitleById]
  );
  const loading =
    activeSection === "library"
      ? libraryLoading
      : activeSection === "conversation"
        ? false
        : todoLoading || automationLoading;
  const error =
    activeSection === "library"
      ? libraryError
      : activeSection === "conversation"
        ? null
        : todoError ?? automationError;

  const selectedObject = useMemo<AffairsSelectedObject>(() => {
    if (activeSection === "library") {
      const selectedId = state.selectedDocumentId ?? state.selectedObjectId;
      const record = filteredDocuments.find((item) => item.id === selectedId) ?? null;
      const selectedFolderEntryPath = normalizeFolderPath(state.selectedFolderEntryPath);
      const activeFolderPath = normalizeFolderPath(state.selectedFolderPath);
      return {
        section: "library",
        record: record ?? (selectedFolderEntryPath && selectedFolderEntryPath !== activeFolderPath ? null : record)
      };
    }

    if (activeSection === "conversation") {
      return {
        section: "conversation",
        record: null
      };
    }

    if (!activeWorkbenchNodeId || activeWorkbenchNodeId === "workbench:overview") {
      return {
        section: "workbench",
        record: null
      };
    }

    if (activeWorkbenchNodeId.startsWith("workbench:todo:")) {
      const record = filteredTodoRecords.find((item) => item.id === state.selectedObjectId) ?? filteredTodoRecords[0] ?? null;
      return {
        section: "todo",
        record
      };
    }

    if (activeWorkbenchNodeId.startsWith("workbench:automation:")) {
      const nodeAutomationId = activeWorkbenchNodeId.startsWith("workbench:automation:item:")
        ? activeWorkbenchNodeId.slice("workbench:automation:item:".length)
        : null;
      const record = automationRecords.find((item) => item.id === (state.selectedObjectId ?? nodeAutomationId)) ?? automationRecords[0] ?? null;
      return {
        section: "automation",
        record
      };
    }

    return {
      section: "workbench",
      record: null
    };
  }, [
    activeSection,
    activeWorkbenchNodeId,
    automationRecords,
    filteredDocuments,
    filteredTodoRecords,
    state.selectedDocumentId,
    state.selectedFolderEntryPath,
    state.selectedFolderPath,
    state.selectedObjectId
  ]);

  useEffect(() => {
    if (!binding?.enabled) {
      setDocumentTagDetails(null);
      return;
    }
    if (selectedObject.section === "library" && selectedObject.record?.id) {
      void getAffairsDocumentTagDetails(workspaceId, selectedObject.record.id)
        .then(setDocumentTagDetails)
        .catch(() => setDocumentTagDetails(null));
      return;
    }
    setDocumentTagDetails(null);
  }, [binding?.enabled, selectedObject, workspaceId]);

  useEffect(() => {
    if (!binding?.enabled) {
      setFolderTagDetails(null);
      return;
    }
    if (selectedObject.section === "library" && !selectedObject.record) {
      const folderPath = state.selectedFolderEntryPath?.trim() || state.selectedFolderPath?.trim() || ".";
      void getAffairsFolderTagDetails(workspaceId, folderPath)
        .then(setFolderTagDetails)
        .catch(() => setFolderTagDetails(null));
      return;
    }
    setFolderTagDetails(null);
  }, [binding?.enabled, selectedObject, state.selectedFolderEntryPath, state.selectedFolderPath, workspaceId]);

  useEffect(() => {
    const selectedId = activeSection === "library"
      ? (selectedObject.record?.id ?? state.selectedDocumentId ?? state.selectedObjectId ?? null)
      : (selectedObject.record?.id ?? null);
    const defaultNodeId = resolveDefaultNodeId(activeSection, automationRecords, binding);

    const nextState: AffairsViewState = {
      ...state,
      primarySection: activeSection,
      selectedNodeId: activeSection === "library"
        ? state.selectedNodeId ?? defaultNodeId
        : (activeSection === "workbench" ? activeWorkbenchNodeId ?? defaultNodeId : state.selectedNodeId ?? defaultNodeId),
      selectedObjectId: selectedId,
      selectedDocumentId: activeSection === "library" ? selectedId : state.selectedDocumentId
    };

    if (JSON.stringify(nextState) === JSON.stringify(state)) {
      return;
    }

    onStateChange(nextState);
  }, [activeSection, activeWorkbenchNodeId, automationRecords, binding, onStateChange, selectedObject.record, state]);

  const currentObjectAssistantContext = useMemo<AffairsObjectContext | null>(() => {
    if (selectedObject.section === "library") {
      const record = selectedObject.record;
      return record
        ? {
            objectType: "document",
            objectId: record.id,
            title: record.displayName,
            summary: record.summary,
            sourceRef: record.filePath,
            assistantScope: `workspace:${workspaceId}:document:${record.id}`
          }
        : null;
    }

    if (selectedObject.section === "todo") {
      const record = selectedObject.record;
      return record
        ? {
            objectType: "todo",
            objectId: record.id,
            title: record.title,
            summary: `${record.statusLabel} · ${record.summary}`,
            sourceRef: record.sourceSessionId,
            assistantScope: `workspace:${workspaceId}:todo:${record.id}`
          }
        : null;
    }

    if (selectedObject.section === "conversation") {
      return null;
    }

    if (selectedObject.section === "workbench") {
      return null;
    }

    const record = selectedObject.record;
    return record
      ? {
          objectType: "automation",
          objectId: record.id,
          title: record.title,
          summary: `${record.statusLabel} · ${record.summary}`,
          sourceRef: record.targetSessionLabel,
          assistantScope: `workspace:${workspaceId}:automation:${record.id}`
        }
      : null;
  }, [selectedObject, workspaceId]);

  const workbenchAssistantContext = useMemo<AffairsObjectContext | null>(() => {
    if (activeSection !== "workbench") {
      return null;
    }

    const scopeLabel = resolveAffairsWorkbenchAssistantScopeLabel(activeWorkbenchNodeId);
    const todoTitles = filteredTodoRecords
      .map((record) => record.title?.trim() || "")
      .filter(Boolean)
      .slice(0, 3);
    const summary = filteredTodoRecords.length > 0
      ? (
        todoTitles.length > 0
          ? t("shell.affairsWorkbenchAssistantContextSummary", {
            scopeLabel,
            count: filteredTodoRecords.length,
            titles: todoTitles.join("、")
          })
          : t("shell.affairsWorkbenchAssistantContextSummaryCompact", {
            scopeLabel,
            count: filteredTodoRecords.length
          })
      )
      : t("shell.affairsWorkbenchAssistantContextEmpty");

    return {
      objectType: "workbench",
      objectId: `workbench:${workspaceId}:${normalizeWorkbenchNodeId(activeWorkbenchNodeId) ?? "overview"}`,
      title: t("shell.affairsWorkbenchAssistantContextTitle"),
      summary,
      sourceRef: scopeLabel,
      assistantScope: `workspace:${workspaceId}:workbench:todo`
    };
  }, [activeSection, activeWorkbenchNodeId, filteredTodoRecords, workspaceId]);

  useEffect(() => {
    if (!currentObjectAssistantContext) {
      return;
    }
    setLastObjectAssistantContext((previous) => areAffairsObjectContextsEqual(previous, currentObjectAssistantContext) ? previous : currentObjectAssistantContext);
  }, [currentObjectAssistantContext]);

  const assistantContext = activeSection === "workbench"
    ? workbenchAssistantContext
    : activeSection === "conversation"
      ? (currentObjectAssistantContext ?? lastObjectAssistantContext)
      : currentObjectAssistantContext;

  const sidebarNodes = useMemo<AffairsSidebarNode[]>(() => {
    if (activeSection === "library") {
      return [];
    }

    if (activeSection === "conversation") {
      const lightweightNodes = (Array.isArray(lightweightConversationSessions) ? lightweightConversationSessions : []).map<AffairsSidebarNode>((session) => ({
        id: buildAffairsConversationSessionNodeId("lightweight", session.sessionId),
        label: session.title,
        summary: [
          resolveAffairsConversationKindLabel("lightweight"),
          resolveAffairsConversationProviderLabel(session.provider),
          session.lastMessageAt ? formatRelativeMeta(session.lastMessageAt) : null
        ].filter(Boolean).join(" · "),
        tone: "conversation"
      }));
      const currentAgentSession = isAffairsControlSessionMatchWorkspaceId(butlerControlSession, agentWorkspaceId)
        ? (butlerControlSession?.session ?? null)
        : null;
      const safeAgentConversationSessions = Array.isArray(agentConversationSessions) ? agentConversationSessions : [];
      const agentItems = currentAgentSession
        ? [currentAgentSession, ...safeAgentConversationSessions.filter((session) => session.sessionId !== currentAgentSession.sessionId)]
        : safeAgentConversationSessions;
      const agentNodes = agentItems.map<AffairsSidebarNode>((session) => ({
        id: buildAffairsConversationSessionNodeId("agent", session.sessionId),
        label: session.title,
        summary: [
          resolveAffairsConversationKindLabel("agent"),
          resolveAffairsConversationProviderLabel(session.provider),
          session.lastMessageAt ? formatRelativeMeta(session.lastMessageAt) : null
        ].filter(Boolean).join(" · "),
        tone: "conversation"
      }));
      return [...lightweightNodes, ...agentNodes];
    }

    if (activeSection === "workbench") {
      return [
        {
          id: "workbench:overview",
          label: t("shell.affairsWorkbenchOverviewLabel"),
          count: todoRecords.length + automationRecords.length,
          summary: t("shell.affairsWorkbenchOverviewSummary", {
            todoCount: todoRecords.length,
            automationCount: automationRecords.length
          }),
          tone: "workbench"
        },
        {
          id: "workbench:todo:all",
          label: t("shell.affairsTodoAllFilter"),
          count: todoRecords.length,
          summary: t("shell.affairsTodoAllFilterSummary"),
          tone: "default"
        },
        {
          id: "workbench:todo:inbox",
          label: t("shell.affairsTodoInboxFilter"),
          count: todoRecords.filter((item) => item.kind === "inbox").length,
          summary: t("shell.affairsTodoInboxSummary"),
          tone: "source"
        },
        {
          id: "workbench:todo:follow_up",
          label: t("shell.affairsTodoFollowUpFilter"),
          count: todoRecords.filter((item) => item.kind === "follow_up").length,
          summary: t("shell.affairsTodoFollowUpSummary"),
          tone: "source"
        },
        ...automationRecords.map<AffairsSidebarNode>((record) => ({
          id: `workbench:automation:item:${record.id}`,
          label: record.title,
          summary: `${record.triggerLabel} · ${record.statusLabel}`,
          tone: "automation"
        }))
      ];
    }

    return [];
  }, [
    agentWorkspacePath,
    activeSection,
    agentWorkspaceId,
    automationRecords,
    butlerControlSession,
    documentRecords.length,
    favoriteEntries,
    folderRecords,
    lightweightConversationSessions,
    state.browseMode,
    tagRecords,
    todoRecords,
    workspaceSessions
  ]);

  const rememberConversationDraft = useCallback((draft: AffairsConversationDraftSelection) => {
    lastConversationNodeIdRef.current = buildAffairsConversationDraftNodeId(draft);
    setConversationRuntimeSeed(null);
    setSelectedConversationSession(null);
    setSelectedConversationDraft(draft);
  }, []);

  const rememberConversationSession = useCallback((input: {
    kind: AffairsConversationKind;
    session: SessionSummaryDto;
    bootstrapMessages: HistoryMessageDto[];
  }) => {
    const seenAt = new Date().toISOString();
    const nextSession = markAffairsSessionSeen(input.session, seenAt);
    if (input.kind === "lightweight") {
      setLightweightConversationSessions((current) => upsertConversationSessionSummary(current, nextSession));
      setAgentConversationSessions((current) => current.map((item) => (
        item.sessionId === nextSession.sessionId ? nextSession : item
      )));
    } else {
      setLightweightConversationSessions((current) => current.map((item) => (
        item.sessionId === nextSession.sessionId ? nextSession : item
      )));
      setAgentConversationSessions((current) => upsertConversationSessionSummary(current, nextSession));
    }
    setSelectedConversationDraft(null);
    setConversationRuntimeSeed({
      kind: input.kind,
      session: nextSession,
      bootstrapMessages: input.bootstrapMessages
    });
    setSelectedConversationSession({
      kind: input.kind,
      sessionId: nextSession.sessionId
    });
    lastConversationNodeIdRef.current = buildAffairsConversationSessionNodeId(input.kind, nextSession.sessionId);
    void Promise.resolve(
      input.kind === "lightweight"
        ? markAffairsLightweightSessionSeen(workspaceId, nextSession.sessionId, seenAt)
        : markSessionSeen(nextSession.sessionId)
    ).catch(() => undefined);
  }, [workspaceId]);

  useEffect(() => {
    let disposed = false;
    setDashboardRemoteReady(false);

    void getGlobalAffairsDashboardState().then((response) => {
      if (disposed) {
        return;
      }
      const remoteStateMissing = isEmptyDashboardStatePayload(response.dashboardState);
      const nextState = remoteStateMissing
        ? resolveInitialDashboardState(workspaceId)
        : normalizeGlobalDashboardState(response.dashboardState);
      const serializedNextState = JSON.stringify(nextState);
      lastSyncedDashboardSerializedRef.current = remoteStateMissing ? null : serializedNextState;
      setDashboardState((current) => (
        JSON.stringify(current) === serializedNextState ? current : nextState
      ));
      writeGlobalDashboardStateSnapshot(nextState);
      setDashboardRemoteReady(true);
    }).catch(() => {
      if (disposed) {
        return;
      }
      const fallbackState = resolveInitialDashboardState(workspaceId);
      const serializedFallbackState = JSON.stringify(fallbackState);
      lastSyncedDashboardSerializedRef.current = serializedFallbackState;
      setDashboardState((current) => (
        JSON.stringify(current) === serializedFallbackState ? current : fallbackState
      ));
      setDashboardRemoteReady(true);
    });

    return () => {
      disposed = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    writeGlobalDashboardStateSnapshot(dashboardState);
  }, [dashboardState]);

  useEffect(() => {
    if (!dashboardRemoteReady) {
      return;
    }

    const normalizedDashboardState = normalizeGlobalDashboardState(dashboardState);
    const serializedDashboardState = JSON.stringify(normalizedDashboardState);

    if (lastSyncedDashboardSerializedRef.current === serializedDashboardState) {
      return;
    }

    if (dashboardSyncTimerRef.current) {
      clearTimeout(dashboardSyncTimerRef.current);
    }

    dashboardSyncTimerRef.current = setTimeout(() => {
      void updateGlobalAffairsDashboardState({
        dashboardState: normalizedDashboardState
      }).then((response) => {
        const nextState = normalizeGlobalDashboardState(response.dashboardState);
        const serializedNextState = JSON.stringify(nextState);
        lastSyncedDashboardSerializedRef.current = serializedNextState;
        writeGlobalDashboardStateSnapshot(nextState);
        setDashboardState((current) => (
          JSON.stringify(current) === serializedNextState ? current : nextState
        ));
      }).catch(() => undefined);
    }, AFFAIRS_DASHBOARD_REMOTE_SYNC_DEBOUNCE_MS);

    return () => {
      if (dashboardSyncTimerRef.current) {
        clearTimeout(dashboardSyncTimerRef.current);
        dashboardSyncTimerRef.current = null;
      }
    };
  }, [dashboardRemoteReady, dashboardState]);

  const selectDashboardTab = useCallback((tabId: string) => {
    setDashboardState((current) => {
      if (!current.tabs.some((tab) => tab.id === tabId) || current.activeTabId === tabId) {
        return current;
      }

      return {
        ...current,
        activeTabId: tabId,
        updatedAt: new Date().toISOString()
      };
    });
  }, []);

  const addDashboardTab = useCallback(() => {
    setDashboardState((current) => {
      const timestamp = new Date().toISOString();
      const nextTab = createEmptyAffairsDashboardTabState(
        t("shell.affairsWorkbenchNewTabTitle", { count: current.tabs.length + 1 }),
        timestamp
      );

      return {
        ...current,
        activeTabId: nextTab.id,
        tabs: [...current.tabs, nextTab],
        updatedAt: timestamp
      };
    });
  }, []);

  const renameDashboardTab = useCallback((tabId: string, title: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }

    setDashboardState((current) => updateDashboardTabById(current, tabId, (tab, timestamp) => {
      if (tab.title === normalizedTitle) {
        return tab;
      }
      return {
        ...tab,
        title: normalizedTitle,
        updatedAt: timestamp
      };
    }));
  }, []);

  const removeDashboardTab = useCallback((tabId: string) => {
    setDashboardState((current) => {
      if (current.tabs.length <= 1 || !current.tabs.some((tab) => tab.id === tabId)) {
        return current;
      }

      const timestamp = new Date().toISOString();
      const removedIndex = current.tabs.findIndex((tab) => tab.id === tabId);
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveTabId = current.activeTabId === tabId
        ? (tabs[Math.max(0, removedIndex - 1)]?.id ?? tabs[0]?.id ?? current.activeTabId)
        : current.activeTabId;

      return {
        ...current,
        tabs,
        activeTabId: nextActiveTabId,
        updatedAt: timestamp
      };
    });
  }, []);

  const toggleDashboardLayoutLocked = useCallback(() => {
    setDashboardState((current) => ({
      ...current,
      layoutLocked: !current.layoutLocked,
      updatedAt: new Date().toISOString()
    }));
  }, []);

  const addDashboardWidget = useCallback((input: {
    type: DashboardWidgetType;
    variant?: DashboardHtmlWidgetVariant;
    title?: string;
    sourceRef?: DashboardWidgetSourceRef;
    config?: Record<string, unknown>;
  }) => {
    setDashboardState((current) => updateDashboardTabById(current, current.activeTabId, (tab, timestamp) => {
      const nextWidget = createAffairsDashboardWidgetState(
        {
          type: input.type,
          variant: input.variant,
          title: input.title,
          sourceRef: input.sourceRef,
          config: input.config,
        },
        timestamp
      );
      const widgets = [...tab.widgets, nextWidget];
      return {
        ...tab,
        widgets,
        layout: buildDashboardWidgetLayout(widgets, tab.layout),
        updatedAt: timestamp
      };
    }));
  }, []);

  const updateDashboardWidgetConfig = useCallback((widgetId: string, patch: Record<string, unknown>) => {
    setDashboardState((current) => updateDashboardTabById(current, current.activeTabId, (tab, timestamp) => ({
      ...tab,
      widgets: tab.widgets.map((widget) => widget.id === widgetId
        ? {
            ...widget,
            config: {
              ...widget.config,
              ...patch
            },
            updatedAt: timestamp
          }
        : widget),
      updatedAt: timestamp
    })));
  }, []);

  const setDashboardWidgetLayout = useCallback((widgetId: string, nextLayout: Partial<DashboardWidgetLayout>) => {
    setDashboardState((current) => updateDashboardTabById(current, current.activeTabId, (tab, timestamp) => {
      const widgets = tab.widgets;
      const currentLayout = tab.layout.find((item) => item.widgetId === widgetId);
      if (!currentLayout) {
        return tab;
      }

      const layout = buildDashboardWidgetLayout(
        widgets,
        tab.layout.map((item) => item.widgetId === widgetId ? { ...item, ...nextLayout, widgetId } : item),
        false,
        widgetId
      );
      return {
        ...tab,
        layout,
        updatedAt: timestamp
      };
    }));
  }, []);

  const removeDashboardWidget = useCallback((widgetId: string) => {
    setDashboardState((current) => updateDashboardTabById(current, current.activeTabId, (tab, timestamp) => {
      const widgets = tab.widgets.filter((widget) => widget.id !== widgetId);
      return {
        ...tab,
        widgets,
        layout: buildDashboardWidgetLayout(widgets, tab.layout),
        updatedAt: timestamp
      };
    }));
  }, []);

  const resetActiveDashboardLayout = useCallback(() => {
    setDashboardState((current) => updateDashboardTabById(current, current.activeTabId, (tab, timestamp) => ({
      ...tab,
      layout: buildDashboardWidgetLayout(tab.widgets, tab.layout, true),
      updatedAt: timestamp
    })));
  }, []);

  const addShortcutApp = useCallback((input: { title?: string; sourceKind?: ShortcutAppSourceKind; workspaceId: string; entryPath: string }) => {
    setDashboardState((current) => {
      const sourceKind: ShortcutAppSourceKind = input.sourceKind === "affairs_library" ? "affairs_library" : "workspace";
      const sourceWorkspaceId = input.workspaceId.trim();
      const normalizedPath = input.entryPath.trim();
      const timestamp = new Date().toISOString();
      const existingIndex = current.shortcutApps.findIndex((item) => (
        item.sourceKind === sourceKind && item.workspaceId === sourceWorkspaceId && item.entryPath === normalizedPath
      ));

      if (existingIndex >= 0) {
        const nextShortcut = {
          ...current.shortcutApps[existingIndex],
          title: resolveWorkspaceHtmlSourceTitle(normalizedPath, input.title),
          sourceKind,
          workspaceId: sourceWorkspaceId,
          updatedAt: timestamp
        };
        const shortcutApps = [...current.shortcutApps];
        shortcutApps.splice(existingIndex, 1);
        shortcutApps.unshift(nextShortcut);
        return {
          ...current,
          shortcutApps,
          updatedAt: timestamp
        };
      }

      return {
        ...current,
        shortcutApps: [
          createAffairsShortcutAppState(
            {
              title: input.title,
              sourceKind,
              workspaceId: sourceWorkspaceId,
              entryPath: normalizedPath,
              sourceId: normalizedPath,
            },
            timestamp
          ),
          ...current.shortcutApps,
        ],
        updatedAt: timestamp
      };
    });
  }, []);

  const updateShortcutApp = useCallback((shortcutId: string, input: { title?: string; sourceKind?: ShortcutAppSourceKind; workspaceId: string; entryPath: string }) => {
    setDashboardState((current) => {
      const sourceKind: ShortcutAppSourceKind = input.sourceKind === "affairs_library" ? "affairs_library" : "workspace";
      const sourceWorkspaceId = input.workspaceId.trim();
      const normalizedPath = input.entryPath.trim();
      const timestamp = new Date().toISOString();
      const targetShortcut = current.shortcutApps.find((item) => item.id === shortcutId);
      if (!targetShortcut) {
        return current;
      }

      const duplicateShortcut = current.shortcutApps.find((item) => (
        item.id !== shortcutId
        && item.sourceKind === sourceKind
        && item.workspaceId === sourceWorkspaceId
        && item.entryPath === normalizedPath
      ));

      const nextShortcut = {
        ...targetShortcut,
        title: resolveWorkspaceHtmlSourceTitle(normalizedPath, input.title),
        sourceKind,
        workspaceId: sourceWorkspaceId,
        entryPath: normalizedPath,
        sourceId: normalizedPath,
        updatedAt: timestamp
      };

      return {
        ...current,
        shortcutApps: [
          nextShortcut,
          ...current.shortcutApps.filter((item) => item.id !== shortcutId && item.id !== duplicateShortcut?.id)
        ],
        updatedAt: timestamp
      };
    });
  }, []);

  const removeShortcutApp = useCallback((shortcutId: string) => {
    setDashboardState((current) => ({
      ...current,
      shortcutApps: current.shortcutApps.filter((item) => item.id !== shortcutId),
      updatedAt: new Date().toISOString()
    }));
  }, []);

  const dashboardContextValue: AffairsDashboardContextValue = {
    dashboardState,
    activeDashboardTab,
    layoutLocked: dashboardState.layoutLocked,
    selectDashboardTab,
    addDashboardTab,
    renameDashboardTab,
    removeDashboardTab,
    toggleDashboardLayoutLocked,
    addDashboardWidget,
    updateDashboardWidgetConfig,
    setDashboardWidgetLayout,
    removeDashboardWidget,
    resetActiveDashboardLayout,
    addShortcutApp,
    updateShortcutApp,
    removeShortcutApp
  };

  const contextValue = useMemo<AffairsWorkbenchContextValue>(() => ({
    workspaceId,
    workspaceName,
    navigationGroups,
    agentWorkspaceId,
    agentProjectId,
    agentWorkspacePath,
    state,
    activeSection,
    initGuard,
    loading,
    error,
    libraryLoading,
    libraryDocumentsLoading,
    libraryRefreshPending,
    libraryDocumentTotal: libraryDocumentPage?.total ?? 0,
    libraryVisibleEntryTotal: libraryDocumentPage?.visibleEntryTotal ?? (libraryDocumentPage?.total ?? 0),
    libraryDocumentHasMore: (libraryDocumentPage?.items.length ?? 0) < (libraryDocumentPage?.total ?? 0),
    binding,
    globalLibraryBinding,
    libraryConfig,
    indexStatus,
    currentDirectoryStatus,
    documentRecords,
    filteredDocuments,
    favoriteDocuments,
    favoriteEntries,
    tagRecords,
    selectedTagPaths,
    libraryTagFacetCounts,
    folderRecords,
    todoRecords,
    filteredTodoRecords,
    automationRecords,
    selectedObject,
    assistantContext,
    automationRuns,
    sidebarNodes,
    auxiliaryTab: effectiveAuxiliaryTab,
    toolbarExpanded: state.toolbarExpanded,
    detailViewerCollapsed: state.detailViewerCollapsed,
    selectSection: (section) => {
      ensureAffairsRoute();
      const preservedConversationNodeId = section === "conversation"
        ? (state.selectedNodeId?.startsWith("conversation:") ? state.selectedNodeId : lastConversationNodeIdRef.current)
        : null;
      onStateChange({
        ...state,
        primarySection: section,
        selectedNodeId: preservedConversationNodeId ?? resolveDefaultNodeId(section, automationRecords, binding),
        selectedObjectId: null,
        selectedDocumentId: section === "library" ? null : state.selectedDocumentId,
        auxiliaryTab: resolveAffairsAuxiliaryTabForSection(section, state.auxiliaryTab)
      });
    },
    openInitializedSection: (section) => {
      ensureAffairsRoute();
      const preservedConversationNodeId = section === "conversation"
        ? (state.selectedNodeId?.startsWith("conversation:") ? state.selectedNodeId : lastConversationNodeIdRef.current)
        : null;
      onStateChange({
        ...state,
        primarySection: section,
        selectedNodeId: preservedConversationNodeId ?? resolveDefaultNodeId(section, automationRecords, binding),
        selectedObjectId: null,
        selectedDocumentId: section === "library" ? null : state.selectedDocumentId,
        auxiliaryTab: resolveAffairsAuxiliaryTabForSection(section, state.auxiliaryTab)
      });
    },
    selectSidebarNode: (nodeId) => {
      if (activeSection === "library") {
        if (nodeId.startsWith("library:folder:")) {
          onStateChange({
            ...state,
            browseMode: "folder",
            selectedNodeId: nodeId,
            selectedFolderPath: nodeId.slice("library:folder:".length),
            selectedFolderEntryPath: null,
            selectedTagPath: null,
            selectedTagPaths: [],
            selectedFavoriteId: null,
            selectedObjectId: null,
            selectedDocumentId: null
          });
          return;
        }
        if (nodeId.startsWith("library:tag:")) {
          const nextTagPath = nodeId.slice("library:tag:".length);
          const nextSelectedTagPaths = updateSelectedTagPaths(tagRecords, selectedTagPaths, nextTagPath);
          onStateChange({
            ...state,
            browseMode: "tag",
            selectedNodeId: nextSelectedTagPaths.length > 0 ? `library:tag:${nextSelectedTagPaths[nextSelectedTagPaths.length - 1]}` : "library:tag-root",
            selectedTagPath: nextSelectedTagPaths[nextSelectedTagPaths.length - 1] ?? null,
            selectedTagPaths: nextSelectedTagPaths,
            selectedFolderPath: null,
            selectedFolderEntryPath: null,
            selectedFavoriteId: null,
            selectedObjectId: null,
            selectedDocumentId: null
          });
          return;
        }
        if (nodeId.startsWith("library:favorite:")) {
          const favoriteId = nodeId;
          const favorite = favoriteEntries.find((item) => buildFavoriteNodeId(item) === favoriteId);
          onStateChange({
            ...state,
            browseMode: favorite?.kind === "tag" ? "tag" : "folder",
            selectedNodeId: nodeId,
            selectedFavoriteId: favoriteId,
            selectedFolderPath: favorite?.kind === "folder" ? favorite.path : null,
            selectedTagPath: favorite?.kind === "tag" ? favorite.path : null,
            selectedTagPaths: favorite?.kind === "tag" ? [favorite.path] : [],
            selectedObjectId: null,
            selectedDocumentId: null
          });
          return;
        }
        onStateChange({
          ...state,
          selectedNodeId: nodeId,
          selectedFavoriteId: null,
          selectedFolderPath: null,
          selectedFolderEntryPath: null,
          selectedTagPath: null,
          selectedTagPaths: [],
          selectedObjectId: null,
          selectedDocumentId: null
        });
        return;
      }

      onStateChange({
        ...state,
        selectedNodeId: activeSection === "workbench" ? normalizeWorkbenchNodeId(nodeId) ?? "workbench:overview" : nodeId,
        selectedObjectId: resolveSidebarSelectedObjectId(activeSection, nodeId)
      });
    },
    selectObject: (objectId) => {
      onStateChange({
        ...state,
        selectedObjectId: objectId,
        selectedDocumentId: activeSection === "library" ? objectId : state.selectedDocumentId,
        selectedFolderEntryPath: activeSection === "library" && objectId ? null : state.selectedFolderEntryPath
      });
    },
    selectAuxiliaryTab: (tab) => {
      onStateChange({
        ...state,
        auxiliaryTab: resolveAffairsAuxiliaryTabForSection(activeSection, tab)
      });
    },
    setLibraryBrowseMode: (mode) => {
      onStateChange({
        ...state,
        browseMode: mode,
        selectedNodeId: mode === "folder" ? "library:all" : "library:tag-root",
        selectedFavoriteId: null,
        selectedFolderPath: null,
        selectedFolderEntryPath: null,
        selectedTagPath: null,
        selectedTagPaths: [],
        selectedObjectId: null,
        selectedDocumentId: null
      });
    },
    setLibraryViewMode: (mode) => {
      onStateChange({
        ...state,
        viewMode: mode
      });
    },
    selectLibraryFolderEntry: (folderPath) => {
      onStateChange({
        ...state,
        selectedObjectId: null,
        selectedDocumentId: null,
        selectedFolderEntryPath: folderPath?.trim() || null
      });
    },
    navigateLibraryFolder: (folderPath) => {
      const nextFolderPath = folderPath?.trim() || null;
      const previousFolderPath = state.selectedFolderPath?.trim() || null;
      onStateChange({
        ...state,
        browseMode: "folder",
        selectedNodeId: nextFolderPath ? `library:folder:${nextFolderPath}` : "library:all",
        selectedFolderPath: nextFolderPath,
        selectedFolderEntryPath: resolveSelectedFolderEntryPathOnNavigate(previousFolderPath, nextFolderPath),
        selectedTagPath: null,
        selectedTagPaths: [],
        selectedFavoriteId: null,
        selectedObjectId: null,
        selectedDocumentId: null
      });
    },
    navigateLibraryTag: (tagPath) => {
      const normalizedTagPath = tagPath?.trim() || null;
      onStateChange({
        ...state,
        browseMode: "tag",
        selectedNodeId: normalizedTagPath ? `library:tag:${normalizedTagPath}` : "library:tag-root",
        selectedTagPath: normalizedTagPath,
        selectedTagPaths: normalizedTagPath ? [normalizedTagPath] : [],
        selectedFolderPath: null,
        selectedFolderEntryPath: null,
        selectedFavoriteId: null,
        selectedObjectId: null,
        selectedDocumentId: null
      });
    },
    toggleDetailViewerCollapsed: () => {
      onStateChange({
        ...state,
        detailViewerCollapsed: !state.detailViewerCollapsed
      });
    },
    toggleToolbarExpanded: () => {
      onStateChange({
        ...state,
        toolbarExpanded: !state.toolbarExpanded
      });
    },
    initializeButlerProfile: async (payload) => {
      await butlerStore.initializeProfile(payload);
    },
    updateButlerProfile: async (payload) => {
      await butlerStore.updateProfile(payload);
    },
    reloadButlerProfile: async () => {
      await butlerStore.initialize();
    },
    openLibraryViewer: (record) => {
      setViewerState({
        filePath: record.filePath,
        title: record.displayName
      });
    },
    saveLibraryBinding: async (rootDir) => {
      const [globalBindingResponse, snapshot, config] = await Promise.all([
        saveGlobalAffairsLibraryBinding({ rootDir }),
        getAffairsLibrarySnapshot(workspaceId),
        getAffairsLibraryConfig(workspaceId)
      ]);
      setGlobalLibraryBinding((previous) => (
        areAffairsLibraryBindingsEqual(previous, globalBindingResponse) ? previous : globalBindingResponse
      ));
      setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
      setLibraryConfig((previous) => areLibraryConfigsEqual(previous, config) ? previous : config);
      writeCachedLibrarySnapshot(workspaceId, snapshot);
      writeCachedLibraryConfig(workspaceId, config);
    },
    setLibraryEnabled: async (enabled) => {
      const [globalBindingResponse, snapshot, config] = await Promise.all([
        setGlobalAffairsLibraryEnabled({ enabled }),
        getAffairsLibrarySnapshot(workspaceId),
        getAffairsLibraryConfig(workspaceId)
      ]);
      setGlobalLibraryBinding((previous) => (
        areAffairsLibraryBindingsEqual(previous, globalBindingResponse) ? previous : globalBindingResponse
      ));
      setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
      setLibraryConfig((previous) => areLibraryConfigsEqual(previous, config) ? previous : config);
      writeCachedLibrarySnapshot(workspaceId, snapshot);
      writeCachedLibraryConfig(workspaceId, config);
    },
    saveLibraryConfig: async (input) => {
      const savedConfig = await saveAffairsLibraryConfig(workspaceId, input);
      const config = savedConfig ?? await getAffairsLibraryConfig(workspaceId);
      setLibraryConfig((previous) => areLibraryConfigsEqual(previous, config) ? previous : config);
      writeCachedLibraryConfig(workspaceId, config);
      const snapshot = await getAffairsLibrarySnapshot(workspaceId);
      setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
      writeCachedLibrarySnapshot(workspaceId, snapshot);
      return config;
    },
    refreshLibrary: refreshLibraryNow,
    toggleFavorite: async (favorite) => {
      const currentFavorites = librarySnapshot?.favorites ?? [];
      const exists = currentFavorites.some((item) => item.kind === favorite.kind && item.path === favorite.path);
      const nextFavorites = exists
        ? currentFavorites.filter((item) => !(item.kind === favorite.kind && item.path === favorite.path))
        : [...currentFavorites, favorite];
      const response = await updateGlobalAffairsLibraryFavorites({
        favorites: nextFavorites
      });
      setLibrarySnapshot((previous) => {
        const nextSnapshot = previous ? { ...previous, favorites: response.items } : previous;
        if (nextSnapshot) {
          writeCachedLibrarySnapshot(workspaceId, nextSnapshot);
        }
        return nextSnapshot;
      });
      showToast({
        title: exists ? t("shell.affairsFavoriteRemoved") : t("shell.affairsFavoriteAdded"),
        description: favorite.label,
        tone: "success"
      });
    },
    loadMoreLibraryDocuments,
    tagManagementOpen,
    openTagManagement: () => setTagManagementOpen(true),
    closeTagManagement: () => setTagManagementOpen(false),
    managedTags,
    selectedManagedTag,
    documentTagDetails,
    folderTagDetails,
    folderTagTaskMonitor,
    recentTagTasks,
    fullTagRecomputeTaskMonitor,
    tagRecoveryStatus,
    reloadTagManagement,
    selectManagedTag: async (tagId) => {
      if (!tagId) {
        setSelectedManagedTag(null);
        return;
      }
      setSelectedManagedTag(await getAffairsTagDetail(workspaceId, tagId));
    },
    saveManagedTag: async (input) => {
      const previousPath = input.tagId
        ? selectedManagedTag?.path?.trim() ?? null
        : null;
      const saved = input.tagId
        ? await updateAffairsTag(workspaceId, input.tagId, input)
        : await createAffairsTag(workspaceId, input);
      setSelectedManagedTag(saved);
      await reloadTagManagement();
      void syncLibrarySnapshotAfterManagedTagSave(previousPath, saved.path);
      return saved;
    },
    deleteManagedTag: async (tagId) => {
      const result = await deleteAffairsTag(workspaceId, tagId);
      setSelectedManagedTag((previous) => previous?.id === tagId || result.deletedTagIds.includes(previous?.id ?? "") ? null : previous);
      await reloadTagManagement();
      await refreshLibraryNow();
      return {
        deletedTagIds: result.deletedTagIds,
        deletedPaths: result.deletedPaths,
      };
    },
    requestFullTagRecompute: async () => {
      const result = await requestAffairsTagRecoveryRecompute(workspaceId);
      setFullTagRecomputeTaskMonitor({
        taskId: result.taskId,
        snapshot: null,
      });
      return result;
    },
    saveDocumentTagSelection: async (documentId, tagIds, createTagPaths = [], previousTagIds = [], documentTitle) => {
      const operation = resolveTagTaskOperation(previousTagIds, tagIds);
      const optimisticMonitor: DocumentTagApplyTaskMonitorState = {
        documentId,
        documentTitle: documentTitle?.trim() || documentTagDetails?.title || documentId,
        taskId: `pending:document:${documentId}:${Date.now()}`,
        snapshot: createOptimisticTagTaskSnapshot(`doc:${documentId}`, operation),
        operation,
      };
      setDocumentTagTaskMonitor(optimisticMonitor);
      syncDocumentTaskRecord(optimisticMonitor);
      const result = createTagPaths.length > 0
        ? await saveAffairsDocumentTagsWithCreate(workspaceId, documentId, { tagIds, createTagPaths })
        : await saveAffairsDocumentTags(workspaceId, documentId, { tagIds });
      if (result?.refreshTask) {
        const nextMonitor: DocumentTagApplyTaskMonitorState = {
          documentId,
          documentTitle: documentTitle?.trim() || documentTagDetails?.title || documentId,
          taskId: result.refreshTask.taskId,
          snapshot: null,
          operation,
        };
        setDocumentTagTaskMonitor(nextMonitor);
        syncDocumentTaskRecord(nextMonitor);
      } else {
        const completedMonitor: DocumentTagApplyTaskMonitorState = {
          ...optimisticMonitor,
          snapshot: createCompletedTagTaskSnapshot(optimisticMonitor.snapshot, operation),
        };
        setDocumentTagTaskMonitor(completedMonitor);
        syncDocumentTaskRecord(completedMonitor);
      }
      if (createTagPaths.length > 0) {
        await reloadTagManagement();
      }
      setDocumentTagDetails(await getAffairsDocumentTagDetails(workspaceId, documentId));
      await refreshLibraryNow();
    },
    saveFolderTagSelection: async (folderPath, tagIds, createTagPaths = [], previousTagIds = []) => {
      const operation = resolveTagTaskOperation(previousTagIds, tagIds);
      const optimisticMonitor: FolderTagApplyTaskMonitorState = {
        folderPath,
        taskId: `pending:${folderPath}:${Date.now()}`,
        snapshot: createOptimisticTagTaskSnapshot(`folder:${folderPath}`, operation),
        operation,
      };
      setFolderTagTaskMonitor(optimisticMonitor);
      syncFolderTaskRecord(optimisticMonitor);
      const result = createTagPaths.length > 0
        ? await saveAffairsFolderTagsWithCreate(workspaceId, { folderPath, tagIds, createTagPaths })
        : await saveAffairsFolderTags(workspaceId, { folderPath, tagIds });
      if (result.refreshTask) {
        const nextMonitor: FolderTagApplyTaskMonitorState = {
          folderPath: result.target.folderPath,
          taskId: result.refreshTask.taskId,
          snapshot: null,
          operation,
        };
        setFolderTagTaskMonitor(nextMonitor);
        syncFolderTaskRecord(nextMonitor);
      } else {
        const completedMonitor: FolderTagApplyTaskMonitorState = {
          ...optimisticMonitor,
          snapshot: createCompletedTagTaskSnapshot(optimisticMonitor.snapshot, operation),
        };
        setFolderTagTaskMonitor(completedMonitor);
        syncFolderTaskRecord(completedMonitor);
      }
      if (createTagPaths.length > 0) {
        await reloadTagManagement();
      }
      setFolderTagDetails(await getAffairsFolderTagDetails(workspaceId, folderPath));
      await refreshLibraryNow();
    },
    conversationCreateModalOpen,
    conversationCreateModalMode,
    openConversationCreateModal: (input) => {
      setConversationCreateModalMode(input?.mode === "agent-only" ? "agent-only" : "all");
      setConversationCreateModalOpen(true);
    },
    closeConversationCreateModal: () => {
      setConversationCreateModalOpen(false);
      setConversationCreateModalMode("all");
    },
    prepareAssistantConversation: async (provider) => {
      if (!agentWorkspaceId) {
        return;
      }
      rememberConversationDraft({
        kind: "agent",
        provider
      });
      if (!butlerStore.getState().initialized && typeof butlerStore.initialize === "function") {
        await butlerStore.initialize();
      }
      const currentState = butlerStore.getState();
      const activeProvider = isAffairsAssistantProvider(currentState.activeProvider)
        ? currentState.activeProvider
        : null;
      const controlSessionId = currentState.controlSession?.session.sessionId?.trim() ?? "";
      const hasMessages = Array.isArray(currentState.messages) && currentState.messages.length > 0;

      if (activeProvider !== provider) {
        await butlerStore.switchProvider(provider);
      } else if (controlSessionId || hasMessages) {
        await butlerStore.startFreshSession();
      }
    },
    rememberConversationDraft,
    rememberConversationSession,
    butlerStore,
    archiveConversationSession: async (input) => {
      const nextSession = input.kind === "lightweight"
        ? await updateAffairsLightweightSessionArchiveState(workspaceId, input.session.sessionId, true)
        : await updateSessionArchiveState(input.session.sessionId, true);
      if (input.kind === "lightweight") {
        setLightweightConversationSessions((current) => current.map((item) => (
          item.sessionId === nextSession.sessionId ? nextSession : item
        )));
      } else {
        setAgentConversationSessions((current) => current.map((item) => (
          item.sessionId === nextSession.sessionId ? nextSession : item
        )));
      }
      clearSelectedConversationSession({
        kind: input.kind,
        sessionId: nextSession.sessionId
      });
      await onRefreshNavigation?.();
    },
    unarchiveConversationSession: async (input) => {
      const nextSession = input.kind === "lightweight"
        ? await updateAffairsLightweightSessionArchiveState(workspaceId, input.session.sessionId, false)
        : await updateSessionArchiveState(input.session.sessionId, false);
      if (input.kind === "lightweight") {
        setLightweightConversationSessions((current) => upsertConversationSessionSummary(current, nextSession));
      } else {
        setAgentConversationSessions((current) => upsertConversationSessionSummary(current, nextSession));
      }
      await onRefreshNavigation?.();
    },
    toggleConversationSessionFavorite: async (input) => {
      const nextSession = input.kind === "lightweight"
        ? await updateAffairsLightweightSessionFavoriteState(
          workspaceId,
          input.session.sessionId,
          input.session.isFavorite !== true
        )
        : await updateSessionFavoriteState(input.session.sessionId, input.session.isFavorite !== true);
      if (input.kind === "lightweight") {
        setLightweightConversationSessions((current) => current.map((item) => (
          item.sessionId === nextSession.sessionId ? nextSession : item
        )));
      } else {
        setAgentConversationSessions((current) => current.map((item) => (
          item.sessionId === nextSession.sessionId ? nextSession : item
        )));
      }
      await onRefreshNavigation?.();
    },
    markConversationSessionSeen: (kind, sessionId, seenAt) => {
      const nextSeenAt = seenAt ?? new Date().toISOString();
      setLightweightConversationSessions((current) => current.map((item) => (
        item.sessionId === sessionId ? markAffairsSessionSeen(item, nextSeenAt) : item
      )));
      setAgentConversationSessions((current) => current.map((item) => (
        item.sessionId === sessionId ? markAffairsSessionSeen(item, nextSeenAt) : item
      )));
      setConversationRuntimeSeed((current) => (
        current && current.session.sessionId === sessionId
          ? {
              ...current,
              session: markAffairsSessionSeen(current.session, nextSeenAt)
            }
          : current
      ));
      void (kind === "lightweight"
        ? markAffairsLightweightSessionSeen(workspaceId, sessionId, nextSeenAt)
        : markSessionSeen(sessionId)).catch(() => undefined);
    },
    openConversationRenameModal: (input) => {
      setConversationRenameTarget(input);
      setConversationRenameValue(input.session.title ?? "");
    },
    openConversationDeleteModal: (input) => {
      setConversationDeleteTarget(input);
    },
    renameConversationSession: async (input) => {
      const renamedSession = input.kind === "lightweight"
        ? await renameAffairsLightweightSessionTitle(workspaceId, input.session.sessionId, input.title.trim())
        : await renameSessionTitle(input.session.sessionId, input.title.trim());
      if (input.kind === "lightweight") {
        setLightweightConversationSessions((current) => current.map((item) => (
          item.sessionId === renamedSession.sessionId ? renamedSession : item
        )));
      } else {
        setAgentConversationSessions((current) => current.map((item) => (
          item.sessionId === renamedSession.sessionId ? renamedSession : item
        )));
      }
      setConversationRuntimeSeed((current) => (
        current && current.session.sessionId === renamedSession.sessionId
          ? {
              ...current,
              session: renamedSession
            }
          : current
      ));
      return renamedSession;
    },
    deleteConversationSession: async (input) => {
      if (input.kind === "lightweight") {
        await deleteAffairsLightweightSession(workspaceId, input.session.sessionId);
        setLightweightConversationSessions((current) => current.filter((item) => item.sessionId !== input.session.sessionId));
      } else {
        await deleteSession(input.session.sessionId);
        setAgentConversationSessions((current) => current.filter((item) => item.sessionId !== input.session.sessionId));
      }
      clearSelectedConversationSession({
        kind: input.kind,
        sessionId: input.session.sessionId
      });
      await onRefreshNavigation?.();
    },
    exportConversationSession: async ({ session, format }) => {
      if (conversationExportingSessionId) {
        return;
      }

      setConversationExportingSessionId(session.sessionId);

      try {
        const snapshot = activeLightweightConversationSessionIds.has(session.sessionId)
          ? await loadAffairsLightweightSessionExportSnapshot(workspaceId, session.sessionId)
          : await loadSessionExportSnapshot(session.sessionId);
        const exportLayout = captureAffairsSessionExportLayoutSnapshot();

        if (format === "md") {
          downloadTextFile(
            buildSessionExportFileName(session, "md"),
            buildSessionMarkdownExport(session, snapshot.messages),
            "text/markdown;charset=utf-8"
          );
          return;
        }

        flushSync(() => {
          setConversationExportRenderJob({
            session,
            items: buildConversationTimelineSourceItems({
              messages: snapshot.messages
            }),
            shellWidthPx: exportLayout.shellWidthPx
          });
        });

        await waitForAffairsSessionExportRender(conversationExportRenderRootRef.current);

        const exportMarkup = conversationExportRenderRootRef.current?.innerHTML.trim() ?? "";

        if (!exportMarkup) {
          throw new Error(t("conversation.exportLoadFailed"));
        }

        const htmlAttributes = collectAffairsSessionExportAttributes(document.documentElement);
        const bodyAttributes = document.body ? collectAffairsSessionExportAttributes(document.body) : {};
        const htmlStyle = document.documentElement.getAttribute("style");
        const bodyStyle = document.body?.getAttribute("style") ?? null;
        const exportStyleText = `${collectAffairsSessionExportStyles()}
${AFFAIRS_STANDALONE_SESSION_EXPORT_OVERRIDES}`;
        const htmlDocument = buildStandaloneSessionExportHtml({
          title: session.title || t("conversation.titleFallback"),
          bodyHtml: `<div class="session-export-document-root">${exportMarkup}</div>`,
          styleText: exportStyleText,
          htmlAttributes,
          bodyAttributes,
          htmlStyle,
          bodyStyle
        });

        if (format === "html") {
          downloadTextFile(
            buildSessionExportFileName(session, "html"),
            htmlDocument,
            "text/html;charset=utf-8"
          );
          return;
        }

        downloadBinaryFile(
          buildSessionExportFileName(session, "pdf"),
          buildSessionPdfExport(session, snapshot.messages),
          "application/pdf"
        );
      } finally {
        flushSync(() => {
          setConversationExportRenderJob(null);
        });
        setConversationExportingSessionId(null);
      }
    },
    selectedConversationDraft,
    selectConversationDraft: (draft) => {
      rememberConversationDraft(draft);
      onStateChange({
        ...state,
        primarySection: "conversation",
        selectedNodeId: buildAffairsConversationDraftNodeId(draft),
        selectedObjectId: null,
        selectedDocumentId: null
      });
    },
    selectedConversationSession,
    conversationRuntimeSeed,
    lightweightRuntimeBySessionId,
    setLightweightRuntimeSnapshot,
    lightweightConversationSessions,
    lightweightConversationSessionsLoading,
    reloadLightweightConversationSessions,
    agentConversationSessions,
    agentConversationSessionsReady,
    agentConversationSessionsLoading,
    reloadAgentConversationSessions,
    activateConversationSession: (input) => {
      rememberConversationSession(input);
      onStateChange({
        ...state,
        primarySection: "conversation",
        selectedNodeId: buildAffairsConversationSessionNodeId(input.kind, input.session.sessionId),
        selectedObjectId: null,
        selectedDocumentId: null
      });
    }
  }), [
    activeSection,
    agentWorkspaceId,
    agentWorkspacePath,
    assistantContext,
    automationRecords,
    automationRuns,
    binding,
    globalLibraryBinding,
    butlerActiveProvider,
    butlerControlSession,
    butlerStore,
    libraryConfig,
    documentRecords,
    error,
    favoriteDocuments,
    favoriteEntries,
    favoriteFolderPathSet,
    filteredDocuments,
    filteredTodoRecords,
    folderRecords,
    conversationCreateModalOpen,
    indexStatus,
    onStateChange,
    currentDirectoryStatus,
    libraryDocumentPage,
    libraryDocumentsLoading,
    libraryLoading,
    libraryRefreshPending,
    librarySnapshot,
    loadMoreLibraryDocuments,
    loading,
    managedTags,
    initGuard,
    onStateChange,
    onRefreshNavigation,
    selectedManagedTag,
    selectedConversationDraft,
    selectedConversationSession,
    conversationRuntimeSeed,
    lightweightRuntimeBySessionId,
    setLightweightRuntimeSnapshot,
    lightweightConversationSessions,
    lightweightConversationSessionsLoading,
    reloadLightweightConversationSessions,
    agentConversationSessions,
    agentConversationSessionsReady,
    agentConversationSessionsLoading,
    reloadAgentConversationSessions,
    clearSelectedConversationSession,
    selectedObject,
    sidebarNodes,
    selectedTagPaths,
    state,
    tagRecords,
    todoRecords,
    tagManagementOpen,
    documentTagDetails,
    folderTagDetails,
    folderTagTaskMonitor,
    recentTagTasks,
    fullTagRecomputeTaskMonitor,
    tagRecoveryStatus,
    documentTagTaskMonitor,
    rememberConversationDraft,
    rememberConversationSession,
    refreshLibraryNow,
    reloadTagManagement,
    syncDocumentTaskRecord,
    syncFolderTaskRecord,
    viewerState,
    showToast,
    workspaceId,
    workspaceName,
    conversationExportingSessionId
  ]);

  useEffect(() => {
    const request = state.pendingLibraryPreview;
    if (!request) {
      return;
    }

    const filePath = request.filePath.trim();
    if (filePath) {
      setViewerState({
        filePath,
        title: request.title.trim() || resolveDocumentDisplayName(filePath)
      });
    }

    onStateChange({
      ...state,
      pendingLibraryPreview: null
    });
  }, [onStateChange, state]);

  return (
    <AffairsWorkbenchContext.Provider value={contextValue}>
      <AffairsDashboardContext.Provider value={dashboardContextValue}>
      {children}
      <AffairsConversationCreateModal />
      <AffairsConversationRenameModal
        target={conversationRenameTarget}
        value={conversationRenameValue}
        busySessionId={conversationRenamingSessionId}
        onChange={setConversationRenameValue}
        onClose={() => {
          if (conversationRenamingSessionId) {
            return;
          }
          setConversationRenameTarget(null);
          setConversationRenameValue("");
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!conversationRenameTarget) {
            return;
          }
          const nextTitle = conversationRenameValue.trim();
          if (!nextTitle) {
            return;
          }
          setConversationRenamingSessionId(conversationRenameTarget.session.sessionId);
          try {
            await contextValue.renameConversationSession({
              kind: conversationRenameTarget.kind,
              session: conversationRenameTarget.session,
              title: nextTitle
            });
            setConversationRenameTarget(null);
            setConversationRenameValue("");
            showToast({ title: t("shell.renameSuccess"), tone: "success" });
          } catch (error) {
            showToast({
              title: error instanceof Error ? error.message : t("shell.renameFailed"),
              tone: "error"
            });
          } finally {
            setConversationRenamingSessionId(null);
          }
        }}
      />
      <AffairsConversationDeleteModal
        target={conversationDeleteTarget}
        busySessionId={conversationDeletingSessionId}
        onClose={() => {
          if (conversationDeletingSessionId) {
            return;
          }
          setConversationDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!conversationDeleteTarget) {
            return;
          }
          setConversationDeletingSessionId(conversationDeleteTarget.session.sessionId);
          try {
            await contextValue.deleteConversationSession({
              kind: conversationDeleteTarget.kind,
              session: conversationDeleteTarget.session
            });
            setConversationDeleteTarget(null);
            showToast({ title: t("shell.deleteSessionSuccess"), tone: "success" });
          } catch (error) {
            showToast({
              title: error instanceof Error ? error.message : t("shell.deleteSessionFailed"),
              tone: "error"
            });
          } finally {
            setConversationDeletingSessionId(null);
          }
        }}
      />
      {conversationExportRenderJob ? (
        <div ref={conversationExportRenderRootRef} className="session-export-print-root" aria-hidden="true">
          <div
            className="session-export-print-shell"
            style={
              conversationExportRenderJob.shellWidthPx
                ? {
                    width: `${conversationExportRenderJob.shellWidthPx}px`,
                    maxWidth: "100%"
                  }
                : undefined
            }
          >
            <header className="session-export-print-header">
              <h1>{conversationExportRenderJob.session.title || t("conversation.titleFallback")}</h1>
              <p>{t("conversation.exportAction")}</p>
            </header>
            <ConversationTranscriptExport
              sessionId={conversationExportRenderJob.session.sessionId}
              items={conversationExportRenderJob.items}
              provider={conversationExportRenderJob.session.provider}
            />
          </div>
        </div>
      ) : null}
      <AffairsLibraryFileViewerModal
        workspaceId={workspaceId}
        viewerState={viewerState}
        onClose={() => setViewerState(null)}
        onSaved={() => refreshLibraryNow()}
      />
      </AffairsDashboardContext.Provider>
    </AffairsWorkbenchContext.Provider>
  );
}

export function AffairsSectionMenu() {
  const { activeSection, selectSection } = useAffairsWorkbenchInternal();

  return (
    <div className="workbench-nav-code-entries" role="tablist" aria-label={t("shell.affairsSidebarMenuLabel")}>
      <button
        type="button"
        className={activeSection === "library" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "library"}
        onClick={() => selectSection("library")}
      >
        <AffairsLibraryIcon />
        <span>{t("shell.affairsLibraryNav")}</span>
      </button>
      <button
        type="button"
        className={activeSection === "conversation" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "conversation"}
        onClick={() => selectSection("conversation")}
      >
        <AffairsConversationIcon />
        <span>{t("shell.affairsConversationNav")}</span>
      </button>
      <button
        type="button"
        className={activeSection === "workbench" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "workbench"}
        onClick={() => selectSection("workbench")}
      >
        <AffairsWorkbenchIcon />
        <span>{t("shell.affairsWorkbenchNav")}</span>
      </button>
    </div>
  );
}

function AffairsShortcutAppsRail({ standalone = false }: { standalone?: boolean }) {
  const { workspaceId, navigationGroups, globalLibraryBinding } = useAffairsWorkbenchInternal();
  const { dashboardState, addShortcutApp, updateShortcutApp, removeShortcutApp } = useAffairsDashboardInternal();
  const { showToast } = useToast();
  const platform = usePlatform();
  const [editing, setEditing] = useState(false);
  const [addingShortcut, setAddingShortcut] = useState(false);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(!standalone);
  const currentLibraryWorkspaceOption = useMemo(
    () => resolveAffairsLibrarySourceWorkspaceOption(globalLibraryBinding, workspaceId),
    [globalLibraryBinding, workspaceId]
  );
  const sourceWorkspaceOptions = useMemo(
    () => buildWorkspaceHtmlSourceWorkspaceOptions(
      navigationGroups,
      workspaceId,
      currentLibraryWorkspaceOption
    ),
    [currentLibraryWorkspaceOption, navigationGroups, workspaceId]
  );
  const defaultSourceWorkspaceId = useMemo(
    () => resolveWorkspaceHtmlSourceDefaultWorkspaceId({
      currentWorkspaceId: workspaceId,
      currentLibraryWorkspace: currentLibraryWorkspaceOption,
      options: sourceWorkspaceOptions
    }),
    [currentLibraryWorkspaceOption, sourceWorkspaceOptions, workspaceId]
  );
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState(defaultSourceWorkspaceId);
  const selectedSourceWorkspaceOption = useMemo(
    () => resolveHtmlSourceScopeOption(sourceWorkspaceOptions, sourceWorkspaceId),
    [sourceWorkspaceId, sourceWorkspaceOptions]
  );
  const selectedSourceWorkspaceLabel = useMemo(
    () => selectedSourceWorkspaceOption?.label ?? "",
    [selectedSourceWorkspaceOption]
  );
  const [entryPath, setEntryPath] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewingShortcut, setPreviewingShortcut] = useState<ShortcutAppState | null>(null);

  useEffect(() => {
    if (!addingShortcut) {
      setSourceWorkspaceId(defaultSourceWorkspaceId);
      setEntryPath("");
      setTitle("");
      setEditingShortcutId(null);
    }
  }, [addingShortcut, defaultSourceWorkspaceId]);

  useEffect(() => {
    setCollapsed(!standalone);
    setEditing(false);
    setAddingShortcut(false);
    setEditingShortcutId(null);
  }, [standalone]);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const source = await validateShortcutSourceSelection(selectedSourceWorkspaceOption, entryPath);
      const resolvedTitle = resolveWorkspaceHtmlSourceTitle(source.path, title);
      if (editingShortcutId) {
        updateShortcutApp(editingShortcutId, {
          sourceKind: selectedSourceWorkspaceOption?.kind === "affairs_library" ? "affairs_library" : "workspace",
          title: resolvedTitle,
          workspaceId: selectedSourceWorkspaceOption?.workspaceId ?? workspaceId,
          entryPath: source.path
        });
      } else {
        addShortcutApp({
          sourceKind: selectedSourceWorkspaceOption?.kind === "affairs_library" ? "affairs_library" : "workspace",
          title: resolvedTitle,
          workspaceId: selectedSourceWorkspaceOption?.workspaceId ?? workspaceId,
          entryPath: source.path
        });
      }
      setSourceWorkspaceId(defaultSourceWorkspaceId);
      setEntryPath("");
      setTitle("");
      setAddingShortcut(false);
      showToast({
        title: editingShortcutId ? t("shell.affairsShortcutRailUpdatedTitle") : t("shell.affairsShortcutRailAddedTitle"),
        description: resolvedTitle,
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: resolveErrorMessage(error, editingShortcutId ? t("shell.affairsShortcutRailUpdateFailed") : t("shell.affairsShortcutRailAddFailed")),
        tone: "error"
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    addShortcutApp,
    defaultSourceWorkspaceId,
    editingShortcutId,
    entryPath,
    selectedSourceWorkspaceOption,
    showToast,
    submitting,
    title,
    updateShortcutApp,
    workspaceId
  ]);

  const openShortcutApp = useCallback((shortcut: ShortcutAppState) => {
    if (editing) {
      setEditingShortcutId(shortcut.id);
      setSourceWorkspaceId(shortcut.sourceKind === "affairs_library" ? AFFAIRS_HTML_SOURCE_CURRENT_LIBRARY : shortcut.workspaceId);
      setEntryPath(shortcut.entryPath);
      setTitle(shortcut.title);
      setAddingShortcut(true);
      return;
    }
    setPreviewingShortcut(shortcut);
  }, [editing]);

  const handleDetachShortcutPreview = useCallback(async () => {
    if (!previewingShortcut) {
      return;
    }

    try {
      if (previewingShortcut.sourceKind === "affairs_library") {
        const preview = await getAffairsLibraryPreview(previewingShortcut.workspaceId, previewingShortcut.entryPath);
        if (!preview.previewUrl) {
          throw new Error(t("shell.affairsShortcutRailOpenFailed"));
        }
        window.open(buildDashboardPreviewUrl(preview.previewUrl), "_blank", "noopener,noreferrer");
      } else {
        const previewLink = await getFilePreviewLink(previewingShortcut.workspaceId, previewingShortcut.entryPath);
        window.open(buildDashboardPreviewUrl(previewLink.previewUrl), "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      showToast({
        title: resolveErrorMessage(error, t("shell.affairsShortcutRailOpenFailed")),
        description: previewingShortcut.title,
        tone: "error"
      });
    }
  }, [previewingShortcut, showToast]);

  return (
    <section
      className={standalone
        ? "workbench-section-block affairs-shortcut-rail affairs-shortcut-rail-standalone"
        : "workbench-section-block affairs-shortcut-rail"}
      data-collapsed={!standalone && collapsed ? "true" : undefined}
      aria-label={t("shell.affairsShortcutRailTitle")}
    >
      <div className="affairs-sidebar-block-header affairs-shortcut-rail-header">
        <div>
          <h2>{t("shell.affairsShortcutRailTitle")}</h2>
        </div>
        <div className="affairs-shortcut-rail-header-actions">
          <span className="affairs-sidebar-block-count">{dashboardState.shortcutApps.length}</span>
          {(standalone || !collapsed) && editing ? (
            <button
              type="button"
              className="affairs-dashboard-toolbar-icon-button affairs-shortcut-rail-header-icon-button"
              aria-label={addingShortcut ? t("shell.affairsWorkbenchCancelAction") : t("shell.affairsShortcutRailAddAction")}
              title={addingShortcut ? t("shell.affairsWorkbenchCancelAction") : t("shell.affairsShortcutRailAddAction")}
              onClick={() => {
                setAddingShortcut((current) => {
                  const nextOpen = !current;
                  if (nextOpen) {
                    setEditingShortcutId(null);
                    setSourceWorkspaceId(defaultSourceWorkspaceId);
                    setEntryPath("");
                    setTitle("");
                  }
                  return nextOpen;
                });
              }}
            >
              {addingShortcut ? <AffairsDashboardRemoveIcon /> : <AffairsDashboardAddTabIcon />}
            </button>
          ) : null}
          {standalone || !collapsed ? (
            <button
              type="button"
              className="affairs-dashboard-toolbar-icon-button affairs-shortcut-rail-header-icon-button"
              aria-label={editing ? t("shell.affairsShortcutRailDoneAction") : t("shell.affairsShortcutRailEditAction")}
              title={editing ? t("shell.affairsShortcutRailDoneAction") : t("shell.affairsShortcutRailEditAction")}
              onClick={() => {
                setEditing((current) => {
                  const nextEditing = !current;
                  if (!nextEditing) {
                    setAddingShortcut(false);
                  }
                  return nextEditing;
                });
              }}
            >
              {editing ? <AffairsShortcutDoneIcon /> : <AffairsShortcutEditIcon />}
            </button>
          ) : null}
          {!standalone ? (
            <button
              type="button"
              className="affairs-dashboard-toolbar-icon-button affairs-shortcut-rail-header-icon-button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? t("shell.affairsShortcutRailExpandAction") : t("shell.affairsShortcutRailCollapseAction")}
              title={collapsed ? t("shell.affairsShortcutRailExpandAction") : t("shell.affairsShortcutRailCollapseAction")}
              onClick={() => setCollapsed((current) => !current)}
            >
              <CollapsePreviewIcon collapsed={collapsed} />
            </button>
          ) : null}
        </div>
      </div>

      {!collapsed && editing && addingShortcut ? (
        <form className="affairs-shortcut-rail-editor" onSubmit={handleSubmit}>
          <label className="affairs-dashboard-inline-field" htmlFor="affairs-shortcut-source-workspace">
            <span>{t("shell.affairsWorkbenchHtmlSourceWorkspaceField")}</span>
            <select
              id="affairs-shortcut-source-workspace"
              className="affairs-dashboard-inline-select"
              value={sourceWorkspaceId}
              onChange={(event) => {
                setSourceWorkspaceId(event.currentTarget.value);
                setEntryPath("");
              }}
            >
              {sourceWorkspaceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {selectedSourceWorkspaceOption?.kind === "affairs_library" ? (
            <p className="affairs-dashboard-inline-help">
              {t("shell.affairsWorkbenchHtmlSourceWorkspaceCurrentLibraryHelper", {
                path: selectedSourceWorkspaceOption.rootDir
              })}
            </p>
          ) : null}
          <WorkspaceShortcutFilePicker
            sourceOption={selectedSourceWorkspaceOption}
            workspaceLabel={selectedSourceWorkspaceLabel}
            inputId="affairs-shortcut-entry-path"
            value={entryPath}
            onChange={setEntryPath}
            label={t("shell.affairsShortcutRailSourceSelectField")}
            placeholder={t("shell.affairsShortcutRailSourceSelectPlaceholder")}
            helpText={t("shell.affairsShortcutRailSourceHelper")}
            listFailedMessage={t("shell.affairsShortcutRailSourceListFailed")}
          />
          <label className="affairs-dashboard-inline-field" htmlFor="affairs-shortcut-title">
            <span>{t("shell.affairsShortcutRailTitleField")}</span>
            <input
              id="affairs-shortcut-title"
              className="affairs-dashboard-inline-input"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={t("shell.affairsShortcutRailTitlePlaceholder")}
            />
          </label>
          <div className="affairs-dashboard-inline-actions">
            <button type="submit" className="secondary-button" disabled={submitting}>
              {submitting
                ? t("common.loading")
                : (editingShortcutId ? t("shell.affairsShortcutRailConfirmEditAction") : t("shell.affairsShortcutRailConfirmAddAction"))}
            </button>
          </div>
        </form>
      ) : null}

      {!collapsed ? (
        dashboardState.shortcutApps.length === 0 ? (
          <div className="affairs-shortcut-rail-empty">{t("shell.affairsShortcutRailEmpty")}</div>
        ) : (
          <div className="affairs-shortcut-rail-list" data-editing={editing ? "true" : undefined}>
            {dashboardState.shortcutApps.map((shortcut) => (
              <div key={shortcut.id} className="affairs-shortcut-rail-item">
                {editing ? (
                  <button
                    type="button"
                    className="affairs-shortcut-rail-remove-button"
                    aria-label={t("shell.affairsShortcutRailRemoveAction")}
                    onClick={() => removeShortcutApp(shortcut.id)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="affairs-shortcut-rail-launcher"
                  aria-label={editing
                    ? t("shell.affairsShortcutRailEditEntryAction", { title: shortcut.title })
                    : t("shell.affairsShortcutRailLaunchAction", { title: shortcut.title })}
                  onClick={() => openShortcutApp(shortcut)}
                >
                  <span
                    className="affairs-shortcut-rail-icon"
                    style={resolveShortcutAppIconStyle(shortcut.title)}
                    aria-hidden="true"
                  >
                    {resolveShortcutAppIconText(shortcut.title)}
                  </span>
                  <span className="affairs-shortcut-rail-copy">
                    <strong>{shortcut.title}</strong>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )
      ) : null}

      {previewingShortcut ? (
        <FileViewerPanel
          workspaceId={previewingShortcut.workspaceId}
          filePath={previewingShortcut.entryPath}
          open
          onClose={() => setPreviewingShortcut(null)}
          onSaved={() => undefined}
          windowTitle={previewingShortcut.title}
          previewLoader={previewingShortcut.sourceKind === "affairs_library"
            ? ((targetWorkspaceId, targetFilePath, options) => getAffairsLibraryPreviewWithOptions(targetWorkspaceId, targetFilePath, options))
            : undefined}
          saveHandler={previewingShortcut.sourceKind === "affairs_library"
            ? (async ({ workspaceId: targetWorkspaceId, filePath: targetFilePath, content, expectedVersion }) => {
                await operateAffairsLibraryFile(targetWorkspaceId, {
                  opType: "write",
                  srcPath: targetFilePath,
                  content,
                  expectedVersion
                });
              })
            : undefined}
          showDetachAction={platform.isDesktop && platform.bridge.supported}
          onDetach={() => void handleDetachShortcutPreview()}
        />
      ) : null}
    </section>
  );
}

function resolveConversationSessionSortTime(session: SessionSummaryDto): number {
  const timestamp = session.lastMessageAt ?? session.updatedAt ?? session.createdAt ?? null;
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortConversationSessionSummaries(sessions: SessionSummaryDto[]): SessionSummaryDto[] {
  return [...sessions].sort((left, right) => resolveConversationSessionSortTime(right) - resolveConversationSessionSortTime(left));
}

function upsertConversationSessionSummary(
  sessions: SessionSummaryDto[],
  session: SessionSummaryDto
): SessionSummaryDto[] {
  const next = sessions.filter((item) => item.sessionId !== session.sessionId);
  next.push(session);
  return sortConversationSessionSummaries(next);
}

function mergeSnapshotBackedAgentConversationSessions(
  current: SessionSummaryDto[],
  snapshot: SessionSummaryDto[]
): SessionSummaryDto[] {
  const next = new Map(snapshot.map((item) => [item.sessionId, item] as const));
  for (const session of current) {
    if (next.has(session.sessionId)) {
      continue;
    }
    if (!session.rawStoreRef.startsWith("butler://")) {
      next.set(session.sessionId, session);
    }
  }
  return sortConversationSessionSummaries(Array.from(next.values()));
}

function extractButlerManagedSessionIdFromRawStoreRef(rawStoreRef: string | null | undefined): string | null {
  const normalized = rawStoreRef?.trim() ?? "";
  if (!normalized.startsWith("butler://")) {
    return null;
  }
  const recordId = normalized.slice("butler://".length).trim();
  return recordId || null;
}

function formatAffairsConversationProviderBadge(provider: ProviderId) {
  return getProviderDisplayName(provider, "compact");
}

function buildAffairsConversationMeta(session: SessionSummaryDto) {
  const date = session.lastMessageAt ?? session.updatedAt ?? session.createdAt;
  return date ? formatRelativeMeta(date) : "";
}

function markAffairsSessionSeen<T extends SessionSummaryDto>(session: T, seenAt: string): T {
  return {
    ...session,
    lastSeenAt:
      session.lastSeenAt && session.lastSeenAt > seenAt
        ? session.lastSeenAt
        : seenAt,
    activityState: session.activityState === "completed_unread" ? "idle" : session.activityState
  };
}

function buildAffairsConversationIndicatorClassName(
  session: SessionSummaryDto,
  options?: { isActive?: boolean }
) {
  return resolveSessionIndicatorClassName("session-state-indicator", session, {
    isActive: options?.isActive
  });
}

function AffairsSessionStarIcon({ active = false }: { active?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill={active ? "currentColor" : "none"} aria-hidden="true">
      <path d="m10 2.9 2.18 4.41 4.87.71-3.52 3.43.83 4.85L10 14.02 5.64 16.3l.83-4.85L2.95 8.02l4.87-.71L10 2.9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsSessionArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 5.5h13v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15.5z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.75 3.25h14.5v2.5H2.75zM7 9.25h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsSessionRenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.75 14.25v1h1l7.98-7.98-1.99-1.99-6.99 6.99Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m11.74 5.28 1.99 1.99 1.24-1.24a1.41 1.41 0 1 0-1.99-1.99z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsSessionExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3.5v8m0 0 3-3m-3 3-3-3M4.5 13.5v1A1.5 1.5 0 0 0 6 16h8a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsArchiveFolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 6.25c0-.69.56-1.25 1.25-1.25h9.5c.69 0 1.25.56 1.25 1.25v1.5c0 .69-.56 1.25-1.25 1.25h-9.5C4.56 9 4 8.44 4 7.75zm1.5 4.25h9v3.25A1.25 1.25 0 0 1 14.25 15h-8.5A1.25 1.25 0 0 1 4.5 13.75zm2.25 1.5h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsSessionDeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.5 6.25h9l-.62 8.06A1.5 1.5 0 0 1 12.39 15.7H7.61a1.5 1.5 0 0 1-1.49-1.39zM7.75 6.25V4.9A1.4 1.4 0 0 1 9.15 3.5h1.7a1.4 1.4 0 0 1 1.4 1.4v1.35M4 6.25h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsConversationSessionCard({
  item,
  isActive,
  role,
  onOpen,
  onRename,
  onExport,
  onToggleFavorite,
  onArchive,
  onDelete
}: {
  item: AffairsConversationListItem;
  isActive: boolean;
  role?: string;
  onOpen: () => void;
  onRename: () => void;
  onExport: (format: "md" | "pdf" | "html") => Promise<void>;
  onToggleFavorite: () => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const platform = usePlatform();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number } | null>(null);
  const [menuPositionStyle, setMenuPositionStyle] = useState<CSSProperties | null>(null);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const sessionActivityBadgeLabel = resolveSessionActivityBadgeLabel(item.session);
  const sessionActivityBadgeClassName =
    resolveSessionActivityBadgeClassName("session-activity-badge", item.session);
  const sessionMeta = buildAffairsConversationMeta(item.session);

  useEffect(() => {
    if (!menuOpen) {
      setExportSubmenuOpen(false);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || platform.isDesktop) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
      setMenuAnchorPoint(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setMenuAnchorPoint(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen, platform.isDesktop]);

  useLayoutEffect(() => {
    if (platform.isDesktop || !menuOpen || !menuAnchorPoint || typeof window === "undefined") {
      setMenuPositionStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const nextPosition = resolveContextMenuPosition(
        menuAnchorPoint,
        {
          width: menuRef.current?.offsetWidth ?? 0,
          height: menuRef.current?.offsetHeight ?? 0
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        },
        {
          estimatedHeightPx: 132
        }
      );
      setMenuPositionStyle({
        position: "fixed",
        top: `${Math.round(nextPosition.top)}px`,
        left: `${Math.round(nextPosition.left)}px`,
        width: `${Math.round(nextPosition.width)}px`,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: `${Math.round(nextPosition.maxHeight)}px`,
        transformOrigin: nextPosition.transformOrigin
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuAnchorPoint, menuOpen, platform.isDesktop]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuAnchorPoint(null);
  }, []);

  const openMenuAt = useCallback((anchorPoint: { x: number; y: number }) => {
    setMenuAnchorPoint(anchorPoint);
    setMenuOpen(true);
  }, []);

  const openDesktopSessionMenu = useCallback(async () => {
    await showDesktopContextMenu([
      {
        id: `rename:${item.session.sessionId}`,
        label: t("shell.renameAction"),
        onSelect: onRename
      },
      {
        id: `export:${item.session.sessionId}`,
        label: t("conversation.exportAction"),
        items: [
          {
            id: `export-markdown:${item.session.sessionId}`,
            label: t("conversation.exportMarkdownAction"),
            onSelect: () => onExport("md")
          },
          {
            id: `export-pdf:${item.session.sessionId}`,
            label: t("conversation.exportPdfAction"),
            onSelect: () => onExport("pdf")
          },
          {
            id: `export-html:${item.session.sessionId}`,
            label: t("conversation.exportHtmlAction"),
            onSelect: () => onExport("html")
          }
        ]
      },
      {
        id: `favorite:${item.session.sessionId}`,
        label: item.session.isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction"),
        onSelect: onToggleFavorite
      },
      {
        id: `archive:${item.session.sessionId}`,
        label: t("shell.archiveAction"),
        onSelect: onArchive
      },
      {
        id: `delete:${item.session.sessionId}`,
        label: t("shell.deleteSessionAction"),
        onSelect: onDelete
      }
    ]);
  }, [item.session.isFavorite, item.session.sessionId, onArchive, onDelete, onExport, onRename, onToggleFavorite]);

  const sessionMenu =
    !platform.isDesktop && menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="workbench-session-menu"
            role="menu"
            aria-label={t("shell.sessionMoreAction")}
            onClick={(event) => event.stopPropagation()}
            style={
              menuPositionStyle ?? {
                position: "fixed",
                top: 0,
                left: 0,
                visibility: "hidden"
              }
            }
          >
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                closeMenu();
                onRename();
              }}
            >
              <AffairsSessionRenameIcon />
              <span>{t("shell.renameAction")}</span>
            </button>
            <div className="workbench-session-submenu" data-open={exportSubmenuOpen}>
              <button
                type="button"
                className="workbench-session-menu-item"
                aria-haspopup="menu"
                aria-expanded={exportSubmenuOpen}
                onClick={() => setExportSubmenuOpen((current) => !current)}
              >
                <AffairsSessionExportIcon />
                <span>{t("conversation.exportAction")}</span>
                <span className="workbench-session-submenu-caret" aria-hidden="true">›</span>
              </button>
              {exportSubmenuOpen ? (
                <div className="workbench-session-submenu-panel" role="menu" aria-label={t("conversation.exportAction")}>
                  <button
                    type="button"
                    className="workbench-session-menu-item"
                    role="menuitem"
                    onClick={() => {
                      void onExport("md").finally(closeMenu);
                    }}
                  >
                    <span>{t("conversation.exportMarkdownAction")}</span>
                  </button>
                  <button
                    type="button"
                    className="workbench-session-menu-item"
                    role="menuitem"
                    onClick={() => {
                      void onExport("pdf").finally(closeMenu);
                    }}
                  >
                    <span>{t("conversation.exportPdfAction")}</span>
                  </button>
                  <button
                    type="button"
                    className="workbench-session-menu-item"
                    role="menuitem"
                    onClick={() => {
                      void onExport("html").finally(closeMenu);
                    }}
                  >
                    <span>{t("conversation.exportHtmlAction")}</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                void onToggleFavorite().finally(closeMenu);
              }}
            >
              <AffairsSessionStarIcon active={item.session.isFavorite} />
              <span>{item.session.isFavorite ? t("shell.unfavoriteAction") : t("shell.favoriteAction")}</span>
            </button>
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                void onArchive().finally(closeMenu);
              }}
            >
              <AffairsSessionArchiveIcon />
              <span>{t("shell.archiveAction")}</span>
            </button>
            <button
              type="button"
              className="workbench-session-menu-item"
              onClick={() => {
                closeMenu();
                void onDelete();
              }}
            >
              <AffairsSessionDeleteIcon />
              <span>{t("shell.deleteSessionAction")}</span>
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <article
      role={role}
      className="workbench-session-card affairs-conversation-session-card"
      data-active={isActive}
      data-kind={item.kind}
      data-workspace-tone="root"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (platform.isDesktop) {
          void openDesktopSessionMenu();
          return;
        }
        openMenuAt({
          x: event.clientX,
          y: event.clientY
        });
      }}
    >
      <div className="workbench-session-main">
        <span
          className={buildAffairsConversationIndicatorClassName(item.session, { isActive })}
          data-activity-source={item.session.activitySource}
          aria-hidden="true"
        />
        <button
          type="button"
          className="workbench-session-link"
          data-active={isActive}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (platform.isDesktop) {
              void openDesktopSessionMenu();
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            openMenuAt({
              x: rect.right,
              y: rect.bottom
            });
          }}
        >
          <div className="workbench-session-link-copy">
            <div className="session-title-row">
              <span className="session-title" title={item.session.title}>{item.session.title}</span>
              {item.session.isFavorite ? (
                <span className="affairs-conversation-favorite-badge" aria-hidden="true">
                  <AffairsSessionStarIcon active />
                </span>
              ) : null}
            </div>
            <div className="session-meta-row">
              <span className="session-meta">
                {[resolveAffairsConversationKindLabel(item.kind), sessionMeta].filter(Boolean).join(" · ")}
              </span>
              {sessionActivityBadgeLabel && sessionActivityBadgeClassName ? (
                <span className={sessionActivityBadgeClassName}>{sessionActivityBadgeLabel}</span>
              ) : null}
              <span className={`session-provider-badge ${item.session.provider}`}>{formatAffairsConversationProviderBadge(item.session.provider)}</span>
            </div>
          </div>
        </button>
      </div>
      {sessionMenu}
    </article>
  );
}

export function AffairsSidebarPanel() {
  const {
    activeSection,
    agentWorkspaceId,
    agentConversationSessions,
    agentConversationSessionsReady,
    agentConversationSessionsLoading,
    binding,
    butlerStore,
    initGuard,
    lightweightConversationSessions,
    lightweightConversationSessionsLoading,
    markConversationSessionSeen,
    openConversationCreateModal,
    openTagManagement,
    archiveConversationSession,
    unarchiveConversationSession,
    documentRecords,
    favoriteEntries,
    folderRecords,
    indexStatus,
    sidebarNodes,
    state,
    tagRecords,
    libraryTagFacetCounts,
    toggleFavorite,
    toggleConversationSessionFavorite,
    todoRecords,
    automationRecords,
    selectSidebarNode,
    selectedTagPaths,
    loading,
    error,
    libraryDocumentTotal,
    openConversationRenameModal,
    openConversationDeleteModal,
    exportConversationSession
  } = useAffairsWorkbenchInternal();
  const butlerControlSession = useButlerRuntimeStore(butlerStore, (value) => value.controlSession);
  const platform = usePlatform();
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const { showToast } = useToast();
  const renderWithShortcutRail = (content: ReactNode) => (
    <div className="affairs-sidebar-shell">
      <div className="affairs-sidebar-content">
        {content}
      </div>
      <AffairsShortcutAppsRail />
    </div>
  );
  if (activeSection === "conversation" && initGuard.loading) {
    return renderWithShortcutRail(
      <section className="workbench-section-block affairs-sidebar-block">
        <div className="affairs-sidebar-block-header">
          <div>
            <h2>{t("shell.affairsConnectionCheckingTitle")}</h2>
            <p>{t("shell.affairsConnectionCheckingDescription")}</p>
          </div>
        </div>
        <div className="affairs-sidebar-empty">{t("shell.affairsConnectionCheckingSidebarEmpty")}</div>
      </section>
    );
  }

  if (activeSection === "conversation" && initGuard.unavailable) {
    return renderWithShortcutRail(
      <section className="workbench-section-block affairs-sidebar-block">
        <div className="affairs-sidebar-block-header">
          <div>
            <h2>{t("shell.affairsHostUnavailableTitle")}</h2>
            <p>{t("shell.affairsHostUnavailableDescription")}</p>
          </div>
        </div>
        <div className="affairs-sidebar-empty">{t("shell.affairsHostUnavailableSidebarEmpty")}</div>
      </section>
    );
  }

  if (activeSection === "conversation" && !initGuard.initialized) {
    return renderWithShortcutRail(
      <section className="workbench-section-block affairs-sidebar-block">
        <div className="affairs-sidebar-block-header">
          <div>
            <h2>{t("shell.affairsConversationSidebarTitle")}</h2>
            <p>{t("shell.affairsInitRouteGuardHint")}</p>
          </div>
        </div>
        <div className="affairs-sidebar-empty">{t("shell.affairsInitRouteGuardSidebarEmpty")}</div>
      </section>
    );
  }

  if (activeSection === "conversation") {
    const currentAgentSession = isAffairsControlSessionMatchWorkspaceId(butlerControlSession, agentWorkspaceId)
      ? (butlerControlSession?.session ?? null)
      : null;
    const agentItems =
      currentAgentSession
      && agentConversationSessions.every((session) => session.sessionId !== currentAgentSession.sessionId)
        ? [currentAgentSession, ...agentConversationSessions]
        : agentConversationSessions;
    const allConversationListItems: AffairsConversationListItem[] = [
      ...lightweightConversationSessions.map((session) => ({
        id: buildAffairsConversationSessionNodeId("lightweight", session.sessionId),
        kind: "lightweight" as const,
        session
      })),
      ...agentItems.map((session) => ({
        id: buildAffairsConversationSessionNodeId("agent", session.sessionId),
        kind: "agent" as const,
        session
      }))
    ].sort((left, right) => {
      if (left.session.isFavorite !== right.session.isFavorite) {
        return left.session.isFavorite ? -1 : 1;
      }
      return resolveConversationSessionSortTime(right.session) - resolveConversationSessionSortTime(left.session);
    });
    const conversationListItems = allConversationListItems.filter((item) => item.session.isArchived !== true);
    const archivedConversationListItems = allConversationListItems.filter((item) => item.session.isArchived === true);
    const conversationSessionsLoading = lightweightConversationSessionsLoading || agentConversationSessionsLoading;
    const showConversationBlockingLoading = conversationSessionsLoading && conversationListItems.length === 0;
    const conversationLoadingHint = conversationListItems.length > 0
      ? resolveConversationSidebarLoadingHint({
          lightweightLoading: lightweightConversationSessionsLoading,
          agentLoading: agentConversationSessionsLoading
        })
      : null;
    const archiveList = archivedConversationListItems.length > 0 ? (
      <ModalList className="workbench-archive-list">
        {archivedConversationListItems.map((item) => (
          <ModalListItem
            key={item.id}
            className="workbench-archive-item"
            trailing={(
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void unarchiveConversationSession({
                    kind: item.kind,
                    session: item.session
                  }).then(() => {
                    setArchiveModalOpen((current) => (
                      archivedConversationListItems.length > 1 ? current : false
                    ));
                  });
                }}
              >
                {t("shell.unarchiveAction")}
              </button>
            )}
          >
            <div className="workbench-archive-item-main">
              <strong title={item.session.title}>{item.session.title || t("common.unknown")}</strong>
              <p>
                {resolveAffairsConversationKindLabel(item.kind)} · {buildAffairsConversationMeta(item.session)} · {formatAffairsConversationProviderBadge(item.session.provider)}
              </p>
            </div>
          </ModalListItem>
        ))}
      </ModalList>
    ) : (
      <ModalEmptyState
        title={t("shell.archiveEmpty")}
        compact
        className="workbench-section-empty"
      />
    );
    return renderWithShortcutRail(
      <>
        <section className="workbench-section-block affairs-sidebar-block">
          <div className="affairs-sidebar-block-header affairs-sidebar-block-header-with-count">
            <div className="affairs-sidebar-block-header-title-row">
              <h2>{t("shell.affairsConversationSidebarTitle")}</h2>
              <span className="affairs-sidebar-block-count">{conversationListItems.length}</span>
            </div>
            <AffairsConversationCreateButton compact onClick={openConversationCreateModal} />
          </div>
          <div className="affairs-sidebar-groups" role="list">
            <section className="affairs-sidebar-group">
              {showConversationBlockingLoading ? (
                <div className="affairs-sidebar-empty compact">{t("common.loading")}</div>
              ) : (
                <>
                  {conversationListItems.length === 0 ? (
                    <div className="affairs-sidebar-empty affairs-sidebar-empty-plain compact">
                      {archivedConversationListItems.length > 0
                        ? t("shell.archiveModalDescription")
                        : t("shell.affairsConversationCreateHint")}
                    </div>
                  ) : (
                    <div className="workbench-session-list affairs-conversation-session-list" role="list">
                      {conversationListItems.map((item) => (
                        <AffairsConversationSessionCard
                          key={item.id}
                          item={item}
                          isActive={item.id === state.selectedNodeId}
                          role="listitem"
                          onOpen={() => {
                            markConversationSessionSeen(item.kind, item.session.sessionId);
                            selectSidebarNode(item.id);
                          }}
                          onRename={() => {
                            openConversationRenameModal({
                              kind: item.kind,
                              session: item.session
                            });
                          }}
                          onExport={async (format) => {
                            try {
                              await exportConversationSession({
                                session: item.session,
                                format
                              });
                              showToast({
                                title:
                                  format === "md"
                                    ? t("conversation.exportMarkdownSuccess")
                                    : format === "pdf"
                                      ? t("conversation.exportPdfPreparing")
                                      : t("conversation.exportHtmlSuccess"),
                                tone: "success"
                              });
                            } catch (error) {
                              showToast({
                                title: error instanceof Error ? error.message : t("conversation.exportLoadFailed"),
                                tone: "error"
                              });
                            }
                          }}
                          onToggleFavorite={() => toggleConversationSessionFavorite({
                            kind: item.kind,
                            session: item.session
                          })}
                          onArchive={() => archiveConversationSession({
                            kind: item.kind,
                            session: item.session
                          })}
                          onDelete={async () => {
                            openConversationDeleteModal({
                              kind: item.kind,
                              session: item.session
                            });
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {archivedConversationListItems.length > 0 ? (
                    <button
                      type="button"
                      className="workbench-archive-folder"
                      data-workspace-tone="root"
                      onClick={() => setArchiveModalOpen(true)}
                    >
                      <span className="workbench-archive-folder-main">
                        <AffairsArchiveFolderIcon />
                        <span>{t("shell.archiveFolderLabel")}</span>
                      </span>
                      <span className="workbench-section-counter">{archivedConversationListItems.length}</span>
                    </button>
                  ) : null}
                  {conversationLoadingHint ? (
                    <div className="affairs-sidebar-empty compact">{conversationLoadingHint}</div>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </section>
        {platform.isMobile ? (
          <MobileSheet
            open={archiveModalOpen}
            onClose={() => setArchiveModalOpen(false)}
            title={t("shell.archiveModalTitle")}
            description={t("shell.archiveModalDescription")}
            height="half"
          >
            {archiveList}
          </MobileSheet>
        ) : (
          <DesktopModal
            open={archiveModalOpen}
            onClose={() => setArchiveModalOpen(false)}
            title={t("shell.archiveModalTitle")}
            description={t("shell.archiveModalDescription")}
            size="regular"
          >
            {archiveList}
          </DesktopModal>
        )}
      </>
    );
  }

  if (activeSection === "workbench") {
    return (
      <div className="affairs-sidebar-shell">
        <AffairsShortcutAppsRail standalone />
      </div>
    );
  }

  if (activeSection !== "library") {
    const groupedSidebarNodes = groupSidebarNodes(activeSection, sidebarNodes);
    return renderWithShortcutRail(
      <section className="workbench-section-block affairs-sidebar-block">
        <div className="affairs-sidebar-block-header">
          <div>
            <h2>{resolveSectionSidebarTitle(activeSection)}</h2>
            <p>{resolveSectionSidebarDescription(activeSection, {
              documentCount: documentRecords.length,
              favoriteCount: favoriteEntries.length,
              tagCount: tagRecords.length,
              todoCount: todoRecords.length,
              automationCount: automationRecords.length
            })}</p>
          </div>
        </div>
        {loading ? <div className="affairs-sidebar-empty compact">{t("common.loading")}</div> : null}
        {error ? <div className="affairs-sidebar-empty">{error}</div> : null}
        {!loading && !error ? (
          <div className="affairs-sidebar-groups" role="list">
            {groupedSidebarNodes.length === 0 ? (
              <div className="affairs-sidebar-empty">{resolveSectionEmptyText(activeSection)}</div>
            ) : (
              groupedSidebarNodes.map((group) => (
                <section key={group.id} className="affairs-sidebar-group">
                  <header className="affairs-sidebar-group-header">
                    <span>{group.label}</span>
                    <span>{group.items.length}</span>
                  </header>
                  <div className="affairs-sidebar-list" role="list">
                    {group.items.map((node) => (
                      <div
                        key={node.id}
                        className={node.id === state.selectedNodeId ? "affairs-sidebar-item active" : "affairs-sidebar-item"}
                        data-tone={node.tone ?? "default"}
                      >
                        <button
                          type="button"
                          className="affairs-sidebar-item-button"
                          onClick={() => selectSidebarNode(node.id)}
                        >
                          <div className="affairs-sidebar-item-row">
                            <span className="affairs-sidebar-item-title">{node.label}</span>
                            {typeof node.count === "number" ? <span className="affairs-sidebar-item-badge">{node.count}</span> : null}
                          </div>
                          {node.summary ? <span className="affairs-sidebar-item-summary">{node.summary}</span> : null}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : null}
      </section>
    );
  }

  return renderWithShortcutRail(<AffairsLibrarySidebarContent />);
}

function AffairsLibrarySidebarContent() {
  const {
    binding,
    documentRecords,
    favoriteEntries,
    folderRecords,
    indexStatus,
    libraryTagFacetCounts,
    loading,
    error,
    openTagManagement,
    selectSidebarNode,
    selectedTagPaths,
    state,
    tagRecords,
    toggleFavorite
  } = useAffairsWorkbenchInternal();
  const favoriteFolderItems = favoriteEntries.filter((item) => item.kind === "folder");
  const favoriteTagItems = favoriteEntries.filter((item) => item.kind === "tag" && isVisibleTagPath(item.path));
  const [tagTreeState, setTagTreeState] = useState<StoredAffairsTagTreeState>(() => readStoredAffairsTagTreeState(state.workspaceId));
  const expandedTagPaths = tagTreeState.expandedPaths ?? [];
  const expandedOverflowPaths = tagTreeState.expandedOverflowPaths ?? [];
  const tagAccessCounts = tagTreeState.accessCounts ?? {};
  const tagTree = useMemo(() => buildTagTree(tagRecords, tagAccessCounts), [tagAccessCounts, tagRecords]);
  const hasTagSelection = selectedTagPaths.length > 0;
  const tagTreeWithCounts = useMemo(
    () => applyTagFacetCountsToTree(tagTree, libraryTagFacetCounts, hasTagSelection),
    [hasTagSelection, libraryTagFacetCounts, tagTree]
  );
  const tagTreeVisibility = useMemo(
    () => buildTagTreeVisibility(tagTreeWithCounts, selectedTagPaths, libraryTagFacetCounts),
    [libraryTagFacetCounts, selectedTagPaths, tagTreeWithCounts]
  );
  const visibleTagTree = useMemo(
    () => filterTagTreeByVisibility(tagTreeWithCounts, tagTreeVisibility.visiblePathSet),
    [tagTreeVisibility.visiblePathSet, tagTreeWithCounts]
  );

  useEffect(() => {
    setTagTreeState(readStoredAffairsTagTreeState(state.workspaceId));
  }, [state.workspaceId]);

  useEffect(() => {
    if (state.browseMode !== "tag" || selectedTagPaths.length === 0) {
      return;
    }
    setTagTreeState((previous) => {
      const nextExpandedPaths = new Set(previous.expandedPaths ?? []);
      selectedTagPaths.forEach((selectedPath) => {
        for (const parentPath of buildAncestorPaths(selectedPath)) {
          nextExpandedPaths.add(parentPath);
        }
      });
      const nextPaths = Array.from(nextExpandedPaths);
      const nextOverflowPaths = Array.from(new Set([
        ...(previous.expandedOverflowPaths ?? []),
        ...selectedTagPaths.flatMap((selectedPath) => collectOverflowPathsForSelection(visibleTagTree, selectedPath))
      ]));
      if (
        areStringArraysEqual(previous.expandedPaths ?? [], nextPaths)
        && areStringArraysEqual(previous.expandedOverflowPaths ?? [], nextOverflowPaths)
      ) {
        return previous;
      }
      return { ...previous, expandedPaths: nextPaths, expandedOverflowPaths: nextOverflowPaths };
    });
  }, [selectedTagPaths, state.browseMode, visibleTagTree]);

  useEffect(() => {
    if (state.browseMode !== "tag" || selectedTagPaths.length === 0) {
      return;
    }
    if (selectedTagPaths.every((tagPath) => tagRecords.some((tag) => tag.path === tagPath))) {
      return;
    }
    selectSidebarNode("library:tag-root");
  }, [selectSidebarNode, selectedTagPaths, state.browseMode, tagRecords]);

  useEffect(() => {
    persistAffairsTagTreeState(state.workspaceId, tagTreeState);
  }, [state.workspaceId, tagTreeState]);

  useEffect(() => {
    if (state.browseMode !== "tag" || selectedTagPaths.length === 0) {
      return;
    }
    setTagTreeState((previous) => {
      const accessCounts = previous.accessCounts ?? {};
      const nextAccessCounts = { ...accessCounts };
      selectedTagPaths.forEach((tagPath) => {
        nextAccessCounts[tagPath] = (nextAccessCounts[tagPath] ?? 0) + 1;
      });
      return {
        ...previous,
        accessCounts: nextAccessCounts
      };
    });
  }, [selectedTagPaths, state.browseMode]);

  const visibleTagRoots = useMemo(
    () => resolveVisibleTagChildren(visibleTagTree, TAG_TREE_ROOT_OVERFLOW_KEY, expandedOverflowPaths),
    [expandedOverflowPaths, visibleTagTree]
  );

  const toggleExpandedTagPath = (path: string) => {
    setTagTreeState((previous) => {
      const current = previous.expandedPaths ?? [];
      return {
        ...previous,
        expandedPaths: current.includes(path)
          ? current.filter((item) => item !== path)
          : [...current, path]
      };
    });
  };

  const toggleOverflowPath = (path: string) => {
    setTagTreeState((previous) => {
      const current = previous.expandedOverflowPaths ?? [];
      return {
        ...previous,
        expandedOverflowPaths: current.includes(path)
          ? current.filter((item) => item !== path)
          : [...current, path]
      };
    });
  };

  return (
    <section className="workbench-section-block affairs-sidebar-block">
      {loading ? <div className="affairs-sidebar-empty compact">{t("common.loading")}</div> : null}
      {error ? <div className="affairs-sidebar-empty">{error}</div> : null}
      {!loading && !error ? (
        <div className="affairs-sidebar-groups affairs-library-sidebar-groups">
          {favoriteEntries.length > 0 ? (
            <section className="affairs-sidebar-group affairs-sidebar-group-plain affairs-favorites-panel">
              <header className="affairs-sidebar-group-header">
                <span>{t("shell.affairsSectionGroupFavorites")}</span>
                <span>{favoriteEntries.length}</span>
              </header>
              <div className="affairs-sidebar-list affairs-sidebar-list-plain" role="list">
                <>
                  {favoriteFolderItems.length > 0 ? <div className="affairs-sidebar-subtitle">{t("shell.affairsLibraryBrowseModeFolder")}</div> : null}
                  {favoriteFolderItems.map((favorite) => {
                    const nodeId = buildFavoriteNodeId(favorite);
                    return (
                      <div
                        key={nodeId}
                        className={nodeId === state.selectedNodeId ? "affairs-sidebar-item active" : "affairs-sidebar-item"}
                        data-tone="favorite"
                      >
                        <div className="affairs-sidebar-item-button-shell">
                          <button type="button" className="affairs-sidebar-item-button affairs-sidebar-item-button-content" onClick={() => selectSidebarNode(nodeId)}>
                            <div className="affairs-sidebar-item-row">
                              <span className="affairs-sidebar-item-title">{favorite.label}</span>
                            </div>
                          </button>
                          <div className="affairs-sidebar-item-actions">
                            {renderFavoriteToggle(nodeId, favorite.label, toggleFavorite)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {favoriteTagItems.length > 0 ? <div className="affairs-sidebar-subtitle">{t("shell.affairsLibraryBrowseModeTag")}</div> : null}
                  {favoriteTagItems.map((favorite) => {
                    const nodeId = buildFavoriteNodeId(favorite);
                    return (
                      <div
                        key={nodeId}
                        className={nodeId === state.selectedNodeId ? "affairs-sidebar-item active" : "affairs-sidebar-item"}
                        data-tone="favorite"
                      >
                        <div className="affairs-sidebar-item-button-shell">
                          <button type="button" className="affairs-sidebar-item-button affairs-sidebar-item-button-content" onClick={() => selectSidebarNode(nodeId)}>
                            <div className="affairs-sidebar-item-row">
                              <span className="affairs-sidebar-item-title">{favorite.label}</span>
                            </div>
                          </button>
                          <div className="affairs-sidebar-item-actions">
                            {renderFavoriteToggle(nodeId, favorite.label, toggleFavorite)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              </div>
            </section>
          ) : null}

          <section className="affairs-sidebar-group affairs-sidebar-group-plain affairs-tag-tree-panel">
            <header className="affairs-sidebar-group-header">
              <span>{t("shell.affairsLibraryTagTreeTitle")}</span>
              <div className="affairs-sidebar-group-header-actions">
                <span>{tagRecords.length}</span>
                {hasTagSelection ? (
                  <button
                    type="button"
                    className="affairs-tag-tree-icon-button affairs-tag-tree-reset"
                    aria-label={t("shell.affairsLibraryTagTreeReset")}
                    title={t("shell.affairsLibraryTagTreeReset")}
                    onClick={() => selectSidebarNode("library:tag-root")}
                  >
                    <ResetFilterIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="affairs-tag-tree-icon-button"
                  aria-label={t("shell.affairsTagManagerAction")}
                  title={t("shell.affairsTagManagerAction")}
                  onClick={openTagManagement}
                >
                  <AffairsTagManagerIcon />
                </button>
              </div>
            </header>
            {visibleTagTree.length === 0 ? (
              <div className="affairs-sidebar-empty affairs-sidebar-empty-plain compact">{resolveLibraryEmptyText(indexStatus)}</div>
            ) : (
              <div className="affairs-tag-tree-list" role="tree" aria-label={t("shell.affairsLibraryTagTreeTitle")}>
                {visibleTagRoots.map((node) => (
                  <AffairsTagTreeNode
                    key={node.path}
                    node={node}
                    state={state}
                    selectedTagPaths={selectedTagPaths}
                    expandedPaths={expandedTagPaths}
                    expandedOverflowPaths={expandedOverflowPaths}
                    onSelect={selectSidebarNode}
                    onToggleExpand={toggleExpandedTagPath}
                    onToggleOverflow={toggleOverflowPath}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
                {visibleTagTree.length > TAG_TREE_CHILDREN_VISIBLE_LIMIT ? (
                  <button
                    type="button"
                    className="affairs-tag-tree-more"
                    onClick={() => toggleOverflowPath(TAG_TREE_ROOT_OVERFLOW_KEY)}
                  >
                    <span className="affairs-tag-tree-more-icon" aria-hidden="true">
                      {expandedOverflowPaths.includes(TAG_TREE_ROOT_OVERFLOW_KEY) ? "▴" : "▾"}
                    </span>
                    <span className="affairs-tag-tree-more-label">
                      {expandedOverflowPaths.includes(TAG_TREE_ROOT_OVERFLOW_KEY)
                        ? t("shell.affairsLibraryTagTreeShowLess")
                        : t("shell.affairsLibraryTagTreeShowMore")}
                    </span>
                  </button>
                ) : null}
              </div>
            )}
          </section>
          {binding && folderRecords.length === 0 && tagRecords.length === 0 ? (
            <div className="affairs-sidebar-empty affairs-sidebar-empty-plain">{resolveLibraryEmptyText(indexStatus)}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AffairsConversationCreateButton({
  compact = false,
  onClick
}: {
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={compact
        ? "secondary-button affairs-conversation-create-trigger icon-only"
        : "secondary-button affairs-conversation-create-trigger"}
      aria-label={t("shell.affairsConversationCreateAction")}
      title={t("shell.affairsConversationCreateAction")}
      onClick={onClick}
    >
      <AffairsConversationPlusIcon />
      {compact ? null : <span>{t("shell.affairsConversationCreateAction")}</span>}
    </button>
  );
}

function AffairsConversationPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 4.25V15.75M4.25 10H15.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AffairsConversationDraftPreview({ compact = false }: { compact?: boolean }) {
  const { selectedConversationDraft } = useAffairsWorkbenchInternal();

  if (!selectedConversationDraft) {
    return (
      <div className={compact ? "affairs-conversation-draft-preview compact" : "affairs-conversation-draft-preview"}>
        <strong>{t("shell.affairsConversationNoDraftTitle")}</strong>
        <p>{t("shell.affairsConversationNoDraftDescription")}</p>
      </div>
    );
  }

  return (
    <div className={compact ? "affairs-conversation-draft-preview compact" : "affairs-conversation-draft-preview"}>
      <div className="affairs-conversation-option-topline">
        <span className="affairs-inline-pill subtle">
          {resolveAffairsConversationKindLabel(selectedConversationDraft.kind)}
        </span>
        <span className="affairs-inline-pill">
          {resolveAffairsConversationProviderLabel(selectedConversationDraft.provider)}
        </span>
      </div>
      <strong>{t("shell.affairsConversationSelectedDraftTitle")}</strong>
      <p>{buildAffairsConversationDraftSummary(selectedConversationDraft)}</p>
    </div>
  );
}

function AffairsConversationCreateProviderSection({
  kind,
  title,
  description,
  providers
}: {
  kind: AffairsConversationKind;
  title: string;
  description: string;
  providers: ProviderId[];
}) {
  const {
    agentWorkspaceId,
    closeConversationCreateModal,
    conversationCreateModalMode,
    prepareAssistantConversation,
    selectConversationDraft
  } = useAffairsWorkbenchInternal();

  return (
    <section className="create-session-modal-section affairs-conversation-create-modal-section">
      <div className="create-session-modal-section-header">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <SessionProviderPicker
        workspaceId={kind === "agent" ? agentWorkspaceId : null}
        providers={providers}
        onSelect={(provider) => {
          if (conversationCreateModalMode === "agent-only" && kind === "agent" && isAffairsAssistantProvider(provider)) {
            void prepareAssistantConversation(provider).finally(() => {
              closeConversationCreateModal();
            });
            return;
          }
          selectConversationDraft({ kind, provider });
          closeConversationCreateModal();
        }}
      />
    </section>
  );
}

const AFFAIRS_STANDALONE_SESSION_EXPORT_OVERRIDES = `
html,
body {
  width: 100% !important;
  height: auto !important;
  min-height: auto !important;
  overflow: visible !important;
  overflow-x: visible !important;
}

body {
  margin: 0 !important;
  padding: 0 !important;
}

.session-export-document-root {
  position: static !important;
  inset: auto !important;
  z-index: auto !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  overflow: visible !important;
}

.session-export-document-root,
.session-export-document-root * {
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  letter-spacing: normal !important;
  word-spacing: normal !important;
  text-align: left !important;
  -webkit-text-fill-color: currentColor !important;
  text-fill-color: currentColor !important;
  -webkit-background-clip: border-box !important;
  background-clip: border-box !important;
  text-shadow: none !important;
  mix-blend-mode: normal !important;
}

.session-export-document-root .markdown-content p,
.session-export-document-root .markdown-content blockquote,
.session-export-document-root .markdown-content td {
  display: block !important;
}

.session-export-document-root .markdown-content li {
  display: list-item !important;
}

.session-export-document-root .markdown-content code,
.session-export-document-root .markdown-content pre,
.session-export-document-root .code-block pre,
.session-export-document-root .tool-call-section pre,
.session-export-document-root .tool-call-input-preview,
.session-export-document-root .apply-patch-line-content,
.session-export-document-root .apply-patch-summary-file {
  font-family:
    var(--font-mono, "SF Mono", "Consolas", "Cascadia Code", "Courier New", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace) !important;
}

.session-export-document-root .thinking-message-label,
.session-export-document-root .thinking-status-text {
  background: none !important;
  color: var(--text-secondary, #475569) !important;
  -webkit-text-fill-color: currentColor !important;
  animation: none !important;
}

@media print {
  body * {
    visibility: hidden;
  }

  .session-export-document-root,
  .session-export-document-root * {
    visibility: visible;
  }

  .session-export-document-root {
    position: static !important;
  }

  .session-export-document-root .session-export-print-shell {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
  }

  .session-export-document-root .message-timeline-export,
  .session-export-document-root .message-timeline-export .message-list-export {
    overflow: visible;
    height: auto;
    max-height: none;
  }

  .session-export-document-root .tool-call-header,
  .session-export-document-root .tool-call-info,
  .session-export-document-root .task-tool-header,
  .session-export-document-root .task-tool-heading,
  .session-export-document-root .task-tool-heading-main,
  .session-export-document-root .task-tool-list-item,
  .session-export-document-root .assistant-capability-header,
  .session-export-document-root .assistant-capability-heading,
  .session-export-document-root .assistant-capability-heading-main,
  .session-export-document-root .assistant-capability-row,
  .session-export-document-root .apply-patch-summary-row,
  .session-export-document-root .rules-message-toggle {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: flex-start !important;
    justify-content: flex-start !important;
  }

  .session-export-document-root .task-tool-list-item,
  .session-export-document-root .assistant-capability-row,
  .session-export-document-root .apply-patch-summary-row {
    row-gap: 4px !important;
  }

  .session-export-document-root .tool-call-input-preview,
  .session-export-document-root .rules-message-summary,
  .session-export-document-root .task-tool-summary-text,
  .session-export-document-root .task-tool-item-title,
  .session-export-document-root .task-tool-item-detail,
  .session-export-document-root .task-tool-item-status,
  .session-export-document-root .assistant-capability-heading-main strong,
  .session-export-document-root .assistant-capability-summary,
  .session-export-document-root .assistant-capability-row-label,
  .session-export-document-root .assistant-capability-row-value,
  .session-export-document-root .apply-patch-summary-file,
  .session-export-document-root .apply-patch-summary-stats,
  .session-export-document-root .session-title,
  .session-export-document-root .message-text,
  .session-export-document-root .markdown-content,
  .session-export-document-root .thinking-message-text,
  .session-export-document-root .thinking-message-text :where(p, li, blockquote, strong, em, a, span),
  .session-export-document-root .thinking-message-label,
  .session-export-document-root .thinking-status-text {
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: clip !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
  }

  .session-export-document-root .assistant-capability-summary {
    display: inline !important;
  }

  .session-export-document-root .task-tool-list {
    list-style: decimal !important;
    padding-left: 24px !important;
  }

  .session-export-document-root .message-timeline-export .conversation-scroll-to-bottom-button,
  .session-export-document-root .message-timeline-export .message-metadata-bar,
  .session-export-document-root .message-timeline-export .retry-button,
  .session-export-document-root .message-timeline-export .code-copy-button,
  .session-export-document-root .message-timeline-export .rules-message-action,
  .session-export-document-root .message-timeline-export .message-origin-detail-popover {
    display: none !important;
  }

  .session-export-document-root .message-item,
  .session-export-document-root .tool-message-row,
  .session-export-document-root .rules-message-row {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

async function waitForAffairsSessionExportAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function waitForAffairsSessionExportTimeout(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

async function waitForAffairsSessionExportFonts(doc: Document, timeoutMs: number): Promise<void> {
  const fontFaceSet = doc.fonts;
  if (!fontFaceSet || typeof fontFaceSet.ready === "undefined") {
    return;
  }
  await Promise.race([
    fontFaceSet.ready.catch(() => undefined),
    waitForAffairsSessionExportTimeout(timeoutMs)
  ]);
}

function waitForAffairsSessionExportImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const cleanup = () => {
      image.removeEventListener("load", handleDone);
      image.removeEventListener("error", handleDone);
    };
    const handleDone = () => {
      cleanup();
      resolve();
    };
    image.addEventListener("load", handleDone, { once: true });
    image.addEventListener("error", handleDone, { once: true });
  });
}

async function waitForAffairsSessionExportImages(root: HTMLElement, timeoutMs: number): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }
  await Promise.race([
    Promise.all(images.map((image) => waitForAffairsSessionExportImage(image))),
    waitForAffairsSessionExportTimeout(timeoutMs)
  ]);
}

async function waitForAffairsSessionExportRender(root: HTMLElement | null, doc: Document = document): Promise<void> {
  await waitForAffairsSessionExportAnimationFrame();
  await waitForAffairsSessionExportAnimationFrame();
  await waitForAffairsSessionExportTimeout(420);
  await waitForAffairsSessionExportFonts(doc, 1800);
  if (!root) {
    return;
  }
  await waitForAffairsSessionExportImages(root, 1800);
}

function collectAffairsSessionExportStyles(): string {
  if (typeof document === "undefined") {
    return "";
  }
  const styleChunks: string[] = [];
  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const rules = styleSheet.cssRules;
      if (!rules || rules.length === 0) {
        continue;
      }
      styleChunks.push(Array.from(rules).map((rule) => rule.cssText).join("\n"));
    } catch {
      continue;
    }
  }
  return styleChunks.join("\n");
}

function collectAffairsSessionExportAttributes(element: HTMLElement): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === "style") {
      continue;
    }
    attributes[attribute.name] = attribute.value;
  }
  return attributes;
}

function captureAffairsSessionExportLayoutSnapshot(): { shellWidthPx: number | null } {
  if (typeof document === "undefined") {
    return { shellWidthPx: null };
  }
  const selectors = [
    ".affairs-conversation-timeline-shell",
    ".conversation-timeline-shell",
    ".affairs-conversation-main",
    ".conversation-main",
    ".conversation-panel"
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      continue;
    }
    return { shellWidthPx: Math.round(rect.width) };
  }
  return { shellWidthPx: null };
}

function AffairsConversationRenameModal({
  target,
  value,
  busySessionId,
  onChange,
  onClose,
  onSubmit
}: {
  target: AffairsConversationRenameTarget;
  value: string;
  busySessionId: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
}) {
  return (
    <WorkbenchModal
      open={target !== null}
      title={t("shell.renameModalTitle")}
      description={t("shell.renameModalDescription")}
      onClose={onClose}
    >
      <form className="workbench-rename-form" onSubmit={onSubmit}>
        <ModalField label={t("shell.renameInputLabel")} htmlFor="affairs-conversation-rename-input">
          <input
            id="affairs-conversation-rename-input"
            type="text"
            value={value}
            placeholder={t("shell.renameInputPlaceholder")}
            maxLength={120}
            autoFocus
            onChange={(event) => onChange(event.target.value)}
          />
        </ModalField>
        <ModalActions>
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(busySessionId)}
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={!value.trim() || busySessionId === target?.session.sessionId}
          >
            {busySessionId === target?.session.sessionId ? t("shell.renamingSession") : t("common.save")}
          </button>
        </ModalActions>
      </form>
    </WorkbenchModal>
  );
}

function AffairsConversationDeleteModal({
  target,
  busySessionId,
  onClose,
  onConfirm
}: {
  target: AffairsConversationDeleteTarget;
  busySessionId: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <WorkbenchModal
      open={target !== null}
      title={t("shell.deleteSessionConfirmTitle")}
      description={t("shell.deleteSessionConfirmDescription")}
      onClose={onClose}
    >
      <ModalSection>
        {target ? <p>{target.session.title || t("conversation.titleFallback")}</p> : null}
      </ModalSection>
      <ModalActions>
        <button
          type="button"
          className="secondary-button"
          disabled={Boolean(busySessionId)}
          onClick={onClose}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="workbench-danger-button"
          disabled={busySessionId === target?.session.sessionId}
          onClick={() => {
            void onConfirm();
          }}
        >
          {busySessionId === target?.session.sessionId ? t("common.loading") : t("shell.deleteSessionAction")}
        </button>
      </ModalActions>
    </WorkbenchModal>
  );
}

function AffairsConversationCreateModal() {
  const {
    binding,
    conversationCreateModalOpen,
    conversationCreateModalMode,
    closeConversationCreateModal,
    agentWorkspacePath,
    workspaceName
  } = useAffairsWorkbenchInternal();
  const boundLibraryPathLabel = useMemo(
    () => resolveAffairsConversationCreateWorkspaceLabel({
      rootDir: binding?.rootDir ?? null,
      mirrorRoot: binding?.mirrorRoot ?? null,
      agentWorkspacePath,
      workspaceName
    }),
    [agentWorkspacePath, binding?.mirrorRoot, binding?.rootDir, workspaceName]
  );

  return (
    <WorkbenchModal
      open={conversationCreateModalOpen}
      title={t("shell.createSessionModalTitle")}
      description={boundLibraryPathLabel
        ? t("shell.affairsConversationCreateModalDescriptionWithWorkspace", { workspace: boundLibraryPathLabel })
        : t("shell.affairsConversationCreateModalDescription")}
      className="workbench-create-session-modal affairs-conversation-create-modal"
      onClose={closeConversationCreateModal}
    >
      {conversationCreateModalMode !== "agent-only" ? (
        <AffairsConversationCreateProviderSection
          kind="lightweight"
          title={t("shell.affairsConversationLightweightTitle")}
          description={t("shell.affairsConversationLightweightDescription")}
          providers={AFFAIRS_LIGHTWEIGHT_PROVIDER_IDS}
        />
      ) : null}
      <AffairsConversationCreateProviderSection
        kind="agent"
        title={t("shell.affairsConversationAssistantTitle")}
        description={t("shell.affairsConversationAssistantDescription")}
        providers={AFFAIRS_ASSISTANT_PROVIDER_IDS}
      />
    </WorkbenchModal>
  );
}

function AffairsConversationEmptyState() {
  const { openConversationCreateModal, selectedConversationDraft } = useAffairsWorkbenchInternal();
  const guideItems = [
    {
      title: t("shell.affairsConversationEmptyCreateTitle"),
      body: t("shell.affairsConversationEmptyCreateBody")
    },
    selectedConversationDraft
      ? {
          title: t("shell.affairsConversationEmptySelectedTitle"),
          body: buildAffairsConversationDraftSummary(selectedConversationDraft)
        }
      : {
          title: t("shell.affairsConversationEmptyModeTitle"),
          body: t("shell.affairsConversationEmptyModeBody")
        },
    {
      title: t("shell.affairsConversationEmptyCompanionTitle"),
      body: t("shell.affairsConversationEmptyCompanionBody")
    }
  ] as const;

  return (
    <div className="affairs-conversation-empty-state">
      <section className="workbench-empty-guide surface-card affairs-conversation-empty-guide">
        <p className="workbench-empty-eyebrow">{t("shell.affairsConversationEmptyEyebrow")}</p>
        <div className="workbench-empty-main affairs-conversation-empty-main">
          <div className="workbench-empty-copy affairs-conversation-empty-copy">
            <h1>{t("shell.affairsConversationStageTitle")}</h1>
            <p className="workbench-empty-body">{t("shell.affairsConversationEmptyBody")}</p>
            <div className="affairs-conversation-empty-actions">
              <AffairsConversationCreateButton onClick={openConversationCreateModal} />
            </div>
          </div>
        </div>
        <ol className="workbench-empty-steps affairs-conversation-empty-steps">
          {guideItems.map((item, index) => (
            <li key={item.title} className="workbench-empty-step">
              <span className="workbench-empty-step-index">{index + 1}</span>
              <div className="workbench-empty-step-copy">
                <h2>{item.title}</h2>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="workbench-empty-tip">{t("shell.affairsConversationEmptyTip")}</p>
      </section>
    </div>
  );
}

function AffairsConnectionCheckingState() {
  return (
    <div className="affairs-conversation-empty-state">
      <header className="affairs-conversation-empty-header">
        <span className="affairs-inline-pill">{t("shell.workbenchModeAffairs")}</span>
        <h2>{t("shell.affairsConnectionCheckingTitle")}</h2>
        <p>{t("shell.affairsConnectionCheckingDescription")}</p>
      </header>
    </div>
  );
}

function AffairsLightweightConversationDraftState(input: {
  workspaceId: string;
  draft: AffairsConversationDraftSelection;
}) {
  const {
    activateConversationSession,
    reloadLightweightConversationSessions,
    lightweightRuntimeBySessionId,
    setLightweightRuntimeSnapshot
  } = useAffairsWorkbenchInternal();
  const capabilities = useMemo(
    () => createAffairsLightweightCapabilities(input.draft.provider),
    [input.draft.provider]
  );
  const session = useMemo(
    () => createAffairsConversationDraftSessionSummary(input.workspaceId, input.draft),
    [input.draft, input.workspaceId]
  );
  const runtimeSnapshot = lightweightRuntimeBySessionId[session.sessionId]
    ?? createAffairsLightweightRuntimeSnapshot({
      session,
      historyState: "ready"
    });

  return (
    <main className="workbench-page conversation-page-shell affairs-conversation-page-shell" data-affairs-section="conversation">
      <div className="conversation-main affairs-conversation-main">
        <SessionHeader session={session} />
        <AffairsLightweightStreamingStatusBar status={runtimeSnapshot.streamingToolStatus} />
        <div className="conversation-timeline-shell affairs-conversation-timeline-shell">
          <MessageTimeline
            sessionId={session.sessionId}
            sessionSummary={session}
            workspaceId={session.workspaceId}
            workspacePath={null}
            items={buildConversationTimelineSourceItems({ messages: runtimeSnapshot.messages })}
            historyState={runtimeSnapshot.historyState}
            provider={input.draft.provider}
            onRetryMessage={() => {}}
          />
        </div>
        <ComposerPanel
          capabilities={capabilities}
          draftStorageId={buildAffairsConversationDraftNodeId(input.draft)}
          workspaceId={input.workspaceId}
          contextUsage={null}
          taskProvider={input.draft.provider}
          taskMessages={runtimeSnapshot.messages}
          isSubmitting={runtimeSnapshot.sending}
          isRunning={false}
          onSend={async (content, options) => {
            const clientRequestId = createAffairsConversationClientRequestId();
            const initialMessages = [
              ...runtimeSnapshot.messages,
              createPendingMessage(
                session.sessionId,
                content,
                clientRequestId,
                options?.attachmentMeta ?? [],
                options?.attachments ?? []
              ),
              createLightweightStreamingAssistantPlaceholder(session.sessionId, clientRequestId)
            ];
            setLightweightRuntimeSnapshot(session.sessionId, createAffairsLightweightRuntimeSnapshot({
              session,
              messages: initialMessages,
              historyState: "ready",
              sending: true,
              streamingToolStatus: null
            }));

            let activeSessionId: string | null = null;

            try {
              const created = await startAffairsLightweightSessionStream(input.workspaceId, {
                provider: input.draft.provider,
                content,
                clientRequestId,
                model: options?.model ?? null,
                reasoningLevel: options?.reasoningLevel ?? null
              }, (event) => {
                if (event.type === "started") {
                  activeSessionId = event.session.sessionId;
                  const liveMessages = initialMessages.map((message) => ({
                    ...message,
                    sessionId: event.session.sessionId
                  }));
                  setLightweightRuntimeSnapshot(event.session.sessionId, createAffairsLightweightRuntimeSnapshot({
                    session: event.session,
                    messages: liveMessages,
                    historyState: "ready",
                    sending: true,
                    streamingToolStatus: null
                  }));
                  setLightweightRuntimeSnapshot(session.sessionId, null);
                  activateConversationSession({
                    kind: "lightweight",
                    session: event.session,
                    bootstrapMessages: []
                  });
                  void reloadLightweightConversationSessions();
                  return;
                }

                const targetSessionId = resolveAffairsLightweightRuntimeSessionId({
                  fallbackSessionId: session.sessionId,
                  activeSessionId,
                  eventSessionId: null
                });

                if (event.type === "delta") {
                  setLightweightRuntimeSnapshot(targetSessionId, (current) => {
                    const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
                      session: targetSessionId === session.sessionId ? session : null,
                      historyState: "ready"
                    });
                    return {
                      ...snapshot,
                      messages: appendLightweightStreamingAssistantDelta(snapshot.messages, targetSessionId, clientRequestId, event.delta)
                    };
                  });
                  return;
                }

                if (event.type === "tool") {
                  setLightweightRuntimeSnapshot(targetSessionId, (current) => {
                    const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
                      session: targetSessionId === session.sessionId ? session : null,
                      historyState: "ready"
                    });
                    return {
                      ...snapshot,
                      messages: upsertAffairsLightweightToolMessage(snapshot.messages, {
                        sessionId: targetSessionId,
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        status: event.status,
                        detail: event.detail ?? null,
                        toolInput: event.input ?? null,
                        toolOutput: event.output ?? null
                      }),
                      streamingToolStatus: createAffairsLightweightToolStatus(event.toolName, event.detail ?? null, event.status)
                    };
                  });
                }
              });

              const liveSession = created.session;
              setLightweightRuntimeSnapshot(liveSession.sessionId, (current) => createAffairsLightweightRuntimeSnapshot({
                session: liveSession,
                messages: created.messages.length > 0
                  ? created.messages.map((message) => convertHistoryMessageToViewModel(message, liveSession.sessionId))
                  : (current?.messages
                    ?? lightweightRuntimeBySessionId[liveSession.sessionId]?.messages
                    ?? initialMessages.map((message) => ({
                      ...message,
                      sessionId: liveSession.sessionId
                    }))),
                historyState: "ready",
                sending: false,
                streamingToolStatus: null
              }));
              await reloadLightweightConversationSessions();
              activateConversationSession({
                kind: "lightweight",
                session: liveSession,
                bootstrapMessages: created.messages
              });
            } catch (error) {
              const failedSessionId = activeSessionId ?? session.sessionId;
              setLightweightRuntimeSnapshot(failedSessionId, (current) => {
                const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
                  session: failedSessionId === session.sessionId ? session : null,
                  historyState: "ready"
                });
                return {
                  ...snapshot,
                  messages: markPendingAsFailed(snapshot.messages, clientRequestId),
                  sending: false,
                  streamingToolStatus: snapshot.streamingToolStatus
                    ? { ...snapshot.streamingToolStatus, phase: "failed" }
                    : null
                };
              });
              throw error;
            } finally {
              const finalSessionId = activeSessionId ?? session.sessionId;
              setLightweightRuntimeSnapshot(finalSessionId, (current) => {
                if (!current) {
                  return current;
                }
                return {
                  ...current,
                  sending: false
                };
              });
            }
          }}
        />
      </div>
    </main>
  );
}

function AffairsLightweightConversationLiveState(input: {
  sessionId: string;
  runtimeSeed: AffairsConversationRuntimeSeed;
}) {
  const runtime = useAffairsLightweightSessionController({
    sessionId: input.sessionId,
    externalSession:
      input.runtimeSeed?.session.sessionId === input.sessionId
        ? input.runtimeSeed.session
        : null,
    bootstrapMessages:
      input.runtimeSeed?.session.sessionId === input.sessionId
        ? input.runtimeSeed.bootstrapMessages
        : []
  });
  const session = runtime.session;

  return (
    <main className="workbench-page conversation-page-shell affairs-conversation-page-shell" data-affairs-section="conversation">
      <div className="conversation-main affairs-conversation-main">
        <SessionHeader session={session} />
        <AffairsLightweightStreamingStatusBar status={runtime.streamingToolStatus} />
        <PermissionRequestList
          requests={runtime.permissionRequests}
          replyingRequestId={runtime.replyingPermissionRequestId}
          onReply={runtime.replyPermissionRequest}
        />
        <div className="conversation-timeline-shell affairs-conversation-timeline-shell">
          <MessageTimeline
            sessionId={input.sessionId}
            sessionSummary={session}
            workspaceId={session?.workspaceId ?? input.runtimeSeed?.session.workspaceId ?? null}
            workspacePath={null}
            items={runtime.timelineItems}
            historyState={runtime.historyState}
            loadingOlderMessages={runtime.loadingOlderMessages}
            hasOlderMessages={runtime.hasOlderMessages}
            provider={session?.provider ?? input.runtimeSeed?.session.provider ?? null}
            interruptedSource={runtime.runtimeInterruptSource}
            onLoadOlderMessages={runtime.loadOlderMessages}
            onRetryMessage={runtime.retryMessage}
          />
        </div>
        <ComposerPanel
          capabilities={runtime.capabilities}
          draftStorageId={input.sessionId}
          workspaceId={session?.workspaceId ?? input.runtimeSeed?.session.workspaceId ?? null}
          initialProviderConfigMode={"global-default"}
          initialProviderPresetId={null}
          hasActiveRun={false}
          canInterrupt={false}
          contextUsage={null}
          taskProvider={session?.provider ?? input.runtimeSeed?.session.provider ?? null}
          taskMessages={runtime.messages}
          isSubmitting={runtime.sending}
          isRunning={false}
          onSend={runtime.send}
        />
      </div>
    </main>
  );
}

function useAffairsLightweightSessionController(input: {
  sessionId: string;
  externalSession: SessionSummaryDto | null;
  bootstrapMessages: HistoryMessageDto[];
}) {
  const {
    workspaceId,
    reloadLightweightConversationSessions,
    lightweightRuntimeBySessionId,
    setLightweightRuntimeSnapshot
  } = useAffairsWorkbenchInternal();
  const runtimeSnapshot = lightweightRuntimeBySessionId[input.sessionId] ?? null;
  const bootstrapViewMessages = useMemo(
    () => input.bootstrapMessages.map((message) => convertHistoryMessageToViewModel(message, input.sessionId)),
    [input.bootstrapMessages, input.sessionId]
  );

  useEffect(() => {
    if (!runtimeSnapshot && input.externalSession) {
      setLightweightRuntimeSnapshot(input.sessionId, createAffairsLightweightRuntimeSnapshot({
        session: input.externalSession,
        messages: bootstrapViewMessages,
        historyState: input.bootstrapMessages.length > 0 ? "ready" : "loading",
        sending: false,
        streamingToolStatus: null
      }));
      return;
    }

    if (!input.externalSession) {
      return;
    }

    const externalSession = input.externalSession;
    setLightweightRuntimeSnapshot(input.sessionId, (current) => {
      if (!current || current.session?.sessionId === externalSession.sessionId) {
        return current;
      }
      return {
        ...current,
        session: externalSession
      };
    });
  }, [bootstrapViewMessages, input.bootstrapMessages.length, input.externalSession, input.sessionId, runtimeSnapshot, setLightweightRuntimeSnapshot]);

  useEffect(() => {
    if (input.bootstrapMessages.length === 0) {
      return;
    }

    setLightweightRuntimeSnapshot(input.sessionId, (current) => {
      const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
        session: input.externalSession,
        historyState: "ready"
      });
      if (snapshot.messages.length > 0) {
        return snapshot;
      }
      return {
        ...snapshot,
        messages: bootstrapViewMessages,
        historyState: "ready"
      };
    });
  }, [bootstrapViewMessages, input.bootstrapMessages.length, input.externalSession, input.sessionId, setLightweightRuntimeSnapshot]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      getAffairsLightweightSession(workspaceId, input.sessionId),
      getAffairsLightweightSessionMessages(workspaceId, input.sessionId)
    ]).then(([nextSession, nextMessages]) => {
      if (cancelled) {
        return;
      }
      setLightweightRuntimeSnapshot(input.sessionId, (current) => {
        const authoritativeMessages = nextMessages.messages.map((message) => convertHistoryMessageToViewModel(message, input.sessionId));
        const nextMessagesList = authoritativeMessages.length > 0
          ? authoritativeMessages
          : (current?.messages ?? []);
        const shouldKeepStreamingStatus = (current?.sending ?? false) || nextMessagesList.some((message) => message.toolCall?.status === "running");
        return {
          ...(current ?? createAffairsLightweightRuntimeSnapshot()),
          session: nextSession,
          messages: nextMessagesList,
          historyState: "ready",
          sending: current?.sending ?? false,
          streamingToolStatus: shouldKeepStreamingStatus ? (current?.streamingToolStatus ?? null) : null
        };
      });
    }).catch(() => {
      if (!cancelled) {
        setLightweightRuntimeSnapshot(input.sessionId, (current) => ({
          ...(current ?? createAffairsLightweightRuntimeSnapshot()),
          historyState: "ready"
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [input.sessionId, setLightweightRuntimeSnapshot, workspaceId]);

  const effectiveSnapshot = runtimeSnapshot ?? createAffairsLightweightRuntimeSnapshot({
    session: input.externalSession,
    messages: bootstrapViewMessages,
    historyState: input.bootstrapMessages.length > 0 ? "ready" : "loading"
  });
  const session = effectiveSnapshot.session ?? input.externalSession;
  const messages = effectiveSnapshot.messages;

  return {
    session,
    messages,
    timelineItems: buildConversationTimelineSourceItems({ messages }),
    historyState: effectiveSnapshot.historyState,
    sending: effectiveSnapshot.sending,
    streamingToolStatus: effectiveSnapshot.streamingToolStatus,
    capabilities: createAffairsLightweightCapabilities(
      session?.provider ?? input.externalSession?.provider ?? "codex"
    ),
    send: async (
      content: string,
      options?: {
        clientRequestId?: string;
        model?: string;
        reasoningLevel?: string;
        attachmentMeta?: HistoryMessageDto["attachments"];
      }
    ) => {
      const clientRequestId = options?.clientRequestId ?? createAffairsConversationClientRequestId();
      const optimisticMessages = [
        ...messages,
        createPendingMessage(
          input.sessionId,
          content,
          clientRequestId,
          options?.attachmentMeta ?? [],
          []
        ),
        createLightweightStreamingAssistantPlaceholder(input.sessionId, clientRequestId)
      ];
      setLightweightRuntimeSnapshot(input.sessionId, (current) => ({
        ...(current ?? createAffairsLightweightRuntimeSnapshot({ session })),
        session: current?.session ?? session,
        messages: optimisticMessages,
        historyState: "ready",
        sending: true,
        streamingToolStatus: null
      }));

      try {
        const response = await sendAffairsLightweightSessionMessageStream(workspaceId, input.sessionId, {
          content,
          clientRequestId,
          model: options?.model ?? null,
          reasoningLevel: options?.reasoningLevel ?? null
        }, (event) => {
          if (event.type === "started") {
            setLightweightRuntimeSnapshot(input.sessionId, (current) => ({
              ...(current ?? createAffairsLightweightRuntimeSnapshot()),
              session: event.session,
              messages: current?.messages ?? optimisticMessages,
              historyState: "ready",
              sending: true,
              streamingToolStatus: current?.streamingToolStatus ?? null
            }));
            return;
          }
          if (event.type === "delta") {
            setLightweightRuntimeSnapshot(input.sessionId, (current) => {
              const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
                session,
                historyState: "ready"
              });
              return {
                ...snapshot,
                messages: appendLightweightStreamingAssistantDelta(snapshot.messages, input.sessionId, clientRequestId, event.delta)
              };
            });
            return;
          }
          if (event.type === "tool") {
            setLightweightRuntimeSnapshot(input.sessionId, (current) => {
              const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
                session,
                historyState: "ready"
              });
              return {
                ...snapshot,
                messages: upsertAffairsLightweightToolMessage(snapshot.messages, {
                  sessionId: input.sessionId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: event.status,
                  detail: event.detail ?? null,
                  toolInput: event.input ?? null,
                  toolOutput: event.output ?? null
                }),
                streamingToolStatus: createAffairsLightweightToolStatus(event.toolName, event.detail ?? null, event.status)
              };
            });
          }
        });
        setLightweightRuntimeSnapshot(input.sessionId, (current) => {
          const authoritativeMessages = response.messages.map((message) => convertHistoryMessageToViewModel(message, input.sessionId));
          return createAffairsLightweightRuntimeSnapshot({
            session: response.session,
            messages: authoritativeMessages.length > 0 ? authoritativeMessages : (current?.messages ?? []),
            historyState: "ready",
            sending: false,
            streamingToolStatus: null
          });
        });
        await reloadLightweightConversationSessions();
      } catch (error) {
        setLightweightRuntimeSnapshot(input.sessionId, (current) => {
          const snapshot = current ?? createAffairsLightweightRuntimeSnapshot({
            session,
            historyState: "ready"
          });
          return {
            ...snapshot,
            messages: markPendingAsFailed(snapshot.messages, clientRequestId),
            sending: false,
            streamingToolStatus: snapshot.streamingToolStatus
              ? { ...snapshot.streamingToolStatus, phase: "failed" }
              : null
          };
        });
        throw error;
      }
    },
    retryMessage: () => {},
    loadingOlderMessages: false,
    hasOlderMessages: false,
    permissionRequests: [],
    replyingPermissionRequestId: null,
    replyPermissionRequest: async () => undefined,
    runtimeInterruptSource: null,
    loadOlderMessages: async () => undefined
  };
}

function AffairsAgentConversationState(input: {
  workspaceId: string;
  draft?: AffairsConversationDraftSelection | null;
  sessionId?: string | null;
}) {
  const {
    activateConversationSession,
    assistantContext,
    butlerStore,
    reloadAgentConversationSessions,
    agentProjectId,
    agentConversationSessionsReady,
    agentConversationSessions
  } = useAffairsWorkbenchInternal();
  const initialized = useButlerRuntimeStore(butlerStore, (value) => value.initialized);
  const loading = useButlerRuntimeStore(butlerStore, (value) => value.loading);
  const profile = useButlerRuntimeStore(butlerStore, (value) => value.profile);
  const activeProvider = useButlerRuntimeStore(butlerStore, (value) => value.activeProvider);
  const controlSession = useButlerRuntimeStore(butlerStore, (value) => value.controlSession);
  const capabilities = useButlerRuntimeStore(butlerStore, (value) => value.capabilities);
  const messages = useButlerRuntimeStore(butlerStore, (value) => value.messages);
  const historyState = useButlerRuntimeStore(butlerStore, (value) => value.historyState);
  const loadingOlderMessages = useButlerRuntimeStore(butlerStore, (value) => value.loadingOlderMessages);
  const hasOlderMessages = useButlerRuntimeStore(butlerStore, (value) => value.hasOlderMessages);
  const runtimeHasActiveRun = useButlerRuntimeStore(butlerStore, (value) => value.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(butlerStore, (value) => value.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(butlerStore, (value) => value.contextUsage);
  const permissionRequests = useButlerRuntimeStore(butlerStore, (value) => value.permissionRequests);
  const sending = useButlerRuntimeStore(butlerStore, (value) => value.sending);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);
  const requestedProvider = input.draft?.provider ?? null;
  const scopedControlSession = isAffairsControlSessionMatchWorkspaceId(controlSession, input.workspaceId)
    ? controlSession
    : null;
  const effectiveProvider = scopedControlSession?.session.provider ?? requestedProvider ?? activeProvider;
  const fallbackCapabilities = useMemo(
    () => createAffairsAgentFallbackCapabilities(effectiveProvider ?? "codex"),
    [effectiveProvider]
  );
  const draftSession = useMemo(
    () => input.draft ? createAffairsConversationDraftSessionSummary(input.workspaceId, input.draft) : null,
    [input.draft, input.workspaceId]
  );
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const restoredHistorySessionIdRef = useRef<string | null>(null);

  const currentAgentConversationSession = useMemo(
    () => input.sessionId
      ? agentConversationSessions.find((item) => item.sessionId === input.sessionId) ?? null
      : null,
    [agentConversationSessions, input.sessionId]
  );

  const session = useMemo(() => {
    if (
      scopedControlSession?.session
      && (!input.sessionId || scopedControlSession.session.sessionId === input.sessionId)
    ) {
      return scopedControlSession.session;
    }

    if (currentAgentConversationSession) {
      return currentAgentConversationSession;
    }

    return draftSession;
  }, [currentAgentConversationSession, draftSession, input.sessionId, scopedControlSession?.session]);

  useEffect(() => {
    if (!input.sessionId || input.draft) {
      restoredHistorySessionIdRef.current = null;
      return;
    }
    const requestedSessionId = input.sessionId;

    if (scopedControlSession?.session.sessionId === requestedSessionId) {
      restoredHistorySessionIdRef.current = requestedSessionId;
      if (restoringSessionId === requestedSessionId) {
        setRestoringSessionId(null);
      }
      return;
    }

    if (restoredHistorySessionIdRef.current === requestedSessionId) {
      return;
    }

    if (!agentConversationSessionsReady) {
      return;
    }

    if (!currentAgentConversationSession || currentAgentConversationSession.isArchived) {
      restoredHistorySessionIdRef.current = requestedSessionId;
      if (restoringSessionId === requestedSessionId) {
        setRestoringSessionId(null);
      }
      return;
    }

    const butlerSessionId = extractButlerManagedSessionIdFromRawStoreRef(currentAgentConversationSession?.rawStoreRef ?? null);
    if (!agentProjectId || !butlerSessionId) {
      return;
    }

    let cancelled = false;
    setRestoringSessionId(requestedSessionId);

    void (async () => {
      try {
        const resumed = await resumeButlerProjectSession(agentProjectId, butlerSessionId);
        if (cancelled) {
          return;
        }
        const controlSessions = await listButlerControlSessions();
        if (cancelled) {
          return;
        }
        const matchedControlSession = controlSessions.items.find(
          (item) => item.session.sessionId === resumed.resumed.session.sessionId
        ) ?? null;
        restoredHistorySessionIdRef.current = requestedSessionId;
        await butlerStore.openControlSession(matchedControlSession?.id ?? "");
        activateConversationSession({
          kind: "agent",
          session: convertButlerManagedSessionToAffairsSessionSummary(
            resumed.resumed.session,
            currentAgentConversationSession?.workspaceId ?? input.workspaceId
          ),
          bootstrapMessages: []
        });
      } catch {
        if (cancelled) {
          return;
        }
        restoredHistorySessionIdRef.current = requestedSessionId;
      } finally {
        if (!cancelled) {
          setRestoringSessionId(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activateConversationSession,
    agentProjectId,
    agentConversationSessionsReady,
    butlerStore,
    currentAgentConversationSession?.isArchived,
    currentAgentConversationSession?.rawStoreRef,
    currentAgentConversationSession?.workspaceId,
    scopedControlSession?.session.sessionId,
    input.draft,
    input.sessionId,
    input.workspaceId,
    restoringSessionId
  ]);

  return (
    <main className="workbench-page conversation-page-shell affairs-conversation-page-shell" data-affairs-section="conversation">
      <div className="conversation-main affairs-conversation-main">
        <SessionHeader session={session} />
        <PermissionRequestList
          requests={permissionRequests}
          replyingRequestId={replyingPermissionRequestId}
          onReply={async (requestId, payload) => {
            setReplyingPermissionRequestId(requestId);
            try {
              await butlerStore.replyPermissionRequest(requestId, payload);
            } finally {
              setReplyingPermissionRequestId(null);
            }
          }}
        />
        <div className="conversation-timeline-shell affairs-conversation-timeline-shell">
          <MessageTimeline
            sessionId={scopedControlSession?.session.sessionId ?? input.sessionId ?? draftSession?.sessionId}
            sessionSummary={session}
            workspaceId={session?.workspaceId ?? input.workspaceId}
            workspacePath={profile?.workspacePath ?? null}
            items={buildConversationTimelineSourceItems({ messages })}
            historyState={historyState}
            loadingOlderMessages={loadingOlderMessages}
            hasOlderMessages={hasOlderMessages}
            provider={effectiveProvider}
            onLoadOlderMessages={() => {
              void butlerStore.loadOlderMessages();
            }}
            onRetryMessage={(clientRequestId) => {
              void butlerStore.retryMessage(clientRequestId);
            }}
          />
        </div>
        <ComposerPanel
          capabilities={requestedProvider && activeProvider !== requestedProvider ? fallbackCapabilities : (capabilities ?? fallbackCapabilities)}
          draftStorageId={input.sessionId ?? draftSession?.sessionId ?? `affairs-agent:${input.workspaceId}`}
          workspaceId={input.workspaceId}
          initialProviderConfigMode={"global-default"}
          initialProviderPresetId={null}
          hasActiveRun={Boolean(runtimeHasActiveRun) || sending}
          canInterrupt={runtimeCanInterrupt ?? false}
          contextUsage={contextUsage}
          taskProvider={effectiveProvider}
          taskMessages={messages}
          isSubmitting={sending || loading || !initialized || restoringSessionId === input.sessionId}
          isRunning={Boolean(runtimeHasActiveRun) || sending || restoringSessionId === input.sessionId}
          onInterrupt={async () => {
            await butlerStore.interrupt();
          }}
          onSend={async (content, options) => {
            const targetProvider = isAffairsAssistantProvider(requestedProvider)
              ? requestedProvider
              : activeProvider;
            const currentSessionId = butlerStore.getState().controlSession?.session.sessionId ?? null;
            const shouldSwitchProvider = Boolean(targetProvider) && activeProvider !== targetProvider;
            const shouldResetDraftSession = Boolean(input.draft) && Boolean(currentSessionId);

            if (targetProvider && shouldSwitchProvider) {
              await butlerStore.switchProvider(targetProvider);
            } else if (shouldResetDraftSession) {
              await butlerStore.startFreshSession();
            }

            await butlerStore.sendMessage(`${buildAffairsAssistantPrefix(assistantContext)}${content}`, {
              model: options?.model ?? null,
              reasoningLevel: options?.reasoningLevel ?? null,
              permissionMode: null
            });

            await reloadAgentConversationSessions();
            const nextSession = butlerStore.getState().controlSession?.session ?? null;
            if (nextSession) {
              activateConversationSession({
                kind: "agent",
                session: nextSession,
                bootstrapMessages: []
              });
            }
          }}
        />
      </div>
    </main>
  );
}

function isAffairsAssistantProvider(provider: ProviderId | null | undefined): provider is "codex" | "claude-code" {
  return provider === "codex" || provider === "claude-code";
}

function createAffairsLightweightCapabilities(provider: ProviderId): ProviderCapabilitiesDto {
  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: false,
    supportsTokenUsage: false,
    supportsAttachments: false,
    supportsPermissionPrompt: false,
    supportsCheckpoint: false,
    supportsSlashMenu: false,
    supportsReasoningSelector: false,
    supportsRunSteering: false,
    supportsQueueWhileRunning: false,
    limitations: [t("shell.affairsConversationLightweightCapabilityHint")]
  };
}

function createAffairsAgentFallbackCapabilities(provider: ProviderId): ProviderCapabilitiesDto {
  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: provider === "claude-code" ? "streaming_guidance" : "none",
    supportsSubagents: false,
    supportsInterrupt: true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    supportsSlashMenu: false,
    supportsReasoningSelector: false,
    supportsRunSteering: false,
    supportsQueueWhileRunning: false,
    limitations: []
  };
}

function convertHistoryMessageToViewModel(
  message: HistoryMessageDto,
  sessionId: string
): SessionMessageViewModel {
  return {
    id: message.messageId,
    sessionId,
    role: message.role,
    kind: message.kind ?? "text",
    content: message.content,
    toolCall: message.toolCall ?? null,
    attachments: message.attachments,
    attachmentPayloads: null,
    origin: message.origin ?? null,
    originRef: message.originRef ?? null,
    timestamp: message.timestamp,
    sequence: message.sequence,
    rawRef: message.rawRef,
    deliveryState: "sent",
    clientRequestId: null
  };
}

async function loadAffairsLightweightSessionExportSnapshot(
  workspaceId: string,
  sessionId: string
): Promise<{ messages: SessionMessageViewModel[] }> {
  const page = await getAffairsLightweightSessionMessages(workspaceId, sessionId);
  return {
    messages: page.messages.map((message) => convertHistoryMessageToViewModel(message, sessionId))
  };
}

function createLightweightStreamingAssistantPlaceholder(
  sessionId: string,
  clientRequestId: string
): SessionMessageViewModel {
  return {
    id: `lightweight-streaming-assistant-${clientRequestId}`,
    sessionId,
    role: "assistant",
    kind: "text",
    content: "",
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: new Date().toISOString(),
    sequence: Number.MAX_SAFE_INTEGER,
    rawRef: `pending://assistant/${clientRequestId}`,
    deliveryState: "sending",
    clientRequestId
  };
}

function AffairsLightweightStreamingStatusBar({
  status
}: {
  status: AffairsLightweightStreamingToolStatus | null;
}) {
  if (!status) {
    return null;
  }

  return (
    <div className="affairs-lightweight-status-bar" role="status" aria-live="polite" data-phase={status.phase}>
      <span className="affairs-lightweight-status-dot" aria-hidden="true" />
      <span className="affairs-lightweight-status-label">{status.label}</span>
      {status.detail?.trim() ? (
        <span className="affairs-lightweight-status-detail">{status.detail.trim()}</span>
      ) : null}
    </div>
  );
}

function createAffairsLightweightRuntimeSnapshot(input?: {
  session?: SessionSummaryDto | null;
  messages?: SessionMessageViewModel[];
  historyState?: "loading" | "ready";
  sending?: boolean;
  streamingToolStatus?: AffairsLightweightStreamingToolStatus | null;
}): AffairsLightweightRuntimeSnapshot {
  return {
    session: input?.session ?? null,
    messages: input?.messages ?? [],
    historyState: input?.historyState ?? "loading",
    sending: input?.sending ?? false,
    streamingToolStatus: input?.streamingToolStatus ?? null
  };
}

function createAffairsLightweightToolStatus(toolName: string, detail: string | null, status: string): AffairsLightweightStreamingToolStatus {
  return {
    label: toolName === "web_search" ? t("conversation.toolWebSearch") : toolName,
    detail,
    phase: status === "completed" ? "completed" : status === "failed" ? "failed" : "running"
  };
}

function resolveAffairsLightweightRuntimeSessionId(input: {
  fallbackSessionId: string;
  activeSessionId: string | null;
  eventSessionId?: string | null;
}): string {
  return input.eventSessionId?.trim() || input.activeSessionId?.trim() || input.fallbackSessionId;
}

function upsertAffairsLightweightToolMessage(
  current: SessionMessageViewModel[],
  input: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    status: "running" | "completed" | "failed";
    detail: string | null;
    toolInput: string | null;
    toolOutput: string | null;
  }
): SessionMessageViewModel[] {
  const messageId = `lightweight-tool-${input.toolCallId}`;
  const assistantIndex = current.findIndex((message) => message.id.startsWith("lightweight-streaming-assistant-"));
  const insertIndex = assistantIndex >= 0 ? assistantIndex : current.length;
  const previousSequence = insertIndex > 0 ? current[insertIndex - 1]?.sequence ?? 0 : 0;
  const nextMessage: SessionMessageViewModel = {
    id: messageId,
    sessionId: input.sessionId,
    role: "tool",
    kind: input.status === "running" ? "tool_call" : "tool_result",
    content: input.detail?.trim() || input.toolOutput?.trim() || input.toolInput?.trim() || input.toolName,
    toolCall: {
      callId: input.toolCallId,
      name: input.toolName,
      input: input.toolInput ?? "",
      output: input.toolOutput,
      error: input.status === "failed" ? (input.detail ?? input.toolOutput ?? null) : null,
      status: input.status
    },
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: new Date().toISOString(),
    sequence: previousSequence + 1,
    rawRef: `lightweight-tool://${input.toolCallId}`,
    deliveryState: "sent",
    clientRequestId: null
  };

  const index = current.findIndex((message) => message.toolCall?.callId === input.toolCallId || message.id === messageId);
  if (index < 0) {
    return [
      ...current.slice(0, insertIndex),
      nextMessage,
      ...current.slice(insertIndex).map((message) => ({
        ...message,
        sequence: message.sequence >= nextMessage.sequence ? message.sequence + 1 : message.sequence
      }))
    ];
  }

  const next = [...current];
  next[index] = {
    ...next[index],
    ...nextMessage,
    timestamp: next[index].timestamp,
    sequence: next[index].sequence,
    rawRef: next[index].rawRef
  };
  return next;
}

function appendLightweightStreamingAssistantDelta(
  current: SessionMessageViewModel[],
  sessionId: string,
  clientRequestId: string,
  delta: string
): SessionMessageViewModel[] {
  if (!delta) {
    return current;
  }
  const placeholderId = `lightweight-streaming-assistant-${clientRequestId}`;
  let found = false;
  const next = current.map((message) => {
    if (message.id !== placeholderId) {
      return message;
    }
    found = true;
    return {
      ...message,
      content: `${message.content}${delta}`
    };
  });
  if (found) {
    return next;
  }
  return [
    ...current,
    {
      ...createLightweightStreamingAssistantPlaceholder(sessionId, clientRequestId),
      content: delta
    }
  ];
}

function AffairsHostUnavailableState({
  errorMessage,
  retrying,
  onRetry
}: {
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="affairs-conversation-empty-state">
      <header className="affairs-conversation-empty-header">
        <span className="affairs-inline-pill">{t("shell.workbenchModeAffairs")}</span>
        <h2>{t("shell.affairsHostUnavailableTitle")}</h2>
        <p>{t("shell.affairsHostUnavailableDescription")}</p>
      </header>

      <section className="affairs-conversation-empty-section affairs-conversation-create-section">
        <button
          type="button"
          className="secondary-button affairs-conversation-create-trigger"
          onClick={() => {
            void onRetry();
          }}
          disabled={retrying}
        >
          <span>{retrying ? t("common.loading") : t("shell.affairsHostUnavailableRetryAction")}</span>
        </button>
        <p>{t("shell.affairsHostUnavailableRetryHint")}</p>
      </section>

      {errorMessage?.trim() ? (
        <section className="affairs-conversation-empty-section">
          <div className="affairs-conversation-empty-section-header">
            <strong>{t("shell.affairsHostUnavailableErrorTitle")}</strong>
            <p>{errorMessage.trim()}</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function resolveAffairsInitAvatar(input: {
  displayName: string;
  providerId: "codex" | "claude-code";
  tone: "direct" | "steady" | "friendly";
}): string {
  const pool =
    input.tone === "friendly"
      ? ["🐼", "🦊", "🐶", "🌼"]
      : input.tone === "steady"
        ? ["🐢", "🪨", "🌲", "🧭"]
        : input.providerId === "claude-code"
          ? ["🦉", "📚", "🔍", "🧪"]
          : ["🧠", "🤖", "🛠️", "⚡"];
  const seed = `${input.displayName.trim()}:${input.providerId}:${input.tone}`;
  if (!seed) {
    return pool[0]!;
  }
  const total = Array.from(seed).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
  return pool[total % pool.length]!;
}

const AFFAIRS_INIT_REPORT_PRIORITY_VALUES: Record<ButlerReportPriorityPresetId, string[]> = {
  "risk-first": ["risk", "blocker", "verification"],
  "blocker-first": ["blocker", "risk", "verification"],
  "verification-first": ["verification", "risk", "blocker"],
  "progress-first": ["progress", "risk", "blocker"]
};

function AffairsConversationInitState({ workspaceId }: { workspaceId: string }) {
  const {
    initGuard,
    initializeButlerProfile,
    updateButlerProfile,
    openInitializedSection,
    reloadButlerProfile,
    selectedConversationDraft,
    selectedConversationSession,
    conversationRuntimeSeed,
    agentWorkspaceId,
    agentWorkspacePath
  } = useAffairsWorkbenchInternal();
  const initialized = initGuard.initialized;
  const loading = initGuard.loading;
  const unavailable = initGuard.unavailable;
  const butlerInitialized = initGuard.butlerInitialized;
  const profile = initGuard.profile;
  const [initForm, setInitForm] = useState<ButlerInitFormState>(DEFAULT_BUTLER_INIT_FORM_STATE);
  const [initializing, setInitializing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pendingOpenLibrary, setPendingOpenLibrary] = useState(false);
  const [libraryInit, setLibraryInit] = useState({
    enabled: true,
    rootDir: ""
  });
  const { showToast } = useToast();
  const butlerDisplayName =
    profile?.displayName?.trim() || initForm.displayName.trim() || t("shell.butlerEntry");
  const butlerAvatar = useMemo(
    () =>
      resolveAffairsInitAvatar({
        displayName: butlerDisplayName,
        providerId: profile?.providerId ?? initForm.providerId,
        tone: profile?.personaTone ?? initForm.personaTone
      }),
    [
      butlerDisplayName,
      initForm.personaTone,
      initForm.providerId,
      profile?.personaTone,
      profile?.providerId
    ]
  );
  useEffect(() => {
    if (initialized) {
      return;
    }
    void getGlobalAffairsLibraryBinding()
      .then((binding) => {
        setLibraryInit({
          enabled: binding?.enabled ?? true,
          rootDir: binding?.rootDir ?? ""
        });
      })
      .catch(() => undefined);
  }, [initialized, workspaceId]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    setInitForm((current) => ({
      ...current,
      displayName: current.displayName.trim() ? current.displayName : profile.displayName,
      providerId: profile.providerId,
      personaTone: profile.personaTone
    }));
  }, [profile]);

  useEffect(() => {
    if (!initialized || !pendingOpenLibrary) {
      return;
    }

    openInitializedSection("library");
    setPendingOpenLibrary(false);
  }, [initialized, openInitializedSection, pendingOpenLibrary]);

  if (initialized) {
    if (selectedConversationSession?.kind === "lightweight") {
      return (
        <AffairsLightweightConversationLiveState
          sessionId={selectedConversationSession.sessionId}
          runtimeSeed={
            conversationRuntimeSeed?.kind === "lightweight"
            && conversationRuntimeSeed.session.sessionId === selectedConversationSession.sessionId
              ? conversationRuntimeSeed
              : null
          }
        />
      );
    }

    if (selectedConversationSession?.kind === "agent") {
      if (!agentWorkspaceId) {
        return <AffairsConversationEmptyState />;
      }
      return (
        <AffairsAgentConversationState
          workspaceId={agentWorkspaceId}
          sessionId={selectedConversationSession.sessionId}
        />
      );
    }

    if (selectedConversationDraft?.kind === "lightweight") {
      return (
        <AffairsLightweightConversationDraftState
          workspaceId={workspaceId}
          draft={selectedConversationDraft}
        />
      );
    }

    if (selectedConversationDraft?.kind === "agent") {
      if (!agentWorkspaceId) {
        return <AffairsConversationEmptyState />;
      }
      return (
        <AffairsAgentConversationState
          workspaceId={agentWorkspaceId}
          draft={selectedConversationDraft}
        />
      );
    }

    return <AffairsConversationEmptyState />;
  }

  if (loading) {
    return (
      <main className="workbench-page butler-page-shell butler-init-shell affairs-conversation-page-shell">
        <AffairsConnectionCheckingState />
      </main>
    );
  }

  if (unavailable) {
    return (
      <main className="workbench-page butler-page-shell butler-init-shell affairs-conversation-page-shell">
        <AffairsHostUnavailableState
          errorMessage={initGuard.errorMessage}
          retrying={retrying}
          onRetry={async () => {
            setRetrying(true);
            try {
              await reloadButlerProfile();
            } finally {
              setRetrying(false);
            }
          }}
        />
      </main>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = initForm.displayName.trim() || profile?.displayName?.trim() || "";

    if (!displayName) {
      showToast({
        title: t("shell.butlerInitNameRequired"),
        tone: "warning"
      });
      return;
    }

    if (libraryInit.enabled && !libraryInit.rootDir.trim()) {
      showToast({
        title: t("shell.affairsInitLibraryPathRequired"),
        tone: "warning"
      });
      return;
    }

    const payload: ButlerProfilePayload = {
      displayName,
      providerId: initForm.providerId,
      agentsMode: initForm.agentsMode,
      persona: {
        tone: initForm.personaTone,
        language: initForm.personaLanguage,
        summaryStyle: initForm.personaSummaryStyle
      },
      focus: {
        projectIds: [],
        riskPreference: initForm.focusRiskPreference,
        reportPriority: AFFAIRS_INIT_REPORT_PRIORITY_VALUES[initForm.reportPriorityPreset],
        summaryDebounceSeconds: 300
      }
    };

    setInitializing(true);

    try {
      if (butlerInitialized) {
        await updateButlerProfile(payload);
      } else {
        await initializeButlerProfile(payload);
      }
      if (libraryInit.rootDir.trim()) {
        await saveGlobalAffairsLibraryBinding({ rootDir: libraryInit.rootDir.trim() });
        await setGlobalAffairsLibraryEnabled({ enabled: libraryInit.enabled });
      }
      await reloadButlerProfile();
      setPendingOpenLibrary(true);
      showToast({
        title: t("shell.affairsInitSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.affairsInitFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setInitializing(false);
    }
  }

  return (
    <main className="workbench-page butler-page-shell butler-init-shell affairs-conversation-page-shell">
      <section className="affairs-init-panel">
        <header className="affairs-init-panel-header">
          <div>
            <span className="affairs-inline-pill">{t("shell.workbenchModeAffairs")}</span>
            <h2>{t("shell.butlerInitTitle")}</h2>
            <p>{t("shell.affairsInitRouteGuardHint")}</p>
          </div>
        </header>
        <ButlerInitForm
          form={initForm}
          onChange={setInitForm}
          submitting={loading || initializing}
          submitLabel={
            loading || initializing ? t("shell.butlerInitSubmitting") : t("shell.affairsInitSubmit")
          }
          previewName={butlerDisplayName}
          previewAvatar={butlerAvatar}
          previewRuleLabel={t("shell.affairsInitPreviewRuleLabel")}
          affairsLibrary={{
            value: libraryInit,
            onChange: setLibraryInit
          }}
          onSubmit={handleSubmit}
        />
      </section>
    </main>
  );
}

export function AffairsWorkbenchView({ workspaceId }: AffairsWorkbenchViewProps) {
  const {
    activeSection,
    initGuard,
    binding,
    documentRecords,
    favoriteEntries,
    filteredDocuments,
    filteredTodoRecords,
    automationRecords,
    folderRecords,
    tagRecords,
    indexStatus,
    libraryConfig,
    currentDirectoryStatus,
    loading,
    openLibraryViewer,
    error,
    selectedObject,
    state,
    selectedTagPaths,
    managedTags,
    saveDocumentTagSelection,
    saveFolderTagSelection,
    documentTagDetails,
    folderTagDetails,
    recentTagTasks,
    selectObject,
    navigateLibraryFolder,
    navigateLibraryTag,
    libraryDocumentsLoading,
    libraryRefreshPending,
    libraryDocumentTotal,
    libraryVisibleEntryTotal,
    libraryDocumentHasMore,
    loadMoreLibraryDocuments,
    refreshLibrary,
    selectLibraryFolderEntry,
    setLibraryViewMode,
    selectSidebarNode,
    navigationGroups
  } = useAffairsWorkbenchInternal();
  const stageScrollRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (settingsOpen && activeSection !== "library") {
      setSettingsOpen(false);
    }
  }, [activeSection, settingsOpen]);

  const [stageViewportHeight, setStageViewportHeight] = useState(0);
  const [stageViewportWidth, setStageViewportWidth] = useState(0);
  const [stageScrollTop, setStageScrollTop] = useState(0);
  const [measuredListRowHeight, setMeasuredListRowHeight] = useState(LIST_ITEM_HEIGHT);
  const [measuredGridColumns, setMeasuredGridColumns] = useState<number | null>(null);
  const [measuredGridItemHeight, setMeasuredGridItemHeight] = useState(AFFAIRS_GRID_ITEM_HEIGHT);
  const [measuredGridRowGap, setMeasuredGridRowGap] = useState(AFFAIRS_GRID_ROW_GAP);
  const [sortState, setSortState] = useState<LibrarySortState>({
    mode: "recent",
    direction: "desc"
  });
  const [finderColumnWidths, setFinderColumnWidths] = useState<Record<FinderColumnKey, number>>(DEFAULT_FINDER_COLUMN_WIDTHS);
  const [contextMenu, setContextMenu] = useState<LibraryContextMenuState | null>(null);
  const [libraryClipboard, setLibraryClipboard] = useState<LibraryClipboardState | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<LibrarySubmenuKey | null>(null);
  const contextSubmenuCloseTimerRef = useRef<number | null>(null);
  const [pendingLibraryCreate, setPendingLibraryCreate] = useState<PendingLibraryCreateState>(null);
  const [pendingLibraryCreateSubmitting, setPendingLibraryCreateSubmitting] = useState(false);
  const [pendingLibraryCreateError, setPendingLibraryCreateError] = useState<string | null>(null);
  const [pendingLibraryDeleteTarget, setPendingLibraryDeleteTarget] = useState<LibraryFileSystemTarget | null>(null);
  const [pendingLibraryDeleteSubmitting, setPendingLibraryDeleteSubmitting] = useState(false);
  const [pendingTagAssignmentTarget, setPendingTagAssignmentTarget] = useState<PendingTagAssignmentTarget | null>(null);
  const finderResizeStateRef = useRef<{
    column: FinderColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const { showToast } = useToast();
  const platform = usePlatform();
  const createNameInputId = useId();
  const favoriteFolderPathSet = useMemo(
    () => new Set(favoriteEntries.filter((item) => item.kind === "folder").map((item) => item.path)),
    [favoriteEntries]
  );

  const childFolders = useMemo(
    () => activeSection === "library" ? getVisibleChildFolders(folderRecords, state.selectedFolderPath) : [],
    [activeSection, folderRecords, state.selectedFolderPath]
  );
  const folderDocuments = useMemo(
    () => activeSection === "library" && state.browseMode === "folder"
      ? getDirectDocuments(documentRecords, state.selectedFolderPath)
      : [],
    [activeSection, documentRecords, state.browseMode, state.selectedFolderPath]
  );
  const libraryEntries = useMemo(
    () => activeSection === "library"
      ? buildLibraryEntries({
          browseMode: state.browseMode,
          childFolders,
          documents: state.browseMode === "folder" ? folderDocuments : filteredDocuments,
          favoriteFolderPathSet
        })
      : [],
    [activeSection, childFolders, favoriteFolderPathSet, filteredDocuments, folderDocuments, state.browseMode]
  );
  const sortedLibraryEntries = useMemo(
    () => sortLibraryEntries(libraryEntries, sortState),
    [libraryEntries, sortState]
  );
  const estimatedLibraryEntryCount = useMemo(() => {
    if (activeSection !== "library") {
      return 0;
    }

    if (state.browseMode === "folder") {
      return Math.max(sortedLibraryEntries.length, libraryVisibleEntryTotal);
    }

    return Math.max(filteredDocuments.length, libraryVisibleEntryTotal);
  }, [
    activeSection,
    filteredDocuments.length,
    libraryVisibleEntryTotal,
    sortedLibraryEntries.length,
    state.browseMode
  ]);
  const effectiveGridColumns = useMemo(
    () => Math.max(
      1,
      measuredGridColumns ?? resolveAffairsGridColumnCount(stageViewportWidth, {
        trackMinWidth: AFFAIRS_GRID_TRACK_MIN_WIDTH,
        columnGap: AFFAIRS_GRID_COLUMN_GAP
      })
    ),
    [measuredGridColumns, stageViewportWidth]
  );
  const gridMetrics = useMemo(
    () => computeVirtualGridMetrics(estimatedLibraryEntryCount, stageViewportWidth, stageViewportHeight, stageScrollTop, {
      columns: effectiveGridColumns,
      itemHeight: measuredGridItemHeight,
      rowGap: measuredGridRowGap,
      trackMinWidth: AFFAIRS_GRID_TRACK_MIN_WIDTH,
      columnGap: AFFAIRS_GRID_COLUMN_GAP
    }),
    [
      effectiveGridColumns,
      estimatedLibraryEntryCount,
      measuredGridItemHeight,
      measuredGridRowGap,
      stageViewportHeight,
      stageViewportWidth,
      stageScrollTop
    ]
  );
  const visibleGridSlots = useMemo(
    () => buildVirtualLibraryEntrySlots(sortedLibraryEntries, gridMetrics.startIndex, gridMetrics.endIndex),
    [gridMetrics.endIndex, gridMetrics.startIndex, sortedLibraryEntries]
  );
  const listMetrics = useMemo(
    () => computeVirtualListMetrics(estimatedLibraryEntryCount, stageViewportHeight, stageScrollTop, {
      rowHeight: measuredListRowHeight
    }),
    [estimatedLibraryEntryCount, measuredListRowHeight, stageViewportHeight, stageScrollTop]
  );
  const visibleListSlots = useMemo(
    () => buildVirtualLibraryEntrySlots(sortedLibraryEntries, listMetrics.startIndex, listMetrics.endIndex),
    [sortedLibraryEntries, listMetrics.endIndex, listMetrics.startIndex]
  );
  const shouldVirtualizeGrid = shouldVirtualizeAffairsGrid(
    estimatedLibraryEntryCount,
    stageViewportWidth,
    stageViewportHeight,
    {
      itemHeight: measuredGridItemHeight,
      trackMinWidth: AFFAIRS_GRID_TRACK_MIN_WIDTH
    }
  );
  const folderBreadcrumbs = useMemo(
    () => buildFolderBreadcrumbs(state.selectedFolderPath),
    [state.selectedFolderPath]
  );
  const finderGridTemplateColumns = useMemo(
    () => buildFinderGridTemplateColumns(finderColumnWidths),
    [finderColumnWidths]
  );
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current || typeof window === "undefined") {
      return;
    }

    const rect = contextMenuRef.current.getBoundingClientRect();
    const position = resolveContextMenuPosition(
      { x: contextMenu.left, y: contextMenu.top },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
      {
        defaultWidthPx: 216,
        estimatedHeightPx: 360,
        minHeightPx: 180
      }
    );

    const current = contextMenuRef.current;
    current.style.left = `${position.left}px`;
    current.style.top = `${position.top}px`;
    current.style.width = `${position.width}px`;
    current.style.maxHeight = `${position.maxHeight}px`;
    current.style.transformOrigin = position.transformOrigin;
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      setActiveSubmenu(null);
      if (contextSubmenuCloseTimerRef.current !== null) {
        window.clearTimeout(contextSubmenuCloseTimerRef.current);
        contextSubmenuCloseTimerRef.current = null;
      }
    }
  }, [contextMenu]);

  useEffect(() => {
    return () => {
      if (contextSubmenuCloseTimerRef.current !== null) {
        window.clearTimeout(contextSubmenuCloseTimerRef.current);
        contextSubmenuCloseTimerRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const element = state.viewMode === "list" ? listScrollRef.current : stageScrollRef.current;
    if (!element) {
      return;
    }
    const sync = () => {
      setStageViewportHeight(element.clientHeight);
      setStageViewportWidth(measureStageScrollContentWidth(element));
    };
    sync();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.viewMode, activeSection]);

  useEffect(() => {
    const element = state.viewMode === "list" ? listScrollRef.current : stageScrollRef.current;
    if (!element) {
      return;
    }
    let frameId = 0;
    let timeoutId = 0;
    const sync = () => {
      setStageViewportHeight(element.clientHeight);
      setStageViewportWidth(measureStageScrollContentWidth(element));
    };
    frameId = window.requestAnimationFrame(sync);
    timeoutId = window.setTimeout(sync, 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [activeSection, state.viewMode, sortedLibraryEntries.length]);

  useLayoutEffect(() => {
    if (activeSection !== "library") {
      return;
    }
    const container = state.viewMode === "list" ? listScrollRef.current : stageScrollRef.current;
    if (!container) {
      return;
    }

    const syncMeasurements = () => {
      if (state.viewMode === "list") {
        const nextRowHeight = measureAffairsFinderRowHeight(container);
        if (nextRowHeight && Math.abs(nextRowHeight - measuredListRowHeight) > 0.5) {
          setMeasuredListRowHeight(nextRowHeight);
        }
        return;
      }

      const nextGridLayout = measureAffairsGridLayout(container);
      if (nextGridLayout.columns && nextGridLayout.columns !== measuredGridColumns) {
        setMeasuredGridColumns(nextGridLayout.columns);
      }
      if (nextGridLayout.itemHeight && Math.abs(nextGridLayout.itemHeight - measuredGridItemHeight) > 0.5) {
        setMeasuredGridItemHeight(nextGridLayout.itemHeight);
      }
      if (nextGridLayout.rowGap !== null && Math.abs(nextGridLayout.rowGap - measuredGridRowGap) > 0.5) {
        setMeasuredGridRowGap(nextGridLayout.rowGap);
      }
    };

    let frameId = window.requestAnimationFrame(syncMeasurements);
    const timeoutId = window.setTimeout(syncMeasurements, 80);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(timeoutId);
      };
    }

    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncMeasurements);
    });
    observer.observe(container);
    const grid = container.querySelector<HTMLElement>(".affairs-doc-grid");
    const listRow = container.querySelector<HTMLElement>(".affairs-finder-row");
    const gridItem = container.querySelector<HTMLElement>(".affairs-doc-item.grid");
    if (grid) {
      observer.observe(grid);
    }
    if (listRow) {
      observer.observe(listRow);
    }
    if (gridItem) {
      observer.observe(gridItem);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activeSection,
    measuredGridColumns,
    measuredGridItemHeight,
    measuredGridRowGap,
    measuredListRowHeight,
    sortedLibraryEntries.length,
    state.viewMode
  ]);

  useEffect(() => {
    const container = state.viewMode === "list" ? listScrollRef.current : stageScrollRef.current;
    if (!container || activeSection !== "library") {
      return;
    }

    const handleScroll = () => {
      setStageScrollTop(container.scrollTop);
      if (!libraryDocumentHasMore || libraryDocumentsLoading) {
        return;
      }
      const loadedEntryCount = sortedLibraryEntries.length;
      if (loadedEntryCount <= 0 || loadedEntryCount >= estimatedLibraryEntryCount) {
        return;
      }
      const viewportHeight = container.clientHeight;
      const nextMetrics = state.viewMode === "list"
        ? computeVirtualListMetrics(estimatedLibraryEntryCount, viewportHeight, container.scrollTop, {
            rowHeight: measuredListRowHeight
          })
        : computeVirtualGridMetrics(
            estimatedLibraryEntryCount,
            measureStageScrollContentWidth(container),
            viewportHeight,
            container.scrollTop,
            {
              columns: effectiveGridColumns,
              itemHeight: measuredGridItemHeight,
              rowGap: measuredGridRowGap,
              trackMinWidth: AFFAIRS_GRID_TRACK_MIN_WIDTH,
              columnGap: AFFAIRS_GRID_COLUMN_GAP
            }
          );
      const preloadThreshold = state.viewMode === "list"
        ? Math.max(12, Math.ceil(Math.max(viewportHeight, measuredListRowHeight) / measuredListRowHeight))
        : Math.max(effectiveGridColumns * 3, effectiveGridColumns * 2, 18);
      if (nextMetrics.endIndex >= loadedEntryCount - preloadThreshold) {
        void loadMoreLibraryDocuments();
        return;
      }
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining <= 320) {
        void loadMoreLibraryDocuments();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [
    activeSection,
    effectiveGridColumns,
    estimatedLibraryEntryCount,
    libraryDocumentHasMore,
    libraryDocumentsLoading,
    loadMoreLibraryDocuments,
    measuredGridItemHeight,
    measuredGridRowGap,
    measuredListRowHeight,
    sortedLibraryEntries.length,
    state.viewMode
  ]);

  useEffect(() => () => {
    document.documentElement.removeAttribute("data-workbench-finder-column-resizing");
  }, []);

  useEffect(() => {
    if (state.viewMode !== "list") {
      document.documentElement.removeAttribute("data-workbench-finder-column-resizing");
    }
  }, [state.viewMode]);

  function handleFinderColumnResizeStart(column: FinderColumnKey, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    finderResizeStateRef.current = {
      column,
      startX: event.clientX,
      startWidth: finderColumnWidths[column]
    };
    document.documentElement.setAttribute("data-workbench-finder-column-resizing", "true");

    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      target.setPointerCapture(event.pointerId);
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const current = finderResizeStateRef.current;
      if (!current || current.column !== column) {
        return;
      }
      if (!Number.isFinite(moveEvent.clientX)) {
        return;
      }
      const delta = moveEvent.clientX - current.startX;
      const nextWidth = Math.max(FINDER_COLUMN_MIN_WIDTHS[column], Math.round(current.startWidth + delta));
      setFinderColumnWidths((previous) => {
        if (previous[column] === nextWidth) {
          return previous;
        }
        return {
          ...previous,
          [column]: nextWidth
        };
      });
    };

    const finishResize = () => {
      finderResizeStateRef.current = null;
      document.documentElement.removeAttribute("data-workbench-finder-column-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  function resolveContextTarget(entry: LibraryEntry): LibraryContextMenuTarget {
    if (entry.kind === "document") {
      const record = documentRecords.find((item) => item.id === entry.documentId);
      return {
        kind: "document",
        entry,
        record: record ?? {
          id: entry.documentId,
          title: entry.title,
          displayName: entry.title,
          filePath: entry.path,
          fullPath: buildAbsoluteLibraryPath(binding?.rootDir ?? null, entry.path),
          summary: entry.summary,
          isFavorite: entry.isFavorite,
          tags: [],
          derivedTags: [],
          createdAt: entry.createdAt,
          sizeBytes: entry.sizeBytes,
          updatedAt: entry.updatedAt
        }
      };
    }

    return {
      kind: "folder",
      entry,
      record: folderRecords.find((item) => item.path === entry.path) ?? null
    };
  }

  async function openDesktopContextMenu(target: LibraryContextMenuTarget) {
    const items = buildDesktopLibraryContextMenuItems({
      target,
      bindingRootDir: binding?.rootDir ?? null,
      libraryClipboard,
      onPreview: target.kind === "document" ? () => openLibraryViewer(target.record) : null,
      onOpen: target.kind === "document" || target.kind === "folder" ? () => handleOpenTarget(target) : null,
      onLocate: target.kind === "document" || target.kind === "folder" ? () => handleLocateTarget(target) : null,
      onDownload: target.kind === "document" ? () => handleDownload(target) : null,
      onOpenWithLocalApp: platform.isDesktop && platform.ui.osFamily === "macos" && target.kind === "document"
        ? () => handleOpenWithLocalApp(target)
        : null,
      onCopyFile: target.kind === "blank" ? null : () => handleCopyText(getContextTargetRelativePath(target), t("shell.affairsLibraryCopyFileSuccess")),
      onCopyFileName: target.kind === "blank" ? null : () => handleCopyText(getContextTargetTitle(target), t("shell.affairsLibraryCopyFileNameSuccess")),
      onCopyAbsolutePath: target.kind === "blank"
        ? null
        : () => {
            const absolutePath = resolveTargetAbsolutePath(binding?.rootDir ?? null, target);
            if (!absolutePath) {
              throw new Error(t("shell.affairsLibraryAbsolutePathMissing"));
            }
            return handleCopyText(absolutePath, t("shell.affairsLibraryCopyAbsolutePathSuccess"));
          },
      onCopyRelativePath: target.kind === "blank" ? null : () => handleCopyText(getContextTargetRelativePath(target), t("shell.affairsLibraryCopyRelativePathSuccess")),
      onCut: target.kind === "document" || target.kind === "folder"
        ? () => {
            setLibraryClipboard({ mode: "cut", target });
            showToast({ title: t("shell.affairsLibraryCutSuccess", { name: getContextTargetTitle(target) }), tone: "success" });
          }
        : null,
      onPaste: libraryClipboard ? () => handlePaste(target) : null,
      onDelete: target.kind === "document" || target.kind === "folder" ? () => requestDeleteTarget(target) : null,
      onCreateDirectory: () => handleRequestCreate(target, "directory"),
      onCreateMarkdownFile: () => handleRequestCreate(target, "markdown"),
      onCreateTextFile: () => handleRequestCreate(target, "text"),
      onCreateCustomFile: () => handleRequestCreate(target, "custom"),
      onRefresh: () => refreshLibrary(),
      onOpenTagAssignment: target.kind === "document" || target.kind === "folder"
        ? () => openTagAssignmentTarget(target)
        : null,
      onProperties: () => {
        if (target.kind === "document") {
          selectObject(target.record.id);
          return;
        }
        selectObject(null);
        setSelectedLibraryFolderEntry(target.kind === "folder" ? target.entry.path : state.selectedFolderPath);
      }
    });

    if (items.length === 0) {
      return;
    }

    await showDesktopContextMenu(items);
  }

  function openContextMenu(event: ReactMouseEvent<HTMLElement>, target: LibraryContextMenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    if (target.kind === "document") {
      selectObject(target.record.id);
    }
    if (platform.isDesktop && platform.ui.osFamily === "macos" && platform.bridge.supported) {
      void openDesktopContextMenu(target);
      return;
    }
    setContextMenu({
      left: event.clientX,
      top: event.clientY,
      target
    });
  }

  function openBlankContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }
    openContextMenu(event, {
      kind: "blank",
      folderPath: state.selectedFolderPath
    });
  }

  async function runContextAction(action: () => void | Promise<void>) {
    setContextMenu(null);
    try {
      await action();
    } catch (actionError) {
      showToast({
        title: readError(actionError, t("shell.affairsLibraryActionFailed")),
        tone: "error"
      });
    }
  }

  async function handleDownload(target: Extract<LibraryContextMenuTarget, { kind: "document" }>) {
    const payload = await downloadAffairsLibraryFile(workspaceId, target.record.filePath);
    const fileBuffer = decodeBase64ToArrayBuffer(payload.contentBase64);
    downloadBlob(payload.fileName, new Blob([fileBuffer], {
      type: "application/octet-stream"
    }));
    showToast({
      title: t("shell.affairsLibraryDownloadSuccess", { name: payload.fileName }),
      tone: "success"
    });
  }

  function closeContextSubmenuLater() {
    if (typeof window === "undefined") {
      setActiveSubmenu(null);
      return;
    }
    if (contextSubmenuCloseTimerRef.current !== null) {
      window.clearTimeout(contextSubmenuCloseTimerRef.current);
    }
    contextSubmenuCloseTimerRef.current = window.setTimeout(() => {
      setActiveSubmenu(null);
      contextSubmenuCloseTimerRef.current = null;
    }, 220);
  }

  function openContextSubmenu(key: LibrarySubmenuKey) {
    if (contextSubmenuCloseTimerRef.current !== null) {
      window.clearTimeout(contextSubmenuCloseTimerRef.current);
      contextSubmenuCloseTimerRef.current = null;
    }
    setActiveSubmenu(key);
  }

  function closeContextSubmenuNow() {
    if (contextSubmenuCloseTimerRef.current !== null) {
      window.clearTimeout(contextSubmenuCloseTimerRef.current);
      contextSubmenuCloseTimerRef.current = null;
    }
    setActiveSubmenu(null);
  }

  async function handleCopyText(text: string, successTitle: string) {
    await writeTextToClipboard(text, platform);
    showToast({
      title: successTitle,
      tone: "success"
    });
  }

  async function handleOpenTarget(target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>) {
    if (target.kind === "document") {
      if (!platform.isDesktop) {
        await handleDownload(target);
        return;
      }
    }
    const absolutePath = resolveTargetAbsolutePath(binding?.rootDir ?? null, target);
    if (!absolutePath) {
      throw new Error(t("shell.affairsLibraryAbsolutePathMissing"));
    }
    const result = await getCodingNSDesktopBridge().fs.openFile(absolutePath);
    if (!result.ok) {
      throw new Error(result.detail ?? t("shell.affairsLibraryOpenLocalFileFailed"));
    }
  }

  function handleLocateTarget(target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>) {
    if (target.kind === "document") {
      navigateLibraryFolder(getDocumentParentPath(target.record.filePath) || null);
      return;
    }
    navigateLibraryFolder(target.entry.path || null);
  }

  function setSelectedLibraryFolderEntry(folderPath: string | null) {
    selectLibraryFolderEntry(folderPath);
  }

  function openLibraryFolderEntry(folderPath: string | null) {
    navigateLibraryFolder(folderPath);
  }

  function handleLibraryFolderEntryClick(folderPath: string | null) {
    const openBehavior = libraryConfig?.folderOpenBehavior === "single_click" ? "single_click" : "double_click";
    if (openBehavior === "single_click") {
      openLibraryFolderEntry(folderPath);
      return;
    }
    setSelectedLibraryFolderEntry(folderPath);
  }

  async function handleOpenWithLocalApp(target: Extract<LibraryContextMenuTarget, { kind: "document" }>) {
    const localMirrorTarget = resolveLocalMirrorTarget(libraryConfig?.mirrorRoot, target.record.filePath);
    if (!localMirrorTarget) {
      throw new Error(t("shell.affairsLibraryMirrorRootEmpty"));
    }
    const result = await getCodingNSDesktopBridge().fs.openFile(localMirrorTarget.absolutePath);
    if (!result.ok) {
      throw new Error(result.detail ?? t("shell.affairsLibraryOpenLocalFileFailed"));
    }
  }

  async function handlePaste(target: LibraryContextMenuTarget) {
    if (!libraryClipboard) {
      return;
    }
    const destinationFolder = resolvePasteDestinationFolder(target);
    const sourcePath = getContextTargetRelativePath(libraryClipboard.target);
    const destinationPath = buildUniqueLibraryTargetPath(
      destinationFolder,
      getPathLeafName(sourcePath),
      libraryEntries
    );

    await operateAffairsLibraryFile(workspaceId, {
      opType: libraryClipboard.mode === "cut" ? "move" : "copy",
      srcPath: sourcePath,
      dstPath: destinationPath
    });
    if (libraryClipboard.mode === "cut") {
      setLibraryClipboard(null);
    }
    await refreshLibrary();
    showToast({
      title: t("shell.affairsLibraryPasteSuccess", { name: getPathLeafName(destinationPath) }),
      tone: "success"
    });
  }

  function requestDeleteTarget(target: LibraryFileSystemTarget) {
    setContextMenu(null);
    setPendingLibraryDeleteTarget(target);
  }

  async function handleDeleteTarget(target: LibraryFileSystemTarget) {
    await operateAffairsLibraryFile(workspaceId, {
      opType: "delete",
      srcPath: getContextTargetRelativePath(target)
    });
    if (target.kind === "document" && selectedObject.section === "library" && selectedObject.record?.id === target.record.id) {
      selectObject(null);
    }
    await refreshLibrary();
    showToast({
      title: t("shell.affairsLibraryDeleteSuccess", { name: getContextTargetTitle(target) }),
      tone: "success"
    });
  }

  async function submitPendingLibraryDelete() {
    if (!pendingLibraryDeleteTarget) {
      return;
    }

    setPendingLibraryDeleteSubmitting(true);
    try {
      await handleDeleteTarget(pendingLibraryDeleteTarget);
      setPendingLibraryDeleteTarget(null);
    } catch (deleteError) {
      showToast({
        title: readError(deleteError, t("shell.affairsLibraryActionFailed")),
        tone: "error"
      });
    } finally {
      setPendingLibraryDeleteSubmitting(false);
    }
  }

  function handleRequestCreate(target: LibraryContextMenuTarget, kind: PendingLibraryCreateKind) {
    setContextMenu(null);
    setPendingLibraryCreateError(null);
    setPendingLibraryCreate({
      folderPath: resolvePasteDestinationFolder(target),
      kind,
      fileName: resolveDefaultCreateName(kind)
    });
  }

  async function submitPendingLibraryCreate() {
    if (!pendingLibraryCreate || !binding) {
      return;
    }
    const trimmedName = pendingLibraryCreate.fileName.trim();
    if (!trimmedName) {
      setPendingLibraryCreateError(t("shell.affairsLibraryCreateNameRequired"));
      return;
    }
    const destinationPath = joinLibraryRelativePath(pendingLibraryCreate.folderPath, trimmedName);

    setPendingLibraryCreateSubmitting(true);
    setPendingLibraryCreateError(null);
    try {
      if (pendingLibraryCreate.kind === "directory") {
        if (platform.isDesktop) {
          const absoluteParentPath = pendingLibraryCreate.folderPath
            ? buildAbsoluteLibraryPath(binding.rootDir, pendingLibraryCreate.folderPath)
            : binding.rootDir;
          if (!absoluteParentPath) {
            throw new Error(t("shell.affairsLibraryAbsolutePathMissing"));
          }
          await createWorkspaceDirectory({
            parentPath: absoluteParentPath,
            directoryName: trimmedName
          });
        } else {
          await operateAffairsLibraryFile(workspaceId, {
            opType: "create_directory",
            dstPath: destinationPath
          });
        }
      } else {
        await operateAffairsLibraryFile(workspaceId, {
          opType: "create_file",
          dstPath: destinationPath,
          content: resolveCreateFileInitialContent(pendingLibraryCreate.kind)
        });
      }
      await refreshLibrary();
      setPendingLibraryCreate(null);
      showToast({
        title: t("shell.affairsLibraryCreateSuccess", { name: trimmedName }),
        tone: "success"
      });
    } catch (createError) {
      setPendingLibraryCreateError(readError(createError, t("shell.affairsLibraryCreateFailed")));
    } finally {
      setPendingLibraryCreateSubmitting(false);
    }
  }

  async function openTagAssignmentTarget(target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>) {
    setContextMenu(null);
    if (target.kind === "document") {
      const details = target.record.id === documentTagDetails?.documentId
        ? documentTagDetails
        : await getAffairsDocumentTagDetails(workspaceId, target.record.id);
      setPendingTagAssignmentTarget({
        kind: "document",
        title: target.record.displayName,
        documentId: target.record.id,
        existingTagIds: details.manualTagIds,
        resolvedTagPaths: compactDocumentTagPaths((details.resolvedTags ?? []).map((item) => item.path)),
      });
      return;
    }

    const folderPath = target.entry.path || ".";
    const details = folderTagDetails?.folderPath === folderPath
      ? folderTagDetails
      : await getAffairsFolderTagDetails(workspaceId, folderPath);
    setPendingTagAssignmentTarget({
      kind: "folder",
      title: target.entry.title,
      folderPath,
      existingTagIds: details.bindingTagIds,
    });
  }

  const finderColumns: Array<{
    key: FinderColumnKey;
    label: string;
    resizable: boolean;
  }> = [
    { key: "name", label: t("shell.affairsFinderColumnName"), resizable: true },
    { key: "size", label: t("shell.affairsFinderColumnSize"), resizable: true },
    { key: "updatedAt", label: t("shell.affairsFinderColumnUpdatedAt"), resizable: true },
    { key: "type", label: t("shell.affairsFinderColumnType"), resizable: true },
    { key: "createdAt", label: t("shell.affairsFinderColumnCreatedAt"), resizable: false }
  ];

  const renderContextMenu = () => {
    if (!contextMenu) {
      return null;
    }

    const target = contextMenu.target;
    const copyTarget = target.kind === "blank" ? null : target;
    const canPaste = Boolean(libraryClipboard);
    const copyFileText = copyTarget ? getContextTargetRelativePath(copyTarget) : "";
    const fileNameText = copyTarget ? getContextTargetTitle(copyTarget) : "";
    const absolutePathText = copyTarget ? resolveTargetAbsolutePath(binding?.rootDir ?? null, copyTarget) ?? "" : "";
    const isDocument = target.kind === "document";
    const isFileSystemTarget = target.kind === "document" || target.kind === "folder";
    const isBlankTarget = target.kind === "blank";

    const content = (
      <div
        ref={contextMenuRef}
        className="affairs-library-context-menu"
        role="menu"
        aria-label={t("shell.affairsLibraryContextMenuLabel")}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {isDocument ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => openLibraryViewer(target.record))}>
            {t("shell.affairsLibraryContextPreview")}
          </button>
        ) : null}
        {isFileSystemTarget ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleOpenTarget(target))}>
            {t("shell.affairsLibraryContextOpen")}
          </button>
        ) : null}
        {isFileSystemTarget ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleLocateTarget(target))}>
            {t("shell.affairsLibraryContextLocate")}
          </button>
        ) : null}
        {isDocument && platform.isDesktop && platform.ui.osFamily === "macos" && resolveLocalMirrorTarget(libraryConfig?.mirrorRoot, target.record.filePath) ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleOpenWithLocalApp(target))}>
            {t("shell.affairsLibraryOpenWithLocalAppAction")}
          </button>
        ) : null}
        {isDocument ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleDownload(target))}>
            {t("shell.affairsLibraryContextDownload")}
          </button>
        ) : null}
        {isBlankTarget ? (
          <div
            className="affairs-library-context-submenu"
            data-open={activeSubmenu === "new" ? "true" : undefined}
            onPointerEnter={() => openContextSubmenu("new")}
            onPointerLeave={() => closeContextSubmenuLater()}
          >
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={activeSubmenu === "new"}>
              <span>{t("shell.affairsLibraryContextNew")}</span>
              <span aria-hidden="true">›</span>
            </button>
            <div
              className="affairs-library-context-submenu-panel"
              role="menu"
              onPointerEnter={() => openContextSubmenu("new")}
              onPointerLeave={() => closeContextSubmenuLater()}
            >
              <button type="button" role="menuitem" onClick={() => handleRequestCreate(target, "directory")}>
                {t("shell.affairsLibraryContextNewDirectory")}
              </button>
              <button type="button" role="menuitem" onClick={() => handleRequestCreate(target, "markdown")}>
                {t("shell.affairsLibraryContextNewMarkdown")}
              </button>
              <button type="button" role="menuitem" onClick={() => handleRequestCreate(target, "text")}>
                {t("shell.affairsLibraryContextNewText")}
              </button>
              <button type="button" role="menuitem" onClick={() => handleRequestCreate(target, "custom")}>
                {t("shell.affairsLibraryContextNewCustomFile")}
              </button>
            </div>
          </div>
        ) : null}
        {copyTarget ? (
          <div
            className="affairs-library-context-submenu"
            data-open={activeSubmenu === "copy" ? "true" : undefined}
            onPointerEnter={() => openContextSubmenu("copy")}
            onPointerLeave={() => closeContextSubmenuLater()}
          >
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={activeSubmenu === "copy"}>
              <span>{t("shell.affairsLibraryContextCopy")}</span>
              <span aria-hidden="true">›</span>
            </button>
            <div
              className="affairs-library-context-submenu-panel"
              role="menu"
              onPointerEnter={() => openContextSubmenu("copy")}
              onPointerLeave={() => closeContextSubmenuLater()}
            >
              <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleCopyText(copyFileText, t("shell.affairsLibraryCopyFileSuccess")))}>
                {t("shell.affairsLibraryContextCopyFile")}
              </button>
              <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleCopyText(fileNameText, t("shell.affairsLibraryCopyFileNameSuccess")))}>
                {t("shell.affairsLibraryContextCopyFileName")}
              </button>
              <button type="button" role="menuitem" disabled={!absolutePathText} onClick={() => void runContextAction(() => handleCopyText(absolutePathText, t("shell.affairsLibraryCopyAbsolutePathSuccess")))}>
                {t("shell.affairsLibraryContextCopyAbsolutePath")}
              </button>
              <button type="button" role="menuitem" onClick={() => void runContextAction(() => handleCopyText(copyFileText, t("shell.affairsLibraryCopyRelativePathSuccess")))}>
                {t("shell.affairsLibraryContextCopyRelativePath")}
              </button>
            </div>
          </div>
        ) : null}
        {isFileSystemTarget ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => setLibraryClipboard({ mode: "cut", target }))}>
            {t("shell.affairsLibraryContextCut")}
          </button>
        ) : null}
        <button type="button" role="menuitem" disabled={!canPaste} onClick={() => void runContextAction(() => handlePaste(target))}>
          {t("shell.affairsLibraryContextPaste")}
        </button>
        {isFileSystemTarget ? (
          <button type="button" role="menuitem" className="danger" onClick={() => requestDeleteTarget(target)}>
            {t("shell.affairsLibraryContextDelete")}
          </button>
        ) : null}
        {isFileSystemTarget ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => openTagAssignmentTarget(target))}>
            {t("shell.affairsLibraryContextTags")}
          </button>
        ) : null}
        {isBlankTarget ? (
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => refreshLibrary())}>
            {t("shell.affairsLibraryContextRefresh")}
          </button>
        ) : null}
        {(isFileSystemTarget || isBlankTarget) ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => void runContextAction(() => {
              if (target.kind === "document") {
                selectObject(target.record.id);
                return;
              }
              selectObject(null);
              setSelectedLibraryFolderEntry(target.kind === "folder" ? target.entry.path : state.selectedFolderPath);
            })}
          >
            {t("shell.affairsLibraryContextProperties")}
          </button>
        ) : null}
      </div>
    );

    if (typeof document === "undefined") {
      return content;
    }

    return createPortal(content, document.body);
  };

  if (!initGuard.loading && !initGuard.unavailable && !initGuard.initialized) {
    return <AffairsConversationInitState workspaceId={workspaceId} />;
  }

  if (activeSection === "conversation") {
    return <AffairsConversationInitState workspaceId={workspaceId} />;
  }

  return (
    <div className="affairs-main-panel">
      <section className="affairs-stage-panel">
        {loading ? <AffairsStageSkeleton viewMode={state.viewMode} /> : null}
        {error ? <div className="affairs-stage-empty">{error}</div> : null}
        {!loading && !error ? (
          activeSection === "library" ? (
            !binding ? null : (
              <>
                <AffairsLibraryStageToolbar
                  browseMode={state.browseMode}
                  folderBreadcrumbs={folderBreadcrumbs}
                  recentTagTasks={recentTagTasks}
                  tagRecords={tagRecords}
                  indexStatus={indexStatus}
                  directoryStatus={state.browseMode === "folder" ? currentDirectoryStatus : null}
                  selectedTagPath={state.selectedTagPath}
                  selectedTagPaths={selectedTagPaths}
                  sortState={sortState}
                  viewMode={state.viewMode}
                  onNavigateFolder={navigateLibraryFolder}
                  onNavigateTag={navigateLibraryTag}
                  onResetTags={() => selectSidebarNode("library:tag-root")}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onRefresh={refreshLibrary}
                  onSetSortState={setSortState}
                  onSetViewMode={setLibraryViewMode}
                  refreshPending={libraryRefreshPending}
                />
                {libraryEntries.length === 0 ? (
                  libraryDocumentsLoading ? <AffairsStageSkeleton viewMode={state.viewMode} /> : <div className="affairs-stage-empty">{resolveLibraryEmptyText(indexStatus)}</div>
                ) : state.viewMode === "grid" ? (
                  <>
                <div ref={stageScrollRef} className="affairs-doc-grid-scroll" onContextMenu={openBlankContextMenu}>
                <div className="affairs-doc-grid-viewport" onContextMenu={openBlankContextMenu}>
                  {shouldVirtualizeGrid ? (
                    <div className="affairs-doc-grid-spacer" style={{ height: `${gridMetrics.totalHeight}px` }}>
                      <div
                        className="affairs-doc-grid affairs-doc-grid-virtual"
                        style={{ top: `${gridMetrics.offsetTop}px` }}
                      >
                        {visibleGridSlots.map((slot) => {
                          const entry = slot.entry;
                          if (!entry) {
                            return <AffairsGridPlaceholderCard key={`grid-placeholder-${slot.index}`} />;
                          }
                          if (entry.kind === "folder") {
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                className={state.selectedFolderEntryPath === entry.path ? "affairs-doc-item grid active" : "affairs-doc-item grid"}
                                onClick={() => handleLibraryFolderEntryClick(entry.path)}
                                onDoubleClick={() => openLibraryFolderEntry(entry.path)}
                                onContextMenu={(event) => openContextMenu(event, resolveContextTarget(entry))}
                              >
                                <div className="affairs-doc-icon">{renderFolderShape()}</div>
                                <div className="affairs-doc-title" title={entry.title}>{entry.title}</div>
                                <div className="affairs-doc-footer">
                                  <span className="affairs-doc-muted">{t("shell.affairsLibraryFolderCardCount", { count: entry.count })}</span>
                                </div>
                              </button>
                            );
                          }
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={selectedObject.section === "library" && selectedObject.record?.id === entry.documentId ? "affairs-doc-item grid active" : "affairs-doc-item grid"}
                              onClick={() => selectObject(entry.documentId)}
                              onContextMenu={(event) => openContextMenu(event, resolveContextTarget(entry))}
                              onDoubleClick={() => {
                                const record = documentRecords.find((item) => item.id === entry.documentId);
                                if (record) {
                                  openLibraryViewer(record);
                                }
                              }}
                            >
                              <div className="affairs-doc-icon">{renderDocumentShape(entry.path)}</div>
                              <div className="affairs-doc-title" title={entry.title}>{entry.title}</div>
                              <div className="affairs-doc-footer">
                                <span className="affairs-doc-muted">{formatRelativeMeta(entry.updatedAt)}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="affairs-doc-grid">
                      {sortedLibraryEntries.map((entry) => (
                        entry.kind === "folder" ? (
                          <button
                            key={entry.id}
                            type="button"
                            className={state.selectedFolderEntryPath === entry.path ? "affairs-doc-item grid active" : "affairs-doc-item grid"}
                            onClick={() => handleLibraryFolderEntryClick(entry.path)}
                            onDoubleClick={() => openLibraryFolderEntry(entry.path)}
                            onContextMenu={(event) => openContextMenu(event, resolveContextTarget(entry))}
                          >
                            <div className="affairs-doc-icon">{renderFolderShape()}</div>
                            <div className="affairs-doc-title" title={entry.title}>{entry.title}</div>
                            <div className="affairs-doc-footer">
                              <span className="affairs-doc-muted">{t("shell.affairsLibraryFolderCardCount", { count: entry.count })}</span>
                            </div>
                          </button>
                        ) : (
                    <button
                      key={entry.id}
                      type="button"
                      className={selectedObject.section === "library" && selectedObject.record?.id === entry.documentId ? "affairs-doc-item grid active" : "affairs-doc-item grid"}
                      onClick={() => selectObject(entry.documentId)}
                      onContextMenu={(event) => openContextMenu(event, resolveContextTarget(entry))}
                      onDoubleClick={() => {
                        const record = documentRecords.find((item) => item.id === entry.documentId);
                        if (record) {
                          openLibraryViewer(record);
                        }
                      }}
                    >
                            <div className="affairs-doc-icon">{renderDocumentShape(entry.path)}</div>
                            <div className="affairs-doc-title" title={entry.title}>{entry.title}</div>
                            <div className="affairs-doc-footer">
                              <span className="affairs-doc-muted">{formatRelativeMeta(entry.updatedAt)}</span>
                            </div>
                          </button>
                        )
                      ))}
                    </div>
                  )}
                </div>
                {libraryDocumentsLoading || libraryDocumentHasMore ? (
                  <div className="affairs-doc-grid-loading-overlay" aria-hidden="true">
                    <div className="affairs-doc-grid-loading">{t("common.loading")}</div>
                  </div>
                ) : null}
                </div>
                  </>
                ) : (
                  <>
                <div className="affairs-finder-shell">
                <div
                  className="affairs-finder-header"
                  style={{ gridTemplateColumns: finderGridTemplateColumns }}
                >
                  {finderColumns.map((column) => (
                    <span
                      key={column.key}
                      className="affairs-finder-header-cell affairs-finder-cell"
                      data-column={column.key}
                    >
                      <button
                        type="button"
                        className="affairs-finder-header-sort-button"
                        onClick={() => setSortState((previous) => getNextSortState(previous, column.key))}
                        aria-label={buildFinderSortButtonLabel(column.label, sortState, column.key)}
                      >
                        <span className="affairs-finder-header-label">{column.label}</span>
                        <span className="affairs-finder-header-sort-indicator" aria-hidden="true">
                          {renderFinderSortIndicator(sortState, column.key)}
                        </span>
                      </button>
                      {column.resizable ? (
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={t("shell.affairsFinderResizeColumn", { column: column.label })}
                          className="affairs-finder-column-resizer"
                          data-column={column.key}
                          onPointerDown={(event) => handleFinderColumnResizeStart(column.key, event)}
                        />
                      ) : null}
                    </span>
                  ))}
                </div>
                <div ref={listScrollRef} className="affairs-finder-list affairs-finder-viewport" onContextMenu={openBlankContextMenu}>
                  <div className="affairs-finder-spacer" style={{ height: `${listMetrics.totalHeight}px` }}>
                    <div className="affairs-finder-virtual" style={{ top: `${listMetrics.offsetTop}px` }}>
                      {visibleListSlots.map((slot) => {
                        const entry = slot.entry;
                        if (!entry) {
                          return (
                            <AffairsFinderPlaceholderRow
                              key={`list-placeholder-${slot.index}`}
                              gridTemplateColumns={finderGridTemplateColumns}
                            />
                          );
                        }
                        if (entry.kind === "folder") {
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={state.selectedFolderEntryPath === entry.path ? "affairs-finder-row active" : "affairs-finder-row"}
                              onClick={() => handleLibraryFolderEntryClick(entry.path)}
                              onDoubleClick={() => openLibraryFolderEntry(entry.path)}
                              onContextMenu={(event) => openContextMenu(event, resolveContextTarget(entry))}
                              style={{ gridTemplateColumns: finderGridTemplateColumns }}
                            >
                              <span className="affairs-finder-name-cell">
                                <span className="affairs-finder-icon">{renderFolderShape("row")}</span>
                                <span className="affairs-finder-name" title={entry.title}>{entry.title}</span>
                              </span>
                              <span className="affairs-finder-cell">{formatLibrarySize(null)}</span>
                              <span className="affairs-finder-cell">{formatFinderDateTime(entry.updatedAt)}</span>
                              <span className="affairs-finder-cell">{t("shell.affairsFinderKindFolder")}</span>
                              <span className="affairs-finder-cell">{formatFinderDateTime(entry.createdAt)}</span>
                            </button>
                          );
                        }
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className={selectedObject.section === "library" && selectedObject.record?.id === entry.documentId ? "affairs-finder-row active" : "affairs-finder-row"}
                            onClick={() => selectObject(entry.documentId)}
                            onContextMenu={(event) => openContextMenu(event, resolveContextTarget(entry))}
                            style={{ gridTemplateColumns: finderGridTemplateColumns }}
                            onDoubleClick={() => {
                              const record = documentRecords.find((item) => item.id === entry.documentId);
                              if (record) {
                                openLibraryViewer(record);
                              }
                            }}
                          >
                            <span className="affairs-finder-name-cell">
                              <span className="affairs-finder-icon">{renderDocumentShape(entry.path, "row")}</span>
                              <span className="affairs-finder-name" title={entry.title}>{entry.title}</span>
                            </span>
                            <span className="affairs-finder-cell">{formatLibrarySize(entry.sizeBytes)}</span>
                            <span className="affairs-finder-cell">{formatFinderDateTime(entry.updatedAt)}</span>
                            <span className="affairs-finder-cell">{resolveFinderKindLabel(entry.path)}</span>
                            <span className="affairs-finder-cell">{formatFinderDateTime(entry.createdAt)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {libraryDocumentsLoading || libraryDocumentHasMore ? (
                    <div className="affairs-finder-loading-overlay" aria-hidden="true">
                      <div className="affairs-finder-loading">{t("common.loading")}</div>
                    </div>
                  ) : null}
                </div>
                </div>
                  </>
                )}
              </>
            )
          ) : (
            <AffairsDashboardView />
          )
        ) : null}
      </section>
      <AffairsLibrarySettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <AffairsTagManagementModal />
      {pendingLibraryCreate ? (
        platform.isMobile ? (
          <MobileSheet
            open
            title={t("shell.affairsLibraryCreateModalTitle")}
            description={t("shell.affairsLibraryCreateModalDescription", { path: formatFolderPath(pendingLibraryCreate.folderPath) })}
            height="auto"
            kind="form"
            onClose={() => {
              if (!pendingLibraryCreateSubmitting) {
                setPendingLibraryCreate(null);
                setPendingLibraryCreateError(null);
              }
            }}
            footer={(
              <ModalActions>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pendingLibraryCreateSubmitting}
                  onClick={() => {
                    setPendingLibraryCreate(null);
                    setPendingLibraryCreateError(null);
                  }}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={pendingLibraryCreateSubmitting}
                  onClick={() => void submitPendingLibraryCreate()}
                >
                  {pendingLibraryCreateSubmitting ? t("common.loading") : t("shell.affairsLibraryCreateConfirmAction")}
                </button>
              </ModalActions>
            )}
          >
            <ModalField
              label={t("shell.affairsLibraryCreateNameLabel")}
              htmlFor={createNameInputId}
              description={t("shell.affairsLibraryCreateTypeHint", { type: resolveCreateKindLabel(pendingLibraryCreate.kind) })}
            >
              <input
                id={createNameInputId}
                value={pendingLibraryCreate.fileName}
                onChange={(event) => setPendingLibraryCreate((current) => current ? { ...current, fileName: event.target.value } : current)}
                placeholder={t("shell.affairsLibraryCreateNamePlaceholder")}
                autoFocus
              />
            </ModalField>
            {pendingLibraryCreateError ? <div className="affairs-binding-hint affairs-create-error">{pendingLibraryCreateError}</div> : null}
          </MobileSheet>
        ) : (
          <DesktopModal
            open
            title={t("shell.affairsLibraryCreateModalTitle")}
            description={t("shell.affairsLibraryCreateModalDescription", { path: formatFolderPath(pendingLibraryCreate.folderPath) })}
            size="compact"
            layout="form"
            onClose={() => {
              if (!pendingLibraryCreateSubmitting) {
                setPendingLibraryCreate(null);
                setPendingLibraryCreateError(null);
              }
            }}
            footer={(
              <ModalActions>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pendingLibraryCreateSubmitting}
                  onClick={() => {
                    setPendingLibraryCreate(null);
                    setPendingLibraryCreateError(null);
                  }}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={pendingLibraryCreateSubmitting}
                  onClick={() => void submitPendingLibraryCreate()}
                >
                  {pendingLibraryCreateSubmitting ? t("common.loading") : t("shell.affairsLibraryCreateConfirmAction")}
                </button>
              </ModalActions>
            )}
          >
            <ModalField
              label={t("shell.affairsLibraryCreateNameLabel")}
              htmlFor={createNameInputId}
              description={t("shell.affairsLibraryCreateTypeHint", { type: resolveCreateKindLabel(pendingLibraryCreate.kind) })}
            >
              <input
                id={createNameInputId}
                value={pendingLibraryCreate.fileName}
                onChange={(event) => setPendingLibraryCreate((current) => current ? { ...current, fileName: event.target.value } : current)}
                placeholder={t("shell.affairsLibraryCreateNamePlaceholder")}
                autoFocus
              />
            </ModalField>
            {pendingLibraryCreateError ? <div className="affairs-binding-hint affairs-create-error">{pendingLibraryCreateError}</div> : null}
          </DesktopModal>
        )
      ) : null}
      {pendingLibraryDeleteTarget ? (
        <AffairsLibraryDeleteConfirmModal
          mobile={platform.isMobile}
          target={pendingLibraryDeleteTarget}
          busy={pendingLibraryDeleteSubmitting}
          onClose={() => {
            if (!pendingLibraryDeleteSubmitting) {
              setPendingLibraryDeleteTarget(null);
            }
          }}
          onConfirm={() => {
            void submitPendingLibraryDelete();
          }}
        />
      ) : null}
      {pendingTagAssignmentTarget ? (
        platform.isMobile ? (
          <MobileSheet
            open
            title={t("shell.affairsTagQuickAssignModalTitle")}
            description={pendingTagAssignmentTarget.kind === "document"
              ? t("shell.affairsTagQuickAssignDocumentDescription", { name: pendingTagAssignmentTarget.title })
              : t("shell.affairsTagQuickAssignFolderDescription", { name: pendingTagAssignmentTarget.title })}
            height="auto"
            kind="form"
            backdropVisible={false}
            onClose={() => setPendingTagAssignmentTarget(null)}
            footer={(
              <ModalActions>
                <button type="button" className="secondary-button" onClick={() => setPendingTagAssignmentTarget(null)}>
                  {t("common.close")}
                </button>
              </ModalActions>
            )}
          >
            {pendingTagAssignmentTarget.kind === "document" ? (
              <AffairsQuickTagAssignmentEditor
                assignedTagIds={pendingTagAssignmentTarget.existingTagIds}
                resolvedTagPaths={pendingTagAssignmentTarget.resolvedTagPaths}
                emptyText={t("shell.affairsDocumentTagsEmpty")}
                inputLabel={t("shell.affairsDocumentTagAddLabel")}
                suggestionsLabel={t("shell.affairsDocumentTagSuggestionsLabel")}
                onSave={(nextTagIds, createTagPaths) => saveDocumentTagSelection(
                  pendingTagAssignmentTarget.documentId,
                  nextTagIds,
                  createTagPaths,
                  pendingTagAssignmentTarget.existingTagIds,
                  pendingTagAssignmentTarget.title,
                )}
                onSaved={() => setPendingTagAssignmentTarget(null)}
              />
            ) : (
              <AffairsQuickTagAssignmentEditor
                assignedTagIds={pendingTagAssignmentTarget.existingTagIds}
                emptyText={t("shell.affairsFolderTagsEmpty")}
                inputLabel={t("shell.affairsFolderTagAddLabel")}
                suggestionsLabel={t("shell.affairsFolderTagSuggestionsLabel")}
                onSave={(nextTagIds, createTagPaths) => saveFolderTagSelection(
                  pendingTagAssignmentTarget.folderPath,
                  nextTagIds,
                  createTagPaths,
                  pendingTagAssignmentTarget.existingTagIds,
                )}
                onSaved={() => setPendingTagAssignmentTarget(null)}
              />
            )}
          </MobileSheet>
        ) : (
          <DesktopModal
            open
            title={t("shell.affairsTagQuickAssignModalTitle")}
            description={pendingTagAssignmentTarget.kind === "document"
              ? t("shell.affairsTagQuickAssignDocumentDescription", { name: pendingTagAssignmentTarget.title })
              : t("shell.affairsTagQuickAssignFolderDescription", { name: pendingTagAssignmentTarget.title })}
            size="compact"
            layout="form"
            backdropVisible={false}
            onClose={() => setPendingTagAssignmentTarget(null)}
            footer={(
              <ModalActions>
                <button type="button" className="secondary-button" onClick={() => setPendingTagAssignmentTarget(null)}>
                  {t("common.close")}
                </button>
              </ModalActions>
            )}
          >
            {pendingTagAssignmentTarget.kind === "document" ? (
              <AffairsQuickTagAssignmentEditor
                assignedTagIds={pendingTagAssignmentTarget.existingTagIds}
                resolvedTagPaths={pendingTagAssignmentTarget.resolvedTagPaths}
                emptyText={t("shell.affairsDocumentTagsEmpty")}
                inputLabel={t("shell.affairsDocumentTagAddLabel")}
                suggestionsLabel={t("shell.affairsDocumentTagSuggestionsLabel")}
                onSave={(nextTagIds, createTagPaths) => saveDocumentTagSelection(
                  pendingTagAssignmentTarget.documentId,
                  nextTagIds,
                  createTagPaths,
                  pendingTagAssignmentTarget.existingTagIds,
                  pendingTagAssignmentTarget.title,
                )}
                onSaved={() => setPendingTagAssignmentTarget(null)}
              />
            ) : (
              <AffairsQuickTagAssignmentEditor
                assignedTagIds={pendingTagAssignmentTarget.existingTagIds}
                emptyText={t("shell.affairsFolderTagsEmpty")}
                inputLabel={t("shell.affairsFolderTagAddLabel")}
                suggestionsLabel={t("shell.affairsFolderTagSuggestionsLabel")}
                onSave={(nextTagIds, createTagPaths) => saveFolderTagSelection(
                  pendingTagAssignmentTarget.folderPath,
                  nextTagIds,
                  createTagPaths,
                  pendingTagAssignmentTarget.existingTagIds,
                )}
                onSaved={() => setPendingTagAssignmentTarget(null)}
              />
            )}
          </DesktopModal>
        )
      ) : null}
      {renderContextMenu()}
    </div>
  );
}

export function AffairsAuxiliaryPanel({ workspaceId, onToggleCollapse }: AffairsAuxiliaryPanelProps) {
  const {
    activeSection,
    activateConversationSession,
    agentConversationSessions,
    agentConversationSessionsLoading,
    agentProjectId,
    agentWorkspaceId,
    binding,
    assistantContext,
    auxiliaryTab,
    automationRuns,
    butlerStore,
    documentTagDetails,
    detailViewerCollapsed,
    filteredDocuments,
    filteredTodoRecords,
    folderRecords,
    initGuard,
    indexStatus,
    libraryConfig,
    lightweightConversationSessions,
    lightweightConversationSessionsLoading,
    markConversationSessionSeen,
    navigateLibraryFolder,
    openConversationCreateModal,
    reloadLightweightConversationSessions,
    reloadAgentConversationSessions,
    rememberConversationSession,
    selectAuxiliaryTab,
    toggleDetailViewerCollapsed,
    selectedObject,
    state,
    tagRecords,
    selectedTagPaths
  } = useAffairsWorkbenchInternal();
  const butlerControlSession = useButlerRuntimeStore(butlerStore, (value) => value.controlSession);
  const [viewerReady, setViewerReady] = useState(false);
  const conversationGuardActive = activeSection === "conversation" && !initGuard.initialized;
  const assistantHistoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const assistantHistoryPopoverRef = useRef<HTMLDivElement | null>(null);
  const [assistantHistoryOpen, setAssistantHistoryOpen] = useState(false);
  const showDetailTab = activeSection === "library";
  const assistantBridgeContext = activeSection === "workbench"
    ? assistantContext
    : (binding ? assistantContext : null);

  const selectedAutomationRuns = useMemo(() => {
    if (selectedObject.section !== "automation" || !selectedObject.record) {
      return [];
    }

    return automationRuns
      .filter((run) => run.automationId === selectedObject.record?.id)
      .slice(0, 12);
  }, [automationRuns, selectedObject]);

  const folderDetail = useMemo(
    () => buildFolderDetailState(folderRecords, filteredDocuments, state.selectedFolderPath, state.selectedFolderEntryPath, selectedObject),
    [filteredDocuments, folderRecords, selectedObject, state.selectedFolderEntryPath, state.selectedFolderPath]
  );
  const tagDetail = useMemo(
    () => buildTagDetailState(tagRecords, filteredDocuments, state.selectedTagPath, selectedTagPaths),
    [filteredDocuments, selectedTagPaths, state.selectedTagPath, tagRecords]
  );
  const documentRecord = selectedObject.section === "library" ? selectedObject.record : null;
  const todoRecord = selectedObject.section === "todo" ? selectedObject.record : null;
  const automationRecord = selectedObject.section === "automation" ? selectedObject.record : null;
  const localMirrorTarget = useMemo(
    () => documentRecord
      ? resolveLocalMirrorTarget(libraryConfig?.mirrorRoot, documentRecord.filePath)
      : null,
    [documentRecord, libraryConfig?.mirrorRoot]
  );
  const currentAgentSession = useMemo(
    () => isAffairsControlSessionMatchWorkspaceId(butlerControlSession, agentWorkspaceId)
      ? (butlerControlSession?.session ?? null)
      : null,
    [agentWorkspaceId, butlerControlSession]
  );
  const assistantHistoryItems = useMemo(() => {
    const lightweightItems = lightweightConversationSessions.map((session) => ({
      id: buildAffairsConversationSessionNodeId("lightweight", session.sessionId),
      kind: "lightweight" as const,
      session
    }));
    const agentItems =
      currentAgentSession
      && agentConversationSessions.every((session) => session.sessionId !== currentAgentSession.sessionId)
        ? [currentAgentSession, ...agentConversationSessions]
        : agentConversationSessions;
    const normalizedAgentItems = agentItems.map((session) => ({
        id: buildAffairsConversationSessionNodeId("agent", session.sessionId),
        kind: "agent" as const,
        session
      }));
    return [...lightweightItems, ...normalizedAgentItems]
      .sort((left, right) => {
      if (left.session.isFavorite !== right.session.isFavorite) {
        return left.session.isFavorite ? -1 : 1;
      }
      return resolveConversationSessionSortTime(right.session) - resolveConversationSessionSortTime(left.session);
    }).filter((item) => item.session.isArchived !== true);
  }, [agentConversationSessions, currentAgentSession, lightweightConversationSessions]);
  const assistantHistoryLoading = lightweightConversationSessionsLoading || agentConversationSessionsLoading;
  const { showToast } = useToast();
  const [documentSummaryExpanded, setDocumentSummaryExpanded] = useState(false);

  useEffect(() => {
    if (
      auxiliaryTab !== "detail"
      || selectedObject.section !== "library"
      || !selectedObject.record
    ) {
      setViewerReady(false);
      return;
    }

    setViewerReady(false);
    const timer = window.setTimeout(() => {
      setViewerReady(true);
    }, DETAIL_VIEWER_MOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [auxiliaryTab, selectedObject]);

  useEffect(() => {
    setDocumentSummaryExpanded(false);
  }, [selectedObject]);

  useEffect(() => {
    if (auxiliaryTab !== "assistant") {
      setAssistantHistoryOpen(false);
    }
  }, [auxiliaryTab]);

  useEffect(() => {
    if (!assistantHistoryOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (
        assistantHistoryButtonRef.current?.contains(event.target)
        || assistantHistoryPopoverRef.current?.contains(event.target)
      ) {
        return;
      }
      setAssistantHistoryOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAssistantHistoryOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [assistantHistoryOpen]);

  const handleOpenAssistantHistory = useCallback(() => {
    setAssistantHistoryOpen((current) => !current);
    void reloadLightweightConversationSessions().catch(() => undefined);
    void reloadAgentConversationSessions().catch(() => undefined);
  }, [reloadAgentConversationSessions, reloadLightweightConversationSessions]);

  const handleOpenAssistantSession = useCallback(async (item: AffairsConversationListItem) => {
    if (item.kind === "lightweight") {
      markConversationSessionSeen(item.kind, item.session.sessionId);
      setAssistantHistoryOpen(false);

      try {
        const response = await getAffairsLightweightSessionMessages(workspaceId, item.session.sessionId);
        activateConversationSession({
          kind: "lightweight",
          session: item.session,
          bootstrapMessages: response.messages
        });
      } catch (error) {
        showToast({
          title: getErrorMessage(error, t("shell.affairsConversationLoadFailed")),
          tone: "error"
        });
      }
      return;
    }

    markConversationSessionSeen(item.kind, item.session.sessionId);
    setAssistantHistoryOpen(false);

    const currentControlSession = butlerStore.getState().controlSession;
    if (currentControlSession?.session.sessionId === item.session.sessionId) {
      rememberConversationSession({
        kind: "agent",
        session: currentControlSession.session,
        bootstrapMessages: []
      });
      return;
    }

    try {
      const controlSessions = await listButlerControlSessions();
      let matchedControlSession = controlSessions.items.find(
        (controlSessionItem) => controlSessionItem.session.sessionId === item.session.sessionId
      ) ?? null;

      if (!matchedControlSession) {
        const butlerSessionId = extractButlerManagedSessionIdFromRawStoreRef(item.session.rawStoreRef ?? null);

        if (!agentProjectId || !butlerSessionId) {
          throw new Error(t("shell.butlerLoadFailed"));
        }

        const resumed = await resumeButlerProjectSession(agentProjectId, butlerSessionId);
        const refreshedControlSessions = await listButlerControlSessions();
        matchedControlSession = refreshedControlSessions.items.find(
          (controlSessionItem) => controlSessionItem.session.sessionId === resumed.resumed.session.sessionId
        ) ?? null;
      }

      if (!matchedControlSession) {
        throw new Error(t("shell.butlerLoadFailed"));
      }

      await butlerStore.openControlSession(matchedControlSession.id);
      rememberConversationSession({
        kind: "agent",
        session: matchedControlSession.session,
        bootstrapMessages: []
      });
    } catch (error) {
      showToast({
        title: getErrorMessage(error, t("shell.butlerLoadFailed")),
        tone: "error"
      });
    }
  }, [
    activateConversationSession,
    agentProjectId,
    butlerStore,
    markConversationSessionSeen,
    rememberConversationSession,
    showToast,
    workspaceId
  ]);

  if (activeSection === "conversation" && initGuard.loading) {
    return (
      <section className="workbench-section-block affairs-sidebar-block affairs-auxiliary-block">
        <div className="affairs-sidebar-block-header">
          <div>
            <h2>{t("shell.affairsConnectionCheckingTitle")}</h2>
            <p>{t("shell.affairsConnectionCheckingDescription")}</p>
          </div>
        </div>
        <div className="affairs-stage-empty">{t("shell.affairsConnectionCheckingAuxiliaryEmpty")}</div>
      </section>
    );
  }

  if (activeSection === "conversation" && initGuard.unavailable) {
    return (
      <section className="workbench-section-block affairs-sidebar-block affairs-auxiliary-block">
        <div className="affairs-sidebar-block-header">
          <div>
            <h2>{t("shell.affairsHostUnavailableTitle")}</h2>
            <p>{t("shell.affairsHostUnavailableDescription")}</p>
          </div>
        </div>
        <div className="affairs-stage-empty">{t("shell.affairsHostUnavailableAuxiliaryEmpty")}</div>
      </section>
    );
  }

  return (
    <div className="affairs-auxiliary-shell">
      <div className="workbench-auxiliary-header">
        {onToggleCollapse ? (
          <button
            type="button"
            className="workbench-nav-toolbar-button"
            aria-label={t("shell.hideInfoSidebar")}
            title={t("shell.hideInfoSidebar")}
            onClick={onToggleCollapse}
          >
            <AffairsSidebarCollapseIcon />
          </button>
        ) : null}
        <div className="workbench-info-tabs affairs-auxiliary-tabs" role="tablist" aria-label={t("shell.affairsAuxiliaryTabsLabel")}>
          {showDetailTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={auxiliaryTab === "detail"}
              className={auxiliaryTab === "detail" ? "workbench-info-tab active" : "workbench-info-tab"}
              onClick={() => selectAuxiliaryTab("detail")}
            >
              {t("shell.affairsDetailTitle")}
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={auxiliaryTab === "assistant"}
            className={auxiliaryTab === "assistant" ? "workbench-info-tab active" : "workbench-info-tab"}
            onClick={() => selectAuxiliaryTab("assistant")}
          >
            {t("shell.affairsAssistantTitle")}
          </button>
        </div>
        <div className="affairs-auxiliary-header-tools">
          <div
            className="affairs-auxiliary-header-actions"
            data-visible={auxiliaryTab === "assistant" ? "true" : "false"}
            aria-hidden={auxiliaryTab === "assistant" ? undefined : "true"}
          >
            {auxiliaryTab === "assistant" ? (
              <>
                <button
                  ref={assistantHistoryButtonRef}
                  type="button"
                  className="workbench-nav-toolbar-button"
                  aria-label={t("shell.butlerHistoryAction")}
                  title={t("shell.butlerHistoryAction")}
                  aria-haspopup="dialog"
                  aria-expanded={assistantHistoryOpen}
                  onClick={handleOpenAssistantHistory}
                >
                  <AffairsAssistantHistoryIcon />
                </button>
                <ButlerAnchoredPopover
                  open={assistantHistoryOpen && assistantHistoryButtonRef.current !== null}
                  className="affairs-assistant-history-popover"
                  backdropClassName="affairs-assistant-history-backdrop"
                  showBackdrop
                  anchorRef={assistantHistoryButtonRef}
                  popoverRef={assistantHistoryPopoverRef}
                  role="dialog"
                  labelledBy="affairs-assistant-history-title"
                  maxWidth={420}
                  gap={8}
                >
                  <div className="affairs-assistant-history-popover-card">
                    <div className="affairs-assistant-history-popover-header">
                      <strong id="affairs-assistant-history-title">{t("shell.affairsConversationSidebarTitle")}</strong>
                      <span>{assistantHistoryItems.length}</span>
                    </div>
                    {assistantHistoryLoading && assistantHistoryItems.length === 0 ? (
                      <div className="affairs-assistant-history-empty">{t("common.loading")}</div>
                    ) : assistantHistoryItems.length === 0 ? (
                      <div className="affairs-assistant-history-empty">{t("shell.affairsConversationCreateHint")}</div>
                    ) : (
                      <div className="affairs-assistant-history-list" role="list">
                        {assistantHistoryItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            role="listitem"
                            className="affairs-assistant-history-item"
                            data-active={state.selectedNodeId === item.id ? "true" : undefined}
                            onClick={() => handleOpenAssistantSession(item)}
                          >
                            <div className="affairs-assistant-history-item-main">
                              <div className="affairs-assistant-history-item-title-row">
                                <span className="affairs-assistant-history-item-title" title={item.session.title}>
                                  {item.session.title}
                                </span>
                                {item.session.isFavorite ? (
                                  <span className="affairs-assistant-history-item-favorite" aria-hidden="true">★</span>
                                ) : null}
                              </div>
                              <div className="affairs-assistant-history-item-meta">
                                {[resolveAffairsConversationKindLabel(item.kind), buildAffairsConversationMeta(item.session)].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                            <span className={`session-provider-badge ${item.session.provider}`}>
                              {formatAffairsConversationProviderBadge(item.session.provider)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </ButlerAnchoredPopover>
                <button
                  type="button"
                  className="workbench-nav-toolbar-button"
                  aria-label={t("shell.butlerNewSessionAction")}
                  title={t("shell.butlerNewSessionAction")}
                  onClick={() => openConversationCreateModal({ mode: "agent-only" })}
                >
                  <AffairsConversationPlusIcon />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className="workbench-auxiliary-body"
        data-scrollbar-autohide="true"
        data-affairs-auxiliary-tab={auxiliaryTab}
      >
        {conversationGuardActive ? (
          auxiliaryTab === "assistant"
            ? <UniversalAssistantBridge workspaceId={workspaceId} context={null} />
            : <div className="affairs-stage-empty">{t("shell.affairsInitRouteGuardAuxiliaryEmpty")}</div>
        ) : auxiliaryTab === "detail" ? (
          selectedObject.section === "library" ? (
            !binding ? (
              <div className="affairs-stage-empty">{t("shell.affairsDetailEmpty")}</div>
            ) : documentRecord ? (
              <div className="affairs-detail-panel">
                <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                  <div className="affairs-detail-headline affairs-detail-headline-document">
                    <div className="affairs-detail-headline-main affairs-detail-headline-main-centered">
                      <span className="affairs-detail-headline-label">{t("shell.affairsLibraryDocumentDetailTitle")}</span>
                      <h2>{documentRecord.displayName}</h2>
                      <div className="affairs-detail-summary-block">
                        <p
                          className="affairs-detail-summary"
                          data-expanded={documentSummaryExpanded ? "true" : undefined}
                        >
                          {documentRecord.summary}
                        </p>
                        {shouldShowDocumentSummaryToggle(documentRecord.summary) ? (
                          <button
                            type="button"
                            className="affairs-detail-summary-toggle"
                            aria-expanded={documentSummaryExpanded}
                            onClick={() => setDocumentSummaryExpanded((current) => !current)}
                          >
                            {documentSummaryExpanded
                              ? t("shell.affairsDocumentSummaryCollapseAction")
                              : t("shell.affairsDocumentSummaryExpandAction")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <dl className="affairs-detail-meta-list">
                    <div>
                      <dt>{t("shell.affairsDetailMetaPath")}</dt>
                      <dd>
                        <AffairsDetailPathBreadcrumbs
                          path={documentRecord.filePath}
                          rootLabel={t("shell.affairsLibraryFolderRootLabel")}
                          onNavigate={navigateLibraryFolder}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsLibraryDocumentSize")}</dt>
                      <dd>{formatLibrarySize(documentRecord.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsLibraryDocumentCreatedAt")}</dt>
                      <dd>{formatFullDateTime(documentRecord.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsLibraryDocumentUpdatedAt")}</dt>
                      <dd>{formatFullDateTime(documentRecord.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsLibraryMirrorRootLabel")}</dt>
                      <dd>{libraryConfig?.mirrorRoot?.trim() || t("shell.affairsLibraryMirrorRootEmpty")}</dd>
                    </div>
                  </dl>
                  <div className="affairs-detail-tag-editor">
                    <strong>{t("shell.affairsDocumentTagsSectionTitle")}</strong>
                    <AffairsDocumentTagSelectionPanel
                      documentId={documentRecord.id}
                      details={documentTagDetails}
                    />
                  </div>
                  <div className="affairs-binding-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => navigateLibraryFolder(getDocumentParentPath(documentRecord.filePath) || null)}
                    >
                      {t("shell.affairsLibraryLocateFolderAction")}
                    </button>
                    {localMirrorTarget ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={async () => {
                            const result = await getCodingNSDesktopBridge().fs.openFile(localMirrorTarget.absolutePath);
                            if (!result.ok) {
                              showToast({
                                title: t("shell.affairsLibraryOpenLocalFileFailed"),
                                description: result.detail ?? localMirrorTarget.absolutePath,
                                tone: "error"
                              });
                            }
                          }}
                        >
                          {t("shell.affairsLibraryOpenLocalFileAction")}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={async () => {
                            const result = await getCodingNSDesktopBridge().fs.revealInFileManager(localMirrorTarget.absolutePath);
                            if (!result.ok) {
                              showToast({
                                title: t("shell.affairsLibraryRevealLocalFileFailed"),
                                description: result.detail ?? localMirrorTarget.absolutePath,
                                tone: "error"
                              });
                            }
                          }}
                        >
                          {t("shell.affairsLibraryRevealLocalFileAction")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </section>
                <div className="affairs-detail-viewer-shell" data-collapsed={detailViewerCollapsed ? "true" : undefined}>
                  <AffairsLibraryInlineViewer
                    workspaceId={workspaceId}
                    filePath={documentRecord.filePath}
                    windowTitle={documentRecord.displayName}
                    collapsed={detailViewerCollapsed}
                    loading={!viewerReady}
                    onToggleCollapsed={toggleDetailViewerCollapsed}
                  />
                </div>
              </div>
            ) : state.browseMode === "folder" ? (
              <AffairsFolderDetailPanel detail={folderDetail} />
            ) : (
              <AffairsTagDetailPanel detail={tagDetail} />
            )
          ) : selectedObject.section === "todo" ? (
            todoRecord ? (
              <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                <div className="affairs-detail-headline">
                  <div>
                    <h2>{todoRecord.title}</h2>
                    <p>{todoRecord.summary}</p>
                  </div>
                  <span className="affairs-inline-pill">{todoRecord.sourceLabel}</span>
                </div>
                <dl className="affairs-detail-meta-list">
                  <div>
                    <dt>{t("shell.affairsTodoDetailStatus")}</dt>
                    <dd>{todoRecord.statusLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailSource")}</dt>
                    <dd>{todoRecord.sourceDescription}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailNotes")}</dt>
                    <dd>{todoRecord.detail}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailTotal")}</dt>
                    <dd>{t("shell.affairsTodoDetailTotalValue", { count: filteredTodoRecords.length })}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <div className="affairs-stage-empty">{t("shell.affairsTodoEmpty")}</div>
            )
          ) : selectedObject.section === "workbench" ? (
            <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
              <div className="affairs-detail-headline">
                <div>
                  <h2>{t("shell.affairsWorkbenchDetailTitle")}</h2>
                  <p>{t("shell.affairsWorkbenchDetailDescription")}</p>
                </div>
                <span className="affairs-inline-pill">{t("shell.affairsWorkbenchNav")}</span>
              </div>
            </section>
          ) : automationRecord ? (
            <div className="affairs-detail-panel">
              <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                <div className="affairs-detail-headline">
                  <div>
                    <h2>{automationRecord.title}</h2>
                    <p>{automationRecord.summary}</p>
                  </div>
                  <span className="affairs-inline-pill">{automationRecord.statusLabel}</span>
                </div>
                <dl className="affairs-detail-meta-list">
                  <div>
                    <dt>{t("shell.affairsAutomationDetailTrigger")}</dt>
                    <dd>{automationRecord.triggerLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsAutomationDetailTarget")}</dt>
                    <dd>{automationRecord.targetSessionLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsAutomationDetailStatus")}</dt>
                    <dd>{automationRecord.statusLabel}</dd>
                  </div>
                </dl>
              </section>
              <section className="workbench-section-block affairs-detail-block">
                <div className="affairs-detail-headline compact">
                  <h3>{t("shell.affairsAutomationRunsTitle")}</h3>
                  <p>{t("shell.affairsAutomationRunsDescription")}</p>
                </div>
                {selectedAutomationRuns.length === 0 ? (
                  <div className="affairs-stage-empty compact">{t("shell.affairsAutomationRunsEmpty")}</div>
                ) : (
                  <div className="affairs-run-list">
                    {selectedAutomationRuns.map((run) => (
                      <div key={run.id} className="affairs-run-item">
                        <div className="affairs-run-item-row">
                          <strong>{resolveAutomationRunStatusLabel(run.status)}</strong>
                          <span className="affairs-run-item-time">{formatRelativeMeta(run.finishedAt || run.startedAt || run.createdAt)}</span>
                        </div>
                        <span>{run.summary?.trim() || run.error?.trim() || t("shell.affairsAutomationRunsFallback")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="affairs-stage-empty">{t("shell.affairsAutomationEmpty")}</div>
          )
        ) : (
          <UniversalAssistantBridge workspaceId={workspaceId} context={assistantBridgeContext} />
        )}
      </div>
    </div>
  );
}

function AffairsTagTreeNode({
  node,
  state,
  selectedTagPaths,
  expandedPaths,
  expandedOverflowPaths,
  onSelect,
  onToggleExpand,
  onToggleOverflow,
  onToggleFavorite
}: {
  node: TagTreeNodeRecord;
  state: AffairsViewState;
  selectedTagPaths: string[];
  expandedPaths: string[];
  expandedOverflowPaths: string[];
  onSelect: (nodeId: string) => void;
  onToggleExpand: (path: string) => void;
  onToggleOverflow: (path: string) => void;
  onToggleFavorite: (favorite: AffairsLibraryFavoriteRecordDto) => Promise<void>;
}) {
  const nodeId = `library:tag:${node.path}`;
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && expandedPaths.includes(node.path);
  const visibleChildren = resolveVisibleTagChildren(node.children, node.path, expandedOverflowPaths);
  const hasOverflowChildren = node.children.length > TAG_TREE_CHILDREN_VISIBLE_LIMIT;
  const overflowExpanded = expandedOverflowPaths.includes(node.path);
  const active = selectedTagPaths.includes(node.path);
  return (
    <div className="affairs-tag-tree-node" role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className={active || nodeId === state.selectedNodeId ? "affairs-sidebar-item active" : "affairs-sidebar-item"} data-tone="tag">
        <div className="affairs-tag-tree-row">
          {hasChildren ? (
            <button
              type="button"
              className="affairs-tag-tree-toggle"
              aria-label={expanded ? t("shell.subagentCollapse") : t("shell.subagentExpand")}
              onClick={() => onToggleExpand(node.path)}
            >
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
            </button>
          ) : (
            <span className="affairs-tag-tree-toggle placeholder" aria-hidden="true" />
          )}
          <button type="button" className="affairs-sidebar-item-button affairs-sidebar-item-button-content" onClick={() => onSelect(nodeId)}>
            <div className="affairs-sidebar-item-row">
              <span className="affairs-sidebar-item-title">{node.label}</span>
              <div className="affairs-sidebar-item-actions">
                <span className="affairs-sidebar-item-badge">{node.count}</span>
              </div>
            </div>
          </button>
          {renderFavoriteToggle(nodeId, node.label, onToggleFavorite)}
        </div>
      </div>
      {expanded ? (
        <div className="affairs-tag-tree-children" role="group">
          {visibleChildren.map((child) => (
            <AffairsTagTreeNode
              key={child.path}
              node={child}
              state={state}
              selectedTagPaths={selectedTagPaths}
              expandedPaths={expandedPaths}
              expandedOverflowPaths={expandedOverflowPaths}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onToggleOverflow={onToggleOverflow}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
          {hasOverflowChildren ? (
            <button
              type="button"
              className="affairs-tag-tree-more"
              onClick={() => onToggleOverflow(node.path)}
            >
              <span className="affairs-tag-tree-more-icon" aria-hidden="true">{overflowExpanded ? "▴" : "▾"}</span>
              <span className="affairs-tag-tree-more-label">
                {overflowExpanded ? t("shell.affairsLibraryTagTreeShowLess") : t("shell.affairsLibraryTagTreeShowMore")}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AffairsFolderDetailPanel({ detail }: { detail: FolderDetailState }) {
  const { folderTagDetails, saveFolderTagSelection } = useAffairsWorkbenchInternal();
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  useEffect(() => {
    setSummaryExpanded(false);
  }, [detail?.path]);

  if (!detail) {
    return <div className="affairs-detail-empty-state">{t("shell.affairsDetailEmpty")}</div>;
  }
  return (
    <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
      <div className="affairs-detail-headline affairs-detail-headline-document">
        <div className="affairs-detail-headline-main affairs-detail-headline-main-centered">
          <span className="affairs-detail-headline-label">{t("shell.affairsLibraryFolderDetailTitle")}</span>
          <h2>{detail.title}</h2>
          <div className="affairs-detail-summary-block">
            <p
              className="affairs-detail-summary"
              data-expanded={summaryExpanded ? "true" : undefined}
            >
              {detail.summary}
            </p>
            {shouldShowDocumentSummaryToggle(detail.summary) ? (
              <button
                type="button"
                className="affairs-detail-summary-toggle"
                aria-expanded={summaryExpanded}
                onClick={() => setSummaryExpanded((current) => !current)}
              >
                {summaryExpanded
                  ? t("shell.affairsDocumentSummaryCollapseAction")
                  : t("shell.affairsDocumentSummaryExpandAction")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <dl className="affairs-detail-meta-list">
        <div>
          <dt>{t("shell.affairsLibraryCurrentFolder")}</dt>
          <dd>{detail.path}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryDirectFolderCount")}</dt>
          <dd>{detail.childFolderCount}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryDirectDocumentCount")}</dt>
          <dd>{detail.directDocumentCount}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryNestedDocumentCount")}</dt>
          <dd>{detail.totalDocumentCount}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryDocumentCreatedAt")}</dt>
          <dd>{formatFullDateTime(detail.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryDocumentUpdatedAt")}</dt>
          <dd>{formatFullDateTime(detail.updatedAt)}</dd>
        </div>
      </dl>
      <div className="affairs-detail-tag-editor">
        <strong>{t("shell.affairsFolderTagsSectionTitle")}</strong>
        <AffairsQuickTagAssignmentEditor
          assignedTagIds={folderTagDetails?.bindingTagIds ?? []}
          emptyText={t("shell.affairsFolderTagsEmpty")}
          inputLabel={t("shell.affairsFolderTagAddLabel")}
          suggestionsLabel={t("shell.affairsFolderTagSuggestionsLabel")}
          onSave={(nextTagIds, createTagPaths) => saveFolderTagSelection(
            folderTagDetails?.folderPath ?? detail.folderPath ?? ".",
            nextTagIds,
            createTagPaths,
            folderTagDetails?.bindingTagIds ?? [],
          )}
        />
      </div>
    </section>
  );
}

function AffairsDocumentTagSelectionPanel({
  documentId,
  details,
}: {
  documentId: string;
  details: AffairsDocumentTagDetailsDto | null;
}) {
  const { saveDocumentTagSelection } = useAffairsWorkbenchInternal();

  if (!details) {
    return <span className="affairs-binding-hint">{t("shell.affairsTagDetailsLoading")}</span>;
  }

  return (
    <AffairsQuickTagAssignmentEditor
      assignedTagIds={details.manualTagIds}
      resolvedTagPaths={compactDocumentTagPaths((details.resolvedTags ?? []).map((tag) => tag.path))}
      emptyText={t("shell.affairsDocumentTagsEmpty")}
      inputLabel={t("shell.affairsDocumentTagAddLabel")}
      suggestionsLabel={t("shell.affairsDocumentTagSuggestionsLabel")}
      onSave={(nextTagIds, createTagPaths) => saveDocumentTagSelection(
        documentId,
        nextTagIds,
        createTagPaths,
        details.manualTagIds,
        details.title,
      )}
    />
  );
}

function AffairsQuickTagAssignmentEditor({
  assignedTagIds,
  resolvedTagPaths = [],
  emptyText,
  inputLabel,
  suggestionsLabel,
  onSave,
  onSaved,
}: {
  assignedTagIds: string[];
  resolvedTagPaths?: string[];
  emptyText: string;
  inputLabel: string;
  suggestionsLabel: string;
  onSave: (nextTagIds: string[], createTagPaths?: string[]) => Promise<void>;
  onSaved?: () => void;
}) {
  const { managedTags } = useAffairsWorkbenchInternal();
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedTagIds = useMemo(() => new Set(assignedTagIds), [assignedTagIds]);
  const assignableTags = useMemo(
    () => (Array.isArray(managedTags) ? managedTags : []).filter(isAssignableManagedTag),
    [managedTags]
  );
  const selectedTags = useMemo(
    () => assignableTags.filter((tag) => selectedTagIds.has(tag.id)),
    [assignableTags, selectedTagIds]
  );
  const selectedTagByPath = useMemo(() => {
    const map = new Map<string, AffairsTagNodeDto>();
    selectedTags.forEach((tag) => map.set(tag.path, tag));
    return map;
  }, [selectedTags]);
  const visibleTagPaths = useMemo(
    () => compactDocumentTagPaths([
      ...resolvedTagPaths,
      ...selectedTags.map((tag) => tag.path),
    ]),
    [resolvedTagPaths, selectedTags]
  );
  const normalizedQuery = normalizeTagPathInput(query);
  const normalizedQueryLower = normalizedQuery.toLowerCase();
  const matchedTags = useMemo(() => {
    if (!normalizedQueryLower) {
      return [];
    }
    return assignableTags
      .filter((tag) => !selectedTagIds.has(tag.id))
      .filter((tag) => {
        const searchable = `${tag.path} ${tag.name}`.toLowerCase();
        return searchable.includes(normalizedQueryLower);
      })
      .slice(0, 8);
  }, [assignableTags, normalizedQueryLower, selectedTagIds]);
  const exactMatchedTag = useMemo(
    () => assignableTags.find((tag) => tag.path.toLowerCase() === normalizedQueryLower) ?? null,
    [assignableTags, normalizedQueryLower]
  );
  const canCreateTag = normalizedQuery.length > 0 && !exactMatchedTag;

  const commitSelection = async (nextTagIds: string[], createTagPaths: string[] = []) => {
    setSubmitting(true);
    try {
      await onSave(uniqueStringList(nextTagIds), createTagPaths);
      setQuery("");
      onSaved?.();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitQuery = async () => {
    if (!normalizedQuery) {
      return;
    }
    if (exactMatchedTag) {
      if (selectedTagIds.has(exactMatchedTag.id)) {
        setQuery("");
        return;
      }
      await commitSelection([...assignedTagIds, exactMatchedTag.id]);
      return;
    }
    await commitSelection([...assignedTagIds], [normalizedQuery]);
  };

  return (
    <>
      <div className="affairs-document-tag-list">
        {visibleTagPaths.length === 0 ? (
          <span className="affairs-binding-hint">{emptyText}</span>
        ) : visibleTagPaths.map((tagPath) => {
          const manualTag = selectedTagByPath.get(tagPath);
          if (!manualTag) {
            return <AffairsColorTag key={tagPath} label={tagPath} path={tagPath} />;
          }
          return (
            <button
              key={manualTag.id}
              type="button"
              className="affairs-document-tag-token"
              aria-label={t("shell.affairsDocumentTagRemoveAction", { tag: manualTag.path })}
              disabled={submitting}
              onClick={() => {
                void commitSelection(assignedTagIds.filter((item) => item !== manualTag.id));
              }}
            >
              <AffairsColorTag label={manualTag.path} path={manualTag.path} />
              <span aria-hidden="true">×</span>
            </button>
          );
        })}
      </div>
      <div className="affairs-document-tag-picker">
        <label className="affairs-document-tag-input-label">
          <span>{inputLabel}</span>
          <input
            value={query}
            disabled={submitting}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmitQuery();
              }
            }}
            placeholder={t("shell.affairsTagQuickSearchPlaceholder")}
          />
        </label>
        {normalizedQuery ? (
          <div className="affairs-document-tag-suggestions" role="listbox" aria-label={suggestionsLabel}>
            {matchedTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="affairs-document-tag-suggestion"
                disabled={submitting}
                onClick={() => {
                  void commitSelection([...assignedTagIds, tag.id]);
                }}
              >
                <AffairsColorTag label={tag.path} path={tag.path} />
              </button>
            ))}
            {canCreateTag ? (
              <button
                type="button"
                className="affairs-document-tag-suggestion affairs-document-tag-create-suggestion"
                disabled={submitting}
                onClick={() => {
                  void commitSelection([...assignedTagIds], [normalizedQuery]);
                }}
              >
                <span className="affairs-document-tag-create-label">{t("shell.affairsTagQuickCreateAction", { tag: normalizedQuery })}</span>
                <span className="affairs-binding-hint">{t("shell.affairsTagQuickCreateHint")}</span>
              </button>
            ) : null}
            {matchedTags.length === 0 && !canCreateTag ? (
              <span className="affairs-binding-hint">{t("shell.affairsTagQuickAlreadyAssigned")}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function AffairsColorTag({ label, path }: { label: string; path: string }) {
  return (
    <span className="affairs-color-tag" style={buildTagColorStyle(path)}>
      {label}
    </span>
  );
}

function buildManagedTagTree(tags: AffairsTagNodeDto[]): ManagedTagTreeNode[] {
  const nodeById = new Map<string, ManagedTagTreeNode>();
  tags.forEach((tag) => {
    nodeById.set(tag.id, { tag, children: [] });
  });
  const roots: ManagedTagTreeNode[] = [];
  nodeById.forEach((node) => {
    if (node.tag.parentId) {
      const parent = nodeById.get(node.tag.parentId);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }
    roots.push(node);
  });
  const sortNodes = (items: ManagedTagTreeNode[]) => {
    items.sort((left, right) => left.tag.path.localeCompare(right.tag.path, "zh-Hans-CN"));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function flattenManagedTagTree(
  nodes: ManagedTagTreeNode[],
  depth = 0,
): Array<{ tag: AffairsTagNodeDto; depth: number }> {
  return nodes.flatMap((node) => [
    { tag: node.tag, depth },
    ...flattenManagedTagTree(node.children, depth + 1),
  ]);
}

function isSelectableParentTag(
  candidate: AffairsTagNodeDto,
  current: AffairsTagDetailWithRulesDto | null,
): boolean {
  if (!current) {
    return true;
  }
  if (candidate.id === current.id) {
    return false;
  }
  const currentPathPrefix = `${current.path}/`;
  return !candidate.path.startsWith(currentPathPrefix);
}

function isAssignableManagedTag(tag: AffairsTagNodeDto): boolean {
  if (tag.status !== "active") {
    return false;
  }
  const rootType = tag.rootType.trim().toLowerCase();
  return rootType !== "类型" && rootType !== "type" && rootType !== "时间" && rootType !== "time";
}

function normalizeTagPathInput(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/g, "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("/");
}

function compactDocumentTagPaths(paths: string[]): string[] {
  const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  const recentTimeTags = uniquePaths
    .map((path) => ({ path, days: resolveRecentTimeTagDays(path) }))
    .filter((item): item is { path: string; days: number } => item.days !== null);
  const keptRecentPath = recentTimeTags.length > 0
    ? recentTimeTags.reduce((smallest, item) => item.days < smallest.days ? item : smallest).path
    : null;
  return uniquePaths.filter((path) => {
    const days = resolveRecentTimeTagDays(path);
    return days === null || path === keptRecentPath;
  });
}

function resolveRecentTimeTagDays(path: string): number | null {
  const normalized = path.trim();
  const matched = /^时间\/最近(\d+)天$/.exec(normalized) ?? /^time\/recent-(\d+)-days$/i.exec(normalized);
  if (!matched) {
    return null;
  }
  const days = Number.parseInt(matched[1] ?? "", 10);
  return Number.isFinite(days) ? days : null;
}

function buildTagColorStyle(path: string): CSSProperties {
  const hue = hashTagPath(path) % 360;
  return {
    "--affairs-tag-hue": String(hue)
  } as CSSProperties;
}

function hashTagPath(path: string): number {
  let hash = 0;
  for (const char of path) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function AffairsStageSkeleton({ viewMode }: { viewMode: "grid" | "list" }) {
  if (viewMode === "list") {
    return (
      <div className="affairs-stage-skeleton affairs-stage-skeleton-list" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="affairs-stage-skeleton-row" />
        ))}
      </div>
    );
  }

  return (
    <div className="affairs-stage-skeleton affairs-stage-skeleton-grid" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <div key={index} className="affairs-stage-skeleton-card" />
      ))}
    </div>
  );
}

function AffairsLibraryStageToolbar({
  browseMode,
  folderBreadcrumbs,
  recentTagTasks = [],
  tagRecords,
  indexStatus,
  directoryStatus,
  selectedTagPath,
  selectedTagPaths,
  sortState,
  viewMode,
  onNavigateFolder,
  onNavigateTag,
  onResetTags,
  onOpenSettings,
  onRefresh,
  onSetSortState,
  onSetViewMode,
  refreshPending
}: {
  browseMode: "folder" | "tag";
  folderBreadcrumbs: Array<{ label: string; path: string }>;
  recentTagTasks: RecentAffairsTagTaskRecord[];
  tagRecords: TagRecord[];
  indexStatus: AffairsLibraryIndexStatusDto | null;
  directoryStatus: AffairsLibraryDocumentListDto["directoryStatus"];
  selectedTagPath: string | null;
  selectedTagPaths: string[];
  sortState: LibrarySortState;
  viewMode: "grid" | "list";
  onNavigateFolder: (path: string | null) => void;
  onNavigateTag: (path: string | null) => void;
  onResetTags: () => void;
  onOpenSettings: () => void;
  onRefresh: () => Promise<void>;
  onSetSortState: (state: LibrarySortState) => void;
  onSetViewMode: (mode: "grid" | "list") => void;
  refreshPending: boolean;
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const rightToolsRef = useRef<HTMLDivElement | null>(null);
  const measureRefs = useRef(new Map<string, HTMLSpanElement>());
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusPopoverRef = useRef<HTMLDivElement | null>(null);
  const statusCloseTimerRef = useRef<number | null>(null);
  const [availableBreadcrumbWidth, setAvailableBreadcrumbWidth] = useState(0);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [statusTechnicalExpanded, setStatusTechnicalExpanded] = useState(false);
  const rawBreadcrumbItems = useMemo(
    () => buildToolbarBreadcrumbItemsRaw(browseMode, folderBreadcrumbs, tagRecords, selectedTagPath, selectedTagPaths),
    [browseMode, folderBreadcrumbs, selectedTagPath, selectedTagPaths, tagRecords]
  );
  const breadcrumbItems = useMemo(
    () => collapseToolbarBreadcrumbItems(rawBreadcrumbItems, measureRefs.current, availableBreadcrumbWidth),
    [availableBreadcrumbWidth, rawBreadcrumbItems]
  );
  const indexStatusLabel = resolveIndexStatusLabel(indexStatus);
  const indexStatusSummaryLabel = t("shell.affairsLibraryStatusIndicatorAction", { status: indexStatusLabel });
  const indexStatusProgressLabel = resolveIndexStatusInlineProgressLabel(indexStatus);
  const indexStatusPopoverModel = useMemo(
    () => buildIndexStatusPopoverModel(indexStatus, directoryStatus ?? null),
    [directoryStatus, indexStatus]
  );

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const rightTools = rightToolsRef.current;
    if (!toolbar || !rightTools || typeof ResizeObserver === "undefined") {
      return;
    }
    const sync = () => {
      const nextWidth = Math.max(120, toolbar.clientWidth - rightTools.clientWidth - 32);
      setAvailableBreadcrumbWidth(nextWidth);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(toolbar);
    observer.observe(rightTools);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!statusPopoverOpen) {
      setStatusTechnicalExpanded(false);
    }
  }, [statusPopoverOpen]);

  useEffect(() => {
    if (!statusPopoverOpen) {
      if (statusCloseTimerRef.current !== null) {
        window.clearTimeout(statusCloseTimerRef.current);
        statusCloseTimerRef.current = null;
      }
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        !statusTriggerRef.current?.contains(event.target)
        && !statusPopoverRef.current?.contains(event.target)
      ) {
        setStatusPopoverOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setStatusPopoverOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [statusPopoverOpen]);

  useEffect(() => () => {
    if (statusCloseTimerRef.current !== null) {
      window.clearTimeout(statusCloseTimerRef.current);
    }
  }, []);

  function openStatusPopover() {
    if (statusCloseTimerRef.current !== null) {
      window.clearTimeout(statusCloseTimerRef.current);
      statusCloseTimerRef.current = null;
    }
    setStatusPopoverOpen(true);
  }

  function scheduleCloseStatusPopover() {
    if (statusCloseTimerRef.current !== null) {
      window.clearTimeout(statusCloseTimerRef.current);
    }
    statusCloseTimerRef.current = window.setTimeout(() => {
      setStatusPopoverOpen(false);
      statusCloseTimerRef.current = null;
    }, 120);
  }

  return (
    <div ref={toolbarRef} className="affairs-stage-toolbar">
      <div className="affairs-stage-toolbar-left">
        <div className="affairs-stage-breadcrumb" aria-label={t("shell.affairsLibraryBindingFieldLabel")}>
          <button
            type="button"
            className="affairs-stage-breadcrumb-button root"
            aria-label={t("shell.affairsLibraryFolderRootLabel")}
            title={t("shell.affairsLibraryFolderRootLabel")}
            onClick={() => onNavigateFolder(null)}
          >
            <AffairsBreadcrumbHomeIcon />
          </button>
          {breadcrumbItems.map((item, index) => (
            <Fragment key={item.key}>
              <span className="affairs-stage-breadcrumb-separator" aria-hidden="true">&gt;</span>
              {item.kind === "collapsed" ? (
                <span className="affairs-stage-breadcrumb-ellipsis">...</span>
              ) : (
                <button
                  type="button"
                  className={index === breadcrumbItems.length - 1 ? "affairs-stage-breadcrumb-button current" : "affairs-stage-breadcrumb-button"}
                  onClick={() => item.mode === "folder" ? onNavigateFolder(item.value) : onNavigateTag(item.value)}
                >
                  {item.label}
                </button>
              )}
            </Fragment>
          ))}
          {browseMode === "tag" && selectedTagPaths.length > 1 ? (
            <button type="button" className="affairs-stage-breadcrumb-reset" onClick={onResetTags}>
              {t("shell.affairsLibraryTagTreeReset")}
            </button>
          ) : null}
        </div>
        <div className="affairs-stage-breadcrumb-measure" aria-hidden="true">
          {rawBreadcrumbItems.map((item) => (
            <span
              key={item.key}
              ref={(node) => {
                if (node) {
                  measureRefs.current.set(item.key, node);
                } else {
                  measureRefs.current.delete(item.key);
                }
              }}
              className="affairs-stage-breadcrumb-measure-item"
            >
              &gt; {item.label}
            </span>
          ))}
        </div>
      </div>
      <div ref={rightToolsRef} className="affairs-stage-toolbar-right">
        <div className="affairs-stage-toolbar-group">
          <button
            type="button"
            className={viewMode === "grid" ? "affairs-stage-toolbar-icon active" : "affairs-stage-toolbar-icon"}
            onClick={() => onSetViewMode("grid")}
            aria-label={t("shell.affairsLibraryViewModeGrid")}
            title={t("shell.affairsLibraryViewModeGrid")}
          >
            <GridViewIcon />
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "affairs-stage-toolbar-icon active" : "affairs-stage-toolbar-icon"}
            onClick={() => onSetViewMode("list")}
            aria-label={t("shell.affairsLibraryViewModeList")}
            title={t("shell.affairsLibraryViewModeList")}
          >
            <ListViewIcon />
          </button>
        </div>
        <div className="affairs-stage-toolbar-group">
          <select
            className="affairs-stage-toolbar-select"
            value={sortState.mode}
            onChange={(event) => onSetSortState(getDefaultSortState(event.target.value as LibrarySortMode))}
            aria-label={t("shell.affairsLibrarySortLabel")}
            title={t("shell.affairsLibrarySortLabel")}
          >
            <option value="recent">{t("shell.affairsLibrarySortRecent")}</option>
            <option value="name">{t("shell.affairsLibrarySortName")}</option>
            <option value="type">{t("shell.affairsLibrarySortType")}</option>
            <option value="size">{t("shell.affairsLibrarySortSize")}</option>
            <option value="createdAt">{t("shell.affairsLibrarySortCreatedAt")}</option>
          </select>
        </div>
        <div className="affairs-stage-toolbar-group">
          <button
            type="button"
            className="affairs-stage-toolbar-icon"
            disabled={refreshPending}
            aria-label={t("shell.affairsLibraryRefreshAction")}
            title={t("shell.affairsLibraryRefreshAction")}
            onClick={() => {
              void onRefresh();
            }}
          >
            <RefreshLibraryIcon />
          </button>
        </div>
        {recentTagTasks.length > 0 ? (
          <div className="affairs-stage-toolbar-group">
            <AffairsTagTaskHistoryButton tasks={recentTagTasks} />
          </div>
        ) : null}
        <div className="affairs-stage-toolbar-group">
          <button
            ref={statusTriggerRef}
            type="button"
            className="affairs-stage-status-trigger"
            aria-label={indexStatusSummaryLabel}
            title={indexStatusSummaryLabel}
            aria-haspopup="dialog"
            aria-expanded={statusPopoverOpen}
            onClick={() => setStatusPopoverOpen((current) => !current)}
            onMouseEnter={openStatusPopover}
            onMouseLeave={scheduleCloseStatusPopover}
            onFocus={openStatusPopover}
            onBlur={scheduleCloseStatusPopover}
          >
            <span className={`affairs-stage-status-dot state-${indexStatus?.state ?? "stale"}`} />
            {indexStatusProgressLabel ? (
              <span className="affairs-stage-status-text">{indexStatusProgressLabel}</span>
            ) : null}
          </button>
          <ButlerAnchoredPopover
            open={statusPopoverOpen && statusTriggerRef.current !== null}
            className="affairs-index-status-popover"
            anchorRef={statusTriggerRef}
            popoverRef={statusPopoverRef}
            role="dialog"
            labelledBy="affairs-index-status-popover-title"
            maxWidth={420}
            gap={8}
          >
            <div
              className="affairs-index-status-popover-card"
              onMouseEnter={openStatusPopover}
              onMouseLeave={scheduleCloseStatusPopover}
            >
              <div className="affairs-index-status-popover-header">
                <strong id="affairs-index-status-popover-title">{t("shell.affairsLibraryStatusPopoverTitle")}</strong>
              </div>
              {indexStatusPopoverModel.summaryMetrics.length > 0 ? (
                <div className="affairs-index-status-summary">
                  {indexStatusPopoverModel.summaryMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="affairs-index-status-summary-item"
                      data-tone={metric.tone ?? "default"}
                    >
                      <span className="affairs-index-status-summary-label">{metric.label}</span>
                      <strong className="affairs-index-status-summary-value">{metric.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="affairs-index-status-primary">
                <div className="affairs-index-status-section-title">{t("shell.affairsLibraryStatusPrimaryTitle")}</div>
                <div className="affairs-index-status-popover-grid">
                  {indexStatusPopoverModel.primaryRows.map((item) => (
                    <div key={item.label} className="affairs-index-status-popover-row">
                      <span className="affairs-index-status-popover-label">{item.label}</span>
                      <span className="affairs-index-status-popover-value" data-multiline={item.multiline ? "true" : undefined}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {indexStatusPopoverModel.technicalSections.length > 0 ? (
                <div className="affairs-index-status-technical">
                  <button
                    type="button"
                    className="secondary-button affairs-index-status-technical-toggle"
                    aria-expanded={statusTechnicalExpanded}
                    onClick={() => setStatusTechnicalExpanded((current) => !current)}
                  >
                    {t("shell.affairsLibraryStatusTechnicalToggle")}
                  </button>
                  {statusTechnicalExpanded ? (
                    <div className="affairs-index-status-section-list">
                      {indexStatusPopoverModel.technicalSections.map((section) => (
                        <section key={section.title} className="affairs-index-status-section">
                          <div className="affairs-index-status-section-title">{section.title}</div>
                          <div className="affairs-index-status-popover-grid">
                            {section.rows.map((item) => (
                              <div key={item.label} className="affairs-index-status-popover-row">
                                <span className="affairs-index-status-popover-label">{item.label}</span>
                                <span className="affairs-index-status-popover-value" data-multiline={item.multiline ? "true" : undefined}>
                                  {item.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </ButlerAnchoredPopover>
        </div>
        <div className="affairs-stage-toolbar-group">
          <button
            type="button"
            className="affairs-stage-toolbar-icon"
            aria-label={t("shell.affairsLibrarySettingsAction")}
            title={t("shell.affairsLibrarySettingsAction")}
            onClick={onOpenSettings}
          >
            <AffairsSettingsIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function AffairsTagDetailPanel({ detail }: { detail: TagDetailState }) {
  const { selectedManagedTag, openTagManagement } = useAffairsWorkbenchInternal();
  if (!detail) {
    return <div className="affairs-detail-empty-state">{resolveLibraryDetailEmptyText(null)}</div>;
  }
  return (
    <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
      <div className="affairs-detail-headline">
        <div>
          <h2>{detail.title}</h2>
          <p>{t("shell.affairsLibraryTagDetailDescription")}</p>
        </div>
        <span className="affairs-inline-pill">{t("shell.affairsLibraryTagDetailTitle")}</span>
      </div>
      <dl className="affairs-detail-meta-list">
        <div>
          <dt>{t("shell.affairsLibraryCurrentTag")}</dt>
          <dd>{detail.path}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryTagRootType")}</dt>
          <dd>{detail.rootType}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryTagDocumentCount")}</dt>
          <dd>{detail.documentCount}</dd>
        </div>
        <div>
          <dt>{t("shell.affairsLibraryNestedTagDocumentCount")}</dt>
          <dd>{detail.nestedDocumentCount}</dd>
        </div>
      </dl>
      <div className="affairs-detail-tag-editor">
        <strong>{t("shell.affairsTagManagerSectionTitle")}</strong>
        <div className="affairs-library-settings-inline-actions">
          <span className="affairs-binding-hint">{selectedManagedTag?.path ?? t("shell.affairsTagDetailManageHint")}</span>
          <button type="button" className="secondary-button" onClick={openTagManagement}>
            {t("shell.affairsTagManagerAction")}
          </button>
        </div>
      </div>
    </section>
  );
}

function AffairsTagTaskHistoryButton({ tasks }: { tasks: RecentAffairsTagTaskRecord[] }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const primaryTask = useMemo(
    () => tasks.find((item) => !item.snapshot || !isTerminalAffairsTaskStatus(item.snapshot.status)) ?? tasks[0] ?? null,
    [tasks],
  );
  if (!primaryTask) {
    return null;
  }
  const snapshot = primaryTask.snapshot;
  const status = snapshot?.status ?? "queued";
  const progress = snapshot?.progress ?? null;
  const normalizedPercent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? (isTerminalAffairsTaskStatus(status) ? 100 : 0))));
  const statusLabel = resolveAffairsTaskStatusLabel(status);
  const operationLabel = resolveTagTaskOperationLabel(primaryTask.operation);
  const runningCount = tasks.filter((item) => !item.snapshot || !isTerminalAffairsTaskStatus(item.snapshot.status)).length;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="affairs-folder-tag-task-trigger"
        aria-label={t("shell.affairsTagTaskHistoryButtonLabel", {
          count: tasks.length,
          operation: operationLabel,
          target: primaryTask.targetLabel,
          status: statusLabel,
          percent: normalizedPercent,
        })}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`affairs-folder-tag-task-dot state-${status}`} aria-hidden="true" />
        <span className="affairs-folder-tag-task-text">
          {t("shell.affairsTagTaskHistoryShortTitle")}
        </span>
        <span className="affairs-folder-tag-task-badge">
          {runningCount > 0 ? t("shell.affairsTagTaskHistoryRunningCount", { count: runningCount }) : status === "running" ? `${normalizedPercent}%` : statusLabel}
        </span>
      </button>
      <ButlerAnchoredPopover
        open={open && triggerRef.current !== null}
        className="affairs-folder-tag-task-popover"
        anchorRef={triggerRef}
        popoverRef={popoverRef}
        role="dialog"
        labelledBy="affairs-tag-task-popover-title"
        maxWidth={360}
        gap={8}
      >
        <div className="affairs-folder-tag-task-popover-card">
          <div className="affairs-folder-tag-task-popover-header">
            <strong id="affairs-tag-task-popover-title">{t("shell.affairsTagTaskHistoryTitle")}</strong>
            <span>{t("shell.affairsTagTaskHistoryCount", { count: tasks.length })}</span>
          </div>
          <div className="affairs-tag-task-history-list">
            {tasks.map((task) => {
              const taskSnapshot = task.snapshot;
              const taskStatus = taskSnapshot?.status ?? "queued";
              const taskProgress = taskSnapshot?.progress ?? null;
              const taskPercent = Math.max(0, Math.min(100, Math.round(taskProgress?.percent ?? (isTerminalAffairsTaskStatus(taskStatus) ? 100 : 0))));
              const taskStatusLabel = resolveAffairsTaskStatusLabel(taskStatus);
              const taskPhaseLabel = resolveAffairsTaskPhaseLabel(taskProgress?.phase ?? null);
              const taskProgressSummary = taskProgress && typeof taskProgress.current === "number" && typeof taskProgress.total === "number"
                ? t("shell.affairsFolderTagTaskProgressCount", { current: taskProgress.current, total: taskProgress.total })
                : t("shell.affairsFolderTagTaskPreparing");
              const taskOperationLabel = resolveTagTaskOperationLabel(task.operation);
              return (
                <div key={task.id} className="affairs-tag-task-history-item">
                  <div className="affairs-tag-task-history-item-header">
                    <div className="affairs-tag-task-history-item-title">
                      <span className={`affairs-folder-tag-task-dot state-${taskStatus}`} aria-hidden="true" />
                      <strong>{t("shell.affairsFolderTagTaskTitle", { operation: taskOperationLabel })}</strong>
                    </div>
                    <span className="affairs-tag-task-history-item-status">
                      {taskStatus === "running" ? `${taskPercent}%` : taskStatusLabel}
                    </span>
                  </div>
                  <div className="affairs-folder-tag-task-popover-grid">
                    <div className="affairs-folder-tag-task-popover-row">
                      <span className="affairs-folder-tag-task-popover-label">{task.targetType === "folder" ? t("shell.affairsFolderTagTaskFolderLabel") : t("shell.affairsTagTaskDocumentLabel")}</span>
                      <span className="affairs-folder-tag-task-popover-value">{task.targetLabel}</span>
                    </div>
                    <div className="affairs-folder-tag-task-popover-row">
                      <span className="affairs-folder-tag-task-popover-label">{t("shell.affairsFolderTagTaskPhaseLabel")}</span>
                      <span className="affairs-folder-tag-task-popover-value">{taskPhaseLabel}</span>
                    </div>
                    <div className="affairs-folder-tag-task-popover-row">
                      <span className="affairs-folder-tag-task-popover-label">{t("shell.affairsFolderTagTaskProgressLabel")}</span>
                      <span className="affairs-folder-tag-task-popover-value">{taskProgressSummary}</span>
                    </div>
                  </div>
                  <div className="affairs-folder-tag-task-progress-track" aria-hidden="true">
                    <span className="affairs-folder-tag-task-progress-fill" style={{ width: `${taskPercent}%` }} />
                  </div>
                  <p className="affairs-folder-tag-task-popover-detail">
                    {taskProgress?.label ?? t("shell.affairsFolderTagTaskPreparing")}
                    {taskProgress?.detail ? ` · ${taskProgress.detail}` : ""}
                  </p>
                  {taskSnapshot?.errorMessage ? (
                    <p className="affairs-folder-tag-task-popover-error">{taskSnapshot.errorMessage}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </ButlerAnchoredPopover>
    </>
  );
}

function FolderGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v8A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 9h16" />
    </svg>
  );
}

function DocumentGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M10 12h6" />
      <path d="M10 16h6" />
    </svg>
  );
}

function DocumentTextGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M7 8.5h10" />
      <path d="M7 12h10" />
      <path d="M7 15.5h6.5" />
    </svg>
  );
}

function DocumentWebGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="6.5" width="13" height="10" rx="2" />
      <path d="M5.5 9.5h13" />
      <path d="m9 12.3-1.8 1.7L9 15.7" />
      <path d="m15 12.3 1.8 1.7-1.8 1.7" />
    </svg>
  );
}

function DocumentJsonGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 8.5c-1.2 0-2 .8-2 2v1c0 .9-.4 1.5-1 1.8.6.3 1 .9 1 1.8v1c0 1.2.8 2 2 2" />
      <path d="M14 8.5c1.2 0 2 .8 2 2v1c0 .9.4 1.5 1 1.8-.6.3-1 .9-1 1.8v1c0 1.2-.8 2-2 2" />
    </svg>
  );
}

function DocumentXmlGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9.5 9.5-3 3 3 3" />
      <path d="m14.5 9.5 3 3-3 3" />
      <path d="m13 8-2 9" />
    </svg>
  );
}

function DocumentYamlGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 8.5 4 4 4-4" />
      <path d="M12 12.5v4" />
      <path d="M8.5 17h7" />
    </svg>
  );
}

function DocumentPdfGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 15.5v-7h2.4a2.2 2.2 0 1 1 0 4.4H7.5" />
      <path d="M12.5 15.5v-7h2.3a2.8 2.8 0 0 1 0 5.6h-2.3" />
      <path d="M18 8.5h-3.8v7" />
    </svg>
  );
}

function DocumentWordGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6.8 8.5 1.3 7 2.3-4.7 2.2 4.7 1.4-7" />
      <path d="M16.8 8.5h.1" />
    </svg>
  );
}

function DocumentSheetGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6.5" y="7" width="11" height="10" rx="1.8" />
      <path d="M10.2 7v10" />
      <path d="M13.9 7v10" />
      <path d="M6.5 10.3h11" />
      <path d="M6.5 13.7h11" />
    </svg>
  );
}

function DocumentSlideGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="6.5" width="13" height="9" rx="2" />
      <path d="M12 15.5v3" />
      <path d="M9 18.5h6" />
      <path d="M8.5 10h7" />
    </svg>
  );
}

function DocumentImageGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="7" width="12" height="10" rx="2" />
      <circle cx="10" cy="10.5" r="1.3" />
      <path d="m8 15 2.7-2.7a1.6 1.6 0 0 1 2.3 0L16 15" />
    </svg>
  );
}

function DocumentArchiveGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 7h4" />
      <path d="M10 10h4" />
      <path d="M10 13h4" />
      <path d="M12 7v10" />
      <rect x="8" y="6.5" width="8" height="11" rx="1.8" />
    </svg>
  );
}

function DocumentCodeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m10 8-3.5 4 3.5 4" />
      <path d="m14 8 3.5 4-3.5 4" />
    </svg>
  );
}

function DocumentDatabaseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="8" rx="4.5" ry="2.3" />
      <path d="M7.5 8v4c0 1.3 2 2.3 4.5 2.3s4.5-1 4.5-2.3V8" />
      <path d="M7.5 12v4c0 1.3 2 2.3 4.5 2.3s4.5-1 4.5-2.3v-4" />
    </svg>
  );
}

function DocumentAudioGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 16a1.8 1.8 0 1 1-3.6 0c0-1 .8-1.8 1.8-1.8H10z" />
      <path d="M10 16V7l7-1.5v8.7a1.8 1.8 0 1 1-3.6 0c0-1 .8-1.8 1.8-1.8H17" />
    </svg>
  );
}

function DocumentVideoGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="7" width="10" height="10" rx="2" />
      <path d="m16 10 3-1.5v7L16 14" />
      <path d="m10 10.5 3 1.8-3 1.7z" />
    </svg>
  );
}

function DocumentDesignGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8.5" r="2.5" />
      <circle cx="15" cy="8.5" r="2.5" />
      <circle cx="9" cy="14.5" r="2.5" />
      <path d="M15 11v6a2.5 2.5 0 0 0 0-5z" />
    </svg>
  );
}

function DocumentFontGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 17 12 7l4.5 10" />
      <path d="M9 13.5h6" />
    </svg>
  );
}

function DocumentBookGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 6.8A2.8 2.8 0 0 1 9.8 4H17v15.5H9.8A2.8 2.8 0 0 0 7 22Z" />
      <path d="M17 4v15.5" />
      <path d="M9.8 8.5H14" />
    </svg>
  );
}

function renderFolderShape(mode: "grid" | "row" = "grid") {
  return (
    <span className={mode === "row" ? "affairs-folder-shape row" : "affairs-folder-shape"}>
      <span className="affairs-folder-tab-shape" />
      <span className="affairs-folder-body-shape" />
    </span>
  );
}

function renderDocumentShape(filePath: string, mode: "grid" | "row" = "grid") {
  const visual = resolveAffairsDocumentVisual(filePath);
  return (
    <span className={mode === "row" ? `affairs-document-sheet row tone-${visual.tone}` : `affairs-document-sheet tone-${visual.tone}`}>
      <span className="affairs-document-fold" />
      <span className="affairs-document-glyph">{renderDocumentGlyphByKind(visual.kind)}</span>
      <span className="affairs-document-lines" />
      <span className="affairs-document-badge">{visual.badge}</span>
    </span>
  );
}

function renderDocumentGlyphByKind(kind: AffairsDocumentKind) {
  switch (kind) {
    case "markdown":
    case "text":
      return <DocumentTextGlyph />;
    case "web":
      return <DocumentWebGlyph />;
    case "json":
      return <DocumentJsonGlyph />;
    case "xml":
      return <DocumentXmlGlyph />;
    case "yaml":
      return <DocumentYamlGlyph />;
    case "pdf":
      return <DocumentPdfGlyph />;
    case "word":
      return <DocumentWordGlyph />;
    case "spreadsheet":
      return <DocumentSheetGlyph />;
    case "presentation":
      return <DocumentSlideGlyph />;
    case "image":
      return <DocumentImageGlyph />;
    case "archive":
      return <DocumentArchiveGlyph />;
    case "code":
      return <DocumentCodeGlyph />;
    case "database":
      return <DocumentDatabaseGlyph />;
    case "audio":
      return <DocumentAudioGlyph />;
    case "video":
      return <DocumentVideoGlyph />;
    case "design":
      return <DocumentDesignGlyph />;
    case "font":
      return <DocumentFontGlyph />;
    case "ebook":
      return <DocumentBookGlyph />;
    default:
      return <DocumentGlyph />;
  }
}

function AffairsLibrarySettingsModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { binding } = useAffairsWorkbenchInternal();
  const platform = usePlatform();

  if (!binding) {
    return null;
  }

  if (platform.isMobile) {
    return (
      <MobileSheet
        open={open}
        title={t("shell.affairsLibraryConfigTitle")}
        description={t("shell.affairsLibraryConfigDescription")}
        height="three-quarter"
        kind="form"
        onClose={onClose}
      >
        <AffairsLibraryConfigForm onCancel={onClose} onSaved={onClose} />
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={t("shell.affairsLibraryConfigTitle")}
      description={t("shell.affairsLibraryConfigDescription")}
      size="regular"
      layout="form"
      className="affairs-library-settings-modal"
      onClose={onClose}
    >
      <AffairsLibraryConfigForm onCancel={onClose} onSaved={onClose} />
    </DesktopModal>
  );
}

type TagManagementEditorMode = "create-root" | "create-child" | "edit";

type ManagedTagTreeNode = {
  tag: AffairsTagNodeDto;
  children: ManagedTagTreeNode[];
};

type EditableSmartTagRule = AffairsTagRuleDto;

function createEditableSmartTagRule(priority: number): EditableSmartTagRule {
  return {
    id: `draft-rule-${priority}-${Math.random().toString(36).slice(2, 8)}`,
    relation: "and",
    ruleType: "file_name_contains",
    matcher: { keyword: "" },
    enabled: true,
    priority,
  };
}

function cloneSmartTagRules(rules: AffairsTagRuleDto[]): EditableSmartTagRule[] {
  return rules
    .map((rule, index) => ({
      ...rule,
      matcher: { ...rule.matcher },
      priority: Number.isFinite(rule.priority) ? rule.priority : index,
    }))
    .sort((left, right) => left.priority - right.priority);
}

function normalizeSmartTagRuleMatcher(rule: EditableSmartTagRule): Record<string, unknown> {
  switch (rule.ruleType) {
    case "file_name_contains":
    case "file_content_contains":
      return {
        keyword: String((rule.matcher as { keyword?: string }).keyword ?? "").trim(),
      };
    case "file_extension_in": {
      const rawValue = Array.isArray((rule.matcher as { extensions?: string[] }).extensions)
        ? ((rule.matcher as { extensions?: string[] }).extensions ?? []).join(", ")
        : String((rule.matcher as { extensionsText?: string }).extensionsText ?? "");
      return {
        extensions: rawValue
          .split(/[，,\n]/g)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
          .map((item) => item.startsWith(".") ? item : `.${item}`),
      };
    }
    case "modified_time_between": {
      const matcher = rule.matcher as { start?: string | null; end?: string | null };
      return {
        start: matcher.start?.trim() || null,
        end: matcher.end?.trim() || null,
      };
    }
    case "document_path_in_folder":
      return {
        folderPath: String((rule.matcher as { folderPath?: string | null }).folderPath ?? "").trim() || ".",
      };
    default:
      return {};
  }
}

function buildDefaultMatcherForRuleType(ruleType: AffairsTagRuleDto["ruleType"]): Record<string, unknown> {
  switch (ruleType) {
    case "file_name_contains":
    case "file_content_contains":
      return { keyword: "" };
    case "file_extension_in":
      return { extensions: [] };
    case "modified_time_between":
      return { start: "", end: "" };
    case "document_path_in_folder":
      return { folderPath: "." };
    default:
      return {};
  }
}

function resolveSmartRuleRelationLabel(relation: AffairsTagRuleDto["relation"]): string {
  switch (relation) {
    case "and":
      return t("shell.affairsTagSmartRuleRelationAnd");
    case "or":
      return t("shell.affairsTagSmartRuleRelationOr");
    case "not":
      return t("shell.affairsTagSmartRuleRelationNot");
    default:
      return relation;
  }
}

function resolveSmartRuleTypeLabel(ruleType: AffairsTagRuleDto["ruleType"]): string {
  switch (ruleType) {
    case "file_name_contains":
      return t("shell.affairsTagSmartRuleTypeFileNameContains");
    case "file_content_contains":
      return t("shell.affairsTagSmartRuleTypeFileContentContains");
    case "file_extension_in":
      return t("shell.affairsTagSmartRuleTypeFileExtensionIn");
    case "modified_time_between":
      return t("shell.affairsTagSmartRuleTypeModifiedTimeBetween");
    case "document_path_in_folder":
      return t("shell.affairsTagSmartRuleTypeDocumentPathInFolder");
    default:
      return ruleType;
  }
}

function AffairsTagManagementModal() {
  const {
    workspaceId,
    tagManagementOpen,
    closeTagManagement,
    managedTags,
    selectedManagedTag,
    selectManagedTag,
    saveManagedTag,
    deleteManagedTag,
    requestFullTagRecompute,
    fullTagRecomputeTaskMonitor,
  } = useAffairsWorkbenchInternal();
  const platform = usePlatform();
  const { showToast } = useToast();
  const [editorMode, setEditorMode] = useState<TagManagementEditorMode>("create-root");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [smartRules, setSmartRules] = useState<EditableSmartTagRule[]>([]);
  const [recomputeSubmitting, setRecomputeSubmitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleManagedTags = useMemo(
    () => (Array.isArray(managedTags) ? managedTags : []).filter(isAssignableManagedTag),
    [managedTags],
  );
  const treeNodes = useMemo(() => buildManagedTagTree(visibleManagedTags), [visibleManagedTags]);
  const flattenedTags = useMemo(() => flattenManagedTagTree(treeNodes), [treeNodes]);
  const selectedEditableTag = selectedManagedTag && isAssignableManagedTag(selectedManagedTag) ? selectedManagedTag : null;
  const selectedTreeTag = useMemo(
    () => visibleManagedTags.find((tag) => tag.id === selectedEditableTag?.id) ?? null,
    [selectedEditableTag?.id, visibleManagedTags],
  );
  const currentEditTagId = editorMode === "edit" ? selectedEditableTag?.id ?? null : null;
  const parentOptions = useMemo(
    () => flattenedTags.filter(({ tag }) => isSelectableParentTag(tag, selectedEditableTag)),
    [flattenedTags, selectedEditableTag],
  );
  const fullRecomputeSnapshot = fullTagRecomputeTaskMonitor?.snapshot ?? null;
  const fullRecomputeStatusLabel = fullRecomputeSnapshot
    ? resolveAffairsTaskStatusLabel(fullRecomputeSnapshot.status)
    : t("shell.affairsTagRecoveryStatusIdle");
  const fullRecomputeProgress = fullRecomputeSnapshot?.progress ?? null;
  const fullRecomputePercent = Math.max(0, Math.min(100, Number(fullRecomputeProgress?.percent ?? 0)));
  const fullRecomputeProgressCount = fullRecomputeProgress?.current !== undefined && fullRecomputeProgress?.current !== null
    && fullRecomputeProgress?.total !== undefined && fullRecomputeProgress?.total !== null
    ? t("shell.affairsFolderTagTaskProgressCount", { current: fullRecomputeProgress.current, total: fullRecomputeProgress.total })
    : t("shell.affairsTagRecoveryProgressIdle");
  const fullRecomputeTaskRunning = fullRecomputeSnapshot ? !isTerminalAffairsTaskStatus(fullRecomputeSnapshot.status) : false;
  const resetEditor = (nextMode: TagManagementEditorMode, parentTag?: AffairsTagDetailWithRulesDto | AffairsTagNodeDto | null) => {
    setEditorMode(nextMode);
    setError(null);
    setName("");
    setParentId(nextMode === "create-child" ? parentTag?.id ?? "" : "");
    setSmartRules([]);
  };

  const beginCreateRoot = () => {
    resetEditor("create-root");
    void selectManagedTag(null);
  };

  const beginCreateChild = () => {
    if (!selectedEditableTag) {
      return;
    }
    resetEditor("create-child", selectedEditableTag);
  };

  const reloadEditorFromSelected = () => {
    if (!selectedEditableTag) {
      beginCreateRoot();
      return;
    }
    setEditorMode("edit");
    setName(selectedEditableTag.name);
    setParentId(selectedEditableTag.parentId ?? "");
    setSmartRules(cloneSmartTagRules(selectedEditableTag.smartRules ?? []));
    setError(null);
  };

  useEffect(() => {
    if (!tagManagementOpen) {
      return;
    }
    if (editorMode === "edit") {
      reloadEditorFromSelected();
      return;
    }
    if (editorMode === "create-child") {
      setParentId(selectedEditableTag?.id ?? parentId);
    }
  }, [editorMode, parentId, selectedEditableTag, tagManagementOpen]);

  useEffect(() => {
    if (!tagManagementOpen) {
      return;
    }
    if (selectedEditableTag) {
      setEditorMode("edit");
      return;
    }
    setEditorMode("create-root");
  }, [selectedEditableTag, tagManagementOpen]);

  const editorTitle = editorMode === "edit"
    ? t("shell.affairsTagEditorEditTitle")
    : editorMode === "create-child"
      ? t("shell.affairsTagEditorCreateChildTitle")
      : t("shell.affairsTagEditorCreateRootTitle");
  const editorDescription = editorMode === "create-child" && selectedEditableTag
    ? t("shell.affairsTagEditorCreateChildDescription", { tag: selectedEditableTag.path })
    : null;
  const currentTagDocumentCountValue = selectedTreeTag?.documentCount ?? selectedEditableTag?.documentCount ?? 0;
  const currentTagDocumentCount = selectedEditableTag
    ? t("shell.affairsTagTreeDocumentCount", { count: currentTagDocumentCountValue })
    : null;
  const saveActionLabel = editorMode === "edit"
    ? t("shell.affairsTagUpdateSubmitAction")
    : t("shell.affairsTagCreateSubmitAction");
  const showParentField = editorMode === "edit";
  const normalizedSmartRules = smartRules.map((rule, index) => ({
    ...rule,
    priority: index,
    matcher: normalizeSmartTagRuleMatcher(rule),
  }));

  const requestRecoveryRecompute = async () => {
    setRecomputeSubmitting(true);
    setError(null);
    try {
      const result = await requestFullTagRecompute();
      showToast({
        title: t("shell.affairsTagRecoveryAction"),
        description: result.deduped
          ? t("shell.affairsTagRecoveryQueuedDescription")
          : t("shell.affairsTagRecoveryStartedDescription"),
        tone: "success",
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("shell.affairsTagRecoveryFailed"));
    } finally {
      setRecomputeSubmitting(false);
    }
  };

  const content = (
    <div className="affairs-library-settings-form affairs-tag-management-shell">
      <div className="affairs-tag-management-layout">
        <ModalSection
          className="affairs-tag-management-tree-panel"
          heading={t("shell.affairsTagTreeSectionTitle")}
        >
          <div className="affairs-tag-management-toolbar">
            <button
              type="button"
              className={editorMode === "create-root" ? "secondary-button active" : "secondary-button"}
              disabled={submitting}
              onClick={beginCreateRoot}
            >
              {t("shell.affairsTagCreateRootAction")}
            </button>
            <button
              type="button"
              className={editorMode === "create-child" ? "secondary-button active" : "secondary-button"}
              disabled={submitting || !selectedEditableTag}
              onClick={beginCreateChild}
            >
              {t("shell.affairsTagCreateChildAction")}
            </button>
          </div>
          {treeNodes.length === 0 ? (
            <ModalEmptyState
              compact
              title={t("shell.affairsTagTreeEmpty")}
              description={t("shell.affairsTagTreeEmptyDescription")}
            />
          ) : (
            <div className="affairs-tag-management-tree" role="tree" aria-label={t("shell.affairsTagTreeSectionTitle")}>
              <AffairsTagManagementTreeNodes
                nodes={treeNodes}
                selectedTagId={currentEditTagId}
                onSelect={(tagId) => {
                  setEditorMode("edit");
                  setError(null);
                  void selectManagedTag(tagId);
                }}
              />
            </div>
          )}
        </ModalSection>

        <div className="affairs-tag-management-editor-column">
          <ModalSection
            className="affairs-tag-management-editor"
            heading={editorTitle}
            description={editorDescription ?? undefined}
          >
            {editorMode === "edit" && selectedEditableTag ? (
              <div className="affairs-tag-management-editor-summary">
                <div className="affairs-tag-management-editor-summary-item">
                  <span className="affairs-tag-management-editor-summary-label">{t("shell.affairsTagEditorPathLabel")}</span>
                  <strong className="affairs-tag-management-editor-summary-value">{selectedEditableTag.path}</strong>
                </div>
                <div className="affairs-tag-management-editor-summary-item">
                  <span className="affairs-tag-management-editor-summary-label">{t("shell.affairsTagEditorDocumentCountLabel")}</span>
                  <strong className="affairs-tag-management-editor-summary-value">{currentTagDocumentCount}</strong>
                </div>
              </div>
            ) : null}
            <ModalField label={t("shell.affairsTagNameLabel")}>
              <input
                className="affairs-tag-name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("shell.affairsTagNamePlaceholder")}
              />
            </ModalField>
            {showParentField ? (
              <ModalField label={t("shell.affairsTagParentLabel")}>
                <select
                  className="affairs-tag-parent-select"
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                >
                  <option value="">{t("shell.affairsTagParentRootOption")}</option>
                  {parentOptions.map(({ tag, depth }) => (
                    <option key={tag.id} value={tag.id}>
                      {`${"　".repeat(depth)}${tag.path}`}
                    </option>
                  ))}
                </select>
              </ModalField>
            ) : null}
          </ModalSection>

          <ModalSection
            className="affairs-tag-management-editor"
            heading={t("shell.affairsTagSmartRulesSectionTitle")}
          >
            {smartRules.length === 0 ? (
              <div className="affairs-tag-management-empty-note">{t("shell.affairsTagSmartRulesEmpty")}</div>
            ) : (
              <div className="affairs-tag-smart-rule-list">
                {smartRules.map((rule, index) => (
                  <div key={rule.id} className="affairs-tag-smart-rule-card">
                    <div className="affairs-tag-smart-rule-header">
                      <strong className="affairs-tag-smart-rule-title">{t("shell.affairsTagSmartRuleOrderHint", { index: index + 1 })}</strong>
                      <div className="affairs-tag-smart-rule-header-actions">
                        <label className="affairs-tag-smart-rule-toggle" data-disabled={submitting ? "true" : undefined}>
                          <span className="affairs-tag-smart-rule-toggle-switch">
                            <input
                              className="affairs-tag-smart-rule-toggle-input"
                              type="checkbox"
                              checked={rule.enabled !== false}
                              disabled={submitting}
                              onChange={(event) => {
                                const enabled = event.target.checked;
                                setSmartRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item));
                              }}
                            />
                            <span className="affairs-tag-smart-rule-toggle-track" aria-hidden="true">
                              <span className="affairs-tag-smart-rule-toggle-thumb" />
                            </span>
                          </span>
                          <span className="affairs-tag-smart-rule-toggle-label">{t("shell.affairsTagSmartRuleEnabledLabel")}</span>
                        </label>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => {
                            setSmartRules((current) => current.filter((item) => item.id !== rule.id).map((item, currentIndex) => ({ ...item, priority: currentIndex })));
                          }}
                        >
                          {t("shell.affairsTagSmartRuleRemoveAction")}
                        </button>
                      </div>
                    </div>
                    <div className="affairs-tag-smart-rule-top-row">
                      <ModalField label={t("shell.affairsTagSmartRuleRelationLabel")} className="affairs-tag-smart-rule-field">
                        <select
                          className="affairs-tag-smart-rule-relation-select"
                          value={rule.relation}
                          disabled={submitting}
                          onChange={(event) => {
                            const nextRelation = event.target.value as AffairsTagRuleDto["relation"];
                            setSmartRules((current) => current.map((item) => item.id === rule.id ? { ...item, relation: nextRelation } : item));
                          }}
                        >
                          {(["and", "or", "not"] as const).map((relation) => (
                            <option key={relation} value={relation}>{resolveSmartRuleRelationLabel(relation)}</option>
                          ))}
                        </select>
                      </ModalField>
                      <ModalField label={t("shell.affairsTagSmartRuleTypeLabel")} className="affairs-tag-smart-rule-field">
                        <select
                          className="affairs-tag-smart-rule-type-select"
                          value={rule.ruleType}
                          disabled={submitting}
                          onChange={(event) => {
                            const nextType = event.target.value as AffairsTagRuleDto["ruleType"];
                            setSmartRules((current) => current.map((item) => item.id === rule.id
                              ? { ...item, ruleType: nextType, matcher: buildDefaultMatcherForRuleType(nextType) }
                              : item));
                          }}
                        >
                          {(["file_name_contains", "file_content_contains", "file_extension_in", "modified_time_between", "document_path_in_folder"] as const).map((ruleType) => (
                            <option key={ruleType} value={ruleType}>{resolveSmartRuleTypeLabel(ruleType)}</option>
                          ))}
                        </select>
                      </ModalField>
                    </div>
                    <div className="affairs-tag-smart-rule-value-row">
                      {rule.ruleType === "file_name_contains" || rule.ruleType === "file_content_contains" ? (
                        <ModalField label={t("shell.affairsTagSmartRuleKeywordLabel")} className="affairs-tag-smart-rule-field">
                          <input
                            value={String((rule.matcher as { keyword?: string }).keyword ?? "")}
                            disabled={submitting}
                            placeholder={t("shell.affairsTagSmartRuleKeywordPlaceholder")}
                            onChange={(event) => {
                              const nextKeyword = event.target.value;
                              setSmartRules((current) => current.map((item) => item.id === rule.id
                                ? { ...item, matcher: { keyword: nextKeyword } }
                                : item));
                            }}
                          />
                        </ModalField>
                      ) : null}
                      {rule.ruleType === "file_extension_in" ? (
                        <ModalField label={t("shell.affairsTagSmartRuleExtensionsLabel")} className="affairs-tag-smart-rule-field">
                          <input
                            value={Array.isArray((rule.matcher as { extensions?: string[] }).extensions)
                              ? ((rule.matcher as { extensions?: string[] }).extensions ?? []).join(", ")
                              : ""}
                            disabled={submitting}
                            placeholder={t("shell.affairsTagSmartRuleExtensionsPlaceholder")}
                            onChange={(event) => {
                              const extensions = event.target.value
                                .split(/[，,\n]/g)
                                .map((item) => item.trim())
                                .filter(Boolean);
                              setSmartRules((current) => current.map((item) => item.id === rule.id
                                ? { ...item, matcher: { extensions } }
                                : item));
                            }}
                          />
                        </ModalField>
                      ) : null}
                      {rule.ruleType === "modified_time_between" ? (
                        <>
                          <ModalField label={t("shell.affairsTagSmartRuleModifiedStartLabel")} className="affairs-tag-smart-rule-field">
                            <input
                              type="datetime-local"
                              value={String((rule.matcher as { start?: string }).start ?? "")}
                              disabled={submitting}
                              onChange={(event) => {
                                const nextStart = event.target.value;
                                setSmartRules((current) => current.map((item) => item.id === rule.id
                                  ? { ...item, matcher: { ...(item.matcher as Record<string, unknown>), start: nextStart } }
                                  : item));
                              }}
                            />
                          </ModalField>
                          <ModalField label={t("shell.affairsTagSmartRuleModifiedEndLabel")} className="affairs-tag-smart-rule-field">
                            <input
                              type="datetime-local"
                              value={String((rule.matcher as { end?: string }).end ?? "")}
                              disabled={submitting}
                              onChange={(event) => {
                                const nextEnd = event.target.value;
                                setSmartRules((current) => current.map((item) => item.id === rule.id
                                  ? { ...item, matcher: { ...(item.matcher as Record<string, unknown>), end: nextEnd } }
                                  : item));
                              }}
                            />
                          </ModalField>
                        </>
                      ) : null}
                      {rule.ruleType === "document_path_in_folder" ? (
                        <ModalField label={t("shell.affairsTagSmartRuleFolderPathLabel")} className="affairs-tag-smart-rule-field">
                          <input
                            value={String((rule.matcher as { folderPath?: string | null }).folderPath ?? ".")}
                            disabled={submitting}
                            placeholder={t("shell.affairsTagSmartRuleFolderPathPlaceholder")}
                            onChange={(event) => {
                              const nextFolderPath = event.target.value;
                              setSmartRules((current) => current.map((item) => item.id === rule.id
                                ? { ...item, matcher: { folderPath: nextFolderPath } }
                                : item));
                            }}
                          />
                        </ModalField>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={submitting}
              onClick={() => {
                setSmartRules((current) => [...current, createEditableSmartTagRule(current.length)]);
              }}
            >
              {t("shell.affairsTagSmartRuleAddAction")}
            </button>
          </ModalSection>

          <ModalSection
            className="affairs-tag-management-editor"
            heading={t("shell.affairsTagRecoverySectionTitle")}
          >
            <div className="affairs-tag-recovery-status">
              <div className="affairs-tag-recovery-status-grid">
                <span className="affairs-tag-recovery-status-label">{t("shell.affairsTagRecoveryStatusLabel")}</span>
                <span className="affairs-tag-recovery-status-value">{fullRecomputeStatusLabel}</span>
                <span className="affairs-tag-recovery-status-label">{t("shell.affairsFolderTagTaskPhaseLabel")}</span>
                <span className="affairs-tag-recovery-status-value">
                  {fullRecomputeProgress?.label ?? t("shell.affairsTagRecoveryPhaseIdle")}
                </span>
                <span className="affairs-tag-recovery-status-label">{t("shell.affairsFolderTagTaskProgressLabel")}</span>
                <span className="affairs-tag-recovery-status-value">{fullRecomputeProgressCount}</span>
              </div>
              <div className="affairs-folder-tag-task-progress-track affairs-tag-recovery-progress-track" aria-hidden="true">
                <span className="affairs-folder-tag-task-progress-fill" style={{ width: `${fullRecomputePercent}%` }} />
              </div>
            </div>
            <div className="affairs-tag-management-batch-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={submitting || recomputeSubmitting || fullRecomputeTaskRunning}
                onClick={() => void requestRecoveryRecompute()}
              >
                {recomputeSubmitting || fullRecomputeTaskRunning ? t("shell.affairsTagRecoveryRunningAction") : t("shell.affairsTagRecoveryAction")}
              </button>
            </div>
            {fullRecomputeSnapshot?.errorMessage ? (
              <span className="affairs-binding-error">{fullRecomputeSnapshot.errorMessage}</span>
            ) : null}
          </ModalSection>

          {editorMode === "edit" && selectedEditableTag ? (
            <ModalSection
              className="affairs-tag-management-danger"
              heading={t("shell.affairsTagDangerZoneTitle")}
              description={t("shell.affairsTagDangerZoneDescription")}
            >
              <button
                type="button"
                className="secondary-button workbench-danger-button"
                disabled={submitting}
                onClick={async () => {
                  const confirmed = typeof window === "undefined"
                    ? true
                    : window.confirm(t("shell.affairsTagDeleteConfirm", { tag: selectedEditableTag.path }));
                  if (!confirmed) {
                    return;
                  }
                  setSubmitting(true);
                  setError(null);
                  try {
                    await deleteManagedTag(selectedEditableTag.id);
                    beginCreateRoot();
                    showToast({
                      title: t("shell.affairsTagDeleteSuccess"),
                      description: t("shell.affairsTagDeleteSuccessDescription"),
                      tone: "success",
                    });
                  } catch (requestError) {
                    setError(requestError instanceof Error ? requestError.message : t("shell.affairsTagDeleteFailed"));
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {t("shell.affairsTagDeleteAction")}
              </button>
            </ModalSection>
          ) : null}
        </div>
      </div>
      <ModalActions className="affairs-library-settings-actions">
        <button type="button" className="secondary-button" disabled={submitting} onClick={closeTagManagement}>
          {t("shell.affairsTagCloseAction")}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={submitting}
          onClick={() => {
            if (editorMode === "edit") {
              reloadEditorFromSelected();
              return;
            }
            if (editorMode === "create-child") {
              resetEditor("create-child", selectedEditableTag);
              return;
            }
            beginCreateRoot();
          }}
        >
          {editorMode === "edit" ? t("shell.affairsTagRevertAction") : t("shell.affairsTagResetFormAction")}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={submitting || !name.trim()}
          onClick={async () => {
            setSubmitting(true);
            setError(null);
            try {
              await saveManagedTag({
                tagId: editorMode === "edit" ? selectedEditableTag?.id : undefined,
                name: name.trim(),
                parentId: parentId || null,
                status: selectedEditableTag?.status ?? "active",
                smartRules: normalizedSmartRules,
              });
              setEditorMode("edit");
              showToast({
                title: t("shell.affairsTagSaveSuccess"),
                description: t("shell.affairsTagSaveSuccessDescription"),
                tone: "success",
              });
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : t("shell.affairsTagSaveFailed"));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? t("common.loading") : saveActionLabel}
        </button>
      </ModalActions>
      {error ? <span className="affairs-binding-error">{error}</span> : null}
    </div>
  );

  if (platform.isMobile) {
    return (
      <MobileSheet
        open={tagManagementOpen}
        title={t("shell.affairsTagManagerTitle")}
        height="three-quarter"
        kind="form"
        onClose={closeTagManagement}
      >
        {content}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={tagManagementOpen}
      title={t("shell.affairsTagManagerTitle")}
      size="wide"
      layout="form"
      className="affairs-library-settings-modal"
      onClose={closeTagManagement}
    >
      {content}
    </DesktopModal>
  );
}

function AffairsTagManagementTreeNodes({
  nodes,
  selectedTagId,
  depth = 0,
  onSelect,
}: {
  nodes: ManagedTagTreeNode[];
  selectedTagId: string | null;
  depth?: number;
  onSelect: (tagId: string) => void;
}) {
  return (
    <ul className="affairs-tag-management-tree-list">
      {nodes.map((node) => (
        <li
          key={node.tag.id}
          className="affairs-tag-management-tree-node"
          role="treeitem"
          aria-selected={selectedTagId === node.tag.id}
          data-depth={depth}
        >
          <button
            type="button"
            className={selectedTagId === node.tag.id ? "affairs-tag-management-tree-button active" : "affairs-tag-management-tree-button"}
            aria-label={node.tag.path}
            onClick={() => onSelect(node.tag.id)}
          >
            <span className="affairs-tag-management-tree-button-main">
              <span className="affairs-tag-management-tree-main">
                <span className="affairs-tag-management-tree-name">{node.tag.name}</span>
              </span>
            </span>
          </button>
          {node.children.length > 0 ? (
            <AffairsTagManagementTreeNodes
              nodes={node.children}
              selectedTagId={selectedTagId}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AffairsLibraryConfigForm({
  onCancel,
  onSaved
}: {
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { binding, libraryConfig, saveLibraryConfig, setLibraryEnabled } = useAffairsWorkbenchInternal();
  const platform = usePlatform();
  const { showToast } = useToast();
  const mirrorRootInputId = useId();
  const includedHiddenPathsInputId = useId();
  const persistedAllowedExtensions = useMemo(
    () => sortAllowedExtensions(libraryConfig?.allowedExtensions ?? []),
    [libraryConfig?.allowedExtensions]
  );
  const persistedAllowedExtensionsSignature = persistedAllowedExtensions.join("|");
  const persistedIncludedHiddenPaths = useMemo(
    () => sortIncludedHiddenPaths(libraryConfig?.includedHiddenPaths ?? []),
    [libraryConfig?.includedHiddenPaths]
  );
  const persistedIncludedHiddenPathsSignature = persistedIncludedHiddenPaths.join("|");
  const [mirrorRoot, setMirrorRoot] = useState(libraryConfig?.mirrorRoot ?? "");
  const [folderOpenBehavior, setFolderOpenBehavior] = useState<"single_click" | "double_click">(
    libraryConfig?.folderOpenBehavior === "single_click" ? "single_click" : "double_click"
  );
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>(
    () => resolveEditableAllowedExtensions(libraryConfig?.allowedExtensions ?? [])
  );
  const [includedHiddenPathsText, setIncludedHiddenPathsText] = useState(
    () => persistedIncludedHiddenPaths.join("\n")
  );
  const [manualExtension, setManualExtension] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMirrorRoot(libraryConfig?.mirrorRoot ?? "");
    setFolderOpenBehavior(libraryConfig?.folderOpenBehavior === "single_click" ? "single_click" : "double_click");
    setSelectedExtensions(resolveEditableAllowedExtensions(persistedAllowedExtensions));
    setIncludedHiddenPathsText(persistedIncludedHiddenPaths.join("\n"));
    setManualExtension("");
  }, [
    libraryConfig?.folderOpenBehavior,
    persistedAllowedExtensions,
    persistedAllowedExtensionsSignature,
    persistedIncludedHiddenPaths,
    persistedIncludedHiddenPathsSignature,
    libraryConfig?.mirrorRoot
  ]);

  if (!binding) {
    return null;
  }

  return (
    <div className="affairs-library-settings-form">
      <div className="affairs-library-config-section">
        <strong>{t("shell.affairsLibraryEnableLabel")}</strong>
        <p>{t("shell.affairsLibraryEnableHint")}</p>
        <div className="affairs-library-settings-inline-actions">
          <span className="affairs-inline-pill">{binding.enabled ? t("shell.affairsLibraryEnabledState") : t("shell.affairsLibraryDisabledState")}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await setLibraryEnabled(!binding.enabled);
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : t("shell.affairsLibraryEnableSaveFailed"));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting
              ? t("common.loading")
              : (binding.enabled ? t("shell.affairsLibraryDisableAction") : t("shell.affairsLibraryEnableAction"))}
          </button>
        </div>
      </div>
      {!binding.enabled ? (
        <div className="affairs-binding-hint">{t("shell.affairsLibraryDisabledSummary")}</div>
      ) : null}
      <ModalField
        label={t("shell.affairsLibraryMirrorRootLabel")}
        htmlFor={mirrorRootInputId}
      >
        <input
          id={mirrorRootInputId}
          value={mirrorRoot}
          onChange={(event) => setMirrorRoot(event.target.value)}
          placeholder={t("shell.affairsLibraryMirrorRootPlaceholder")}
        />
      </ModalField>
      <div className="affairs-library-settings-inline-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={submitting || !platform.isDesktop}
          onClick={async () => {
            if (!platform.isDesktop) {
              return;
            }
            const result = await getCodingNSDesktopBridge().fs.pickDirectory();
            if (!result.ok || !result.value) {
              return;
            }
            setMirrorRoot(String(result.value).trim());
          }}
        >
          {t("shell.affairsLibraryMirrorRootBrowseAction")}
        </button>
      </div>
      {!platform.isDesktop ? (
        <span className="affairs-binding-hint">{t("shell.affairsLibraryMirrorRootDesktopOnlyHint")}</span>
      ) : null}
      <div className="affairs-library-config-section">
        <div className="affairs-library-behavior-switch-row">
          <span className="affairs-library-behavior-switch-title">
            {t("shell.affairsLibraryFolderOpenBehaviorSwitchLabel")}
          </span>
          <SettingsSwitch
            checked={folderOpenBehavior === "single_click"}
            label={t("shell.affairsLibraryFolderOpenBehaviorSwitchLabel")}
            semanticRole="switch"
            onChange={(checked) => setFolderOpenBehavior(checked ? "single_click" : "double_click")}
          />
        </div>
      </div>
      <ModalField
        label={t("shell.affairsLibraryIncludedHiddenPathsLabel")}
        htmlFor={includedHiddenPathsInputId}
        description={t("shell.affairsLibraryIncludedHiddenPathsHint")}
      >
        <textarea
          id={includedHiddenPathsInputId}
          value={includedHiddenPathsText}
          onChange={(event) => setIncludedHiddenPathsText(event.target.value)}
          placeholder={t("shell.affairsLibraryIncludedHiddenPathsPlaceholder")}
          rows={4}
        />
      </ModalField>
      <ModalField
        label={t("shell.affairsLibraryAllowedExtensionsLabel")}
        description={t("shell.affairsLibraryAllowedExtensionsHint")}
      >
        <div className="affairs-extension-chip-list">
          {buildAllowedExtensionOptions(selectedExtensions).map((extension) => {
            const selected = selectedExtensions.includes(extension);
            const preset = AFFAIRS_LIBRARY_PRESET_EXTENSIONS.includes(extension as typeof AFFAIRS_LIBRARY_PRESET_EXTENSIONS[number]);
            return (
              <button
                key={extension}
                type="button"
                className={selected
                  ? (preset ? "affairs-extension-chip active" : "affairs-extension-chip active custom")
                  : (preset ? "affairs-extension-chip" : "affairs-extension-chip custom")
                }
                aria-pressed={selected}
                data-selected={selected ? "true" : "false"}
                onClick={() => {
                  setSelectedExtensions((current) => current.includes(extension)
                    ? current.filter((item) => item !== extension)
                    : sortAllowedExtensions([...current, extension]));
                }}
              >
                <span>{extension}</span>
                {!preset ? <span className="affairs-extension-chip-badge">{t("shell.affairsLibraryCustomExtensionBadge")}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="affairs-extension-manual-row">
          <input
            value={manualExtension}
            onChange={(event) => setManualExtension(event.target.value)}
            placeholder={t("shell.affairsLibraryAllowedExtensionsCustomPlaceholder")}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={submitting}
            onClick={() => {
              try {
                const extension = normalizeExtensionToken(manualExtension);
                if (!extension) {
                  throw new Error(t("shell.affairsLibraryAllowedExtensionsCustomInvalid"));
                }
                setSelectedExtensions((current) => current.includes(extension)
                  ? current
                  : sortAllowedExtensions([...current, extension]));
                setManualExtension("");
                setError(null);
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : t("shell.affairsLibraryAllowedExtensionsCustomInvalid"));
              }
            }}
          >
            {t("shell.affairsLibraryAllowedExtensionsCustomAddAction")}
          </button>
        </div>
      </ModalField>
      <ModalActions className="affairs-library-settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={submitting}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            setError(null);
            try {
              const normalizedMirrorRoot = mirrorRoot.trim() || null;
              const normalizedSelectedExtensions = sortAllowedExtensions(selectedExtensions);
              const normalizedIncludedHiddenPaths = parseIncludedHiddenPaths(includedHiddenPathsText);
              const normalizedExtensions = shouldPersistImplicitAllowedExtensions(
                persistedAllowedExtensions,
                normalizedSelectedExtensions
              )
                ? []
                : normalizedSelectedExtensions;
              const nextFolderOpenBehavior = folderOpenBehavior === "single_click" ? "single_click" : "double_click";
              const result = await saveLibraryConfig({
                mirrorRoot: normalizedMirrorRoot,
                allowedExtensions: normalizedExtensions,
                includedHiddenPaths: normalizedIncludedHiddenPaths,
                folderOpenBehavior: nextFolderOpenBehavior
              });
              const applyStatus = result?.applyConfigStatus;
              showToast({
                title: t("shell.affairsLibraryConfigSaved"),
                description: resolveLibraryConfigSaveToastDescription(applyStatus),
                tone: applyStatus?.state === "failed" ? "warning" : "success"
              });
              onSaved();
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : t("shell.affairsLibraryConfigSaveFailed"));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? t("common.loading") : t("shell.affairsLibraryConfigSaveAction")}
        </button>
      </ModalActions>
      {error ? <span className="affairs-binding-error">{error}</span> : null}
    </div>
  );
}

function resolveLibraryConfigSaveToastDescription(
  status: AffairsLibraryIndexStatusDto | undefined
): string | undefined {
  if (!status) {
    return undefined;
  }

  if (status.state === "failed") {
    return status.errorSummary?.trim() || t("shell.affairsLibraryConfigAppliedFailed");
  }

  if (status.state === "running") {
    return t("shell.affairsLibraryConfigAppliedRunning");
  }

  return t("shell.affairsLibraryConfigAppliedSuccess");
}

function resolveLocalMirrorTarget(
  mirrorRoot: string | null | undefined,
  relativePath: string
): LocalMirrorTarget {
  const root = mirrorRoot?.trim() ?? "";
  const filePath = relativePath.trim().replace(/^\/+/, "");
  if (!root || !filePath) {
    return null;
  }

  const normalizedRoot = root.replace(/\/+$/g, "");
  const absolutePath = `${normalizedRoot}/${filePath}`.replace(/\/{2,}/g, "/");
  return {
    absolutePath,
    mirrorRoot: normalizedRoot
  };
}

function buildAbsoluteLibraryPath(rootDir: string | null | undefined, relativePath: string): string | null {
  const root = rootDir?.trim().replace(/\/+$/g, "") ?? "";
  const filePath = relativePath.trim().replace(/^\/+/, "");
  if (!root || !filePath) {
    return null;
  }
  return `${root}/${filePath}`.replace(/\/{2,}/g, "/");
}

function getContextTargetRelativePath(target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>): string {
  return target.kind === "document" ? target.record.filePath : target.entry.path;
}

function getContextTargetTitle(target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>): string {
  return target.kind === "document" ? target.record.displayName : target.entry.title;
}

function resolveTargetAbsolutePath(
  rootDir: string | null | undefined,
  target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>
): string | null {
  return buildAbsoluteLibraryPath(rootDir, getContextTargetRelativePath(target));
}

function resolvePasteDestinationFolder(target: LibraryContextMenuTarget): string | null {
  if (target.kind === "blank") {
    return target.folderPath;
  }
  if (target.kind === "folder") {
    return target.entry.path;
  }
  return getParentFolderPath(target.record.filePath);
}

function buildUniqueLibraryTargetPath(
  destinationFolder: string | null,
  fileName: string,
  currentEntries: LibraryEntry[]
): string {
  const normalizedName = fileName.trim() || t("shell.affairsLibraryUntitledFileName");
  const existing = new Set(currentEntries.map((entry) => entry.path));
  const basePath = joinLibraryRelativePath(destinationFolder, normalizedName);
  if (!existing.has(basePath)) {
    return basePath;
  }

  const dotIndex = normalizedName.lastIndexOf(".");
  const name = dotIndex > 0 ? normalizedName.slice(0, dotIndex) : normalizedName;
  const extension = dotIndex > 0 ? normalizedName.slice(dotIndex) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = joinLibraryRelativePath(destinationFolder, `${name} ${index}${extension}`);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return joinLibraryRelativePath(destinationFolder, `${name} ${Date.now()}${extension}`);
}

function joinLibraryRelativePath(folderPath: string | null | undefined, fileName: string): string {
  const folder = folderPath?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const name = fileName.trim().replace(/^\/+/, "");
  return folder ? `${folder}/${name}` : name;
}

function uniqueStringList(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function buildDesktopLibraryContextMenuItems(input: {
  target: LibraryContextMenuTarget;
  bindingRootDir: string | null;
  libraryClipboard: LibraryClipboardState | null;
  onPreview: (() => void | Promise<void>) | null;
  onOpen: (() => void | Promise<void>) | null;
  onLocate: (() => void | Promise<void>) | null;
  onDownload: (() => void | Promise<void>) | null;
  onOpenWithLocalApp: (() => void | Promise<void>) | null;
  onCopyFile: (() => void | Promise<void>) | null;
  onCopyFileName: (() => void | Promise<void>) | null;
  onCopyAbsolutePath: (() => void | Promise<void>) | null;
  onCopyRelativePath: (() => void | Promise<void>) | null;
  onCut: (() => void | Promise<void>) | null;
  onPaste: (() => void | Promise<void>) | null;
  onDelete: (() => void | Promise<void>) | null;
  onCreateDirectory: (() => void | Promise<void>) | null;
  onCreateMarkdownFile: (() => void | Promise<void>) | null;
  onCreateTextFile: (() => void | Promise<void>) | null;
  onCreateCustomFile: (() => void | Promise<void>) | null;
  onRefresh: (() => void | Promise<void>) | null;
  onOpenTagAssignment: (() => void | Promise<void>) | null;
  onProperties: (() => void | Promise<void>) | null;
}): DesktopContextMenuItem[] {
  const { target } = input;
  const items: DesktopContextMenuItem[] = [];

  if (target.kind === "document" && input.onPreview) {
    items.push({
      id: `preview:${target.record.id}`,
      label: t("shell.affairsLibraryContextPreview"),
      onSelect: input.onPreview
    });
  }

  if ((target.kind === "document" || target.kind === "folder") && input.onOpen) {
    items.push({
      id: `open:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextOpen"),
      onSelect: input.onOpen
    });
  }

  if ((target.kind === "document" || target.kind === "folder") && input.onLocate) {
    items.push({
      id: `locate:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextLocate"),
      onSelect: input.onLocate
    });
  }

  if (target.kind === "document" && input.onOpenWithLocalApp) {
    items.push({
      id: `open-local-app:${target.record.id}`,
      label: t("shell.affairsLibraryOpenWithLocalAppAction"),
      onSelect: input.onOpenWithLocalApp
    });
  }

  if (target.kind === "document" && input.onDownload) {
    items.push({
      id: `download:${target.record.id}`,
      label: t("shell.affairsLibraryContextDownload"),
      onSelect: input.onDownload
    });
  }

  if (target.kind !== "blank") {
    items.push({
      id: `copy:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextCopy"),
      items: [
        {
          id: `copy-file:${target.kind}`,
          label: t("shell.affairsLibraryContextCopyFile"),
          onSelect: () => input.onCopyFile?.()
        },
        {
          id: `copy-file-name:${target.kind}`,
          label: t("shell.affairsLibraryContextCopyFileName"),
          onSelect: () => input.onCopyFileName?.()
        },
        {
          id: `copy-absolute-path:${target.kind}`,
          label: t("shell.affairsLibraryContextCopyAbsolutePath"),
          disabled: !buildAbsoluteLibraryPath(input.bindingRootDir, getContextTargetRelativePath(target)),
          onSelect: () => input.onCopyAbsolutePath?.()
        },
        {
          id: `copy-relative-path:${target.kind}`,
          label: t("shell.affairsLibraryContextCopyRelativePath"),
          onSelect: () => input.onCopyRelativePath?.()
        }
      ]
    });
  }

  if (target.kind === "blank") {
    items.push({
      id: "new:blank",
      label: t("shell.affairsLibraryContextNew"),
      items: [
        {
          id: "new-directory",
          label: t("shell.affairsLibraryContextNewDirectory"),
          onSelect: () => input.onCreateDirectory?.()
        },
        {
          id: "new-markdown",
          label: t("shell.affairsLibraryContextNewMarkdown"),
          onSelect: () => input.onCreateMarkdownFile?.()
        },
        {
          id: "new-text",
          label: t("shell.affairsLibraryContextNewText"),
          onSelect: () => input.onCreateTextFile?.()
        },
        {
          id: "new-custom",
          label: t("shell.affairsLibraryContextNewCustomFile"),
          onSelect: () => input.onCreateCustomFile?.()
        }
      ]
    });
    items.push({
      id: "refresh:blank",
      label: t("shell.affairsLibraryContextRefresh"),
      onSelect: () => input.onRefresh?.()
    });
  }

  if ((target.kind === "document" || target.kind === "folder") && input.onCut) {
    items.push({
      id: `cut:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextCut"),
      onSelect: input.onCut
    });
  }

  items.push({
    id: `paste:${target.kind === "blank" ? "blank" : getContextTargetRelativePath(target)}`,
    label: t("shell.affairsLibraryContextPaste"),
    disabled: !input.libraryClipboard,
    onSelect: () => input.onPaste?.()
  });

  if ((target.kind === "document" || target.kind === "folder") && input.onDelete) {
    items.push({
      id: `delete:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextDelete"),
      onSelect: input.onDelete
    });
  }

  if ((target.kind === "document" || target.kind === "folder") && input.onOpenTagAssignment) {
    items.push({
      id: `tags:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextTags"),
      onSelect: input.onOpenTagAssignment,
    });
  }

  if (input.onProperties) {
    items.push({
      id: target.kind === "blank"
        ? "properties:blank"
        : `properties:${target.kind}:${getContextTargetRelativePath(target)}`,
      label: t("shell.affairsLibraryContextProperties"),
      onSelect: input.onProperties
    });
  }

  return items;
}

function resolveDefaultCreateName(kind: PendingLibraryCreateKind): string {
  switch (kind) {
    case "directory":
      return t("shell.affairsLibraryCreateDirectoryDefaultName");
    case "markdown":
      return t("shell.affairsLibraryCreateMarkdownDefaultName");
    case "text":
      return t("shell.affairsLibraryCreateTextDefaultName");
    case "custom":
      return t("shell.affairsLibraryCreateCustomDefaultName");
    default:
      return t("shell.affairsLibraryUntitledFileName");
  }
}

function resolveCreateFileInitialContent(kind: Exclude<PendingLibraryCreateKind, "directory">): string {
  switch (kind) {
    case "markdown":
      return `# ${t("shell.affairsLibraryCreateMarkdownHeading")}\n`;
    case "text":
    case "custom":
    default:
      return "";
  }
}

function resolveCreateKindLabel(kind: PendingLibraryCreateKind): string {
  switch (kind) {
    case "directory":
      return t("shell.affairsLibraryContextNewDirectory");
    case "markdown":
      return t("shell.affairsLibraryContextNewMarkdown");
    case "text":
      return t("shell.affairsLibraryContextNewText");
    case "custom":
      return t("shell.affairsLibraryContextNewCustomFile");
    default:
      return t("common.unknown");
  }
}

function decodeBase64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function downloadBlob(fileName: string, blob: Blob): void {
  if (typeof document === "undefined") {
    throw new Error(t("shell.affairsLibraryDownloadFailed"));
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

async function writeTextToClipboard(
  text: string,
  platform: ReturnType<typeof usePlatform>
): Promise<void> {
  if (platform.isDesktop) {
    const desktopResult = await platform.bridge.writeClipboardText(text);
    if (desktopResult.ok) {
      return;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 会拒绝 clipboard API，继续走同步回退。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("shell.affairsLibraryCopyFailed"));
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function AffairsLibraryFileViewerModal({
  workspaceId,
  viewerState,
  onClose,
  onSaved
}: {
  workspaceId: string;
  viewerState: AffairsLibraryViewerState;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  if (!viewerState) {
    return null;
  }

  return (
    <AffairsLibraryFileViewerSurface
      workspaceId={workspaceId}
      filePath={viewerState.filePath}
      windowTitle={viewerState.title}
      chrome="modal"
      officeDisplayMode="default"
      open={true}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function AffairsLibraryInlineViewer({
  workspaceId,
  filePath,
  windowTitle,
  collapsed,
  loading,
  onToggleCollapsed
}: {
  workspaceId: string;
  filePath: string;
  windowTitle: string;
  collapsed: boolean;
  loading: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="affairs-detail-viewer-header"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("conversation.fileViewerExpand") : t("conversation.fileViewerCollapse")}
        title={collapsed ? t("conversation.fileViewerExpand") : t("conversation.fileViewerCollapse")}
      >
        <h3 className="affairs-detail-viewer-title">{t("conversation.fileViewerWindowTitle")}</h3>
        <span className="affairs-detail-viewer-toggle" aria-hidden="true">
          <CollapsePreviewIcon collapsed={collapsed} />
        </span>
      </button>
      {!collapsed ? (
        <div className="affairs-detail-viewer-body">
          {loading ? (
            <div className="affairs-stage-empty compact">{t("common.loading")}</div>
          ) : (
            <AffairsLibraryFileViewerSurface
              workspaceId={workspaceId}
              filePath={filePath}
              windowTitle={windowTitle}
              chrome="window"
              officeDisplayMode="reading"
              open={true}
              onClose={() => undefined}
              onSaved={() => undefined}
            />
          )}
        </div>
      ) : null}
    </>
  );
}

function CollapsePreviewIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      {collapsed ? (
        <>
          <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5.25 8.75 8 6l2.75 2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5.25 7.25 8 10l2.75-2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function AffairsLibraryFileViewerSurface({
  workspaceId,
  filePath,
  windowTitle,
  chrome,
  officeDisplayMode,
  open,
  onClose,
  onSaved
}: {
  workspaceId: string;
  filePath: string;
  windowTitle: string;
  chrome: "modal" | "window";
  officeDisplayMode?: "default" | "reading";
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const previewLoader = useMemo(
    () => (targetWorkspaceId: string, targetFilePath: string) =>
      getAffairsLibraryPreviewWithOptions(targetWorkspaceId, targetFilePath, {
        officeDisplayMode
      }),
    [officeDisplayMode]
  );

  return (
    <FileViewerPanel
      workspaceId={workspaceId}
      filePath={filePath}
      open={open}
      chrome={chrome === "window" ? "inline" : chrome}
      windowTitle={windowTitle}
      onClose={onClose}
      onSaved={onSaved}
      previewLoader={previewLoader}
      saveHandler={async ({ workspaceId: targetWorkspaceId, filePath: targetFilePath, content, expectedVersion }) => {
        await operateAffairsLibraryFile(targetWorkspaceId, {
          opType: "write",
          srcPath: targetFilePath,
          content,
          expectedVersion
        });
      }}
      officeDisplayMode={officeDisplayMode}
    />
  );
}

function AffairsLibraryDeleteConfirmModal({
  mobile,
  target,
  busy,
  onClose,
  onConfirm
}: {
  mobile: boolean;
  target: LibraryFileSystemTarget;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const description = t("shell.affairsLibraryDeleteConfirmDescription");
  const targetPath = getContextTargetRelativePath(target);
  const detail = target.kind === "folder"
    ? t("shell.affairsLibraryDeleteFolderConfirm", { path: targetPath })
    : t("shell.affairsLibraryDeleteDocumentConfirm", { path: targetPath });
  const footer = (
    <ModalActions>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={onClose}
      >
        {t("common.cancel")}
      </button>
      <button
        type="button"
        className="secondary-button workbench-danger-button"
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? t("shell.affairsLibraryDeleteSubmitting") : t("shell.affairsLibraryDeleteConfirmAction")}
      </button>
    </ModalActions>
  );

  if (mobile) {
    return (
      <MobileSheet
        open
        title={t("shell.affairsLibraryDeleteConfirmTitle")}
        description={description}
        height="auto"
        kind="action"
        dismissible={!busy}
        showHandle
        showCancelButton={false}
        footer={footer}
        onClose={onClose}
      >
        <p className="workbench-section-empty">{detail}</p>
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open
      title={t("shell.affairsLibraryDeleteConfirmTitle")}
      description={description}
      size="compact"
      layout="confirm"
      dismissible={!busy}
      footer={footer}
      onClose={onClose}
    >
      <p className="workbench-section-empty">{detail}</p>
    </DesktopModal>
  );
}

function UniversalAssistantBridge({
  workspaceId,
  context
}: {
  workspaceId: string;
  context: AffairsObjectContext | null;
}) {
  const {
    butlerStore: store,
    agentWorkspacePath,
    rememberConversationSession,
    reloadAgentConversationSessions
  } = useAffairsWorkbenchInternal();
  const initialized = useButlerRuntimeStore(store, (value) => value.initialized);
  const loading = useButlerRuntimeStore(store, (value) => value.loading);
  const profile = useButlerRuntimeStore(store, (value) => value.profile);
  const activeProvider = useButlerRuntimeStore(store, (value) => value.activeProvider);
  const controlSession = useButlerRuntimeStore(store, (value) => value.controlSession);
  const capabilities = useButlerRuntimeStore(store, (value) => value.capabilities);
  const messages = useButlerRuntimeStore(store, (value) => value.messages);
  const historyState = useButlerRuntimeStore(store, (value) => value.historyState);
  const loadingOlderMessages = useButlerRuntimeStore(store, (value) => value.loadingOlderMessages);
  const hasOlderMessages = useButlerRuntimeStore(store, (value) => value.hasOlderMessages);
  const runtimeHasActiveRun = useButlerRuntimeStore(store, (value) => value.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(store, (value) => value.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(store, (value) => value.contextUsage);
  const permissionRequests = useButlerRuntimeStore(store, (value) => value.permissionRequests);
  const sending = useButlerRuntimeStore(store, (value) => value.sending);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);

  const placeholder = context
    ? t("shell.affairsAssistantPlaceholder", { title: context.title ?? t("common.unknown") })
    : t("shell.affairsAssistantPlaceholderEmpty");
  const fallbackProvider = isAffairsAssistantProvider(activeProvider)
    ? activeProvider
    : (isAffairsAssistantProvider(profile?.providerId) ? profile.providerId : "codex");
  const fallbackCapabilities = useMemo(
    () => createAffairsAgentFallbackCapabilities(fallbackProvider),
    [fallbackProvider]
  );
  const hasStartedConversation = Boolean(controlSession?.session?.sessionId?.trim()) || messages.length > 0;
  const contextVisual = useMemo(
    () => resolveAffairsAssistantContextVisual(context),
    [context]
  );
  const compactDocumentContext = context?.objectType === "document";

  return (
    <section className="affairs-assistant-panel">
      {context ? (
        <section className="workbench-section-block affairs-detail-block affairs-assistant-context-block">
          <div
            className={compactDocumentContext ? "affairs-assistant-context-card compact" : "affairs-assistant-context-card"}
            data-object-type={context.objectType}
          >
            <div className="affairs-assistant-context-icon" data-tone={contextVisual.tone}>
              {contextVisual.badge ? <span>{contextVisual.badge}</span> : renderAffairsAssistantContextIcon(contextVisual.iconKind)}
            </div>
            <div className="affairs-assistant-context-copy">
              {compactDocumentContext ? (
                <h3>{context.title}</h3>
              ) : (
                <>
                  <div className="affairs-assistant-context-topline">
                    <span className="affairs-inline-pill subtle">{contextVisual.label}</span>
                  </div>
                  <h3>{context.title}</h3>
                  <p>{context.sourceRef || context.summary || t("shell.affairsAssistantContextFallback")}</p>
                  {context.summary && context.summary !== context.sourceRef ? (
                    <span className="affairs-assistant-context-summary">{context.summary}</span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      ) : !hasStartedConversation ? (
        <section className="workbench-section-block affairs-detail-block affairs-assistant-context-block">
          <div className="affairs-assistant-context-card empty" data-object-type="empty">
            <div className="affairs-assistant-context-icon" data-tone="neutral">
              <AffairsAssistantSparkIcon />
            </div>
            <div className="affairs-assistant-context-copy">
              <div className="affairs-assistant-context-topline">
                <span className="affairs-inline-pill subtle">{t("shell.affairsAssistantTitle")}</span>
              </div>
              <h3>{t("shell.affairsAssistantTitle")}</h3>
              <p>{t("shell.affairsAssistantPlaceholderEmpty")}</p>
            </div>
          </div>
        </section>
      ) : null}
      <PermissionRequestList
        requests={permissionRequests}
        replyingRequestId={replyingPermissionRequestId}
        onReply={async (requestId, payload) => {
          setReplyingPermissionRequestId(requestId);
          try {
            await store.replyPermissionRequest(requestId, payload);
          } finally {
            setReplyingPermissionRequestId(null);
          }
        }}
      />
      <div className="affairs-assistant-timeline">
        <MessageTimeline
          sessionId={controlSession?.session?.sessionId}
          items={buildConversationTimelineSourceItems({ messages })}
          historyState={historyState}
          loadingOlderMessages={loadingOlderMessages}
          hasOlderMessages={hasOlderMessages}
          provider={activeProvider}
          onLoadOlderMessages={() => {
            void store.loadOlderMessages();
          }}
          onRetryMessage={(clientRequestId) => {
            void store.retryMessage(clientRequestId);
          }}
        />
      </div>
      <div className="affairs-assistant-composer">
        <ComposerPanel
          capabilities={capabilities ?? fallbackCapabilities}
          draftStorageId={`affairs-assistant:${workspaceId}:${context?.objectId ?? "empty"}`}
          placeholder={placeholder}
          hasActiveRun={Boolean(runtimeHasActiveRun) || sending}
          canInterrupt={runtimeCanInterrupt ?? false}
          contextUsage={contextUsage}
          isSubmitting={sending || loading || !initialized}
          isRunning={Boolean(runtimeHasActiveRun) || sending}
          onInterrupt={async () => {
            await store.interrupt();
          }}
          onSend={async (content, options) => {
            if (!initialized && typeof store.initialize === "function") {
              await store.initialize();
            }
            const targetProvider = isAffairsAssistantProvider(store.getState().activeProvider)
              ? store.getState().activeProvider
              : fallbackProvider;
            if (targetProvider && store.getState().activeProvider !== targetProvider) {
              await store.switchProvider(targetProvider);
            }
            const normalizedAgentWorkspacePath = agentWorkspacePath?.trim() ?? "";
            if (normalizedAgentWorkspacePath && store.getState().profile?.workspacePath !== normalizedAgentWorkspacePath) {
              await store.updateProfile({
                workspacePath: normalizedAgentWorkspacePath
              });
            }
            await store.sendMessage(`${buildAffairsAssistantPrefix(context)}${content}`, {
              model: options?.model ?? null,
              reasoningLevel: options?.reasoningLevel ?? null,
              permissionMode: null
            });
            await reloadAgentConversationSessions();
            const nextSession = store.getState().controlSession?.session ?? null;
            if (nextSession) {
              rememberConversationSession({
                kind: "agent",
                session: nextSession,
                bootstrapMessages: []
              });
            }
          }}
        />
      </div>
    </section>
  );
}

function AffairsAssistantSparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 14 9l5.5 2-5.5 2L12 18.5 10 13 4.5 11 10 9 12 3.5Z" />
    </svg>
  );
}

function resolveAffairsAssistantContextVisual(context: AffairsObjectContext | null): {
  badge: string | null;
  iconKind: "spark" | "todo" | "automation";
  label: string;
  tone: string;
} {
  if (!context) {
    return {
      badge: null,
      iconKind: "spark",
      label: t("shell.affairsAssistantTitle"),
      tone: "neutral"
    };
  }

  if (context.objectType === "document") {
    const visual = resolveAffairsDocumentVisual(context.sourceRef ?? context.title ?? "");
    return {
      badge: visual.badge,
      iconKind: "spark",
      label: t("shell.affairsObjectTypeDocument"),
      tone: visual.tone
    };
  }

  if (context.objectType === "todo") {
    return {
      badge: null,
      iconKind: "todo",
      label: t("shell.affairsTodoNav"),
      tone: "green"
    };
  }

  if (context.objectType === "workbench") {
    return {
      badge: null,
      iconKind: "todo",
      label: t("shell.affairsWorkbenchNav"),
      tone: "blue"
    };
  }

  if (context.objectType === "automation") {
    return {
      badge: null,
      iconKind: "automation",
      label: t("shell.affairsAutomationNav"),
      tone: "purple"
    };
  }

  return {
    badge: null,
    iconKind: "spark",
    label: t("shell.affairsAssistantTitle"),
    tone: "neutral"
  };
}

function renderAffairsAssistantContextIcon(kind: "spark" | "todo" | "automation") {
  switch (kind) {
    case "todo":
      return <AffairsTodoIcon />;
    case "automation":
      return <AffairsAutomationIcon />;
    case "spark":
    default:
      return <AffairsAssistantSparkIcon />;
  }
}

function AffairsLibraryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v8A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 9h16" />
    </svg>
  );
}

function AffairsTodoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="m8.5 11 2 2 5-5" />
    </svg>
  );
}

function AffairsAutomationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

function AffairsConversationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M6.5 5h11A2.5 2.5 0 0 1 20 7.5v7A2.5 2.5 0 0 1 17.5 17H9l-4 3V7.5A2.5 2.5 0 0 1 7.5 5Z" />
      <path d="M9 10h6" />
      <path d="M9 13h4" />
    </svg>
  );
}

function AffairsWorkbenchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4" y="5" width="7" height="6" rx="1.5" />
      <rect x="13" y="5" width="7" height="10" rx="1.5" />
      <rect x="4" y="13" width="7" height="6" rx="1.5" />
      <rect x="13" y="17" width="7" height="2" rx="1" />
    </svg>
  );
}

function AffairsSidebarCollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <polyline points="11 9 14 12 11 15" />
    </svg>
  );
}

function AffairsAssistantHistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" strokeLinecap="round" />
      <path d="M4.5 5.5v4h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8.25v4.25l2.75 1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsDashboardAddTabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14" strokeLinecap="round" />
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function AffairsDashboardEditTabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m12 20 7-7-3-3-7 7-1 4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m14.5 8.5 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AffairsShortcutEditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path
        d="M9 5.75H8a3.25 3.25 0 0 0-3.25 3.25V16A3.25 3.25 0 0 0 8 19.25h8A3.25 3.25 0 0 0 19.25 16v-1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m13.2 7.55 3.25-3.25a1.6 1.6 0 0 1 2.27 2.27l-3.25 3.25-3.4.85z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AffairsDashboardRemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6 6 18" strokeLinecap="round" />
      <path d="m6 6 12 12" strokeLinecap="round" />
    </svg>
  );
}

function AffairsShortcutDoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m5 12 4.2 4.2L19 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function resolveDashboardTabTitleLabel(tabTitle: string): string {
  return tabTitle === t("shell.affairsWorkbenchDefaultTabTitle")
    ? t("shell.affairsWorkbenchDefaultTabShortTitle")
    : tabTitle;
}

function resolveDashboardWidgetHint(widget: Pick<DashboardWidgetState, "type" | "variant">): string {
  if (widget.type === "todo") {
    return t("shell.affairsWorkbenchWidgetTodoHint");
  }
  if (widget.type === "automation") {
    return t("shell.affairsWorkbenchWidgetAutomationHint");
  }
  const htmlVariant = resolveDashboardHtmlWidgetVariant(widget);
  if (htmlVariant === "app") {
    return t("shell.affairsWorkbenchWidgetHtmlAppHint");
  }
  if (htmlVariant === "stat") {
    return t("shell.affairsWorkbenchWidgetHtmlStatHint");
  }
  return t("shell.affairsWorkbenchWidgetHtmlEmbedHint");
}

function resolveDashboardWidgetBadgeLabel(
  widget: DashboardWidgetState,
  todoCount: number,
  automationCount: number
): string {
  if (widget.type === "todo") {
    return t("shell.affairsWorkbenchWidgetCountValue", { count: todoCount });
  }
  if (widget.type === "automation") {
    return t("shell.affairsWorkbenchWidgetCountValue", { count: automationCount });
  }
  return t("shell.affairsWorkbenchHtmlWidgetBadge");
}

function AffairsDashboardLockedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

function AffairsDashboardUnlockedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M15 11V8a4 4 0 0 0-7.5-2" strokeLinecap="round" />
    </svg>
  );
}

export function AffairsDashboardLockToolbarButton({ className }: { className?: string }) {
  const { activeSection } = useAffairsWorkbenchInternal();
  const { layoutLocked, toggleDashboardLayoutLocked } = useAffairsDashboardInternal();

  if (activeSection !== "workbench") {
    return null;
  }

  return (
    <button
      type="button"
      className={className ?? "workbench-nav-toolbar-button"}
      aria-label={layoutLocked ? t("shell.affairsWorkbenchUnlockLayoutAction") : t("shell.affairsWorkbenchLockLayoutAction")}
      title={layoutLocked ? t("shell.affairsWorkbenchUnlockLayoutAction") : t("shell.affairsWorkbenchLockLayoutAction")}
      aria-pressed={!layoutLocked}
      onClick={toggleDashboardLayoutLocked}
    >
      {layoutLocked ? <AffairsDashboardLockedIcon /> : <AffairsDashboardUnlockedIcon />}
    </button>
  );
}

function AffairsDashboardView({
}: {
}) {
  const {
    filteredTodoRecords,
    automationRecords,
    automationRuns,
    selectSidebarNode,
    workspaceId,
    navigationGroups,
    globalLibraryBinding
  } = useAffairsWorkbenchInternal();
  const {
    dashboardState,
    activeDashboardTab,
    layoutLocked,
    selectDashboardTab,
    addDashboardTab,
    renameDashboardTab,
    removeDashboardTab,
    addDashboardWidget,
    updateDashboardWidgetConfig,
    setDashboardWidgetLayout,
    removeDashboardWidget,
    resetActiveDashboardLayout
  } = useAffairsDashboardInternal();
  const { showToast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabTitle, setEditingTabTitle] = useState("");
  const [selectedWidgetType, setSelectedWidgetType] = useState<DashboardWidgetPaletteType>("todo");
  const [selectedHtmlVariant, setSelectedHtmlVariant] = useState<DashboardHtmlWidgetVariant>("embed");
  const currentLibraryWorkspaceOption = useMemo(
    () => resolveAffairsLibrarySourceWorkspaceOption(globalLibraryBinding, workspaceId),
    [globalLibraryBinding, workspaceId]
  );
  const htmlSourceWorkspaceOptions = useMemo(
    () => buildWorkspaceHtmlSourceWorkspaceOptions(
      navigationGroups,
      workspaceId,
      currentLibraryWorkspaceOption
    ),
    [currentLibraryWorkspaceOption, navigationGroups, workspaceId]
  );
  const defaultHtmlSourceWorkspaceId = useMemo(
    () => resolveWorkspaceHtmlSourceDefaultWorkspaceId({
      currentWorkspaceId: workspaceId,
      currentLibraryWorkspace: currentLibraryWorkspaceOption,
      options: htmlSourceWorkspaceOptions
    }),
    [currentLibraryWorkspaceOption, htmlSourceWorkspaceOptions, workspaceId]
  );
  const [htmlSourceWorkspaceId, setHtmlSourceWorkspaceId] = useState(defaultHtmlSourceWorkspaceId);
  const selectedHtmlSourceWorkspaceOption = useMemo(
    () => resolveHtmlSourceScopeOption(htmlSourceWorkspaceOptions, htmlSourceWorkspaceId),
    [htmlSourceWorkspaceId, htmlSourceWorkspaceOptions]
  );
  const [htmlEntryPath, setHtmlEntryPath] = useState("");
  const [widgetTitle, setWidgetTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeGesture, setActiveGesture] = useState<{ widgetId: string; kind: "move" | "resize" } | null>(null);
  const canvasGridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{
    kind: "move" | "resize";
    resizeMode: "x" | "y" | "xy";
    widgetId: string;
    startX: number;
    startY: number;
    startLayout: DashboardWidgetLayout;
    columnPitch: number;
    rowPitch: number;
    snapGuides: {
      x: number[];
      y: number[];
    };
  } | null>(null);

  const widgetLayoutById = useMemo(
    () => new Map((activeDashboardTab?.layout ?? []).map((layout) => [layout.widgetId, layout])),
    [activeDashboardTab]
  );
  useEffect(() => {
    if (!editorOpen) {
      setHtmlSourceWorkspaceId(defaultHtmlSourceWorkspaceId);
      setHtmlEntryPath("");
    }
  }, [defaultHtmlSourceWorkspaceId, editorOpen]);

  useEffect(() => {
    if (layoutLocked) {
      setEditingTabId(null);
      setEditingTabTitle("");
    }
  }, [layoutLocked]);

  const sortedWidgets = useMemo(() => {
    if (!activeDashboardTab) {
      return [];
    }

    return [...activeDashboardTab.widgets].sort((left, right) => {
      const leftLayout = widgetLayoutById.get(left.id);
      const rightLayout = widgetLayoutById.get(right.id);
      const leftY = leftLayout?.y ?? 0;
      const rightY = rightLayout?.y ?? 0;
      const leftX = leftLayout?.x ?? 0;
      const rightX = rightLayout?.x ?? 0;

      if (leftY !== rightY) {
        return leftY - rightY;
      }

      if (leftX !== rightX) {
        return leftX - rightX;
      }

      return activeDashboardTab.widgets.findIndex((widget) => widget.id === left.id)
        - activeDashboardTab.widgets.findIndex((widget) => widget.id === right.id);
    });
  }, [activeDashboardTab, widgetLayoutById]);

  const stopGesture = useCallback(() => {
    gestureRef.current = null;
    setActiveGesture(null);
  }, []);

  useEffect(() => {
    if (layoutLocked && editorOpen) {
      setEditorOpen(false);
    }
  }, [editorOpen, layoutLocked]);

  useEffect(() => {
    if (layoutLocked && activeGesture) {
      stopGesture();
    }
  }, [activeGesture, layoutLocked, stopGesture]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const currentGesture = gestureRef.current;
      if (!currentGesture) {
        return;
      }

      event.preventDefault();
      const deltaCols = Math.round((event.clientX - currentGesture.startX) / currentGesture.columnPitch);
      const deltaRows = Math.round((event.clientY - currentGesture.startY) / currentGesture.rowPitch);

      if (currentGesture.kind === "move") {
        const nextLayout = {
          x: Math.max(0, Math.min(DASHBOARD_GRID_COLUMNS - currentGesture.startLayout.w, currentGesture.startLayout.x + deltaCols)),
          y: Math.max(0, currentGesture.startLayout.y + deltaRows),
          w: currentGesture.startLayout.w,
          h: currentGesture.startLayout.h
        };
        const snapped = applyDashboardMoveSnap(nextLayout, currentGesture.snapGuides);
        setDashboardWidgetLayout(currentGesture.widgetId, {
          x: Math.max(0, Math.min(DASHBOARD_GRID_COLUMNS - currentGesture.startLayout.w, Math.round(snapped.x))),
          y: Math.max(0, Math.round(snapped.y))
        });
        return;
      }

      const draftLayout = {
        x: currentGesture.startLayout.x,
        y: currentGesture.startLayout.y,
        w: currentGesture.resizeMode === "x" || currentGesture.resizeMode === "xy"
          ? Math.max(
              currentGesture.startLayout.minW ?? 1,
              Math.min(DASHBOARD_GRID_COLUMNS - currentGesture.startLayout.x, currentGesture.startLayout.w + deltaCols)
            )
          : currentGesture.startLayout.w,
        h: currentGesture.resizeMode === "y" || currentGesture.resizeMode === "xy"
          ? Math.max(currentGesture.startLayout.minH ?? 1, currentGesture.startLayout.h + deltaRows)
          : currentGesture.startLayout.h
      };
      const snapped = applyDashboardResizeSnap(draftLayout, currentGesture.snapGuides, currentGesture.resizeMode);
      setDashboardWidgetLayout(currentGesture.widgetId, {
        ...(currentGesture.resizeMode === "x" || currentGesture.resizeMode === "xy"
          ? {
              w: Math.max(
                currentGesture.startLayout.minW ?? 1,
                Math.min(DASHBOARD_GRID_COLUMNS - currentGesture.startLayout.x, Math.round(snapped.w))
              )
            }
          : {}),
        ...(currentGesture.resizeMode === "y" || currentGesture.resizeMode === "xy"
          ? {
              h: Math.max(currentGesture.startLayout.minH ?? 1, Math.round(snapped.h))
            }
          : {})
      });
    }

    function handlePointerUp() {
      stopGesture();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [setDashboardWidgetLayout, stopGesture]);

  const beginWidgetGesture = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    widgetId: string,
    kind: "move" | "resize",
    resizeMode: "x" | "y" | "xy" = "xy"
  ) => {
    if (layoutLocked) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const layout = widgetLayoutById.get(widgetId);
    const container = canvasGridRef.current;
    if (!layout || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const columnWidth = (containerRect.width - DASHBOARD_GRID_GAP_PX * (DASHBOARD_GRID_COLUMNS - 1)) / DASHBOARD_GRID_COLUMNS;
    const columnPitch = columnWidth + DASHBOARD_GRID_GAP_PX;
    const rowPitch = DASHBOARD_GRID_ROW_HEIGHT_PX + DASHBOARD_GRID_GAP_PX;
    const snapGuides = buildDashboardSnapGuides(activeDashboardTab?.layout ?? [], widgetId);

    gestureRef.current = {
      kind,
      widgetId,
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layout,
      columnPitch,
      rowPitch,
      resizeMode,
      snapGuides
    };
    setActiveGesture({ widgetId, kind });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [activeDashboardTab?.layout, layoutLocked, widgetLayoutById]);

  const handleAddWidget = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    try {
      if (selectedWidgetType === "todo") {
        addDashboardWidget({
          type: "todo",
          title: widgetTitle.trim() || t("shell.affairsTodoAllFilter"),
          config: {
            filter: "all",
            view: "compact"
          }
        });
      } else if (selectedWidgetType === "automation") {
        addDashboardWidget({
          type: "automation",
          title: widgetTitle.trim() || t("shell.affairsAutomationStageTitle"),
          config: {
            scope: "all",
            view: "list"
          }
        });
      } else {
        const source = await validateHtmlSourceSelection(selectedHtmlSourceWorkspaceOption, htmlEntryPath);
        addDashboardWidget({
          type: "html",
          variant: selectedHtmlVariant,
          title: resolveWorkspaceHtmlSourceTitle(source.path, widgetTitle),
          sourceRef: {
            kind: selectedHtmlSourceWorkspaceOption?.kind === "affairs_library" ? "affairs_library_html" : "html_shortcut",
            workspaceId: selectedHtmlSourceWorkspaceOption?.workspaceId ?? workspaceId,
            sourceId: source.path,
          },
          config: {}
        });
      }
      setWidgetTitle("");
      setHtmlSourceWorkspaceId(defaultHtmlSourceWorkspaceId);
      setHtmlEntryPath("");
      setEditorOpen(false);
    } catch (error) {
      showToast({
        title: resolveErrorMessage(error, t("shell.affairsWorkbenchAddWidgetFailed")),
        tone: "error"
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    addDashboardWidget,
    htmlEntryPath,
    htmlSourceWorkspaceId,
    selectedHtmlVariant,
    selectedHtmlSourceWorkspaceOption,
    selectedWidgetType,
    showToast,
    submitting,
    widgetTitle,
    defaultHtmlSourceWorkspaceId,
    workspaceId
  ]);

  if (!activeDashboardTab) {
    return <div className="affairs-stage-empty">{t("shell.affairsWorkbenchEmpty")}</div>;
  }

  const startEditingTab = (tab: DashboardTabState) => {
    setEditingTabId(tab.id);
    setEditingTabTitle(tab.title);
  };

  const commitEditingTab = () => {
    if (!editingTabId) {
      return;
    }
    renameDashboardTab(editingTabId, editingTabTitle);
    setEditingTabId(null);
    setEditingTabTitle("");
  };

  return (
    <div className="affairs-dashboard-shell">
      <div className="affairs-dashboard-tabbar-shell">
        <div className="affairs-dashboard-tabbar" role="tablist" aria-label={t("shell.affairsWorkbenchNav")}>
          {dashboardState.tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeDashboardTab.id}
              className={tab.id === activeDashboardTab.id ? "affairs-dashboard-tab active" : "affairs-dashboard-tab"}
            >
              <button
                type="button"
                className="affairs-dashboard-tab-main"
                onClick={() => selectDashboardTab(tab.id)}
              >
                {editingTabId === tab.id ? (
                  <input
                    autoFocus
                    className="affairs-dashboard-tab-input"
                    value={editingTabTitle}
                    onChange={(event) => setEditingTabTitle(event.currentTarget.value)}
                    onBlur={commitEditingTab}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitEditingTab();
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingTabId(null);
                        setEditingTabTitle("");
                      }
                    }}
                    aria-label={t("shell.affairsWorkbenchRenameTabAction")}
                  />
                ) : (
                  <span className="affairs-dashboard-tab-title">{resolveDashboardTabTitleLabel(tab.title)}</span>
                )}
              </button>
              {!layoutLocked ? (
                <div className="affairs-dashboard-tab-actions">
                  <button
                    type="button"
                    className="affairs-dashboard-tab-action"
                    aria-label={t("shell.affairsWorkbenchRenameTabAction")}
                    title={t("shell.affairsWorkbenchRenameTabAction")}
                    onClick={(event) => {
                      event.stopPropagation();
                      startEditingTab(tab);
                    }}
                  >
                    <AffairsDashboardEditTabIcon />
                  </button>
                  <button
                    type="button"
                    className="affairs-dashboard-tab-action"
                    aria-label={t("shell.affairsWorkbenchDeleteTabAction")}
                    title={t("shell.affairsWorkbenchDeleteTabAction")}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeDashboardTab(tab.id);
                    }}
                    disabled={dashboardState.tabs.length <= 1}
                  >
                    <AffairsDashboardRemoveIcon />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {!layoutLocked ? (
            <button
              type="button"
              className="affairs-dashboard-add-tab"
              aria-label={t("shell.affairsWorkbenchAddTabAction")}
              title={t("shell.affairsWorkbenchAddTabAction")}
              onClick={addDashboardTab}
            >
              <AffairsDashboardAddTabIcon />
            </button>
          ) : null}
        </div>
        <div className="affairs-dashboard-tabbar-actions">
          <AffairsDashboardLockToolbarButton />
        </div>
      </div>

      <section className="workbench-section-block affairs-dashboard-canvas-block">
        {layoutLocked ? null : (
          <div className="affairs-dashboard-canvas-header affairs-dashboard-canvas-header-with-actions">
            <div className="affairs-dashboard-canvas-actions">
              <button
                type="button"
                className="workbench-secondary-button"
                onClick={() => {
                  setEditorOpen((current) => {
                    const nextOpen = !current;
                    if (nextOpen) {
                      setHtmlSourceWorkspaceId(defaultHtmlSourceWorkspaceId);
                      setHtmlEntryPath("");
                    }
                    return nextOpen;
                  });
                }}
              >
                {editorOpen ? t("shell.affairsWorkbenchCancelAction") : t("shell.affairsWorkbenchAddWidgetAction")}
              </button>
              <button
                type="button"
                className="workbench-secondary-button"
                onClick={resetActiveDashboardLayout}
                disabled={sortedWidgets.length === 0}
              >
                {t("shell.affairsWorkbenchResetLayoutAction")}
              </button>
            </div>
          </div>
        )}

        {!layoutLocked && editorOpen ? (
          <form className="affairs-dashboard-editor-panel" onSubmit={handleAddWidget}>
            <div className="affairs-dashboard-editor-types" role="tablist" aria-label={t("shell.affairsWorkbenchAddWidgetAction")}>
              {(["todo", "automation", "html"] as DashboardWidgetPaletteType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={type === selectedWidgetType ? "affairs-dashboard-editor-type active" : "affairs-dashboard-editor-type"}
                  onClick={() => {
                    setSelectedWidgetType(type);
                    if (type === "html") {
                      setHtmlSourceWorkspaceId(defaultHtmlSourceWorkspaceId);
                      setHtmlEntryPath("");
                    }
                  }}
                >
                  {type === "todo"
                    ? t("shell.affairsWorkbenchWidgetTypeTodo")
                    : type === "automation"
                      ? t("shell.affairsWorkbenchWidgetTypeAutomation")
                      : t("shell.affairsWorkbenchWidgetTypeHtml")}
                </button>
              ))}
            </div>
            <label className="affairs-dashboard-inline-field" htmlFor="affairs-dashboard-widget-title">
              <span>{t("shell.affairsWorkbenchWidgetTitleField")}</span>
              <input
                id="affairs-dashboard-widget-title"
                className="affairs-dashboard-inline-input"
                value={widgetTitle}
                onChange={(event) => setWidgetTitle(event.currentTarget.value)}
                placeholder={t("shell.affairsWorkbenchWidgetTitlePlaceholder")}
              />
            </label>
            {selectedWidgetType === "html" ? (
              <>
                <div className="affairs-dashboard-inline-field-group">
                  <label className="affairs-dashboard-inline-field" htmlFor="affairs-dashboard-widget-source-workspace">
                    <span>{t("shell.affairsWorkbenchHtmlSourceWorkspaceField")}</span>
                    <select
                      id="affairs-dashboard-widget-source-workspace"
                      className="affairs-dashboard-inline-select"
                      value={htmlSourceWorkspaceId}
                      onChange={(event) => {
                        setHtmlSourceWorkspaceId(event.currentTarget.value);
                        setHtmlEntryPath("");
                      }}
                    >
                      {htmlSourceWorkspaceOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <p className="affairs-dashboard-inline-help">{t("shell.affairsWorkbenchHtmlSourceWorkspaceHelper")}</p>
                  {selectedHtmlSourceWorkspaceOption?.kind === "affairs_library" ? (
                    <p className="affairs-dashboard-inline-help">
                      {t("shell.affairsWorkbenchHtmlSourceWorkspaceCurrentLibraryHelper", {
                        path: selectedHtmlSourceWorkspaceOption.rootDir
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="affairs-dashboard-inline-field-group">
                  <div className="affairs-dashboard-inline-field">
                    <span>{t("shell.affairsWorkbenchHtmlVariantField")}</span>
                    <div className="affairs-dashboard-editor-types" role="tablist" aria-label={t("shell.affairsWorkbenchHtmlVariantField")}>
                      {(["app", "stat", "embed"] as DashboardHtmlWidgetVariant[]).map((variant) => (
                        <button
                          key={variant}
                          type="button"
                          className={variant === selectedHtmlVariant ? "affairs-dashboard-editor-type active" : "affairs-dashboard-editor-type"}
                          onClick={() => setSelectedHtmlVariant(variant)}
                        >
                          {variant === "app"
                            ? t("shell.affairsWorkbenchHtmlVariantApp")
                            : variant === "stat"
                              ? t("shell.affairsWorkbenchHtmlVariantStat")
                              : t("shell.affairsWorkbenchHtmlVariantEmbed")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="affairs-dashboard-inline-help">{t("shell.affairsWorkbenchHtmlVariantHelper")}</p>
                </div>
                <WorkspaceShortcutFilePicker
                  sourceOption={selectedHtmlSourceWorkspaceOption}
                  workspaceLabel={selectedHtmlSourceWorkspaceOption?.label}
                  inputId="affairs-dashboard-widget-source"
                  value={htmlEntryPath}
                  onChange={setHtmlEntryPath}
                  mode="html"
                  label={t("shell.affairsWorkbenchHtmlSourceSelectField")}
                  placeholder={t("shell.affairsWorkbenchHtmlSourceSelectPlaceholder")}
                  helpText={t("shell.affairsWorkbenchHtmlSourceHelper")}
                  listFailedMessage={t("shell.affairsWorkbenchHtmlSourceListFailed")}
                />
              </>
            ) : null}
            <div className="affairs-dashboard-inline-actions">
              <button type="submit" className="secondary-button" disabled={submitting}>
                {submitting ? t("common.loading") : t("shell.affairsWorkbenchConfirmAddWidgetAction")}
              </button>
            </div>
          </form>
        ) : null}

        {sortedWidgets.length === 0 ? (
          <section className="workbench-empty-guide surface-card affairs-dashboard-empty-guide">
            <div className="workbench-empty-main affairs-conversation-empty-main">
              <div className="workbench-empty-copy affairs-conversation-empty-copy">
                <h2>{t("shell.affairsWorkbenchCanvasEmptyTitle")}</h2>
                <p className="workbench-empty-body">{t("shell.affairsWorkbenchCanvasEmptyBody")}</p>
              </div>
            </div>
          </section>
        ) : (
          <div ref={canvasGridRef} className="affairs-dashboard-canvas-grid">
            {sortedWidgets.map((widget) => {
              const layout = widgetLayoutById.get(widget.id);
              const itemStyle: CSSProperties = {
                gridColumnStart: (layout?.x ?? 0) + 1,
                gridColumnEnd: `span ${Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, layout?.w ?? 6))}`,
                gridRowStart: (layout?.y ?? 0) + 1,
                gridRowEnd: `span ${Math.max(1, layout?.h ?? 5)}`,
                minHeight: `${Math.max(180, (layout?.h ?? 5) * DASHBOARD_GRID_ROW_HEIGHT_PX)}px`
              };

              return (
                <AffairsDashboardWidgetCard
                  key={widget.id}
                  widget={widget}
                  style={itemStyle}
                  editable={!layoutLocked}
                  todoCount={filteredTodoRecords.length}
                  automationCount={automationRecords.length}
                  gestureKind={activeGesture?.widgetId === widget.id ? activeGesture.kind : null}
                  onMovePointerDown={(event) => beginWidgetGesture(event, widget.id, "move")}
                  onResizePointerDown={(event, resizeMode) => beginWidgetGesture(event, widget.id, "resize", resizeMode)}
                  onRemove={() => removeDashboardWidget(widget.id)}
                >
                  <AffairsDashboardWidgetHost
                    widget={widget}
                    workspaceId={workspaceId}
                    todoRecords={filteredTodoRecords}
                    automationRecords={automationRecords}
                    automationRuns={automationRuns}
                    onUpdateConfig={(patch) => updateDashboardWidgetConfig(widget.id, patch)}
                    onOpenTodo={() => selectSidebarNode("workbench:todo:all")}
                    onOpenAutomation={() => selectSidebarNode(
                      automationRecords[0]
                        ? `workbench:automation:item:${automationRecords[0].id}`
                        : "workbench:overview"
                    )}
                  />
                </AffairsDashboardWidgetCard>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AffairsDashboardWidgetCard({
  widget,
  style,
  editable,
  todoCount,
  automationCount,
  gestureKind,
  children,
  headerAction,
  onMovePointerDown,
  onResizePointerDown,
  onRemove
}: {
  widget: DashboardWidgetState;
  style: CSSProperties;
  editable: boolean;
  todoCount: number;
  automationCount: number;
  gestureKind: "move" | "resize" | null;
  children: ReactNode;
  headerAction?: ReactNode;
  onMovePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, resizeMode: "x" | "y" | "xy") => void;
  onRemove: () => void;
}) {
  const hint = resolveDashboardWidgetHint(widget);
  return (
    <section
      className={[
        "affairs-dashboard-widget",
        editable ? "editable" : "locked",
        gestureKind === "move" ? "dragging" : "",
        gestureKind === "resize" ? "resizing" : ""
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <div
        className={editable ? "affairs-dashboard-widget-header affairs-dashboard-widget-header-draggable" : "affairs-dashboard-widget-header"}
        onPointerDown={editable ? onMovePointerDown : undefined}
      >
        <div className="affairs-dashboard-widget-header-main">
          <div>
            <h3>{widget.title}</h3>
            {hint ? <p>{hint}</p> : null}
          </div>
        </div>
        <div className="affairs-dashboard-widget-header-meta">
          <span className="affairs-inline-pill">
            {resolveDashboardWidgetBadgeLabel(widget, todoCount, automationCount)}
          </span>
          {headerAction}
          {editable ? (
            <div className="affairs-dashboard-widget-toolbar">
              <button
                type="button"
              className="affairs-dashboard-toolbar-icon-button danger"
              title={t("shell.affairsWorkbenchRemoveWidgetAction")}
              aria-label={t("shell.affairsWorkbenchRemoveWidgetAction")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onRemove}
            >
                <AffairsDashboardRemoveIcon />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="affairs-dashboard-widget-body">{children}</div>
      {editable ? (
        <>
          <div
            className="affairs-dashboard-resize-edge right"
            aria-hidden="true"
            onPointerDown={(event) => onResizePointerDown(event, "x")}
          />
          <div
            className="affairs-dashboard-resize-edge bottom"
            aria-hidden="true"
            onPointerDown={(event) => onResizePointerDown(event, "y")}
          />
          <div
            className="affairs-dashboard-resize-corner"
            aria-hidden="true"
            onPointerDown={(event) => onResizePointerDown(event, "xy")}
          />
        </>
      ) : null}
    </section>
  );
}

class DashboardWidgetErrorBoundary extends Component<
  { fallbackTitle: string; children: ReactNode },
  { hasError: boolean; message: string | null }
> {
  constructor(props: { fallbackTitle: string; children: ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: null
    };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="affairs-dashboard-widget-error">
          <strong>{this.props.fallbackTitle}</strong>
          <p>{this.state.message || t("shell.affairsWorkbenchWidgetErrorBody")}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

function AffairsDashboardWidgetHost({
  widget,
  workspaceId,
  todoRecords,
  automationRecords,
  automationRuns,
  onUpdateConfig,
  onOpenTodo,
  onOpenAutomation
}: {
  widget: DashboardWidgetState;
  workspaceId: string;
  todoRecords: TodoRecord[];
  automationRecords: AutomationRecord[];
  automationRuns: AssistantAutomationRunDto[];
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onOpenTodo: () => void;
  onOpenAutomation: () => void;
}) {
  return (
    <DashboardWidgetErrorBoundary fallbackTitle={t("shell.affairsWorkbenchWidgetErrorTitle")}>
      {widget.type === "todo" ? (
        <AffairsDashboardTodoWidget widget={widget} todoRecords={todoRecords} onUpdateConfig={onUpdateConfig} onOpen={onOpenTodo} />
      ) : widget.type === "automation" ? (
        <AffairsDashboardAutomationWidget
          widget={widget}
          automationRecords={automationRecords}
          automationRuns={automationRuns}
          onUpdateConfig={onUpdateConfig}
          onOpen={onOpenAutomation}
        />
      ) : (
        <AffairsDashboardHtmlWidget widget={widget} workspaceId={workspaceId} />
      )}
    </DashboardWidgetErrorBoundary>
  );
}

function AffairsDashboardTodoWidget({
  widget,
  todoRecords,
  onUpdateConfig,
  onOpen
}: {
  widget: DashboardWidgetState;
  todoRecords: TodoRecord[];
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onOpen: () => void;
}) {
  const currentView = widget.config.view === "detail" ? "detail" : "compact";

  return (
    <>
      <div className="affairs-dashboard-widget-inline-tabs" role="tablist" aria-label={t("shell.affairsWorkbenchWidgetTodoViewLabel")}>
        <button
          type="button"
          className={currentView === "compact" ? "affairs-dashboard-widget-inline-tab active" : "affairs-dashboard-widget-inline-tab"}
          onClick={() => onUpdateConfig({ view: "compact" })}
        >
          {t("shell.affairsWorkbenchWidgetCompactView")}
        </button>
        <button
          type="button"
          className={currentView === "detail" ? "affairs-dashboard-widget-inline-tab active" : "affairs-dashboard-widget-inline-tab"}
          onClick={() => onUpdateConfig({ view: "detail" })}
        >
          {t("shell.affairsWorkbenchWidgetDetailView")}
        </button>
      </div>
      <div className="affairs-dashboard-widget-preview-list">
        {todoRecords.slice(0, currentView === "detail" ? 4 : 3).map((record) => (
          <div key={record.id} className="affairs-dashboard-widget-preview-item affairs-dashboard-widget-preview-item-stack">
            <div>
              <strong>{record.title}</strong>
              <span>{record.statusLabel}</span>
            </div>
            {currentView === "detail" ? <p>{record.summary || record.detail || record.sourceDescription}</p> : null}
          </div>
        ))}
        {todoRecords.length === 0 ? (
          <div className="affairs-stage-empty compact">{t("shell.affairsTodoEmpty")}</div>
        ) : null}
      </div>
      <button type="button" className="secondary-button" onClick={onOpen}>
        {t("shell.affairsWorkbenchWidgetOpenTodoAction")}
      </button>
    </>
  );
}

function AffairsDashboardAutomationWidget({
  widget,
  automationRecords,
  automationRuns,
  onUpdateConfig,
  onOpen
}: {
  widget: DashboardWidgetState;
  automationRecords: AutomationRecord[];
  automationRuns: AssistantAutomationRunDto[];
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onOpen: () => void;
}) {
  const currentView = widget.config.view === "recent" ? "recent" : "list";

  return (
    <>
      <div className="affairs-dashboard-widget-inline-tabs" role="tablist" aria-label={t("shell.affairsWorkbenchWidgetAutomationViewLabel")}>
        <button
          type="button"
          className={currentView === "list" ? "affairs-dashboard-widget-inline-tab active" : "affairs-dashboard-widget-inline-tab"}
          onClick={() => onUpdateConfig({ view: "list" })}
        >
          {t("shell.affairsWorkbenchWidgetAutomationListView")}
        </button>
        <button
          type="button"
          className={currentView === "recent" ? "affairs-dashboard-widget-inline-tab active" : "affairs-dashboard-widget-inline-tab"}
          onClick={() => onUpdateConfig({ view: "recent" })}
        >
          {t("shell.affairsWorkbenchWidgetAutomationRecentView")}
        </button>
      </div>
      {currentView === "recent" ? (
        <div className="affairs-dashboard-widget-preview-list">
          {automationRuns.slice(0, 3).map((record) => {
            const automation = automationRecords.find((item) => item.id === record.automationId);
            return (
              <div key={record.id} className="affairs-dashboard-widget-preview-item affairs-dashboard-widget-preview-item-stack">
                <div>
                  <strong>{automation?.title || t("shell.affairsWorkbenchWidgetAutomationRunFallbackTitle")}</strong>
                  <span>{resolveAutomationRunStatusLabel(record.status)}</span>
                </div>
                <p>{record.summary || automation?.summary || t("shell.affairsAutomationEmpty")}</p>
              </div>
            );
          })}
          {automationRuns.length === 0 ? (
            <div className="affairs-stage-empty compact">{t("shell.affairsAutomationEmpty")}</div>
          ) : null}
        </div>
      ) : (
        <div className="affairs-dashboard-widget-preview-list">
          {automationRecords.slice(0, 3).map((record) => (
            <div key={record.id} className="affairs-dashboard-widget-preview-item affairs-dashboard-widget-preview-item-stack">
              <div>
                <strong>{record.title}</strong>
                <span>{record.statusLabel}</span>
              </div>
              <p>{record.summary || record.lastRunSummary || record.triggerLabel}</p>
            </div>
          ))}
          {automationRecords.length === 0 ? (
            <div className="affairs-stage-empty compact">{t("shell.affairsAutomationEmpty")}</div>
          ) : null}
        </div>
      )}
      <button type="button" className="secondary-button" onClick={onOpen}>
        {t("shell.affairsWorkbenchWidgetOpenAutomationAction")}
      </button>
    </>
  );
}

function AffairsDashboardHtmlWidget({
  widget,
  workspaceId
}: {
  widget: DashboardWidgetState;
  workspaceId: string;
}) {
  const { showToast } = useToast();
  const platform = usePlatform();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sourcePath = widget.sourceRef?.sourceId?.trim() ?? "";
  const sourceWorkspaceId = resolveDashboardSourceWorkspaceId(widget.sourceRef, workspaceId);
  const sourceKind = widget.sourceRef?.kind ?? "html_shortcut";

  useEffect(() => {
    let cancelled = false;
    if (!sourcePath) {
      setPreviewUrl(null);
      setLoading(false);
      setError(t("shell.affairsWorkbenchHtmlSourceMissing"));
      return;
    }

    setLoading(true);
    setError(null);
    void (sourceKind === "affairs_library_html"
      ? getAffairsLibraryPreview(sourceWorkspaceId, sourcePath).then((preview) => preview.previewUrl ? {
          previewPath: preview.previewPath,
          previewUrl: preview.previewUrl
        } : Promise.reject(new Error(t("shell.affairsWorkbenchHtmlSourceLoadFailed"))))
      : getFilePreviewLink(sourceWorkspaceId, sourcePath))
      .then((previewLink) => {
        if (cancelled) {
          return;
        }
        setPreviewUrl(buildDashboardPreviewUrl(previewLink, platform.isDesktop));
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setError(resolveErrorMessage(nextError, t("shell.affairsWorkbenchHtmlSourceLoadFailed")));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [platform.isDesktop, sourceKind, sourcePath, sourceWorkspaceId]);

  const openInWindow = useCallback(() => {
    if (!previewUrl) {
      return;
    }
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }, [previewUrl]);

  if (loading) {
    return <div className="affairs-stage-empty compact">{t("common.loading")}</div>;
  }

  if (error) {
    return (
      <div className="affairs-dashboard-widget-error">
        <strong>{t("shell.affairsWorkbenchHtmlSourceLoadFailed")}</strong>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="affairs-dashboard-html-meta">
        <span>{sourcePath}</span>
        <button
          type="button"
          className="affairs-dashboard-toolbar-button"
          onClick={() => {
            if (!previewUrl) {
              showToast({ title: t("shell.affairsWorkbenchHtmlSourceLoadFailed"), tone: "error" });
              return;
            }
            openInWindow();
          }}
        >
          {t("shell.affairsWorkbenchOpenHtmlAction")}
        </button>
      </div>
      <AffairsDashboardHtmlFrame src={previewUrl} workspaceId={sourceWorkspaceId} title={widget.title} />
    </>
  );
}

function AffairsDashboardHtmlFrame({
  src,
  workspaceId,
  title
}: {
  src: string | null;
  workspaceId: string;
  title: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!src) {
      return;
    }

    const bridge = createHtmlPreviewWorkspaceBridge({
      iframe: frameRef.current,
      workspaceId
    });

    function handleMessage(event: MessageEvent) {
      void bridge.onMessage(event);
    }

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      bridge.dispose();
    };
  }, [src, workspaceId]);

  if (!src) {
    return <div className="affairs-stage-empty compact">{t("shell.affairsWorkbenchHtmlSourceMissing")}</div>;
  }

  return (
    <div className="affairs-dashboard-html-frame-shell">
      <iframe
        ref={frameRef}
        key={src}
        className="affairs-dashboard-html-frame"
        title={title}
        src={src}
        sandbox={resolveDashboardHtmlPreviewSandbox(src)}
      />
    </div>
  );
}

async function listAffairsLibrarySourceFiles(
  workspaceId: string,
  mode: "html" | "file"
): Promise<WorkspaceHtmlSourceOption[]> {
  const limit = 200;
  let offset = 0;
  const collected: WorkspaceHtmlSourceOption[] = [];

  while (offset < 1000) {
    const payload = await listAffairsLibraryDocuments(workspaceId, {
      browseMode: "folder",
      offset,
      limit
    });
    const nextItems = payload.items
      .filter((item) => mode === "file" || isWorkspaceHtmlEntryPath(item.path))
      .map((item) => ({
        path: item.path,
        title: getPathLeafName(item.path),
        updatedAt: item.updatedAt ? Date.parse(item.updatedAt) : null,
        size: item.sizeBytes ?? null
      }));
    collected.push(...nextItems);

    const pageCount = payload.items.length;
    if (pageCount < limit || offset + pageCount >= payload.total) {
      break;
    }
    offset += pageCount;
  }

  return collected;
}

function buildAffairsLibraryFileTree(
  items: AffairsLibraryDocumentRecordDto[]
): {
  rootItems: FileNodeDto[];
  treeCache: Record<string, FileNodeDto[]>;
} {
  const childMap = new Map<string, Map<string, FileNodeDto>>();
  const ensureBucket = (directoryPath: string) => {
    const current = childMap.get(directoryPath);
    if (current) {
      return current;
    }
    const next = new Map<string, FileNodeDto>();
    childMap.set(directoryPath, next);
    return next;
  };

  ensureBucket(SHORTCUT_FILE_TREE_ROOT_KEY);

  items.forEach((item) => {
    const normalizedPath = item.path.trim().replace(/\\/g, "/");
    if (!normalizedPath) {
      return;
    }
    const segments = normalizedPath.split("/").filter(Boolean);
    if (!segments.length) {
      return;
    }

    let currentPath = "";
    let parentKey = SHORTCUT_FILE_TREE_ROOT_KEY;

    segments.forEach((segment, index) => {
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      const bucket = ensureBucket(parentKey);
      if (!bucket.has(nextPath)) {
        bucket.set(nextPath, {
          path: nextPath,
          name: segment,
          kind: isFile ? "file" : "directory",
          size: isFile ? (item.sizeBytes ?? null) : null,
          updatedAt: isFile ? (item.updatedAt ?? null) : null
        });
      }
      if (!isFile) {
        ensureBucket(nextPath);
      }
      parentKey = nextPath;
      currentPath = nextPath;
    });
  });

  const sortNodes = (nodes: FileNodeDto[]) => [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "zh-Hans-CN", { sensitivity: "base" });
  });

  return {
    rootItems: sortNodes(Array.from(childMap.get(SHORTCUT_FILE_TREE_ROOT_KEY)?.values() ?? [])),
    treeCache: Object.fromEntries(
      Array.from(childMap.entries())
        .filter(([directoryPath]) => directoryPath !== SHORTCUT_FILE_TREE_ROOT_KEY)
        .map(([directoryPath, children]) => [directoryPath, sortNodes(Array.from(children.values()))])
    )
  };
}

function WorkspaceHtmlSourcePicker({
  sourceOption,
  inputId,
  value,
  onChange,
  helpText,
  mode = "html",
  label,
  placeholder,
  listFailedMessage
}: {
  sourceOption: WorkspaceHtmlSourceScopeOption | null;
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  helpText: string;
  mode?: "html" | "file";
  label?: string;
  placeholder?: string;
  listFailedMessage?: string;
}) {
  const [items, setItems] = useState<WorkspaceHtmlSourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!sourceOption) {
      setItems([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    void (sourceOption.kind === "affairs_library"
      ? listAffairsLibrarySourceFiles(sourceOption.workspaceId, mode)
      : listWorkspaceBridgeDir(sourceOption.workspaceId, "", {
          kind: "file",
          recursive: true,
          sortBy: "mtime",
          order: "desc",
          limit: 300
        }).then((payload) => payload.items
          .filter((item) => item.kind === "file" && (mode === "file" || isWorkspaceHtmlEntryPath(item.path)))
          .map((item) => ({
            path: item.path,
            title: getPathLeafName(item.path),
            updatedAt: item.mtime,
            size: item.size
          }))))
      .then((nextItems) => {
      if (cancelled) {
        return;
      }
      setItems(nextItems);
    }).catch((nextError) => {
      if (cancelled) {
        return;
      }
      setError(resolveErrorMessage(nextError, listFailedMessage ?? t("shell.affairsWorkbenchHtmlSourceListFailed")));
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [listFailedMessage, mode, sourceOption]);

  return (
    <div className="affairs-dashboard-inline-field-group">
      <label className="affairs-dashboard-inline-field" htmlFor={inputId}>
        <span>{label ?? t("shell.affairsWorkbenchHtmlSourceSelectField")}</span>
        <select
          id={inputId}
          className="affairs-dashboard-inline-select"
          value={items.some((item) => item.path === value) ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">{loading ? t("common.loading") : (placeholder ?? t("shell.affairsWorkbenchHtmlSourceSelectPlaceholder"))}</option>
          {items.map((item) => (
            <option key={item.path} value={item.path}>{item.path}</option>
          ))}
        </select>
      </label>
      <p className="affairs-dashboard-inline-help">{helpText}</p>
      {error ? <p className="affairs-dashboard-inline-error">{error}</p> : null}
    </div>
  );
}

const SHORTCUT_FILE_TREE_ROOT_KEY = "__shortcut_root__";
const SHORTCUT_FILE_TREE_ROOT_PADDING_PX = 12;
const SHORTCUT_FILE_TREE_DEPTH_STEP_PX = 18;

function WorkspaceShortcutFilePicker({
  sourceOption,
  workspaceLabel,
  inputId,
  value,
  onChange,
  mode = "file",
  helpText,
  label,
  placeholder,
  listFailedMessage
}: {
  sourceOption: WorkspaceHtmlSourceScopeOption | null;
  workspaceLabel?: string;
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  mode?: "html" | "file";
  helpText: string;
  label?: string;
  placeholder?: string;
  listFailedMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rootItems, setRootItems] = useState<FileNodeDto[]>([]);
  const [treeCache, setTreeCache] = useState<Record<string, FileNodeDto[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState(value);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setSelectedPath(value);
    }
  }, [open, value]);

  const loadDirectory = useCallback(async (directoryPath?: string) => {
    if (!sourceOption) {
      setRootItems([]);
      setTreeCache({});
      return;
    }
    const cacheKey = directoryPath ?? SHORTCUT_FILE_TREE_ROOT_KEY;
    const currentToken = requestTokenRef.current;

    setLoadingDirectories((current) => (current.includes(cacheKey) ? current : [...current, cacheKey]));
    try {
      if (sourceOption.kind === "affairs_library") {
        const response = await listAffairsLibraryFiles(sourceOption.workspaceId, {
          path: directoryPath ?? null,
          limit: 1000
        });
        if (requestTokenRef.current !== currentToken) {
          return;
        }
        const nextItems = (response.items ?? []).filter((item) => item.kind === "directory" || mode === "file" || isWorkspaceHtmlEntryPath(item.path));
        if (directoryPath) {
          setTreeCache((current) => ({
            ...current,
            [directoryPath]: nextItems
          }));
        } else {
          setRootItems(nextItems);
        }
      } else {
        const response = await getFileTree(sourceOption.workspaceId, directoryPath || undefined);
        if (requestTokenRef.current !== currentToken) {
          return;
        }
        const nextItems = (response.items ?? []).filter((item) => item.kind === "directory" || mode === "file" || isWorkspaceHtmlEntryPath(item.path));
        if (directoryPath) {
          setTreeCache((current) => ({
            ...current,
            [directoryPath]: nextItems
          }));
        } else {
          setRootItems(nextItems);
        }
      }
      setError(null);
    } catch (nextError) {
      if (requestTokenRef.current !== currentToken) {
        return;
      }
      setError(resolveErrorMessage(nextError, listFailedMessage ?? t("shell.affairsShortcutRailSourceListFailed")));
    } finally {
      if (requestTokenRef.current === currentToken) {
        setLoadingDirectories((current) => current.filter((item) => item !== cacheKey));
      }
    }
  }, [listFailedMessage, mode, sourceOption]);

  const initializeTree = useCallback(async () => {
    requestTokenRef.current += 1;
    setRootItems([]);
    setTreeCache({});
    setExpandedDirectories([]);
    setError(null);
    setSelectedPath(value);
    await loadDirectory();
  }, [loadDirectory, value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void initializeTree();
  }, [initializeTree, open]);

  useEffect(() => {
    requestTokenRef.current += 1;
    setOpen(false);
    setRootItems([]);
    setTreeCache({});
    setExpandedDirectories([]);
    setLoadingDirectories([]);
    setError(null);
    setSelectedPath(value);
  }, [sourceOption, value]);

  const toggleDirectory = useCallback(async (directoryPath: string) => {
    const nextExpanded = expandedDirectories.includes(directoryPath)
      ? expandedDirectories.filter((item) => item !== directoryPath)
      : [...expandedDirectories, directoryPath];
    setExpandedDirectories(nextExpanded);

    if (!expandedDirectories.includes(directoryPath) && !treeCache[directoryPath]) {
      await loadDirectory(directoryPath);
    }
  }, [expandedDirectories, loadDirectory, treeCache]);

  const confirmSelection = useCallback(() => {
    if (!selectedPath) {
      return;
    }
    onChange(selectedPath);
    setOpen(false);
  }, [onChange, selectedPath]);

  const renderTree = useCallback((items: FileNodeDto[], depth: number): ReactNode => (
    <>
      {items.map((item) => {
        const isDirectory = item.kind === "directory";
        const isExpanded = isDirectory && expandedDirectories.includes(item.path);
        const childItems = treeCache[item.path] ?? [];
        const isLoading = loadingDirectories.includes(item.path);
        const isSelected = selectedPath === item.path;

        return (
          <div key={`${item.kind}-${item.path}`} className="file-tree-node">
            <button
              type="button"
              className="file-tree-item"
              data-kind={item.kind}
              data-selected={isSelected ? "true" : undefined}
              aria-expanded={isDirectory ? isExpanded : undefined}
              style={{
                paddingInlineStart: `${SHORTCUT_FILE_TREE_ROOT_PADDING_PX + depth * SHORTCUT_FILE_TREE_DEPTH_STEP_PX}px`
              }}
              onClick={() => {
                if (isDirectory) {
                  void toggleDirectory(item.path);
                  return;
                }
                setSelectedPath(item.path);
              }}
            >
              <span className={`file-tree-chevron${isDirectory ? "" : " is-hidden"}`} aria-hidden="true">
                <ShortcutFileTreeChevronIcon expanded={isExpanded} />
              </span>
              {!isDirectory ? (
                <span
                  className="git-tree-file-icon"
                  data-kind={resolveFileTreeIconKind(item.name)}
                  aria-hidden="true"
                >
                  {resolveFileTreeIconLabel(item.name)}
                </span>
              ) : (
                <span className="affairs-shortcut-file-picker-folder-dot" aria-hidden="true" />
              )}
              <span className="file-tree-label">{item.name}</span>
            </button>
            {isDirectory && isExpanded ? (
              <div className="file-tree-children">
                {isLoading && !childItems.length ? (
                  <p className="file-tree-empty">{t("common.loading")}</p>
                ) : childItems.length ? (
                  renderTree(childItems, depth + 1)
                ) : (
                  <p className="file-tree-empty">{t("conversation.filePanelEmptyDirectory")}</p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  ), [expandedDirectories, loadingDirectories, selectedPath, toggleDirectory, treeCache]);

  const fieldLabel = label ?? t("shell.affairsShortcutRailSourceSelectField");
  const fieldPlaceholder = placeholder ?? t("shell.affairsShortcutRailSourceSelectPlaceholder");
  const selectedSummary = selectedPath || value || t("shell.affairsShortcutRailSourcePickerCurrentEmpty");
  const workspaceSummary = workspaceLabel || t("shell.affairsWorkbenchHtmlSourceWorkspaceCurrent");
  const loadingRoot = loadingDirectories.includes(SHORTCUT_FILE_TREE_ROOT_KEY);

  return (
    <>
      <div className="affairs-dashboard-inline-field-group">
        <label className="affairs-dashboard-inline-field" htmlFor={inputId}>
          <span>{fieldLabel}</span>
          <button
            id={inputId}
            type="button"
            className="affairs-dashboard-inline-picker-button"
            data-empty={value ? undefined : "true"}
            onClick={() => setOpen(true)}
          >
            <span className="affairs-dashboard-inline-picker-button-value">
              {value || fieldPlaceholder}
            </span>
            <span className="affairs-dashboard-inline-picker-button-icon" aria-hidden="true">
              <ShortcutPickerOpenIcon />
            </span>
          </button>
        </label>
        <p className="affairs-dashboard-inline-help">{helpText}</p>
        {error ? <p className="affairs-dashboard-inline-error">{error}</p> : null}
      </div>

      <WorkbenchModal
        open={open}
        title={t("shell.affairsShortcutRailSourcePickerTitle")}
        description={t("shell.affairsShortcutRailSourcePickerDescription")}
        size="regular"
        bodyClassName="affairs-shortcut-file-picker-modal-body"
        onClose={() => setOpen(false)}
      >
        <div className="affairs-shortcut-file-picker-modal">
          <ModalField
            label={t("shell.affairsShortcutRailSourcePickerCurrentField")}
            description={workspaceSummary}
          >
            <div className="affairs-shortcut-file-picker-selected">
              <strong>{selectedSummary}</strong>
            </div>
          </ModalField>
          <ModalSection
            heading={t("shell.affairsShortcutRailSourcePickerTreeTitle")}
            actions={error ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void initializeTree();
                }}
              >
                {t("shell.affairsShortcutRailSourcePickerRetryAction")}
              </button>
            ) : null}
          >
            <div
              className="affairs-shortcut-file-picker-tree"
              role="tree"
              aria-label={t("shell.affairsShortcutRailSourcePickerTreeTitle")}
            >
              {loadingRoot && !rootItems.length ? (
                <ModalEmptyState
                  compact
                  title={t("common.loading")}
                />
              ) : rootItems.length ? (
                renderTree(rootItems, 0)
              ) : (
                <ModalEmptyState
                  compact
                  title={t("shell.affairsShortcutRailSourcePickerTreeEmpty")}
                  description={error ?? t("shell.affairsShortcutRailSourcePickerTreeEmptyDescription")}
                  action={error ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void initializeTree();
                      }}
                    >
                      {t("shell.affairsShortcutRailSourcePickerRetryAction")}
                    </button>
                  ) : null}
                />
              )}
            </div>
          </ModalSection>
          <ModalActions>
            <button type="button" className="ghost-button" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!selectedPath}
              onClick={confirmSelection}
            >
              {t("shell.affairsShortcutRailSourcePickerConfirmAction")}
            </button>
          </ModalActions>
        </div>
      </WorkbenchModal>
    </>
  );
}

function ShortcutPickerOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 18h6" strokeLinecap="round" />
      <path d="m8 10 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShortcutFileTreeChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {expanded ? (
        <path d="M2 3.5 5 6.5l3-3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M3.5 2 6.5 5l-3 3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function AffairsBreadcrumbHomeIcon() {
  return (
    <svg
      className="affairs-stage-breadcrumb-home-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 10.5 12 4.5l7.5 6" />
      <path d="M6.75 9.75v8.75h10.5V9.75" />
      <path d="M10.25 18.5v-4.75h3.5v4.75" />
    </svg>
  );
}

function GridViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="8.5" y="1.5" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="1.5" y="8.5" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="8.5" y="8.5" width="4" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="2.5" height="2.5" rx="0.8" fill="currentColor" />
      <rect x="1.5" y="5.75" width="2.5" height="2.5" rx="0.8" fill="currentColor" />
      <rect x="1.5" y="9.5" width="2.5" height="2.5" rx="0.8" fill="currentColor" />
      <rect x="5.5" y="2.4" width="7" height="1.7" rx="0.85" fill="currentColor" />
      <rect x="5.5" y="6.15" width="7" height="1.7" rx="0.85" fill="currentColor" />
      <rect x="5.5" y="9.9" width="7" height="1.7" rx="0.85" fill="currentColor" />
    </svg>
  );
}

function RefreshLibraryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 5v5h-5" />
      <path d="M4 19v-5h5" />
      <path d="M6.8 9A7 7 0 0 1 18 6.4L20 10" />
      <path d="M17.2 15A7 7 0 0 1 6 17.6L4 14" />
    </svg>
  );
}

function ResetFilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
      <path d="M18 6l-4 4" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

function AffairsSettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.1a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2.4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.25 1 1.51h.09a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.49z" />
    </svg>
  );
}

function AffairsTagManagerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h10" />
      <path d="M4 12h16" />
      <path d="M4 17h12" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

function resolveAffairsTaskStatusLabel(status: AffairsTaskSnapshotDto["status"] | "queued"): string {
  switch (status) {
    case "running":
      return t("shell.affairsFolderTagTaskStatusRunning");
    case "succeeded":
      return t("shell.affairsFolderTagTaskStatusSucceeded");
    case "failed":
      return t("shell.affairsFolderTagTaskStatusFailed");
    case "cancelled":
      return t("shell.affairsFolderTagTaskStatusCancelled");
    case "timeout":
      return t("shell.affairsFolderTagTaskStatusTimeout");
    case "queued":
    default:
      return t("shell.affairsFolderTagTaskStatusQueued");
  }
}

function resolveAffairsTaskPhaseLabel(phase: string | null): string {
  switch (phase) {
    case "prepare":
      return t("shell.affairsFolderTagTaskPhasePrepare");
    case "recompute":
      return t("shell.affairsFolderTagTaskPhaseRecompute");
    case "write":
      return t("shell.affairsFolderTagTaskPhaseWrite");
    case "export":
      return t("shell.affairsFolderTagTaskPhaseExport");
    case "finished":
      return t("shell.affairsFolderTagTaskPhaseFinished");
    default:
      return t("shell.affairsFolderTagTaskPhasePrepare");
  }
}

function resolveFolderTagTaskOperationLabel(operation: FolderTagApplyTaskMonitorState["operation"]): string {
  switch (operation) {
    case "attach":
      return t("shell.affairsFolderTagTaskOperationAttach");
    case "remove":
      return t("shell.affairsFolderTagTaskOperationRemove");
    default:
      return t("shell.affairsFolderTagTaskOperationUpdate");
  }
}

function resolveTagTaskOperationLabel(operation: TagApplyOperation): string {
  return resolveFolderTagTaskOperationLabel(operation);
}

function resolveFolderTagTaskOperation(
  currentTagIds: string[],
  nextTagIds: string[],
): FolderTagApplyTaskMonitorState["operation"] {
  const currentSet = new Set(currentTagIds);
  const nextSet = new Set(nextTagIds);
  let added = 0;
  let removed = 0;
  nextSet.forEach((tagId) => {
    if (!currentSet.has(tagId)) {
      added += 1;
    }
  });
  currentSet.forEach((tagId) => {
    if (!nextSet.has(tagId)) {
      removed += 1;
    }
  });
  if (added > 0 && removed === 0) {
    return "attach";
  }
  if (removed > 0 && added === 0) {
    return "remove";
  }
  return "update";
}

function createOptimisticFolderTagTaskSnapshot(
  folderPath: string,
  operation: FolderTagApplyTaskMonitorState["operation"],
): AffairsTaskSnapshotDto {
  const now = Date.now();
  return {
    taskId: `pending-folder-tag-${now}`,
    taskType: "affairs.library_tag_apply_bindings",
    key: `pending:${folderPath}`,
    executionLane: "helper_process",
    status: "queued",
    source: "affairs_tag.save_folder_bindings",
    attempt: 0,
    enqueuedAt: now,
    startedAt: null,
    finishedAt: null,
    timeoutMs: null,
    progress: {
      phase: "prepare",
      label: t("shell.affairsFolderTagTaskSubmitting", {
        operation: resolveFolderTagTaskOperationLabel(operation),
      }),
      detail: t("shell.affairsFolderTagTaskSubmittingDetail"),
      current: 0,
      total: 1,
      percent: 0,
      updatedAt: now,
    },
  };
}

function resolveTagTaskOperation(
  currentTagIds: string[],
  nextTagIds: string[],
): FolderTagApplyTaskMonitorState["operation"] {
  return resolveFolderTagTaskOperation(currentTagIds, nextTagIds);
}

function createOptimisticTagTaskSnapshot(
  targetKey: string,
  operation: FolderTagApplyTaskMonitorState["operation"],
): AffairsTaskSnapshotDto {
  return createOptimisticFolderTagTaskSnapshot(targetKey, operation);
}

function createCompletedTagTaskSnapshot(
  base: AffairsTaskSnapshotDto | null,
  operation: TagApplyOperation,
): AffairsTaskSnapshotDto {
  const now = Date.now();
  const fallbackTaskId = `completed-tag-task-${now}`;
  return {
    taskId: base?.taskId ?? fallbackTaskId,
    taskType: base?.taskType ?? "affairs.library_tag_apply_bindings",
    key: base?.key ?? `completed:${fallbackTaskId}`,
    executionLane: base?.executionLane ?? "helper_process",
    source: base?.source ?? "affairs_tag.completed_local",
    attempt: base?.attempt ?? 1,
    enqueuedAt: base?.enqueuedAt ?? now,
    timeoutMs: base?.timeoutMs ?? null,
    status: "succeeded",
    startedAt: base?.startedAt ?? base?.enqueuedAt ?? now,
    finishedAt: now,
    progress: {
      phase: "finished",
      label: t("shell.affairsFolderTagTaskSubmitting", {
        operation: resolveTagTaskOperationLabel(operation),
      }),
      detail: t("shell.affairsFolderTagTaskPhaseFinished"),
      current: 1,
      total: 1,
      percent: 100,
      updatedAt: now,
    },
  };
}

function isTerminalAffairsTaskStatus(status: AffairsTaskSnapshotDto["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timeout";
}

function areAffairsTaskSnapshotsEqual(left: AffairsTaskSnapshotDto | null, right: AffairsTaskSnapshotDto | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function areAffairsTagRecoveryStatusEqual(
  left: AffairsTagRecoveryStatusDto | null,
  right: AffairsTagRecoveryStatusDto | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function useAffairsWorkbenchInternal() {
  const context = useContext(AffairsWorkbenchContext);

  if (!context) {
    throw new Error("AffairsWorkbench components must be used inside AffairsWorkbenchProvider");
  }

  return context;
}

function useAffairsDashboardInternal() {
  const context = useContext(AffairsDashboardContext);

  if (!context) {
    throw new Error("AffairsDashboard components must be used inside AffairsWorkbenchProvider");
  }

  return context;
}

function buildDocumentRecordsFromSnapshot(
  documents: AffairsLibraryDocumentRecordDto[],
  rootDir: string | null
): DocumentRecord[] {
  return [...documents]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((document) => ({
      id: document.documentId,
      title: document.title,
      displayName: resolveDocumentDisplayName(document.path),
      filePath: document.path,
      fullPath: rootDir ? `${rootDir}/${document.path}` : null,
      summary: document.summary?.trim() || t("shell.affairsAssistantContextFallback"),
      isFavorite: document.isFavorite,
      tags: document.tags,
      derivedTags: document.derivedTags,
      createdAt: document.createdAt ?? null,
      sizeBytes: typeof document.sizeBytes === "number" ? document.sizeBytes : null,
      updatedAt: document.updatedAt
    }));
}

function buildTagRecordsFromSnapshot(tags: AffairsLibraryTagNodeDto[]): TagRecord[] {
  return [...tags]
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"))
    .map((item) => ({
      id: item.path,
      label: item.name,
      path: item.path,
      rootType: item.rootType,
      parentPath: item.parentPath,
      depth: item.depth,
      count: item.documentCount
    }));
}

const HIDDEN_TAG_ROOTS = new Set(["来源", "主题", "状态"]);

function isVisibleTagRecord(tag: TagRecord): boolean {
  return isVisibleTagPath(tag.path);
}

function isVisibleTagPath(tagPath: string): boolean {
  const normalizedPath = tagPath.trim();
  if (!normalizedPath) {
    return false;
  }
  const rootPath = normalizedPath.split("/")[0]?.trim() ?? "";
  return !HIDDEN_TAG_ROOTS.has(rootPath);
}

function buildFolderRecordsFromSnapshot(folders: AffairsLibraryFolderNodeDto[]): FolderRecord[] {
  return [...folders]
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"))
    .map((item) => ({
      id: item.path,
      label: item.name,
      path: item.path,
      parentPath: item.parentPath,
      depth: item.path ? item.path.split("/").length - 1 : 0,
      directCount: item.directDocumentCount,
      count: item.documentCount,
      createdAt: item.createdAt ?? null,
      updatedAt: item.updatedAt ?? null
    }));
}

type TagTreeNodeRecord = TagRecord & { children: TagTreeNodeRecord[] };
type FolderDetailState = {
  title: string;
  path: string;
  folderPath: string | null;
  summary: string;
  childFolderCount: number;
  directDocumentCount: number;
  totalDocumentCount: number;
  createdAt: string | null;
  updatedAt: string | null;
} | null;
type TagDetailState = {
  title: string;
  path: string;
  rootType: string;
  documentCount: number;
  nestedDocumentCount: number;
} | null;

function buildTagTree(tags: TagRecord[], accessCounts: Record<string, number>): TagTreeNodeRecord[] {
  const nodeMap = new Map<string, TagTreeNodeRecord>();
  tags.forEach((tag) => {
    nodeMap.set(tag.path, { ...tag, children: [] });
  });
  const roots: TagTreeNodeRecord[] = [];
  nodeMap.forEach((node) => {
    if (node.parentPath && nodeMap.has(node.parentPath)) {
      nodeMap.get(node.parentPath)?.children.push(node);
      return;
    }
    roots.push(node);
  });
  const sortNodes = (items: TagTreeNodeRecord[]) => {
    items.sort((left, right) => compareTagTreeNodes(left, right, accessCounts));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function applyTagFacetCountsToTree(
  nodes: TagTreeNodeRecord[],
  tagFacetCounts: Record<string, number>,
  hasTagSelection: boolean
): TagTreeNodeRecord[] {
  if (!hasTagSelection) {
    return nodes;
  }
  return nodes.map((node) => ({
    ...node,
    count: tagFacetCounts[node.path] ?? 0,
    children: applyTagFacetCountsToTree(node.children, tagFacetCounts, hasTagSelection)
  }));
}

function compareTagTreeNodes(left: TagTreeNodeRecord, right: TagTreeNodeRecord, accessCounts: Record<string, number>): number {
  if (isTimeTagNode(left) || isTimeTagNode(right)) {
    const timeComparison = compareTimeTagNode(left, right);
    if (timeComparison !== 0) {
      return timeComparison;
    }
  }
  const accessComparison = (accessCounts[right.path] ?? 0) - (accessCounts[left.path] ?? 0);
  if (accessComparison !== 0) {
    return accessComparison;
  }
  const countComparison = right.count - left.count;
  if (countComparison !== 0) {
    return countComparison;
  }
  return left.label.localeCompare(right.label, "zh-CN");
}

function isTimeTagNode(node: TagTreeNodeRecord): boolean {
  const rootType = node.rootType.trim().toLowerCase();
  return rootType === "时间" || rootType === "time";
}

function compareTimeTagNode(left: TagTreeNodeRecord, right: TagTreeNodeRecord): number {
  const leftRecentOrder = resolveRecentTimeTagOrder(left);
  const rightRecentOrder = resolveRecentTimeTagOrder(right);
  if (leftRecentOrder !== null || rightRecentOrder !== null) {
    if (leftRecentOrder === null) {
      return 1;
    }
    if (rightRecentOrder === null) {
      return -1;
    }
    if (leftRecentOrder !== rightRecentOrder) {
      return leftRecentOrder - rightRecentOrder;
    }
  }

  const leftRank = resolveTimeTagSortRank(left);
  const rightRank = resolveTimeTagSortRank(right);
  if (leftRank !== null || rightRank !== null) {
    if (leftRank === null) {
      return 1;
    }
    if (rightRank === null) {
      return -1;
    }
    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }
  }
  return 0;
}

function resolveRecentTimeTagOrder(node: TagTreeNodeRecord): number | null {
  const normalized = node.path.trim();
  const relativePath = normalized.startsWith("时间/") ? normalized.slice("时间/".length) : normalized;
  if (relativePath === "最近3天") {
    return 0;
  }
  if (relativePath === "最近7天") {
    return 1;
  }
  if (relativePath === "最近30天") {
    return 2;
  }
  return null;
}

function resolveTimeTagSortRank(node: TagTreeNodeRecord): number | null {
  const normalized = node.path.trim();
  if (normalized === "时间") {
    return Number.MAX_SAFE_INTEGER;
  }
  const relativePath = normalized.startsWith("时间/") ? normalized.slice("时间/".length) : normalized;
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const numbers = segments.map((segment) => Number.parseInt(segment, 10));
  if (numbers.some((value) => !Number.isFinite(value))) {
    return null;
  }
  if (numbers.length === 1) {
    return numbers[0];
  }
  if (numbers.length === 2) {
    return numbers[0] * 100 + numbers[1];
  }
  if (numbers.length === 3) {
    return numbers[0] * 10_000 + numbers[1] * 100 + numbers[2];
  }
  return numbers.reduce((value, segment) => value * 100 + segment, 0);
}

function resolveVisibleTagChildren(
  items: TagTreeNodeRecord[],
  path: string,
  expandedOverflowPaths: string[]
): TagTreeNodeRecord[] {
  if (items.length <= TAG_TREE_CHILDREN_VISIBLE_LIMIT || expandedOverflowPaths.includes(path)) {
    return items;
  }
  return items.slice(0, TAG_TREE_CHILDREN_VISIBLE_LIMIT);
}

function collectOverflowPathsForSelection(nodes: TagTreeNodeRecord[], selectedPath: string): string[] {
  const matchedPaths: string[] = [];
  const visit = (items: TagTreeNodeRecord[], parentPath: string) => {
    const hiddenChildren = items.slice(TAG_TREE_CHILDREN_VISIBLE_LIMIT);
    const selectedInHidden = hiddenChildren.some((child) => selectedPath === child.path || selectedPath.startsWith(`${child.path}/`));
    if (selectedInHidden) {
      matchedPaths.push(parentPath);
    }
    items.forEach((child) => {
      if (selectedPath === child.path || selectedPath.startsWith(`${child.path}/`)) {
        visit(child.children, child.path);
      }
    });
  };
  visit(nodes, TAG_TREE_ROOT_OVERFLOW_KEY);
  return matchedPaths;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function resolveSelectedTagPaths(state: AffairsViewState): string[] {
  const directTagPaths = Array.isArray(state.selectedTagPaths)
    ? state.selectedTagPaths
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : [];
  if (directTagPaths.length > 0) {
    return Array.from(new Set(directTagPaths));
  }
  const fallback = state.selectedTagPath?.trim();
  return fallback ? [fallback] : [];
}

function toggleTagPathSelection(currentPaths: string[], nextPath: string): string[] {
  const normalizedPath = nextPath.trim();
  if (!normalizedPath) {
    return [];
  }
  return currentPaths.includes(normalizedPath)
    ? currentPaths.filter((item) => item !== normalizedPath)
    : [...currentPaths, normalizedPath];
}

function updateSelectedTagPaths(
  tagRecords: TagRecord[],
  currentPaths: string[],
  nextPath: string
): string[] {
  const normalizedPath = nextPath.trim();
  if (!normalizedPath) {
    return [];
  }
  const nextRootType = resolveTagRootType(tagRecords, normalizedPath);
  const alreadySelected = currentPaths.includes(normalizedPath);
  const nextPaths = currentPaths.filter((item) => resolveTagRootType(tagRecords, item) !== nextRootType);
  if (alreadySelected) {
    return nextPaths;
  }
  return [...nextPaths, normalizedPath];
}

function resolveTagRootType(tagRecords: TagRecord[], pathValue: string): string {
  const normalizedPath = pathValue.trim();
  if (!normalizedPath) {
    return "";
  }
  const matched = tagRecords.find((item) => item.path === normalizedPath);
  if (matched?.rootType?.trim()) {
    return matched.rootType.trim();
  }
  return normalizedPath.split("/")[0] ?? normalizedPath;
}

function buildTagTreeVisibility(
  roots: TagTreeNodeRecord[],
  selectedTagPaths: string[],
  tagFacetCounts: Record<string, number>
): TagTreeVisibilityRecord {
  const nodeMap = new Map<string, TagTreeNodeRecord>();
  const visiblePathSet = new Set<string>();
  const selectedSet = new Set(selectedTagPaths);
  const markAncestorsVisible = (pathValue: string) => {
    for (const ancestorPath of buildAncestorPaths(pathValue)) {
      visiblePathSet.add(ancestorPath);
    }
  };

  const visit = (node: TagTreeNodeRecord): boolean => {
    nodeMap.set(node.path, node);
    const nodeFacetCount = tagFacetCounts[node.path] ?? 0;
    const selectedRelated = selectedTagPaths.some((selectedPath) => (
      selectedPath === node.path
      || selectedPath.startsWith(`${node.path}/`)
      || node.path.startsWith(`${selectedPath}/`)
    ));
    const directVisible = selectedRelated || nodeFacetCount > 0;
    let childVisible = false;
    node.children.forEach((child) => {
      if (visit(child)) {
        childVisible = true;
      }
    });
    const visible = directVisible || childVisible || selectedTagPaths.length === 0;
    if (visible) {
      visiblePathSet.add(node.path);
      if (selectedSet.has(node.path)) {
        markAncestorsVisible(node.path);
      }
    }
    return visible;
  };

  roots.forEach((root) => {
    visit(root);
  });

  return { nodeMap, visiblePathSet };
}

function filterTagTreeByVisibility(
  nodes: TagTreeNodeRecord[],
  visiblePathSet: Set<string>
): TagTreeNodeRecord[] {
  return nodes
    .filter((node) => visiblePathSet.has(node.path))
    .map((node) => ({
      ...node,
      children: filterTagTreeByVisibility(node.children, visiblePathSet)
    }));
}

function buildAncestorPaths(pathValue: string): string[] {
  const normalized = pathValue.trim();
  if (!normalized) {
    return [];
  }
  const segments = normalized.split("/");
  const paths: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    paths.push(segments.slice(0, index + 1).join("/"));
  }
  return paths;
}

function readStoredAffairsTagTreeState(workspaceId: string): StoredAffairsTagTreeState {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(`${AFFAIRS_TAG_TREE_STATE_STORAGE_KEY_PREFIX}${workspaceId}`);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoredAffairsTagTreeState;
    return {
      expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths.filter((item): item is string => typeof item === "string") : [],
      expandedOverflowPaths: Array.isArray(parsed.expandedOverflowPaths)
        ? parsed.expandedOverflowPaths.filter((item): item is string => typeof item === "string")
        : [],
      accessCounts: parsed.accessCounts && typeof parsed.accessCounts === "object" ? parsed.accessCounts : {}
    };
  } catch {
    return {};
  }
}

function persistAffairsTagTreeState(workspaceId: string, state: StoredAffairsTagTreeState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      `${AFFAIRS_TAG_TREE_STATE_STORAGE_KEY_PREFIX}${workspaceId}`,
      JSON.stringify({
        expandedPaths: state.expandedPaths ?? [],
        expandedOverflowPaths: state.expandedOverflowPaths ?? [],
        accessCounts: state.accessCounts ?? {}
      })
    );
  } catch {
    // 忽略本地存储不可用。
  }
}

function buildAffairsLibrarySnapshotCacheKey(workspaceId: string) {
  return `affairs.library.snapshot.${AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID}`;
}

function buildAffairsLightweightConversationSessionsCacheKey(workspaceId: string) {
  return `affairs.conversation.lightweight.sessions.${AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID}`;
}

function buildAffairsLibraryConfigCacheKey(workspaceId: string) {
  return `affairs.library.config.${AFFAIRS_DASHBOARD_GLOBAL_SCOPE_ID}`;
}

function buildAffairsLibraryDocumentPageCacheKey(workspaceId: string, state: AffairsViewState) {
  return [
    "affairs.library.documents",
    workspaceId,
    state.browseMode,
    state.selectedFolderPath?.trim() || ".",
    resolveSelectedTagPaths(state).join("|") || state.selectedTagPath?.trim() || ".",
    state.selectedFavoriteId?.trim() || "."
  ].join("::");
}

function readCachedLibrarySnapshot(workspaceId: string) {
  return readViewSnapshot<AffairsLibrarySnapshotDto>(
    buildAffairsLibrarySnapshotCacheKey(workspaceId),
    AFFAIRS_LIBRARY_CACHE_MAX_AGE_MS
  );
}

function writeCachedLibrarySnapshot(workspaceId: string, snapshot: AffairsLibrarySnapshotDto) {
  writeViewSnapshot(buildAffairsLibrarySnapshotCacheKey(workspaceId), snapshot);
}

function readCachedLibraryConfig(workspaceId: string) {
  return readViewSnapshot<AffairsLibraryConfigDto>(
    buildAffairsLibraryConfigCacheKey(workspaceId),
    AFFAIRS_LIBRARY_CACHE_MAX_AGE_MS
  );
}

function writeCachedLibraryConfig(workspaceId: string, config: AffairsLibraryConfigDto) {
  writeViewSnapshot(buildAffairsLibraryConfigCacheKey(workspaceId), config);
}

function readCachedLibraryDocumentPage(workspaceId: string, state: AffairsViewState) {
  return readViewSnapshot<AffairsLibraryDocumentListDto>(
    buildAffairsLibraryDocumentPageCacheKey(workspaceId, state),
    AFFAIRS_LIBRARY_CACHE_MAX_AGE_MS
  );
}

function writeCachedLibraryDocumentPage(
  workspaceId: string,
  state: AffairsViewState,
  page: AffairsLibraryDocumentListDto
) {
  writeViewSnapshot(buildAffairsLibraryDocumentPageCacheKey(workspaceId, state), page);
}

function readCachedAffairsLightweightConversationSessions(workspaceId: string) {
  return readViewSnapshot<SessionSummaryDto[]>(
    buildAffairsLightweightConversationSessionsCacheKey(workspaceId),
    AFFAIRS_CONVERSATION_SESSION_CACHE_MAX_AGE_MS
  );
}

function writeCachedAffairsLightweightConversationSessions(workspaceId: string, sessions: SessionSummaryDto[]) {
  writeViewSnapshot(buildAffairsLightweightConversationSessionsCacheKey(workspaceId), sessions);
}

function mergeDocumentPageItems(
  previous: AffairsLibraryDocumentRecordDto[],
  incoming: AffairsLibraryDocumentRecordDto[]
): AffairsLibraryDocumentRecordDto[] {
  if (previous.length === 0) {
    return incoming;
  }
  const seen = new Set(previous.map((item) => item.documentId));
  const merged = [...previous];
  for (const item of incoming) {
    if (seen.has(item.documentId)) {
      continue;
    }
    seen.add(item.documentId);
    merged.push(item);
  }
  return merged;
}

function mergeInitialLibraryDocumentPage(
  cached: AffairsLibraryDocumentListDto | null,
  response: AffairsLibraryDocumentListDto
): AffairsLibraryDocumentListDto {
  void cached;
  // 首屏可以先显示缓存，但接口返回后必须以接口结果为准。
  // 文档库列表表达的是“当前目录状态”，不是追加日志；继续合并旧缓存会让已删除文件假装还存在。
  return response;
}

function mergePagedLibraryDocumentPage(
  previous: AffairsLibraryDocumentListDto | null,
  response: AffairsLibraryDocumentListDto
): AffairsLibraryDocumentListDto {
  return {
    total: response.total,
    visibleEntryTotal: response.visibleEntryTotal ?? previous?.visibleEntryTotal ?? response.total,
    offset: 0,
    limit: Math.max(previous?.limit ?? 0, response.limit),
    items: mergeDocumentPageItems(previous?.items ?? [], response.items),
    tagFacetCounts: response.tagFacetCounts ?? previous?.tagFacetCounts ?? {},
    directoryStatus: response.directoryStatus ?? previous?.directoryStatus ?? null
  };
}

function resolveDocumentDisplayName(filePath: string): string {
  const normalized = filePath.trim().replace(/\/+$/g, "");
  if (!normalized) {
    return t("common.unknown");
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function buildDirectoryHintKey(
  activeSection: string,
  browseMode: "folder" | "tag",
  selectedFolderPath: string | null,
  selectedTagPath: string | null
): string {
  const tagSelectionKey = selectedTagPath?.trim() || ".";
  return [
    activeSection,
    browseMode,
    selectedFolderPath?.trim() || ".",
    tagSelectionKey
  ].join("|");
}

function areLibraryDocumentPagesEqual(
  left: AffairsLibraryDocumentListDto | null,
  right: AffairsLibraryDocumentListDto | null
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (
    left.total !== right.total
    || (left.visibleEntryTotal ?? left.total) !== (right.visibleEntryTotal ?? right.total)
    || left.offset !== right.offset
    || left.limit !== right.limit
  ) {
    return false;
  }
  if (JSON.stringify(left.tagFacetCounts ?? {}) !== JSON.stringify(right.tagFacetCounts ?? {})) {
    return false;
  }
  if (left.items.length !== right.items.length) {
    return false;
  }
  return left.items.every((item, index) => {
    const other = right.items[index];
    return Boolean(other) && areLibraryDocumentRecordsEqual(item, other);
  });
}

function areLibraryDocumentRecordsEqual(
  left: AffairsLibraryDocumentRecordDto,
  right: AffairsLibraryDocumentRecordDto
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areLibrarySnapshotsEqual(
  left: AffairsLibrarySnapshotDto | null,
  right: AffairsLibrarySnapshotDto | null
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function areLibraryConfigsEqual(
  left: AffairsLibraryConfigDto | null,
  right: AffairsLibraryConfigDto | null
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function areAffairsLibraryBindingsEqual(
  left: AffairsLibraryBindingDto | null,
  right: AffairsLibraryBindingDto | null
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function areAffairsObjectContextsEqual(
  left: AffairsObjectContext | null,
  right: AffairsObjectContext | null
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.objectType === right.objectType
    && left.objectId === right.objectId
    && left.title === right.title
    && left.summary === right.summary
    && left.sourceRef === right.sourceRef
    && left.assistantScope === right.assistantScope
  );
}

function sortIncludedHiddenPaths(input: readonly string[]): string[] {
  return [...new Set(
    input
      .map((item) => String(item ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/g, ""))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function parseIncludedHiddenPaths(input: string): string[] {
  return sortIncludedHiddenPaths(
    input
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function computeVirtualListMetrics(
  itemCount: number,
  viewportHeight: number,
  scrollTop: number,
  options?: {
    rowHeight?: number;
  }
) {
  const rowHeight = Math.max(1, options?.rowHeight ?? LIST_ITEM_HEIGHT);
  const visibleRows = Math.max(1, Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight));
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - LIST_VIRTUAL_OVERSCAN_ROWS);
  const endRow = Math.min(itemCount, startRow + visibleRows + LIST_VIRTUAL_OVERSCAN_ROWS * 2);
  return {
    startIndex: startRow,
    endIndex: endRow,
    offsetTop: startRow * rowHeight,
    totalHeight: itemCount * rowHeight
  };
}

function measureStageScrollContentWidth(element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft || "0");
  const paddingRight = Number.parseFloat(styles.paddingRight || "0");
  return Math.max(0, element.clientWidth - paddingLeft - paddingRight);
}

function readMeasuredPixelValue(value: string | null | undefined): number | null {
  const nextValue = Number.parseFloat(value ?? "");
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : null;
}

function readMeasuredTrackCount(gridTemplateColumns: string | null | undefined): number | null {
  const normalizedValue = String(gridTemplateColumns ?? "").trim();
  if (!normalizedValue || normalizedValue === "none") {
    return null;
  }
  const tracks = normalizedValue
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return tracks.length > 0 ? tracks.length : null;
}

function measureAffairsFinderRowHeight(container: HTMLElement | null): number | null {
  if (!container) {
    return null;
  }
  const row = container.querySelector<HTMLElement>(".affairs-finder-row:not(.is-placeholder)") ?? container.querySelector<HTMLElement>(".affairs-finder-row");
  if (!row) {
    return null;
  }
  const rectHeight = row.getBoundingClientRect().height;
  if (rectHeight > 0) {
    return rectHeight;
  }
  return readMeasuredPixelValue(window.getComputedStyle(row).height);
}

function measureAffairsGridLayout(container: HTMLElement | null): {
  columns: number | null;
  itemHeight: number | null;
  rowGap: number | null;
} {
  if (!container) {
    return {
      columns: null,
      itemHeight: null,
      rowGap: null
    };
  }
  const grid = container.querySelector<HTMLElement>(".affairs-doc-grid");
  const item = container.querySelector<HTMLElement>(".affairs-doc-item.grid:not(.is-placeholder)") ?? container.querySelector<HTMLElement>(".affairs-doc-item.grid");
  const gridStyles = grid ? window.getComputedStyle(grid) : null;
  const itemRectHeight = item?.getBoundingClientRect().height ?? 0;
  return {
    columns: readMeasuredTrackCount(gridStyles?.gridTemplateColumns),
    itemHeight: itemRectHeight > 0 ? itemRectHeight : readMeasuredPixelValue(item ? window.getComputedStyle(item).height : null),
    rowGap: readMeasuredPixelValue(gridStyles?.rowGap)
  };
}

function buildVirtualLibraryEntrySlots(
  loadedEntries: LibraryEntry[],
  startIndex: number,
  endIndex: number
): VirtualLibraryEntrySlot[] {
  const slots: VirtualLibraryEntrySlot[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    slots.push({
      index,
      entry: loadedEntries[index] ?? null
    });
  }
  return slots;
}

function AffairsGridPlaceholderCard() {
  return (
    <div className="affairs-doc-item grid is-placeholder" aria-hidden="true">
      <div className="affairs-doc-icon">
        <div className="affairs-doc-placeholder-icon" />
      </div>
      <div className="affairs-doc-placeholder-lines">
        <span />
        <span />
      </div>
      <div className="affairs-doc-footer">
        <span className="affairs-doc-placeholder-meta" />
      </div>
    </div>
  );
}

function AffairsFinderPlaceholderRow({ gridTemplateColumns }: { gridTemplateColumns: string }) {
  return (
    <div
      className="affairs-finder-row is-placeholder"
      style={{ gridTemplateColumns }}
      aria-hidden="true"
    >
      <span className="affairs-finder-name-cell">
        <span className="affairs-finder-icon">
          <span className="affairs-finder-placeholder-icon" />
        </span>
        <span className="affairs-finder-placeholder-line affairs-finder-placeholder-line-main" />
      </span>
      <span className="affairs-finder-placeholder-line affairs-finder-placeholder-line-short" />
      <span className="affairs-finder-placeholder-line affairs-finder-placeholder-line-short" />
      <span className="affairs-finder-placeholder-line affairs-finder-placeholder-line-short" />
      <span className="affairs-finder-placeholder-line affairs-finder-placeholder-line-short" />
    </div>
  );
}

function sortLibraryEntries(entries: LibraryEntry[], sortState: LibrarySortState): LibraryEntry[] {
  const next = [...entries];
  next.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }
    const direction = sortState.direction === "asc" ? 1 : -1;
    if (sortState.mode === "type") {
      const leftType = left.kind === "folder" ? "folder" : resolveDocumentType(left.path);
      const rightType = right.kind === "folder" ? "folder" : resolveDocumentType(right.path);
      const typeCompare = leftType.localeCompare(rightType, "zh-CN") * direction;
      if (typeCompare !== 0) {
        return typeCompare;
      }
      return left.title.localeCompare(right.title, "zh-CN");
    }
    if (sortState.mode === "name") {
      return left.title.localeCompare(right.title, "zh-CN") * direction;
    }
    if (sortState.mode === "size") {
      const leftSize = left.kind === "folder" ? -1 : left.sizeBytes ?? -1;
      const rightSize = right.kind === "folder" ? -1 : right.sizeBytes ?? -1;
      if (leftSize !== rightSize) {
        return (leftSize - rightSize) * direction;
      }
      return left.title.localeCompare(right.title, "zh-CN");
    }
    if (sortState.mode === "createdAt") {
      const leftCreated = Date.parse(left.createdAt || "") || 0;
      const rightCreated = Date.parse(right.createdAt || "") || 0;
      if (leftCreated !== rightCreated) {
        return (leftCreated - rightCreated) * direction;
      }
      return left.title.localeCompare(right.title, "zh-CN");
    }
    const leftValue = Date.parse(left.updatedAt || "") || 0;
    const rightValue = Date.parse(right.updatedAt || "") || 0;
    if (leftValue !== rightValue) {
      return (leftValue - rightValue) * direction;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });
  return next;
}

function getDefaultSortState(mode: LibrarySortMode): LibrarySortState {
  return {
    mode,
    direction: mode === "name" || mode === "type" ? "asc" : "desc"
  };
}

function mapFinderColumnToSortMode(column: FinderColumnKey): LibrarySortMode {
  switch (column) {
    case "name":
      return "name";
    case "size":
      return "size";
    case "updatedAt":
      return "recent";
    case "type":
      return "type";
    case "createdAt":
      return "createdAt";
  }
}

function getNextSortState(current: LibrarySortState, column: FinderColumnKey): LibrarySortState {
  const mode = mapFinderColumnToSortMode(column);
  if (current.mode !== mode) {
    return getDefaultSortState(mode);
  }
  return {
    mode,
    direction: current.direction === "asc" ? "desc" : "asc"
  };
}

function renderFinderSortIndicator(sortState: LibrarySortState, column: FinderColumnKey) {
  const mode = mapFinderColumnToSortMode(column);
  if (sortState.mode !== mode) {
    return "↕";
  }
  return sortState.direction === "asc" ? "↑" : "↓";
}

function buildFinderSortButtonLabel(label: string, sortState: LibrarySortState, column: FinderColumnKey) {
  const mode = mapFinderColumnToSortMode(column);
  if (sortState.mode !== mode) {
    return t("shell.affairsFinderSortAction", { column: label });
  }
  return t("shell.affairsFinderSortCurrent", {
    column: label,
    direction: sortState.direction === "asc"
      ? t("shell.affairsFinderSortDirectionAsc")
      : t("shell.affairsFinderSortDirectionDesc")
  });
}

const resolveDocumentType = resolveAffairsDocumentExtension;

function buildToolbarBreadcrumbItems(
  browseMode: "folder" | "tag",
  folderBreadcrumbs: Array<{ label: string; path: string }>,
  tagRecords: TagRecord[],
  selectedTagPath: string | null,
  selectedTagPaths: string[]
): Array<
  | { key: string; kind: "item"; label: string; value: string; mode: "folder" | "tag" }
  | { key: string; kind: "collapsed" }
> {
  const rawItems = buildToolbarBreadcrumbItemsRaw(browseMode, folderBreadcrumbs, tagRecords, selectedTagPath, selectedTagPaths);

  if (rawItems.length <= 3) {
    return rawItems;
  }

  return [
    rawItems[0]!,
    { key: "collapsed", kind: "collapsed" as const },
    rawItems[rawItems.length - 1]!
  ];
}

function buildToolbarBreadcrumbItemsRaw(
  browseMode: "folder" | "tag",
  folderBreadcrumbs: Array<{ label: string; path: string }>,
  tagRecords: TagRecord[],
  selectedTagPath: string | null,
  selectedTagPaths: string[]
) {
  if (browseMode === "folder") {
    return folderBreadcrumbs.map((item) => ({
      key: item.path,
      kind: "item" as const,
      label: item.label,
      value: item.path,
      mode: "folder" as const
    }));
  }

  return buildTagBreadcrumbItems(tagRecords, selectedTagPath, selectedTagPaths);
}

function collapseToolbarBreadcrumbItems(
  rawItems: Array<{ key: string; kind: "item"; label: string; value: string; mode: "folder" | "tag" }>,
  widthRefs: Map<string, HTMLSpanElement>,
  availableWidth: number
): Array<
  | { key: string; kind: "item"; label: string; value: string; mode: "folder" | "tag" }
  | { key: string; kind: "collapsed" }
> {
  if (rawItems.length <= 1 || availableWidth <= 0) {
    return rawItems;
  }

  const fullWidth = rawItems.reduce((sum, item) => sum + (widthRefs.get(item.key)?.offsetWidth ?? 0), 0);
  if (fullWidth <= availableWidth) {
    return rawItems;
  }

  const collapsedWidth = 28;
  const first = rawItems[0]!;
  const last = rawItems[rawItems.length - 1]!;
  const firstWidth = widthRefs.get(first.key)?.offsetWidth ?? 0;
  const lastWidth = widthRefs.get(last.key)?.offsetWidth ?? 0;
  const baseWidth = firstWidth + lastWidth + collapsedWidth;

  const trailing: typeof rawItems = [];
  let runningWidth = baseWidth;
  for (let index = rawItems.length - 2; index >= 1; index -= 1) {
    const candidate = rawItems[index]!;
    const candidateWidth = widthRefs.get(candidate.key)?.offsetWidth ?? 0;
    if (runningWidth + candidateWidth > availableWidth) {
      break;
    }
    trailing.unshift(candidate);
    runningWidth += candidateWidth;
  }

  return [first, { key: "collapsed", kind: "collapsed" as const }, ...trailing, last];
}

function getVisibleChildFolders(folders: FolderRecord[], currentPath: string | null) {
  const normalized = normalizeFolderPath(currentPath);
  return folders.filter((folder) => normalizeFolderPath(folder.parentPath) === normalized);
}

function getDirectDocuments(documents: DocumentRecord[], currentPath: string | null) {
  const normalized = normalizeFolderPath(currentPath);
  return documents.filter((document) => normalizeFolderPath(getDocumentParentPath(document.filePath)) === normalized);
}

function buildLibraryEntries({
  browseMode,
  childFolders,
  documents,
  favoriteFolderPathSet
}: {
  browseMode: "folder" | "tag";
  childFolders: FolderRecord[];
  documents: DocumentRecord[];
  favoriteFolderPathSet: Set<string>;
}): LibraryEntry[] {
  if (browseMode === "tag") {
    return documents.map((document) => ({
      id: `document:${document.id}`,
      kind: "document",
      title: document.displayName,
      path: document.filePath,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
      sizeBytes: document.sizeBytes,
      summary: document.summary,
      isFavorite: document.isFavorite,
      documentId: document.id
    }));
  }
  return [
    ...childFolders.map<LibraryEntry>((folder) => ({
      id: `folder:${folder.path}`,
      kind: "folder",
      title: folder.label,
      path: folder.path,
      count: folder.count,
      isFavorite: favoriteFolderPathSet.has(folder.path),
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt
    })),
    ...documents.map<LibraryEntry>((document) => ({
      id: `document:${document.id}`,
      kind: "document",
      title: document.displayName,
      path: document.filePath,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
      sizeBytes: document.sizeBytes,
      summary: document.summary,
      isFavorite: document.isFavorite,
      documentId: document.id
    }))
  ];
}

function buildFolderDetailState(
  folders: FolderRecord[],
  documents: DocumentRecord[],
  currentPath: string | null,
  selectedFolderEntryPath: string | null,
  selectedObject: AffairsSelectedObject
): FolderDetailState {
  if (selectedObject.section !== "library" || selectedObject.record) {
    return null;
  }
  const detailPath = selectedFolderEntryPath?.trim() || currentPath;
  const normalized = normalizeFolderPath(detailPath);
  const folder = folders.find((item) => normalizeFolderPath(item.path) === normalized) ?? null;
  const childFolderCount = folders.filter((item) => normalizeFolderPath(item.parentPath) === normalized).length;
  const directDocumentCount = documents.filter((item) => normalizeFolderPath(getDocumentParentPath(item.filePath)) === normalized).length;
  const title = folder?.label || t("shell.affairsLibraryFolderRootLabel");
  const pathLabel = formatFolderPath(detailPath);
  return {
    title,
    path: pathLabel,
    folderPath: detailPath?.trim() || null,
    summary: t("shell.affairsLibraryFolderDetailSummary", {
      path: pathLabel,
      folderCount: childFolderCount,
      directDocumentCount,
      totalDocumentCount: folder?.count ?? documents.filter((item) => matchesFolder(item.filePath, detailPath)).length
    }),
    childFolderCount,
    directDocumentCount,
    totalDocumentCount: folder?.count ?? documents.filter((item) => matchesFolder(item.filePath, detailPath)).length,
    createdAt: folder?.createdAt ?? null,
    updatedAt: folder?.updatedAt ?? null
  };
}

function buildTagDetailState(
  tags: TagRecord[],
  filteredDocuments: DocumentRecord[],
  currentTagPath: string | null,
  selectedTagPaths: string[]
): TagDetailState {
  const normalizedTagPaths = selectedTagPaths.length > 0
    ? selectedTagPaths
    : (currentTagPath?.trim() ? [currentTagPath.trim()] : []);
  const normalized = normalizedTagPaths[0] ?? "";
  const tag = normalizedTagPaths.length === 1
    ? tags.find((item) => item.path === normalized) ?? null
    : null;
  return {
    title: normalizedTagPaths.length > 1 ? t("shell.affairsLibraryTagMultiTitle") : (tag?.label || t("shell.affairsLibraryTagRootLabel")),
    path: normalizedTagPaths.length > 0 ? normalizedTagPaths.join(" · ") : t("shell.affairsLibraryTagRootLabel"),
    rootType: normalizedTagPaths.length > 1 ? t("shell.affairsLibraryTagMultiRootType") : (tag?.rootType || t("common.unknown")),
    documentCount: normalizedTagPaths.length > 0
      ? filteredDocuments.filter((record) => normalizedTagPaths.every((tagPath) => hasDirectTagMatch(record, tagPath))).length
      : 0,
    nestedDocumentCount: filteredDocuments.length
  };
}

function normalizeFolderPath(path: string | null | undefined) {
  const normalized = path?.trim() ?? "";
  if (!normalized || normalized === ".") {
    return "";
  }
  return normalized.replace(/^\/+|\/+$/g, "");
}

function getDocumentParentPath(filePath: string) {
  const normalized = filePath.trim();
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function formatFolderPath(path: string | null) {
  const normalized = normalizeFolderPath(path);
  return normalized || t("shell.affairsLibraryFolderRootLabel");
}

function getParentFolderPath(path: string | null) {
  const normalized = normalizeFolderPath(path);
  if (!normalized) {
    return null;
  }
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : null;
}

function resolveSelectedFolderEntryPathOnNavigate(
  previousFolderPath: string | null,
  nextFolderPath: string | null
) {
  const previous = normalizeFolderPath(previousFolderPath);
  const next = normalizeFolderPath(nextFolderPath);

  if (!previous || previous === next) {
    return null;
  }

  if (getParentFolderPath(previous) === next) {
    return previous;
  }

  if (!next) {
    const [firstSegment] = previous.split("/");
    return firstSegment || null;
  }

  if (!previous.startsWith(`${next}/`)) {
    return null;
  }

  const remainder = previous.slice(next.length + 1);
  const [firstChildSegment] = remainder.split("/");
  return firstChildSegment ? `${next}/${firstChildSegment}` : null;
}

function buildFolderBreadcrumbs(path: string | null) {
  const normalized = normalizeFolderPath(path);
  if (!normalized) {
    return [];
  }
  const segments = normalized.split("/");
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/")
  }));
}

function buildTagBreadcrumbItems(tags: TagRecord[], path: string | null, selectedTagPaths: string[]) {
  const normalizedPaths = selectedTagPaths.length > 0
    ? selectedTagPaths
    : (path?.trim() ? [path.trim()] : []);
  if (normalizedPaths.length === 0) {
    return [];
  }

  if (normalizedPaths.length > 1) {
    return normalizedPaths.map((selectedPath) => {
      const normalized = selectedPath.trim();
      const tag = tags.find((item) => item.path === normalized);
      return {
        key: normalized,
        kind: "item" as const,
        label: tag?.label ?? normalized.split("/").pop() ?? normalized,
        value: normalized,
        mode: "tag" as const
      };
    });
  }

  const normalized = normalizedPaths[0]!;

  const tagByPath = new Map(tags.map((tag) => [tag.path, tag]));
  const breadcrumbItems: Array<{ key: string; kind: "item"; label: string; value: string; mode: "tag" }> = [];
  let cursor = normalized;
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const tag = tagByPath.get(cursor);
    if (tag) {
      breadcrumbItems.unshift({
        key: tag.path,
        kind: "item",
        label: tag.label,
        value: tag.path,
        mode: "tag"
      });
      cursor = tag.parentPath?.trim() || "";
      continue;
    }

    const segments = normalized.split("/");
    return segments.map((segment, index) => ({
      key: segments.slice(0, index + 1).join("/"),
      kind: "item" as const,
      label: segment,
      value: segments.slice(0, index + 1).join("/"),
      mode: "tag" as const
    }));
  }

  return breadcrumbItems;
}

function buildTodoRecords(inboxItems: ButlerInboxItemDto[], followUpTasks: ButlerFollowUpTaskDto[]): TodoRecord[] {
  const inboxRecords = inboxItems
    .filter((item) => item.status !== "closed")
    .map<TodoRecord>((item) => ({
      id: `inbox:${item.id}`,
      kind: "inbox",
      title: item.title,
      summary: item.content,
      statusLabel: resolveInboxStatusLabel(item.status),
      detail:
        item.assistantState.analysisSummary?.trim()
        || item.assistantState.generatedPrompt?.trim()
        || item.assistantState.lastError?.trim()
        || item.content,
      sourceSessionId: item.assistantState.linkedSessionId,
      updatedAt: item.updatedAt,
      sourceLabel: t("shell.affairsTodoInboxFilter"),
      sourceDescription: item.projectName?.trim() || t("common.unknown")
    }));
  const followUpRecords = followUpTasks
    .filter((item) => item.status === "active" || item.status === "waiting_user")
    .map<TodoRecord>((item) => ({
      id: `follow-up:${item.id}`,
      kind: "follow_up",
      title: item.sessionTitle?.trim() || item.projectName,
      summary: item.objective,
      statusLabel: resolveFollowUpStatusLabel(item.status),
      detail: item.waitingReason?.trim() || item.lastAutomationSummary?.trim() || item.objective,
      sourceSessionId: item.sessionId,
      updatedAt: item.updatedAt,
      sourceLabel: t("shell.affairsTodoFollowUpFilter"),
      sourceDescription: item.sessionTitle?.trim() || item.projectName
    }));

  return [...inboxRecords, ...followUpRecords].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildAutomationRecords(
  automations: AssistantAutomationTaskDto[],
  sessionTitleById: Record<string, string>
): AutomationRecord[] {
  return [...automations]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((automation) => ({
      id: automation.id,
      title: automation.title?.trim() || t("shell.affairsAutomationUntitled"),
      summary: automation.actionConfig.content.trim() || t("shell.affairsAutomationPromptFallback"),
      statusLabel: resolveAutomationStatusLabel(automation.status),
      triggerLabel: resolveAutomationTriggerLabel(automation.triggerType),
      targetSessionLabel: resolveAutomationTargetLabel(automation, sessionTitleById),
      updatedAt: automation.updatedAt,
      lastRunSummary: automation.lastRunSummary?.trim() || null,
      lastRunStatusLabel: automation.lastError?.trim() ? t("shell.affairsAutomationRunsStatusFailed") : automation.lastRunAt ? t("shell.affairsAutomationRunsStatusFinished") : null
    }));
}

function buildAffairsAssistantPrefix(context: AffairsObjectContext | null) {
  if (!context) {
    return `${t("shell.affairsAssistantPromptPreambleEmpty")}\n\n`;
  }

  return `${t("shell.affairsAssistantPromptPreamble", {
    title: context.title ?? t("common.unknown"),
    summary: context.summary ?? t("shell.affairsAssistantContextFallback"),
    sourceRef: context.sourceRef ?? t("common.unknown")
  })}\n\n`;
}

function resolveAffairsAuxiliaryTabForSection(
  section: AffairsPrimarySection,
  tab: AffairsAuxiliaryTab | null | undefined
): AffairsAuxiliaryTab {
  if (section === "workbench") {
    return "assistant";
  }

  if (tab === "assistant") {
    return "assistant";
  }

  return "detail";
}

function resolveAffairsWorkbenchAssistantScopeLabel(nodeId: string | null | undefined) {
  const normalizedNodeId = normalizeWorkbenchNodeId(nodeId);

  if (normalizedNodeId === "workbench:todo:inbox") {
    return t("shell.affairsTodoInboxFilter");
  }

  if (normalizedNodeId === "workbench:todo:follow_up") {
    return t("shell.affairsTodoFollowUpFilter");
  }

  return t("shell.affairsTodoAllFilter");
}

function convertButlerManagedSessionToAffairsSessionSummary(
  session: ButlerManagedSessionDto,
  workspaceId: string
): SessionSummaryDto {
  return {
    sessionId: session.sessionId,
    workspaceId,
    provider: (session.provider ?? "codex") as ProviderId,
    providerSessionId: session.sessionId,
    rawStoreRef: `butler://${session.id}`,
    providerConfigMode: "global-default",
    providerPresetId: null,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: session.isArchived,
    isFavorite: session.isFavorite === true,
    title: session.title?.trim() || session.sessionId,
    messageCount: 0,
    lastMessageAt: session.updatedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: session.updatedAt,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: normalizeAffairsRunningState(session.runningState),
    activitySource: "inferred",
    lastEventAt: session.updatedAt,
    completedAt: session.status === "closed" ? session.updatedAt : null,
    lastSeenAt: null,
    activityState: session.status === "running" ? "running" : "completed_unread"
  };
}

function normalizeAffairsRunningState(runningState: string | null | undefined): SessionSummaryDto["runningState"] {
  switch (runningState) {
    case "idle":
    case "starting":
    case "running":
    case "reconnecting":
    case "stale":
    case "unknown":
    case "completed":
    case "interrupted":
    case "failed":
      return runningState;
    default:
      return "idle";
  }
}

function resolveAffairsSectionTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationNav");
    case "workbench":
      return t("shell.affairsWorkbenchNav");
    case "library":
    default:
      return t("shell.affairsLibraryTitle");
  }
}

function resolveAffairsSectionSummary(section: AffairsPrimarySection) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationSummary");
    case "workbench":
      return t("shell.affairsWorkbenchSummary");
    case "library":
    default:
      return t("shell.affairsLibrarySummary");
  }
}

function resolveStageTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationStageTitle");
    case "workbench":
      return t("shell.affairsWorkbenchStageTitle");
    case "library":
    default:
      return t("shell.affairsLibraryResultTitle");
  }
}

function resolveStageDescription(section: AffairsPrimarySection, sidebarCount: number) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationStageDescription", { count: sidebarCount });
    case "workbench":
      return t("shell.affairsWorkbenchStageDescription", { count: sidebarCount });
    case "library":
    default:
      return t("shell.affairsLibraryStageDescription", { count: sidebarCount });
  }
}

function resolveSectionSidebarTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationSidebarTitle");
    case "workbench":
      return t("shell.affairsWorkbenchSidebarTitle");
    case "library":
    default:
      return t("shell.affairsLibrarySidebarTitle");
  }
}

function resolveSectionSidebarDescription(
  section: AffairsPrimarySection,
  counts: {
    documentCount: number;
    favoriteCount: number;
    tagCount: number;
    todoCount: number;
    automationCount: number;
  }
) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationSidebarDescription", { count: 4 });
    case "workbench":
      return t("shell.affairsWorkbenchSidebarDescription", {
        todoCount: counts.todoCount,
        automationCount: counts.automationCount
      });
    case "library":
    default:
      return t("shell.affairsLibrarySidebarDescription", {
        favorites: counts.favoriteCount,
        tags: counts.tagCount,
        count: counts.documentCount
      });
  }
}

function resolveSectionEmptyText(section: AffairsPrimarySection) {
  switch (section) {
    case "conversation":
      return t("shell.affairsConversationEmpty");
    case "workbench":
      return t("shell.affairsWorkbenchEmpty");
    case "library":
    default:
      return t("shell.affairsLibraryEmpty");
  }
}

function resolveInboxStatusLabel(status: ButlerInboxItemDto["status"]) {
  switch (status) {
    case "in_progress":
      return t("shell.affairsTodoStatusInProgress");
    case "closed":
      return t("shell.affairsTodoStatusClosed");
    case "pending":
    default:
      return t("shell.affairsTodoStatusPending");
  }
}

function resolveFollowUpStatusLabel(status: ButlerFollowUpTaskDto["status"]) {
  switch (status) {
    case "waiting_user":
      return t("shell.affairsTodoStatusWaitingUser");
    case "completed":
      return t("shell.affairsTodoStatusCompleted");
    case "failed":
      return t("shell.affairsTodoStatusFailed");
    case "cancelled":
      return t("shell.affairsTodoStatusCancelled");
    case "active":
    default:
      return t("shell.affairsTodoStatusActive");
  }
}

function resolveAutomationStatusLabel(status: AssistantAutomationTaskDto["status"]) {
  switch (status) {
    case "paused":
      return t("shell.affairsAutomationStatusPaused");
    case "completed":
      return t("shell.affairsAutomationStatusCompleted");
    case "cancelled":
      return t("shell.affairsAutomationStatusCancelled");
    case "failed":
      return t("shell.affairsAutomationStatusFailed");
    case "active":
    default:
      return t("shell.affairsAutomationStatusActive");
  }
}

function resolveAutomationRunStatusLabel(status: AssistantAutomationRunDto["status"]) {
  switch (status) {
    case "queued":
      return t("shell.affairsAutomationRunsStatusQueued");
    case "running":
      return t("shell.affairsAutomationRunsStatusRunning");
    case "failed":
      return t("shell.affairsAutomationRunsStatusFailed");
    case "cancelled":
      return t("shell.affairsAutomationRunsStatusCancelled");
    case "skipped":
      return t("shell.affairsAutomationRunsStatusSkipped");
    case "succeeded":
    default:
      return t("shell.affairsAutomationRunsStatusFinished");
  }
}

function resolveAutomationTriggerLabel(triggerType: AssistantAutomationTaskDto["triggerType"]) {
  switch (triggerType) {
    case "interval":
      return t("shell.affairsAutomationTriggerInterval");
    case "cron":
      return t("shell.affairsAutomationTriggerCron");
    case "condition":
      return t("shell.affairsAutomationTriggerCondition");
    case "once":
    default:
      return t("shell.affairsAutomationTriggerOnce");
  }
}

function resolveAutomationTargetLabel(
  automation: AssistantAutomationTaskDto,
  sessionTitleById: Record<string, string>
) {
  const sessionId = automation.actionConfig.targetSessionId?.trim() || automation.controlSession?.sessionId?.trim() || "";
  return sessionTitleById[sessionId] ?? t("shell.affairsAutomationTargetFallback");
}

function resolveConversationSidebarLoadingHint(input: {
  lightweightLoading: boolean;
  agentLoading: boolean;
}) {
  if (input.lightweightLoading && input.agentLoading) {
    return t("shell.affairsConversationSidebarLoadingAll");
  }
  if (input.agentLoading) {
    return t("shell.affairsConversationSidebarLoadingAgent");
  }
  if (input.lightweightLoading) {
    return t("shell.affairsConversationSidebarLoadingLightweight");
  }
  return null;
}

function resolveAffairsConversationKindLabel(kind: AffairsConversationKind) {
  return kind === "agent"
    ? t("shell.affairsConversationKindAgent")
    : t("shell.affairsConversationKindLightweight");
}

function resolveAffairsConversationProviderLabel(provider: ProviderId) {
  return getProviderDisplayName(provider, "full");
}

function buildAffairsConversationDraftNodeId(draft: AffairsConversationDraftSelection): string {
  return `conversation:draft:${draft.kind}:${draft.provider}`;
}

function buildAffairsConversationSessionNodeId(
  kind: AffairsConversationKind,
  sessionId: string
): string {
  return `conversation:${kind}:session:${sessionId}`;
}

function parseAffairsConversationDraftSelection(nodeId: string | null | undefined): AffairsConversationDraftSelection | null {
  const normalizedNodeId = nodeId?.trim() ?? "";
  if (!normalizedNodeId.startsWith("conversation:draft:")) {
    return null;
  }

  const segments = normalizedNodeId.split(":");
  if (segments.length < 4) {
    return null;
  }

  const kind = segments[2];
  const provider = segments.slice(3).join(":");
  if ((kind !== "lightweight" && kind !== "agent") || !isDraftProviderSupported(provider)) {
    return null;
  }

  return {
    kind,
    provider
  };
}

function parseAffairsConversationSessionSelection(
  nodeId: string | null | undefined
): AffairsConversationSessionSelection | null {
  const normalizedNodeId = nodeId?.trim() ?? "";

  if (!normalizedNodeId.startsWith("conversation:")) {
    return null;
  }

  const segments = normalizedNodeId.split(":");
  if (segments.length !== 4 || segments[2] !== "session") {
    return null;
  }

  const kind = segments[1];
  const sessionId = segments[3]?.trim() ?? "";
  if ((kind !== "lightweight" && kind !== "agent") || !sessionId) {
    return null;
  }

  return {
    kind,
    sessionId
  };
}

function resolveAffairsAgentWorkspacePath(binding: AffairsLibraryBindingDto | null): string | null {
  const mirrorRoot = binding?.mirrorRoot?.trim() ?? "";
  if (mirrorRoot) {
    return mirrorRoot;
  }
  const rootDir = binding?.rootDir?.trim() ?? "";
  return rootDir || null;
}

function resolveAffairsConversationCreateWorkspaceLabel(input: {
  rootDir: string | null | undefined;
  mirrorRoot: string | null | undefined;
  agentWorkspacePath: string | null | undefined;
  workspaceName: string | null | undefined;
}): string | null {
  const rootDir = input.rootDir?.trim() ?? "";
  if (rootDir) {
    return rootDir;
  }
  const mirrorRoot = input.mirrorRoot?.trim() ?? "";
  if (mirrorRoot) {
    return mirrorRoot;
  }
  const agentWorkspacePath = input.agentWorkspacePath?.trim() ?? "";
  if (agentWorkspacePath) {
    return agentWorkspacePath;
  }
  const workspaceName = input.workspaceName?.trim() ?? "";
  return workspaceName || null;
}

function resolveAffairsAgentWorkspaceId(
  workspacePath: string | null,
  navigationGroups: WorkspaceSessionGroup[]
): string | null {
  const normalizedWorkspacePath = normalizeAffairsWorkspacePath(workspacePath);
  if (!normalizedWorkspacePath) {
    return null;
  }
  const matches = navigationGroups
    .map((group) => {
      const normalizedPath = normalizeAffairsWorkspacePath(group.workspace.path);
      const normalizedRepoRoot = normalizeAffairsWorkspacePath(group.workspace.repoRoot ?? null);
      const matchLength = Math.max(
        resolveAffairsWorkspacePathMatchLength(normalizedPath, normalizedWorkspacePath),
        resolveAffairsWorkspacePathMatchLength(normalizedRepoRoot, normalizedWorkspacePath)
      );
      return {
        workspaceId: group.workspace.id,
        matchLength
      };
    })
    .filter((item) => item.matchLength > 0)
    .sort((left, right) => right.matchLength - left.matchLength);
  return matches[0]?.workspaceId ?? null;
}

function resolveAffairsWorkspacePathMatchLength(
  leftPath: string | null | undefined,
  rightPath: string | null | undefined
): number {
  const normalizedLeftPath = normalizeAffairsWorkspacePath(leftPath);
  const normalizedRightPath = normalizeAffairsWorkspacePath(rightPath);
  if (!normalizedLeftPath || !normalizedRightPath) {
    return 0;
  }
  if (normalizedLeftPath === normalizedRightPath) {
    return normalizedLeftPath.length;
  }
  if (normalizedRightPath.startsWith(`${normalizedLeftPath}/`)) {
    return normalizedLeftPath.length;
  }
  if (normalizedLeftPath.startsWith(`${normalizedRightPath}/`)) {
    return normalizedRightPath.length;
  }
  return 0;
}

function normalizeAffairsWorkspacePath(input: string | null | undefined): string {
  return input?.trim().replace(/\/+$/g, "") ?? "";
}

function isAffairsControlSessionMatchWorkspaceId(
  controlSession: ButlerControlSessionDto | null | undefined,
  workspaceId: string | null | undefined
): boolean {
  const normalizedWorkspaceId = workspaceId?.trim() ?? "";
  const sessionWorkspaceId = controlSession?.session.workspaceId?.trim() ?? "";
  return normalizedWorkspaceId.length > 0 && sessionWorkspaceId === normalizedWorkspaceId;
}

function buildAffairsConversationDraftSummary(draft: AffairsConversationDraftSelection) {
  if (draft.kind === "agent") {
    return t("shell.affairsConversationOptionSummaryAgent", {
      provider: resolveAffairsConversationProviderLabel(draft.provider)
    });
  }

  return t("shell.affairsConversationOptionSummaryLightweight", {
    provider: resolveAffairsConversationProviderLabel(draft.provider)
  });
}

function createAffairsConversationDraftSessionSummary(
  workspaceId: string,
  draft: AffairsConversationDraftSelection
): SessionSummaryDto {
  const timestamp = new Date().toISOString();

  return {
    sessionId: buildAffairsConversationDraftNodeId(draft),
    workspaceId,
    provider: draft.provider,
    providerSessionId: `draft://${draft.provider}/${workspaceId}`,
    rawStoreRef: `draft://${draft.provider}/${workspaceId}`,
    providerConfigMode: "global-default",
    providerPresetId: null,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: getDraftTitle(draft.provider),
    messageCount: 0,
    lastMessageAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

function createAffairsConversationClientRequestId(): string {
  const nativeCrypto = globalThis.crypto;

  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return nativeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function resolveDefaultNodeId(
  section: AffairsPrimarySection,
  automationRecords: AutomationRecord[],
  _binding: AffairsLibraryBindingDto | null
) {
  switch (section) {
    case "conversation":
      return "conversation:home";
    case "workbench":
      return "workbench:overview";
    case "library":
    default:
      return "library:all";
  }
}

function normalizeWorkbenchNodeId(nodeId: string | null | undefined): string | null {
  const normalizedNodeId = nodeId?.trim() ?? "";

  if (!normalizedNodeId) {
    return "workbench:overview";
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
  if (normalizedNodeId.startsWith("workbench:")) {
    return normalizedNodeId;
  }

  return "workbench:overview";
}

function resolveSidebarSelectedObjectId(
  section: AffairsPrimarySection,
  nodeId: string
): string | null {
  if (section !== "workbench") {
    return null;
  }

  const normalizedNodeId = normalizeWorkbenchNodeId(nodeId);

  if (!normalizedNodeId || normalizedNodeId === "workbench:overview") {
    return null;
  }

  if (normalizedNodeId.startsWith("workbench:automation:item:")) {
    return normalizedNodeId.slice("workbench:automation:item:".length) || null;
  }

  return null;
}

function groupSidebarNodes(section: AffairsPrimarySection, nodes: AffairsSidebarNode[]) {
  if (section === "conversation") {
    return [
      {
        id: "conversation",
        label: t("shell.affairsConversationSidebarGroupModes"),
        items: nodes
      }
    ];
  }

  if (section === "workbench") {
    return [
      {
        id: "overview",
        label: t("shell.affairsWorkbenchSidebarGroupOverview"),
        items: nodes.filter((node) => node.id === "workbench:overview")
      },
      {
        id: "todo",
        label: t("shell.affairsTodoSidebarGroupSources"),
        items: nodes.filter((node) => node.id.startsWith("workbench:todo:"))
      },
      {
        id: "automation",
        label: t("shell.affairsAutomationSidebarGroupTasks"),
        items: nodes.filter((node) => node.id.startsWith("workbench:automation:"))
      }
    ];
  }

  return [];
}

function normalizeSection(section: AffairsPrimarySection): AffairsPrimarySection {
  if (section === "conversation" || section === "workbench") {
    return section;
  }

  return "library";
}

function formatRelativeMeta(value: string) {
  if (!value) {
    return t("common.unknown");
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFullDateTime(value: string | null | undefined) {
  if (!value) {
    return t("common.unknown");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("common.unknown");
  }
  return new Intl.DateTimeFormat(userPreferenceStore.getState().profile.language ?? "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function shouldShowDocumentSummaryToggle(summary: string | null | undefined) {
  const normalized = summary?.trim() ?? "";
  if (!normalized) {
    return false;
  }
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.length > 3 || normalized.length > 120;
}

function buildDocumentPathSegments(filePath: string) {
  const normalized = normalizeFolderPath(filePath);
  if (!normalized) {
    return [] as Array<{ label: string; path: string | null }>;
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments.map((segment, index) => ({
    label: segment,
    path: index < segments.length - 1 ? segments.slice(0, index + 1).join("/") : getDocumentParentPath(normalized) || null
  }));
}

function AffairsDetailPathBreadcrumbs({
  path,
  rootLabel,
  onNavigate
}: {
  path: string;
  rootLabel: string;
  onNavigate: (folderPath: string | null) => void;
}) {
  const items = useMemo(() => buildDocumentPathSegments(path), [path]);
  return (
    <span className="affairs-detail-path-breadcrumbs">
      <button
        type="button"
        className="affairs-detail-path-segment root"
        onClick={() => onNavigate(null)}
      >
        {rootLabel}
      </button>
      {items.map((item, index) => (
        <Fragment key={`${item.label}:${item.path ?? index}`}>
          <span className="affairs-detail-path-separator" aria-hidden="true">/</span>
          <button
            type="button"
            className={index === items.length - 1 ? "affairs-detail-path-segment current" : "affairs-detail-path-segment"}
            onClick={() => onNavigate(item.path)}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </span>
  );
}

function formatFinderDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const language = userPreferenceStore.getState().profile.language ?? "zh-CN";
  const isEnglish = language === "en-US";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / 86400000);
  const timeLabel = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  if (dayDiff === 0) {
    return `${t("shell.affairsFinderDateToday")} ${timeLabel}`;
  }
  if (dayDiff === 1) {
    return `${t("shell.affairsFinderDateYesterday")} ${timeLabel}`;
  }

  if (isEnglish) {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${timeLabel}`;
}

function formatLibrarySize(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === null || value === undefined || value < 0) {
    return "—";
  }
  const normalized = Number(value);
  if (normalized < 1024) {
    return `${Math.round(normalized)} B`;
  }
  if (normalized < 1024 ** 2) {
    return `${(normalized / 1024).toFixed(1)} KB`;
  }
  if (normalized < 1024 ** 3) {
    return `${(normalized / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${(normalized / 1024 ** 3).toFixed(2)} GB`;
}

function resolveFinderKindLabel(filePath: string) {
  const visual = resolveAffairsDocumentVisual(filePath);
  const extension = visual.extension;
  if (extension === "document") {
    return t("shell.affairsFinderKindFile");
  }

  switch (visual.kind) {
    case "markdown":
      return t("shell.affairsFinderKindMarkdown");
    case "text":
      return t("shell.affairsFinderKindText");
    case "web":
      return t("shell.affairsFinderKindHtml");
    case "json":
      return t("shell.affairsFinderKindJson");
    case "xml":
      return t("shell.affairsFinderKindXml");
    case "yaml":
      return t("shell.affairsFinderKindYaml");
    case "pdf":
      return t("shell.affairsFinderKindPdf");
    case "word":
      return t("shell.affairsFinderKindWord");
    case "spreadsheet":
      return t("shell.affairsFinderKindExcel");
    case "presentation":
      return t("shell.affairsFinderKindPowerPoint");
    case "image":
      return t("shell.affairsFinderKindImage");
    case "archive":
      return t("shell.affairsFinderKindArchive");
    case "code":
      return t("shell.affairsFinderKindCode");
    case "database":
      return extension === "sql" ? t("shell.affairsFinderKindSql") : t("shell.affairsFinderKindDatabase");
    case "audio":
      return t("shell.affairsFinderKindAudio");
    case "video":
      return t("shell.affairsFinderKindVideo");
    case "design":
      return t("shell.affairsFinderKindDesign");
    case "font":
      return t("shell.affairsFinderKindFont");
    case "ebook":
      return t("shell.affairsFinderKindEbook");
    default:
      return extension.toUpperCase();
  }
}
function buildFinderGridTemplateColumns(widths: Record<FinderColumnKey, number>) {
  const normalized = {
    name: Number.isFinite(widths.name) ? widths.name : DEFAULT_FINDER_COLUMN_WIDTHS.name,
    size: Number.isFinite(widths.size) ? widths.size : DEFAULT_FINDER_COLUMN_WIDTHS.size,
    updatedAt: Number.isFinite(widths.updatedAt) ? widths.updatedAt : DEFAULT_FINDER_COLUMN_WIDTHS.updatedAt,
    type: Number.isFinite(widths.type) ? widths.type : DEFAULT_FINDER_COLUMN_WIDTHS.type,
    createdAt: Number.isFinite(widths.createdAt) ? widths.createdAt : DEFAULT_FINDER_COLUMN_WIDTHS.createdAt
  };
  return [
    `minmax(${FINDER_COLUMN_MIN_WIDTHS.name}px, ${Math.round(normalized.name)}px)`,
    `minmax(${FINDER_COLUMN_MIN_WIDTHS.size}px, ${Math.round(normalized.size)}px)`,
    `minmax(${FINDER_COLUMN_MIN_WIDTHS.updatedAt}px, ${Math.round(normalized.updatedAt)}px)`,
    `minmax(${FINDER_COLUMN_MIN_WIDTHS.type}px, ${Math.round(normalized.type)}px)`,
    `minmax(${FINDER_COLUMN_MIN_WIDTHS.createdAt}px, 1fr)`
  ].join(" ");
}

function formatIndexStatusDateTime(value: string) {
  if (!value) {
    return t("common.unknown");
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return t("common.unknown");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("common.unknown");
  }
  return new Intl.DateTimeFormat(userPreferenceStore.getState().profile.language ?? "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildFavoriteNodeId(favorite: AffairsLibraryFavoriteRecordDto) {
  return `library:favorite:${favorite.kind}:${favorite.path}`;
}

function renderFavoriteToggle(
  nodeId: string,
  label: string,
  toggleFavorite: (favorite: AffairsLibraryFavoriteRecordDto) => Promise<void>
) {
  if (nodeId.startsWith("library:folder:")) {
    const favorite: AffairsLibraryFavoriteRecordDto = {
      kind: "folder",
      path: nodeId.slice("library:folder:".length),
      label
    };
    return (
      <button
        type="button"
        className="affairs-favorite-toggle"
        aria-label={t("shell.affairsFavoriteAddAction")}
        onClick={(event) => {
          event.stopPropagation();
          void toggleFavorite(favorite);
        }}
      >
        ☆
      </button>
    );
  }

  if (nodeId.startsWith("library:tag:")) {
    const favorite: AffairsLibraryFavoriteRecordDto = {
      kind: "tag",
      path: nodeId.slice("library:tag:".length),
      label
    };
    return (
      <button
        type="button"
        className="affairs-favorite-toggle"
        aria-label={t("shell.affairsFavoriteAddAction")}
        onClick={(event) => {
          event.stopPropagation();
          void toggleFavorite(favorite);
        }}
      >
        ☆
      </button>
    );
  }

  if (nodeId.startsWith("library:favorite:")) {
    const [, , , kind, ...rest] = nodeId.split(":");
    const favorite: AffairsLibraryFavoriteRecordDto = {
      kind: kind === "tag" ? "tag" : "folder",
      path: rest.join(":"),
      label
    };
    return (
      <button
        type="button"
        className="affairs-favorite-toggle active"
        aria-label={t("shell.affairsFavoriteRemoveAction")}
        onClick={(event) => {
          event.stopPropagation();
          void toggleFavorite(favorite);
        }}
      >
        ★
      </button>
    );
  }

  return null;
}

function matchesFolder(documentPath: string, folderPath: string | null) {
  const normalizedFolderPath = folderPath?.trim() ?? "";
  if (!normalizedFolderPath || normalizedFolderPath === ".") {
    return true;
  }
  return documentPath === normalizedFolderPath || documentPath.startsWith(`${normalizedFolderPath}/`);
}

function matchesTag(record: DocumentRecord, tagPath: string | null) {
  const normalizedTagPath = tagPath?.trim() ?? "";
  if (!normalizedTagPath) {
    return true;
  }
  return [...record.tags, ...record.derivedTags].some((tag) => tag === normalizedTagPath || isTagPathAncestor(normalizedTagPath, tag));
}

function hasDirectTagMatch(record: DocumentRecord, tagPath: string): boolean {
  const normalizedTagPath = tagPath.trim();
  if (!normalizedTagPath) {
    return false;
  }
  return [...record.tags, ...record.derivedTags].some((tag) => tag === normalizedTagPath);
}

function isTagPathAncestor(parentPath: string, childPath: string): boolean {
  return childPath.startsWith(`${parentPath}/`);
}

function parseAllowedExtensionsText(input: string): string[] {
  return input
    .split(/[,\n，\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item.toLowerCase() : `.${item.toLowerCase()}`))
    .filter((item, index, array) => array.indexOf(item) === index)
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function normalizeExtensionToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  const withDot = normalized.startsWith(".") ? normalized : `.${normalized}`;
  return /^.[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(withDot) ? withDot : "";
}

function resolveEditableAllowedExtensions(input: readonly string[]): string[] {
  const normalized = sortAllowedExtensions(input);
  if (normalized.length > 0) {
    return normalized;
  }
  return [...AFFAIRS_LIBRARY_PRESET_EXTENSIONS];
}

function shouldPersistImplicitAllowedExtensions(
  configuredExtensions: readonly string[],
  selectedExtensions: readonly string[]
): boolean {
  const normalizedConfigured = sortAllowedExtensions(configuredExtensions);
  if (normalizedConfigured.length > 0) {
    return false;
  }
  return areSortedStringListsEqual(
    sortAllowedExtensions(AFFAIRS_LIBRARY_PRESET_EXTENSIONS),
    sortAllowedExtensions(selectedExtensions)
  );
}

function buildAllowedExtensionOptions(selectedExtensions: readonly string[]): string[] {
  return sortAllowedExtensions([
    ...AFFAIRS_LIBRARY_PRESET_EXTENSIONS,
    ...selectedExtensions
  ]);
}

function sortAllowedExtensions(input: readonly string[]): string[] {
  return Array.from(new Set(
    input
      .map((item) => normalizeExtensionToken(item))
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function areSortedStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function resolveIndexStatusLabel(status: AffairsLibraryIndexStatusDto | null) {
  if (!status) {
    return t("shell.affairsLibraryStatusIdle");
  }

  switch (status.state) {
    case "queued":
      return t("shell.affairsLibraryStatusQueued");
    case "running":
      return t("shell.affairsLibraryStatusRunning");
    case "queue_timeout":
      return t("shell.affairsLibraryStatusQueueTimeout");
    case "cooldown":
      return t("shell.affairsLibraryStatusCooldown");
    case "failed":
      return t("shell.affairsLibraryStatusFailed");
    case "stale":
      return t("shell.affairsLibraryStatusStale");
    case "fresh":
    default:
      return t("shell.affairsLibraryStatusFresh");
  }
}

function buildIndexStatusPopoverModel(
  status: AffairsLibraryIndexStatusDto | null,
  directoryStatus: AffairsLibraryDocumentListDto["directoryStatus"]
) : IndexStatusPopoverModel {
  const primaryRows: IndexStatusPopoverRow[] = [
    {
      label: t("shell.affairsLibraryStatusCurrentLabel"),
      value: resolveIndexStatusLabel(status)
    }
  ];
  const overviewRows: IndexStatusPopoverRow[] = [];
  const timelineRows: IndexStatusPopoverRow[] = [];
  const progressRows: IndexStatusPopoverRow[] = [];
  const directoryRows: IndexStatusPopoverRow[] = [];
  const workerRows: IndexStatusPopoverRow[] = [];

  if (!status) {
    return {
      summaryMetrics: [],
      primaryRows,
      technicalSections: []
    };
  }

  const summaryMetrics: IndexStatusPopoverMetric[] = status.progress ? [
    {
      label: t("shell.affairsLibraryStatusSummaryTotalLabel"),
      value: formatIndexStatusMetricValue(status.progress.totalCount)
    },
    {
      label: t("shell.affairsLibraryStatusSummaryScannedLabel"),
      value: String(status.progress.scannedCount)
    },
    {
      label: t("shell.affairsLibraryStatusSummaryIssueLabel"),
      value: String(status.progress.failedCount),
      tone: status.progress.failedCount > 0 ? "danger" : "default"
    },
    {
      label: t("shell.affairsLibraryStatusSummaryUpdatedLabel"),
      value: String(status.progress.indexedCount),
      tone: status.progress.indexedCount > 0 ? "success" : "default"
    }
  ] : [];

  pushIndexStatusDetail(timelineRows, t("shell.affairsLibraryStatusLastRequestedAtLabel"), status.lastRequestedAt);
  pushIndexStatusDetail(timelineRows, t("shell.affairsLibraryStatusLastStartedAtLabel"), status.lastStartedAt);
  pushIndexStatusDetail(timelineRows, t("shell.affairsLibraryStatusLastCompletedAtLabel"), status.lastCompletedAt);
  pushIndexStatusDetail(timelineRows, t("shell.affairsLibraryStatusLastFailedAtLabel"), status.lastFailedAt);
  pushIndexStatusDetail(timelineRows, t("shell.affairsLibraryStatusNextAllowedAtLabel"), status.nextAllowedAt);

  if (status.runningTaskId?.trim()) {
    overviewRows.push({
      label: t("shell.affairsLibraryStatusRunningTaskIdLabel"),
      value: status.runningTaskId.trim(),
      multiline: true
    });
  }

  if (status.runningStage?.trim()) {
    primaryRows.push({
      label: t("shell.affairsLibraryStatusRunningStageLabel"),
      value: resolveIndexStatusStageLabel(status.runningStage.trim())
    });
  }

  if (status.progress) {
    progressRows.push({
      label: t("shell.affairsLibraryStatusProgressUnchangedLabel"),
      value: String(status.progress.unchangedCount)
    });
    progressRows.push({
      label: t("shell.affairsLibraryStatusProgressSkippedLabel"),
      value: String(status.progress.skippedCount)
    });
    progressRows.push({
      label: t("shell.affairsLibraryStatusProgressFailedLabel"),
      value: String(status.progress.failedCount)
    });
  }

  if (status.dirtyReasons.length > 0) {
    overviewRows.push({
      label: t("shell.affairsLibraryStatusDirtyReasonsLabel"),
      value: status.dirtyReasons.join("、"),
      multiline: true
    });
  }

  if (status.errorSummary?.trim()) {
    primaryRows.push({
      label: t("shell.affairsLibraryStatusErrorSummaryLabel"),
      value: status.errorSummary.trim(),
      multiline: true
    });
  }

  if (directoryStatus?.path?.trim()) {
    primaryRows.push({
      label: t("shell.affairsLibraryDirectoryStatusPathLabel"),
      value: directoryStatus.path === "." ? t("shell.affairsLibraryDirectoryStatusRootPath") : directoryStatus.path
    });
    primaryRows.push({
      label: t("shell.affairsLibraryDirectoryStatusStateLabel"),
      value: resolveDirectoryStatusLabel(directoryStatus.state)
    });
    directoryRows.push({
      label: t("shell.affairsLibraryDirectoryStatusSourceLabel"),
      value: resolveDirectoryStatusSourceLabel(directoryStatus.source)
    });
    pushIndexStatusDetail(
      directoryRows,
      t("shell.affairsLibraryDirectoryStatusLastRequestedAtLabel"),
      directoryStatus.lastRequestedAt
    );
    pushIndexStatusDetail(
      directoryRows,
      t("shell.affairsLibraryDirectoryStatusLastCompletedAtLabel"),
      directoryStatus.lastCompletedAt
    );
    pushIndexStatusDetail(
      directoryRows,
      t("shell.affairsLibraryDirectoryStatusLastFailedAtLabel"),
      directoryStatus.lastFailedAt
    );
    if (directoryStatus.runningTaskId?.trim()) {
      directoryRows.push({
        label: t("shell.affairsLibraryDirectoryStatusRunningTaskIdLabel"),
        value: directoryStatus.runningTaskId.trim(),
        multiline: true
      });
    }
    if (directoryStatus.errorSummary?.trim()) {
      directoryRows.push({
        label: t("shell.affairsLibraryDirectoryStatusErrorSummaryLabel"),
        value: directoryStatus.errorSummary.trim(),
        multiline: true
      });
    }
    pushIndexStatusDetail(
      directoryRows,
      t("shell.affairsLibraryDirectoryStatusGeneratedAtLabel"),
      directoryStatus.generatedAt ?? null
    );
    pushIndexStatusDetail(
      directoryRows,
      t("shell.affairsLibraryDirectoryStatusFilesystemObservedAtLabel"),
      directoryStatus.filesystemObservedAt ?? null
    );
    if (directoryStatus.staleReason?.trim()) {
      directoryRows.push({
        label: t("shell.affairsLibraryDirectoryStatusStaleReasonLabel"),
        value: directoryStatus.staleReason.trim(),
        multiline: true
      });
    }
  }

  if (status.workerHealth) {
    const workerHealth = status.workerHealth;
    workerRows.push({
      label: t("shell.affairsLibraryWorkerHealthStateLabel"),
      value: resolveWorkerHealthStateLabel(workerHealth.state)
    });
    workerRows.push({
      label: t("shell.affairsLibraryWorkerHealthPidLabel"),
      value: workerHealth.pid === null ? t("common.none") : String(workerHealth.pid)
    });
    workerRows.push({
      label: t("shell.affairsLibraryWorkerHealthLocalInflightLabel"),
      value: String(workerHealth.inflightLocalCount)
    });
    workerRows.push({
      label: t("shell.affairsLibraryWorkerHealthRemoteInflightLabel"),
      value: String(workerHealth.inflightRemoteRequestCount)
    });
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthStartedAtLabel"), workerHealth.startedAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthHeartbeatLabel"), workerHealth.lastHeartbeatAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthLastStartedAtLabel"), workerHealth.lastStartedAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthLastCompletedAtLabel"), workerHealth.lastCompletedAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthLastFailedAtLabel"), workerHealth.lastFailedAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthSoftCancelAtLabel"), workerHealth.lastSoftCancelRequestedAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthHardKillAtLabel"), workerHealth.lastHardKillAt);
    pushIndexStatusDetail(workerRows, t("shell.affairsLibraryWorkerHealthLastExitAtLabel"), workerHealth.lastExitAt);
    if (workerHealth.lastTerminationReason?.trim()) {
      workerRows.push({
        label: t("shell.affairsLibraryWorkerHealthTerminationReasonLabel"),
        value: workerHealth.lastTerminationReason.trim(),
        multiline: true
      });
    }
  }

  const sections: IndexStatusPopoverSection[] = [];
  pushIndexStatusSection(sections, t("shell.affairsLibraryStatusSectionOverviewTitle"), overviewRows);
  pushIndexStatusSection(sections, t("shell.affairsLibraryStatusSectionTimelineTitle"), timelineRows);
  pushIndexStatusSection(sections, t("shell.affairsLibraryStatusSectionProgressTitle"), progressRows);
  pushIndexStatusSection(sections, t("shell.affairsLibraryStatusSectionDirectoryTitle"), directoryRows);
  pushIndexStatusSection(sections, t("shell.affairsLibraryStatusSectionWorkerTitle"), workerRows);

  return {
    summaryMetrics,
    primaryRows,
    technicalSections: sections
  };
}

function pushIndexStatusDetail(
  details: IndexStatusPopoverRow[],
  label: string,
  value: string | null
) {
  if (!value) {
    return;
  }

  details.push({
    label,
    value: formatIndexStatusDateTime(value)
  });
}

function pushIndexStatusSection(
  sections: IndexStatusPopoverSection[],
  title: string,
  rows: IndexStatusPopoverRow[]
) {
  if (rows.length === 0) {
    return;
  }

  sections.push({
    title,
    rows
  });
}

function formatIndexStatusMetricValue(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  return String(value);
}

function resolveIndexStatusInlineProgressLabel(status: AffairsLibraryIndexStatusDto | null): string | null {
  if (status?.state !== "running" || !status.progress) {
    return null;
  }
  return t("shell.affairsLibraryStatusIndicatorProgress", {
    scanned: status.progress.scannedCount,
  });
}

function resolveIndexStatusStageLabel(stage: string) {
  switch (stage) {
    case "init":
      return t("shell.affairsLibraryStatusStageInit");
    case "apply_config":
      return t("shell.affairsLibraryStatusStageApplyConfig");
    case "index":
      return t("shell.affairsLibraryStatusStageIndex");
    case "incremental_index":
      return t("shell.affairsLibraryStatusStageIncrementalIndex");
    case "recompute_tags":
      return t("shell.affairsLibraryStatusStageRecomputeTags");
    case "export":
      return t("shell.affairsLibraryStatusStageExport");
    case "export_meta_detail":
      return t("shell.affairsLibraryStatusStageExportMetaDetail");
    case "export_tag":
      return t("shell.affairsLibraryStatusStageExportTag");
    case "export_relation":
      return t("shell.affairsLibraryStatusStageExportRelation");
    case "export_search":
      return t("shell.affairsLibraryStatusStageExportSearch");
    case "sqlite":
      return t("shell.affairsLibraryStatusStageSqlite");
    case "queued":
      return t("shell.affairsLibraryStatusStageQueued");
    default:
      return stage;
  }
}

function resolveDirectoryStatusLabel(state: string) {
  switch (state) {
    case "queued":
      return t("shell.affairsLibraryDirectoryStatusQueued");
    case "running":
      return t("shell.affairsLibraryDirectoryStatusRunning");
    case "queue_timeout":
      return t("shell.affairsLibraryDirectoryStatusQueueTimeout");
    case "fresh":
      return t("shell.affairsLibraryDirectoryStatusFresh");
    case "failed":
      return t("shell.affairsLibraryDirectoryStatusFailed");
    case "idle":
    default:
      return t("shell.affairsLibraryDirectoryStatusIdle");
  }
}

function resolveDirectoryStatusSourceLabel(source: string) {
  switch (source) {
    case "live":
      return t("shell.affairsLibraryDirectoryStatusSourceLive");
    case "snapshot":
      return t("shell.affairsLibraryDirectoryStatusSourceSnapshot");
    case "stale_fallback":
      return t("shell.affairsLibraryDirectoryStatusSourceStaleFallback");
    case "mixed":
    default:
      return t("shell.affairsLibraryDirectoryStatusSourceMixed");
  }
}

function resolveWorkerHealthStateLabel(state: string) {
  switch (state) {
    case "running":
      return t("shell.affairsLibraryWorkerHealthStateRunning");
    case "terminating":
      return t("shell.affairsLibraryWorkerHealthStateTerminating");
    case "recycled":
      return t("shell.affairsLibraryWorkerHealthStateRecycled");
    case "idle":
    default:
      return t("shell.affairsLibraryWorkerHealthStateIdle");
  }
}

function resolveLibraryEmptyText(status: AffairsLibraryIndexStatusDto | null) {
  if (!status) {
    return t("shell.affairsLibraryEmpty");
  }

  if (status.state === "running") {
    return t("shell.affairsLibraryEmptyRunning");
  }

  return status.errorSummary?.trim() || t("shell.affairsLibraryEmpty");
}

function resolveLibraryDetailEmptyText(status: AffairsLibraryIndexStatusDto | null) {
  if (!status) {
    return t("shell.affairsDetailEmpty");
  }

  if (status.state === "running") {
    return t("shell.affairsAssistantWaitingDocument");
  }

  return status.errorSummary?.trim() || t("shell.affairsDetailEmpty");
}

