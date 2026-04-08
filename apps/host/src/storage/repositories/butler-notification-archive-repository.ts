import type Database from "better-sqlite3";

import type { ButlerNotificationArchiveRecord } from "../../types/domain.js";

export class ButlerNotificationArchiveRepository {
  constructor(private readonly db: Database.Database) {}

  listByUserId(userId: string): ButlerNotificationArchiveRecord[] {
    return this.db
      .prepare(
        `SELECT
           user_id,
           notification_id,
           archived_at,
           updated_at
         FROM butler_notification_archives
         WHERE user_id = ?
         ORDER BY updated_at DESC`
      )
      .all(userId)
      .map((row) => mapRow(row as ButlerNotificationArchiveRow));
  }

  upsert(record: ButlerNotificationArchiveRecord): ButlerNotificationArchiveRecord {
    this.db
      .prepare(
        `INSERT INTO butler_notification_archives (
           user_id,
           notification_id,
           archived_at,
           updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, notification_id) DO UPDATE SET
           archived_at = excluded.archived_at,
           updated_at = excluded.updated_at`
      )
      .run(record.userId, record.notificationId, record.archivedAt, record.updatedAt);

    return record;
  }

  delete(userId: string, notificationId: string): void {
    this.db
      .prepare(
        `DELETE FROM butler_notification_archives
         WHERE user_id = ? AND notification_id = ?`
      )
      .run(userId, notificationId);
  }
}

interface ButlerNotificationArchiveRow {
  user_id: string;
  notification_id: string;
  archived_at: string;
  updated_at: string;
}

function mapRow(row: ButlerNotificationArchiveRow): ButlerNotificationArchiveRecord {
  return {
    userId: row.user_id,
    notificationId: row.notification_id,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at
  };
}
