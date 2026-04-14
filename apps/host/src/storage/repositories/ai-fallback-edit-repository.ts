import type Database from "better-sqlite3";

import type { AiFallbackEditRecord } from "../../types/domain.js";

export class AiFallbackEditRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AiFallbackEditRecord): AiFallbackEditRecord {
    this.db
      .prepare(
        `INSERT INTO ai_fallback_edits (
          id,
          runtime_id,
          service_id,
          reason,
          allowed_files_json,
          target_port,
          patch_ref,
          rollback_ref,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.runtimeId,
        record.serviceId,
        record.reason,
        JSON.stringify(record.allowedFiles),
        record.targetPort,
        record.patchRef ?? null,
        record.rollbackRef ?? null,
        record.status,
        record.createdAt
      );

    return record;
  }

  listByRuntimeId(runtimeId: string): AiFallbackEditRecord[] {
    return this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          reason,
          allowed_files_json,
          target_port,
          patch_ref,
          rollback_ref,
          status,
          created_at
        FROM ai_fallback_edits
        WHERE runtime_id = ?
        ORDER BY created_at DESC`
      )
      .all(runtimeId)
      .map((row) => mapAiFallbackEditRow(row as AiFallbackEditRow));
  }

  listBlockingByWorkspaceId(workspaceId: string): AiFallbackEditRecord[] {
    return this.db
      .prepare(
        `SELECT
          edits.id,
          edits.runtime_id,
          edits.service_id,
          edits.reason,
          edits.allowed_files_json,
          edits.target_port,
          edits.patch_ref,
          edits.rollback_ref,
          edits.status,
          edits.created_at
        FROM ai_fallback_edits AS edits
        INNER JOIN debug_runtime_sessions AS runtimes
          ON runtimes.id = edits.runtime_id
        INNER JOIN debug_targets AS targets
          ON targets.id = runtimes.target_id
        WHERE targets.workspace_id = ?
          AND edits.status IN ('PENDING', 'APPLIED')
        ORDER BY edits.created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapAiFallbackEditRow(row as AiFallbackEditRow));
  }

  update(record: AiFallbackEditRecord): AiFallbackEditRecord | null {
    this.db
      .prepare(
        `UPDATE ai_fallback_edits
         SET patch_ref = ?,
             rollback_ref = ?,
             status = ?
         WHERE id = ?`
      )
      .run(record.patchRef ?? null, record.rollbackRef ?? null, record.status, record.id);

    return this.findById(record.id);
  }

  findById(id: string): AiFallbackEditRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          reason,
          allowed_files_json,
          target_port,
          patch_ref,
          rollback_ref,
          status,
          created_at
        FROM ai_fallback_edits
        WHERE id = ?`
      )
      .get(id) as AiFallbackEditRow | undefined;

    return row ? mapAiFallbackEditRow(row) : null;
  }
}

interface AiFallbackEditRow {
  id: string;
  runtime_id: string;
  service_id: string;
  reason: string;
  allowed_files_json: string;
  target_port: number;
  patch_ref: string | null;
  rollback_ref: string | null;
  status: AiFallbackEditRecord["status"];
  created_at: string;
}

function mapAiFallbackEditRow(row: AiFallbackEditRow): AiFallbackEditRecord {
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    serviceId: row.service_id,
    reason: row.reason,
    allowedFiles: parseJsonStringArray(row.allowed_files_json),
    targetPort: row.target_port,
    patchRef: row.patch_ref,
    rollbackRef: row.rollback_ref,
    status: row.status,
    createdAt: row.created_at
  };
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
