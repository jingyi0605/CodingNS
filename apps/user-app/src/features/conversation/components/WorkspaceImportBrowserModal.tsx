import { useCallback, useEffect, useState, type FormEvent } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  browseWorkspaceDirectories,
  createWorkspaceDirectory,
  importWorkspace,
  type WorkspaceDirectoryOptionDto,
  type WorkspaceDto
} from "../api/conversation-api";
import { WorkbenchModal } from "./WorkbenchModal";

interface WorkspaceImportBrowserModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onImported?: (workspace: WorkspaceDto) => Promise<void> | void;
}

export function WorkspaceImportBrowserModal({
  open,
  onClose,
  onImported
}: WorkspaceImportBrowserModalProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [roots, setRoots] = useState<WorkspaceDirectoryOptionDto[]>([]);
  const [items, setItems] = useState<WorkspaceDirectoryOptionDto[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const busy = loading || creating || importing;

  const loadDirectoryBrowser = useCallback(async (targetPath?: string) => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = await browseWorkspaceDirectories(targetPath);
      setCurrentPath(snapshot.currentPath);
      setInputPath(snapshot.currentPath);
      setParentPath(snapshot.parentPath);
      setRoots(snapshot.roots);
      setItems(snapshot.items);
    } catch (loadError) {
      setCurrentPath("");
      setParentPath(null);
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : t("shell.importBrowserBrowseFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setCreateModalOpen(false);
      setCreateName("");
      setError(null);
      return;
    }

    void loadDirectoryBrowser(currentPath || undefined);
  }, [loadDirectoryBrowser, open]);

  function handleClose() {
    if (busy) {
      return;
    }

    setCreateModalOpen(false);
    setCreateName("");
    onClose();
  }

  async function handleBrowseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadDirectoryBrowser(inputPath);
  }

  function handleOpenCreateDirectoryModal() {
    if (!currentPath || busy) {
      return;
    }

    setCreateName("");
    setCreateModalOpen(true);
  }

  function handleCloseCreateDirectoryModal() {
    if (creating) {
      return;
    }

    setCreateModalOpen(false);
    setCreateName("");
  }

  async function handleCreateDirectory(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const safeDirectoryName = createName.trim();

    if (!currentPath || !safeDirectoryName || busy) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const createdDirectory = await createWorkspaceDirectory({
        parentPath: currentPath,
        directoryName: safeDirectoryName
      });

      showToast({
        title: t("shell.importBrowserCreateDirectorySuccess"),
        description: createdDirectory.path,
        tone: "success"
      });

      setCreateModalOpen(false);
      setCreateName("");
      await loadDirectoryBrowser(createdDirectory.path);
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : t("shell.importBrowserCreateDirectoryFailed");
      setError(message);
      showToast({
        title: message,
        tone: "error"
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleImportCurrentDirectory() {
    const targetPath = currentPath.trim();

    if (!targetPath || busy) {
      return;
    }

    setImporting(true);

    try {
      const workspace = await importWorkspace({
        path: targetPath
      });
      await onImported?.(workspace);
      showToast({
        title: t("shell.importSuccess"),
        description: workspace.path,
        tone: "success"
      });
      onClose();
    } catch (importError) {
      showToast({
        title: importError instanceof Error ? importError.message : t("shell.importFailed"),
        tone: "error"
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <WorkbenchModal
        open={open}
        title={t("shell.importBrowserTitle")}
        description={t("shell.importBrowserDescription")}
        onClose={handleClose}
      >
        <form className="workbench-directory-browser-form" onSubmit={handleBrowseSubmit}>
          <label className="workbench-modal-field">
            <span>{t("shell.importBrowserCurrentPath")}</span>
            <input
              type="text"
              value={inputPath}
              placeholder={t("shell.importPathPlaceholder")}
              onChange={(event) => setInputPath(event.target.value)}
            />
          </label>
          <div className="workbench-directory-browser-toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !parentPath}
              onClick={() => {
                if (parentPath) {
                  void loadDirectoryBrowser(parentPath);
                }
              }}
            >
              {t("shell.importBrowserOpenParent")}
            </button>
            <button type="submit" className="secondary-button" disabled={busy}>
              {t("shell.importBrowserOpenPath")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !currentPath}
              onClick={handleOpenCreateDirectoryModal}
            >
              {t("shell.importBrowserCreateDirectory")}
            </button>
          </div>
        </form>

        <section className="workbench-directory-browser-panel">
          <div className="workbench-directory-browser-section">
            <span className="workbench-directory-browser-section-title">{t("shell.importBrowserRoots")}</span>
            <div className="workbench-directory-browser-root-list">
              {roots.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workbench-directory-browser-chip"
                  disabled={busy}
                  onClick={() => {
                    void loadDirectoryBrowser(item.path);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="workbench-directory-browser-current-path">{currentPath}</div>

          {error ? (
            <p className="workbench-directory-browser-status status-text" data-tone="error">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="workbench-directory-browser-status status-text">{t("common.loading")}</p>
          ) : items.length > 0 ? (
            <div className="workbench-directory-browser-list">
              {items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workbench-directory-browser-item"
                  disabled={busy}
                  onClick={() => {
                    void loadDirectoryBrowser(item.path);
                  }}
                >
                  <span className="workbench-directory-browser-item-name">{item.name}</span>
                  <span className="workbench-directory-browser-item-path">{item.path}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="workbench-directory-browser-status status-text">{t("shell.importBrowserEmpty")}</p>
          )}
        </section>

        <div className="workbench-modal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={handleClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !currentPath}
            onClick={() => {
              void handleImportCurrentDirectory();
            }}
          >
            {importing ? t("shell.importSubmitting") : t("shell.importBrowserSubmit")}
          </button>
        </div>
      </WorkbenchModal>

      <WorkbenchModal
        open={open && createModalOpen}
        title={t("shell.importBrowserCreateDirectoryTitle")}
        description={t("shell.importBrowserCreateDirectoryDescription")}
        onClose={handleCloseCreateDirectoryModal}
      >
        <form className="workbench-rename-form" onSubmit={(event) => void handleCreateDirectory(event)}>
          <div className="workbench-directory-browser-current-path">{currentPath}</div>
          <label className="workbench-modal-field">
            <span>{t("shell.importBrowserCreateDirectoryLabel")}</span>
            <input
              type="text"
              value={createName}
              placeholder={t("shell.importBrowserCreateDirectoryPlaceholder")}
              autoFocus
              onChange={(event) => setCreateName(event.target.value)}
            />
          </label>
          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={creating}
              onClick={handleCloseCreateDirectoryModal}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={creating || !createName.trim()}
            >
              {creating
                ? t("shell.importBrowserCreatingDirectory")
                : t("shell.importBrowserCreateDirectorySubmit")}
            </button>
          </div>
        </form>
      </WorkbenchModal>
    </>
  );
}
