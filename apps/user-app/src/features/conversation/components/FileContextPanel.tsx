import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useLocalUiPreferenceSelector } from "../../../preferences/local-ui-preference-store";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import type {
  FileTreeRealtimeSnapshotDto,
  GitRealtimeSnapshotDto
} from "../../../network/workbench-realtime-client";
import {
  downloadFile,
  operateFile,
  searchFiles,
  uploadFile,
  type FileNodeDto
} from "../api/file-context-api";
import { getGitDiff, type GitChangeItemDto } from "../api/git-api";
import { usePlatform } from "../../../platform/platform-provider";
import {
  showDesktopContextMenu,
  type DesktopContextMenuItem
} from "../../../platform/desktop/desktop-context-menu";
import {
  useWorkbenchShell,
  type WorkbenchFileRevealRequest,
  type WorkspaceSessionGroup
} from "./WorkbenchLayout";
import { WorkbenchModal } from "./WorkbenchModal";
import { FileViewerModal } from "./FileViewerModal";
import {
  resolveFileTreeIconKind,
  resolveFileTreeIconLabel
} from "./file-tree-icon";
import {
  filterVisibleEntriesByName,
  filterVisibleFileNodes,
  filterVisibleFileTreeCache,
  getPathLeafName
} from "./file-entry-visibility";
import { SessionChangedFilesPanel } from "./SessionChangedFilesPanel";

interface FileContextPanelProps {
  className?: string;
  sessionId: string | null | undefined;
  workspaceId: string | null | undefined;
  hideHeading?: boolean;
  externalRevealRequest?: WorkbenchFileRevealRequest | null;
  externalWindowMode?: boolean;
  workbenchShellOverrides?: FileContextPanelWorkbenchShellOverrides;
}

export interface FileContextPanelWorkbenchShellOverrides {
  navigationGroups?: WorkspaceSessionGroup[];
  subscribeFileTree?: (workspaceId: string, paths: string[]) => void;
  requestFileTreeRefresh?: (workspaceId: string, paths?: string[]) => void;
  addFileTreeSnapshotListener?: (
    listener: (snapshot: FileTreeRealtimeSnapshotDto) => void
  ) => () => void;
  subscribeGitSnapshot?: (workspaceId: string) => void;
  requestGitRefresh?: (workspaceId: string) => void;
  addGitSnapshotListener?: (listener: (snapshot: GitRealtimeSnapshotDto) => void) => () => void;
}

type FileTreeCache = Record<string, FileNodeDto[]>;
type FileTreeCacheUpdater =
  | FileTreeCache
  | ((previous: FileTreeCache) => FileTreeCache);
type ExpandedDirectoriesUpdater =
  | string[]
  | ((previous: string[]) => string[]);
type FilePanelTab = "workspace" | "session";
type RecentFileActivation = {
  filePath: string;
  timestamp: number;
};
type FileSelectionTarget = {
  path: string;
  kind: "file" | "directory";
};
type FileClipboardMode = "copy" | "cut";
type FileClipboardState = {
  mode: FileClipboardMode;
  items: FileSelectionTarget[];
};
type WebContextMenuState = {
  positionX: number;
  positionY: number;
  items: DesktopContextMenuItem[];
};
type WebContextMenuLayout = {
  left: number;
  top: number;
  maxHeight: number;
};

const ROOT_DIRECTORY = "";
const FILE_REPEAT_ACTIVATION_MS = 450;
const WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX = 8;
const WEB_CONTEXT_MENU_GAP_PX = 4;
const WEB_CONTEXT_MENU_DEFAULT_WIDTH_PX = 176;
const WEB_CONTEXT_MENU_MIN_HEIGHT_PX = 120;
const FILE_PANEL_WORKSPACE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const FILE_PANEL_SESSION_COUNT_CACHE_MAX_AGE_MS = 60 * 1000;
const FILE_TREE_SNAPSHOT_TIMEOUT_MS = 1600;
const SIDEBAR_TREE_ROOT_PADDING_PX = 20;
const SIDEBAR_TREE_DEPTH_STEP_PX = 16;

interface FilePanelWorkspaceSnapshot {
  treeCache: FileTreeCache;
  expandedDirectories: string[];
  activeDirectoryPath: string;
}

interface LoadRootTreeOptions {
  silent?: boolean;
}

interface DirectorySnapshotRequestOptions {
  force?: boolean;
}

export function FileContextPanel({
  className,
  sessionId,
  workspaceId,
  hideHeading = false,
  externalRevealRequest = null,
  externalWindowMode = false,
  workbenchShellOverrides
}: FileContextPanelProps) {
  const workbenchShell = useWorkbenchShell();
  const {
    navigationGroups,
    subscribeFileTree,
    requestFileTreeRefresh,
    addFileTreeSnapshotListener,
    subscribeGitSnapshot,
    requestGitRefresh,
    addGitSnapshotListener
  } = {
    ...workbenchShell,
    ...workbenchShellOverrides
  };
  const [treeCache, setTreeCache] = useState<FileTreeCache>({});
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<string[]>([]);
  const [activeDirectoryPath, setActiveDirectoryPath] = useState(ROOT_DIRECTORY);
  const [selectedTargets, setSelectedTargets] = useState<FileSelectionTarget[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResult, setSearchResult] = useState<FileNodeDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [viewerFilePath, setViewerFilePath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilePanelTab>("workspace");
  const [sessionRefreshVersion, setSessionRefreshVersion] = useState(0);
  const [sessionChangeCount, setSessionChangeCount] = useState(0);
  const [copyPathMenuOpen, setCopyPathMenuOpen] = useState(false);
  const [mobileActionMenuOpen, setMobileActionMenuOpen] = useState(false);
  const [webContextMenu, setWebContextMenu] = useState<WebContextMenuState | null>(null);
  const [webContextMenuLayout, setWebContextMenuLayout] = useState<WebContextMenuLayout | null>(null);
  const [deleteConfirmTargets, setDeleteConfirmTargets] = useState<FileSelectionTarget[] | null>(null);
  const [fileClipboard, setFileClipboard] = useState<FileClipboardState | null>(null);
  const [gitChanges, setGitChanges] = useState<GitChangeItemDto[]>([]);
  const [showChangesOnly, setShowChangesOnly] = useState(false);
  const [viewerDiffContent, setViewerDiffContent] = useState<string | null>(null);
  const treeCacheRef = useRef<FileTreeCache>({});
  const expandedDirectoriesRef = useRef<string[]>([]);
  const activeDirectoryPathRef = useRef(ROOT_DIRECTORY);
  const restoringWorkspaceSnapshotRef = useRef(false);
  const recentFileActivationRef = useRef<RecentFileActivation | null>(null);
  const copyPathMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileActionMenuRef = useRef<HTMLDivElement | null>(null);
  const webContextMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const handledExternalRevealRequestIdRef = useRef<number | null>(null);
  const viewerDiffRequestIdRef = useRef(0);
  const directoryWaitersRef = useRef(
    new Map<
      string,
      Array<{
        resolve: (items: FileNodeDto[]) => void;
        reject: (error: Error) => void;
        timerId: number;
      }>
    >()
  );
  const { showToast } = useToast();
  const platform = usePlatform();
  const showSystemFiles = useLocalUiPreferenceSelector((state) => state.showSystemFiles);
  const hasSessionContext = Boolean(sessionId?.trim());
  const shouldUseMobileActionMenu = hideHeading && platform.isMobile;

  useEffect(() => {
    logPerfDebug("file_panel.props", {
      sessionId,
      workspaceId,
      externalWindowMode
    });
  }, [externalWindowMode, sessionId, workspaceId]);

  useEffect(() => {
    activeDirectoryPathRef.current = activeDirectoryPath;
  }, [activeDirectoryPath]);

  function updateTreeCache(nextValue: FileTreeCacheUpdater) {
    setTreeCache((previous) => {
      const nextCache =
        typeof nextValue === "function"
          ? (nextValue as (previous: FileTreeCache) => FileTreeCache)(previous)
          : nextValue;
      treeCacheRef.current = nextCache;
      return nextCache;
    });
  }

  function updateExpandedDirectories(nextValue: ExpandedDirectoriesUpdater) {
    setExpandedDirectories((previous) => {
      const nextDirectories =
        typeof nextValue === "function"
          ? (nextValue as (previous: string[]) => string[])(previous)
          : nextValue;
      expandedDirectoriesRef.current = nextDirectories;
      return nextDirectories;
    });
  }

  useEffect(() => {
    rejectAllDirectoryWaiters();

    if (!workspaceId) {
      rejectAllDirectoryWaiters();
      restoringWorkspaceSnapshotRef.current = false;
      treeCacheRef.current = {};
      expandedDirectoriesRef.current = [];
      activeDirectoryPathRef.current = ROOT_DIRECTORY;
      updateTreeCache({});
      updateExpandedDirectories([]);
      setLoadingDirectories([]);
      setActiveDirectoryPath(ROOT_DIRECTORY);
      setSearchVisible(false);
      setSearchKeyword("");
      setSearchResult(null);
      setSearching(false);
      setLoadingTree(false);
      setShowChangesOnly(false);
      setViewerDiffContent(null);
      setSelectedTargets([]);
      setSelectionAnchorPath(null);
      setWebContextMenu(null);
      setWebContextMenuLayout(null);
      setDeleteConfirmTargets(null);
      return;
    }

    restoringWorkspaceSnapshotRef.current = true;

    const cachedSnapshot = readViewSnapshot<FilePanelWorkspaceSnapshot>(
      buildWorkspaceTreeSnapshotKey(workspaceId),
      FILE_PANEL_WORKSPACE_CACHE_MAX_AGE_MS
    );

    logPerfDebug("file_panel.workspace_snapshot", {
      workspaceId,
      cached: Boolean(cachedSnapshot),
      cachedRootItems: cachedSnapshot?.treeCache?.[ROOT_DIRECTORY]?.length ?? 0,
      cachedDirectoryCount: Object.keys(cachedSnapshot?.treeCache ?? {}).length
    });

    const nextActiveDirectoryPath = resolveRestoredActiveDirectoryPath(
      cachedSnapshot?.activeDirectoryPath ?? ROOT_DIRECTORY,
      cachedSnapshot?.treeCache ?? {}
    );
    const nextExpandedDirectories = sanitizeExpandedDirectories(
      cachedSnapshot?.expandedDirectories ?? [],
      nextActiveDirectoryPath
    );
    const nextTreeCache = pruneTreeCache(
      cachedSnapshot?.treeCache ?? {},
      nextActiveDirectoryPath,
      nextExpandedDirectories
    );

    treeCacheRef.current = nextTreeCache;
    expandedDirectoriesRef.current = nextExpandedDirectories;
    activeDirectoryPathRef.current = nextActiveDirectoryPath;
    updateTreeCache(nextTreeCache);
    updateExpandedDirectories(nextExpandedDirectories);
    setLoadingDirectories([]);
    setActiveDirectoryPath(nextActiveDirectoryPath);
    setLoadingTree(false);
    setMutating(false);
    setSearchVisible(false);
    setSearchKeyword("");
    setSearchResult(null);
    setSearching(false);

    queueMicrotask(() => {
      restoringWorkspaceSnapshotRef.current = false;
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!externalRevealRequest || externalRevealRequest.workspaceId !== workspaceId) {
      return;
    }

    const runRevealRequest = () => {
      if (handledExternalRevealRequestIdRef.current === externalRevealRequest.requestId) {
        return;
      }

      handledExternalRevealRequestIdRef.current = externalRevealRequest.requestId;
      setActiveTab("workspace");

      const revealTask = externalRevealRequest.openViewer
        ? openFileViewer(externalRevealRequest.filePath)
        : selectFile(externalRevealRequest.filePath);

      void revealTask.catch((error) => {
        showToast({
          title: readError(error, t("conversation.filePanelOpenFailed")),
          tone: "error"
        });
      });
    };

    if (restoringWorkspaceSnapshotRef.current) {
      queueMicrotask(runRevealRequest);
      return;
    }

    runRevealRequest();
  }, [externalRevealRequest, openFileViewer, selectFile, showToast, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    return addFileTreeSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) {
        return;
      }

      updateTreeCache((previous) => ({
        ...previous,
        [snapshot.path]: snapshot.items
      }));

      if (snapshot.path === ROOT_DIRECTORY) {
        setLoadingTree(false);
      }

      setLoadingDirectories((previous) => previous.filter((item) => item !== snapshot.path));
      resolveDirectoryWaiters(snapshot.path, snapshot.items);
    });
  }, [addFileTreeSnapshotListener, workspaceId]);

  useEffect(() => {
    return () => {
      rejectAllDirectoryWaiters();
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    subscribeFileTree(
      workspaceId,
      collectSubscribedDirectories(expandedDirectoriesRef.current, activeDirectoryPathRef.current)
    );
  }, [activeDirectoryPath, expandedDirectories, subscribeFileTree, workspaceId]);

  useEffect(() => {
    setSelectedTargets([]);
    setSelectionAnchorPath(null);
    setViewerFilePath(null);
    setViewerDiffContent(null);
    setSessionRefreshVersion(0);
    setCopyPathMenuOpen(false);
    setMobileActionMenuOpen(false);
    setWebContextMenu(null);
    setWebContextMenuLayout(null);
    setDeleteConfirmTargets(null);
    recentFileActivationRef.current = null;
    viewerDiffRequestIdRef.current += 1;
  }, [sessionId]);

  useEffect(() => {
    if (!hasSessionContext && activeTab === "session") {
      setActiveTab("workspace");
    }
  }, [activeTab, hasSessionContext]);

  useEffect(() => {
    if (!copyPathMenuOpen && !mobileActionMenuOpen && !webContextMenu) {
      return;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      const clickedCopyPathMenu = copyPathMenuRef.current?.contains(event.target) ?? false;
      const clickedMobileActionMenu = mobileActionMenuRef.current?.contains(event.target) ?? false;
      const clickedWebContextMenu = webContextMenuRef.current?.contains(event.target) ?? false;

      if (!clickedCopyPathMenu && !clickedMobileActionMenu && !clickedWebContextMenu) {
        setCopyPathMenuOpen(false);
        setMobileActionMenuOpen(false);
        setWebContextMenu(null);
        setWebContextMenuLayout(null);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCopyPathMenuOpen(false);
        setMobileActionMenuOpen(false);
        setWebContextMenu(null);
        setWebContextMenuLayout(null);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [copyPathMenuOpen, mobileActionMenuOpen, webContextMenu]);

  useLayoutEffect(() => {
    if (!webContextMenu || typeof window === "undefined") {
      setWebContextMenuLayout(null);
      return;
    }

    const activeWebContextMenu = webContextMenu;

    function updateWebContextMenuLayout() {
      const menuElement = webContextMenuRef.current;

      if (!menuElement) {
        return;
      }

      const menuRect = menuElement.getBoundingClientRect();
      setWebContextMenuLayout(
        resolveWebContextMenuLayout(
          {
            x: activeWebContextMenu.positionX,
            y: activeWebContextMenu.positionY
          },
          {
            width: menuRect.width || WEB_CONTEXT_MENU_DEFAULT_WIDTH_PX,
            height: menuRect.height || menuElement.scrollHeight || 0
          },
          {
            width: window.innerWidth,
            height: window.innerHeight
          }
        )
      );
    }

    updateWebContextMenuLayout();
    const animationFrameId = window.requestAnimationFrame(updateWebContextMenuLayout);

    window.addEventListener("resize", updateWebContextMenuLayout);
    window.addEventListener("scroll", updateWebContextMenuLayout, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateWebContextMenuLayout);
      window.removeEventListener("scroll", updateWebContextMenuLayout, true);
    };
  }, [webContextMenu]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const snapshotExpandedDirectories = sanitizeExpandedDirectories(
      expandedDirectories,
      activeDirectoryPath
    );
    const snapshotTreeCache = pruneTreeCache(
      treeCache,
      activeDirectoryPath,
      snapshotExpandedDirectories
    );

    writeViewSnapshot<FilePanelWorkspaceSnapshot>(buildWorkspaceTreeSnapshotKey(workspaceId), {
      treeCache: snapshotTreeCache,
      expandedDirectories: snapshotExpandedDirectories,
      activeDirectoryPath
    });
  }, [activeDirectoryPath, expandedDirectories, treeCache, workspaceId]);

  useEffect(() => {
    if (restoringWorkspaceSnapshotRef.current) {
      return;
    }

    const prunedTreeCache = pruneTreeCache(treeCache, activeDirectoryPath, expandedDirectories);

    if (isSameTreeCache(treeCache, prunedTreeCache)) {
      return;
    }

    updateTreeCache(prunedTreeCache);
  }, [activeDirectoryPath, expandedDirectories, treeCache]);

  useEffect(() => {
    let cancelled = false;
    const currentWorkspaceId = workspaceId?.trim() ?? null;

    async function loadRootTree(options?: LoadRootTreeOptions) {
      if (!currentWorkspaceId) {
        return;
      }

      const cachedVisibleRootItems = filterVisibleFileNodes(
        treeCacheRef.current[ROOT_DIRECTORY] ?? [],
        showSystemFiles
      );
      const shouldShowLoading = options?.silent !== true && cachedVisibleRootItems.length === 0;

      if (shouldShowLoading) {
        setLoadingTree(true);
      }

      logPerfDebug("file_panel.load_root_tree.start", {
        sessionId,
        workspaceId: currentWorkspaceId,
        silent: options?.silent === true,
        cachedRootItems: cachedVisibleRootItems.length
      });

      try {
        const response = await requestDirectorySnapshot(ROOT_DIRECTORY, {
          force: true
        });

        if (!cancelled) {
          logPerfDebug("file_panel.load_root_tree.end", {
            sessionId,
            workspaceId: currentWorkspaceId,
            itemCount: response.length
          });
          updateTreeCache((previous) => ({
            ...pruneTreeCache(
              previous,
              activeDirectoryPathRef.current,
              expandedDirectoriesRef.current
            ),
            [ROOT_DIRECTORY]: response
          }));
        }
      } catch (error) {
        if (!cancelled && !isSnapshotTimeoutError(error)) {
          showToast({
            title: readError(error, t("conversation.filePanelLoadFailed")),
            tone: "error"
          });
        }
      } finally {
        if (!cancelled && shouldShowLoading) {
          setLoadingTree(false);
        }
      }
    }

    const hasCachedRootItems =
      filterVisibleFileNodes(treeCacheRef.current[ROOT_DIRECTORY] ?? [], showSystemFiles).length > 0;

    if (hasCachedRootItems) {
      const timer = window.setTimeout(() => {
        if (!currentWorkspaceId) {
          return;
        }

        subscribeFileTree(
          currentWorkspaceId,
          collectSubscribedDirectories(expandedDirectoriesRef.current, activeDirectoryPathRef.current)
        );
        void loadRootTree({ silent: true });
      }, 1500);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    void loadRootTree();

    return () => {
      cancelled = true;
    };
  }, [sessionId, showSystemFiles, showToast, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !sessionId) {
      setSessionChangeCount(0);
      return;
    }

    const cachedCount = readViewSnapshot<number>(
      buildSessionChangeCountSnapshotKey(workspaceId, sessionId),
      FILE_PANEL_SESSION_COUNT_CACHE_MAX_AGE_MS
    );

    logPerfDebug("file_panel.session_change_count.snapshot", {
      sessionId,
      workspaceId,
      cached: cachedCount !== null,
      cachedCount
    });

    setSessionChangeCount(cachedCount ?? 0);
  }, [sessionId, sessionRefreshVersion, workspaceId]);

  // 通过 WebSocket 订阅 git 状态（复用 GitSidebar 的快照通道，避免冗余 HTTP 调用）
  useEffect(() => {
    if (!workspaceId) {
      setGitChanges([]);
      return;
    }

    const wid = workspaceId.trim();
    subscribeGitSnapshot(wid);
    requestGitRefresh(wid);
  }, [workspaceId, subscribeGitSnapshot, requestGitRefresh]);

  // 监听 git 快照，提取文件变更列表
  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const wid = workspaceId.trim();

    return addGitSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== wid) {
        return;
      }

      setGitChanges(snapshot.status?.changes ?? []);
    });
  }, [addGitSnapshotListener, workspaceId]);

  // 变更路径集合（用于筛选和状态标记）
  const visibleGitChanges = useMemo(
    () =>
      filterVisibleEntriesByName(
        gitChanges,
        (item) => getPathLeafName(item.path),
        showSystemFiles
      ),
    [gitChanges, showSystemFiles]
  );

  const gitChangeInfo = useMemo(() => {
    const statusByPath = new Map<string, string>();
    const changedDirs = new Set<string>();

    for (const change of visibleGitChanges) {
      const path = change.path.replace(/\\/g, "/");
      const status = change.worktreeStatus ?? change.stagedStatus ?? change.status;
      statusByPath.set(path, status);

      const segments = path.split("/");
      for (let i = 1; i < segments.length; i++) {
        changedDirs.add(segments.slice(0, i).join("/"));
      }
    }

    return { statusByPath, changedDirs };
  }, [visibleGitChanges]);

  const visibleTreeCache = useMemo(
    () => filterVisibleFileTreeCache(treeCache, showSystemFiles),
    [showSystemFiles, treeCache]
  );
  const visibleSearchResult = useMemo(
    () => (searchResult === null ? null : filterVisibleFileNodes(searchResult, showSystemFiles)),
    [searchResult, showSystemFiles]
  );
  const rootItems = visibleTreeCache[ROOT_DIRECTORY] ?? [];
  const searchMode = searchVisible && visibleSearchResult !== null;
  const visibleWorkspaceItems = useMemo(
    () =>
      showChangesOnly
        ? filterTreeByChanges(
            rootItems,
            visibleTreeCache,
            gitChangeInfo.statusByPath,
            gitChangeInfo.changedDirs
          )
        : rootItems,
    [gitChangeInfo.changedDirs, gitChangeInfo.statusByPath, rootItems, showChangesOnly, visibleTreeCache]
  );
  const orderedSelectionTargets = useMemo(() => {
    if (searchMode) {
      return (visibleSearchResult ?? []).map((item) => createSelectionTarget(item.path, item.kind));
    }

    return flattenVisibleSelectionTargets(
      visibleWorkspaceItems,
      visibleTreeCache,
      expandedDirectories,
      showChangesOnly,
      gitChangeInfo.statusByPath,
      gitChangeInfo.changedDirs
    );
  }, [
    expandedDirectories,
    gitChangeInfo.changedDirs,
    gitChangeInfo.statusByPath,
    searchMode,
    showChangesOnly,
    visibleSearchResult,
    visibleTreeCache,
    visibleWorkspaceItems
  ]);
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace ?? null;
  const primarySelectedTarget = getPrimarySelectedTarget(selectedTargets);
  const primarySelectedPath = primarySelectedTarget?.path ?? null;
  const primarySelectedFilePath =
    primarySelectedTarget?.kind === "file" ? primarySelectedTarget.path : null;
  const selectedTargetPathSet = useMemo(
    () => new Set(selectedTargets.map((item) => item.path)),
    [selectedTargets]
  );
  const actionableSelectedTargets = useMemo(
    () => collapseNestedSelectionTargets(selectedTargets),
    [selectedTargets]
  );
  const canCopySelectedPath = Boolean(
    currentWorkspace?.path && selectedTargets.length === 1 && primarySelectedPath
  );
  const canDownloadSelectedFile =
    selectedTargets.length === 1 && primarySelectedTarget?.kind === "file";
  const canDeleteSelectedTarget = actionableSelectedTargets.length > 0;
  const canCopyOrCutSelection = actionableSelectedTargets.length > 0;
  const canPasteSelection = Boolean(fileClipboard?.items.length && workspaceId);
  const canCollapseCurrent = Boolean(
    (primarySelectedFilePath ? getParentDirectory(primarySelectedFilePath) : activeDirectoryPath) &&
      expandedDirectories.length
  );

  async function loadDirectory(directoryPath: string, force = false) {
    if (!workspaceId) {
      return [];
    }

    if (!force) {
      const cachedItems = treeCacheRef.current[directoryPath];

      if (cachedItems) {
        return cachedItems;
      }
    }

    if (directoryPath === ROOT_DIRECTORY) {
      setLoadingTree(true);
    } else {
      setLoadingDirectories((previous) => appendUnique(previous, directoryPath));
    }

    try {
      const items = await requestDirectorySnapshot(directoryPath, {
        force
      });

      updateTreeCache((previous) => ({
        ...previous,
        [directoryPath]: items
      }));

      return items;
    } catch (error) {
      if (!isSnapshotTimeoutError(error)) {
        showToast({
          title: readError(error, t("conversation.filePanelLoadFailed")),
          tone: "error"
        });
      }
      throw error;
    } finally {
      if (directoryPath === ROOT_DIRECTORY) {
        setLoadingTree(false);
      } else {
        setLoadingDirectories((previous) => previous.filter((item) => item !== directoryPath));
      }
    }
  }

  async function refreshTreeCache(options?: {
    activeDirectoryPath?: string;
    expandedDirectories?: string[];
  }) {
    if (!workspaceId) {
      return;
    }

    const effectiveActiveDirectoryPath =
      options?.activeDirectoryPath ?? activeDirectoryPathRef.current;
    const effectiveExpandedDirectories =
      options?.expandedDirectories ?? expandedDirectoriesRef.current;

    const targetDirectories = resolveRefreshTargetDirectories(
      treeCacheRef.current,
      effectiveActiveDirectoryPath,
      effectiveExpandedDirectories
    );

    logPerfDebug("file_panel.refresh_tree_cache.start", {
      sessionId,
      workspaceId,
      targetDirectories
    });

    const entries = await Promise.all(
      targetDirectories.map(async (directoryPath) => {
        const items = await requestDirectorySnapshot(directoryPath, {
          force: true
        });
        return [directoryPath, items] as const;
      })
    );

    const nextTreeCache = entries.reduce<FileTreeCache>((nextCache, [directoryPath, items]) => {
      nextCache[directoryPath] = items;
      return nextCache;
    }, {});

    logPerfDebug("file_panel.refresh_tree_cache.end", {
      sessionId,
      workspaceId,
      targetDirectories,
      directoryCount: Object.keys(nextTreeCache).length
    });

    updateTreeCache(nextTreeCache);
  }

  async function requestDirectorySnapshot(
    directoryPath: string,
    options?: DirectorySnapshotRequestOptions
  ): Promise<FileNodeDto[]> {
    if (!workspaceId) {
      return [];
    }

    if (!options?.force) {
      const cachedItems = treeCacheRef.current[directoryPath];

      if (cachedItems) {
        return cachedItems;
      }
    }

    const subscribedDirectories = collectSubscribedDirectories(
      appendUnique(expandedDirectoriesRef.current, directoryPath),
      directoryPath || activeDirectoryPathRef.current
    );

    subscribeFileTree(workspaceId, subscribedDirectories);
    requestFileTreeRefresh(workspaceId, [directoryPath]);
    return waitForDirectorySnapshot(directoryPath, FILE_TREE_SNAPSHOT_TIMEOUT_MS, {
      allowCached: options?.force !== true
    });
  }

  function waitForDirectorySnapshot(
    directoryPath: string,
    timeoutMs = FILE_TREE_SNAPSHOT_TIMEOUT_MS,
    options?: {
      allowCached?: boolean;
    }
  ): Promise<FileNodeDto[]> {
    const cachedItems = treeCacheRef.current[directoryPath];

    if (options?.allowCached !== false && cachedItems) {
      return Promise.resolve(cachedItems);
    }

    return new Promise<FileNodeDto[]>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        removeDirectoryWaiter(directoryPath, timerId);
        reject(new Error(`FILE_TREE_SNAPSHOT_TIMEOUT:${directoryPath}`));
      }, timeoutMs);
      const waiters = directoryWaitersRef.current.get(directoryPath) ?? [];

      directoryWaitersRef.current.set(directoryPath, [
        ...waiters,
        {
          resolve,
          reject,
          timerId
        }
      ]);
    });
  }

  function resolveDirectoryWaiters(directoryPath: string, items: FileNodeDto[]) {
    const waiters = directoryWaitersRef.current.get(directoryPath) ?? [];

    if (waiters.length === 0) {
      return;
    }

    directoryWaitersRef.current.delete(directoryPath);

    waiters.forEach((waiter) => {
      window.clearTimeout(waiter.timerId);
      waiter.resolve(items);
    });
  }

  function removeDirectoryWaiter(directoryPath: string, timerId: number) {
    const waiters = directoryWaitersRef.current.get(directoryPath) ?? [];
    const nextWaiters = waiters.filter((waiter) => waiter.timerId !== timerId);

    if (nextWaiters.length === 0) {
      directoryWaitersRef.current.delete(directoryPath);
      return;
    }

    directoryWaitersRef.current.set(directoryPath, nextWaiters);
  }

  function rejectAllDirectoryWaiters() {
    for (const [directoryPath, waiters] of directoryWaitersRef.current.entries()) {
      waiters.forEach((waiter) => {
        window.clearTimeout(waiter.timerId);
        waiter.reject(new Error(`FILE_TREE_ABORTED:${directoryPath}`));
      });
    }

    directoryWaitersRef.current.clear();
  }

  function setSingleSelection(target: FileSelectionTarget) {
    setSelectedTargets([target]);
    setSelectionAnchorPath(target.path);
  }

  function syncActiveDirectoryWithTarget(target: FileSelectionTarget) {
    setActiveDirectoryPath(target.kind === "directory" ? target.path : getParentDirectory(target.path));
  }

  function applyRangeSelection(target: FileSelectionTarget) {
    const rangeTargets = selectRangeTargets(orderedSelectionTargets, selectionAnchorPath, target);
    setSelectedTargets(rangeTargets);
    setSelectionAnchorPath(target.path);
    syncActiveDirectoryWithTarget(target);
  }

  function applyToggleSelection(target: FileSelectionTarget) {
    const nextTargets = toggleSelectionTarget(selectedTargets, target);
    const nextPrimaryTarget = getPrimarySelectedTarget(nextTargets);

    setSelectedTargets(nextTargets);
    setSelectionAnchorPath(target.path);

    if (nextPrimaryTarget) {
      syncActiveDirectoryWithTarget(nextPrimaryTarget);
    }
  }

  function applySingleSelection(target: FileSelectionTarget) {
    setSingleSelection(target);
    syncActiveDirectoryWithTarget(target);
  }

  function handleTargetSelection(
    target: FileSelectionTarget,
    event?: Pick<React.MouseEvent<HTMLElement>, "shiftKey" | "ctrlKey" | "metaKey">
  ) {
    if (event?.shiftKey) {
      applyRangeSelection(target);
      return;
    }

    if (isToggleSelectionEvent(event)) {
      applyToggleSelection(target);
      return;
    }

    applySingleSelection(target);
  }

  // 选中文件时要把父目录链展开，否则树高亮永远对不上。
  async function revealPathInTree(targetPath: string, includeLeafDirectory = false) {
    const directoryChain = getDirectoryChain(targetPath, includeLeafDirectory);

    if (!directoryChain.length) {
      setActiveDirectoryPath(ROOT_DIRECTORY);
      return;
    }

    updateExpandedDirectories((previous) => mergeUnique(previous, directoryChain));
    setActiveDirectoryPath(directoryChain[directoryChain.length - 1] ?? ROOT_DIRECTORY);

    for (const directoryPath of directoryChain) {
      try {
        await loadDirectory(directoryPath);
      } catch {
        return;
      }
    }
  }

  async function selectFile(filePath: string) {
    const target = createSelectionTarget(filePath, "file");
    setSingleSelection(target);
    syncActiveDirectoryWithTarget(target);
    await revealPathInTree(filePath);
  }

  async function openFileViewer(filePath: string) {
    setViewerFilePath(filePath);
    setViewerDiffContent(null);
    recentFileActivationRef.current = null;
    viewerDiffRequestIdRef.current += 1;

    void selectFile(filePath);

    // 预览视图始终先打开，diff 只作为滚动标尺数据源，不能反过来接管整个查看器。
    const requestId = viewerDiffRequestIdRef.current;
    const normalizedPath = filePath.replace(/\\/g, "/");
    const status = gitChangeInfo.statusByPath.get(normalizedPath);
    if (workspaceId && status && status !== "?" && status !== "D") {
      try {
        const diffResult = await getGitDiff(workspaceId, filePath, false);

        if (viewerDiffRequestIdRef.current === requestId) {
          setViewerDiffContent(diffResult.content || null);
        }
      } catch {
        if (viewerDiffRequestIdRef.current === requestId) {
          setViewerDiffContent(null);
        }
      }
    }
  }

  function shouldOpenViewerByRepeatClick(filePath: string): boolean {
    const now = Date.now();
    const recentActivation = recentFileActivationRef.current;
    recentFileActivationRef.current = {
      filePath,
      timestamp: now
    };

    return (
      recentActivation?.filePath === filePath &&
      now - recentActivation.timestamp <= FILE_REPEAT_ACTIVATION_MS
    );
  }

  function resetRecentFileActivation() {
    recentFileActivationRef.current = null;
  }

  async function handleWorkspaceFileClick(
    filePath: string,
    event?: Pick<React.MouseEvent<HTMLElement>, "shiftKey" | "ctrlKey" | "metaKey">
  ) {
    const target = createSelectionTarget(filePath, "file");

    if (event?.shiftKey || isToggleSelectionEvent(event)) {
      resetRecentFileActivation();
      handleTargetSelection(target, event);
      return;
    }

    if (shouldOpenViewerByRepeatClick(filePath)) {
      await openFileViewer(filePath);
      return;
    }

    handleTargetSelection(target, event);
    await revealPathInTree(filePath);
  }

  function closeSearchPanel() {
    setSearchVisible(false);
    setSearchKeyword("");
    setSearchResult(null);
    resetRecentFileActivation();
  }

  async function handleSearchResultClick(
    item: FileNodeDto,
    event?: Pick<React.MouseEvent<HTMLElement>, "shiftKey" | "ctrlKey" | "metaKey">
  ) {
    const target = createSelectionTarget(item.path, item.kind);

    if (event?.shiftKey || isToggleSelectionEvent(event)) {
      resetRecentFileActivation();
      handleTargetSelection(target, event);
      return;
    }

    if (item.kind === "directory") {
      closeSearchPanel();
      handleTargetSelection(target, event);
      await expandDirectory(item.path);
      return;
    }

    if (shouldOpenViewerByRepeatClick(item.path)) {
      closeSearchPanel();
      await openFileViewer(item.path);
      return;
    }

    await selectFile(item.path);
  }

  async function expandDirectory(directoryPath: string) {
    setSingleSelection(createSelectionTarget(directoryPath, "directory"));
    setActiveDirectoryPath(directoryPath);

    if (expandedDirectoriesRef.current.includes(directoryPath)) {
      return;
    }

    try {
      await loadDirectory(directoryPath);
      updateExpandedDirectories((previous) => appendUnique(previous, directoryPath));
    } catch {
      // loadDirectory 已经提示错误，这里不再重复报。
    }
  }

  async function toggleDirectory(directoryPath: string) {
    setSingleSelection(createSelectionTarget(directoryPath, "directory"));
    setActiveDirectoryPath(directoryPath);

    if (expandedDirectoriesRef.current.includes(directoryPath)) {
      collapseBranch(directoryPath);
      return;
    }

    await expandDirectory(directoryPath);
  }

  function collapseBranch(directoryPath: string) {
    updateExpandedDirectories((previous) =>
      previous.filter((item) => item !== directoryPath && !item.startsWith(`${directoryPath}/`))
    );
    setActiveDirectoryPath(getParentDirectory(directoryPath));
    setSelectedTargets([]);
    setSelectionAnchorPath(null);
  }

  async function handleRefresh() {
    if (!workspaceId) {
      return;
    }

    const wid = workspaceId;

    try {
      // 手动刷新时同步触发 git status 更新（通过 WebSocket）
      requestGitRefresh(wid);
      await refreshTreeCache();

      if (primarySelectedFilePath) {
        await revealPathInTree(primarySelectedFilePath);
      }

      if (searchMode && searchKeyword.trim()) {
        const response = await searchFiles(wid, searchKeyword.trim());
        setSearchResult(response.items);
      }
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelLoadFailed")),
        tone: "error"
      });
    }
  }

  async function handleSearchSubmit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!workspaceId || !searchKeyword.trim()) {
      setSearchResult(null);
      return;
    }

    setSearching(true);

    try {
      const response = await searchFiles(workspaceId, searchKeyword.trim());
      setSearchResult(response.items);
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelSearchFailed")),
        tone: "error"
      });
    } finally {
      setSearching(false);
    }
  }

  function handleToggleSearch() {
    if (searchVisible) {
      setSearchVisible(false);
      setSearchKeyword("");
      setSearchResult(null);
      return;
    }

    setSearchVisible(true);
  }

  function handleMobileToolbarAction(action: () => void | Promise<void>) {
    setMobileActionMenuOpen(false);
    void action();
  }

  function handleUploadTrigger() {
    uploadInputRef.current?.click();
  }

  async function handleUploadInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !workspaceId) {
      return;
    }

    const safeFileName = normalizeUploadFileName(file.name);

    if (!safeFileName) {
      showToast({
        title: t("conversation.filePanelUploadFailed"),
        tone: "error"
      });
      return;
    }

    const baseDirectory = getCreateBaseDirectory(activeDirectoryPath, primarySelectedTarget);
    const targetPath = joinRelativePath(baseDirectory, safeFileName);

    setTransferring(true);

    try {
      const contentBase64 = await readFileAsBase64(file);

      await uploadFile({
        workspaceId,
        path: targetPath,
        contentBase64
      });

      await refreshTreeCache();
      await selectFile(targetPath);
      showToast({
        title: t("conversation.filePanelUploadSuccess", {
          name: safeFileName
        }),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelUploadFailed")),
        tone: "error"
      });
    } finally {
      setTransferring(false);
    }
  }

  async function handleDownload(explicitFilePath = primarySelectedFilePath) {
    if (!workspaceId || !explicitFilePath) {
      return;
    }

    setTransferring(true);

    try {
      const payload = await downloadFile(workspaceId, explicitFilePath);
      const fileBuffer = decodeBase64ToArrayBuffer(payload.contentBase64);

      downloadBlob(payload.fileName, new Blob([fileBuffer], {
        type: "application/octet-stream"
      }));
      showToast({
        title: t("conversation.filePanelDownloadSuccess", {
          name: payload.fileName
        }),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelDownloadFailed")),
        tone: "error"
      });
    } finally {
      setTransferring(false);
    }
  }

  function handleCollapseCurrent() {
    const targetDirectory = primarySelectedFilePath
      ? getParentDirectory(primarySelectedFilePath)
      : activeDirectoryPath;

    if (!targetDirectory || !expandedDirectoriesRef.current.includes(targetDirectory)) {
      return;
    }

    collapseBranch(targetDirectory);
  }

  async function handleCreate(
    opType: "create_file" | "create_directory",
    explicitBaseDirectory = getCreateBaseDirectory(activeDirectoryPath, primarySelectedTarget)
  ) {
    if (!workspaceId) {
      return;
    }

    const baseDirectory = explicitBaseDirectory;
    const defaultPath = baseDirectory ? `${baseDirectory}/` : "";
    const nextPath = window.prompt(
      opType === "create_file"
        ? t("conversation.filePanelCreateFilePrompt")
        : t("conversation.filePanelCreateDirectoryPrompt"),
      defaultPath
    );

    if (!nextPath?.trim()) {
      return;
    }

    const safeNextPath = nextPath.trim();

    setMutating(true);

    try {
      await operateFile({
        workspaceId,
        opType,
        dstPath: safeNextPath,
        content: opType === "create_file" ? "" : undefined
      });

      await refreshTreeCache();

      if (opType === "create_directory") {
        await revealPathInTree(safeNextPath, true);
        setSingleSelection(createSelectionTarget(safeNextPath, "directory"));
        setActiveDirectoryPath(safeNextPath);
      } else {
        await selectFile(safeNextPath);
      }
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelMutateFailed")),
        tone: "error"
      });
    } finally {
      setMutating(false);
    }
  }

  function handleCopyCutRequest(
    mode: FileClipboardMode,
    targets: FileSelectionTarget[] = actionableSelectedTargets
  ) {
    if (targets.length === 0) {
      return;
    }

    const nextTargets = collapseNestedSelectionTargets(targets);
    setFileClipboard({
      mode,
      items: nextTargets
    });
    setSelectedTargets(nextTargets);
    setSelectionAnchorPath(nextTargets[nextTargets.length - 1]?.path ?? null);
    showToast({
      title:
        mode === "copy"
          ? t("conversation.filePanelCopySelectionSuccess", {
              count: nextTargets.length
            })
          : t("conversation.filePanelCutSelectionSuccess", {
              count: nextTargets.length
            }),
      tone: "success"
    });
    setWebContextMenu(null);
  }

  async function handlePasteRequest(
    explicitBaseDirectory = resolvePasteBaseDirectory(primarySelectedTarget, activeDirectoryPath)
  ) {
    if (!workspaceId || !fileClipboard || !fileClipboard.items.length) {
      return;
    }

    const baseDirectory = explicitBaseDirectory ?? ROOT_DIRECTORY;
    const nextTargets = fileClipboard.items.map((item) => ({
      source: item,
      destinationPath: joinRelativePath(baseDirectory, getPathLeafName(item.path) || item.path)
    }));

    setMutating(true);

    try {
      for (const target of nextTargets) {
        if (
          fileClipboard.mode === "cut" &&
          normalizeRelativeClipboardPath(target.source.path) ===
            normalizeRelativeClipboardPath(target.destinationPath)
        ) {
          continue;
        }

        await operateFile({
          workspaceId,
          opType: fileClipboard.mode === "copy" ? "copy" : "move",
          srcPath: target.source.path,
          dstPath: target.destinationPath
        });
      }

      const pastedTargets = nextTargets.map((item) =>
        createSelectionTarget(item.destinationPath, item.source.kind)
      );
      const nextPrimaryTarget = pastedTargets[pastedTargets.length - 1] ?? null;

      if (fileClipboard.mode === "cut") {
        setFileClipboard(null);
      }

      setSelectedTargets(pastedTargets);
      setSelectionAnchorPath(nextPrimaryTarget?.path ?? null);
      if (nextPrimaryTarget) {
        syncActiveDirectoryWithTarget(nextPrimaryTarget);
      }
      resetRecentFileActivation();

      await refreshTreeCache({
        activeDirectoryPath:
          nextPrimaryTarget?.kind === "directory"
            ? nextPrimaryTarget.path
            : nextPrimaryTarget
              ? getParentDirectory(nextPrimaryTarget.path)
              : activeDirectoryPathRef.current,
        expandedDirectories: expandedDirectoriesRef.current
      });

      if (searchMode && searchKeyword.trim()) {
        const response = await searchFiles(workspaceId, searchKeyword.trim());
        setSearchResult(response.items);
      }

      setSessionRefreshVersion((current) => current + 1);
      showToast({
        title: t("conversation.filePanelPasteSuccess", {
          count: pastedTargets.length
        }),
        tone: "success"
      });
      setWebContextMenu(null);
    } catch (error) {
      await refreshTreeCache().catch(() => undefined);
      showToast({
        title: readError(error, t("conversation.filePanelPasteFailed")),
        tone: "error"
      });
    } finally {
      setMutating(false);
    }
  }

  function handleDeleteRequest(targets: FileSelectionTarget[] = actionableSelectedTargets) {
    if (!targets.length || mutating) {
      return;
    }

    setDeleteConfirmTargets(collapseNestedSelectionTargets(targets));
    setWebContextMenu(null);
  }

  async function handleDeleteConfirm() {
    if (!workspaceId || !deleteConfirmTargets?.length) {
      return;
    }

    const effectiveDeleteTargets = collapseNestedSelectionTargets(deleteConfirmTargets);

    setMutating(true);

    try {
      for (const target of effectiveDeleteTargets) {
        await operateFile({
          workspaceId,
          opType: "delete",
          srcPath: target.path
        });
      }

      const nextActiveDirectory = resolveSafeActiveDirectoryAfterDelete(
        activeDirectoryPath,
        effectiveDeleteTargets
      );
      const nextExpandedDirectories = expandedDirectoriesRef.current.filter(
        (item) =>
          !effectiveDeleteTargets.some(
            (target) => target.kind === "directory" && isSameOrDescendantPath(target.path, item)
          )
      );

      if (
        viewerFilePath &&
        effectiveDeleteTargets.some((target) => isSameOrDescendantPath(target.path, viewerFilePath))
      ) {
        viewerDiffRequestIdRef.current += 1;
        setViewerFilePath(null);
        setViewerDiffContent(null);
      }

      setDeleteConfirmTargets(null);
      setSelectedTargets([]);
      setSelectionAnchorPath(null);
      activeDirectoryPathRef.current = nextActiveDirectory;
      expandedDirectoriesRef.current = nextExpandedDirectories;
      setActiveDirectoryPath(nextActiveDirectory);
      updateExpandedDirectories(nextExpandedDirectories);
      resetRecentFileActivation();

      await refreshTreeCache({
        activeDirectoryPath: nextActiveDirectory,
        expandedDirectories: nextExpandedDirectories
      });

      if (searchMode && searchKeyword.trim()) {
        const response = await searchFiles(workspaceId, searchKeyword.trim());
        setSearchResult(response.items);
      }

      setSessionRefreshVersion((current) => current + 1);
      showToast({
        title:
          effectiveDeleteTargets.length === 1
            ? t("conversation.filePanelDeleteSuccess", {
                name:
                  getPathLeafName(effectiveDeleteTargets[0]?.path ?? "") ||
                  effectiveDeleteTargets[0]?.path ||
                  ""
              })
            : t("conversation.filePanelDeleteSelectionSuccess", {
                count: effectiveDeleteTargets.length
              }),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelMutateFailed")),
        tone: "error"
      });
    } finally {
      setMutating(false);
    }
  }

  async function handleCopyPath(
    mode: "absolute" | "relative",
    explicitTarget = primarySelectedTarget
  ) {
    const workspacePath = currentWorkspace?.path ?? "";
    const targetPath = explicitTarget?.path ?? null;

    if (targetPath === null || !workspacePath) {
      setCopyPathMenuOpen(false);
      return;
    }

    try {
      const backendPathStyle = resolveBackendPathStyle(workspacePath);
      const copiedPath =
        mode === "absolute"
          ? buildAbsoluteWorkspacePath(workspacePath, targetPath, backendPathStyle)
          : normalizeRelativeClipboardPath(targetPath, backendPathStyle);

      await writeTextToClipboard(copiedPath, platform);
      showToast({
        title:
          mode === "absolute"
            ? t("conversation.filePanelCopyAbsolutePathSuccess")
            : t("conversation.filePanelCopyRelativePathSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.filePanelCopyPathFailed"),
        tone: "error"
      });
    } finally {
      setCopyPathMenuOpen(false);
      setWebContextMenu(null);
    }
  }

  function buildWorkspaceContextMenuItems(
    target: FileSelectionTarget,
    effectiveSelection: FileSelectionTarget[],
    baseDirectory: string
  ): DesktopContextMenuItem[] {
    return [
      {
        id: `open-${target.path}`,
        label:
          target.kind === "directory"
            ? expandedDirectories.includes(target.path)
              ? t("conversation.filePanelCollapseDirectory")
              : t("conversation.filePanelExpandDirectory")
            : t("conversation.filePanelOpenFile"),
        onSelect: () => {
          if (target.kind === "directory") {
            void toggleDirectory(target.path);
            return;
          }

          void openFileViewer(target.path);
        }
      },
      {
        id: `download-${target.path}`,
        label: t("conversation.filePanelDownload"),
        disabled: target.kind !== "file" || transferring,
        onSelect: () => {
          void handleDownload(target.kind === "file" ? target.path : null);
        }
      },
      {
        id: `create-file-${target.path}`,
        label: t("conversation.filePanelNewFile"),
        disabled: !workspaceId || mutating || transferring,
        onSelect: () => {
          void handleCreate("create_file", baseDirectory);
        }
      },
      {
        id: `create-directory-${target.path}`,
        label: t("conversation.filePanelNewDirectory"),
        disabled: !workspaceId || mutating || transferring,
        onSelect: () => {
          void handleCreate("create_directory", baseDirectory);
        }
      },
      {
        id: `copy-${target.path}`,
        label: t("conversation.filePanelCopy"),
        disabled: effectiveSelection.length === 0,
        onSelect: () => handleCopyCutRequest("copy", effectiveSelection)
      },
      {
        id: `cut-${target.path}`,
        label: t("conversation.filePanelCut"),
        disabled: effectiveSelection.length === 0,
        onSelect: () => handleCopyCutRequest("cut", effectiveSelection)
      },
      {
        id: `paste-${target.path}`,
        label: t("conversation.filePanelPaste"),
        disabled: !canPasteSelection,
        onSelect: () => {
          void handlePasteRequest(baseDirectory);
        }
      },
      {
        id: `copy-relative-${target.path}`,
        label: t("conversation.filePanelCopyRelativePath"),
        onSelect: () => {
          void handleCopyPath("relative", target);
        }
      },
      {
        id: `copy-absolute-${target.path}`,
        label: t("conversation.filePanelCopyAbsolutePath"),
        onSelect: () => {
          void handleCopyPath("absolute", target);
        }
      },
      {
        id: `delete-${target.path}`,
        label: t("conversation.filePanelDelete"),
        disabled: effectiveSelection.length === 0 || mutating || transferring,
        onSelect: () => handleDeleteRequest(effectiveSelection)
      }
    ];
  }

  async function handleWorkspaceItemContextMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    item: FileNodeDto
  ) {
    if (platform.isMobile) {
      return;
    }

    event.preventDefault();
    const target = createSelectionTarget(item.path, item.kind);
    const effectiveSelection = selectedTargetPathSet.has(target.path)
      ? actionableSelectedTargets
      : [target];
    const itemBaseDirectory =
      target.kind === "directory" ? target.path : getParentDirectory(target.path);

    if (!selectedTargetPathSet.has(target.path)) {
      applySingleSelection(target);
    }

    const menuItems = buildWorkspaceContextMenuItems(target, effectiveSelection, itemBaseDirectory);

    if (platform.isDesktop) {
      await showDesktopContextMenu(menuItems);
      return;
    }

    if (platform.isWeb) {
      setCopyPathMenuOpen(false);
      setMobileActionMenuOpen(false);
      setWebContextMenu({
        positionX: event.clientX,
        positionY: event.clientY,
        items: menuItems
      });
    }
  }

  useEffect(() => {
    if (activeTab !== "workspace") {
      return;
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (!hasModifierKey(event) || event.altKey || event.shiftKey) {
        return;
      }

      if (isEditableEventTarget(event.target)) {
        return;
      }

      const lowerKey = event.key.toLowerCase();

      if (lowerKey === "c" && canCopyOrCutSelection) {
        event.preventDefault();
        handleCopyCutRequest("copy");
        return;
      }

      if (lowerKey === "x" && canCopyOrCutSelection) {
        event.preventDefault();
        handleCopyCutRequest("cut");
        return;
      }

      if (lowerKey === "v" && canPasteSelection) {
        event.preventDefault();
        void handlePasteRequest();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [
    activeTab,
    canCopyOrCutSelection,
    canPasteSelection,
    handleCopyCutRequest,
    handlePasteRequest
  ]);

  function renderTree(items: FileNodeDto[], depth: number) {
    return (
      <>
        {items.map((item) => {
          const target = createSelectionTarget(item.path, item.kind);
          const isDirectory = item.kind === "directory";
          const isExpanded = isDirectory && expandedDirectories.includes(item.path);
          const isLoading = isDirectory && loadingDirectories.includes(item.path);
          const rawChildItems = visibleTreeCache[item.path] ?? [];
          // 筛选模式下递归过滤子节点
          const childItems = showChangesOnly
            ? filterTreeByChanges(
                rawChildItems,
                visibleTreeCache,
                gitChangeInfo.statusByPath,
                gitChangeInfo.changedDirs
              )
            : rawChildItems;
          const isSelected = selectedTargetPathSet.has(item.path);
          const isActive = primarySelectedPath === item.path;
          const changeStatus = gitChangeInfo.statusByPath.get(item.path.replace(/\\/g, "/"));
          const hasDirChanges = isDirectory && gitChangeInfo.changedDirs.has(item.path.replace(/\\/g, "/"));
          const isCutPending =
            fileClipboard?.mode === "cut" &&
            fileClipboard.items.some((clipboardItem) => clipboardItem.path === item.path);

          return (
            <div key={`${item.kind}-${item.path}`} className="file-tree-node">
              <button
                className="file-tree-item"
                type="button"
                data-active={isActive}
                data-selected={isSelected}
                data-cut-pending={isCutPending || undefined}
                data-kind={item.kind}
                aria-expanded={isDirectory ? isExpanded : undefined}
                style={{
                  paddingInlineStart: `${SIDEBAR_TREE_ROOT_PADDING_PX + depth * SIDEBAR_TREE_DEPTH_STEP_PX}px`
                }}
                onClick={(event) => {
                  if (isDirectory) {
                    if (event.shiftKey || isToggleSelectionEvent(event)) {
                      resetRecentFileActivation();
                      handleTargetSelection(target, event);
                      return;
                    }

                    resetRecentFileActivation();
                    handleTargetSelection(target, event);
                    void toggleDirectory(item.path);
                    return;
                  }

                  void handleWorkspaceFileClick(item.path, event);
                }}
                onContextMenu={(event) => {
                  void handleWorkspaceItemContextMenu(event, item);
                }}
              >
                <span className={`file-tree-chevron${isDirectory ? "" : " is-hidden"}`} aria-hidden="true">
                  {isExpanded ? "v" : ">"}
                </span>
                {!isDirectory ? (
                  <span
                    className="git-tree-file-icon"
                    data-kind={resolveFileTreeIconKind(item.name)}
                    aria-hidden="true"
                  >
                    {resolveFileTreeIconLabel(item.name)}
                  </span>
                ) : null}
                <span className="file-tree-label" data-status={changeStatus ?? undefined} data-has-changes={hasDirChanges || undefined}>
                  {item.name}
                </span>
                {!isDirectory && changeStatus ? (
                  <span className="git-status-badge" data-status={changeStatus} aria-label={changeStatus}>
                    {changeStatus}
                  </span>
                ) : null}
                {isDirectory && hasDirChanges ? (
                  <span className="file-tree-dir-badge" aria-hidden="true" />
                ) : null}
                {isLoading ? <span className="file-tree-meta">{t("common.loading")}</span> : null}
              </button>

              {isDirectory && isExpanded ? (
                <div className="file-tree-children">
                  {isLoading && !rawChildItems.length ? (
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
    );
  }

  function renderSearchResults(items: FileNodeDto[]) {
    return (
      <>
        {items.map((item) => {
          const isDirectory = item.kind === "directory";
          const isSelected = selectedTargetPathSet.has(item.path);
          const isActive = primarySelectedPath === item.path;

          return (
            <div key={`search-${item.kind}-${item.path}`} className="file-tree-node">
              <button
                className="file-tree-item is-search-result"
                type="button"
                data-active={isActive}
                data-selected={isSelected}
                data-kind={item.kind}
                onClick={(event) => {
                  void handleSearchResultClick(item, event);
                }}
                onContextMenu={(event) => {
                  void handleWorkspaceItemContextMenu(event, item);
                }}
              >
                <span className="file-tree-chevron is-hidden" aria-hidden="true">&gt;</span>
                {!isDirectory ? (
                  <span
                    className="git-tree-file-icon"
                    data-kind={resolveFileTreeIconKind(item.name)}
                    aria-hidden="true"
                  >
                    {resolveFileTreeIconLabel(item.name)}
                  </span>
                ) : null}
                <span className="file-tree-label">
                  <span className="file-tree-name">{item.name}</span>
                  <span className="file-tree-path">{item.path}</span>
                </span>
              </button>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <section
      className={["conversation-panel", "surface-card", "file-panel", className].filter(Boolean).join(" ")}
      data-testid="file-context-panel"
    >
      {!workspaceId ? (
        <section className="file-panel-section">
          <p className="status-text">{t("conversation.filePanelNoWorkspace")}</p>
        </section>
      ) : (
        <>
          <FileViewerModal
            workspaceId={workspaceId}
            filePath={viewerFilePath}
            open={viewerFilePath !== null}
            onClose={() => {
              viewerDiffRequestIdRef.current += 1;
              setViewerFilePath(null);
              setViewerDiffContent(null);
            }}
            onSaved={async (filePath) => {
              await refreshTreeCache();
              await selectFile(filePath);
              setSessionRefreshVersion((current) => current + 1);
            }}
            diffContent={viewerDiffContent}
          />
          {hideHeading ? null : (
            <div className="file-panel-heading-row">
              <h2 className="file-panel-heading">{t("conversation.filePanelTitle")}</h2>
            </div>
          )}
          <div className="file-panel-tabs" role="tablist" aria-label={t("conversation.filePanelTitle")}>
            <button
              className={activeTab === "workspace" ? "file-panel-tab active" : "file-panel-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "workspace"}
              onClick={() => setActiveTab("workspace")}
            >
              {t("conversation.filePanelWorkspaceTab")}
            </button>
            <button
              className={activeTab === "session" ? "file-panel-tab active" : "file-panel-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "session"}
              onClick={() => {
                if (!hasSessionContext) {
                  return;
                }

                setActiveTab("session");
              }}
              disabled={!hasSessionContext}
            >
              {t("conversation.filePanelSessionTab")}
              <span className="file-panel-tab-badge" aria-label={`${t("conversation.filePanelSessionTab")} ${sessionChangeCount}`}>
                {sessionChangeCount}
              </span>
            </button>
          </div>

          {activeTab === "workspace" ? (
            <>
              <input
                ref={uploadInputRef}
                data-testid="file-panel-upload-input"
                type="file"
                hidden
                onChange={(event) => void handleUploadInputChange(event)}
              />
              {shouldUseMobileActionMenu ? (
                <div className="file-panel-toolbar file-panel-toolbar-mobile" aria-label={t("conversation.filePanelTitle")}>
                  <div className="file-mobile-action-shell" ref={mobileActionMenuRef}>
                    <button
                      className="secondary-button file-mobile-action-trigger"
                      type="button"
                      aria-label={t("conversation.filePanelActionsMenu")}
                      aria-haspopup="menu"
                      aria-expanded={mobileActionMenuOpen}
                      data-active={mobileActionMenuOpen}
                      onClick={() => {
                        setCopyPathMenuOpen(false);
                        setMobileActionMenuOpen((current) => !current);
                      }}
                    >
                      <span>{t("conversation.filePanelActionsMenu")}</span>
                      <MenuChevronIcon />
                    </button>
                    {mobileActionMenuOpen ? (
                      <div
                        className="file-mobile-action-menu"
                        role="menu"
                        aria-label={t("conversation.filePanelActionsMenu")}
                      >
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(() => handleCopyCutRequest("copy"))}
                          disabled={!canCopyOrCutSelection}
                        >
                          {t("conversation.filePanelCopy")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(() => handleCopyCutRequest("cut"))}
                          disabled={!canCopyOrCutSelection}
                        >
                          {t("conversation.filePanelCut")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(() => handlePasteRequest())}
                          disabled={!canPasteSelection || mutating || transferring}
                        >
                          {t("conversation.filePanelPaste")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMobileActionMenuOpen(false);
                            handleToggleSearch();
                          }}
                        >
                          {searchVisible
                            ? t("conversation.filePanelHideSearch")
                            : t("conversation.filePanelShowSearch")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMobileActionMenuOpen(false);
                            setShowChangesOnly((current) => !current);
                          }}
                          disabled={visibleGitChanges.length === 0}
                        >
                          {showChangesOnly ? t("conversation.filePanelShowAll") : t("conversation.filePanelFilterChanges")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(handleRefresh)}
                          disabled={loadingTree || mutating || searching}
                        >
                          {t("conversation.filePanelRefresh")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMobileActionMenuOpen(false);
                            handleCollapseCurrent();
                          }}
                          disabled={!canCollapseCurrent}
                        >
                          {t("conversation.filePanelCollapseCurrent")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMobileActionMenuOpen(false);
                            handleUploadTrigger();
                          }}
                          disabled={mutating || transferring}
                        >
                          {t("conversation.filePanelUpload")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(handleDownload)}
                          disabled={!canDownloadSelectedFile || transferring}
                        >
                          {t("conversation.filePanelDownload")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item danger"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(handleDeleteRequest)}
                          disabled={!canDeleteSelectedTarget || mutating || transferring}
                        >
                          {t("conversation.filePanelDelete")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(() => handleCreate("create_file"))}
                          disabled={mutating || transferring}
                        >
                          {t("conversation.filePanelNewFile")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() =>
                            handleMobileToolbarAction(() => handleCreate("create_directory"))
                          }
                          disabled={mutating || transferring}
                        >
                          {t("conversation.filePanelNewDirectory")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(() => handleCopyPath("absolute"))}
                          disabled={!canCopySelectedPath}
                        >
                          {t("conversation.filePanelCopyAbsolutePath")}
                        </button>
                        <button
                          className="file-mobile-action-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => handleMobileToolbarAction(() => handleCopyPath("relative"))}
                          disabled={!canCopySelectedPath}
                        >
                          {t("conversation.filePanelCopyRelativePath")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="file-panel-toolbar" aria-label={t("conversation.filePanelTitle")}>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelCopy")}
                    aria-label={t("conversation.filePanelCopy")}
                    onClick={() => handleCopyCutRequest("copy")}
                    disabled={!canCopyOrCutSelection}
                  >
                    <CopyIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelCut")}
                    aria-label={t("conversation.filePanelCut")}
                    onClick={() => handleCopyCutRequest("cut")}
                    disabled={!canCopyOrCutSelection}
                  >
                    <CutIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelPaste")}
                    aria-label={t("conversation.filePanelPaste")}
                    onClick={() => void handlePasteRequest()}
                    disabled={!canPasteSelection || mutating || transferring}
                  >
                    <PasteIcon />
                  </button>
                  <div className="file-toolbar-menu-shell" ref={copyPathMenuRef}>
                    <button
                      className="file-toolbar-button"
                      type="button"
                      title={t("conversation.filePanelCopyPath")}
                      aria-label={t("conversation.filePanelCopyPath")}
                      aria-haspopup="menu"
                      aria-expanded={copyPathMenuOpen}
                      data-active={copyPathMenuOpen}
                      onClick={() => {
                        setMobileActionMenuOpen(false);
                        setCopyPathMenuOpen((current) => !current);
                      }}
                      disabled={!canCopySelectedPath}
                    >
                      <PathCopyIcon />
                    </button>
                    {copyPathMenuOpen ? (
                      <div className="file-toolbar-menu" role="menu">
                        <button
                          className="file-toolbar-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => void handleCopyPath("absolute")}
                        >
                          {t("conversation.filePanelCopyAbsolutePath")}
                        </button>
                        <button
                          className="file-toolbar-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => void handleCopyPath("relative")}
                        >
                          {t("conversation.filePanelCopyRelativePath")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelCollapseCurrent")}
                    aria-label={t("conversation.filePanelCollapseCurrent")}
                    onClick={handleCollapseCurrent}
                    disabled={!canCollapseCurrent}
                  >
                    <CollapseIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelRefresh")}
                    aria-label={t("conversation.filePanelRefresh")}
                    onClick={() => void handleRefresh()}
                    disabled={loadingTree || mutating || searching}
                  >
                    <RefreshIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelSearchButton")}
                    aria-label={t("conversation.filePanelSearchButton")}
                    data-active={searchVisible}
                    onClick={handleToggleSearch}
                    disabled={loadingTree}
                  >
                    <SearchIcon />
                  </button>
                  {visibleGitChanges.length > 0 ? (
                    <button
                      className="file-toolbar-button"
                      type="button"
                      title={showChangesOnly ? t("conversation.filePanelShowAll") : t("conversation.filePanelFilterChanges")}
                      aria-label={showChangesOnly ? t("conversation.filePanelShowAll") : t("conversation.filePanelFilterChanges")}
                      data-active={showChangesOnly}
                      onClick={() => setShowChangesOnly((current) => !current)}
                    >
                      <FilterIcon />
                    </button>
                  ) : null}
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelUpload")}
                    aria-label={t("conversation.filePanelUpload")}
                    onClick={handleUploadTrigger}
                    disabled={mutating || transferring}
                  >
                    <UploadIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelDownload")}
                    aria-label={t("conversation.filePanelDownload")}
                    onClick={() => void handleDownload()}
                    disabled={!canDownloadSelectedFile || transferring}
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    className="file-toolbar-button danger"
                    type="button"
                    title={t("conversation.filePanelDelete")}
                    aria-label={t("conversation.filePanelDelete")}
                    onClick={() => handleDeleteRequest()}
                    disabled={!canDeleteSelectedTarget || mutating || transferring}
                  >
                    <DeleteIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelNewFile")}
                    aria-label={t("conversation.filePanelNewFile")}
                    onClick={() => void handleCreate("create_file")}
                    disabled={mutating || transferring}
                  >
                    <FilePlusIcon />
                  </button>
                  <button
                    className="file-toolbar-button"
                    type="button"
                    title={t("conversation.filePanelNewDirectory")}
                    aria-label={t("conversation.filePanelNewDirectory")}
                    onClick={() => void handleCreate("create_directory")}
                    disabled={mutating || transferring}
                  >
                    <FolderPlusIcon />
                  </button>
                </div>
              )}

              {webContextMenu && typeof document !== "undefined"
                ? createPortal(
                    <div
                      className="file-web-context-menu"
                      ref={webContextMenuRef}
                      role="menu"
                      aria-label={t("conversation.filePanelActionsMenu")}
                      style={{
                        left: `${webContextMenuLayout?.left ?? Math.max(8, webContextMenu.positionX)}px`,
                        top: `${webContextMenuLayout?.top ?? Math.max(8, webContextMenu.positionY)}px`,
                        maxHeight: webContextMenuLayout ? `${webContextMenuLayout.maxHeight}px` : undefined
                      }}
                    >
                      {webContextMenu.items.map((item) => (
                        <button
                          key={item.id}
                          className={[
                            "file-web-context-menu-item",
                            item.label === t("conversation.filePanelDelete") ? "danger" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          type="button"
                          role="menuitem"
                          disabled={item.disabled}
                          onClick={() => {
                            setWebContextMenu(null);
                            void item.onSelect();
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>,
                    document.body
                  )
                : null}

              {selectedTargets.length > 0 || fileClipboard ? (
                <div className="file-panel-selection-summary" aria-live="polite">
                  {selectedTargets.length > 0 ? (
                    <span>
                      {t("conversation.filePanelSelectionCount", {
                        count: selectedTargets.length
                      })}
                    </span>
                  ) : null}
                  {fileClipboard ? (
                    <span>
                      {fileClipboard.mode === "copy"
                        ? t("conversation.filePanelClipboardCopyReady", {
                            count: fileClipboard.items.length
                          })
                        : t("conversation.filePanelClipboardCutReady", {
                            count: fileClipboard.items.length
                          })}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {searchVisible ? (
                <form className="file-toolbar-search" onSubmit={(event) => void handleSearchSubmit(event)}>
                  <input
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    placeholder={t("conversation.filePanelSearchPlaceholder")}
                  />
                  {shouldUseMobileActionMenu ? (
                    <button
                      className="secondary-button file-mobile-search-submit"
                      type="submit"
                      aria-label={t("conversation.filePanelSearchButton")}
                      disabled={searching}
                    >
                      {t("conversation.filePanelSearchButton")}
                    </button>
                  ) : (
                    <button
                      className="file-toolbar-button"
                      type="submit"
                      title={t("conversation.filePanelSearchButton")}
                      aria-label={t("conversation.filePanelSearchButton")}
                      disabled={searching}
                    >
                      <SearchIcon />
                    </button>
                  )}
                </form>
              ) : null}

              <div className="file-tree" data-search-mode={searchMode}>
                {loadingTree && rootItems.length === 0 ? (
                  <p className="file-tree-status status-text">{t("common.loading")}</p>
                ) : searchMode ? (
                  visibleSearchResult?.length ? (
                    renderSearchResults(visibleSearchResult)
                  ) : (
                    <p className="file-tree-status status-text">{t("conversation.filePanelSearchEmpty")}</p>
                  )
                ) : showChangesOnly ? (
                  visibleWorkspaceItems.length ? (
                    renderTree(visibleWorkspaceItems, 0)
                  ) : (
                    <p className="file-tree-status status-text">{t("conversation.filePanelNoChanges")}</p>
                  )
                ) : rootItems.length ? (
                  renderTree(rootItems, 0)
                ) : (
                  <p className="file-tree-status status-text">{t("conversation.filePanelEmptyDirectory")}</p>
                )}
              </div>
              <WorkbenchModal
                open={deleteConfirmTargets !== null}
                title={t("conversation.filePanelDeleteConfirmTitle")}
                description={t("conversation.filePanelDeleteConfirmDescription")}
                onClose={() => {
                  if (mutating) {
                    return;
                  }

                  setDeleteConfirmTargets(null);
                }}
              >
                <p className="workbench-section-empty">
                  {deleteConfirmTargets?.length
                    ? deleteConfirmTargets.length === 1
                      ? deleteConfirmTargets[0]?.kind === "directory"
                        ? t("conversation.filePanelDeleteDirectoryConfirm", {
                            path: deleteConfirmTargets[0].path
                          })
                        : t("conversation.filePanelDeleteFileConfirm", {
                            path: deleteConfirmTargets[0].path
                          })
                      : t("conversation.filePanelDeleteSelectionConfirm", {
                          count: deleteConfirmTargets.length
                        })
                    : ""}
                </p>
                <div className="workbench-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={mutating}
                    onClick={() => setDeleteConfirmTargets(null)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="secondary-button workbench-danger-button"
                    disabled={mutating}
                    onClick={() => {
                      void handleDeleteConfirm();
                    }}
                  >
                    {mutating
                      ? t("conversation.filePanelDeleting")
                      : t("conversation.filePanelDelete")}
                  </button>
                </div>
              </WorkbenchModal>
            </>
          ) : hasSessionContext && sessionId ? (
            <SessionChangedFilesPanel
              sessionId={sessionId}
              workspaceId={workspaceId}
              showSystemFiles={showSystemFiles}
              selectedPath={primarySelectedFilePath}
              refreshVersion={sessionRefreshVersion}
              onCountChange={setSessionChangeCount}
              onSelectFile={selectFile}
              onOpenFile={openFileViewer}
            />
          ) : (
            <section className="file-panel-section">
              <p className="status-text">{t("conversation.filePanelSessionNoSession")}</p>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function getParentDirectory(filePath: string): string {
  if (!filePath.includes("/")) {
    return ROOT_DIRECTORY;
  }

  return filePath.split("/").slice(0, -1).join("/");
}

function getDirectoryChain(targetPath: string, includeLeafDirectory = false): string[] {
  const parts = targetPath.split("/").filter(Boolean);
  const lastIndex = includeLeafDirectory ? parts.length : parts.length - 1;
  const directories: string[] = [];

  for (let index = 0; index < lastIndex; index += 1) {
    directories.push(parts.slice(0, index + 1).join("/"));
  }

  return directories;
}

function getCreateBaseDirectory(
  activeDirectoryPath: string,
  primarySelectedTarget: FileSelectionTarget | null
): string {
  if (activeDirectoryPath) {
    return activeDirectoryPath;
  }

  if (primarySelectedTarget?.kind === "directory") {
    return primarySelectedTarget.path;
  }

  if (primarySelectedTarget?.path) {
    return getParentDirectory(primarySelectedTarget.path);
  }

  return ROOT_DIRECTORY;
}

function joinRelativePath(baseDirectory: string, fileName: string): string {
  return baseDirectory ? `${baseDirectory}/${fileName}` : fileName;
}

function normalizeUploadFileName(fileName: string): string {
  return fileName.split(/[/\\]/).pop()?.trim() ?? "";
}

function createSelectionTarget(
  path: string,
  kind: "file" | "directory"
): FileSelectionTarget {
  return { path, kind };
}

function getPrimarySelectedTarget(
  targets: FileSelectionTarget[]
): FileSelectionTarget | null {
  return targets[targets.length - 1] ?? null;
}

function toggleSelectionTarget(
  targets: FileSelectionTarget[],
  nextTarget: FileSelectionTarget
): FileSelectionTarget[] {
  const existingIndex = targets.findIndex((item) => item.path === nextTarget.path);

  if (existingIndex >= 0) {
    return targets.filter((item) => item.path !== nextTarget.path);
  }

  return [...targets, nextTarget];
}

function selectRangeTargets(
  orderedTargets: FileSelectionTarget[],
  anchorPath: string | null,
  nextTarget: FileSelectionTarget
): FileSelectionTarget[] {
  const targetIndex = orderedTargets.findIndex((item) => item.path === nextTarget.path);

  if (targetIndex < 0) {
    return [nextTarget];
  }

  const anchorIndex = anchorPath
    ? orderedTargets.findIndex((item) => item.path === anchorPath)
    : targetIndex;

  if (anchorIndex < 0) {
    return [nextTarget];
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedTargets.slice(start, end + 1);
}

function isToggleSelectionEvent(
  event?: Pick<React.MouseEvent<HTMLElement>, "ctrlKey" | "metaKey">
): boolean {
  return Boolean(event?.ctrlKey || event?.metaKey);
}

function hasModifierKey(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function collapseNestedSelectionTargets(targets: FileSelectionTarget[]): FileSelectionTarget[] {
  const uniqueTargets = [...new Map(targets.map((item) => [item.path, item])).values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const collapsed: FileSelectionTarget[] = [];

  for (const target of uniqueTargets) {
    if (
      collapsed.some(
        (item) => item.kind === "directory" && isSameOrDescendantPath(item.path, target.path)
      )
    ) {
      continue;
    }

    collapsed.push(target);
  }

  return collapsed;
}

function resolvePasteBaseDirectory(
  primarySelectedTarget: FileSelectionTarget | null,
  activeDirectoryPath: string
): string {
  if (primarySelectedTarget?.kind === "directory") {
    return primarySelectedTarget.path;
  }

  if (primarySelectedTarget?.path) {
    return getParentDirectory(primarySelectedTarget.path);
  }

  return activeDirectoryPath;
}

function resolveSafeActiveDirectoryAfterDelete(
  activeDirectoryPath: string,
  deletedTargets: FileSelectionTarget[]
): string {
  let nextDirectory = activeDirectoryPath;

  while (
    nextDirectory &&
    deletedTargets.some(
      (target) => target.kind === "directory" && isSameOrDescendantPath(target.path, nextDirectory)
    )
  ) {
    nextDirectory = getParentDirectory(nextDirectory);
  }

  return nextDirectory;
}

function flattenVisibleSelectionTargets(
  items: FileNodeDto[],
  treeCache: FileTreeCache,
  expandedDirectories: string[],
  showChangesOnly: boolean,
  statusByPath: Map<string, string>,
  changedDirs: Set<string>
): FileSelectionTarget[] {
  const flattened: FileSelectionTarget[] = [];

  for (const item of items) {
    flattened.push(createSelectionTarget(item.path, item.kind));

    if (item.kind !== "directory" || !expandedDirectories.includes(item.path)) {
      continue;
    }

    const rawChildItems = treeCache[item.path] ?? [];
    const childItems = showChangesOnly
      ? filterTreeByChanges(rawChildItems, treeCache, statusByPath, changedDirs)
      : rawChildItems;

    flattened.push(
      ...flattenVisibleSelectionTargets(
        childItems,
        treeCache,
        expandedDirectories,
        showChangesOnly,
        statusByPath,
        changedDirs
      )
    );
  }

  return flattened;
}

function resolveWebContextMenuLayout(
  anchorPoint: { x: number; y: number },
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number }
): WebContextMenuLayout {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const viewportMaxHeight = Math.max(
    0,
    viewportHeight - WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX * 2
  );
  const maxMenuWidth = Math.max(
    0,
    viewportWidth - WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX * 2
  );
  const safeMenuWidth = Math.min(
    Math.max(menuSize.width || WEB_CONTEXT_MENU_DEFAULT_WIDTH_PX, 0),
    maxMenuWidth
  );
  const spaceBelow = Math.max(
    0,
    viewportHeight - anchorPoint.y - WEB_CONTEXT_MENU_GAP_PX - WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX
  );
  const spaceAbove = Math.max(
    0,
    anchorPoint.y - WEB_CONTEXT_MENU_GAP_PX - WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX
  );
  const shouldOpenUpward = spaceBelow < menuSize.height && spaceAbove > spaceBelow;
  const availableHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
  const safeMaxHeight = clampNumber(
    Math.max(availableHeight, WEB_CONTEXT_MENU_MIN_HEIGHT_PX),
    0,
    viewportMaxHeight
  );
  const visibleMenuHeight = Math.min(
    Math.max(menuSize.height, 0),
    safeMaxHeight
  );
  const unclampedTop = shouldOpenUpward
    ? anchorPoint.y - WEB_CONTEXT_MENU_GAP_PX - visibleMenuHeight
    : anchorPoint.y + WEB_CONTEXT_MENU_GAP_PX;
  const maxTop = Math.max(
    WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
    viewportHeight - WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX - visibleMenuHeight
  );
  const maxLeft = Math.max(
    WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
    viewportWidth - WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX - safeMenuWidth
  );

  return {
    top: clampNumber(
      unclampedTop,
      WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
      maxTop
    ),
    left: clampNumber(
      anchorPoint.x,
      WEB_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
      maxLeft
    ),
    maxHeight: Math.max(0, safeMaxHeight)
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function normalizeRelativeClipboardPath(
  targetPath: string,
  pathStyle: BackendPathStyle = "posix"
): string {
  if (!targetPath) {
    return ".";
  }

  return normalizePathSeparators(targetPath, pathStyle);
}

function buildAbsoluteWorkspacePath(
  workspacePath: string,
  targetPath: string,
  pathStyle: BackendPathStyle
): string {
  // 路径格式必须服从后端 Host，而后端工作区路径本身就是最可靠的事实来源。
  const normalizedWorkspacePath = normalizePathSeparators(workspacePath, pathStyle);
  const normalizedTargetPath = normalizeRelativeClipboardPath(targetPath, pathStyle).replace(
    /^\.[/\\]?/,
    ""
  );

  if (!normalizedTargetPath) {
    return normalizedWorkspacePath;
  }

  const separator = resolvePathSeparator(pathStyle);
  const safeTargetPath = normalizedTargetPath.replace(/^[/\\]+/, "");

  if (!safeTargetPath) {
    return normalizedWorkspacePath;
  }

  if (normalizedWorkspacePath.endsWith("/") || normalizedWorkspacePath.endsWith("\\")) {
    return `${normalizedWorkspacePath}${safeTargetPath}`;
  }

  return `${normalizedWorkspacePath}${separator}${safeTargetPath}`;
}

type BackendPathStyle = "windows" | "posix";

function resolveBackendPathStyle(workspacePath: string): BackendPathStyle {
  if (/^[a-zA-Z]:[\\/]/.test(workspacePath) || workspacePath.includes("\\")) {
    return "windows";
  }

  return "posix";
}

function normalizePathSeparators(path: string, pathStyle: BackendPathStyle): string {
  if (!path) {
    return path;
  }

  const separator = resolvePathSeparator(pathStyle);
  return separator === "\\" ? path.replace(/\//g, "\\") : path.replace(/\\/g, "/");
}

function resolvePathSeparator(pathStyle: BackendPathStyle): "/" | "\\" {
  return pathStyle === "windows" ? "\\" : "/";
}

function isSameOrDescendantPath(targetPath: string, candidatePath: string): boolean {
  return candidatePath === targetPath || candidatePath.startsWith(`${targetPath}/`);
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
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
    throw new Error(t("conversation.filePanelDownloadFailed"));
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
      // 浏览器剪贴板在部分 WebView/权限场景下会失败，继续走兼容回退。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("conversation.filePanelCopyPathFailed"));
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

function resolveRestoredActiveDirectoryPath(activeDirectoryPath: string, treeCache: FileTreeCache): string {
  if (!activeDirectoryPath) {
    return ROOT_DIRECTORY;
  }

  const directoryChain = getDirectoryChain(activeDirectoryPath, true);
  const hasCachedChain = directoryChain.every((directoryPath) => directoryPath in treeCache);

  return hasCachedChain ? activeDirectoryPath : ROOT_DIRECTORY;
}

function sanitizeExpandedDirectories(expandedDirectories: string[], activeDirectoryPath: string): string[] {
  if (!activeDirectoryPath) {
    return [];
  }

  const activeDirectoryChain = getDirectoryChain(activeDirectoryPath, true);
  return expandedDirectories.filter((directoryPath) => activeDirectoryChain.includes(directoryPath));
}

function pruneTreeCache(
  treeCache: FileTreeCache,
  activeDirectoryPath: string,
  expandedDirectories: string[]
): FileTreeCache {
  const retainedDirectoryPaths = resolveRetainedDirectoryPaths(
    activeDirectoryPath,
    expandedDirectories
  );

  return Object.entries(treeCache).reduce<FileTreeCache>((nextCache, [directoryPath, items]) => {
    if (retainedDirectoryPaths.has(directoryPath)) {
      nextCache[directoryPath] = items;
    }

    return nextCache;
  }, {});
}

function resolveRefreshTargetDirectories(
  treeCache: FileTreeCache,
  activeDirectoryPath: string,
  expandedDirectories: string[]
): string[] {
  const retainedDirectoryPaths = resolveRetainedDirectoryPaths(
    activeDirectoryPath,
    expandedDirectories
  );
  const targetDirectories = [...retainedDirectoryPaths].filter(
    (directoryPath) => directoryPath === ROOT_DIRECTORY || directoryPath in treeCache
  );

  return targetDirectories.length ? targetDirectories : [ROOT_DIRECTORY];
}

function resolveRetainedDirectoryPaths(activeDirectoryPath: string, expandedDirectories: string[]) {
  const retainedDirectoryPaths = new Set<string>([ROOT_DIRECTORY]);
  const scopedDirectories = mergeUnique(expandedDirectories, getDirectoryChain(activeDirectoryPath, true));

  for (const directoryPath of scopedDirectories) {
    retainedDirectoryPaths.add(directoryPath);

    for (const ancestorPath of getDirectoryChain(directoryPath, true)) {
      retainedDirectoryPaths.add(ancestorPath);
    }
  }

  return retainedDirectoryPaths;
}

function isSameTreeCache(currentCache: FileTreeCache, nextCache: FileTreeCache) {
  const currentKeys = Object.keys(currentCache);
  const nextKeys = Object.keys(nextCache);

  if (currentKeys.length !== nextKeys.length) {
    return false;
  }

  return currentKeys.every((cacheKey) => currentCache[cacheKey] === nextCache[cacheKey]);
}

function appendUnique(items: string[], nextItem: string): string[] {
  return items.includes(nextItem) ? items : [...items, nextItem];
}

function mergeUnique(items: string[], nextItems: string[]): string[] {
  return nextItems.reduce((merged, nextItem) => appendUnique(merged, nextItem), items);
}

function buildWorkspaceTreeSnapshotKey(workspaceId: string) {
  return `file-panel.workspace-tree.${workspaceId}`;
}

function buildSessionChangeCountSnapshotKey(workspaceId: string, sessionId: string) {
  return `file-panel.session-change-count.${workspaceId}.${sessionId}`;
}

function collectSubscribedDirectories(
  expandedDirectories: string[],
  activeDirectoryPath: string
): string[] {
  return [...resolveRetainedDirectoryPaths(activeDirectoryPath, expandedDirectories)];
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return fallback;
}

function isSnapshotTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith("FILE_TREE_SNAPSHOT_TIMEOUT:") ||
      error.message.startsWith("FILE_TREE_ABORTED:"))
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11v2h-11zM2.5 7.5h7v2h-7zM2.5 10.5h4v2h-4z" fill="currentColor" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M12.8 5.2A5.5 5.5 0 1 0 13.5 8h-1.8A3.7 3.7 0 1 1 10.6 5l-1.4 1.4h4V2l-1.4 1.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M11.2 10.1l3 3-1.1 1.1-3-3a5 5 0 1 1 1.1-1.1zM6.8 10.3a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
        fill="currentColor"
      />
    </svg>
  );
}

function PathCopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 4.3h5.2v1.4H4.9v5.4H3.5zm3.8-2.1h5.2v9.5H7.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5.7 10.8h4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 2.5h7.5v9H5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 5H2.4V13.5H10V12.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CutIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.2 4.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm0 5.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm1-3.2 6.6 5.6M5.2 9.6l6.6-5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 3.5h8v10H4zM6 2.2h4v2H6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M6 7.2h4M6 9.6h4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FilePlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 6.5v5M5.5 9h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 11.5v2h10v-2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m5.5 5 2.5-2.5L10.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 11.5v2h10v-2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m5.5 8.5 2.5 2.5 2.5-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 4.5h9M6.2 2.5h3.6l.6 1.4H13v1.2H3V3.9h2.6zM5.2 5.7v6.1m2.8-6.1v6.1m2.8-6.1v6.1M4.4 13.5h7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.8 4.5h4l1.2 1.3h7.2v6.7H1.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M8.5 7.2v4M6.5 9.2h4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function MenuChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 2h13l-5 6v5l-3 1.5V8z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// 筛选文件树：仅保留有变更的文件及其父目录
function filterTreeByChanges(
  items: FileNodeDto[],
  treeCache: FileTreeCache,
  statusByPath: Map<string, string>,
  changedDirs: Set<string>
): FileNodeDto[] {
  const result: FileNodeDto[] = [];

  for (const item of items) {
    const normalPath = item.path.replace(/\\/g, "/");

    if (item.kind === "file") {
      if (statusByPath.has(normalPath)) {
        result.push(item);
      }
    } else {
      if (hasDescendantChanges(normalPath, treeCache, statusByPath, changedDirs)) {
        result.push(item);
      }
    }
  }

  return result;
}

// 递归检查目录子树中是否有 git 变更文件
// 已加载到 treeCache 的目录走递归检查，未加载的回退 changedDirs
function hasDescendantChanges(
  dirPath: string,
  treeCache: FileTreeCache,
  statusByPath: Map<string, string>,
  changedDirs: Set<string>,
  visited?: Set<string>
): boolean {
  const safeVisited = visited ?? new Set<string>();
  if (safeVisited.has(dirPath)) return false;
  safeVisited.add(dirPath);

  const children = treeCache[dirPath];
  if (!children) return changedDirs.has(dirPath);

  for (const child of children) {
    const normalPath = child.path.replace(/\\/g, "/");

    if (child.kind === "file") {
      if (statusByPath.has(normalPath)) return true;
    } else {
      if (hasDescendantChanges(normalPath, treeCache, statusByPath, changedDirs, safeVisited)) return true;
    }
  }

  return false;
}
