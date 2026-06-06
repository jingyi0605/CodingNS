import type Database from "better-sqlite3";

import type { UserTeableGlobalSettingRecord } from "../../types/domain.js";

export class UserTeableGlobalSettingRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserId(userId: string): UserTeableGlobalSettingRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_id, base_url, space_id, base_id, auth_ref, enabled, mirror_mode, created_at, updated_at
         FROM user_teable_global_settings
         WHERE user_id = ?`
      )
      .get(userId) as UserTeableGlobalSettingRow | undefined;

    return row ? mapUserTeableGlobalSettingRow(row) : null;
  }

  upsert(record: UserTeableGlobalSettingRecord): UserTeableGlobalSettingRecord {
    this.db
      .prepare(
        `INSERT INTO user_teable_global_settings (
          user_id,
          base_url,
          space_id,
          base_id,
          auth_ref,
          enabled,
          mirror_mode,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          base_url = excluded.base_url,
          space_id = excluded.space_id,
          base_id = excluded.base_id,
          auth_ref = excluded.auth_ref,
          enabled = excluded.enabled,
          mirror_mode = excluded.mirror_mode,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.baseUrl,
        record.spaceId,
        record.baseId,
        record.authRef,
        record.enabled ? 1 : 0,
        record.mirrorMode,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserTeableGlobalSettingRow {
  user_id: string;
  base_url: string | null;
  space_id: string | null;
  base_id: string | null;
  auth_ref: string | null;
  enabled: number;
  mirror_mode: "manual" | "scheduled" | "event_driven";
  created_at: string;
  updated_at: string;
}

function mapUserTeableGlobalSettingRow(row: UserTeableGlobalSettingRow): UserTeableGlobalSettingRecord {
  return {
    userId: row.user_id,
    baseUrl: row.base_url,
    spaceId: row.space_id,
    baseId: row.base_id,
    authRef: row.auth_ref,
    enabled: row.enabled === 1,
    mirrorMode: row.mirror_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
