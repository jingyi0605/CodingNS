import type Database from "better-sqlite3";

import type { SessionIndexRecord, SessionListItem } from "../../types/domain.js";

export class SessionIndexRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: SessionIndexRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_indices (
           session_id,
           workspace_id,
           provider,
           title,
           message_count,
           last_message_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           provider = excluded.provider,
           title = excluded.title,
           message_count = excluded.message_count,
           last_message_at = excluded.last_message_at,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.workspaceId,
        record.provider,
        record.title,
        record.messageCount,
        record.lastMessageAt,
        record.createdAt,
        record.updatedAt
      );
  }

  listByWorkspace(workspaceId: string): SessionListItem[] {
    return this.db
      .prepare(
        `SELECT
           indices.session_id AS session_id,
           indices.workspace_id AS workspace_id,
           indices.provider AS provider,
           bindings.provider_session_id AS provider_session_id,
           bindings.raw_store_ref AS raw_store_ref,
           indices.title AS title,
           indices.message_count AS message_count,
           indices.last_message_at AS last_message_at,
           indices.created_at AS created_at,
           indices.updated_at AS updated_at,
           snapshots.sync_status AS sync_status,
           snapshots.sync_cursor AS sync_cursor,
           snapshots.last_sync_at AS last_sync_at,
           snapshots.last_error_code AS last_error_code,
           snapshots.last_error_detail AS last_error_detail,
           snapshots.resumed_at AS resumed_at
         FROM session_indices indices
         INNER JOIN session_bindings bindings ON bindings.session_id = indices.session_id
         LEFT JOIN session_status_snapshots snapshots ON snapshots.session_id = indices.session_id
         WHERE indices.workspace_id = ?
         ORDER BY COALESCE(indices.last_message_at, indices.updated_at) DESC, indices.updated_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapSessionListItemRow(row as SessionListItemRow));
  }

  findBySessionId(sessionId: string): SessionListItem | null {
    const row = this.db
      .prepare(
        `SELECT
           indices.session_id AS session_id,
           indices.workspace_id AS workspace_id,
           indices.provider AS provider,
           bindings.provider_session_id AS provider_session_id,
           bindings.raw_store_ref AS raw_store_ref,
           indices.title AS title,
           indices.message_count AS message_count,
           indices.last_message_at AS last_message_at,
           indices.created_at AS created_at,
           indices.updated_at AS updated_at,
           snapshots.sync_status AS sync_status,
           snapshots.sync_cursor AS sync_cursor,
           snapshots.last_sync_at AS last_sync_at,
           snapshots.last_error_code AS last_error_code,
           snapshots.last_error_detail AS last_error_detail,
           snapshots.resumed_at AS resumed_at
         FROM session_indices indices
         INNER JOIN session_bindings bindings ON bindings.session_id = indices.session_id
         LEFT JOIN session_status_snapshots snapshots ON snapshots.session_id = indices.session_id
         WHERE indices.session_id = ?`
      )
      .get(sessionId) as SessionListItemRow | undefined;

    return row ? mapSessionListItemRow(row) : null;
  }
}

interface SessionListItemRow {
  session_id: string;
  workspace_id: string;
  provider: SessionListItem["provider"];
  provider_session_id: string;
  raw_store_ref: string;
  title: string;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SessionListItem["syncStatus"];
  sync_cursor: string | null;
  last_sync_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  resumed_at: string | null;
}

function mapSessionListItemRow(row: SessionListItemRow): SessionListItem {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    rawStoreRef: row.raw_store_ref,
    title: row.title,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    syncCursor: row.sync_cursor,
    lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail,
    resumedAt: row.resumed_at
  };
}
