import type Database from "better-sqlite3";

import type { DebugServiceSpec } from "../../types/domain.js";

export class DebugServiceRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: DebugServiceSpec): DebugServiceSpec {
    this.db
      .prepare(
        `INSERT INTO debug_services (
          id,
          target_id,
          role,
          name,
          cwd,
          command,
          args_json,
          env_json,
          default_port_hint,
          protocol,
          health_path,
          adapter_kind,
          framework_analysis_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.targetId,
        record.role,
        record.name,
        record.cwd,
        record.command,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
        record.defaultPortHint ?? null,
        record.protocol ?? null,
        record.healthPath ?? null,
        record.adapterKind ?? null,
        record.frameworkAnalysisId ?? null,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  listByTargetId(targetId: string): DebugServiceSpec[] {
    return this.db
      .prepare(
        `SELECT
          id,
          target_id,
          role,
          name,
          cwd,
          command,
          args_json,
          env_json,
          default_port_hint,
          protocol,
          health_path,
          adapter_kind,
          framework_analysis_id,
          created_at,
          updated_at
        FROM debug_services
        WHERE target_id = ?
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(targetId)
      .map((row) => mapDebugServiceRow(row as DebugServiceRow));
  }

  deleteByTargetId(targetId: string): void {
    this.db
      .prepare(
        `DELETE FROM debug_services
         WHERE target_id = ?`
      )
      .run(targetId);
  }
}

interface DebugServiceRow {
  id: string;
  target_id: string;
  role: DebugServiceSpec["role"];
  name: string;
  cwd: string;
  command: string;
  args_json: string;
  env_json: string;
  default_port_hint: number | null;
  protocol: DebugServiceSpec["protocol"] | null;
  health_path: string | null;
  adapter_kind: DebugServiceSpec["adapterKind"] | null;
  framework_analysis_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapDebugServiceRow(row: DebugServiceRow): DebugServiceSpec {
  return {
    id: row.id,
    targetId: row.target_id,
    role: row.role,
    name: row.name,
    cwd: row.cwd,
    command: row.command,
    args: parseJsonArray(row.args_json),
    env: parseJsonObject(row.env_json),
    defaultPortHint: row.default_port_hint,
    protocol: row.protocol,
    healthPath: row.health_path,
    adapterKind: row.adapter_kind,
    frameworkAnalysisId: row.framework_analysis_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

function parseJsonObject(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}
