import type Database from "better-sqlite3";

import type { AssistantAutomationRun } from "../../types/domain.js";

export class AssistantAutomationRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AssistantAutomationRun): AssistantAutomationRun {
    this.db
      .prepare(
        `INSERT INTO assistant_automation_runs (
           id,
           automation_id,
           run_seq,
           trigger_type,
           trigger_snapshot_json,
           action_type,
           action_snapshot_json,
           status,
           summary,
           error,
           scheduled_at,
           started_at,
           finished_at,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.automationId,
        record.runSeq,
        record.triggerType,
        record.triggerSnapshotJson,
        record.actionType,
        record.actionSnapshotJson,
        record.status,
        record.summary,
        record.error,
        record.scheduledAt,
        record.startedAt,
        record.finishedAt,
        record.createdAt
      );

    return record;
  }

  listByAutomation(automationId: string, limit?: number): AssistantAutomationRun[] {
    const limitClause = limit ? "LIMIT ?" : "";
    const rows = this.db
      .prepare(
        `SELECT
           id,
           automation_id,
           run_seq,
           trigger_type,
           trigger_snapshot_json,
           action_type,
           action_snapshot_json,
           status,
           summary,
           error,
           scheduled_at,
           started_at,
           finished_at,
           created_at
         FROM assistant_automation_runs
         WHERE automation_id = ?
         ORDER BY run_seq DESC
         ${limitClause}`
      )
      .all(...(limit ? [automationId, limit] : [automationId])) as AssistantAutomationRunRow[];

    return rows.map((row) => mapRunRow(row));
  }

  listRecent(limit = 30): AssistantAutomationRun[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           automation_id,
           run_seq,
           trigger_type,
           trigger_snapshot_json,
           action_type,
           action_snapshot_json,
           status,
           summary,
           error,
           scheduled_at,
           started_at,
           finished_at,
           created_at
         FROM assistant_automation_runs
         ORDER BY created_at DESC, run_seq DESC
         LIMIT ?`
      )
      .all(limit) as AssistantAutomationRunRow[];

    return rows.map((row) => mapRunRow(row));
  }

  findLatestByAutomation(automationId: string): AssistantAutomationRun | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           automation_id,
           run_seq,
           trigger_type,
           trigger_snapshot_json,
           action_type,
           action_snapshot_json,
           status,
           summary,
           error,
           scheduled_at,
           started_at,
           finished_at,
           created_at
         FROM assistant_automation_runs
         WHERE automation_id = ?
         ORDER BY run_seq DESC
         LIMIT 1`
      )
      .get(automationId) as AssistantAutomationRunRow | undefined;

    return row ? mapRunRow(row) : null;
  }

  getLatestSeq(automationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(run_seq), 0) AS seq
         FROM assistant_automation_runs
         WHERE automation_id = ?`
      )
      .get(automationId) as { seq: number } | undefined;

    return row?.seq ?? 0;
  }

  update(record: AssistantAutomationRun): AssistantAutomationRun {
    this.db
      .prepare(
        `UPDATE assistant_automation_runs
         SET status = ?,
             summary = ?,
             error = ?,
             scheduled_at = ?,
             started_at = ?,
             finished_at = ?
         WHERE id = ?`
      )
      .run(
        record.status,
        record.summary,
        record.error,
        record.scheduledAt,
        record.startedAt,
        record.finishedAt,
        record.id
      );

    return record;
  }
}

interface AssistantAutomationRunRow {
  id: string;
  automation_id: string;
  run_seq: number;
  trigger_type: AssistantAutomationRun["triggerType"];
  trigger_snapshot_json: string;
  action_type: AssistantAutomationRun["actionType"];
  action_snapshot_json: string;
  status: AssistantAutomationRun["status"];
  summary: string | null;
  error: string | null;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function mapRunRow(row: AssistantAutomationRunRow): AssistantAutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    runSeq: row.run_seq,
    triggerType: row.trigger_type,
    triggerSnapshotJson: row.trigger_snapshot_json,
    actionType: row.action_type,
    actionSnapshotJson: row.action_snapshot_json,
    status: row.status,
    summary: row.summary,
    error: row.error,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}
