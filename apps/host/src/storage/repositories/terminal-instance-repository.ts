import type Database from "better-sqlite3";

import type { TerminalInstance, TerminalStatus } from "../../types/domain.js";

interface UpdateTerminalLifecycleInput {
  id: string;
  status: TerminalStatus;
  lastActiveAt: string;
  closedAt?: string | null;
  exitCode?: number | null;
  statusDetail?: string | null;
}

export class TerminalInstanceRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: TerminalInstance): TerminalInstance {
    this.db
      .prepare(
        `INSERT INTO terminal_instances (
          id,
          workspace_id,
          name,
          cwd,
          shell,
          status,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.name,
        record.cwd,
        record.shell,
        record.status,
        record.createdByUserId,
        record.createdAt,
        record.lastActiveAt,
        record.closedAt,
        record.exitCode,
        record.statusDetail
      );

    return record;
  }

  findById(id: string): TerminalInstance | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          name,
          cwd,
          shell,
          status,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail
        FROM terminal_instances
        WHERE id = ?`
      )
      .get(id) as TerminalInstanceRow | undefined;

    return row ? mapTerminalInstanceRow(row) : null;
  }

  listByWorkspace(workspaceId: string): TerminalInstance[] {
    return this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          name,
          cwd,
          shell,
          status,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail
        FROM terminal_instances
        WHERE workspace_id = ?
        ORDER BY last_active_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapTerminalInstanceRow(row as TerminalInstanceRow));
  }

  updateLifecycle(input: UpdateTerminalLifecycleInput): void {
    this.db
      .prepare(
        `UPDATE terminal_instances
         SET status = ?,
             last_active_at = ?,
             closed_at = ?,
             exit_code = ?,
             status_detail = ?
         WHERE id = ?`
      )
      .run(
        input.status,
        input.lastActiveAt,
        input.closedAt ?? null,
        input.exitCode ?? null,
        input.statusDetail ?? null,
        input.id
      );
  }

  touchLastActiveAt(id: string, lastActiveAt: string): void {
    this.db
      .prepare(
        `UPDATE terminal_instances
         SET last_active_at = ?
         WHERE id = ?`
      )
      .run(lastActiveAt, id);
  }

  delete(id: string): void {
    this.db
      .prepare(
        `DELETE FROM terminal_instances
         WHERE id = ?`
      )
      .run(id);
  }
}

interface TerminalInstanceRow {
  id: string;
  workspace_id: string;
  name: string;
  cwd: string;
  shell: string;
  status: TerminalStatus;
  created_by_user_id: string;
  created_at: string;
  last_active_at: string;
  closed_at: string | null;
  exit_code: number | null;
  status_detail: string | null;
}

function mapTerminalInstanceRow(row: TerminalInstanceRow): TerminalInstance {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    cwd: row.cwd,
    shell: row.shell,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    closedAt: row.closed_at,
    exitCode: row.exit_code,
    statusDetail: row.status_detail
  };
}
