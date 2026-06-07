import type Database from "better-sqlite3";

import type { ButlerProfile } from "../../types/domain.js";

export class ButlerProfileRepository {
  constructor(private readonly db: Database.Database) {}

  find(userId?: string): ButlerProfile | null {
    if (userId?.trim()) {
      return this.findByUserId(userId);
    }

    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           display_name,
           provider_id,
           workspace_path,
           agents_mode,
           agents_file_path,
           agents_content,
           persona_json,
           focus_json,
           setup_completed,
           initialized_at,
           updated_at
         FROM butler_profiles
         ORDER BY updated_at DESC, initialized_at DESC
         LIMIT 1`
      )
      .get() as ButlerProfileRow | undefined;

    return row ? mapButlerProfileRow(row) : null;
  }

  findByUserId(userId: string): ButlerProfile | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           display_name,
           provider_id,
           workspace_path,
           agents_mode,
           agents_file_path,
           agents_content,
           persona_json,
           focus_json,
           setup_completed,
           initialized_at,
           updated_at
         FROM butler_profiles
         WHERE user_id = ?`
      )
      .get(userId) as ButlerProfileRow | undefined;

    return row ? mapButlerProfileRow(row) : null;
  }

  create(record: ButlerProfile): ButlerProfile {
    this.db
      .prepare(
        `INSERT INTO butler_profiles (
           id,
           user_id,
           display_name,
           provider_id,
           workspace_path,
           agents_mode,
           agents_file_path,
           agents_content,
           persona_json,
           focus_json,
           setup_completed,
           initialized_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.displayName,
        record.providerId,
        record.workspacePath,
        record.agentsMode,
        record.agentsFilePath,
        record.agentsContent,
        JSON.stringify(record.persona),
        JSON.stringify(record.focus),
        record.setupCompleted ? 1 : 0,
        record.initializedAt,
        record.updatedAt
      );

    return record;
  }

  update(record: ButlerProfile): ButlerProfile {
    this.db
      .prepare(
        `UPDATE butler_profiles
         SET provider_id = ?,
             display_name = ?,
             workspace_path = ?,
             agents_mode = ?,
             agents_file_path = ?,
             agents_content = ?,
             persona_json = ?,
             focus_json = ?,
             setup_completed = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`
      )
      .run(
        record.providerId,
        record.displayName,
        record.workspacePath,
        record.agentsMode,
        record.agentsFilePath,
        record.agentsContent,
        JSON.stringify(record.persona),
        JSON.stringify(record.focus),
        record.setupCompleted ? 1 : 0,
        record.updatedAt,
        record.id,
        record.userId
      );

    return record;
  }
}

interface ButlerProfileRow {
  id: ButlerProfile["id"];
  user_id: string;
  display_name: string;
  provider_id: ButlerProfile["providerId"];
  workspace_path: string;
  agents_mode: ButlerProfile["agentsMode"];
  agents_file_path: string | null;
  agents_content: string;
  persona_json: string;
  focus_json: string;
  setup_completed: number;
  initialized_at: string;
  updated_at: string;
}

function mapButlerProfileRow(row: ButlerProfileRow): ButlerProfile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    providerId: row.provider_id,
    workspacePath: row.workspace_path,
    agentsMode: row.agents_mode,
    agentsFilePath: row.agents_file_path,
    agentsContent: row.agents_content,
    persona: parseJsonObject(row.persona_json) as ButlerProfile["persona"],
    focus: parseJsonObject(row.focus_json) as ButlerProfile["focus"],
    setupCompleted: row.setup_completed === 1,
    initializedAt: row.initialized_at,
    updatedAt: row.updated_at
  };
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
