import type Database from "better-sqlite3";

import type { AuthLoginAttemptRecord } from "../../types/domain.js";

export class AuthLoginAttemptRepository {
  constructor(private readonly db: Database.Database) {}

  findByUsername(username: string): AuthLoginAttemptRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           username,
           failed_attempt_count,
           captcha_id,
           captcha_code_hash,
           captcha_expires_at,
           created_at,
           updated_at
         FROM auth_login_attempts
         WHERE username = ?`
      )
      .get(username) as AuthLoginAttemptRow | undefined;

    return row ? mapAuthLoginAttemptRow(row) : null;
  }

  upsert(record: AuthLoginAttemptRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_login_attempts (
           username,
           failed_attempt_count,
           captcha_id,
           captcha_code_hash,
           captcha_expires_at,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           failed_attempt_count = excluded.failed_attempt_count,
           captcha_id = excluded.captcha_id,
           captcha_code_hash = excluded.captcha_code_hash,
           captcha_expires_at = excluded.captcha_expires_at,
           updated_at = excluded.updated_at`
      )
      .run(
        record.username,
        record.failedAttemptCount,
        record.captchaId,
        record.captchaCodeHash,
        record.captchaExpiresAt,
        record.createdAt,
        record.updatedAt
      );
  }

  deleteByUsername(username: string): void {
    this.db
      .prepare(
        `DELETE FROM auth_login_attempts
         WHERE username = ?`
      )
      .run(username);
  }
}

interface AuthLoginAttemptRow {
  username: string;
  failed_attempt_count: number;
  captcha_id: string | null;
  captcha_code_hash: string | null;
  captcha_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapAuthLoginAttemptRow(row: AuthLoginAttemptRow): AuthLoginAttemptRecord {
  return {
    username: row.username,
    failedAttemptCount: row.failed_attempt_count,
    captchaId: row.captcha_id,
    captchaCodeHash: row.captcha_code_hash,
    captchaExpiresAt: row.captcha_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
