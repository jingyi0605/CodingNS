import type Database from "better-sqlite3";

import type { DebugTargetProfile } from "../../types/domain.js";

export class DebugTargetRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: DebugTargetProfile): DebugTargetProfile {
    this.db
      .prepare(
        `INSERT INTO debug_targets (
          id,
          workspace_id,
          root_path,
          display_name,
          stack_hint,
          source_type,
          root_workspace_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.rootPath,
        record.displayName,
        record.stackHint ?? null,
        record.sourceType,
        record.rootWorkspaceId ?? null,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  update(record: DebugTargetProfile): DebugTargetProfile | null {
    this.db
      .prepare(
        `UPDATE debug_targets
         SET display_name = ?,
             stack_hint = ?,
             source_type = ?,
             root_workspace_id = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.displayName,
        record.stackHint ?? null,
        record.sourceType,
        record.rootWorkspaceId ?? null,
        record.updatedAt,
        record.id
      );

    return this.findById(record.id);
  }

  findById(id: string): DebugTargetProfile | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          root_path,
          display_name,
          stack_hint,
          source_type,
          root_workspace_id,
          created_at,
          updated_at
        FROM debug_targets
        WHERE id = ?`
      )
      .get(id) as DebugTargetRow | undefined;

    return row ? mapDebugTargetRow(row) : null;
  }

  findByWorkspaceAndRootPath(workspaceId: string, rootPath: string): DebugTargetProfile | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          root_path,
          display_name,
          stack_hint,
          source_type,
          root_workspace_id,
          created_at,
          updated_at
        FROM debug_targets
        WHERE workspace_id = ? AND root_path = ?`
      )
      .get(workspaceId, rootPath) as DebugTargetRow | undefined;

    return row ? mapDebugTargetRow(row) : null;
  }

  listByWorkspaceId(workspaceId: string): DebugTargetProfile[] {
    return this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          root_path,
          display_name,
          stack_hint,
          source_type,
          root_workspace_id,
          created_at,
          updated_at
        FROM debug_targets
        WHERE workspace_id = ?
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapDebugTargetRow(row as DebugTargetRow));
  }
}

interface DebugTargetRow {
  id: string;
  workspace_id: string;
  root_path: string;
  display_name: string;
  stack_hint: string | null;
  source_type: DebugTargetProfile["sourceType"];
  root_workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapDebugTargetRow(row: DebugTargetRow): DebugTargetProfile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    rootPath: row.root_path,
    displayName: row.display_name,
    stackHint: row.stack_hint,
    sourceType: row.source_type,
    rootWorkspaceId: row.root_workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
