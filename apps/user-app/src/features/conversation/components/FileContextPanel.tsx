import { useEffect, useState } from "react";

import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import {
  attachFileContext,
  detachFileContext,
  getFilePreview,
  getFileTree,
  getRecentFiles,
  listFileContextBindings,
  operateFile,
  saveFileContent,
  searchFiles,
  type FileContextBindingDto,
  type FileNodeDto,
  type FilePreviewDto,
  type FileSearchResultDto,
  type FileOperationType,
  type RecentFileRecordDto
} from "../api/file-context-api";

interface FileContextPanelProps {
  sessionId: string;
  workspaceId: string | null | undefined;
}

export function FileContextPanel({ sessionId, workspaceId }: FileContextPanelProps) {
  const [currentDirectory, setCurrentDirectory] = useState("");
  const [treeItems, setTreeItems] = useState<FileNodeDto[]>([]);
  const [recentItems, setRecentItems] = useState<RecentFileRecordDto[]>([]);
  const [bindings, setBindings] = useState<FileContextBindingDto[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResult, setSearchResult] = useState<FileSearchResultDto | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewDto | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    setCurrentDirectory("");
    setTreeItems([]);
    setRecentItems([]);
    setBindings([]);
    setSearchKeyword("");
    setSearchResult(null);
    setSelectedPath(null);
    setPreview(null);
    setEditorContent("");
    setPanelError(null);
    setPanelMessage(null);
  }, [sessionId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadTree() {
      if (!workspaceId) {
        return;
      }

      setLoadingTree(true);

      try {
        const response = await getFileTree(workspaceId, currentDirectory || undefined);

        if (!cancelled) {
          setTreeItems(response.items);
          setPanelError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setPanelError(readError(error, t("conversation.filePanelLoadFailed")));
        }
      } finally {
        if (!cancelled) {
          setLoadingTree(false);
        }
      }
    }

    void loadTree();

    return () => {
      cancelled = true;
    };
  }, [currentDirectory, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      if (!workspaceId) {
        return;
      }

      setSyncingMeta(true);

      try {
        const [recentResponse, bindingResponse] = await Promise.all([
          getRecentFiles(workspaceId),
          listFileContextBindings(sessionId)
        ]);

        if (!cancelled) {
          setRecentItems(recentResponse.items);
          setBindings(bindingResponse.items);
        }
      } catch (error) {
        if (!cancelled) {
          setPanelError(readError(error, t("conversation.filePanelLoadFailed")));
        }
      } finally {
        if (!cancelled) {
          setSyncingMeta(false);
        }
      }
    }

    void loadMeta();

    return () => {
      cancelled = true;
    };
  }, [sessionId, workspaceId]);

  const activeBinding = bindings.find((item) => item.path === selectedPath);
  const canEdit = Boolean(preview?.supported && preview.kind === "text" && selectedPath);

  async function refreshMeta() {
    if (!workspaceId) {
      return;
    }

    const [recentResponse, bindingResponse] = await Promise.all([
      getRecentFiles(workspaceId),
      listFileContextBindings(sessionId)
    ]);

    setRecentItems(recentResponse.items);
    setBindings(bindingResponse.items);
  }

  async function refreshCurrentTree() {
    if (!workspaceId) {
      return;
    }

    const response = await getFileTree(workspaceId, currentDirectory || undefined);
    setTreeItems(response.items);
  }

  // 文件内容只在面板本地状态里短暂存在，真正的会话真相仍然是消息流。
  async function openFile(filePath: string) {
    if (!workspaceId) {
      return;
    }

    setLoadingPreview(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      const nextPreview = await getFilePreview(workspaceId, filePath);

      setSelectedPath(filePath);
      setPreview(nextPreview);
      setEditorContent(nextPreview.content ?? "");
      setCurrentDirectory(getParentDirectory(filePath));
      await refreshMeta();
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelOpenFailed")));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleRefresh() {
    if (!workspaceId) {
      return;
    }

    setPanelError(null);
    setPanelMessage(null);

    try {
      await Promise.all([refreshCurrentTree(), refreshMeta()]);

      if (selectedPath) {
        const nextPreview = await getFilePreview(workspaceId, selectedPath);
        setPreview(nextPreview);
        setEditorContent(nextPreview.content ?? "");
      }
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelLoadFailed")));
    }
  }

  async function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspaceId || !searchKeyword.trim()) {
      setSearchResult(null);
      return;
    }

    setSearching(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      const response = await searchFiles(workspaceId, searchKeyword.trim());
      setSearchResult(response);
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelSearchFailed")));
    } finally {
      setSearching(false);
    }
  }

  async function handleSave() {
    if (!workspaceId || !selectedPath || !preview?.supported || !preview.version) {
      return;
    }

    setSaving(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await saveFileContent(workspaceId, selectedPath, editorContent, preview.version);
      const nextPreview = await getFilePreview(workspaceId, selectedPath);
      setPreview(nextPreview);
      setEditorContent(nextPreview.content ?? "");
      await refreshMeta();
      await refreshCurrentTree();
      setPanelMessage(t("conversation.filePanelSaveSuccess"));
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleAttach() {
    if (!workspaceId || !selectedPath || !preview?.supported) {
      return;
    }

    setMutating(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await attachFileContext(sessionId, {
        workspaceId,
        path: selectedPath
      });
      await refreshMeta();
      setPanelMessage(t("conversation.filePanelAttachSuccess"));
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelAttachFailed")));
    } finally {
      setMutating(false);
    }
  }

  async function handleDetach(bindingId: string) {
    setMutating(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await detachFileContext(sessionId, bindingId);
      await refreshMeta();
      setPanelMessage(t("conversation.filePanelDetachSuccess"));
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelDetachFailed")));
    } finally {
      setMutating(false);
    }
  }

  async function handleCreate(opType: "create_file" | "create_directory") {
    if (!workspaceId) {
      return;
    }

    const defaultPath = currentDirectory ? `${currentDirectory}/` : "";
    const nextPath = window.prompt(
      opType === "create_file"
        ? t("conversation.filePanelCreateFilePrompt")
        : t("conversation.filePanelCreateDirectoryPrompt"),
      defaultPath
    );

    if (!nextPath?.trim()) {
      return;
    }

    setMutating(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await operateFile({
        workspaceId,
        opType,
        dstPath: nextPath.trim(),
        content: opType === "create_file" ? "" : undefined
      });
      setCurrentDirectory(getParentDirectory(nextPath.trim()));
      await Promise.all([refreshCurrentTree(), refreshMeta()]);

      if (opType === "create_file") {
        await openFile(nextPath.trim());
      }
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelMutateFailed")));
    } finally {
      setMutating(false);
    }
  }

  async function handleDelete() {
    if (!workspaceId || !selectedPath) {
      return;
    }

    const confirmed = window.confirm(
      t("conversation.filePanelDeleteConfirm").replace("{path}", selectedPath)
    );

    if (!confirmed) {
      return;
    }

    setMutating(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await operateFile({
        workspaceId,
        opType: "delete",
        srcPath: selectedPath
      });
      setSelectedPath(null);
      setPreview(null);
      setEditorContent("");
      await Promise.all([refreshCurrentTree(), refreshMeta()]);
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelMutateFailed")));
    } finally {
      setMutating(false);
    }
  }

  async function handleMove() {
    if (!workspaceId || !selectedPath) {
      return;
    }

    const targetPath = window.prompt(
      t("conversation.filePanelRenameMovePrompt"),
      selectedPath
    );

    if (!targetPath?.trim() || targetPath.trim() === selectedPath) {
      return;
    }

    const nextPath = targetPath.trim();
    const opType: FileOperationType =
      getParentDirectory(nextPath) === getParentDirectory(selectedPath) ? "rename" : "move";

    setMutating(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await operateFile({
        workspaceId,
        opType,
        srcPath: selectedPath,
        dstPath: nextPath
      });
      setSelectedPath(nextPath);
      setCurrentDirectory(getParentDirectory(nextPath));
      await Promise.all([refreshCurrentTree(), refreshMeta()]);
      await openFile(nextPath);
    } catch (error) {
      setPanelError(readError(error, t("conversation.filePanelMutateFailed")));
    } finally {
      setMutating(false);
    }
  }

  return (
    <section className="conversation-panel surface-card file-panel" data-testid="file-context-panel">
      <div className="file-panel-header">
        <div>
          <h2>{t("conversation.filePanelTitle")}</h2>
          <p className="status-text">
            {workspaceId ? t("conversation.filePanelSubtitle") : t("conversation.filePanelNoWorkspace")}
          </p>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={() => void handleRefresh()}
          disabled={!workspaceId || loadingTree || syncingMeta || loadingPreview}
        >
          {t("conversation.filePanelRefresh")}
        </button>
      </div>

      {panelError ? (
        <p className="status-text" data-tone="error">
          {panelError}
        </p>
      ) : null}

      {panelMessage ? (
        <p className="status-text" data-tone="success">
          {panelMessage}
        </p>
      ) : null}

      {!workspaceId ? (
        <section className="file-panel-section">
          <p className="status-text">{t("conversation.filePanelNoWorkspace")}</p>
        </section>
      ) : (
        <>
          <section className="file-panel-section">
            <div className="file-section-header">
              <div>
                <h3>{t("conversation.filePanelBrowse")}</h3>
                <p className="status-text">{currentDirectory || "/"}</p>
              </div>
              <div className="badge-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCurrentDirectory(getParentDirectory(currentDirectory))}
                  disabled={!currentDirectory}
                >
                  {t("conversation.filePanelBackDirectory")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void handleCreate("create_file")}
                  disabled={mutating}
                >
                  {t("conversation.filePanelNewFile")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void handleCreate("create_directory")}
                  disabled={mutating}
                >
                  {t("conversation.filePanelNewDirectory")}
                </button>
              </div>
            </div>
            <div className="file-list">
              {loadingTree ? (
                <p className="status-text">{t("common.loading")}</p>
              ) : treeItems.length ? (
                treeItems.map((item) => (
                  <button
                    key={`${item.kind}-${item.path}`}
                    className="file-list-item"
                    type="button"
                    data-active={selectedPath === item.path}
                    onClick={() => {
                      if (item.kind === "directory") {
                        setCurrentDirectory(item.path);
                        return;
                      }

                      void openFile(item.path);
                    }}
                  >
                    <span className="badge">{item.kind === "directory" ? "DIR" : "FILE"}</span>
                    <span>{item.path}</span>
                  </button>
                ))
              ) : (
                <p className="status-text">{t("conversation.filePanelEmptyDirectory")}</p>
              )}
            </div>
          </section>

          <section className="file-panel-section">
            <div className="file-section-header">
              <h3>{t("conversation.filePanelSearchResults")}</h3>
            </div>
            <form className="file-search-form" onSubmit={(event) => void handleSearchSubmit(event)}>
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder={t("conversation.filePanelSearchPlaceholder")}
              />
              <button className="secondary-button" type="submit" disabled={searching}>
                {t("conversation.filePanelSearchButton")}
              </button>
            </form>
            {searchResult ? (
              <div className="file-list compact">
                {searchResult.items.length ? (
                  searchResult.items.map((item) => (
                    <button
                      key={`search-${item.kind}-${item.path}`}
                      className="file-list-item"
                      type="button"
                      onClick={() => {
                        if (item.kind === "directory") {
                          setCurrentDirectory(item.path);
                          return;
                        }

                        void openFile(item.path);
                      }}
                    >
                      <span className="badge">{item.kind === "directory" ? "DIR" : "FILE"}</span>
                      <span>{item.path}</span>
                    </button>
                  ))
                ) : (
                  <p className="status-text">{t("conversation.filePanelEmptyDirectory")}</p>
                )}
              </div>
            ) : null}
          </section>

          <section className="file-panel-section">
            <div className="file-section-header">
              <h3>{t("conversation.filePanelRecentTitle")}</h3>
              <span className="status-text">{syncingMeta ? t("common.loading") : null}</span>
            </div>
            <div className="file-list compact">
              {recentItems.length ? (
                recentItems.map((item) => (
                  <button
                    key={item.id}
                    className="file-list-item"
                    type="button"
                    data-active={selectedPath === item.path}
                    onClick={() => void openFile(item.path)}
                  >
                    <span>{item.path}</span>
                  </button>
                ))
              ) : (
                <p className="status-text">{t("conversation.filePanelEmptyRecent")}</p>
              )}
            </div>
          </section>

          <section className="file-panel-section">
            <div className="file-section-header">
              <h3>{t("conversation.filePanelContextTitle")}</h3>
            </div>
            <div className="file-list compact">
              {bindings.length ? (
                bindings.map((item) => (
                  <article key={item.id} className="file-context-item">
                    <button
                      className="file-list-item"
                      type="button"
                      data-active={selectedPath === item.path}
                      onClick={() => void openFile(item.path)}
                    >
                      <span>{item.displayName}</span>
                      <span className="status-text">{item.path}</span>
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void handleDetach(item.id)}
                      disabled={mutating}
                    >
                      {t("conversation.filePanelDetach")}
                    </button>
                  </article>
                ))
              ) : (
                <p className="status-text">{t("conversation.filePanelEmptyContexts")}</p>
              )}
            </div>
          </section>

          <section className="file-panel-section">
            <div className="file-section-header">
              <div>
                <h3>{t("conversation.filePanelEditorTitle")}</h3>
                <p className="status-text">{selectedPath ?? t("conversation.filePanelSelectHint")}</p>
              </div>
              {selectedPath ? (
                <div className="badge-row">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleMove()}
                    disabled={mutating}
                  >
                    {t("conversation.filePanelRenameMove")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={mutating}
                  >
                    {t("conversation.filePanelDelete")}
                  </button>
                </div>
              ) : null}
            </div>

            {loadingPreview ? (
              <p className="status-text">{t("common.loading")}</p>
            ) : preview ? (
              <>
                {preview.supported ? null : (
                  <p className="status-text">{preview.reason ?? t("conversation.filePanelUnsupported")}</p>
                )}
                <textarea
                  className="file-editor"
                  data-testid="file-editor-textarea"
                  value={editorContent}
                  onChange={(event) => setEditorContent(event.target.value)}
                  placeholder={t("conversation.filePanelEditorPlaceholder")}
                  disabled={!preview.supported}
                />
                <div className="badge-row">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!canEdit || saving}
                  >
                    {saving ? t("conversation.filePanelSaving") : t("conversation.filePanelSave")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleAttach()}
                    disabled={!preview.supported || Boolean(activeBinding) || mutating}
                  >
                    {activeBinding
                      ? t("conversation.filePanelAttached")
                      : t("conversation.filePanelAttach")}
                  </button>
                </div>
              </>
            ) : (
              <p className="status-text">{t("conversation.filePanelSelectHint")}</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function getParentDirectory(filePath: string): string {
  if (!filePath.includes("/")) {
    return "";
  }

  return filePath.split("/").slice(0, -1).join("/");
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return fallback;
}
