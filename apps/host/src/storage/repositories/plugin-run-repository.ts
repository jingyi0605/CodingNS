import type Database from "better-sqlite3";

import type { PluginRun, PluginRunStatus, PluginRunTriggerKind } from "../../types/domain.js";

export class PluginRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PluginRun): PluginRun {
    this.db
      .prepare(
        `INSERT INTO plugin_runs (
           id,
           plugin_id,
           workspace_id,
           trigger_kind,
           action_id,
           status,
           input_summary_json,
           output_summary_json,
           error_code,
           error_message,
           started_at,
           finished_at,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.pluginId,
        record.workspaceId,
        record.triggerKind,
        record.actionId,
        record.status,
        record.inputSummaryJson,
        record.outputSummaryJson,
        record.errorCode,
        record.errorMessage,
        record.startedAt,
        record.finishedAt,
        record.createdAt
      );

    return record;
  }

  update(record: PluginRun): PluginRun {
    this.db
      .prepare(
        `UPDATE plugin_runs
         SET plugin_id = ?,
             workspace_id = ?,
             trigger_kind = ?,
             action_id = ?,
             status = ?,
             input_summary_json = ?,
             output_summary_json = ?,
             error_code = ?,
             error_message = ?,
             started_at = ?,
             finished_at = ?
         WHERE id = ?`
      )
      .run(
        record.pluginId,
        record.workspaceId,
        record.triggerKind,
        record.actionId,
        record.status,
        record.inputSummaryJson,
        record.outputSummaryJson,
        record.errorCode,
        record.errorMessage,
        record.startedAt,
        record.finishedAt,
        record.id
      );

    return record;
  }

  findById(id: string): PluginRun | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           trigger_kind,
           action_id,
           status,
           input_summary_json,
           output_summary_json,
           error_code,
           error_message,
           started_at,
           finished_at,
           created_at
         FROM plugin_runs
         WHERE id = ?`
      )
      .get(id) as PluginRunRow | undefined;

    return row ? mapPluginRunRow(row) : null;
  }

  listByPluginId(pluginId: string, limit = 50): PluginRun[] {
    return this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           trigger_kind,
           action_id,
           status,
           input_summary_json,
           output_summary_json,
           error_code,
           error_message,
           started_at,
           finished_at,
           created_at
         FROM plugin_runs
         WHERE plugin_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(pluginId, limit)
      .map((row) => mapPluginRunRow(row as PluginRunRow));
  }
}

interface PluginRunRow {
  id: string;
  plugin_id: string;
  workspace_id: string;
  trigger_kind: PluginRunTriggerKind;
  action_id: string | null;
  status: PluginRunStatus;
  input_summary_json: string | null;
  output_summary_json: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function mapPluginRunRow(row: PluginRunRow): PluginRun {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    workspaceId: row.workspace_id,
    triggerKind: row.trigger_kind,
    actionId: row.action_id,
    status: row.status,
    inputSummaryJson: row.input_summary_json,
    outputSummaryJson: row.output_summary_json,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}
