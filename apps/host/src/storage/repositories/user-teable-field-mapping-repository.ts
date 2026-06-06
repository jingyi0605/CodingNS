import type Database from "better-sqlite3";

import type { TeableSyncSourceType, UserTeableFieldMappingRecord } from "../../types/domain.js";

export class UserTeableFieldMappingRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string): UserTeableFieldMappingRecord[] {
    return this.db
      .prepare(
        `SELECT mapping_id, user_id, config_id, source_type, target_table_id, items_json, created_at, updated_at
         FROM user_teable_field_mappings
         WHERE user_id = ?
         ORDER BY CASE source_type
           WHEN 'tags' THEN 1
           WHEN 'sessions' THEN 2
           WHEN 'todos' THEN 3
           ELSE 99
         END ASC, datetime(updated_at) DESC`
      )
      .all(userId)
      .map((row) => mapRow(row as UserTeableFieldMappingRow));
  }

  findByUserIdAndConfigId(userId: string, configId: string): UserTeableFieldMappingRecord | null {
    const row = this.db
      .prepare(
        `SELECT mapping_id, user_id, config_id, source_type, target_table_id, items_json, created_at, updated_at
         FROM user_teable_field_mappings
         WHERE user_id = ? AND config_id = ?
         LIMIT 1`
      )
      .get(userId, configId) as UserTeableFieldMappingRow | undefined;

    return row ? mapRow(row) : null;
  }

  upsert(record: UserTeableFieldMappingRecord): UserTeableFieldMappingRecord {
    this.db
      .prepare(
        `INSERT INTO user_teable_field_mappings (
          mapping_id,
          user_id,
          config_id,
          source_type,
          target_table_id,
          items_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, config_id) DO UPDATE SET
          mapping_id = excluded.mapping_id,
          source_type = excluded.source_type,
          target_table_id = excluded.target_table_id,
          items_json = excluded.items_json,
          updated_at = excluded.updated_at`
      )
      .run(
        record.mappingId,
        record.userId,
        record.configId,
        record.sourceType,
        record.targetTableId,
        record.itemsJson,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  delete(userId: string, configId: string): void {
    this.db
      .prepare(
        `DELETE FROM user_teable_field_mappings
         WHERE user_id = ? AND config_id = ?`
      )
      .run(userId, configId);
  }
}

interface UserTeableFieldMappingRow {
  mapping_id: string;
  user_id: string;
  config_id: string;
  source_type: TeableSyncSourceType;
  target_table_id: string;
  items_json: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UserTeableFieldMappingRow): UserTeableFieldMappingRecord {
  return {
    mappingId: row.mapping_id,
    userId: row.user_id,
    configId: row.config_id,
    sourceType: row.source_type,
    targetTableId: row.target_table_id,
    itemsJson: row.items_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
