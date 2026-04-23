import type Database from "better-sqlite3";

import type { ParallelSessionMemberRecord } from "../../types/domain.js";

export class ParallelSessionMemberRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ParallelSessionMemberRecord): ParallelSessionMemberRecord {
    this.db
      .prepare(
        `INSERT INTO parallel_session_members (
           group_id,
           session_id,
           ordinal,
           role,
           provider,
           model,
           member_prompt,
           workspace_isolation_mode,
           temporary_workspace_id,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.groupId,
        record.sessionId,
        record.ordinal,
        record.role,
        record.provider,
        record.model,
        record.memberPrompt,
        record.workspaceIsolationMode,
        record.temporaryWorkspaceId,
        record.createdAt,
        record.updatedAt,
        record.deletedAt
      );

    return record;
  }

  update(record: ParallelSessionMemberRecord): ParallelSessionMemberRecord | null {
    this.db
      .prepare(
        `UPDATE parallel_session_members
         SET group_id = ?,
             ordinal = ?,
             role = ?,
             provider = ?,
             model = ?,
             member_prompt = ?,
             workspace_isolation_mode = ?,
             temporary_workspace_id = ?,
             created_at = ?,
             updated_at = ?,
             deleted_at = ?
         WHERE session_id = ?`
      )
      .run(
        record.groupId,
        record.ordinal,
        record.role,
        record.provider,
        record.model,
        record.memberPrompt,
        record.workspaceIsolationMode,
        record.temporaryWorkspaceId,
        record.createdAt,
        record.updatedAt,
        record.deletedAt,
        record.sessionId
      );

    return this.findBySessionId(record.sessionId);
  }

  findBySessionId(sessionId: string): ParallelSessionMemberRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           group_id,
           session_id,
           ordinal,
           role,
           provider,
           model,
           member_prompt,
           workspace_isolation_mode,
           temporary_workspace_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_members
         WHERE session_id = ?`
      )
      .get(sessionId) as ParallelSessionMemberRow | undefined;

    return row ? mapParallelSessionMemberRow(row) : null;
  }

  listByGroupId(groupId: string): ParallelSessionMemberRecord[] {
    return this.db
      .prepare(
        `SELECT
           group_id,
           session_id,
           ordinal,
           role,
           provider,
           model,
           member_prompt,
           workspace_isolation_mode,
           temporary_workspace_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_members
         WHERE group_id = ?
         ORDER BY ordinal ASC, created_at ASC`
      )
      .all(groupId)
      .map((row) => mapParallelSessionMemberRow(row as ParallelSessionMemberRow));
  }

  listBySessionIds(sessionIds: readonly string[]): ParallelSessionMemberRecord[] {
    if (sessionIds.length === 0) {
      return [];
    }

    const placeholders = sessionIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT
           group_id,
           session_id,
           ordinal,
           role,
           provider,
           model,
           member_prompt,
           workspace_isolation_mode,
           temporary_workspace_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_members
         WHERE session_id IN (${placeholders})`
      )
      .all(...sessionIds)
      .map((row) => mapParallelSessionMemberRow(row as ParallelSessionMemberRow));
  }

  listByGroupIds(groupIds: readonly string[]): ParallelSessionMemberRecord[] {
    if (groupIds.length === 0) {
      return [];
    }

    const placeholders = groupIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT
           group_id,
           session_id,
           ordinal,
           role,
           provider,
           model,
           member_prompt,
           workspace_isolation_mode,
           temporary_workspace_id,
           created_at,
           updated_at,
           deleted_at
         FROM parallel_session_members
         WHERE group_id IN (${placeholders})
         ORDER BY group_id ASC, ordinal ASC`
      )
      .all(...groupIds)
      .map((row) => mapParallelSessionMemberRow(row as ParallelSessionMemberRow));
  }
}

interface ParallelSessionMemberRow {
  group_id: string;
  session_id: string;
  ordinal: number;
  role: ParallelSessionMemberRecord["role"];
  provider: ParallelSessionMemberRecord["provider"];
  model: string | null;
  member_prompt: string | null;
  workspace_isolation_mode: ParallelSessionMemberRecord["workspaceIsolationMode"];
  temporary_workspace_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapParallelSessionMemberRow(row: ParallelSessionMemberRow): ParallelSessionMemberRecord {
  return {
    groupId: row.group_id,
    sessionId: row.session_id,
    ordinal: row.ordinal,
    role: row.role,
    provider: row.provider,
    model: row.model,
    memberPrompt: row.member_prompt,
    workspaceIsolationMode: row.workspace_isolation_mode,
    temporaryWorkspaceId: row.temporary_workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}
