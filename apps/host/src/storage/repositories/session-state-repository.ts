import type Database from "better-sqlite3";

import type { SessionState } from "../../types/domain.js";

export class SessionStateRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: SessionState): void {
    this.db
      .prepare(
        `INSERT INTO session_states (
           session_id,
           sync_cursor,
           last_sync_at,
           sync_error_code,
           sync_error_message,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           sync_cursor = excluded.sync_cursor,
           last_sync_at = excluded.last_sync_at,
           sync_error_code = excluded.sync_error_code,
           sync_error_message = excluded.sync_error_message,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.syncCursor,
        record.lastSyncAt,
        record.syncErrorCode,
        record.syncErrorMessage,
        record.updatedAt
      );
  }

  findBySessionId(sessionId: string): SessionState | null {
    const row = this.db
      .prepare(
        `SELECT session_id, sync_cursor, last_sync_at, sync_error_code, sync_error_message, updated_at
         FROM session_states
         WHERE session_id = ?`
      )
      .get(sessionId) as SessionStateRow | undefined;

    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      syncCursor: row.sync_cursor,
      lastSyncAt: row.last_sync_at,
      syncErrorCode: row.sync_error_code,
      syncErrorMessage: row.sync_error_message,
      updatedAt: row.updated_at
    };
  }
}

interface SessionStateRow {
  session_id: string;
  sync_cursor: string | null;
  last_sync_at: string | null;
  sync_error_code: string | null;
  sync_error_message: string | null;
  updated_at: string;
}
