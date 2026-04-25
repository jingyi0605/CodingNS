import type Database from "better-sqlite3";

import type { SessionBinding } from "../../types/domain.js";

export class SessionBindingRepository {
  constructor(private readonly db: Database.Database) {}

  findBySessionId(sessionId: string): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           workspace_id,
           provider,
           provider_session_id,
           raw_store_ref,
           provider_config_mode,
           provider_preset_id,
           runtime_home_dir,
           created_at,
           updated_at
         FROM session_bindings
         WHERE session_id = ?`
      )
      .get(sessionId) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findByProviderSession(provider: string, providerSessionId: string): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           workspace_id,
           provider,
           provider_session_id,
           raw_store_ref,
           provider_config_mode,
           provider_preset_id,
           runtime_home_dir,
           created_at,
           updated_at
         FROM session_bindings
         WHERE provider = ?
           AND provider_session_id = ?`
      )
      .get(provider, providerSessionId) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findByRawStoreRef(provider: string, rawStoreRef: string): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           workspace_id,
           provider,
           provider_session_id,
           raw_store_ref,
           provider_config_mode,
           provider_preset_id,
           runtime_home_dir,
           created_at,
           updated_at
         FROM session_bindings
         WHERE provider = ?
           AND raw_store_ref = ?`
      )
      .get(provider, rawStoreRef) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  upsert(record: SessionBinding): void {
    this.db
      .prepare(
        `INSERT INTO session_bindings (
           session_id,
           workspace_id,
           provider,
           provider_session_id,
           raw_store_ref,
           provider_config_mode,
           provider_preset_id,
           runtime_home_dir,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           provider = excluded.provider,
           provider_session_id = excluded.provider_session_id,
           raw_store_ref = excluded.raw_store_ref,
           provider_config_mode = excluded.provider_config_mode,
           provider_preset_id = excluded.provider_preset_id,
           runtime_home_dir = excluded.runtime_home_dir,
           updated_at = excluded.updated_at`
      )
      .run(
        record.sessionId,
        record.workspaceId,
        record.provider,
        record.providerSessionId,
        record.rawStoreRef,
        record.providerConfigMode,
        record.providerPresetId,
        record.runtimeHomeDir,
        record.createdAt,
        record.updatedAt
      );
  }
}

interface SessionBindingRow {
  session_id: string;
  workspace_id: string;
  provider: SessionBinding["provider"];
  provider_session_id: string;
  raw_store_ref: string;
  provider_config_mode: SessionBinding["providerConfigMode"];
  provider_preset_id: string | null;
  runtime_home_dir: string | null;
  created_at: string;
  updated_at: string;
}

function mapSessionBindingRow(row: SessionBindingRow): SessionBinding {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    rawStoreRef: row.raw_store_ref,
    providerConfigMode: row.provider_config_mode,
    providerPresetId: row.provider_preset_id,
    runtimeHomeDir: row.runtime_home_dir,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
