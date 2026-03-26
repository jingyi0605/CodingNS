import type Database from "better-sqlite3";

import type {
  TerminalRuntimeSession,
  TerminalRuntimeSessionState,
  TerminalRuntimeType
} from "../../types/domain.js";

interface UpdateTerminalRuntimeSessionStateInput {
  id: string;
  shellPid: number | null;
  agentPid?: number | null;
  hostInstanceId?: string | null;
  state: TerminalRuntimeSessionState;
  lastHeartbeatAt?: string | null;
  lastCheckedAt?: string | null;
  lastErrorDetail?: string | null;
  updatedAt: string;
}

export class TerminalRuntimeSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: TerminalRuntimeSession): TerminalRuntimeSession {
    this.db
      .prepare(
        `INSERT INTO terminal_runtime_sessions (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.terminalId,
        record.runtimeType,
        record.sessionKey,
        record.attachTarget,
        record.hostInstanceId,
        record.agentPid,
        record.shellPid,
        record.state,
        record.lastHeartbeatAt,
        record.lastCheckedAt,
        record.lastErrorDetail,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): TerminalRuntimeSession | null {
    const row = this.db
      .prepare(
        `SELECT
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
        FROM terminal_runtime_sessions
        WHERE id = ?`
      )
      .get(id) as TerminalRuntimeSessionRow | undefined;

    return row ? mapTerminalRuntimeSessionRow(row) : null;
  }

  listByTerminalId(terminalId: string): TerminalRuntimeSession[] {
    return this.db
      .prepare(
        `SELECT
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
        FROM terminal_runtime_sessions
        WHERE terminal_id = ?
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(terminalId)
      .map((row) => mapTerminalRuntimeSessionRow(row as TerminalRuntimeSessionRow));
  }

  listRecoverable(): TerminalRuntimeSession[] {
    return this.db
      .prepare(
        `SELECT
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
        FROM terminal_runtime_sessions
        WHERE state IN ('starting', 'running', 'lost')
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all()
      .map((row) => mapTerminalRuntimeSessionRow(row as TerminalRuntimeSessionRow));
  }

  updateState(input: UpdateTerminalRuntimeSessionStateInput): void {
    this.db
      .prepare(
        `UPDATE terminal_runtime_sessions
         SET host_instance_id = ?,
             agent_pid = ?,
             shell_pid = ?,
             state = ?,
             last_heartbeat_at = ?,
             last_checked_at = ?,
             last_error_detail = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.hostInstanceId ?? null,
        input.agentPid ?? null,
        input.shellPid,
        input.state,
        input.lastHeartbeatAt ?? null,
        input.lastCheckedAt ?? null,
        input.lastErrorDetail ?? null,
        input.updatedAt,
        input.id
      );
  }

  deleteByTerminalId(terminalId: string): void {
    this.db
      .prepare(
        `DELETE FROM terminal_runtime_sessions
         WHERE terminal_id = ?`
      )
      .run(terminalId);
  }
}

interface TerminalRuntimeSessionRow {
  id: string;
  terminal_id: string;
  runtime_type: TerminalRuntimeType;
  session_key: string;
  attach_target: string;
  host_instance_id: string | null;
  agent_pid: number | null;
  shell_pid: number | null;
  state: TerminalRuntimeSessionState;
  last_heartbeat_at: string | null;
  last_checked_at: string | null;
  last_error_detail: string | null;
  created_at: string;
  updated_at: string;
}

function mapTerminalRuntimeSessionRow(row: TerminalRuntimeSessionRow): TerminalRuntimeSession {
  return {
    id: row.id,
    terminalId: row.terminal_id,
    runtimeType: row.runtime_type,
    sessionKey: row.session_key,
    attachTarget: row.attach_target,
    hostInstanceId: row.host_instance_id,
    agentPid: row.agent_pid,
    shellPid: row.shell_pid,
    state: row.state,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastCheckedAt: row.last_checked_at,
    lastErrorDetail: row.last_error_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
