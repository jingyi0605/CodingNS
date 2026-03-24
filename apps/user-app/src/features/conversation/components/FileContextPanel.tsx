import { useEffect, useRef, useState } from "react";

import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  getFileTree,
  operateFile,
  searchFiles,
  type FileNodeDto
} from "../api/file-context-api";
import { FileViewerModal } from "./FileViewerModal";

interface FileContextPanelProps {
  sessionId: string;
  workspaceId: string | null | undefined;
}

type FileTreeCache = Record<string, FileNodeDto[]>;
type FileTreeCacheUpdater =
  | FileTreeCache
  | ((previous: FileTreeCache) => FileTreeCache);
type ExpandedDirectoriesUpdater =
  | string[]
  | ((previous: string[]) => string[]);

const ROOT_DIRECTORY = "";

export function FileContextPanel({ sessionId, workspaceId }: FileContextPanelProps) {
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
  const treeCacheRef = useRef<FileTreeCache>({});
  const expandedDirectoriesRef = useRef<string[]>([]);
  const { showToast } = useToast();

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
    treeCacheRef.current = {};
    expandedDirectoriesRef.current = [];
    updateTreeCache({});
    updateExpandedDirectories([]);
    setLoadingDirectories([]);
    setActiveDirectoryPath(ROOT_DIRECTORY);
    setSelectedPath(null);
    setLoadingTree(false);
    setMutating(false);
    setSearchVisible(false);
    setSearchKeyword("");
    setSearchResult(null);
    setSearching(false);
    setViewerFilePath(null);
  }, [sessionId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadRootTree() {
      if (!workspaceId) {
        return;
      }

      setLoadingTree(true);

      try {
        const response = await getFileTree(workspaceId);

        if (!cancelled) {
          updateTreeCache({
            [ROOT_DIRECTORY]: response.items
          });
        }
      } catch (error) {
        if (!cancelled) {
          showToast({
            title: readError(error, t("conversation.filePanelLoadFailed")),
            tone: "error"
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingTree(false);
        }
      }
    }

    void loadRootTree();

    return () => {
      cancelled = true;
    };
  }, [sessionId, showToast, workspaceId]);

  const rootItems = treeCache[ROOT_DIRECTORY] ?? [];
  const searchMode = searchVisible && searchResult !== null;

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
      const response = await getFileTree(workspaceId, directoryPath || undefined);

      updateTreeCache((previous) => ({
        ...previous,
        [directoryPath]: response.items
      }));

      return response.items;
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

    const loadedDirectories = Object.keys(treeCacheRef.current);
    const targetDirectories = loadedDirectories.length ? loadedDirectories : [ROOT_DIRECTORY];
    const entries = await Promise.all(
      targetDirectories.map(async (directoryPath) => {
        const response = await getFileTree(workspaceId, directoryPath || undefined);
        return [directoryPath, response.items] as const;
      })
    );

    updateTreeCache(
      entries.reduce<FileTreeCache>((nextCache, [directoryPath, items]) => {
        nextCache[directoryPath] = items;
        return nextCache;
      }, {})
    );
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
                style={{ paddingInlineStart: `${12 + depth * 16}px` }}
                onClick={() => {
                  if (isDirectory) {
                    void toggleDirectory(item.path);
                    return;
                  }

                  void selectFile(item.path);
                }}
                onDoubleClick={() => {
                  if (isDirectory) {
                    return;
                  }

                  void openFileViewer(item.path);
                }}
              >
                <span className={`file-tree-chevron${isDirectory ? "" : " is-hidden"}`} aria-hidden="true">
                  {isExpanded ? "v" : ">"}
                </span>
                <span
                  className={`file-tree-icon ${isDirectory ? "is-directory" : "is-file"}`}
                  data-expanded={isExpanded}
                  aria-hidden="true"
                />
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
                    setSearchVisible(false);
                    setSearchKeyword("");
                    setSearchResult(null);
                    void expandDirectory(item.path);
                    return;
                  }

                  setSearchVisible(false);
                  setSearchKeyword("");
                  setSearchResult(null);
                  void selectFile(item.path);
                }}
                onDoubleClick={() => {
                  if (isDirectory) {
                    return;
                  }

                  setSearchVisible(false);
                  setSearchKeyword("");
                  setSearchResult(null);
                  void openFileViewer(item.path);
                }}
              >
                <span className="file-tree-chevron is-hidden" aria-hidden="true">&gt;</span>
                <span className={`file-tree-icon ${isDirectory ? "is-directory" : "is-file"}`} aria-hidden="true" />
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
    <section className="conversation-panel surface-card file-panel" data-testid="file-context-panel">
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
            }}
          />
          <div className="file-panel-header">
            <h2>{t("conversation.filePanelTitle")}</h2>
            <div className="file-panel-toolbar" aria-label={t("conversation.filePanelTitle")}>
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
            {loadingTree ? (
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

function appendUnique(items: string[], nextItem: string): string[] {
  return items.includes(nextItem) ? items : [...items, nextItem];
}

function mergeUnique(items: string[], nextItems: string[]): string[] {
  return nextItems.reduce((merged, nextItem) => appendUnique(merged, nextItem), items);
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
