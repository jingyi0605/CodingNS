import { useCallback, useEffect, useState, type FormEvent } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  browseWorkspaceDirectories,
  cloneWorkspace,
  type WorkspaceDirectoryOptionDto,
  type WorkspaceDto
} from "../api/conversation-api";
import { WorkbenchModal } from "./WorkbenchModal";

interface CloneWorkspaceFormState {
  repositoryUrl: string;
  parentPath: string;
  directoryName: string;
  name: string;
  authMode: "none" | "basic" | "token";
  username: string;
  password: string;
  token: string;
}

interface WorkspaceCloneModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCloned?: (workspace: WorkspaceDto) => Promise<void> | void;
}

const INITIAL_CLONE_FORM: CloneWorkspaceFormState = {
  repositoryUrl: "",
  parentPath: "",
  directoryName: "",
  name: "",
  authMode: "none",
  username: "",
  password: "",
  token: ""
};

export function WorkspaceCloneModal({
  open,
  onClose,
  onCloned
}: WorkspaceCloneModalProps) {
  const { showToast } = useToast();
  const [cloning, setCloning] = useState(false);
  const [form, setForm] = useState<CloneWorkspaceFormState>(INITIAL_CLONE_FORM);
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false);
  const [directoryBrowserLoading, setDirectoryBrowserLoading] = useState(false);
  const [directoryBrowserError, setDirectoryBrowserError] = useState<string | null>(null);
  const [directoryBrowserCurrentPath, setDirectoryBrowserCurrentPath] = useState("");
  const [directoryBrowserInputPath, setDirectoryBrowserInputPath] = useState("");
  const [directoryBrowserParentPath, setDirectoryBrowserParentPath] = useState<string | null>(null);
  const [directoryBrowserRoots, setDirectoryBrowserRoots] = useState<WorkspaceDirectoryOptionDto[]>([]);
  const [directoryBrowserItems, setDirectoryBrowserItems] = useState<WorkspaceDirectoryOptionDto[]>([]);

  const browserBusy = cloning || directoryBrowserLoading;

  useEffect(() => {
    if (!open && !cloning) {
      setForm(INITIAL_CLONE_FORM);
      setDirectoryBrowserOpen(false);
      setDirectoryBrowserError(null);
    }
  }, [cloning, open]);

  const loadDirectoryBrowser = useCallback(async (targetPath?: string) => {
    setDirectoryBrowserLoading(true);
    setDirectoryBrowserError(null);

    try {
      const snapshot = await browseWorkspaceDirectories(targetPath);
      setDirectoryBrowserCurrentPath(snapshot.currentPath);
      setDirectoryBrowserInputPath(snapshot.currentPath);
      setDirectoryBrowserParentPath(snapshot.parentPath);
      setDirectoryBrowserRoots(snapshot.roots);
      setDirectoryBrowserItems(snapshot.items);
      setForm((current) => ({
        ...current,
        parentPath: snapshot.currentPath
      }));
    } catch (error) {
      setDirectoryBrowserCurrentPath("");
      setDirectoryBrowserParentPath(null);
      setDirectoryBrowserItems([]);
      setDirectoryBrowserError(error instanceof Error ? error.message : t("shell.importBrowserBrowseFailed"));
    } finally {
      setDirectoryBrowserLoading(false);
    }
  }, []);

  function handleCloseCloneModal() {
    if (cloning) {
      return;
    }

    setDirectoryBrowserOpen(false);
    setDirectoryBrowserError(null);
    setForm(INITIAL_CLONE_FORM);
    onClose();
  }

  function handleOpenCloneDirectoryBrowser() {
    setDirectoryBrowserOpen(true);
    void loadDirectoryBrowser(form.parentPath || undefined);
  }

  function handleCloseDirectoryBrowser() {
    if (cloning) {
      return;
    }

    setDirectoryBrowserOpen(false);
    setDirectoryBrowserError(null);
  }

  async function handleDirectoryBrowserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadDirectoryBrowser(directoryBrowserInputPath);
  }

  function handleApplyCurrentDirectory() {
    setForm((current) => ({
      ...current,
      parentPath: directoryBrowserCurrentPath
    }));
    setDirectoryBrowserOpen(false);
    setDirectoryBrowserError(null);
  }

  async function handleCloneWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const repositoryUrl = form.repositoryUrl.trim();
    const parentPath = form.parentPath.trim();

    if (!repositoryUrl) {
      showToast({
        title: t("shell.cloneRepoRequired"),
        tone: "error"
      });
      return;
    }

    if (!parentPath) {
      showToast({
        title: t("shell.clonePathRequired"),
        tone: "error"
      });
      return;
    }

    setCloning(true);

    try {
      const workspace = await cloneWorkspace({
        repositoryUrl,
        parentPath,
        directoryName: form.directoryName.trim() || undefined,
        name: form.name.trim() || undefined,
        auth:
          form.authMode === "none"
            ? { mode: "none" }
            : form.authMode === "basic"
              ? {
                  mode: "basic",
                  username: form.username.trim(),
                  password: form.password
                }
              : {
                  mode: "token",
                  username: form.username.trim() || undefined,
                  token: form.token
                }
      });

      await onCloned?.(workspace);
      setForm(INITIAL_CLONE_FORM);
      setDirectoryBrowserOpen(false);
      showToast({
        title: t("shell.cloneSuccess"),
        description: workspace.path,
        tone: "success"
      });
      onClose();
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.cloneFailed"),
        tone: "error"
      });
    } finally {
      setCloning(false);
    }
  }

  return (
    <>
      <WorkbenchModal
        open={open}
        title={t("shell.cloneWorkspaceTitle")}
        description={t("shell.cloneWorkspaceHint")}
        onClose={handleCloseCloneModal}
      >
        <form className="workbench-clone-form" onSubmit={(event) => void handleCloneWorkspace(event)}>
          <label className="workbench-modal-field">
            <span>{t("shell.cloneRepositoryLabel")}</span>
            <input
              type="text"
              value={form.repositoryUrl}
              placeholder={t("shell.cloneRepositoryPlaceholder")}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  repositoryUrl: event.target.value
                }))
              }
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.cloneParentPathLabel")}</span>
            <div className="workbench-modal-inline-field">
              <input
                type="text"
                value={form.parentPath}
                placeholder={t("shell.cloneParentPathPlaceholder")}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    parentPath: event.target.value
                  }))
                }
              />
              <button
                type="button"
                className="secondary-button"
                disabled={cloning}
                onClick={handleOpenCloneDirectoryBrowser}
              >
                {t("shell.clonePickDirectory")}
              </button>
            </div>
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.cloneDirectoryNameLabel")}</span>
            <input
              type="text"
              value={form.directoryName}
              placeholder={t("shell.cloneDirectoryNamePlaceholder")}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  directoryName: event.target.value
                }))
              }
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.importNameLabel")}</span>
            <input
              type="text"
              value={form.name}
              placeholder={t("shell.importNamePlaceholder")}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.cloneAuthModeLabel")}</span>
            <select
              value={form.authMode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  authMode: event.target.value as CloneWorkspaceFormState["authMode"]
                }))
              }
            >
              <option value="none">{t("shell.cloneAuthModeNone")}</option>
              <option value="basic">{t("shell.cloneAuthModeBasic")}</option>
              <option value="token">{t("shell.cloneAuthModeToken")}</option>
            </select>
          </label>

          {form.authMode === "basic" ? (
            <>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneUsernameLabel")}</span>
                <input
                  type="text"
                  value={form.username}
                  placeholder={t("shell.cloneUsernamePlaceholder")}
                  autoComplete="username"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                />
              </label>
              <label className="workbench-modal-field">
                <span>{t("shell.clonePasswordLabel")}</span>
                <input
                  type="password"
                  value={form.password}
                  placeholder={t("shell.clonePasswordPlaceholder")}
                  autoComplete="current-password"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.target.value
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          {form.authMode === "token" ? (
            <>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneUsernameLabel")}</span>
                <input
                  type="text"
                  value={form.username}
                  placeholder={t("shell.cloneTokenUsernamePlaceholder")}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                />
              </label>
              <label className="workbench-modal-field">
                <span>{t("shell.cloneTokenLabel")}</span>
                <input
                  type="password"
                  value={form.token}
                  placeholder={t("shell.cloneTokenPlaceholder")}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      token: event.target.value
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          <p className="workbench-import-hint">{t("shell.cloneHint")}</p>

          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={cloning}
              onClick={handleCloseCloneModal}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary-button" disabled={cloning}>
              {cloning ? t("shell.cloneSubmitting") : t("shell.cloneSubmit")}
            </button>
          </div>
        </form>
      </WorkbenchModal>

      <WorkbenchModal
        open={open && directoryBrowserOpen}
        title={t("shell.cloneBrowserTitle")}
        description={t("shell.cloneBrowserDescription")}
        onClose={handleCloseDirectoryBrowser}
      >
        <form className="workbench-directory-browser-form" onSubmit={handleDirectoryBrowserSubmit}>
          <label className="workbench-modal-field">
            <span>{t("shell.importBrowserCurrentPath")}</span>
            <input
              type="text"
              value={directoryBrowserInputPath}
              placeholder={t("shell.importPathPlaceholder")}
              onChange={(event) => setDirectoryBrowserInputPath(event.target.value)}
            />
          </label>
          <div className="workbench-directory-browser-toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={browserBusy || !directoryBrowserParentPath}
              onClick={() => {
                if (directoryBrowserParentPath) {
                  void loadDirectoryBrowser(directoryBrowserParentPath);
                }
              }}
            >
              {t("shell.importBrowserOpenParent")}
            </button>
            <button type="submit" className="secondary-button" disabled={browserBusy}>
              {t("shell.importBrowserOpenPath")}
            </button>
          </div>
        </form>

        <section className="workbench-directory-browser-panel">
          <div className="workbench-directory-browser-section">
            <span className="workbench-directory-browser-section-title">{t("shell.importBrowserRoots")}</span>
            <div className="workbench-directory-browser-root-list">
              {directoryBrowserRoots.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workbench-directory-browser-chip"
                  disabled={browserBusy}
                  onClick={() => {
                    void loadDirectoryBrowser(item.path);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="workbench-directory-browser-current-path">{directoryBrowserCurrentPath}</div>

          {directoryBrowserError ? (
            <p className="workbench-directory-browser-status status-text" data-tone="error">
              {directoryBrowserError}
            </p>
          ) : null}

          {directoryBrowserLoading ? (
            <p className="workbench-directory-browser-status status-text">{t("common.loading")}</p>
          ) : directoryBrowserItems.length > 0 ? (
            <div className="workbench-directory-browser-list">
              {directoryBrowserItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workbench-directory-browser-item"
                  disabled={browserBusy}
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
          <button
            type="button"
            className="secondary-button"
            disabled={cloning}
            onClick={handleCloseDirectoryBrowser}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={browserBusy || !directoryBrowserCurrentPath}
            onClick={handleApplyCurrentDirectory}
          >
            {t("shell.cloneBrowserSubmit")}
          </button>
        </div>
      </WorkbenchModal>
    </>
  );
}
