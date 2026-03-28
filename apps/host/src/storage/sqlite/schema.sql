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
  updated_at TEXT NOT NULL,
  removed_at TEXT
);

CREATE TABLE IF NOT EXISTS commit_rule_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject_pattern TEXT NOT NULL,
  max_subject_length INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('zh', 'en', 'any')),
  require_body INTEGER NOT NULL DEFAULT 0 CHECK (require_body IN (0, 1)),
  require_issue INTEGER NOT NULL DEFAULT 0 CHECK (require_issue IN (0, 1)),
  issue_pattern TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS session_bindings (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  raw_store_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_bindings_workspace_id ON session_bindings(workspace_id);

CREATE TABLE IF NOT EXISTS session_indices (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  parent_session_id TEXT,
  is_subagent INTEGER NOT NULL DEFAULT 0 CHECK (is_subagent IN (0, 1)),
  subagent_label TEXT,
  title TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_indices_workspace_id ON session_indices(workspace_id);

CREATE TABLE IF NOT EXISTS session_changed_files (
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  last_tool_name TEXT,
  PRIMARY KEY (session_id, path),
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_session_changed_files_session
  ON session_changed_files(session_id, path);

CREATE TABLE IF NOT EXISTS session_changed_file_states (
  session_id TEXT PRIMARY KEY,
  indexed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE TABLE IF NOT EXISTS session_status_snapshots (
  session_id TEXT PRIMARY KEY,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_cursor TEXT,
  last_sync_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  resumed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE TABLE IF NOT EXISTS session_states (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  running_state TEXT NOT NULL CHECK (
    running_state IN ('idle', 'starting', 'running', 'completed', 'interrupted', 'failed')
  ),
  activity_source TEXT NOT NULL CHECK (activity_source IN ('none', 'runtime', 'inferred')),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_event_at TEXT,
  completed_at TEXT,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_session_states_user_id
  ON session_states(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_message_attachments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('image')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_message_attachments_message
  ON session_message_attachments(session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_session_message_attachments_client_request
  ON session_message_attachments(session_id, client_request_id);

CREATE TABLE IF NOT EXISTS session_send_queue (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  client_request_id TEXT,
  model TEXT,
  reasoning_level TEXT,
  permission_mode TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'dispatching', 'failed')),
  order_index INTEGER NOT NULL,
  error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_session_send_queue_session_status
  ON session_send_queue(session_id, status, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_session_send_queue_session_user
  ON session_send_queue(session_id, user_id, order_index ASC);

CREATE TABLE IF NOT EXISTS recent_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  UNIQUE (workspace_id, user_id, path)
);

CREATE INDEX IF NOT EXISTS idx_recent_files_workspace_user
  ON recent_files(workspace_id, user_id, last_opened_at DESC);

CREATE TABLE IF NOT EXISTS session_file_context_bindings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 1 CHECK (selected IN (0, 1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  range_start INTEGER,
  range_end INTEGER,
  content_hash TEXT NOT NULL,
  file_version TEXT NOT NULL,
  attached_by TEXT NOT NULL,
  attached_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (attached_by) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_session_file_context_bindings_session
  ON session_file_context_bindings(session_id, attached_at DESC);

-- 会话同步的硬边界：这里不保存 provider 原始历史正文。
-- 允许保存项目内待发送队列正文，因为它属于本项目的发送控制面，不属于 provider 原始会话镜像。

CREATE TABLE IF NOT EXISTS terminal_instances (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  shell TEXT NOT NULL,
  runtime_type TEXT NOT NULL CHECK (
    runtime_type IN ('embedded-pty', 'tmux', 'conpty-powershell', 'conpty-cmd', 'conpty-git-bash')
  ),
  runtime_session_id TEXT NOT NULL,
  attach_target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating', 'running', 'closed', 'error')),
  process_id INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  closed_at TEXT,
  exit_code INTEGER,
  status_detail TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (created_by_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_instances_workspace_id
  ON terminal_instances(workspace_id);
CREATE INDEX IF NOT EXISTS idx_terminal_instances_last_active_at
  ON terminal_instances(last_active_at DESC);

CREATE TABLE IF NOT EXISTS terminal_runtime_sessions (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  runtime_type TEXT NOT NULL CHECK (
    runtime_type IN ('embedded-pty', 'tmux', 'conpty-powershell', 'conpty-cmd', 'conpty-git-bash')
  ),
  session_key TEXT NOT NULL,
  attach_target TEXT NOT NULL,
  host_instance_id TEXT,
  agent_pid INTEGER,
  shell_pid INTEGER,
  state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'lost', 'closed', 'error')),
  last_heartbeat_at TEXT,
  last_checked_at TEXT,
  last_error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (terminal_id) REFERENCES terminal_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_runtime_sessions_terminal_id
  ON terminal_runtime_sessions(terminal_id);
CREATE INDEX IF NOT EXISTS idx_terminal_runtime_sessions_state
  ON terminal_runtime_sessions(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS terminal_log_files (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'sealed', 'deleting')),
  start_seq INTEGER NOT NULL,
  end_seq INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (terminal_id) REFERENCES terminal_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terminal_log_files_terminal_id
  ON terminal_log_files(terminal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_log_files_terminal_status
  ON terminal_log_files(terminal_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS terminal_log_segments (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (terminal_id) REFERENCES terminal_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES terminal_log_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terminal_log_segments_terminal_id_start_seq
  ON terminal_log_segments(terminal_id, start_seq DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_log_segments_file_id
  ON terminal_log_segments(file_id, start_offset ASC);

CREATE TABLE IF NOT EXISTS terminal_command_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL,
  env_json TEXT NOT NULL,
  port INTEGER,
  runtime_type TEXT CHECK (
    runtime_type IS NULL OR runtime_type IN (
      'embedded-pty',
      'tmux',
      'conpty-powershell',
      'conpty-cmd',
      'conpty-git-bash'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_terminal_templates_workspace_id
  ON terminal_command_templates(workspace_id);

INSERT INTO bootstrap_state (id, initialized)
VALUES ('default', 0)
ON CONFLICT(id) DO NOTHING;
