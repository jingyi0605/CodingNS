import crypto from "node:crypto";
import fs from "node:fs";
import type { RuntimeConfig } from "../../../contracts/src/index.js";
import { CATALOG_SCHEMA_SQL } from "./catalog-schema.js";
import { openDatabase } from "./open-database.js";

export interface CatalogMigration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrationRunResult {
  dbPath: string;
  schemaVersion: number;
  appliedMigrations: string[];
  executedAt: string;
}

const CATALOG_MIGRATIONS: CatalogMigration[] = [
  {
    version: 1,
    name: "bootstrap_node_schema_v1",
    sql: `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_history (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  dir_path TEXT NOT NULL,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime TEXT NOT NULL,
  ctime TEXT,
  content_hash TEXT,
  status TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_id TEXT UNIQUE NOT NULL,
  title TEXT,
  summary TEXT,
  language TEXT,
  parse_status TEXT NOT NULL,
  parse_error TEXT,
  index_status TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  last_indexed_at TEXT,
  FOREIGN KEY(file_id) REFERENCES files(id)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT,
  page_no INTEGER,
  sheet_name TEXT,
  heading_path TEXT,
  token_count INTEGER,
  vector_point_id TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  root_type TEXT NOT NULL,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  canonical_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_aliases (
  id TEXT PRIMARY KEY,
  tag_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  FOREIGN KEY(tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS document_tags (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  evidence TEXT,
  manual_override INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, tag_id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS derived_document_tags (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS reindex_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  target_path TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(path);
CREATE INDEX IF NOT EXISTS idx_tag_aliases_alias ON tag_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_reindex_jobs_status ON reindex_jobs(status, priority, created_at);
    `,
  },
  {
    version: 2,
    name: "add_parser_skip_catalog_v2",
    sql: `
CREATE TABLE IF NOT EXISTS parser_skip_catalog (
  skip_key TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  extension TEXT NOT NULL,
  sample_paths_json TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  last_message TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_run_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parser_skip_catalog_reason ON parser_skip_catalog(reason_code, extension, last_run_at);
    `,
  },
  {
    version: 3,
    name: "add_tag_write_indexes_v3",
    sql: `
CREATE INDEX IF NOT EXISTS idx_document_tags_document ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_derived_document_tags_document ON derived_document_tags(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_derived_document_tags_pair ON derived_document_tags(document_id, tag_id);
    `,
  },
];

function hasTable(db: ReturnType<typeof openDatabase>, tableName: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function readCurrentSchemaVersion(db: ReturnType<typeof openDatabase>): number {
  if (!hasTable(db, "schema_meta")) {
    return 0;
  }
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as { value?: string } | undefined;
  if (!row?.value) {
    return 0;
  }
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 最小迁移执行器。
 * 先把版本与历史机制收整齐，避免后续 schema 演进继续失控。
 */
export function runCatalogMigrations(config: RuntimeConfig): MigrationRunResult {
  fs.mkdirSync(config.indexDir, { recursive: true });
  fs.mkdirSync(config.exportDir, { recursive: true });

  const db = openDatabase(config.dbPath);
  const now = new Date().toISOString();
  const appliedMigrations: string[] = [];

  try {
    db.exec("BEGIN IMMEDIATE");
    let currentVersion = readCurrentSchemaVersion(db);

    for (const migration of CATALOG_MIGRATIONS) {
      if (migration.version <= currentVersion) {
        continue;
      }

      db.exec(migration.sql);

      const checksum = crypto.createHash("sha1").update(migration.sql).digest("hex");
      db.prepare(`
        INSERT OR REPLACE INTO schema_meta(key, value, updated_at)
        VALUES(?, ?, ?)
      `).run("schema_version", String(migration.version), now);
      db.prepare(`
        INSERT OR REPLACE INTO schema_meta(key, value, updated_at)
        VALUES(?, ?, ?)
      `).run("managed_by", "node", now);

      db.prepare(`
        INSERT OR REPLACE INTO migration_history(id, version, name, applied_at, checksum, status)
        VALUES(?, ?, ?, ?, ?, ?)
      `).run(
        `migration_${migration.version}`,
        migration.version,
        migration.name,
        now,
        checksum,
        "done",
      );

      appliedMigrations.push(migration.name);
      currentVersion = migration.version;
    }

    db.exec("COMMIT");
    return {
      dbPath: config.dbPath,
      schemaVersion: currentVersion,
      appliedMigrations,
      executedAt: now,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    db.close();
  }
}
