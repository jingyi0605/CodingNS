import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { DesktopModal } from "../../../components/DesktopModal";
import { ModalActions } from "../../../components/ModalAtoms";
import { MobileSheet } from "../../../components/MobileSheet";
import { getHostRequestUrl } from "../../../config/env";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import type { TerminalManagerRealtimeSnapshotDto } from "../../../network/workbench-realtime-client";
import { usePlatform } from "../../../platform/platform-provider";
import { useToast } from "../../../shared/toast";
import { ApiError } from "../../../shared/network/api-error";
import {
  buildScopedSnapshotKey,
  isSameTargetHostId,
  readSnapshotTargetHostId
} from "../utils/resource-scope";
import type { WorkspaceRef } from "../../conversation/api/conversation-api";
import {
  createTerminalTemplate,
  deleteTerminalTemplate,
  runTerminalTemplate,
  stopTerminalTemplateProcess,
  type TerminalShellOptionDto,
  type TerminalDto,
  type TerminalTemplateDto,
  type TerminalTemplateRuntimeStatusDto,
  updateTerminalTemplate
} from "../../terminal/api/terminal-api";
import {
  getTerminalRuntimeLabel,
  listTerminalRuntimeOptions,
  type SelectableTerminalRuntimeType
} from "../../terminal/runtime/terminal-runtime-meta";
import { isTmuxDependencyMissingError } from "../../terminal/runtime/terminal-runtime-errors";
import { TerminalRuntimeFallbackModal } from "../../terminal/components/TerminalRuntimeFallbackModal";
import { buildWorkspaceDebugPath } from "../utils/workbench-navigation";
import {
  type WorkspaceSessionGroup,
  useWorkbenchShell
} from "../../conversation/components/WorkbenchLayout";

interface TerminalManagerPanelProps {
  className?: string;
  currentWorkspaceId: string | null;
  requestWorkspaceId?: string | null;
  navigationGroups: WorkspaceSessionGroup[];
  externalWindowMode?: boolean;
  workbenchShellOverrides?: TerminalManagerPanelWorkbenchShellOverrides;
}

export interface TerminalManagerPanelWorkbenchShellOverrides {
  currentTargetHostId?: string | null;
  currentWorkspaceRef?: WorkspaceRef | null;
  subscribeTerminalManagerSnapshot?: (
    workspaceId: string,
    options?: { knownRevision?: string | null; targetHostId?: string | null; skipKnownRevision?: boolean }
  ) => void;
  requestTerminalManagerRefresh?: (
    workspaceId: string,
    options?: { knownRevision?: string | null; targetHostId?: string | null; skipKnownRevision?: boolean }
  ) => void;
  addTerminalManagerSnapshotListener?: (
    listener: (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  ) => () => void;
}

interface LaunchDraftState {
  mode: "command" | "script";
  name: string;
  cwd: string;
  target: string;
  args: string;
  port: string;
  proxyEnabled: boolean;
}

const INITIAL_LAUNCH_DRAFT: LaunchDraftState = {
  mode: "command",
  name: "",
  cwd: "",
  target: "",
  args: "",
  port: "",
  proxyEnabled: false
};
const TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS = 60 * 1000;

interface TerminalManagerSnapshot {
  revision?: string | null;
  terminals: TerminalDto[];
  templates: TerminalTemplateDto[];
  templateStatuses: TerminalTemplateRuntimeStatusDto[];
  shellOptions: TerminalShellOptionDto[];
}

interface TemplateRunFallbackDraft {
  templateId: string;
  shell?: string;
}

interface TemplateRemoveConfirmDraft {
  templateId: string;
  name: string;
  occupied: boolean;
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

function buildLaunchDraftFromTemplate(template: TerminalTemplateDto): LaunchDraftState {
  return {
    mode: detectTemplateMode(template),
    name: template.name,
    cwd: template.cwd,
    target: template.command,
    args: template.args.join(" "),
    port: template.port === null ? "" : String(template.port),
    proxyEnabled: template.proxyEnabled
  };
}

function buildTemplateProxyUrl(proxySlug: string): string {
  return getHostRequestUrl(`/proxy/${encodeURIComponent(proxySlug)}`);
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

function getTerminationScopeLabel(
  runtimeStatus: TerminalTemplateRuntimeStatusDto | null
): string | null {
  if (!runtimeStatus?.terminationScope) {
    return null;
  }

  return runtimeStatus.terminationScope === "process_group"
    ? t("terminalManager.terminationScopeProcessGroup")
    : t("terminalManager.terminationScopeProcess");
}

function TerminalManagerModal({
  open,
  mobile = false,
  title,
  description,
  onClose,
  children,
  className
}: {
  open: boolean;
  mobile?: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={title}
        description={description}
        kind="form"
        height="three-quarter"
        className={className}
        bodyClassName="terminal-manager-modal-body"
        showHandle
        onClose={onClose}
      >
        {children}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={title}
      description={description}
      size="regular"
      layout="form"
      className={["terminal-manager-modal-card", className].filter(Boolean).join(" ")}
      bodyClassName="terminal-manager-modal-body"
      onClose={onClose}
    >
      {children}
    </DesktopModal>
  );
}

function TerminalManagerConfirmModal({
  open,
  mobile = false,
  busy,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  className
}: {
  open: boolean;
  mobile?: boolean;
  busy: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const footer = (
    <ModalActions className="terminal-manager-confirm-actions">
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={onClose}
      >
        {t("common.cancel")}
      </button>
      <button
        type="button"
        className="secondary-button workbench-danger-button"
        disabled={busy}
        onClick={() => {
          void onConfirm();
        }}
      >
        {busy ? t("terminalManager.templateRemoving") : confirmLabel}
      </button>
    </ModalActions>
  );

  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={title}
        description={description}
        kind="action"
        height="auto"
        dismissible={!busy}
        showHandle
        showCancelButton={false}
        className={className}
        bodyClassName="terminal-manager-confirm-body"
        footer={footer}
        onClose={onClose}
      >
        {null}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={title}
      description={description}
      size="compact"
      layout="confirm"
      dismissible={!busy}
      className={["terminal-manager-confirm-modal", className].filter(Boolean).join(" ")}
      bodyClassName="terminal-manager-confirm-body"
      footer={footer}
      onClose={onClose}
    >
      {null}
    </DesktopModal>
  );
}

interface MobilePickerOption {
  value: string;
  label: string;
  description?: string | null;
  disabled?: boolean;
}

function TerminalManagerMobilePicker({
  label,
  value,
  options,
  open,
  onToggle,
  onChange
}: {
  label: string;
  value: string;
  options: MobilePickerOption[];
  open: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  return (
    <div className="field-group terminal-manager-mobile-picker">
      <span>{label}</span>
      <button
        type="button"
        className="terminal-manager-mobile-picker-trigger"
        aria-label={`${label} ${selectedOption?.label ?? ""}`.trim()}
        aria-expanded={open ? "true" : "false"}
        onClick={onToggle}
      >
        <span className="terminal-manager-mobile-picker-copy">
          <strong>{selectedOption?.label ?? t("common.unknown")}</strong>
          {selectedOption?.description ? <span>{selectedOption.description}</span> : null}
        </span>
        <ChevronDownIcon expanded={open} />
      </button>
      {open ? (
        <div className="terminal-manager-mobile-picker-list" role="listbox" aria-label={label}>
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value || "__empty__"}
                type="button"
                role="option"
                className="terminal-manager-mobile-picker-option"
                aria-selected={selected}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                }}
              >
                <span className="terminal-manager-mobile-picker-option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </span>
                <span className="terminal-manager-mobile-picker-option-indicator" aria-hidden="true">
                  {selected ? <CheckIcon /> : <ChevronRightIcon />}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ChevronDownIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="terminal-manager-mobile-picker-chevron"
      data-expanded={expanded ? "true" : "false"}
    >
      <path
        d="M4 6.5L8 10l4-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 3.5L10.5 8 6 12.5"
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
        d="M3.5 8.5L6.5 11.5L12.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function TerminalManagerPanel({
  className,
  currentWorkspaceId,
  requestWorkspaceId,
  navigationGroups,
  externalWindowMode = false,
  workbenchShellOverrides
}: TerminalManagerPanelProps) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const workbenchShell = useWorkbenchShell();
  const {
    subscribeTerminalManagerSnapshot,
    requestTerminalManagerRefresh,
    addTerminalManagerSnapshotListener,
    currentTargetHostId,
    currentWorkspaceRef
  } = {
    ...workbenchShell,
    ...workbenchShellOverrides
  };
  const activeWorkspaceId = currentWorkspaceId?.trim() || null;
  const activeRequestWorkspaceId =
    requestWorkspaceId?.trim()
    || (
      currentTargetHostId
        ? (
          currentWorkspaceRef?.hostId === currentTargetHostId
            ? currentWorkspaceRef.workspaceId?.trim() || null
            : null
        )
        : activeWorkspaceId
    )
    || null;
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [revision, setRevision] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TerminalTemplateDto[]>([]);
  const [templateStatuses, setTemplateStatuses] = useState<TerminalTemplateRuntimeStatusDto[]>([]);
  const [shellOptions, setShellOptions] = useState<TerminalShellOptionDto[]>([]);
  const [selectedShellId, setSelectedShellId] = useState("");
  const [selectedRuntimeType, setSelectedRuntimeType] =
    useState<SelectableTerminalRuntimeType>("");
  const [launchDraft, setLaunchDraft] = useState<LaunchDraftState>(INITIAL_LAUNCH_DRAFT);
  const [templateEditorMode, setTemplateEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [runningTemplateId, setRunningTemplateId] = useState<string | null>(null);
  const [stoppingTemplateId, setStoppingTemplateId] = useState<string | null>(null);
  const [removingTemplateId, setRemovingTemplateId] = useState<string | null>(null);
  const [removeConfirmDraft, setRemoveConfirmDraft] = useState<TemplateRemoveConfirmDraft | null>(
    null
  );
  const [runtimeFallbackDraft, setRuntimeFallbackDraft] = useState<TemplateRunFallbackDraft | null>(
    null
  );
  const [applyingRuntimeFallback, setApplyingRuntimeFallback] = useState(false);
  const [openMobilePicker, setOpenMobilePicker] = useState<"shell" | "runtime" | null>(null);
  const { showToast } = useToast();
  const isMobileProcessPanel = className?.includes("mobile-tool-process-panel") ?? false;
  const templateEditorOpen = templateEditorMode !== null;
  const editingTemplate =
    templateEditorMode === "edit"
      ? templates.find((template) => template.id === editingTemplateId) ?? null
      : null;
  const editingTemplateMode = templateEditorMode === "edit";

  useEffect(() => {
    logPerfDebug("terminal_manager.props", {
      currentWorkspaceId,
      requestWorkspaceId: activeRequestWorkspaceId,
      workspaceCount: navigationGroups.length,
      externalWindowMode
    });
  }, [activeRequestWorkspaceId, currentWorkspaceId, externalWindowMode, navigationGroups.length]);

  const selectedShellOption = useMemo(
    () => shellOptions.find((option) => option.id === selectedShellId) ?? null,
    [selectedShellId, shellOptions]
  );
  const runtimeOptions = useMemo(
    () => listTerminalRuntimeOptions(platform.ui.osFamily),
    [platform.ui.osFamily]
  );
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
    setSelectedShellId((current) => {
      if (!shellOptions.length) {
        return "";
      }

      if (current && shellOptions.some((option) => option.id === current)) {
        return current;
      }

      return pickDefaultShellId(shellOptions);
    });
  }, [shellOptions]);

  useEffect(() => {
    if (!templateEditorOpen || !activeRequestWorkspaceId || shellOptions.length > 0) {
      return;
    }

    requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId);
  }, [activeRequestWorkspaceId, shellOptions.length, templateEditorOpen]);

  useEffect(() => {
    if (!templateEditorOpen) {
      setOpenMobilePicker(null);
    }
  }, [templateEditorOpen]);

  useEffect(() => {
    if (templateEditorMode === "edit" && editingTemplateId && !editingTemplate) {
      setTemplateEditorMode(null);
      setEditingTemplateId(null);
      setLaunchDraft(INITIAL_LAUNCH_DRAFT);
      setSelectedRuntimeType("");
      setOpenMobilePicker(null);
    }
  }, [editingTemplate, editingTemplateId, templateEditorMode]);

  useEffect(() => {
    if (!removeConfirmDraft || removingTemplateId === removeConfirmDraft.templateId) {
      return;
    }

    if (!templates.some((template) => template.id === removeConfirmDraft.templateId)) {
      setRemoveConfirmDraft(null);
    }
  }, [removeConfirmDraft, removingTemplateId, templates]);

  useEffect(() => {
    if (!activeRequestWorkspaceId) {
      setTerminals([]);
      setRevision(null);
      setTemplates([]);
      setTemplateStatuses([]);
      setLoading(false);
      return;
    }

    const cachedSnapshot = readViewSnapshot<TerminalManagerSnapshot>(
      buildTerminalManagerSnapshotKey(activeRequestWorkspaceId, currentTargetHostId),
      TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    logPerfDebug("terminal_manager.snapshot", {
      workspaceId: activeRequestWorkspaceId,
      cached: Boolean(cachedSnapshot),
      cachedTemplateCount: cachedSnapshot?.templates.length ?? 0,
      cachedStatusCount: cachedSnapshot?.templateStatuses.length ?? 0
    });

    if (cachedSnapshot) {
      setTerminals(cachedSnapshot.terminals);
      setRevision(typeof cachedSnapshot.revision === "string" ? cachedSnapshot.revision : null);
      setTemplates(cachedSnapshot.templates);
      setTemplateStatuses(cachedSnapshot.templateStatuses);
      setShellOptions(cachedSnapshot.shellOptions ?? []);
      setLoading(false);
    } else {
      setTerminals([]);
      setRevision(null);
      setTemplates([]);
      setTemplateStatuses([]);
      setShellOptions([]);
      setLoading(true);
    }
  }, [activeRequestWorkspaceId, currentTargetHostId]);

  useEffect(() => {
    if (!activeRequestWorkspaceId) {
      return;
    }

    return addTerminalManagerSnapshotListener((snapshot) => {
      if (
        snapshot.workspaceId !== activeRequestWorkspaceId
        || !isSameTargetHostId(readSnapshotTargetHostId(snapshot), currentTargetHostId)
      ) {
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
  }, [activeRequestWorkspaceId, addTerminalManagerSnapshotListener, currentTargetHostId]);

  useEffect(() => {
    if (!activeRequestWorkspaceId) {
      return;
    }

    const cachedSnapshot = readViewSnapshot<TerminalManagerSnapshot>(
      buildTerminalManagerSnapshotKey(activeRequestWorkspaceId, currentTargetHostId),
      TERMINAL_MANAGER_SNAPSHOT_CACHE_MAX_AGE_MS
    );

    subscribeTerminalManagerSnapshot(activeRequestWorkspaceId, {
      knownRevision: cachedSnapshot?.revision ?? null,
      targetHostId: currentTargetHostId
    });

    requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId, {
      force: true,
      knownRevision: cachedSnapshot?.revision ?? null
    });
  }, [activeRequestWorkspaceId, currentTargetHostId, requestTerminalManagerRefresh, subscribeTerminalManagerSnapshot]);

  useEffect(() => {
    if (!activeRequestWorkspaceId) {
      return;
    }

    writeViewSnapshot<TerminalManagerSnapshot>(buildTerminalManagerSnapshotKey(activeRequestWorkspaceId, currentTargetHostId), {
      revision,
      terminals,
      templates,
      templateStatuses,
      shellOptions
    });
  }, [activeRequestWorkspaceId, currentTargetHostId, revision, shellOptions, templateStatuses, templates, terminals]);

  function applyTerminalManagerSnapshot(snapshot: TerminalManagerSnapshot) {
    setRevision(typeof snapshot.revision === "string" ? snapshot.revision : null);
    setTerminals(snapshot.terminals);
    setTemplates(snapshot.templates);
    setTemplateStatuses(snapshot.templateStatuses);
    setShellOptions(snapshot.shellOptions ?? []);
  }

  function requestTerminalManagerSnapshotRefresh(
    workspaceId: string,
    options: {
      force?: boolean;
      knownRevision?: string | null;
    } = {}
  ) {
    logPerfDebug("terminal_manager.refresh_requested", {
      workspaceId,
      force: options.force === true
    });
    requestTerminalManagerRefresh(workspaceId, {
      knownRevision: options.knownRevision ?? revision,
      skipKnownRevision: options.force === true,
      targetHostId: currentTargetHostId
    });
  }

  function closeTemplateEditor() {
    setTemplateEditorMode(null);
    setEditingTemplateId(null);
    setLaunchDraft(INITIAL_LAUNCH_DRAFT);
    setSelectedRuntimeType("");
    setOpenMobilePicker(null);
  }

  function openCreateTemplateEditor() {
    setEditingTemplateId(null);
    setLaunchDraft(INITIAL_LAUNCH_DRAFT);
    setSelectedRuntimeType("");
    setTemplateEditorMode("create");
  }

  function openEditTemplateEditor(template: TerminalTemplateDto) {
    setEditingTemplateId(template.id);
    setLaunchDraft(buildLaunchDraftFromTemplate(template));
    setSelectedRuntimeType((template.runtimeType as SelectableTerminalRuntimeType) ?? "");
    setTemplateEditorMode("edit");
  }

  async function handleStopTemplateProcess(templateId: string) {
    if (!activeRequestWorkspaceId) {
      return;
    }

    setStoppingTemplateId(templateId);

    try {
      await stopTerminalTemplateProcess(templateId, { targetHostId: currentTargetHostId });
      requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId);
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
    if (!activeRequestWorkspaceId || !launchDraft.target.trim()) {
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

    if (launchDraft.proxyEnabled && parsedPort === null) {
      showToast({
        title: t("terminalManager.proxyPortRequired"),
        tone: "error"
      });
      return;
    }

    setSavingTemplate(true);

    try {
      const payload = {
        workspaceId: activeRequestWorkspaceId,
        name: buildLaunchName(launchDraft),
        cwd: launchDraft.cwd.trim() || undefined,
        command: launchDraft.target.trim(),
        args: splitArgs(launchDraft.args),
        port: parsedPort,
        proxyEnabled: launchDraft.proxyEnabled,
        runtimeType: selectedRuntimeType || null
      };

      if (editingTemplateMode && editingTemplateId) {
        const updatedTemplate = await updateTerminalTemplate(editingTemplateId, payload, {
          targetHostId: currentTargetHostId
        });
        setTemplates((current) =>
          current.map((template) => (template.id === updatedTemplate.id ? updatedTemplate : template))
        );
      } else {
        await createTerminalTemplate(payload, { targetHostId: currentTargetHostId });
      }

      closeTemplateEditor();
      requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId);
      showToast({
        title: editingTemplateMode
          ? t("terminalManager.templateUpdateSuccess")
          : t("terminalManager.templateSaveSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title:
          error instanceof Error
            ? error.message
            : editingTemplateMode
              ? t("terminalManager.templateUpdateFailed")
              : t("terminalManager.templateSaveFailed"),
        tone: "error"
      });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleOpenProxyUrl(proxyUrl: string) {
    const result = await platform.bridge.openExternal(proxyUrl);

    if (!result.ok) {
      showToast({
        title: result.detail || t("terminalManager.openProxyUrlFailed"),
        tone: "error"
      });
    }
  }

  async function handleDeleteTemplate(
    template: TerminalTemplateDto,
    _runtimeStatus: TerminalTemplateRuntimeStatusDto | null
  ) {
    if (!activeRequestWorkspaceId) {
      return;
    }

    setRemovingTemplateId(template.id);

    try {
      await deleteTerminalTemplate(template.id, { targetHostId: currentTargetHostId });
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setTemplateStatuses((current) => current.filter((item) => item.templateId !== template.id));
      setExpandedTemplateIds((current) => current.filter((item) => item !== template.id));
      setRemoveConfirmDraft((current) => (current?.templateId === template.id ? null : current));

      if (editingTemplateId === template.id) {
        closeTemplateEditor();
      }

      requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId);
      showToast({
        title: t("terminalManager.templateDeleteSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("terminalManager.templateDeleteFailed"),
        tone: "error"
      });
    } finally {
      setRemovingTemplateId(null);
    }
  }

  async function handleRunTemplate(templateId: string) {
    if (!activeRequestWorkspaceId) {
      return;
    }

    const shell = selectedShellOption?.available ? selectedShellOption.shell : undefined;
    setRunningTemplateId(templateId);

    try {
      await runTerminalTemplate(templateId, {
        shell
      }, { targetHostId: currentTargetHostId });
      requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId);
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
    if (!activeRequestWorkspaceId || !runtimeFallbackDraft) {
      return;
    }

    setApplyingRuntimeFallback(true);

    try {
      await runTerminalTemplate(runtimeFallbackDraft.templateId, {
        shell: runtimeFallbackDraft.shell,
        runtimeType: "embedded-pty"
      }, { targetHostId: currentTargetHostId });
      setRuntimeFallbackDraft(null);
      requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId);
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

  if (!activeWorkspaceId || !activeRequestWorkspaceId) {
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
            className="secondary-button"
            type="button"
            disabled={!activeWorkspaceId}
            onClick={() => {
              if (activeWorkspaceId) {
                navigate(buildWorkspaceDebugPath(activeWorkspaceId, currentWorkspaceRef));
              }
            }}
          >
            {t("terminalManager.openWorkspaceDebugAction")}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={!activeRequestWorkspaceId || loading}
            onClick={() => {
              if (activeRequestWorkspaceId) {
                requestTerminalManagerSnapshotRefresh(activeRequestWorkspaceId, {
                  force: true
                });
              }
            }}
          >
            {t("terminalManager.refresh")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!activeRequestWorkspaceId}
            onClick={() => {
              openCreateTemplateEditor();
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
              const terminationScopeLabel = getTerminationScopeLabel(runtimeStatus);
              const detailsOpen = expandedTemplateIds.includes(template.id);
              const detailButtonLabel = detailsOpen
                ? t("terminalManager.hideDetailsAction")
                : t("terminalManager.showDetailsAction");
              const proxyUrl =
                template.proxyEnabled && template.proxySlug
                  ? buildTemplateProxyUrl(template.proxySlug)
                  : null;

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
                          {getTerminalRuntimeLabel(template.runtimeType, platform.ui.osFamily)}
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
                      {runtimeStatus?.occupied && runtimeStatus.processGroupId ? (
                        <span className="badge">{`PGID ${runtimeStatus.processGroupId}`}</span>
                      ) : null}
                      {template.proxyEnabled ? (
                        <span className="badge">{t("terminalManager.proxyEnabled")}</span>
                      ) : null}
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
                      <strong>{getTerminalRuntimeLabel(template.runtimeType, platform.ui.osFamily)}</strong>
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
                        <div className="terminal-manager-detail-item terminal-manager-detail-item-wide">
                          <span>{t("terminalManager.proxyField")}</span>
                          <strong>
                            {proxyUrl ?? t("terminalManager.proxyDisabledDescription")}
                          </strong>
                        </div>
                        {runtimeStatus?.processId ? (
                          <div className="terminal-manager-detail-item">
                            <span>{t("terminalManager.processIdLabel")}</span>
                            <strong>{runtimeStatus.processId}</strong>
                          </div>
                        ) : null}
                        {runtimeStatus?.processGroupId ? (
                          <div className="terminal-manager-detail-item">
                            <span>{t("terminalManager.processGroupIdLabel")}</span>
                            <strong>{runtimeStatus.processGroupId}</strong>
                          </div>
                        ) : null}
                        {terminationScopeLabel ? (
                          <div className="terminal-manager-detail-item">
                            <span>{t("terminalManager.terminationScopeLabel")}</span>
                            <strong>{terminationScopeLabel}</strong>
                          </div>
                        ) : null}
                        {runtimeStatus?.parentProcessId ? (
                          <div className="terminal-manager-detail-item">
                            <span>{t("terminalManager.parentProcessIdLabel")}</span>
                            <strong>{runtimeStatus.parentProcessId}</strong>
                          </div>
                        ) : null}
                        {runtimeStatus?.processCommandLine ? (
                          <div className="terminal-manager-detail-item terminal-manager-detail-item-wide">
                            <span>{t("terminalManager.processCommandLabel")}</span>
                            <strong>{runtimeStatus.processCommandLine}</strong>
                          </div>
                        ) : null}
                        {runtimeStatus?.parentProcessCommandLine ? (
                          <div className="terminal-manager-detail-item terminal-manager-detail-item-wide">
                            <span>{t("terminalManager.parentProcessCommandLabel")}</span>
                            <strong>{runtimeStatus.parentProcessCommandLine}</strong>
                          </div>
                        ) : null}
                      </div>
                      <div className="terminal-manager-actions terminal-manager-detail-actions">
                        {proxyUrl ? (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => {
                              void handleOpenProxyUrl(proxyUrl);
                            }}
                          >
                            {t("terminalManager.openProxyUrlAction")}
                          </button>
                        ) : null}
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={savingTemplate || removingTemplateId === template.id}
                          onClick={() => {
                            openEditTemplateEditor(template);
                          }}
                        >
                          {t("terminalManager.editAction")}
                        </button>
                        <button
                          className="secondary-button workbench-danger-button"
                          type="button"
                          disabled={removingTemplateId === template.id}
                          onClick={() => {
                            setRemoveConfirmDraft({
                              templateId: template.id,
                              name: template.name,
                              occupied: Boolean(runtimeStatus?.occupied)
                            });
                          }}
                        >
                          {removingTemplateId === template.id
                            ? t("terminalManager.templateRemoving")
                            : t("terminalManager.removeAction")}
                        </button>
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
        open={templateEditorOpen}
        mobile={isMobileProcessPanel}
        title={
          editingTemplateMode
            ? t("terminalManager.editModalTitle")
            : t("terminalManager.createModalTitle")
        }
        description={
          editingTemplateMode
            ? t("terminalManager.editModalDescription")
            : t("terminalManager.createModalDescription")
        }
        className={isMobileProcessPanel ? "terminal-manager-mobile-modal" : undefined}
        onClose={closeTemplateEditor}
      >
        <section className="terminal-manager-modal-form">
          {isMobileProcessPanel ? (
            <>
              <TerminalManagerMobilePicker
                label={t("terminalManager.shellField")}
                value={selectedShellId}
                open={openMobilePicker === "shell"}
                options={shellOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                  description: option.available ? null : option.unavailableReason ?? t("terminalManager.shellUnavailable"),
                  disabled: !option.available
                }))}
                onToggle={() => {
                  setOpenMobilePicker((current) => (current === "shell" ? null : "shell"));
                }}
                onChange={(value) => {
                  setSelectedShellId(value);
                  setOpenMobilePicker(null);
                }}
              />
              {selectedShellOption?.available === false && selectedShellOption.unavailableReason ? (
                <p className="status-text">{selectedShellOption.unavailableReason}</p>
              ) : null}

              <TerminalManagerMobilePicker
                label={t("terminal.runtimeField")}
                value={selectedRuntimeType}
                open={openMobilePicker === "runtime"}
                options={runtimeOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: option.description
                }))}
                onToggle={() => {
                  setOpenMobilePicker((current) => (current === "runtime" ? null : "runtime"));
                }}
                onChange={(value) => {
                  setSelectedRuntimeType(value as SelectableTerminalRuntimeType);
                  setOpenMobilePicker(null);
                }}
              />
              <p className="status-text">
                {
                  runtimeOptions.find((option) => option.value === selectedRuntimeType)?.description ??
                  runtimeOptions[0]?.description
                }
              </p>
            </>
          ) : (
            <>
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
            </>
          )}

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
            <div className="field-group terminal-manager-proxy-field">
              <span>{t("terminalManager.proxyField")}</span>
              <div className="terminal-manager-proxy-control">
                <span>{t("terminalManager.proxyToggleLabel")}</span>
                <label className="terminal-manager-proxy-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={t("terminalManager.proxyField")}
                    checked={launchDraft.proxyEnabled}
                    onChange={(event) => {
                      setLaunchDraft((current) => ({
                        ...current,
                        proxyEnabled: event.target.checked
                      }));
                    }}
                  />
                  <span className="terminal-manager-proxy-track" aria-hidden="true">
                    <span className="terminal-manager-proxy-thumb" />
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="terminal-manager-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={closeTemplateEditor}
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
                ? editingTemplateMode
                  ? t("terminalManager.templateUpdating")
                  : t("terminalManager.templateSaving")
                : editingTemplateMode
                  ? t("terminalManager.saveTemplateChangesAction")
                  : t("terminalManager.saveLaunchAction")}
            </button>
          </div>
        </section>
      </TerminalManagerModal>

      <TerminalManagerConfirmModal
        open={removeConfirmDraft !== null}
        mobile={isMobileProcessPanel}
        busy={removeConfirmDraft !== null && removingTemplateId === removeConfirmDraft.templateId}
        title={t("terminalManager.removeConfirmTitle")}
        description={
          removeConfirmDraft
            ? t(
                removeConfirmDraft.occupied
                  ? "terminalManager.removeRunningConfirmTarget"
                  : "terminalManager.removeConfirmTarget",
                {
                  name: removeConfirmDraft.name
                }
              )
            : ""
        }
        confirmLabel={t("terminalManager.removeConfirmAction")}
        className={isMobileProcessPanel ? "terminal-manager-mobile-modal" : "terminal-manager-confirm-modal"}
        onClose={() => {
          if (removingTemplateId) {
            return;
          }

          setRemoveConfirmDraft(null);
        }}
        onConfirm={() => {
          if (!removeConfirmDraft) {
            return;
          }

          const template = templates.find((item) => item.id === removeConfirmDraft.templateId);

          if (!template) {
            setRemoveConfirmDraft(null);
            return;
          }

          const runtimeStatus = getTemplateRuntimeStatus(runtimeStatusByTemplateId, template.id);
          void handleDeleteTemplate(template, runtimeStatus);
        }}
      />
    </section>
  );
}

function buildTerminalManagerSnapshotKey(workspaceId: string, targetHostId?: string | null) {
  return buildScopedSnapshotKey("terminal-manager.snapshot", {
    workspaceId,
    targetHostId
  });
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return fallback;
}
