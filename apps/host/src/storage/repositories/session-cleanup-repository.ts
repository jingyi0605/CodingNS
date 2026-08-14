import type Database from "better-sqlite3";

import type {
  SessionCleanupArchiveRecord,
  SessionCleanupOperationItemRecord,
  SessionCleanupScanRecord
} from "../../types/domain.js";

export class SessionCleanupRepository {
  private readonly insertScanStatement: Database.Statement<any[], any>;
  private readonly findLatestScanByUserIdStatement: Database.Statement<any[], any>;
  private readonly insertArchiveStatement: Database.Statement<any[], any>;
  private readonly listArchivesByUserIdStatement: Database.Statement<any[], any>;
  private readonly insertOperationItemStatement: Database.Statement<any[], any>;
  private readonly listOperationItemsByOperationIdStatement: Database.Statement<any[], any>;
  private readonly updateOperationItemStatement: Database.Statement<any[], any>;
  private readonly findLatestOperationItemByUserIdAndTaskKindStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.insertScanStatement = this.db.prepare(
      `INSERT INTO session_cleanup_scans (
         id,
         user_id,
         provider_filter_json,
         time_range_start,
         time_range_end,
         candidate_count,
         summary_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.findLatestScanByUserIdStatement = this.db.prepare(
      `SELECT
         id,
         user_id,
         provider_filter_json,
         time_range_start,
         time_range_end,
         candidate_count,
         summary_json,
         created_at,
         updated_at
       FROM session_cleanup_scans
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    );
    this.insertArchiveStatement = this.db.prepare(
      `INSERT INTO session_cleanup_archives (
         id,
         user_id,
         archive_path,
         manifest_version,
         session_count,
         summary_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.listArchivesByUserIdStatement = this.db.prepare(
      `SELECT
         id,
         user_id,
         archive_path,
         manifest_version,
         session_count,
         summary_json,
         created_at,
         updated_at
       FROM session_cleanup_archives
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC`
    );
    this.insertOperationItemStatement = this.db.prepare(
      `INSERT INTO session_cleanup_operation_items (
         id,
         operation_id,
         task_kind,
         candidate_id,
         provider,
         session_id,
         provider_session_id,
         raw_store_ref,
         status,
         backup_status,
         provider_delete_status,
         local_delete_status,
         restore_status,
         detail,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.listOperationItemsByOperationIdStatement = this.db.prepare(
      `SELECT
         id,
         operation_id,
         task_kind,
         candidate_id,
         provider,
         session_id,
         provider_session_id,
         raw_store_ref,
         status,
         backup_status,
         provider_delete_status,
         local_delete_status,
         restore_status,
         detail,
         created_at,
         updated_at
       FROM session_cleanup_operation_items
       WHERE operation_id = ?
       ORDER BY created_at ASC, id ASC`
    );
    this.updateOperationItemStatement = this.db.prepare(
      `UPDATE session_cleanup_operation_items
       SET status = ?,
           backup_status = ?,
           provider_delete_status = ?,
           local_delete_status = ?,
           restore_status = ?,
           detail = ?,
           updated_at = ?
       WHERE id = ?`
    );
    this.findLatestOperationItemByUserIdAndTaskKindStatement = this.db.prepare(
      `SELECT
         items.id,
         items.operation_id,
         items.task_kind,
         items.candidate_id,
         items.provider,
         items.session_id,
         items.provider_session_id,
         items.raw_store_ref,
         items.status,
         items.backup_status,
         items.provider_delete_status,
         items.local_delete_status,
         items.restore_status,
         items.detail,
         items.created_at,
         items.updated_at
       FROM session_cleanup_operation_items AS items
       INNER JOIN session_cleanup_scans AS scans
         ON scans.id = items.operation_id
       WHERE scans.user_id = ?
         AND items.task_kind = ?
       ORDER BY items.created_at DESC, items.id DESC
       LIMIT 1`
    );
  }

  insertScan(record: SessionCleanupScanRecord): void {
    this.insertScanStatement.run(
      record.id,
      record.userId,
      record.providerFilterJson,
      record.timeRangeStart,
      record.timeRangeEnd,
      record.candidateCount,
      record.summaryJson,
      record.createdAt,
      record.updatedAt
    );
  }

  findLatestScanByUserId(userId: string): SessionCleanupScanRecord | null {
    const row = this.findLatestScanByUserIdStatement.get(userId) as SessionCleanupScanRow | undefined;
    return row ? mapScanRow(row) : null;
  }

  insertArchive(record: SessionCleanupArchiveRecord): void {
    this.insertArchiveStatement.run(
      record.id,
      record.userId,
      record.archivePath,
      record.manifestVersion,
      record.sessionCount,
      record.summaryJson,
      record.createdAt,
      record.updatedAt
    );
  }

  listArchivesByUserId(userId: string): SessionCleanupArchiveRecord[] {
    return this.listArchivesByUserIdStatement
      .all(userId)
      .map((row) => mapArchiveRow(row as SessionCleanupArchiveRow));
  }

  insertOperationItems(records: readonly SessionCleanupOperationItemRecord[]): void {
    const run = this.db.transaction((items: readonly SessionCleanupOperationItemRecord[]) => {
      for (const record of items) {
        this.insertOperationItemStatement.run(
          record.id,
          record.operationId,
          record.taskKind,
          record.candidateId,
          record.provider,
          record.sessionId,
          record.providerSessionId,
          record.rawStoreRef,
          record.status,
          record.backupStatus,
          record.providerDeleteStatus,
          record.localDeleteStatus,
          record.restoreStatus,
          record.detail,
          record.createdAt,
          record.updatedAt
        );
      }
    });

    run(records);
  }

  listOperationItemsByOperationId(operationId: string): SessionCleanupOperationItemRecord[] {
    return this.listOperationItemsByOperationIdStatement
      .all(operationId)
      .map((row) => mapOperationItemRow(row as SessionCleanupOperationItemRow));
  }

  updateOperationItem(record: SessionCleanupOperationItemRecord): void {
    this.updateOperationItemStatement.run(
      record.status,
      record.backupStatus,
      record.providerDeleteStatus,
      record.localDeleteStatus,
      record.restoreStatus,
      record.detail,
      record.updatedAt,
      record.id
    );
  }

  findLatestOperationItemByUserIdAndTaskKind(
    userId: string,
    taskKind: SessionCleanupOperationItemRecord["taskKind"]
  ): SessionCleanupOperationItemRecord | null {
    const row = this.findLatestOperationItemByUserIdAndTaskKindStatement.get(userId, taskKind) as SessionCleanupOperationItemRow | undefined;
    return row ? mapOperationItemRow(row) : null;
  }
}

interface SessionCleanupScanRow {
  id: string;
  user_id: string;
  provider_filter_json: string;
  time_range_start: string | null;
  time_range_end: string | null;
  candidate_count: number;
  summary_json: string;
  created_at: string;
  updated_at: string;
}

interface SessionCleanupArchiveRow {
  id: string;
  user_id: string;
  archive_path: string;
  manifest_version: string;
  session_count: number;
  summary_json: string;
  created_at: string;
  updated_at: string;
}

interface SessionCleanupOperationItemRow {
  id: string;
  operation_id: string;
  task_kind: SessionCleanupOperationItemRecord["taskKind"];
  candidate_id: string;
  provider: SessionCleanupOperationItemRecord["provider"];
  session_id: string | null;
  provider_session_id: string | null;
  raw_store_ref: string | null;
  status: SessionCleanupOperationItemRecord["status"];
  backup_status: string | null;
  provider_delete_status: string | null;
  local_delete_status: string | null;
  restore_status: string | null;
  detail: string | null;
  created_at: string;
  updated_at: string;
}

function mapScanRow(row: SessionCleanupScanRow): SessionCleanupScanRecord {
  return {
    id: row.id,
    userId: row.user_id,
    providerFilterJson: row.provider_filter_json,
    timeRangeStart: row.time_range_start,
    timeRangeEnd: row.time_range_end,
    candidateCount: row.candidate_count,
    summaryJson: row.summary_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapArchiveRow(row: SessionCleanupArchiveRow): SessionCleanupArchiveRecord {
  return {
    id: row.id,
    userId: row.user_id,
    archivePath: row.archive_path,
    manifestVersion: row.manifest_version,
    sessionCount: row.session_count,
    summaryJson: row.summary_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOperationItemRow(row: SessionCleanupOperationItemRow): SessionCleanupOperationItemRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    taskKind: row.task_kind,
    candidateId: row.candidate_id,
    provider: row.provider,
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id,
    rawStoreRef: row.raw_store_ref,
    status: row.status,
    backupStatus: row.backup_status,
    providerDeleteStatus: row.provider_delete_status,
    localDeleteStatus: row.local_delete_status,
    restoreStatus: row.restore_status,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
