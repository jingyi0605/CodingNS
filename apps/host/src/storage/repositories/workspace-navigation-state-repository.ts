import type Database from "better-sqlite3";

import type { WorkspaceNavigationStateRecord } from "../../types/domain.js";

export class WorkspaceNavigationStateRepository {
  constructor(private readonly db: Database.Database) {}

  listEnabledAffairsLibraries(): WorkspaceNavigationStateRecord[] {
    return this.db
      .prepare(
        `SELECT workspace_id, user_id, collapsed, background_color, affairs_library_root_path, affairs_library_enabled, affairs_library_favorites_json, updated_at
         FROM workspace_navigation_states
         WHERE affairs_library_enabled = 1
           AND affairs_library_root_path IS NOT NULL
           AND TRIM(affairs_library_root_path) <> ''`
      )
      .all()
      .map((row) => mapWorkspaceNavigationStateRow(row as WorkspaceNavigationStateRow));
  }

  findAnyEnabledAffairsLibraryByWorkspaceId(workspaceId: string): WorkspaceNavigationStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT workspace_id, user_id, collapsed, background_color, affairs_library_root_path, affairs_library_enabled, affairs_library_favorites_json, updated_at
         FROM workspace_navigation_states
         WHERE workspace_id = ?
           AND affairs_library_enabled = 1
           AND affairs_library_root_path IS NOT NULL
           AND TRIM(affairs_library_root_path) <> ''
         LIMIT 1`
      )
      .get(workspaceId) as WorkspaceNavigationStateRow | undefined;

    return row ? mapWorkspaceNavigationStateRow(row) : null;
  }

  findLatestAffairsLibraryByWorkspaceId(workspaceId: string): WorkspaceNavigationStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT workspace_id, user_id, collapsed, background_color, affairs_library_root_path, affairs_library_enabled, affairs_library_favorites_json, updated_at
         FROM workspace_navigation_states
         WHERE workspace_id = ?
           AND affairs_library_root_path IS NOT NULL
           AND TRIM(affairs_library_root_path) <> ''
         ORDER BY datetime(updated_at) DESC
         LIMIT 1`
      )
      .get(workspaceId) as WorkspaceNavigationStateRow | undefined;

    return row ? mapWorkspaceNavigationStateRow(row) : null;
  }

  listByUserId(userId: string): WorkspaceNavigationStateRecord[] {
    return this.db
      .prepare(
        `SELECT workspace_id, user_id, collapsed, background_color, affairs_library_root_path, affairs_library_enabled, affairs_library_favorites_json, updated_at
         FROM workspace_navigation_states
         WHERE user_id = ?`
      )
      .all(userId)
      .map((row) => mapWorkspaceNavigationStateRow(row as WorkspaceNavigationStateRow));
  }

  findByWorkspaceIdAndUserId(workspaceId: string, userId: string): WorkspaceNavigationStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT workspace_id, user_id, collapsed, background_color, affairs_library_root_path, affairs_library_enabled, affairs_library_favorites_json, updated_at
         FROM workspace_navigation_states
         WHERE workspace_id = ?
           AND user_id = ?`
      )
      .get(workspaceId, userId) as WorkspaceNavigationStateRow | undefined;

    return row ? mapWorkspaceNavigationStateRow(row) : null;
  }

  upsert(record: WorkspaceNavigationStateRecord): WorkspaceNavigationStateRecord {
    this.db
      .prepare(
        `INSERT INTO workspace_navigation_states (
           workspace_id,
           user_id,
           collapsed,
           background_color,
           affairs_library_root_path,
           affairs_library_enabled,
           affairs_library_favorites_json,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, user_id) DO UPDATE SET
           collapsed = excluded.collapsed,
           background_color = excluded.background_color,
           affairs_library_root_path = excluded.affairs_library_root_path,
           affairs_library_enabled = excluded.affairs_library_enabled,
           affairs_library_favorites_json = excluded.affairs_library_favorites_json,
           updated_at = excluded.updated_at`
      )
      .run(
        record.workspaceId,
        record.userId,
        record.collapsed ? 1 : 0,
        record.backgroundColor,
        record.affairsLibraryRootPath ?? null,
        record.affairsLibraryEnabled ? 1 : 0,
        record.affairsLibraryFavoritesJson ?? null,
        record.updatedAt
      );

    return record;
  }
}

interface WorkspaceNavigationStateRow {
  workspace_id: string;
  user_id: string;
  collapsed: number;
  background_color: string | null;
  affairs_library_root_path: string | null;
  affairs_library_enabled: number;
  affairs_library_favorites_json: string | null;
  updated_at: string;
}

function mapWorkspaceNavigationStateRow(row: WorkspaceNavigationStateRow): WorkspaceNavigationStateRecord {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    collapsed: row.collapsed === 1,
    backgroundColor: row.background_color,
    affairsLibraryRootPath: row.affairs_library_root_path,
    affairsLibraryEnabled: row.affairs_library_enabled === 1,
    affairsLibraryFavoritesJson: row.affairs_library_favorites_json,
    updatedAt: row.updated_at
  };
}
