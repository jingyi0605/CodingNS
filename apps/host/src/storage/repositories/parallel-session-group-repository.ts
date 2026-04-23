import type Database from "better-sqlite3";

import type { ParallelSessionGroupRecord } from "../../types/domain.js";

export class ParallelSessionGroupRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ParallelSessionGroupRecord): ParallelSessionGroupRecord {
    this.db
      .prepare(
        `INSERT INTO parallel_session_groups (
           id,
           workspace_id,
           source_type,
           source_session_id,
           source_message_id,
           shared_prompt,
           requested_count,
           anchor_session_id,
           status,
           created_by_user_id,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.sourceType,
        record.sourceSessionId,
        record.sourceMessageId,
        record.sharedPrompt,
        record.requestedCount,
        record.anchorSessionId,
        record.status,
        record.createdByUserId,
        record.createdAt,
        record.updatedAt,
        record.deletedAt
      );

    return record;
  }

  update(record: ParallelSessionGroupRecord): ParallelSessionGroupRecord | null {
    this.db
      .prepare(
        `UPDATE parallel_session_groups
         SET workspace_id = ?,
             source_type = ?,
             source_session_id = ?,
             source_message_id = ?,
             shared_prompt = ?,
             requested_count = ?,
             anchor_session_id = ?,
             status = ?,
             created_by_user_id = ?,
             created_at = ?,
             updated_at = ?,
             deleted_at = ?
         WHERE id = ?`
      )
      .run(
        record.workspaceId,
        record.sourceType,
        record.sourceSessionId,
        record.sourceMessageId,
        record.sharedPrompt,
        record.requestedCount,
        record.anchorSessionId,
        record.status,
        record.createdByUserId,
        record.createdAt,
        record.updatedAt,
        record.deletedAt,
        record.id
      );

    return this.findById(record.id);
  }

  findById(groupId: string): ParallelSessionGroupRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           workspace_id,
           source_type,
           source_session_id,
           source_message_id,
           shared_prompt,
           requested_count,
           anchor_session_id,
           status,
           created_by_user_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_groups
         WHERE id = ?`
      )
      .get(groupId) as ParallelSessionGroupRow | undefined;

    return row ? mapParallelSessionGroupRow(row) : null;
  }

  listByWorkspaceId(workspaceId: string): ParallelSessionGroupRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           workspace_id,
           source_type,
           source_session_id,
           source_message_id,
           shared_prompt,
           requested_count,
           anchor_session_id,
           status,
           created_by_user_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_groups
         WHERE workspace_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapParallelSessionGroupRow(row as ParallelSessionGroupRow));
  }

  listByIds(groupIds: readonly string[]): ParallelSessionGroupRecord[] {
    if (groupIds.length === 0) {
      return [];
    }

    const placeholders = groupIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT
           id,
           workspace_id,
           source_type,
           source_session_id,
           source_message_id,
           shared_prompt,
           requested_count,
           anchor_session_id,
           status,
           created_by_user_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_groups
         WHERE id IN (${placeholders})`
      )
      .all(...groupIds)
      .map((row) => mapParallelSessionGroupRow(row as ParallelSessionGroupRow));
  }
}

interface ParallelSessionGroupRow {
  id: string;
  workspace_id: string;
  source_type: ParallelSessionGroupRecord["sourceType"];
  source_session_id: string | null;
  source_message_id: string | null;
  shared_prompt: string | null;
  requested_count: number;
  anchor_session_id: string | null;
  status: ParallelSessionGroupRecord["status"];
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapParallelSessionGroupRow(row: ParallelSessionGroupRow): ParallelSessionGroupRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceType: row.source_type,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    sharedPrompt: row.shared_prompt,
    requestedCount: row.requested_count,
    anchorSessionId: row.anchor_session_id,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}
