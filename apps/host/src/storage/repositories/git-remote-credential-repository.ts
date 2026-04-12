import type Database from "better-sqlite3";

import type { GitRemoteCredentialRecord } from "../../types/domain.js";

export class GitRemoteCredentialRepository {
  constructor(private readonly db: Database.Database) {}

  findByUserIdAndRemoteUrl(userId: string, remoteUrl: string): GitRemoteCredentialRecord | null {
    const row = this.db
      .prepare(
        `SELECT auth_mode, username_ciphertext, secret_ciphertext, created_at, updated_at
         FROM git_remote_credentials
         WHERE user_id = ? AND remote_url = ?`
      )
      .get(userId, remoteUrl) as GitRemoteCredentialRow | undefined;

    if (!row) {
      return null;
    }

    return {
      userId,
      remoteUrl,
      authMode: row.auth_mode as GitRemoteCredentialRecord["authMode"],
      usernameCiphertext: row.username_ciphertext,
      secretCiphertext: row.secret_ciphertext,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  upsert(record: GitRemoteCredentialRecord): GitRemoteCredentialRecord {
    this.db
      .prepare(
        `INSERT INTO git_remote_credentials (
          user_id,
          remote_url,
          auth_mode,
          username_ciphertext,
          secret_ciphertext,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, remote_url) DO UPDATE SET
          auth_mode = excluded.auth_mode,
          username_ciphertext = excluded.username_ciphertext,
          secret_ciphertext = excluded.secret_ciphertext,
          updated_at = excluded.updated_at`
      )
      .run(
        record.userId,
        record.remoteUrl,
        record.authMode,
        record.usernameCiphertext,
        record.secretCiphertext,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  delete(userId: string, remoteUrl: string): void {
    this.db
      .prepare(
        `DELETE FROM git_remote_credentials
         WHERE user_id = ? AND remote_url = ?`
      )
      .run(userId, remoteUrl);
  }
}

interface GitRemoteCredentialRow {
  auth_mode: string;
  username_ciphertext: string;
  secret_ciphertext: string;
  created_at: string;
  updated_at: string;
}
