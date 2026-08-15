import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import type {
  AssistantRuntimeSkillOverviewItemDto,
  ManagedSkillOverviewItemDto,
  SkillOverviewDto,
  SkillScanDiagnosticDto,
  SkillScanEntryDto,
  SkillScope,
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
import type { ProviderCatalogEntryDto } from "../features/conversation/api/conversation-api";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { useProviderCatalog } from "../features/conversation/capability/provider-catalog-store";
import { ModalActions, ModalEmptyState, ModalList, ModalListItem, ModalSection } from "../components/ModalAtoms";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type PendingActionKey = string | null;
type SkillManagementTabId = "skills";
type SkillUploadSourceMode = "file" | "paste";

interface SkillManagementPanelProps {
  readonly triggerClassName?: string;
  readonly triggerLabel?: string;
  readonly triggerLeading?: ReactNode;
  readonly triggerContent?: ReactNode;
  readonly workspaceId?: string | null;
  readonly sessionId?: string | null;
  readonly initialTab?: SkillManagementTabId;
  readonly triggerMode?: "panel" | "onlyoffice";
}

interface SkillUploadDraft {
  fileName: string;
  rawContent: string;
  directoryName: string;
  previewTitle: string;
  notes: string[];
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

const SKILL_TARGET_OPTIONS: readonly SkillTargetCli[] = [
  "codex",
  "claude-code",
  "gemini",
  "opencode",
  "deepseek-harness"
];
const ASSISTANT_UPLOAD_TARGET_OPTIONS: readonly SkillTargetCli[] = ["codex", "claude-code"];
const SKILL_SCOPE_OPTIONS: readonly SkillScope[] = ["workspace", "assistant"];
const SKILL_UPLOAD_SOURCE_OPTIONS: readonly SkillUploadSourceMode[] = ["file", "paste"];
const EMPTY_PROVIDER_CATALOG_ITEMS: readonly ProviderCatalogEntryDto[] = [];

export function SkillManagementPanel({
  triggerClassName = "secondary-button",
  triggerLabel,
  triggerLeading,
  triggerContent,
  workspaceId = null,
  sessionId = null
}: SkillManagementPanelProps) {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [overview, setOverview] = useState<SkillOverviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<PendingActionKey>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [workspaceSessionMcpModalOpen, setWorkspaceSessionMcpModalOpen] = useState(false);
  const [workspaceSessionMcpStatus, setWorkspaceSessionMcpStatus] = useState<WorkspaceSessionMcpStatusDto | null>(null);
  const [workspaceSessionMcpLoading, setWorkspaceSessionMcpLoading] = useState(false);
  const [uploadDraft, setUploadDraft] = useState<SkillUploadDraft | null>(null);
  const [uploadSourceMode, setUploadSourceMode] = useState<SkillUploadSourceMode>("file");
  const [uploadScope, setUploadScope] = useState<SkillScope>("workspace");
  const [pastedMarkdown, setPastedMarkdown] = useState("");
  const providerCatalogState = useProviderCatalog(modalOpen && Boolean(accessToken));
  const providerCatalogItems = providerCatalogState.items ?? EMPTY_PROVIDER_CATALOG_ITEMS;
  const providerCatalogByTargetCli = useMemo(
    () => buildSkillTargetCatalogMap(providerCatalogItems),
    [providerCatalogItems]
  );
  const [uploadTargets, setUploadTargets] = useState<Record<SkillTargetCli, boolean>>(() =>
    createDefaultUploadTargets("workspace")
  );

  useEffect(() => {
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

    let active = true;
    setLoading(true);

    void fetchSkillOverview()
      .then((nextOverview) => {
        if (!active) {
          return;
        }

        setOverview(nextOverview);
        setPanelError(null);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setPanelError(resolveSkillPanelError(error));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessToken, modalOpen]);

  useEffect(() => {
    setUploadTargets(createDefaultUploadTargets(uploadScope, providerCatalogByTargetCli));
  }, [providerCatalogByTargetCli, uploadScope]);

  async function reloadPanelData(): Promise<void> {
    const nextOverview = await fetchSkillOverview();
    setOverview(nextOverview);
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
      setUploadDraft(prepareSkillUploadDraft(file.name, markdownContent));
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

    if (!currentUploadDraft.directoryName) {
      setPanelError(t("settings.skillUploadDirectoryInvalid"));
      return;
    }

    const selectedTargets = getUploadTargetOptions(uploadScope)
      .filter((targetCli) => uploadTargets[targetCli])
      .filter((targetCli) => isSkillTargetProviderEnabled(targetCli, providerCatalogByTargetCli));

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
        directoryName: currentUploadDraft.directoryName,
        targetCli: selectedTargets
      });
      await reloadPanelData();
      setStatusText(
        t("settings.skillUploadSuccess", {
          name: currentUploadDraft.directoryName
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
  const workspaceSessionMcpSimplified = workspaceSessionMcpStatus?.simplified ?? null;
  const resolvedTriggerLabel = triggerLabel ?? t("settings.skillManageAction");

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        data-open={modalOpen ? "true" : "false"}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
        onClick={() => {
          setPanelError(null);
          setStatusText(null);
          setModalOpen(true);
        }}
      >
        {triggerContent ?? (
          <>
            {triggerLeading}
            <span>{resolvedTriggerLabel}</span>
          </>
        )}
      </button>

      <WorkbenchModal
        open={modalOpen}
        title={t("settings.skillConfigModalTitle")}
        description={t("settings.skillConfigModalDescription")}
        className="settings-skill-modal"
        onClose={() => setModalOpen(false)}
      >
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
                  label={t("settings.skillWorkspaceSessionMcpOverallLabel")}
                  value={workspaceSessionMcpSimplified?.overallState === "ready"
                    ? t("settings.skillWorkspaceSessionMcpStateReady")
                    : workspaceSessionMcpSimplified?.overallState === "partial"
                      ? t("settings.skillWorkspaceSessionMcpStatePartial")
                      : t("settings.skillWorkspaceSessionMcpStateMissing")}
                />
                <SummaryCard
                  label={t("settings.skillWorkspaceSessionMcpCurrentSessionLabel")}
                  value={workspaceSessionMcpSimplified?.currentSessionReady
                    ? t("settings.skillWorkspaceSessionMcpStateReady")
                    : t("settings.skillWorkspaceSessionMcpStateMissing")}
                />
                <SummaryCard
                  label={t("settings.skillWorkspaceSessionMcpCodexLabel")}
                  value={workspaceSessionMcpSimplified?.codexState === "ready"
                    ? t("settings.skillWorkspaceSessionMcpStateReady")
                    : workspaceSessionMcpSimplified?.codexState === "partial"
                      ? t("settings.skillWorkspaceSessionMcpStatePartial")
                      : t("settings.skillWorkspaceSessionMcpStateMissing")}
                />
              </div>
              <ModalList>
                <ModalListItem
                  label={t("settings.skillWorkspaceSessionMcpRuntimeTitle")}
                  description={workspaceSessionMcpSimplified?.currentSessionDetail ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(
                    workspaceSessionMcpSimplified?.currentSessionReady ? "ready" : "missing"
                  )}
                />
                <ModalListItem
                  label="Codex"
                  description={workspaceSessionMcpSimplified?.codexDetail ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpSimplified?.codexState ?? "missing")}
                />
                <ModalListItem
                  label={t("settings.skillWorkspaceSessionMcpGlobalCodingnsLabel")}
                  description={workspaceSessionMcpSimplified?.globalCodingnsDetail ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                  trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpSimplified?.globalCodingnsState ?? "missing")}
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
                description={workspaceSessionMcpSimplified?.globalCodingnsDetail ?? t("settings.skillWorkspaceSessionMcpValueMissing")}
                trailing={renderWorkspaceSessionMcpStateTag(workspaceSessionMcpSimplified?.globalCodingnsState ?? "missing")}
              />
            </ModalList>
          ) : null}
        </ModalSection>

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
                  aria-label={t("settings.skillPasteLabel")}
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
  headerExtra,
  emptyText,
  items,
  renderItem
}: {
  title: string;
  description?: string;
  headerExtra?: ReactNode;
  emptyText: string;
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <section className="settings-skill-section">
      <div className="settings-skill-section-header">
        <h3 className="settings-skill-section-title">{title}</h3>
        {headerExtra ? <div className="settings-skill-section-extra">{headerExtra}</div> : null}
      </div>
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
    case "deepseek-harness":
      return t("settings.skillTargetDeepSeekHarness");
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
    opencode: firstSelectableTarget === "opencode",
    "deepseek-harness": firstSelectableTarget === "deepseek-harness"
  };
}

function getUploadTargetOptions(scope: SkillScope): readonly SkillTargetCli[] {
  return scope === "assistant" ? ASSISTANT_UPLOAD_TARGET_OPTIONS : SKILL_TARGET_OPTIONS;
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
    case "deepseek-harness":
      return "deepseek-harness";
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

function renderWorkspaceSessionMcpStateTag(state: "ready" | "partial" | "missing") {
  const status = state === "ready" ? "synced" : state === "partial" ? "pending" : "failed";
  const label = state === "ready"
    ? t("settings.skillWorkspaceSessionMcpStateReady")
    : state === "partial"
      ? t("settings.skillWorkspaceSessionMcpStatePartial")
      : t("settings.skillWorkspaceSessionMcpStateMissing");

  return (
    <span className="settings-skill-tag" data-status={status}>
      {label}
    </span>
  );
}
