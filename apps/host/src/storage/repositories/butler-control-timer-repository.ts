import type Database from "better-sqlite3";

import type {
  ButlerControlTimer,
  ButlerControlTimerStatus
} from "../../types/domain.js";

export class ButlerControlTimerRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerControlTimer): ButlerControlTimer {
    this.db
      .prepare(
        `INSERT INTO butler_control_timers (
           id,
           control_session_id,
           session_id,
           user_id,
           project_id,
           target_session_id,
           title,
           content,
           due_at,
           status,
           triggered_at,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.controlSessionId,
        record.sessionId,
        record.userId,
        record.projectId,
        record.targetSessionId,
        record.title,
        record.content,
        record.dueAt,
        record.status,
        record.triggeredAt,
        record.lastError,
        record.createdAt,
        record.updatedAt,
        record.cancelledAt
      );

    return record;
  }

  findById(id: string): ButlerControlTimer | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           control_session_id,
           session_id,
           user_id,
           project_id,
           target_session_id,
           title,
           content,
           due_at,
           status,
           triggered_at,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         FROM butler_control_timers
         WHERE id = ?`
      )
      .get(id) as ButlerControlTimerRow | undefined;

    return row ? mapRow(row) : null;
  }

  list(filters: {
    statuses?: ButlerControlTimerStatus[];
    controlSessionId?: string;
    limit?: number;
  } = {}): ButlerControlTimer[] {
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
           control_session_id,
           session_id,
           user_id,
           project_id,
           target_session_id,
           title,
           content,
           due_at,
           status,
           triggered_at,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         FROM butler_control_timers
         ${whereClause}
         ORDER BY due_at ASC, created_at ASC
         ${limitClause}`
      )
      .all(...values)
      .map((row) => mapRow(row as ButlerControlTimerRow));
  }

  listDueActive(referenceAt: string, limit = 20): ButlerControlTimer[] {
    return this.db
      .prepare(
        `SELECT
           id,
           control_session_id,
           session_id,
           user_id,
           project_id,
           target_session_id,
           title,
           content,
           due_at,
           status,
           triggered_at,
           last_error,
           created_at,
           updated_at,
           cancelled_at
         FROM butler_control_timers
         WHERE status = 'active'
           AND due_at <= ?
         ORDER BY due_at ASC, created_at ASC
         LIMIT ?`
      )
      .all(referenceAt, limit)
      .map((row) => mapRow(row as ButlerControlTimerRow));
  }

  update(record: ButlerControlTimer): ButlerControlTimer {
    this.db
      .prepare(
        `UPDATE butler_control_timers
         SET control_session_id = ?,
             session_id = ?,
             user_id = ?,
             project_id = ?,
             target_session_id = ?,
             title = ?,
             content = ?,
             due_at = ?,
             status = ?,
             triggered_at = ?,
             last_error = ?,
             updated_at = ?,
             cancelled_at = ?
         WHERE id = ?`
      )
      .run(
        record.controlSessionId,
        record.sessionId,
        record.userId,
        record.projectId,
        record.targetSessionId,
        record.title,
        record.content,
        record.dueAt,
        record.status,
        record.triggeredAt,
        record.lastError,
        record.updatedAt,
        record.cancelledAt,
        record.id
      );

    return record;
  }
}

interface ButlerControlTimerRow {
  id: string;
  control_session_id: string;
  session_id: string;
  user_id: string;
  project_id: string | null;
  target_session_id: string | null;
  title: string | null;
  content: string;
  due_at: string;
  status: ButlerControlTimer["status"];
  triggered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

function mapRow(row: ButlerControlTimerRow): ButlerControlTimer {
  return {
    id: row.id,
    controlSessionId: row.control_session_id,
    sessionId: row.session_id,
    userId: row.user_id,
    projectId: row.project_id,
    targetSessionId: row.target_session_id,
    title: row.title,
    content: row.content,
    dueAt: row.due_at,
    status: row.status,
    triggeredAt: row.triggered_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at
  };
}
