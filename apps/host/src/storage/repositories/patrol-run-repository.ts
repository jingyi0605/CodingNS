import type Database from "better-sqlite3";

export interface PatrolRunRecord {
  id: string;
  projectId: string;
  planId: string | null;
  triggeredBy: string;
  triggerRef: string | null;
  butlerSessionId: string | null;
  status: string;
  summary: string | null;
  riskLevel: string | null;
  suggestionsJson: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export class PatrolRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PatrolRunRecord): PatrolRunRecord {
    this.db
      .prepare(
        `INSERT INTO patrol_runs (
           id,
           project_id,
           plan_id,
           triggered_by,
           trigger_ref,
           butler_session_id,
           status,
           summary,
           risk_level,
           suggestions_json,
           started_at,
           finished_at,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.planId,
        record.triggeredBy,
        record.triggerRef,
        record.butlerSessionId,
        record.status,
        record.summary,
        record.riskLevel,
        record.suggestionsJson,
        record.startedAt,
        record.finishedAt,
        record.createdAt
      );

    return record;
  }

  listByProject(projectId: string, filters?: { status?: string; triggeredBy?: string }): PatrolRunRecord[] {
    const conditions: string[] = ["project_id = ?"];
    const values: unknown[] = [projectId];

    if (filters?.status) {
      conditions.push("status = ?");
      values.push(filters.status);
    }

    if (filters?.triggeredBy) {
      conditions.push("triggered_by = ?");
      values.push(filters.triggeredBy);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           plan_id,
           triggered_by,
           trigger_ref,
           butler_session_id,
           status,
           summary,
           risk_level,
           suggestions_json,
           started_at,
           finished_at,
           created_at
         FROM patrol_runs
         ${where}
         ORDER BY created_at DESC`
      )
      .all(...values)
      .map((row) => row as PatrolRunRecord);
  }

  findById(id: string): PatrolRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           plan_id,
           triggered_by,
           trigger_ref,
           butler_session_id,
           status,
           summary,
           risk_level,
           suggestions_json,
           started_at,
           finished_at,
           created_at
         FROM patrol_runs
         WHERE id = ?`
      )
      .get(id) as PatrolRunRecord | undefined;

    return row ?? null;
  }

  listRunningByProject(projectId: string): PatrolRunRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           plan_id,
           triggered_by,
           trigger_ref,
           butler_session_id,
           status,
           summary,
           risk_level,
           suggestions_json,
           started_at,
           finished_at,
           created_at
         FROM patrol_runs
         WHERE project_id = ?
           AND status = 'running'
         ORDER BY created_at DESC`
      )
      .all(projectId)
      .map((row) => row as PatrolRunRecord);
  }

  update(record: PatrolRunRecord): PatrolRunRecord | null {
    this.db
      .prepare(
        `UPDATE patrol_runs
         SET plan_id = ?,
             triggered_by = ?,
             trigger_ref = ?,
             butler_session_id = ?,
             status = ?,
             summary = ?,
             risk_level = ?,
             suggestions_json = ?,
             started_at = ?,
             finished_at = ?
         WHERE id = ?`
      )
      .run(
        record.planId,
        record.triggeredBy,
        record.triggerRef,
        record.butlerSessionId,
        record.status,
        record.summary,
        record.riskLevel,
        record.suggestionsJson,
        record.startedAt,
        record.finishedAt,
        record.id
      );

    return this.findById(record.id);
  }
}
