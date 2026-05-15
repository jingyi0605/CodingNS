import type Database from "better-sqlite3";

import type { OfficeTaskStep, OfficeTaskStepStatus } from "../../types/domain.js";

export class OfficeTaskStepRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeTaskStep): OfficeTaskStep {
    this.db
      .prepare(
        `INSERT INTO office_task_steps (
           id,
           task_id,
           step_seq,
           step_type,
           title,
           input_json,
           output_json,
           status,
           retry_count,
           started_at,
           finished_at,
           error_message,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepSeq,
        record.stepType,
        record.title,
        record.inputJson,
        record.outputJson,
        record.status,
        record.retryCount,
        record.startedAt,
        record.finishedAt,
        record.errorMessage,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): OfficeTaskStep | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_seq,
           step_type,
           title,
           input_json,
           output_json,
           status,
           retry_count,
           started_at,
           finished_at,
           error_message,
           created_at,
           updated_at
         FROM office_task_steps
         WHERE id = ?`
      )
      .get(id) as OfficeTaskStepRow | undefined;

    return row ? mapOfficeTaskStepRow(row) : null;
  }

  listByTaskId(taskId: string): OfficeTaskStep[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_seq,
           step_type,
           title,
           input_json,
           output_json,
           status,
           retry_count,
           started_at,
           finished_at,
           error_message,
           created_at,
           updated_at
         FROM office_task_steps
         WHERE task_id = ?
         ORDER BY step_seq ASC`
      )
      .all(taskId)
      .map((row) => mapOfficeTaskStepRow(row as OfficeTaskStepRow));
  }

  update(record: OfficeTaskStep): OfficeTaskStep {
    this.db
      .prepare(
        `UPDATE office_task_steps
         SET task_id = ?,
             step_seq = ?,
             step_type = ?,
             title = ?,
             input_json = ?,
             output_json = ?,
             status = ?,
             retry_count = ?,
             started_at = ?,
             finished_at = ?,
             error_message = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.taskId,
        record.stepSeq,
        record.stepType,
        record.title,
        record.inputJson,
        record.outputJson,
        record.status,
        record.retryCount,
        record.startedAt,
        record.finishedAt,
        record.errorMessage,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface OfficeTaskStepRow {
  id: string;
  task_id: string;
  step_seq: number;
  step_type: string;
  title: string;
  input_json: string | null;
  output_json: string | null;
  status: OfficeTaskStepStatus;
  retry_count: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapOfficeTaskStepRow(row: OfficeTaskStepRow): OfficeTaskStep {
  return {
    id: row.id,
    taskId: row.task_id,
    stepSeq: row.step_seq,
    stepType: row.step_type,
    title: row.title,
    inputJson: row.input_json,
    outputJson: row.output_json,
    status: row.status,
    retryCount: row.retry_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
