import type Database from "better-sqlite3";

import type { OpenCliRuntimeProfileRecord, OpenCliRuntimeProfileStatus } from "../../types/domain.js";

export class OpenCliRuntimeProfileRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): OpenCliRuntimeProfileRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           version,
           source_install_path,
           enabled_command_ids_json,
           runtime_root_path,
           status,
           content_hash,
           created_at,
           updated_at,
           last_error_code,
           last_error_detail
         FROM opencli_runtime_profiles
         WHERE id = ?`
      )
      .get(id) as OpenCliRuntimeProfileRow | undefined;

    return row ? mapOpenCliRuntimeProfileRow(row) : null;
  }

  findByContentHash(contentHash: string): OpenCliRuntimeProfileRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           version,
           source_install_path,
           enabled_command_ids_json,
           runtime_root_path,
           status,
           content_hash,
           created_at,
           updated_at,
           last_error_code,
           last_error_detail
         FROM opencli_runtime_profiles
         WHERE content_hash = ?`
      )
      .get(contentHash) as OpenCliRuntimeProfileRow | undefined;

    return row ? mapOpenCliRuntimeProfileRow(row) : null;
  }

  list(): OpenCliRuntimeProfileRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           version,
           source_install_path,
           enabled_command_ids_json,
           runtime_root_path,
           status,
           content_hash,
           created_at,
           updated_at,
           last_error_code,
           last_error_detail
         FROM opencli_runtime_profiles
         ORDER BY updated_at DESC, created_at DESC, id ASC`
      )
      .all()
      .map((row) => mapOpenCliRuntimeProfileRow(row as OpenCliRuntimeProfileRow));
  }

  listByStatus(status: OpenCliRuntimeProfileStatus): OpenCliRuntimeProfileRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           version,
           source_install_path,
           enabled_command_ids_json,
           runtime_root_path,
           status,
           content_hash,
           created_at,
           updated_at,
           last_error_code,
           last_error_detail
         FROM opencli_runtime_profiles
         WHERE status = ?
         ORDER BY updated_at DESC, created_at DESC, id ASC`
      )
      .all(status)
      .map((row) => mapOpenCliRuntimeProfileRow(row as OpenCliRuntimeProfileRow));
  }

  upsert(record: OpenCliRuntimeProfileRecord): OpenCliRuntimeProfileRecord {
    this.db
      .prepare(
        `INSERT INTO opencli_runtime_profiles (
           id,
           version,
           source_install_path,
           enabled_command_ids_json,
           runtime_root_path,
           status,
           content_hash,
           created_at,
           updated_at,
           last_error_code,
           last_error_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           source_install_path = excluded.source_install_path,
           enabled_command_ids_json = excluded.enabled_command_ids_json,
           runtime_root_path = excluded.runtime_root_path,
           status = excluded.status,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at,
           last_error_code = excluded.last_error_code,
           last_error_detail = excluded.last_error_detail`
      )
      .run(
        record.id,
        record.version,
        record.sourceInstallPath,
        record.enabledCommandIdsJson,
        record.runtimeRootPath,
        record.status,
        record.contentHash,
        record.createdAt,
        record.updatedAt,
        record.lastErrorCode,
        record.lastErrorDetail
      );

    return record;
  }
}

interface OpenCliRuntimeProfileRow {
  id: string;
  version: string;
  source_install_path: string;
  enabled_command_ids_json: string;
  runtime_root_path: string;
  status: OpenCliRuntimeProfileRecord["status"];
  content_hash: string;
  created_at: string;
  updated_at: string;
  last_error_code: string | null;
  last_error_detail: string | null;
}

function mapOpenCliRuntimeProfileRow(row: OpenCliRuntimeProfileRow): OpenCliRuntimeProfileRecord {
  return {
    id: row.id,
    version: row.version,
    sourceInstallPath: row.source_install_path,
    enabledCommandIdsJson: row.enabled_command_ids_json,
    runtimeRootPath: row.runtime_root_path,
    status: row.status,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail
  };
}
