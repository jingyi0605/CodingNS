import fs from "node:fs";
import { openDatabase } from "./open-database.js";

export type CatalogSchemaMode =
  | "absent"
  | "empty"
  | "legacy_unsupported"
  | "node_v1"
  | "node_v2"
  | "node_v3"
  | "unknown";

export interface CatalogSchemaReport {
  mode: CatalogSchemaMode;
  dbPath: string;
  tableCount: number;
  tableNames: string[];
  schemaVersion: number | null;
  managedBy: string | null;
}

/**
 * 检测当前 catalog.db 的 schema 状态。
 * 这里保留对旧库形态的识别，但不再保留 Python 运行时或并行期依赖。
 */
export async function detectCatalogSchema(dbPath: string): Promise<CatalogSchemaReport> {
  if (!fs.existsSync(dbPath)) {
    return {
      mode: "absent",
      dbPath,
      tableCount: 0,
      tableNames: [],
      schemaVersion: null,
      managedBy: null,
    };
  }

  const db = openDatabase(dbPath);
  try {
    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    const tableNames = tables.map(item => item.name);
    const tableCount = tableNames.length;

    if (tableCount === 0) {
      return {
        mode: "empty",
        dbPath,
        tableCount,
        tableNames,
        schemaVersion: null,
        managedBy: null,
      };
    }

    const hasSchemaMeta = tableNames.includes("schema_meta");
    const hasLegacyCoreTables = ["files", "documents", "chunks", "tags"].every(name => tableNames.includes(name));

    if (hasSchemaMeta) {
      const rows = db.prepare(`SELECT key, value FROM schema_meta WHERE key IN ('schema_version', 'managed_by')`).all() as Array<{ key: string; value: string }>;
      const kv = new Map(rows.map(item => [item.key, item.value]));
      const rawVersion = kv.get("schema_version");
      const schemaVersion = rawVersion ? Number(rawVersion) : null;
      const managedBy = kv.get("managed_by") ?? null;

      const mode = managedBy === "node"
        ? schemaVersion === 1
          ? "node_v1"
          : schemaVersion === 2
            ? "node_v2"
            : schemaVersion === 3
              ? "node_v3"
              : "unknown"
        : "unknown";

      return {
        mode,
        dbPath,
        tableCount,
        tableNames,
        schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : null,
        managedBy,
      };
    }

    if (hasLegacyCoreTables) {
      return {
        mode: "legacy_unsupported",
        dbPath,
        tableCount,
        tableNames,
        schemaVersion: null,
        managedBy: null,
      };
    }

    return {
      mode: "unknown",
      dbPath,
      tableCount,
      tableNames,
      schemaVersion: null,
      managedBy: null,
    };
  } finally {
    db.close();
  }
}
