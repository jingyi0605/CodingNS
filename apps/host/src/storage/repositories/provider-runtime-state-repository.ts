import type Database from "better-sqlite3";

import type { ProviderRuntimeStateRecord } from "../../types/domain.js";

export class ProviderRuntimeStateRepository {
  constructor(private readonly db: Database.Database) {}

  list(): ProviderRuntimeStateRecord[] {
    return this.db
      .prepare(
        `SELECT provider_id, install_state, version, updated_at
         FROM provider_runtime_states
         ORDER BY provider_id ASC`
      )
      .all()
      .map((row) => mapProviderRuntimeStateRow(row as ProviderRuntimeStateRow));
  }

  get(providerId: string): ProviderRuntimeStateRecord | null {
    const normalizedProviderId = providerId.trim();

    if (!normalizedProviderId) {
      return null;
    }

    const row = this.db
      .prepare(
        `SELECT provider_id, install_state, version, updated_at
         FROM provider_runtime_states
         WHERE provider_id = ?`
      )
      .get(normalizedProviderId) as ProviderRuntimeStateRow | undefined;

    return row ? mapProviderRuntimeStateRow(row) : null;
  }

  upsert(record: ProviderRuntimeStateRecord): ProviderRuntimeStateRecord {
    this.db
      .prepare(
        `INSERT INTO provider_runtime_states (
           provider_id,
           install_state,
           version,
           updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           install_state = excluded.install_state,
           version = excluded.version,
           updated_at = excluded.updated_at`
      )
      .run(
        record.providerId,
        record.installState,
        record.version,
        record.updatedAt
      );

    return record;
  }
}

interface ProviderRuntimeStateRow {
  provider_id: string;
  install_state: ProviderRuntimeStateRecord["installState"];
  version: string | null;
  updated_at: string;
}

function mapProviderRuntimeStateRow(row: ProviderRuntimeStateRow): ProviderRuntimeStateRecord {
  return {
    providerId: row.provider_id,
    installState: row.install_state,
    version: row.version,
    updatedAt: row.updated_at
  };
}
