import type Database from "better-sqlite3";

import type { WorkspaceWorktreeRecord } from "../../types/domain.js";

export class WorkspaceWorktreeRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: WorkspaceWorktreeRecord): WorkspaceWorktreeRecord {
    this.db
      .prepare(
        `INSERT INTO workspace_worktrees (
           workspace_id,
           root_workspace_id,
           parent_workspace_id,
           source_workspace_id,
           merge_target_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           display_name,
           depth,
           lifecycle_status,
           merged_at,
           removed_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.workspaceId,
        record.rootWorkspaceId,
        record.parentWorkspaceId,
        record.sourceWorkspaceId,
        record.mergeTargetWorkspaceId,
        record.branchName,
        record.baseRef,
        record.baseCommit,
        record.headCommit,
        record.displayName,
        record.depth,
        record.lifecycleStatus,
        record.mergedAt,
        record.removedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findByWorkspaceId(workspaceId: string): WorkspaceWorktreeRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           workspace_id,
           root_workspace_id,
           parent_workspace_id,
           source_workspace_id,
           merge_target_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           display_name,
           depth,
           lifecycle_status,
           merged_at,
           removed_at,
           created_at,
           updated_at
         FROM workspace_worktrees
         WHERE workspace_id = ?`
      )
      .get(workspaceId) as WorkspaceWorktreeRow | undefined;

    return row ? mapWorkspaceWorktreeRow(row) : null;
  }

  listWorkspaceIds(): string[] {
    return this.db
      .prepare(
        `SELECT workspace_id
         FROM workspace_worktrees`
      )
      .all()
      .map((row) => (row as Pick<WorkspaceWorktreeRow, "workspace_id">).workspace_id);
  }

  listByRootWorkspaceId(rootWorkspaceId: string): WorkspaceWorktreeRecord[] {
    return this.db
      .prepare(
        `SELECT
           workspace_id,
           root_workspace_id,
           parent_workspace_id,
           source_workspace_id,
           merge_target_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           display_name,
           depth,
           lifecycle_status,
           merged_at,
           removed_at,
           created_at,
           updated_at
         FROM workspace_worktrees
         WHERE root_workspace_id = ?
         ORDER BY depth ASC, updated_at DESC, created_at DESC`
      )
      .all(rootWorkspaceId)
      .map((row) => mapWorkspaceWorktreeRow(row as WorkspaceWorktreeRow));
  }

  listByParentWorkspaceId(parentWorkspaceId: string): WorkspaceWorktreeRecord[] {
    return this.db
      .prepare(
        `SELECT
           workspace_id,
           root_workspace_id,
           parent_workspace_id,
           source_workspace_id,
           merge_target_workspace_id,
           branch_name,
           base_ref,
           base_commit,
           head_commit,
           display_name,
           depth,
           lifecycle_status,
           merged_at,
           removed_at,
           created_at,
           updated_at
         FROM workspace_worktrees
         WHERE parent_workspace_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(parentWorkspaceId)
      .map((row) => mapWorkspaceWorktreeRow(row as WorkspaceWorktreeRow));
  }

  update(record: WorkspaceWorktreeRecord): WorkspaceWorktreeRecord | null {
    this.db
      .prepare(
        `UPDATE workspace_worktrees
         SET root_workspace_id = ?,
             parent_workspace_id = ?,
             source_workspace_id = ?,
             merge_target_workspace_id = ?,
             branch_name = ?,
             base_ref = ?,
             base_commit = ?,
             head_commit = ?,
             display_name = ?,
             depth = ?,
             lifecycle_status = ?,
             merged_at = ?,
             removed_at = ?,
             updated_at = ?
         WHERE workspace_id = ?`
      )
      .run(
        record.rootWorkspaceId,
        record.parentWorkspaceId,
        record.sourceWorkspaceId,
        record.mergeTargetWorkspaceId,
        record.branchName,
        record.baseRef,
        record.baseCommit,
        record.headCommit,
        record.displayName,
        record.depth,
        record.lifecycleStatus,
        record.mergedAt,
        record.removedAt,
        record.updatedAt,
        record.workspaceId
      );

    return this.findByWorkspaceId(record.workspaceId);
  }

  deleteByWorkspaceId(workspaceId: string): void {
    this.db
      .prepare(
        `DELETE FROM workspace_worktrees
         WHERE workspace_id = ?`
      )
      .run(workspaceId);
  }
}

interface WorkspaceWorktreeRow {
  workspace_id: string;
  root_workspace_id: string;
  parent_workspace_id: string;
  source_workspace_id: string;
  merge_target_workspace_id: string;
  branch_name: string;
  base_ref: string;
  base_commit: string;
  head_commit: string | null;
  display_name: string;
  depth: number;
  lifecycle_status: WorkspaceWorktreeRecord["lifecycleStatus"];
  merged_at: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapWorkspaceWorktreeRow(row: WorkspaceWorktreeRow): WorkspaceWorktreeRecord {
  return {
    workspaceId: row.workspace_id,
    rootWorkspaceId: row.root_workspace_id,
    parentWorkspaceId: row.parent_workspace_id,
    sourceWorkspaceId: row.source_workspace_id,
    mergeTargetWorkspaceId: row.merge_target_workspace_id,
    branchName: row.branch_name,
    baseRef: row.base_ref,
    baseCommit: row.base_commit,
    headCommit: row.head_commit,
    displayName: row.display_name,
    depth: row.depth,
    lifecycleStatus: row.lifecycle_status,
    mergedAt: row.merged_at,
    removedAt: row.removed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
