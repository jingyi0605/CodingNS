import type Database from "better-sqlite3";

import type { TeableSyncSourceType, UserTeableWorkbenchSyncConfigRecord } from "../../types/domain.js";

export class UserTeableWorkbenchSyncConfigRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string): UserTeableWorkbenchSyncConfigRecord[] {
    return this.db
      .prepare(
        `SELECT config_id, user_id, source_type, enabled, scope_json, target_table_id, created_at, updated_at
         FROM user_teable_workbench_sync_configs
         WHERE user_id = ?
         ORDER BY CASE source_type
           WHEN 'tags' THEN 1
           WHEN 'sessions' THEN 2
           WHEN 'todos' THEN 3
           ELSE 99
         END ASC`
      )
      .all(userId)
      .map((row) => mapRow(row as UserTeableWorkbenchSyncConfigRow));
  }

  replaceAllForUser(userId: string, records: UserTeableWorkbenchSyncConfigRecord[]): UserTeableWorkbenchSyncConfigRecord[] {
    const deleteStatement = this.db.prepare(
      `DELETE FROM user_teable_workbench_sync_configs
       WHERE user_id = ?`
    );
    const insertStatement = this.db.prepare(
      `INSERT INTO user_teable_workbench_sync_configs (
        config_id,
        user_id,
        source_type,
        enabled,
        scope_json,
        target_table_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((nextUserId: string, nextRecords: UserTeableWorkbenchSyncConfigRecord[]) => {
      deleteStatement.run(nextUserId);
      for (const record of nextRecords) {
        insertStatement.run(
          record.configId,
          record.userId,
          record.sourceType,
          record.enabled ? 1 : 0,
          record.scopeJson,
          record.targetTableId,
          record.createdAt,
          record.updatedAt
        );
      }
    });

    transaction(userId, records);
    return records;
  }
}

interface UserTeableWorkbenchSyncConfigRow {
  config_id: string;
  user_id: string;
  source_type: TeableSyncSourceType;
  enabled: number;
  scope_json: string;
  target_table_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UserTeableWorkbenchSyncConfigRow): UserTeableWorkbenchSyncConfigRecord {
  return {
    configId: row.config_id,
    userId: row.user_id,
    sourceType: row.source_type,
    enabled: row.enabled === 1,
    scopeJson: row.scope_json,
    targetTableId: row.target_table_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
