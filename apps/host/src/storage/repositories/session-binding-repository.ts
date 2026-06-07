import type Database from "better-sqlite3";

import type { SessionBinding } from "../../types/domain.js";

export class SessionBindingRepository {
  private readonly findBySessionIdStatement: Database.Statement<any[], any>;
  private readonly findByProviderSessionStatement: Database.Statement<any[], any>;
  private readonly findByRawStoreRefStatement: Database.Statement<any[], any>;
  private readonly upsertStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.findBySessionIdStatement = this.db.prepare(
      `SELECT
         session_id,
         user_id,
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
    );
    this.findByProviderSessionStatement = this.db.prepare(
      `SELECT
         session_id,
         user_id,
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
    );
    this.findByRawStoreRefStatement = this.db.prepare(
      `SELECT
         session_id,
         user_id,
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
    );
    this.upsertStatement = this.db.prepare(
      `INSERT INTO session_bindings (
         session_id,
         user_id,
         workspace_id,
         provider,
         provider_session_id,
         raw_store_ref,
         provider_config_mode,
         provider_preset_id,
         runtime_home_dir,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         user_id = COALESCE(excluded.user_id, session_bindings.user_id),
         workspace_id = excluded.workspace_id,
         provider = excluded.provider,
         provider_session_id = excluded.provider_session_id,
         raw_store_ref = excluded.raw_store_ref,
         provider_config_mode = excluded.provider_config_mode,
         provider_preset_id = excluded.provider_preset_id,
         runtime_home_dir = excluded.runtime_home_dir,
         updated_at = excluded.updated_at`
    );
  }

  findBySessionId(sessionId: string): SessionBinding | null {
    const row = this.findBySessionIdStatement.get(sessionId) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findBySessionIdForUser(sessionId: string, userId: string): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           user_id,
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
         WHERE session_id = ?
           AND user_id = ?`
      )
      .get(sessionId, userId) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findByProviderSession(provider: string, providerSessionId: string): SessionBinding | null {
    const row = this.findByProviderSessionStatement.get(provider, providerSessionId) as
      | SessionBindingRow
      | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findByProviderSessionForUser(
    provider: string,
    providerSessionId: string,
    userId: string
  ): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           user_id,
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
           AND provider_session_id = ?
           AND user_id = ?`
      )
      .get(provider, providerSessionId, userId) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findByRawStoreRef(provider: string, rawStoreRef: string): SessionBinding | null {
    const row = this.findByRawStoreRefStatement.get(provider, rawStoreRef) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  findByRawStoreRefForUser(provider: string, rawStoreRef: string, userId: string): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           session_id,
           user_id,
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
           AND raw_store_ref = ?
           AND user_id = ?`
      )
      .get(provider, rawStoreRef, userId) as SessionBindingRow | undefined;

    return row ? mapSessionBindingRow(row) : null;
  }

  upsert(record: SessionBinding): void {
    this.upsertStatement
      .run(
        record.sessionId,
        record.userId,
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
  user_id: string | null;
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
    userId: row.user_id,
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
