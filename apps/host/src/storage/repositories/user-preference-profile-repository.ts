import type Database from "better-sqlite3";

import type { UserPreferenceProfileRecord } from "../../types/domain.js";

export class UserPreferenceProfileRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserId(userId: string): UserPreferenceProfileRecord | null {
    const row = this.db
      .prepare(
        `SELECT language, theme, auto_theme, default_permission_mode, providers_json, debug_port_pools_json, affairs_dashboard_states_json, created_at, updated_at
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
      autoTheme: row.auto_theme === 1,
      defaultPermissionMode: row.default_permission_mode as UserPreferenceProfileRecord["defaultPermissionMode"],
      providers: JSON.parse(row.providers_json) as UserPreferenceProfileRecord["providers"],
      debugPortPools: JSON.parse(row.debug_port_pools_json) as UserPreferenceProfileRecord["debugPortPools"],
      affairsDashboardStatesByWorkspace:
        JSON.parse(row.affairs_dashboard_states_json) as UserPreferenceProfileRecord["affairsDashboardStatesByWorkspace"],
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
          auto_theme,
          default_permission_mode,
          providers_json,
          debug_port_pools_json,
          affairs_dashboard_states_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          language = excluded.language,
          theme = excluded.theme,
          auto_theme = excluded.auto_theme,
          default_permission_mode = excluded.default_permission_mode,
          providers_json = excluded.providers_json,
          debug_port_pools_json = excluded.debug_port_pools_json,
          affairs_dashboard_states_json = excluded.affairs_dashboard_states_json,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.language,
        record.theme,
        record.autoTheme ? 1 : 0,
        record.defaultPermissionMode,
        JSON.stringify(record.providers),
        JSON.stringify(record.debugPortPools),
        JSON.stringify(record.affairsDashboardStatesByWorkspace),
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserPreferenceProfileRow {
  language: string;
  theme: string;
  auto_theme: number;
  default_permission_mode: string;
  providers_json: string;
  debug_port_pools_json: string;
  affairs_dashboard_states_json: string;
  created_at: string;
  updated_at: string;
}
