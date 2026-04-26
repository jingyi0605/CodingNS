import type Database from "better-sqlite3";

import type { OpenCliProviderRecord } from "../../types/domain.js";

const DEFAULT_OPENCLI_PROVIDER_RECORD: OpenCliProviderRecord = {
  providerId: "opencli",
  enabled: false,
  installState: "not_installed",
  healthState: "unknown",
  version: null,
  installPath: null,
  lastCheckedAt: null,
  activeRuntimeId: null,
  lastErrorCode: null,
  lastErrorDetail: null,
  catalogRefreshedAt: null,
  catalogSource: null
};

export class OpenCliProviderRepository {
  constructor(private readonly db: Database.Database) {}

  get(providerId: OpenCliProviderRecord["providerId"] = "opencli"): OpenCliProviderRecord {
    const row = this.db
      .prepare(
        `SELECT
           provider_id,
           enabled,
           install_state,
           health_state,
           version,
           install_path,
           last_checked_at,
           active_runtime_id,
           last_error_code,
           last_error_detail,
           catalog_refreshed_at,
           catalog_source
         FROM opencli_providers
         WHERE provider_id = ?`
      )
      .get(providerId) as OpenCliProviderRow | undefined;

    return row ? mapOpenCliProviderRow(row) : { ...DEFAULT_OPENCLI_PROVIDER_RECORD, providerId };
  }

  upsert(record: OpenCliProviderRecord): OpenCliProviderRecord {
    this.db
      .prepare(
        `INSERT INTO opencli_providers (
           provider_id,
           enabled,
           install_state,
           health_state,
           version,
           install_path,
           last_checked_at,
           active_runtime_id,
           last_error_code,
           last_error_detail,
           catalog_refreshed_at,
           catalog_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           enabled = excluded.enabled,
           install_state = excluded.install_state,
           health_state = excluded.health_state,
           version = excluded.version,
           install_path = excluded.install_path,
           last_checked_at = excluded.last_checked_at,
           active_runtime_id = excluded.active_runtime_id,
           last_error_code = excluded.last_error_code,
           last_error_detail = excluded.last_error_detail,
           catalog_refreshed_at = excluded.catalog_refreshed_at,
           catalog_source = excluded.catalog_source`
      )
      .run(
        record.providerId,
        record.enabled ? 1 : 0,
        record.installState,
        record.healthState,
        record.version,
        record.installPath,
        record.lastCheckedAt,
        record.activeRuntimeId,
        record.lastErrorCode,
        record.lastErrorDetail,
        record.catalogRefreshedAt,
        record.catalogSource
      );

    return record;
  }
}

interface OpenCliProviderRow {
  provider_id: OpenCliProviderRecord["providerId"];
  enabled: number;
  install_state: OpenCliProviderRecord["installState"];
  health_state: OpenCliProviderRecord["healthState"];
  version: string | null;
  install_path: string | null;
  last_checked_at: string | null;
  active_runtime_id: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  catalog_refreshed_at: string | null;
  catalog_source: OpenCliProviderRecord["catalogSource"];
}

function mapOpenCliProviderRow(row: OpenCliProviderRow): OpenCliProviderRecord {
  return {
    providerId: row.provider_id,
    enabled: row.enabled === 1,
    installState: row.install_state,
    healthState: row.health_state,
    version: row.version,
    installPath: row.install_path,
    lastCheckedAt: row.last_checked_at,
    activeRuntimeId: row.active_runtime_id,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail,
    catalogRefreshedAt: row.catalog_refreshed_at,
    catalogSource: row.catalog_source
  };
}
