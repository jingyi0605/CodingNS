import { useEffect, useState, type ReactNode } from "react";

import type {
  AssistantRuntimeSkillOverviewItemDto,
  ManagedSkillOverviewItemDto,
  SkillOverviewDto,
  SkillScanDiagnosticDto,
  SkillScanEntryDto,
  SkillTargetBindingDto,
  SkillTargetCli
} from "../features/settings/api/skills-api";
import {
  fetchSkillOverview,
  importSkillEntry,
  syncManagedSkillTargets
} from "../features/settings/api/skills-api";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type PendingActionKey = string | null;

export function SkillManagementPanel() {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const [overview, setOverview] = useState<SkillOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingActionKey, setPendingActionKey] = useState<PendingActionKey>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let active = true;

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
        const nextOverview = await fetchSkillOverview();

        if (!active) {
          return;
        }

        setOverview(nextOverview);
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
  }, [accessToken]);

  async function reloadOverview(): Promise<void> {
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
      await reloadOverview();
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
      await reloadOverview();
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

    const targetCli = item.bindings.filter((binding) => binding.enabled).map((binding) => binding.targetCli);

    if (targetCli.length === 0) {
      setPanelError(t("settings.skillSyncTargetMissing"));
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
      await reloadOverview();
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

  return (
    <div className="settings-skill-panel">
      <div className="settings-release-card">
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
            label={t("settings.skillSummaryUnmanagedEntries")}
            value={String(summary.unmanagedEntryCount)}
          />
          <SummaryCard
            label={t("settings.skillSummaryConflictedEntries")}
            value={String(visibleConflictedEntries.length)}
          />
          <SummaryCard
            label={t("settings.skillSummaryAssistantRuntimeEntries")}
            value={String(assistantRuntimeItems.length)}
          />
          <SummaryCard
            label={t("settings.skillSummaryDiagnostics")}
            value={String(visibleDiagnostics.length)}
          />
        </div>

        <div className="settings-release-actions settings-skill-panel-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={!accessToken}
            onClick={() => {
              setModalOpen(true);
            }}
          >
            {t("settings.skillManageAction")}
          </button>
        </div>
      </div>

      <WorkbenchModal
        open={modalOpen}
        title={t("settings.skillConfigModalTitle")}
        description={t("settings.skillConfigModalDescription")}
        className="settings-skill-modal"
        headerActions={(
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
        )}
        onClose={() => setModalOpen(false)}
      >
        <div className="settings-release-meta">
          <span>
            {t("settings.skillScannedAt")}: {loading ? t("common.loading") : formatDateTime(overview?.scannedAt)}
          </span>
        </div>

        {statusText ? <p className="settings-release-status">{statusText}</p> : null}
        {panelError ? <p className="settings-release-status">{panelError}</p> : null}

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
                  <p className="settings-skill-entry-meta">
                    {t("settings.skillDirectoryName")}: {item.skill.directoryName}
                  </p>
                  <p className="settings-skill-entry-meta">
                    {t("settings.skillSsotPath")}: <span className="settings-skill-path">{item.ssotPath}</span>
                  </p>
                  <div className="settings-skill-tags">
                    {item.bindings.map((binding) => (
                      <span
                        key={`${item.skill.id}-${binding.targetCli}`}
                        className="settings-skill-tag"
                        data-status={binding.syncStatus}
                      >
                        {resolveTargetCliLabel(binding.targetCli)} · {resolveBindingStatusLabel(binding.syncStatus)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="settings-skill-entry-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading || pendingActionKey !== null}
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
                    {t("settings.skillSourceCli")}: {resolveTargetCliLabel(entry.targetCli)}
                  </p>
                  <p className="settings-skill-entry-meta">
                    {t("settings.skillDirectoryPath")}: <span className="settings-skill-path">{entry.directoryPath}</span>
                  </p>
                </div>
                <div className="settings-skill-entry-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading || pendingActionKey !== null}
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
                  {t("settings.skillDirectoryName")}: {item.directoryName}
                </p>
                <p className="settings-skill-entry-meta">
                  {t("settings.skillAssistantRuntimeUsedBy")}: {item.usedByTargetCli.map(resolveTargetCliLabel).join(" / ")}
                </p>
                <p className="settings-skill-entry-meta">
                  {t("settings.skillAssistantRuntimeSourcePath")}: <span className="settings-skill-path">{item.sourcePath}</span>
                </p>
                <div className="settings-skill-tags">
                  <span className="settings-skill-tag" data-status="assistant-runtime">
                    {t("settings.skillTagAssistantOnly")}
                  </span>
                  {item.usedByTargetCli.map((targetCli) => (
                    <span
                      key={`${item.directoryName}:${targetCli}`}
                      className="settings-skill-tag"
                      data-status="synced"
                    >
                      {resolveTargetCliLabel(targetCli)}
                    </span>
                  ))}
                </div>
              </div>
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
                    {t("settings.skillSourceCli")}: {resolveTargetCliLabel(entry.targetCli)}
                  </p>
                  <p className="settings-skill-entry-meta">
                    {t("settings.skillDirectoryPath")}: <span className="settings-skill-path">{entry.directoryPath}</span>
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

            return (
              <div
                key={`${diagnostic.targetCli}:${diagnostic.code}:${diagnostic.directoryPath ?? diagnostic.rootDir}`}
                className="settings-skill-entry"
              >
                <div className="settings-skill-entry-main">
                  <strong className="settings-skill-entry-title">
                    {resolveTargetCliLabel(diagnostic.targetCli)} · {diagnostic.code}
                  </strong>
                  <p className="settings-skill-entry-meta">{diagnostic.detail}</p>
                  <p className="settings-skill-entry-meta">
                    {t("settings.skillDirectoryPath")}:{" "}
                    <span className="settings-skill-path">{diagnostic.directoryPath ?? diagnostic.rootDir}</span>
                  </p>
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
    </div>
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
        <div className="settings-skill-entry-list">{items.map((item) => renderItem(item))}</div>
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
    default:
      return t("settings.skillTargetCodex");
  }
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
      usedByTargetCli: item.usedByTargetCli
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
      usedByTargetCli: [entry.targetCli]
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
      usedByTargetCli: [diagnostic.targetCli]
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
