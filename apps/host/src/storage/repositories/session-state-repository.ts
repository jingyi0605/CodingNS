import type Database from "better-sqlite3";

import type { SessionStateRecord } from "../../types/domain.js";

export class SessionStateRepository {
  constructor(private readonly db: Database.Database) {}

  findBySessionAndUser(sessionId: string, userId: string): SessionStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           user_id,
           running_state,
           activity_source,
           last_event_at,
           completed_at,
           last_seen_at,
            updated_at
         FROM session_states
         WHERE session_id = ? AND user_id = ?`
      )
      .get(sessionId, userId) as SessionStateRow | undefined;

    return row ? mapSessionStateRow(row) : null;
  }

  upsert(record: SessionStateRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_states (
           session_id,
           user_id,
           running_state,
           activity_source,
           last_event_at,
           completed_at,
           last_seen_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, user_id) DO UPDATE SET
           running_state = excluded.running_state,
           activity_source = excluded.activity_source,
           last_event_at = excluded.last_event_at,
           completed_at = excluded.completed_at,
           last_seen_at = excluded.last_seen_at,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.userId,
        record.runningState,
        record.activitySource,
        record.lastEventAt,
        record.completedAt,
        record.lastSeenAt,
        record.updatedAt
      );
  }
}

interface SessionStateRow {
  session_id: string;
  user_id: string;
  running_state: SessionStateRecord["runningState"];
  activity_source: SessionStateRecord["activitySource"];
  last_event_at: string | null;
  completed_at: string | null;
  last_seen_at: string | null;
  updated_at: string;
}

function mapSessionStateRow(row: SessionStateRow): SessionStateRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    runningState: row.running_state,
    activitySource: row.activity_source,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at
  };
}
