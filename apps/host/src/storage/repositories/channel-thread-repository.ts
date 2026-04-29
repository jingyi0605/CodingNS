import type Database from "better-sqlite3";

import type { ChannelThread } from "../../types/domain.js";

export class ChannelThreadRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): ChannelThread | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           external_conversation_key,
           external_user_id,
           external_thread_key,
           control_session_id,
           session_id,
           title,
           status,
           last_inbound_at,
           last_outbound_at,
           last_transport_context_json,
           created_at,
           updated_at
         FROM channel_threads
         WHERE id = ?
         LIMIT 1`
      )
      .get(id) as ChannelThreadRow | undefined;

    return row ? mapChannelThreadRow(row) : null;
  }

  listByAccountId(channelAccountId: string, limit = 50): ChannelThread[] {
    return this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           external_conversation_key,
           external_user_id,
           external_thread_key,
           control_session_id,
           session_id,
           title,
           status,
           last_inbound_at,
           last_outbound_at,
           last_transport_context_json,
           created_at,
           updated_at
         FROM channel_threads
         WHERE channel_account_id = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT ?`
      )
      .all(channelAccountId, limit)
      .map((row) => mapChannelThreadRow(row as ChannelThreadRow));
  }

  countByAccountId(channelAccountId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM channel_threads
         WHERE channel_account_id = ?`
      )
      .get(channelAccountId) as { count: number };

    return row.count;
  }

  findByAccountAndConversationKey(
    channelAccountId: string,
    externalConversationKey: string
  ): ChannelThread | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           channel_account_id,
           external_conversation_key,
           external_user_id,
           external_thread_key,
           control_session_id,
           session_id,
           title,
           status,
           last_inbound_at,
           last_outbound_at,
           last_transport_context_json,
           created_at,
           updated_at
         FROM channel_threads
         WHERE channel_account_id = ?
           AND external_conversation_key = ?`
      )
      .get(channelAccountId, externalConversationKey) as ChannelThreadRow | undefined;

    return row ? mapChannelThreadRow(row) : null;
  }

  create(record: ChannelThread): ChannelThread {
    this.db
      .prepare(
        `INSERT INTO channel_threads (
           id,
           channel_account_id,
           external_conversation_key,
           external_user_id,
           external_thread_key,
           control_session_id,
           session_id,
           title,
           status,
           last_inbound_at,
           last_outbound_at,
           last_transport_context_json,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.channelAccountId,
        record.externalConversationKey,
        record.externalUserId,
        record.externalThreadKey,
        record.controlSessionId,
        record.sessionId,
        record.title,
        record.status,
        record.lastInboundAt,
        record.lastOutboundAt,
        JSON.stringify(record.lastTransportContext),
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  update(record: ChannelThread): ChannelThread {
    this.db
      .prepare(
        `UPDATE channel_threads
         SET external_user_id = ?,
             external_thread_key = ?,
             control_session_id = ?,
             session_id = ?,
             title = ?,
             status = ?,
             last_inbound_at = ?,
             last_outbound_at = ?,
             last_transport_context_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.externalUserId,
        record.externalThreadKey,
        record.controlSessionId,
        record.sessionId,
        record.title,
        record.status,
        record.lastInboundAt,
        record.lastOutboundAt,
        JSON.stringify(record.lastTransportContext),
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface ChannelThreadRow {
  id: string;
  channel_account_id: string;
  external_conversation_key: string;
  external_user_id: string | null;
  external_thread_key: string | null;
  control_session_id: string | null;
  session_id: string | null;
  title: string | null;
  status: ChannelThread["status"];
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_transport_context_json: string;
  created_at: string;
  updated_at: string;
}

function mapChannelThreadRow(row: ChannelThreadRow): ChannelThread {
  return {
    id: row.id,
    channelAccountId: row.channel_account_id,
    externalConversationKey: row.external_conversation_key,
    externalUserId: row.external_user_id,
    externalThreadKey: row.external_thread_key,
    controlSessionId: row.control_session_id,
    sessionId: row.session_id,
    title: row.title,
    status: row.status,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    lastTransportContext: parseJsonObject(row.last_transport_context_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
