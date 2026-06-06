import type Database from "better-sqlite3";

import type { UserTeableCredentialRecord } from "../../types/domain.js";

export class UserTeableCredentialRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserIdAndAuthRef(userId: string, authRef: string): UserTeableCredentialRecord | null {
    const row = this.db
      .prepare(
        `SELECT token_ciphertext, created_at, updated_at
         FROM user_teable_credentials
         WHERE user_id = ? AND auth_ref = ?`
      )
      .get(userId, authRef) as UserTeableCredentialRow | undefined;

    if (!row) {
      return null;
    }

    return {
      userId,
      authRef,
      tokenCiphertext: row.token_ciphertext,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  upsert(record: UserTeableCredentialRecord): UserTeableCredentialRecord {
    this.db
      .prepare(
        `INSERT INTO user_teable_credentials (
          user_id,
          auth_ref,
          token_ciphertext,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, auth_ref) DO UPDATE SET
          token_ciphertext = excluded.token_ciphertext,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.authRef,
        record.tokenCiphertext,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  delete(userId: string, authRef: string): void {
    this.db
      .prepare(
        `DELETE FROM user_teable_credentials
         WHERE user_id = ? AND auth_ref = ?`
      )
      .run(userId, authRef);
  }
}

interface UserTeableCredentialRow {
  token_ciphertext: string;
  created_at: string;
  updated_at: string;
}
