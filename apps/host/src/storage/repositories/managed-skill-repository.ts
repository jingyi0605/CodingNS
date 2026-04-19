import type Database from "better-sqlite3";

import type { ManagedSkillRecord, SkillScope } from "../../types/domain.js";

export class ManagedSkillRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): ManagedSkillRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           name,
           scope,
           directory_name,
           source_type,
           source_path,
           content_hash,
           managed_state,
           created_at,
           updated_at
         FROM managed_skills
         WHERE id = ?`
      )
      .get(id) as ManagedSkillRow | undefined;

    return row ? mapManagedSkillRow(row) : null;
  }

  findByDirectoryName(directoryName: string): ManagedSkillRecord | null {
    return this.findByScopeAndDirectoryName("workspace", directoryName);
  }

  findByScopeAndDirectoryName(scope: SkillScope, directoryName: string): ManagedSkillRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           name,
           scope,
           directory_name,
           source_type,
           source_path,
           content_hash,
           managed_state,
           created_at,
           updated_at
         FROM managed_skills
         WHERE scope = ?
           AND directory_name = ?`
      )
      .get(scope, directoryName) as ManagedSkillRow | undefined;

    return row ? mapManagedSkillRow(row) : null;
  }

  list(): ManagedSkillRecord[] {
    return this.db
      .prepare(
        `SELECT
           id,
           name,
           scope,
           directory_name,
           source_type,
           source_path,
           content_hash,
           managed_state,
           created_at,
           updated_at
         FROM managed_skills
         ORDER BY updated_at DESC, created_at DESC, id ASC`
      )
      .all()
      .map((row) => mapManagedSkillRow(row as ManagedSkillRow));
  }

  upsert(record: ManagedSkillRecord): ManagedSkillRecord {
    this.db
      .prepare(
        `INSERT INTO managed_skills (
           id,
           name,
           scope,
           directory_name,
           source_type,
           source_path,
           content_hash,
           managed_state,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           scope = excluded.scope,
           directory_name = excluded.directory_name,
           source_type = excluded.source_type,
           source_path = excluded.source_path,
           content_hash = excluded.content_hash,
           managed_state = excluded.managed_state,
           updated_at = excluded.updated_at`
      )
      .run(
        record.id,
        record.name,
        record.scope,
        record.directoryName,
        record.sourceType,
        record.sourcePath,
        record.contentHash,
        record.managedState,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM managed_skills
         WHERE id = ?`
      )
      .run(id);

    return result.changes > 0;
  }
}

interface ManagedSkillRow {
  id: string;
  name: string;
  scope: ManagedSkillRecord["scope"];
  directory_name: string;
  source_type: ManagedSkillRecord["sourceType"];
  source_path: string | null;
  content_hash: string;
  managed_state: ManagedSkillRecord["managedState"];
  created_at: string;
  updated_at: string;
}

function mapManagedSkillRow(row: ManagedSkillRow): ManagedSkillRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    directoryName: row.directory_name,
    sourceType: row.source_type,
    sourcePath: row.source_path,
    contentHash: row.content_hash,
    managedState: row.managed_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
