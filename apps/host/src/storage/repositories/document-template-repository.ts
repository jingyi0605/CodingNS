import type Database from "better-sqlite3";

import type { DocumentTemplate, DocumentTemplateStatus } from "../../types/domain.js";

export class DocumentTemplateRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: DocumentTemplate): DocumentTemplate {
    this.db
      .prepare(
        `INSERT INTO document_templates (
           id,
           template_key,
           display_name,
           engine,
           template_version,
           template_source_path,
           schema_json,
           mapping_json,
         output_formats_json,
          status,
          created_at,
          updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.templateKey,
        record.displayName,
        record.engine,
        record.templateVersion,
        record.templateSourcePath,
        record.schemaJson,
        record.mappingJson,
        record.outputFormatsJson,
        record.status,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): DocumentTemplate | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           template_key,
           display_name,
           engine,
           template_version,
           template_source_path,
           schema_json,
           mapping_json,
           output_formats_json,
           status,
           created_at,
           updated_at
         FROM document_templates
         WHERE id = ?`
      )
      .get(id) as DocumentTemplateRow | undefined;

    return row ? mapDocumentTemplateRow(row) : null;
  }

  findByKey(templateKey: string): DocumentTemplate | null {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           template_key,
           display_name,
           engine,
           template_version,
           template_source_path,
           schema_json,
           mapping_json,
           output_formats_json,
           status,
           created_at,
           updated_at
         FROM document_templates
         WHERE template_key = ?
         ORDER BY created_at DESC`
      )
      .all(templateKey) as DocumentTemplateRow[];

    return sortDocumentTemplatesByVersion(rows.map(mapDocumentTemplateRow))[0] ?? null;
  }

  findActiveByKey(templateKey: string): DocumentTemplate | null {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           template_key,
           display_name,
           engine,
           template_version,
           template_source_path,
           schema_json,
           mapping_json,
           output_formats_json,
           status,
           created_at,
           updated_at
         FROM document_templates
         WHERE template_key = ? AND status = 'active'
         ORDER BY created_at DESC`
      )
      .all(templateKey) as DocumentTemplateRow[];

    return sortDocumentTemplatesByVersion(rows.map(mapDocumentTemplateRow))[0] ?? null;
  }

  findByKeyAndVersion(templateKey: string, templateVersion: string): DocumentTemplate | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           template_key,
           display_name,
           engine,
           template_version,
           schema_json,
           mapping_json,
           output_formats_json,
           status,
           created_at,
           updated_at
         FROM document_templates
         WHERE template_key = ? AND template_version = ?
         LIMIT 1`
      )
      .get(templateKey, templateVersion) as DocumentTemplateRow | undefined;

    return row ? mapDocumentTemplateRow(row) : null;
  }

  list(status?: DocumentTemplateStatus): DocumentTemplate[] {
    const rows = status
      ? this.db
        .prepare(
          `SELECT
             id,
             template_key,
             display_name,
             engine,
             template_version,
             template_source_path,
             schema_json,
             mapping_json,
             output_formats_json,
             status,
             created_at,
           updated_at
           FROM document_templates
           WHERE status = ?
           ORDER BY template_key ASC, created_at DESC`
        )
        .all(status)
      : this.db
        .prepare(
          `SELECT
             id,
             template_key,
             display_name,
             engine,
             template_version,
             template_source_path,
             schema_json,
             mapping_json,
             output_formats_json,
             status,
             created_at,
             updated_at
           FROM document_templates
           ORDER BY template_key ASC, created_at DESC`
        )
        .all();

    return sortDocumentTemplatesByVersion(rows.map((row) => mapDocumentTemplateRow(row as DocumentTemplateRow)));
  }

  update(record: DocumentTemplate): DocumentTemplate {
    this.db
      .prepare(
        `UPDATE document_templates
         SET display_name = ?,
             engine = ?,
             template_source_path = ?,
             schema_json = ?,
             mapping_json = ?,
             output_formats_json = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.displayName,
        record.engine,
        record.templateSourcePath,
        record.schemaJson,
        record.mappingJson,
        record.outputFormatsJson,
        record.status,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface DocumentTemplateRow {
  id: string;
  template_key: string;
  display_name: string;
  engine: "doct";
  template_version: string;
  template_source_path: string | null;
  schema_json: string;
  mapping_json: string;
  output_formats_json: string;
  status: DocumentTemplateStatus;
  created_at: string;
  updated_at: string;
}

function mapDocumentTemplateRow(row: DocumentTemplateRow): DocumentTemplate {
  return {
    id: row.id,
    templateKey: row.template_key,
    displayName: row.display_name,
    engine: row.engine,
    templateVersion: row.template_version,
    templateSourcePath: row.template_source_path,
    schemaJson: row.schema_json,
    mappingJson: row.mapping_json,
    outputFormatsJson: row.output_formats_json,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sortDocumentTemplatesByVersion(items: DocumentTemplate[]): DocumentTemplate[] {
  return [...items].sort((left, right) => {
    if (left.templateKey !== right.templateKey) {
      return left.templateKey.localeCompare(right.templateKey);
    }

    const versionCompare = compareTemplateVersion(right.templateVersion, left.templateVersion);
    if (versionCompare !== 0) {
      return versionCompare;
    }

    const updatedAtCompare = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtCompare !== 0) {
      return updatedAtCompare;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

function compareTemplateVersion(left: string, right: string): number {
  const leftParts = splitTemplateVersion(left);
  const rightParts = splitTemplateVersion(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    if (leftPart.kind === "number" && rightPart.kind === "number") {
      if (leftPart.value !== rightPart.value) {
        return leftPart.value - rightPart.value;
      }
      continue;
    }

    if (leftPart.kind === "number") {
      return 1;
    }

    if (rightPart.kind === "number") {
      return -1;
    }

    const textCompare = leftPart.value.localeCompare(rightPart.value);
    if (textCompare !== 0) {
      return textCompare;
    }
  }

  return left.localeCompare(right);
}

function splitTemplateVersion(value: string): Array<
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
> {
  return value
    .trim()
    .toLowerCase()
    .match(/\d+|[^\d]+/g)
    ?.map((part) => {
      if (/^\d+$/.test(part)) {
        return {
          kind: "number" as const,
          value: Number(part)
        };
      }

      return {
        kind: "text" as const,
        value: part
      };
    }) ?? [];
}
