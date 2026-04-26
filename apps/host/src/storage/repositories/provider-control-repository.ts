import type Database from "better-sqlite3";

import type { ProviderControlRecord } from "../../types/domain.js";

const DEFAULT_PROVIDER_CONTROL_ENABLED = true;

export class ProviderControlRepository {
  constructor(private readonly db: Database.Database) {}

  list(): ProviderControlRecord[] {
    return this.db
      .prepare(
        `SELECT provider_id, enabled, updated_at
         FROM provider_control_profiles
         ORDER BY provider_id ASC`
      )
      .all()
      .map((row) => mapProviderControlRow(row as ProviderControlRow));
  }

  get(providerId: string): ProviderControlRecord {
    const normalizedProviderId = providerId.trim();
    const row = this.db
      .prepare(
        `SELECT provider_id, enabled, updated_at
         FROM provider_control_profiles
         WHERE provider_id = ?`
      )
      .get(normalizedProviderId) as ProviderControlRow | undefined;

    return row
      ? mapProviderControlRow(row)
      : {
          providerId: normalizedProviderId,
          enabled: DEFAULT_PROVIDER_CONTROL_ENABLED,
          updatedAt: ""
        };
  }

  upsert(record: ProviderControlRecord): ProviderControlRecord {
    this.db
      .prepare(
        `INSERT INTO provider_control_profiles (
           provider_id,
           enabled,
           updated_at
         ) VALUES (?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(
        record.providerId,
        record.enabled ? 1 : 0,
        record.updatedAt
      );

    return record;
  }
}

interface ProviderControlRow {
  provider_id: string;
  enabled: number;
  updated_at: string;
}

function mapProviderControlRow(row: ProviderControlRow): ProviderControlRecord {
  return {
    providerId: row.provider_id,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at
  };
}
