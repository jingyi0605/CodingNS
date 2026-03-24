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
  ensureSessionStateArchiveColumn(db);
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

  if (columns.some((column) => column.name === "activity_source")) {
    return;
  }

  db.exec(`
    CREATE TABLE session_states_next (
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      running_state TEXT NOT NULL CHECK (
        running_state IN ('idle', 'starting', 'running', 'completed', 'interrupted', 'failed')
      ),
      activity_source TEXT NOT NULL CHECK (activity_source IN ('none', 'runtime', 'inferred')),
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
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
      CASE
        WHEN running_state = 'running' THEN 'running'
        ELSE 'idle'
      END,
      CASE
        WHEN running_state = 'running' THEN 'inferred'
        ELSE 'none'
      END,
      0,
      last_event_at,
      NULL,
      last_seen_at,
      updated_at
    FROM session_states;

    DROP TABLE session_states;
    ALTER TABLE session_states_next RENAME TO session_states;

    CREATE INDEX IF NOT EXISTS idx_session_states_user_id
      ON session_states(user_id, updated_at DESC);
  `);
}

function ensureSessionStateArchiveColumn(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(session_states)")
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "is_archived")) {
    return;
  }

  db.exec(`
    ALTER TABLE session_states
    ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
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
