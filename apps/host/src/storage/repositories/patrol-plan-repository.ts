import type Database from "better-sqlite3";

export interface PatrolPlanRecord {
  id: string;
  projectId: string;
  name: string;
  triggerType: string;
  triggerConfigJson: string;
  executionMode: string;
  patrolScopeJson: string;
  enabled: number;
  lastScheduledAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class PatrolPlanRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PatrolPlanRecord): PatrolPlanRecord {
    this.db
      .prepare(
        `INSERT INTO patrol_plans (
           id,
           project_id,
           name,
           trigger_type,
           trigger_config_json,
           execution_mode,
           patrol_scope_json,
           enabled,
           last_scheduled_at,
           next_run_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.name,
        record.triggerType,
        record.triggerConfigJson,
        record.executionMode,
        record.patrolScopeJson,
        record.enabled,
        record.lastScheduledAt,
        record.nextRunAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  listByProject(projectId: string, filters?: { enabled?: number; executionMode?: string }): PatrolPlanRecord[] {
    const conditions: string[] = ["project_id = ?"];
    const values: unknown[] = [projectId];

    if (filters?.enabled !== undefined) {
      conditions.push("enabled = ?");
      values.push(filters.enabled);
    }

    if (filters?.executionMode) {
      conditions.push("execution_mode = ?");
      values.push(filters.executionMode);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           name,
           trigger_type,
           trigger_config_json,
           execution_mode,
           patrol_scope_json,
           enabled,
           last_scheduled_at,
           next_run_at,
           created_at,
           updated_at
         FROM patrol_plans
         ${where}
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...values)
      .map((row) => row as PatrolPlanRecord);
  }

  findById(id: string): PatrolPlanRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           name,
           trigger_type,
           trigger_config_json,
           execution_mode,
           patrol_scope_json,
           enabled,
           last_scheduled_at,
           next_run_at,
           created_at,
           updated_at
         FROM patrol_plans
         WHERE id = ?`
      )
      .get(id) as PatrolPlanRecord | undefined;

    return row ?? null;
  }

  listDue(referenceTime: string, limit = 50): PatrolPlanRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           name,
           trigger_type,
           trigger_config_json,
           execution_mode,
           patrol_scope_json,
           enabled,
           last_scheduled_at,
           next_run_at,
           created_at,
           updated_at
         FROM patrol_plans
         WHERE enabled = 1
           AND trigger_type != 'manual'
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC, updated_at ASC
         LIMIT ?`
      )
      .all(referenceTime, limit)
      .map((row) => row as PatrolPlanRecord);
  }

  update(record: PatrolPlanRecord): PatrolPlanRecord | null {
    this.db
      .prepare(
        `UPDATE patrol_plans
         SET name = ?,
             trigger_type = ?,
             trigger_config_json = ?,
             execution_mode = ?,
             patrol_scope_json = ?,
             enabled = ?,
             last_scheduled_at = ?,
             next_run_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.name,
        record.triggerType,
        record.triggerConfigJson,
        record.executionMode,
        record.patrolScopeJson,
        record.enabled,
        record.lastScheduledAt,
        record.nextRunAt,
        record.updatedAt,
        record.id
      );

    return this.findById(record.id);
  }
}
