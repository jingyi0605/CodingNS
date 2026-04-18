import type Database from "better-sqlite3";

import type { AuthDeviceSessionRecord } from "../../types/domain.js";

export class AuthDeviceSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthDeviceSessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_device_sessions (
          id,
          user_id,
          device_id,
          access_token_id,
          refresh_token_id,
          revoked_at,
          created_at,
          updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.deviceId,
        record.accessTokenId,
        record.refreshTokenId,
        record.revokedAt,
        record.createdAt,
        record.updatedAt
      );
  }

  findById(id: string): AuthDeviceSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, device_id, access_token_id, refresh_token_id, revoked_at, created_at, updated_at
         FROM auth_device_sessions
         WHERE id = ?`
      )
      .get(id) as DeviceSessionRow | undefined;

    return row ? mapDeviceSessionRow(row) : null;
  }

  listActiveByUser(userId: string): AuthDeviceSessionRecord[] {
    return this.db
      .prepare(
        `SELECT id, user_id, device_id, access_token_id, refresh_token_id, revoked_at, created_at, updated_at
         FROM auth_device_sessions
         WHERE user_id = ?
           AND revoked_at IS NULL
         ORDER BY updated_at DESC`
      )
      .all(userId)
      .map((row) => mapDeviceSessionRow(row as DeviceSessionRow));
  }

  updateBinding(
    id: string,
    input: {
      deviceId: string | null;
      accessTokenId: string | null;
      refreshTokenId: string | null;
      updatedAt: string;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE auth_device_sessions
         SET device_id = ?,
             access_token_id = ?,
             refresh_token_id = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.deviceId, input.accessTokenId, input.refreshTokenId, input.updatedAt, id);
  }

  revokeByIds(ids: string[], revokedAt: string): void {
    if (ids.length === 0) {
      return;
    }

    const placeholders = ids.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE auth_device_sessions
         SET revoked_at = ?,
             updated_at = ?
         WHERE id IN (${placeholders}) AND revoked_at IS NULL`
      )
      .run(revokedAt, revokedAt, ...ids);
  }

  revokeById(id: string, revokedAt: string): void {
    this.db
      .prepare(
        `UPDATE auth_device_sessions
         SET revoked_at = ?,
             updated_at = ?
         WHERE id = ? AND revoked_at IS NULL`
      )
      .run(revokedAt, revokedAt, id);
  }
}

interface DeviceSessionRow {
  id: string;
  user_id: string;
  device_id: string | null;
  access_token_id: string | null;
  refresh_token_id: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapDeviceSessionRow(row: DeviceSessionRow): AuthDeviceSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    accessTokenId: row.access_token_id,
    refreshTokenId: row.refresh_token_id,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
