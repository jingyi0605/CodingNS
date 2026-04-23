import type Database from "better-sqlite3";

import type { SessionIsolatedWorkspaceRecord } from "../../types/domain.js";

export class SessionIsolatedWorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: SessionIsolatedWorkspaceRecord): SessionIsolatedWorkspaceRecord {
    this.db
      .prepare(
        `INSERT INTO session_isolated_workspaces (
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.groupId,
        record.ownerSessionId,
        record.workspaceId,
        record.sourceWorkspaceId,
        record.branchName,
        record.baseRef,
        record.baseCommit,
        record.headCommit,
        record.lifecycleStatus,
        record.promotedAt,
        record.removedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  update(record: SessionIsolatedWorkspaceRecord): SessionIsolatedWorkspaceRecord | null {
    this.db
      .prepare(
        `UPDATE session_isolated_workspaces
         SET group_id = ?,
             owner_session_id = ?,
             workspace_id = ?,
             source_workspace_id = ?,
             branch_name = ?,
             base_ref = ?,
             base_commit = ?,
             head_commit = ?,
             lifecycle_status = ?,
             promoted_at = ?,
             removed_at = ?,
             created_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.groupId,
        record.ownerSessionId,
        record.workspaceId,
        record.sourceWorkspaceId,
        record.branchName,
        record.baseRef,
        record.baseCommit,
        record.headCommit,
        record.lifecycleStatus,
        record.promotedAt,
        record.removedAt,
        record.createdAt,
        record.updatedAt,
        record.id
      );

    return this.findById(record.id);
  }

  findById(id: string): SessionIsolatedWorkspaceRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE id = ?`
      )
      .get(id) as SessionIsolatedWorkspaceRow | undefined;

    return row ? mapSessionIsolatedWorkspaceRow(row) : null;
  }

  findByOwnerSessionId(ownerSessionId: string): SessionIsolatedWorkspaceRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE owner_session_id = ?`
      )
      .get(ownerSessionId) as SessionIsolatedWorkspaceRow | undefined;

    return row ? mapSessionIsolatedWorkspaceRow(row) : null;
  }

  findByWorkspaceId(workspaceId: string): SessionIsolatedWorkspaceRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE workspace_id = ?`
      )
      .get(workspaceId) as SessionIsolatedWorkspaceRow | undefined;

    return row ? mapSessionIsolatedWorkspaceRow(row) : null;
  }

  listByGroupId(groupId: string): SessionIsolatedWorkspaceRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE group_id = ?
         ORDER BY created_at ASC`
      )
      .all(groupId)
      .map((row) => mapSessionIsolatedWorkspaceRow(row as SessionIsolatedWorkspaceRow));
  }

  listByOwnerSessionIds(ownerSessionIds: readonly string[]): SessionIsolatedWorkspaceRecord[] {
    if (ownerSessionIds.length === 0) {
      return [];
    }

    const placeholders = ownerSessionIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE owner_session_id IN (${placeholders})`
      )
      .all(...ownerSessionIds)
      .map((row) => mapSessionIsolatedWorkspaceRow(row as SessionIsolatedWorkspaceRow));
  }

  listByLifecycleStatuses(
    lifecycleStatuses: readonly SessionIsolatedWorkspaceRecord["lifecycleStatus"][]
  ): SessionIsolatedWorkspaceRecord[] {
    if (lifecycleStatuses.length === 0) {
      return [];
    }

    const placeholders = lifecycleStatuses.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE lifecycle_status IN (${placeholders})`
      )
      .all(...lifecycleStatuses)
      .map((row) => mapSessionIsolatedWorkspaceRow(row as SessionIsolatedWorkspaceRow));
  }

  listBySourceWorkspaceId(sourceWorkspaceId: string): SessionIsolatedWorkspaceRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           group_id,
           owner_session_id,
           workspace_id,
           source_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           lifecycle_status,
           promoted_at,
           removed_at,
           created_at,
           updated_at
         FROM session_isolated_workspaces
         WHERE source_workspace_id = ?
         ORDER BY created_at ASC`
      )
      .all(sourceWorkspaceId)
      .map((row) => mapSessionIsolatedWorkspaceRow(row as SessionIsolatedWorkspaceRow));
  }
}

interface SessionIsolatedWorkspaceRow {
  id: string;
  group_id: string;
  owner_session_id: string;
  workspace_id: string;
  source_workspace_id: string;
  branch_name: string;
  base_ref: string;
  base_commit: string;
  head_commit: string | null;
  lifecycle_status: SessionIsolatedWorkspaceRecord["lifecycleStatus"];
  promoted_at: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapSessionIsolatedWorkspaceRow(
  row: SessionIsolatedWorkspaceRow
): SessionIsolatedWorkspaceRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    ownerSessionId: row.owner_session_id,
    workspaceId: row.workspace_id,
    sourceWorkspaceId: row.source_workspace_id,
    branchName: row.branch_name,
    baseRef: row.base_ref,
    baseCommit: row.base_commit,
    headCommit: row.head_commit,
    lifecycleStatus: row.lifecycle_status,
    promotedAt: row.promoted_at,
    removedAt: row.removed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
