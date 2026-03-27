import { useEffect, useRef, useState } from "react";

import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  operateFile,
  searchFiles,
  type FileNodeDto
} from "../api/file-context-api";
import { usePlatform } from "../../../platform/platform-provider";
import { useWorkbenchShell } from "./WorkbenchLayout";
import { FileViewerModal } from "./FileViewerModal";
import {
  resolveFileTreeIconKind,
  resolveFileTreeIconLabel
} from "./file-tree-icon";
import { SessionChangedFilesPanel } from "./SessionChangedFilesPanel";

interface FileContextPanelProps {
  className?: string;
  sessionId: string | null | undefined;
  workspaceId: string | null | undefined;
  hideHeading?: boolean;
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

const ROOT_DIRECTORY = "";
const FILE_REPEAT_ACTIVATION_MS = 450;
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

export function FileContextPanel({ className, sessionId, workspaceId, hideHeading = false }: FileContextPanelProps) {
  const {
    navigationGroups,
    subscribeFileTree,
    requestFileTreeRefresh,
    addFileTreeSnapshotListener
  } = useWorkbenchShell();
  const [treeCache, setTreeCache] = useState<FileTreeCache>({});
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<string[]>([]);
  const [activeDirectoryPath, setActiveDirectoryPath] = useState(ROOT_DIRECTORY);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResult, setSearchResult] = useState<FileNodeDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [viewerFilePath, setViewerFilePath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilePanelTab>("workspace");
  const [sessionRefreshVersion, setSessionRefreshVersion] = useState(0);
  const [sessionChangeCount, setSessionChangeCount] = useState(0);
  const [copyPathMenuOpen, setCopyPathMenuOpen] = useState(false);
  const treeCacheRef = useRef<FileTreeCache>({});
  const expandedDirectoriesRef = useRef<string[]>([]);
  const activeDirectoryPathRef = useRef(ROOT_DIRECTORY);
  const restoringWorkspaceSnapshotRef = useRef(false);
  const recentFileActivationRef = useRef<RecentFileActivation | null>(null);
  const copyPathMenuRef = useRef<HTMLDivElement | null>(null);
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
  const hasSessionContext = Boolean(sessionId?.trim());

  useEffect(() => {
    logPerfDebug("file_panel.props", {
      sessionId,
      workspaceId
    });
  }, [sessionId, workspaceId]);

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
    setSelectedPath(null);
    setViewerFilePath(null);
    setSessionRefreshVersion(0);
    setCopyPathMenuOpen(false);
    recentFileActivationRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!hasSessionContext && activeTab === "session") {
      setActiveTab("workspace");
    }
  }, [activeTab, hasSessionContext]);

  useEffect(() => {
    if (!copyPathMenuOpen) {
      return;
    }

    function handleDocumentPointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!copyPathMenuRef.current?.contains(event.target)) {
        setCopyPathMenuOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCopyPathMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [copyPathMenuOpen]);

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

      const shouldShowLoading = options?.silent !== true && (treeCacheRef.current[ROOT_DIRECTORY]?.length ?? 0) === 0;

      if (shouldShowLoading) {
        setLoadingTree(true);
      }

      logPerfDebug("file_panel.load_root_tree.start", {
        sessionId,
        workspaceId: currentWorkspaceId,
        silent: options?.silent === true,
        cachedRootItems: treeCacheRef.current[ROOT_DIRECTORY]?.length ?? 0
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
        if (!cancelled) {
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

    const hasCachedRootItems = (treeCacheRef.current[ROOT_DIRECTORY]?.length ?? 0) > 0;

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
  }, [sessionId, showToast, workspaceId]);

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

  const rootItems = treeCache[ROOT_DIRECTORY] ?? [];
  const searchMode = searchVisible && searchResult !== null;
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace ?? null;
  // 文件和目录原本分散在两套选中状态里，这里收敛成一个“当前目标路径”，后续按钮逻辑就不用到处打补丁。
  const selectedTargetPath = resolveSelectedTargetPath(selectedPath, activeDirectoryPath);
  const canCopySelectedPath = Boolean(currentWorkspace?.path && selectedTargetPath !== null);

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
      showToast({
        title: readError(error, t("conversation.filePanelLoadFailed")),
        tone: "error"
      });
      throw error;
    } finally {
      if (directoryPath === ROOT_DIRECTORY) {
        setLoadingTree(false);
      } else {
        setLoadingDirectories((previous) => previous.filter((item) => item !== directoryPath));
      }
    }
  }

  async function refreshTreeCache() {
    if (!workspaceId) {
      return;
    }

    const targetDirectories = resolveRefreshTargetDirectories(
      treeCacheRef.current,
      activeDirectoryPath,
      expandedDirectoriesRef.current
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
    return waitForDirectorySnapshot(directoryPath);
  }

  function waitForDirectorySnapshot(
    directoryPath: string,
    timeoutMs = FILE_TREE_SNAPSHOT_TIMEOUT_MS
  ): Promise<FileNodeDto[]> {
    const cachedItems = treeCacheRef.current[directoryPath];

    if (cachedItems) {
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
    setSelectedPath(filePath);
    setActiveDirectoryPath(getParentDirectory(filePath));
    await revealPathInTree(filePath);
  }

  async function openFileViewer(filePath: string) {
    await selectFile(filePath);
    setViewerFilePath(filePath);
    recentFileActivationRef.current = null;
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

  async function handleWorkspaceFileClick(filePath: string) {
    if (shouldOpenViewerByRepeatClick(filePath)) {
      await openFileViewer(filePath);
      return;
    }

    await selectFile(filePath);
  }

  function closeSearchPanel() {
    setSearchVisible(false);
    setSearchKeyword("");
    setSearchResult(null);
    resetRecentFileActivation();
  }

  async function handleSearchResultClick(item: FileNodeDto) {
    if (item.kind === "directory") {
      closeSearchPanel();
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
    setSelectedPath(null);
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
    setSelectedPath(null);
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
    setSelectedPath(null);
  }

  async function handleRefresh() {
    if (!workspaceId) {
      return;
    }

    try {
      await refreshTreeCache();

      if (selectedPath) {
        await revealPathInTree(selectedPath);
      }

      if (searchMode && searchKeyword.trim()) {
        const response = await searchFiles(workspaceId, searchKeyword.trim());
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

  function handleCollapseCurrent() {
    const targetDirectory = selectedPath ? getParentDirectory(selectedPath) : activeDirectoryPath;

    if (!targetDirectory || !expandedDirectoriesRef.current.includes(targetDirectory)) {
      return;
    }

    collapseBranch(targetDirectory);
  }

  async function handleCreate(opType: "create_file" | "create_directory") {
    if (!workspaceId) {
      return;
    }

    const baseDirectory = getCreateBaseDirectory(activeDirectoryPath, selectedPath);
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
        setSelectedPath(null);
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

  async function handleCopyPath(mode: "absolute" | "relative") {
    const workspacePath = currentWorkspace?.path ?? "";

    if (selectedTargetPath === null || !workspacePath) {
      setCopyPathMenuOpen(false);
      return;
    }

    try {
      const backendPathStyle = resolveBackendPathStyle(workspacePath);
      const copiedPath =
        mode === "absolute"
          ? buildAbsoluteWorkspacePath(workspacePath, selectedTargetPath, backendPathStyle)
          : normalizeRelativeClipboardPath(selectedTargetPath, backendPathStyle);

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
    }
  }

  function renderTree(items: FileNodeDto[], depth: number) {
    return (
      <>
        {items.map((item) => {
          const isDirectory = item.kind === "directory";
          const isExpanded = isDirectory && expandedDirectories.includes(item.path);
          const isLoading = isDirectory && loadingDirectories.includes(item.path);
          const childItems = treeCache[item.path] ?? [];
          const isActive =
            selectedPath === item.path ||
            (selectedPath === null && isDirectory && activeDirectoryPath === item.path);

          return (
            <div key={`${item.kind}-${item.path}`} className="file-tree-node">
              <button
                className="file-tree-item"
                type="button"
                data-active={isActive}
                data-kind={item.kind}
                aria-expanded={isDirectory ? isExpanded : undefined}
                style={{
                  paddingInlineStart: `${SIDEBAR_TREE_ROOT_PADDING_PX + depth * SIDEBAR_TREE_DEPTH_STEP_PX}px`
                }}
                onClick={() => {
                  if (isDirectory) {
                    resetRecentFileActivation();
                    void toggleDirectory(item.path);
                    return;
                  }

                  void handleWorkspaceFileClick(item.path);
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
                <span className="file-tree-label">{item.name}</span>
                {isLoading ? <span className="file-tree-meta">{t("common.loading")}</span> : null}
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
    );
  }

  function renderSearchResults(items: FileNodeDto[]) {
    return (
      <>
        {items.map((item) => {
          const isDirectory = item.kind === "directory";
          const isActive = selectedPath === item.path;

          return (
            <div key={`search-${item.kind}-${item.path}`} className="file-tree-node">
              <button
                className="file-tree-item is-search-result"
                type="button"
                data-active={isActive}
                data-kind={item.kind}
                onClick={() => {
                  if (isDirectory) {
                    void handleSearchResultClick(item);
                  } else {
                    void handleSearchResultClick(item);
                  }
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
            onClose={() => setViewerFilePath(null)}
            onSaved={async (filePath) => {
              await refreshTreeCache();
              await selectFile(filePath);
              setSessionRefreshVersion((current) => current + 1);
            }}
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
              <div className="file-panel-toolbar" aria-label={t("conversation.filePanelTitle")}>
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
                  disabled={
                    !(selectedPath ? getParentDirectory(selectedPath) : activeDirectoryPath) ||
                    !expandedDirectories.length
                  }
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
                <button
                  className="file-toolbar-button"
                  type="button"
                  title={t("conversation.filePanelNewFile")}
                  aria-label={t("conversation.filePanelNewFile")}
                  onClick={() => void handleCreate("create_file")}
                  disabled={mutating}
                >
                  <FilePlusIcon />
                </button>
                <button
                  className="file-toolbar-button"
                  type="button"
                  title={t("conversation.filePanelNewDirectory")}
                  aria-label={t("conversation.filePanelNewDirectory")}
                  onClick={() => void handleCreate("create_directory")}
                  disabled={mutating}
                >
                  <FolderPlusIcon />
                </button>
              </div>

              {searchVisible ? (
                <form className="file-toolbar-search" onSubmit={(event) => void handleSearchSubmit(event)}>
                  <input
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    placeholder={t("conversation.filePanelSearchPlaceholder")}
                  />
                  <button
                    className="file-toolbar-button"
                    type="submit"
                    title={t("conversation.filePanelSearchButton")}
                    aria-label={t("conversation.filePanelSearchButton")}
                    disabled={searching}
                  >
                    <SearchIcon />
                  </button>
                </form>
              ) : null}

              <div className="file-tree" data-search-mode={searchMode}>
                {loadingTree && rootItems.length === 0 ? (
                  <p className="file-tree-status status-text">{t("common.loading")}</p>
                ) : searchMode ? (
                  searchResult?.length ? (
                    renderSearchResults(searchResult)
                  ) : (
                    <p className="file-tree-status status-text">{t("conversation.filePanelSearchEmpty")}</p>
                  )
                ) : rootItems.length ? (
                  renderTree(rootItems, 0)
                ) : (
                  <p className="file-tree-status status-text">{t("conversation.filePanelEmptyDirectory")}</p>
                )}
              </div>
            </>
          ) : hasSessionContext && sessionId ? (
            <SessionChangedFilesPanel
              sessionId={sessionId}
              workspaceId={workspaceId}
              selectedPath={selectedPath}
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

function getCreateBaseDirectory(activeDirectoryPath: string, selectedPath: string | null): string {
  if (activeDirectoryPath) {
    return activeDirectoryPath;
  }

  if (selectedPath) {
    return getParentDirectory(selectedPath);
  }

  return ROOT_DIRECTORY;
}

function resolveSelectedTargetPath(selectedPath: string | null, activeDirectoryPath: string): string | null {
  if (selectedPath) {
    return selectedPath;
  }

  return activeDirectoryPath || null;
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

function FilePlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 6.5v5M5.5 9h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
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
