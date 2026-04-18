import type Database from "better-sqlite3";

import type { AuthLoginEventRecord } from "../../types/domain.js";

export class AuthLoginEventRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthLoginEventRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_login_events (
          id,
          user_id,
          device_id,
          client_type,
          source_address,
          occurred_at
        )
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.deviceId,
        record.clientType,
        record.sourceAddress,
        record.occurredAt
      );
  }

  listRecentByUser(userId: string, limit: number): AuthLoginEventRecord[] {
    return this.db
      .prepare(
        `SELECT id, user_id, device_id, client_type, source_address, occurred_at
         FROM auth_login_events
         WHERE user_id = ?
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`
      )
      .all(userId, limit)
      .map((row) => mapLoginEventRow(row as LoginEventRow));
  }

  trimToLatest(userId: string, limit: number): void {
    this.db
      .prepare(
        `DELETE FROM auth_login_events
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id
             FROM auth_login_events
             WHERE user_id = ?
             ORDER BY occurred_at DESC, id DESC
             LIMIT ?
           )`
      )
      .run(userId, userId, limit);
  }
}

interface LoginEventRow {
  id: string;
  user_id: string;
  device_id: string | null;
  client_type: AuthLoginEventRecord["clientType"];
  source_address: string | null;
  occurred_at: string;
}

function mapLoginEventRow(row: LoginEventRow): AuthLoginEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    clientType: row.client_type,
    sourceAddress: row.source_address,
    occurredAt: row.occurred_at
  };
}
