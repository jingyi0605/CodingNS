import type Database from "better-sqlite3";

import type {
  UserQuickPhrasePreferenceRecord,
  UserQuickPhraseRecord
} from "../../types/domain.js";

export class UserQuickPhrasePreferenceRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserId(userId: string): UserQuickPhrasePreferenceRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_id, phrases_json, created_at, updated_at
         FROM user_quick_phrase_preferences
         WHERE user_id = ?`
      )
      .get(userId) as UserQuickPhrasePreferenceRow | undefined;

    return row ? mapPreferenceRow(row) : null;
  }

  upsert(record: UserQuickPhrasePreferenceRecord): UserQuickPhrasePreferenceRecord {
    this.db
      .prepare(
        `INSERT INTO user_quick_phrase_preferences (
          user_id,
          phrases_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          phrases_json = excluded.phrases_json,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        JSON.stringify(record.phrases),
        record.createdAt,
        record.updatedAt
      );

    return record;
  }
}

interface UserQuickPhrasePreferenceRow {
  user_id: string;
  phrases_json: string;
  created_at: string;
  updated_at: string;
}

function mapPreferenceRow(
  row: UserQuickPhrasePreferenceRow
): UserQuickPhrasePreferenceRecord {
  return {
    userId: row.user_id,
    phrases: JSON.parse(row.phrases_json) as UserQuickPhraseRecord[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
