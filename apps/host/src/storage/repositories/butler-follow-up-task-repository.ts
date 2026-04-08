import type Database from "better-sqlite3";

import type {
  ButlerFollowUpRound,
  ButlerFollowUpTask,
  ButlerFollowUpTaskStatus,
  SessionRunningState
} from "../../types/domain.js";

export class ButlerFollowUpTaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerFollowUpTask): ButlerFollowUpTask {
    this.db
      .prepare(
        `INSERT INTO butler_follow_up_tasks (
           id,
           project_id,
           butler_session_id,
           session_id,
           created_by_user_id,
           objective,
           completion_criteria,
           max_auto_continue_count,
           status,
           check_interval_seconds,
           last_checked_at,
           next_check_at,
           last_observed_running_state,
           last_observed_message_at,
           last_observed_message_count,
           last_automation_summary,
           last_automation_at,
           auto_continue_count,
           waiting_reason,
           rounds_json,
           created_at,
           updated_at,
           completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.butlerSessionId,
        record.sessionId,
        record.createdByUserId,
        record.objective,
        record.completionCriteria,
        record.maxAutoContinueCount,
        record.status,
        record.checkIntervalSeconds,
        record.lastCheckedAt,
        record.nextCheckAt,
        record.lastObservedRunningState,
        record.lastObservedMessageAt,
        record.lastObservedMessageCount,
        record.lastAutomationSummary,
        record.lastAutomationAt,
        record.autoContinueCount,
        record.waitingReason,
        JSON.stringify(record.rounds),
        record.createdAt,
        record.updatedAt,
        record.completedAt
      );

    return record;
  }

  findById(id: string): ButlerFollowUpTask | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           butler_session_id,
           session_id,
           created_by_user_id,
           objective,
           completion_criteria,
           max_auto_continue_count,
           status,
           check_interval_seconds,
           last_checked_at,
           next_check_at,
           last_observed_running_state,
           last_observed_message_at,
           last_observed_message_count,
           last_automation_summary,
           last_automation_at,
           auto_continue_count,
           waiting_reason,
           rounds_json,
           created_at,
           updated_at,
           completed_at
         FROM butler_follow_up_tasks
         WHERE id = ?`
      )
      .get(id) as ButlerFollowUpTaskRow | undefined;

    return row ? mapRow(row) : null;
  }

  findActiveByButlerSessionId(butlerSessionId: string): ButlerFollowUpTask | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           butler_session_id,
           session_id,
           created_by_user_id,
           objective,
           completion_criteria,
           max_auto_continue_count,
           status,
           check_interval_seconds,
           last_checked_at,
           next_check_at,
           last_observed_running_state,
           last_observed_message_at,
           last_observed_message_count,
           last_automation_summary,
           last_automation_at,
           auto_continue_count,
           waiting_reason,
           rounds_json,
           created_at,
           updated_at,
           completed_at
         FROM butler_follow_up_tasks
         WHERE butler_session_id = ?
           AND status IN ('active', 'waiting_user')
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(butlerSessionId) as ButlerFollowUpTaskRow | undefined;

    return row ? mapRow(row) : null;
  }

  list(filters: {
    statuses?: ButlerFollowUpTaskStatus[];
    projectId?: string;
    sessionId?: string;
    limit?: number;
  } = {}): ButlerFollowUpTask[] {
    const whereParts: string[] = [];
    const values: Array<string | number> = [];

    if (filters.statuses && filters.statuses.length > 0) {
      whereParts.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
      values.push(...filters.statuses);
    }

    if (filters.projectId?.trim()) {
      whereParts.push("project_id = ?");
      values.push(filters.projectId.trim());
    }

    if (filters.sessionId?.trim()) {
      whereParts.push("session_id = ?");
      values.push(filters.sessionId.trim());
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
           project_id,
           butler_session_id,
           session_id,
           created_by_user_id,
           objective,
           completion_criteria,
           max_auto_continue_count,
           status,
           check_interval_seconds,
           last_checked_at,
           next_check_at,
           last_observed_running_state,
           last_observed_message_at,
           last_observed_message_count,
           last_automation_summary,
           last_automation_at,
           auto_continue_count,
           waiting_reason,
           rounds_json,
           created_at,
           updated_at,
           completed_at
         FROM butler_follow_up_tasks
         ${whereClause}
         ORDER BY
           CASE status
             WHEN 'active' THEN 0
             WHEN 'waiting_user' THEN 1
             WHEN 'failed' THEN 2
             WHEN 'completed' THEN 3
             WHEN 'cancelled' THEN 4
             ELSE 5
           END,
           updated_at DESC,
           created_at DESC
         ${limitClause}`
      )
      .all(...values)
      .map((row) => mapRow(row as ButlerFollowUpTaskRow));
  }

  update(record: ButlerFollowUpTask): ButlerFollowUpTask | null {
    this.db
      .prepare(
        `UPDATE butler_follow_up_tasks
         SET project_id = ?,
             butler_session_id = ?,
             session_id = ?,
             created_by_user_id = ?,
             objective = ?,
             completion_criteria = ?,
             max_auto_continue_count = ?,
             status = ?,
             check_interval_seconds = ?,
             last_checked_at = ?,
             next_check_at = ?,
             last_observed_running_state = ?,
             last_observed_message_at = ?,
             last_observed_message_count = ?,
             last_automation_summary = ?,
             last_automation_at = ?,
             auto_continue_count = ?,
             waiting_reason = ?,
             rounds_json = ?,
             created_at = ?,
             updated_at = ?,
             completed_at = ?
         WHERE id = ?`
      )
      .run(
        record.projectId,
        record.butlerSessionId,
        record.sessionId,
        record.createdByUserId,
        record.objective,
        record.completionCriteria,
        record.maxAutoContinueCount,
        record.status,
        record.checkIntervalSeconds,
        record.lastCheckedAt,
        record.nextCheckAt,
        record.lastObservedRunningState,
        record.lastObservedMessageAt,
        record.lastObservedMessageCount,
        record.lastAutomationSummary,
        record.lastAutomationAt,
        record.autoContinueCount,
        record.waitingReason,
        JSON.stringify(record.rounds),
        record.createdAt,
        record.updatedAt,
        record.completedAt,
        record.id
      );

    return this.findById(record.id);
  }
}

interface ButlerFollowUpTaskRow {
  id: string;
  project_id: string;
  butler_session_id: string;
  session_id: string;
  created_by_user_id: string;
  objective: string;
  completion_criteria: string;
  max_auto_continue_count: number;
  status: ButlerFollowUpTaskStatus;
  check_interval_seconds: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_observed_running_state: SessionRunningState | null;
  last_observed_message_at: string | null;
  last_observed_message_count: number;
  last_automation_summary: string | null;
  last_automation_at: string | null;
  auto_continue_count: number;
  waiting_reason: string | null;
  rounds_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapRow(row: ButlerFollowUpTaskRow): ButlerFollowUpTask {
  return {
    id: row.id,
    projectId: row.project_id,
    butlerSessionId: row.butler_session_id,
    sessionId: row.session_id,
    createdByUserId: row.created_by_user_id,
    objective: row.objective,
    completionCriteria: row.completion_criteria,
    maxAutoContinueCount: row.max_auto_continue_count,
    status: row.status,
    checkIntervalSeconds: row.check_interval_seconds,
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    lastObservedRunningState: row.last_observed_running_state,
    lastObservedMessageAt: row.last_observed_message_at,
    lastObservedMessageCount: row.last_observed_message_count,
    lastAutomationSummary: row.last_automation_summary,
    lastAutomationAt: row.last_automation_at,
    autoContinueCount: row.auto_continue_count,
    waitingReason: row.waiting_reason,
    rounds: parseRounds(row.rounds_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function parseRounds(value: string | null | undefined): ButlerFollowUpRound[] {
  if (!value?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is ButlerFollowUpRound => Boolean(item && typeof item === "object"))
      .map((item, index) => ({
        roundNumber:
          typeof item.roundNumber === "number" && Number.isFinite(item.roundNumber)
            ? item.roundNumber
            : index + 1,
        kind: typeof item.kind === "string" ? item.kind as ButlerFollowUpRound["kind"] : "started",
        status: typeof item.status === "string" ? item.status as ButlerFollowUpTaskStatus : "active",
        summary: typeof item.summary === "string" ? item.summary : "",
        waitingReason: typeof item.waitingReason === "string" ? item.waitingReason : null,
        continuePrompt: typeof item.continuePrompt === "string" ? item.continuePrompt : null,
        observedRunningState:
          typeof item.observedRunningState === "string"
            ? item.observedRunningState as SessionRunningState
            : null,
        autoContinueCount:
          typeof item.autoContinueCount === "number" && Number.isFinite(item.autoContinueCount)
            ? item.autoContinueCount
            : 0,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : ""
      }));
  } catch {
    return [];
  }
}
