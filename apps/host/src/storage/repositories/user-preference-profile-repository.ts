import type Database from "better-sqlite3";

import type { UserPreferenceProfileRecord } from "../../types/domain.js";

export class UserPreferenceProfileRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserId(userId: string): UserPreferenceProfileRecord | null {
    const row = this.db
      .prepare(
        `SELECT language, theme, default_permission_mode, providers_json, created_at, updated_at
         FROM user_preference_profiles
         WHERE user_id = ?`
      )
      .get(userId) as UserPreferenceProfileRow | undefined;

    if (!row) {
      return null;
    }

    return {
      userId,
      language: row.language as UserPreferenceProfileRecord["language"],
      theme: row.theme as UserPreferenceProfileRecord["theme"],
      defaultPermissionMode: row.default_permission_mode as UserPreferenceProfileRecord["defaultPermissionMode"],
      providers: JSON.parse(row.providers_json) as UserPreferenceProfileRecord["providers"],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  upsert(record: UserPreferenceProfileRecord): UserPreferenceProfileRecord {
    this.db
      .prepare(
        `INSERT INTO user_preference_profiles (
          user_id,
          language,
          theme,
          default_permission_mode,
          providers_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          language = excluded.language,
          theme = excluded.theme,
          default_permission_mode = excluded.default_permission_mode,
          providers_json = excluded.providers_json,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.language,
        record.theme,
        record.defaultPermissionMode,
        JSON.stringify(record.providers),
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserPreferenceProfileRow {
  language: string;
  theme: string;
  default_permission_mode: string;
  providers_json: string;
  created_at: string;
  updated_at: string;
}
