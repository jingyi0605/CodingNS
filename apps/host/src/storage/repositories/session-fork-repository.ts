import type Database from "better-sqlite3";

import type { SessionForkRecord } from "../../types/domain.js";

export class SessionForkRepository {
  private readonly upsertStatement: Database.Statement<any[], any>;
  private readonly findBySessionIdStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.upsertStatement = this.db.prepare(
      `INSERT INTO session_forks (
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         parent_session_id = excluded.parent_session_id,
         provider = excluded.provider,
         fork_source_type = excluded.fork_source_type,
         fork_source_session_id = excluded.fork_source_session_id,
         fork_source_message_id = excluded.fork_source_message_id,
         inherited_prefix_message_count = excluded.inherited_prefix_message_count,
         provider_parent_session_id = excluded.provider_parent_session_id,
         provider_source_message_id = excluded.provider_source_message_id,
         fork_method = excluded.fork_method,
         created_at = excluded.created_at`
    );
    this.findBySessionIdStatement = this.db.prepare(
      `SELECT
         session_id AS session_id,
         parent_session_id AS parent_session_id,
         provider AS provider,
         fork_source_type AS fork_source_type,
         fork_source_session_id AS fork_source_session_id,
         fork_source_message_id AS fork_source_message_id,
         inherited_prefix_message_count AS inherited_prefix_message_count,
         provider_parent_session_id AS provider_parent_session_id,
         provider_source_message_id AS provider_source_message_id,
         fork_method AS fork_method,
         created_at AS created_at
       FROM session_forks
       WHERE session_id = ?`
    );
  }

  upsert(record: SessionForkRecord): void {
    this.upsertStatement
      .run(
        record.sessionId,
        record.parentSessionId,
        record.provider,
        record.forkSourceType,
        record.forkSourceSessionId,
        record.forkSourceMessageId,
        record.inheritedPrefixMessageCount,
        record.providerParentSessionId,
        record.providerSourceMessageId,
        record.forkMethod,
        record.createdAt
      );
  }

  findBySessionId(sessionId: string): SessionForkRecord | null {
    const row = this.findBySessionIdStatement.get(sessionId) as SessionForkRow | undefined;

    return row ? mapSessionForkRow(row) : null;
  }
}

interface SessionForkRow {
  session_id: string;
  parent_session_id: string;
  provider: SessionForkRecord["provider"];
  fork_source_type: SessionForkRecord["forkSourceType"];
  fork_source_session_id: string;
  fork_source_message_id: string | null;
  inherited_prefix_message_count: number;
  provider_parent_session_id: string | null;
  provider_source_message_id: string | null;
  fork_method: SessionForkRecord["forkMethod"];
  created_at: string;
}

function mapSessionForkRow(row: SessionForkRow): SessionForkRecord {
  return {
    sessionId: row.session_id,
    parentSessionId: row.parent_session_id,
    provider: row.provider,
    forkSourceType: row.fork_source_type,
    forkSourceSessionId: row.fork_source_session_id,
    forkSourceMessageId: row.fork_source_message_id,
    inheritedPrefixMessageCount: row.inherited_prefix_message_count,
    providerParentSessionId: row.provider_parent_session_id,
    providerSourceMessageId: row.provider_source_message_id,
    forkMethod: row.fork_method,
    createdAt: row.created_at
  };
}
