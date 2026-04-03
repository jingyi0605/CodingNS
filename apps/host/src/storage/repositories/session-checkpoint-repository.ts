import type Database from "better-sqlite3";

import type { SessionCheckpoint } from "../../types/domain.js";

export class SessionCheckpointRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: SessionCheckpoint): SessionCheckpoint {
    this.db
      .prepare(
        `INSERT INTO session_checkpoints (
           id,
           butler_session_id,
           checkpoint_seq,
           source_kind,
           progress_state,
           summary,
           risk_flags_json,
           next_action_json,
           captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.butlerSessionId,
        record.checkpointSeq,
        record.sourceKind,
        record.progressState,
        record.summary,
        JSON.stringify(record.riskFlags),
        JSON.stringify(record.nextActions),
        record.capturedAt
      );

    return record;
  }

  listByButlerSessionId(butlerSessionId: string, limit = 20): SessionCheckpoint[] {
    return this.db
      .prepare(
        `SELECT
           id,
           butler_session_id,
           checkpoint_seq,
           source_kind,
           progress_state,
           summary,
           risk_flags_json,
           next_action_json,
           captured_at
         FROM session_checkpoints
         WHERE butler_session_id = ?
         ORDER BY checkpoint_seq DESC
         LIMIT ?`
      )
      .all(butlerSessionId, limit)
      .map((row) => mapSessionCheckpointRow(row as SessionCheckpointRow));
  }

  getLatestSeq(butlerSessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(checkpoint_seq) AS checkpoint_seq
         FROM session_checkpoints
         WHERE butler_session_id = ?`
      )
      .get(butlerSessionId) as { checkpoint_seq: number | null } | undefined;

    return row?.checkpoint_seq ?? 0;
  }
}

interface SessionCheckpointRow {
  id: string;
  butler_session_id: string;
  checkpoint_seq: number;
  source_kind: SessionCheckpoint["sourceKind"];
  progress_state: SessionCheckpoint["progressState"];
  summary: string;
  risk_flags_json: string;
  next_action_json: string;
  captured_at: string;
}

function mapSessionCheckpointRow(row: SessionCheckpointRow): SessionCheckpoint {
  return {
    id: row.id,
    butlerSessionId: row.butler_session_id,
    checkpointSeq: row.checkpoint_seq,
    sourceKind: row.source_kind,
    progressState: row.progress_state,
    summary: row.summary,
    riskFlags: parseJsonArray(row.risk_flags_json),
    nextActions: parseJsonArray(row.next_action_json),
    capturedAt: row.captured_at
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
