import { openDatabase } from "../sqlite/open-database.js";

export interface DocumentContextResult {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  modifiedAt: string;
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
  mtime: string;
  ctime: string;
  extension: string;
}

export interface ExportTagPostingRow {
  rootType: string;
  tagPath: string;
  documentId: string;
  path: string;
  title: string;
  derived: boolean;
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
  constructor(private readonly dbPath: string) {}

  getDocumentContext(documentId?: string, filePath?: string): DocumentContextResult | null {
    if (!documentId && !filePath) {
      throw new Error("documentId 或 filePath 至少提供一个");
    }

    const db = openDatabase(this.dbPath);
    try {
      let row: Record<string, unknown> | undefined;

      if (documentId) {
        row = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary, f.mtime
          FROM documents d
          JOIN files f ON f.id = d.file_id
          WHERE d.id = ?
            AND f.status = 'active'
            AND d.index_status = 'indexed'
        `).get(documentId) as Record<string, unknown> | undefined;
      } else if (filePath) {
        row = db.prepare(`
          SELECT d.id AS document_id, f.path, COALESCE(d.title, f.name) AS title,
                 COALESCE(d.summary, '') AS summary, f.mtime
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
        tags: tags.map(item => item.tag_path),
      };
    } finally {
      db.close();
    }
  }

  browseTags(rootType?: string, parentPath?: string): BrowseTagNodeResult[] {
    const db = openDatabase(this.dbPath);
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

    const db = openDatabase(this.dbPath);
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

    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
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

    const db = openDatabase(this.dbPath);
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

    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
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
    const db = openDatabase(this.dbPath);
    try {
      let offset = 0;
      while (true) {
        const rows = db.prepare(`
          SELECT *
          FROM (
            SELECT t.root_type, t.path AS tag_path, dt.document_id, f.path, COALESCE(d.title, f.name) AS title, 0 AS derived
            FROM document_tags dt
            JOIN tags t ON t.id = dt.tag_id
            JOIN documents d ON d.id = dt.document_id
            JOIN files f ON f.id = d.file_id
            WHERE f.status = 'active'
              AND d.index_status = 'indexed'
            UNION ALL
            SELECT t.root_type, t.path AS tag_path, ddt.document_id, f.path, COALESCE(d.title, f.name) AS title, 1 AS derived
            FROM derived_document_tags ddt
            JOIN tags t ON t.id = ddt.tag_id
            JOIN documents d ON d.id = ddt.document_id
            JOIN files f ON f.id = d.file_id
            WHERE f.status = 'active'
              AND d.index_status = 'indexed'
          )
          ORDER BY root_type, tag_path, path
          LIMIT ? OFFSET ?
        `).all(batchSize, offset) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        yield rows.map(row => ({
          rootType: String(row.root_type),
          tagPath: String(row.tag_path),
          documentId: String(row.document_id),
          path: String(row.path),
          title: String(row.title),
          derived: Number(row.derived) === 1,
        }));
        offset += rows.length;
      }
    } finally {
      db.close();
    }
  }

  *iterateDirectTagPostingRows(batchSize = 5000): Generator<ExportTagPostingRow[]> {
    const db = openDatabase(this.dbPath);
    try {
      let offset = 0;
      while (true) {
        const rows = db.prepare(`
          SELECT t.root_type, t.path AS tag_path, dt.document_id, f.path, COALESCE(d.title, f.name) AS title, 0 AS derived
          FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          JOIN documents d ON d.id = dt.document_id
          JOIN files f ON f.id = d.file_id
          WHERE f.status = 'active'
            AND d.index_status = 'indexed'
          ORDER BY t.path, f.path
          LIMIT ? OFFSET ?
        `).all(batchSize, offset) as Array<Record<string, unknown>>;

        if (rows.length === 0) {
          return;
        }

        yield rows.map(row => ({
          rootType: String(row.root_type),
          tagPath: String(row.tag_path),
          documentId: String(row.document_id),
          path: String(row.path),
          title: String(row.title),
          derived: false,
        }));
        offset += rows.length;
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
                 COALESCE(d.summary, '') AS summary, f.mtime, f.ctime, f.extension
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

        yield rows.map(row => ({
          documentId: String(row.document_id),
          path: String(row.path),
          title: String(row.title),
          summary: String(row.summary ?? ""),
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
}
