import type Database from "better-sqlite3";

import type { OfficeApproval, OfficeApprovalStatus } from "../../types/domain.js";

export class OfficeApprovalRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeApproval): OfficeApproval {
    this.db
      .prepare(
        `INSERT INTO office_approvals (
           id,
           task_id,
           step_id,
           policy_id,
           status,
           approver_user_id,
           decision_note,
           decided_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepId,
        record.policyId,
        record.status,
        record.approverUserId,
        record.decisionNote,
        record.decidedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): OfficeApproval | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           policy_id,
           status,
           approver_user_id,
           decision_note,
           decided_at,
           created_at,
           updated_at
         FROM office_approvals
         WHERE id = ?`
      )
      .get(id) as OfficeApprovalRow | undefined;

    return row ? mapOfficeApprovalRow(row) : null;
  }

  listByTaskId(taskId: string): OfficeApproval[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           policy_id,
           status,
           approver_user_id,
           decision_note,
           decided_at,
           created_at,
           updated_at
         FROM office_approvals
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
      .all(taskId)
      .map((row) => mapOfficeApprovalRow(row as OfficeApprovalRow));
  }

  listPendingByUser(_userId: string): OfficeApproval[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           policy_id,
           status,
           approver_user_id,
           decision_note,
           decided_at,
           created_at,
           updated_at
         FROM office_approvals
         WHERE status = 'pending'
         ORDER BY created_at ASC`
      )
      .all()
      .map((row) => mapOfficeApprovalRow(row as OfficeApprovalRow));
  }

  update(record: OfficeApproval): OfficeApproval {
    this.db
      .prepare(
        `UPDATE office_approvals
         SET task_id = ?,
             step_id = ?,
             policy_id = ?,
             status = ?,
             approver_user_id = ?,
             decision_note = ?,
             decided_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.taskId,
        record.stepId,
        record.policyId,
        record.status,
        record.approverUserId,
        record.decisionNote,
        record.decidedAt,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface OfficeApprovalRow {
  id: string;
  task_id: string;
  step_id: string | null;
  policy_id: string;
  status: OfficeApprovalStatus;
  approver_user_id: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapOfficeApprovalRow(row: OfficeApprovalRow): OfficeApproval {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    policyId: row.policy_id,
    status: row.status,
    approverUserId: row.approver_user_id,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
