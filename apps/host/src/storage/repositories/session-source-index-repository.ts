import type Database from "better-sqlite3";

import type { SessionSourceIndexRecord } from "../../types/domain.js";

export class SessionSourceIndexRepository {
  private readonly findBySourceKeyStatement: Database.Statement<any[], any>;
  private readonly listByWorkspaceIdStatement: Database.Statement<any[], any>;
  private readonly upsertStatement: Database.Statement<any[], any>;
  private readonly deleteBySourceKeyStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.findBySourceKeyStatement = this.db.prepare(
      `SELECT
         source_key,
         provider,
         source_kind,
         workspace_id,
         provider_session_id,
         raw_store_ref,
         workspace_path,
         fingerprint_mtime_ms,
         fingerprint_size_bytes,
         fingerprint_inode,
         fingerprint_version,
         title,
         message_count,
         last_message_at,
         is_archived_hint,
         last_parsed_at,
         last_verified_at,
         sample_due_at,
         deleted_at,
         created_at,
         updated_at
       FROM session_source_index
       WHERE source_key = ?`
    );
    this.listByWorkspaceIdStatement = this.db.prepare(
      `SELECT
         source_key,
         provider,
         source_kind,
         workspace_id,
         provider_session_id,
         raw_store_ref,
         workspace_path,
         fingerprint_mtime_ms,
         fingerprint_size_bytes,
         fingerprint_inode,
         fingerprint_version,
         title,
         message_count,
         last_message_at,
         is_archived_hint,
         last_parsed_at,
         last_verified_at,
         sample_due_at,
         deleted_at,
         created_at,
         updated_at
       FROM session_source_index
       WHERE workspace_id = ?
       ORDER BY updated_at DESC, source_key ASC`
    );
    this.upsertStatement = this.db.prepare(
      `INSERT INTO session_source_index (
         source_key,
         provider,
         source_kind,
         workspace_id,
         provider_session_id,
         raw_store_ref,
         workspace_path,
         fingerprint_mtime_ms,
         fingerprint_size_bytes,
         fingerprint_inode,
         fingerprint_version,
         title,
         message_count,
         last_message_at,
         is_archived_hint,
         last_parsed_at,
         last_verified_at,
         sample_due_at,
         deleted_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         provider = excluded.provider,
         source_kind = excluded.source_kind,
         workspace_id = excluded.workspace_id,
         provider_session_id = excluded.provider_session_id,
         raw_store_ref = excluded.raw_store_ref,
         workspace_path = excluded.workspace_path,
         fingerprint_mtime_ms = excluded.fingerprint_mtime_ms,
         fingerprint_size_bytes = excluded.fingerprint_size_bytes,
         fingerprint_inode = excluded.fingerprint_inode,
         fingerprint_version = excluded.fingerprint_version,
         title = excluded.title,
         message_count = excluded.message_count,
         last_message_at = excluded.last_message_at,
         is_archived_hint = excluded.is_archived_hint,
         last_parsed_at = excluded.last_parsed_at,
         last_verified_at = excluded.last_verified_at,
         sample_due_at = excluded.sample_due_at,
         deleted_at = excluded.deleted_at,
         updated_at = excluded.updated_at`
    );
    this.deleteBySourceKeyStatement = this.db.prepare(
      `DELETE FROM session_source_index
       WHERE source_key = ?`
    );
  }

  findBySourceKey(sourceKey: string): SessionSourceIndexRecord | null {
    const row = this.findBySourceKeyStatement.get(sourceKey) as SessionSourceIndexRow | undefined;
    return row ? mapSessionSourceIndexRow(row) : null;
  }

  listByWorkspaceId(workspaceId: string): SessionSourceIndexRecord[] {
    return this.listByWorkspaceIdStatement
      .all(workspaceId)
      .map((row) => mapSessionSourceIndexRow(row as SessionSourceIndexRow));
  }

  upsert(record: SessionSourceIndexRecord): void {
    this.upsertStatement.run(
      record.sourceKey,
      record.provider,
      record.sourceKind,
      record.workspaceId,
      record.providerSessionId,
      record.rawStoreRef,
      record.workspacePath,
      record.fingerprintMtimeMs,
      record.fingerprintSizeBytes,
      record.fingerprintInode,
      record.fingerprintVersion,
      record.title,
      record.messageCount,
      record.lastMessageAt,
      mapBooleanToInteger(record.isArchivedHint),
      record.lastParsedAt,
      record.lastVerifiedAt,
      record.sampleDueAt,
      record.deletedAt,
      record.createdAt,
      record.updatedAt
    );
  }

  deleteBySourceKeys(sourceKeys: readonly string[]): number {
    let deletedCount = 0;

    for (const sourceKey of sourceKeys) {
      if (!sourceKey.trim()) {
        continue;
      }

      deletedCount += this.deleteBySourceKeyStatement.run(sourceKey).changes;
    }

    return deletedCount;
  }
}

interface SessionSourceIndexRow {
  source_key: string;
  provider: SessionSourceIndexRecord["provider"];
  source_kind: SessionSourceIndexRecord["sourceKind"];
  workspace_id: string | null;
  provider_session_id: string | null;
  raw_store_ref: string | null;
  workspace_path: string | null;
  fingerprint_mtime_ms: number | null;
  fingerprint_size_bytes: number | null;
  fingerprint_inode: string | null;
  fingerprint_version: string | null;
  title: string | null;
  message_count: number | null;
  last_message_at: string | null;
  is_archived_hint: number | null;
  last_parsed_at: string | null;
  last_verified_at: string | null;
  sample_due_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapSessionSourceIndexRow(row: SessionSourceIndexRow): SessionSourceIndexRecord {
  return {
    sourceKey: row.source_key,
    provider: row.provider,
    sourceKind: row.source_kind,
    workspaceId: row.workspace_id,
    providerSessionId: row.provider_session_id,
    rawStoreRef: row.raw_store_ref,
    workspacePath: row.workspace_path,
    fingerprintMtimeMs: row.fingerprint_mtime_ms,
    fingerprintSizeBytes: row.fingerprint_size_bytes,
    fingerprintInode: row.fingerprint_inode,
    fingerprintVersion: row.fingerprint_version,
    title: row.title,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    isArchivedHint: mapIntegerToBoolean(row.is_archived_hint),
    lastParsedAt: row.last_parsed_at,
    lastVerifiedAt: row.last_verified_at,
    sampleDueAt: row.sample_due_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBooleanToInteger(value: boolean | null): number | null {
  if (value === null) {
    return null;
  }

  return value ? 1 : 0;
}

function mapIntegerToBoolean(value: number | null): boolean | null {
  if (value === null) {
    return null;
  }

  return value === 1;
}
