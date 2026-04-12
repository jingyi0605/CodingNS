import type Database from "better-sqlite3";

import type { Workspace } from "../../types/domain.js";

type WorkspaceCreateInput = Omit<Workspace, "sortOrder"> & {
  sortOrder?: number;
};

export class WorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: WorkspaceCreateInput): Workspace {
    const sortOrder = record.sortOrder ?? this.getNextSortOrder();

    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, path, repo_root, favorite, sort_order, created_at, updated_at, removed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.name,
        record.path,
        record.repoRoot,
        record.favorite ? 1 : 0,
        sortOrder,
        record.createdAt,
        record.updatedAt,
        record.removedAt ?? null
      );

    return {
      ...record,
      sortOrder,
      removedAt: record.removedAt ?? null
    };
  }

  findById(id: string): Workspace | null {
    const row = this.db
      .prepare(
        `SELECT id, name, path, repo_root, favorite, sort_order, created_at, updated_at, removed_at
         FROM workspaces
         WHERE id = ?`
      )
      .get(id) as WorkspaceRow | undefined;

    return row ? mapWorkspaceRow(row) : null;
  }

  findByPath(workspacePath: string): Workspace | null {
    const row = this.db
      .prepare(
        `SELECT id, name, path, repo_root, favorite, sort_order, created_at, updated_at, removed_at
         FROM workspaces
         WHERE path = ?`
      )
      .get(workspacePath) as WorkspaceRow | undefined;

    return row ? mapWorkspaceRow(row) : null;
  }

  list(): Workspace[] {
    return this.db
      .prepare(
        `SELECT id, name, path, repo_root, favorite, sort_order, created_at, updated_at, removed_at
         FROM workspaces
         WHERE removed_at IS NULL
         ORDER BY sort_order ASC, updated_at DESC, created_at DESC`
      )
      .all()
      .map((row) => mapWorkspaceRow(row as WorkspaceRow));
  }

  getNextSortOrder(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order
         FROM workspaces`
      )
      .get() as { max_sort_order: number | null } | undefined;

    return (row?.max_sort_order ?? -1) + 1;
  }

  reorderVisible(workspaceIds: readonly string[]): void {
    const update = this.db.prepare(
      `UPDATE workspaces
       SET sort_order = ?
       WHERE id = ? AND removed_at IS NULL`
    );
    const runInTransaction = this.db.transaction((orderedIds: readonly string[]) => {
      orderedIds.forEach((workspaceId, index) => {
        update.run(index, workspaceId);
      });
    });

    runInTransaction(workspaceIds);
  }

  restore(
    id: string,
    input: {
      name?: string;
      repoRoot?: string | null;
      updatedAt: string;
    }
  ): Workspace | null {
    this.db
      .prepare(
        `UPDATE workspaces
         SET name = COALESCE(?, name),
             repo_root = COALESCE(?, repo_root),
             updated_at = ?,
             removed_at = NULL
         WHERE id = ?`
      )
      .run(input.name?.trim() || null, input.repoRoot ?? null, input.updatedAt, id);

    return this.findById(id);
  }

  markRemoved(id: string, removedAt: string, updatedAt: string): Workspace | null {
    this.db
      .prepare(
        `UPDATE workspaces
         SET removed_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(removedAt, updatedAt, id);

    return this.findById(id);
  }
}

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  repo_root: string | null;
  favorite: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
}

function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    repoRoot: row.repo_root,
    favorite: row.favorite === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at
  };
}
