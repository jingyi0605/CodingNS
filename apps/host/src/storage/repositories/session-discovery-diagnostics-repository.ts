import type Database from "better-sqlite3";

import type { SessionDiscoveryDiagnosticRecord } from "../../types/domain.js";

export class SessionDiscoveryDiagnosticsRepository {
  private readonly listByWorkspaceIdStatement: Database.Statement<any[], any>;
  private readonly insertStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.listByWorkspaceIdStatement = this.db.prepare(
      `SELECT
         id,
         workspace_id,
         trigger_source,
         provider,
         is_complete,
         status,
         duration_ms,
         session_count,
         scanned_files,
         skipped_by_fingerprint,
         parsed_files,
         bytes_read,
         created_at
       FROM session_discovery_diagnostics
       WHERE workspace_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    );
    this.insertStatement = this.db.prepare(
      `INSERT INTO session_discovery_diagnostics (
         id,
         workspace_id,
         trigger_source,
         provider,
         is_complete,
         status,
         duration_ms,
         session_count,
         scanned_files,
         skipped_by_fingerprint,
         parsed_files,
         bytes_read,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
  }

  listByWorkspaceId(workspaceId: string, limit = 50): SessionDiscoveryDiagnosticRecord[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;

    return this.listByWorkspaceIdStatement
      .all(workspaceId, normalizedLimit)
      .map((row) => mapSessionDiscoveryDiagnosticRow(row as SessionDiscoveryDiagnosticRow));
  }

  insert(record: SessionDiscoveryDiagnosticRecord): void {
    this.insertStatement.run(
      record.id,
      record.workspaceId,
      record.triggerSource,
      record.provider,
      record.isComplete ? 1 : 0,
      record.status,
      record.durationMs,
      record.sessionCount,
      record.scannedFiles,
      record.skippedByFingerprint,
      record.parsedFiles,
      record.bytesRead,
      record.createdAt
    );
  }
}

interface SessionDiscoveryDiagnosticRow {
  id: string;
  workspace_id: string;
  trigger_source: string;
  provider: SessionDiscoveryDiagnosticRecord["provider"];
  is_complete: number;
  status: string;
  duration_ms: number;
  session_count: number;
  scanned_files: number;
  skipped_by_fingerprint: number;
  parsed_files: number;
  bytes_read: number;
  created_at: string;
}

function mapSessionDiscoveryDiagnosticRow(row: SessionDiscoveryDiagnosticRow): SessionDiscoveryDiagnosticRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    triggerSource: row.trigger_source,
    provider: row.provider,
    isComplete: row.is_complete === 1,
    status: row.status,
    durationMs: row.duration_ms,
    sessionCount: row.session_count,
    scannedFiles: row.scanned_files,
    skippedByFingerprint: row.skipped_by_fingerprint,
    parsedFiles: row.parsed_files,
    bytesRead: row.bytes_read,
    createdAt: row.created_at
  };
}
