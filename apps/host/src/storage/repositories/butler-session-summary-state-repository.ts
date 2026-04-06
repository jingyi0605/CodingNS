import type Database from "better-sqlite3";

import type { ButlerSessionSummaryState } from "../../types/domain.js";

export class ButlerSessionSummaryStateRepository {
  constructor(private readonly db: Database.Database) {}

  findByButlerSessionId(butlerSessionId: string): ButlerSessionSummaryState | null {
    const row = this.db
      .prepare(
        `SELECT
           butler_session_id,
           source_message_count,
           source_last_message_at,
           last_summarized_at,
           last_summarized_sequence,
           debounce_until,
           status,
           error_detail,
           updated_at
         FROM butler_session_summary_states
         WHERE butler_session_id = ?`
      )
      .get(butlerSessionId) as ButlerSessionSummaryStateRow | undefined;

    return row ? mapButlerSessionSummaryStateRow(row) : null;
  }

  upsert(record: ButlerSessionSummaryState): ButlerSessionSummaryState {
    this.db
      .prepare(
        `INSERT INTO butler_session_summary_states (
           butler_session_id,
           source_message_count,
           source_last_message_at,
           last_summarized_at,
           last_summarized_sequence,
           debounce_until,
           status,
           error_detail,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(butler_session_id) DO UPDATE SET
           source_message_count = excluded.source_message_count,
           source_last_message_at = excluded.source_last_message_at,
           last_summarized_at = excluded.last_summarized_at,
           last_summarized_sequence = excluded.last_summarized_sequence,
           debounce_until = excluded.debounce_until,
           status = excluded.status,
           error_detail = excluded.error_detail,
           updated_at = excluded.updated_at`
      )
      .run(
        record.butlerSessionId,
        record.sourceMessageCount,
        record.sourceLastMessageAt,
        record.lastSummarizedAt,
        record.lastSummarizedSequence,
        record.debounceUntil,
        record.status,
        record.errorDetail,
        record.updatedAt
      );

    return record;
  }
}

interface ButlerSessionSummaryStateRow {
  butler_session_id: string;
  source_message_count: number;
  source_last_message_at: string | null;
  last_summarized_at: string | null;
  last_summarized_sequence: number | null;
  debounce_until: string | null;
  status: ButlerSessionSummaryState["status"];
  error_detail: string | null;
  updated_at: string;
}

function mapButlerSessionSummaryStateRow(row: ButlerSessionSummaryStateRow): ButlerSessionSummaryState {
  return {
    butlerSessionId: row.butler_session_id,
    sourceMessageCount: row.source_message_count,
    sourceLastMessageAt: row.source_last_message_at,
    lastSummarizedAt: row.last_summarized_at,
    lastSummarizedSequence: row.last_summarized_sequence,
    debounceUntil: row.debounce_until,
    status: row.status,
    errorDetail: row.error_detail,
    updatedAt: row.updated_at
  };
}
