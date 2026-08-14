import { existsSync } from "node:fs";
import path from "node:path";

import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionCleanupRepository } from "../../storage/repositories/session-cleanup-repository.js";
import type { SessionSourceIndexRepository } from "../../storage/repositories/session-source-index-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type {
  SessionCleanupBackupManifest,
  SessionCleanupBackupManifestEntry,
  SessionCleanupCandidate,
  SessionCleanupItemStatus,
  SessionCleanupOperationItemRecord,
  SessionSourceIndexRecord
} from "../../types/domain.js";
import { SessionCleanupArchiveService, type SessionCleanupArchiveInspection } from "./session-cleanup-archive-service.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";

export interface SessionCleanupScanTaskInput {
  userId: string;
  providers: string[];
  startAt?: string | null;
  endAt?: string | null;
  force?: boolean;
}

export interface SessionCleanupScanTaskResult {
  operationId: string;
  candidateCount: number;
  summary: {
    providers: string[];
    forced: boolean;
    candidates: SessionCleanupCandidate[];
  };
}

export interface SessionCleanupArchiveTaskInput {
  userId: string;
  candidateIds: string[];
  archivePath: string;
}

export interface SessionCleanupArchiveTaskResult {
  operationId: string;
  archiveId: string;
  sessionCount: number;
  archivePath: string;
}

export interface SessionCleanupRestoreTaskInput {
  userId: string;
  archivePath: string;
  entryIds: string[];
}

export interface SessionCleanupRestoreTaskResult {
  operationId: string;
  restoredCount: number;
  archivePath: string;
}

export interface SessionCleanupDeleteTaskInput {
  userId: string;
  candidateIds: string[];
}

export interface SessionCleanupDeleteTaskResult {
  operationId: string;
  deletedCount: number;
}

export interface SessionCleanupButlerResiduePurgeResult {
  bindingCount: number;
  indexCount: number;
  sourceIndexCount: number;
}

export interface SessionCleanupLatestDeleteSummary {
  taskId: string;
  taskType: string;
  status: "queued" | "running" | "queue_timeout" | "succeeded" | "failed" | "cancelled" | "timeout";
  operationId: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  partialCount: number;
  skippedCount: number;
  conflictCount: number;
}

export interface SessionCleanupDeleteTaskDetail {
  taskId: string;
  taskType: string;
  status: "queued" | "running" | "queue_timeout" | "succeeded" | "failed" | "cancelled" | "timeout";
  operationId: string | null;
  phase: string | null;
  label: string | null;
  detail: string | null;
  current: number | null;
  total: number | null;
  percent: number | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  partialCount: number;
  skippedCount: number;
  conflictCount: number;
  items: SessionCleanupOperationItemRecord[];
}

type SessionCleanupDeleteExecutor = (sessionId: string, userId: string) => Promise<void>;
type SessionCleanupDeleteVerificationInput = {
  userId: string;
  workspaceId: string;
  provider: SessionCleanupCandidate["provider"];
  providerSessionId: string | null;
  rawStoreRef: string | null;
};
type SessionCleanupDeleteVerificationExecutor = (
  input: SessionCleanupDeleteVerificationInput
) => Promise<void>;
type SessionCleanupButlerResiduePurgeExecutor = () => Promise<SessionCleanupButlerResiduePurgeResult>;

export class SessionCleanupService {
  private readonly taskManager: TaskManager;
  private deleteExecutor: SessionCleanupDeleteExecutor | null = null;
  private deleteVerificationExecutor: SessionCleanupDeleteVerificationExecutor | null = null;
  private butlerResiduePurgeExecutor: SessionCleanupButlerResiduePurgeExecutor | null = null;

  constructor(
    private readonly repository: Pick<
      SessionCleanupRepository,
      | "findLatestScanByUserId"
      | "insertArchive"
      | "insertOperationItems"
      | "insertScan"
      | "listOperationItemsByOperationId"
      | "updateOperationItem"
    >,
    private readonly sessionBindingRepository: Pick<
      SessionBindingRepository,
      "findByProviderSession" | "findByRawStoreRef" | "findBySessionId" | "listByUserId" | "upsert"
    >,
    private readonly sessionIndexRepository: Pick<
      SessionIndexRepository,
      "findIndexRecordBySessionId" | "upsert"
    >,
    private readonly sessionSourceIndexRepository: Pick<
      SessionSourceIndexRepository,
      "listByWorkspaceId" | "upsert"
    >,
    private readonly workspaceRepository: Pick<WorkspaceRepository, "findById" | "findByPath">,
    taskManager: TaskManager = createTaskManager(),
    private readonly archiveService: SessionCleanupArchiveService = new SessionCleanupArchiveService()
  ) {
    this.taskManager = taskManager;
    this.registerBackgroundTasks();
  }

  requestScan(input: SessionCleanupScanTaskInput): TaskHandle<SessionCleanupScanTaskResult> {
    return this.taskManager.enqueue(HOST_TASK_TYPES.sessionCleanupScan, {
      key: buildUserScopedTaskKey(input.userId, "scan"),
      source: "session_cleanup.scan",
      input
    });
  }

  requestBackup(input: SessionCleanupArchiveTaskInput): TaskHandle<SessionCleanupArchiveTaskResult> {
    return this.taskManager.enqueue(HOST_TASK_TYPES.sessionCleanupBackup, {
      key: buildUserScopedTaskKey(input.userId, "backup"),
      source: "session_cleanup.backup",
      input
    });
  }

  requestRestore(input: SessionCleanupRestoreTaskInput): TaskHandle<SessionCleanupRestoreTaskResult> {
    return this.taskManager.enqueue(HOST_TASK_TYPES.sessionCleanupRestore, {
      key: buildUserScopedTaskKey(input.userId, "restore"),
      source: "session_cleanup.restore",
      input
    });
  }

  requestDelete(input: SessionCleanupDeleteTaskInput): TaskHandle<SessionCleanupDeleteTaskResult> {
    return this.taskManager.enqueue(HOST_TASK_TYPES.sessionCleanupDelete, {
      key: buildUserScopedTaskKey(input.userId, "delete"),
      source: "session_cleanup.delete",
      input
    });
  }

  readLatestScan(userId: string) {
    const record = this.repository.findLatestScanByUserId(userId);

    if (!record) {
      return null;
    }

    const parsedSummary = parseJsonRecord(record.summaryJson);

    return {
      ...record,
      summary: parsedSummary
    };
  }

  async inspectArchive(archivePath: string): Promise<SessionCleanupArchiveInspection> {
    const inspection = await this.archiveService.inspectArchive(archivePath);

    return {
      ...inspection,
      restorableEntries: inspection.restorableEntries.map((entry) => {
        const manifestEntry = inspection.manifest.entries.find((item) => item.entryId === entry.entryId) ?? null;
        const reasons = manifestEntry ? this.resolveRestoreConflictReasons(manifestEntry) : ["entry_missing"];

        return {
          ...entry,
          restorable: entry.restorable && reasons.length === 0,
          conflict: {
            hasConflict: reasons.length > 0,
            reasons
          }
        };
      })
    };
  }

  readLatestDeleteSummary(userId: string): SessionCleanupLatestDeleteSummary | null {
    const snapshot = this.taskManager.peek<SessionCleanupDeleteTaskResult>(
      HOST_TASK_TYPES.sessionCleanupDelete,
      buildUserScopedTaskKey(userId, "delete")
    );

    if (!snapshot) {
      return null;
    }

    const operationId = snapshot.result?.operationId ?? null;
    const items = operationId ? this.repository.listOperationItemsByOperationId(operationId) : [];

    return {
      taskId: snapshot.taskId,
      taskType: snapshot.taskType,
      status: snapshot.status,
      operationId,
      totalCount: items.length,
      successCount: items.filter((item) => item.status === "success").length,
      failedCount: items.filter((item) => item.status === "failed").length,
      partialCount: items.filter((item) => item.status === "partial").length,
      skippedCount: items.filter((item) => item.status === "skipped").length,
      conflictCount: items.filter((item) => item.status === "conflict").length
    };
  }

  readDeleteTaskDetail(userId: string): SessionCleanupDeleteTaskDetail | null {
    const snapshot = this.taskManager.peek<SessionCleanupDeleteTaskResult>(
      HOST_TASK_TYPES.sessionCleanupDelete,
      buildUserScopedTaskKey(userId, "delete")
    );

    if (!snapshot) {
      return null;
    }

    const operationId = snapshot.result?.operationId ?? null;
    const items = operationId ? this.repository.listOperationItemsByOperationId(operationId) : [];
    const counts = summarizeOperationItems(items);

    return {
      taskId: snapshot.taskId,
      taskType: snapshot.taskType,
      status: snapshot.status,
      operationId,
      phase: snapshot.progress?.phase ?? null,
      label: snapshot.progress?.label ?? null,
      detail: snapshot.progress?.detail ?? null,
      current: snapshot.progress?.current ?? null,
      total: snapshot.progress?.total ?? null,
      percent: snapshot.progress?.percent ?? null,
      totalCount: items.length,
      successCount: counts.successCount,
      failedCount: counts.failedCount,
      partialCount: counts.partialCount,
      skippedCount: counts.skippedCount,
      conflictCount: counts.conflictCount,
      items
    };
  }

  configureDeleteExecutor(executor: SessionCleanupDeleteExecutor): void {
    this.deleteExecutor = executor;
  }

  configureDeleteVerificationExecutor(executor: SessionCleanupDeleteVerificationExecutor): void {
    this.deleteVerificationExecutor = executor;
  }

  configureButlerResiduePurgeExecutor(executor: SessionCleanupButlerResiduePurgeExecutor): void {
    this.butlerResiduePurgeExecutor = executor;
  }

  async purgeButlerResidue(): Promise<SessionCleanupButlerResiduePurgeResult> {
    if (!this.butlerResiduePurgeExecutor) {
      throw new Error("session_cleanup.butler_residue_purge_executor_missing");
    }

    return await this.butlerResiduePurgeExecutor();
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.sessionCleanupScan)) {
      this.taskManager.register<SessionCleanupScanTaskInput, SessionCleanupScanTaskResult>({
        taskType: HOST_TASK_TYPES.sessionCleanupScan,
        executionLane: "helper_process",
        timeoutMs: 30_000,
        run: async (input) => this.runScan(input)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.sessionCleanupBackup)) {
      this.taskManager.register<SessionCleanupArchiveTaskInput, SessionCleanupArchiveTaskResult>({
        taskType: HOST_TASK_TYPES.sessionCleanupBackup,
        executionLane: "host_background",
        timeoutMs: 60_000,
        run: async (input) => this.runBackup(input)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.sessionCleanupRestore)) {
      this.taskManager.register<SessionCleanupRestoreTaskInput, SessionCleanupRestoreTaskResult>({
        taskType: HOST_TASK_TYPES.sessionCleanupRestore,
        executionLane: "host_background",
        timeoutMs: 60_000,
        run: async (input) => this.runRestore(input)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.sessionCleanupDelete)) {
      this.taskManager.register<SessionCleanupDeleteTaskInput, SessionCleanupDeleteTaskResult>({
        taskType: HOST_TASK_TYPES.sessionCleanupDelete,
        executionLane: "external_process",
        timeoutMs: 5 * 60_000,
        run: async (input, context) => this.runDelete(input, context.reportProgress.bind(context))
      });
    }
  }

  private async runScan(input: SessionCleanupScanTaskInput): Promise<SessionCleanupScanTaskResult> {
    const operationId = createId();
    const createdAt = nowIso();
    const providers = normalizeProviders(input.providers);
    const candidates = this.buildCandidates(input.userId, providers, input.startAt ?? null, input.endAt ?? null);
    const summary = {
      providers,
      forced: Boolean(input.force),
      candidates
    };

    this.repository.insertScan({
      id: operationId,
      userId: input.userId,
      providerFilterJson: JSON.stringify(providers),
      timeRangeStart: input.startAt ?? null,
      timeRangeEnd: input.endAt ?? null,
      candidateCount: candidates.length,
      summaryJson: JSON.stringify(summary),
      createdAt,
      updatedAt: createdAt
    });

    return {
      operationId,
      candidateCount: candidates.length,
      summary
    };
  }

  private async runBackup(input: SessionCleanupArchiveTaskInput): Promise<SessionCleanupArchiveTaskResult> {
    const operationId = createId();
    const archiveId = createId();
    const createdAt = nowIso();
    const candidateMap = new Map(this.buildCandidates(input.userId, [], null, null).map((item) => [item.candidateId, item]));
    const entries = input.candidateIds.map((candidateId) => {
      const candidate = candidateMap.get(candidateId);

      if (!candidate || !candidate.backupable) {
        throw new Error(`cleanup_candidate_not_backupable:${candidateId}`);
      }

      return this.buildManifestEntry(candidate);
    });
    const manifest = this.buildBackupManifest(input.userId, createdAt, entries);

    await this.archiveService.writeArchive({
      archivePath: input.archivePath,
      manifest
    });

    this.repository.insertArchive({
      id: archiveId,
      userId: input.userId,
      archivePath: input.archivePath,
      manifestVersion: manifest.version,
      sessionCount: manifest.summary.sessionCount,
      summaryJson: JSON.stringify(manifest.summary),
      createdAt,
      updatedAt: createdAt
    });

    this.repository.insertOperationItems(entries.map((entry) => ({
      id: createId(),
      operationId,
      taskKind: "backup",
      candidateId: entry.candidateId,
      provider: entry.provider,
      sessionId: entry.sessionId,
      providerSessionId: entry.providerSessionId,
      rawStoreRef: entry.rawStoreRef,
      status: entry.completeness === "complete" ? "success" : "partial",
      backupStatus: entry.completeness === "complete" ? "archived" : "archived_partial",
      providerDeleteStatus: null,
      localDeleteStatus: null,
      restoreStatus: null,
      detail: entry.completeness === "complete" ? "备份包已写入" : "备份包已写入，但原始文件不完整",
      createdAt,
      updatedAt: createdAt
    })));

    return {
      operationId,
      archiveId,
      sessionCount: manifest.summary.sessionCount,
      archivePath: input.archivePath
    };
  }

  private async runRestore(input: SessionCleanupRestoreTaskInput): Promise<SessionCleanupRestoreTaskResult> {
    const operationId = createId();
    const createdAt = nowIso();
    const manifest = await this.archiveService.readManifest(input.archivePath);
    const selectedEntries = manifest.entries.filter((entry) => input.entryIds.includes(entry.entryId));
    const results: SessionCleanupOperationItemRecord[] = selectedEntries.map((entry) =>
      this.restoreManifestEntry(entry, createdAt, operationId)
    );

    this.repository.insertOperationItems(results);

    return {
      operationId,
      restoredCount: results.filter((item) => item.status === "success").length,
      archivePath: input.archivePath
    };
  }

  private async runDelete(
    input: SessionCleanupDeleteTaskInput,
    reportProgress: (progress: {
      phase: string;
      label?: string | null;
      detail?: string | null;
      current?: number | null;
      total?: number | null;
      percent?: number | null;
    }) => void
  ): Promise<SessionCleanupDeleteTaskResult> {
    const operationId = createId();
    const createdAt = nowIso();
    const candidateMap = new Map(this.buildCandidates(input.userId, [], null, null).map((item) => [item.candidateId, item]));
    const results: SessionCleanupOperationItemRecord[] = [];
    const total = input.candidateIds.length;

    reportProgress({
      phase: "preparing",
      label: "正在准备删除列表",
      detail: `共 ${total} 条待处理会话`,
      current: 0,
      total,
      percent: total > 0 ? 0 : 100
    });

    for (const [index, candidateId] of input.candidateIds.entries()) {
      const candidate = candidateMap.get(candidateId) ?? null;
      const startedAt = nowIso();
      const pendingRecord = createDeleteOperationItem({
        operationId,
        candidateId,
        candidate,
        createdAt,
        updatedAt: startedAt,
        status: "skipped",
        providerDeleteStatus: "pending",
        localDeleteStatus: "pending",
        detail: "等待执行删除"
      });

      this.repository.insertOperationItems([pendingRecord]);
      reportProgress({
        phase: "deleting",
        label: "正在删除会话",
        detail: candidate?.title
          ? `正在处理：${candidate.title}`
          : `正在处理第 ${index + 1} / ${total} 条`,
        current: index,
        total,
        percent: total > 0 ? Math.round((index / total) * 100) : 100
      });

      if (!candidate || !candidate.sessionId) {
        const failedRecord = {
          ...pendingRecord,
          status: "failed" as const,
          providerDeleteStatus: "not_found",
          localDeleteStatus: "not_found",
          detail: "删除失败：候选不存在或缺少本地会话 ID",
          updatedAt: nowIso()
        };
        this.repository.updateOperationItem(failedRecord);
        results.push(failedRecord);
        continue;
      }

      if (!this.deleteExecutor) {
        const skippedRecord = {
          ...pendingRecord,
          status: "skipped" as const,
          providerDeleteStatus: "delete_executor_missing",
          localDeleteStatus: "delete_executor_missing",
          detail: "删除跳过：未配置单条删除执行器",
          updatedAt: nowIso()
        };
        this.repository.updateOperationItem(skippedRecord);
        results.push(skippedRecord);
        continue;
      }

      try {
        await this.deleteExecutor(candidate.sessionId, input.userId);
        let verificationDetail = "已复用单条删除主链路完成级联删除";
        let status: SessionCleanupOperationItemRecord["status"] = "success";

        if (candidate.workspaceId && this.deleteVerificationExecutor) {
          try {
            await this.deleteVerificationExecutor({
              userId: input.userId,
              workspaceId: candidate.workspaceId,
              provider: candidate.provider,
              providerSessionId: candidate.providerSessionId,
              rawStoreRef: candidate.rawStoreRef
            });
          } catch (error) {
            status = "partial";
            verificationDetail = `删除已完成，但删除后复核失败：${
              error instanceof Error ? error.message : "verify_failed"
            }`;
          }
        }

        const successRecord = {
          ...pendingRecord,
          status,
          providerDeleteStatus: "deleted",
          localDeleteStatus: "deleted",
          detail: verificationDetail,
          updatedAt: nowIso()
        };
        this.repository.updateOperationItem(successRecord);
        results.push(successRecord);
      } catch (error) {
        const failedRecord = {
          ...pendingRecord,
          status: "failed" as const,
          providerDeleteStatus: "failed",
          localDeleteStatus: "failed",
          detail: error instanceof Error ? error.message : "删除失败",
          updatedAt: nowIso()
        };
        this.repository.updateOperationItem(failedRecord);
        results.push(failedRecord);
      }

      reportProgress({
        phase: "deleting",
        label: "正在删除会话",
        detail: `已处理 ${index + 1} / ${total} 条`,
        current: index + 1,
        total,
        percent: total > 0 ? Math.round(((index + 1) / total) * 100) : 100
      });
    }

    reportProgress({
      phase: "completed",
      label: "删除任务已完成",
      detail: `成功 ${results.filter((item) => item.status === "success" || item.status === "partial").length} 条，失败 ${results.filter((item) => item.status === "failed").length} 条`,
      current: total,
      total,
      percent: 100
    });

    return {
      operationId,
      deletedCount: results.filter((item) => item.status === "success" || item.status === "partial").length
    };
  }

  private buildCandidates(
    userId: string,
    providers: readonly string[],
    startAt: string | null,
    endAt: string | null
  ): SessionCleanupCandidate[] {
    const allowedProviders = new Set(providers.length > 0 ? providers : ["codex", "claude-code", "opencode"]);
    const bindings = this.sessionBindingRepository.listByUserId(userId);
    const candidates: SessionCleanupCandidate[] = [];
    const startMs = parseOptionalDate(startAt);
    const endMs = parseOptionalDate(endAt);

    for (const binding of bindings) {
      if (!allowedProviders.has(binding.provider)) {
        continue;
      }

      const index = this.sessionIndexRepository.findIndexRecordBySessionId(binding.sessionId);
      const workspace = this.workspaceRepository.findById(binding.workspaceId);
      const sourceIndexes = binding.workspaceId
        ? this.sessionSourceIndexRepository.listByWorkspaceId(binding.workspaceId)
        : [];
      const sourceIndex = sourceIndexes.find(
        (item) =>
          item.provider === binding.provider
          && (
            (binding.rawStoreRef && item.rawStoreRef === binding.rawStoreRef)
            || (binding.providerSessionId && item.providerSessionId === binding.providerSessionId)
          )
      ) ?? null;

      const startedAtValue = index?.createdAt ?? binding.createdAt ?? null;
      const lastMessageAtValue = index?.lastMessageAt ?? null;
      const filterTs = parseOptionalDate(lastMessageAtValue ?? startedAtValue);

      if (startMs !== null && (filterTs === null || filterTs < startMs)) {
        continue;
      }

      if (endMs !== null && (filterTs === null || filterTs > endMs)) {
        continue;
      }

      const sourceHealth = resolveCandidateSourceHealth(binding.rawStoreRef, sourceIndex);
      candidates.push({
        candidateId: buildCandidateId(binding.provider, binding.sessionId, binding.providerSessionId, binding.rawStoreRef),
        provider: binding.provider,
        sessionId: binding.sessionId,
        providerSessionId: binding.providerSessionId,
        rawStoreRef: binding.rawStoreRef,
        workspaceId: binding.workspaceId,
        workspacePath: workspace?.path ?? sourceIndex?.workspacePath ?? null,
        title: index?.title ?? sourceIndex?.title ?? binding.providerSessionId,
        startedAt: startedAtValue,
        lastMessageAt: lastMessageAtValue,
        estimatedBytes: sourceIndex?.fingerprintSizeBytes ?? null,
        sourceHealth,
        deletable: true,
        backupable: sourceHealth !== "missing",
        restorable: false
      });
    }

    return candidates.sort((left, right) => {
      const rightTs = parseOptionalDate(right.lastMessageAt ?? right.startedAt) ?? 0;
      const leftTs = parseOptionalDate(left.lastMessageAt ?? left.startedAt) ?? 0;
      return rightTs - leftTs || left.candidateId.localeCompare(right.candidateId);
    });
  }

  private buildManifestEntry(candidate: SessionCleanupCandidate): SessionCleanupBackupManifestEntry {
    const binding = candidate.sessionId ? this.sessionBindingRepository.findBySessionId(candidate.sessionId) : null;
    const index = candidate.sessionId ? this.sessionIndexRepository.findIndexRecordBySessionId(candidate.sessionId) : null;
    const sourceIndex = this.findSourceIndex(candidate);
    const files = collectEntryFiles(candidate.rawStoreRef, candidate.provider);
    const completeness = files.every((file) => file.status === "included") ? "complete" : "partial";

    return {
      entryId: createId(),
      candidateId: candidate.candidateId,
      provider: candidate.provider,
      sessionId: candidate.sessionId,
      providerSessionId: candidate.providerSessionId,
      rawStoreRef: candidate.rawStoreRef,
      workspaceId: candidate.workspaceId,
      workspacePath: candidate.workspacePath,
      title: candidate.title,
      startedAt: candidate.startedAt,
      lastMessageAt: candidate.lastMessageAt,
      estimatedBytes: candidate.estimatedBytes,
      sourceHealth: candidate.sourceHealth,
      completeness,
      restorable: true,
      bindingSnapshot: binding,
      indexSnapshot: index,
      sourceIndexSnapshot: sourceIndex,
      files
    };
  }

  private buildBackupManifest(
    userId: string,
    createdAt: string,
    entries: SessionCleanupBackupManifestEntry[]
  ): SessionCleanupBackupManifest {
    const providerCounts = entries.reduce<Partial<Record<SessionCleanupCandidate["provider"], number>>>((acc, entry) => {
      acc[entry.provider] = (acc[entry.provider] ?? 0) + 1;
      return acc;
    }, {});

    return {
      version: "session-cleanup.v1.gzip-json",
      createdAt,
      createdBy: userId,
      entries,
      summary: {
        sessionCount: entries.length,
        providerCounts,
        completeCount: entries.filter((entry) => entry.completeness === "complete").length,
        partialCount: entries.filter((entry) => entry.completeness === "partial").length
      }
    };
  }

  private restoreManifestEntry(
    entry: SessionCleanupBackupManifestEntry,
    timestamp: string,
    operationId: string
  ): SessionCleanupOperationItemRecord {
    const conflictReasons = this.resolveRestoreConflictReasons(entry);

    if (conflictReasons.length > 0) {
      return {
        id: createId(),
        operationId,
        taskKind: "restore" as const,
        candidateId: entry.candidateId,
        provider: entry.provider,
        sessionId: entry.sessionId,
        providerSessionId: entry.providerSessionId,
        rawStoreRef: entry.rawStoreRef,
        status: "conflict" as const,
        backupStatus: null,
        providerDeleteStatus: null,
        localDeleteStatus: null,
        restoreStatus: "conflict",
        detail: `恢复冲突：${conflictReasons.join(",")}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
    }

    if (entry.bindingSnapshot) {
      this.sessionBindingRepository.upsert(entry.bindingSnapshot);
    }

    if (entry.indexSnapshot) {
      this.sessionIndexRepository.upsert(entry.indexSnapshot);
    }

    if (entry.sourceIndexSnapshot) {
      this.sessionSourceIndexRepository.upsert(entry.sourceIndexSnapshot);
    }

    const status = entry.completeness === "complete" ? "success" : "partial";

    return {
      id: createId(),
      operationId,
      taskKind: "restore" as const,
      candidateId: entry.candidateId,
      provider: entry.provider,
      sessionId: entry.sessionId,
      providerSessionId: entry.providerSessionId,
      rawStoreRef: entry.rawStoreRef,
      status,
      backupStatus: null,
      providerDeleteStatus: null,
      localDeleteStatus: null,
      restoreStatus: entry.completeness === "complete" ? "restored_index" : "restored_index_partial_source",
      detail: entry.completeness === "complete" ? "已恢复到 CodingNS 可见链路" : "已恢复到 CodingNS 可见链路，但原始文件材料不完整",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private resolveRestoreConflictReasons(entry: SessionCleanupBackupManifestEntry): string[] {
    const reasons: string[] = [];

    if (entry.providerSessionId && this.sessionBindingRepository.findByProviderSession(entry.provider, entry.providerSessionId)) {
      reasons.push("provider_session_exists");
    }

    if (entry.rawStoreRef && this.sessionBindingRepository.findByRawStoreRef(entry.provider, entry.rawStoreRef)) {
      reasons.push("raw_store_ref_exists");
    }

    return reasons;
  }

  private findSourceIndex(candidate: SessionCleanupCandidate): SessionSourceIndexRecord | null {
    if (!candidate.workspaceId) {
      return null;
    }

    return this.sessionSourceIndexRepository.listByWorkspaceId(candidate.workspaceId).find((item) => {
      return item.provider === candidate.provider
        && (
          (candidate.rawStoreRef && item.rawStoreRef === candidate.rawStoreRef)
          || (candidate.providerSessionId && item.providerSessionId === candidate.providerSessionId)
        );
    }) ?? null;
  }
}

function createDeleteOperationItem(input: {
  operationId: string;
  candidateId: string;
  candidate: SessionCleanupCandidate | null;
  createdAt: string;
  updatedAt: string;
  status: SessionCleanupItemStatus;
  providerDeleteStatus: string | null;
  localDeleteStatus: string | null;
  detail: string | null;
}): SessionCleanupOperationItemRecord {
  return {
    id: createId(),
    operationId: input.operationId,
    taskKind: "delete",
    candidateId: input.candidateId,
    provider: input.candidate?.provider ?? "codex",
    sessionId: input.candidate?.sessionId ?? null,
    providerSessionId: input.candidate?.providerSessionId ?? null,
    rawStoreRef: input.candidate?.rawStoreRef ?? null,
    status: input.status,
    backupStatus: null,
    providerDeleteStatus: input.providerDeleteStatus,
    localDeleteStatus: input.localDeleteStatus,
    restoreStatus: null,
    detail: input.detail,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function summarizeOperationItems(items: readonly SessionCleanupOperationItemRecord[]) {
  return {
    successCount: items.filter((item) => item.status === "success").length,
    failedCount: items.filter((item) => item.status === "failed").length,
    partialCount: items.filter((item) => item.status === "partial").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    conflictCount: items.filter((item) => item.status === "conflict").length
  };
}

function buildUserScopedTaskKey(userId: string, suffix: string): string {
  return `${userId}:${suffix}`;
}

function normalizeProviders(providers: readonly string[]): string[] {
  const values = providers
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const text = value.trim();

  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildCandidateId(
  provider: string,
  sessionId: string | null,
  providerSessionId: string,
  rawStoreRef: string
): string {
  return [provider, sessionId ?? "", providerSessionId ?? "", rawStoreRef ?? ""].join("::");
}

function parseOptionalDate(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function resolveCandidateSourceHealth(
  rawStoreRef: string | null,
  sourceIndex: {
    rawStoreRef: string | null;
    providerSessionId: string | null;
    fingerprintSizeBytes: number | null;
  } | null
): SessionCleanupCandidate["sourceHealth"] {
  if (!rawStoreRef && !sourceIndex?.rawStoreRef && !sourceIndex?.providerSessionId) {
    return "missing";
  }

  if (rawStoreRef && sourceIndex?.rawStoreRef && rawStoreRef !== sourceIndex.rawStoreRef) {
    return "conflict";
  }

  if (!sourceIndex || sourceIndex.fingerprintSizeBytes === null) {
    return "partial";
  }

  return "healthy";
}

function collectEntryFiles(
  rawStoreRef: string | null,
  provider: SessionCleanupCandidate["provider"]
): SessionCleanupBackupManifestEntry["files"] {
  if (!rawStoreRef) {
    return [];
  }

  const filePath = rawStoreRef;
  const relativePath = path.posix.join("files", provider, sanitizeRelativeName(path.basename(rawStoreRef)));

  if (!existsSync(filePath)) {
    return [{
      filePath,
      relativePath,
      sizeBytes: 0,
      status: "missing"
    }];
  }

  return [{
    filePath,
    relativePath,
    sizeBytes: 0,
    status: "included"
  }];
}

function sanitizeRelativeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
