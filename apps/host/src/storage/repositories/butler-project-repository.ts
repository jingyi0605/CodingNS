import type Database from "better-sqlite3";

import type { ButlerProject } from "../../types/domain.js";

export class ButlerProjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerProject): ButlerProject {
    this.db
      .prepare(
        `INSERT INTO butler_projects (
           id,
           user_id,
           workspace_id,
           name,
           repo_root,
           default_provider,
           instruction_profile_id,
           approval_mode,
           lifecycle_status,
           risk_level,
           config_json,
           last_patrol_at,
           last_verification_at,
           created_at,
           updated_at,
           archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.workspaceId,
        record.name,
        record.repoRoot,
        record.defaultProvider,
        record.instructionProfileId,
        record.approvalMode,
        record.lifecycleStatus,
        record.riskLevel,
        JSON.stringify(record.config),
        record.lastPatrolAt,
        record.lastVerificationAt,
        record.createdAt,
        record.updatedAt,
        record.archivedAt
      );

    return record;
  }

  list(filters?: {
    userId?: string;
    workspaceId?: string;
    lifecycleStatus?: ButlerProject["lifecycleStatus"];
    riskLevel?: ButlerProject["riskLevel"];
  }): ButlerProject[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.userId) {
      conditions.push("user_id = ?");
      values.push(filters.userId);
    }

    if (filters?.workspaceId) {
      conditions.push("workspace_id = ?");
      values.push(filters.workspaceId);
    }

    if (filters?.lifecycleStatus) {
      conditions.push("lifecycle_status = ?");
      values.push(filters.lifecycleStatus);
    }

    if (filters?.riskLevel) {
      conditions.push("risk_level = ?");
      values.push(filters.riskLevel);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           name,
           repo_root,
           default_provider,
           instruction_profile_id,
           approval_mode,
           lifecycle_status,
           risk_level,
           config_json,
           last_patrol_at,
           last_verification_at,
           created_at,
           updated_at,
           archived_at
         FROM butler_projects
         ${whereClause}
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...values)
      .map((row) => mapButlerProjectRow(row as ButlerProjectRow));
  }

  findById(id: string): ButlerProject | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           name,
           repo_root,
           default_provider,
           instruction_profile_id,
           approval_mode,
           lifecycle_status,
           risk_level,
           config_json,
           last_patrol_at,
           last_verification_at,
           created_at,
           updated_at,
           archived_at
         FROM butler_projects
         WHERE id = ?`
      )
      .get(id) as ButlerProjectRow | undefined;

    return row ? mapButlerProjectRow(row) : null;
  }

  findByIdForUser(id: string, userId: string): ButlerProject | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           name,
           repo_root,
           default_provider,
           instruction_profile_id,
           approval_mode,
           lifecycle_status,
           risk_level,
           config_json,
           last_patrol_at,
           last_verification_at,
           created_at,
           updated_at,
           archived_at
         FROM butler_projects
         WHERE id = ?
           AND user_id = ?`
      )
      .get(id, userId) as ButlerProjectRow | undefined;

    return row ? mapButlerProjectRow(row) : null;
  }

  update(record: ButlerProject): ButlerProject | null {
    this.db
      .prepare(
        `UPDATE butler_projects
         SET name = ?,
             repo_root = ?,
             default_provider = ?,
             instruction_profile_id = ?,
             approval_mode = ?,
             lifecycle_status = ?,
             risk_level = ?,
             config_json = ?,
             last_patrol_at = ?,
             last_verification_at = ?,
             archived_at = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`
      )
      .run(
        record.name,
        record.repoRoot,
        record.defaultProvider,
        record.instructionProfileId,
        record.approvalMode,
        record.lifecycleStatus,
        record.riskLevel,
        JSON.stringify(record.config),
        record.lastPatrolAt,
        record.lastVerificationAt,
        record.archivedAt,
        record.updatedAt,
        record.id,
        record.userId
      );

    return this.findById(record.id);
  }
}

interface ButlerProjectRow {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  repo_root: string;
  default_provider: string | null;
  instruction_profile_id: string | null;
  approval_mode: ButlerProject["approvalMode"];
  lifecycle_status: ButlerProject["lifecycleStatus"];
  risk_level: ButlerProject["riskLevel"];
  config_json: string;
  last_patrol_at: string | null;
  last_verification_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function mapButlerProjectRow(row: ButlerProjectRow): ButlerProject {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    name: row.name,
    repoRoot: row.repo_root,
    defaultProvider: row.default_provider,
    instructionProfileId: row.instruction_profile_id,
    approvalMode: row.approval_mode,
    lifecycleStatus: row.lifecycle_status,
    riskLevel: row.risk_level,
    config: parseJsonObject(row.config_json),
    lastPatrolAt: row.last_patrol_at,
    lastVerificationAt: row.last_verification_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
