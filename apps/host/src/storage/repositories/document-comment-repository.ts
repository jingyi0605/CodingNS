import type Database from "better-sqlite3";

import type { OfficeDocumentComment, OfficeDocumentCommentStatus } from "../../types/domain.js";

export class DocumentCommentRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeDocumentComment): OfficeDocumentComment {
    this.db
      .prepare(
        `INSERT INTO document_comments (
           id,
           document_id,
           revision_id,
           anchor_type,
           anchor_key,
           body,
           status,
           created_by,
           resolved_by,
           created_at,
           updated_at,
           resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.documentId,
        record.revisionId,
        record.anchorType,
        record.anchorKey,
        record.body,
        record.status,
        record.createdBy,
        record.resolvedBy,
        record.createdAt,
        record.updatedAt,
        record.resolvedAt
      );

    return record;
  }

  listByDocumentId(documentId: string, status?: OfficeDocumentCommentStatus): OfficeDocumentComment[] {
    const rows = status
      ? this.db
        .prepare(
          `SELECT
             id,
             document_id,
             revision_id,
             anchor_type,
             anchor_key,
             body,
             status,
             created_by,
             resolved_by,
             created_at,
             updated_at,
             resolved_at
           FROM document_comments
           WHERE document_id = ? AND status = ?
           ORDER BY created_at DESC`
        )
        .all(documentId, status)
      : this.db
        .prepare(
          `SELECT
             id,
             document_id,
             revision_id,
             anchor_type,
             anchor_key,
             body,
             status,
             created_by,
             resolved_by,
             created_at,
             updated_at,
             resolved_at
           FROM document_comments
           WHERE document_id = ?
           ORDER BY created_at DESC`
        )
        .all(documentId);

    return rows.map((row) => mapOfficeDocumentCommentRow(row as OfficeDocumentCommentRow));
  }

  findById(id: string): OfficeDocumentComment | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           document_id,
           revision_id,
           anchor_type,
           anchor_key,
           body,
           status,
           created_by,
           resolved_by,
           created_at,
           updated_at,
           resolved_at
         FROM document_comments
         WHERE id = ?`
      )
      .get(id) as OfficeDocumentCommentRow | undefined;

    return row ? mapOfficeDocumentCommentRow(row) : null;
  }

  update(record: OfficeDocumentComment): OfficeDocumentComment {
    this.db
      .prepare(
        `UPDATE document_comments
         SET revision_id = ?,
             anchor_type = ?,
             anchor_key = ?,
             body = ?,
             status = ?,
             created_by = ?,
             resolved_by = ?,
             updated_at = ?,
             resolved_at = ?
         WHERE id = ?`
      )
      .run(
        record.revisionId,
        record.anchorType,
        record.anchorKey,
        record.body,
        record.status,
        record.createdBy,
        record.resolvedBy,
        record.updatedAt,
        record.resolvedAt,
        record.id
      );

    return record;
  }
}

interface OfficeDocumentCommentRow {
  id: string;
  document_id: string;
  revision_id: string | null;
  anchor_type: string;
  anchor_key: string;
  body: string;
  status: OfficeDocumentCommentStatus;
  created_by: string;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function mapOfficeDocumentCommentRow(row: OfficeDocumentCommentRow): OfficeDocumentComment {
  return {
    id: row.id,
    documentId: row.document_id,
    revisionId: row.revision_id,
    anchorType: row.anchor_type,
    anchorKey: row.anchor_key,
    body: row.body,
    status: row.status,
    createdBy: row.created_by,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at
  };
}
