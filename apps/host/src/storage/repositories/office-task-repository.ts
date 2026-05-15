import type Database from "better-sqlite3";

import type {
  OfficeRiskLevel,
  OfficeTask,
  OfficeTaskStatus,
  OfficeTaskType
} from "../../types/domain.js";

export interface OfficeTaskListFilters {
  userId?: string;
  workspaceId?: string | null;
  taskType?: OfficeTaskType;
  status?: OfficeTaskStatus;
  riskLevel?: OfficeRiskLevel;
  limit?: number;
}

export class OfficeTaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeTask): OfficeTask {
    this.db
      .prepare(
        `INSERT INTO office_tasks (
           id,
           user_id,
           workspace_id,
           task_type,
           title,
           description,
           connector_id,
           target_ref_kind,
           target_ref_id,
           input_json,
           status,
           risk_level,
           approval_policy_id,
           current_step_id,
           idempotency_key,
           started_at,
           finished_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.workspaceId,
        record.taskType,
        record.title,
        record.description,
        record.connectorId,
        record.targetRefKind,
        record.targetRefId,
        record.inputJson,
        record.status,
        record.riskLevel,
        record.approvalPolicyId,
        record.currentStepId,
        record.idempotencyKey,
        record.startedAt,
        record.finishedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): OfficeTask | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           task_type,
           title,
           description,
           connector_id,
           target_ref_kind,
           target_ref_id,
           input_json,
           status,
           risk_level,
           approval_policy_id,
           current_step_id,
           idempotency_key,
           started_at,
           finished_at,
           created_at,
           updated_at
         FROM office_tasks
         WHERE id = ?`
      )
      .get(id) as OfficeTaskRow | undefined;

    return row ? mapOfficeTaskRow(row) : null;
  }

  list(filters: OfficeTaskListFilters = {}): OfficeTask[] {
    const whereParts: string[] = [];
    const values: Array<string | number | null> = [];

    if (filters.userId?.trim()) {
      whereParts.push("user_id = ?");
      values.push(filters.userId.trim());
    }

    if (filters.workspaceId !== undefined) {
      if (filters.workspaceId === null) {
        whereParts.push("workspace_id IS NULL");
      } else {
        whereParts.push("workspace_id = ?");
        values.push(filters.workspaceId.trim());
      }
    }

    if (filters.taskType) {
      whereParts.push("task_type = ?");
      values.push(filters.taskType);
    }

    if (filters.status) {
      whereParts.push("status = ?");
      values.push(filters.status);
    }

    if (filters.riskLevel) {
      whereParts.push("risk_level = ?");
      values.push(filters.riskLevel);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const limitClause = filters.limit ? "LIMIT ?" : "";

    if (filters.limit) {
      values.push(filters.limit);
    }

    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           task_type,
           title,
           description,
           connector_id,
           target_ref_kind,
           target_ref_id,
           input_json,
           status,
           risk_level,
           approval_policy_id,
           current_step_id,
           idempotency_key,
           started_at,
           finished_at,
           created_at,
           updated_at
         FROM office_tasks
         ${whereClause}
         ORDER BY created_at DESC
         ${limitClause}`
      )
      .all(...values)
      .map((row) => mapOfficeTaskRow(row as OfficeTaskRow));
  }

  update(record: OfficeTask): OfficeTask {
    this.db
      .prepare(
        `UPDATE office_tasks
         SET user_id = ?,
             workspace_id = ?,
             task_type = ?,
             title = ?,
             description = ?,
             connector_id = ?,
             target_ref_kind = ?,
             target_ref_id = ?,
             input_json = ?,
             status = ?,
             risk_level = ?,
             approval_policy_id = ?,
             current_step_id = ?,
             idempotency_key = ?,
             started_at = ?,
             finished_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.userId,
        record.workspaceId,
        record.taskType,
        record.title,
        record.description,
        record.connectorId,
        record.targetRefKind,
        record.targetRefId,
        record.inputJson,
        record.status,
        record.riskLevel,
        record.approvalPolicyId,
        record.currentStepId,
        record.idempotencyKey,
        record.startedAt,
        record.finishedAt,
        record.updatedAt,
        record.id
      );

    return record;
  }

  findActiveByIdempotencyKey(userId: string, idempotencyKey: string): OfficeTask | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           task_type,
           title,
           description,
           connector_id,
           target_ref_kind,
           target_ref_id,
           input_json,
           status,
           risk_level,
           approval_policy_id,
           current_step_id,
           idempotency_key,
           started_at,
           finished_at,
           created_at,
           updated_at
         FROM office_tasks
         WHERE user_id = ?
           AND idempotency_key = ?
           AND status IN ('draft', 'pending_approval', 'ready', 'running', 'paused', 'waiting_external')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(userId, idempotencyKey) as OfficeTaskRow | undefined;

    return row ? mapOfficeTaskRow(row) : null;
  }
}

interface OfficeTaskRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  task_type: OfficeTaskType;
  title: string;
  description: string | null;
  connector_id: string;
  target_ref_kind: string | null;
  target_ref_id: string | null;
  input_json: string;
  status: OfficeTaskStatus;
  risk_level: OfficeRiskLevel;
  approval_policy_id: string | null;
  current_step_id: string | null;
  idempotency_key: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapOfficeTaskRow(row: OfficeTaskRow): OfficeTask {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    taskType: row.task_type,
    title: row.title,
    description: row.description,
    connectorId: row.connector_id,
    targetRefKind: row.target_ref_kind,
    targetRefId: row.target_ref_id,
    inputJson: row.input_json,
    status: row.status,
    riskLevel: row.risk_level,
    approvalPolicyId: row.approval_policy_id,
    currentStepId: row.current_step_id,
    idempotencyKey: row.idempotency_key,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
