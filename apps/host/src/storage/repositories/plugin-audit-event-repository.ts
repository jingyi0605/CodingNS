import type Database from "better-sqlite3";

import type { PluginAuditEvent } from "../../types/domain.js";

export class PluginAuditEventRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PluginAuditEvent): PluginAuditEvent {
    this.db
      .prepare(
        `INSERT INTO plugin_audit_events (
           id,
           plugin_id,
           workspace_id,
           event_type,
           actor_user_id,
           payload_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.pluginId,
        record.workspaceId,
        record.eventType,
        record.actorUserId,
        record.payloadJson,
        record.createdAt
      );

    return record;
  }

  listByPluginId(pluginId: string, limit = 100): PluginAuditEvent[] {
    return this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           event_type,
           actor_user_id,
           payload_json,
           created_at
         FROM plugin_audit_events
         WHERE plugin_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(pluginId, limit)
      .map((row) => mapPluginAuditEventRow(row as PluginAuditEventRow));
  }
}

interface PluginAuditEventRow {
  id: string;
  plugin_id: string;
  workspace_id: string | null;
  event_type: PluginAuditEvent["eventType"];
  actor_user_id: string | null;
  payload_json: string;
  created_at: string;
}

function mapPluginAuditEventRow(row: PluginAuditEventRow): PluginAuditEvent {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    workspaceId: row.workspace_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    payloadJson: row.payload_json,
    createdAt: row.created_at
  };
}
