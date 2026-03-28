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

  db.exec(schema);
  ensureWorkspaceRemovalColumn(db);
  ensureSessionProviderSchema(db);
  ensureSessionStateSchema(db);
  ensureSessionIndexArchiveColumn(db);
  ensureSessionRelationColumns(db);
  ensureSessionChangedFileTables(db);
  ensureTerminalInstanceProcessIdColumn(db);
  ensureTerminalRuntimeSchema(db);
  ensureTerminalLogSchema(db);
  ensureTerminalCommandTemplatePortColumn(db);
  ensureTerminalCommandTemplateRuntimeTypeColumn(db);

  return {
    db,
    close: () => db.close()
  };
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
