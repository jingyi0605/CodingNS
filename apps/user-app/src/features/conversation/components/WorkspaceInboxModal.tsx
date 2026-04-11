import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  createButlerInboxItem,
  deleteButlerInboxItem,
  getButlerSessionTarget,
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
  preferredSessionId?: string | null;
  creationRequestId?: number;
  initialDraft?: Partial<Pick<InboxFormState, "title" | "content">> | null;
  compactComposer?: boolean;
  composerOpen?: boolean;
  onComposerOpenChange?: (open: boolean) => void;
}

interface InboxFormState {
  projectId: string;
  itemType: ButlerInboxItemType;
  title: string;
  content: string;
  status: ButlerInboxItemStatus;
}

interface PickerOption<T extends string> {
  value: T;
  label: string;
  description?: string;
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
  preferredWorkspaceId,
  preferredSessionId,
  creationRequestId = 0,
  initialDraft = null,
  compactComposer = false,
  composerOpen = true,
  onComposerOpenChange
}: WorkspaceInboxPanelProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ButlerProjectDto[]>([]);
  const [items, setItems] = useState<ButlerInboxItemDto[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [preferredProjectId, setPreferredProjectId] = useState<string | null>(null);
  const [formState, setFormState] = useState<InboxFormState>(DEFAULT_FORM_STATE);

  const selectableProjects = useMemo(
    () => sortSelectableProjects(projects, preferredWorkspaceId, preferredProjectId),
    [preferredProjectId, preferredWorkspaceId, projects]
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    void loadData();
  }, [active, preferredSessionId]);

  useEffect(() => {
    if (!active || editingItemId) {
      return;
    }

    setFormState((current) => {
      const nextProjectId = resolveProjectId({
        projects: selectableProjects,
        currentProjectId: current.projectId,
        preferredProjectId,
        preferredWorkspaceId
      });

      if (nextProjectId === current.projectId) {
        return current;
      }

      return {
        ...current,
        projectId: nextProjectId
      };
    });
  }, [active, editingItemId, preferredProjectId, preferredWorkspaceId, selectableProjects]);

  useEffect(() => {
    if (!active || creationRequestId <= 0) {
      return;
    }

    resetEditor(undefined, preferredWorkspaceId, initialDraft, preferredProjectId);
    onComposerOpenChange?.(true);
  }, [active, creationRequestId, initialDraft, onComposerOpenChange, preferredProjectId, preferredWorkspaceId]);

  async function loadData() {
    setLoading(true);

    try {
      const [projectResponse, itemResponse, sessionTargetResponse] = await Promise.all([
        listButlerProjects(),
        listButlerInboxItems(),
        preferredSessionId
          ? getButlerSessionTarget(preferredSessionId).catch(() => null)
          : Promise.resolve(null)
      ]);
      const nextPreferredProjectId = sessionTargetResponse?.target.project.id ?? null;

      setPreferredProjectId(nextPreferredProjectId);
      setProjects(projectResponse.items);
      setItems(itemResponse.items);

      if (!editingItemId) {
        resetEditor(
          projectResponse.items,
          preferredWorkspaceId,
          creationRequestId > 0 ? initialDraft : null,
          nextPreferredProjectId
        );
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
    workspaceId: string | null | undefined = preferredWorkspaceId,
    nextDraft: Partial<Pick<InboxFormState, "title" | "content">> | null = initialDraft,
    nextPreferredProjectId: string | null = preferredProjectId
  ) {
    const nextSelectableProjects = sortSelectableProjects(nextProjects, workspaceId, nextPreferredProjectId);
    setEditingItemId(null);
    setFormState({
      ...DEFAULT_FORM_STATE,
      projectId: resolveProjectId({
        projects: nextSelectableProjects,
        preferredProjectId: nextPreferredProjectId,
        preferredWorkspaceId: workspaceId
      }),
      title: nextDraft?.title?.trim() ?? "",
      content: nextDraft?.content?.trim() ?? ""
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
    if (compactComposer) {
      onComposerOpenChange?.(true);
    }
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
      if (compactComposer) {
        onComposerOpenChange?.(false);
      }
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
      {!compactComposer ? (
        <section className="workspace-inbox-panel">
          <WorkspaceInboxComposerSection
            selectableProjects={selectableProjects}
            formState={formState}
            saving={saving}
            editingItemId={editingItemId}
            useMobilePicker={false}
            onProjectChange={(projectId) => {
              setFormState((current) => ({
                ...current,
                projectId
              }));
            }}
            onItemTypeChange={(itemType) => {
              setFormState((current) => ({
                ...current,
                itemType
              }));
            }}
            onStatusChange={(status) => {
              setFormState((current) => ({
                ...current,
                status
              }));
            }}
            onTitleChange={(title) => {
              setFormState((current) => ({
                ...current,
                title
              }));
            }}
            onContentChange={(content) => {
              setFormState((current) => ({
                ...current,
                content
              }));
            }}
            onCancel={() => resetEditor()}
            onSubmit={handleSubmit}
          />
        </section>
      ) : null}

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

      {compactComposer ? (
        <WorkbenchModal
          open={active && composerOpen}
          title={editingItemId ? t("shell.butlerInboxEditingTitle") : t("shell.butlerInboxCreateTitle")}
          description={t("shell.butlerInboxFormDescription")}
          className="workspace-inbox-modal-card workspace-inbox-composer-modal-card"
          onClose={() => {
            onComposerOpenChange?.(false);
            resetEditor();
          }}
        >
          <div className="workspace-inbox-composer-modal-body">
            <WorkspaceInboxComposerSection
              selectableProjects={selectableProjects}
              formState={formState}
              saving={saving}
              editingItemId={editingItemId}
              useMobilePicker
              onProjectChange={(projectId) => {
                setFormState((current) => ({
                  ...current,
                  projectId
                }));
              }}
              onItemTypeChange={(itemType) => {
                setFormState((current) => ({
                  ...current,
                  itemType
                }));
              }}
              onStatusChange={(status) => {
                setFormState((current) => ({
                  ...current,
                  status
                }));
              }}
              onTitleChange={(title) => {
                setFormState((current) => ({
                  ...current,
                  title
                }));
              }}
              onContentChange={(content) => {
                setFormState((current) => ({
                  ...current,
                  content
                }));
              }}
              onCancel={() => {
                onComposerOpenChange?.(false);
                resetEditor();
              }}
              onSubmit={handleSubmit}
            />
          </div>
        </WorkbenchModal>
      ) : null}
    </div>
  );
}

function WorkspaceInboxComposerSection(props: {
  selectableProjects: ButlerProjectDto[];
  formState: InboxFormState;
  saving: boolean;
  editingItemId: string | null;
  useMobilePicker?: boolean;
  onProjectChange: (projectId: string) => void;
  onItemTypeChange: (itemType: ButlerInboxItemType) => void;
  onStatusChange: (status: ButlerInboxItemStatus) => void;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const projectOptions = props.selectableProjects.map((project) => ({
    value: project.id,
    label: project.name
  }));
  const typeOptions: PickerOption<ButlerInboxItemType>[] = [
    { value: "task", label: t("shell.butlerInboxTypeTask") },
    { value: "bug", label: t("shell.butlerInboxTypeBug") },
    { value: "feature", label: t("shell.butlerInboxTypeFeature") },
    { value: "change", label: t("shell.butlerInboxTypeChange") }
  ];
  const statusOptions: PickerOption<ButlerInboxItemStatus>[] = [
    { value: "pending", label: t("shell.butlerInboxStatusPending") },
    { value: "in_progress", label: t("shell.butlerInboxStatusInProgress") },
    { value: "closed", label: t("shell.butlerInboxStatusClosed") }
  ];

  return (
    <>
      <header className="workspace-inbox-panel-header">
        <h3>
          {props.editingItemId
            ? t("shell.butlerInboxEditingTitle")
            : t("shell.butlerInboxCreateTitle")}
        </h3>
        <p>{t("shell.butlerInboxFormDescription")}</p>
      </header>

      {props.selectableProjects.length === 0 ? (
        <p className="workspace-inbox-status">{t("shell.butlerInboxProjectsEmpty")}</p>
      ) : (
        <form className="workspace-inbox-form" onSubmit={props.onSubmit}>
          <div className="workspace-inbox-form-grid">
            {props.useMobilePicker ? (
              <>
                <MobilePickerField
                  label={t("shell.butlerInboxProjectLabel")}
                  value={props.formState.projectId}
                  options={projectOptions}
                  disabled={props.saving}
                  onChange={props.onProjectChange}
                />
                <MobilePickerField
                  label={t("shell.butlerInboxTypeLabel")}
                  value={props.formState.itemType}
                  options={typeOptions}
                  disabled={props.saving}
                  onChange={props.onItemTypeChange}
                />
                <MobilePickerField
                  label={t("shell.butlerInboxStatusLabel")}
                  value={props.formState.status}
                  options={statusOptions}
                  disabled={props.saving}
                  onChange={props.onStatusChange}
                />
              </>
            ) : (
              <>
                <label className="workbench-modal-field">
                  <span>{t("shell.butlerInboxProjectLabel")}</span>
                  <select
                    value={props.formState.projectId}
                    disabled={props.saving}
                    onChange={(event) => props.onProjectChange(event.target.value)}
                  >
                    {props.selectableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="workbench-modal-field">
                  <span>{t("shell.butlerInboxTypeLabel")}</span>
                  <select
                    value={props.formState.itemType}
                    disabled={props.saving}
                    onChange={(event) => props.onItemTypeChange(event.target.value as ButlerInboxItemType)}
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
                    value={props.formState.status}
                    disabled={props.saving}
                    onChange={(event) => props.onStatusChange(event.target.value as ButlerInboxItemStatus)}
                  >
                    <option value="pending">{t("shell.butlerInboxStatusPending")}</option>
                    <option value="in_progress">{t("shell.butlerInboxStatusInProgress")}</option>
                    <option value="closed">{t("shell.butlerInboxStatusClosed")}</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <label className="workbench-modal-field">
            <span>{t("shell.butlerInboxTitleLabel")}</span>
            <input
              value={props.formState.title}
              placeholder={t("shell.butlerInboxTitlePlaceholder")}
              disabled={props.saving}
              onChange={(event) => props.onTitleChange(event.target.value)}
            />
          </label>

          <label className="workbench-modal-field">
            <span>{t("shell.butlerInboxContentLabel")}</span>
            <textarea
              rows={4}
              value={props.formState.content}
              placeholder={t("shell.butlerInboxContentPlaceholder")}
              disabled={props.saving}
              onChange={(event) => props.onContentChange(event.target.value)}
            />
          </label>

          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={props.saving}
              onClick={props.onCancel}
            >
              {props.editingItemId ? t("shell.butlerInboxCancelEditAction") : t("common.cancel")}
            </button>
            <button type="submit" className="primary-button" disabled={props.saving || !props.formState.projectId}>
              {props.editingItemId
                ? t("shell.butlerInboxUpdateAction")
                : t("shell.butlerInboxCreateAction")}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function MobilePickerField<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string;
  value: T;
  options: PickerOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <div className="workbench-modal-field workspace-inbox-mobile-picker">
        <span>{label}</span>
        <button
          type="button"
          className="workspace-inbox-mobile-picker-trigger"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled || options.length === 0}
          onClick={() => setOpen(true)}
        >
          <span className="workspace-inbox-mobile-picker-trigger-value">
            {selectedOption?.label ?? ""}
          </span>
          <span className="workspace-inbox-mobile-picker-trigger-icon">
            <ChevronDownIcon expanded={open} />
          </span>
        </button>
      </div>

      <MobilePickerSheet
        open={open}
        title={label}
        options={options}
        selectedValue={value}
        onClose={() => setOpen(false)}
        onSelect={(nextValue) => {
          onChange(nextValue);
          setOpen(false);
        }}
      />
    </>
  );
}

function MobilePickerSheet<T extends string>({
  open,
  title,
  options,
  selectedValue,
  onClose,
  onSelect
}: {
  open: boolean;
  title: string;
  options: PickerOption<T>[];
  selectedValue: T;
  onClose: () => void;
  onSelect: (value: T) => void;
}) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="ios-action-sheet-overlay workspace-inbox-picker-sheet-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="mobile-workspace-home-sheet workspace-inbox-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card workspace-inbox-picker-sheet-card">
          <div className="mobile-workspace-home-sheet-header workspace-inbox-picker-sheet-header">
            <strong>{title}</strong>
          </div>

          <div className="mobile-workspace-home-group workspace-inbox-picker-sheet-options" role="listbox" aria-label={title}>
            {options.map((option) => {
              const selected = option.value === selectedValue;

              return (
                <button
                  key={option.value}
                  type="button"
                  className="mobile-workspace-home-row workspace-inbox-picker-option"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(option.value)}
                >
                  <span className="workspace-inbox-picker-option-copy">
                    <strong>{option.label}</strong>
                    {option.description ? <span>{option.description}</span> : null}
                  </span>
                  <span className="workspace-inbox-picker-option-indicator" aria-hidden="true">
                    {selected ? <CheckIcon /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button type="button" className="ios-action-sheet-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body
  );
}

interface WorkspaceInboxModalProps {
  open: boolean;
  preferredWorkspaceId?: string | null;
  preferredSessionId?: string | null;
  creationRequestId?: number;
  initialDraft?: Partial<Pick<InboxFormState, "title" | "content">> | null;
  onClose: () => void;
  compactComposer?: boolean;
}

export function WorkspaceInboxModal({
  open,
  preferredWorkspaceId,
  preferredSessionId,
  creationRequestId: externalCreationRequestId = 0,
  initialDraft = null,
  onClose,
  compactComposer = false
}: WorkspaceInboxModalProps) {
  const [internalCreationRequestId, setInternalCreationRequestId] = useState(0);
  const [composerOpen, setComposerOpen] = useState(!compactComposer);

  useEffect(() => {
    if (!open) {
      setComposerOpen(!compactComposer);
    }
  }, [compactComposer, open]);

  return (
    <WorkbenchModal
      open={open}
      title={t("shell.butlerInboxModalTitle")}
      description={t("shell.butlerInboxModalDescription")}
      className="workspace-inbox-modal-card"
      showCloseButton={!compactComposer}
      headerActions={compactComposer ? (
        <button
          type="button"
          className="workspace-inbox-modal-create-button"
          aria-label={t("shell.butlerInboxCreateAction")}
          title={t("shell.butlerInboxCreateAction")}
          onClick={() => {
            setInternalCreationRequestId((current) => current + 1);
            setComposerOpen(true);
          }}
        >
          <PlusIcon />
        </button>
      ) : undefined}
      onClose={onClose}
    >
      <WorkspaceInboxPanel
        active={open}
        preferredWorkspaceId={preferredWorkspaceId}
        preferredSessionId={preferredSessionId}
        creationRequestId={Math.max(externalCreationRequestId, internalCreationRequestId)}
        initialDraft={initialDraft}
        compactComposer={compactComposer}
        composerOpen={composerOpen}
        onComposerOpenChange={setComposerOpen}
      />
    </WorkbenchModal>
  );
}

function sortSelectableProjects(
  projects: ButlerProjectDto[],
  preferredWorkspaceId?: string | null,
  preferredProjectId?: string | null
) {
  return [...projects]
    .filter((project) => project.lifecycleStatus !== "archived")
    .sort((left, right) => {
      const leftWeight = resolveProjectWeight(left, preferredWorkspaceId, preferredProjectId);
      const rightWeight = resolveProjectWeight(right, preferredWorkspaceId, preferredProjectId);

      if (leftWeight !== rightWeight) {
        return rightWeight - leftWeight;
      }

      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });
}

function resolveProjectWeight(
  project: ButlerProjectDto,
  preferredWorkspaceId?: string | null,
  preferredProjectId?: string | null
) {
  if (preferredProjectId && project.id === preferredProjectId) {
    return 2;
  }

  if (preferredWorkspaceId && project.workspaceId === preferredWorkspaceId) {
    return 1;
  }

  return 0;
}

function resolveProjectId({
  projects,
  currentProjectId,
  preferredProjectId,
  preferredWorkspaceId
}: {
  projects: ButlerProjectDto[];
  currentProjectId?: string | null;
  preferredProjectId?: string | null;
  preferredWorkspaceId?: string | null;
}) {
  if (currentProjectId && projects.some((project) => project.id === currentProjectId)) {
    return currentProjectId;
  }

  if (preferredProjectId && projects.some((project) => project.id === preferredProjectId)) {
    return preferredProjectId;
  }

  const workspaceProject = preferredWorkspaceId
    ? projects.find((project) => project.workspaceId === preferredWorkspaceId)
    : null;

  return workspaceProject?.id || projects[0]?.id || "";
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function ChevronDownIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" data-expanded={expanded ? "true" : undefined}>
      <path
        d="M3.5 6 8 10l4.5-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.4 6.6 11.5 12.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
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
