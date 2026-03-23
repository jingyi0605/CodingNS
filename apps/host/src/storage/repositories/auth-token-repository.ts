import type Database from "better-sqlite3";

import type { AuthTokenRecord } from "../../types/domain.js";

export class AuthTokenRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthTokenRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_tokens (id, user_id, token_type, token_hash, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.tokenType,
        record.tokenHash,
        record.expiresAt,
        record.revokedAt,
        record.createdAt
      );
  }

  findByHash(tokenHash: string, tokenType?: "access" | "refresh"): AuthTokenRecord | null {
    const row = tokenType
      ? (this.db
          .prepare(
            `SELECT id, user_id, token_type, token_hash, expires_at, revoked_at, created_at
             FROM auth_tokens
             WHERE token_hash = ? AND token_type = ?`
          )
          .get(tokenHash, tokenType) as TokenRow | undefined)
      : (this.db
          .prepare(
            `SELECT id, user_id, token_type, token_hash, expires_at, revoked_at, created_at
             FROM auth_tokens
             WHERE token_hash = ?`
          )
          .get(tokenHash) as TokenRow | undefined);

    return row ? mapTokenRow(row) : null;
  }

  revokeByHash(tokenHash: string, revokedAt: string): void {
    this.db
      .prepare(
        `UPDATE auth_tokens
         SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`
      )
      .run(revokedAt, tokenHash);
  }
}

interface TokenRow {
  id: string;
  user_id: string;
  token_type: "access" | "refresh";
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

function mapTokenRow(row: TokenRow): AuthTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenType: row.token_type,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}
