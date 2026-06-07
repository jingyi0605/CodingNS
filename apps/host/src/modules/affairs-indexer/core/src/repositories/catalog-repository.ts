import {
  openDatabase,
  type OpenDatabaseOptions,
} from "../sqlite/open-database.js";

export interface DocumentContextResult {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  modifiedAt: string;
  inodeKey: string | null;
  contentHash: string | null;
  size: number;
  extension: string;
  tags: string[];
}

export interface BrowseTagNodeResult {
  path: string;
  name: string;
  rootType: string;
  parentPath: string | null;
  depth: number;
}

export interface SearchDocumentResult {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  modifiedAt: string;
}

export interface ExportDocumentRecord {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  tags: string[];
  derivedTags: string[];
  mtime: string;
}

export interface ExportTagRecord {
  path: string;
  name: string;
  rootType: string;
  parentPath: string | null;
  depth: number;
}

export interface ExportDocumentRow {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  mtime: string;
}

export interface ExportDocumentTagRow {
  documentId: string;
  tagPath: string;
  derived: boolean;
}

export interface TagRecomputeDocumentRow {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  contentText: string;
  mtime: string;
  ctime: string;
  extension: string;
}

export type TagResolvedSourceType =
  | "manual_document"
  | "folder_binding"
  | "smart_rule"
  | "system_derived";

export type TagRuleRelation = "and" | "or" | "not";

export type TagRuleType =
  | "file_name_contains"
  | "file_content_contains"
  | "file_extension_in"
  | "modified_time_between"
  | "document_path_in_folder";

export interface TagRuleMatcherFileNameContains {
  keyword: string;
}

export interface TagRuleMatcherFileContentContains {
  keyword: string;
}

export interface TagRuleMatcherFileExtensionIn {
  extensions: string[];
}

export interface TagRuleMatcherModifiedTimeBetween {
  start?: string | null;
  end?: string | null;
}

export interface TagRuleMatcherDocumentPathInFolder {
  folderPath?: string | null;
}

export type TagRuleMatcher =
  | TagRuleMatcherFileNameContains
  | TagRuleMatcherFileContentContains
  | TagRuleMatcherFileExtensionIn
  | TagRuleMatcherModifiedTimeBetween
  | TagRuleMatcherDocumentPathInFolder;

export interface TagRuleRow {
  id: string;
  tagId: string;
  tagPath: string;
  enabled: boolean;
  relation: TagRuleRelation;
  ruleType: TagRuleType;
  matcher: TagRuleMatcher;
  minScore: number | null;
  priority: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualDocumentTagBindingRow {
  id: string;
  documentId: string;
  tagId: string;
  tagPath: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualTagBindingStats {
  identityBindingCount: number;
  legacyBindingCount: number;
  legacyFallbackBindingCount: number;
  legacyFallbackDocumentCount: number;
}

interface DocumentIdentityRow {
  documentId: string;
  path: string;
  inodeKey: string | null;
  contentHash: string | null;
  size: number;
  extension: string;
}

interface ManualFileTagBindingCandidateRow {
  id: string;
  inodeKey: string | null;
  contentHash: string | null;
  fileSize: number;
  extension: string;
  tagId: string;
  tagPath: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderTagBindingRow {
  id: string;
  folderPath: string;
  tagId: string;
  tagPath: string;
  applyMode: string;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveFolderTagBindingRow extends FolderTagBindingRow {
  documentPath: string;
  documentId: string;
}

export interface TagDefinitionRow {
  id: string;
  rootType: string;
  path: string;
  name: string;
  parentId: string | null;
  canonicalName: string;
  description: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface ResolvedDocumentTagRow {
  documentId: string;
  path: string;
  tagId: string;
  sourceType: TagResolvedSourceType;
  sourceRef: string | null;
  evidence: string | null;
  confidence: number;
  updatedAt: string;
}

export interface RecomputeScope {
  kind: "full" | "document" | "folder" | "tag";
  documentId?: string;
  folderPath?: string;
  tagId?: string;
  mode?: "full" | "folder_bindings_only";
}

export interface ExportTagPostingRow {
  rootType: string;
  tagPath: string;
  documentId: string;
  path: string;
  title: string;
  derived: boolean;
}

function compareTagPostingRows(left: ExportTagPostingRow, right: ExportTagPostingRow): number {
  return left.rootType.localeCompare(right.rootType, "zh-Hans-CN")
    || left.tagPath.localeCompare(right.tagPath, "zh-Hans-CN")
    || left.path.localeCompare(right.path, "zh-Hans-CN")
    || left.documentId.localeCompare(right.documentId, "zh-Hans-CN")
    || Number(left.derived) - Number(right.derived);
}

function attachTags(
  documentRows: Array<Record<string, unknown>>,
  directTagRows: Array<{ document_id: string; tag_path: string }>,
  derivedTagRows: Array<{ document_id: string; tag_path: string }>,
): ExportDocumentRecord[] {
  const directTagsByDocument = new Map<string, string[]>();
  for (const row of directTagRows) {
    const current = directTagsByDocument.get(row.document_id) ?? [];
    current.push(row.tag_path);
    directTagsByDocument.set(row.document_id, current);
  }

  const derivedTagsByDocument = new Map<string, string[]>();
  for (const row of derivedTagRows) {
    const current = derivedTagsByDocument.get(row.document_id) ?? [];
    current.push(row.tag_path);
    derivedTagsByDocument.set(row.document_id, current);
  }

  return documentRows.map(row => {
    const documentId = String(row.document_id);
    return {
      documentId,
      path: String(row.path),
      title: String(row.title),
      summary: String(row.summary ?? ""),
      tags: directTagsByDocument.get(documentId) ?? [],
      derivedTags: derivedTagsByDocument.get(documentId) ?? [],
      mtime: String(row.mtime),
    };
  });
}

function mapDocumentRows(rows: Array<Record<string, unknown>>): ExportDocumentRow[] {
  return rows.map(row => ({
    documentId: String(row.document_id),
    path: String(row.path),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    mtime: String(row.mtime),
  }));
}

function fetchDocumentTagsForIds(
  db: ReturnType<typeof openDatabase>,
  documentIds: string[],
): {
  directTagRows: Array<{ document_id: string; tag_path: string }>;
  derivedTagRows: Array<{ document_id: string; tag_path: string }>;
} {
  if (documentIds.length === 0) {
    return {
      directTagRows: [],
      derivedTagRows: [],
    };
  }

  const placeholders = documentIds.map(() => "?").join(", ");
  const directTagRows = db.prepare(`
    SELECT dt.document_id, t.path AS tag_path
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.document_id IN (${placeholders})
    ORDER BY dt.document_id, t.path
  `).all(...documentIds) as Array<{ document_id: string; tag_path: string }>;

  const derivedTagRows = db.prepare(`
    SELECT ddt.document_id, t.path AS tag_path
    FROM derived_document_tags ddt
    JOIN tags t ON t.id = ddt.tag_id
    WHERE ddt.document_id IN (${placeholders})
    ORDER BY ddt.document_id, t.path
  `).all(...documentIds) as Array<{ document_id: string; tag_path: string }>;

  return {
    directTagRows,
    derivedTagRows,
  };
}

/**
 * 最小 SQLite 查询仓库。
 * 第二阶段继续承接只读查询，并补最小增量导出所需查询。
 */
export class CatalogRepository {
  constructor(
    private readonly dbPath: string,
    private readonly dbOptions: OpenDatabaseOptions = {},
  ) {}

  listTagDefinitions(includeDisabled = false): TagDefinitionRow[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const rows = db.prepare(`
        SELECT
          id,
          root_type,
          path,
          name,
          parent_id,
          canonical_name,
          description,
          status,
          created_by,
          created_at,
          updated_at,
          disabled_at
        FROM tags
        ${includeDisabled ? "" : "WHERE status <> 'disabled'"}
        ORDER BY path
      `).all() as Array<Record<string, unknown>>;

      return rows.map(row => ({
        id: String(row.id),
        rootType: String(row.root_type),
        path: String(row.path),
        name: String(row.name),
        parentId: row.parent_id ? String(row.parent_id) : null,
        canonicalName: String(row.canonical_name),
        description: typeof row.description === "string" ? row.description : null,
        status: String(row.status),
        createdBy: String(row.created_by),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at ?? row.created_at),
        disabledAt: typeof row.disabled_at === "string" ? row.disabled_at : null,
      }));
    } finally {
      db.close();
    }
  }

  getTagDefinitionById(tagId: string): TagDefinitionRow | null {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const row = db.prepare(`
        SELECT
          id,
          root_type,
          path,
          name,
          parent_id,
          canonical_name,
          description,
          status,
          created_by,
          created_at,
          updated_at,
          disabled_at
        FROM tags
        WHERE id = ?
      `).get(tagId) as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }
      return {
        id: String(row.id),
        rootType: String(row.root_type),
        path: String(row.path),
        name: String(row.name),
        parentId: row.parent_id ? String(row.parent_id) : null,
        canonicalName: String(row.canonical_name),
        description: typeof row.description === "string" ? row.description : null,
        status: String(row.status),
        createdBy: String(row.created_by),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at ?? row.created_at),
        disabledAt: typeof row.disabled_at === "string" ? row.disabled_at : null,
      };
    } finally {
      db.close();
    }
  }

  listTagRulesByTagIds(tagIds: string[]): TagRuleRow[] {
    const normalizedIds = [...new Set(tagIds.map(item => item.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedIds.map(() => "?").join(", ");
      const rows = db.prepare(`
        SELECT
          r.id,
          r.tag_id,
          t.path AS tag_path,
          r.enabled,
          r.rule_type,
          r.scope_json,
          r.matcher_json,
          r.min_score,
          r.priority,
          r.source,
          r.created_at,
          r.updated_at
        FROM tag_rules r
        JOIN tags t ON t.id = r.tag_id
        WHERE r.tag_id IN (${placeholders})
        ORDER BY t.path, r.priority, r.created_at
      `).all(...normalizedIds) as Array<Record<string, unknown>>;

      return rows.map(mapTagRuleRow);
    } finally {
      db.close();
    }
  }

  listAllEnabledTagRules(): TagRuleRow[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const rows = db.prepare(`
        SELECT
          r.id,
          r.tag_id,
          t.path AS tag_path,
          r.enabled,
          r.rule_type,
          r.scope_json,
          r.matcher_json,
          r.min_score,
          r.priority,
          r.source,
          r.created_at,
          r.updated_at
        FROM tag_rules r
        JOIN tags t ON t.id = r.tag_id
        WHERE r.enabled = 1
          AND t.status = 'active'
        ORDER BY t.path, r.priority, r.created_at
      `).all() as Array<Record<string, unknown>>;

      return rows.map(mapTagRuleRow);
    } finally {
      db.close();
    }
  }

  listManualDocumentTagBindingsByDocumentIds(documentIds: string[]): ManualDocumentTagBindingRow[] {
    const normalizedIds = [...new Set(documentIds.map(item => item.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedIds.map(() => "?").join(", ");
      const documentRows = db.prepare(`
        SELECT
          d.id AS document_id,
          f.path,
          f.inode_key,
          f.content_hash,
          f.size,
          f.extension
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE d.id IN (${placeholders})
          AND f.status = 'active'
          AND d.index_status = 'indexed'
      `).all(...normalizedIds) as Array<Record<string, unknown>>;

      const currentDocuments = documentRows.map((row) => ({
        documentId: String(row.document_id),
        path: String(row.path),
        inodeKey: typeof row.inode_key === "string" && row.inode_key.trim() ? String(row.inode_key) : null,
        contentHash: typeof row.content_hash === "string" && row.content_hash.trim() ? String(row.content_hash) : null,
        size: Number(row.size ?? 0),
        extension: String(row.extension ?? ""),
      })) satisfies DocumentIdentityRow[];

      const resolvedRows = this.resolveManualFileTagBindingsForDocuments(db, currentDocuments);
      const legacyRows = db.prepare(`
        SELECT
          b.id,
          b.document_id,
          b.tag_id,
          t.path AS tag_path,
          b.source,
          b.created_at,
          b.updated_at
        FROM manual_document_tag_bindings b
        JOIN tags t ON t.id = b.tag_id
        WHERE b.document_id IN (${placeholders})
          AND t.status = 'active'
        ORDER BY b.document_id, t.path
      `).all(...normalizedIds) as Array<Record<string, unknown>>;

      const identityRowsByDocument = new Map<string, ManualDocumentTagBindingRow[]>();
      resolvedRows.forEach((row) => {
        const current = identityRowsByDocument.get(row.documentId) ?? [];
        current.push(row);
        identityRowsByDocument.set(row.documentId, current);
      });
      const legacyRowsByDocument = new Map<string, ManualDocumentTagBindingRow[]>();
      legacyRows.forEach((row) => {
        const mapped = {
          id: String(row.id),
          documentId: String(row.document_id),
          tagId: String(row.tag_id),
          tagPath: String(row.tag_path),
          source: String(row.source),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        } satisfies ManualDocumentTagBindingRow;
        const current = legacyRowsByDocument.get(mapped.documentId) ?? [];
        current.push(mapped);
        legacyRowsByDocument.set(mapped.documentId, current);
      });

      return normalizedIds
        .flatMap((documentId) => {
          const identityRows = identityRowsByDocument.get(documentId);
          if (identityRows && identityRows.length > 0) {
            return identityRows;
          }
          return legacyRowsByDocument.get(documentId) ?? [];
        })
        .sort((left, right) =>
        left.documentId.localeCompare(right.documentId, "zh-Hans-CN")
        || left.tagPath.localeCompare(right.tagPath, "zh-Hans-CN"));
    } finally {
      db.close();
    }
  }

  getManualTagBindingStats(): ManualTagBindingStats {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const row = db.prepare(`
        WITH legacy_active AS (
          SELECT
            mdtb.document_id,
            mdtb.tag_id,
            f.inode_key,
            f.content_hash,
            f.size,
            f.extension
          FROM manual_document_tag_bindings mdtb
          JOIN documents d ON d.id = mdtb.document_id
          JOIN files f ON f.id = d.file_id
          WHERE f.status = 'active'
            AND d.index_status IN ('indexed', 'failed', 'skipped')
        ),
        legacy_only AS (
          SELECT la.document_id, la.tag_id
          FROM legacy_active la
          WHERE NOT EXISTS (
            SELECT 1
            FROM manual_file_tag_bindings mftb
            WHERE mftb.tag_id = la.tag_id
              AND (
                (la.inode_key IS NOT NULL AND mftb.inode_key = la.inode_key)
                OR (
                  la.content_hash IS NOT NULL
                  AND mftb.content_hash = la.content_hash
                  AND mftb.file_size = la.size
                  AND mftb.extension = la.extension
                )
              )
          )
        )
        SELECT
          (SELECT COUNT(*) FROM manual_file_tag_bindings) AS identity_binding_count,
          (SELECT COUNT(*) FROM manual_document_tag_bindings) AS legacy_binding_count,
          (SELECT COUNT(*) FROM legacy_only) AS legacy_fallback_binding_count,
          (SELECT COUNT(DISTINCT document_id) FROM legacy_only) AS legacy_fallback_document_count
      `).get() as Record<string, unknown> | undefined;

      return {
        identityBindingCount: Number(row?.identity_binding_count ?? 0),
        legacyBindingCount: Number(row?.legacy_binding_count ?? 0),
        legacyFallbackBindingCount: Number(row?.legacy_fallback_binding_count ?? 0),
        legacyFallbackDocumentCount: Number(row?.legacy_fallback_document_count ?? 0),
      };
    } finally {
      db.close();
    }
  }

  private resolveManualFileTagBindingsForDocuments(
    db: ReturnType<typeof openDatabase>,
    documents: DocumentIdentityRow[],
  ): ManualDocumentTagBindingRow[] {
    if (documents.length === 0) {
      return [];
    }

    const inodeKeys = [...new Set(documents.map((item) => item.inodeKey).filter((item): item is string => Boolean(item)))];
    const contentHashes = [...new Set(documents.map((item) => item.contentHash).filter((item): item is string => Boolean(item)))];
    if (inodeKeys.length === 0 && contentHashes.length === 0) {
      return [];
    }

    const predicateParts: string[] = [];
    const predicateParams: string[] = [];
    if (inodeKeys.length > 0) {
      predicateParts.push(`b.inode_key IN (${inodeKeys.map(() => "?").join(", ")})`);
      predicateParams.push(...inodeKeys);
    }
    if (contentHashes.length > 0) {
      predicateParts.push(`b.content_hash IN (${contentHashes.map(() => "?").join(", ")})`);
      predicateParams.push(...contentHashes);
    }

    const candidateRows = db.prepare(`
      SELECT
        b.id,
        b.inode_key,
        b.content_hash,
        b.file_size,
        b.extension,
        b.tag_id,
        t.path AS tag_path,
        b.source,
        b.created_at,
        b.updated_at
      FROM manual_file_tag_bindings b
      JOIN tags t ON t.id = b.tag_id
      WHERE t.status = 'active'
        AND (${predicateParts.join(" OR ")})
      ORDER BY t.path, b.updated_at DESC, b.id
    `).all(...predicateParams) as Array<Record<string, unknown>>;

    if (candidateRows.length === 0) {
      return [];
    }

    const candidates = candidateRows.map((row) => ({
      id: String(row.id),
      inodeKey: typeof row.inode_key === "string" && row.inode_key.trim() ? String(row.inode_key) : null,
      contentHash: typeof row.content_hash === "string" && row.content_hash.trim() ? String(row.content_hash) : null,
      fileSize: Number(row.file_size ?? 0),
      extension: String(row.extension ?? ""),
      tagId: String(row.tag_id),
      tagPath: String(row.tag_path),
      source: String(row.source),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })) satisfies ManualFileTagBindingCandidateRow[];

    const candidateInodeKeys = [...new Set(candidates.map((item) => item.inodeKey).filter((item): item is string => Boolean(item)))];
    const candidateContentHashes = [...new Set(candidates.map((item) => item.contentHash).filter((item): item is string => Boolean(item)))];
    const activeIdentityRows = this.listActiveDocumentIdentitiesByKeys(db, candidateInodeKeys, candidateContentHashes);
    const activeDocIdsByInode = buildDocumentIdsByInode(activeIdentityRows);
    const activeDocIdsByContent = buildDocumentIdsByContent(activeIdentityRows);

    const resolved = new Map<string, ManualDocumentTagBindingRow>();
    for (const document of documents) {
      const documentContentKey = buildContentIdentityKey(document.contentHash, document.size, document.extension);
      for (const candidate of candidates) {
        const matchedByInode = Boolean(candidate.inodeKey && document.inodeKey && candidate.inodeKey === document.inodeKey);
        const matchedByContent = !matchedByInode && matchesContentFallback(document, candidate, activeDocIdsByInode, activeDocIdsByContent, documentContentKey);
        if (!matchedByInode && !matchedByContent) {
          continue;
        }
        resolved.set(`${document.documentId}:${candidate.tagId}`, {
          id: candidate.id,
          documentId: document.documentId,
          tagId: candidate.tagId,
          tagPath: candidate.tagPath,
          source: candidate.source,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        });
      }
    }

    return [...resolved.values()];
  }

  private listActiveDocumentIdentitiesByKeys(
    db: ReturnType<typeof openDatabase>,
    inodeKeys: string[],
    contentHashes: string[],
  ): DocumentIdentityRow[] {
    if (inodeKeys.length === 0 && contentHashes.length === 0) {
      return [];
    }

    const predicateParts: string[] = [];
    const params: string[] = [];
    if (inodeKeys.length > 0) {
      predicateParts.push(`f.inode_key IN (${inodeKeys.map(() => "?").join(", ")})`);
      params.push(...inodeKeys);
    }
    if (contentHashes.length > 0) {
      predicateParts.push(`f.content_hash IN (${contentHashes.map(() => "?").join(", ")})`);
      params.push(...contentHashes);
    }

    const rows = db.prepare(`
      SELECT
        d.id AS document_id,
        f.path,
        f.inode_key,
        f.content_hash,
        f.size,
        f.extension
      FROM documents d
      JOIN files f ON f.id = d.file_id
      WHERE f.status = 'active'
        AND d.index_status = 'indexed'
        AND (${predicateParts.join(" OR ")})
    `).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      documentId: String(row.document_id),
      path: String(row.path),
      inodeKey: typeof row.inode_key === "string" && row.inode_key.trim() ? String(row.inode_key) : null,
      contentHash: typeof row.content_hash === "string" && row.content_hash.trim() ? String(row.content_hash) : null,
      size: Number(row.size ?? 0),
      extension: String(row.extension ?? ""),
    }));
  }

  listFolderTagBindingsByPaths(paths: string[]): FolderTagBindingRow[] {
    const normalizedPaths = [...new Set(paths.map(normalizeFolderBindingPath))];
    if (normalizedPaths.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedPaths.map(() => "?").join(", ");
      const rows = db.prepare(`
        SELECT
          b.id,
          b.folder_path,
          b.tag_id,
          t.path AS tag_path,
          b.apply_mode,
          b.created_at,
          b.updated_at
        FROM folder_tag_bindings b
        JOIN tags t ON t.id = b.tag_id
        WHERE b.folder_path IN (${placeholders})
        ORDER BY b.folder_path, t.path
      `).all(...normalizedPaths) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        id: String(row.id),
        folderPath: String(row.folder_path),
        tagId: String(row.tag_id),
        tagPath: String(row.tag_path),
        applyMode: String(row.apply_mode),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    } finally {
      db.close();
    }
  }

  listAllFolderTagBindings(): FolderTagBindingRow[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const rows = db.prepare(`
        SELECT
          b.id,
          b.folder_path,
          b.tag_id,
          t.path AS tag_path,
          b.apply_mode,
          b.created_at,
          b.updated_at
        FROM folder_tag_bindings b
        JOIN tags t ON t.id = b.tag_id
        WHERE t.status = 'active'
        ORDER BY b.folder_path, t.path
      `).all() as Array<Record<string, unknown>>;

      return rows.map(row => ({
        id: String(row.id),
        folderPath: String(row.folder_path),
        tagId: String(row.tag_id),
        tagPath: String(row.tag_path),
        applyMode: String(row.apply_mode),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    } finally {
      db.close();
    }
  }

  listEffectiveFolderTagBindingsForDocumentPaths(paths: string[]): EffectiveFolderTagBindingRow[] {
    const normalizedPaths = [...new Set(paths.map(item => item.trim().replace(/^\.\/+/, "")).filter(Boolean))];
    if (normalizedPaths.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const valuePlaceholders = normalizedPaths.map(() => "(?)").join(", ");
      const rows = db.prepare(`
        WITH target_paths(path) AS (
          VALUES ${valuePlaceholders}
        )
        SELECT
          b.id,
          b.folder_path,
          b.tag_id,
          t.path AS tag_path,
          b.apply_mode,
          b.created_at,
          b.updated_at,
          f.path AS document_path,
          d.id AS document_id
        FROM target_paths p
        JOIN files f ON f.path = p.path
        JOIN documents d ON d.file_id = f.id
        JOIN folder_tag_bindings b ON (
          b.folder_path = '.'
          OR f.path = b.folder_path
          OR f.path LIKE b.folder_path || '/%'
        )
        JOIN tags t ON t.id = b.tag_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
        ORDER BY f.path, b.folder_path, t.path
      `).all(...normalizedPaths) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        id: String(row.id),
        folderPath: String(row.folder_path),
        tagId: String(row.tag_id),
        tagPath: String(row.tag_path),
        applyMode: String(row.apply_mode),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        documentPath: String(row.document_path),
        documentId: String(row.document_id),
      }));
    } finally {
      db.close();
    }
  }

  listEffectiveFolderTagBindingsForFolderScope(folderPath: string): EffectiveFolderTagBindingRow[] {
    const normalizedFolderPath = normalizeScopedFolderPath(folderPath);
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const whereClause = normalizedFolderPath === "."
        ? ""
        : "AND (f.path = ? OR f.path LIKE ?)";
      const params = normalizedFolderPath === "."
        ? []
        : [normalizedFolderPath, `${normalizedFolderPath}/%`];
      const rows = db.prepare(`
        SELECT
          b.id,
          b.folder_path,
          b.tag_id,
          t.path AS tag_path,
          b.apply_mode,
          b.created_at,
          b.updated_at,
          f.path AS document_path,
          d.id AS document_id
        FROM files f
        JOIN documents d ON d.file_id = f.id
        JOIN folder_tag_bindings b ON (
          b.folder_path = '.'
          OR f.path = b.folder_path
          OR f.path LIKE b.folder_path || '/%'
        )
        JOIN tags t ON t.id = b.tag_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
          ${whereClause}
        ORDER BY f.path, b.folder_path, t.path
      `).all(...params) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        id: String(row.id),
        folderPath: String(row.folder_path),
        tagId: String(row.tag_id),
        tagPath: String(row.tag_path),
        applyMode: String(row.apply_mode),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        documentPath: String(row.document_path),
        documentId: String(row.document_id),
      }));
    } finally {
      db.close();
    }
  }

  listResolvedDocumentTagsByDocumentIds(documentIds: string[]): ResolvedDocumentTagRow[] {
    const normalizedIds = [...new Set(documentIds.map(item => item.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedIds.map(() => "?").join(", ");
      const directRows = db.prepare(`
        SELECT
          dt.document_id,
          t.path,
          dt.tag_id,
          dt.source AS source_type,
          dt.source_ref,
          dt.evidence,
          dt.confidence,
          dt.updated_at
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id IN (${placeholders})
      `).all(...normalizedIds) as Array<Record<string, unknown>>;
      const derivedRows = db.prepare(`
        SELECT
          ddt.document_id,
          t.path,
          ddt.tag_id,
          ddt.source AS source_type,
          ddt.source_ref,
          ddt.evidence,
          1 AS confidence,
          ddt.updated_at
        FROM derived_document_tags ddt
        JOIN tags t ON t.id = ddt.tag_id
        WHERE ddt.document_id IN (${placeholders})
      `).all(...normalizedIds) as Array<Record<string, unknown>>;

      return [...directRows, ...derivedRows]
        .map(row => ({
          documentId: String(row.document_id),
          path: String(row.path),
          tagId: String(row.tag_id),
          sourceType: String(row.source_type) as TagResolvedSourceType,
          sourceRef: typeof row.source_ref === "string" ? row.source_ref : null,
          evidence: typeof row.evidence === "string" ? row.evidence : null,
          confidence: Number(row.confidence ?? 0),
          updatedAt: String(row.updated_at),
        }))
        .sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
    } finally {
      db.close();
    }
  }

  listRecomputeCandidateDocuments(scope: RecomputeScope): TagRecomputeDocumentRow[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      if (scope.kind === "document" && scope.documentId) {
        const rows = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary,
                 COALESCE(group_concat(c.content, char(10)), '') AS content_text,
                 f.mtime, f.ctime, f.extension
          FROM documents d
          JOIN files f ON f.id = d.file_id
          LEFT JOIN chunks c ON c.document_id = d.id
          WHERE d.id = ?
            AND f.status = 'active'
            AND d.index_status = 'indexed'
          GROUP BY d.id, f.path, d.title, f.name, d.summary, f.mtime, f.ctime, f.extension
        `).all(scope.documentId) as Array<Record<string, unknown>>;
        return rows.map(mapTagRecomputeRow);
      }

      if (scope.kind === "folder" && scope.folderPath) {
        const normalizedPath = normalizeScopedFolderPath(scope.folderPath);
        const includeContentText = scope.mode !== "folder_bindings_only";
        const contentJoinClause = includeContentText
          ? "LEFT JOIN chunks c ON c.document_id = d.id"
          : "";
        const contentSelectClause = includeContentText
          ? "COALESCE(group_concat(c.content, char(10)), '') AS content_text,"
          : "'' AS content_text,";
        const whereClause = normalizedPath === "."
          ? ""
          : "AND (f.path = ? OR f.path LIKE ?)";
        const groupByClause = includeContentText
          ? "GROUP BY d.id, f.path, d.title, f.name, d.summary, f.mtime, f.ctime, f.extension"
          : "";
        const params = normalizedPath === "."
          ? []
          : [normalizedPath, `${normalizedPath}/%`];
        const rows = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary,
                 ${contentSelectClause}
                 f.mtime, f.ctime, f.extension
          FROM documents d
          JOIN files f ON f.id = d.file_id
          ${contentJoinClause}
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
            ${whereClause}
          ${groupByClause}
          ORDER BY f.path
        `).all(...params) as Array<Record<string, unknown>>;
        return rows.map(mapTagRecomputeRow);
      }

      if (scope.kind === "tag" && scope.tagId) {
        const rows = db.prepare(`
          SELECT DISTINCT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary,
                 COALESCE(group_concat(c.content, char(10)), '') AS content_text,
                 f.mtime, f.ctime, f.extension
          FROM tag_rules r
          JOIN tags t ON t.id = r.tag_id
          JOIN documents d
          LEFT JOIN chunks c ON c.document_id = d.id
          JOIN files f ON f.id = d.file_id
          WHERE r.tag_id = ?
            AND f.status = 'active'
            AND d.index_status = 'indexed'
          GROUP BY d.id, f.path, d.title, f.name, d.summary, f.mtime, f.ctime, f.extension
          ORDER BY f.path
        `).all(scope.tagId) as Array<Record<string, unknown>>;
        return rows.map(mapTagRecomputeRow);
      }

      return this.listAllRecomputeCandidateDocuments(db);
    } finally {
      db.close();
    }
  }

  getDocumentContext(documentId?: string, filePath?: string): DocumentContextResult | null {
    if (!documentId && !filePath) {
      throw new Error("documentId 或 filePath 至少提供一个");
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      let row: Record<string, unknown> | undefined;

      if (documentId) {
        row = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary, f.mtime, f.inode_key, f.content_hash, f.size, f.extension
          FROM documents d
          JOIN files f ON f.id = d.file_id
          WHERE d.id = ?
            AND f.status = 'active'
            AND d.index_status = 'indexed'
        `).get(documentId) as Record<string, unknown> | undefined;
      } else if (filePath) {
        row = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary, f.mtime, f.inode_key, f.content_hash, f.size, f.extension
          FROM documents d
          JOIN files f ON f.id = d.file_id
          WHERE f.path = ?
            AND f.status = 'active'
            AND d.index_status = 'indexed'
        `).get(filePath) as Record<string, unknown> | undefined;
      }

      if (!row) {
        return null;
      }

      const resolvedDocumentId = String(row.document_id);
      const tags = db.prepare(`
        SELECT t.path AS tag_path
        FROM tags t
        JOIN document_tags dt ON dt.tag_id = t.id
        WHERE dt.document_id = ?
        UNION ALL
        SELECT t.path AS tag_path
        FROM tags t
        JOIN derived_document_tags ddt ON ddt.tag_id = t.id
        WHERE ddt.document_id = ?
        ORDER BY tag_path
      `).all(resolvedDocumentId, resolvedDocumentId) as Array<{ tag_path: string }>;

      return {
        documentId: resolvedDocumentId,
        path: String(row.path),
        title: String(row.title),
        summary: String(row.summary ?? ""),
        modifiedAt: String(row.mtime),
        inodeKey: typeof row.inode_key === "string" && row.inode_key.trim() ? String(row.inode_key) : null,
        contentHash: typeof row.content_hash === "string" && row.content_hash.trim() ? String(row.content_hash) : null,
        size: Number(row.size ?? 0),
        extension: String(row.extension ?? ""),
        tags: tags.map(item => item.tag_path),
      };
    } finally {
      db.close();
    }
  }

  browseTags(rootType?: string, parentPath?: string): BrowseTagNodeResult[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      let sql = `
        SELECT id, path, name, root_type, parent_id
        FROM tags
        WHERE status = 'active'
          AND (
            EXISTS (SELECT 1 FROM document_tags dt WHERE dt.tag_id = tags.id)
            OR EXISTS (SELECT 1 FROM derived_document_tags ddt WHERE ddt.tag_id = tags.id)
            OR EXISTS (SELECT 1 FROM tags child WHERE child.parent_id = tags.id AND child.status = 'active')
          )
      `;
      const params: Array<string> = [];

      if (rootType) {
        sql += ` AND root_type = ?`;
        params.push(rootType);
      }

      if (parentPath) {
        const parentRow = db.prepare(`SELECT id FROM tags WHERE path = ?`).get(parentPath) as { id?: string } | undefined;
        if (!parentRow?.id) {
          return [];
        }
        sql += ` AND parent_id = ?`;
        params.push(String(parentRow.id));
      }

      sql += ` ORDER BY path`;

      const rows = db.prepare(sql).all(...params) as Array<{
        path: string;
        name: string;
        root_type: string;
        parent_id: string | null;
      }>;

      return rows.map(row => {
        let parentPathValue: string | null = null;
        if (row.parent_id) {
          const parent = db.prepare(`SELECT path FROM tags WHERE id = ?`).get(row.parent_id) as { path?: string } | undefined;
          parentPathValue = parent?.path ?? null;
        }
        return {
          path: row.path,
          name: row.name,
          rootType: row.root_type,
          parentPath: parentPathValue,
          depth: row.path.split("/").length - 1,
        };
      });
    } finally {
      db.close();
    }
  }

  searchDocuments(query: string, limit = 20): SearchDocumentResult[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const keyword = `%${normalizedQuery}%`;
      const rows = db.prepare(`
        SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
               COALESCE(d.summary, '') AS summary, f.mtime
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
          AND (
            f.path LIKE ?
            OR COALESCE(d.title, '') LIKE ?
            OR COALESCE(d.summary, '') LIKE ?
          )
        ORDER BY f.mtime DESC, f.path ASC
        LIMIT ?
      `).all(keyword, keyword, keyword, limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        documentId: String(row.document_id),
        path: String(row.path),
        title: String(row.title),
        summary: String(row.summary ?? ""),
        modifiedAt: String(row.mtime),
      }));
    } finally {
      db.close();
    }
  }

  listExportDocumentsByDocumentIds(documentIds: string[]): ExportDocumentRecord[] {
    const normalizedIds = [...new Set(documentIds.map(item => item.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedIds.map(() => "?").join(", ");
      const documentRows = db.prepare(`
        SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
               COALESCE(d.summary, '') AS summary, f.mtime
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
          AND d.id IN (${placeholders})
        ORDER BY f.path
      `).all(...normalizedIds) as Array<Record<string, unknown>>;

      if (documentRows.length === 0) {
        return [];
      }

      const ids = documentRows.map(row => String(row.document_id));
      const {
        directTagRows,
        derivedTagRows,
      } = fetchDocumentTagsForIds(db, ids);

      return attachTags(documentRows, directTagRows, derivedTagRows);
    } finally {
      db.close();
    }
  }

  listExportDocuments(): ExportDocumentRecord[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const documentRows = db.prepare(`
        SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
               COALESCE(d.summary, '') AS summary, f.mtime
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
        ORDER BY f.path
      `).all() as Array<Record<string, unknown>>;

      const directTagRows = db.prepare(`
        SELECT dt.document_id, t.path AS tag_path
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        ORDER BY dt.document_id, t.path
      `).all() as Array<{ document_id: string; tag_path: string }>;

      const derivedTagRows = db.prepare(`
        SELECT ddt.document_id, t.path AS tag_path
        FROM derived_document_tags ddt
        JOIN tags t ON t.id = ddt.tag_id
        ORDER BY ddt.document_id, t.path
      `).all() as Array<{ document_id: string; tag_path: string }>;

      return attachTags(documentRows, directTagRows, derivedTagRows);
    } finally {
      db.close();
    }
  }

  listActiveFileExtensions(): string[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const rows = db.prepare(`
        SELECT DISTINCT extension
        FROM files
        WHERE status = 'active'
          AND extension IS NOT NULL
          AND extension <> ''
        ORDER BY extension
      `).all() as Array<{ extension: string }>;
      return rows.map(row => String(row.extension));
    } finally {
      db.close();
    }
  }

  listExportDocumentsByPaths(paths: string[]): ExportDocumentRecord[] {
    const normalizedPaths = [...new Set(paths.map(item => item.trim()).filter(Boolean))];
    if (normalizedPaths.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedPaths.map(() => "?").join(", ");
      const documentRows = db.prepare(`
        SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
               COALESCE(d.summary, '') AS summary, f.mtime
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
          AND f.path IN (${placeholders})
        ORDER BY f.path
      `).all(...normalizedPaths) as Array<Record<string, unknown>>;

      if (documentRows.length === 0) {
        return [];
      }

      const documentIds = documentRows.map(row => String(row.document_id));
      const tagPlaceholders = documentIds.map(() => "?").join(", ");

      const directTagRows = db.prepare(`
        SELECT dt.document_id, t.path AS tag_path
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id IN (${tagPlaceholders})
        ORDER BY dt.document_id, t.path
      `).all(...documentIds) as Array<{ document_id: string; tag_path: string }>;

      const derivedTagRows = db.prepare(`
        SELECT ddt.document_id, t.path AS tag_path
        FROM derived_document_tags ddt
        JOIN tags t ON t.id = ddt.tag_id
        WHERE ddt.document_id IN (${tagPlaceholders})
        ORDER BY ddt.document_id, t.path
      `).all(...documentIds) as Array<{ document_id: string; tag_path: string }>;

      return attachTags(documentRows, directTagRows, derivedTagRows);
    } finally {
      db.close();
    }
  }

  listExportDocumentsByExtensions(extensions: string[]): ExportDocumentRecord[] {
    const normalizedExtensions = [...new Set(
      extensions
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)
        .map(item => item.startsWith(".") ? item : `.${item}`),
    )];
    if (normalizedExtensions.length === 0) {
      return [];
    }

    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const placeholders = normalizedExtensions.map(() => "?").join(", ");
      const documentRows = db.prepare(`
        SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
               COALESCE(d.summary, '') AS summary, f.mtime
        FROM documents d
        JOIN files f ON f.id = d.file_id
        WHERE f.status = 'active'
          AND d.index_status = 'indexed'
          AND f.extension IN (${placeholders})
        ORDER BY f.path
      `).all(...normalizedExtensions) as Array<Record<string, unknown>>;

      if (documentRows.length === 0) {
        return [];
      }

      const documentIds = documentRows.map(row => String(row.document_id));
      const {
        directTagRows,
        derivedTagRows,
      } = fetchDocumentTagsForIds(db, documentIds);

      return attachTags(documentRows, directTagRows, derivedTagRows);
    } finally {
      db.close();
    }
  }

  listExportTags(): ExportTagRecord[] {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      const rows = db.prepare(`
        SELECT t.path, t.name, t.root_type, parent.path AS parent_path
        FROM tags t
        LEFT JOIN tags parent ON parent.id = t.parent_id
        WHERE t.status = 'active'
          AND (
            EXISTS (SELECT 1 FROM document_tags dt WHERE dt.tag_id = t.id)
            OR EXISTS (SELECT 1 FROM derived_document_tags ddt WHERE ddt.tag_id = t.id)
            OR EXISTS (SELECT 1 FROM tags child WHERE child.parent_id = t.id AND child.status = 'active')
          )
        ORDER BY t.path
      `).all() as Array<Record<string, unknown>>;

      return rows.map(row => ({
        path: String(row.path),
        name: String(row.name),
        rootType: String(row.root_type),
        parentPath: row.parent_path ? String(row.parent_path) : null,
        depth: String(row.path).split("/").length - 1,
      }));
    } finally {
      db.close();
    }
  }

  *iterateExportDocuments(batchSize = 1000): Generator<ExportDocumentRow[]> {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      let lastPath = "";
      while (true) {
        const rows = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary, f.mtime
          FROM documents d
          JOIN files f ON f.id = d.file_id
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
            AND f.path > ?
          ORDER BY f.path
          LIMIT ?
        `).all(lastPath, batchSize) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        yield mapDocumentRows(rows);
        lastPath = String(rows[rows.length - 1]?.path ?? lastPath);
      }
    } finally {
      db.close();
    }
  }

  *iterateExportDocumentRecords(batchSize = 1000): Generator<ExportDocumentRecord[]> {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      let lastPath = "";
      while (true) {
        const documentRows = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary, f.mtime
          FROM documents d
          JOIN files f ON f.id = d.file_id
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
            AND f.path > ?
          ORDER BY f.path
          LIMIT ?
        `).all(lastPath, batchSize) as Array<Record<string, unknown>>;

        if (documentRows.length === 0) {
          return;
        }

        const documentIds = documentRows.map(row => String(row.document_id));
        const {
          directTagRows,
          derivedTagRows,
        } = fetchDocumentTagsForIds(db, documentIds);
        yield attachTags(documentRows, directTagRows, derivedTagRows);
        lastPath = String(documentRows[documentRows.length - 1]?.path ?? lastPath);
      }
    } finally {
      db.close();
    }
  }

  *iterateDocumentTagRows(batchSize = 5000): Generator<ExportDocumentTagRow[]> {
    const db = openDatabase(this.dbPath, this.dbOptions);
    try {
      let offset = 0;
      while (true) {
        const rows = db.prepare(`
          SELECT dt.document_id, t.path AS tag_path, 0 AS derived
          FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          ORDER BY dt.document_id, t.path
          LIMIT ? OFFSET ?
        `).all(batchSize, offset) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          break;
        }

        yield rows.map(row => ({
          documentId: String(row.document_id),
          tagPath: String(row.tag_path),
          derived: Number(row.derived) === 1,
        }));
        offset += rows.length;
      }

      offset = 0;
      while (true) {
        const rows = db.prepare(`
          SELECT ddt.document_id, t.path AS tag_path, 1 AS derived
          FROM derived_document_tags ddt
          JOIN tags t ON t.id = ddt.tag_id
          ORDER BY ddt.document_id, t.path
          LIMIT ? OFFSET ?
        `).all(batchSize, offset) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        yield rows.map(row => ({
          documentId: String(row.document_id),
          tagPath: String(row.tag_path),
          derived: Number(row.derived) === 1,
        }));
        offset += rows.length;
      }
    } finally {
      db.close();
    }
  }

  *iterateTagPostingRows(batchSize = 5000): Generator<ExportTagPostingRow[]> {
    const directIterator = this.iterateDirectTagPostingRows(batchSize);
    const derivedIterator = this.iterateDerivedTagPostingRows(batchSize);
    let directState = directIterator.next();
    let derivedState = derivedIterator.next();
    let directIndex = 0;
    let derivedIndex = 0;

    while (!directState.done || !derivedState.done) {
      const mergedBatch: ExportTagPostingRow[] = [];

      while (mergedBatch.length < batchSize && (!directState.done || !derivedState.done)) {
        if (directState.done) {
          mergedBatch.push(derivedState.value[derivedIndex]!);
          derivedIndex += 1;
        } else if (derivedState.done) {
          mergedBatch.push(directState.value[directIndex]!);
          directIndex += 1;
        } else {
          const directRow = directState.value[directIndex]!;
          const derivedRow = derivedState.value[derivedIndex]!;
          if (compareTagPostingRows(directRow, derivedRow) <= 0) {
            mergedBatch.push(directRow);
            directIndex += 1;
          } else {
            mergedBatch.push(derivedRow);
            derivedIndex += 1;
          }
        }

        if (!directState.done && directIndex >= directState.value.length) {
          directState = directIterator.next();
          directIndex = 0;
        }
        if (!derivedState.done && derivedIndex >= derivedState.value.length) {
          derivedState = derivedIterator.next();
          derivedIndex = 0;
        }
      }

      if (mergedBatch.length === 0) {
        return;
      }

      yield mergedBatch;
    }
  }

  *iterateDirectTagPostingRows(batchSize = 5000): Generator<ExportTagPostingRow[]> {
    const db = openDatabase(this.dbPath);
    try {
      let lastRootType = "";
      let lastTagPath = "";
      let lastPath = "";
      let lastDocumentId = "";
      while (true) {
        const rows = db.prepare(`
          SELECT t.root_type, t.path AS tag_path, dt.document_id, f.path, COALESCE(d.title, f.name) AS title, 0 AS derived
          FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          JOIN documents d ON d.id = dt.document_id
          JOIN files f ON f.id = d.file_id
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
            AND (
              t.root_type > ?
              OR (t.root_type = ? AND t.path > ?)
              OR (t.root_type = ? AND t.path = ? AND f.path > ?)
              OR (t.root_type = ? AND t.path = ? AND f.path = ? AND dt.document_id > ?)
            )
          ORDER BY t.root_type, t.path, f.path, dt.document_id
          LIMIT ?
        `).all(
          lastRootType,
          lastRootType, lastTagPath,
          lastRootType, lastTagPath, lastPath,
          lastRootType, lastTagPath, lastPath, lastDocumentId,
          batchSize
        ) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        const mapped = rows.map(row => ({
          rootType: String(row.root_type),
          tagPath: String(row.tag_path),
          documentId: String(row.document_id),
          path: String(row.path),
          title: String(row.title),
          derived: false,
        }));
        yield mapped;
        const lastRow = mapped[mapped.length - 1];
        lastRootType = lastRow?.rootType ?? lastRootType;
        lastTagPath = lastRow?.tagPath ?? lastTagPath;
        lastPath = lastRow?.path ?? lastPath;
        lastDocumentId = lastRow?.documentId ?? lastDocumentId;
      }
    } finally {
      db.close();
    }
  }

  *iterateDerivedTagPostingRows(batchSize = 5000): Generator<ExportTagPostingRow[]> {
    const db = openDatabase(this.dbPath);
    try {
      let lastRootType = "";
      let lastTagPath = "";
      let lastPath = "";
      let lastDocumentId = "";
      while (true) {
        const rows = db.prepare(`
          SELECT t.root_type, t.path AS tag_path, ddt.document_id, f.path, COALESCE(d.title, f.name) AS title, 1 AS derived
          FROM derived_document_tags ddt
          JOIN tags t ON t.id = ddt.tag_id
          JOIN documents d ON d.id = ddt.document_id
          JOIN files f ON f.id = d.file_id
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
            AND (
              t.root_type > ?
              OR (t.root_type = ? AND t.path > ?)
              OR (t.root_type = ? AND t.path = ? AND f.path > ?)
              OR (t.root_type = ? AND t.path = ? AND f.path = ? AND ddt.document_id > ?)
            )
          ORDER BY t.root_type, t.path, f.path, ddt.document_id
          LIMIT ?
        `).all(
          lastRootType,
          lastRootType, lastTagPath,
          lastRootType, lastTagPath, lastPath,
          lastRootType, lastTagPath, lastPath, lastDocumentId,
          batchSize
        ) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        const mapped = rows.map(row => ({
          rootType: String(row.root_type),
          tagPath: String(row.tag_path),
          documentId: String(row.document_id),
          path: String(row.path),
          title: String(row.title),
          derived: true,
        }));
        yield mapped;
        const lastRow = mapped[mapped.length - 1];
        lastRootType = lastRow?.rootType ?? lastRootType;
        lastTagPath = lastRow?.tagPath ?? lastTagPath;
        lastPath = lastRow?.path ?? lastPath;
        lastDocumentId = lastRow?.documentId ?? lastDocumentId;
      }
    } finally {
      db.close();
    }
  }

  *iterateTagRecomputeDocuments(batchSize = 1000): Generator<TagRecomputeDocumentRow[]> {
    const db = openDatabase(this.dbPath);
    try {
      let lastPath = "";
      while (true) {
        const rows = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary,
                 COALESCE(group_concat(c.content, char(10)), '') AS content_text,
                 f.mtime, f.ctime, f.extension
          FROM documents d
          JOIN files f ON f.id = d.file_id
          LEFT JOIN chunks c ON c.document_id = d.id
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
            AND f.path > ?
          GROUP BY d.id, f.path, d.title, f.name, d.summary, f.mtime, f.ctime, f.extension
          ORDER BY f.path
          LIMIT ?
        `).all(lastPath, batchSize) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        yield rows.map(row => ({
          documentId: String(row.document_id),
          path: String(row.path),
          title: String(row.title),
          summary: String(row.summary ?? ""),
          contentText: String(row.content_text ?? ""),
          mtime: String(row.mtime),
          ctime: String(row.ctime),
          extension: String(row.extension),
        }));
        lastPath = String(rows[rows.length - 1]?.path ?? lastPath);
      }
    } finally {
      db.close();
    }
  }

  private listAllRecomputeCandidateDocuments(db: ReturnType<typeof openDatabase>): TagRecomputeDocumentRow[] {
    const rows = db.prepare(`
      SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
             COALESCE(d.summary, '') AS summary,
             COALESCE(group_concat(c.content, char(10)), '') AS content_text,
             f.mtime, f.ctime, f.extension
      FROM documents d
      JOIN files f ON f.id = d.file_id
      LEFT JOIN chunks c ON c.document_id = d.id
      WHERE f.status = 'active'
        AND d.index_status = 'indexed'
      GROUP BY d.id, f.path, d.title, f.name, d.summary, f.mtime, f.ctime, f.extension
      ORDER BY f.path
    `).all() as Array<Record<string, unknown>>;
    return rows.map(mapTagRecomputeRow);
  }
}

function buildDocumentIdsByInode(rows: DocumentIdentityRow[]): Map<string, Set<string>> {
  const byInode = new Map<string, Set<string>>();
  rows.forEach((row) => {
    if (!row.inodeKey) {
      return;
    }
    const current = byInode.get(row.inodeKey) ?? new Set<string>();
    current.add(row.documentId);
    byInode.set(row.inodeKey, current);
  });
  return byInode;
}

function buildDocumentIdsByContent(rows: DocumentIdentityRow[]): Map<string, Set<string>> {
  const byContent = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const key = buildContentIdentityKey(row.contentHash, row.size, row.extension);
    if (!key) {
      return;
    }
    const current = byContent.get(key) ?? new Set<string>();
    current.add(row.documentId);
    byContent.set(key, current);
  });
  return byContent;
}

function buildContentIdentityKey(contentHash: string | null, size: number, extension: string): string | null {
  if (!contentHash) {
    return null;
  }
  return `${contentHash}::${size}::${extension}`;
}

function matchesContentFallback(
  document: DocumentIdentityRow,
  candidate: ManualFileTagBindingCandidateRow,
  activeDocIdsByInode: Map<string, Set<string>>,
  activeDocIdsByContent: Map<string, Set<string>>,
  documentContentKey: string | null,
): boolean {
  const candidateContentKey = buildContentIdentityKey(candidate.contentHash, candidate.fileSize, candidate.extension);
  if (!documentContentKey || !candidateContentKey || documentContentKey !== candidateContentKey) {
    return false;
  }

  const contentMatches = activeDocIdsByContent.get(candidateContentKey);
  if (!contentMatches || contentMatches.size !== 1 || !contentMatches.has(document.documentId)) {
    return false;
  }

  if (!candidate.inodeKey) {
    return true;
  }

  const inodeMatches = activeDocIdsByInode.get(candidate.inodeKey);
  return !inodeMatches || (inodeMatches.size === 1 && inodeMatches.has(document.documentId));
}

function mapTagRecomputeRow(row: Record<string, unknown>): TagRecomputeDocumentRow {
  return {
    documentId: String(row.document_id),
    path: String(row.path),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    contentText: String(row.content_text ?? ""),
    mtime: String(row.mtime),
    ctime: String(row.ctime),
    extension: String(row.extension),
  };
}

function normalizeScopedFolderPath(value: string): string {
  const normalized = value.trim().replace(/^\.\/+/, "").replace(/\/+$/g, "");
  if (!normalized || normalized === ".") {
    return ".";
  }
  return normalized;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function mapTagRuleRow(row: Record<string, unknown>): TagRuleRow {
  const scope = parseJsonRecord(row.scope_json);
  const matcher = parseJsonRecord(row.matcher_json) as TagRuleMatcher;
  const relationValue = typeof scope.relation === "string" ? scope.relation.toLowerCase() : "and";
  const relation: TagRuleRelation =
    relationValue === "or" || relationValue === "not" ? relationValue : "and";
  return {
    id: String(row.id),
    tagId: String(row.tag_id),
    tagPath: String(row.tag_path),
    enabled: Number(row.enabled ?? 0) === 1,
    relation,
    ruleType: String(row.rule_type) as TagRuleType,
    matcher,
    minScore: row.min_score === null || row.min_score === undefined ? null : Number(row.min_score),
    priority: Number(row.priority ?? 0),
    source: String(row.source ?? "smart_rule"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeFolderBindingPath(value: string): string {
  const normalized = value.trim().replace(/^\.\/+/, "").replace(/\/+$/g, "");
  return normalized || ".";
}
