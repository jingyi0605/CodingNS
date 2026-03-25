import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  createTerminalTemplate,
  listTerminalShellOptions,
  listWorkspaceTemplateRuntimeStatuses,
  listWorkspaceTemplates,
  runTerminalTemplate,
  stopTerminalTemplateProcess,
  type TerminalShellOptionDto,
  type TerminalTemplateDto,
  type TerminalTemplateRuntimeStatusDto
} from "../../terminal/api/terminal-api";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";

interface TerminalManagerPanelProps {
  currentWorkspaceId: string | null;
  navigationGroups: WorkspaceSessionGroup[];
}

interface LaunchDraftState {
  mode: "command" | "script";
  name: string;
  cwd: string;
  target: string;
  args: string;
  port: string;
}

const INITIAL_LAUNCH_DRAFT: LaunchDraftState = {
  mode: "command",
  name: "",
  cwd: "",
  target: "",
  args: "",
  port: ""
};
const TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;

interface TerminalManagerSnapshot {
  templates: TerminalTemplateDto[];
  templateStatuses: TerminalTemplateRuntimeStatusDto[];
}

function formatDate(value: string | null): string {
  if (!value) {
    return t("common.unknown");
  }

  return new Date(value).toLocaleString();
}

function splitArgs(input: string): string[] {
  return input
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickDefaultShellId(options: TerminalShellOptionDto[]): string {
  return (
    options.find((option) => option.id === "cmd" && option.available)?.id ??
    options.find((option) => option.available)?.id ??
    options[0]?.id ??
    ""
  );
}

function buildLaunchName(draft: LaunchDraftState): string {
  const name = draft.name.trim();

  if (name) {
    return name;
  }

  const target = draft.target.trim();
  const args = draft.args.trim();

  if (!target) {
    return draft.mode === "script"
      ? t("terminalManager.defaultScriptName")
      : t("terminalManager.defaultCommandName");
  }

  return args ? `${target} ${args}` : target;
}

function buildTemplatePreview(template: TerminalTemplateDto): string {
  const args = template.args.join(" ");
  return args ? `${template.command} ${args}` : template.command;
}

function detectTemplateMode(template: TerminalTemplateDto): "command" | "script" {
  const command = template.command.toLowerCase();

  if (
    command.endsWith(".ps1") ||
    command.endsWith(".bat") ||
    command.endsWith(".cmd") ||
    command.endsWith(".sh")
  ) {
    return "script";
  }

  return "command";
}

function parsePort(input: string): number | null {
  const value = input.trim();

  if (!value) {
    return null;
  }

  const port = Number(value);
  return Number.isInteger(port) ? port : Number.NaN;
}

function getTemplateRuntimeStatus(
  runtimeStatusByTemplateId: ReadonlyMap<string, TerminalTemplateRuntimeStatusDto>,
  templateId: string
) {
  return runtimeStatusByTemplateId.get(templateId) ?? null;
}

function TerminalManagerModal({
  open,
  title,
  description,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card terminal-manager-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            className="workbench-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="workbench-modal-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}

export function TerminalManagerPanel({
  currentWorkspaceId,
  navigationGroups
}: TerminalManagerPanelProps) {
  const activeWorkspaceId = currentWorkspaceId?.trim() || null;
  const [templates, setTemplates] = useState<TerminalTemplateDto[]>([]);
  const [templateStatuses, setTemplateStatuses] = useState<TerminalTemplateRuntimeStatusDto[]>([]);
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [selectedShellId, setSelectedShellId] = useState("");
  const [launchDraft, setLaunchDraft] = useState<LaunchDraftState>(INITIAL_LAUNCH_DRAFT);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [runningTemplateId, setRunningTemplateId] = useState<string | null>(null);
  const [stoppingTemplateId, setStoppingTemplateId] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    logPerfDebug("terminal_manager.props", {
      currentWorkspaceId,
      workspaceCount: navigationGroups.length
    });
  }, [currentWorkspaceId, navigationGroups.length]);

  const selectedShellOption = useMemo(
    () => shellOptions.find((option) => option.id === selectedShellId) ?? null,
    [selectedShellId, shellOptions]
  );
  const runtimeStatusByTemplateId = useMemo(
    () => new Map(templateStatuses.map((status) => [status.templateId, status] as const)),
    [templateStatuses]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        logPerfDebug("terminal_manager.shell_options.start");
        const response = await listTerminalShellOptions();

        if (cancelled) {
          return;
        }

        setShellOptions(response.items);
        setSelectedShellId((current) => current || pickDefaultShellId(response.items));
        logPerfDebug("terminal_manager.shell_options.end", {
          count: response.items.length
        });
      } catch (error) {
        if (!cancelled) {
          showToast({
            title: error instanceof Error ? error.message : t("terminalManager.shellLoadFailed"),
            tone: "error"
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  async function loadWorkspaceData(workspaceId: string, options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }

    try {
      logPerfDebug("terminal_manager.load_workspace.start", {
        workspaceId,
        silent: options?.silent ?? false
      });
      const templateResponse = await listWorkspaceTemplates(workspaceId);

      setTemplates(templateResponse.items);

      const templateStatusResponse = await listWorkspaceTemplateRuntimeStatuses(workspaceId);
      setTemplateStatuses(templateStatusResponse.items);
      logPerfDebug("terminal_manager.load_workspace.end", {
        workspaceId,
        templateCount: templateResponse.items.length,
        statusCount: templateStatusResponse.items.length
      });
    } catch (error) {
      if (!options?.silent) {
        setTemplates([]);
        setTemplateStatuses([]);
        showToast({
          title: error instanceof Error ? error.message : t("terminalManager.loadFailed"),
          tone: "error"
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!activeWorkspaceId) {
      setTemplates([]);
      setTemplateStatuses([]);
      setLoading(false);
      return;
    }

    const cachedSnapshot = readViewSnapshot<TerminalManagerSnapshot>(
      buildTerminalManagerSnapshotKey(activeWorkspaceId),
      TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    logPerfDebug("terminal_manager.snapshot", {
      workspaceId: activeWorkspaceId,
      cached: Boolean(cachedSnapshot),
      cachedTemplateCount: cachedSnapshot?.templates.length ?? 0,
      cachedStatusCount: cachedSnapshot?.templateStatuses.length ?? 0
    });

    if (cachedSnapshot) {
      setTemplates(cachedSnapshot.templates);
      setTemplateStatuses(cachedSnapshot.templateStatuses);
      setLoading(false);
    } else {
      setTemplates([]);
      setTemplateStatuses([]);
      setLoading(true);
    }

    void loadWorkspaceData(activeWorkspaceId, {
      silent: cachedSnapshot !== null
    });
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    writeViewSnapshot<TerminalManagerSnapshot>(buildTerminalManagerSnapshotKey(activeWorkspaceId), {
      templates,
      templateStatuses
    });
  }, [activeWorkspaceId, templateStatuses, templates]);

  async function handleStopTemplateProcess(templateId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    setStoppingTemplateId(templateId);

    try {
      await stopTerminalTemplateProcess(templateId);
      await loadWorkspaceData(activeWorkspaceId);
      showToast({
        title: t("terminalManager.stopProcessSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("terminalManager.stopProcessFailed"),
        tone: "error"
      });
    } finally {
      setStoppingTemplateId(null);
    }
  }

  async function handleSaveLaunchTemplate() {
    if (!activeWorkspaceId || !launchDraft.target.trim()) {
      return;
    }

    const parsedPort = parsePort(launchDraft.port);

    if (Number.isNaN(parsedPort)) {
      showToast({
        title: t("terminalManager.invalidPort"),
        tone: "error"
      });
      return;
    }

    setSavingTemplate(true);

    try {
      await createTerminalTemplate({
        workspaceId: activeWorkspaceId,
        name: buildLaunchName(launchDraft),
        cwd: launchDraft.cwd.trim() || undefined,
        command: launchDraft.target.trim(),
        args: splitArgs(launchDraft.args),
        port: parsedPort
      });
      setLaunchDraft(INITIAL_LAUNCH_DRAFT);
      setCreateModalOpen(false);
      await loadWorkspaceData(activeWorkspaceId);
      showToast({
        title: t("terminalManager.templateSaveSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("terminalManager.templateSaveFailed"),
        tone: "error"
      });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleRunTemplate(templateId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    setRunningTemplateId(templateId);

    try {
      await runTerminalTemplate(templateId, {
        shell: selectedShellOption?.available ? selectedShellOption.shell : undefined
      });
      await loadWorkspaceData(activeWorkspaceId);
      showToast({
        title: t("terminalManager.templateRunSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("terminalManager.templateRunFailed"),
        tone: "error"
      });
    } finally {
      setRunningTemplateId(null);
    }
  }

  if (!navigationGroups.length) {
    return (
      <section className="workbench-empty-state minimal">
        <p>{t("terminalManager.emptyWorkspaceBody")}</p>
      </section>
    );
  }

  if (!activeWorkspaceId) {
    return (
      <section className="workbench-empty-state minimal">
        <p>{t("terminalManager.noCurrentWorkspaceBody")}</p>
      </section>
    );
  }

  return (
    <section className="conversation-panel surface-card terminal-manager-panel">
      <div className="terminal-manager-header">
        <button
          className="ghost-button"
          type="button"
          disabled={!activeWorkspaceId || loading}
          onClick={() => {
            if (activeWorkspaceId) {
              void loadWorkspaceData(activeWorkspaceId);
            }
          }}
        >
          {t("terminalManager.refresh")}
        </button>
      </div>

      <section className="terminal-manager-section">
        <div className="terminal-manager-section-header">
          <div>
            <h3>{t("terminalManager.templateSectionTitle")}</h3>
            <p className="status-text">{t("terminalManager.templateSectionDescription")}</p>
          </div>
          <span className="workbench-section-counter">{templates.length}</span>
        </div>

        <div className="terminal-manager-toolbar">
          <button
            className="primary-button"
            type="button"
            disabled={!activeWorkspaceId}
            onClick={() => {
              setCreateModalOpen(true);
            }}
          >
            {t("terminalManager.openCreateModalAction")}
          </button>
        </div>

        {loading && !templates.length ? <p className="status-text">{t("common.loading")}</p> : null}

        {templates.length ? (
          <div className="terminal-manager-list">
            {templates.map((template) => {
              const runtimeStatus = getTemplateRuntimeStatus(runtimeStatusByTemplateId, template.id);

              return (
                <article key={template.id} className="terminal-manager-card">
                  <div className="terminal-manager-card-header">
                    <div>
                      <strong>{template.name}</strong>
                      <p className="status-text">{buildTemplatePreview(template)}</p>
                    </div>
                    <span className="badge">
                      {detectTemplateMode(template) === "script"
                        ? t("terminalManager.scriptMode")
                        : t("terminalManager.commandMode")}
                    </span>
                  </div>

                  <div className="terminal-manager-meta">
                    <span className="status-text">
                      {t("terminalManager.cwdLabel")} {template.cwd}
                    </span>
                    <span className="status-text">
                      {t("terminalManager.updatedAt")} {formatDate(template.updatedAt)}
                    </span>
                    <span className="status-text">
                      {template.port === null
                        ? t("terminalManager.portUnset")
                        : `${t("terminalManager.portLabel")} ${template.port}`}
                    </span>
                  </div>

                  {template.port !== null ? (
                    runtimeStatus?.occupied ? (
                      <div className="terminal-template-status success">
                        <div className="terminal-process-item-header">
                          <strong>{t("terminalManager.portOccupied")}</strong>
                          <span className="badge" data-tone="success">
                            {runtimeStatus.processId
                              ? `PID ${runtimeStatus.processId}`
                              : t("terminalManager.statusRunning")}
                          </span>
                        </div>
                        <p className="status-text">
                          {runtimeStatus.processName || t("terminalManager.processCommandFallback")}
                        </p>
                        {runtimeStatus.processCommandLine ? (
                          <p className="status-text">{runtimeStatus.processCommandLine}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="terminal-template-status">
                        <div className="terminal-process-item-header">
                          <strong>{t("terminalManager.portAvailable")}</strong>
                          <span className="badge">{t("terminalManager.statusStopped")}</span>
                        </div>
                        <p className="status-text">{t("terminalManager.portAvailableDescription")}</p>
                      </div>
                    )
                  ) : (
                    <div className="terminal-template-status">
                      <div className="terminal-process-item-header">
                        <strong>{t("terminalManager.portUnset")}</strong>
                      </div>
                      <p className="status-text">{t("terminalManager.portUnsetDescription")}</p>
                    </div>
                  )}

                  <div className="terminal-manager-actions">
                    {runtimeStatus?.occupied ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={stoppingTemplateId === template.id}
                        onClick={() => {
                          void handleStopTemplateProcess(template.id);
                        }}
                      >
                        {stoppingTemplateId === template.id
                          ? t("terminalManager.stoppingProcess")
                          : t("terminalManager.stopProcessAction")}
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        runningTemplateId === template.id ||
                        (selectedShellOption?.available === false && shellOptions.length > 0)
                      }
                      onClick={() => {
                        void handleRunTemplate(template.id);
                      }}
                    >
                      {runningTemplateId === template.id
                        ? t("terminalManager.runningTemplate")
                        : t("terminalManager.runTemplateAction")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <section className="workbench-empty-state minimal">
            <p>{t("terminalManager.emptyTemplateBody")}</p>
          </section>
        )}
      </section>

      <TerminalManagerModal
        open={createModalOpen}
        title={t("terminalManager.createModalTitle")}
        description={t("terminalManager.createModalDescription")}
        onClose={() => {
          setCreateModalOpen(false);
        }}
      >
        <section className="terminal-manager-modal-form">
          <div className="field-group">
            <span>{t("terminalManager.shellField")}</span>
            <select
              value={selectedShellId}
              onChange={(event) => {
                setSelectedShellId(event.target.value);
              }}
            >
              {shellOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.available}>
                  {option.available
                    ? option.label
                    : `${option.label} - ${t("terminalManager.shellUnavailable")}`}
                </option>
              ))}
            </select>
            {selectedShellOption?.available === false && selectedShellOption.unavailableReason ? (
              <p className="status-text">{selectedShellOption.unavailableReason}</p>
            ) : null}
          </div>

          <div
            className="terminal-manager-mode-row"
            role="tablist"
            aria-label={t("terminalManager.modeField")}
          >
            <button
              type="button"
              className={
                launchDraft.mode === "command" ? "workbench-info-tab active" : "workbench-info-tab"
              }
              onClick={() => {
                setLaunchDraft((current) => ({
                  ...current,
                  mode: "command"
                }));
              }}
            >
              {t("terminalManager.commandMode")}
            </button>
            <button
              type="button"
              className={
                launchDraft.mode === "script" ? "workbench-info-tab active" : "workbench-info-tab"
              }
              onClick={() => {
                setLaunchDraft((current) => ({
                  ...current,
                  mode: "script"
                }));
              }}
            >
              {t("terminalManager.scriptMode")}
            </button>
          </div>

          <div className="terminal-manager-grid">
            <div className="field-group">
              <span>{t("terminalManager.templateNameField")}</span>
              <input
                value={launchDraft.name}
                placeholder={t("terminalManager.templateNamePlaceholder")}
                onChange={(event) => {
                  setLaunchDraft((current) => ({
                    ...current,
                    name: event.target.value
                  }));
                }}
              />
            </div>

            <div className="field-group">
              <span>{t("terminalManager.cwdField")}</span>
              <input
                value={launchDraft.cwd}
                placeholder={t("terminalManager.cwdPlaceholder")}
                onChange={(event) => {
                  setLaunchDraft((current) => ({
                    ...current,
                    cwd: event.target.value
                  }));
                }}
              />
            </div>
          </div>

          <div className="terminal-manager-grid">
            <div className="field-group">
              <span>
                {launchDraft.mode === "script"
                  ? t("terminalManager.scriptPathField")
                  : t("terminalManager.commandField")}
              </span>
              <input
                value={launchDraft.target}
                placeholder={
                  launchDraft.mode === "script"
                    ? t("terminalManager.scriptPathPlaceholder")
                    : t("terminalManager.commandPlaceholder")
                }
                onChange={(event) => {
                  setLaunchDraft((current) => ({
                    ...current,
                    target: event.target.value
                  }));
                }}
              />
            </div>

            <div className="field-group">
              <span>{t("terminalManager.argsField")}</span>
              <input
                value={launchDraft.args}
                placeholder={t("terminalManager.argsPlaceholder")}
                onChange={(event) => {
                  setLaunchDraft((current) => ({
                    ...current,
                    args: event.target.value
                  }));
                }}
              />
            </div>
          </div>

          <div className="terminal-manager-grid">
            <div className="field-group">
              <span>{t("terminalManager.portField")}</span>
              <input
                value={launchDraft.port}
                placeholder={t("terminalManager.portPlaceholder")}
                onChange={(event) => {
                  setLaunchDraft((current) => ({
                    ...current,
                    port: event.target.value
                  }));
                }}
              />
            </div>
          </div>

          <div className="terminal-manager-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setCreateModalOpen(false);
              }}
            >
              {t("common.close")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!activeWorkspaceId || savingTemplate || !launchDraft.target.trim()}
              onClick={() => {
                void handleSaveLaunchTemplate();
              }}
            >
              {savingTemplate
                ? t("terminalManager.templateSaving")
                : t("terminalManager.saveLaunchAction")}
            </button>
          </div>
        </section>
      </TerminalManagerModal>
    </section>
  );
}

function buildTerminalManagerSnapshotKey(workspaceId: string) {
  return `terminal-manager.snapshot.${workspaceId}`;
}
