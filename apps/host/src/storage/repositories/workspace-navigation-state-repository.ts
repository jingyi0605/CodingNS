import type Database from "better-sqlite3";

import type { WorkspaceNavigationStateRecord } from "../../types/domain.js";

export class WorkspaceNavigationStateRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string): WorkspaceNavigationStateRecord[] {
    return this.db
      .prepare(
        `SELECT workspace_id, user_id, collapsed, updated_at
         FROM workspace_navigation_states
         WHERE user_id = ?`
      )
      .all(userId)
      .map((row) => mapWorkspaceNavigationStateRow(row as WorkspaceNavigationStateRow));
  }

  upsert(record: WorkspaceNavigationStateRecord): WorkspaceNavigationStateRecord {
    this.db
      .prepare(
        `INSERT INTO workspace_navigation_states (
           workspace_id,
           user_id,
           collapsed,
           updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, user_id) DO UPDATE SET
           collapsed = excluded.collapsed,
           updated_at = excluded.updated_at`
      )
      .run(record.workspaceId, record.userId, record.collapsed ? 1 : 0, record.updatedAt);

    return record;
  }
}

interface WorkspaceNavigationStateRow {
  workspace_id: string;
  user_id: string;
  collapsed: number;
  updated_at: string;
}

function mapWorkspaceNavigationStateRow(row: WorkspaceNavigationStateRow): WorkspaceNavigationStateRecord {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    collapsed: row.collapsed === 1,
    updatedAt: row.updated_at
  };
}
