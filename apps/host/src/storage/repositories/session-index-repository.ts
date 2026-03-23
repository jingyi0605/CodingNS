import type Database from "better-sqlite3";

import type { SessionIndex } from "../../types/domain.js";

export class SessionIndexRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: SessionIndex): SessionIndex {
    this.db
      .prepare(
        `INSERT INTO session_indexes (
           id,
           workspace_id,
           provider,
           provider_session_id,
           title,
           status,
           last_message_at,
           raw_ref,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.provider,
        record.providerSessionId,
        record.title,
        record.status,
        record.lastMessageAt,
        record.rawRef,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  listByWorkspace(workspaceId: string): SessionIndex[] {
    return this.db
      .prepare(
        `SELECT id, workspace_id, provider, provider_session_id, title, status, last_message_at, raw_ref, created_at, updated_at
         FROM session_indexes
         WHERE workspace_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapSessionIndexRow(row as SessionIndexRow));
  }

  findById(sessionId: string): SessionIndex | null {
    const row = this.db
      .prepare(
        `SELECT id, workspace_id, provider, provider_session_id, title, status, last_message_at, raw_ref, created_at, updated_at
         FROM session_indexes
         WHERE id = ?`
      )
      .get(sessionId) as SessionIndexRow | undefined;

    return row ? mapSessionIndexRow(row) : null;
  }
}

interface SessionIndexRow {
  id: string;
  workspace_id: string;
  provider: string;
  provider_session_id: string;
  title: string | null;
  status: string;
  last_message_at: string | null;
  raw_ref: string;
  created_at: string;
  updated_at: string;
}

function mapSessionIndexRow(row: SessionIndexRow): SessionIndex {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    title: row.title,
    status: row.status,
    lastMessageAt: row.last_message_at,
    rawRef: row.raw_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
