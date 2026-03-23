import type Database from "better-sqlite3";

import type { RecentFileRecord } from "../../types/domain.js";

export class RecentFileRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: RecentFileRecord): void {
    this.db
      .prepare(
        `INSERT INTO recent_files (
           id,
           workspace_id,
           user_id,
           path,
           last_opened_at,
           pinned
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, user_id, path) DO UPDATE SET
           last_opened_at = excluded.last_opened_at`
      )
      .run(
        record.id,
        record.workspaceId,
        record.userId,
        record.path,
        record.lastOpenedAt,
        record.pinned ? 1 : 0
      );
  }

  listByWorkspaceAndUser(workspaceId: string, userId: string, limit: number): RecentFileRecord[] {
    return this.db
      .prepare(
        `SELECT id, workspace_id, user_id, path, last_opened_at, pinned
         FROM recent_files
         WHERE workspace_id = ? AND user_id = ?
         ORDER BY pinned DESC, last_opened_at DESC
         LIMIT ?`
      )
      .all(workspaceId, userId, limit)
      .map((row) => mapRecentFileRow(row as RecentFileRow));
  }

  renamePath(workspaceId: string, oldPath: string, newPath: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, user_id, path, last_opened_at, pinned
         FROM recent_files
         WHERE workspace_id = ?
           AND (path = ? OR path LIKE ?)`
      )
      .all(workspaceId, oldPath, `${oldPath}/%`) as RecentFileRow[];

    for (const row of rows) {
      const nextPath = row.path === oldPath ? newPath : `${newPath}${row.path.slice(oldPath.length)}`;

      this.db
        .prepare(
          `UPDATE recent_files
           SET path = ?
           WHERE id = ?`
        )
        .run(nextPath, row.id);
    }
  }

  deleteByPath(workspaceId: string, targetPath: string): void {
    this.db
      .prepare(
        `DELETE FROM recent_files
         WHERE workspace_id = ?
           AND (path = ? OR path LIKE ?)`
      )
      .run(workspaceId, targetPath, `${targetPath}/%`);
  }
}

interface RecentFileRow {
  id: string;
  workspace_id: string;
  user_id: string;
  path: string;
  last_opened_at: string;
  pinned: number;
}

function mapRecentFileRow(row: RecentFileRow): RecentFileRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    path: row.path,
    lastOpenedAt: row.last_opened_at,
    pinned: row.pinned === 1
  };
}
