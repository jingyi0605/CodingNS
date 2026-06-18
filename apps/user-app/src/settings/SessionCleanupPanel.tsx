import { useEffect, useMemo, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import { MobileSheet } from "../components/MobileSheet";
import {
  ModalActions,
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import {
  fetchSessionCleanupDeleteTaskDetail,
  fetchLatestSessionCleanupScan,
  fetchLatestSessionCleanupDeleteTask,
  inspectSessionCleanupArchive,
  triggerSessionCleanupBackup,
  triggerSessionCleanupDelete,
  triggerSessionCleanupRestore,
  triggerSessionCleanupScan,
  type SessionCleanupArchiveInspectionDto,
  type SessionCleanupCandidateDto,
  type SessionCleanupDeleteTaskDetailDto,
  type SessionCleanupLatestDeleteTaskDto,
  type SessionCleanupProvider,
  type SessionCleanupTaskHandleDto
} from "../features/settings/api/session-cleanup-api";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

const DEFAULT_ARCHIVE_PATH = "/tmp/codingns-session-cleanup-backup.cns-session-cleanup";
const ALL_PROVIDERS: SessionCleanupProvider[] = ["codex", "claude-code", "opencode"];

export function SessionCleanupPanel({ compact = false, mobile = false }: { compact?: boolean; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTaskPollingRequested, setDeleteTaskPollingRequested] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [latestCandidates, setLatestCandidates] = useState<SessionCleanupCandidateDto[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [providerFilter, setProviderFilter] = useState<SessionCleanupProvider[]>(ALL_PROVIDERS);
  const [startAtFilter, setStartAtFilter] = useState("");
  const [endAtFilter, setEndAtFilter] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [archivePath, setArchivePath] = useState(DEFAULT_ARCHIVE_PATH);
  const [inspectionPath, setInspectionPath] = useState(DEFAULT_ARCHIVE_PATH);
  const [inspection, setInspection] = useState<SessionCleanupArchiveInspectionDto | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [lastTask, setLastTask] = useState<SessionCleanupTaskHandleDto | null>(null);
  const [latestDeleteTask, setLatestDeleteTask] = useState<SessionCleanupLatestDeleteTaskDto | null>(null);
  const [deleteTaskDetail, setDeleteTaskDetail] = useState<SessionCleanupDeleteTaskDetailDto | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadLatestScan();
  }, [open]);

  useEffect(() => {
    if (!open || (!deleteTaskPollingRequested && (!deleteTaskDetail || !isDeleteTaskActive(deleteTaskDetail.status)))) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadDeleteTaskDetail();
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [deleteTaskDetail, deleteTaskPollingRequested, open]);

  const visibleCandidates = useMemo(
    () => latestCandidates.filter((item) => matchesCandidateFilters(item, providerFilter, startAtFilter, endAtFilter, keywordFilter)),
    [endAtFilter, keywordFilter, latestCandidates, providerFilter, startAtFilter]
  );

  const selectedCandidates = useMemo(
    () => visibleCandidates.filter((item) => selectedCandidateIds.includes(item.candidateId)),
    [selectedCandidateIds, visibleCandidates]
  );

  async function loadLatestScan(): Promise<void> {
    setLoading(true);
    setErrorText(null);

    try {
      const result = await fetchLatestSessionCleanupScan();
      const candidates = result.latestScan?.summary?.candidates ?? [];
      setLatestCandidates(candidates);
      setSelectedCandidateIds((current) => current.filter((candidateId) => candidates.some((item) => item.candidateId === candidateId)));
      const latestDelete = await fetchLatestSessionCleanupDeleteTask();
      setLatestDeleteTask(latestDelete.latestDeleteTask);
      await loadDeleteTaskDetail();
    } catch (error) {
      setErrorText(resolveSessionCleanupError(error, "settings.sessionCleanupLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDeleteTaskDetail(options?: { preserveActiveFallback?: boolean }): Promise<void> {
    const result = await fetchSessionCleanupDeleteTaskDetail();
    setDeleteTaskDetail((current) => {
      const nextTask = result.deleteTask;

      if (!nextTask) {
        return options?.preserveActiveFallback && current && isDeleteTaskActive(current.status) ? current : null;
      }

      return mergeDeleteTaskDetail(current, nextTask);
    });

    if (result.deleteTask && !isDeleteTaskActive(result.deleteTask.status)) {
      setDeleteTaskPollingRequested(false);
    }
  }

  async function handleScan(): Promise<void> {
    setLoading(true);
    setStatusText(null);
    setErrorText(null);

    try {
      const handle = await triggerSessionCleanupScan({
        providers: providerFilter,
        startAt: startAtFilter ? new Date(startAtFilter).toISOString() : null,
        endAt: endAtFilter ? new Date(endAtFilter).toISOString() : null,
        force: true
      });
      setLastTask(handle);
      setStatusText(t("settings.sessionCleanupScanQueued"));
      await loadLatestScan();
    } catch (error) {
      setErrorText(resolveSessionCleanupError(error, "settings.sessionCleanupScanFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleBackup(): Promise<void> {
    if (selectedCandidateIds.length === 0) {
      return;
    }

    setLoading(true);
    setStatusText(null);
    setErrorText(null);

    try {
      const handle = await triggerSessionCleanupBackup({
        candidateIds: selectedCandidateIds,
        archivePath
      });
      setLastTask(handle);
      setInspectionPath(archivePath);
      setStatusText(t("settings.sessionCleanupBackupQueued"));
    } catch (error) {
      setErrorText(resolveSessionCleanupError(error, "settings.sessionCleanupBackupFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleInspectArchive(): Promise<void> {
    if (!inspectionPath.trim()) {
      return;
    }

    setLoading(true);
    setStatusText(null);
    setErrorText(null);

    try {
      const result = await inspectSessionCleanupArchive(inspectionPath.trim());
      setInspection(result);
      setSelectedEntryIds(result.restorableEntries.filter((item) => item.restorable).map((item) => item.entryId));
      setStatusText(t("settings.sessionCleanupArchiveLoaded"));
    } catch (error) {
      setErrorText(resolveSessionCleanupError(error, "settings.sessionCleanupArchiveLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(): Promise<void> {
    if (!inspectionPath.trim() || selectedEntryIds.length === 0) {
      return;
    }

    setLoading(true);
    setStatusText(null);
    setErrorText(null);

    try {
      const handle = await triggerSessionCleanupRestore({
        archivePath: inspectionPath.trim(),
        entryIds: selectedEntryIds
      });
      setLastTask(handle);
      setStatusText(t("settings.sessionCleanupRestoreQueued"));
    } catch (error) {
      setErrorText(resolveSessionCleanupError(error, "settings.sessionCleanupRestoreFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (selectedCandidateIds.length === 0) {
      return;
    }

    setDeleteConfirmOpen(false);
    setLoading(true);
    setStatusText(null);
    setErrorText(null);

    try {
      const selectedCount = selectedCandidateIds.length;
      const handle = await triggerSessionCleanupDelete({
        candidateIds: selectedCandidateIds
      });
      setLastTask(handle);
      setLatestDeleteTask({
        taskId: handle.taskId,
        taskType: handle.taskType,
        status: "queued",
        operationId: null,
        totalCount: selectedCount,
        successCount: 0,
        failedCount: 0,
        partialCount: 0,
        skippedCount: 0,
        conflictCount: 0
      });
      setDeleteTaskDetail(createPendingDeleteTaskDetail(handle, selectedCount));
      setDeleteTaskPollingRequested(true);
      setStatusText(t("settings.sessionCleanupDeleteQueued"));
      await loadDeleteTaskDetail({ preserveActiveFallback: true });
    } catch (error) {
      setErrorText(resolveSessionCleanupError(error, "settings.sessionCleanupDeleteFailed"));
    } finally {
      setLoading(false);
    }
  }

  function toggleCandidate(candidateId: string): void {
    setSelectedCandidateIds((current) =>
      current.includes(candidateId)
        ? current.filter((item) => item !== candidateId)
        : [...current, candidateId]
    );
  }

  function toggleEntry(entryId: string): void {
    setSelectedEntryIds((current) =>
      current.includes(entryId)
        ? current.filter((item) => item !== entryId)
        : [...current, entryId]
    );
  }

  function toggleProvider(provider: SessionCleanupProvider): void {
    setProviderFilter((current) => {
      if (current.includes(provider)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter((item) => item !== provider);
      }

      return [...current, provider];
    });
  }

  function resetFilters(): void {
    setProviderFilter(ALL_PROVIDERS);
    setStartAtFilter("");
    setEndAtFilter("");
    setKeywordFilter("");
  }

  function applyDaysAgoFilter(days: number): void {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    setStartAtFilter("");
    setEndAtFilter(formatDateTimeLocal(cutoffDate));
  }

  function selectAllVisibleCandidates(): void {
    if (visibleCandidates.length === 0) {
      return;
    }

    setSelectedCandidateIds((current) => {
      const visibleIds = visibleCandidates.map((candidate) => candidate.candidateId);
      const allVisibleSelected = visibleIds.every((candidateId) => current.includes(candidateId));

      if (allVisibleSelected) {
        return current.filter((candidateId) => !visibleIds.includes(candidateId));
      }

      const merged = new Set(current);
      for (const candidateId of visibleIds) {
        merged.add(candidateId);
      }
      return Array.from(merged);
    });
  }

  const triggerClassName = compact ? "settings-mobile-primary-button" : "settings-button";
  const body = (
    <div className="settings-session-cleanup-layout">
      {statusText ? <p className="settings-provider-status">{statusText}</p> : null}
      {errorText ? <p className="settings-provider-error">{errorText}</p> : null}

      <div className="settings-session-cleanup-summary-grid" aria-label={t("settings.sessionCleanupSummaryTitle")}>
        <SummaryTile label={t("settings.sessionCleanupSummaryCandidates")} value={String(latestCandidates.length)} />
        <SummaryTile label={t("settings.sessionCleanupSummarySelected")} value={String(selectedCandidateIds.length)} />
        <SummaryTile label={t("settings.sessionCleanupSummaryRestorable")} value={String(inspection?.restorableEntries.length ?? 0)} />
      </div>

      <ModalSection
        heading={t("settings.sessionCleanupFilterSectionTitle")}
        description={t("settings.sessionCleanupFilterSectionDescription")}
      >
        <div className="settings-session-cleanup-filter-grid">
          <ModalField label={t("settings.sessionCleanupFilterProvidersLabel")}>
            <div className="settings-session-cleanup-provider-filter-list">
              {ALL_PROVIDERS.map((provider) => {
                const checked = providerFilter.includes(provider);

                return (
                  <label key={provider} className="settings-session-cleanup-provider-filter-pill">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProvider(provider)}
                    />
                    <span>{resolveProviderLabel(provider)}</span>
                  </label>
                );
              })}
            </div>
          </ModalField>

          <div className="settings-session-cleanup-time-range-grid">
            <ModalField label={t("settings.sessionCleanupFilterStartAtLabel")}>
              <input
                type="datetime-local"
                aria-label={t("settings.sessionCleanupFilterStartAtLabel")}
                className="settings-text-input"
                value={startAtFilter}
                onChange={(event) => setStartAtFilter(event.target.value)}
              />
            </ModalField>
            <ModalField label={t("settings.sessionCleanupFilterEndAtLabel")}>
              <input
                type="datetime-local"
                aria-label={t("settings.sessionCleanupFilterEndAtLabel")}
                className="settings-text-input"
                value={endAtFilter}
                onChange={(event) => setEndAtFilter(event.target.value)}
              />
            </ModalField>
          </div>

          <ModalField label={t("settings.sessionCleanupFilterKeywordLabel")}>
            <input
              type="text"
              aria-label={t("settings.sessionCleanupFilterKeywordLabel")}
              className="settings-text-input"
              value={keywordFilter}
              placeholder={t("settings.sessionCleanupFilterKeywordPlaceholder")}
              onChange={(event) => setKeywordFilter(event.target.value)}
            />
          </ModalField>
        </div>
        <ModalActions align="start">
          <button
            type="button"
            className="secondary-button"
            onClick={() => applyDaysAgoFilter(7)}
          >
            {t("settings.sessionCleanupFilterQuick7Days")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => applyDaysAgoFilter(30)}
          >
            {t("settings.sessionCleanupFilterQuick30Days")}
          </button>
          <button type="button" className="secondary-button" onClick={resetFilters}>
            {t("settings.sessionCleanupFilterResetAction")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={visibleCandidates.length === 0}
            onClick={selectAllVisibleCandidates}
          >
            {t("settings.sessionCleanupSelectAllVisibleAction")}
          </button>
        </ModalActions>
      </ModalSection>

      <ModalSection
        heading={t("settings.sessionCleanupScanSectionTitle")}
        description={t("settings.sessionCleanupScanSectionDescription")}
        actions={(
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => {
              void handleScan();
            }}
          >
            {loading ? t("common.loading") : t("settings.sessionCleanupScanAction")}
          </button>
        )}
      >
        {latestCandidates.length === 0 ? (
          <ModalEmptyState
            compact
            title={t("settings.sessionCleanupEmptyTitle")}
            description={t("settings.sessionCleanupEmptyDescription")}
          />
        ) : visibleCandidates.length === 0 ? (
          <ModalEmptyState
            compact
            title={t("settings.sessionCleanupFilteredEmptyTitle")}
            description={t("settings.sessionCleanupFilteredEmptyDescription")}
          />
        ) : (
          <div className="settings-session-cleanup-list-shell" data-list-kind="scan">
            <ModalList compact>
              {visibleCandidates.map((candidate) => (
                <ModalListItem
                  key={candidate.candidateId}
                  as="button"
                  selected={selectedCandidateIds.includes(candidate.candidateId)}
                  label={candidate.title || t("settings.sessionCleanupUnknownSession")}
                  description={buildCandidateDescription(candidate)}
                  leading={<ProviderBadge provider={candidate.provider} />}
                  trailing={(
                    <input
                      type="checkbox"
                      checked={selectedCandidateIds.includes(candidate.candidateId)}
                      aria-label={t("settings.sessionCleanupSelectCandidate", {
                        title: candidate.title || t("settings.sessionCleanupUnknownSession")
                      })}
                      readOnly
                    />
                  )}
                  onClick={() => toggleCandidate(candidate.candidateId)}
                />
              ))}
            </ModalList>
          </div>
        )}
      </ModalSection>

      <ModalSection
        heading={t("settings.sessionCleanupBackupSectionTitle")}
        description={t("settings.sessionCleanupBackupSectionDescription")}
      >
        <ModalField label={t("settings.sessionCleanupArchivePathLabel")}>
          <input
            aria-label={t("settings.sessionCleanupArchivePathLabel")}
            className="settings-text-input"
            value={archivePath}
            onChange={(event) => setArchivePath(event.target.value)}
          />
        </ModalField>
        <ModalActions align="start">
          <button
            type="button"
            className="settings-button"
            disabled={loading || selectedCandidates.length === 0}
            onClick={() => {
              void handleBackup();
            }}
          >
            {t("settings.sessionCleanupBackupAction")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => {
              void handleInspectArchive();
            }}
          >
            {t("settings.sessionCleanupInspectArchiveAction")}
          </button>
        </ModalActions>
      </ModalSection>

      <ModalSection
        heading={t("settings.sessionCleanupRestoreSectionTitle")}
        description={t("settings.sessionCleanupRestoreSectionDescription")}
      >
        <ModalField label={t("settings.sessionCleanupRestoreArchivePathLabel")}>
          <input
            aria-label={t("settings.sessionCleanupRestoreArchivePathLabel")}
            className="settings-text-input"
            value={inspectionPath}
            onChange={(event) => setInspectionPath(event.target.value)}
          />
        </ModalField>

        {inspection ? (
          <div className="settings-session-cleanup-list-shell" data-list-kind="restore">
            <ModalList compact>
              {inspection.restorableEntries.map((entry) => (
                <ModalListItem
                  key={entry.entryId}
                  as="button"
                  selected={selectedEntryIds.includes(entry.entryId)}
                  label={entry.title || t("settings.sessionCleanupUnknownSession")}
                  description={buildRestoreEntryDescription(entry)}
                  leading={<ProviderBadge provider={entry.provider} />}
                  trailing={(
                    <input
                      type="checkbox"
                      checked={selectedEntryIds.includes(entry.entryId)}
                      aria-label={t("settings.sessionCleanupSelectRestoreEntry", {
                        title: entry.title || t("settings.sessionCleanupUnknownSession")
                      })}
                      disabled={!entry.restorable}
                      readOnly
                    />
                  )}
                  onClick={() => {
                    if (entry.restorable) {
                      toggleEntry(entry.entryId);
                    }
                  }}
                />
              ))}
            </ModalList>
          </div>
        ) : (
          <ModalEmptyState
            compact
            title={t("settings.sessionCleanupArchiveEmptyTitle")}
            description={t("settings.sessionCleanupArchiveEmptyDescription")}
          />
        )}

        <ModalActions align="start">
          <button
            type="button"
            className="settings-button"
            disabled={loading || selectedEntryIds.length === 0}
            onClick={() => {
              void handleRestore();
            }}
          >
            {t("settings.sessionCleanupRestoreAction")}
          </button>
        </ModalActions>
      </ModalSection>

      <ModalSection
        heading={t("settings.sessionCleanupDeleteSectionTitle")}
        description={t("settings.sessionCleanupDeleteSectionDescription")}
        tone="danger"
      >
        <ModalActions align="start">
          <button
            type="button"
            className="settings-button settings-button-danger"
            disabled={loading || selectedCandidateIds.length === 0}
            onClick={() => {
              setDeleteConfirmOpen(true);
            }}
          >
            {t("settings.sessionCleanupDeleteAction")}
          </button>
        </ModalActions>

        {deleteTaskDetail ? (
          <div className="settings-session-cleanup-progress-panel">
            <div className="settings-session-cleanup-progress-header">
              <div>
                <strong>{t("settings.sessionCleanupDeleteProgressTitle")}</strong>
                <p>{buildDeleteTaskStatusText(deleteTaskDetail)}</p>
              </div>
              <ModalTag tone={mapDeleteTaskTone(deleteTaskDetail.status)}>
                {t(`settings.sessionCleanupTaskStatus.${deleteTaskDetail.status}`)}
              </ModalTag>
            </div>
            <div
              className="settings-session-cleanup-progress-bar"
              aria-label={t("settings.sessionCleanupDeleteProgressTitle")}
            >
              <span
                className="settings-session-cleanup-progress-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, deleteTaskDetail.percent ?? 0))}%` }}
              />
            </div>
            <div className="settings-session-cleanup-progress-summary">
              <SummaryTile label={t("settings.sessionCleanupProgressDone")} value={String(deleteTaskDetail.successCount + deleteTaskDetail.partialCount)} />
              <SummaryTile label={t("settings.sessionCleanupProgressFailed")} value={String(deleteTaskDetail.failedCount)} />
              <SummaryTile label={t("settings.sessionCleanupProgressPending")} value={String(Math.max(deleteTaskDetail.totalCount - deleteTaskDetail.items.length, 0))} />
            </div>
            {deleteTaskDetail.items.length > 0 ? (
              <div className="settings-session-cleanup-list-shell" data-list-kind="delete-progress">
                <ModalList compact>
                  {deleteTaskDetail.items.map((item) => (
                    <ModalListItem
                      key={item.id}
                      label={resolveDeleteItemLabel(item, latestCandidates)}
                      description={item.detail || t("settings.sessionCleanupDeleteItemPending")}
                      leading={<ProviderBadge provider={item.provider} />}
                      trailing={<ModalTag tone={mapDeleteItemTone(item.status)}>{t(`settings.sessionCleanupItemStatus.${item.status}`)}</ModalTag>}
                    />
                  ))}
                </ModalList>
              </div>
            ) : null}
          </div>
        ) : null}
      </ModalSection>

      {lastTask || latestDeleteTask ? (
        <div className="settings-session-cleanup-task-note">
          <span>{buildLatestTaskText(lastTask, latestDeleteTask)}</span>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div className={`settings-session-cleanup-entry${compact ? " settings-session-cleanup-entry-compact" : ""}`}>
        <button className={triggerClassName} type="button" onClick={() => setOpen(true)}>
          {t("settings.sessionCleanupOpenAction")}
        </button>
      </div>

      {mobile ? (
        <MobileSheet
          open={open}
          title={t("settings.sessionCleanupModalTitle")}
          description={t("settings.sessionCleanupModalDescription")}
          height="full"
          kind="form"
          className="settings-session-cleanup-modal"
          bodyClassName="settings-session-cleanup-modal-body"
          onClose={() => setOpen(false)}
        >
          {body}
        </MobileSheet>
      ) : (
        <DesktopModal
          open={open}
          title={t("settings.sessionCleanupModalTitle")}
          size="xwide"
          layout="list"
          className="settings-session-cleanup-modal"
          bodyClassName="settings-session-cleanup-modal-body"
          onClose={() => setOpen(false)}
        >
          {body}
        </DesktopModal>
      )}

      {mobile ? (
        <MobileSheet
          open={deleteConfirmOpen}
          title={t("settings.sessionCleanupDeleteConfirmTitle")}
          description={t("settings.sessionCleanupDeleteConfirmDescription")}
          height="auto"
          kind="action"
          onClose={() => setDeleteConfirmOpen(false)}
        >
          <DeleteConfirmBody selectedCount={selectedCandidateIds.length} />
          <ModalActions>
            <button
              type="button"
              className="secondary-button"
              disabled={loading}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="settings-button settings-button-danger"
              disabled={loading || selectedCandidateIds.length === 0}
              onClick={() => {
                void handleDelete();
              }}
            >
              {t("settings.sessionCleanupDeleteConfirmAction")}
            </button>
          </ModalActions>
        </MobileSheet>
      ) : (
        <DesktopModal
          open={deleteConfirmOpen}
          title={t("settings.sessionCleanupDeleteConfirmTitle")}
          description={t("settings.sessionCleanupDeleteConfirmDescription")}
          size="compact"
          layout="confirm"
          onClose={() => setDeleteConfirmOpen(false)}
        >
          <DeleteConfirmBody selectedCount={selectedCandidateIds.length} />
          <ModalActions>
            <button
              type="button"
              className="secondary-button"
              disabled={loading}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="settings-button settings-button-danger"
              disabled={loading || selectedCandidateIds.length === 0}
              onClick={() => {
                void handleDelete();
              }}
            >
              {t("settings.sessionCleanupDeleteConfirmAction")}
            </button>
          </ModalActions>
        </DesktopModal>
      )}
    </>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-session-cleanup-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DeleteConfirmBody({ selectedCount }: { selectedCount: number }) {
  return (
    <div className="settings-session-cleanup-confirm-body">
      <p>{t("settings.sessionCleanupDeleteConfirmSelection", { count: selectedCount })}</p>
      <p>{t("settings.sessionCleanupDeleteConfirmImpact")}</p>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: SessionCleanupProvider }) {
  return <ModalTag tone="default">{resolveProviderLabel(provider)}</ModalTag>;
}

function resolveProviderLabel(provider: SessionCleanupProvider): string {
  switch (provider) {
    case "claude-code":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    default:
      return "Codex";
  }
}

function buildCandidateDescription(candidate: SessionCleanupCandidateDto): string {
  const parts = [
    resolveProviderLabel(candidate.provider),
    candidate.lastMessageAt || candidate.startedAt || t("settings.sessionCleanupTimeUnknown"),
    t(`settings.sessionCleanupSourceHealth.${candidate.sourceHealth}`)
  ];

  if (candidate.workspacePath) {
    parts.push(candidate.workspacePath);
  }

  return parts.join(" · ");
}

function buildRestoreEntryDescription(
  entry: SessionCleanupArchiveInspectionDto["restorableEntries"][number]
): string {
  const parts = [
    resolveProviderLabel(entry.provider),
    entry.lastMessageAt || entry.startedAt || t("settings.sessionCleanupTimeUnknown"),
    entry.completeness === "complete"
      ? t("settings.sessionCleanupRestoreComplete")
      : t("settings.sessionCleanupRestorePartial")
  ];

  if (entry.conflict.hasConflict) {
    parts.push(t("settings.sessionCleanupRestoreConflict"));
  }

  return parts.join(" · ");
}

function resolveSessionCleanupError(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return t(fallbackKey);
}

function buildLatestTaskText(
  lastTask: SessionCleanupTaskHandleDto | null,
  latestDeleteTask: SessionCleanupLatestDeleteTaskDto | null
): string {
  if (latestDeleteTask && (!lastTask || lastTask.taskType === "session_cleanup.delete")) {
    const deletedCount = latestDeleteTask.successCount + latestDeleteTask.partialCount;
    return t("settings.sessionCleanupDeleteTaskHint", {
      taskId: latestDeleteTask.taskId,
      totalCount: latestDeleteTask.totalCount,
      deletedCount,
      failedCount: latestDeleteTask.failedCount
    });
  }

  if (!lastTask) {
    return "";
  }

  return t("settings.sessionCleanupTaskHint", { taskId: lastTask.taskId, taskType: lastTask.taskType });
}

function isDeleteTaskActive(status: SessionCleanupDeleteTaskDetailDto["status"]): boolean {
  return status === "queued" || status === "running";
}

function buildDeleteTaskStatusText(task: SessionCleanupDeleteTaskDetailDto): string {
  const progressPart = task.total
    ? t("settings.sessionCleanupDeleteProgressDetail", {
      current: task.current ?? 0,
      total: task.total
    })
    : t("settings.sessionCleanupDeleteProgressWaiting");

  if (task.detail) {
    return `${progressPart} · ${task.detail}`;
  }

  return progressPart;
}

function resolveDeleteItemLabel(
  item: SessionCleanupDeleteTaskDetailDto["items"][number],
  candidates: SessionCleanupCandidateDto[]
): string {
  const matched = candidates.find((candidate) => candidate.candidateId === item.candidateId);
  return matched?.title || item.sessionId || item.providerSessionId || item.candidateId;
}

function mapDeleteTaskTone(status: SessionCleanupDeleteTaskDetailDto["status"]): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
    case "cancelled":
    case "timeout":
      return "danger";
    case "queue_timeout":
      return "warning";
    default:
      return "default";
  }
}

function mapDeleteItemTone(status: SessionCleanupDeleteTaskDetailDto["items"][number]["status"]): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "success":
      return "success";
    case "partial":
    case "conflict":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "default";
  }
}

function createPendingDeleteTaskDetail(
  handle: SessionCleanupTaskHandleDto,
  totalCount: number
): SessionCleanupDeleteTaskDetailDto {
  return {
    taskId: handle.taskId,
    taskType: handle.taskType,
    status: "queued",
    operationId: null,
    phase: "queued",
    label: t("settings.sessionCleanupTaskStatus.queued"),
    detail: t("settings.sessionCleanupDeleteProgressWaiting"),
    current: 0,
    total: totalCount,
    percent: 0,
    totalCount,
    successCount: 0,
    failedCount: 0,
    partialCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    items: []
  };
}

function mergeDeleteTaskDetail(
  current: SessionCleanupDeleteTaskDetailDto | null,
  nextTask: SessionCleanupDeleteTaskDetailDto
): SessionCleanupDeleteTaskDetailDto {
  if (!current || current.taskId !== nextTask.taskId) {
    return nextTask;
  }

  const fallbackTotalCount = nextTask.totalCount > 0 ? nextTask.totalCount : current.totalCount;
  const fallbackTotal = nextTask.total ?? current.total ?? fallbackTotalCount;
  const fallbackCurrent = nextTask.current ?? current.current ?? 0;
  const fallbackPercent = nextTask.percent ?? current.percent ?? (fallbackTotal > 0
    ? Math.round((fallbackCurrent / fallbackTotal) * 100)
    : 0);

  return {
    ...nextTask,
    totalCount: fallbackTotalCount,
    total: fallbackTotal,
    current: fallbackCurrent,
    percent: fallbackPercent
  };
}

function matchesCandidateFilters(
  candidate: SessionCleanupCandidateDto,
  providerFilter: SessionCleanupProvider[],
  startAtFilter: string,
  endAtFilter: string,
  keywordFilter: string
): boolean {
  if (!providerFilter.includes(candidate.provider)) {
    return false;
  }

  const candidateTime = candidate.lastMessageAt ?? candidate.startedAt;
  if (!candidateTime) {
    return !startAtFilter && !endAtFilter;
  }

  const candidateTimestamp = new Date(candidateTime).getTime();
  if (Number.isNaN(candidateTimestamp)) {
    return false;
  }

  if (startAtFilter) {
    const startTimestamp = new Date(startAtFilter).getTime();
    if (!Number.isNaN(startTimestamp) && candidateTimestamp < startTimestamp) {
      return false;
    }
  }

  if (endAtFilter) {
    const endTimestamp = new Date(endAtFilter).getTime();
    if (!Number.isNaN(endTimestamp) && candidateTimestamp > endTimestamp) {
      return false;
    }
  }

  const normalizedKeyword = keywordFilter.trim().toLowerCase();
  if (normalizedKeyword) {
    const haystack = [
      candidate.title,
      candidate.workspacePath,
      candidate.sessionId,
      candidate.providerSessionId
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(normalizedKeyword)) {
      return false;
    }
  }

  return true;
}

function formatDateTimeLocal(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
