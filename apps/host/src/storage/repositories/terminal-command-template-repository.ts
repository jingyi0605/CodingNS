import type Database from "better-sqlite3";

import type { TerminalCommandTemplate } from "../../types/domain.js";

export class TerminalCommandTemplateRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: TerminalCommandTemplate): TerminalCommandTemplate {
    this.db
      .prepare(
        `INSERT INTO terminal_command_templates (
          id,
          workspace_id,
          name,
          cwd,
          command,
          args_json,
          env_json,
          port,
          proxy_enabled,
          proxy_slug,
          runtime_type,
          source_type,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          adapter_kind,
          injection_mode,
          generated_artifact_ref,
          service_discovery_mode,
          managed_by_system,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.name,
        record.cwd,
        record.command,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
        record.port,
        record.proxyEnabled ? 1 : 0,
        record.proxySlug,
        record.runtimeType,
        record.sourceType ?? null,
        record.debugTargetId ?? null,
        record.debugServiceId ?? null,
        record.frameworkAnalysisId ?? null,
        record.adapterKind ?? null,
        record.injectionMode ?? null,
        record.generatedArtifactRef ?? null,
        record.serviceDiscoveryMode ?? null,
        record.managedBySystem ? 1 : 0,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): TerminalCommandTemplate | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          name,
          cwd,
          command,
          args_json,
          env_json,
          port,
          proxy_enabled,
          proxy_slug,
          runtime_type,
          source_type,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          adapter_kind,
          injection_mode,
          generated_artifact_ref,
          service_discovery_mode,
          managed_by_system,
          created_at,
          updated_at
        FROM terminal_command_templates
        WHERE id = ?`
      )
      .get(id) as TerminalCommandTemplateRow | undefined;

    return row ? mapTemplateRow(row) : null;
  }

  listByWorkspace(workspaceId: string): TerminalCommandTemplate[] {
    return this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          name,
          cwd,
          command,
          args_json,
          env_json,
          port,
          proxy_enabled,
          proxy_slug,
          runtime_type,
          source_type,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          adapter_kind,
          injection_mode,
          generated_artifact_ref,
          service_discovery_mode,
          managed_by_system,
          created_at,
          updated_at
        FROM terminal_command_templates
        WHERE workspace_id = ?
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapTemplateRow(row as TerminalCommandTemplateRow));
  }

  findByProxySlug(proxySlug: string): TerminalCommandTemplate | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workspace_id,
          name,
          cwd,
          command,
          args_json,
          env_json,
          port,
          proxy_enabled,
          proxy_slug,
          runtime_type,
          source_type,
          debug_target_id,
          debug_service_id,
          framework_analysis_id,
          adapter_kind,
          injection_mode,
          generated_artifact_ref,
          service_discovery_mode,
          managed_by_system,
          created_at,
          updated_at
        FROM terminal_command_templates
        WHERE proxy_slug = ?`
      )
      .get(proxySlug) as TerminalCommandTemplateRow | undefined;

    return row ? mapTemplateRow(row) : null;
  }

  update(record: TerminalCommandTemplate): TerminalCommandTemplate {
    this.db
      .prepare(
        `UPDATE terminal_command_templates
         SET name = ?,
             cwd = ?,
             command = ?,
             args_json = ?,
             env_json = ?,
             port = ?,
             proxy_enabled = ?,
             proxy_slug = ?,
             runtime_type = ?,
             source_type = ?,
             debug_target_id = ?,
             debug_service_id = ?,
             framework_analysis_id = ?,
             adapter_kind = ?,
             injection_mode = ?,
             generated_artifact_ref = ?,
             service_discovery_mode = ?,
             managed_by_system = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.name,
        record.cwd,
        record.command,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
        record.port,
        record.proxyEnabled ? 1 : 0,
        record.proxySlug,
        record.runtimeType,
        record.sourceType ?? null,
        record.debugTargetId ?? null,
        record.debugServiceId ?? null,
        record.frameworkAnalysisId ?? null,
        record.adapterKind ?? null,
        record.injectionMode ?? null,
        record.generatedArtifactRef ?? null,
        record.serviceDiscoveryMode ?? null,
        record.managedBySystem ? 1 : 0,
        record.updatedAt,
        record.id
      );

    return record;
  }

  delete(id: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM terminal_command_templates WHERE id = ?")
        .run(id).changes > 0
    );
  }
}

interface TerminalCommandTemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  cwd: string;
  command: string;
  args_json: string;
  env_json: string;
  port: number | null;
  proxy_enabled: number;
  proxy_slug: string | null;
  runtime_type: TerminalCommandTemplate["runtimeType"];
  source_type: TerminalCommandTemplate["sourceType"] | null;
  debug_target_id: string | null;
  debug_service_id: string | null;
  framework_analysis_id: string | null;
  adapter_kind: TerminalCommandTemplate["adapterKind"] | null;
  injection_mode: TerminalCommandTemplate["injectionMode"] | null;
  generated_artifact_ref: string | null;
  service_discovery_mode: TerminalCommandTemplate["serviceDiscoveryMode"] | null;
  managed_by_system: number;
  created_at: string;
  updated_at: string;
}

function mapTemplateRow(row: TerminalCommandTemplateRow): TerminalCommandTemplate {
  const template: TerminalCommandTemplate = {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    cwd: row.cwd,
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    env: JSON.parse(row.env_json) as Record<string, string>,
    port: row.port,
    proxyEnabled: row.proxy_enabled === 1,
    proxySlug: row.proxy_slug,
    runtimeType: row.runtime_type ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if (row.source_type) {
    template.sourceType = row.source_type;
  }

  if (row.debug_target_id) {
    template.debugTargetId = row.debug_target_id;
  }

  if (row.debug_service_id) {
    template.debugServiceId = row.debug_service_id;
  }

  if (row.framework_analysis_id) {
    template.frameworkAnalysisId = row.framework_analysis_id;
  }

  if (row.adapter_kind) {
    template.adapterKind = row.adapter_kind;
  }

  if (row.injection_mode) {
    template.injectionMode = row.injection_mode;
  }

  if (row.generated_artifact_ref) {
    template.generatedArtifactRef = row.generated_artifact_ref;
  }

  if (row.service_discovery_mode) {
    template.serviceDiscoveryMode = row.service_discovery_mode;
  }

  if (row.managed_by_system === 1) {
    template.managedBySystem = true;
  }

  return template;
}
