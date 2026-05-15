import type Database from "better-sqlite3";

import type { OpsTarget, OpsTargetKind, OpsTargetStatus } from "../../types/domain.js";

export interface OpsTargetListFilters {
  userId?: string;
  kind?: OpsTargetKind;
  status?: OpsTargetStatus;
}

export class OpsTargetRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OpsTarget): OpsTarget {
    this.db
      .prepare(
        `INSERT INTO ops_targets (
           id,
           user_id,
           kind,
           display_name,
           environment,
           config_json,
           credential_ref,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.kind,
        record.displayName,
        record.environment,
        record.configJson,
        record.credentialRef,
        record.status,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): OpsTarget | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           kind,
           display_name,
           environment,
           config_json,
           credential_ref,
           status,
           created_at,
           updated_at
         FROM ops_targets
         WHERE id = ?`
      )
      .get(id) as OpsTargetRow | undefined;

    return row ? mapOpsTargetRow(row) : null;
  }

  list(filters: OpsTargetListFilters = {}): OpsTarget[] {
    const whereParts: string[] = [];
    const values: string[] = [];

    if (filters.userId?.trim()) {
      whereParts.push("user_id = ?");
      values.push(filters.userId.trim());
    }

    if (filters.kind) {
      whereParts.push("kind = ?");
      values.push(filters.kind);
    }

    if (filters.status) {
      whereParts.push("status = ?");
      values.push(filters.status);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           kind,
           display_name,
           environment,
           config_json,
           credential_ref,
           status,
           created_at,
           updated_at
         FROM ops_targets
         ${whereClause}
         ORDER BY created_at DESC`
      )
      .all(...values)
      .map((row) => mapOpsTargetRow(row as OpsTargetRow));
  }

  update(record: OpsTarget): OpsTarget {
    this.db
      .prepare(
        `UPDATE ops_targets
         SET user_id = ?,
             kind = ?,
             display_name = ?,
             environment = ?,
             config_json = ?,
             credential_ref = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.userId,
        record.kind,
        record.displayName,
        record.environment,
        record.configJson,
        record.credentialRef,
        record.status,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface OpsTargetRow {
  id: string;
  user_id: string;
  kind: OpsTargetKind;
  display_name: string;
  environment: string | null;
  config_json: string;
  credential_ref: string | null;
  status: OpsTargetStatus;
  created_at: string;
  updated_at: string;
}

function mapOpsTargetRow(row: OpsTargetRow): OpsTarget {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    displayName: row.display_name,
    environment: row.environment,
    configJson: row.config_json,
    credentialRef: row.credential_ref,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
