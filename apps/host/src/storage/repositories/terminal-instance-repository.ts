import type Database from "better-sqlite3";

import type { TerminalInstance, TerminalRuntimeType, TerminalStatus } from "../../types/domain.js";

interface UpdateTerminalLifecycleInput {
  id: string;
  status: TerminalStatus;
  processId: number | null;
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
          runtime_type,
          runtime_session_id,
          attach_target,
          status,
          process_id,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail,
          debug_runtime_session_id,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          launcher_source_type,
          launch_stage,
          failure_stage,
          adapter_kind,
          env_patch_summary_json,
          artifact_ref
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.name,
        record.cwd,
        record.shell,
        record.runtimeType,
        record.runtimeSessionId,
        record.attachTarget,
        record.status,
        record.processId,
        record.createdByUserId,
        record.createdAt,
        record.lastActiveAt,
        record.closedAt,
        record.exitCode,
        record.statusDetail,
        record.debugRuntimeSessionId ?? null,
        record.debugTargetId ?? null,
        record.debugServiceId ?? null,
        record.frameworkAnalysisId ?? null,
        record.launcherSourceType ?? null,
        record.launchStage ?? null,
        record.failureStage ?? null,
        record.adapterKind ?? null,
        record.envPatchSummary ? JSON.stringify(record.envPatchSummary) : null,
        record.artifactRef ?? null
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
          runtime_type,
          runtime_session_id,
          attach_target,
          status,
          process_id,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail,
          debug_runtime_session_id,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          launcher_source_type,
          launch_stage,
          failure_stage,
          adapter_kind,
          env_patch_summary_json,
          artifact_ref
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
          runtime_type,
          runtime_session_id,
          attach_target,
          status,
          process_id,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail,
          debug_runtime_session_id,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          launcher_source_type,
          launch_stage,
          failure_stage,
          adapter_kind,
          env_patch_summary_json,
          artifact_ref
        FROM terminal_instances
        WHERE workspace_id = ?
        ORDER BY last_active_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapTerminalInstanceRow(row as TerminalInstanceRow));
  }

  listRecoverable(): TerminalInstance[] {
    return this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          name,
          cwd,
          shell,
          runtime_type,
          runtime_session_id,
          attach_target,
          status,
          process_id,
          created_by_user_id,
          created_at,
          last_active_at,
          closed_at,
          exit_code,
          status_detail,
          debug_runtime_session_id,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          launcher_source_type,
          launch_stage,
          failure_stage,
          adapter_kind,
          env_patch_summary_json,
          artifact_ref
        FROM terminal_instances
        WHERE status IN ('creating', 'running')
        ORDER BY last_active_at DESC, created_at DESC`
      )
      .all()
      .map((row) => mapTerminalInstanceRow(row as TerminalInstanceRow));
  }

  updateLifecycle(input: UpdateTerminalLifecycleInput): void {
    this.db
      .prepare(
        `UPDATE terminal_instances
         SET status = ?,
             process_id = ?,
             last_active_at = ?,
             closed_at = ?,
             exit_code = ?,
             status_detail = ?
         WHERE id = ?`
      )
      .run(
        input.status,
        input.processId,
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
  runtime_type: TerminalRuntimeType;
  runtime_session_id: string;
  attach_target: string;
  status: TerminalStatus;
  process_id: number | null;
  created_by_user_id: string;
  created_at: string;
  last_active_at: string;
  closed_at: string | null;
  exit_code: number | null;
  status_detail: string | null;
  debug_runtime_session_id: string | null;
  debug_target_id: string | null;
  debug_service_id: string | null;
  framework_analysis_id: string | null;
  launcher_source_type: TerminalInstance["launcherSourceType"] | null;
  launch_stage: string | null;
  failure_stage: string | null;
  adapter_kind: TerminalInstance["adapterKind"] | null;
  env_patch_summary_json: string | null;
  artifact_ref: string | null;
}

function mapTerminalInstanceRow(row: TerminalInstanceRow): TerminalInstance {
  const terminal: TerminalInstance = {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    cwd: row.cwd,
    shell: row.shell,
    runtimeType: row.runtime_type,
    runtimeSessionId: row.runtime_session_id,
    attachTarget: row.attach_target,
    status: row.status,
    processId: row.process_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    closedAt: row.closed_at,
    exitCode: row.exit_code,
    statusDetail: row.status_detail
  };

  if (row.debug_runtime_session_id) {
    terminal.debugRuntimeSessionId = row.debug_runtime_session_id;
  }

  if (row.debug_target_id) {
    terminal.debugTargetId = row.debug_target_id;
  }

  if (row.debug_service_id) {
    terminal.debugServiceId = row.debug_service_id;
  }

  if (row.framework_analysis_id) {
    terminal.frameworkAnalysisId = row.framework_analysis_id;
  }

  if (row.launcher_source_type) {
    terminal.launcherSourceType = row.launcher_source_type;
  }

  if (row.launch_stage) {
    terminal.launchStage = row.launch_stage;
  }

  if (row.failure_stage) {
    terminal.failureStage = row.failure_stage;
  }

  if (row.adapter_kind) {
    terminal.adapterKind = row.adapter_kind;
  }

  if (row.env_patch_summary_json) {
    terminal.envPatchSummary = parseJsonObject(row.env_patch_summary_json);
  }

  if (row.artifact_ref) {
    terminal.artifactRef = row.artifact_ref;
  }

  return terminal;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
