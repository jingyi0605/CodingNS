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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.name,
        record.cwd,
        record.command,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
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
          created_at,
          updated_at
        FROM terminal_command_templates
        WHERE workspace_id = ?
        ORDER BY updated_at DESC, created_at DESC`
      )
      .all(workspaceId)
      .map((row) => mapTemplateRow(row as TerminalCommandTemplateRow));
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
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.name,
        record.cwd,
        record.command,
        JSON.stringify(record.args),
        JSON.stringify(record.env),
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
  created_at: string;
  updated_at: string;
}

function mapTemplateRow(row: TerminalCommandTemplateRow): TerminalCommandTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    cwd: row.cwd,
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    env: JSON.parse(row.env_json) as Record<string, string>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
