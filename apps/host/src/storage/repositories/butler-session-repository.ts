import type Database from "better-sqlite3";

import type { ButlerSession } from "../../types/domain.js";

export class ButlerSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerSession): ButlerSession {
    this.db
      .prepare(
        `INSERT INTO butler_sessions (
           id,
           user_id,
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.projectId,
        record.sessionId,
        record.role,
        record.ownershipMode,
        record.status,
        record.lastSummary,
        record.lastCheckpointAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  listByProject(projectId: string, userId?: string): ButlerSession[] {
    const userClause = userId?.trim() ? "AND user_id = ?" : "";
    const values = userId?.trim() ? [projectId, userId] : [projectId];

    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         FROM butler_sessions
         WHERE project_id = ?
           ${userClause}
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...values)
      .map((row) => mapButlerSessionRow(row as ButlerSessionRow));
  }

  findById(id: string): ButlerSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         FROM butler_sessions
         WHERE id = ?`
      )
      .get(id) as ButlerSessionRow | undefined;

    return row ? mapButlerSessionRow(row) : null;
  }

  findBySessionId(sessionId: string): ButlerSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         FROM butler_sessions
         WHERE session_id = ?`
      )
      .get(sessionId) as ButlerSessionRow | undefined;

    return row ? mapButlerSessionRow(row) : null;
  }

  findBySessionIdForUser(sessionId: string, userId: string): ButlerSession | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         FROM butler_sessions
         WHERE session_id = ?
           AND user_id = ?`
      )
      .get(sessionId, userId) as ButlerSessionRow | undefined;

    return row ? mapButlerSessionRow(row) : null;
  }

  update(record: ButlerSession): ButlerSession | null {
    this.db
      .prepare(
        `UPDATE butler_sessions
         SET role = ?,
             ownership_mode = ?,
             status = ?,
             last_summary = ?,
             last_checkpoint_at = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`
      )
      .run(
        record.role,
        record.ownershipMode,
        record.status,
        record.lastSummary,
        record.lastCheckpointAt,
        record.updatedAt,
        record.id,
        record.userId
      );

    return this.findById(record.id);
  }
}

interface ButlerSessionRow {
  id: string;
  user_id: string;
  project_id: string;
  session_id: string;
  role: ButlerSession["role"];
  ownership_mode: ButlerSession["ownershipMode"];
  status: ButlerSession["status"];
  last_summary: string | null;
  last_checkpoint_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapButlerSessionRow(row: ButlerSessionRow): ButlerSession {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    role: row.role,
    ownershipMode: row.ownership_mode,
    status: row.status,
    lastSummary: row.last_summary,
    lastCheckpointAt: row.last_checkpoint_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
