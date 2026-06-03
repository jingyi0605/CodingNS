import type Database from "better-sqlite3";

import type { AffairsAssistantSessionSnapshotRecord } from "../../types/domain.js";

export class AffairsAssistantSessionSnapshotRepository {
  private readonly findByWorkspaceAndUserStatement: Database.Statement<any[], any>;
  private readonly upsertStatement: Database.Statement<any[], any>;

  constructor(private readonly db: Database.Database) {
    this.findByWorkspaceAndUserStatement = this.db.prepare(
      `SELECT workspace_id, user_id, project_id, project_workspace_id, agent_workspace_path, sessions_json, updated_at
       FROM affairs_assistant_session_snapshots
       WHERE workspace_id = ?
         AND user_id = ?`
    );
    this.upsertStatement = this.db.prepare(
      `INSERT INTO affairs_assistant_session_snapshots (
         workspace_id,
         user_id,
         project_id,
         project_workspace_id,
         agent_workspace_path,
         sessions_json,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET
         project_id = excluded.project_id,
         project_workspace_id = excluded.project_workspace_id,
         agent_workspace_path = excluded.agent_workspace_path,
         sessions_json = excluded.sessions_json,
         updated_at = excluded.updated_at`
    );
  }

  findByWorkspaceAndUserId(workspaceId: string, userId: string): AffairsAssistantSessionSnapshotRecord | null {
    const row = this.findByWorkspaceAndUserStatement.get(workspaceId, userId) as
      | AffairsAssistantSessionSnapshotRow
      | undefined;

    return row ? mapAffairsAssistantSessionSnapshotRow(row) : null;
  }

  upsert(record: AffairsAssistantSessionSnapshotRecord): AffairsAssistantSessionSnapshotRecord {
    this.upsertStatement.run(
      record.workspaceId,
      record.userId,
      record.projectId,
      record.projectWorkspaceId,
      record.agentWorkspacePath,
      record.sessionsJson,
      record.updatedAt
    );

    return record;
  }
}

interface AffairsAssistantSessionSnapshotRow {
  workspace_id: string;
  user_id: string;
  project_id: string | null;
  project_workspace_id: string | null;
  agent_workspace_path: string | null;
  sessions_json: string;
  updated_at: string;
}

function mapAffairsAssistantSessionSnapshotRow(
  row: AffairsAssistantSessionSnapshotRow
): AffairsAssistantSessionSnapshotRecord {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    projectId: row.project_id,
    projectWorkspaceId: row.project_workspace_id,
    agentWorkspacePath: row.agent_workspace_path,
    sessionsJson: row.sessions_json,
    updatedAt: row.updated_at
  };
}
