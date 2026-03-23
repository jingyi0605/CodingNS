PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS bootstrap_state (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1)),
  initialized_at TEXT,
  initialized_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'admin'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  repo_root TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_indexes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  last_message_at TEXT,
  raw_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_indexes_workspace_id ON session_indexes(workspace_id);

CREATE TABLE IF NOT EXISTS session_states (
  session_id TEXT PRIMARY KEY,
  sync_cursor TEXT,
  last_sync_at TEXT,
  sync_error_code TEXT,
  sync_error_message TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_indexes(id)
);

-- spec001 的硬边界：这里只允许索引、状态、映射和认证信息。
-- 不允许出现保存原始会话正文的 message/content/raw_body 之类表。

INSERT INTO bootstrap_state (id, initialized)
VALUES ('default', 0)
ON CONFLICT(id) DO NOTHING;
