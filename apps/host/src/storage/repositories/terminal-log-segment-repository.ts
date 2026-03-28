import type Database from "better-sqlite3";

import type { TerminalLogSegment } from "../../types/domain.js";

export class TerminalLogSegmentRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: TerminalLogSegment): TerminalLogSegment {
    this.db
      .prepare(
        `INSERT INTO terminal_log_segments (
          id,
          terminal_id,
          file_id,
          start_seq,
          end_seq,
          start_offset,
          end_offset,
          byte_length,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.terminalId,
        record.fileId,
        record.startSeq,
        record.endSeq,
        record.startOffset,
        record.endOffset,
        record.byteLength,
        record.createdAt
      );

    return record;
  }

  findLatestByTerminalId(terminalId: string): TerminalLogSegment | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          terminal_id,
          file_id,
          start_seq,
          end_seq,
          start_offset,
          end_offset,
          byte_length,
          created_at
        FROM terminal_log_segments
        WHERE terminal_id = ?
        ORDER BY end_seq DESC, created_at DESC
        LIMIT 1`
      )
      .get(terminalId) as TerminalLogSegmentRow | undefined;

    return row ? mapTerminalLogSegmentRow(row) : null;
  }

  listByTerminalId(terminalId: string, limit?: number): TerminalLogSegment[] {
    const resolvedLimit = normalizeLimit(limit);

    return this.db
      .prepare(
        `SELECT
          id,
          terminal_id,
          file_id,
          start_seq,
          end_seq,
          start_offset,
          end_offset,
          byte_length,
          created_at
        FROM terminal_log_segments
        WHERE terminal_id = ?
        ORDER BY start_seq DESC, created_at DESC
        LIMIT ?`
      )
      .all(terminalId, resolvedLimit)
      .map((row) => mapTerminalLogSegmentRow(row as TerminalLogSegmentRow));
  }

  listBeforeSeq(terminalId: string, beforeSeq: number | null, limit: number): TerminalLogSegment[] {
    const resolvedLimit = normalizeLimit(limit);

    if (beforeSeq === null) {
      return this.listByTerminalId(terminalId, resolvedLimit);
    }

    return this.db
      .prepare(
        `SELECT
          id,
          terminal_id,
          file_id,
          start_seq,
          end_seq,
          start_offset,
          end_offset,
          byte_length,
          created_at
        FROM terminal_log_segments
        WHERE terminal_id = ? AND start_seq < ?
        ORDER BY start_seq DESC, created_at DESC
        LIMIT ?`
      )
      .all(terminalId, beforeSeq, resolvedLimit)
      .map((row) => mapTerminalLogSegmentRow(row as TerminalLogSegmentRow));
  }

  deleteByTerminalId(terminalId: string): void {
    this.db
      .prepare(
        `DELETE FROM terminal_log_segments
         WHERE terminal_id = ?`
      )
      .run(terminalId);
  }
}

interface TerminalLogSegmentRow {
  id: string;
  terminal_id: string;
  file_id: string;
  start_seq: number;
  end_seq: number;
  start_offset: number;
  end_offset: number;
  byte_length: number;
  created_at: string;
}

function mapTerminalLogSegmentRow(row: TerminalLogSegmentRow): TerminalLogSegment {
  return {
    id: row.id,
    terminalId: row.terminal_id,
    fileId: row.file_id,
    startSeq: row.start_seq,
    endSeq: row.end_seq,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    byteLength: row.byte_length,
    createdAt: row.created_at
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || (limit ?? 0) <= 0) {
    return 50;
  }

  return Math.min(limit as number, 200);
}
