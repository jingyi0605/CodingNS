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
  ensureSessionStateSchema(db);
  ensureSessionIndexArchiveColumn(db);
  ensureSessionChangedFileTables(db);
  ensureTerminalCommandTemplatePortColumn(db);

  return {
    db,
    close: () => db.close()
  };
}

function ensureSessionStateSchema(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(session_states)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("activity_source") && !columnNames.has("is_archived")) {
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
  const updatedAtExpr = columnNames.has("updated_at") ? "updated_at" : "CURRENT_TIMESTAMP";

  db.exec(`
    CREATE TABLE session_states_next (
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      running_state TEXT NOT NULL CHECK (
        running_state IN ('idle', 'starting', 'running', 'completed', 'interrupted', 'failed')
      ),
      activity_source TEXT NOT NULL CHECK (activity_source IN ('none', 'runtime', 'inferred')),
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
