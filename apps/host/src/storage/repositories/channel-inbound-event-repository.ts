import type Database from "better-sqlite3";

import type { ChannelInboundEvent } from "../../types/domain.js";

export class ChannelInboundEventRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): ChannelInboundEvent | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           external_event_id,
           external_conversation_key,
           external_user_id,
           control_session_id,
           session_id,
           text_content,
           payload_json,
           status,
           error_message,
           received_at,
           processed_at
         FROM channel_inbound_events
         WHERE id = ?
         LIMIT 1`
      )
      .get(id) as ChannelInboundEventRow | undefined;

    return row ? mapChannelInboundEventRow(row) : null;
  }

  listByAccountId(channelAccountId: string, limit = 50): ChannelInboundEvent[] {
    return this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           external_event_id,
           external_conversation_key,
           external_user_id,
           control_session_id,
           session_id,
           text_content,
           payload_json,
           status,
           error_message,
           received_at,
           processed_at
         FROM channel_inbound_events
         WHERE channel_account_id = ?
         ORDER BY received_at DESC
         LIMIT ?`
      )
      .all(channelAccountId, limit)
      .map((row) => mapChannelInboundEventRow(row as ChannelInboundEventRow));
  }

  countByAccountId(channelAccountId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM channel_inbound_events
         WHERE channel_account_id = ?`
      )
      .get(channelAccountId) as { count: number };

    return row.count;
  }

  findByAccountAndExternalEventId(
    channelAccountId: string,
    externalEventId: string
  ): ChannelInboundEvent | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           external_event_id,
           external_conversation_key,
           external_user_id,
           control_session_id,
           session_id,
           text_content,
           payload_json,
           status,
           error_message,
           received_at,
           processed_at
         FROM channel_inbound_events
         WHERE channel_account_id = ?
           AND external_event_id = ?`
      )
      .get(channelAccountId, externalEventId) as ChannelInboundEventRow | undefined;

    return row ? mapChannelInboundEventRow(row) : null;
  }

  create(record: ChannelInboundEvent): ChannelInboundEvent {
    this.db
      .prepare(
        `INSERT INTO channel_inbound_events (
           id,
           channel_account_id,
           external_event_id,
           external_conversation_key,
           external_user_id,
           control_session_id,
           session_id,
           text_content,
           payload_json,
           status,
           error_message,
           received_at,
           processed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.channelAccountId,
        record.externalEventId,
        record.externalConversationKey,
        record.externalUserId,
        record.controlSessionId,
        record.sessionId,
        record.textContent,
        JSON.stringify(record.payload),
        record.status,
        record.errorMessage,
        record.receivedAt,
        record.processedAt
      );

    return record;
  }

  update(record: ChannelInboundEvent): ChannelInboundEvent {
    this.db
      .prepare(
        `UPDATE channel_inbound_events
         SET control_session_id = ?,
             session_id = ?,
             text_content = ?,
             payload_json = ?,
             status = ?,
             error_message = ?,
             processed_at = ?
         WHERE id = ?`
      )
      .run(
        record.controlSessionId,
        record.sessionId,
        record.textContent,
        JSON.stringify(record.payload),
        record.status,
        record.errorMessage,
        record.processedAt,
        record.id
      );

    return record;
  }
}

interface ChannelInboundEventRow {
  id: string;
  channel_account_id: string;
  external_event_id: string;
  external_conversation_key: string;
  external_user_id: string | null;
  control_session_id: string | null;
  session_id: string | null;
  text_content: string;
  payload_json: string;
  status: ChannelInboundEvent["status"];
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
}

function mapChannelInboundEventRow(row: ChannelInboundEventRow): ChannelInboundEvent {
  return {
    id: row.id,
    channelAccountId: row.channel_account_id,
    externalEventId: row.external_event_id,
    externalConversationKey: row.external_conversation_key,
    externalUserId: row.external_user_id,
    controlSessionId: row.control_session_id,
    sessionId: row.session_id,
    textContent: row.text_content,
    payload: parseJsonObject(row.payload_json),
    status: row.status,
    errorMessage: row.error_message,
    receivedAt: row.received_at,
    processedAt: row.processed_at
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
