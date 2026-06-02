import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { openDatabase } from "../sqlite/open-database.js";
import type { FileScanResult } from "../scanner/file-scanner.js";
import type { ParsedDocument } from "../parser/plain-text-parser.js";
import type { TagAssignment } from "../tagging/simple-tag-inference.js";
import type {
  RecomputeScope,
  TagResolvedSourceType,
  TagRuleMatcher,
  TagRuleRelation,
  TagRuleType,
} from "./catalog-repository.js";

function makeStableId(prefix: string, value: string): string {
  const digest = crypto.createHash("sha1").update(value).digest("hex");
  return `${prefix}_${digest}`;
}

export interface ReconcileScope {
  kind: "all" | "prefix" | "exact";
  value?: string;
}

interface PreparedStatements {
  upsertFile: ReturnType<DatabaseSync["prepare"]>;
  upsertDocument: ReturnType<DatabaseSync["prepare"]>;
  insertChunk: ReturnType<DatabaseSync["prepare"]>;
  insertTag: ReturnType<DatabaseSync["prepare"]>;
  updateTagDefinition: ReturnType<DatabaseSync["prepare"]>;
  selectTagById: ReturnType<DatabaseSync["prepare"]>;
  selectTagByPath: ReturnType<DatabaseSync["prepare"]>;
  selectTagChildrenByParentId: ReturnType<DatabaseSync["prepare"]>;
  deleteManualDocumentBindingsByDocumentId: ReturnType<DatabaseSync["prepare"]>;
  insertManualDocumentBinding: ReturnType<DatabaseSync["prepare"]>;
  deleteFolderBindingsByFolderPath: ReturnType<DatabaseSync["prepare"]>;
  insertFolderBinding: ReturnType<DatabaseSync["prepare"]>;
  deleteTagRulesByTagId: ReturnType<DatabaseSync["prepare"]>;
  insertTagRule: ReturnType<DatabaseSync["prepare"]>;
  deleteDocumentTagByPair: ReturnType<DatabaseSync["prepare"]>;
  deleteDerivedDocumentTagByPair: ReturnType<DatabaseSync["prepare"]>;
  deleteDocumentTagByDocumentAndSource: ReturnType<DatabaseSync["prepare"]>;
  deleteDerivedDocumentTagByDocumentAndSource: ReturnType<DatabaseSync["prepare"]>;
  insertDocumentTag: ReturnType<DatabaseSync["prepare"]>;
  insertDerivedTag: ReturnType<DatabaseSync["prepare"]>;
  upsertDocumentTag: ReturnType<DatabaseSync["prepare"]>;
  upsertDerivedTag: ReturnType<DatabaseSync["prepare"]>;
  selectFileByPath: ReturnType<DatabaseSync["prepare"]>;
  selectDocumentByFileId: ReturnType<DatabaseSync["prepare"]>;
  selectDocumentTagIds: ReturnType<DatabaseSync["prepare"]>;
  selectDerivedTagIds: ReturnType<DatabaseSync["prepare"]>;
  deleteDocumentTags: ReturnType<DatabaseSync["prepare"]>;
  deleteDerivedDocumentTags: ReturnType<DatabaseSync["prepare"]>;
  deleteChunksByDocumentId: ReturnType<DatabaseSync["prepare"]>;
  deleteDocumentById: ReturnType<DatabaseSync["prepare"]>;
  markFileDeleted: ReturnType<DatabaseSync["prepare"]>;
  listActiveFilesAll: ReturnType<DatabaseSync["prepare"]>;
  listActiveFilesExact: ReturnType<DatabaseSync["prepare"]>;
  listActiveFilesPrefix: ReturnType<DatabaseSync["prepare"]>;
  countActiveIndexedDocuments: ReturnType<DatabaseSync["prepare"]>;
}

export interface SkippedDocumentEntry {
  file: FileScanResult;
  adapter: string;
  reasonCode: string;
  message: string;
}

export interface IndexedDocumentWritePayload {
  title: string;
  summary: string;
  text: string;
}

export interface IndexedDocumentBatchEntry {
  file: FileScanResult;
  document: IndexedDocumentWritePayload;
  tags: TagAssignment[];
  derivedTags: TagAssignment[];
}

export interface RecomputedResolvedTagEntry {
  documentId: string;
  tagPath: string;
  sourceType: TagResolvedSourceType;
  confidence: number;
  sourceRef?: string | null;
  evidence?: string | null;
}

export interface SaveTagDefinitionInput {
  id?: string;
  path: string;
  name: string;
  rootType: string;
  parentId?: string | null;
  canonicalName?: string;
  description?: string | null;
  status: "active" | "disabled";
  createdBy: string;
}

export interface SaveTagRuleInput {
  relation: TagRuleRelation;
  ruleType: TagRuleType;
  matcher: TagRuleMatcher;
  enabled: boolean;
  priority: number;
}

/**
 * 最小写入仓库。
 * 第二阶段补上 prepared statement 复用与批量连接内执行，减少大批量索引时的重复 prepare 与全表清理成本。
 */
export class CatalogWriteRepository {
  private readonly tagIdCache = new Map<string, string>();
  private activeDb: DatabaseSync | null = null;
  private activeStatements: PreparedStatements | null = null;
  private activeBootstrapSession = false;

  constructor(private readonly dbPath: string) {}

  beginSession(): void {
    if (this.activeDb) {
      return;
    }
    this.activeDb = openDatabase(this.dbPath);
    this.activeStatements = this.prepareStatements(this.activeDb);
    this.activeBootstrapSession = this.detectBootstrapSession(this.activeDb);
  }

  endSession(): void {
    if (!this.activeDb) {
      return;
    }
    this.activeDb.close();
    this.activeDb = null;
    this.activeStatements = null;
    this.activeBootstrapSession = false;
  }

  private withConnection<T>(handler: (db: DatabaseSync, statements: PreparedStatements) => T): T {
    if (this.activeDb && this.activeStatements) {
      return handler(this.activeDb, this.activeStatements);
    }

    const db = openDatabase(this.dbPath);
    const statements = this.prepareStatements(db);
    try {
      return handler(db, statements);
    } finally {
      db.close();
    }
  }

  private normalizeRelativePath(relativePath: string): string {
    return relativePath.split(path.sep).join("/");
  }

  getSchemaMeta(key: string): string | null {
    return this.withConnection(db => {
      const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(key) as { value?: string } | undefined;
      return typeof row?.value === "string" ? row.value : null;
    });
  }

  setSchemaMeta(key: string, value: string, updatedAt = new Date().toISOString()): void {
    this.withConnection(db => {
      const updated = db.prepare(`
        UPDATE schema_meta
        SET value = ?, updated_at = ?
        WHERE key = ?
      `).run(value, updatedAt, key);
      if ((updated.changes || 0) > 0) {
        return;
      }
      db.prepare(`
        INSERT INTO schema_meta(key, value, updated_at)
        VALUES(?, ?, ?)
      `).run(key, value, updatedAt);
    });
  }

  countActiveIndexedDocuments(): number {
    return this.withConnection(db => {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
      `).get() as { count?: number } | undefined;
      return Number(row?.count ?? 0);
    });
  }

  private detectBootstrapSession(db: DatabaseSync): boolean {
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM documents) AS document_count,
        (SELECT COUNT(*) FROM document_tags) AS document_tag_count,
        (SELECT COUNT(*) FROM derived_document_tags) AS derived_tag_count
    `).get() as {
      document_count?: number;
      document_tag_count?: number;
      derived_tag_count?: number;
    } | undefined;

    return Number(row?.document_count ?? 0) === 0
      && Number(row?.document_tag_count ?? 0) === 0
      && Number(row?.derived_tag_count ?? 0) === 0;
  }

  private prepareStatements(db: DatabaseSync): PreparedStatements {
    return {
      upsertFile: db.prepare(`
        INSERT INTO files(id, path, dir_path, name, extension, size, mtime, ctime, content_hash, status, last_seen_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        ON CONFLICT(path) DO UPDATE SET
          dir_path = excluded.dir_path,
          name = excluded.name,
          extension = excluded.extension,
          size = excluded.size,
          mtime = excluded.mtime,
          ctime = excluded.ctime,
          content_hash = excluded.content_hash,
          status = 'active',
          last_seen_at = excluded.last_seen_at
      `),
      upsertDocument: db.prepare(`
        INSERT INTO documents(id, file_id, title, summary, language, parse_status, parse_error, index_status, chunk_count, last_indexed_at)
        VALUES(?, ?, ?, ?, 'zh', ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
          id = excluded.id,
          title = excluded.title,
          summary = excluded.summary,
          parse_status = excluded.parse_status,
          parse_error = excluded.parse_error,
          index_status = excluded.index_status,
          chunk_count = excluded.chunk_count,
          last_indexed_at = excluded.last_indexed_at
      `),
      insertChunk: db.prepare(`
        INSERT INTO chunks(id, document_id, chunk_index, content, content_hash, page_no, sheet_name, heading_path, token_count, vector_point_id)
        VALUES(?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)
      `),
      insertTag: db.prepare(`
        INSERT OR IGNORE INTO tags(id, root_type, path, name, parent_id, canonical_name, description, status, created_by, created_at, updated_at, disabled_at)
        VALUES(?, ?, ?, ?, ?, ?, '', 'active', ?, ?, ?, NULL)
      `),
      updateTagDefinition: db.prepare(`
        UPDATE tags
        SET root_type = ?,
            path = ?,
            name = ?,
            parent_id = ?,
            canonical_name = ?,
            description = ?,
            status = ?,
            updated_at = ?,
            disabled_at = ?
        WHERE id = ?
      `),
      selectTagById: db.prepare(`
        SELECT id, root_type, path, name, parent_id, canonical_name, description, status, created_by, created_at, updated_at, disabled_at
        FROM tags
        WHERE id = ?
      `),
      selectTagByPath: db.prepare(`
        SELECT id, root_type, path, name, parent_id, canonical_name, description, status, created_by, created_at, updated_at, disabled_at
        FROM tags
        WHERE path = ?
      `),
      selectTagChildrenByParentId: db.prepare(`
        SELECT id
        FROM tags
        WHERE parent_id = ?
      `),
      deleteManualDocumentBindingsByDocumentId: db.prepare(`DELETE FROM manual_document_tag_bindings WHERE document_id = ?`),
      insertManualDocumentBinding: db.prepare(`
        INSERT INTO manual_document_tag_bindings(id, document_id, tag_id, source, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?)
      `),
      deleteFolderBindingsByFolderPath: db.prepare(`DELETE FROM folder_tag_bindings WHERE folder_path = ?`),
      insertFolderBinding: db.prepare(`
        INSERT INTO folder_tag_bindings(id, folder_path, tag_id, apply_mode, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?)
      `),
      deleteTagRulesByTagId: db.prepare(`DELETE FROM tag_rules WHERE tag_id = ?`),
      insertTagRule: db.prepare(`
        INSERT INTO tag_rules(id, tag_id, enabled, rule_type, scope_json, matcher_json, min_score, priority, source, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      deleteDocumentTagByPair: db.prepare(`DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?`),
      deleteDerivedDocumentTagByPair: db.prepare(`DELETE FROM derived_document_tags WHERE document_id = ? AND tag_id = ?`),
      deleteDocumentTagByDocumentAndSource: db.prepare(`DELETE FROM document_tags WHERE document_id = ? AND source = ?`),
      deleteDerivedDocumentTagByDocumentAndSource: db.prepare(`DELETE FROM derived_document_tags WHERE document_id = ? AND source = ?`),
      insertDocumentTag: db.prepare(`
        INSERT INTO document_tags(id, document_id, tag_id, confidence, source, source_ref, evidence, manual_override, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertDerivedTag: db.prepare(`
        INSERT INTO derived_document_tags(id, document_id, tag_id, source, source_ref, rule_name, evidence, computed_at, updated_at, expires_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `),
      upsertDocumentTag: db.prepare(`
        INSERT INTO document_tags(id, document_id, tag_id, confidence, source, source_ref, evidence, manual_override, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, tag_id) DO UPDATE SET
          confidence = excluded.confidence,
          source = excluded.source,
          source_ref = excluded.source_ref,
          evidence = excluded.evidence,
          manual_override = excluded.manual_override,
          updated_at = excluded.updated_at
      `),
      upsertDerivedTag: db.prepare(`
        INSERT INTO derived_document_tags(id, document_id, tag_id, source, source_ref, rule_name, evidence, computed_at, updated_at, expires_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(document_id, tag_id) DO UPDATE SET
          source = excluded.source,
          source_ref = excluded.source_ref,
          rule_name = excluded.rule_name,
          evidence = excluded.evidence,
          computed_at = excluded.computed_at,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
      `),
      selectFileByPath: db.prepare(`SELECT id FROM files WHERE path = ?`),
      selectDocumentByFileId: db.prepare(`SELECT id FROM documents WHERE file_id = ?`),
      selectDocumentTagIds: db.prepare(`SELECT tag_id FROM document_tags WHERE document_id = ?`),
      selectDerivedTagIds: db.prepare(`SELECT tag_id FROM derived_document_tags WHERE document_id = ?`),
      deleteDocumentTags: db.prepare(`DELETE FROM document_tags WHERE document_id = ?`),
      deleteDerivedDocumentTags: db.prepare(`DELETE FROM derived_document_tags WHERE document_id = ?`),
      deleteChunksByDocumentId: db.prepare(`DELETE FROM chunks WHERE document_id = ?`),
      deleteDocumentById: db.prepare(`DELETE FROM documents WHERE id = ?`),
      markFileDeleted: db.prepare(`
        UPDATE files
        SET status = 'deleted',
            last_seen_at = ?
        WHERE id = ?
      `),
      listActiveFilesAll: db.prepare(`SELECT path, last_seen_at FROM files WHERE status = 'active'`),
      listActiveFilesExact: db.prepare(`SELECT path, last_seen_at FROM files WHERE status = 'active' AND path = ?`),
      listActiveFilesPrefix: db.prepare(`SELECT path, last_seen_at FROM files WHERE status = 'active' AND (path = ? OR path LIKE ?)`),
      countActiveIndexedDocuments: db.prepare(`
        SELECT COUNT(*) AS count
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
      `),
    };
  }

  private ensureTagInConnection(
    db: DatabaseSync,
    statements: PreparedStatements,
    tagCache: Map<string, string>,
    tagPath: string,
    createdBy: string,
  ): string {
    const cached = tagCache.get(tagPath);
    if (cached) {
      return cached;
    }

    const segments = tagPath.split("/").filter(Boolean);
    const rootType = segments[0] ?? "未分类";
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
    const parentId = parentPath ? this.ensureTagInConnection(db, statements, tagCache, parentPath, createdBy) : null;
    const name = segments[segments.length - 1] ?? rootType;
    const tagId = makeStableId("tag", tagPath);

    statements.insertTag.run(
      tagId,
      rootType,
      tagPath,
      name,
      parentId,
      name,
      createdBy,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    tagCache.set(tagPath, tagId);
    this.tagIdCache.set(tagPath, tagId);
    return tagId;
  }

  private cleanupOrphanTagsInConnection(db: DatabaseSync): void {
    const selectOrphans = db.prepare(`
      SELECT t.id
      FROM tags t
      WHERE NOT EXISTS (
        SELECT 1 FROM tags child WHERE child.parent_id = t.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM document_tags dt WHERE dt.tag_id = t.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM derived_document_tags ddt WHERE ddt.tag_id = t.id
      )
    `);
    const deleteTag = db.prepare(`DELETE FROM tags WHERE id = ?`);

    while (true) {
      const orphanRows = selectOrphans.all() as Array<{ id: string }>;

      if (orphanRows.length === 0) {
        return;
      }

      for (const row of orphanRows) {
        deleteTag.run(row.id);
      }
    }
  }

  private deleteDocumentInConnection(
    db: DatabaseSync,
    statements: PreparedStatements,
    relativePath: string,
    deletedAt: string,
  ): boolean {
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const fileRow = statements.selectFileByPath.get(normalizedPath) as { id?: string } | undefined;
    if (!fileRow?.id) {
      return false;
    }

    const documentRow = statements.selectDocumentByFileId.get(fileRow.id) as { id?: string } | undefined;
    if (documentRow?.id) {
      statements.deleteChunksByDocumentId.run(documentRow.id);
      statements.deleteDocumentTags.run(documentRow.id);
      statements.deleteDerivedDocumentTags.run(documentRow.id);
      statements.deleteDocumentById.run(documentRow.id);
    }

    statements.markFileDeleted.run(deletedAt, fileRow.id);
    return true;
  }

  private upsertDocumentInConnection(
    db: DatabaseSync,
    statements: PreparedStatements,
    tagCache: Map<string, string>,
    file: FileScanResult,
    document: IndexedDocumentWritePayload,
    tags: TagAssignment[] = [],
    derivedTags: TagAssignment[] = [],
    observedAt = new Date().toISOString(),
  ): { fileId: string; documentId: string } {
    const fileId = makeStableId("file", file.relativePath);
    const documentId = makeStableId("doc", file.relativePath);

    statements.upsertFile.run(
      fileId,
      file.relativePath,
      file.relativePath.includes("/") ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/")) : ".",
      file.name,
      file.extension,
      file.size,
      file.mtime,
      file.ctime,
      null,
      observedAt,
    );

    statements.upsertDocument.run(
      documentId,
      fileId,
      document.title,
      document.summary,
      "parsed",
      null,
      "indexed",
      document.text.trim() ? 1 : 0,
      observedAt,
    );

    statements.deleteChunksByDocumentId.run(documentId);
    if (document.text.trim()) {
      statements.insertChunk.run(
        makeStableId("chunk", `${documentId}:0`),
        documentId,
        0,
        document.text,
      );
    }

    if (this.activeBootstrapSession) {
      for (const tag of tags) {
        const tagId = this.ensureTagInConnection(db, statements, tagCache, tag.tagPath, tag.source.split("+")[0] || "rule");
        statements.insertDocumentTag.run(
          makeStableId("doc_tag", `${documentId}:${tagId}`),
          documentId,
          tagId,
          tag.confidence,
          tag.source,
          null,
          tag.evidence,
          tag.manualOverride ? 1 : 0,
          observedAt,
        );
      }

      for (const tag of derivedTags) {
        const tagId = this.ensureTagInConnection(db, statements, tagCache, tag.tagPath, tag.source);
        statements.insertDerivedTag.run(
          makeStableId("derived_tag", `${documentId}:${tagId}`),
          documentId,
          tagId,
          "system_derived",
          null,
          tag.source,
          tag.evidence,
          observedAt,
          observedAt,
        );
      }

      return { fileId, documentId };
    }

    const existingDirectTagRows = statements.selectDocumentTagIds.all(documentId) as Array<{ tag_id: string }>;
    const existingDirectTagIds = new Set(existingDirectTagRows.map(row => String(row.tag_id)));
    const nextDirectTagIds = new Set<string>();

    for (const tag of tags) {
      const tagId = this.ensureTagInConnection(db, statements, tagCache, tag.tagPath, tag.source.split("+")[0] || "rule");
      nextDirectTagIds.add(tagId);
      statements.upsertDocumentTag.run(
        makeStableId("doc_tag", `${documentId}:${tagId}`),
        documentId,
        tagId,
        tag.confidence,
        tag.source,
        null,
        tag.evidence,
        tag.manualOverride ? 1 : 0,
        observedAt,
      );
    }

    for (const tagId of existingDirectTagIds) {
      if (!nextDirectTagIds.has(tagId)) {
        statements.deleteDocumentTagByPair.run(documentId, tagId);
      }
    }

    const existingDerivedTagRows = statements.selectDerivedTagIds.all(documentId) as Array<{ tag_id: string }>;
    const existingDerivedTagIds = new Set(existingDerivedTagRows.map(row => String(row.tag_id)));
    const nextDerivedTagIds = new Set<string>();

    for (const tag of derivedTags) {
      const tagId = this.ensureTagInConnection(db, statements, tagCache, tag.tagPath, tag.source);
      nextDerivedTagIds.add(tagId);
      statements.upsertDerivedTag.run(
        makeStableId("derived_tag", `${documentId}:${tagId}`),
        documentId,
        tagId,
        "system_derived",
        null,
        tag.source,
        tag.evidence,
        observedAt,
        observedAt,
      );
    }

    for (const tagId of existingDerivedTagIds) {
      if (!nextDerivedTagIds.has(tagId)) {
        statements.deleteDerivedDocumentTagByPair.run(documentId, tagId);
      }
    }

    return { fileId, documentId };
  }

  private upsertParseFailureInConnection(
    db: DatabaseSync,
    statements: PreparedStatements,
    file: FileScanResult,
    error: Error,
    observedAt = new Date().toISOString(),
  ): { fileId: string; documentId: string } {
    const fileId = makeStableId("file", file.relativePath);
    const documentId = makeStableId("doc", file.relativePath);

    statements.upsertFile.run(
      fileId,
      file.relativePath,
      file.relativePath.includes("/") ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/")) : ".",
      file.name,
      file.extension,
      file.size,
      file.mtime,
      file.ctime,
      null,
      observedAt,
    );

    statements.upsertDocument.run(
      documentId,
      fileId,
      file.name,
      "",
      "failed",
      error.message,
      "failed",
      0,
      observedAt,
    );

    statements.deleteChunksByDocumentId.run(documentId);
    statements.deleteDocumentTags.run(documentId);
    statements.deleteDerivedDocumentTags.run(documentId);
    return { fileId, documentId };
  }

  private markSkippedDocumentInConnection(
    db: DatabaseSync,
    statements: PreparedStatements,
    entry: SkippedDocumentEntry,
    observedAt = new Date().toISOString(),
  ): { fileId: string; documentId: string } {
    const { file, adapter, reasonCode, message } = entry;
    const fileId = makeStableId("file", file.relativePath);
    const documentId = makeStableId("doc", file.relativePath);

    statements.upsertFile.run(
      fileId,
      file.relativePath,
      file.relativePath.includes("/") ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/")) : ".",
      file.name,
      file.extension,
      file.size,
      file.mtime,
      file.ctime,
      null,
      observedAt,
    );

    statements.upsertDocument.run(
      documentId,
      fileId,
      file.name,
      "",
      "skipped",
      `${reasonCode}: ${adapter}${message ? ` - ${message}` : ""}`,
      "skipped",
      0,
      observedAt,
    );

    statements.deleteChunksByDocumentId.run(documentId);
    statements.deleteDocumentTags.run(documentId);
    statements.deleteDerivedDocumentTags.run(documentId);
    statements.deleteChunksByDocumentId.run(documentId);
    return { fileId, documentId };
  }

  upsertTextDocument(
    file: FileScanResult,
    parsed: ParsedDocument,
    tags: TagAssignment[] = [],
    derivedTags: TagAssignment[] = [],
    observedAt?: string,
  ): { fileId: string; documentId: string } {
    return this.withConnection((db, statements) => {
      const tagCache = new Map(this.tagIdCache);
      try {
        db.exec("BEGIN");
        const result = this.upsertDocumentInConnection(db, statements, tagCache, file, parsed, tags, derivedTags, observedAt);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  upsertParseFailure(file: FileScanResult, error: Error, observedAt?: string): { fileId: string; documentId: string } {
    return this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN");
        const result = this.upsertParseFailureInConnection(db, statements, file, error, observedAt);
        this.cleanupOrphanTagsInConnection(db);
        db.exec("COMMIT");
        return result;
      } catch (failure) {
        db.exec("ROLLBACK");
        throw failure;
      }
    });
  }

  batchUpsertDocuments(
    entries: IndexedDocumentBatchEntry[],
    observedAt?: string,
  ): Array<{ fileId: string; documentId: string }> {
    if (entries.length === 0) {
      return [];
    }

    return this.withConnection((db, statements) => {
      const tagCache = new Map(this.tagIdCache);
      try {
        db.exec("BEGIN IMMEDIATE");
        const results = entries.map(entry => this.upsertDocumentInConnection(
          db,
          statements,
          tagCache,
          entry.file,
          entry.document,
          entry.tags,
          entry.derivedTags,
          observedAt,
        ));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  batchUpsertParseFailures(
    entries: Array<{ file: FileScanResult; error: Error }>,
    observedAt?: string,
  ): Array<{ fileId: string; documentId: string }> {
    if (entries.length === 0) {
      return [];
    }

    return this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        const results = entries.map(entry => this.upsertParseFailureInConnection(db, statements, entry.file, entry.error, observedAt));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  batchMarkSkippedDocuments(
    entries: SkippedDocumentEntry[],
    observedAt?: string,
  ): Array<{ fileId: string; documentId: string }> {
    if (entries.length === 0) {
      return [];
    }

    return this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        const results = entries.map(entry => this.markSkippedDocumentInConnection(db, statements, entry, observedAt));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  cleanupOrphanTags(): void {
    this.withConnection(db => {
      try {
        db.exec("BEGIN IMMEDIATE");
        this.cleanupOrphanTagsInConnection(db);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  reconcileScope(scope: ReconcileScope, observedAt: string): { deletedCount: number; deletedPaths: string[] } {
    return this.withConnection((db, statements) => {
      const now = new Date().toISOString();

      try {
        db.exec("BEGIN IMMEDIATE");

        let rows: Array<{ path: string; last_seen_at: string | null }> = [];
        if (scope.kind === "exact" && scope.value) {
          rows = statements.listActiveFilesExact.all(this.normalizeRelativePath(scope.value)) as Array<{ path: string; last_seen_at: string | null }>;
        } else if (scope.kind === "prefix" && scope.value) {
          const normalizedPrefix = this.normalizeRelativePath(scope.value).replace(/\/+$/, "");
          rows = statements.listActiveFilesPrefix.all(normalizedPrefix, `${normalizedPrefix}/%`) as Array<{ path: string; last_seen_at: string | null }>;
        } else {
          rows = statements.listActiveFilesAll.all() as Array<{ path: string; last_seen_at: string | null }>;
        }

        const deletedPaths: string[] = [];
        for (const row of rows) {
          if (row.last_seen_at === observedAt) {
            continue;
          }
          if (this.deleteDocumentInConnection(db, statements, row.path, now)) {
            deletedPaths.push(row.path);
          }
        }

        this.cleanupOrphanTagsInConnection(db);
        db.exec("COMMIT");
        return {
          deletedCount: deletedPaths.length,
          deletedPaths,
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  deleteActiveFilesByExtensions(extensions: string[], deletedAt = new Date().toISOString()): { deletedCount: number; deletedPaths: string[] } {
    const normalizedExtensions = [...new Set(
      extensions
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)
        .map(item => item.startsWith(".") ? item : `.${item}`),
    )];
    if (normalizedExtensions.length === 0) {
      return {
        deletedCount: 0,
        deletedPaths: [],
      };
    }

    return this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        const placeholders = normalizedExtensions.map(() => "?").join(", ");
        const rows = db.prepare(`
          SELECT path
          FROM files
          WHERE status = 'active'
            AND extension IN (${placeholders})
          ORDER BY path
        `).all(...normalizedExtensions) as Array<{ path: string }>;

        const deletedPaths: string[] = [];
        for (const row of rows) {
          if (this.deleteDocumentInConnection(db, statements, row.path, deletedAt)) {
            deletedPaths.push(String(row.path));
          }
        }

        this.cleanupOrphanTagsInConnection(db);
        db.exec("COMMIT");
        return {
          deletedCount: deletedPaths.length,
          deletedPaths,
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  recomputeDocumentTags(
    entries: Array<{
      documentId: string;
      tags: TagAssignment[];
      derivedTags: TagAssignment[];
    }>,
    observedAt = new Date().toISOString(),
  ): { updatedCount: number } {
    if (entries.length === 0) {
      return { updatedCount: 0 };
    }

    return this.withConnection((db, statements) => {
      const tagCache = new Map(this.tagIdCache);
      try {
        db.exec("BEGIN IMMEDIATE");
        for (const entry of entries) {
          statements.deleteDocumentTags.run(entry.documentId);
          statements.deleteDerivedDocumentTags.run(entry.documentId);

          for (const tag of entry.tags) {
            const tagId = this.ensureTagInConnection(db, statements, tagCache, tag.tagPath, tag.source.split("+")[0] || "rule");
            statements.upsertDocumentTag.run(
              makeStableId("doc_tag", `${entry.documentId}:${tagId}`),
              entry.documentId,
              tagId,
              tag.confidence,
              tag.source,
              null,
              tag.evidence,
              tag.manualOverride ? 1 : 0,
              observedAt,
            );
          }

          for (const tag of entry.derivedTags) {
            const tagId = this.ensureTagInConnection(db, statements, tagCache, tag.tagPath, tag.source);
            statements.upsertDerivedTag.run(
              makeStableId("derived_tag", `${entry.documentId}:${tagId}`),
              entry.documentId,
              tagId,
              "system_derived",
              null,
              tag.source,
              tag.evidence,
              observedAt,
              observedAt,
            );
          }
        }

        this.cleanupOrphanTagsInConnection(db);
        db.exec("COMMIT");
        return { updatedCount: entries.length };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  saveTagDefinition(input: SaveTagDefinitionInput, observedAt = new Date().toISOString()): { id: string } {
    return this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        const tagId = input.id?.trim() || makeStableId("tag", input.path);
        const disabledAt = input.status === "disabled" ? observedAt : null;
        const existing = statements.selectTagById.get(tagId) as { id?: string; created_at?: string } | undefined;
        if (existing?.id) {
          statements.updateTagDefinition.run(
            input.rootType,
            input.path,
            input.name,
            input.parentId ?? null,
            input.canonicalName ?? input.name,
            input.description ?? null,
            input.status,
            observedAt,
            disabledAt,
            tagId,
          );
        } else {
          db.prepare(`
            INSERT INTO tags(id, root_type, path, name, parent_id, canonical_name, description, status, created_by, created_at, updated_at, disabled_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            tagId,
            input.rootType,
            input.path,
            input.name,
            input.parentId ?? null,
            input.canonicalName ?? input.name,
            input.description ?? null,
            input.status,
            input.createdBy,
            observedAt,
            observedAt,
            disabledAt,
          );
        }
        db.exec("COMMIT");
        return { id: tagId };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  replaceTagRules(tagId: string, rules: SaveTagRuleInput[], observedAt = new Date().toISOString()): void {
    const normalizedTagId = tagId.trim();
    if (!normalizedTagId) {
      return;
    }
    this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        statements.deleteTagRulesByTagId.run(normalizedTagId);
        rules
          .filter(rule => Number.isFinite(rule.priority))
          .sort((left, right) => left.priority - right.priority)
          .forEach((rule, index) => {
            const priority = Number.isFinite(rule.priority) ? rule.priority : index;
            const relation = rule.relation === "or" || rule.relation === "not" ? rule.relation : "and";
            const scopeJson = JSON.stringify({ relation });
            const matcherJson = JSON.stringify(rule.matcher ?? {});
            const ruleId = makeStableId("tag_rule", `${normalizedTagId}:${priority}:${rule.ruleType}:${matcherJson}:${relation}`);
            statements.insertTagRule.run(
              ruleId,
              normalizedTagId,
              rule.enabled ? 1 : 0,
              rule.ruleType,
              scopeJson,
              matcherJson,
              null,
              priority,
              "smart_rule",
              observedAt,
              observedAt,
            );
          });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  replaceManualDocumentTagBindings(documentId: string, tagIds: string[], observedAt = new Date().toISOString()): void {
    const normalizedTagIds = [...new Set(tagIds.map(item => item.trim()).filter(Boolean))];
    this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        statements.deleteManualDocumentBindingsByDocumentId.run(documentId);
        normalizedTagIds.forEach(tagId => {
          statements.insertManualDocumentBinding.run(
            makeStableId("manual_binding", `${documentId}:${tagId}`),
            documentId,
            tagId,
            "manual_document",
            observedAt,
            observedAt,
          );
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  replaceFolderTagBindings(folderPath: string, tagIds: string[], observedAt = new Date().toISOString()): void {
    const normalizedFolderPath = this.normalizeRelativePath(folderPath).replace(/^\.\/+/, "").replace(/\/+$/g, "") || ".";
    const normalizedTagIds = [...new Set(tagIds.map(item => item.trim()).filter(Boolean))];
    this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        statements.deleteFolderBindingsByFolderPath.run(normalizedFolderPath);
        normalizedTagIds.forEach(tagId => {
          statements.insertFolderBinding.run(
            makeStableId("folder_binding", `${normalizedFolderPath}:${tagId}:descendant_files`),
            normalizedFolderPath,
            tagId,
            "descendant_files",
            observedAt,
            observedAt,
          );
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  deleteTagDefinitions(tagIds: string[]): void {
    const normalizedTagIds = [...new Set(tagIds.map(item => item.trim()).filter(Boolean))];
    if (normalizedTagIds.length === 0) {
      return;
    }
    this.withConnection((db) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        const deleteManualBindings = db.prepare(`DELETE FROM manual_document_tag_bindings WHERE tag_id = ?`);
        const deleteFolderBindings = db.prepare(`DELETE FROM folder_tag_bindings WHERE tag_id = ?`);
        const deleteRules = db.prepare(`DELETE FROM tag_rules WHERE tag_id = ?`);
        const deleteDocumentTags = db.prepare(`DELETE FROM document_tags WHERE tag_id = ?`);
        const deleteDerivedTags = db.prepare(`DELETE FROM derived_document_tags WHERE tag_id = ?`);
        const deleteTag = db.prepare(`DELETE FROM tags WHERE id = ?`);
        normalizedTagIds.forEach((tagId) => {
          deleteManualBindings.run(tagId);
          deleteFolderBindings.run(tagId);
          deleteRules.run(tagId);
          deleteDocumentTags.run(tagId);
          deleteDerivedTags.run(tagId);
          deleteTag.run(tagId);
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  deleteResolvedTagsBySource(documentId: string, sourceTypes: TagResolvedSourceType[]): void {
    const normalizedTypes = [...new Set(sourceTypes)];
    if (normalizedTypes.length === 0) {
      return;
    }
    this.withConnection((db, statements) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        normalizedTypes.forEach(sourceType => {
          if (sourceType === "system_derived") {
            statements.deleteDerivedDocumentTagByDocumentAndSource.run(documentId, sourceType);
          } else {
            statements.deleteDocumentTagByDocumentAndSource.run(documentId, sourceType);
          }
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  recomputeResolvedTags(
    entries: RecomputedResolvedTagEntry[],
    observedAt = new Date().toISOString(),
    documentIds: string[] = [],
  ): { updatedCount: number } {
    const normalizedDocumentIds = [...new Set([
      ...documentIds,
      ...entries.map(item => item.documentId),
    ].map(item => item.trim()).filter(Boolean))];
    if (normalizedDocumentIds.length === 0) {
      return { updatedCount: 0 };
    }

    return this.withConnection((db, statements) => {
      const tagCache = new Map(this.tagIdCache);
      try {
        db.exec("BEGIN IMMEDIATE");
        const groupedByDocument = new Map<string, RecomputedResolvedTagEntry[]>();
        entries.forEach(entry => {
          const current = groupedByDocument.get(entry.documentId) ?? [];
          current.push(entry);
          groupedByDocument.set(entry.documentId, current);
        });

        for (const documentId of normalizedDocumentIds) {
          const documentEntries = groupedByDocument.get(documentId) ?? [];
          statements.deleteDocumentTags.run(documentId);
          statements.deleteDerivedDocumentTags.run(documentId);

          for (const entry of documentEntries) {
            const tagId = this.ensureTagInConnection(
              db,
              statements,
              tagCache,
              entry.tagPath,
              entry.sourceType,
            );
            if (entry.sourceType === "system_derived") {
              statements.upsertDerivedTag.run(
                makeStableId("derived_tag", `${documentId}:${tagId}`),
                documentId,
                tagId,
                entry.sourceType,
                entry.sourceRef ?? null,
                entry.sourceRef ?? "system_derived",
                entry.evidence ?? null,
                observedAt,
                observedAt,
              );
            } else {
              statements.upsertDocumentTag.run(
                makeStableId("doc_tag", `${documentId}:${tagId}`),
                documentId,
                tagId,
                entry.confidence,
                entry.sourceType,
                entry.sourceRef ?? null,
                entry.evidence ?? null,
                entry.sourceType === "manual_document" ? 1 : 0,
                observedAt,
              );
            }
          }
        }

        db.exec("COMMIT");
        return { updatedCount: normalizedDocumentIds.length };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }
}
