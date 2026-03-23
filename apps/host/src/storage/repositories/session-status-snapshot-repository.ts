import type Database from "better-sqlite3";

import type { SessionStatusSnapshot } from "../../types/domain.js";

export class SessionStatusSnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  findBySessionId(sessionId: string): SessionStatusSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT session_id, sync_status, sync_cursor, last_sync_at, last_error_code, last_error_detail, resumed_at, updated_at
         FROM session_status_snapshots
         WHERE session_id = ?`
      )
      .get(sessionId) as SessionStatusSnapshotRow | undefined;

    return row ? mapSessionStatusSnapshotRow(row) : null;
  }

  upsert(record: SessionStatusSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO session_status_snapshots (
           session_id,
           sync_status,
           sync_cursor,
           last_sync_at,
           last_error_code,
           last_error_detail,
           resumed_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           sync_status = excluded.sync_status,
           sync_cursor = excluded.sync_cursor,
           last_sync_at = excluded.last_sync_at,
           last_error_code = excluded.last_error_code,
           last_error_detail = excluded.last_error_detail,
           resumed_at = excluded.resumed_at,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.syncStatus,
        record.syncCursor,
        record.lastSyncAt,
        record.lastErrorCode,
        record.lastErrorDetail,
        record.resumedAt,
        record.updatedAt
      );
  }
}

interface SessionStatusSnapshotRow {
  session_id: string;
  sync_status: SessionStatusSnapshot["syncStatus"];
  sync_cursor: string | null;
  last_sync_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  resumed_at: string | null;
  updated_at: string;
}

function mapSessionStatusSnapshotRow(row: SessionStatusSnapshotRow): SessionStatusSnapshot {
  return {
    sessionId: row.session_id,
    syncStatus: row.sync_status,
    syncCursor: row.sync_cursor,
    lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail,
    resumedAt: row.resumed_at,
    updatedAt: row.updated_at
  };
}
