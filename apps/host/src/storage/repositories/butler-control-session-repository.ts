import type Database from "better-sqlite3";

import type { ButlerControlSession } from "../../types/domain.js";

export class ButlerControlSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerControlSession): ButlerControlSession {
    this.db
      .prepare(
        `INSERT INTO butler_control_sessions (
           id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.providerId,
        record.sessionId,
        record.purpose,
        record.title,
        record.sourceItemId,
        record.status,
        record.lastContextVersion,
        record.lastSummary,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): ButlerControlSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         FROM butler_control_sessions
         WHERE id = ?`
      )
      .get(id) as ButlerControlSessionRow | undefined;

    return row ? mapButlerControlSessionRow(row) : null;
  }

  findLatestByProvider(providerId: ButlerControlSession["providerId"]): ButlerControlSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         FROM butler_control_sessions
         WHERE provider_id = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`
      )
      .get(providerId) as ButlerControlSessionRow | undefined;

    return row ? mapButlerControlSessionRow(row) : null;
  }

  findLatestOpenByProvider(providerId: ButlerControlSession["providerId"]): ButlerControlSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         FROM butler_control_sessions
         WHERE provider_id = ?
           AND status != 'closed'
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`
      )
      .get(providerId) as ButlerControlSessionRow | undefined;

    return row ? mapButlerControlSessionRow(row) : null;
  }

  listByProvider(providerId: ButlerControlSession["providerId"]): ButlerControlSession[] {
    return this.db
      .prepare(
        `SELECT
           id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         FROM butler_control_sessions
         WHERE provider_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(providerId)
      .map((row) => mapButlerControlSessionRow(row as ButlerControlSessionRow));
  }

  findBySessionId(sessionId: string): ButlerControlSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         FROM butler_control_sessions
         WHERE session_id = ?`
      )
      .get(sessionId) as ButlerControlSessionRow | undefined;

    return row ? mapButlerControlSessionRow(row) : null;
  }

  listSessionIds(): string[] {
    return this.db
      .prepare(
        `SELECT session_id
         FROM butler_control_sessions`
      )
      .all()
      .map((row) => String((row as { session_id: string }).session_id));
  }

  update(record: ButlerControlSession): ButlerControlSession {
    this.db
      .prepare(
        `UPDATE butler_control_sessions
         SET purpose = ?,
             title = ?,
             source_item_id = ?,
             status = ?,
             last_context_version = ?,
             last_summary = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.purpose,
        record.title,
        record.sourceItemId,
        record.status,
        record.lastContextVersion,
        record.lastSummary,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface ButlerControlSessionRow {
  id: string;
  provider_id: ButlerControlSession["providerId"];
  session_id: string;
  purpose: ButlerControlSession["purpose"];
  title: string | null;
  source_item_id: string | null;
  status: ButlerControlSession["status"];
  last_context_version: string | null;
  last_summary: string | null;
  created_at: string;
  updated_at: string;
}

function mapButlerControlSessionRow(row: ButlerControlSessionRow): ButlerControlSession {
  return {
    id: row.id,
    providerId: row.provider_id,
    sessionId: row.session_id,
    purpose: row.purpose,
    title: row.title,
    sourceItemId: row.source_item_id,
    status: row.status,
    lastContextVersion: row.last_context_version,
    lastSummary: row.last_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
