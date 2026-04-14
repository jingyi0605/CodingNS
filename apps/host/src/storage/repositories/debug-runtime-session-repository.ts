import type Database from "better-sqlite3";

import type { DebugRuntimeSession, DebugRuntimeSessionStatus } from "../../types/domain.js";

export class DebugRuntimeSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: DebugRuntimeSession): DebugRuntimeSession {
    this.db
      .prepare(
        `INSERT INTO debug_runtime_sessions (
          id,
          target_id,
          status,
          failure_stage,
          started_at,
          stopped_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.targetId,
        record.status,
        record.failureStage ?? null,
        record.startedAt ?? null,
        record.stoppedAt ?? null,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): DebugRuntimeSession | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          target_id,
          status,
          failure_stage,
          started_at,
          stopped_at,
          created_at,
          updated_at
        FROM debug_runtime_sessions
        WHERE id = ?`
      )
      .get(id) as DebugRuntimeSessionRow | undefined;

    return row ? mapDebugRuntimeSessionRow(row) : null;
  }

  listByTargetId(targetId: string): DebugRuntimeSession[] {
    return this.db
      .prepare(
        `SELECT
          id,
          target_id,
          status,
          failure_stage,
          started_at,
          stopped_at,
          created_at,
          updated_at
        FROM debug_runtime_sessions
        WHERE target_id = ?
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(targetId)
      .map((row) => mapDebugRuntimeSessionRow(row as DebugRuntimeSessionRow));
  }

  listByStatuses(statuses: DebugRuntimeSessionStatus[]): DebugRuntimeSession[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => "?").join(", ");

    return this.db
      .prepare(
        `SELECT
          id,
          target_id,
          status,
          failure_stage,
          started_at,
          stopped_at,
          created_at,
          updated_at
        FROM debug_runtime_sessions
        WHERE status IN (${placeholders})
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...statuses)
      .map((row) => mapDebugRuntimeSessionRow(row as DebugRuntimeSessionRow));
  }

  update(record: DebugRuntimeSession): DebugRuntimeSession | null {
    this.db
      .prepare(
        `UPDATE debug_runtime_sessions
         SET status = ?,
             failure_stage = ?,
             started_at = ?,
             stopped_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.status,
        record.failureStage ?? null,
        record.startedAt ?? null,
        record.stoppedAt ?? null,
        record.updatedAt,
        record.id
      );

    return this.findById(record.id);
  }
}

interface DebugRuntimeSessionRow {
  id: string;
  target_id: string;
  status: DebugRuntimeSession["status"];
  failure_stage: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapDebugRuntimeSessionRow(row: DebugRuntimeSessionRow): DebugRuntimeSession {
  return {
    id: row.id,
    targetId: row.target_id,
    status: row.status,
    failureStage: row.failure_stage,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
