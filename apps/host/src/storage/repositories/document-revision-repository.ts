import type Database from "better-sqlite3";

import type { OfficeDocumentRevision } from "../../types/domain.js";

export class DocumentRevisionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeDocumentRevision): OfficeDocumentRevision {
    this.db
      .prepare(
        `INSERT INTO document_revisions (
           id,
           document_id,
           revision_seq,
           base_revision_id,
           content_json,
           outline_json,
           summary,
           created_by,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.documentId,
        record.revisionSeq,
        record.baseRevisionId,
        record.contentJson,
        record.outlineJson,
        record.summary,
        record.createdBy,
        record.createdAt
      );

    return record;
  }

  findById(id: string): OfficeDocumentRevision | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           document_id,
           revision_seq,
           base_revision_id,
           content_json,
           outline_json,
           summary,
           created_by,
           created_at
         FROM document_revisions
         WHERE id = ?`
      )
      .get(id) as OfficeDocumentRevisionRow | undefined;

    return row ? mapOfficeDocumentRevisionRow(row) : null;
  }

  listByDocumentId(documentId: string): OfficeDocumentRevision[] {
    return this.db
      .prepare(
        `SELECT
           id,
           document_id,
           revision_seq,
           base_revision_id,
           content_json,
           outline_json,
           summary,
           created_by,
           created_at
         FROM document_revisions
         WHERE document_id = ?
         ORDER BY revision_seq DESC`
      )
      .all(documentId)
      .map((row) => mapOfficeDocumentRevisionRow(row as OfficeDocumentRevisionRow));
  }

  getNextRevisionSeq(documentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(revision_seq), 0) AS max_revision_seq
         FROM document_revisions
         WHERE document_id = ?`
      )
      .get(documentId) as { max_revision_seq: number } | undefined;

    return (row?.max_revision_seq ?? 0) + 1;
  }
}

interface OfficeDocumentRevisionRow {
  id: string;
  document_id: string;
  revision_seq: number;
  base_revision_id: string | null;
  content_json: string;
  outline_json: string | null;
  summary: string | null;
  created_by: string;
  created_at: string;
}

function mapOfficeDocumentRevisionRow(row: OfficeDocumentRevisionRow): OfficeDocumentRevision {
  return {
    id: row.id,
    documentId: row.document_id,
    revisionSeq: row.revision_seq,
    baseRevisionId: row.base_revision_id,
    contentJson: row.content_json,
    outlineJson: row.outline_json,
    summary: row.summary,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}
