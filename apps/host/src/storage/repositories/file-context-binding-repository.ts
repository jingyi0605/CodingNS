import type Database from "better-sqlite3";

import type { FileContextBinding } from "../../types/domain.js";

export class FileContextBindingRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: FileContextBinding): FileContextBinding {
    this.db
      .prepare(
        `INSERT INTO session_file_context_bindings (
           id,
           session_id,
           workspace_id,
           path,
           display_name,
           selected,
           pinned,
           range_start,
           range_end,
           content_hash,
           file_version,
           attached_by,
           attached_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.sessionId,
        record.workspaceId,
        record.path,
        record.displayName,
        record.selected ? 1 : 0,
        record.pinned ? 1 : 0,
        record.rangeStart,
        record.rangeEnd,
        record.contentHash,
        record.fileVersion,
        record.attachedBy,
        record.attachedAt
      );

    return record;
  }

  listBySession(sessionId: string): FileContextBinding[] {
    return this.db
      .prepare(
        `SELECT
           id,
           session_id,
           workspace_id,
           path,
           display_name,
           selected,
           pinned,
           range_start,
           range_end,
           content_hash,
           file_version,
           attached_by,
           attached_at
         FROM session_file_context_bindings
         WHERE session_id = ?
         ORDER BY pinned DESC, attached_at DESC`
      )
      .all(sessionId)
      .map((row) => mapFileContextBindingRow(row as FileContextBindingRow));
  }

  findById(bindingId: string): FileContextBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           workspace_id,
           path,
           display_name,
           selected,
           pinned,
           range_start,
           range_end,
           content_hash,
           file_version,
           attached_by,
           attached_at
         FROM session_file_context_bindings
         WHERE id = ?`
      )
      .get(bindingId) as FileContextBindingRow | undefined;

    return row ? mapFileContextBindingRow(row) : null;
  }

  delete(bindingId: string): void {
    this.db
      .prepare(
        `DELETE FROM session_file_context_bindings
         WHERE id = ?`
      )
      .run(bindingId);
  }

  renamePath(workspaceId: string, oldPath: string, newPath: string): void {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           session_id,
           workspace_id,
           path,
           display_name,
           selected,
           pinned,
           range_start,
           range_end,
           content_hash,
           file_version,
           attached_by,
           attached_at
         FROM session_file_context_bindings
         WHERE workspace_id = ?
           AND (path = ? OR path LIKE ?)`
      )
      .all(workspaceId, oldPath, `${oldPath}/%`) as FileContextBindingRow[];

    for (const row of rows) {
      const nextPath = row.path === oldPath ? newPath : `${newPath}${row.path.slice(oldPath.length)}`;
      const nextDisplayName = nextPath.split("/").pop() || nextPath;

      this.db
        .prepare(
          `UPDATE session_file_context_bindings
           SET path = ?, display_name = ?
           WHERE id = ?`
        )
        .run(nextPath, nextDisplayName, row.id);
    }
  }

  deleteByPath(workspaceId: string, targetPath: string): void {
    this.db
      .prepare(
        `DELETE FROM session_file_context_bindings
         WHERE workspace_id = ?
           AND (path = ? OR path LIKE ?)`
      )
      .run(workspaceId, targetPath, `${targetPath}/%`);
  }
}

interface FileContextBindingRow {
  id: string;
  session_id: string;
  workspace_id: string;
  path: string;
  display_name: string;
  selected: number;
  pinned: number;
  range_start: number | null;
  range_end: number | null;
  content_hash: string;
  file_version: string;
  attached_by: string;
  attached_at: string;
}

function mapFileContextBindingRow(row: FileContextBindingRow): FileContextBinding {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    path: row.path,
    displayName: row.display_name,
    selected: row.selected === 1,
    pinned: row.pinned === 1,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    contentHash: row.content_hash,
    fileVersion: row.file_version,
    attachedBy: row.attached_by,
    attachedAt: row.attached_at
  };
}
