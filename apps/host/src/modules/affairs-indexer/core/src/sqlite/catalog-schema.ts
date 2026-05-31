/**
 * 当前 Node 版最小 catalog schema。
 * 以 SQLite 为唯一真相源，保持 schema 可迁移、可追踪。
 */
export const CATALOG_SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_files_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(path);
CREATE INDEX IF NOT EXISTS idx_document_tags_document ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_derived_document_tags_document ON derived_document_tags(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_derived_document_tags_pair ON derived_document_tags(document_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_aliases_alias ON tag_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_reindex_jobs_status ON reindex_jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_parser_skip_catalog_reason ON parser_skip_catalog(reason_code, extension, last_run_at);
`;
