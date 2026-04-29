import type Database from "better-sqlite3";

import type { ChannelAccount } from "../../types/domain.js";

export class ChannelAccountRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string): ChannelAccount[] {
    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           platform_code,
           display_name,
           provider_id,
           connection_mode,
           status,
           config_json,
           runtime_state_json,
           last_inbound_at,
           last_outbound_at,
           last_error,
           created_at,
           updated_at
         FROM channel_accounts
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(userId)
      .map((row) => mapChannelAccountRow(row as ChannelAccountRow));
  }

  findById(id: string): ChannelAccount | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           platform_code,
           display_name,
           provider_id,
           connection_mode,
           status,
           config_json,
           runtime_state_json,
           last_inbound_at,
           last_outbound_at,
           last_error,
           created_at,
           updated_at
         FROM channel_accounts
         WHERE id = ?`
      )
      .get(id) as ChannelAccountRow | undefined;

    return row ? mapChannelAccountRow(row) : null;
  }

  listActiveByConnectionModes(connectionModes: ChannelAccount["connectionMode"][]): ChannelAccount[] {
    if (connectionModes.length === 0) {
      return [];
    }

    const placeholders = connectionModes.map(() => "?").join(", ");

    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           platform_code,
           display_name,
           provider_id,
           connection_mode,
           status,
           config_json,
           runtime_state_json,
           last_inbound_at,
           last_outbound_at,
           last_error,
           created_at,
           updated_at
         FROM channel_accounts
         WHERE status IN ('active', 'degraded')
           AND connection_mode IN (${placeholders})
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...connectionModes)
      .map((row) => mapChannelAccountRow(row as ChannelAccountRow));
  }

  create(record: ChannelAccount): ChannelAccount {
    this.db
      .prepare(
        `INSERT INTO channel_accounts (
           id,
           user_id,
           platform_code,
           display_name,
           provider_id,
           connection_mode,
           status,
           config_json,
           runtime_state_json,
           last_inbound_at,
           last_outbound_at,
           last_error,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.platformCode,
        record.displayName,
        record.providerId,
        record.connectionMode,
        record.status,
        JSON.stringify(record.config),
        JSON.stringify(record.runtimeState),
        record.lastInboundAt,
        record.lastOutboundAt,
        record.lastError,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  update(record: ChannelAccount): ChannelAccount {
    this.db
      .prepare(
        `UPDATE channel_accounts
         SET display_name = ?,
             provider_id = ?,
             connection_mode = ?,
             status = ?,
             config_json = ?,
             runtime_state_json = ?,
             last_inbound_at = ?,
             last_outbound_at = ?,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.displayName,
        record.providerId,
        record.connectionMode,
        record.status,
        JSON.stringify(record.config),
        JSON.stringify(record.runtimeState),
        record.lastInboundAt,
        record.lastOutboundAt,
        record.lastError,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface ChannelAccountRow {
  id: string;
  user_id: string;
  platform_code: ChannelAccount["platformCode"];
  display_name: string;
  provider_id: ChannelAccount["providerId"];
  connection_mode: ChannelAccount["connectionMode"];
  status: ChannelAccount["status"];
  config_json: string;
  runtime_state_json: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function mapChannelAccountRow(row: ChannelAccountRow): ChannelAccount {
  return {
    id: row.id,
    userId: row.user_id,
    platformCode: row.platform_code,
    displayName: row.display_name,
    providerId: row.provider_id,
    connectionMode: row.connection_mode,
    status: row.status,
    config: parseJsonObject(row.config_json),
    runtimeState: parseJsonObject(row.runtime_state_json),
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    lastError: row.last_error,
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
