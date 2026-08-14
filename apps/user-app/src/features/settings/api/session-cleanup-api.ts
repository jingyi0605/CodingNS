import { httpClient } from "../../../network/http-client";

export type SessionCleanupProvider = "codex" | "claude-code" | "opencode";
export type SessionCleanupSourceHealth = "healthy" | "partial" | "missing" | "conflict";
export type SessionCleanupItemStatus = "success" | "partial" | "failed" | "skipped" | "conflict";

export interface SessionCleanupCandidateDto {
  candidateId: string;
  provider: SessionCleanupProvider;
  sessionId: string | null;
  providerSessionId: string | null;
  rawStoreRef: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
  title: string | null;
  startedAt: string | null;
  lastMessageAt: string | null;
  estimatedBytes: number | null;
  sourceHealth: SessionCleanupSourceHealth;
  deletable: boolean;
  backupable: boolean;
  restorable: boolean;
}

export interface SessionCleanupLatestScanDto {
  id: string;
  userId: string;
  providerFilterJson: string;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
  summary: {
    providers?: string[];
    forced?: boolean;
    candidates?: SessionCleanupCandidateDto[];
  } | null;
}

export interface SessionCleanupTaskHandleDto {
  taskId: string;
  taskType: string;
  key: string;
  deduped: boolean;
}

export interface SessionCleanupLatestDeleteTaskDto {
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

export interface SessionCleanupDeleteTaskDetailDto {
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
  items: Array<{
    id: string;
    operationId: string;
    taskKind: "scan" | "backup" | "restore" | "delete";
    candidateId: string;
    provider: SessionCleanupProvider;
    sessionId: string | null;
    providerSessionId: string | null;
    rawStoreRef: string | null;
    status: SessionCleanupItemStatus;
    backupStatus: string | null;
    providerDeleteStatus: string | null;
    localDeleteStatus: string | null;
    restoreStatus: string | null;
    detail: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface SessionCleanupArchiveInspectionDto {
  manifest: {
    version: string;
    createdAt: string;
    createdBy: string | null;
    entries: Array<{
      entryId: string;
      candidateId: string;
      provider: SessionCleanupProvider;
      title: string | null;
      startedAt: string | null;
      lastMessageAt: string | null;
      completeness: "complete" | "partial";
      restorable: boolean;
    }>;
    summary: {
      sessionCount: number;
      completeCount: number;
      partialCount: number;
      providerCounts: Partial<Record<SessionCleanupProvider, number>>;
    };
  };
  restorableEntries: Array<{
    entryId: string;
    candidateId: string;
    provider: SessionCleanupProvider;
    title: string | null;
    startedAt: string | null;
    lastMessageAt: string | null;
    completeness: "complete" | "partial";
    restorable: boolean;
    conflict: {
      hasConflict: boolean;
      reasons: string[];
    };
  }>;
}

export async function fetchLatestSessionCleanupScan(): Promise<{
  latestScan: SessionCleanupLatestScanDto | null;
}> {
  return await httpClient.request("/api/settings/session-cleanup/scans/latest");
}

export async function triggerSessionCleanupScan(input: {
  providers?: SessionCleanupProvider[];
  startAt?: string | null;
  endAt?: string | null;
  force?: boolean;
}): Promise<SessionCleanupTaskHandleDto> {
  return await httpClient.request("/api/settings/session-cleanup/scans", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function triggerSessionCleanupBackup(input: {
  candidateIds: string[];
  archivePath: string;
}): Promise<SessionCleanupTaskHandleDto> {
  return await httpClient.request("/api/settings/session-cleanup/backups", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function inspectSessionCleanupArchive(archivePath: string): Promise<SessionCleanupArchiveInspectionDto> {
  return await httpClient.request("/api/settings/session-cleanup/backup-inspections", {
    method: "POST",
    body: JSON.stringify({
      archivePath
    })
  });
}

export async function triggerSessionCleanupRestore(input: {
  archivePath: string;
  entryIds: string[];
}): Promise<SessionCleanupTaskHandleDto> {
  return await httpClient.request("/api/settings/session-cleanup/restores", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function triggerSessionCleanupDelete(input: {
  candidateIds: string[];
}): Promise<SessionCleanupTaskHandleDto> {
  return await httpClient.request("/api/settings/session-cleanup/deletions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchLatestSessionCleanupDeleteTask(): Promise<{
  latestDeleteTask: SessionCleanupLatestDeleteTaskDto | null;
}> {
  return await httpClient.request("/api/settings/session-cleanup/tasks/latest-delete");
}

export async function fetchSessionCleanupDeleteTaskDetail(): Promise<{
  deleteTask: SessionCleanupDeleteTaskDetailDto | null;
}> {
  return await httpClient.request("/api/settings/session-cleanup/tasks/delete-detail");
}
