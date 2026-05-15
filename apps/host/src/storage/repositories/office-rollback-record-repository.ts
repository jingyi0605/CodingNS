import type Database from "better-sqlite3";

import type { OfficeRollbackRecord, OfficeRollbackStatus } from "../../types/domain.js";

export class OfficeRollbackRecordRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeRollbackRecord): OfficeRollbackRecord {
    this.db
      .prepare(
        `INSERT INTO office_rollback_records (
           id,
           task_id,
           step_id,
           status,
           reason,
           compensation_json,
           summary,
           started_at,
           finished_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepId,
        record.status,
        record.reason,
        record.compensationJson,
        record.summary,
        record.startedAt,
        record.finishedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  listByTaskId(taskId: string): OfficeRollbackRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           status,
           reason,
           compensation_json,
           summary,
           started_at,
           finished_at,
           created_at,
           updated_at
         FROM office_rollback_records
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
      .all(taskId)
      .map((row) => mapOfficeRollbackRecordRow(row as OfficeRollbackRecordRow));
  }
}

interface OfficeRollbackRecordRow {
  id: string;
  task_id: string;
  step_id: string | null;
  status: OfficeRollbackStatus;
  reason: string;
  compensation_json: string | null;
  summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapOfficeRollbackRecordRow(row: OfficeRollbackRecordRow): OfficeRollbackRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    status: row.status,
    reason: row.reason,
    compensationJson: row.compensation_json,
    summary: row.summary,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
