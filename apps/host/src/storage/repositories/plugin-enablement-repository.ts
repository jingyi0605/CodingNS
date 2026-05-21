import type Database from "better-sqlite3";

import type { PluginEnablement } from "../../types/domain.js";

export class PluginEnablementRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: PluginEnablement): PluginEnablement {
    this.db
      .prepare(
        `INSERT INTO plugin_enablements (
           plugin_id,
           enabled,
           enabled_by_user_id,
           enabled_at,
           disabled_by_user_id,
           disabled_at,
           reason,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(plugin_id) DO UPDATE SET
           enabled = excluded.enabled,
           enabled_by_user_id = excluded.enabled_by_user_id,
           enabled_at = excluded.enabled_at,
           disabled_by_user_id = excluded.disabled_by_user_id,
           disabled_at = excluded.disabled_at,
           reason = excluded.reason,
           updated_at = excluded.updated_at`
      )
      .run(
        record.pluginId,
        record.enabled ? 1 : 0,
        record.enabledByUserId,
        record.enabledAt,
        record.disabledByUserId,
        record.disabledAt,
        record.reason,
        record.updatedAt
      );

    return record;
  }

  findByPluginId(pluginId: string): PluginEnablement | null {
    const row = this.db
      .prepare(
        `SELECT
           plugin_id,
           enabled,
           enabled_by_user_id,
           enabled_at,
           disabled_by_user_id,
           disabled_at,
           reason,
           updated_at
         FROM plugin_enablements
         WHERE plugin_id = ?`
      )
      .get(pluginId) as PluginEnablementRow | undefined;

    return row ? mapPluginEnablementRow(row) : null;
  }

  list(): PluginEnablement[] {
    return this.db
      .prepare(
        `SELECT
           plugin_id,
           enabled,
           enabled_by_user_id,
           enabled_at,
           disabled_by_user_id,
           disabled_at,
           reason,
           updated_at
         FROM plugin_enablements
         ORDER BY plugin_id ASC`
      )
      .all()
      .map((row) => mapPluginEnablementRow(row as PluginEnablementRow));
  }
}

interface PluginEnablementRow {
  plugin_id: string;
  enabled: number;
  enabled_by_user_id: string | null;
  enabled_at: string | null;
  disabled_by_user_id: string | null;
  disabled_at: string | null;
  reason: string | null;
  updated_at: string;
}

function mapPluginEnablementRow(row: PluginEnablementRow): PluginEnablement {
  return {
    pluginId: row.plugin_id,
    enabled: row.enabled === 1,
    enabledByUserId: row.enabled_by_user_id,
    enabledAt: row.enabled_at,
    disabledByUserId: row.disabled_by_user_id,
    disabledAt: row.disabled_at,
    reason: row.reason,
    updatedAt: row.updated_at
  };
}
