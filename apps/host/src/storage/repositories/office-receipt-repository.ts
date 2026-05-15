import type Database from "better-sqlite3";

import type { OfficeReceipt } from "../../types/domain.js";

export class OfficeReceiptRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeReceipt): OfficeReceipt {
    this.db
      .prepare(
        `INSERT INTO office_receipts (
           id,
           task_id,
           step_id,
           receipt_type,
           summary,
           payload_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepId,
        record.receiptType,
        record.summary,
        record.payloadJson,
        record.createdAt
      );

    return record;
  }

  listByTaskId(taskId: string): OfficeReceipt[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           receipt_type,
           summary,
           payload_json,
           created_at
         FROM office_receipts
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
      .all(taskId)
      .map((row) => mapOfficeReceiptRow(row as OfficeReceiptRow));
  }
}

interface OfficeReceiptRow {
  id: string;
  task_id: string;
  step_id: string | null;
  receipt_type: string;
  summary: string;
  payload_json: string;
  created_at: string;
}

function mapOfficeReceiptRow(row: OfficeReceiptRow): OfficeReceipt {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    receiptType: row.receipt_type,
    summary: row.summary,
    payloadJson: row.payload_json,
    createdAt: row.created_at
  };
}
