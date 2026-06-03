import type Database from "better-sqlite3";

import type { UserAffairsLibrarySettingRecord } from "../../types/domain.js";

export class UserAffairsLibrarySettingRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserId(userId: string): UserAffairsLibrarySettingRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_id, root_dir, enabled, favorites_json, last_workspace_id, created_at, updated_at
         FROM user_affairs_library_settings
         WHERE user_id = ?`
      )
      .get(userId) as UserAffairsLibrarySettingRow | undefined;

    return row ? mapUserAffairsLibrarySettingRow(row) : null;
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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          root_dir = excluded.root_dir,
          enabled = excluded.enabled,
          favorites_json = excluded.favorites_json,
          last_workspace_id = excluded.last_workspace_id,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.rootDir,
        record.enabled ? 1 : 0,
        record.favoritesJson,
        record.lastWorkspaceId,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
