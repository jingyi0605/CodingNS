import type Database from "better-sqlite3";

import type { SessionStateRecord } from "../../types/domain.js";

export class SessionStateRepository {
  private readonly findBySessionAndUserStatement: Database.Statement<any[], any>;
  private readonly upsertStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.findBySessionAndUserStatement = this.db.prepare(
      `SELECT
         session_id,
         user_id,
         running_state,
         activity_source,
         favorite,
         last_event_at,
         completed_at,
         last_seen_at,
          updated_at
       FROM session_states
       WHERE session_id = ? AND user_id = ?`
    );
    this.upsertStatement = this.db.prepare(
      `INSERT INTO session_states (
         session_id,
         user_id,
         running_state,
         activity_source,
         favorite,
         last_event_at,
         completed_at,
         last_seen_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET
         running_state = excluded.running_state,
         activity_source = excluded.activity_source,
         favorite = excluded.favorite,
         last_event_at = excluded.last_event_at,
         completed_at = excluded.completed_at,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`
    );
  }

  findBySessionAndUser(sessionId: string, userId: string): SessionStateRecord | null {
    const row = this.findBySessionAndUserStatement.get(sessionId, userId) as SessionStateRow | undefined;

    return row ? mapSessionStateRow(row) : null;
  }

  upsert(record: SessionStateRecord): void {
    this.upsertStatement
      .run(
        record.sessionId,
        record.userId,
        record.runningState,
        record.activitySource,
        record.favorite ? 1 : 0,
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
  favorite: number;
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
    favorite: row.favorite === 1,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at
  };
}
