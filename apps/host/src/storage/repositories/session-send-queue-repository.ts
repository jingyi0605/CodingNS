import type Database from "better-sqlite3";

import type { SessionSendQueueItemRecord } from "../../types/domain.js";

export class SessionSendQueueRepository {
  constructor(private readonly db: Database.Database) {}

  listBySessionAndUser(
    sessionId: string,
    userId: string
  ): SessionSendQueueItemRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           user_id,
           content,
           client_request_id,
           model,
           reasoning_level,
           permission_mode,
           status,
           order_index,
           error_detail,
           created_at,
           updated_at,
           dispatched_at
         FROM session_send_queue
         WHERE session_id = ?
           AND user_id = ?
           AND status IN ('queued', 'failed')
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(sessionId, userId) as SessionSendQueueRow[];

    return rows.map(mapSessionSendQueueRow);
  }

  findBySessionUserAndId(
    sessionId: string,
    userId: string,
    queueItemId: string
  ): SessionSendQueueItemRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           user_id,
           content,
           client_request_id,
           model,
           reasoning_level,
           permission_mode,
           status,
           order_index,
           error_detail,
           created_at,
           updated_at,
           dispatched_at
         FROM session_send_queue
         WHERE session_id = ?
           AND user_id = ?
           AND id = ?
         LIMIT 1`
      )
      .get(sessionId, userId, queueItemId) as SessionSendQueueRow | undefined;

    return row ? mapSessionSendQueueRow(row) : null;
  }

  findNextQueued(sessionId: string): SessionSendQueueItemRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           user_id,
           content,
           client_request_id,
           model,
           reasoning_level,
           permission_mode,
           status,
           order_index,
           error_detail,
           created_at,
           updated_at,
           dispatched_at
         FROM session_send_queue
         WHERE session_id = ?
           AND status = 'queued'
         ORDER BY order_index ASC, created_at ASC
         LIMIT 1`
      )
      .get(sessionId) as SessionSendQueueRow | undefined;

    return row ? mapSessionSendQueueRow(row) : null;
  }

  getNextOrderIndex(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(order_index), 0) AS max_order_index
         FROM session_send_queue
         WHERE session_id = ?`
      )
      .get(sessionId) as { max_order_index: number | null } | undefined;

    return (row?.max_order_index ?? 0) + 1;
  }

  insert(record: SessionSendQueueItemRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_send_queue (
           id,
           session_id,
           user_id,
           content,
           client_request_id,
           model,
           reasoning_level,
           permission_mode,
           status,
           order_index,
           error_detail,
           created_at,
           updated_at,
           dispatched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.sessionId,
        record.userId,
        record.content,
        record.clientRequestId,
        record.model,
        record.reasoningLevel,
        record.permissionMode,
        record.status,
        record.orderIndex,
        record.errorDetail,
        record.createdAt,
        record.updatedAt,
        record.dispatchedAt
      );
  }

  markDispatching(queueItemId: string, dispatchedAt: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE session_send_queue
         SET status = 'dispatching',
             dispatched_at = ?,
             updated_at = ?,
             error_detail = NULL
         WHERE id = ?
           AND status = 'queued'`
      )
      .run(dispatchedAt, dispatchedAt, queueItemId);

    return result.changes > 0;
  }

  markQueued(queueItemId: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE session_send_queue
         SET status = 'queued',
             dispatched_at = NULL,
             updated_at = ?,
             error_detail = NULL
         WHERE id = ?`
      )
      .run(updatedAt, queueItemId);
  }

  markFailed(queueItemId: string, errorDetail: string | null, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE session_send_queue
         SET status = 'failed',
             error_detail = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(errorDetail, updatedAt, queueItemId);
  }

  delete(queueItemId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM session_send_queue WHERE id = ?")
      .run(queueItemId);

    return result.changes > 0;
  }
}

interface SessionSendQueueRow {
  id: string;
  session_id: string;
  user_id: string;
  content: string;
  client_request_id: string | null;
  model: string | null;
  reasoning_level: string | null;
  permission_mode: string | null;
  status: SessionSendQueueItemRecord["status"];
  order_index: number;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
}

function mapSessionSendQueueRow(row: SessionSendQueueRow): SessionSendQueueItemRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    content: row.content,
    clientRequestId: row.client_request_id,
    model: row.model,
    reasoningLevel: row.reasoning_level,
    permissionMode: row.permission_mode,
    status: row.status,
    orderIndex: row.order_index,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dispatchedAt: row.dispatched_at
  };
}
