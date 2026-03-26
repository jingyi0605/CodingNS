import type Database from "better-sqlite3";

import type { SessionMessageAttachmentRecord } from "../../types/domain.js";

export class SessionMessageAttachmentRepository {
  constructor(private readonly db: Database.Database) {}

  listBySessionAndClientRequest(
    sessionId: string,
    clientRequestId: string
  ): SessionMessageAttachmentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           client_request_id,
           message_id,
           kind,
           file_name,
           mime_type,
           file_size,
           storage_path,
           created_at
         FROM session_message_attachments
         WHERE session_id = ?
           AND client_request_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId, clientRequestId) as SessionMessageAttachmentRow[];

    return rows.map(mapSessionMessageAttachmentRow);
  }

  listBySessionAndMessageIds(
    sessionId: string,
    messageIds: string[]
  ): SessionMessageAttachmentRecord[] {
    if (messageIds.length === 0) {
      return [];
    }

    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           client_request_id,
           message_id,
           kind,
           file_name,
           mime_type,
           file_size,
           storage_path,
           created_at
         FROM session_message_attachments
         WHERE session_id = ?
           AND message_id IN (${placeholders})
         ORDER BY created_at ASC`
      )
      .all(sessionId, ...messageIds) as SessionMessageAttachmentRow[];

    return rows.map(mapSessionMessageAttachmentRow);
  }

  findBySessionAndId(
    sessionId: string,
    attachmentId: string
  ): SessionMessageAttachmentRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           client_request_id,
           message_id,
           kind,
           file_name,
           mime_type,
           file_size,
           storage_path,
           created_at
         FROM session_message_attachments
         WHERE session_id = ?
           AND id = ?
         LIMIT 1`
      )
      .get(sessionId, attachmentId) as SessionMessageAttachmentRow | undefined;

    return row ? mapSessionMessageAttachmentRow(row) : null;
  }

  insert(record: SessionMessageAttachmentRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_message_attachments (
           id,
           session_id,
           client_request_id,
           message_id,
           kind,
           file_name,
           mime_type,
           file_size,
           storage_path,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.sessionId,
        record.clientRequestId,
        record.messageId,
        record.kind,
        record.fileName,
        record.mimeType,
        record.fileSize,
        record.storagePath,
        record.createdAt
      );
  }

  bindMessage(sessionId: string, clientRequestId: string, messageId: string): void {
    this.db
      .prepare(
        `UPDATE session_message_attachments
         SET message_id = ?
         WHERE session_id = ?
           AND client_request_id = ?`
      )
      .run(messageId, sessionId, clientRequestId);
  }

  listUnboundBySessionAndClientRequest(
    sessionId: string,
    clientRequestId: string
  ): SessionMessageAttachmentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           client_request_id,
           message_id,
           kind,
           file_name,
           mime_type,
           file_size,
           storage_path,
           created_at
         FROM session_message_attachments
         WHERE session_id = ?
           AND client_request_id = ?
           AND message_id IS NULL
         ORDER BY created_at ASC`
      )
      .all(sessionId, clientRequestId) as SessionMessageAttachmentRow[];

    return rows.map(mapSessionMessageAttachmentRow);
  }

  deleteByIds(attachmentIds: string[]): void {
    if (attachmentIds.length === 0) {
      return;
    }

    const placeholders = attachmentIds.map(() => "?").join(", ");
    this.db
      .prepare(`DELETE FROM session_message_attachments WHERE id IN (${placeholders})`)
      .run(...attachmentIds);
  }
}

interface SessionMessageAttachmentRow {
  id: string;
  session_id: string;
  client_request_id: string;
  message_id: string | null;
  kind: SessionMessageAttachmentRecord["kind"];
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  created_at: string;
}

function mapSessionMessageAttachmentRow(
  row: SessionMessageAttachmentRow
): SessionMessageAttachmentRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    clientRequestId: row.client_request_id,
    messageId: row.message_id,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    createdAt: row.created_at
  };
}
