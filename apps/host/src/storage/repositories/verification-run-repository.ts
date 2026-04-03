import type Database from "better-sqlite3";

export interface VerificationRunRecord {
  id: string;
  projectId: string;
  butlerSessionId: string | null;
  sourcePatrolRunId: string | null;
  verificationType: string;
  status: string;
  targetRef: string | null;
  specJson: string;
  artifactRefsJson: string;
  resultJson: string;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export class VerificationRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: VerificationRunRecord): VerificationRunRecord {
    this.db
      .prepare(
        `INSERT INTO verification_runs (
           id,
           project_id,
           butler_session_id,
           source_patrol_run_id,
           verification_type,
           status,
           target_ref,
           spec_json,
           artifact_refs_json,
           result_json,
           summary,
           started_at,
           finished_at,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.butlerSessionId,
        record.sourcePatrolRunId,
        record.verificationType,
        record.status,
        record.targetRef,
        record.specJson,
        record.artifactRefsJson,
        record.resultJson,
        record.summary,
        record.startedAt,
        record.finishedAt,
        record.createdAt
      );

    return record;
  }

  listByProject(
    projectId: string,
    filters?: { status?: string; verificationType?: string }
  ): VerificationRunRecord[] {
    const conditions: string[] = ["project_id = ?"];
    const values: unknown[] = [projectId];

    if (filters?.status) {
      conditions.push("status = ?");
      values.push(filters.status);
    }

    if (filters?.verificationType) {
      conditions.push("verification_type = ?");
      values.push(filters.verificationType);
    }

    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           butler_session_id,
           source_patrol_run_id,
           verification_type,
           status,
           target_ref,
           spec_json,
           artifact_refs_json,
           result_json,
           summary,
           started_at,
           finished_at,
           created_at
         FROM verification_runs
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`
      )
      .all(...values)
      .map((row) => row as VerificationRunRecord);
  }

  findById(id: string): VerificationRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           butler_session_id,
           source_patrol_run_id,
           verification_type,
           status,
           target_ref,
           spec_json,
           artifact_refs_json,
           result_json,
           summary,
           started_at,
           finished_at,
           created_at
         FROM verification_runs
         WHERE id = ?`
      )
      .get(id) as VerificationRunRecord | undefined;

    return row ?? null;
  }

  listRunningByProject(projectId: string): VerificationRunRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           butler_session_id,
           source_patrol_run_id,
           verification_type,
           status,
           target_ref,
           spec_json,
           artifact_refs_json,
           result_json,
           summary,
           started_at,
           finished_at,
           created_at
         FROM verification_runs
         WHERE project_id = ?
           AND status IN ('queued', 'running')
         ORDER BY created_at DESC`
      )
      .all(projectId)
      .map((row) => row as VerificationRunRecord);
  }

  update(record: VerificationRunRecord): VerificationRunRecord | null {
    this.db
      .prepare(
        `UPDATE verification_runs
         SET butler_session_id = ?,
             source_patrol_run_id = ?,
             verification_type = ?,
             status = ?,
             target_ref = ?,
             spec_json = ?,
             artifact_refs_json = ?,
             result_json = ?,
             summary = ?,
             started_at = ?,
             finished_at = ?
         WHERE id = ?`
      )
      .run(
        record.butlerSessionId,
        record.sourcePatrolRunId,
        record.verificationType,
        record.status,
        record.targetRef,
        record.specJson,
        record.artifactRefsJson,
        record.resultJson,
        record.summary,
        record.startedAt,
        record.finishedAt,
        record.id
      );

    return this.findById(record.id);
  }
}
