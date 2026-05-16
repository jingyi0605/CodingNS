import { Fragment, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { ModalCloseButton } from "../components/ModalCloseButton";
import type {
  AssistantRuntimeSkillOverviewItemDto,
  ManagedSkillOverviewItemDto,
  SkillScope,
  SkillOverviewDto,
  SkillScanDiagnosticDto,
  SkillScanEntryDto,
  SkillTargetBindingDto,
  SkillTargetCli,
  WorkspaceSessionMcpStatusDto
} from "../features/settings/api/skills-api";
import {
  addSkillFromMarkdown,
  fetchSkillOverview,
  fetchWorkspaceSessionMcpStatus,
  importSkillEntry,
  syncManagedSkillTargets
} from "../features/settings/api/skills-api";
import type {
  DocumentTemplateDto,
  OfficeTaskDetailDto,
  OfficeTaskDto,
  OfficeTaskStatus,
  OpsTargetDto,
  OpsTargetKind,
  OpsTargetStatus
} from "../features/settings/api/office-capability-api";
import {
  ModalActions,
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection
} from "../components/ModalAtoms";
import {
  createDocumentTemplate,
  createOpsTarget,
  fetchDocumentTemplates,
  fetchOfficeTaskDetail,
  fetchOfficeTasks,
  fetchOpsTargets,
  importDocumentTemplateFile,
  replyOfficeApproval,
  updateDocumentTemplate,
  updateOpsTarget
} from "../features/settings/api/office-capability-api";
import type { ProviderCatalogEntryDto } from "../features/conversation/api/conversation-api";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { useProviderCatalog } from "../features/conversation/capability/provider-catalog-store";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import {
  OpenCliManagementPanel,
  type OpenCliManagementToolbarState
} from "./OpenCliManagementPanel";

type PendingActionKey = string | null;
type SkillManagementTabId = "skills" | "office" | "ops" | "opencli";

interface SkillManagementPanelProps {
  readonly triggerClassName?: string;
  readonly triggerLabel?: string;
  readonly triggerLeading?: ReactNode;
  readonly workspaceId?: string | null;
  readonly sessionId?: string | null;
}

type SkillUploadSourceMode = "file" | "paste";

const SKILL_MANAGEMENT_TABS: ReadonlyArray<{ id: SkillManagementTabId }> = [
  { id: "skills" },
  { id: "office" },
  { id: "ops" },
  { id: "opencli" }
];

export function SkillManagementPanel({
  triggerClassName = "secondary-button",
  triggerLabel,
  triggerLeading,
  workspaceId = null,
  sessionId = null
}: SkillManagementPanelProps) {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const templateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [overview, setOverview] = useState<SkillOverviewDto | null>(null);
  const [documentTemplates, setDocumentTemplates] = useState<DocumentTemplateDto[]>([]);
  const [opsTasks, setOpsTasks] = useState<OfficeTaskDto[]>([]);
  const [opsTargets, setOpsTargets] = useState<OpsTargetDto[]>([]);
  const [selectedOpsTaskDetail, setSelectedOpsTaskDetail] = useState<OfficeTaskDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<PendingActionKey>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [officeTemplateModalOpen, setOfficeTemplateModalOpen] = useState(false);
  const [opsTargetModalOpen, setOpsTargetModalOpen] = useState(false);
  const [workspaceSessionMcpModalOpen, setWorkspaceSessionMcpModalOpen] = useState(false);
  const [workspaceSessionMcpStatus, setWorkspaceSessionMcpStatus] = useState<WorkspaceSessionMcpStatusDto | null>(null);
  const [workspaceSessionMcpLoading, setWorkspaceSessionMcpLoading] = useState(false);
  const [uploadDraft, setUploadDraft] = useState<SkillUploadDraft | null>(null);
  const [uploadSourceMode, setUploadSourceMode] = useState<SkillUploadSourceMode>("file");
  const [uploadScope, setUploadScope] = useState<SkillScope>("workspace");
  const [pastedMarkdown, setPastedMarkdown] = useState("");
  const [uploadTargets, setUploadTargets] = useState<Record<SkillTargetCli, boolean>>(() =>
    createDefaultUploadTargets("workspace")
  );
  const [activeTab, setActiveTab] = useState<SkillManagementTabId>("skills");
  const [openCliToolbarState, setOpenCliToolbarState] = useState<OpenCliManagementToolbarState | null>(null);
  const [opsTaskStatusFilter, setOpsTaskStatusFilter] = useState<OfficeTaskStatus | "all">("all");
  const [opsTargetKindFilter, setOpsTargetKindFilter] = useState<OpsTargetKind | "all">("ssh_host");
  const [officeTemplateDraft, setOfficeTemplateDraft] = useState<{
    fileName: string;
    fileContentBase64: string;
  }>({
    fileName: "",
    fileContentBase64: ""
  });
  const [opsTargetDraft, setOpsTargetDraft] = useState<{
    targetId: string | null;
    displayName: string;
    environment: string;
    host: string;
    port: string;
    username: string;
    privateKeyPath: string;
    knownHostsPath: string;
    jumpHost: string;
    workspacePath: string;
    credentialRef: string;
    strictHostKeyChecking: "accept-new" | "yes" | "no";
    status: OpsTargetStatus;
  }>({
    targetId: null,
    displayName: "",
    environment: "",
    host: "",
    port: "22",
    username: "",
    privateKeyPath: "",
    knownHostsPath: "",
    jumpHost: "",
    workspacePath: "",
    credentialRef: "",
    strictHostKeyChecking: "accept-new",
    status: "active"
  });
  const tabsBaseId = useId();
  const providerCatalogState = useProviderCatalog(modalOpen && Boolean(accessToken));
  const providerCatalogItems = providerCatalogState.items ?? [];
  const providerCatalogByTargetCli = useMemo(
    () => buildSkillTargetCatalogMap(providerCatalogItems),
    [providerCatalogItems]
  );

  useEffect(() => {
    let active = true;

    if (!modalOpen) {
      return;
    }

    if (!accessToken) {
      setOverview(null);
      setPanelError(null);
      setStatusText(null);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);

      try {
        const [nextOverview, nextTemplates, nextOpsTasks, nextOpsTargets] = await Promise.all([
          fetchSkillOverview(),
          fetchDocumentTemplates("active"),
          fetchOfficeTasks({
            workspaceId,
            taskType: "ops",
            limit: 20
          }),
          fetchOpsTargets({
            workspaceId,
            kind: "ssh_host"
          })
        ]);

        if (!active) {
          return;
        }

        setOverview(nextOverview);
        setDocumentTemplates(nextTemplates);
        setOpsTasks(nextOpsTasks);
        setOpsTargets(nextOpsTargets);
        setSelectedOpsTaskDetail(null);
        setPanelError(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setPanelError(resolveSkillPanelError(error));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [accessToken, modalOpen, workspaceId]);

  async function reloadPanelData(): Promise<void> {
    const [nextOverview, nextTemplates, nextOpsTasks, nextOpsTargets] = await Promise.all([
      fetchSkillOverview(),
      fetchDocumentTemplates("active"),
      fetchOfficeTasks({
        workspaceId,
        taskType: "ops",
        status: opsTaskStatusFilter === "all" ? undefined : opsTaskStatusFilter,
        limit: 20
      }),
      fetchOpsTargets({
        workspaceId,
        kind: opsTargetKindFilter === "all" ? undefined : opsTargetKindFilter
      })
    ]);
    setOverview(nextOverview);
    setDocumentTemplates(nextTemplates);
    setOpsTasks(nextOpsTasks);
    setOpsTargets(nextOpsTargets);
    setPanelError(null);
  }

  async function handleRefresh(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey("refresh");
    setPanelError(null);
    setStatusText(null);

    try {
      await reloadPanelData();
      setStatusText(t("settings.skillRefreshSuccess"));
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleOfficeTemplateSubmit(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey("office-template-submit");
    setPanelError(null);
    setStatusText(null);

    try {
      await importDocumentTemplateFile({
        fileName: officeTemplateDraft.fileName,
        fileContentBase64: officeTemplateDraft.fileContentBase64
      });

      setOfficeTemplateDraft(createDefaultOfficeTemplateDraft());
      setOfficeTemplateModalOpen(false);
      setStatusText(t("settings.skillOfficeTemplateImported"));
      await reloadPanelData();
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleOpenOpsTask(taskId: string): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey(`ops-task-detail:${taskId}`);
    setPanelError(null);

    try {
      const detail = await fetchOfficeTaskDetail(taskId);
      setSelectedOpsTaskDetail(detail);
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleReplyOpsApproval(approvalId: string, status: "approved" | "rejected"): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey(`ops-approval:${approvalId}:${status}`);
    setPanelError(null);

    try {
      await replyOfficeApproval(approvalId, {
        status,
        decisionNote: status === "approved"
          ? t("settings.skillOpsApprovalApproveNote")
          : t("settings.skillOpsApprovalRejectNote")
      });

      if (selectedOpsTaskDetail) {
        const detail = await fetchOfficeTaskDetail(selectedOpsTaskDetail.task.id);
        setSelectedOpsTaskDetail(detail);
      }
      await reloadPanelData();
      setStatusText(
        status === "approved"
          ? t("settings.skillOpsApprovalApproved")
          : t("settings.skillOpsApprovalRejected")
      );
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleOpsTargetSubmit(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey("ops-target-submit");
    setPanelError(null);
    setStatusText(null);

    try {
      const payload = {
        workspaceId,
        kind: "ssh_host" as const,
        displayName: opsTargetDraft.displayName.trim(),
        environment: opsTargetDraft.environment.trim() || null,
        credentialRef: opsTargetDraft.credentialRef.trim() || null,
        status: opsTargetDraft.status,
        config: {
          host: opsTargetDraft.host.trim(),
          port: Number.parseInt(opsTargetDraft.port, 10) || 22,
          username: opsTargetDraft.username.trim(),
          privateKeyPath: opsTargetDraft.privateKeyPath.trim() || undefined,
          knownHostsPath: opsTargetDraft.knownHostsPath.trim() || undefined,
          jumpHost: opsTargetDraft.jumpHost.trim() || undefined,
          workspacePath: opsTargetDraft.workspacePath.trim() || undefined,
          strictHostKeyChecking: opsTargetDraft.strictHostKeyChecking
        }
      };

      if (opsTargetDraft.targetId) {
        await updateOpsTarget(opsTargetDraft.targetId, payload);
        setStatusText(t("settings.skillOpsTargetUpdated"));
      } else {
        await createOpsTarget(payload);
        setStatusText(t("settings.skillOpsTargetCreated"));
      }

      setOpsTargetDraft(createDefaultOpsTargetDraft());
      setOpsTargetModalOpen(false);
      await reloadPanelData();
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleOpenWorkspaceSessionMcpStatus(): Promise<void> {
    if (!accessToken || !workspaceId?.trim()) {
      return;
    }

    setWorkspaceSessionMcpModalOpen(true);
    setWorkspaceSessionMcpLoading(true);
    setPanelError(null);

    try {
      const status = await fetchWorkspaceSessionMcpStatus({
        workspaceId,
        sessionId
      });
      setWorkspaceSessionMcpStatus(status);
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
      setWorkspaceSessionMcpStatus(null);
    } finally {
      setWorkspaceSessionMcpLoading(false);
    }
  }

  function handleEditOpsTarget(target: OpsTargetDto): void {
    const config = parseOpsTargetConfig(target.configJson);
    setOpsTargetDraft({
      targetId: target.id,
      displayName: target.displayName,
      environment: target.environment ?? "",
      host: readConfigString(config.host),
      port: readConfigNumber(config.port, 22),
      username: readConfigString(config.username),
      privateKeyPath: readConfigString(config.privateKeyPath),
      knownHostsPath: readConfigString(config.knownHostsPath),
      jumpHost: readConfigString(config.jumpHost),
      workspacePath: readConfigString(config.workspacePath),
      credentialRef: target.credentialRef ?? "",
      strictHostKeyChecking: readStrictHostKeyChecking(config.strictHostKeyChecking),
      status: target.status
    });
    setOpsTargetModalOpen(true);
  }

  function handleResetOpsTargetDraft(): void {
    setOpsTargetDraft(createDefaultOpsTargetDraft());
  }

  function handleEditOfficeTemplate(template: DocumentTemplateDto): void {
    void template;
  }

  async function handleOfficeTemplateFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setPanelError(null);
    setStatusText(null);

    try {
      setOfficeTemplateDraft({
        fileName: file.name,
        fileContentBase64: await readFileAsBase64(file)
      });
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    }
  }

  function openOfficeTemplateModal(): void {
    setOfficeTemplateDraft(createDefaultOfficeTemplateDraft());
    setOfficeTemplateModalOpen(true);
    setPanelError(null);
  }

  function openOpsTargetModal(): void {
    setOpsTargetDraft(createDefaultOpsTargetDraft());
    setOpsTargetModalOpen(true);
    setPanelError(null);
  }

  async function handleImport(entry: SkillScanEntryDto): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey(buildImportActionKey(entry));
    setPanelError(null);
    setStatusText(null);

    try {
      await importSkillEntry({
        targetCli: entry.targetCli,
        directoryPath: entry.directoryPath,
        expectedContentHash: entry.contentHash
      });
      await reloadPanelData();
      setStatusText(
        t("settings.skillImportSuccess", {
          name: entry.name,
          target: resolveTargetCliLabel(entry.targetCli)
        })
      );
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleSync(item: ManagedSkillOverviewItemDto): Promise<void> {
    if (!accessToken) {
      return;
    }

    const targetCli = item.bindings
      .filter((binding) => binding.enabled)
      .map((binding) => binding.targetCli)
      .filter((target) => isSkillTargetProviderEnabled(target, providerCatalogByTargetCli));

    if (targetCli.length === 0) {
      setPanelError(resolveSkillSyncTargetError(item.bindings, providerCatalogByTargetCli));
      return;
    }

    setPendingActionKey(buildSyncActionKey(item.skill.id));
    setPanelError(null);
    setStatusText(null);

    try {
      await syncManagedSkillTargets({
        skillId: item.skill.id,
        targetCli
      });
      await reloadPanelData();
      setStatusText(
        t("settings.skillSyncSuccess", {
          name: item.skill.name
        })
      );
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleUploadFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setPanelError(null);
    setStatusText(null);

    try {
      const markdownContent = await readTextFromFile(file);
      const draft = prepareSkillUploadDraft(file.name, markdownContent);

      setUploadDraft(draft);
      setUploadTargets(createDefaultUploadTargets(uploadScope, providerCatalogByTargetCli));
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    }
  }

  async function handleUploadSubmit(): Promise<void> {
    const currentUploadDraft = resolveCurrentUploadDraft({
      sourceMode: uploadSourceMode,
      fileDraft: uploadDraft,
      pastedMarkdown
    });

    if (!accessToken) {
      return;
    }

    if (!currentUploadDraft) {
      setPanelError(
        uploadSourceMode === "paste"
          ? t("settings.skillPasteEmpty")
          : t("settings.skillUploadEmpty")
      );
      return;
    }

    const normalizedDirectoryName = currentUploadDraft.directoryName;

    if (!normalizedDirectoryName) {
      setPanelError(t("settings.skillUploadDirectoryInvalid"));
      return;
    }

    const selectedTargets = getUploadTargetOptions(uploadScope)
      .filter((targetCli) => uploadTargets[targetCli])
      .filter((targetCli) => isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli))
      .map((targetCli) => targetCli);

    if (selectedTargets.length === 0) {
      setPanelError(resolveSkillUploadTargetError(uploadScope, providerCatalogByTargetCli));
      return;
    }

    setPendingActionKey("upload");
    setPanelError(null);
    setStatusText(null);

    try {
      await addSkillFromMarkdown({
        markdownContent: currentUploadDraft.rawContent,
        scope: uploadScope,
        fileName: currentUploadDraft.fileName,
        directoryName: normalizedDirectoryName,
        targetCli: selectedTargets
      });
      await reloadPanelData();
      setStatusText(
        t("settings.skillUploadSuccess", {
          name: normalizedDirectoryName
        })
      );
      resetUploadComposer(uploadScope);
      setCreateModalOpen(false);
    } catch (error) {
      setPanelError(resolveSkillPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  function handleUploadScopeChange(scope: SkillScope): void {
    setUploadScope(scope);
    setUploadTargets(createDefaultUploadTargets(scope, providerCatalogByTargetCli));
  }

  function handleUploadSourceModeChange(mode: SkillUploadSourceMode): void {
    setUploadSourceMode(mode);
    setUploadDraft(null);
    setPastedMarkdown("");
    setUploadTargets(createDefaultUploadTargets(uploadScope, providerCatalogByTargetCli));
    setPanelError(null);
  }

  function handleUploadTargetToggle(targetCli: SkillTargetCli): void {
    if (!isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)) {
      return;
    }

    setUploadTargets((current) => ({
      ...current,
      [targetCli]: !current[targetCli]
    }));
  }

  function openCreateModal(): void {
    setCreateModalOpen(true);
    setPanelError(null);
    resetUploadComposer(uploadScope);
  }

  function closeCreateModal(): void {
    setCreateModalOpen(false);
    setPanelError(null);
    resetUploadComposer(uploadScope);
  }

  function resetUploadComposer(scope: SkillScope): void {
    setUploadDraft(null);
    setPastedMarkdown("");
    setUploadSourceMode("file");
    setUploadTargets(createDefaultUploadTargets(scope, providerCatalogByTargetCli));
  }

  const summary = overview?.summary ?? {
    managedSkillCount: 0,
    managedEntryCount: 0,
    unmanagedEntryCount: 0,
    conflictedEntryCount: 0,
    diagnosticCount: 0
  };
  const assistantRuntimeItems = buildAssistantRuntimeItems(
    overview?.assistantRuntimeSkills ?? [],
    overview?.conflictedEntries ?? [],
    overview?.diagnostics ?? []
  );
  const visibleConflictedEntries = (overview?.conflictedEntries ?? []).filter(
    (entry) => !isAssistantRuntimeEntry(entry, overview?.diagnostics ?? [])
  );
  const visibleDiagnostics = (overview?.diagnostics ?? []).filter(
    (diagnostic) => !isAssistantRuntimeDiagnostic(diagnostic)
  );
  const currentUploadDraft = resolveCurrentUploadDraft({
    sourceMode: uploadSourceMode,
    fileDraft: uploadDraft,
    pastedMarkdown
  });
  const resolvedTriggerLabel = triggerLabel ?? t("settings.skillManageAction");
  const skillTabSelected = activeTab === "skills";
  const officeTabSelected = activeTab === "office";
  const opsTabSelected = activeTab === "ops";
  const openCliTabSelected = activeTab === "opencli";

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        data-open={modalOpen ? "true" : "false"}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
        onClick={() => {
          setActiveTab("skills");
          setModalOpen(true);
        }}
      >
        {triggerLeading}
        <span>{resolvedTriggerLabel}</span>
      </button>

      <WorkbenchModal
        open={modalOpen}
        title={t("settings.skillConfigModalTitle")}
        hideHeader
        className="settings-skill-modal"
        onClose={() => {
          setActiveTab("skills");
          setModalOpen(false);
        }}
      >
        <div className="settings-skill-modal-topbar">
          <div className="settings-skill-modal-topbar-main">
            <div
              className="settings-model-tabs settings-skill-tabs"
              role="tablist"
              aria-label={t("settings.skillConfigTabsLabel")}
            >
              {SKILL_MANAGEMENT_TABS.map((tab) => {
                const selected = activeTab === tab.id;
                const tabId = `${tabsBaseId}-${tab.id}-tab`;
                const panelId = `${tabsBaseId}-${tab.id}-panel`;

                return (
                  <button
                    key={tab.id}
                    id={tabId}
                    type="button"
                    role="tab"
                    className="settings-model-tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    data-active={selected ? "true" : "false"}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {resolveSkillManagementTabLabel(tab.id)}
                  </button>
                );
              })}
            </div>

            {skillTabSelected ? (
              <div className="settings-skill-modal-actions settings-skill-page-toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!accessToken || loading || pendingActionKey !== null}
                  onClick={openCreateModal}
                >
                  {t("settings.skillCreateAction")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!accessToken || loading || pendingActionKey !== null}
                  onClick={() => {
                    void handleRefresh();
                  }}
                >
                  {pendingActionKey === "refresh" ? t("common.loading") : t("settings.skillRefresh")}
                </button>
              </div>
            ) : null}

            {officeTabSelected ? (
              <div className="settings-skill-modal-actions settings-skill-page-toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!accessToken || loading || pendingActionKey !== null}
                  onClick={openOfficeTemplateModal}
                >
                  {t("settings.skillOfficeTemplateOpenCreateAction")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!accessToken || loading || pendingActionKey !== null}
                  onClick={() => {
                    void handleRefresh();
                  }}
                >
                  {pendingActionKey === "refresh" ? t("common.loading") : t("settings.skillRefresh")}
                </button>
              </div>
            ) : null}

            {opsTabSelected ? (
              <div className="settings-skill-modal-actions settings-skill-page-toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!accessToken || loading || pendingActionKey !== null}
                  onClick={openOpsTargetModal}
                >
                  {t("settings.skillOpsTargetOpenCreateAction")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!accessToken || loading || pendingActionKey !== null}
                  onClick={() => {
                    void handleRefresh();
                  }}
                >
                  {pendingActionKey === "refresh" ? t("common.loading") : t("settings.skillRefresh")}
                </button>
              </div>
            ) : null}

            {openCliTabSelected && openCliToolbarState ? (
              <div className="settings-skill-modal-actions settings-skill-page-toolbar settings-opencli-toolbar">
                <label className="settings-opencli-checkbox settings-opencli-toolbar-toggle">
                  <input
                    aria-label={t("settings.opencliProviderToggleLabel")}
                    type="checkbox"
                    checked={openCliToolbarState.draftEnabled}
                    disabled={openCliToolbarState.enableDisabled}
                    onChange={(event) => openCliToolbarState.onEnabledChange(event.target.checked)}
                  />
                  <span>{t("settings.opencliEnableAction")}</span>
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={openCliToolbarState.refreshDisabled}
                  onClick={openCliToolbarState.onRefresh}
                >
                  {openCliToolbarState.refreshing
                    ? t("common.loading")
                    : t("settings.opencliRefreshAction")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={openCliToolbarState.detailDisabled}
                  onClick={openCliToolbarState.onShowDetails}
                >
                  {t("settings.opencliDetailAction")}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={openCliToolbarState.saveDisabled}
                  onClick={openCliToolbarState.onSave}
                >
                  {openCliToolbarState.saving
                    ? t("common.loading")
                    : t("settings.opencliSaveAction")}
                </button>
              </div>
            ) : null}
          </div>

          <ModalCloseButton
            onClick={() => {
              setActiveTab("skills");
              setModalOpen(false);
            }}
          />
        </div>

        {skillTabSelected ? (
          <div
            id={`${tabsBaseId}-skills-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsBaseId}-skills-tab`}
            className="settings-skill-panel"
          >
            <section className="settings-skill-summary-block">
              <div className="settings-skill-summary-grid">
                <SummaryCard
                  label={t("settings.skillSummaryManagedSkills")}
                  value={String(summary.managedSkillCount)}
                />
                <SummaryCard
                  label={t("settings.skillSummaryManagedEntries")}
                  value={String(summary.managedEntryCount)}
                />
                <SummaryCard
                  label={t("settings.skillSummaryConflictedEntries")}
                  value={String(visibleConflictedEntries.length)}
                />
                <SummaryCard
                  label={t("settings.skillSummaryDiagnostics")}
                  value={String(visibleDiagnostics.length)}
                />
              </div>

              <div className="settings-release-meta">
                <span>
                  {t("settings.skillScannedAt")}: {loading ? t("common.loading") : formatDateTime(overview?.scannedAt)}
                </span>
              </div>

              {statusText ? <p className="settings-release-status">{statusText}</p> : null}
              {panelError ? <p className="settings-release-status">{panelError}</p> : null}
            </section>

            <SkillSection
              title={t("settings.skillManagedListTitle")}
              emptyText={t("settings.skillManagedEmpty")}
              items={overview?.managedSkills ?? []}
              renderItem={(item) => {
                const actionKey = buildSyncActionKey(item.skill.id);

                return (
                  <div key={item.skill.id} className="settings-skill-entry">
                    <div className="settings-skill-entry-main">
                      <strong className="settings-skill-entry-title">{item.skill.name}</strong>
                      <p className="settings-skill-entry-meta">{resolveManagedSkillDescription(item.bindings)}</p>
                      <div className="settings-skill-tags">
                        {item.bindings.map((binding) => (
                          <span
                            key={`${item.skill.id}-${binding.targetCli}`}
                            className="settings-skill-tag"
                            data-status={resolveBindingTagStatus(binding, providerCatalogByTargetCli)}
                          >
                            {resolveBindingTagLabel(binding, providerCatalogByTargetCli)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="settings-skill-entry-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={
                          loading
                          || pendingActionKey !== null
                          || !canSyncManagedSkill(item.bindings, providerCatalogByTargetCli)
                        }
                        onClick={() => {
                          void handleSync(item);
                        }}
                      >
                        {pendingActionKey === actionKey ? t("common.loading") : t("settings.skillSyncAction")}
                      </button>
                    </div>
                  </div>
                );
              }}
            />

            <SkillSection
              title={t("settings.skillUnmanagedListTitle")}
              emptyText={t("settings.skillUnmanagedEmpty")}
              items={overview?.unmanagedEntries ?? []}
              renderItem={(entry) => {
                const actionKey = buildImportActionKey(entry);

                return (
                  <div key={`${entry.targetCli}:${entry.directoryPath}`} className="settings-skill-entry">
                    <div className="settings-skill-entry-main">
                      <strong className="settings-skill-entry-title">{entry.name}</strong>
                      <p className="settings-skill-entry-meta">
                        {resolveUnmanagedSkillDescription(entry, providerCatalogByTargetCli)}
                      </p>
                      {!isSkillTargetProviderEnabled(entry.targetCli, providerCatalogByTargetCli) ? (
                        <div className="settings-skill-tags">
                          <span className="settings-skill-tag" data-status="failed">
                            {t("settings.skillTargetDisabledTag")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="settings-skill-entry-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={
                          loading
                          || pendingActionKey !== null
                          || !isSkillTargetProviderEnabled(entry.targetCli, providerCatalogByTargetCli)
                        }
                        onClick={() => {
                          void handleImport(entry);
                        }}
                      >
                        {pendingActionKey === actionKey ? t("common.loading") : t("settings.skillImportAction")}
                      </button>
                    </div>
                  </div>
                );
              }}
            />

            <SkillSection
              title={t("settings.skillAssistantRuntimeListTitle")}
              description={t("settings.skillAssistantRuntimeListDescription")}
              emptyText={t("settings.skillAssistantRuntimeEmpty")}
              items={assistantRuntimeItems}
              renderItem={(item) => (
                <div key={`${item.directoryName}:${item.sourcePath}`} className="settings-skill-entry">
                  <div className="settings-skill-entry-main">
                    <strong className="settings-skill-entry-title">{item.name}</strong>
                    <p className="settings-skill-entry-meta">
                      {t("settings.skillAssistantRuntimeItemDescription")}
                    </p>
                    <p className="settings-skill-entry-meta">
                      {t("settings.skillAssistantRuntimeUsedBy")}: {formatTargetCliList(item.usedByTargetCli)}
                    </p>
                    <div className="settings-skill-tags">
                      <span className="settings-skill-tag" data-status="assistant-runtime">
                        {resolveAssistantRuntimeUsageTagLabel(item.usageTag)}
                      </span>
                      {item.usedByTargetCli.map((targetCli) => (
                        <span
                          key={`${item.directoryName}:${targetCli}`}
                          className="settings-skill-tag"
                          data-status={
                            isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)
                              ? "synced"
                              : "failed"
                          }
                        >
                          {isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)
                            ? resolveTargetCliLabel(targetCli)
                            : `${resolveTargetCliLabel(targetCli)} · ${t("settings.skillTargetDisabledTag")}`}
                        </span>
                      ))}
                    </div>
                  </div>
                  {item.directoryName === "codingns-workspace-session" ? (
                    <div className="settings-skill-entry-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={loading || pendingActionKey !== null || !workspaceId?.trim()}
                        onClick={() => {
                          void handleOpenWorkspaceSessionMcpStatus();
                        }}
                      >
                        {t("settings.skillWorkspaceSessionMcpStatusAction")}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            />

            <SkillSection
              title={t("settings.skillConflictedListTitle")}
              emptyText={t("settings.skillConflictedEmpty")}
              items={visibleConflictedEntries}
              renderItem={(entry) => {
                const entryTags = resolveScanEntryTags(entry, overview?.diagnostics ?? []);

                return (
                  <div key={`${entry.targetCli}:${entry.directoryPath}`} className="settings-skill-entry">
                    <div className="settings-skill-entry-main">
                      <strong className="settings-skill-entry-title">{entry.name}</strong>
                      <p className="settings-skill-entry-meta">
                        {resolveConflictedSkillDescription(entry, providerCatalogByTargetCli)}
                      </p>
                      {entryTags.length > 0 ? (
                        <div className="settings-skill-tags">
                          {entryTags.map((tag) => (
                            <span key={tag.key} className="settings-skill-tag" data-status={tag.status}>
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }}
            />

            <SkillSection
              title={t("settings.skillDiagnosticsTitle")}
              emptyText={t("settings.skillDiagnosticsEmpty")}
              items={visibleDiagnostics}
              renderItem={(diagnostic) => {
                const diagnosticTags = resolveDiagnosticTags(diagnostic);
                const diagnosticPresentation = resolveDiagnosticPresentation(diagnostic);

                return (
                  <div
                    key={`${diagnostic.targetCli}:${diagnostic.code}:${diagnostic.directoryPath ?? diagnostic.rootDir}`}
                    className="settings-skill-entry"
                  >
                    <div className="settings-skill-entry-main">
                      <strong className="settings-skill-entry-title">{diagnosticPresentation.title}</strong>
                      <p className="settings-skill-entry-meta">{diagnosticPresentation.detail}</p>
                      {diagnosticTags.length > 0 ? (
                        <div className="settings-skill-tags">
                          {diagnosticTags.map((tag) => (
                            <span key={tag.key} className="settings-skill-tag" data-status={tag.status}>
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }}
            />
          </div>
        ) : null}

        {officeTabSelected ? (
          <div
            id={`${tabsBaseId}-office-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsBaseId}-office-tab`}
            className="settings-skill-panel"
          >
            <section className="settings-skill-summary-block">
              <div className="settings-skill-summary-grid">
                <SummaryCard label={t("settings.skillOfficeTemplateCount")} value={String(documentTemplates.length)} />
                <SummaryCard
                  label={t("settings.skillOfficeWorkspaceScope")}
                  value={workspaceId?.trim() ? t("settings.skillOfficeScoped") : t("settings.skillOfficeGlobal")}
                />
              </div>
              {statusText ? <p className="settings-release-status">{statusText}</p> : null}
              {panelError ? <p className="settings-release-status">{panelError}</p> : null}
            </section>

            <SkillSection
              title={t("settings.skillOfficeTemplateListTitle")}
              description={t("settings.skillOfficeTemplateListDescription")}
              emptyText={t("settings.skillOfficeTemplateEmpty")}
              items={documentTemplates}
              renderItem={(template) => (
                <div key={template.id} className="settings-skill-entry">
                  <div className="settings-skill-entry-main">
                    <strong className="settings-skill-entry-title">{template.displayName}</strong>
                    <p className="settings-skill-entry-meta">
                      {t("settings.skillOfficeTemplateListMeta", {
                        key: template.templateKey,
                        version: template.templateVersion
                      })}
                    </p>
                    <div className="settings-skill-tags">
                      <span className="settings-skill-tag" data-status="synced">{template.engine}</span>
                      <span className="settings-skill-tag" data-status={template.status === "active" ? "synced" : "failed"}>
                        {template.status}
                      </span>
                    </div>
                  </div>
                  <div className="settings-skill-entry-actions">
                    <span className="settings-skill-entry-meta">{template.templateSourcePath ?? "-"}</span>
                  </div>
                </div>
              )}
            />
          </div>
        ) : null}

        {opsTabSelected ? (
          <div
            id={`${tabsBaseId}-ops-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsBaseId}-ops-tab`}
            className="settings-skill-panel"
          >
            <section className="settings-skill-summary-block">
              <div className="settings-skill-summary-grid">
                <SummaryCard label={t("settings.skillOpsTaskCount")} value={String(opsTasks.length)} />
                <SummaryCard label={t("settings.skillOpsTargetCount")} value={String(opsTargets.length)} />
                <SummaryCard
                  label={t("settings.skillOpsWorkspaceScope")}
                  value={workspaceId?.trim() ? t("settings.skillOfficeScoped") : t("settings.skillOfficeGlobal")}
                />
              </div>
              {statusText ? <p className="settings-release-status">{statusText}</p> : null}
              {panelError ? <p className="settings-release-status">{panelError}</p> : null}
            </section>

            <SkillSection
              title={t("settings.skillOpsTaskListTitle")}
              description={t("settings.skillOpsTaskListDescription")}
              emptyText={t("settings.skillOpsTaskEmpty")}
              items={opsTasks}
              renderItem={(task) => (
                <div key={task.id} className="settings-skill-entry">
                  <div className="settings-skill-entry-main">
                    <strong className="settings-skill-entry-title">{task.title}</strong>
                    <p className="settings-skill-entry-meta">
                      {t("settings.skillOpsTaskListMeta", {
                        status: task.status,
                        risk: task.riskLevel
                      })}
                    </p>
                    <div className="settings-skill-tags">
                      <span className="settings-skill-tag" data-status="synced">{task.connectorId}</span>
                      <span className="settings-skill-tag" data-status={resolveOpsTaskStatusTag(task.status)}>
                        {task.status}
                      </span>
                    </div>
                    {selectedOpsTaskDetail?.task.id === task.id ? (
                      <div className="settings-skill-tags">
                        {selectedOpsTaskDetail.approvals.map((approval) => (
                          <span
                            key={approval.id}
                            className="settings-skill-tag"
                            data-status={approval.status === "pending" ? "pending" : approval.status === "approved" ? "synced" : "failed"}
                          >
                            {approval.status}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-skill-entry-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={loading || pendingActionKey !== null}
                      onClick={() => {
                        void handleOpenOpsTask(task.id);
                      }}
                    >
                      {pendingActionKey === `ops-task-detail:${task.id}`
                        ? t("common.loading")
                        : t("settings.skillOpsTaskDetailAction")}
                    </button>
                    {selectedOpsTaskDetail?.task.id === task.id
                      ? selectedOpsTaskDetail.approvals
                        .filter((approval) => approval.status === "pending")
                        .map((approval) => (
                          <button
                            key={approval.id}
                            className="secondary-button"
                            type="button"
                            disabled={loading || pendingActionKey !== null}
                            onClick={() => {
                              void handleReplyOpsApproval(approval.id, "approved");
                            }}
                          >
                            {pendingActionKey === `ops-approval:${approval.id}:approved`
                              ? t("common.loading")
                              : t("settings.skillOpsApprovalApproveAction")}
                          </button>
                        ))
                      : null}
                  </div>
                </div>
              )}
            />

            <SkillSection
              title={t("settings.skillOpsTargetListTitle")}
              description={t("settings.skillOpsTargetListDescription")}
              emptyText={t("settings.skillOpsTargetEmpty")}
              items={opsTargets}
              renderItem={(target) => (
                <div key={target.id} className="settings-skill-entry">
                  <div className="settings-skill-entry-main">
                    <strong className="settings-skill-entry-title">{target.displayName}</strong>
                    <p className="settings-skill-entry-meta">{buildOpsTargetSummary(target)}</p>
                    <div className="settings-skill-tags">
                      <span className="settings-skill-tag" data-status="synced">{target.kind}</span>
                      <span className="settings-skill-tag" data-status={target.status === "active" ? "synced" : "failed"}>
                        {target.status}
                      </span>
                    </div>
                  </div>
                  <div className="settings-skill-entry-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={loading || pendingActionKey !== null}
                      onClick={() => handleEditOpsTarget(target)}
                    >
                      {t("settings.skillOpsTargetEditAction")}
                    </button>
                  </div>
                </div>
              )}
            />
          </div>
        ) : null}

        {openCliTabSelected ? (
          <div
            id={`${tabsBaseId}-opencli-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsBaseId}-opencli-tab`}
            className="settings-skill-panel"
          >
            <OpenCliManagementPanel
              toolbarMode="external"
              onToolbarStateChange={setOpenCliToolbarState}
            />
          </div>
        ) : null}
      </WorkbenchModal>

      <WorkbenchModal
        open={officeTemplateModalOpen}
        title={t("settings.skillOfficeTemplateModalTitle")}
        description={t("settings.skillOfficeTemplateModalDescription")}
        className="settings-skill-create-modal"
        onClose={() => {
          setOfficeTemplateModalOpen(false);
          setOfficeTemplateDraft(createDefaultOfficeTemplateDraft());
        }}
      >
        <ModalSection heading={t("settings.skillOfficeTemplateFormTitle")}>
          <input
            ref={templateUploadInputRef}
            type="file"
            accept=".domt,.doct,application/octet-stream"
            className="settings-skill-upload-input"
            onChange={(event) => {
              void handleOfficeTemplateFileChange(event);
            }}
          />
          <ModalField
            label={t("settings.skillOfficeTemplateUploadLabel")}
            description={t("settings.skillOfficeTemplateUploadDescription")}
          >
            <div className="settings-skill-create-toolbar">
              <button
                className="secondary-button"
                type="button"
                disabled={loading || pendingActionKey !== null}
                onClick={() => templateUploadInputRef.current?.click()}
              >
                {t("settings.skillOfficeTemplatePickAction")}
              </button>
            </div>
          </ModalField>
          {officeTemplateDraft.fileName ? (
            <div className="settings-skill-entry">
              <div className="settings-skill-entry-main">
                <strong className="settings-skill-entry-title">{officeTemplateDraft.fileName}</strong>
                <p className="settings-skill-entry-meta">{t("settings.skillOfficeTemplateAutoDetectHint")}</p>
              </div>
            </div>
          ) : null}
          <ModalActions>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setOfficeTemplateModalOpen(false);
                setOfficeTemplateDraft(createDefaultOfficeTemplateDraft());
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!officeTemplateDraft.fileName || loading || pendingActionKey !== null}
              onClick={() => {
                void handleOfficeTemplateSubmit();
              }}
            >
              {pendingActionKey === "office-template-submit"
                ? t("common.loading")
                : t("settings.skillOfficeTemplateSaveAction")}
            </button>
          </ModalActions>
        </ModalSection>
      </WorkbenchModal>

      <WorkbenchModal
        open={opsTargetModalOpen}
        title={t("settings.skillOpsTargetModalTitle")}
        description={t("settings.skillOpsTargetModalDescription")}
        className="settings-skill-create-modal"
        onClose={() => {
          setOpsTargetModalOpen(false);
          setOpsTargetDraft(createDefaultOpsTargetDraft());
        }}
      >
        <ModalSection
          heading={t("settings.skillOpsTargetFormTitle")}
          description={t("settings.skillOpsTargetFormDescription")}
        >
          <p className="settings-skill-entry-meta">{t("settings.skillOpsPasswordNotice")}</p>
          <ModalField label={t("settings.skillOpsTargetNameLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.displayName} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, displayName: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetEnvironmentLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.environment} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, environment: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetHostLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.host} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, host: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetPortLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.port} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, port: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetUsernameLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.username} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, username: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetPrivateKeyPathLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.privateKeyPath} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, privateKeyPath: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetKnownHostsPathLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.knownHostsPath} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, knownHostsPath: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetJumpHostLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.jumpHost} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, jumpHost: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetWorkspacePathLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.workspacePath} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, workspacePath: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetCredentialRefLabel")}>
            <input className="settings-text-input" value={opsTargetDraft.credentialRef} onChange={(event) => setOpsTargetDraft((current) => ({ ...current, credentialRef: event.target.value }))} />
          </ModalField>
          <ModalField label={t("settings.skillOpsTargetHostKeyPolicyLabel")}>
            <select
              className="settings-select"
              value={opsTargetDraft.strictHostKeyChecking}
              onChange={(event) => setOpsTargetDraft((current) => ({
                ...current,
                strictHostKeyChecking: event.target.value as "accept-new" | "yes" | "no"
              }))}
            >
              <option value="accept-new">accept-new</option>
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
          </ModalField>
          <ModalActions>
            <button className="secondary-button" type="button" onClick={handleResetOpsTargetDraft}>
              {t("settings.skillOpsTargetResetAction")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={loading || pendingActionKey !== null}
              onClick={() => {
                void handleOpsTargetSubmit();
              }}
            >
              {pendingActionKey === "ops-target-submit"
                ? t("common.loading")
                : t("settings.skillOpsTargetSaveAction")}
            </button>
          </ModalActions>
        </ModalSection>
      </WorkbenchModal>

      <WorkbenchModal
        open={workspaceSessionMcpModalOpen}
        title={t("settings.skillWorkspaceSessionMcpModalTitle")}
        description={t("settings.skillWorkspaceSessionMcpModalDescription")}
        className="settings-skill-create-modal"
        onClose={() => {
          setWorkspaceSessionMcpModalOpen(false);
          setWorkspaceSessionMcpStatus(null);
        }}
      >
        <ModalSection
          heading={t("settings.skillWorkspaceSessionMcpRuntimeTitle")}
          description={t("settings.skillWorkspaceSessionMcpRuntimeDescription")}
        >
          {workspaceSessionMcpLoading ? (
            <div className="settings-skill-empty">{t("settings.skillWorkspaceSessionMcpLoading")}</div>
          ) : workspaceSessionMcpStatus ? (
            <div className="settings-skill-entry-list">
              <div className="settings-skill-summary-grid">
                <SummaryCard
                  label={t("settings.skillWorkspaceSessionMcpReadyCliCount")}
                  value={String(workspaceSessionMcpStatus.summary.readyCliCount)}
                />
                <SummaryCard
                  label={t("settings.skillWorkspaceSessionMcpConfiguredCliCount")}
                  value={String(workspaceSessionMcpStatus.summary.configuredCliCount)}
                />
                <SummaryCard
                  label={t("settings.skillWorkspaceSessionMcpTotalCliCount")}
                  value={String(workspaceSessionMcpStatus.summary.totalCliCount)}
                />
              </div>
              <ModalList>
                <ModalListItem
                  label={t("settings.skillWorkspaceSessionMcpRuntimeHomeLabel")}
                  description={workspaceSessionMcpStatus.runtime.runtimeHomeDir ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.runtime.runtimeHomeExists)}
                />
                <ModalListItem
                  label={t("settings.skillWorkspaceSessionMcpAuthFileLabel")}
                  description={workspaceSessionMcpStatus.runtime.scopedAuthFilePath ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.runtime.scopedAuthFileExists)}
                />
                <ModalListItem
                  label={t("settings.skillWorkspaceSessionMcpInstructionFileLabel")}
                  description={workspaceSessionMcpStatus.runtime.composedInstructionPath ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.runtime.composedInstructionExists)}
                />
                <ModalListItem
                  label={t("settings.skillWorkspaceSessionMcpSkillDirLabel")}
                  description={workspaceSessionMcpStatus.runtime.skillDirectoryPath ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.runtime.skillDirectoryExists)}
                />
              </ModalList>
            </div>
          ) : (
            <ModalEmptyState
              title={t("settings.skillWorkspaceSessionMcpEmptyTitle")}
              description={panelError ?? t("settings.skillWorkspaceSessionMcpEmptyDescription")}
              compact
            />
          )}
        </ModalSection>

        <ModalSection
          heading={t("settings.skillWorkspaceSessionMcpCommandTitle")}
          description={t("settings.skillWorkspaceSessionMcpCommandDescription")}
        >
          {workspaceSessionMcpStatus ? (
            <ModalList>
              <ModalListItem
                label={t("settings.skillWorkspaceSessionMcpGlobalCodingnsLabel")}
                description={workspaceSessionMcpStatus.commands.globalCodingnsPath ?? workspaceSessionMcpStatus.commands.globalCodingnsWorkspaceMcpDetail}
                trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.commands.globalCodingnsSupportsWorkspaceMcp)}
              />
              <ModalListItem
                label={t("settings.skillWorkspaceSessionMcpGlobalStandaloneLabel")}
                description={workspaceSessionMcpStatus.commands.globalWorkspaceOfficeMcpPath ?? t("settings.skillWorkspaceSessionMcpGlobalStandaloneMissing")}
                trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.commands.globalWorkspaceOfficeMcpInstalled)}
              />
              <ModalListItem
                label={t("settings.skillWorkspaceSessionMcpRepoCodingnsLabel")}
                description={workspaceSessionMcpStatus.commands.repoCodingnsWorkspaceMcpDetail}
                trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpStatus.commands.repoCodingnsSupportsWorkspaceMcp)}
              />
            </ModalList>
          ) : null}
        </ModalSection>

        <ModalSection
          heading={t("settings.skillWorkspaceSessionMcpCliTitle")}
          description={t("settings.skillWorkspaceSessionMcpCliDescription")}
        >
          {workspaceSessionMcpStatus ? (
            <ModalList>
              {workspaceSessionMcpStatus.cliStatuses.map((item) => (
                <ModalListItem
                  key={item.cli}
                  label={item.label}
                  description={`${item.runtimeConfigFile} · ${item.callStateDetail}`}
                  trailing={renderWorkspaceSessionMcpStateTag(item.mcpConfigured)}
                />
              ))}
            </ModalList>
          ) : null}
          <ModalActions>
            <button
              className="secondary-button"
              type="button"
              disabled={!workspaceId?.trim() || workspaceSessionMcpLoading}
              onClick={() => {
                void handleOpenWorkspaceSessionMcpStatus();
              }}
            >
              {workspaceSessionMcpLoading
                ? t("common.loading")
                : t("settings.skillWorkspaceSessionMcpRefreshAction")}
            </button>
          </ModalActions>
        </ModalSection>
      </WorkbenchModal>

      <WorkbenchModal
        open={createModalOpen}
        title={t("settings.skillCreateModalTitle")}
        description={t("settings.skillCreateModalDescription")}
        className="settings-skill-create-modal"
        onClose={closeCreateModal}
      >
        <section className="settings-skill-section">
          <h3 className="settings-skill-section-title">{t("settings.skillUploadSectionTitle")}</h3>
          <p className="settings-skill-section-description">{t("settings.skillUploadSectionDescription")}</p>

          <div className="settings-skill-create-panel">
            <input
              ref={uploadInputRef}
              type="file"
              accept=".md,text/markdown,text/plain"
              className="settings-skill-upload-input"
              onChange={(event) => {
                void handleUploadFileChange(event);
              }}
            />

            <div className="settings-model-tabs" role="tablist" aria-label={t("settings.skillCreateSourceTabsLabel")}>
              {SKILL_UPLOAD_SOURCE_OPTIONS.map((mode) => {
                const selected = uploadSourceMode === mode;

                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    className="settings-model-tab"
                    aria-selected={selected}
                    data-active={selected ? "true" : "false"}
                    onClick={() => handleUploadSourceModeChange(mode)}
                  >
                    {resolveSkillUploadSourceModeLabel(mode)}
                  </button>
                );
              })}
            </div>

            <div
              className="settings-skill-upload-targets"
              role="radiogroup"
              aria-label={t("settings.skillUploadScopeLabel")}
            >
              {SKILL_SCOPE_OPTIONS.map((scope) => (
                <label
                  key={scope}
                  className="settings-skill-upload-target"
                  data-selected={uploadScope === scope ? "true" : "false"}
                >
                  <input
                    type="radio"
                    name="skill-upload-scope"
                    checked={uploadScope === scope}
                    onChange={() => handleUploadScopeChange(scope)}
                  />
                  <span>{resolveSkillScopeLabel(scope)}</span>
                </label>
              ))}
            </div>

            {uploadSourceMode === "file" ? (
              <div className="settings-skill-create-toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={loading || pendingActionKey !== null}
                  onClick={() => {
                    uploadInputRef.current?.click();
                  }}
                >
                  {t("settings.skillUploadPickAction")}
                </button>
              </div>
            ) : (
              <label className="settings-skill-upload-field">
                <span>{t("settings.skillPasteLabel")}</span>
                <textarea
                  className="settings-skill-create-textarea"
                  value={pastedMarkdown}
                  onChange={(event) => setPastedMarkdown(event.target.value)}
                  placeholder={t("settings.skillPastePlaceholder")}
                />
              </label>
            )}

            {currentUploadDraft ? (
              <div className="settings-skill-entry">
                <div className="settings-skill-entry-main">
                  <strong className="settings-skill-entry-title">{currentUploadDraft.previewTitle}</strong>
                  <p className="settings-skill-entry-meta">
                    {t("settings.skillUploadPickedFile")}: {currentUploadDraft.fileName}
                  </p>
                </div>
              </div>
            ) : (
              <div className="settings-skill-empty">
                {uploadSourceMode === "paste" ? t("settings.skillPasteEmpty") : t("settings.skillUploadEmpty")}
              </div>
            )}

            <div className="settings-skill-upload-field">
              <span>{t("settings.skillUploadTargetsLabel")}</span>
              <div className="settings-skill-upload-targets">
                {getUploadTargetOptions(uploadScope).map((targetCli) => (
                  <label
                    key={targetCli}
                    className="settings-skill-upload-target"
                    data-selected={uploadTargets[targetCli] ? "true" : "false"}
                  >
                    <input
                      type="checkbox"
                      checked={uploadTargets[targetCli]}
                      disabled={!isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)}
                      onChange={() => handleUploadTargetToggle(targetCli)}
                    />
                    <span>
                      {isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)
                        ? resolveTargetCliLabel(targetCli)
                        : `${resolveTargetCliLabel(targetCli)} · ${t("settings.skillTargetDisabledTag")}`}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {currentUploadDraft?.notes.length ? (
              <div className="settings-skill-tags">
                {currentUploadDraft.notes.map((note, index) => (
                  <span
                    key={`${currentUploadDraft.fileName}:${index}`}
                    className="settings-skill-tag"
                    data-status="pending"
                  >
                    {note}
                  </span>
                ))}
              </div>
            ) : null}

            {panelError ? <p className="settings-release-status">{panelError}</p> : null}

            <div className="settings-skill-create-actions">
              <button
                className="primary-button"
                type="button"
                disabled={loading || pendingActionKey !== null}
                onClick={() => {
                  void handleUploadSubmit();
                }}
              >
                {pendingActionKey === "upload" ? t("common.loading") : t("settings.skillCreateSubmitAction")}
              </button>
            </div>
          </div>
        </section>
      </WorkbenchModal>
    </>
  );
}

function SkillSection<T>({
  title,
  description,
  emptyText,
  items,
  renderItem
}: {
  title: string;
  description?: string;
  emptyText: string;
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <section className="settings-skill-section">
      <h3 className="settings-skill-section-title">{title}</h3>
      {description ? <p className="settings-skill-section-description">{description}</p> : null}
      {items.length > 0 ? (
        <div className="settings-skill-entry-list">
          {items.map((item, index) => (
            <Fragment key={index}>{renderItem(item)}</Fragment>
          ))}
        </div>
      ) : (
        <div className="settings-skill-empty">{emptyText}</div>
      )}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-skill-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildImportActionKey(entry: SkillScanEntryDto): string {
  return `import:${entry.targetCli}:${entry.directoryPath}`;
}

function buildSyncActionKey(skillId: string): string {
  return `sync:${skillId}`;
}

interface SkillUploadDraft {
  fileName: string;
  rawContent: string;
  directoryName: string;
  previewTitle: string;
  notes: string[];
}

const SKILL_TARGET_OPTIONS: readonly SkillTargetCli[] = ["codex", "claude-code", "gemini", "opencode"];
const ASSISTANT_UPLOAD_TARGET_OPTIONS: readonly SkillTargetCli[] = ["codex", "claude-code"];
const SKILL_SCOPE_OPTIONS: readonly SkillScope[] = ["workspace", "assistant"];
const SKILL_UPLOAD_SOURCE_OPTIONS: readonly SkillUploadSourceMode[] = ["file", "paste"];

function resolveSkillPanelError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message || t("settings.skillLoadFailed");
  }

  return error instanceof Error ? error.message : t("settings.skillLoadFailed");
}

function resolveTargetCliLabel(targetCli: SkillTargetCli): string {
  switch (targetCli) {
    case "claude-code":
      return t("settings.skillTargetClaudeCode");
    case "gemini":
      return t("settings.skillTargetGemini");
    case "opencode":
      return t("settings.skillTargetOpenCode");
    default:
      return t("settings.skillTargetCodex");
  }
}

function resolveSkillScopeLabel(scope: SkillScope): string {
  return scope === "assistant"
    ? t("settings.skillUploadScopeAssistant")
    : t("settings.skillUploadScopeWorkspace");
}

function resolveSkillUploadSourceModeLabel(mode: SkillUploadSourceMode): string {
  return mode === "paste"
    ? t("settings.skillCreateSourcePaste")
    : t("settings.skillCreateSourceFile");
}

function resolveSkillManagementTabLabel(tabId: SkillManagementTabId): string {
  switch (tabId) {
    case "office":
      return t("settings.skillConfigTabOffice");
    case "ops":
      return t("settings.skillConfigTabOps");
    case "opencli":
      return t("settings.skillConfigTabOpenCli");
    default:
      return t("settings.skillConfigTabSkills");
  }
}

function createDefaultUploadTargets(
  scope: SkillScope,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>> = {}
): Record<SkillTargetCli, boolean> {
  const selectableTargets = getUploadTargetOptions(scope).filter((targetCli) =>
    isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)
  );
  const firstSelectableTarget = selectableTargets[0] ?? null;

  return {
    codex: firstSelectableTarget === "codex",
    "claude-code": firstSelectableTarget === "claude-code",
    gemini: firstSelectableTarget === "gemini",
    opencode: firstSelectableTarget === "opencode"
  };
}

function getUploadTargetOptions(scope: SkillScope): readonly SkillTargetCli[] {
  return scope === "assistant" ? ASSISTANT_UPLOAD_TARGET_OPTIONS : SKILL_TARGET_OPTIONS;
}

function createDefaultOpsTargetDraft() {
  return {
    targetId: null,
    displayName: "",
    environment: "",
    host: "",
    port: "22",
    username: "",
    privateKeyPath: "",
    knownHostsPath: "",
    jumpHost: "",
    workspacePath: "",
    credentialRef: "",
    strictHostKeyChecking: "accept-new" as const,
    status: "active" as const
  };
}

function createDefaultOfficeTemplateDraft() {
  return {
    fileName: "",
    fileContentBase64: ""
  };
}

function parseOpsTargetConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readConfigString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readConfigNumber(value: unknown, fallback: number): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

function readStrictHostKeyChecking(value: unknown): "accept-new" | "yes" | "no" {
  return value === "yes" || value === "no" || value === "accept-new"
    ? value
    : "accept-new";
}

function resolveOpsTaskStatusTag(status: OfficeTaskStatus): "pending" | "synced" | "failed" | "conflicted" {
  if (status === "ready" || status === "running" || status === "succeeded") {
    return "synced";
  }

  if (status === "pending_approval" || status === "waiting_external" || status === "paused") {
    return "pending";
  }

  if (status === "failed" || status === "cancelled" || status === "rolled_back") {
    return "failed";
  }

  return "conflicted";
}

function buildOpsTargetSummary(target: OpsTargetDto): string {
  const config = parseOpsTargetConfig(target.configJson);
  const host = readConfigString(config.host);
  const username = readConfigString(config.username);
  const port = readConfigNumber(config.port, 22);
  const environment = target.environment?.trim();

  return [environment, `${username}@${host}:${port}`]
    .filter((item) => item && item.trim().length > 0)
    .join(" · ");
}

function renderWorkspaceSessionMcpStateTag(ready: boolean) {
  return (
    <span className="settings-skill-tag" data-status={ready ? "synced" : "failed"}>
      {ready ? t("settings.skillWorkspaceSessionMcpStateReady") : t("settings.skillWorkspaceSessionMcpStateMissing")}
    </span>
  );
}


function resolveCurrentUploadDraft({
  sourceMode,
  fileDraft,
  pastedMarkdown
}: {
  sourceMode: SkillUploadSourceMode;
  fileDraft: SkillUploadDraft | null;
  pastedMarkdown: string;
}): SkillUploadDraft | null {
  if (sourceMode === "file") {
    return fileDraft;
  }

  if (!pastedMarkdown.trim()) {
    return null;
  }

  return prepareSkillUploadDraft(buildPastedSkillFileName(pastedMarkdown), pastedMarkdown);
}

function resolveBindingStatusLabel(status: SkillTargetBindingDto["syncStatus"]): string {
  switch (status) {
    case "conflicted":
      return t("settings.skillBindingConflicted");
    case "failed":
      return t("settings.skillBindingFailed");
    case "pending":
      return t("settings.skillBindingPending");
    default:
      return t("settings.skillBindingSynced");
  }
}

function buildSkillTargetCatalogMap(
  providerCatalog: readonly ProviderCatalogEntryDto[]
): Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>> {
  const result: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>> = {};

  for (const entry of providerCatalog) {
    const targetCli = resolveSkillTargetCli(entry.provider);

    if (targetCli) {
      result[targetCli] = entry;
    }
  }

  return result;
}

function resolveSkillTargetCli(provider: ProviderCatalogEntryDto["provider"]): SkillTargetCli | null {
  switch (provider) {
    case "claude-code":
      return "claude-code";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "opencode":
      return "opencode";
    default:
      return null;
  }
}

function isSkillTargetProviderEnabled(
  targetCli: SkillTargetCli,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): boolean {
  return providerCatalogByTargetCli[targetCli]?.enabled !== false;
}

function canSyncManagedSkill(
  bindings: readonly SkillTargetBindingDto[],
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): boolean {
  return bindings.some((binding) =>
    binding.enabled && isSkillTargetProviderEnabled(binding.targetCli, providerCatalogByTargetCli)
  );
}

function resolveBindingTagStatus(
  binding: SkillTargetBindingDto,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): string {
  if (!isSkillTargetProviderEnabled(binding.targetCli, providerCatalogByTargetCli)) {
    return "failed";
  }

  return binding.syncStatus;
}

function resolveBindingTagLabel(
  binding: SkillTargetBindingDto,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): string {
  if (!isSkillTargetProviderEnabled(binding.targetCli, providerCatalogByTargetCli)) {
    return `${resolveTargetCliLabel(binding.targetCli)} · ${t("settings.skillTargetDisabledTag")}`;
  }

  return `${resolveTargetCliLabel(binding.targetCli)} · ${resolveBindingStatusLabel(binding.syncStatus)}`;
}

function formatTargetCliList(targetCli: readonly SkillTargetCli[]): string {
  return targetCli.map(resolveTargetCliLabel).join(" / ");
}

function resolveManagedSkillDescription(bindings: readonly SkillTargetBindingDto[]): string {
  const enabledBindings = bindings.filter((binding) => binding.enabled);

  if (enabledBindings.length === 0) {
    return t("settings.skillManagedItemNoTarget");
  }

  return t("settings.skillManagedItemDescription", {
    targets: formatTargetCliList(enabledBindings.map((binding) => binding.targetCli))
  });
}

function resolveUnmanagedSkillDescription(
  entry: SkillScanEntryDto,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): string {
  if (!isSkillTargetProviderEnabled(entry.targetCli, providerCatalogByTargetCli)) {
    return t("settings.skillUnmanagedItemDisabledDescription", {
      target: resolveTargetCliLabel(entry.targetCli)
    });
  }

  return t("settings.skillUnmanagedItemDescription", {
    target: resolveTargetCliLabel(entry.targetCli)
  });
}

function resolveConflictedSkillDescription(
  entry: SkillScanEntryDto,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): string {
  if (!isSkillTargetProviderEnabled(entry.targetCli, providerCatalogByTargetCli)) {
    return t("settings.skillConflictedItemDisabledDescription", {
      target: resolveTargetCliLabel(entry.targetCli)
    });
  }

  return t("settings.skillConflictedItemDescription", {
    target: resolveTargetCliLabel(entry.targetCli)
  });
}

function resolveSkillSyncTargetError(
  bindings: readonly SkillTargetBindingDto[],
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): string {
  const hasEnabledBinding = bindings.some((binding) => binding.enabled);

  if (!hasEnabledBinding) {
    return t("settings.skillSyncTargetMissing");
  }

  return t("settings.skillSyncTargetDisabled");
}

function resolveSkillUploadTargetError(
  scope: SkillScope,
  providerCatalogByTargetCli: Partial<Record<SkillTargetCli, ProviderCatalogEntryDto>>
): string {
  const hasSelectableTarget = getUploadTargetOptions(scope).some((targetCli) =>
    isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli)
  );

  if (!hasSelectableTarget) {
    return t("settings.skillUploadTargetDisabled");
  }

  return t("settings.skillUploadTargetRequired");
}

function resolveDiagnosticPresentation(diagnostic: SkillScanDiagnosticDto): { title: string; detail: string } {
  const target = resolveTargetCliLabel(diagnostic.targetCli);

  switch (diagnostic.code) {
    case "SKILL_TARGET_ROOT_MISSING":
      return {
        title: t("settings.skillDiagnosticTargetMissingTitle", { target }),
        detail: t("settings.skillDiagnosticTargetMissingDetail", { target })
      };
    case "SKILL_TARGET_ROOT_INVALID":
    case "SKILL_TARGET_STAT_FAILED":
    case "SKILL_TARGET_READ_FAILED":
      return {
        title: t("settings.skillDiagnosticReadFailedTitle", { target }),
        detail: t("settings.skillDiagnosticReadFailedDetail", { target })
      };
    case "SKILL_TARGET_SKILL_MISSING":
      return {
        title: t("settings.skillDiagnosticSyncMissingTitle", { target }),
        detail: t("settings.skillDiagnosticSyncMissingDetail", { target })
      };
    default:
      return {
        title: t("settings.skillDiagnosticGenericTitle", { target }),
        detail: t("settings.skillDiagnosticGenericDetail", { target })
      };
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

interface SkillTagView {
  key: string;
  label: string;
  status: string;
}

interface AssistantRuntimeItemView {
  name: string;
  directoryName: string;
  sourcePath: string;
  usedByTargetCli: SkillTargetCli[];
  usageTag: "assistant-only" | "workspace-session";
}

function buildAssistantRuntimeItems(
  assistantRuntimeSkills: readonly AssistantRuntimeSkillOverviewItemDto[],
  conflictedEntries: readonly SkillScanEntryDto[],
  diagnostics: readonly SkillScanDiagnosticDto[]
): AssistantRuntimeItemView[] {
  if (assistantRuntimeSkills.length > 0) {
    return assistantRuntimeSkills.map((item) => ({
      name: item.name,
      directoryName: item.directoryName,
      sourcePath: item.sourcePath,
      usedByTargetCli: item.usedByTargetCli,
      usageTag: resolveAssistantRuntimeUsageTag(item.directoryName)
    }));
  }

  const items = new Map<string, AssistantRuntimeItemView>();

  for (const entry of conflictedEntries) {
    if (!isAssistantRuntimeEntry(entry, diagnostics)) {
      continue;
    }

    items.set(buildSkillEntryKey(entry.targetCli, entry.directoryPath), {
      name: entry.name,
      directoryName: entry.directoryName,
      sourcePath: entry.directoryPath,
      usedByTargetCli: [entry.targetCli],
      usageTag: resolveAssistantRuntimeUsageTag(entry.directoryName)
    });
  }

  for (const diagnostic of diagnostics) {
    if (!isAssistantRuntimeDiagnostic(diagnostic)) {
      continue;
    }

    const directoryPath = diagnostic.directoryPath ?? diagnostic.rootDir;
    const key = buildSkillEntryKey(diagnostic.targetCli, directoryPath);

    if (items.has(key)) {
      continue;
    }

    items.set(key, {
      name: diagnostic.directoryName ?? "codingns-assistant",
      directoryName: diagnostic.directoryName ?? "codingns-assistant",
      sourcePath: directoryPath,
      usedByTargetCli: [diagnostic.targetCli],
      usageTag: resolveAssistantRuntimeUsageTag(diagnostic.directoryName ?? "codingns-assistant")
    });
  }

  return [...items.values()];
}

function buildSkillEntryKey(targetCli: SkillTargetCli, directoryPath: string): string {
  return `${targetCli}:${directoryPath}`;
}

function isAssistantRuntimeEntry(
  entry: SkillScanEntryDto,
  diagnostics: readonly SkillScanDiagnosticDto[]
): boolean {
  return diagnostics.some((diagnostic) =>
    isAssistantRuntimeDiagnostic(diagnostic)
    && diagnostic.targetCli === entry.targetCli
    && diagnostic.directoryPath === entry.directoryPath
    && diagnostic.directoryName === entry.directoryName
  );
}

function isAssistantRuntimeDiagnostic(diagnostic: SkillScanDiagnosticDto): boolean {
  return diagnostic.code === "SKILL_RESERVED_FOR_ASSISTANT_RUNTIME";
}

function resolveAssistantRuntimeUsageTag(
  directoryName: string
): AssistantRuntimeItemView["usageTag"] {
  return directoryName === "codingns-workspace-session"
    ? "workspace-session"
    : "assistant-only";
}

function resolveAssistantRuntimeUsageTagLabel(
  usageTag: AssistantRuntimeItemView["usageTag"]
): string {
  return usageTag === "workspace-session"
    ? t("settings.skillTagWorkspaceSessionOnly")
    : t("settings.skillTagAssistantOnly");
}

function resolveScanEntryTags(
  entry: SkillScanEntryDto,
  diagnostics: readonly SkillScanDiagnosticDto[]
): SkillTagView[] {
  const matchedDiagnostic = diagnostics.find((diagnostic) =>
    isAssistantRuntimeDiagnostic(diagnostic)
    && diagnostic.targetCli === entry.targetCli
    && diagnostic.directoryName === entry.directoryName
    && diagnostic.directoryPath === entry.directoryPath
  );

  if (!matchedDiagnostic) {
    return [];
  }

  return [
    {
      key: `assistant-runtime:${entry.targetCli}:${entry.directoryPath}`,
      label: t("settings.skillTagAssistantOnly"),
      status: "assistant-runtime"
    }
  ];
}

function resolveDiagnosticTags(diagnostic: SkillScanDiagnosticDto): SkillTagView[] {
  if (!isAssistantRuntimeDiagnostic(diagnostic)) {
    return [];
  }

  return [
    {
      key: `assistant-runtime:${diagnostic.targetCli}:${diagnostic.directoryPath ?? diagnostic.rootDir}`,
      label: t("settings.skillTagAssistantOnly"),
      status: "assistant-runtime"
    }
  ];
}

function prepareSkillUploadDraft(fileName: string, markdownContent: string): SkillUploadDraft {
  const notes: string[] = [];
  const normalizedContent = markdownContent.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();

  if (!normalizedContent) {
    throw new Error(t("settings.skillUploadContentEmpty"));
  }

  if (normalizedContent !== markdownContent.trim()) {
    notes.push(t("settings.skillUploadNormalizedNote"));
  }

  const heading = extractSkillHeading(normalizedContent);
  const directoryName = normalizeUploadedDirectoryName(fileName) ?? normalizeUploadedDirectoryName(heading) ?? "";

  if (!directoryName) {
    notes.push(t("settings.skillUploadDirectoryRequiredNote"));
  }

  if (!heading) {
    notes.push(t("settings.skillUploadHeadingNote"));
  }

  return {
    fileName,
    rawContent: normalizedContent,
    directoryName,
    previewTitle: heading || formatSkillTitleFromDirectoryName(directoryName || "skill"),
    notes
  };
}

async function readTextFromFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return await file.text();
  }

  if (typeof FileReader === "undefined") {
    throw new Error(t("settings.skillUploadReadFailed"));
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error(t("settings.skillUploadReadFailed")));
    };

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(t("settings.skillUploadReadFailed")));
    };

    reader.readAsText(file);
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === "function") {
    const arrayBuffer = await file.arrayBuffer();
    return base64FromUint8Array(new Uint8Array(arrayBuffer));
  }

  if (typeof FileReader === "undefined") {
    throw new Error(t("settings.skillUploadReadFailed"));
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error(t("settings.skillUploadReadFailed")));
    };

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(base64FromUint8Array(new Uint8Array(reader.result)));
        return;
      }

      reject(new Error(t("settings.skillUploadReadFailed")));
    };

    reader.readAsArrayBuffer(file);
  });
}

function base64FromUint8Array(bytes: Uint8Array): string {
  let binary = "";

  bytes.forEach((item) => {
    binary += String.fromCharCode(item);
  });

  return btoa(binary);
}

function normalizeUploadedDirectoryName(input: string): string | null {
  const basename = input.replace(/\\/g, "/").split("/").pop() ?? input;
  const withoutExtension = basename.replace(/\.[A-Za-z0-9]+$/, "");
  const normalized = withoutExtension
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function buildPastedSkillFileName(markdownContent: string): string {
  const normalizedDirectoryName = normalizeUploadedDirectoryName(extractSkillHeading(markdownContent));

  return normalizedDirectoryName ? `${normalizedDirectoryName}.md` : "pasted-skill.md";
}

function extractSkillHeading(markdownContent: string): string {
  return markdownContent.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function formatSkillTitleFromDirectoryName(directoryName: string): string {
  const title = directoryName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

  return title || directoryName;
}
