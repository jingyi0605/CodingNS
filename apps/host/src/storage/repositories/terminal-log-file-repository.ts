import type Database from "better-sqlite3";

import type { TerminalLogFile, TerminalLogFileStatus } from "../../types/domain.js";

interface UpdateTerminalLogFileInput {
  id: string;
  status: TerminalLogFileStatus;
  endSeq: number | null;
  sizeBytes: number;
  updatedAt: string;
}

export class TerminalLogFileRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: TerminalLogFile): TerminalLogFile {
    this.db
      .prepare(
        `INSERT INTO terminal_log_files (
          id,
          terminal_id,
          relative_path,
          status,
          start_seq,
          end_seq,
          size_bytes,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.terminalId,
        record.relativePath,
        record.status,
        record.startSeq,
        record.endSeq,
        record.sizeBytes,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): TerminalLogFile | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          terminal_id,
          relative_path,
          status,
          start_seq,
          end_seq,
          size_bytes,
          created_at,
          updated_at
        FROM terminal_log_files
        WHERE id = ?`
      )
      .get(id) as TerminalLogFileRow | undefined;

    return row ? mapTerminalLogFileRow(row) : null;
  }

  findActiveByTerminalId(terminalId: string): TerminalLogFile | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          terminal_id,
          relative_path,
          status,
          start_seq,
          end_seq,
          size_bytes,
          created_at,
          updated_at
        FROM terminal_log_files
        WHERE terminal_id = ? AND status = 'active'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`
      )
      .get(terminalId) as TerminalLogFileRow | undefined;

    return row ? mapTerminalLogFileRow(row) : null;
  }

  listByTerminalId(terminalId: string): TerminalLogFile[] {
    return this.db
      .prepare(
        `SELECT
          id,
          terminal_id,
          relative_path,
          status,
          start_seq,
          end_seq,
          size_bytes,
          created_at,
          updated_at
        FROM terminal_log_files
        WHERE terminal_id = ?
        ORDER BY created_at DESC, id DESC`
      )
      .all(terminalId)
      .map((row) => mapTerminalLogFileRow(row as TerminalLogFileRow));
  }

  updateLifecycle(input: UpdateTerminalLogFileInput): void {
    this.db
      .prepare(
        `UPDATE terminal_log_files
         SET status = ?,
             end_seq = ?,
             size_bytes = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.status, input.endSeq, input.sizeBytes, input.updatedAt, input.id);
  }

  deleteByTerminalId(terminalId: string): void {
    this.db
      .prepare(
        `DELETE FROM terminal_log_files
         WHERE terminal_id = ?`
      )
      .run(terminalId);
  }
}

interface TerminalLogFileRow {
  id: string;
  terminal_id: string;
  relative_path: string;
  status: TerminalLogFileStatus;
  start_seq: number;
  end_seq: number | null;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

function mapTerminalLogFileRow(row: TerminalLogFileRow): TerminalLogFile {
  return {
    id: row.id,
    terminalId: row.terminal_id,
    relativePath: row.relative_path,
    status: row.status,
    startSeq: row.start_seq,
    endSeq: row.end_seq,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
