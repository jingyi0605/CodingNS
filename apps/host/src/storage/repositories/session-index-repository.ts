import type Database from "better-sqlite3";

import type { SessionIndexRecord, SessionListItem } from "../../types/domain.js";

export class SessionIndexRepository {
  private readonly upsertStatement: Database.Statement<any[], any>;
  private readonly listByWorkspaceStatement: Database.Statement<any[], any>;
  private readonly findBySessionIdStatement: Database.Statement<any[], any>;
  private readonly findIndexRecordBySessionIdStatement: Database.Statement<any[], any>;
  private readonly renameTitleStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.upsertStatement = this.db.prepare(
      `INSERT INTO session_indices (
         session_id,
         workspace_id,
         provider,
         session_visibility,
         parent_session_id,
         session_kind,
         annotation_source_message_id,
         annotation_source_text,
         is_subagent,
         subagent_label,
         title,
         message_count,
         is_archived,
         last_message_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         provider = excluded.provider,
         session_visibility = excluded.session_visibility,
         parent_session_id = excluded.parent_session_id,
         session_kind = excluded.session_kind,
         annotation_source_message_id = excluded.annotation_source_message_id,
         annotation_source_text = excluded.annotation_source_text,
         is_subagent = excluded.is_subagent,
         subagent_label = excluded.subagent_label,
         title = excluded.title,
         message_count = excluded.message_count,
         is_archived = excluded.is_archived,
         last_message_at = excluded.last_message_at,
         updated_at = excluded.updated_at`
    );
    this.listByWorkspaceStatement = this.db.prepare(
      `SELECT
         indices.session_id AS session_id,
         indices.workspace_id AS workspace_id,
         indices.provider AS provider,
         indices.session_visibility AS session_visibility,
         bindings.provider_session_id AS provider_session_id,
         bindings.raw_store_ref AS raw_store_ref,
         bindings.provider_config_mode AS provider_config_mode,
         bindings.provider_preset_id AS provider_preset_id,
         bindings.selected_model AS selected_model,
         indices.parent_session_id AS parent_session_id,
         indices.session_kind AS session_kind,
         indices.annotation_source_message_id AS annotation_source_message_id,
         indices.annotation_source_text AS annotation_source_text,
         forks.fork_method AS fork_method,
         forks.fork_source_type AS fork_source_type,
         forks.fork_source_session_id AS fork_source_session_id,
         forks.fork_source_message_id AS fork_source_message_id,
         forks.inherited_prefix_message_count AS inherited_prefix_message_count,
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
       LEFT JOIN session_forks forks ON forks.session_id = indices.session_id
       LEFT JOIN session_status_snapshots snapshots ON snapshots.session_id = indices.session_id
       LEFT JOIN session_states states
         ON states.session_id = indices.session_id
       AND states.user_id = ?
       WHERE indices.workspace_id = ?
         AND bindings.user_id = ?
       ORDER BY COALESCE(indices.last_message_at, indices.updated_at) DESC, indices.updated_at DESC`
    );
    this.findBySessionIdStatement = this.db.prepare(
      `SELECT
         indices.session_id AS session_id,
         indices.workspace_id AS workspace_id,
         indices.provider AS provider,
         indices.session_visibility AS session_visibility,
         bindings.provider_session_id AS provider_session_id,
         bindings.raw_store_ref AS raw_store_ref,
         bindings.provider_config_mode AS provider_config_mode,
         bindings.provider_preset_id AS provider_preset_id,
         bindings.selected_model AS selected_model,
         indices.parent_session_id AS parent_session_id,
         indices.session_kind AS session_kind,
         indices.annotation_source_message_id AS annotation_source_message_id,
         indices.annotation_source_text AS annotation_source_text,
         forks.fork_method AS fork_method,
         forks.fork_source_type AS fork_source_type,
         forks.fork_source_session_id AS fork_source_session_id,
         forks.fork_source_message_id AS fork_source_message_id,
         forks.inherited_prefix_message_count AS inherited_prefix_message_count,
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
       LEFT JOIN session_forks forks ON forks.session_id = indices.session_id
       LEFT JOIN session_status_snapshots snapshots ON snapshots.session_id = indices.session_id
       LEFT JOIN session_states states
         ON states.session_id = indices.session_id
       AND states.user_id = ?
       WHERE indices.session_id = ?
         AND bindings.user_id = ?`
    );
    this.findIndexRecordBySessionIdStatement = this.db.prepare(
      `SELECT
         session_id AS session_id,
         workspace_id AS workspace_id,
         provider AS provider,
         session_visibility AS session_visibility,
         parent_session_id AS parent_session_id,
         session_kind AS session_kind,
         annotation_source_message_id AS annotation_source_message_id,
         annotation_source_text AS annotation_source_text,
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
    );
    this.renameTitleStatement = this.db.prepare(
      `UPDATE session_indices
       SET title = ?, updated_at = ?
       WHERE session_id = ?`
    );
  }

  upsert(record: SessionIndexRecord): void {
    this.upsertStatement
      .run(
        record.sessionId,
        record.workspaceId,
        record.provider,
        record.sessionVisibility ?? "workspace",
        record.parentSessionId ?? null,
        record.sessionKind ?? "default",
        record.annotationSourceMessageId ?? null,
        record.annotationSourceText ?? null,
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
    return this.listByWorkspaceStatement.all(userId, workspaceId, userId)
      .map((row) => mapSessionListItemRow(row as SessionListItemRow));
  }

  findBySessionId(sessionId: string, userId: string): SessionListItem | null {
    const row = this.findBySessionIdStatement.get(userId, sessionId, userId) as
      | SessionListItemRow
      | undefined;

    return row ? mapSessionListItemRow(row) : null;
  }

  findIndexRecordBySessionId(sessionId: string): SessionIndexRecord | null {
    const row = this.findIndexRecordBySessionIdStatement.get(sessionId) as SessionIndexRecordRow | undefined;

    return row ? mapSessionIndexRecordRow(row) : null;
  }

  renameTitle(sessionId: string, title: string, updatedAt: string): void {
    this.renameTitleStatement.run(title, updatedAt, sessionId);
  }
}

interface SessionListItemRow {
  session_id: string;
  workspace_id: string;
  provider: SessionListItem["provider"];
  session_visibility: NonNullable<SessionListItem["sessionVisibility"]>;
  provider_session_id: string;
  raw_store_ref: string;
  provider_config_mode: SessionListItem["providerConfigMode"];
  provider_preset_id: string | null;
  selected_model: string | null;
  parent_session_id: string | null;
  session_kind: SessionListItem["sessionKind"];
  annotation_source_message_id: string | null;
  annotation_source_text: string | null;
  fork_method: SessionListItem["forkMethod"];
  fork_source_type: SessionListItem["forkSourceType"];
  fork_source_session_id: string | null;
  fork_source_message_id: string | null;
  inherited_prefix_message_count: number | null;
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
  session_visibility: NonNullable<SessionIndexRecord["sessionVisibility"]>;
  parent_session_id: string | null;
  session_kind: SessionIndexRecord["sessionKind"];
  annotation_source_message_id: string | null;
  annotation_source_text: string | null;
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
    sessionVisibility: row.session_visibility ?? "workspace",
    providerSessionId: row.provider_session_id,
    rawStoreRef: row.raw_store_ref,
    providerConfigMode: row.provider_config_mode,
    providerPresetId: row.provider_preset_id,
    selectedModel: row.selected_model,
    parentSessionId: row.parent_session_id,
    sessionKind: row.session_kind ?? "default",
    annotationSourceMessageId: row.annotation_source_message_id,
    annotationSourceText: row.annotation_source_text,
    forkMethod: row.fork_method ?? null,
    forkSourceType: row.fork_source_type ?? null,
    forkSourceSessionId: row.fork_source_session_id,
    forkSourceMessageId: row.fork_source_message_id,
    inheritedPrefixMessageCount: row.inherited_prefix_message_count ?? null,
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
    sessionVisibility: row.session_visibility ?? "workspace",
    parentSessionId: row.parent_session_id,
    sessionKind: row.session_kind ?? "default",
    annotationSourceMessageId: row.annotation_source_message_id,
    annotationSourceText: row.annotation_source_text,
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
