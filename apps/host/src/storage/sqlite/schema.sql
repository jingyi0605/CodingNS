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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  token_hash TEXT NOT NULL UNIQUE,
  device_session_id TEXT,
  caller_kind TEXT CHECK (caller_kind IN ('interactive_user', 'assistant_runtime', 'workspace_session')),
  capability_profile TEXT,
  workspace_id TEXT,
  project_id TEXT,
  session_id TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_device_session_id ON auth_tokens(device_session_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_workspace_id ON auth_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_session_id ON auth_tokens(session_id);

CREATE TABLE IF NOT EXISTS auth_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK (client_type IN ('desktop', 'web', 'ios', 'android', 'unknown')),
  client_instance_id TEXT,
  display_name TEXT,
  user_agent TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  last_source_address TEXT,
  last_seen_at TEXT NOT NULL,
  primary_set_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_devices_user_id ON auth_devices(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_devices_client_lookup
  ON auth_devices(user_id, client_type, client_instance_id);

CREATE TABLE IF NOT EXISTS auth_device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  access_token_id TEXT,
  refresh_token_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  FOREIGN KEY (device_id) REFERENCES auth_devices(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_device_sessions_user_id
  ON auth_device_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_device_sessions_device_id
  ON auth_device_sessions(device_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS auth_login_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  client_type TEXT NOT NULL CHECK (client_type IN ('desktop', 'web', 'ios', 'android', 'unknown')),
  source_address TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  FOREIGN KEY (device_id) REFERENCES auth_devices(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_login_events_user_id
  ON auth_login_events(user_id, occurred_at DESC);

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


CREATE TABLE IF NOT EXISTS peer_hosts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alias TEXT,
  tag_color TEXT,
  base_url TEXT NOT NULL,
  normalized_base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'reachable', 'unreachable', 'version_mismatch', 'unauthorized')),
  remote_version TEXT,
  remote_api_compatibility TEXT,
  remote_host_fingerprint TEXT,
  last_checked_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES auth_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_hosts_owner_base_url_active
  ON peer_hosts(owner_user_id, normalized_base_url)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_peer_hosts_owner_status
  ON peer_hosts(owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS peer_host_workspace_bindings (
  owner_user_id TEXT NOT NULL,
  active_host_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  selected_host_id TEXT NOT NULL,
  remote_workspace_id TEXT,
  remote_workspace_path TEXT,
  remote_workspace_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, active_host_id, workspace_key),
  FOREIGN KEY (owner_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_peer_host_workspace_bindings_owner_updated_at
  ON peer_host_workspace_bindings(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS peer_host_sessions (
  peer_host_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TEXT,
  remote_user_id TEXT NOT NULL,
  remote_username TEXT NOT NULL,
  remote_host_fingerprint TEXT,
  saved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (peer_host_id, owner_user_id),
  FOREIGN KEY (peer_host_id) REFERENCES peer_hosts(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_peer_host_sessions_owner_updated_at
  ON peer_host_sessions(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  repo_root TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id
  ON workspaces(owner_user_id, removed_at, sort_order);

CREATE TABLE IF NOT EXISTS workspace_navigation_states (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  background_color TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  shortcut_apps_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (shortcut_apps_collapsed IN (0, 1)),
  shortcut_apps_side TEXT NOT NULL DEFAULT 'left' CHECK (shortcut_apps_side IN ('left', 'right')),
  affairs_library_root_path TEXT,
  affairs_library_enabled INTEGER NOT NULL DEFAULT 0 CHECK (affairs_library_enabled IN (0, 1)),
  affairs_library_favorites_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_navigation_states_user_id
  ON workspace_navigation_states(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS office_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('browser', 'document', 'ops', 'workflow')),
  title TEXT NOT NULL,
  description TEXT,
  connector_id TEXT NOT NULL,
  target_ref_kind TEXT,
  target_ref_id TEXT,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'pending_approval', 'ready', 'running', 'paused', 'waiting_external', 'succeeded', 'failed', 'cancelled', 'rolled_back')
  ),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  approval_policy_id TEXT,
  current_step_id TEXT,
  idempotency_key TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_office_tasks_user_id ON office_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_office_tasks_workspace_id ON office_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_office_tasks_status ON office_tasks(status);
CREATE INDEX IF NOT EXISTS idx_office_tasks_task_type ON office_tasks(task_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_tasks_user_idempotency_key_active
  ON office_tasks(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('draft', 'pending_approval', 'ready', 'running', 'paused', 'waiting_external');

CREATE TABLE IF NOT EXISTS office_task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_seq INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  title TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'waiting_approval', 'waiting_external', 'succeeded', 'failed', 'cancelled', 'skipped')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_office_task_steps_task_seq
  ON office_task_steps(task_id, step_seq);
CREATE INDEX IF NOT EXISTS idx_office_task_steps_task_id ON office_task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_office_task_steps_status ON office_task_steps(status);

CREATE TABLE IF NOT EXISTS office_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  kind TEXT NOT NULL CHECK (
    kind IN ('screenshot', 'ocr_result', 'document_export', 'command_log', 'downloaded_file', 'dom_snapshot', 'approval_record', 'custom')
  ),
  name TEXT NOT NULL,
  storage_path TEXT,
  content_type TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES office_task_steps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_office_artifacts_task_id ON office_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_office_artifacts_step_id ON office_artifacts(step_id);
CREATE INDEX IF NOT EXISTS idx_office_artifacts_kind ON office_artifacts(kind);

CREATE TABLE IF NOT EXISTS office_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  policy_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  approver_user_id TEXT,
  decision_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES office_task_steps(id) ON DELETE SET NULL,
  FOREIGN KEY (approver_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_office_approvals_task_id ON office_approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_office_approvals_status ON office_approvals(status);

CREATE TABLE IF NOT EXISTS office_receipts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  receipt_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES office_task_steps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_office_receipts_task_id ON office_receipts(task_id);
CREATE INDEX IF NOT EXISTS idx_office_receipts_step_id ON office_receipts(step_id);

CREATE TABLE IF NOT EXISTS plugin_definitions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  install_root TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  has_frontend INTEGER NOT NULL DEFAULT 0 CHECK (has_frontend IN (0, 1)),
  has_backend INTEGER NOT NULL DEFAULT 0 CHECK (has_backend IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugin_definitions_name ON plugin_definitions(name);
CREATE INDEX IF NOT EXISTS idx_plugin_definitions_updated_at ON plugin_definitions(updated_at DESC);

CREATE TABLE IF NOT EXISTS plugin_enablements (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_by_user_id TEXT,
  enabled_at TEXT,
  disabled_by_user_id TEXT,
  disabled_at TEXT,
  reason TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plugin_id) REFERENCES plugin_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (enabled_by_user_id) REFERENCES auth_users(id),
  FOREIGN KEY (disabled_by_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_enablements_enabled ON plugin_enablements(enabled);

CREATE TABLE IF NOT EXISTS plugin_runtime_sessions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  opened_by_user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('frontend', 'assistant', 'cli')),
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (plugin_id) REFERENCES plugin_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (opened_by_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_runtime_sessions_plugin_id
  ON plugin_runtime_sessions(plugin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plugin_runtime_sessions_workspace_id
  ON plugin_runtime_sessions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plugin_runtime_sessions_status
  ON plugin_runtime_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plugin_permission_grants (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  permission_key TEXT NOT NULL CHECK (
    permission_key IN (
      'workspace.read_file',
      'workspace.list_dir',
      'workspace.write_file',
      'desktop.open_file',
      'desktop.reveal_in_file_manager'
    )
  ),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'directory', 'file')),
  scope_path TEXT,
  grant_mode TEXT NOT NULL CHECK (grant_mode IN ('once', 'session', 'persistent')),
  granted_by_user_id TEXT NOT NULL,
  runtime_session_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (plugin_id) REFERENCES plugin_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (granted_by_user_id) REFERENCES auth_users(id),
  FOREIGN KEY (runtime_session_id) REFERENCES plugin_runtime_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_permission_grants_plugin_workspace
  ON plugin_permission_grants(plugin_id, workspace_id, permission_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plugin_permission_grants_runtime_session
  ON plugin_permission_grants(runtime_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plugin_permission_grants_active
  ON plugin_permission_grants(plugin_id, workspace_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS plugin_audit_events (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  workspace_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'plugin.registered',
      'plugin.registration_failed',
      'plugin.enabled',
      'plugin.disabled',
      'plugin.permission_granted',
      'plugin.permission_revoked',
      'plugin.permission_denied',
      'plugin.action_invoked',
      'plugin.action_rejected',
      'plugin.schedule_triggered',
      'plugin.schedule_retry_scheduled',
      'plugin.schedule_skipped',
      'plugin.frontend_loaded',
      'plugin.scope_rejected',
      'plugin.desktop_call'
    )
  ),
  actor_user_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (actor_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_events_plugin_id ON plugin_audit_events(plugin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_runs (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  runtime_session_id TEXT,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('frontend', 'cli', 'schedule', 'assistant')),
  action_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'rejected', 'cancelled')),
  input_summary_json TEXT,
  output_summary_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (runtime_session_id) REFERENCES plugin_runtime_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_runs_plugin_id ON plugin_runs(plugin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('doct')),
  template_version TEXT NOT NULL,
  template_source_path TEXT,
  schema_json TEXT NOT NULL,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  output_formats_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_templates_key_version
  ON document_templates(template_key, template_version);
CREATE INDEX IF NOT EXISTS idx_document_templates_template_key
  ON document_templates(template_key);
CREATE INDEX IF NOT EXISTS idx_document_templates_status
  ON document_templates(status);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL,
  template_id TEXT NOT NULL,
  current_revision_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'reviewing', 'published', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (template_id) REFERENCES document_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS document_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision_seq INTEGER NOT NULL,
  base_revision_id TEXT,
  content_json TEXT NOT NULL,
  outline_json TEXT,
  summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (base_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES auth_users(id),
  UNIQUE (document_id, revision_seq)
);

CREATE INDEX IF NOT EXISTS idx_document_revisions_document_id
  ON document_revisions(document_id);

CREATE TABLE IF NOT EXISTS document_comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision_id TEXT,
  anchor_type TEXT NOT NULL,
  anchor_key TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'archived')),
  created_by TEXT NOT NULL,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES auth_users(id),
  FOREIGN KEY (resolved_by) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_document_comments_document_id
  ON document_comments(document_id);
CREATE INDEX IF NOT EXISTS idx_document_comments_status
  ON document_comments(status);


CREATE TABLE IF NOT EXISTS office_connectors (
  id TEXT PRIMARY KEY,
  connector_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('browser', 'document', 'ops', 'external')),
  display_name TEXT NOT NULL,
  capability_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_office_connectors_kind ON office_connectors(kind);
CREATE INDEX IF NOT EXISTS idx_office_connectors_status ON office_connectors(status);

CREATE TABLE IF NOT EXISTS office_audit_events (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  step_id TEXT,
  event_kind TEXT NOT NULL CHECK (
    event_kind IN ('task_created', 'task_updated', 'task_started', 'task_finished', 'task_cancelled', 'task_approved', 'task_rejected', 'task_rolled_back', 'artifact_created', 'external_action', 'permission_denied')
  ),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'system', 'assistant', 'connector')),
  actor_id TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (step_id) REFERENCES office_task_steps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_office_audit_events_task_id ON office_audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_office_audit_events_step_id ON office_audit_events(step_id);
CREATE INDEX IF NOT EXISTS idx_office_audit_events_event_kind ON office_audit_events(event_kind);

CREATE TABLE IF NOT EXISTS office_rollback_records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  reason TEXT NOT NULL,
  compensation_json TEXT,
  summary TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES office_task_steps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_office_rollback_records_task_id ON office_rollback_records(task_id);
CREATE INDEX IF NOT EXISTS idx_office_rollback_records_step_id ON office_rollback_records(step_id);

CREATE TABLE IF NOT EXISTS office_onlyoffice_settings (
  singleton_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  server_url TEXT,
  public_base_url TEXT,
  callback_base_url TEXT,
  user_display_name TEXT,
  user_avatar_url TEXT,
  jwt_secret TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
  user_id TEXT,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  raw_store_ref TEXT NOT NULL,
  provider_config_mode TEXT NOT NULL DEFAULT 'global-default' CHECK (
    provider_config_mode IN ('global-default', 'cc-switch-preset')
  ),
  provider_preset_id TEXT,
  runtime_home_dir TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_bindings_workspace_id ON session_bindings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_session_bindings_user_id ON session_bindings(user_id, workspace_id);

CREATE TABLE IF NOT EXISTS session_indices (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (
    session_visibility IN ('workspace', 'affairs_lightweight')
  ),
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

CREATE TABLE IF NOT EXISTS parallel_session_groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('fork', 'new')),
  source_session_id TEXT,
  source_message_id TEXT,
  shared_prompt TEXT,
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 2 AND 4),
  anchor_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleting', 'deleted')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (created_by_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_parallel_session_groups_workspace_id
  ON parallel_session_groups(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_parallel_session_groups_anchor_session_id
  ON parallel_session_groups(anchor_session_id);

CREATE TABLE IF NOT EXISTS parallel_session_members (
  group_id TEXT NOT NULL,
  session_id TEXT NOT NULL PRIMARY KEY,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  role TEXT NOT NULL CHECK (role IN ('anchor', 'member')),
  provider TEXT NOT NULL,
  model TEXT,
  member_prompt TEXT,
  workspace_isolation_mode TEXT NOT NULL CHECK (
    workspace_isolation_mode IN ('none', 'temporary_worktree')
  ),
  temporary_workspace_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (group_id) REFERENCES parallel_session_groups(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parallel_session_members_group_ordinal
  ON parallel_session_members(group_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_parallel_session_members_group_id
  ON parallel_session_members(group_id, deleted_at, ordinal ASC);

CREATE TABLE IF NOT EXISTS session_isolated_workspaces (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  owner_session_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  head_commit TEXT,
  lifecycle_status TEXT NOT NULL CHECK (
    lifecycle_status IN ('active', 'promoted', 'removing', 'removed')
  ),
  promoted_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES parallel_session_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (source_workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_session_isolated_workspaces_group_id
  ON session_isolated_workspaces(group_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_isolated_workspaces_workspace_id
  ON session_isolated_workspaces(workspace_id, lifecycle_status, updated_at DESC);

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

CREATE TABLE IF NOT EXISTS session_source_index (
  source_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('jsonl', 'sqlite_row', 'server_session', 'index_entry')),
  workspace_id TEXT,
  provider_session_id TEXT,
  raw_store_ref TEXT,
  workspace_path TEXT,
  fingerprint_mtime_ms INTEGER,
  fingerprint_size_bytes INTEGER,
  fingerprint_inode TEXT,
  fingerprint_version TEXT,
  title TEXT,
  message_count INTEGER,
  last_message_at TEXT,
  is_archived_hint INTEGER CHECK (is_archived_hint IN (0, 1)),
  last_parsed_at TEXT,
  last_verified_at TEXT,
  sample_due_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_session_source_index_workspace_id
  ON session_source_index(workspace_id, provider, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_source_index_provider_session_id
  ON session_source_index(provider, provider_session_id);
CREATE INDEX IF NOT EXISTS idx_session_source_index_workspace_path
  ON session_source_index(workspace_path, provider, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_discovery_diagnostics (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  provider TEXT NOT NULL,
  is_complete INTEGER NOT NULL CHECK (is_complete IN (0, 1)),
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  session_count INTEGER NOT NULL,
  scanned_files INTEGER NOT NULL,
  skipped_by_fingerprint INTEGER NOT NULL,
  parsed_files INTEGER NOT NULL,
  bytes_read INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_session_discovery_diagnostics_workspace_id
  ON session_discovery_diagnostics(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_discovery_diagnostics_provider
  ON session_discovery_diagnostics(provider, created_at DESC);

CREATE TABLE IF NOT EXISTS session_cleanup_scans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_filter_json TEXT NOT NULL,
  time_range_start TEXT,
  time_range_end TEXT,
  candidate_count INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_session_cleanup_scans_user_id
  ON session_cleanup_scans(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_cleanup_archives (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  session_count INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_session_cleanup_archives_user_id
  ON session_cleanup_archives(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_cleanup_operation_items (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  task_kind TEXT NOT NULL CHECK (task_kind IN ('scan', 'backup', 'restore', 'delete')),
  candidate_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT,
  provider_session_id TEXT,
  raw_store_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped', 'conflict')),
  backup_status TEXT,
  provider_delete_status TEXT,
  local_delete_status TEXT,
  restore_status TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_cleanup_operation_items_operation_id
  ON session_cleanup_operation_items(operation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_session_cleanup_operation_items_provider
  ON session_cleanup_operation_items(provider, created_at DESC);

CREATE TABLE IF NOT EXISTS affairs_assistant_session_snapshots (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  project_workspace_id TEXT,
  agent_workspace_path TEXT,
  sessions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_affairs_assistant_session_snapshots_user_id
  ON affairs_assistant_session_snapshots(user_id, updated_at DESC);

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
  affairs_dashboard_states_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS user_affairs_library_settings (
  user_id TEXT PRIMARY KEY,
  root_dir TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  favorites_json TEXT,
  last_workspace_id TEXT,
  dashboard_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS user_teable_global_settings (
  user_id TEXT PRIMARY KEY,
  base_url TEXT,
  space_id TEXT,
  base_id TEXT,
  auth_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  mirror_mode TEXT NOT NULL DEFAULT 'manual' CHECK (mirror_mode IN ('manual', 'scheduled', 'event_driven')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE TABLE IF NOT EXISTS user_teable_credentials (
  user_id TEXT NOT NULL,
  auth_ref TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, auth_ref),
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_credentials_user_updated_at
  ON user_teable_credentials(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_teable_workbench_sync_configs (
  config_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('tags', 'sessions', 'todos')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  scope_json TEXT NOT NULL,
  target_table_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  UNIQUE (user_id, source_type)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_workbench_sync_configs_user
  ON user_teable_workbench_sync_configs(user_id, source_type);

CREATE TABLE IF NOT EXISTS user_teable_mirror_table_bindings (
  binding_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mirror_type TEXT NOT NULL CHECK (mirror_type IN ('tags', 'sessions', 'todos')),
  table_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  read_only_mode TEXT NOT NULL CHECK (read_only_mode IN ('role_based', 'matrix_based', 'unknown')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  UNIQUE (user_id, mirror_type)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_mirror_table_bindings_user
  ON user_teable_mirror_table_bindings(user_id, mirror_type);

CREATE TABLE IF NOT EXISTS user_teable_mirror_record_mappings (
  mapping_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mirror_type TEXT NOT NULL CHECK (mirror_type IN ('tags', 'sessions', 'todos')),
  local_id TEXT NOT NULL,
  teable_record_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  UNIQUE (user_id, mirror_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_mirror_record_mappings_user
  ON user_teable_mirror_record_mappings(user_id, mirror_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_teable_form_bindings (
  form_binding_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source_workspace_ids_json TEXT NOT NULL DEFAULT '[]',
  table_id TEXT NOT NULL,
  view_id TEXT NOT NULL,
  name TEXT NOT NULL,
  linked_mirror_types_json TEXT NOT NULL,
  teable_table_id TEXT NOT NULL DEFAULT '',
  teable_view_id TEXT NOT NULL DEFAULT '',
  teable_share_id TEXT,
  teable_form_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  open_mode TEXT NOT NULL DEFAULT 'embed' CHECK (open_mode IN ('embed', 'external')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  inbound_action TEXT NOT NULL CHECK (inbound_action IN ('create_todo', 'append_session_context', 'request_tag_assignment', 'none')),
  open_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_form_bindings_user_workspace
  ON user_teable_form_bindings(user_id, workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_teable_form_bindings_user_enabled
  ON user_teable_form_bindings(user_id, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_teable_field_mappings (
  mapping_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('tags', 'sessions', 'todos')),
  target_table_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  UNIQUE (user_id, config_id)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_field_mappings_user
  ON user_teable_field_mappings(user_id, source_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_teable_inbound_record_mappings (
  mapping_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  form_binding_id TEXT NOT NULL,
  teable_record_id TEXT NOT NULL,
  teable_record_fingerprint TEXT NOT NULL,
  inbound_action TEXT NOT NULL CHECK (inbound_action IN ('create_todo', 'append_session_context', 'request_tag_assignment', 'none')),
  target_local_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('applied', 'skipped', 'failed')),
  error_detail TEXT,
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id),
  UNIQUE (user_id, form_binding_id, teable_record_id)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_inbound_record_mappings_user_form
  ON user_teable_inbound_record_mappings(user_id, form_binding_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_teable_sync_logs (
  log_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'local_change', 'retry')),
  source_types_json TEXT NOT NULL,
  task_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'partial_failed', 'failed')),
  summary TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  error_detail TEXT,
  reason TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_teable_sync_logs_user_created_at
  ON user_teable_sync_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_teable_sync_logs_user_state
  ON user_teable_sync_logs(user_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_control_profiles (
  provider_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_control_profiles_enabled
  ON provider_control_profiles(enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_runtime_states (
  provider_id TEXT PRIMARY KEY,
  install_state TEXT NOT NULL CHECK (install_state IN ('ready', 'missing', 'unknown')),
  version TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_runtime_states_install
  ON provider_runtime_states(install_state, updated_at DESC);

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
  shell TEXT,
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
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex', 'claude-code')),
  workspace_path TEXT NOT NULL,
  agents_mode TEXT NOT NULL CHECK (agents_mode IN ('inline', 'file')),
  agents_file_path TEXT,
  agents_content TEXT NOT NULL,
  persona_json TEXT NOT NULL,
  focus_json TEXT NOT NULL,
  setup_completed INTEGER NOT NULL DEFAULT 1 CHECK (setup_completed IN (0, 1)),
  initialized_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_butler_profiles_user_id
  ON butler_profiles(user_id);

CREATE TABLE IF NOT EXISTS butler_control_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
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
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_butler_control_sessions_provider
  ON butler_control_sessions(user_id, provider_id, updated_at DESC, created_at DESC);

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
  user_id TEXT NOT NULL,
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
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE (user_id, workspace_id, repo_root)
);

CREATE INDEX IF NOT EXISTS idx_butler_projects_user_id
  ON butler_projects(user_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_projects_workspace_id
  ON butler_projects(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_butler_projects_status
  ON butler_projects(user_id, lifecycle_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('patrol', 'execution', 'verification', 'adhoc')),
  ownership_mode TEXT NOT NULL CHECK (ownership_mode IN ('managed', 'observed')),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'blocked', 'failed', 'closed')),
  last_summary TEXT,
  last_checkpoint_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES butler_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
);

CREATE INDEX IF NOT EXISTS idx_butler_sessions_user_id
  ON butler_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_sessions_project_id
  ON butler_sessions(user_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_sessions_status
  ON butler_sessions(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS butler_follow_up_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  butler_session_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex', 'claude-code')),
  assistant_butler_session_id TEXT NOT NULL,
  assistant_session_id TEXT NOT NULL,
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
  FOREIGN KEY (assistant_butler_session_id) REFERENCES butler_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (assistant_session_id) REFERENCES session_bindings(session_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_butler_follow_up_tasks_status
  ON butler_follow_up_tasks(status, next_check_at ASC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_butler_follow_up_tasks_session
  ON butler_follow_up_tasks(butler_session_id, status, updated_at DESC);

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

CREATE TABLE IF NOT EXISTS channel_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform_code TEXT NOT NULL CHECK (
    platform_code IN ('wechat-claw', 'telegram')
  ),
  display_name TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex', 'claude-code')),
  connection_mode TEXT NOT NULL CHECK (connection_mode IN ('webhook', 'polling', 'bridge')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'degraded')),
  config_json TEXT NOT NULL,
  runtime_state_json TEXT NOT NULL,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_user_updated_at
  ON channel_accounts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_platform_status
  ON channel_accounts(platform_code, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS channel_threads (
  id TEXT PRIMARY KEY,
  channel_account_id TEXT NOT NULL,
  external_conversation_key TEXT NOT NULL,
  external_user_id TEXT,
  external_thread_key TEXT,
  control_session_id TEXT,
  session_id TEXT,
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'failed')),
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  last_transport_context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_account_id) REFERENCES channel_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id),
  UNIQUE(channel_account_id, external_conversation_key)
);

CREATE INDEX IF NOT EXISTS idx_channel_threads_account_updated_at
  ON channel_threads(channel_account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_threads_account_status
  ON channel_threads(channel_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_threads_control_session
  ON channel_threads(control_session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS channel_inbound_events (
  id TEXT PRIMARY KEY,
  channel_account_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  external_conversation_key TEXT NOT NULL,
  external_user_id TEXT,
  control_session_id TEXT,
  session_id TEXT,
  text_content TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'dispatched', 'replied', 'failed', 'ignored')),
  error_message TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (channel_account_id) REFERENCES channel_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id),
  UNIQUE(channel_account_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_inbound_events_account_received_at
  ON channel_inbound_events(channel_account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_inbound_events_account_status
  ON channel_inbound_events(channel_account_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_inbound_events_control_session
  ON channel_inbound_events(control_session_id, received_at DESC);

CREATE TABLE IF NOT EXISTS channel_deliveries (
  id TEXT PRIMARY KEY,
  channel_account_id TEXT NOT NULL,
  thread_id TEXT,
  inbound_event_id TEXT,
  control_session_id TEXT,
  session_id TEXT,
  text_content TEXT NOT NULL,
  provider_message_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_account_id) REFERENCES channel_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES channel_threads(id) ON DELETE SET NULL,
  FOREIGN KEY (inbound_event_id) REFERENCES channel_inbound_events(id) ON DELETE SET NULL,
  FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_channel_deliveries_account_created_at
  ON channel_deliveries(channel_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_deliveries_account_status
  ON channel_deliveries(channel_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_deliveries_thread_created_at
  ON channel_deliveries(thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS instance_tailscale_config (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1)),
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

CREATE TABLE IF NOT EXISTS instance_relay_tunnel_config (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  provider TEXT NOT NULL CHECK (provider = 'codingns_relay'),
  relay_base_url TEXT,
  control_base_url TEXT,
  control_access_token_ciphertext TEXT,
  control_account_email TEXT,
  control_session_expires_at TEXT,
  account_id TEXT,
  tunnel_domain TEXT,
  binding_id TEXT,
  host_public_key TEXT,
  host_key_fingerprint TEXT,
  local_target_base_url TEXT NOT NULL,
  local_target_source TEXT NOT NULL DEFAULT 'default' CHECK (local_target_source IN ('default', 'custom')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_relay_tunnel_identity (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  key_algorithm TEXT NOT NULL CHECK (key_algorithm = 'x25519'),
  private_key_pem TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_relay_tunnel_status (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  phase TEXT NOT NULL CHECK (
    phase IN (
      'disabled',
      'blocked_uninitialized',
      'unbound',
      'binding',
      'connecting',
      'running',
      'quota_exhausted',
      'error'
    )
  ),
  connected INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
  binding_id TEXT,
  tunnel_domain TEXT,
  host_fingerprint TEXT,
  traffic_used_bytes TEXT,
  traffic_remaining_bytes TEXT,
  quota_reset_at TEXT,
  last_error TEXT,
  observed_at TEXT
);

CREATE TABLE IF NOT EXISTS managed_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'assistant')),
  directory_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('builtin', 'local-import', 'managed-copy')),
  source_path TEXT,
  content_hash TEXT NOT NULL,
  managed_state TEXT NOT NULL CHECK (managed_state IN ('active', 'conflicted', 'missing')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, directory_name)
);

CREATE INDEX IF NOT EXISTS idx_managed_skills_state
  ON managed_skills(scope, managed_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS skill_target_bindings (
  skill_id TEXT NOT NULL,
  target_cli TEXT NOT NULL CHECK (target_cli IN ('codex', 'claude-code', 'gemini', 'opencode', 'deepseek-harness')),
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
