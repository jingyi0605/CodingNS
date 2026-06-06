import type Database from "better-sqlite3";

import type { TeableSyncSourceType, UserTeableMirrorRecordMappingRecord } from "../../types/domain.js";

export class UserTeableMirrorRecordMappingRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserIdAndMirrorType(userId: string, mirrorType: TeableSyncSourceType): UserTeableMirrorRecordMappingRecord[] {
    return this.db
      .prepare(
        `SELECT mapping_id, user_id, mirror_type, local_id, teable_record_id, fingerprint, last_synced_at, deleted_at, created_at, updated_at
         FROM user_teable_mirror_record_mappings
         WHERE user_id = ?
           AND mirror_type = ?
         ORDER BY datetime(updated_at) DESC, local_id ASC`
      )
      .all(userId, mirrorType)
      .map((row) => mapMappingRow(row as UserTeableMirrorRecordMappingRow));
  }

  findByUserIdAndMirrorTypeAndLocalId(
    userId: string,
    mirrorType: TeableSyncSourceType,
    localId: string
  ): UserTeableMirrorRecordMappingRecord | null {
    const row = this.db
      .prepare(
        `SELECT mapping_id, user_id, mirror_type, local_id, teable_record_id, fingerprint, last_synced_at, deleted_at, created_at, updated_at
         FROM user_teable_mirror_record_mappings
         WHERE user_id = ?
           AND mirror_type = ?
           AND local_id = ?
         LIMIT 1`
      )
      .get(userId, mirrorType, localId) as UserTeableMirrorRecordMappingRow | undefined;

    return row ? mapMappingRow(row) : null;
  }

  upsert(record: UserTeableMirrorRecordMappingRecord): UserTeableMirrorRecordMappingRecord {
    this.db
      .prepare(
        `INSERT INTO user_teable_mirror_record_mappings (
          mapping_id,
          user_id,
          mirror_type,
          local_id,
          teable_record_id,
          fingerprint,
          last_synced_at,
          deleted_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, mirror_type, local_id) DO UPDATE SET
          mapping_id = excluded.mapping_id,
          teable_record_id = excluded.teable_record_id,
          fingerprint = excluded.fingerprint,
          last_synced_at = excluded.last_synced_at,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at`
      )
      .run(
        record.mappingId,
        record.userId,
        record.mirrorType,
        record.localId,
        record.teableRecordId,
        record.fingerprint,
        record.lastSyncedAt,
        record.deletedAt,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserTeableMirrorRecordMappingRow {
  mapping_id: string;
  user_id: string;
  mirror_type: TeableSyncSourceType;
  local_id: string;
  teable_record_id: string;
  fingerprint: string;
  last_synced_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapMappingRow(row: UserTeableMirrorRecordMappingRow): UserTeableMirrorRecordMappingRecord {
  return {
    mappingId: row.mapping_id,
    userId: row.user_id,
    mirrorType: row.mirror_type,
    localId: row.local_id,
    teableRecordId: row.teable_record_id,
    fingerprint: row.fingerprint,
    lastSyncedAt: row.last_synced_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
