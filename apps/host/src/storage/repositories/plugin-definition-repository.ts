import type Database from "better-sqlite3";

import type { PluginDefinition } from "../../types/domain.js";

export class PluginDefinitionRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: PluginDefinition): PluginDefinition {
    this.db
      .prepare(
        `INSERT INTO plugin_definitions (
           id,
           version,
           name,
           install_root,
           manifest_json,
           has_frontend,
           has_backend,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           name = excluded.name,
           install_root = excluded.install_root,
           manifest_json = excluded.manifest_json,
           has_frontend = excluded.has_frontend,
           has_backend = excluded.has_backend,
           updated_at = excluded.updated_at`
      )
      .run(
        record.id,
        record.version,
        record.name,
        record.installRoot,
        record.manifestJson,
        record.hasFrontend ? 1 : 0,
        record.hasBackend ? 1 : 0,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): PluginDefinition | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           version,
           name,
           install_root,
           manifest_json,
           has_frontend,
           has_backend,
           created_at,
           updated_at
         FROM plugin_definitions
         WHERE id = ?`
      )
      .get(id) as PluginDefinitionRow | undefined;

    return row ? mapPluginDefinitionRow(row) : null;
  }

  list(): PluginDefinition[] {
    return this.db
      .prepare(
        `SELECT
           id,
           version,
           name,
           install_root,
           manifest_json,
           has_frontend,
           has_backend,
           created_at,
           updated_at
         FROM plugin_definitions
         ORDER BY id ASC`
      )
      .all()
      .map((row) => mapPluginDefinitionRow(row as PluginDefinitionRow));
  }

  deleteById(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM plugin_definitions WHERE id = ?")
      .run(id);

    return result.changes > 0;
  }
}

interface PluginDefinitionRow {
  id: string;
  version: string;
  name: string;
  install_root: string;
  manifest_json: string;
  has_frontend: number;
  has_backend: number;
  created_at: string;
  updated_at: string;
}

function mapPluginDefinitionRow(row: PluginDefinitionRow): PluginDefinition {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    installRoot: row.install_root,
    manifestJson: row.manifest_json,
    hasFrontend: row.has_frontend === 1,
    hasBackend: row.has_backend === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
