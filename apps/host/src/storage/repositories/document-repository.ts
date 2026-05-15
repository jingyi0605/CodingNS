import type Database from "better-sqlite3";

import type { OfficeDocument, OfficeDocumentStatus } from "../../types/domain.js";

export interface OfficeDocumentListFilters {
  userId?: string;
  workspaceId?: string | null;
  status?: OfficeDocumentStatus;
  templateId?: string;
}

export class DocumentRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeDocument): OfficeDocument {
    this.db
      .prepare(
        `INSERT INTO documents (
           id,
           user_id,
           workspace_id,
           title,
           template_id,
           current_revision_id,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.workspaceId,
        record.title,
        record.templateId,
        record.currentRevisionId,
        record.status,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): OfficeDocument | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           title,
           template_id,
           current_revision_id,
           status,
           created_at,
           updated_at
         FROM documents
         WHERE id = ?`
      )
      .get(id) as OfficeDocumentRow | undefined;

    return row ? mapOfficeDocumentRow(row) : null;
  }

  list(filters: OfficeDocumentListFilters = {}): OfficeDocument[] {
    const whereParts: string[] = [];
    const values: Array<string | null> = [];

    if (filters.userId?.trim()) {
      whereParts.push("user_id = ?");
      values.push(filters.userId.trim());
    }

    if (filters.workspaceId !== undefined) {
      if (filters.workspaceId === null) {
        whereParts.push("workspace_id IS NULL");
      } else {
        whereParts.push("workspace_id = ?");
        values.push(filters.workspaceId.trim());
      }
    }

    if (filters.status) {
      whereParts.push("status = ?");
      values.push(filters.status);
    }

    if (filters.templateId?.trim()) {
      whereParts.push("template_id = ?");
      values.push(filters.templateId.trim());
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           title,
           template_id,
           current_revision_id,
           status,
           created_at,
           updated_at
         FROM documents
         ${whereClause}
         ORDER BY created_at DESC`
      )
      .all(...values)
      .map((row) => mapOfficeDocumentRow(row as OfficeDocumentRow));
  }

  update(record: OfficeDocument): OfficeDocument {
    this.db
      .prepare(
        `UPDATE documents
         SET user_id = ?,
             workspace_id = ?,
             title = ?,
             template_id = ?,
             current_revision_id = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.userId,
        record.workspaceId,
        record.title,
        record.templateId,
        record.currentRevisionId,
        record.status,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface OfficeDocumentRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  template_id: string;
  current_revision_id: string | null;
  status: OfficeDocumentStatus;
  created_at: string;
  updated_at: string;
}

function mapOfficeDocumentRow(row: OfficeDocumentRow): OfficeDocument {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    title: row.title,
    templateId: row.template_id,
    currentRevisionId: row.current_revision_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
