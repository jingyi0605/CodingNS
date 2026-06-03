import type Database from "better-sqlite3";

export interface OfficeOnlyOfficeSettingRecord {
  singletonKey: string;
  enabled: boolean;
  serverUrl: string | null;
  publicBaseUrl: string | null;
  callbackBaseUrl: string | null;
  userDisplayName: string | null;
  userAvatarUrl: string | null;
  jwtSecret: string | null;
  createdAt: string;
  updatedAt: string;
}

export class OfficeOnlyOfficeSettingRepository {
  constructor(private readonly db: Database.Database) {}

  find(): OfficeOnlyOfficeSettingRecord | null {
    const row = this.db
      .prepare(
        `SELECT singleton_key, enabled, server_url, public_base_url, callback_base_url, user_display_name, user_avatar_url, jwt_secret, created_at, updated_at
         FROM office_onlyoffice_settings
         WHERE singleton_key = 'default'`
      )
      .get() as OfficeOnlyOfficeSettingRow | undefined;

    return row ? mapOfficeOnlyOfficeSettingRow(row) : null;
  }

  upsert(record: OfficeOnlyOfficeSettingRecord): OfficeOnlyOfficeSettingRecord {
    this.db
      .prepare(
        `INSERT INTO office_onlyoffice_settings (
          singleton_key,
          enabled,
          server_url,
          public_base_url,
          callback_base_url,
          user_display_name,
          user_avatar_url,
          jwt_secret,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton_key) DO UPDATE SET
          enabled = excluded.enabled,
          server_url = excluded.server_url,
          public_base_url = excluded.public_base_url,
          callback_base_url = excluded.callback_base_url,
          user_display_name = excluded.user_display_name,
          user_avatar_url = excluded.user_avatar_url,
          jwt_secret = excluded.jwt_secret,
          updated_at = excluded.updated_at`
      )
      .run(
        record.singletonKey,
        record.enabled ? 1 : 0,
        record.serverUrl,
        record.publicBaseUrl,
        record.callbackBaseUrl,
        record.userDisplayName,
        record.userAvatarUrl,
        record.jwtSecret,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface OfficeOnlyOfficeSettingRow {
  singleton_key: string;
  enabled: number;
  server_url: string | null;
  public_base_url: string | null;
  callback_base_url: string | null;
  user_display_name: string | null;
  user_avatar_url: string | null;
  jwt_secret: string | null;
  created_at: string;
  updated_at: string;
}

function mapOfficeOnlyOfficeSettingRow(row: OfficeOnlyOfficeSettingRow): OfficeOnlyOfficeSettingRecord {
  return {
    singletonKey: row.singleton_key,
    enabled: row.enabled === 1,
    serverUrl: row.server_url,
    publicBaseUrl: row.public_base_url,
    callbackBaseUrl: row.callback_base_url,
    userDisplayName: row.user_display_name,
    userAvatarUrl: row.user_avatar_url,
    jwtSecret: row.jwt_secret,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
