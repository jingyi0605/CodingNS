import {
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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

import { DesktopModal } from "../../../components/DesktopModal";
import { ModalActions, ModalEmptyState, ModalField, ModalList, ModalListItem, ModalSection, ModalTag } from "../../../components/ModalAtoms";
import { MobileSheet } from "../../../components/MobileSheet";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type {
  AssistantAutomationRunDto,
  AssistantAutomationTaskDto,
  ButlerFollowUpTaskDto,
  ButlerInboxItemDto
} from "../../butler/api/butler-api";
import {
  listAssistantAutomations,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listRecentAssistantAutomationRuns
} from "../../butler/api/butler-api";
import { ButlerAnchoredPopover } from "../../butler/components/ButlerAnchoredPopover";
import { ButlerRuntimeStore, useButlerRuntimeStore } from "../../butler/runtime/butler-runtime-store";
import type {
  AffairsDocumentTagDetailsDto,
  AffairsFolderTagDetailsDto,
  AffairsLibraryBindingDto,
  AffairsLibraryConfigDto,
  AffairsLibraryDocumentListDto,
  AffairsLibraryDocumentRecordDto,
  AffairsLibraryFavoriteRecordDto,
  AffairsLibraryFolderNodeDto,
  AffairsLibraryIndexStatusDto,
  AffairsLibrarySnapshotDto,
  AffairsLibraryTagNodeDto,
  AffairsTagDetailWithRulesDto,
  AffairsTagNodeDto,
  AffairsTagRuleDto,
} from "../../conversation/api/conversation-api";
import {
  createAffairsTag,
  createWorkspaceDirectory,
  deleteAffairsTag,
  getAffairsDocumentTagDetails,
  getAffairsFolderTagDetails,
  getAffairsTagDetail,
  listAffairsTags,
  getAffairsLibraryConfig,
  getAffairsLibraryPreview,
  getAffairsLibrarySnapshot,
  downloadAffairsLibraryFile,
  listAffairsLibraryDocuments,
  operateAffairsLibraryFile,
  requestAffairsLibraryRefresh,
  saveAffairsDocumentTags,
  saveAffairsDocumentTagsWithCreate,
  saveAffairsFolderTags,
  saveAffairsFolderTagsWithCreate,
  saveAffairsLibraryBinding,
  saveAffairsLibraryConfig,
  setAffairsLibraryEnabled,
  updateAffairsTag,
  updateAffairsLibraryFavorites
} from "../../conversation/api/conversation-api";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { FileViewerPanel } from "../../conversation/components/FileViewerModal";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { PermissionRequestList } from "../../conversation/components/PermissionRequestList";
import { WorkspaceImportBrowserModal } from "../../conversation/components/WorkspaceImportBrowserModal";
import { getPathLeafName } from "../../conversation/components/file-entry-visibility";
import { buildConversationTimelineSourceItems } from "../../conversation/timeline-source-items";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import {
  showDesktopContextMenu,
  type DesktopContextMenuItem
} from "../../../platform/desktop/desktop-context-menu";
import { usePlatform } from "../../../platform/platform-provider";
import { resolveContextMenuPosition } from "../utils/context-menu-position";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import {
  computeVirtualGridMetrics,
  shouldVirtualizeAffairsGrid
} from "../utils/affairs-grid";
import {
  resolveAffairsDocumentExtension,
  resolveAffairsDocumentVisual,
  type AffairsDocumentKind
} from "../utils/affairs-document-visual";
import type {
  AffairsAuxiliaryTab,
  AffairsObjectContext,
  AffairsPrimarySection,
  AffairsViewState
} from "../types/workbench-mode";

interface AffairsWorkbenchProviderProps {
  workspaceId: string;
  workspaceName: string | null;
  navigationGroups: WorkspaceSessionGroup[];
  state: AffairsViewState;
  onStateChange: (nextState: AffairsViewState) => void;
  children: ReactNode;
}

interface AffairsWorkbenchViewProps {
  workspaceId: string;
}

interface AffairsAuxiliaryPanelProps {
  workspaceId: string;
  onToggleCollapse?: () => void;
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
const AFFAIRS_LIBRARY_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
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
  tone?: "default" | "favorite" | "tag" | "source" | "automation";
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

type AffairsSelectedObject =
  | {
      section: "library";
      record: DocumentRecord | null;
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
  state: AffairsViewState;
  activeSection: AffairsPrimarySection;
  loading: boolean;
  error: string | null;
  libraryLoading: boolean;
  libraryDocumentsLoading: boolean;
  libraryRefreshPending: boolean;
  libraryDocumentTotal: number;
  libraryDocumentHasMore: boolean;
  binding: AffairsLibraryBindingDto | null;
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
  openLibraryViewer: (record: DocumentRecord) => void;
  selectSection: (section: AffairsPrimarySection) => void;
  selectSidebarNode: (nodeId: string) => void;
  selectObject: (objectId: string | null) => void;
  selectAuxiliaryTab: (tab: AffairsAuxiliaryTab) => void;
  setLibraryBrowseMode: (mode: "folder" | "tag") => void;
  setLibraryViewMode: (mode: "grid" | "list") => void;
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
  saveDocumentTagSelection: (documentId: string, tagIds: string[], createTagPaths?: string[]) => Promise<void>;
  saveFolderTagSelection: (folderPath: string, tagIds: string[], createTagPaths?: string[]) => Promise<void>;
}

const AffairsWorkbenchContext = createContext<AffairsWorkbenchContextValue | null>(null);

export function AffairsWorkbenchProvider({
  workspaceId,
  workspaceName,
  navigationGroups,
  state,
  onStateChange,
  children
}: AffairsWorkbenchProviderProps) {
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
  const [libraryLoading, setLibraryLoading] = useState(initialLibrarySnapshot === null);
  const [todoLoading, setTodoLoading] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
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
  const [inboxItems, setInboxItems] = useState<ButlerInboxItemDto[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<ButlerFollowUpTaskDto[]>([]);
  const [automations, setAutomations] = useState<AssistantAutomationTaskDto[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AssistantAutomationRunDto[]>([]);
  const { showToast } = useToast();
  const binding = librarySnapshot?.binding ?? null;
  const indexStatus = librarySnapshot?.status ?? null;
  const currentDirectoryStatus = libraryDocumentPage?.directoryStatus ?? null;
  const activeSection = normalizeSection(state.primarySection);
  const recentFileActivationRef = useRef<{ path: string; timestamp: number } | null>(null);
  const librarySnapshotRef = useRef<AffairsLibrarySnapshotDto | null>(initialLibrarySnapshot);
  const directoryHintKeyRef = useRef<string | null>(null);
  const directoryHintBootstrappedRef = useRef(false);

  useEffect(() => {
    librarySnapshotRef.current = librarySnapshot;
  }, [librarySnapshot]);

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
    librarySnapshot?.status.state,
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
  const selectedTagPaths = useMemo(() => resolveSelectedTagPaths(state), [state]);
  const libraryTagFacetCounts = useMemo(
    () => libraryDocumentPage?.tagFacetCounts ?? {},
    [libraryDocumentPage?.tagFacetCounts]
  );

  useEffect(() => {
    if (activeSection !== "library" || !binding?.enabled || state.browseMode !== "folder") {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pollIntervalMs = currentDirectoryStatus?.state === "queued"
      || currentDirectoryStatus?.state === "running"
      || indexStatus?.state === "running"
      ? AFFAIRS_LIBRARY_DIRECTORY_POLL_ACTIVE_MS
      : AFFAIRS_LIBRARY_DIRECTORY_POLL_IDLE_MS;

    const pollDirectory = async () => {
      try {
        const response = await listAffairsLibraryDocuments(workspaceId, {
          browseMode: "folder",
          selectedFolderPath: state.selectedFolderPath,
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
    state.selectedFolderPath,
    state.selectedTagPath,
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
    if (activeSection !== "library" || !binding) {
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
      selectedFolderPath: state.selectedFolderPath,
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
    binding,
    librarySnapshot?.status.lastCompletedAt,
    state.browseMode,
    state.selectedFavoriteId,
    state.selectedFolderPath,
    state.selectedTagPath,
    selectedTagPaths,
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
        selectedFolderPath: state.selectedFolderPath,
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
  const filteredTodoRecords = useMemo(() => {
    if (activeSection !== "todo") {
      return [];
    }

    if (!state.selectedNodeId || state.selectedNodeId === "todo:all") {
      return todoRecords;
    }

    if (state.selectedNodeId === "todo:inbox") {
      return todoRecords.filter((item) => item.kind === "inbox");
    }

    if (state.selectedNodeId === "todo:follow_up") {
      return todoRecords.filter((item) => item.kind === "follow_up");
    }

    return todoRecords;
  }, [activeSection, state.selectedNodeId, todoRecords]);
  const automationRecords = useMemo(
    () => buildAutomationRecords(automations, sessionTitleById),
    [automations, sessionTitleById]
  );
  const loading =
    activeSection === "library"
      ? libraryLoading
      : activeSection === "todo"
        ? todoLoading
        : automationLoading;
  const error =
    activeSection === "library"
      ? libraryError
      : activeSection === "todo"
        ? todoError
        : automationError;

  const selectedObject = useMemo<AffairsSelectedObject>(() => {
    if (activeSection === "library") {
      const selectedId = state.selectedDocumentId ?? state.selectedObjectId;
      const record = filteredDocuments.find((item) => item.id === selectedId) ?? null;
      return {
        section: "library",
        record
      };
    }

    if (activeSection === "todo") {
      const record = filteredTodoRecords.find((item) => item.id === state.selectedObjectId) ?? filteredTodoRecords[0] ?? null;
      return {
        section: "todo",
        record
      };
    }

    const record = automationRecords.find((item) => item.id === state.selectedObjectId) ?? automationRecords[0] ?? null;
    return {
      section: "automation",
      record
    };
  }, [activeSection, automationRecords, filteredDocuments, filteredTodoRecords, state.selectedDocumentId, state.selectedObjectId]);

  useEffect(() => {
    if (selectedObject.section === "library" && selectedObject.record?.id) {
      void getAffairsDocumentTagDetails(workspaceId, selectedObject.record.id)
        .then(setDocumentTagDetails)
        .catch(() => setDocumentTagDetails(null));
      return;
    }
    setDocumentTagDetails(null);
  }, [selectedObject, workspaceId]);

  useEffect(() => {
    if (selectedObject.section === "library" && !selectedObject.record) {
      const folderPath = state.selectedFolderPath?.trim() ?? ".";
      void getAffairsFolderTagDetails(workspaceId, folderPath)
        .then(setFolderTagDetails)
        .catch(() => setFolderTagDetails(null));
      return;
    }
    setFolderTagDetails(null);
  }, [selectedObject, state.selectedFolderPath, workspaceId]);

  useEffect(() => {
    const selectedId = selectedObject.record?.id ?? null;
    const defaultNodeId = resolveDefaultNodeId(activeSection, automationRecords, binding);

    const nextState: AffairsViewState = {
      ...state,
      primarySection: activeSection,
      selectedNodeId: activeSection === "library" ? state.selectedNodeId ?? defaultNodeId : state.selectedNodeId ?? defaultNodeId,
      selectedObjectId: selectedId,
      selectedDocumentId: activeSection === "library" ? selectedId : state.selectedDocumentId
    };

    if (JSON.stringify(nextState) === JSON.stringify(state)) {
      return;
    }

    onStateChange(nextState);
  }, [activeSection, automationRecords, binding, onStateChange, selectedObject.record, state]);

  const assistantContext = useMemo<AffairsObjectContext | null>(() => {
    if (selectedObject.section === "library") {
      const record = selectedObject.record;
      return record
        ? {
            objectType: "document",
            objectId: record.id,
            title: record.displayName,
            summary: record.summary,
            sourceRef: record.fullPath ?? record.filePath,
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

  const sidebarNodes = useMemo<AffairsSidebarNode[]>(() => {
    if (activeSection === "library") {
      return [];
    }

    if (activeSection === "todo") {
      return [
        {
          id: "todo:all",
          label: t("shell.affairsTodoAllFilter"),
          count: todoRecords.length,
          summary: t("shell.affairsTodoAllFilterSummary"),
          tone: "default"
        },
        {
          id: "todo:inbox",
          label: t("shell.affairsTodoInboxFilter"),
          count: todoRecords.filter((item) => item.kind === "inbox").length,
          summary: t("shell.affairsTodoInboxSummary"),
          tone: "source"
        },
        {
          id: "todo:follow_up",
          label: t("shell.affairsTodoFollowUpFilter"),
          count: todoRecords.filter((item) => item.kind === "follow_up").length,
          summary: t("shell.affairsTodoFollowUpSummary"),
          tone: "source"
        }
      ];
    }

    return automationRecords.map<AffairsSidebarNode>((record) => ({
      id: `automation:item:${record.id}`,
      label: record.title,
      summary: `${record.triggerLabel} · ${record.statusLabel}`,
      tone: "automation"
    }));
  }, [activeSection, automationRecords, documentRecords.length, favoriteEntries, folderRecords, state.browseMode, tagRecords, todoRecords]);

  const contextValue = useMemo<AffairsWorkbenchContextValue>(() => ({
    workspaceId,
    workspaceName,
    state,
    activeSection,
    loading,
    error,
    libraryLoading,
    libraryDocumentsLoading,
    libraryRefreshPending,
    libraryDocumentTotal: libraryDocumentPage?.total ?? 0,
    libraryDocumentHasMore: (libraryDocumentPage?.items.length ?? 0) < (libraryDocumentPage?.total ?? 0),
    binding,
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
    auxiliaryTab: state.auxiliaryTab ?? "detail",
    toolbarExpanded: state.toolbarExpanded,
    detailViewerCollapsed: state.detailViewerCollapsed,
    selectSection: (section) => {
      onStateChange({
        ...state,
        primarySection: section,
        selectedNodeId: resolveDefaultNodeId(section, automationRecords, binding),
        selectedObjectId: null,
        selectedDocumentId: section === "library" ? null : state.selectedDocumentId
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
          selectedTagPath: null,
          selectedTagPaths: [],
          selectedObjectId: null,
          selectedDocumentId: null
        });
        return;
      }

      onStateChange({
        ...state,
        selectedNodeId: nodeId,
        selectedObjectId: null
      });
    },
    selectObject: (objectId) => {
      onStateChange({
        ...state,
        selectedObjectId: objectId,
        selectedDocumentId: activeSection === "library" ? objectId : state.selectedDocumentId
      });
    },
    selectAuxiliaryTab: (tab) => {
      onStateChange({
        ...state,
        auxiliaryTab: tab
      });
    },
    setLibraryBrowseMode: (mode) => {
      onStateChange({
        ...state,
        browseMode: mode,
        selectedNodeId: mode === "folder" ? "library:all" : "library:tag-root",
        selectedFavoriteId: null,
        selectedFolderPath: null,
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
    navigateLibraryFolder: (folderPath) => {
      onStateChange({
        ...state,
        browseMode: "folder",
        selectedNodeId: folderPath?.trim() ? `library:folder:${folderPath}` : "library:all",
        selectedFolderPath: folderPath?.trim() || null,
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
    openLibraryViewer: (record) => {
      setViewerState({
        filePath: record.filePath,
        title: record.displayName
      });
    },
    saveLibraryBinding: async (rootDir) => {
      await saveAffairsLibraryBinding(workspaceId, { rootDir });
      const [snapshot, config] = await Promise.all([
        getAffairsLibrarySnapshot(workspaceId),
        getAffairsLibraryConfig(workspaceId)
      ]);
      setLibrarySnapshot((previous) => areLibrarySnapshotsEqual(previous, snapshot) ? previous : snapshot);
      setLibraryConfig((previous) => areLibraryConfigsEqual(previous, config) ? previous : config);
      writeCachedLibrarySnapshot(workspaceId, snapshot);
      writeCachedLibraryConfig(workspaceId, config);
    },
    setLibraryEnabled: async (enabled) => {
      await setAffairsLibraryEnabled(workspaceId, { enabled });
      const [snapshot, config] = await Promise.all([
        getAffairsLibrarySnapshot(workspaceId),
        getAffairsLibraryConfig(workspaceId)
      ]);
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
      const response = await updateAffairsLibraryFavorites(workspaceId, {
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
    reloadTagManagement,
    selectManagedTag: async (tagId) => {
      if (!tagId) {
        setSelectedManagedTag(null);
        return;
      }
      setSelectedManagedTag(await getAffairsTagDetail(workspaceId, tagId));
    },
    saveManagedTag: async (input) => {
      const saved = input.tagId
        ? await updateAffairsTag(workspaceId, input.tagId, input)
        : await createAffairsTag(workspaceId, input);
      setSelectedManagedTag(saved);
      await reloadTagManagement();
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
    saveDocumentTagSelection: async (documentId, tagIds, createTagPaths = []) => {
      if (createTagPaths.length > 0) {
        await saveAffairsDocumentTagsWithCreate(workspaceId, documentId, { tagIds, createTagPaths });
      } else {
        await saveAffairsDocumentTags(workspaceId, documentId, { tagIds });
      }
      if (createTagPaths.length > 0) {
        await reloadTagManagement();
      }
      setDocumentTagDetails(await getAffairsDocumentTagDetails(workspaceId, documentId));
      await refreshLibraryNow();
    },
    saveFolderTagSelection: async (folderPath, tagIds, createTagPaths = []) => {
      if (createTagPaths.length > 0) {
        await saveAffairsFolderTagsWithCreate(workspaceId, { folderPath, tagIds, createTagPaths });
      } else {
        await saveAffairsFolderTags(workspaceId, { folderPath, tagIds });
      }
      if (createTagPaths.length > 0) {
        await reloadTagManagement();
      }
      setFolderTagDetails(await getAffairsFolderTagDetails(workspaceId, folderPath));
      await refreshLibraryNow();
    }
  }), [
    activeSection,
    assistantContext,
    automationRecords,
    automationRuns,
    binding,
    libraryConfig,
    documentRecords,
    error,
    favoriteDocuments,
    favoriteEntries,
    favoriteFolderPathSet,
    filteredDocuments,
    filteredTodoRecords,
    folderRecords,
    indexStatus,
    currentDirectoryStatus,
    libraryDocumentPage,
    libraryDocumentsLoading,
    libraryLoading,
    libraryRefreshPending,
    librarySnapshot,
    loadMoreLibraryDocuments,
    loading,
    managedTags,
    onStateChange,
    selectedManagedTag,
    selectedObject,
    sidebarNodes,
    selectedTagPaths,
    state,
    tagRecords,
    todoRecords,
    tagManagementOpen,
    documentTagDetails,
    folderTagDetails,
    refreshLibraryNow,
    viewerState,
    showToast,
    workspaceId,
    workspaceName
  ]);

  return (
    <AffairsWorkbenchContext.Provider value={contextValue}>
      {children}
      <AffairsLibraryFileViewerModal
        workspaceId={workspaceId}
        viewerState={viewerState}
        onClose={() => setViewerState(null)}
      />
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
        className={activeSection === "todo" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "todo"}
        onClick={() => selectSection("todo")}
      >
        <AffairsTodoIcon />
        <span>{t("shell.affairsTodoNav")}</span>
      </button>
      <button
        type="button"
        className={activeSection === "automation" ? "workbench-nav-segment-button active" : "workbench-nav-segment-button"}
        role="tab"
        aria-selected={activeSection === "automation"}
        onClick={() => selectSection("automation")}
      >
        <AffairsAutomationIcon />
        <span>{t("shell.affairsAutomationNav")}</span>
      </button>
    </div>
  );
}

export function AffairsSidebarPanel() {
  const {
    activeSection,
    binding,
    openTagManagement,
    documentRecords,
    favoriteEntries,
    folderRecords,
    indexStatus,
    sidebarNodes,
    state,
    tagRecords,
    libraryTagFacetCounts,
    toggleFavorite,
    todoRecords,
    automationRecords,
    selectSidebarNode,
    selectedTagPaths,
    loading,
    error,
    libraryDocumentTotal
  } = useAffairsWorkbenchInternal();

  if (activeSection !== "library") {
    const groupedSidebarNodes = groupSidebarNodes(activeSection, sidebarNodes);
    return (
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
    if (state.browseMode !== "tag") {
      return;
    }
    if (selectedTagPaths.length === 0) {
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
  }, [selectedTagPaths, state.browseMode, tagTree, visibleTagTree]);

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

export function AffairsWorkbenchView({ workspaceId }: AffairsWorkbenchViewProps) {
  const {
    activeSection,
    binding,
    documentRecords,
    favoriteEntries,
    filteredDocuments,
    filteredTodoRecords,
    automationRecords,
    folderRecords,
    tagRecords,
    indexStatus,
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
    selectObject,
    navigateLibraryFolder,
    navigateLibraryTag,
    libraryDocumentsLoading,
    libraryRefreshPending,
    libraryDocumentHasMore,
    loadMoreLibraryDocuments,
    refreshLibrary,
    setLibraryViewMode,
    selectSidebarNode
  } = useAffairsWorkbenchInternal();
  const stageScrollRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stageViewportHeight, setStageViewportHeight] = useState(0);
  const [stageViewportWidth, setStageViewportWidth] = useState(0);
  const [stageScrollTop, setStageScrollTop] = useState(0);
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
  const gridMetrics = useMemo(
    () => computeVirtualGridMetrics(sortedLibraryEntries.length, stageViewportWidth, stageViewportHeight, stageScrollTop),
    [sortedLibraryEntries.length, stageViewportHeight, stageViewportWidth, stageScrollTop]
  );
  const visibleGridEntries = useMemo(
    () => sortedLibraryEntries.slice(gridMetrics.startIndex, gridMetrics.endIndex),
    [gridMetrics.endIndex, gridMetrics.startIndex, sortedLibraryEntries]
  );
  const listMetrics = useMemo(
    () => computeVirtualListMetrics(sortedLibraryEntries.length, stageViewportHeight, stageScrollTop),
    [sortedLibraryEntries.length, stageViewportHeight, stageScrollTop]
  );
  const visibleListEntries = useMemo(
    () => sortedLibraryEntries.slice(listMetrics.startIndex, listMetrics.endIndex),
    [sortedLibraryEntries, listMetrics.endIndex, listMetrics.startIndex]
  );
  const shouldVirtualizeGrid = shouldVirtualizeAffairsGrid(
    sortedLibraryEntries.length,
    stageViewportWidth,
    stageViewportHeight
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
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining <= 320) {
        void loadMoreLibraryDocuments();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeSection, libraryDocumentHasMore, libraryDocumentsLoading, loadMoreLibraryDocuments, state.viewMode]);

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
      onDownload: target.kind === "document" ? () => handleDownload(target) : null,
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
      onDelete: target.kind === "document" || target.kind === "folder" ? () => handleDeleteTarget(target) : null,
      onCreateDirectory: () => handleRequestCreate(target, "directory"),
      onCreateMarkdownFile: () => handleRequestCreate(target, "markdown"),
      onCreateTextFile: () => handleRequestCreate(target, "text"),
      onCreateCustomFile: () => handleRequestCreate(target, "custom"),
      onRefresh: () => refreshLibrary(),
      onOpenTagAssignment: target.kind === "document" || target.kind === "folder"
        ? () => openTagAssignmentTarget(target)
        : null,
      onProperties: () => selectObject(target.kind === "document" ? target.record.id : null)
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

  async function handleDeleteTarget(target: Extract<LibraryContextMenuTarget, { kind: "document" | "folder" }>) {
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
          <button type="button" role="menuitem" className="danger" onClick={() => void runContextAction(() => handleDeleteTarget(target))}>
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
          <button type="button" role="menuitem" onClick={() => void runContextAction(() => selectObject(target.kind === "document" ? target.record.id : null))}>
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

  return (
    <div className="affairs-main-panel">
      <section className="affairs-stage-panel">
        {loading ? <AffairsStageSkeleton viewMode={state.viewMode} /> : null}
        {error ? <div className="affairs-stage-empty">{error}</div> : null}
        {!loading && !error ? (
          activeSection === "library" ? (
            !binding ? (
              <AffairsLibraryBindingPanel />
            ) : (
              <>
                <AffairsLibraryStageToolbar
                  browseMode={state.browseMode}
                  folderBreadcrumbs={folderBreadcrumbs}
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
                        style={{ transform: `translateY(${gridMetrics.offsetTop}px)` }}
                      >
                        {visibleGridEntries.map((entry) => (
                          entry.kind === "folder" ? (
                            <button
                              key={entry.id}
                              type="button"
                              className={state.selectedFolderPath === entry.path ? "affairs-doc-item grid active" : "affairs-doc-item grid"}
                              onClick={() => navigateLibraryFolder(entry.path)}
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
                    </div>
                  ) : (
                    <div className="affairs-doc-grid">
                      {sortedLibraryEntries.map((entry) => (
                        entry.kind === "folder" ? (
                          <button
                            key={entry.id}
                            type="button"
                            className={state.selectedFolderPath === entry.path ? "affairs-doc-item grid active" : "affairs-doc-item grid"}
                            onClick={() => navigateLibraryFolder(entry.path)}
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
                  <div className="affairs-doc-grid-loading">{t("common.loading")}</div>
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
                    <div className="affairs-finder-virtual" style={{ transform: `translateY(${listMetrics.offsetTop}px)` }}>
                      {visibleListEntries.map((entry) => (
                        entry.kind === "folder" ? (
                          <button
                            key={entry.id}
                            type="button"
                            className={state.selectedFolderPath === entry.path ? "affairs-finder-row active" : "affairs-finder-row"}
                            onClick={() => navigateLibraryFolder(entry.path)}
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
                        ) : (
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
                        )
                      ))}
                    </div>
                  </div>
                  {libraryDocumentsLoading || libraryDocumentHasMore ? (
                    <div className="affairs-finder-loading">{t("common.loading")}</div>
                  ) : null}
                </div>
                </div>
                  </>
                )}
              </>
            )
          ) : activeSection === "todo" ? (
            filteredTodoRecords.length === 0 ? (
              <div className="affairs-stage-empty">{t("shell.affairsTodoEmpty")}</div>
            ) : (
              <div className="affairs-stage-list">
                {filteredTodoRecords.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className={selectedObject.section === "todo" && selectedObject.record?.id === record.id ? "affairs-stage-item active" : "affairs-stage-item"}
                    onClick={() => selectObject(record.id)}
                  >
                    <div className="affairs-stage-item-row">
                      <span className="affairs-stage-item-title">{record.title}</span>
                      <span className="affairs-inline-pill">{record.sourceLabel}</span>
                    </div>
                    <span className="affairs-stage-item-summary">{record.summary}</span>
                    <span className="affairs-stage-item-meta">{record.statusLabel} · {record.sourceDescription} · {formatRelativeMeta(record.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )
          ) : automationRecords.length === 0 ? (
            <div className="affairs-stage-empty">{t("shell.affairsAutomationEmpty")}</div>
          ) : (
            <div className="affairs-stage-list">
              {automationRecords.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className={selectedObject.section === "automation" && selectedObject.record?.id === record.id ? "affairs-stage-item active" : "affairs-stage-item"}
                  onClick={() => selectObject(record.id)}
                >
                  <div className="affairs-stage-item-row">
                    <span className="affairs-stage-item-title">{record.title}</span>
                    <span className="affairs-inline-pill">{record.statusLabel}</span>
                  </div>
                  <span className="affairs-stage-item-summary">{record.summary}</span>
                  <span className="affairs-stage-item-meta">{record.triggerLabel} · {record.targetSessionLabel}</span>
                  {record.lastRunSummary ? <span className="affairs-stage-item-meta subtle">{t("shell.affairsAutomationLastRunSummary", { summary: record.lastRunSummary })}</span> : null}
                </button>
              ))}
            </div>
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
                onSave={(nextTagIds, createTagPaths) => saveDocumentTagSelection(pendingTagAssignmentTarget.documentId, nextTagIds, createTagPaths)}
                onSaved={() => setPendingTagAssignmentTarget(null)}
              />
            ) : (
              <AffairsQuickTagAssignmentEditor
                assignedTagIds={pendingTagAssignmentTarget.existingTagIds}
                emptyText={t("shell.affairsFolderTagsEmpty")}
                inputLabel={t("shell.affairsFolderTagAddLabel")}
                suggestionsLabel={t("shell.affairsFolderTagSuggestionsLabel")}
                onSave={(nextTagIds, createTagPaths) => saveFolderTagSelection(pendingTagAssignmentTarget.folderPath, nextTagIds, createTagPaths)}
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
                onSave={(nextTagIds, createTagPaths) => saveDocumentTagSelection(pendingTagAssignmentTarget.documentId, nextTagIds, createTagPaths)}
                onSaved={() => setPendingTagAssignmentTarget(null)}
              />
            ) : (
              <AffairsQuickTagAssignmentEditor
                assignedTagIds={pendingTagAssignmentTarget.existingTagIds}
                emptyText={t("shell.affairsFolderTagsEmpty")}
                inputLabel={t("shell.affairsFolderTagAddLabel")}
                suggestionsLabel={t("shell.affairsFolderTagSuggestionsLabel")}
                onSave={(nextTagIds, createTagPaths) => saveFolderTagSelection(pendingTagAssignmentTarget.folderPath, nextTagIds, createTagPaths)}
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
    binding,
    assistantContext,
    auxiliaryTab,
    automationRuns,
    documentTagDetails,
    detailViewerCollapsed,
    filteredDocuments,
    filteredTodoRecords,
    folderRecords,
    indexStatus,
    libraryConfig,
    selectAuxiliaryTab,
    toggleDetailViewerCollapsed,
    selectedObject,
    state,
    tagRecords,
    selectedTagPaths
  } = useAffairsWorkbenchInternal();
  const [viewerReady, setViewerReady] = useState(false);

  const selectedAutomationRuns = useMemo(() => {
    if (selectedObject.section !== "automation" || !selectedObject.record) {
      return [];
    }

    return automationRuns
      .filter((run) => run.automationId === selectedObject.record?.id)
      .slice(0, 12);
  }, [automationRuns, selectedObject]);

  const folderDetail = useMemo(
    () => buildFolderDetailState(folderRecords, filteredDocuments, state.selectedFolderPath, selectedObject),
    [filteredDocuments, folderRecords, selectedObject, state.selectedFolderPath]
  );
  const tagDetail = useMemo(
    () => buildTagDetailState(tagRecords, filteredDocuments, state.selectedTagPath, selectedTagPaths),
    [filteredDocuments, selectedTagPaths, state.selectedTagPath, tagRecords]
  );
  const localMirrorTarget = useMemo(
    () => selectedObject.section === "library" && selectedObject.record
      ? resolveLocalMirrorTarget(libraryConfig?.mirrorRoot, selectedObject.record.filePath)
      : null,
    [libraryConfig?.mirrorRoot, selectedObject]
  );
  const { showToast } = useToast();

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
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <div className="workbench-info-tabs" role="tablist" aria-label={t("shell.affairsAuxiliaryTabsLabel")}>
          <button
            type="button"
            role="tab"
            aria-selected={auxiliaryTab === "detail"}
            className={auxiliaryTab === "detail" ? "workbench-info-tab active" : "workbench-info-tab"}
            onClick={() => selectAuxiliaryTab("detail")}
          >
            {t("shell.affairsDetailTitle")}
          </button>
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
      </div>

      <div className="workbench-auxiliary-body" data-scrollbar-autohide="true">
        {auxiliaryTab === "detail" ? (
          selectedObject.section === "library" ? (
            !binding ? (
              <div className="affairs-stage-empty">{t("shell.affairsAssistantBindingRequired")}</div>
            ) : selectedObject.record ? (
              <div className="affairs-detail-panel">
                <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                  <div className="affairs-detail-headline">
                    <div>
                      <h2>{selectedObject.record.displayName}</h2>
                      <p>{selectedObject.record.summary}</p>
                    </div>
                    <span className="affairs-inline-pill">{t("shell.affairsLibraryDocumentDetailTitle")}</span>
                  </div>
                  <dl className="affairs-detail-meta-list">
                    <div>
                      <dt>{t("shell.affairsDetailMetaPath")}</dt>
                      <dd>{selectedObject.record.filePath}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsDetailMetaTags")}</dt>
                      <dd>{selectedObject.record.tags.join(" · ") || t("common.none")}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsLibraryDocumentUpdatedAt")}</dt>
                      <dd>{formatRelativeMeta(selectedObject.record.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>{t("shell.affairsLibraryMirrorRootLabel")}</dt>
                      <dd>{libraryConfig?.mirrorRoot || t("common.none")}</dd>
                    </div>
                  </dl>
                  <div className="affairs-detail-tag-editor">
                    <strong>{t("shell.affairsDocumentTagsSectionTitle")}</strong>
                    <AffairsDocumentTagSelectionPanel
                      documentId={selectedObject.record.id}
                      details={documentTagDetails}
                    />
                  </div>
                  <div className="affairs-binding-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!localMirrorTarget}
                      onClick={async () => {
                        if (!localMirrorTarget) {
                          return;
                        }
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
                      disabled={!localMirrorTarget}
                      onClick={async () => {
                        if (!localMirrorTarget) {
                          return;
                        }
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
                  </div>
                </section>
                <div className="affairs-detail-viewer-shell" data-collapsed={detailViewerCollapsed ? "true" : undefined}>
                  <AffairsLibraryInlineViewer
                    workspaceId={workspaceId}
                    filePath={selectedObject.record.filePath}
                    windowTitle={selectedObject.record.title}
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
            selectedObject.record ? (
              <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                <div className="affairs-detail-headline">
                  <div>
                    <h2>{selectedObject.record.title}</h2>
                    <p>{selectedObject.record.summary}</p>
                  </div>
                  <span className="affairs-inline-pill">{selectedObject.record.sourceLabel}</span>
                </div>
                <dl className="affairs-detail-meta-list">
                  <div>
                    <dt>{t("shell.affairsTodoDetailStatus")}</dt>
                    <dd>{selectedObject.record.statusLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailSource")}</dt>
                    <dd>{selectedObject.record.sourceDescription}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsTodoDetailNotes")}</dt>
                    <dd>{selectedObject.record.detail}</dd>
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
          ) : selectedObject.record ? (
            <div className="affairs-detail-panel">
              <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
                <div className="affairs-detail-headline">
                  <div>
                    <h2>{selectedObject.record.title}</h2>
                    <p>{selectedObject.record.summary}</p>
                  </div>
                  <span className="affairs-inline-pill">{selectedObject.record.statusLabel}</span>
                </div>
                <dl className="affairs-detail-meta-list">
                  <div>
                    <dt>{t("shell.affairsAutomationDetailTrigger")}</dt>
                    <dd>{selectedObject.record.triggerLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsAutomationDetailTarget")}</dt>
                    <dd>{selectedObject.record.targetSessionLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("shell.affairsAutomationDetailStatus")}</dt>
                    <dd>{selectedObject.record.statusLabel}</dd>
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
          <UniversalAssistantBridge workspaceId={workspaceId} context={binding ? assistantContext : null} />
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
  if (!detail) {
    return <div className="affairs-detail-empty-state">{t("shell.affairsDetailEmpty")}</div>;
  }
  return (
    <section className="workbench-section-block affairs-detail-block affairs-detail-hero-block">
      <div className="affairs-detail-headline">
        <div>
          <h2>{detail.title}</h2>
          <p>{t("shell.affairsLibraryFolderDetailDescription")}</p>
        </div>
        <span className="affairs-inline-pill">{t("shell.affairsLibraryFolderDetailTitle")}</span>
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
      </dl>
      <div className="affairs-detail-tag-editor">
        <strong>{t("shell.affairsFolderTagsSectionTitle")}</strong>
        <AffairsQuickTagAssignmentEditor
          assignedTagIds={folderTagDetails?.bindingTagIds ?? []}
          emptyText={t("shell.affairsFolderTagsEmpty")}
          inputLabel={t("shell.affairsFolderTagAddLabel")}
          suggestionsLabel={t("shell.affairsFolderTagSuggestionsLabel")}
          onSave={(nextTagIds, createTagPaths) => saveFolderTagSelection(folderTagDetails?.folderPath ?? detail.path, nextTagIds, createTagPaths)}
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
      onSave={(nextTagIds, createTagPaths) => saveDocumentTagSelection(documentId, nextTagIds, createTagPaths)}
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
  const indexStatusDetails = useMemo(
    () => buildIndexStatusDetails(indexStatus, directoryStatus ?? null),
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
          <button type="button" className="affairs-stage-breadcrumb-button root" onClick={() => onNavigateFolder(null)}>
            {" / "}
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
          </button>
          <ButlerAnchoredPopover
            open={statusPopoverOpen && statusTriggerRef.current !== null}
            className="affairs-index-status-popover"
            anchorRef={statusTriggerRef}
            popoverRef={statusPopoverRef}
            role="dialog"
            labelledBy="affairs-index-status-popover-title"
            maxWidth={320}
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
              <div className="affairs-index-status-popover-grid">
                {indexStatusDetails.map((item) => (
                  <div key={item.label} className="affairs-index-status-popover-row">
                    <span className="affairs-index-status-popover-label">{item.label}</span>
                    <span className="affairs-index-status-popover-value" data-multiline={item.multiline ? "true" : undefined}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
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

function AffairsLibraryBindingPanel() {
  const { binding, saveLibraryBinding, setLibraryEnabled } = useAffairsWorkbenchInternal();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [value, setValue] = useState(binding?.rootDir ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(binding?.rootDir ?? "");
  }, [binding?.rootDir]);

  return (
    <>
      <div className="affairs-stage-empty affairs-binding-panel">
        <strong>{t("shell.affairsLibraryBindingTitle")}</strong>
        <p>{t("shell.affairsLibraryBindingDescription")}</p>
        <label className="affairs-binding-field">
          <span>{t("shell.affairsLibraryBindingFieldLabel")}</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t("shell.affairsLibraryBindingFieldPlaceholder")}
          />
        </label>
        <div className="affairs-binding-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={submitting}
            onClick={() => setBrowserOpen(true)}
          >
            {t("shell.affairsLibraryBindingBrowseAction")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={submitting || !value.trim()}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await saveLibraryBinding(value.trim());
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : t("shell.affairsLibraryBindingSaveFailed"));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? t("common.loading") : t("shell.affairsLibraryBindingSubmitAction")}
          </button>
        </div>
        {binding ? (
          <div className="affairs-library-config-section">
            <strong>{t("shell.affairsLibraryEnableLabel")}</strong>
            <p>{t("shell.affairsLibraryEnableHint")}</p>
            <div className="affairs-binding-actions">
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
        ) : null}
        {error ? <span className="affairs-binding-error">{error}</span> : null}
      </div>
      <WorkspaceImportBrowserModal
        open={browserOpen}
        mode="select-directory"
        title={t("shell.affairsLibraryBindingPickerTitle")}
        description={t("shell.affairsLibraryBindingPickerDescription")}
        submitLabel={t("shell.affairsLibraryBindingUseThisDirectory")}
        initialPath={value || binding?.rootDir || null}
        onClose={() => setBrowserOpen(false)}
        onSelectedPath={async (path) => {
          setValue(path);
          setBrowserOpen(false);
          setSubmitting(true);
          setError(null);
          try {
            await saveLibraryBinding(path);
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : t("shell.affairsLibraryBindingSaveFailed"));
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </>
  );
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
    default:
      return ruleType;
  }
}

function AffairsTagManagementModal() {
  const {
    tagManagementOpen,
    closeTagManagement,
    managedTags,
    selectedManagedTag,
    selectManagedTag,
    saveManagedTag,
    deleteManagedTag,
  } = useAffairsWorkbenchInternal();
  const platform = usePlatform();
  const { showToast } = useToast();
  const [editorMode, setEditorMode] = useState<TagManagementEditorMode>("create-root");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [smartRules, setSmartRules] = useState<EditableSmartTagRule[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleManagedTags = useMemo(
    () => (Array.isArray(managedTags) ? managedTags : []).filter(isAssignableManagedTag),
    [managedTags],
  );
  const treeNodes = useMemo(() => buildManagedTagTree(visibleManagedTags), [visibleManagedTags]);
  const flattenedTags = useMemo(() => flattenManagedTagTree(treeNodes), [treeNodes]);
  const selectedEditableTag = selectedManagedTag && isAssignableManagedTag(selectedManagedTag) ? selectedManagedTag : null;
  const currentEditTagId = editorMode === "edit" ? selectedEditableTag?.id ?? null : null;
  const parentOptions = useMemo(
    () => flattenedTags.filter(({ tag }) => isSelectableParentTag(tag, selectedEditableTag)),
    [flattenedTags, selectedEditableTag],
  );

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
  const editorDescription = editorMode === "edit"
    ? t("shell.affairsTagEditorEditDescription")
    : editorMode === "create-child" && selectedEditableTag
      ? t("shell.affairsTagEditorCreateChildDescription", { tag: selectedEditableTag.path })
      : t("shell.affairsTagEditorCreateRootDescription");
  const saveActionLabel = editorMode === "edit"
    ? t("shell.affairsTagUpdateSubmitAction")
    : t("shell.affairsTagCreateSubmitAction");
  const showParentField = editorMode === "edit";
  const normalizedSmartRules = smartRules.map((rule, index) => ({
    ...rule,
    priority: index,
    matcher: normalizeSmartTagRuleMatcher(rule),
  }));

  const content = (
    <div className="affairs-library-settings-form affairs-tag-management-shell">
      <div className="affairs-tag-management-layout">
        <ModalSection
          className="affairs-tag-management-tree-panel"
          heading={t("shell.affairsTagTreeSectionTitle")}
          description={t("shell.affairsTagTreeSectionDescription")}
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
            description={editorDescription}
          >
            <ModalField label={t("shell.affairsTagNameLabel")}>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("shell.affairsTagNamePlaceholder")} />
            </ModalField>
            {showParentField ? (
              <ModalField label={t("shell.affairsTagParentLabel")}>
                <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
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
            description={t("shell.affairsTagSmartRulesSectionDescription")}
          >
            {smartRules.length === 0 ? (
              <ModalEmptyState
                compact
                title={t("shell.affairsTagSmartRulesEmpty")}
                description={t("shell.affairsTagSmartRulesEmptyDescription")}
              />
            ) : (
              <div className="affairs-tag-smart-rule-list">
                {smartRules.map((rule, index) => (
                  <div key={rule.id} className="affairs-tag-smart-rule-card">
                    <div className="affairs-tag-smart-rule-row">
                      <ModalField label={t("shell.affairsTagSmartRuleRelationLabel")}>
                        <select
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
                      <ModalField label={t("shell.affairsTagSmartRuleTypeLabel")}>
                        <select
                          value={rule.ruleType}
                          disabled={submitting}
                          onChange={(event) => {
                            const nextType = event.target.value as AffairsTagRuleDto["ruleType"];
                            setSmartRules((current) => current.map((item) => item.id === rule.id
                              ? { ...item, ruleType: nextType, matcher: buildDefaultMatcherForRuleType(nextType) }
                              : item));
                          }}
                        >
                          {(["file_name_contains", "file_content_contains", "file_extension_in", "modified_time_between"] as const).map((ruleType) => (
                            <option key={ruleType} value={ruleType}>{resolveSmartRuleTypeLabel(ruleType)}</option>
                          ))}
                        </select>
                      </ModalField>
                    </div>
                    <div className="affairs-tag-smart-rule-row">
                      {rule.ruleType === "file_name_contains" || rule.ruleType === "file_content_contains" ? (
                        <ModalField label={t("shell.affairsTagSmartRuleKeywordLabel")}>
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
                        <ModalField label={t("shell.affairsTagSmartRuleExtensionsLabel")}>
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
                          <ModalField label={t("shell.affairsTagSmartRuleModifiedStartLabel")}>
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
                          <ModalField label={t("shell.affairsTagSmartRuleModifiedEndLabel")}>
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
                    </div>
                    <div className="affairs-tag-smart-rule-actions">
                      <label className="affairs-tag-smart-rule-toggle">
                        <input
                          type="checkbox"
                          checked={rule.enabled !== false}
                          disabled={submitting}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setSmartRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item));
                          }}
                        />
                        <span>{t("shell.affairsTagSmartRuleEnabledLabel")}</span>
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
                    <span className="affairs-binding-hint">{t("shell.affairsTagSmartRuleOrderHint", { index: index + 1 })}</span>
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
        description={t("shell.affairsTagManagerDescription")}
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
      description={t("shell.affairsTagManagerDescription")}
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
  onSelect,
}: {
  nodes: ManagedTagTreeNode[];
  selectedTagId: string | null;
  onSelect: (tagId: string) => void;
}) {
  return (
    <ul className="affairs-tag-management-tree-list">
      {nodes.map((node) => (
        <li key={node.tag.id} className="affairs-tag-management-tree-node" role="treeitem" aria-selected={selectedTagId === node.tag.id}>
          <button
            type="button"
            className={selectedTagId === node.tag.id ? "affairs-tag-management-tree-button active" : "affairs-tag-management-tree-button"}
            onClick={() => onSelect(node.tag.id)}
          >
            <span className="affairs-tag-management-tree-main">
              <span className="affairs-tag-management-tree-name">{node.tag.name}</span>
              <span className="affairs-tag-management-tree-path">{node.tag.path}</span>
            </span>
            <span className="affairs-tag-management-tree-meta">
              {node.tag.documentCount > 0 ? <span className="affairs-binding-hint">{t("shell.affairsTagTreeDocumentCount", { count: node.tag.documentCount })}</span> : null}
            </span>
          </button>
          {node.children.length > 0 ? (
            <AffairsTagManagementTreeNodes nodes={node.children} selectedTagId={selectedTagId} onSelect={onSelect} />
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
    setSelectedExtensions(resolveEditableAllowedExtensions(persistedAllowedExtensions));
    setIncludedHiddenPathsText(persistedIncludedHiddenPaths.join("\n"));
    setManualExtension("");
  }, [
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
              const result = await saveLibraryConfig({
                mirrorRoot: normalizedMirrorRoot,
                allowedExtensions: normalizedExtensions,
                includedHiddenPaths: normalizedIncludedHiddenPaths
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
  onDownload: (() => void | Promise<void>) | null;
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
  onClose
}: {
  workspaceId: string;
  viewerState: AffairsLibraryViewerState;
  onClose: () => void;
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
      open={true}
      onClose={onClose}
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
              open={true}
              onClose={() => undefined}
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
  open,
  onClose
}: {
  workspaceId: string;
  filePath: string;
  windowTitle: string;
  chrome: "modal" | "window";
  open: boolean;
  onClose: () => void;
}) {
  return (
    <FileViewerPanel
      workspaceId={workspaceId}
      filePath={filePath}
      open={open}
      chrome={chrome === "window" ? "inline" : chrome}
      windowTitle={windowTitle}
      onClose={onClose}
      onSaved={() => undefined}
      previewLoader={getAffairsLibraryPreview}
      saveDisabledReason={t("shell.affairsLibraryViewerEditDisabled")}
    />
  );
}

function UniversalAssistantBridge({
  workspaceId,
  context
}: {
  workspaceId: string;
  context: AffairsObjectContext | null;
}) {
  const [store] = useState(() => new ButlerRuntimeStore(workspaceId));
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

  useEffect(() => {
    void store.initialize();
  }, [store]);

  const placeholder = context
    ? t("shell.affairsAssistantPlaceholder", { title: context.title ?? t("common.unknown") })
    : t("shell.affairsAssistantPlaceholderEmpty");

  return (
    <section className="affairs-assistant-panel">
      {context ? (
        <section className="workbench-section-block affairs-detail-block affairs-assistant-context-block">
          <div className="affairs-detail-headline compact">
            <h3>{context.title}</h3>
            <p>{context.summary || t("shell.affairsAssistantContextFallback")}</p>
          </div>
        </section>
      ) : (
        <section className="workbench-section-block affairs-detail-block affairs-assistant-context-block">
          <div className="affairs-detail-headline compact">
            <h3>{t("shell.affairsAssistantTitle")}</h3>
            <p>{t("shell.affairsAssistantBindingRequired")}</p>
          </div>
        </section>
      )}
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
          capabilities={capabilities}
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
            await store.sendMessage(`${buildAffairsAssistantPrefix(context)}${content}`, {
              model: options?.model ?? null,
              reasoningLevel: options?.reasoningLevel ?? null,
              permissionMode: null
            });
          }}
        />
      </div>
      <div className="affairs-assistant-footer">{profile?.displayName?.trim() || t("shell.butlerEntry")}</div>
    </section>
  );
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

function useAffairsWorkbenchInternal() {
  const context = useContext(AffairsWorkbenchContext);

  if (!context) {
    throw new Error("AffairsWorkbench components must be used inside AffairsWorkbenchProvider");
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

function isVisibleTagRecord(tag: TagRecord): boolean {
  const rootType = tag.rootType.trim().toLowerCase();
  if (rootType === "类型" || rootType === "time" || rootType === "时间" || rootType === "type") {
    return true;
  }
  return isVisibleTagPath(tag.path);
}

function isVisibleTagPath(tagPath: string): boolean {
  return tagPath.startsWith("类型/") || tagPath === "类型" || tagPath.startsWith("时间/") || tagPath === "时间";
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
  childFolderCount: number;
  directDocumentCount: number;
  totalDocumentCount: number;
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
  return `affairs.library.snapshot.${workspaceId}`;
}

function buildAffairsLibraryConfigCacheKey(workspaceId: string) {
  return `affairs.library.config.${workspaceId}`;
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
    offset: 0,
    limit: Math.max(previous?.limit ?? 0, response.limit),
    items: mergeDocumentPageItems(previous?.items ?? [], response.items),
    tagFacetCounts: response.tagFacetCounts ?? previous?.tagFacetCounts ?? {}
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
  if (left.total !== right.total || left.offset !== right.offset || left.limit !== right.limit) {
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
  scrollTop: number
) {
  const visibleRows = Math.max(1, Math.ceil(Math.max(viewportHeight, LIST_ITEM_HEIGHT) / LIST_ITEM_HEIGHT));
  const startRow = Math.max(0, Math.floor(scrollTop / LIST_ITEM_HEIGHT) - LIST_VIRTUAL_OVERSCAN_ROWS);
  const endRow = Math.min(itemCount, startRow + visibleRows + LIST_VIRTUAL_OVERSCAN_ROWS * 2);
  return {
    startIndex: startRow,
    endIndex: endRow,
    offsetTop: startRow * LIST_ITEM_HEIGHT,
    totalHeight: itemCount * LIST_ITEM_HEIGHT
  };
}

function measureStageScrollContentWidth(element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft || "0");
  const paddingRight = Number.parseFloat(styles.paddingRight || "0");
  return Math.max(0, element.clientWidth - paddingLeft - paddingRight);
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
  selectedObject: AffairsSelectedObject
): FolderDetailState {
  if (selectedObject.section !== "library" || selectedObject.record) {
    return null;
  }
  const normalized = normalizeFolderPath(currentPath);
  const folder = folders.find((item) => normalizeFolderPath(item.path) === normalized) ?? null;
  const childFolderCount = folders.filter((item) => normalizeFolderPath(item.parentPath) === normalized).length;
  const directDocumentCount = documents.filter((item) => normalizeFolderPath(getDocumentParentPath(item.filePath)) === normalized).length;
  return {
    title: folder?.label || t("shell.affairsLibraryFolderRootLabel"),
    path: formatFolderPath(currentPath),
    childFolderCount,
    directDocumentCount,
    totalDocumentCount: folder?.count ?? documents.filter((item) => matchesFolder(item.filePath, currentPath)).length
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

function resolveAffairsSectionTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoNav");
    case "automation":
      return t("shell.affairsAutomationNav");
    case "library":
    default:
      return t("shell.affairsLibraryTitle");
  }
}

function resolveAffairsSectionSummary(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoSummary");
    case "automation":
      return t("shell.affairsAutomationSummary");
    case "library":
    default:
      return t("shell.affairsLibrarySummary");
  }
}

function resolveStageTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoStageTitle");
    case "automation":
      return t("shell.affairsAutomationStageTitle");
    case "library":
    default:
      return t("shell.affairsLibraryResultTitle");
  }
}

function resolveStageDescription(section: AffairsPrimarySection, sidebarCount: number) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoStageDescription", { count: sidebarCount });
    case "automation":
      return t("shell.affairsAutomationStageDescription", { count: sidebarCount });
    case "library":
    default:
      return t("shell.affairsLibraryStageDescription", { count: sidebarCount });
  }
}

function resolveSectionSidebarTitle(section: AffairsPrimarySection) {
  switch (section) {
    case "todo":
      return t("shell.affairsTodoSidebarTitle");
    case "automation":
      return t("shell.affairsAutomationSidebarTitle");
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
    case "todo":
      return t("shell.affairsTodoSidebarDescription", { count: counts.todoCount });
    case "automation":
      return t("shell.affairsAutomationSidebarDescription", { count: counts.automationCount });
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
    case "todo":
      return t("shell.affairsTodoEmpty");
    case "automation":
      return t("shell.affairsAutomationEmpty");
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

function resolveDefaultNodeId(
  section: AffairsPrimarySection,
  automationRecords: AutomationRecord[],
  binding: AffairsLibraryBindingDto | null
) {
  switch (section) {
    case "todo":
      return "todo:all";
    case "automation":
      return automationRecords[0] ? `automation:item:${automationRecords[0].id}` : "automation:all";
    case "library":
    default:
      return binding ? "library:all" : "library:binding";
  }
}

function groupSidebarNodes(section: AffairsPrimarySection, nodes: AffairsSidebarNode[]) {
  if (section === "todo") {
    return [
      {
        id: "sources",
        label: t("shell.affairsTodoSidebarGroupSources"),
        items: nodes
      }
    ];
  }

  return [
    {
      id: "automation",
      label: t("shell.affairsAutomationSidebarGroupTasks"),
      items: nodes
    }
  ];
}

function normalizeSection(section: AffairsPrimarySection): AffairsPrimarySection {
  if (section === "todo" || section === "automation") {
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
    case "running":
      return t("shell.affairsLibraryStatusRunning");
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

function buildIndexStatusDetails(
  status: AffairsLibraryIndexStatusDto | null,
  directoryStatus: AffairsLibraryDocumentListDto["directoryStatus"]
) {
  const details: Array<{ label: string; value: string; multiline?: boolean }> = [
    {
      label: t("shell.affairsLibraryStatusCurrentLabel"),
      value: resolveIndexStatusLabel(status)
    }
  ];

  if (!status) {
    return details;
  }

  pushIndexStatusDetail(details, t("shell.affairsLibraryStatusLastRequestedAtLabel"), status.lastRequestedAt);
  pushIndexStatusDetail(details, t("shell.affairsLibraryStatusLastStartedAtLabel"), status.lastStartedAt);
  pushIndexStatusDetail(details, t("shell.affairsLibraryStatusLastCompletedAtLabel"), status.lastCompletedAt);
  pushIndexStatusDetail(details, t("shell.affairsLibraryStatusLastFailedAtLabel"), status.lastFailedAt);
  pushIndexStatusDetail(details, t("shell.affairsLibraryStatusNextAllowedAtLabel"), status.nextAllowedAt);

  if (status.runningTaskId?.trim()) {
    details.push({
      label: t("shell.affairsLibraryStatusRunningTaskIdLabel"),
      value: status.runningTaskId.trim(),
      multiline: true
    });
  }

  if (status.runningStage?.trim()) {
    details.push({
      label: t("shell.affairsLibraryStatusRunningStageLabel"),
      value: resolveIndexStatusStageLabel(status.runningStage.trim())
    });
  }

  if (status.dirtyReasons.length > 0) {
    details.push({
      label: t("shell.affairsLibraryStatusDirtyReasonsLabel"),
      value: status.dirtyReasons.join("、"),
      multiline: true
    });
  }

  if (status.errorSummary?.trim()) {
    details.push({
      label: t("shell.affairsLibraryStatusErrorSummaryLabel"),
      value: status.errorSummary.trim(),
      multiline: true
    });
  }

  if (directoryStatus?.path?.trim()) {
    details.push({
      label: t("shell.affairsLibraryDirectoryStatusPathLabel"),
      value: directoryStatus.path === "." ? t("shell.affairsLibraryDirectoryStatusRootPath") : directoryStatus.path
    });
    details.push({
      label: t("shell.affairsLibraryDirectoryStatusStateLabel"),
      value: resolveDirectoryStatusLabel(directoryStatus.state)
    });
    details.push({
      label: t("shell.affairsLibraryDirectoryStatusSourceLabel"),
      value: resolveDirectoryStatusSourceLabel(directoryStatus.source)
    });
    pushIndexStatusDetail(
      details,
      t("shell.affairsLibraryDirectoryStatusLastRequestedAtLabel"),
      directoryStatus.lastRequestedAt
    );
    pushIndexStatusDetail(
      details,
      t("shell.affairsLibraryDirectoryStatusLastCompletedAtLabel"),
      directoryStatus.lastCompletedAt
    );
    pushIndexStatusDetail(
      details,
      t("shell.affairsLibraryDirectoryStatusLastFailedAtLabel"),
      directoryStatus.lastFailedAt
    );
    if (directoryStatus.runningTaskId?.trim()) {
      details.push({
        label: t("shell.affairsLibraryDirectoryStatusRunningTaskIdLabel"),
        value: directoryStatus.runningTaskId.trim(),
        multiline: true
      });
    }
    if (directoryStatus.errorSummary?.trim()) {
      details.push({
        label: t("shell.affairsLibraryDirectoryStatusErrorSummaryLabel"),
        value: directoryStatus.errorSummary.trim(),
        multiline: true
      });
    }
  }

  return details;
}

function pushIndexStatusDetail(
  details: Array<{ label: string; value: string; multiline?: boolean }>,
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
    case "mixed":
    default:
      return t("shell.affairsLibraryDirectoryStatusSourceMixed");
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
    return t("shell.affairsAssistantBindingRequired");
  }

  if (status.state === "running") {
    return t("shell.affairsAssistantWaitingDocument");
  }

  return status.errorSummary?.trim() || t("shell.affairsDetailEmpty");
}
