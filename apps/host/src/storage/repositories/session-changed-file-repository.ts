import type Database from "better-sqlite3";

import type {
  SessionChangedFileIndexState,
  SessionChangedFileRecord
} from "../../types/domain.js";

export class SessionChangedFileRepository {
  private readonly upsertManyStatement: Database.Statement<any[], any>;
  private readonly listBySessionIdStatement: Database.Statement<any[], any>;
  private readonly findIndexStateBySessionIdStatement: Database.Statement<any[], any>;
  private readonly upsertIndexStateStatement: Database.Statement<any[], any>;
  private readonly deleteFilesBySessionIdStatement: Database.Statement<any[], any>;
  private readonly deleteStatesBySessionIdStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.upsertManyStatement = this.db.prepare(
      `INSERT INTO session_changed_files (
         session_id,
         workspace_id,
         path,
         first_detected_at,
         last_detected_at,
         last_tool_name
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, path) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         first_detected_at = MIN(session_changed_files.first_detected_at, excluded.first_detected_at),
         last_detected_at = MAX(session_changed_files.last_detected_at, excluded.last_detected_at),
         last_tool_name = COALESCE(excluded.last_tool_name, session_changed_files.last_tool_name)`
    );
    this.listBySessionIdStatement = this.db.prepare(
      `SELECT
         session_id AS session_id,
         workspace_id AS workspace_id,
         path AS path,
         first_detected_at AS first_detected_at,
         last_detected_at AS last_detected_at,
         last_tool_name AS last_tool_name
       FROM session_changed_files
       WHERE session_id = ?
       ORDER BY path ASC`
    );
    this.findIndexStateBySessionIdStatement = this.db.prepare(
      `SELECT
         session_id AS session_id,
         indexed_at AS indexed_at,
         updated_at AS updated_at
       FROM session_changed_file_states
       WHERE session_id = ?`
    );
    this.upsertIndexStateStatement = this.db.prepare(
      `INSERT INTO session_changed_file_states (
         session_id,
         indexed_at,
         updated_at
       ) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         indexed_at = excluded.indexed_at,
         updated_at = excluded.updated_at`
    );
    this.deleteFilesBySessionIdStatement = this.db.prepare(
      "DELETE FROM session_changed_files WHERE session_id = ?"
    );
    this.deleteStatesBySessionIdStatement = this.db.prepare(
      "DELETE FROM session_changed_file_states WHERE session_id = ?"
    );
  }

  upsertMany(records: SessionChangedFileRecord[]): void {
    if (records.length === 0) {
      return;
    }

    const persist = this.db.transaction((items: SessionChangedFileRecord[]) => {
      for (const record of items) {
        this.upsertManyStatement.run(
          record.sessionId,
          record.workspaceId,
          record.path,
          record.firstDetectedAt,
          record.lastDetectedAt,
          record.lastToolName
        );
      }
    });

    persist(records);
  }

  listBySessionId(sessionId: string): SessionChangedFileRecord[] {
    return this.listBySessionIdStatement.all(sessionId)
      .map((row) => mapSessionChangedFileRow(row as SessionChangedFileRow));
  }

  findIndexStateBySessionId(sessionId: string): SessionChangedFileIndexState | null {
    const row = this.findIndexStateBySessionIdStatement.get(sessionId) as
      | SessionChangedFileStateRow
      | undefined;

    return row ? mapSessionChangedFileStateRow(row) : null;
  }

  upsertIndexState(record: SessionChangedFileIndexState): void {
    this.upsertIndexStateStatement.run(record.sessionId, record.indexedAt, record.updatedAt);
  }

  deleteBySessionId(sessionId: string): void {
    this.deleteFilesBySessionIdStatement.run(sessionId);
    this.deleteStatesBySessionIdStatement.run(sessionId);
  }
}

interface SessionChangedFileRow {
  session_id: string;
  workspace_id: string;
  path: string;
  first_detected_at: string;
  last_detected_at: string;
  last_tool_name: string | null;
}

interface SessionChangedFileStateRow {
  session_id: string;
  indexed_at: string;
  updated_at: string;
}

function mapSessionChangedFileRow(row: SessionChangedFileRow): SessionChangedFileRecord {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    path: row.path,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    lastToolName: row.last_tool_name
  };
}

function mapSessionChangedFileStateRow(
  row: SessionChangedFileStateRow
): SessionChangedFileIndexState {
  return {
    sessionId: row.session_id,
    indexedAt: row.indexed_at,
    updatedAt: row.updated_at
  };
}
