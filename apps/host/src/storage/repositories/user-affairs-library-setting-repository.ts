import type Database from "better-sqlite3";

import type { UserAffairsLibrarySettingRecord } from "../../types/domain.js";

export class UserAffairsLibrarySettingRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserId(userId: string): UserAffairsLibrarySettingRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_id, root_dir, enabled, favorites_json, last_workspace_id, dashboard_state_json, created_at, updated_at
         FROM user_affairs_library_settings
         WHERE user_id = ?`
      )
      .get(userId) as UserAffairsLibrarySettingRow | undefined;

    return row ? mapUserAffairsLibrarySettingRow(row) : null;
  }

  findEnabledByWorkspaceId(workspaceId: string): UserAffairsLibrarySettingRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_id, root_dir, enabled, favorites_json, last_workspace_id, dashboard_state_json, created_at, updated_at
         FROM user_affairs_library_settings
         WHERE last_workspace_id = ?
           AND enabled = 1
           AND root_dir IS NOT NULL
           AND TRIM(root_dir) <> ''
         ORDER BY datetime(updated_at) DESC
         LIMIT 1`
      )
      .get(workspaceId) as UserAffairsLibrarySettingRow | undefined;

    return row ? mapUserAffairsLibrarySettingRow(row) : null;
  }

  listEnabled(): UserAffairsLibrarySettingRecord[] {
    return this.db
      .prepare(
        `SELECT user_id, root_dir, enabled, favorites_json, last_workspace_id, dashboard_state_json, created_at, updated_at
         FROM user_affairs_library_settings
         WHERE enabled = 1
           AND root_dir IS NOT NULL
           AND TRIM(root_dir) <> ''`
      )
      .all()
      .map((row) => mapUserAffairsLibrarySettingRow(row as UserAffairsLibrarySettingRow));
  }

  upsert(record: UserAffairsLibrarySettingRecord): UserAffairsLibrarySettingRecord {
    this.db
      .prepare(
        `INSERT INTO user_affairs_library_settings (
          user_id,
          root_dir,
          enabled,
          favorites_json,
          last_workspace_id,
          dashboard_state_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          root_dir = excluded.root_dir,
          enabled = excluded.enabled,
          favorites_json = excluded.favorites_json,
          last_workspace_id = excluded.last_workspace_id,
          dashboard_state_json = excluded.dashboard_state_json,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.rootDir,
        record.enabled ? 1 : 0,
        record.favoritesJson,
        record.lastWorkspaceId,
        record.dashboardStateJson || "{}",
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserAffairsLibrarySettingRow {
  user_id: string;
  root_dir: string | null;
  enabled: number;
  favorites_json: string | null;
  last_workspace_id: string | null;
  dashboard_state_json?: string | null;
  created_at: string;
  updated_at: string;
}

function mapUserAffairsLibrarySettingRow(row: UserAffairsLibrarySettingRow): UserAffairsLibrarySettingRecord {
  return {
    userId: row.user_id,
    rootDir: row.root_dir,
    enabled: row.enabled === 1,
    favoritesJson: row.favorites_json,
    lastWorkspaceId: row.last_workspace_id,
    dashboardStateJson: row.dashboard_state_json?.trim() || "{}",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
