import type Database from "better-sqlite3";

import type { UserTeableMirrorTableBindingRecord } from "../../types/domain.js";

export class UserTeableMirrorTableBindingRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string): UserTeableMirrorTableBindingRecord[] {
    return this.db
      .prepare(
        `SELECT binding_id, user_id, mirror_type, table_id, table_name, read_only_mode, last_synced_at, created_at, updated_at
         FROM user_teable_mirror_table_bindings
         WHERE user_id = ?
         ORDER BY CASE mirror_type
           WHEN 'tags' THEN 1
           WHEN 'sessions' THEN 2
           WHEN 'todos' THEN 3
           ELSE 99
         END ASC`
      )
      .all(userId)
      .map((row) => mapRow(row as UserTeableMirrorTableBindingRow));
  }

  findByUserIdAndMirrorType(userId: string, mirrorType: UserTeableMirrorTableBindingRecord["mirrorType"]): UserTeableMirrorTableBindingRecord | null {
    const row = this.db
      .prepare(
        `SELECT binding_id, user_id, mirror_type, table_id, table_name, read_only_mode, last_synced_at, created_at, updated_at
         FROM user_teable_mirror_table_bindings
         WHERE user_id = ?
           AND mirror_type = ?
         LIMIT 1`
      )
      .get(userId, mirrorType) as UserTeableMirrorTableBindingRow | undefined;

    return row ? mapRow(row) : null;
  }

  upsert(record: UserTeableMirrorTableBindingRecord): UserTeableMirrorTableBindingRecord {
    this.db
      .prepare(
        `INSERT INTO user_teable_mirror_table_bindings (
          binding_id,
          user_id,
          mirror_type,
          table_id,
          table_name,
          read_only_mode,
          last_synced_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, mirror_type) DO UPDATE SET
          binding_id = excluded.binding_id,
          table_id = excluded.table_id,
          table_name = excluded.table_name,
          read_only_mode = excluded.read_only_mode,
          last_synced_at = excluded.last_synced_at,
          updated_at = excluded.updated_at`
      )
      .run(
        record.bindingId,
        record.userId,
        record.mirrorType,
        record.tableId,
        record.tableName,
        record.readOnlyMode,
        record.lastSyncedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserTeableMirrorTableBindingRow {
  binding_id: string;
  user_id: string;
  mirror_type: UserTeableMirrorTableBindingRecord["mirrorType"];
  table_id: string;
  table_name: string;
  read_only_mode: UserTeableMirrorTableBindingRecord["readOnlyMode"];
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UserTeableMirrorTableBindingRow): UserTeableMirrorTableBindingRecord {
  return {
    bindingId: row.binding_id,
    userId: row.user_id,
    mirrorType: row.mirror_type,
    tableId: row.table_id,
    tableName: row.table_name,
    readOnlyMode: row.read_only_mode,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
