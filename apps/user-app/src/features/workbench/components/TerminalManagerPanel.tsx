import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  createTerminalTemplate,
  listTerminalShellOptions,
  runTerminalTemplate,
  stopTerminalTemplateProcess,
  type TerminalShellOptionDto,
  type TerminalDto,
  type TerminalTemplateDto,
  type TerminalTemplateRuntimeStatusDto
} from "../../terminal/api/terminal-api";
import {
  getTerminalRuntimeLabel,
  listTerminalRuntimeOptions,
  type SelectableTerminalRuntimeType
} from "../../terminal/runtime/terminal-runtime-meta";
import { isTmuxDependencyMissingError } from "../../terminal/runtime/terminal-runtime-errors";
import { TerminalRuntimeFallbackModal } from "../../terminal/components/TerminalRuntimeFallbackModal";
import {
  type WorkspaceSessionGroup,
  useWorkbenchShell
} from "../../conversation/components/WorkbenchLayout";

interface TerminalManagerPanelProps {
  className?: string;
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
  terminals: TerminalDto[];
  templates: TerminalTemplateDto[];
  templateStatuses: TerminalTemplateRuntimeStatusDto[];
}

interface TemplateRunFallbackDraft {
  templateId: string;
  shell?: string;
}

interface TemplateVisualStatus {
  tone: "running" | "idle" | "untracked";
  title: string;
  summary: string;
  badgeLabel: string;
  badgeTone?: "success";
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

function resolveTemplateVisualStatus(
  template: TerminalTemplateDto,
  runtimeStatus: TerminalTemplateRuntimeStatusDto | null
): TemplateVisualStatus {
  if (template.port === null) {
    return {
      tone: "untracked",
      title: t("terminalManager.portUnset"),
      summary: t("terminalManager.portUnsetDescription"),
      badgeLabel: t("terminalManager.portUnset")
    };
  }

  if (runtimeStatus?.occupied) {
    return {
      tone: "running",
      title: t("terminalManager.portOccupied"),
      summary: runtimeStatus.processName || t("terminalManager.processCommandFallback"),
      badgeLabel: runtimeStatus.processId
        ? `PID ${runtimeStatus.processId}`
        : t("terminalManager.statusRunning"),
      badgeTone: "success"
    };
  }

  return {
    tone: "idle",
    title: t("terminalManager.portAvailable"),
    summary: t("terminalManager.portAvailableDescription"),
    badgeLabel: t("terminalManager.statusStopped")
  };
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
  className,
  currentWorkspaceId,
  navigationGroups
}: TerminalManagerPanelProps) {
  const {
    subscribeTerminalManagerSnapshot,
    requestTerminalManagerRefresh,
    addTerminalManagerSnapshotListener
  } = useWorkbenchShell();
  const activeWorkspaceId = currentWorkspaceId?.trim() || null;
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [templates, setTemplates] = useState<TerminalTemplateDto[]>([]);
  const [templateStatuses, setTemplateStatuses] = useState<TerminalTemplateRuntimeStatusDto[]>([]);
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [selectedShellId, setSelectedShellId] = useState("");
  const [selectedRuntimeType, setSelectedRuntimeType] =
    useState<SelectableTerminalRuntimeType>("");
  const [launchDraft, setLaunchDraft] = useState<LaunchDraftState>(INITIAL_LAUNCH_DRAFT);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [runningTemplateId, setRunningTemplateId] = useState<string | null>(null);
  const [stoppingTemplateId, setStoppingTemplateId] = useState<string | null>(null);
  const [runtimeFallbackDraft, setRuntimeFallbackDraft] = useState<TemplateRunFallbackDraft | null>(
    null
  );
  const [applyingRuntimeFallback, setApplyingRuntimeFallback] = useState(false);
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
  const runtimeOptions = useMemo(() => listTerminalRuntimeOptions(), []);
  const runtimeStatusByTemplateId = useMemo(
    () => new Map(templateStatuses.map((status) => [status.templateId, status] as const)),
    [templateStatuses]
  );
  const runningTemplateCount = useMemo(
    () => templateStatuses.filter((status) => status.occupied).length,
    [templateStatuses]
  );
  const monitoredTemplateCount = useMemo(
    () => templates.filter((template) => template.port !== null).length,
    [templates]
  );
  const unavailableShellSelected = selectedShellOption?.available === false && shellOptions.length > 0;

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

  useEffect(() => {
    if (!activeWorkspaceId) {
      setTerminals([]);
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
      setTerminals(cachedSnapshot.terminals);
      setTemplates(cachedSnapshot.templates);
      setTemplateStatuses(cachedSnapshot.templateStatuses);
      setLoading(false);
    } else {
      setTerminals([]);
      setTemplates([]);
      setTemplateStatuses([]);
      setLoading(true);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    return addTerminalManagerSnapshotListener((snapshot) => {
      if (snapshot.workspaceId !== activeWorkspaceId) {
        return;
      }

      logPerfDebug("terminal_manager.snapshot_received", {
        workspaceId: snapshot.workspaceId,
        terminalCount: snapshot.terminals.length,
        templateCount: snapshot.templates.length,
        statusCount: snapshot.templateStatuses.length
      });
      applyTerminalManagerSnapshot(snapshot);
      setLoading(false);
    });
  }, [activeWorkspaceId, addTerminalManagerSnapshotListener]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    const hasCachedSnapshot =
      readViewSnapshot<TerminalManagerSnapshot>(
        buildTerminalManagerSnapshotKey(activeWorkspaceId),
        TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS
      ) !== null;

    subscribeTerminalManagerSnapshot(activeWorkspaceId);

    if (hasCachedSnapshot) {
      const timer = window.setTimeout(() => {
        requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
      }, 1500);

      return () => {
        window.clearTimeout(timer);
      };
    }

    requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
  }, [activeWorkspaceId, requestTerminalManagerRefresh, subscribeTerminalManagerSnapshot]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    writeViewSnapshot<TerminalManagerSnapshot>(buildTerminalManagerSnapshotKey(activeWorkspaceId), {
      terminals,
      templates,
      templateStatuses
    });
  }, [activeWorkspaceId, templateStatuses, templates, terminals]);

  function applyTerminalManagerSnapshot(snapshot: TerminalManagerSnapshot) {
    setTerminals(snapshot.terminals);
    setTemplates(snapshot.templates);
    setTemplateStatuses(snapshot.templateStatuses);
  }

  function requestTerminalManagerSnapshotRefresh(workspaceId: string) {
    logPerfDebug("terminal_manager.refresh_requested", {
      workspaceId
    });
    requestTerminalManagerRefresh(workspaceId);
  }

  async function handleStopTemplateProcess(templateId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    setStoppingTemplateId(templateId);

    try {
      await stopTerminalTemplateProcess(templateId);
      requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
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
        port: parsedPort,
        runtimeType: selectedRuntimeType || null
      });
      setLaunchDraft(INITIAL_LAUNCH_DRAFT);
      setSelectedRuntimeType("");
      setCreateModalOpen(false);
      requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
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

    const shell = selectedShellOption?.available ? selectedShellOption.shell : undefined;
    setRunningTemplateId(templateId);

    try {
      await runTerminalTemplate(templateId, {
        shell
      });
      requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
      showToast({
        title: t("terminalManager.templateRunSuccess"),
        tone: "success"
      });
    } catch (error) {
      if (isTmuxDependencyMissingError(error)) {
        setRuntimeFallbackDraft({
          templateId,
          shell
        });
        return;
      }

      showToast({
        title: error instanceof Error ? error.message : t("terminalManager.templateRunFailed"),
        tone: "error"
      });
    } finally {
      setRunningTemplateId(null);
    }
  }

  async function handleConfirmRuntimeFallback() {
    if (!activeWorkspaceId || !runtimeFallbackDraft) {
      return;
    }

    setApplyingRuntimeFallback(true);

    try {
      await runTerminalTemplate(runtimeFallbackDraft.templateId, {
        shell: runtimeFallbackDraft.shell,
        runtimeType: "embedded-pty"
      });
      setRuntimeFallbackDraft(null);
      requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
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
      setApplyingRuntimeFallback(false);
    }
  }

  function toggleTemplateDetails(templateId: string) {
    setExpandedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((item) => item !== templateId)
        : [...current, templateId]
    );
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
    <section
      className={["conversation-panel", "surface-card", "terminal-manager-panel", className]
        .filter(Boolean)
        .join(" ")}
    >
      <TerminalRuntimeFallbackModal
        open={runtimeFallbackDraft !== null}
        busy={applyingRuntimeFallback}
        onClose={() => {
          if (applyingRuntimeFallback) {
            return;
          }

          setRuntimeFallbackDraft(null);
        }}
        onConfirmFallback={() => {
          void handleConfirmRuntimeFallback();
        }}
      />
      <div className="terminal-manager-header terminal-manager-desktop-header">
        <div className="terminal-manager-panel-heading">
          <span className="terminal-manager-panel-eyebrow">{t("terminalManager.quickLaunchTitle")}</span>
          <div>
            <h2>{t("terminalManager.templateSectionTitle")}</h2>
            <p className="status-text">{t("terminalManager.desktopPanelDescription")}</p>
          </div>
        </div>

        <div className="terminal-manager-overview">
          <article className="terminal-manager-overview-card">
            <span>{t("terminalManager.runningCountLabel")}</span>
            <strong>{runningTemplateCount}</strong>
          </article>
          <article className="terminal-manager-overview-card">
            <span>{t("terminalManager.portWatchCountLabel")}</span>
            <strong>{monitoredTemplateCount}</strong>
          </article>
          <article className="terminal-manager-overview-card">
            <span>{t("terminalManager.terminalCountLabel")}</span>
            <strong>{terminals.length}</strong>
          </article>
        </div>

        <div className="terminal-manager-toolbar terminal-manager-toolbar-header">
          <button
            className="ghost-button"
            type="button"
            disabled={!activeWorkspaceId || loading}
            onClick={() => {
              if (activeWorkspaceId) {
                requestTerminalManagerSnapshotRefresh(activeWorkspaceId);
              }
            }}
          >
            {t("terminalManager.refresh")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!activeWorkspaceId}
            onClick={() => {
              setSelectedRuntimeType("");
              setCreateModalOpen(true);
            }}
          >
            {t("terminalManager.openCreateModalAction")}
          </button>
        </div>
      </div>

      <section className="terminal-manager-section">
        <div className="terminal-manager-section-header">
          <div>
            <h3>{t("terminalManager.templateSectionTitle")}</h3>
            <p className="status-text">{t("terminalManager.templateSectionDescription")}</p>
          </div>
          <span className="workbench-section-counter">{templates.length}</span>
        </div>

        {loading && !templates.length ? <p className="status-text">{t("common.loading")}</p> : null}

        {templates.length ? (
          <div className="terminal-manager-list">
            {templates.map((template) => {
              const runtimeStatus = getTemplateRuntimeStatus(runtimeStatusByTemplateId, template.id);
              const visualStatus = resolveTemplateVisualStatus(template, runtimeStatus);
              const detailsOpen = expandedTemplateIds.includes(template.id);
              const detailButtonLabel = detailsOpen
                ? t("terminalManager.hideDetailsAction")
                : t("terminalManager.showDetailsAction");

              return (
                <article
                  key={template.id}
                  className="terminal-manager-card terminal-manager-desktop-card"
                  data-tone={visualStatus.tone}
                  data-expanded={detailsOpen ? "true" : "false"}
                >
                  <div className="terminal-manager-card-header">
                    <div className="terminal-manager-card-title">
                      <span className="terminal-manager-card-indicator" aria-hidden="true" />
                      <strong>{template.name}</strong>
                    </div>
                    <div className="terminal-manager-card-tools">
                      <span className="badge terminal-runtime-badge">
                        {getTerminalRuntimeLabel(template.runtimeType)}
                      </span>
                      <span className="badge">
                        {detectTemplateMode(template) === "script"
                          ? t("terminalManager.scriptMode")
                          : t("terminalManager.commandMode")}
                      </span>
                      <button
                        className="terminal-manager-detail-toggle"
                        type="button"
                        aria-label={detailButtonLabel}
                        aria-expanded={detailsOpen}
                        onClick={() => {
                          toggleTemplateDetails(template.id);
                        }}
                      >
                        i
                      </button>
                    </div>
                  </div>

                  <div className="terminal-manager-status-panel">
                    <div className="terminal-manager-status-copy">
                      <p className="terminal-manager-status-title">{visualStatus.title}</p>
                      <p className="status-text">{visualStatus.summary}</p>
                    </div>
                    <div className="terminal-manager-status-badges">
                      <span className="terminal-manager-stat-pill">
                        {template.port === null
                          ? t("terminalManager.portUnset")
                          : `${t("terminalManager.portLabel")} ${template.port}`}
                      </span>
                      <span className="badge" data-tone={visualStatus.badgeTone}>
                        {visualStatus.badgeLabel}
                      </span>
                    </div>
                  </div>

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
                      disabled={runningTemplateId === template.id || unavailableShellSelected}
                      onClick={() => {
                        void handleRunTemplate(template.id);
                      }}
                    >
                      {runningTemplateId === template.id
                        ? t("terminalManager.runningTemplate")
                        : t("terminalManager.runTemplateAction")}
                    </button>
                  </div>

                  {detailsOpen ? (
                    <section
                      className="terminal-manager-details"
                      aria-label={t("terminalManager.detailsSectionTitle")}
                    >
                      <div className="terminal-manager-detail-grid">
                        <div className="terminal-manager-detail-item terminal-manager-detail-item-wide">
                          <span>{t("terminalManager.commandPreviewLabel")}</span>
                          <strong>{buildTemplatePreview(template)}</strong>
                        </div>
                        <div className="terminal-manager-detail-item">
                          <span>{t("terminalManager.cwdLabel")}</span>
                          <strong>{template.cwd}</strong>
                        </div>
                        <div className="terminal-manager-detail-item">
                          <span>{t("terminal.runtimeField")}</span>
                          <strong>{getTerminalRuntimeLabel(template.runtimeType)}</strong>
                        </div>
                        <div className="terminal-manager-detail-item">
                          <span>{t("terminalManager.updatedAt")}</span>
                          <strong>{formatDate(template.updatedAt)}</strong>
                        </div>
                        <div className="terminal-manager-detail-item">
                          <span>{t("terminalManager.portLabel")}</span>
                          <strong>
                            {template.port === null ? t("terminalManager.portUnset") : template.port}
                          </strong>
                        </div>
                        {runtimeStatus?.processId ? (
                          <div className="terminal-manager-detail-item">
                            <span>{t("terminalManager.processIdLabel")}</span>
                            <strong>{runtimeStatus.processId}</strong>
                          </div>
                        ) : null}
                        {runtimeStatus?.processCommandLine ? (
                          <div className="terminal-manager-detail-item terminal-manager-detail-item-wide">
                            <span>{t("terminalManager.processCommandLabel")}</span>
                            <strong>{runtimeStatus.processCommandLine}</strong>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
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
          setSelectedRuntimeType("");
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

          <div className="field-group">
            <span>{t("terminal.runtimeField")}</span>
            <select
              value={selectedRuntimeType}
              onChange={(event) => {
                setSelectedRuntimeType(event.target.value as SelectableTerminalRuntimeType);
              }}
            >
              {runtimeOptions.map((option) => (
                <option key={option.value || "auto"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="status-text">
              {
                runtimeOptions.find((option) => option.value === selectedRuntimeType)?.description ??
                runtimeOptions[0]?.description
              }
            </p>
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
                setSelectedRuntimeType("");
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
