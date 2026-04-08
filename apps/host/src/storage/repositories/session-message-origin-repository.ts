import type Database from "better-sqlite3";

import type { SessionMessageOriginRecord } from "../../types/domain.js";

export class SessionMessageOriginRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: SessionMessageOriginRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_message_origins (
           session_id,
           client_request_id,
           message_id,
           origin,
           origin_ref,
           content,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, client_request_id) DO UPDATE SET
           message_id = excluded.message_id,
           origin = excluded.origin,
           origin_ref = excluded.origin_ref,
           content = excluded.content,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.clientRequestId,
        record.messageId,
        record.origin,
        record.originRef,
        record.content,
        record.createdAt,
        record.updatedAt
      );
  }

  resolveMessageId(
    sessionId: string,
    clientRequestId: string,
    messageId: string,
    updatedAt: string
  ): void {
    this.db
      .prepare(
        `UPDATE session_message_origins
         SET message_id = ?,
             updated_at = ?
         WHERE session_id = ?
           AND client_request_id = ?`
      )
      .run(messageId, updatedAt, sessionId, clientRequestId);
  }

  listBySessionAndMessageIds(sessionId: string, messageIds: string[]): SessionMessageOriginRecord[] {
    if (messageIds.length === 0) {
      return [];
    }

    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT
           session_id,
           client_request_id,
           message_id,
           origin,
           origin_ref,
           content,
           created_at,
           updated_at
         FROM session_message_origins
         WHERE session_id = ?
           AND message_id IN (${placeholders})
         ORDER BY updated_at DESC`
      )
      .all(sessionId, ...messageIds) as SessionMessageOriginRow[];

    return rows.map(mapRow);
  }

  listUnresolvedBySessionAndContents(sessionId: string, contents: string[]): SessionMessageOriginRecord[] {
    if (contents.length === 0) {
      return [];
    }

    const placeholders = contents.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT
           session_id,
           client_request_id,
           message_id,
           origin,
           origin_ref,
           content,
           created_at,
           updated_at
         FROM session_message_origins
         WHERE session_id = ?
           AND message_id IS NULL
           AND content IN (${placeholders})
         ORDER BY created_at ASC, updated_at ASC`
      )
      .all(sessionId, ...contents) as SessionMessageOriginRow[];

    return rows.map(mapRow);
  }
}

interface SessionMessageOriginRow {
  session_id: string;
  client_request_id: string;
  message_id: string | null;
  origin: SessionMessageOriginRecord["origin"];
  origin_ref: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: SessionMessageOriginRow): SessionMessageOriginRecord {
  return {
    sessionId: row.session_id,
    clientRequestId: row.client_request_id,
    messageId: row.message_id,
    origin: row.origin,
    originRef: row.origin_ref,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
