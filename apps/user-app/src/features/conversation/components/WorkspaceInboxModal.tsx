import { useEffect, useMemo, useState, type FormEvent } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  createButlerInboxItem,
  deleteButlerInboxItem,
  listButlerInboxItems,
  listButlerProjects,
  updateButlerInboxItem,
  type ButlerInboxItemDto,
  type ButlerInboxItemStatus,
  type ButlerInboxItemType,
  type ButlerProjectDto
} from "../../butler/api/butler-api";
import { dispatchButlerInboxUpdatedEvent } from "../../butler/runtime/butler-inbox-events";
import { WorkbenchModal } from "./WorkbenchModal";

interface WorkspaceInboxPanelProps {
  active: boolean;
  preferredWorkspaceId?: string | null;
}

interface InboxFormState {
  projectId: string;
  itemType: ButlerInboxItemType;
  title: string;
  content: string;
  status: ButlerInboxItemStatus;
}

const DEFAULT_FORM_STATE: InboxFormState = {
  projectId: "",
  itemType: "task",
  title: "",
  content: "",
  status: "pending"
};

export function WorkspaceInboxPanel({
  active,
  preferredWorkspaceId
}: WorkspaceInboxPanelProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ButlerProjectDto[]>([]);
  const [items, setItems] = useState<ButlerInboxItemDto[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [formState, setFormState] = useState<InboxFormState>(DEFAULT_FORM_STATE);

  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.lifecycleStatus !== "archived"
          && (!preferredWorkspaceId || project.workspaceId === preferredWorkspaceId)
      ),
    [preferredWorkspaceId, projects]
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    void loadData();
  }, [active, preferredWorkspaceId]);

  useEffect(() => {
    if (!active || editingItemId) {
      return;
    }

    setFormState((current) => ({
      ...current,
      projectId: current.projectId || visibleProjects[0]?.id || ""
    }));
  }, [active, editingItemId, visibleProjects]);

  async function loadData() {
    setLoading(true);

    try {
      const [projectResponse, itemResponse] = await Promise.all([
        listButlerProjects({
          workspaceId: preferredWorkspaceId ?? null
        }),
        listButlerInboxItems({
          workspaceId: preferredWorkspaceId ?? null
        })
      ]);

      setProjects(projectResponse.items);
      setItems(itemResponse.items);

      if (!editingItemId) {
        resetEditor(projectResponse.items, preferredWorkspaceId);
      }
    } catch (error) {
      showToast({
        title: t("shell.butlerInboxLoadFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  function resetEditor(
    nextProjects: ButlerProjectDto[] = projects,
    workspaceId: string | null | undefined = preferredWorkspaceId
  ) {
    const firstProject = nextProjects.find(
      (project) =>
        project.lifecycleStatus !== "archived"
        && (!workspaceId || project.workspaceId === workspaceId)
    );
    setEditingItemId(null);
    setFormState({
      ...DEFAULT_FORM_STATE,
      projectId: firstProject?.id || ""
    });
  }

  function handleEditClick(item: ButlerInboxItemDto) {
    setEditingItemId(item.id);
    setFormState({
      projectId: item.projectId,
      itemType: item.itemType,
      title: item.title,
      content: item.content,
      status: item.status
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      if (editingItemId) {
        await updateButlerInboxItem(editingItemId, {
          projectId: formState.projectId,
          itemType: formState.itemType,
          title: formState.title,
          content: formState.content,
          status: formState.status,
          priority: "medium"
        });
        showToast({
          title: t("shell.butlerInboxUpdated"),
          tone: "success"
        });
      } else {
        await createButlerInboxItem({
          projectId: formState.projectId,
          itemType: formState.itemType,
          title: formState.title,
          content: formState.content,
          status: formState.status,
          priority: "medium"
        });
        showToast({
          title: t("shell.butlerInboxCreated"),
          tone: "success"
        });
      }

      dispatchButlerInboxUpdatedEvent();
      await loadData();
      resetEditor();
    } catch (error) {
      showToast({
        title: t("shell.butlerInboxSaveFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(itemId: string) {
    setSaving(true);

    try {
      await deleteButlerInboxItem(itemId);
      showToast({
        title: t("shell.butlerInboxDeleted"),
        tone: "success"
      });

      dispatchButlerInboxUpdatedEvent();
      await loadData();

      if (editingItemId === itemId) {
        resetEditor();
      }
    } catch (error) {
      showToast({
        title: t("shell.butlerInboxDeleteFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace-inbox-modal">
      <section className="workspace-inbox-panel">
        <header className="workspace-inbox-panel-header">
          <h3>
            {editingItemId
              ? t("shell.butlerInboxEditingTitle")
              : t("shell.butlerInboxCreateTitle")}
          </h3>
          <p>{t("shell.butlerInboxFormDescription")}</p>
        </header>

        {visibleProjects.length === 0 ? (
          <p className="workspace-inbox-status">{t("shell.butlerInboxProjectsEmpty")}</p>
        ) : (
          <form className="workspace-inbox-form" onSubmit={handleSubmit}>
            <div className="workspace-inbox-form-grid">
              <label className="workbench-modal-field">
                <span>{t("shell.butlerInboxProjectLabel")}</span>
                <select
                  value={formState.projectId}
                  disabled={saving}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      projectId: event.target.value
                    }));
                  }}
                >
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="workbench-modal-field">
                <span>{t("shell.butlerInboxTypeLabel")}</span>
                <select
                  value={formState.itemType}
                  disabled={saving}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      itemType: event.target.value as ButlerInboxItemType
                    }));
                  }}
                >
                  <option value="task">{t("shell.butlerInboxTypeTask")}</option>
                  <option value="bug">{t("shell.butlerInboxTypeBug")}</option>
                  <option value="feature">{t("shell.butlerInboxTypeFeature")}</option>
                  <option value="change">{t("shell.butlerInboxTypeChange")}</option>
                </select>
              </label>

              <label className="workbench-modal-field">
                <span>{t("shell.butlerInboxStatusLabel")}</span>
                <select
                  value={formState.status}
                  disabled={saving}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      status: event.target.value as ButlerInboxItemStatus
                    }));
                  }}
                >
                  <option value="pending">{t("shell.butlerInboxStatusPending")}</option>
                  <option value="in_progress">{t("shell.butlerInboxStatusInProgress")}</option>
                  <option value="closed">{t("shell.butlerInboxStatusClosed")}</option>
                </select>
              </label>
            </div>

            <label className="workbench-modal-field">
              <span>{t("shell.butlerInboxTitleLabel")}</span>
              <input
                value={formState.title}
                placeholder={t("shell.butlerInboxTitlePlaceholder")}
                disabled={saving}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    title: event.target.value
                  }));
                }}
              />
            </label>

            <label className="workbench-modal-field">
              <span>{t("shell.butlerInboxContentLabel")}</span>
              <textarea
                rows={4}
                value={formState.content}
                placeholder={t("shell.butlerInboxContentPlaceholder")}
                disabled={saving}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    content: event.target.value
                  }));
                }}
              />
            </label>

            <div className="workbench-modal-actions">
              {editingItemId ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => resetEditor()}
                >
                  {t("shell.butlerInboxCancelEditAction")}
                </button>
              ) : null}
              <button type="submit" className="primary-button" disabled={saving || !formState.projectId}>
                {editingItemId
                  ? t("shell.butlerInboxUpdateAction")
                  : t("shell.butlerInboxCreateAction")}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="workspace-inbox-panel">
        <header className="workspace-inbox-panel-header">
          <h3>{t("shell.butlerInboxListTitle")}</h3>
          <p>{t("shell.butlerInboxListDescription")}</p>
        </header>

        {loading ? <p className="workspace-inbox-status">{t("shell.butlerInboxLoading")}</p> : null}

        {!loading && items.length === 0 ? (
          <p className="workspace-inbox-status">{t("shell.butlerInboxEmpty")}</p>
        ) : null}

        {!loading && items.length > 0 ? (
          <div className="workspace-inbox-list">
            {items.map((item) => (
              <article key={item.id} className="workspace-inbox-item">
                <div className="workspace-inbox-item-header">
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.projectName}</p>
                  </div>
                  <div className="workspace-inbox-item-badges">
                    <span className="workspace-inbox-badge">{getInboxStatusLabel(item.status)}</span>
                    <span className="workspace-inbox-badge">{getInboxTypeLabel(item.itemType)}</span>
                  </div>
                </div>
                <p className="workspace-inbox-item-content">{item.content}</p>
                <div className="workspace-inbox-item-footer">
                  <span>{formatDateTime(item.updatedAt)}</span>
                  <div className="workspace-inbox-item-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() => handleEditClick(item)}
                    >
                      {t("shell.butlerInboxEditAction")}
                    </button>
                    <button
                      type="button"
                      className="secondary-button workbench-danger-button"
                      disabled={saving}
                      onClick={() => {
                        void handleDelete(item.id);
                      }}
                    >
                      {t("shell.butlerInboxDeleteAction")}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface WorkspaceInboxModalProps {
  open: boolean;
  preferredWorkspaceId?: string | null;
  onClose: () => void;
}

export function WorkspaceInboxModal({
  open,
  preferredWorkspaceId,
  onClose
}: WorkspaceInboxModalProps) {
  return (
    <WorkbenchModal
      open={open}
      title={t("shell.butlerInboxModalTitle")}
      description={t("shell.butlerInboxModalDescription")}
      className="workspace-inbox-modal-card"
      onClose={onClose}
    >
      <WorkspaceInboxPanel active={open} preferredWorkspaceId={preferredWorkspaceId} />
    </WorkbenchModal>
  );
}

function getInboxTypeLabel(itemType: ButlerInboxItemType) {
  switch (itemType) {
    case "bug":
      return t("shell.butlerInboxTypeBug");
    case "feature":
      return t("shell.butlerInboxTypeFeature");
    case "change":
      return t("shell.butlerInboxTypeChange");
    case "task":
    default:
      return t("shell.butlerInboxTypeTask");
  }
}

function getInboxStatusLabel(status: ButlerInboxItemStatus) {
  switch (status) {
    case "in_progress":
      return t("shell.butlerInboxStatusInProgress");
    case "closed":
      return t("shell.butlerInboxStatusClosed");
    case "pending":
    default:
      return t("shell.butlerInboxStatusPending");
  }
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}
