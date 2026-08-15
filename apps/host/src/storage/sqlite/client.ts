import fs from "node:fs";
import path from "node:path";

import type { BetterSqliteDatabase } from "../../shared/runtime/better-sqlite3.js";
import Database from "../../shared/runtime/better-sqlite3.js";

export interface DatabaseClient {
  db: BetterSqliteDatabase;
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
  ensureAuthUserStatusSchema(db);
  ensureAuthTokenDeviceColumns(db);
  ensureAuthDeviceSchema(db);
  ensureAuthLoginAttemptSchema(db);
  ensureWorkspaceOwnerSchema(db);
  ensurePeerHostSchema(db);
  ensureWorkspaceRemovalColumn(db);
  ensureWorkspaceSortOrderColumn(db);
  ensureWorkspaceNavigationBackgroundColorColumn(db);
  ensureWorkspaceNavigationHiddenColumn(db);
  ensureWorkspaceNavigationShortcutAppsColumns(db);
  ensureWorkspaceNavigationAffairsLibraryColumns(db);
  ensureSessionProviderSchema(db);
  ensureSessionBindingUserSchema(db);
  ensureSessionBindingPresetSchema(db);
  ensureSessionStateSchema(db);
  ensureSessionAttachmentSchema(db);
  ensureSessionIndexArchiveColumn(db);
  ensureSessionRelationColumns(db);
  ensureSessionForkSchema(db);
  ensureSessionChangedFileTables(db);
  ensureAffairsAssistantSessionSnapshotSchema(db);
  ensureTerminalInstanceProcessIdColumn(db);
  ensureTerminalRuntimeSchema(db);
  ensureTerminalLogSchema(db);
  ensureTerminalCommandTemplatePortColumn(db);
  ensureTerminalCommandTemplateShellColumn(db);
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
  ensureUserAffairsLibrarySettingsSchema(db);
  ensureUserTeableGlobalSettingsSchema(db);
  ensureUserTeableCredentialsSchema(db);
  ensureUserTeableWorkbenchSyncConfigsSchema(db);
  ensureUserTeableMirrorTableBindingsSchema(db);
  ensureUserTeableMirrorRecordMappingsSchema(db);
  ensureUserTeableFormBindingsSchema(db);
  ensureUserTeableFieldMappingsSchema(db);
  ensureUserTeableInboundRecordMappingsSchema(db);
  ensureButlerProfileSchema(db);
  ensureButlerControlSessionSchema(db);
  ensureButlerControlTimerSchema(db);
  ensureAssistantAutomationSchema(db);
  ensureOnlyOfficeSettingsSchema(db);
  ensureDocumentTemplateSchema(db);
  ensurePluginRegistrySchema(db);
  ensurePluginRuntimeSessionSchema(db);
  ensurePluginPermissionGrantSchema(db);
  ensurePluginRunSchema(db);
  ensureButlerInboxSchema(db);
  ensureButlerFollowUpTaskSchema(db);
  ensureVerificationRunSchema(db);

  return {
    db,
    close: () => db.close()
  };
}

function ensurePreSchemaCompatibility(db: BetterSqliteDatabase): void {
  // 旧库还没有这些列时，schema.sql 里的索引会先炸掉，所以必须先补齐。
  ensureAuthTokenDeviceColumns(db);
  ensureWorkspaceRemovalColumn(db);
  ensureWorkspaceSortOrderColumn(db);
  ensureWorkspaceOwnerColumn(db);
  ensurePeerHostSchema(db);
  ensureSessionBindingUserSchema(db);
  ensureButlerOwnershipPreSchemaCompatibility(db);
  ensureUserTeableFormBindingsPreSchemaCompatibility(db);
  ensureManagedSkillScopeSchema(db);
  ensureSkillTargetBindingsSchema(db);
  ensureAuthTokenCallerKindSchema(db);
}


function ensurePeerHostSchema(db: BetterSqliteDatabase): void {
  db.exec(`
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
  `);

  if (!tableHasColumn(db, "peer_hosts", "alias")) {
    db.exec("ALTER TABLE peer_hosts ADD COLUMN alias TEXT");
  }

  if (!tableHasColumn(db, "peer_hosts", "tag_color")) {
    db.exec("ALTER TABLE peer_hosts ADD COLUMN tag_color TEXT");
  }

  if (!tableHasColumn(db, "peer_host_workspace_bindings", "remote_workspace_id")) {
    db.exec("ALTER TABLE peer_host_workspace_bindings ADD COLUMN remote_workspace_id TEXT");
  }

  if (!tableHasColumn(db, "peer_host_workspace_bindings", "remote_workspace_path")) {
    db.exec("ALTER TABLE peer_host_workspace_bindings ADD COLUMN remote_workspace_path TEXT");
  }

  if (!tableHasColumn(db, "peer_host_workspace_bindings", "remote_workspace_name")) {
    db.exec("ALTER TABLE peer_host_workspace_bindings ADD COLUMN remote_workspace_name TEXT");
  }
}

function ensureAuthUserStatusSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "auth_users")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(auth_users)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("status")) {
    db.exec("ALTER TABLE auth_users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'))");
  }

  db.exec("UPDATE auth_users SET status = 'active' WHERE status IS NULL OR TRIM(status) = ''");
}

function ensureAuthTokenDeviceColumns(db: BetterSqliteDatabase): void {
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

function ensureUserTeableFormBindingsPreSchemaCompatibility(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_form_bindings")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(user_teable_form_bindings)")
    .all() as Array<{ name?: string }>;
  const columnNames = new Set(columns.map((column) => column.name ?? ""));

  if (!columnNames.has("enabled")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }
}

function ensureAuthTokenCallerKindSchema(db: BetterSqliteDatabase): void {
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

function tableExists(db: BetterSqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`
    )
    .get(tableName) as { name: string } | undefined;

  return row?.name === tableName;
}

function tableHasColumn(db: BetterSqliteDatabase, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) {
    return false;
  }

  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some(
    (column) => column.name === columnName
  );
}

function ensureAuthDeviceSchema(db: BetterSqliteDatabase): void {
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

function readLegacyDefaultUserId(db: BetterSqliteDatabase): string | null {
  if (!tableExists(db, "auth_users")) {
    return null;
  }

  const orderBy = tableHasColumn(db, "auth_users", "created_at")
    ? "created_at ASC, id ASC"
    : "id ASC";
  const row = db
    .prepare(
      `SELECT id
       FROM auth_users
       ORDER BY ${orderBy}
       LIMIT 1`
    )
    .get() as { id?: string | null } | undefined;

  return row?.id?.trim() || null;
}

function ensureButlerOwnershipPreSchemaCompatibility(db: BetterSqliteDatabase): void {
  const legacyUserId = readLegacyDefaultUserId(db);

  ensureButlerProfileOwnershipSchema(db, legacyUserId);
  ensureButlerProjectOwnershipSchema(db, legacyUserId);
  ensureButlerSessionOwnershipSchema(db, legacyUserId);
  ensureButlerControlSessionOwnershipSchema(db, legacyUserId);
}

function ensureButlerProfileOwnershipSchema(
  db: BetterSqliteDatabase,
  legacyUserId: string | null
): void {
  if (!tableExists(db, "butler_profiles")) {
    return;
  }

  if (!tableHasColumn(db, "butler_profiles", "user_id")) {
    db.exec("ALTER TABLE butler_profiles ADD COLUMN user_id TEXT");
  }

  if (legacyUserId) {
    db.prepare(`
      UPDATE butler_profiles
      SET user_id = ?
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `).run(legacyUserId);
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_butler_profiles_user_id ON butler_profiles(user_id)");

  const requiredColumns = [
    "display_name",
    "provider_id",
    "workspace_path",
    "agents_mode",
    "agents_content",
    "persona_json",
    "focus_json",
    "setup_completed",
    "initialized_at",
    "updated_at"
  ];

  if (requiredColumns.some((columnName) => !tableHasColumn(db, "butler_profiles", columnName))) {
    return;
  }

  const needsRebuild =
    readTableSql(db, "butler_profiles").includes("CHECK (id = 'default')");

  if (!needsRebuild) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.exec(`
      CREATE TABLE butler_profiles_next (
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
    `);

    if (legacyUserId) {
      db.prepare(`
        INSERT OR IGNORE INTO butler_profiles_next (
          id,
          user_id,
          display_name,
          provider_id,
          workspace_path,
          agents_mode,
          agents_file_path,
          agents_content,
          persona_json,
          focus_json,
          setup_completed,
          initialized_at,
          updated_at
        )
        SELECT
          CASE
            WHEN id = 'default' THEN ?
            ELSE id
          END,
          COALESCE(NULLIF(TRIM(user_id), ''), ?),
          display_name,
          provider_id,
          workspace_path,
          agents_mode,
          agents_file_path,
          agents_content,
          persona_json,
          focus_json,
          setup_completed,
          initialized_at,
          updated_at
        FROM butler_profiles
      `).run(`default:${legacyUserId}`, legacyUserId);
    }

    db.exec("DROP TABLE butler_profiles");
    db.exec("ALTER TABLE butler_profiles_next RENAME TO butler_profiles");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_butler_profiles_user_id ON butler_profiles(user_id)");
}

function ensureButlerProjectOwnershipSchema(
  db: BetterSqliteDatabase,
  legacyUserId: string | null
): void {
  if (!tableExists(db, "butler_projects")) {
    return;
  }

  if (!tableHasColumn(db, "butler_projects", "user_id")) {
    db.exec("ALTER TABLE butler_projects ADD COLUMN user_id TEXT");
  }

  if (legacyUserId) {
    db.prepare(`
      UPDATE butler_projects
      SET user_id = ?
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `).run(legacyUserId);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_butler_projects_user_id
      ON butler_projects(user_id, lifecycle_status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_butler_projects_workspace_id
      ON butler_projects(user_id, workspace_id);
  `);
}

function ensureButlerSessionOwnershipSchema(
  db: BetterSqliteDatabase,
  legacyUserId: string | null
): void {
  if (!tableExists(db, "butler_sessions")) {
    return;
  }

  if (!tableHasColumn(db, "butler_sessions", "user_id")) {
    db.exec("ALTER TABLE butler_sessions ADD COLUMN user_id TEXT");
  }

  if (legacyUserId) {
    db.prepare(`
      UPDATE butler_sessions
      SET user_id = COALESCE(
        (
          SELECT projects.user_id
          FROM butler_projects AS projects
          WHERE projects.id = butler_sessions.project_id
        ),
        ?
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `).run(legacyUserId);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_butler_sessions_user_id
      ON butler_sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_butler_sessions_project_id
      ON butler_sessions(user_id, project_id, updated_at DESC);
  `);
}

function ensureButlerControlSessionOwnershipSchema(
  db: BetterSqliteDatabase,
  legacyUserId: string | null
): void {
  if (!tableExists(db, "butler_control_sessions")) {
    return;
  }

  if (!tableHasColumn(db, "butler_control_sessions", "user_id")) {
    db.exec("ALTER TABLE butler_control_sessions ADD COLUMN user_id TEXT");
  }

  if (legacyUserId) {
    db.prepare(`
      UPDATE butler_control_sessions
      SET user_id = COALESCE(
        (
          SELECT bindings.user_id
          FROM session_bindings AS bindings
          WHERE bindings.session_id = butler_control_sessions.session_id
        ),
        ?
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `).run(legacyUserId);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_butler_control_sessions_user_provider
      ON butler_control_sessions(user_id, provider_id, updated_at DESC, created_at DESC);
  `);
}

function ensureWorkspaceOwnerSchema(db: BetterSqliteDatabase): void {
  ensureWorkspaceOwnerColumn(db);
  ensurePeerHostSchema(db);

  const legacyOwnerUserId = readLegacyDefaultUserId(db);
  if (legacyOwnerUserId) {
    db.prepare(
      `UPDATE workspaces
       SET owner_user_id = ?
       WHERE owner_user_id IS NULL OR TRIM(owner_user_id) = ''`
    ).run(legacyOwnerUserId);
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id, removed_at, sort_order)");
}

function ensureWorkspaceOwnerColumn(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "workspaces")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("owner_user_id")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN owner_user_id TEXT");
  }
}

function ensureWorkspaceNavigationAffairsLibraryColumns(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "workspace_navigation_states")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(workspace_navigation_states)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("affairs_library_root_path")) {
    db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN affairs_library_root_path TEXT");
  }

  if (!columnNames.has("affairs_library_enabled")) {
    db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN affairs_library_enabled INTEGER NOT NULL DEFAULT 0 CHECK (affairs_library_enabled IN (0, 1))");
  }

  if (!columnNames.has("affairs_library_favorites_json")) {
    db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN affairs_library_favorites_json TEXT");
  }
}

function ensurePluginRegistrySchema(db: BetterSqliteDatabase): void {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_plugin_definitions_name
      ON plugin_definitions(name);
    CREATE INDEX IF NOT EXISTS idx_plugin_definitions_updated_at
      ON plugin_definitions(updated_at DESC);

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

    CREATE INDEX IF NOT EXISTS idx_plugin_enablements_enabled
      ON plugin_enablements(enabled);

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

    CREATE INDEX IF NOT EXISTS idx_plugin_audit_events_plugin_id
      ON plugin_audit_events(plugin_id, created_at DESC);
  `);

  ensurePluginAuditEventForeignKeyCompatibility(db);
}

function ensurePluginAuditEventForeignKeyCompatibility(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "plugin_audit_events")) {
    return;
  }

  const table = db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'plugin_audit_events'
       LIMIT 1`
    )
    .get() as { sql?: string | null } | undefined;
  const definition = table?.sql ?? "";

  if (!definition.includes("REFERENCES plugin_definitions")) {
    const supportsNewEvents =
      definition.includes("'plugin.permission_granted'") &&
      definition.includes("'plugin.permission_revoked'") &&
      definition.includes("'plugin.permission_denied'") &&
      definition.includes("'plugin.schedule_triggered'") &&
      definition.includes("'plugin.schedule_retry_scheduled'") &&
      definition.includes("'plugin.schedule_skipped'");

    if (supportsNewEvents) {
      return;
    }
  }

  db.exec(`
    ALTER TABLE plugin_audit_events RENAME TO plugin_audit_events_legacy;

    CREATE TABLE plugin_audit_events (
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

    INSERT INTO plugin_audit_events (
      id,
      plugin_id,
      workspace_id,
      event_type,
      actor_user_id,
      payload_json,
      created_at
    )
    SELECT
      id,
      plugin_id,
      workspace_id,
      event_type,
      actor_user_id,
      payload_json,
      created_at
    FROM plugin_audit_events_legacy;

    DROP TABLE plugin_audit_events_legacy;

    CREATE INDEX IF NOT EXISTS idx_plugin_audit_events_plugin_id
      ON plugin_audit_events(plugin_id, created_at DESC);
  `);
}

function ensurePluginRuntimeSessionSchema(db: BetterSqliteDatabase): void {
  db.exec(`
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
  `);
}

function ensurePluginPermissionGrantSchema(db: BetterSqliteDatabase): void {
  db.exec(`
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
  `);
}

function ensurePluginRunSchema(db: BetterSqliteDatabase): void {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_plugin_runs_plugin_id
      ON plugin_runs(plugin_id, created_at DESC);
  `);

  const columns = db
    .prepare("PRAGMA table_info(plugin_runs)")
    .all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === "runtime_session_id")) {
    db.exec("ALTER TABLE plugin_runs ADD COLUMN runtime_session_id TEXT");
  }
}

function ensureAuthLoginAttemptSchema(db: BetterSqliteDatabase): void {
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

function ensureWorkspaceRemovalColumn(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "workspaces")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "removed_at")) {
    return;
  }

  db.exec("ALTER TABLE workspaces ADD COLUMN removed_at TEXT");
}

function ensureWorkspaceSortOrderColumn(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "workspaces")) {
    return;
  }

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

function ensureWorkspaceNavigationBackgroundColorColumn(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(workspace_navigation_states)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "background_color")) {
    return;
  }

  db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN background_color TEXT");
}

function ensureWorkspaceNavigationHiddenColumn(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(workspace_navigation_states)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "hidden")) {
    return;
  }

  db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))");
}

function ensureWorkspaceNavigationShortcutAppsColumns(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(workspace_navigation_states)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("shortcut_apps_collapsed")) {
    db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN shortcut_apps_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (shortcut_apps_collapsed IN (0, 1))");
  }

  if (!columnNames.has("shortcut_apps_side")) {
    db.exec("ALTER TABLE workspace_navigation_states ADD COLUMN shortcut_apps_side TEXT NOT NULL DEFAULT 'left' CHECK (shortcut_apps_side IN ('left', 'right'))");
  }
}

function ensureSessionAttachmentSchema(db: BetterSqliteDatabase): void {
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

function ensureButlerProfileSchema(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_profiles)")
    .all() as Array<{ name: string }>;

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("display_name")) {
    db.exec("ALTER TABLE butler_profiles ADD COLUMN display_name TEXT NOT NULL DEFAULT '代码助手'");
  }

  if (!columnNames.has("setup_completed")) {
    db.exec("ALTER TABLE butler_profiles ADD COLUMN setup_completed INTEGER NOT NULL DEFAULT 0 CHECK (setup_completed IN (0, 1))");
  }

  ensureButlerOwnershipPreSchemaCompatibility(db);
}

function ensureUserPreferenceProfileSchema(db: BetterSqliteDatabase): void {
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

  if (!columnNames.has("affairs_dashboard_states_json")) {
    db.exec(`ALTER TABLE user_preference_profiles
      ADD COLUMN affairs_dashboard_states_json TEXT NOT NULL DEFAULT '{}'`);
  }

  migrateLegacyAffairsShortcutAppsColumn(db, columnNames);
}

interface UserPreferenceProfileLegacyRow {
  user_id: string;
  language: string;
  theme: string;
  auto_theme: number;
  default_permission_mode: string;
  providers_json: string;
  debug_port_pools_json: string;
  affairs_dashboard_states_json: string;
  affairs_shortcut_apps_json: string;
  created_at: string;
  updated_at: string;
}

function migrateLegacyAffairsShortcutAppsColumn(
  db: BetterSqliteDatabase,
  columnNames?: Set<string>
): void {
  if (!tableExists(db, "user_preference_profiles")) {
    return;
  }

  const resolvedColumnNames = columnNames
    ?? new Set(
      (db.prepare("PRAGMA table_info(user_preference_profiles)").all() as Array<{ name: string }>)
        .map((column) => column.name)
    );

  if (!resolvedColumnNames.has("affairs_shortcut_apps_json")) {
    return;
  }

  const rows = db
    .prepare(
      `SELECT
        user_id,
        language,
        theme,
        auto_theme,
        default_permission_mode,
        providers_json,
        debug_port_pools_json,
        affairs_dashboard_states_json,
        affairs_shortcut_apps_json,
        created_at,
        updated_at
      FROM user_preference_profiles`
    )
    .all() as UserPreferenceProfileLegacyRow[];

  const migratedRows = rows.map((row) => ({
    ...row,
    affairs_dashboard_states_json: JSON.stringify(
      mergeLegacyShortcutAppsIntoDashboardStates(
        parseJsonObjectRecord(row.affairs_dashboard_states_json),
        parseJsonObjectRecord(row.affairs_shortcut_apps_json)
      )
    )
  }));

  db.exec("BEGIN IMMEDIATE");

  try {
    db.exec(`
      ALTER TABLE user_preference_profiles RENAME TO user_preference_profiles_legacy;

      CREATE TABLE user_preference_profiles (
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
      )
    `);

    const insertStatement = db.prepare(`
      INSERT INTO user_preference_profiles (
        user_id,
        language,
        theme,
        auto_theme,
        default_permission_mode,
        providers_json,
        debug_port_pools_json,
        affairs_dashboard_states_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of migratedRows) {
      insertStatement.run(
        row.user_id,
        row.language,
        row.theme,
        row.auto_theme,
        row.default_permission_mode,
        row.providers_json,
        row.debug_port_pools_json,
        row.affairs_dashboard_states_json,
        row.created_at,
        row.updated_at
      );
    }

    db.exec("DROP TABLE user_preference_profiles_legacy");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseJsonObjectRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return { ...parsed };
  } catch {
    return {};
  }
}

function mergeLegacyShortcutAppsIntoDashboardStates(
  dashboardStatesByWorkspace: Record<string, unknown>,
  legacyShortcutAppsByWorkspace: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...dashboardStatesByWorkspace
  };

  for (const [workspaceId, shortcutApps] of Object.entries(legacyShortcutAppsByWorkspace)) {
    const normalizedWorkspaceId = workspaceId.trim();

    if (!normalizedWorkspaceId || Object.prototype.hasOwnProperty.call(result, normalizedWorkspaceId)) {
      continue;
    }

    if (!Array.isArray(shortcutApps)) {
      continue;
    }

    result[normalizedWorkspaceId] = {
      workspaceId: normalizedWorkspaceId,
      shortcutApps
    };
  }

  return result;
}

function ensureUserAffairsLibrarySettingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_affairs_library_settings")) {
    db.exec(`
      CREATE TABLE user_affairs_library_settings (
        user_id TEXT PRIMARY KEY,
        root_dir TEXT,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        favorites_json TEXT,
        last_workspace_id TEXT,
        dashboard_state_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id)
      )
    `);
  }

  const columns = db
    .prepare("PRAGMA table_info(user_affairs_library_settings)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("favorites_json")) {
    db.exec("ALTER TABLE user_affairs_library_settings ADD COLUMN favorites_json TEXT");
  }

  if (!columnNames.has("last_workspace_id")) {
    db.exec("ALTER TABLE user_affairs_library_settings ADD COLUMN last_workspace_id TEXT");
  }

  if (!columnNames.has("dashboard_state_json")) {
    db.exec("ALTER TABLE user_affairs_library_settings ADD COLUMN dashboard_state_json TEXT NOT NULL DEFAULT '{}'");
  }

  migrateLegacyAffairsLibrarySettings(db);
  migrateLegacyDashboardStatesIntoGlobalAffairsSettings(db);
}

interface LegacyDashboardProfileRow {
  user_id: string;
  affairs_dashboard_states_json: string;
}

function migrateLegacyDashboardStatesIntoGlobalAffairsSettings(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_preference_profiles") || !tableExists(db, "user_affairs_library_settings")) {
    return;
  }

  const rows = db
    .prepare("SELECT user_id, affairs_dashboard_states_json FROM user_preference_profiles")
    .all() as LegacyDashboardProfileRow[];

  const updateStatement = db.prepare(`
    UPDATE user_affairs_library_settings
    SET dashboard_state_json = ?
    WHERE user_id = ?
      AND (dashboard_state_json IS NULL OR TRIM(dashboard_state_json) = '' OR dashboard_state_json = '{}')
  `);

  for (const row of rows) {
    const dashboardState = pickLatestLegacyDashboardState(
      parseJsonObjectRecord(row.affairs_dashboard_states_json)
    );

    if (!dashboardState) {
      continue;
    }

    updateStatement.run(JSON.stringify(dashboardState), row.user_id);
  }
}

function pickLatestLegacyDashboardState(
  dashboardStatesByWorkspace: Record<string, unknown>
): Record<string, unknown> | null {
  const candidates = Object.entries(dashboardStatesByWorkspace)
    .map(([workspaceId, rawState]) => normalizeLegacyDashboardStateCandidate(workspaceId, rawState))
    .filter((item): item is { state: Record<string, unknown>; score: number; updatedAt: string } => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  return candidates[0]?.state ?? null;
}

function normalizeLegacyDashboardStateCandidate(
  workspaceId: string,
  rawState: unknown
): { state: Record<string, unknown>; score: number; updatedAt: string } | null {
  if (typeof rawState !== "object" || rawState === null || Array.isArray(rawState)) {
    return null;
  }

  const state: Record<string, unknown> = {
    ...(rawState as Record<string, unknown>),
    workspaceId: "affairs-global"
  };
  const shortcutApps = Array.isArray(state.shortcutApps) ? state.shortcutApps : [];
  const tabs = Array.isArray(state.tabs) ? state.tabs : [];
  const widgetCount = tabs.reduce((total: number, tab: unknown) => {
    if (typeof tab !== "object" || tab === null || Array.isArray(tab)) {
      return total;
    }
    return total + (Array.isArray((tab as Record<string, unknown>).widgets) ? ((tab as Record<string, unknown>).widgets as unknown[]).length : 0);
  }, 0);
  const updatedAt = typeof state.updatedAt === "string" && state.updatedAt.trim()
    ? state.updatedAt.trim()
    : "";

  return {
    state,
    score: shortcutApps.length * 100 + widgetCount,
    updatedAt: updatedAt || workspaceId
  };
}

function ensureUserTeableGlobalSettingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_global_settings")) {
    db.exec(`
      CREATE TABLE user_teable_global_settings (
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
      )
    `);
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(user_teable_global_settings)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("base_id")) {
    db.exec("ALTER TABLE user_teable_global_settings ADD COLUMN base_id TEXT");
  }

  if (!columnNames.has("mirror_mode")) {
    db.exec("ALTER TABLE user_teable_global_settings ADD COLUMN mirror_mode TEXT NOT NULL DEFAULT 'manual'");
  }
}

function ensureUserTeableCredentialsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_credentials")) {
    db.exec(`
      CREATE TABLE user_teable_credentials (
        user_id TEXT NOT NULL,
        auth_ref TEXT NOT NULL,
        token_ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, auth_ref),
        FOREIGN KEY (user_id) REFERENCES auth_users(id)
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_credentials_user_updated_at
      ON user_teable_credentials(user_id, updated_at DESC)
  `);
}

function ensureUserTeableWorkbenchSyncConfigsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_workbench_sync_configs")) {
    db.exec(`
      CREATE TABLE user_teable_workbench_sync_configs (
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
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_teable_workbench_sync_configs_user
        ON user_teable_workbench_sync_configs(user_id, source_type)
    `);
    return;
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_workbench_sync_configs_user
      ON user_teable_workbench_sync_configs(user_id, source_type)
  `);
}

function ensureUserTeableMirrorTableBindingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_mirror_table_bindings")) {
    db.exec(`
      CREATE TABLE user_teable_mirror_table_bindings (
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
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_mirror_table_bindings_user
      ON user_teable_mirror_table_bindings(user_id, mirror_type)
  `);
}

function ensureUserTeableMirrorRecordMappingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_mirror_record_mappings")) {
    db.exec(`
      CREATE TABLE user_teable_mirror_record_mappings (
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
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_mirror_record_mappings_user
      ON user_teable_mirror_record_mappings(user_id, mirror_type, updated_at DESC)
  `);
}

function ensureUserTeableFormBindingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_form_bindings")) {
    db.exec(`
      CREATE TABLE user_teable_form_bindings (
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
      )
    `);
  }

  const columns = db
    .prepare("PRAGMA table_info(user_teable_form_bindings)")
    .all() as Array<{ name?: string }>;
  const columnNames = new Set(columns.map((item) => item.name ?? ""));
  if (!columnNames.has("source_workspace_ids_json")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN source_workspace_ids_json TEXT NOT NULL DEFAULT '[]'");
    db.exec(`
      UPDATE user_teable_form_bindings
      SET source_workspace_ids_json = json_array(workspace_id)
      WHERE COALESCE(TRIM(source_workspace_ids_json), '') = ''
         OR source_workspace_ids_json = '[]'
    `);
  }
  if (!columnNames.has("teable_table_id")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN teable_table_id TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE user_teable_form_bindings SET teable_table_id = table_id WHERE COALESCE(TRIM(teable_table_id), '') = ''");
  }
  if (!columnNames.has("teable_view_id")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN teable_view_id TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE user_teable_form_bindings SET teable_view_id = view_id WHERE COALESCE(TRIM(teable_view_id), '') = ''");
  }
  if (!columnNames.has("teable_share_id")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN teable_share_id TEXT");
  }
  if (!columnNames.has("teable_form_name")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN teable_form_name TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE user_teable_form_bindings SET teable_form_name = name WHERE COALESCE(TRIM(teable_form_name), '') = ''");
  }
  if (!columnNames.has("display_name")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE user_teable_form_bindings SET display_name = name WHERE COALESCE(TRIM(display_name), '') = ''");
  }
  if (!columnNames.has("open_mode")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN open_mode TEXT NOT NULL DEFAULT 'embed'");
  }
  if (!columnNames.has("enabled")) {
    db.exec("ALTER TABLE user_teable_form_bindings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_form_bindings_user_workspace
      ON user_teable_form_bindings(user_id, workspace_id, updated_at DESC)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_form_bindings_user_enabled
      ON user_teable_form_bindings(user_id, enabled, updated_at DESC)
  `);
}

function ensureUserTeableFieldMappingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_field_mappings")) {
    db.exec(`
      CREATE TABLE user_teable_field_mappings (
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
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_field_mappings_user
      ON user_teable_field_mappings(user_id, source_type, updated_at DESC)
  `);
}


function ensureUserTeableInboundRecordMappingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "user_teable_inbound_record_mappings")) {
    db.exec(`
      CREATE TABLE user_teable_inbound_record_mappings (
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
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_teable_inbound_record_mappings_user_form
      ON user_teable_inbound_record_mappings(user_id, form_binding_id, updated_at DESC)
  `);
}

function migrateLegacyAffairsLibrarySettings(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "workspace_navigation_states") || !tableExists(db, "user_affairs_library_settings")) {
    return;
  }

  db.exec(`
    INSERT INTO user_affairs_library_settings (
      user_id,
      root_dir,
      enabled,
      favorites_json,
      last_workspace_id,
      created_at,
      updated_at
    )
    SELECT
      legacy.user_id,
      legacy.affairs_library_root_path,
      legacy.affairs_library_enabled,
      legacy.affairs_library_favorites_json,
      legacy.workspace_id,
      legacy.updated_at,
      legacy.updated_at
    FROM (
      SELECT
        workspace_id,
        user_id,
        affairs_library_root_path,
        affairs_library_enabled,
        affairs_library_favorites_json,
        updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY datetime(updated_at) DESC
        ) AS row_number
      FROM workspace_navigation_states
      WHERE affairs_library_root_path IS NOT NULL
        AND TRIM(affairs_library_root_path) <> ''
    ) AS legacy
    WHERE legacy.row_number = 1
      AND NOT EXISTS (
        SELECT 1
        FROM user_affairs_library_settings AS current
        WHERE current.user_id = legacy.user_id
      )
  `);
}

function ensureManagedSkillScopeSchema(db: BetterSqliteDatabase): void {
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

function ensureSkillTargetBindingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "skill_target_bindings")) {
    return;
  }

  const tableSqlRow = db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'skill_target_bindings'`
    )
    .get() as { sql: string | null } | undefined;

  if (tableSqlRow?.sql?.includes("'deepseek-harness'")) {
    return;
  }

  db.exec("DROP INDEX IF EXISTS idx_skill_target_bindings_target_cli");
  db.exec("PRAGMA foreign_keys = OFF");

  try {
    db.exec("BEGIN");
    db.exec(`
      CREATE TABLE skill_target_bindings__next (
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
    `);
    db.exec(`
      INSERT INTO skill_target_bindings__next (
        skill_id,
        target_cli,
        enabled,
        sync_status,
        last_synced_at,
        last_error_code,
        last_error_detail
      )
      SELECT
        skill_id,
        target_cli,
        enabled,
        sync_status,
        last_synced_at,
        last_error_code,
        last_error_detail
      FROM skill_target_bindings;
    `);
    db.exec("DROP TABLE skill_target_bindings");
    db.exec("ALTER TABLE skill_target_bindings__next RENAME TO skill_target_bindings");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_skill_target_bindings_target_cli
      ON skill_target_bindings(target_cli, sync_status, enabled);
  `);
}

function ensureButlerControlSessionSchema(db: BetterSqliteDatabase): void {
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

function ensureButlerControlTimerSchema(db: BetterSqliteDatabase): void {
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

function ensureAssistantAutomationSchema(db: BetterSqliteDatabase): void {
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

function ensureVerificationRunSchema(db: BetterSqliteDatabase): void {
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

function ensureDocumentTemplateSchema(db: BetterSqliteDatabase): void {
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

function ensureOnlyOfficeSettingsSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "office_onlyoffice_settings")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(office_onlyoffice_settings)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("user_display_name")) {
    db.exec("ALTER TABLE office_onlyoffice_settings ADD COLUMN user_display_name TEXT");
  }

  if (!columnNames.has("user_avatar_url")) {
    db.exec("ALTER TABLE office_onlyoffice_settings ADD COLUMN user_avatar_url TEXT");
  }
}

function ensureButlerInboxSchema(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(butler_inbox_items)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "assistant_state_json")) {
    return;
  }

  db.exec("ALTER TABLE butler_inbox_items ADD COLUMN assistant_state_json TEXT NOT NULL DEFAULT '{}'");
}

function ensureButlerFollowUpTaskSchema(db: BetterSqliteDatabase): void {
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

function ensureInstanceTailscaleStatusSchema(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(instance_tailscale_status)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "account_name")) {
    return;
  }

  db.exec("ALTER TABLE instance_tailscale_status ADD COLUMN account_name TEXT");
}

function ensureInstanceTailscaleConfigSchema(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(instance_tailscale_config)")
    .all() as Array<{ name: string }>;

  if (columns.length === 0 || columns.some((column) => column.name === "activated")) {
    return;
  }

  db.exec("ALTER TABLE instance_tailscale_config ADD COLUMN activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1))");
  db.exec("UPDATE instance_tailscale_config SET activated = enabled");
}

function ensureInstanceRelayTunnelConfigSchema(db: BetterSqliteDatabase): void {
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

function ensureSessionProviderSchema(db: BetterSqliteDatabase): void {
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

function ensureSessionBindingPresetSchema(db: BetterSqliteDatabase): void {
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

  if (!columnNames.has("selected_model")) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN selected_model TEXT");
  }
}

function ensureSessionBindingUserSchema(db: BetterSqliteDatabase): void {
  if (!tableExists(db, "session_bindings")) {
    return;
  }

  const columns = db
    .prepare("PRAGMA table_info(session_bindings)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("user_id")) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN user_id TEXT");
  }

  if (tableHasColumn(db, "workspaces", "owner_user_id")) {
    db.exec(`
      UPDATE session_bindings
      SET user_id = (
        SELECT owner_user_id
        FROM workspaces
        WHERE workspaces.id = session_bindings.workspace_id
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `);
  }

  const legacyOwnerUserId = readLegacyDefaultUserId(db);
  if (legacyOwnerUserId) {
    db.prepare(
      `UPDATE session_bindings
       SET user_id = ?
       WHERE user_id IS NULL OR TRIM(user_id) = ''`
    ).run(legacyOwnerUserId);
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_session_bindings_user_id ON session_bindings(user_id, workspace_id)");
}

function ensureSessionStateSchema(db: BetterSqliteDatabase): void {
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

function ensureSessionForkSchema(db: BetterSqliteDatabase): void {
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

function ensureSessionIndexArchiveColumn(db: BetterSqliteDatabase): void {
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

function ensureSessionRelationColumns(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(session_indices)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("session_visibility")) {
    db.exec(
      "ALTER TABLE session_indices ADD COLUMN session_visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (session_visibility IN ('workspace', 'affairs_lightweight'))"
    );
  }

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

function ensureSessionChangedFileTables(db: BetterSqliteDatabase): void {
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

function ensureAffairsAssistantSessionSnapshotSchema(db: BetterSqliteDatabase): void {
  const currentSql = readTableSql(db, "affairs_assistant_session_snapshots");

  if (!currentSql) {
    db.exec(`
      CREATE TABLE affairs_assistant_session_snapshots (
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
    `);
    return;
  }

  if (!currentSql.includes("FOREIGN KEY (workspace_id) REFERENCES workspaces(id)")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_affairs_assistant_session_snapshots_user_id
        ON affairs_assistant_session_snapshots(user_id, updated_at DESC);
    `);
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;

    DROP TABLE IF EXISTS affairs_assistant_session_snapshots_next;

    CREATE TABLE affairs_assistant_session_snapshots_next (
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

    INSERT INTO affairs_assistant_session_snapshots_next (
      workspace_id,
      user_id,
      project_id,
      project_workspace_id,
      agent_workspace_path,
      sessions_json,
      updated_at
    )
    SELECT
      workspace_id,
      user_id,
      project_id,
      project_workspace_id,
      agent_workspace_path,
      sessions_json,
      updated_at
    FROM affairs_assistant_session_snapshots;

    DROP TABLE affairs_assistant_session_snapshots;

    ALTER TABLE affairs_assistant_session_snapshots_next
      RENAME TO affairs_assistant_session_snapshots;

    PRAGMA foreign_keys = ON;

    CREATE INDEX IF NOT EXISTS idx_affairs_assistant_session_snapshots_user_id
      ON affairs_assistant_session_snapshots(user_id, updated_at DESC);
  `);
}

function ensureTerminalCommandTemplatePortColumn(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "port")) {
    return;
  }

  db.exec("ALTER TABLE terminal_command_templates ADD COLUMN port INTEGER");
}

function ensureTerminalCommandTemplateShellColumn(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "shell")) {
    return;
  }

  db.exec("ALTER TABLE terminal_command_templates ADD COLUMN shell TEXT");
}

function ensureTerminalCommandTemplateRuntimeTypeColumn(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_command_templates)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "runtime_type")) {
    return;
  }

  db.exec("ALTER TABLE terminal_command_templates ADD COLUMN runtime_type TEXT");
}

function ensureTerminalCommandTemplateProxySchema(db: BetterSqliteDatabase): void {
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

function ensureTerminalInstanceProcessIdColumn(db: BetterSqliteDatabase): void {
  const columns = db
    .prepare("PRAGMA table_info(terminal_instances)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "process_id")) {
    return;
  }

  db.exec("ALTER TABLE terminal_instances ADD COLUMN process_id INTEGER");
}

function ensureTerminalRuntimeSchema(db: BetterSqliteDatabase): void {
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

function ensureTerminalLogSchema(db: BetterSqliteDatabase): void {
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

function ensureDebugTargetSchema(db: BetterSqliteDatabase): void {
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

function ensureFrameworkAnalysisSchema(db: BetterSqliteDatabase): void {
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

function ensureDebugRuntimeSchema(db: BetterSqliteDatabase): void {
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

function ensurePortLeaseSchema(db: BetterSqliteDatabase): void {
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

function ensureRuntimeBindingSchema(db: BetterSqliteDatabase): void {
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

function ensureAiFallbackEditSchema(db: BetterSqliteDatabase): void {
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

function ensureTerminalCommandTemplateDebugSchema(db: BetterSqliteDatabase): void {
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

function ensureTerminalInstanceDebugSchema(db: BetterSqliteDatabase): void {
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

function readTableSql(db: BetterSqliteDatabase, tableName: string): string {
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
