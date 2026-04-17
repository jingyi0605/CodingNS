import type Database from "better-sqlite3";

import type {
  AssistantSandboxStatus,
  AssistantSandboxWorkspace
} from "../../types/domain.js";

export class AssistantSandboxWorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AssistantSandboxWorkspace): AssistantSandboxWorkspace {
    this.db
      .prepare(
        `INSERT INTO assistant_sandboxes (
           id,
           user_id,
           workspace_id,
           title,
           description,
           source_kind,
           source_ref,
           visibility,
           status,
           purpose,
           expires_at,
           promoted_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.workspaceId,
        record.title,
        record.description,
        record.sourceKind,
        record.sourceRef,
        record.visibility,
        record.status,
        record.purpose,
        record.expiresAt,
        record.promotedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): AssistantSandboxWorkspace | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           title,
           description,
           source_kind,
           source_ref,
           visibility,
           status,
           purpose,
           expires_at,
           promoted_at,
           created_at,
           updated_at
         FROM assistant_sandboxes
         WHERE id = ?`
      )
      .get(id) as AssistantSandboxWorkspaceRow | undefined;

    return row ? mapRow(row) : null;
  }

  findByWorkspaceId(workspaceId: string): AssistantSandboxWorkspace | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           title,
           description,
           source_kind,
           source_ref,
           visibility,
           status,
           purpose,
           expires_at,
           promoted_at,
           created_at,
           updated_at
         FROM assistant_sandboxes
         WHERE workspace_id = ?`
      )
      .get(workspaceId) as AssistantSandboxWorkspaceRow | undefined;

    return row ? mapRow(row) : null;
  }

  list(filters: {
    userId?: string;
    statuses?: AssistantSandboxStatus[];
    limit?: number;
  } = {}): AssistantSandboxWorkspace[] {
    const whereParts: string[] = [];
    const values: Array<string | number> = [];

    if (filters.userId?.trim()) {
      whereParts.push("user_id = ?");
      values.push(filters.userId.trim());
    }

    if (filters.statuses?.length) {
      whereParts.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
      values.push(...filters.statuses);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const limitClause = filters.limit ? "LIMIT ?" : "";

    if (filters.limit) {
      values.push(filters.limit);
    }

    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           title,
           description,
           source_kind,
           source_ref,
           visibility,
           status,
           purpose,
           expires_at,
           promoted_at,
           created_at,
           updated_at
         FROM assistant_sandboxes
         ${whereClause}
         ORDER BY updated_at DESC, created_at DESC
         ${limitClause}`
      )
      .all(...values)
      .map((row) => mapRow(row as AssistantSandboxWorkspaceRow));
  }

  listManagedWorkspaceIds(): string[] {
    return this.db
      .prepare(
        `SELECT workspace_id
         FROM assistant_sandboxes
         WHERE status != 'deleted'`
      )
      .all()
      .map((row) => (row as { workspace_id: string }).workspace_id);
  }

  update(record: AssistantSandboxWorkspace): AssistantSandboxWorkspace {
    this.db
      .prepare(
        `UPDATE assistant_sandboxes
         SET title = ?,
             description = ?,
             source_kind = ?,
             source_ref = ?,
             visibility = ?,
             status = ?,
             purpose = ?,
             expires_at = ?,
             promoted_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.title,
        record.description,
        record.sourceKind,
        record.sourceRef,
        record.visibility,
        record.status,
        record.purpose,
        record.expiresAt,
        record.promotedAt,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface AssistantSandboxWorkspaceRow {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  source_kind: AssistantSandboxWorkspace["sourceKind"];
  source_ref: string | null;
  visibility: AssistantSandboxWorkspace["visibility"];
  status: AssistantSandboxWorkspace["status"];
  purpose: string | null;
  expires_at: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: AssistantSandboxWorkspaceRow): AssistantSandboxWorkspace {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    visibility: row.visibility,
    status: row.status,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    promotedAt: row.promoted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
