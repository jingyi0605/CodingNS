import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  cloneWorkspace,
  importWorkspace,
  type CloneWorkspacePayload
} from "../../conversation/api/conversation-api";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

type WorkspaceActionMode = "import" | "clone" | "create" | null;

function getVisibleSessionCount(totalCount: number, archivedCount: number) {
  return Math.max(0, totalCount - archivedCount);
}

export function WorkspaceHomePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    navigationGroups,
    currentWorkspaceId,
    refreshNavigation,
    selectWorkspace,
    startDraftSession
  } = useWorkbenchShell();
  const [actionMode, setActionMode] = useState<WorkspaceActionMode>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [cloneForm, setCloneForm] = useState<CloneWorkspacePayload>({
    repositoryUrl: "",
    parentPath: "",
    directoryName: "",
    name: "",
    auth: {
      mode: "none"
    }
  });

  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace ??
    navigationGroups[0]?.workspace ??
    null;

  async function handleImportWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!importPath.trim()) {
      return;
    }

    setSubmitting(true);

    try {
      const workspace = await importWorkspace({
        path: importPath.trim(),
        name: importName.trim() || undefined
      });
      await refreshNavigation();
      selectWorkspace(workspace.id);
      showToast({
        title: t("shell.importSuccess"),
        description: workspace.path,
        tone: "success"
      });
      setImportPath("");
      setImportName("");
      setActionMode(null);
      navigate(`/workspaces/${workspace.id}`);
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.importFailed"),
        tone: "error"
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloneWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!cloneForm.repositoryUrl?.trim() || !cloneForm.parentPath?.trim()) {
      return;
    }

    setSubmitting(true);

    try {
      const workspace = await cloneWorkspace({
        repositoryUrl: cloneForm.repositoryUrl.trim(),
        parentPath: cloneForm.parentPath.trim(),
        directoryName: cloneForm.directoryName?.trim() || undefined,
        name: cloneForm.name?.trim() || undefined,
        auth: cloneForm.auth
      });
      await refreshNavigation();
      selectWorkspace(workspace.id);
      showToast({
        title: t("shell.cloneSuccess"),
        description: workspace.path,
        tone: "success"
      });
      setCloneForm({
        repositoryUrl: "",
        parentPath: "",
        directoryName: "",
        name: "",
        auth: {
          mode: "none"
        }
      });
      setActionMode(null);
      navigate(`/workspaces/${workspace.id}`);
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.cloneFailed"),
        tone: "error"
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mobile-feature-page mobile-workspace-home-page">
      <section className="mobile-feature-hero surface-card">
        <div className="mobile-feature-hero-copy">
          <p className="mobile-feature-eyebrow">{t("shell.mobileWorkspacesEntry")}</p>
          <h1>{t("shell.workspaceOverviewTitle")}</h1>
          <p>{t("shell.workspaceOverviewBody")}</p>
        </div>
        <div className="mobile-feature-hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => setActionMode("import")}
          >
            {t("shell.importWorkspaceTitle")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setActionMode("clone")}
          >
            {t("shell.cloneWorkspaceTitle")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!currentWorkspace}
            aria-label={
              currentWorkspace
                ? `${t("shell.createSessionTarget")} ${currentWorkspace.name} ${t("shell.createSession")}`
                : t("shell.createSession")
            }
            onClick={() => setActionMode("create")}
          >
            {t("shell.createSession")}
          </button>
        </div>
      </section>

      {actionMode === "import" ? (
        <section className="mobile-feature-panel surface-card">
          <div className="mobile-feature-panel-header">
            <div>
              <h2>{t("shell.importWorkspaceTitle")}</h2>
              <p>{t("shell.importWorkspaceHint")}</p>
            </div>
          </div>
          <form className="mobile-feature-form" onSubmit={handleImportWorkspace}>
            <label className="mobile-feature-field">
              <span>{t("shell.importPathLabel")}</span>
              <input
                value={importPath}
                placeholder={t("shell.importPathPlaceholder")}
                onChange={(event) => setImportPath(event.target.value)}
              />
            </label>
            <label className="mobile-feature-field">
              <span>{t("shell.importNameLabel")}</span>
              <input
                value={importName}
                placeholder={t("shell.importNamePlaceholder")}
                onChange={(event) => setImportName(event.target.value)}
              />
            </label>
            <div className="mobile-feature-inline-actions">
              <button type="button" className="secondary-button" onClick={() => setActionMode(null)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="primary-button" disabled={submitting || !importPath.trim()}>
                {submitting ? t("shell.importSubmitting") : t("shell.importSubmit")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {actionMode === "clone" ? (
        <section className="mobile-feature-panel surface-card">
          <div className="mobile-feature-panel-header">
            <div>
              <h2>{t("shell.cloneWorkspaceTitle")}</h2>
              <p>{t("shell.cloneWorkspaceHint")}</p>
            </div>
          </div>
          <form className="mobile-feature-form" onSubmit={handleCloneWorkspace}>
            <label className="mobile-feature-field">
              <span>{t("shell.cloneRepositoryLabel")}</span>
              <input
                value={cloneForm.repositoryUrl ?? ""}
                placeholder={t("shell.cloneRepositoryPlaceholder")}
                onChange={(event) =>
                  setCloneForm((current) => ({
                    ...current,
                    repositoryUrl: event.target.value
                  }))
                }
              />
            </label>
            <label className="mobile-feature-field">
              <span>{t("shell.cloneParentPathLabel")}</span>
              <input
                value={cloneForm.parentPath ?? ""}
                placeholder={t("shell.cloneParentPathPlaceholder")}
                onChange={(event) =>
                  setCloneForm((current) => ({
                    ...current,
                    parentPath: event.target.value
                  }))
                }
              />
            </label>
            <label className="mobile-feature-field">
              <span>{t("shell.cloneDirectoryNameLabel")}</span>
              <input
                value={cloneForm.directoryName ?? ""}
                placeholder={t("shell.cloneDirectoryNamePlaceholder")}
                onChange={(event) =>
                  setCloneForm((current) => ({
                    ...current,
                    directoryName: event.target.value
                  }))
                }
              />
            </label>
            <label className="mobile-feature-field">
              <span>{t("shell.importNameLabel")}</span>
              <input
                value={cloneForm.name ?? ""}
                placeholder={t("shell.importNamePlaceholder")}
                onChange={(event) =>
                  setCloneForm((current) => ({
                    ...current,
                    name: event.target.value
                  }))
                }
              />
            </label>
            <div className="mobile-feature-inline-actions">
              <button type="button" className="secondary-button" onClick={() => setActionMode(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={
                  submitting ||
                  !cloneForm.repositoryUrl?.trim() ||
                  !cloneForm.parentPath?.trim()
                }
              >
                {submitting ? t("shell.cloneSubmitting") : t("shell.cloneSubmit")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {actionMode === "create" && currentWorkspace ? (
        <section className="mobile-feature-panel surface-card">
          <div className="mobile-feature-panel-header">
            <div>
              <h2>{t("shell.createSessionModalTitle")}</h2>
              <p>
                {t("shell.createSessionTarget")} · {currentWorkspace.name}
              </p>
            </div>
          </div>
          <div className="mobile-provider-grid">
            <button
              type="button"
              className="mobile-provider-card"
              aria-label={t("conversation.providerCodex")}
              onClick={() => startDraftSession(currentWorkspace.id, "codex")}
            >
              <strong>{t("conversation.providerCodex")}</strong>
              <p>{t("shell.providerCodexDescription")}</p>
            </button>
            <button
              type="button"
              className="mobile-provider-card"
              aria-label={t("conversation.providerClaude")}
              onClick={() => startDraftSession(currentWorkspace.id, "claude-code")}
            >
              <strong>{t("conversation.providerClaude")}</strong>
              <p>{t("shell.providerClaudeDescription")}</p>
            </button>
          </div>
        </section>
      ) : null}

      <section className="mobile-feature-section">
        <div className="mobile-feature-section-header">
          <div>
            <h2>{t("shell.workspaceSectionTitle")}</h2>
            <p>{t("shell.workspaceListBody")}</p>
          </div>
          <span className="mobile-feature-counter">{navigationGroups.length}</span>
        </div>

        {navigationGroups.length === 0 ? (
          <article className="mobile-feature-empty surface-card">
            <p>{t("shell.emptyNavigationBody")}</p>
          </article>
        ) : (
          <div className="mobile-feature-stack">
            {navigationGroups.map((group) => {
              const archivedCount = group.sessions.filter((session) => session.isArchived === true).length;
              const visibleCount = getVisibleSessionCount(group.sessions.length, archivedCount);

              return (
                <article
                  key={group.workspace.id}
                  className="mobile-workspace-card surface-card"
                  data-active={group.workspace.id === currentWorkspaceId}
                >
                  <div className="mobile-workspace-card-main">
                    <div>
                      <h3>{group.workspace.name}</h3>
                      <p>{group.workspace.path}</p>
                    </div>
                    <div className="mobile-workspace-metrics">
                      <span>{t("shell.sessionCount")} {visibleCount}</span>
                      <span>{t("shell.archiveFolderLabel")} {archivedCount}</span>
                    </div>
                  </div>
                  <div className="mobile-feature-inline-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        selectWorkspace(group.workspace.id);
                        navigate(`/workspaces/${group.workspace.id}`);
                      }}
                    >
                      {t("shell.switchWorkspace")}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      aria-label={`${group.workspace.name} ${t("shell.createSession")}`}
                      onClick={() => startDraftSession(group.workspace.id, "codex")}
                    >
                      {t("shell.createSession")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
