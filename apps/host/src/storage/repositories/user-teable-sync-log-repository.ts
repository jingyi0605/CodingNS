import type Database from "better-sqlite3";

import type { TeableSyncLogState, TeableSyncLogTriggerType, UserTeableSyncLogRecord } from "../../types/domain.js";

export class UserTeableSyncLogRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string, input: {
    limit?: number;
    triggerType?: TeableSyncLogTriggerType;
    state?: TeableSyncLogState;
  } = {}): UserTeableSyncLogRecord[] {
    const where: string[] = ["user_id = ?"];
    const values: Array<string | number> = [userId];

    if (input.triggerType) {
      where.push("trigger_type = ?");
      values.push(input.triggerType);
    }

    if (input.state) {
      where.push("state = ?");
      values.push(input.state);
    }

    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    values.push(limit);

    return this.db
      .prepare(
        `SELECT log_id, user_id, trigger_type, source_types_json, task_id, state, summary, counts_json,
                error_detail, reason, started_at, finished_at, created_at, updated_at
         FROM user_teable_sync_logs
         WHERE ${where.join(" AND ")}
         ORDER BY datetime(created_at) DESC, log_id DESC
         LIMIT ?`
      )
      .all(...values)
      .map((row) => mapRow(row as UserTeableSyncLogRow));
  }

  create(record: UserTeableSyncLogRecord): UserTeableSyncLogRecord {
    this.db
      .prepare(
        `INSERT INTO user_teable_sync_logs (
          log_id,
          user_id,
          trigger_type,
          source_types_json,
          task_id,
          state,
          summary,
          counts_json,
          error_detail,
          reason,
          started_at,
          finished_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.logId,
        record.userId,
        record.triggerType,
        record.sourceTypesJson,
        record.taskId,
        record.state,
        record.summary,
        record.countsJson,
        record.errorDetail,
        record.reason,
        record.startedAt,
        record.finishedAt,
        record.createdAt,
        record.updatedAt
      );
    return record;
  }

  update(record: UserTeableSyncLogRecord): UserTeableSyncLogRecord {
    this.db
      .prepare(
        `UPDATE user_teable_sync_logs
         SET task_id = ?,
             state = ?,
             summary = ?,
             counts_json = ?,
             error_detail = ?,
             reason = ?,
             started_at = ?,
             finished_at = ?,
             updated_at = ?
         WHERE log_id = ?
           AND user_id = ?`
      )
      .run(
        record.taskId,
        record.state,
        record.summary,
        record.countsJson,
        record.errorDetail,
        record.reason,
        record.startedAt,
        record.finishedAt,
        record.updatedAt,
        record.logId,
        record.userId
      );
    return record;
  }

  findById(userId: string, logId: string): UserTeableSyncLogRecord | null {
    const row = this.db
      .prepare(
        `SELECT log_id, user_id, trigger_type, source_types_json, task_id, state, summary, counts_json,
                error_detail, reason, started_at, finished_at, created_at, updated_at
         FROM user_teable_sync_logs
         WHERE user_id = ?
           AND log_id = ?
         LIMIT 1`
      )
      .get(userId, logId) as UserTeableSyncLogRow | undefined;
    return row ? mapRow(row) : null;
  }
}

interface UserTeableSyncLogRow {
  log_id: string;
  user_id: string;
  trigger_type: TeableSyncLogTriggerType;
  source_types_json: string;
  task_id: string | null;
  state: TeableSyncLogState;
  summary: string;
  counts_json: string;
  error_detail: string | null;
  reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UserTeableSyncLogRow): UserTeableSyncLogRecord {
  return {
    logId: row.log_id,
    userId: row.user_id,
    triggerType: row.trigger_type,
    sourceTypesJson: row.source_types_json,
    taskId: row.task_id,
    state: row.state,
    summary: row.summary,
    countsJson: row.counts_json,
    errorDetail: row.error_detail,
    reason: row.reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
