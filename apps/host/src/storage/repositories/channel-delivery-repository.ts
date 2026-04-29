import type Database from "better-sqlite3";

import type { ChannelDelivery } from "../../types/domain.js";

export class ChannelDeliveryRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): ChannelDelivery | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           thread_id,
           inbound_event_id,
           control_session_id,
           session_id,
           text_content,
           provider_message_ref,
           status,
           error_message,
           created_at,
           updated_at
         FROM channel_deliveries
         WHERE id = ?
         LIMIT 1`
      )
      .get(id) as ChannelDeliveryRow | undefined;

    return row ? mapChannelDeliveryRow(row) : null;
  }

  findByInboundEventId(inboundEventId: string): ChannelDelivery | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           thread_id,
           inbound_event_id,
           control_session_id,
           session_id,
           text_content,
           provider_message_ref,
           status,
           error_message,
           created_at,
           updated_at
         FROM channel_deliveries
         WHERE inbound_event_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(inboundEventId) as ChannelDeliveryRow | undefined;

    return row ? mapChannelDeliveryRow(row) : null;
  }

  listByAccountId(channelAccountId: string, limit = 50): ChannelDelivery[] {
    return this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           thread_id,
           inbound_event_id,
           control_session_id,
           session_id,
           text_content,
           provider_message_ref,
           status,
           error_message,
           created_at,
           updated_at
         FROM channel_deliveries
         WHERE channel_account_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(channelAccountId, limit)
      .map((row) => mapChannelDeliveryRow(row as ChannelDeliveryRow));
  }

  countByAccountId(channelAccountId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM channel_deliveries
         WHERE channel_account_id = ?`
      )
      .get(channelAccountId) as { count: number };

    return row.count;
  }

  listRetryableFailures(limit = 100): ChannelDelivery[] {
    return this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           thread_id,
           inbound_event_id,
           control_session_id,
           session_id,
           text_content,
           provider_message_ref,
           status,
           error_message,
           created_at,
           updated_at
         FROM channel_deliveries
         WHERE status = 'failed'
           AND TRIM(text_content) <> ''
           AND thread_id IS NOT NULL
           AND inbound_event_id IS NOT NULL
         ORDER BY updated_at ASC
         LIMIT ?`
      )
      .all(limit)
      .map((row) => mapChannelDeliveryRow(row as ChannelDeliveryRow));
  }

  create(record: ChannelDelivery): ChannelDelivery {
    this.db
      .prepare(
        `INSERT INTO channel_deliveries (
           id,
           channel_account_id,
           thread_id,
           inbound_event_id,
           control_session_id,
           session_id,
           text_content,
           provider_message_ref,
           status,
           error_message,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.channelAccountId,
        record.threadId,
        record.inboundEventId,
        record.controlSessionId,
        record.sessionId,
        record.textContent,
        record.providerMessageRef,
        record.status,
        record.errorMessage,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  update(record: ChannelDelivery): ChannelDelivery {
    this.db
      .prepare(
        `UPDATE channel_deliveries
         SET thread_id = ?,
             inbound_event_id = ?,
             control_session_id = ?,
             session_id = ?,
             text_content = ?,
             provider_message_ref = ?,
             status = ?,
             error_message = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.threadId,
        record.inboundEventId,
        record.controlSessionId,
        record.sessionId,
        record.textContent,
        record.providerMessageRef,
        record.status,
        record.errorMessage,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface ChannelDeliveryRow {
  id: string;
  channel_account_id: string;
  thread_id: string | null;
  inbound_event_id: string | null;
  control_session_id: string | null;
  session_id: string | null;
  text_content: string;
  provider_message_ref: string | null;
  status: ChannelDelivery["status"];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapChannelDeliveryRow(row: ChannelDeliveryRow): ChannelDelivery {
  return {
    id: row.id,
    channelAccountId: row.channel_account_id,
    threadId: row.thread_id,
    inboundEventId: row.inbound_event_id,
    controlSessionId: row.control_session_id,
    sessionId: row.session_id,
    textContent: row.text_content,
    providerMessageRef: row.provider_message_ref,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
