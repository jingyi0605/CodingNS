import type Database from "better-sqlite3";

import type { AuthTokenRecord } from "../../types/domain.js";

export class AuthTokenRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthTokenRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_tokens (
          id,
          user_id,
          token_type,
          token_hash,
          device_session_id,
          caller_kind,
          capability_profile,
          workspace_id,
          project_id,
          session_id,
          expires_at,
          revoked_at,
          created_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.userId,
        record.tokenType,
        record.tokenHash,
        record.deviceSessionId,
        record.callerKind,
        record.capabilityProfile,
        record.workspaceId,
        record.projectId,
        record.sessionId,
        record.expiresAt,
        record.revokedAt,
        record.createdAt
      );
  }

  findByHash(tokenHash: string, tokenType?: "access" | "refresh"): AuthTokenRecord | null {
    const row = tokenType
      ? (this.db
          .prepare(
            `SELECT id, user_id, token_type, token_hash, device_session_id, caller_kind,
                    capability_profile, workspace_id, project_id, session_id,
                    expires_at, revoked_at, created_at
             FROM auth_tokens
             WHERE token_hash = ? AND token_type = ?`
          )
          .get(tokenHash, tokenType) as TokenRow | undefined)
      : (this.db
          .prepare(
            `SELECT id, user_id, token_type, token_hash, device_session_id, caller_kind,
                    capability_profile, workspace_id, project_id, session_id,
                    expires_at, revoked_at, created_at
             FROM auth_tokens
             WHERE token_hash = ?`
          )
          .get(tokenHash) as TokenRow | undefined);

    return row ? mapTokenRow(row) : null;
  }

  findById(id: string): AuthTokenRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, token_type, token_hash, device_session_id, caller_kind,
                capability_profile, workspace_id, project_id, session_id,
                expires_at, revoked_at, created_at
         FROM auth_tokens
         WHERE id = ?`
      )
      .get(id) as TokenRow | undefined;

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

  revokeByDeviceSessionIds(deviceSessionIds: string[], revokedAt: string): void {
    if (deviceSessionIds.length === 0) {
      return;
    }

    const placeholders = deviceSessionIds.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE auth_tokens
         SET revoked_at = ?
         WHERE device_session_id IN (${placeholders}) AND revoked_at IS NULL`
      )
      .run(revokedAt, ...deviceSessionIds);
  }

  revokeLegacyTokensByUser(userId: string, revokedAt: string): void {
    this.db
      .prepare(
        `UPDATE auth_tokens
         SET revoked_at = ?
         WHERE user_id = ?
           AND device_session_id IS NULL
           AND revoked_at IS NULL`
      )
      .run(revokedAt, userId);
  }

  listActiveLegacyRefreshTokensByUser(userId: string, now: string): AuthTokenRecord[] {
    return this.db
      .prepare(
        `SELECT id, user_id, token_type, token_hash, device_session_id, caller_kind,
                capability_profile, workspace_id, project_id, session_id,
                expires_at, revoked_at, created_at
         FROM auth_tokens
         WHERE user_id = ?
           AND token_type = 'refresh'
           AND device_session_id IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?
         ORDER BY created_at DESC`
      )
      .all(userId, now)
      .map((row) => mapTokenRow(row as TokenRow));
  }
}

interface TokenRow {
  id: string;
  user_id: string;
  token_type: "access" | "refresh";
  token_hash: string;
  device_session_id: string | null;
  caller_kind: "interactive_user" | "assistant_runtime" | "workspace_session" | null;
  capability_profile: string | null;
  workspace_id: string | null;
  project_id: string | null;
  session_id: string | null;
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
    deviceSessionId: row.device_session_id,
    callerKind: row.caller_kind,
    capabilityProfile: row.capability_profile,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}
