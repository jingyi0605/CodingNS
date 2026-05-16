import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export interface DatabaseClient {
  db: Database.Database;
  close: () => void;
}

export function createDatabaseClient(databasePath: string): DatabaseClient {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  const schemaPath = new URL("./schema.sql", import.meta.url);
  const schema = fs.readFileSync(schemaPath, "utf8");

  ensurePreSchemaCompatibility(db);
  db.exec(schema);
  ensureAuthTokenDeviceColumns(db);
  ensureAuthDeviceSchema(db);
  ensureAuthLoginAttemptSchema(db);
  ensureWorkspaceRemovalColumn(db);
  ensureWorkspaceSortOrderColumn(db);
  ensureWorkspaceNavigationBackgroundColorColumn(db);
  ensureOpenCliProviderSchema(db);
  ensureOpenCliCatalogSchema(db);
  ensureOpenCliRuntimeProfileSchema(db);
  ensureSessionProviderSchema(db);
  ensureSessionBindingPresetSchema(db);
  ensureSessionStateSchema(db);
  ensureSessionAttachmentSchema(db);
  ensureSessionIndexArchiveColumn(db);
  ensureSessionRelationColumns(db);
  ensureSessionForkSchema(db);
  ensureSessionChangedFileTables(db);
  ensureTerminalInstanceProcessIdColumn(db);
  ensureTerminalRuntimeSchema(db);
  ensureTerminalLogSchema(db);
  ensureTerminalCommandTemplatePortColumn(db);
  ensureTerminalCommandTemplateRuntimeTypeColumn(db);
  ensureTerminalCommandTemplateProxySchema(db);
  ensureDebugTargetSchema(db);
  ensureFrameworkAnalysisSchema(db);
  ensureDebugRuntimeSchema(db);
  ensurePortLeaseSchema(db);
  ensureRuntimeBindingSchema(db);
  ensureAiFallbackEditSchema(db);
  ensureInstanceTailscaleConfigSchema(db);
  ensureInstanceTailscaleStatusSchema(db);
  ensureInstanceRelayTunnelConfigSchema(db);
  ensureTerminalCommandTemplateDebugSchema(db);
  ensureTerminalInstanceDebugSchema(db);
  ensureUserPreferenceProfileSchema(db);
  ensureButlerProfileSchema(db);
  ensureButlerControlSessionSchema(db);
  ensureButlerControlTimerSchema(db);
  ensureAssistantAutomationSchema(db);
  ensureAssistantSandboxSchema(db);
  ensureDocumentTemplateSchema(db);
  ensureOpsTargetWorkspaceSchema(db);
  ensureButlerInboxSchema(db);
  ensureButlerFollowUpTaskSchema(db);
  ensureVerificationRunSchema(db);
  ensureButlerSessionSummarySchema(db);

  return {
    db,
    close: () => db.close()
  };
}

function ensurePreSchemaCompatibility(db: Database.Database): void {
  // 旧库还没有这些列时，schema.sql 里的索引会先炸掉，所以必须先补齐。
  ensureAuthTokenDeviceColumns(db);
  ensureOpsTargetWorkspaceSchema(db);
  ensureManagedSkillScopeSchema(db);
  ensureAuthTokenCallerKindSchema(db);
}

function ensureAuthTokenDeviceColumns(db: Database.Database): void {
  if (!tableExists(db, "auth_tokens")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(auth_tokens)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("device_session_id")) {
    db.exec("ALTER TABLE auth_tokens ADD COLUMN device_session_id TEXT");
  }

  if (!columnNames.has("caller_kind")) {
    db.exec(
      "ALTER TABLE auth_tokens ADD COLUMN caller_kind TEXT CHECK (caller_kind IN ('interactive_user', 'assistant_runtime', 'workspace_session'))"
    );
  }

  if (!columnNames.has("capability_profile")) {
    db.exec("ALTER TABLE auth_tokens ADD COLUMN capability_profile TEXT");
  }

  if (!columnNames.has("workspace_id")) {
    db.exec("ALTER TABLE auth_tokens ADD COLUMN workspace_id TEXT");
  }

  if (!columnNames.has("project_id")) {
    db.exec("ALTER TABLE auth_tokens ADD COLUMN project_id TEXT");
  }

  if (!columnNames.has("session_id")) {
    db.exec("ALTER TABLE auth_tokens ADD COLUMN session_id TEXT");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_auth_tokens_device_session_id ON auth_tokens(device_session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_auth_tokens_workspace_id ON auth_tokens(workspace_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_auth_tokens_session_id ON auth_tokens(session_id)");
}

function ensureAuthTokenCallerKindSchema(db: Database.Database): void {
  if (!tableExists(db, "auth_tokens")) {
    return;
  }

  const table = db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'auth_tokens'
       LIMIT 1`
    )
    .get() as { sql?: string | null } | undefined;
  const definition = table?.sql ?? "";

  if (
    definition.includes("'interactive_user', 'assistant_runtime', 'workspace_session'")
    || definition.includes("'interactive_user','assistant_runtime','workspace_session'")
  ) {
    return;
  }

  db.exec(`
    ALTER TABLE auth_tokens RENAME TO auth_tokens_legacy;

    CREATE TABLE auth_tokens (
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

    INSERT INTO auth_tokens (
      id,
      user_id,
      token_type,
      token_hash,
      device_session_id,
      caller_kind,
      capability_profile,
      workspace_id,
      project_id,
      session_id,
      expires_at,
      revoked_at,
      created_at
    )
    SELECT
      id,
      user_id,
      token_type,
      token_hash,
      device_session_id,
      caller_kind,
      capability_profile,
      workspace_id,
      project_id,
      session_id,
      expires_at,
      revoked_at,
      created_at
    FROM auth_tokens_legacy;

    DROP TABLE auth_tokens_legacy;

    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_device_session_id ON auth_tokens(device_session_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_workspace_id ON auth_tokens(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_session_id ON auth_tokens(session_id);
  `);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`
    )
    .get(tableName) as { name: string } | undefined;

  return row?.name === tableName;
}

function ensureAuthDeviceSchema(db: Database.Database): void {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_auth_devices_user_id
      ON auth_devices(user_id, updated_at DESC);
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
  `);

  const authDeviceColumns = db
    .prepare("PRAGMA table_info(auth_devices)")
    .all() as Array<{ name: string }>;

  if (!authDeviceColumns.some((column) => column.name === "user_agent")) {
    db.exec("ALTER TABLE auth_devices ADD COLUMN user_agent TEXT");
  }
}

function ensureAuthLoginAttemptSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(auth_login_attempts)")
    .all() as Array<{ name: string }>;

  if (columns.length > 0) {
    return;
  }

  db.exec(`
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
  `);
}

function ensureWorkspaceRemovalColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "removed_at")) {
    return;
  }

  db.exec("ALTER TABLE workspaces ADD COLUMN removed_at TEXT");
}

function ensureWorkspaceSortOrderColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("sort_order")) {
    return;
  }

  db.exec("ALTER TABLE workspaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");

  const orderByClauses: string[] = [];

  if (columnNames.has("updated_at")) {
    orderByClauses.push("updated_at DESC");
  }

  if (columnNames.has("created_at")) {
    orderByClauses.push("created_at DESC");
  }

  if (orderByClauses.length === 0) {
    orderByClauses.push("id ASC");
  }

  const workspaces = db
    .prepare(
      `SELECT id
       FROM workspaces
       ORDER BY ${orderByClauses.join(", ")}`
    )
    .all() as Array<{ id: string }>;
  const update = db.prepare(
    `UPDATE workspaces
     SET sort_order = ?
     WHERE id = ?`
  );
  const runInTransaction = db.transaction((items: Array<{ id: string }>) => {
    items.forEach((item, index) => {
      update.run(index, item.id);
    });
  });

  runInTransaction(workspaces);
}

function ensureWorkspaceNavigationBackgroundColorColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(workspace_navigation_states)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "background_color")) {
    return;
  }

  db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN background_color TEXT");
}

function ensureSessionAttachmentSchema(db: Database.Database): void {
  const table = db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'session_message_attachments'
       LIMIT 1`
    )
    .get() as { sql?: string | null } | undefined;
  const definition = table?.sql ?? "";

  if (
    definition.length === 0 ||
    definition.includes("kind IN ('image', 'file')") ||
    definition.includes("kind IN ('image','file')")
  ) {
    return;
  }

  db.exec(`
    ALTER TABLE session_message_attachments RENAME TO session_message_attachments_legacy;

    CREATE TABLE session_message_attachments (
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

    INSERT INTO session_message_attachments (
      id,
      session_id,
      client_request_id,
      message_id,
      kind,
      file_name,
      mime_type,
      file_size,
      storage_path,
      created_at
    )
    SELECT
      id,
      session_id,
      client_request_id,
      message_id,
      kind,
      file_name,
      mime_type,
      file_size,
      storage_path,
      created_at
    FROM session_message_attachments_legacy;

    DROP TABLE session_message_attachments_legacy;

    CREATE INDEX IF NOT EXISTS idx_session_message_attachments_message
      ON session_message_attachments(session_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_session_message_attachments_client_request
      ON session_message_attachments(session_id, client_request_id);
  `);
}

function ensureButlerProfileSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_profiles)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "display_name")) {
    return;
  }

  db.exec("ALTER TABLE butler_profiles ADD COLUMN display_name TEXT NOT NULL DEFAULT '代码助手'");
}

function ensureUserPreferenceProfileSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(user_preference_profiles)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("auto_theme")) {
    db.exec("ALTER TABLE user_preference_profiles ADD COLUMN auto_theme INTEGER NOT NULL DEFAULT 0 CHECK (auto_theme IN (0, 1))");
  }

  if (!columnNames.has("debug_port_pools_json")) {
    db.exec(`ALTER TABLE user_preference_profiles
      ADD COLUMN debug_port_pools_json TEXT NOT NULL DEFAULT '{"start":43000,"end":47999}'`);
  }
}

function ensureManagedSkillScopeSchema(db: Database.Database): void {
  if (!tableExists(db, "managed_skills")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(managed_skills)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const tableSqlRow = db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'managed_skills'`
    )
    .get() as { sql: string | null } | undefined;
  const tableSql = tableSqlRow?.sql ?? "";
  const needsRebuild =
    !columnNames.has("scope")
    || tableSql.includes("directory_name TEXT NOT NULL UNIQUE")
    || !tableSql.includes("UNIQUE(scope, directory_name)");

  if (!needsRebuild) {
    return;
  }

  db.exec("DROP INDEX IF EXISTS idx_managed_skills_state");
  db.exec("PRAGMA foreign_keys = OFF");

  try {
    db.exec("BEGIN");
    db.exec(`
      CREATE TABLE managed_skills__next (
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
    `);
    db.exec(`
      INSERT INTO managed_skills__next (
        id,
        name,
        scope,
        directory_name,
        source_type,
        source_path,
        content_hash,
        managed_state,
        created_at,
        updated_at
      )
      SELECT
        id,
        name,
        'workspace',
        directory_name,
        source_type,
        source_path,
        content_hash,
        managed_state,
        created_at,
        updated_at
      FROM managed_skills;
    `);
    db.exec("DROP TABLE managed_skills");
    db.exec("ALTER TABLE managed_skills__next RENAME TO managed_skills");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_managed_skills_state
      ON managed_skills(scope, managed_state, updated_at DESC);
  `);
}

function ensureOpenCliProviderSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(opencli_providers)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("catalog_refreshed_at")) {
    db.exec("ALTER TABLE opencli_providers ADD COLUMN catalog_refreshed_at TEXT");
  }

  if (!columnNames.has("catalog_source")) {
    db.exec(
      "ALTER TABLE opencli_providers ADD COLUMN catalog_source TEXT CHECK (catalog_source IS NULL OR catalog_source IN ('manifest', 'cli_list', 'local_manifest', 'cache'))"
    );
  }
}

function ensureOpenCliCatalogSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(opencli_catalog_entries)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("module_path")) {
    db.exec("ALTER TABLE opencli_catalog_entries ADD COLUMN module_path TEXT");
  }

  if (!columnNames.has("source_file")) {
    db.exec("ALTER TABLE opencli_catalog_entries ADD COLUMN source_file TEXT");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_opencli_catalog_entries_site_sort
      ON opencli_catalog_entries(provider_id, site, sort_order, command_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_opencli_catalog_entries_enabled
      ON opencli_catalog_entries(provider_id, enabled, site)
  `);
}

function ensureOpenCliRuntimeProfileSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(opencli_runtime_profiles)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_opencli_runtime_profiles_status
      ON opencli_runtime_profiles(status, updated_at DESC)
  `);
}

function ensureButlerControlSessionSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_control_sessions)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has("purpose")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'chat'");
  }

  if (!columnNames.has("title")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN title TEXT");
  }

  if (!columnNames.has("source_item_id")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN source_item_id TEXT");
  }

  if (!columnNames.has("model")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN model TEXT");
  }

  if (!columnNames.has("reasoning_level")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN reasoning_level TEXT");
  }

  if (!columnNames.has("permission_mode")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN permission_mode TEXT");
  }
}

function ensureButlerControlTimerSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_control_timers)")
    .all() as Array<{ name: string }>;

  if (columns.length > 0) {
    return;
  }

  db.exec(`
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
  `);
}

function ensureAssistantAutomationSchema(db: Database.Database): void {
  const taskColumns = db
    .prepare("PRAGMA table_info(assistant_automation_tasks)")
    .all() as Array<{ name: string }>;
  const runColumns = db
    .prepare("PRAGMA table_info(assistant_automation_runs)")
    .all() as Array<{ name: string }>;

  if (taskColumns.length > 0 && runColumns.length > 0) {
    return;
  }

  db.exec(`
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
  `);
}

function ensureAssistantSandboxSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(assistant_sandboxes)")
    .all() as Array<{ name: string }>;

  if (columns.length > 0) {
    const columnNames = new Set(columns.map((column) => column.name));
    const tableSql = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assistant_sandboxes'"
        )
        .get() as { sql?: string } | undefined
    )?.sql ?? "";
    const needsStatusConstraintRebuild = !tableSql.includes("'orphaned'");

    if (needsStatusConstraintRebuild) {
      const hasControlSessionId = columnNames.has("control_session_id");
      const rebuild = db.transaction(() => {
        db.exec("ALTER TABLE assistant_sandboxes RENAME TO assistant_sandboxes_legacy");
        db.exec(`
          CREATE TABLE assistant_sandboxes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL UNIQUE,
            control_session_id TEXT,
            title TEXT NOT NULL,
            description TEXT,
            source_kind TEXT NOT NULL CHECK (source_kind IN ('blank', 'clone')),
            source_ref TEXT,
            visibility TEXT NOT NULL CHECK (visibility IN ('assistant_only', 'pinned')),
            status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'expired', 'orphaned', 'deleted')),
            purpose TEXT,
            expires_at TEXT,
            promoted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (control_session_id) REFERENCES butler_control_sessions(id) ON DELETE SET NULL
          );
        `);
        db.exec(`
          INSERT INTO assistant_sandboxes (
            id,
            user_id,
            workspace_id,
            control_session_id,
            title,
            description,
            source_kind,
            source_ref,
            visibility,
            status,
            purpose,
            expires_at,
            promoted_at,
            created_at,
            updated_at
          )
          SELECT
            id,
            user_id,
            workspace_id,
            ${hasControlSessionId ? "control_session_id" : "NULL"},
            title,
            description,
            source_kind,
            source_ref,
            visibility,
            status,
            purpose,
            expires_at,
            promoted_at,
            created_at,
            updated_at
          FROM assistant_sandboxes_legacy;
        `);
        db.exec("DROP TABLE assistant_sandboxes_legacy");
      });

      rebuild();
    } else if (!columnNames.has("control_session_id")) {
      db.exec("ALTER TABLE assistant_sandboxes ADD COLUMN control_session_id TEXT");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_assistant_sandboxes_user_status
        ON assistant_sandboxes(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assistant_sandboxes_workspace
        ON assistant_sandboxes(workspace_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assistant_sandboxes_control_session
        ON assistant_sandboxes(control_session_id, status, updated_at DESC);
    `);
    return;
  }

  db.exec(`
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
      status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'expired', 'orphaned', 'deleted')),
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
    CREATE INDEX IF NOT EXISTS idx_assistant_sandboxes_control_session
      ON assistant_sandboxes(control_session_id, status, updated_at DESC);
  `);
}

function ensureVerificationRunSchema(db: Database.Database): void {
  const verificationRunSql = readTableSql(db, "verification_runs");

  if (!verificationRunSql.includes("status IN ('queued', 'running', 'passed', 'failed', 'skipped')")) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE verification_runs_next (
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

    INSERT INTO verification_runs_next (
      id,
      project_id,
      butler_session_id,
      source_patrol_run_id,
      verification_type,
      status,
      target_ref,
      spec_json,
      artifact_refs_json,
      result_json,
      summary,
      started_at,
      finished_at,
      created_at
    )
    SELECT
      id,
      project_id,
      butler_session_id,
      source_patrol_run_id,
      verification_type,
      status,
      target_ref,
      spec_json,
      artifact_refs_json,
      result_json,
      summary,
      started_at,
      finished_at,
      created_at
    FROM verification_runs;

    DROP TABLE verification_runs;
    ALTER TABLE verification_runs_next RENAME TO verification_runs;

    CREATE INDEX IF NOT EXISTS idx_verification_runs_project_created_at
      ON verification_runs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_verification_runs_project_status
      ON verification_runs(project_id, status, created_at DESC);

    PRAGMA foreign_keys = ON;
  `);
}

function ensureDocumentTemplateSchema(db: Database.Database): void {
  if (!tableExists(db, "document_templates")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(document_templates)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("mapping_json")) {
    db.exec("ALTER TABLE document_templates ADD COLUMN mapping_json TEXT NOT NULL DEFAULT '{}'");
  }

  if (!columnNames.has("template_source_path")) {
    db.exec("ALTER TABLE document_templates ADD COLUMN template_source_path TEXT");
  }
}

function ensureOpsTargetWorkspaceSchema(db: Database.Database): void {
  if (!tableExists(db, "ops_targets")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(ops_targets)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("workspace_id")) {
    db.exec("ALTER TABLE ops_targets ADD COLUMN workspace_id TEXT");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_targets_workspace_id ON ops_targets(workspace_id)");
}

function ensureButlerInboxSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_inbox_items)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "assistant_state_json")) {
    return;
  }

  db.exec("ALTER TABLE butler_inbox_items ADD COLUMN assistant_state_json TEXT NOT NULL DEFAULT '{}'");
}

function ensureButlerFollowUpTaskSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_follow_up_tasks)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has("completion_criteria")) {
    db.exec("ALTER TABLE butler_follow_up_tasks ADD COLUMN completion_criteria TEXT NOT NULL DEFAULT ''");
  }

  if (!columnNames.has("max_auto_continue_count")) {
    db.exec("ALTER TABLE butler_follow_up_tasks ADD COLUMN max_auto_continue_count INTEGER NOT NULL DEFAULT 5");
  }

  if (!columnNames.has("rounds_json")) {
    db.exec("ALTER TABLE butler_follow_up_tasks ADD COLUMN rounds_json TEXT NOT NULL DEFAULT '[]'");
  }

  if (!columnNames.has("provider_id")) {
    db.exec("ALTER TABLE butler_follow_up_tasks ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'codex'");
  }

  if (!columnNames.has("assistant_butler_session_id")) {
    db.exec("ALTER TABLE butler_follow_up_tasks ADD COLUMN assistant_butler_session_id TEXT NOT NULL DEFAULT ''");
  }

  if (!columnNames.has("assistant_session_id")) {
    db.exec("ALTER TABLE butler_follow_up_tasks ADD COLUMN assistant_session_id TEXT NOT NULL DEFAULT ''");
  }
}

function ensureButlerSessionSummarySchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_session_summary_states)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "last_summarized_sequence")) {
    return;
  }

  db.exec("ALTER TABLE butler_session_summary_states ADD COLUMN last_summarized_sequence INTEGER");
}

function ensureInstanceTailscaleStatusSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(instance_tailscale_status)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "account_name")) {
    return;
  }

  db.exec("ALTER TABLE instance_tailscale_status ADD COLUMN account_name TEXT");
}

function ensureInstanceTailscaleConfigSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(instance_tailscale_config)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "activated")) {
    return;
  }

  db.exec("ALTER TABLE instance_tailscale_config ADD COLUMN activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1))");
  db.exec("UPDATE instance_tailscale_config SET activated = enabled");
}

function ensureInstanceRelayTunnelConfigSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(instance_relay_tunnel_config)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  if (!columns.some((column) => column.name === "activated")) {
    db.exec("ALTER TABLE instance_relay_tunnel_config ADD COLUMN activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1))");
    db.exec("UPDATE instance_relay_tunnel_config SET activated = enabled");
  }

  if (!columns.some((column) => column.name === "control_access_token_ciphertext")) {
    db.exec("ALTER TABLE instance_relay_tunnel_config ADD COLUMN control_access_token_ciphertext TEXT");
  }

  if (!columns.some((column) => column.name === "control_account_email")) {
    db.exec("ALTER TABLE instance_relay_tunnel_config ADD COLUMN control_account_email TEXT");
  }

  if (!columns.some((column) => column.name === "control_session_expires_at")) {
    db.exec("ALTER TABLE instance_relay_tunnel_config ADD COLUMN control_session_expires_at TEXT");
  }

  if (!columns.some((column) => column.name === "local_target_source")) {
    db.exec(
      "ALTER TABLE instance_relay_tunnel_config ADD COLUMN local_target_source TEXT NOT NULL DEFAULT 'default' CHECK (local_target_source IN ('default', 'custom'))"
    );
  }
}

function ensureSessionProviderSchema(db: Database.Database): void {
  const bindingSql = readTableSql(db, "session_bindings");
  const indexSql = readTableSql(db, "session_indices");
  const requiresBindingMigration = bindingSql.includes("CHECK (provider IN ('claude-code', 'codex'))");
  const requiresIndexMigration = indexSql.includes("CHECK (provider IN ('claude-code', 'codex'))");

  if (!requiresBindingMigration && !requiresIndexMigration) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE session_bindings_next (
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

    INSERT INTO session_bindings_next (
      session_id,
      workspace_id,
      provider,
      provider_session_id,
      raw_store_ref,
      created_at,
      updated_at
    )
    SELECT
      session_id,
      workspace_id,
      provider,
      provider_session_id,
      raw_store_ref,
      created_at,
      updated_at
    FROM session_bindings;

    CREATE TABLE session_indices_next (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (session_id) REFERENCES session_bindings(session_id)
    );

    INSERT INTO session_indices_next (
      session_id,
      workspace_id,
      provider,
      title,
      message_count,
      is_archived,
      last_message_at,
      created_at,
      updated_at
    )
    SELECT
      session_id,
      workspace_id,
      provider,
      title,
      message_count,
      COALESCE(is_archived, 0),
      last_message_at,
      created_at,
      updated_at
    FROM session_indices;

    DROP TABLE session_indices;
    DROP TABLE session_bindings;

    ALTER TABLE session_bindings_next RENAME TO session_bindings;
    ALTER TABLE session_indices_next RENAME TO session_indices;

    CREATE INDEX IF NOT EXISTS idx_session_bindings_workspace_id
      ON session_bindings(workspace_id);

    CREATE INDEX IF NOT EXISTS idx_session_indices_workspace_id
      ON session_indices(workspace_id);

    PRAGMA foreign_keys = ON;
  `);
}

function ensureSessionBindingPresetSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(session_bindings)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has("provider_config_mode")) {
    db.exec(
      "ALTER TABLE session_bindings ADD COLUMN provider_config_mode TEXT NOT NULL DEFAULT 'global-default' CHECK (provider_config_mode IN ('global-default', 'cc-switch-preset'))"
    );
  }

  if (!columnNames.has("provider_preset_id")) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN provider_preset_id TEXT");
  }

  if (!columnNames.has("runtime_home_dir")) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN runtime_home_dir TEXT");
  }
}

function ensureSessionStateSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(session_states)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("activity_source") && columnNames.has("favorite")) {
    return;
  }

  const runningStateExpr = columnNames.has("running_state")
    ? `CASE
         WHEN running_state IN ('idle', 'starting', 'running', 'completed', 'interrupted', 'failed')
           THEN running_state
         ELSE 'idle'
       END`
    : "'idle'";
  const activitySourceExpr = columnNames.has("activity_source")
    ? `CASE
         WHEN activity_source IN ('none', 'runtime', 'inferred') THEN activity_source
         WHEN ${runningStateExpr} = 'running' THEN 'inferred'
         ELSE 'none'
       END`
    : `CASE
         WHEN ${runningStateExpr} = 'running' THEN 'inferred'
         ELSE 'none'
       END`;
  const lastEventAtExpr = columnNames.has("last_event_at") ? "last_event_at" : "NULL";
  const completedAtExpr = columnNames.has("completed_at") ? "completed_at" : "NULL";
  const lastSeenAtExpr = columnNames.has("last_seen_at") ? "last_seen_at" : "NULL";
  const favoriteExpr = columnNames.has("favorite") ? "favorite" : "0";
  const updatedAtExpr = columnNames.has("updated_at") ? "updated_at" : "CURRENT_TIMESTAMP";

  db.exec(`
    CREATE TABLE session_states_next (
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

    INSERT INTO session_states_next (
      session_id,
      user_id,
      running_state,
      activity_source,
      favorite,
      last_event_at,
      completed_at,
      last_seen_at,
      updated_at
    )
    SELECT
      session_id,
      user_id,
      ${runningStateExpr},
      ${activitySourceExpr},
      ${favoriteExpr},
      ${lastEventAtExpr},
      ${completedAtExpr},
      ${lastSeenAtExpr},
      ${updatedAtExpr}
    FROM session_states;

    DROP TABLE session_states;
    ALTER TABLE session_states_next RENAME TO session_states;

    CREATE INDEX IF NOT EXISTS idx_session_states_user_id
      ON session_states(user_id, updated_at DESC);
  `);
}

function ensureSessionForkSchema(db: Database.Database): void {
  const tableSql = db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'session_forks'`
    )
    .get() as { sql?: string | null } | undefined;
  const columns = db
    .prepare("PRAGMA table_info(session_forks)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  const columnNames = new Set(columns.map((column) => column.name));

  if (
    columnNames.has("session_id")
    && columnNames.has("parent_session_id")
    && columnNames.has("provider")
    && columnNames.has("fork_source_type")
    && columnNames.has("fork_source_session_id")
    && columnNames.has("fork_source_message_id")
    && columnNames.has("inherited_prefix_message_count")
    && columnNames.has("provider_parent_session_id")
    && columnNames.has("provider_source_message_id")
    && columnNames.has("fork_method")
    && columnNames.has("created_at")
    && tableSql?.sql?.includes("'reconstructed_session_fork'")
  ) {
    return;
  }

  const hasSourceSessionId = columnNames.has("fork_source_session_id");
  const hasInheritedPrefixMessageCount = columnNames.has("inherited_prefix_message_count");
  const hasProviderParentSessionId = columnNames.has("provider_parent_session_id");
  const hasProviderSourceMessageId = columnNames.has("provider_source_message_id");

  db.exec(`
    PRAGMA foreign_keys = OFF;

    DROP TABLE IF EXISTS session_forks_next;

    CREATE TABLE session_forks_next (
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

    INSERT INTO session_forks_next (
      session_id,
      parent_session_id,
      provider,
      fork_source_type,
      fork_source_session_id,
      fork_source_message_id,
      inherited_prefix_message_count,
      provider_parent_session_id,
      provider_source_message_id,
      fork_method,
      created_at
    )
    SELECT
      session_id,
      parent_session_id,
      provider,
      fork_source_type,
      ${hasSourceSessionId ? "fork_source_session_id" : "parent_session_id"},
      fork_source_message_id,
      ${hasInheritedPrefixMessageCount ? "inherited_prefix_message_count" : "0"},
      ${hasProviderParentSessionId ? "provider_parent_session_id" : "NULL"},
      ${hasProviderSourceMessageId ? "provider_source_message_id" : "NULL"},
      fork_method,
      created_at
    FROM session_forks;

    DROP TABLE session_forks;
    ALTER TABLE session_forks_next RENAME TO session_forks;

    CREATE INDEX IF NOT EXISTS idx_session_forks_parent_session_id
      ON session_forks(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_forks_source_message_id
      ON session_forks(fork_source_message_id);

    PRAGMA foreign_keys = ON;
  `);
}

function ensureSessionIndexArchiveColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(session_indices)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "is_archived")) {
    return;
  }

  db.exec(`
    ALTER TABLE session_indices
    ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
  `);
}

function ensureSessionRelationColumns(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(session_indices)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("parent_session_id")) {
    db.exec("ALTER TABLE session_indices ADD COLUMN parent_session_id TEXT");
  }

  if (!columnNames.has("session_kind")) {
    db.exec(
      "ALTER TABLE session_indices ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'default' CHECK (session_kind IN ('default', 'annotation'))"
    );
  }

  if (!columnNames.has("annotation_source_message_id")) {
    db.exec("ALTER TABLE session_indices ADD COLUMN annotation_source_message_id TEXT");
  }

  if (!columnNames.has("annotation_source_text")) {
    db.exec("ALTER TABLE session_indices ADD COLUMN annotation_source_text TEXT");
  }

  if (!columnNames.has("is_subagent")) {
    db.exec(
      "ALTER TABLE session_indices ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0 CHECK (is_subagent IN (0, 1))"
    );
  }

  if (!columnNames.has("subagent_label")) {
    db.exec("ALTER TABLE session_indices ADD COLUMN subagent_label TEXT");
  }
}

function ensureSessionChangedFileTables(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureTerminalCommandTemplatePortColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "port")) {
    return;
  }

  db.exec("ALTER TABLE terminal_command_templates ADD COLUMN port INTEGER");
}

function ensureTerminalCommandTemplateRuntimeTypeColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "runtime_type")) {
    return;
  }

  db.exec("ALTER TABLE terminal_command_templates ADD COLUMN runtime_type TEXT");
}

function ensureTerminalCommandTemplateProxySchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("proxy_enabled")) {
    db.exec(
      "ALTER TABLE terminal_command_templates ADD COLUMN proxy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (proxy_enabled IN (0, 1))"
    );
  }

  if (!columnNames.has("proxy_slug")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN proxy_slug TEXT");
  }

  // 索引放在迁移阶段创建，避免旧库缺少 proxy_slug 列时在 schema 初始化阶段直接失败。
  db.exec(`
    UPDATE terminal_command_templates
    SET proxy_enabled = 0
    WHERE proxy_enabled IS NULL OR proxy_enabled NOT IN (0, 1);

    UPDATE terminal_command_templates
    SET proxy_slug = NULL
    WHERE proxy_enabled = 0;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_templates_proxy_slug
      ON terminal_command_templates(proxy_slug)
      WHERE proxy_slug IS NOT NULL;
  `);
}

function ensureTerminalInstanceProcessIdColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_instances)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "process_id")) {
    return;
  }

  db.exec("ALTER TABLE terminal_instances ADD COLUMN process_id INTEGER");
}

function ensureTerminalRuntimeSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_instances)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("runtime_type")) {
    db.exec(
      "ALTER TABLE terminal_instances ADD COLUMN runtime_type TEXT NOT NULL DEFAULT 'embedded-pty'"
    );
  }

  if (!columnNames.has("runtime_session_id")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN runtime_session_id TEXT NOT NULL DEFAULT ''");
  }

  if (!columnNames.has("attach_target")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN attach_target TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    UPDATE terminal_instances
    SET runtime_type = 'embedded-pty'
    WHERE runtime_type IS NULL OR trim(runtime_type) = '';

    UPDATE terminal_instances
    SET runtime_session_id = 'legacy-' || id
    WHERE runtime_session_id IS NULL OR trim(runtime_session_id) = '';

    UPDATE terminal_instances
    SET attach_target = 'embedded:' || id
    WHERE attach_target IS NULL OR trim(attach_target) = '';
  `);

  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_terminal_instances_runtime_session_id
      ON terminal_instances(runtime_session_id);

    CREATE INDEX IF NOT EXISTS idx_terminal_runtime_sessions_terminal_id
      ON terminal_runtime_sessions(terminal_id);

    CREATE INDEX IF NOT EXISTS idx_terminal_runtime_sessions_state
      ON terminal_runtime_sessions(state, updated_at DESC);
  `);

  db.exec(`
    INSERT INTO terminal_runtime_sessions (
      id,
      terminal_id,
      runtime_type,
      session_key,
      attach_target,
      host_instance_id,
      agent_pid,
      shell_pid,
      state,
      last_heartbeat_at,
      last_checked_at,
      last_error_detail,
      created_at,
      updated_at
    )
    SELECT
      terminal_instances.runtime_session_id,
      terminal_instances.id,
      terminal_instances.runtime_type,
      terminal_instances.runtime_session_id,
      terminal_instances.attach_target,
      NULL,
      NULL,
      terminal_instances.process_id,
      CASE terminal_instances.status
        WHEN 'creating' THEN 'starting'
        WHEN 'running' THEN 'lost'
        WHEN 'closed' THEN 'closed'
        ELSE 'error'
      END,
      NULL,
      terminal_instances.last_active_at,
      CASE
        WHEN terminal_instances.status = 'error' THEN terminal_instances.status_detail
        WHEN terminal_instances.status = 'running' THEN 'LEGACY_RUNTIME_REQUIRES_REATTACH'
        ELSE NULL
      END,
      terminal_instances.created_at,
      terminal_instances.last_active_at
    FROM terminal_instances
    WHERE NOT EXISTS (
      SELECT 1
      FROM terminal_runtime_sessions
      WHERE terminal_runtime_sessions.id = terminal_instances.runtime_session_id
    );
  `);
}

function ensureTerminalLogSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureDebugTargetSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureFrameworkAnalysisSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureDebugRuntimeSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensurePortLeaseSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureRuntimeBindingSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureAiFallbackEditSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

function ensureTerminalCommandTemplateDebugSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("source_type")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN source_type TEXT");
  }

  if (!columnNames.has("debug_target_id")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN debug_target_id TEXT");
  }

  if (!columnNames.has("debug_service_id")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN debug_service_id TEXT");
  }

  if (!columnNames.has("framework_analysis_id")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN framework_analysis_id TEXT");
  }

  if (!columnNames.has("adapter_kind")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN adapter_kind TEXT");
  }

  if (!columnNames.has("injection_mode")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN injection_mode TEXT");
  }

  if (!columnNames.has("generated_artifact_ref")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN generated_artifact_ref TEXT");
  }

  if (!columnNames.has("service_discovery_mode")) {
    db.exec("ALTER TABLE terminal_command_templates ADD COLUMN service_discovery_mode TEXT");
  }

  if (!columnNames.has("managed_by_system")) {
    db.exec(
      "ALTER TABLE terminal_command_templates ADD COLUMN managed_by_system INTEGER NOT NULL DEFAULT 0"
    );
  }

  db.exec(`
    UPDATE terminal_command_templates
    SET managed_by_system = 0
    WHERE managed_by_system IS NULL OR managed_by_system NOT IN (0, 1);

    CREATE INDEX IF NOT EXISTS idx_terminal_templates_debug_target_id
      ON terminal_command_templates(debug_target_id);
  `);
}

function ensureTerminalInstanceDebugSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_instances)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("debug_runtime_session_id")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN debug_runtime_session_id TEXT");
  }

  if (!columnNames.has("debug_target_id")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN debug_target_id TEXT");
  }

  if (!columnNames.has("debug_service_id")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN debug_service_id TEXT");
  }

  if (!columnNames.has("framework_analysis_id")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN framework_analysis_id TEXT");
  }

  if (!columnNames.has("launcher_source_type")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN launcher_source_type TEXT");
  }

  if (!columnNames.has("launch_stage")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN launch_stage TEXT");
  }

  if (!columnNames.has("failure_stage")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN failure_stage TEXT");
  }

  if (!columnNames.has("adapter_kind")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN adapter_kind TEXT");
  }

  if (!columnNames.has("env_patch_summary_json")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN env_patch_summary_json TEXT");
  }

  if (!columnNames.has("artifact_ref")) {
    db.exec("ALTER TABLE terminal_instances ADD COLUMN artifact_ref TEXT");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_terminal_instances_debug_runtime_session_id
      ON terminal_instances(debug_runtime_session_id);

    CREATE INDEX IF NOT EXISTS idx_terminal_instances_debug_target_id
      ON terminal_instances(debug_target_id);
  `);
}

function readTableSql(db: Database.Database, tableName: string): string {
  const row = db
    .prepare(
      `
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(tableName) as { sql?: string } | undefined;

  return row?.sql ?? "";
}
