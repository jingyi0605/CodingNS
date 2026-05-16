import type Database from "better-sqlite3";

import type {
  BrowserEngine,
  BrowserProfile,
  BrowserProfileMode,
  BrowserProfileOwnershipScope,
  BrowserProfileStatus
} from "../../types/domain.js";

export interface BrowserProfileListFilters {
  userId?: string;
  workspaceId?: string | null;
  engine?: BrowserEngine;
  mode?: BrowserProfileMode;
  status?: BrowserProfileStatus;
}

export class BrowserProfileRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: BrowserProfile): BrowserProfile {
    this.db
      .prepare(
        `INSERT INTO browser_profiles (
           id,
           user_id,
           workspace_id,
           engine,
           mode,
           display_name,
           user_data_dir,
           cdp_endpoint,
           ownership_scope,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.workspaceId,
        record.engine,
        record.mode,
        record.displayName,
        record.userDataDir,
        record.cdpEndpoint,
        record.ownershipScope,
        record.status,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): BrowserProfile | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           engine,
           mode,
           display_name,
           user_data_dir,
           cdp_endpoint,
           ownership_scope,
           status,
           created_at,
           updated_at
         FROM browser_profiles
         WHERE id = ?`
      )
      .get(id) as BrowserProfileRow | undefined;

    return row ? mapBrowserProfileRow(row) : null;
  }

  list(filters: BrowserProfileListFilters = {}): BrowserProfile[] {
    const whereParts: string[] = [];
    const values: Array<string | null> = [];

    if (filters.userId?.trim()) {
      whereParts.push("user_id = ?");
      values.push(filters.userId.trim());
    }

    if (filters.workspaceId !== undefined) {
      if (filters.workspaceId === null) {
        whereParts.push("workspace_id IS NULL");
      } else {
        whereParts.push("workspace_id = ?");
        values.push(filters.workspaceId.trim());
      }
    }

    if (filters.engine) {
      whereParts.push("engine = ?");
      values.push(filters.engine);
    }

    if (filters.mode) {
      whereParts.push("mode = ?");
      values.push(filters.mode);
    }

    if (filters.status) {
      whereParts.push("status = ?");
      values.push(filters.status);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT
           id,
           user_id,
           workspace_id,
           engine,
           mode,
           display_name,
           user_data_dir,
           cdp_endpoint,
           ownership_scope,
           status,
           created_at,
           updated_at
         FROM browser_profiles
         ${whereClause}
         ORDER BY created_at DESC`
      )
      .all(...values)
      .map((row) => mapBrowserProfileRow(row as BrowserProfileRow));
  }

  update(record: BrowserProfile): BrowserProfile {
    this.db
      .prepare(
        `UPDATE browser_profiles
         SET user_id = ?,
             workspace_id = ?,
             engine = ?,
             mode = ?,
             display_name = ?,
             user_data_dir = ?,
             cdp_endpoint = ?,
             ownership_scope = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.userId,
        record.workspaceId,
        record.engine,
        record.mode,
        record.displayName,
        record.userDataDir,
        record.cdpEndpoint,
        record.ownershipScope,
        record.status,
        record.updatedAt,
        record.id
      );

    return record;
  }

  deleteById(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM browser_profiles WHERE id = ?")
      .run(id);

    return result.changes > 0;
  }
}

interface BrowserProfileRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  engine: BrowserEngine;
  mode: BrowserProfileMode;
  display_name: string;
  user_data_dir: string | null;
  cdp_endpoint: string | null;
  ownership_scope: BrowserProfileOwnershipScope;
  status: BrowserProfileStatus;
  created_at: string;
  updated_at: string;
}

function mapBrowserProfileRow(row: BrowserProfileRow): BrowserProfile {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    engine: row.engine,
    mode: row.mode,
    displayName: row.display_name,
    userDataDir: row.user_data_dir,
    cdpEndpoint: row.cdp_endpoint,
    ownershipScope: row.ownership_scope,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
