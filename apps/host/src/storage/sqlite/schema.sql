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

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  username TEXT PRIMARY KEY,
  failed_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  captcha_id TEXT,
  captcha_code_hash TEXT,
  captcha_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_updated_at
  ON auth_login_attempts(updated_at DESC);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  repo_root TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_navigation_states (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  background_color TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_navigation_states_user_id
  ON workspace_navigation_states(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_worktrees (
  workspace_id TEXT PRIMARY KEY,
  root_workspace_id TEXT NOT NULL,
  parent_workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  merge_target_workspace_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  head_commit TEXT,
  display_name TEXT NOT NULL,
  depth INTEGER NOT NULL CHECK (depth >= 1),
  lifecycle_status TEXT NOT NULL CHECK (
    lifecycle_status IN ('active', 'merged', 'abandoned', 'removing', 'removed')
  ),
  merged_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (root_workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (parent_workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (source_workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (merge_target_workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_worktrees_root_workspace_id
  ON workspace_worktrees(root_workspace_id, depth ASC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_worktrees_parent_workspace_id
  ON workspace_worktrees(parent_workspace_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_worktrees_root_branch_name
  ON workspace_worktrees(root_workspace_id, branch_name);

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
  session_kind TEXT NOT NULL DEFAULT 'default' CHECK (session_kind IN ('default', 'annotation')),
  annotation_source_message_id TEXT,
  annotation_source_text TEXT,
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

CREATE TABLE IF NOT EXISTS session_forks (
  session_id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  fork_source_type TEXT NOT NULL CHECK (fork_source_type IN ('session', 'message')),
  fork_source_session_id TEXT NOT NULL,
  fork_source_message_id TEXT,
  inherited_prefix_message_count INTEGER NOT NULL DEFAULT 0,
  provider_parent_session_id TEXT,
  provider_source_message_id TEXT,
  fork_method TEXT NOT NULL CHECK (
    fork_method IN (
      'native_session_fork',
      'native_message_fork',
      'reconstructed_session_fork',
      'reconstructed_message_fork'
    )
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_forks_parent_session_id
  ON session_forks(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_session_forks_source_message_id
  ON session_forks(fork_source_message_id);

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
  kind TEXT NOT NULL CHECK (kind IN ('image', 'file')),
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

CREATE TABLE IF NOT EXISTS session_message_origins (
  session_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  message_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('butler_proxy', 'system')),
  origin_ref TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, client_request_id),
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_message_origins_message
  ON session_message_origins(session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_session_message_origins_origin
  ON session_message_origins(session_id, origin, updated_at DESC);

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

CREATE TABLE IF NOT EXISTS user_quick_phrase_preferences (
  user_id TEXT PRIMARY KEY,
  phrases_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS user_preference_profiles (
  user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en-US')),
  theme TEXT NOT NULL CHECK (theme IN ('light', 'dark', 'sky-blue', 'eye-green')),
  auto_theme INTEGER NOT NULL DEFAULT 0 CHECK (auto_theme IN (0, 1)),
  default_permission_mode TEXT NOT NULL CHECK (
    default_permission_mode IN ('default', 'acceptEdits', 'bypassPermissions')
  ),
  providers_json TEXT NOT NULL,
  debug_port_pools_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS git_remote_credentials (
  user_id TEXT NOT NULL,
  remote_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('basic', 'token')),
  username_ciphertext TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, remote_url),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_git_remote_credentials_user_updated_at
  ON git_remote_credentials(user_id, updated_at DESC);

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
  debug_runtime_session_id TEXT,
  debug_target_id TEXT,
  debug_service_id TEXT,
  framework_analysis_id TEXT,
  launcher_source_type TEXT CHECK (
    launcher_source_type IS NULL OR launcher_source_type IN ('manual', 'debug_service')
  ),
  launch_stage TEXT,
  failure_stage TEXT,
  adapter_kind TEXT CHECK (
    adapter_kind IS NULL OR adapter_kind IN ('cli', 'env', 'override', 'ai_fallback')
  ),
  env_patch_summary_json TEXT,
  artifact_ref TEXT,
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
  proxy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (proxy_enabled IN (0, 1)),
  proxy_slug TEXT,
  runtime_type TEXT CHECK (
    runtime_type IS NULL OR runtime_type IN (
      'embedded-pty',
      'tmux',
      'conpty-powershell',
      'conpty-cmd',
      'conpty-git-bash'
    )
  ),
  source_type TEXT CHECK (
    source_type IS NULL OR source_type IN ('manual', 'debug_service')
  ),
  debug_target_id TEXT,
  debug_service_id TEXT,
  framework_analysis_id TEXT,
  adapter_kind TEXT CHECK (
    adapter_kind IS NULL OR adapter_kind IN ('cli', 'env', 'override', 'ai_fallback')
  ),
  injection_mode TEXT CHECK (
    injection_mode IS NULL OR injection_mode IN ('cli', 'env', 'override', 'none')
  ),
  generated_artifact_ref TEXT,
  service_discovery_mode TEXT CHECK (
    service_discovery_mode IS NULL OR service_discovery_mode IN ('same_origin', 'api_base_url', 'none')
  ),
  managed_by_system INTEGER NOT NULL DEFAULT 0 CHECK (managed_by_system IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_terminal_templates_workspace_id
  ON terminal_command_templates(workspace_id);

CREATE TABLE IF NOT EXISTS debug_targets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  stack_hint TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('repo', 'worktree')),
  root_workspace_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (root_workspace_id) REFERENCES workspaces(id),
  UNIQUE (workspace_id, root_path)
);

CREATE INDEX IF NOT EXISTS idx_debug_targets_workspace_id
  ON debug_targets(workspace_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS debug_services (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('frontend', 'backend', 'worker', 'mock', 'custom')),
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL,
  env_json TEXT NOT NULL,
  default_port_hint INTEGER,
  protocol TEXT CHECK (protocol IS NULL OR protocol IN ('http', 'ws', 'tcp')),
  health_path TEXT,
  adapter_kind TEXT CHECK (
    adapter_kind IS NULL OR adapter_kind IN ('cli', 'env', 'override', 'ai_fallback')
  ),
  framework_analysis_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_id) REFERENCES debug_targets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_debug_services_target_id
  ON debug_services(target_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS framework_analysis_results (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  service_id TEXT,
  primary_framework TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  compatibility_level TEXT NOT NULL CHECK (
    compatibility_level IN ('supported', 'conditional', 'unsupported', 'unknown')
  ),
  recommended_injection_mode TEXT CHECK (
    recommended_injection_mode IS NULL OR recommended_injection_mode IN ('cli', 'env', 'override', 'none')
  ),
  requires_service_discovery_handling INTEGER NOT NULL CHECK (
    requires_service_discovery_handling IN (0, 1)
  ),
  requires_hmr_handling INTEGER NOT NULL CHECK (requires_hmr_handling IN (0, 1)),
  requires_callback_handling INTEGER NOT NULL CHECK (requires_callback_handling IN (0, 1)),
  ai_fallback_policy TEXT NOT NULL CHECK (ai_fallback_policy IN ('never', 'conditional', 'allowed')),
  reasons_json TEXT NOT NULL,
  detected_files_json TEXT NOT NULL DEFAULT '[]',
  raw_evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (target_id) REFERENCES debug_targets(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES debug_services(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_framework_analysis_results_target_id
  ON framework_analysis_results(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_framework_analysis_results_service_id
  ON framework_analysis_results(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS debug_runtime_sessions (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREPARING', 'RUNNING', 'FAILED', 'STOPPED')),
  failure_stage TEXT,
  started_at TEXT,
  stopped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_id) REFERENCES debug_targets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_debug_runtime_sessions_target_id
  ON debug_runtime_sessions(target_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS port_leases (
  id TEXT PRIMARY KEY,
  runtime_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('tcp', 'udp')),
  status TEXT NOT NULL CHECK (status IN ('LEASED', 'RELEASING', 'RELEASED', 'STALE')),
  leased_at TEXT NOT NULL,
  expires_at TEXT,
  released_at TEXT,
  FOREIGN KEY (runtime_id) REFERENCES debug_runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES debug_services(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_port_leases_runtime_id
  ON port_leases(runtime_id, leased_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_port_leases_active_port
  ON port_leases(port, protocol)
  WHERE status IN ('LEASED', 'RELEASING');

CREATE TABLE IF NOT EXISTS runtime_bindings (
  id TEXT PRIMARY KEY,
  runtime_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  process_instance_id TEXT,
  expected_port INTEGER,
  leased_port INTEGER,
  observed_port INTEGER,
  proxy_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('ALLOCATED', 'LISTENING', 'FAILED', 'RELEASED')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (runtime_id) REFERENCES debug_runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES debug_services(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_bindings_runtime_id
  ON runtime_bindings(runtime_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_fallback_edits (
  id TEXT PRIMARY KEY,
  runtime_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  allowed_files_json TEXT NOT NULL,
  target_port INTEGER NOT NULL,
  patch_ref TEXT,
  rollback_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPLIED', 'ROLLED_BACK', 'REJECTED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (runtime_id) REFERENCES debug_runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES debug_services(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_fallback_edits_runtime_id
  ON ai_fallback_edits(runtime_id, created_at DESC);

CREATE TABLE IF NOT EXISTS butler_profiles (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  display_name TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex', 'claude-code')),
  workspace_path TEXT NOT NULL,
  agents_mode TEXT NOT NULL CHECK (agents_mode IN ('inline', 'file')),
  agents_file_path TEXT,
  agents_content TEXT NOT NULL,
  persona_json TEXT NOT NULL,
  focus_json TEXT NOT NULL,
  initialized_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS butler_control_sessions (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex', 'claude-code')),
  session_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'chat' CHECK (purpose IN ('chat', 'todo_analysis')),
  title TEXT,
  source_item_id TEXT,
  model TEXT,
  reasoning_level TEXT,
  permission_mode TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'failed', 'closed')),
  last_context_version TEXT,
  last_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_butler_control_sessions_provider
  ON butler_control_sessions(provider_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS butler_control_timers (
  id TEXT PRIMARY KEY,
  control_session_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  target_session_id TEXT,
  title TEXT,
  content TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  triggered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_butler_control_timers_status_due_at
  ON butler_control_timers(status, due_at ASC, updated_at ASC);
CREATE INDEX IF NOT EXISTS idx_butler_control_timers_session
  ON butler_control_timers(control_session_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_automation_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  control_session_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('once', 'interval', 'cron', 'condition')),
  trigger_config_json TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('send_control_message')),
  action_config_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'failed')),
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_summary TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assistant_automation_tasks_status_next_run_at
  ON assistant_automation_tasks(status, next_run_at ASC, updated_at ASC);
CREATE INDEX IF NOT EXISTS idx_assistant_automation_tasks_session
  ON assistant_automation_tasks(control_session_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  run_seq INTEGER NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('once', 'interval', 'cron', 'condition')),
  trigger_snapshot_json TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('send_control_message')),
  action_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')),
  summary TEXT,
  error TEXT,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (automation_id) REFERENCES assistant_automation_tasks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_automation_runs_seq
  ON assistant_automation_runs(automation_id, run_seq);
CREATE INDEX IF NOT EXISTS idx_assistant_automation_runs_created_at
  ON assistant_automation_runs(automation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_sandboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  control_session_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('blank', 'clone')),
  source_ref TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('assistant_only', 'pinned')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'expired', 'deleted')),
  purpose TEXT,
  expires_at TEXT,
  promoted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_sandboxes_user_status
  ON assistant_sandboxes(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_sandboxes_workspace
  ON assistant_sandboxes(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_control_events (
  id TEXT PRIMARY KEY,
  control_session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('action')),
  action_type TEXT NOT NULL CHECK (
    action_type IN ('open-project', 'resume-session', 'start-patrol', 'start-verification')
  ),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  related_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_butler_control_events_session_created_at
  ON butler_control_events(control_session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS butler_inbox_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('bug', 'feature', 'change', 'task')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'closed')),
  assistant_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_butler_inbox_items_project_updated_at
  ON butler_inbox_items(project_id, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_inbox_items_status_updated_at
  ON butler_inbox_items(status, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS butler_notification_archives (
  user_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_butler_notification_archives_user_updated_at
  ON butler_notification_archives(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  default_provider TEXT,
  instruction_profile_id TEXT,
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('readonly', 'controlled', 'auto')),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('active', 'paused', 'archived')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  config_json TEXT NOT NULL,
  last_patrol_at TEXT,
  last_verification_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (workspace_id, repo_root)
);

CREATE INDEX IF NOT EXISTS idx_butler_projects_workspace_id
  ON butler_projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_butler_projects_status
  ON butler_projects(lifecycle_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('patrol', 'execution', 'verification', 'adhoc')),
  ownership_mode TEXT NOT NULL CHECK (ownership_mode IN ('managed', 'observed')),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'blocked', 'failed', 'closed')),
  last_summary TEXT,
  last_checkpoint_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_butler_sessions_project_id
  ON butler_sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_sessions_status
  ON butler_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_follow_up_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  butler_session_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  completion_criteria TEXT NOT NULL DEFAULT '',
  max_auto_continue_count INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL CHECK (
    status IN ('active', 'waiting_user', 'completed', 'failed', 'cancelled')
  ),
  check_interval_seconds INTEGER NOT NULL,
  last_checked_at TEXT,
  next_check_at TEXT,
  last_observed_running_state TEXT,
  last_observed_message_at TEXT,
  last_observed_message_count INTEGER NOT NULL DEFAULT 0,
  last_automation_summary TEXT,
  last_automation_at TEXT,
  auto_continue_count INTEGER NOT NULL DEFAULT 0,
  waiting_reason TEXT,
  rounds_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (butler_session_id) REFERENCES butler_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_butler_follow_up_tasks_status
  ON butler_follow_up_tasks(status, next_check_at ASC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_follow_up_tasks_session
  ON butler_follow_up_tasks(butler_session_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_session_summary_states (
  butler_session_id TEXT PRIMARY KEY,
  source_message_count INTEGER NOT NULL DEFAULT 0,
  source_last_message_at TEXT,
  last_summarized_at TEXT,
  last_summarized_sequence INTEGER,
  debounce_until TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle', 'scheduled', 'running', 'failed')),
  error_detail TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (butler_session_id) REFERENCES butler_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_butler_session_summary_states_status
  ON butler_session_summary_states(status, debounce_until ASC, updated_at ASC);

CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  butler_session_id TEXT NOT NULL,
  checkpoint_seq INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('snapshot', 'summary', 'verification', 'manual')
  ),
  progress_state TEXT NOT NULL CHECK (
    progress_state IN ('unknown', 'working', 'blocked', 'done')
  ),
  summary TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  next_action_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (butler_session_id) REFERENCES butler_sessions(id) ON DELETE CASCADE,
  UNIQUE (butler_session_id, checkpoint_seq)
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id
  ON session_checkpoints(butler_session_id, checkpoint_seq DESC);
CREATE INDEX IF NOT EXISTS idx_session_checkpoints_captured_at
  ON session_checkpoints(captured_at DESC);

CREATE TABLE IF NOT EXISTS project_memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_butler_session_id TEXT,
  source_checkpoint_id TEXT,
  memory_type TEXT NOT NULL CHECK (
    memory_type IN ('arch', 'rule', 'decision', 'incident', 'verify', 'note')
  ),
  title TEXT NOT NULL,
  scope_path TEXT,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (
    status IN ('candidate', 'active', 'superseded', 'archived')
  ),
  evidence_json TEXT NOT NULL,
  superseded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_butler_session_id) REFERENCES butler_sessions(id),
  FOREIGN KEY (source_checkpoint_id) REFERENCES session_checkpoints(id)
);

CREATE INDEX IF NOT EXISTS idx_project_memories_project_id
  ON project_memories(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_memories_project_status
  ON project_memories(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_memories_project_scope
  ON project_memories(project_id, scope_path, updated_at DESC);

CREATE TABLE IF NOT EXISTS patrol_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'interval', 'cron')),
  trigger_config_json TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('readonly', 'controlled')),
  patrol_scope_json TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  last_scheduled_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patrol_plans_project_id
  ON patrol_plans(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_plans_enabled_next_run_at
  ON patrol_plans(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS patrol_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_id TEXT,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('scheduler', 'user', 'system')),
  trigger_ref TEXT,
  butler_session_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  summary TEXT,
  risk_level TEXT CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high')),
  suggestions_json TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES patrol_plans(id),
  FOREIGN KEY (butler_session_id) REFERENCES butler_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_patrol_runs_project_started_at
  ON patrol_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_runs_project_status
  ON patrol_runs(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS verification_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  butler_session_id TEXT,
  source_patrol_run_id TEXT,
  verification_type TEXT NOT NULL CHECK (
    verification_type IN ('test', 'health', 'browser', 'visual', 'metric')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'passed', 'failed', 'skipped', 'cancelled')
  ),
  target_ref TEXT,
  spec_json TEXT NOT NULL,
  artifact_refs_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  summary TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (butler_session_id) REFERENCES butler_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_verification_runs_project_created_at
  ON verification_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_runs_project_status
  ON verification_runs(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS instance_tailscale_config (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  control_server_url TEXT,
  hostname TEXT,
  state_dir TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_tailscale_status (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  phase TEXT NOT NULL CHECK (
    phase IN (
      'disabled',
      'blocked_uninitialized',
      'starting',
      'needs_login',
      'running',
      'stopping',
      'error'
    )
  ),
  connected INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
  login_url TEXT,
  control_server_url TEXT,
  hostname TEXT,
  account_name TEXT,
  tailnet_fqdn TEXT,
  tailnet_ipv4 TEXT,
  tailnet_ipv6 TEXT,
  reachable_base_url TEXT,
  last_error TEXT,
  observed_at TEXT
);

CREATE TABLE IF NOT EXISTS managed_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory_name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('builtin', 'local-import', 'managed-copy')),
  source_path TEXT,
  content_hash TEXT NOT NULL,
  managed_state TEXT NOT NULL CHECK (managed_state IN ('active', 'conflicted', 'missing')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_skills_state
  ON managed_skills(managed_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS skill_target_bindings (
  skill_id TEXT NOT NULL,
  target_cli TEXT NOT NULL CHECK (target_cli IN ('codex', 'claude-code', 'gemini', 'opencode')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('synced', 'pending', 'failed', 'conflicted')),
  last_synced_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  PRIMARY KEY (skill_id, target_cli),
  FOREIGN KEY (skill_id) REFERENCES managed_skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skill_target_bindings_target_cli
  ON skill_target_bindings(target_cli, sync_status, enabled);

INSERT INTO bootstrap_state (id, initialized)
VALUES ('default', 0)
ON CONFLICT(id) DO NOTHING;
