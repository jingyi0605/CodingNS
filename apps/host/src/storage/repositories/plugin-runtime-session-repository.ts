import type Database from "better-sqlite3";

import type {
  PluginRuntimeSession,
  PluginRuntimeSessionSource,
  PluginRuntimeSessionStatus
} from "../../types/domain.js";

export class PluginRuntimeSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PluginRuntimeSession): PluginRuntimeSession {
    this.db
      .prepare(
        `INSERT INTO plugin_runtime_sessions (
           id,
           plugin_id,
           workspace_id,
           opened_by_user_id,
           source,
           status,
           created_at,
           updated_at,
           closed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.pluginId,
        record.workspaceId,
        record.openedByUserId,
        record.source,
        record.status,
        record.createdAt,
        record.updatedAt,
        record.closedAt
      );

    return record;
  }

  update(record: PluginRuntimeSession): PluginRuntimeSession {
    this.db
      .prepare(
        `UPDATE plugin_runtime_sessions
         SET plugin_id = ?,
             workspace_id = ?,
             opened_by_user_id = ?,
             source = ?,
             status = ?,
             updated_at = ?,
             closed_at = ?
         WHERE id = ?`
      )
      .run(
        record.pluginId,
        record.workspaceId,
        record.openedByUserId,
        record.source,
        record.status,
        record.updatedAt,
        record.closedAt,
        record.id
      );

    return record;
  }

  findById(id: string): PluginRuntimeSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           opened_by_user_id,
           source,
           status,
           created_at,
           updated_at,
           closed_at
         FROM plugin_runtime_sessions
         WHERE id = ?`
      )
      .get(id) as PluginRuntimeSessionRow | undefined;

    return row ? mapPluginRuntimeSessionRow(row) : null;
  }

  listByPluginId(pluginId: string, limit = 50): PluginRuntimeSession[] {
    return this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           opened_by_user_id,
           source,
           status,
           created_at,
           updated_at,
           closed_at
         FROM plugin_runtime_sessions
         WHERE plugin_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(pluginId, limit)
      .map((row) => mapPluginRuntimeSessionRow(row as PluginRuntimeSessionRow));
  }
}

interface PluginRuntimeSessionRow {
  id: string;
  plugin_id: string;
  workspace_id: string;
  opened_by_user_id: string;
  source: PluginRuntimeSessionSource;
  status: PluginRuntimeSessionStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

function mapPluginRuntimeSessionRow(row: PluginRuntimeSessionRow): PluginRuntimeSession {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    workspaceId: row.workspace_id,
    openedByUserId: row.opened_by_user_id,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}
