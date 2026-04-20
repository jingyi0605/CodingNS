import type Database from "better-sqlite3";

import type {
  AssistantAutomationStatus,
  AssistantAutomationTask
} from "../../types/domain.js";

export class AssistantAutomationTaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AssistantAutomationTask): AssistantAutomationTask {
    this.db
      .prepare(
        `INSERT INTO assistant_automation_tasks (
           id,
           user_id,
           control_session_id,
           project_id,
           title,
           trigger_type,
           trigger_config_json,
           action_type,
           action_config_json,
           status,
           next_run_at,
           last_run_at,
           last_run_summary,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.controlSessionId,
        record.projectId,
        record.title,
        record.triggerType,
        record.triggerConfigJson,
        record.actionType,
        record.actionConfigJson,
        record.status,
        record.nextRunAt,
        record.lastRunAt,
        record.lastRunSummary,
        record.lastError,
        record.createdAt,
        record.updatedAt,
        record.cancelledAt
      );

    return record;
  }

  findById(id: string): AssistantAutomationTask | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           control_session_id,
           project_id,
           title,
           trigger_type,
           trigger_config_json,
           action_type,
           action_config_json,
           status,
           next_run_at,
           last_run_at,
           last_run_summary,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         FROM assistant_automation_tasks
         WHERE id = ?`
      )
      .get(id) as AssistantAutomationTaskRow | undefined;

    return row ? mapTaskRow(row) : null;
  }

  list(filters: {
    statuses?: AssistantAutomationStatus[];
    controlSessionId?: string;
    limit?: number;
  } = {}): AssistantAutomationTask[] {
    const whereParts: string[] = [];
    const values: Array<string | number> = [];

    if (filters.statuses?.length) {
      whereParts.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
      values.push(...filters.statuses);
    }

    if (filters.controlSessionId?.trim()) {
      whereParts.push("control_session_id = ?");
      values.push(filters.controlSessionId.trim());
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
           control_session_id,
           project_id,
           title,
           trigger_type,
           trigger_config_json,
           action_type,
           action_config_json,
           status,
           next_run_at,
           last_run_at,
           last_run_summary,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         FROM assistant_automation_tasks
         ${whereClause}
         ORDER BY
           CASE WHEN next_run_at IS NULL THEN 1 ELSE 0 END ASC,
           next_run_at ASC,
           created_at ASC
         ${limitClause}`
      )
      .all(...values)
      .map((row) => mapTaskRow(row as AssistantAutomationTaskRow));
  }

  listDueActive(referenceAt: string, limit = 20): AssistantAutomationTask[] {
    return this.listDueByStatus("active", referenceAt, limit);
  }

  listDuePaused(referenceAt: string, limit = 20): AssistantAutomationTask[] {
    return this.listDueByStatus("paused", referenceAt, limit);
  }

  private listDueByStatus(
    status: AssistantAutomationStatus,
    referenceAt: string,
    limit: number
  ): AssistantAutomationTask[] {
    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           control_session_id,
           project_id,
           title,
           trigger_type,
           trigger_config_json,
           action_type,
           action_config_json,
           status,
           next_run_at,
           last_run_at,
           last_run_summary,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         FROM assistant_automation_tasks
         WHERE status = ?
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC, created_at ASC
         LIMIT ?`
      )
      .all(status, referenceAt, limit)
      .map((row) => mapTaskRow(row as AssistantAutomationTaskRow));
  }

  update(record: AssistantAutomationTask): AssistantAutomationTask {
    this.db
      .prepare(
        `UPDATE assistant_automation_tasks
         SET user_id = ?,
             control_session_id = ?,
             project_id = ?,
             title = ?,
             trigger_type = ?,
             trigger_config_json = ?,
             action_type = ?,
             action_config_json = ?,
             status = ?,
             next_run_at = ?,
             last_run_at = ?,
             last_run_summary = ?,
             last_error = ?,
             updated_at = ?,
             cancelled_at = ?
         WHERE id = ?`
      )
      .run(
        record.userId,
        record.controlSessionId,
        record.projectId,
        record.title,
        record.triggerType,
        record.triggerConfigJson,
        record.actionType,
        record.actionConfigJson,
        record.status,
        record.nextRunAt,
        record.lastRunAt,
        record.lastRunSummary,
        record.lastError,
        record.updatedAt,
        record.cancelledAt,
        record.id
      );

    return record;
  }
}

interface AssistantAutomationTaskRow {
  id: string;
  user_id: string;
  control_session_id: string;
  project_id: string | null;
  title: string | null;
  trigger_type: AssistantAutomationTask["triggerType"];
  trigger_config_json: string;
  action_type: AssistantAutomationTask["actionType"];
  action_config_json: string;
  status: AssistantAutomationTask["status"];
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_summary: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

function mapTaskRow(row: AssistantAutomationTaskRow): AssistantAutomationTask {
  return {
    id: row.id,
    userId: row.user_id,
    controlSessionId: row.control_session_id,
    projectId: row.project_id,
    title: row.title,
    triggerType: row.trigger_type,
    triggerConfigJson: row.trigger_config_json,
    actionType: row.action_type,
    actionConfigJson: row.action_config_json,
    status: row.status,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunSummary: row.last_run_summary,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at
  };
}
