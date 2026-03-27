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
           parent_session_id,
           is_subagent,
           subagent_label,
           title,
           message_count,
           is_archived,
           last_message_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           provider = excluded.provider,
           parent_session_id = excluded.parent_session_id,
           is_subagent = excluded.is_subagent,
           subagent_label = excluded.subagent_label,
           title = excluded.title,
           message_count = excluded.message_count,
           is_archived = excluded.is_archived,
           last_message_at = excluded.last_message_at,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.workspaceId,
        record.provider,
        record.parentSessionId ?? null,
        record.isSubagent ? 1 : 0,
        record.subagentLabel ?? null,
        record.title,
        record.messageCount,
        record.isArchived ? 1 : 0,
        record.lastMessageAt,
        record.createdAt,
        record.updatedAt
      );
  }

  listByWorkspace(workspaceId: string, userId: string): SessionListItem[] {
    return this.db
      .prepare(
        `SELECT
           indices.session_id AS session_id,
           indices.workspace_id AS workspace_id,
           indices.provider AS provider,
           bindings.provider_session_id AS provider_session_id,
           bindings.raw_store_ref AS raw_store_ref,
           indices.parent_session_id AS parent_session_id,
           indices.is_subagent AS is_subagent,
           indices.subagent_label AS subagent_label,
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
           snapshots.resumed_at AS resumed_at,
           states.running_state AS running_state,
           COALESCE(states.activity_source, 'none') AS activity_source,
           COALESCE(states.favorite, 0) AS favorite,
           indices.is_archived AS is_archived,
           states.last_event_at AS last_event_at,
           states.completed_at AS completed_at,
           states.last_seen_at AS last_seen_at
         FROM session_indices indices
         INNER JOIN session_bindings bindings ON bindings.session_id = indices.session_id
         LEFT JOIN session_status_snapshots snapshots ON snapshots.session_id = indices.session_id
         LEFT JOIN session_states states
           ON states.session_id = indices.session_id
          AND states.user_id = ?
         WHERE indices.workspace_id = ?
         ORDER BY COALESCE(indices.last_message_at, indices.updated_at) DESC, indices.updated_at DESC`
      )
      .all(userId, workspaceId)
      .map((row) => mapSessionListItemRow(row as SessionListItemRow));
  }

  findBySessionId(sessionId: string, userId: string): SessionListItem | null {
    const row = this.db
      .prepare(
        `SELECT
           indices.session_id AS session_id,
           indices.workspace_id AS workspace_id,
           indices.provider AS provider,
           bindings.provider_session_id AS provider_session_id,
           bindings.raw_store_ref AS raw_store_ref,
           indices.parent_session_id AS parent_session_id,
           indices.is_subagent AS is_subagent,
           indices.subagent_label AS subagent_label,
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
           snapshots.resumed_at AS resumed_at,
           states.running_state AS running_state,
           COALESCE(states.activity_source, 'none') AS activity_source,
           COALESCE(states.favorite, 0) AS favorite,
           indices.is_archived AS is_archived,
           states.last_event_at AS last_event_at,
           states.completed_at AS completed_at,
           states.last_seen_at AS last_seen_at
         FROM session_indices indices
         INNER JOIN session_bindings bindings ON bindings.session_id = indices.session_id
         LEFT JOIN session_status_snapshots snapshots ON snapshots.session_id = indices.session_id
         LEFT JOIN session_states states
           ON states.session_id = indices.session_id
          AND states.user_id = ?
         WHERE indices.session_id = ?`
      )
      .get(userId, sessionId) as SessionListItemRow | undefined;

    return row ? mapSessionListItemRow(row) : null;
  }

  findIndexRecordBySessionId(sessionId: string): SessionIndexRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id AS session_id,
           workspace_id AS workspace_id,
           provider AS provider,
           parent_session_id AS parent_session_id,
           is_subagent AS is_subagent,
           subagent_label AS subagent_label,
           title AS title,
           message_count AS message_count,
           is_archived AS is_archived,
           last_message_at AS last_message_at,
           created_at AS created_at,
           updated_at AS updated_at
         FROM session_indices
         WHERE session_id = ?`
      )
      .get(sessionId) as SessionIndexRecordRow | undefined;

    return row ? mapSessionIndexRecordRow(row) : null;
  }

  renameTitle(sessionId: string, title: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE session_indices
         SET title = ?, updated_at = ?
         WHERE session_id = ?`
      )
      .run(title, updatedAt, sessionId);
  }
}

interface SessionListItemRow {
  session_id: string;
  workspace_id: string;
  provider: SessionListItem["provider"];
  provider_session_id: string;
  raw_store_ref: string;
  parent_session_id: string | null;
  is_subagent: number;
  subagent_label: string | null;
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
  running_state: SessionListItem["runningState"];
  activity_source: SessionListItem["activitySource"];
  favorite: number;
  is_archived: number;
  last_event_at: string | null;
  completed_at: string | null;
  last_seen_at: string | null;
}

interface SessionIndexRecordRow {
  session_id: string;
  workspace_id: string;
  provider: SessionIndexRecord["provider"];
  parent_session_id: string | null;
  is_subagent: number;
  subagent_label: string | null;
  title: string;
  message_count: number;
  is_archived: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapSessionListItemRow(row: SessionListItemRow): SessionListItem {
  const isRuntimeActive =
    row.activity_source === "runtime"
    && (row.running_state === "starting" || row.running_state === "running");
  const isInferredActive = row.activity_source === "inferred" && row.running_state === "running";
  const hasUnreadCompletion =
    row.activity_source !== "none"
    && !!row.completed_at
    && (!row.last_seen_at || row.completed_at > row.last_seen_at);
  const activityState =
    isRuntimeActive || isInferredActive
      ? "running"
      : hasUnreadCompletion
        ? "completed_unread"
        : "idle";

  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    rawStoreRef: row.raw_store_ref,
    parentSessionId: row.parent_session_id,
    isSubagent: row.is_subagent === 1,
    subagentLabel: row.subagent_label,
    title: row.title,
    isFavorite: row.favorite === 1,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    syncCursor: row.sync_cursor,
    lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail,
    resumedAt: row.resumed_at,
    runningState: row.running_state,
    activitySource: row.activity_source,
    isArchived: row.is_archived === 1,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
    lastSeenAt: row.last_seen_at,
    activityState
  };
}

function mapSessionIndexRecordRow(row: SessionIndexRecordRow): SessionIndexRecord {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    parentSessionId: row.parent_session_id,
    isSubagent: row.is_subagent === 1,
    subagentLabel: row.subagent_label,
    title: row.title,
    messageCount: row.message_count,
    isArchived: row.is_archived === 1,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
