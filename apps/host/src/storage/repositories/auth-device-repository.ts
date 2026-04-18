import type Database from "better-sqlite3";

import type { AuthClientType, AuthDeviceRecord } from "../../types/domain.js";

export class AuthDeviceRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthDeviceRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_devices (
          id,
          user_id,
          client_type,
          client_instance_id,
          display_name,
          user_agent,
          is_primary,
          last_source_address,
          last_seen_at,
          primary_set_at,
          created_at,
          updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.clientType,
        record.clientInstanceId,
        record.displayName,
        record.userAgent,
        record.isPrimary ? 1 : 0,
        record.lastSourceAddress,
        record.lastSeenAt,
        record.primarySetAt,
        record.createdAt,
        record.updatedAt
      );
  }

  findById(id: string): AuthDeviceRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, client_type, client_instance_id, display_name, user_agent, is_primary,
                last_source_address, last_seen_at, primary_set_at, created_at, updated_at
         FROM auth_devices
         WHERE id = ?`
      )
      .get(id) as DeviceRow | undefined;

    return row ? mapDeviceRow(row) : null;
  }

  findByClientIdentity(
    userId: string,
    clientType: AuthClientType,
    clientInstanceId: string
  ): AuthDeviceRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, client_type, client_instance_id, display_name, user_agent, is_primary,
                last_source_address, last_seen_at, primary_set_at, created_at, updated_at
         FROM auth_devices
         WHERE user_id = ?
           AND client_type = ?
           AND client_instance_id = ?
         LIMIT 1`
      )
      .get(userId, clientType, clientInstanceId) as DeviceRow | undefined;

    return row ? mapDeviceRow(row) : null;
  }

  listByIds(ids: string[]): AuthDeviceRecord[] {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT id, user_id, client_type, client_instance_id, display_name, user_agent, is_primary,
                last_source_address, last_seen_at, primary_set_at, created_at, updated_at
         FROM auth_devices
         WHERE id IN (${placeholders})
         ORDER BY updated_at DESC`
      )
      .all(...ids)
      .map((row) => mapDeviceRow(row as DeviceRow));
  }

  updateActivity(deviceId: string, input: {
    displayName: string | null;
    userAgent: string | null;
    lastSourceAddress: string | null;
    lastSeenAt: string;
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `UPDATE auth_devices
         SET display_name = ?,
             user_agent = ?,
             last_source_address = ?,
             last_seen_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.displayName, input.userAgent, input.lastSourceAddress, input.lastSeenAt, input.updatedAt, deviceId);
  }

  updatePrimary(deviceId: string, input: { isPrimary: boolean; primarySetAt: string | null; updatedAt: string }): void {
    this.db
      .prepare(
        `UPDATE auth_devices
         SET is_primary = ?,
             primary_set_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.isPrimary ? 1 : 0, input.primarySetAt, input.updatedAt, deviceId);
  }
}

interface DeviceRow {
  id: string;
  user_id: string;
  client_type: AuthClientType;
  client_instance_id: string | null;
  display_name: string | null;
  user_agent: string | null;
  is_primary: number;
  last_source_address: string | null;
  last_seen_at: string;
  primary_set_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapDeviceRow(row: DeviceRow): AuthDeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientType: row.client_type,
    clientInstanceId: row.client_instance_id,
    displayName: row.display_name,
    userAgent: row.user_agent,
    isPrimary: row.is_primary === 1,
    lastSourceAddress: row.last_source_address,
    lastSeenAt: row.last_seen_at,
    primarySetAt: row.primary_set_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
