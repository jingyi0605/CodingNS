import type Database from "better-sqlite3";

import type {
  PeerHostRecord,
  PeerHostSessionRecord,
  PeerHostStatus,
  PeerHostWorkspaceBindingRecord,
} from "../../types/domain.js";

export class PeerHostRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PeerHostRecord): PeerHostRecord {
    this.db
      .prepare(
        `INSERT INTO peer_hosts (
          id,
          owner_user_id,
          name,
          alias,
          tag_color,
          base_url,
          normalized_base_url,
          status,
          remote_version,
          remote_api_compatibility,
          remote_host_fingerprint,
          last_checked_at,
          last_error_code,
          last_error_detail,
          created_at,
          updated_at,
          removed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.ownerUserId,
        record.name,
        record.alias,
        record.tagColor,
        record.baseUrl,
        record.normalizedBaseUrl,
        record.status,
        record.remoteVersion,
        record.remoteApiCompatibility,
        record.remoteHostFingerprint,
        record.lastCheckedAt,
        record.lastErrorCode,
        record.lastErrorDetail,
        record.createdAt,
        record.updatedAt,
        record.removedAt,
      );

    return record;
  }

  listByOwner(ownerUserId: string): PeerHostRecord[] {
    return this.db
      .prepare(
        `SELECT *
         FROM peer_hosts
         WHERE owner_user_id = ?
           AND removed_at IS NULL
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all(ownerUserId)
      .map((row) => mapPeerHostRow(row as PeerHostRow));
  }

  findByIdForOwner(id: string, ownerUserId: string): PeerHostRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM peer_hosts
         WHERE id = ?
           AND owner_user_id = ?
           AND removed_at IS NULL`,
      )
      .get(id, ownerUserId) as PeerHostRow | undefined;

    return row ? mapPeerHostRow(row) : null;
  }

  findByNormalizedBaseUrlForOwner(
    normalizedBaseUrl: string,
    ownerUserId: string,
  ): PeerHostRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM peer_hosts
         WHERE normalized_base_url = ?
           AND owner_user_id = ?
           AND removed_at IS NULL`,
      )
      .get(normalizedBaseUrl, ownerUserId) as PeerHostRow | undefined;

    return row ? mapPeerHostRow(row) : null;
  }

  updateConfig(
    id: string,
    ownerUserId: string,
    input: {
      name: string;
      alias: string | null;
      tagColor: string | null;
      baseUrl: string;
      normalizedBaseUrl: string;
      resetConnectionState?: boolean;
      updatedAt: string;
    },
  ): PeerHostRecord | null {
    if (input.resetConnectionState) {
      this.db
        .prepare(
          `UPDATE peer_hosts
           SET name = ?,
               alias = ?,
               tag_color = ?,
               base_url = ?,
               normalized_base_url = ?,
               status = 'unknown',
               remote_version = NULL,
               remote_api_compatibility = NULL,
               remote_host_fingerprint = NULL,
               last_checked_at = NULL,
               last_error_code = NULL,
               last_error_detail = NULL,
               updated_at = ?
           WHERE id = ?
             AND owner_user_id = ?
             AND removed_at IS NULL`,
        )
        .run(
          input.name,
          input.alias,
          input.tagColor,
          input.baseUrl,
          input.normalizedBaseUrl,
          input.updatedAt,
          id,
          ownerUserId,
        );

      return this.findByIdForOwner(id, ownerUserId);
    }

    this.db
      .prepare(
        `UPDATE peer_hosts
         SET name = ?,
             alias = ?,
             tag_color = ?,
             base_url = ?,
             normalized_base_url = ?,
             updated_at = ?
         WHERE id = ?
           AND owner_user_id = ?
           AND removed_at IS NULL`,
      )
      .run(
        input.name,
        input.alias,
        input.tagColor,
        input.baseUrl,
        input.normalizedBaseUrl,
        input.updatedAt,
        id,
        ownerUserId,
      );

    return this.findByIdForOwner(id, ownerUserId);
  }

  updateCheckResult(
    id: string,
    ownerUserId: string,
    input: {
      status: PeerHostStatus;
      remoteVersion: string | null;
      remoteApiCompatibility: string | null;
      remoteHostFingerprint: string | null;
      lastCheckedAt: string;
      lastErrorCode: string | null;
      lastErrorDetail: string | null;
      updatedAt: string;
    },
  ): PeerHostRecord | null {
    this.db
      .prepare(
        `UPDATE peer_hosts
         SET status = ?,
             remote_version = ?,
             remote_api_compatibility = ?,
             remote_host_fingerprint = ?,
             last_checked_at = ?,
             last_error_code = ?,
             last_error_detail = ?,
             updated_at = ?
         WHERE id = ?
           AND owner_user_id = ?
           AND removed_at IS NULL`,
      )
      .run(
        input.status,
        input.remoteVersion,
        input.remoteApiCompatibility,
        input.remoteHostFingerprint,
        input.lastCheckedAt,
        input.lastErrorCode,
        input.lastErrorDetail,
        input.updatedAt,
        id,
        ownerUserId,
      );

    return this.findByIdForOwner(id, ownerUserId);
  }

  markRemoved(
    id: string,
    ownerUserId: string,
    removedAt: string,
  ): PeerHostRecord | null {
    this.db
      .prepare(
        `UPDATE peer_hosts
         SET removed_at = ?,
             updated_at = ?
         WHERE id = ?
           AND owner_user_id = ?
           AND removed_at IS NULL`,
      )
      .run(removedAt, removedAt, id, ownerUserId);

    return this.findRemovedByIdForOwner(id, ownerUserId);
  }

  private findRemovedByIdForOwner(
    id: string,
    ownerUserId: string,
  ): PeerHostRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM peer_hosts
         WHERE id = ?
           AND owner_user_id = ?`,
      )
      .get(id, ownerUserId) as PeerHostRow | undefined;

    return row ? mapPeerHostRow(row) : null;
  }
}

export class PeerHostWorkspaceBindingRepository {
  constructor(private readonly db: Database.Database) {}

  listByOwner(ownerUserId: string): PeerHostWorkspaceBindingRecord[] {
    return this.db
      .prepare(
        `SELECT *
         FROM peer_host_workspace_bindings
         WHERE owner_user_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(ownerUserId)
      .map((row) =>
        mapPeerHostWorkspaceBindingRow(row as PeerHostWorkspaceBindingRow),
      );
  }

  upsert(record: PeerHostWorkspaceBindingRecord): PeerHostWorkspaceBindingRecord {
    this.db
      .prepare(
        `INSERT INTO peer_host_workspace_bindings (
          owner_user_id,
          active_host_id,
          workspace_key,
          selected_host_id,
          remote_workspace_id,
          remote_workspace_path,
          remote_workspace_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, active_host_id, workspace_key) DO UPDATE SET
          selected_host_id = excluded.selected_host_id,
          remote_workspace_id = excluded.remote_workspace_id,
          remote_workspace_path = excluded.remote_workspace_path,
          remote_workspace_name = excluded.remote_workspace_name,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.ownerUserId,
        record.activeHostId,
        record.workspaceKey,
        record.selectedHostId,
        record.remoteWorkspaceId,
        record.remoteWorkspacePath,
        record.remoteWorkspaceName,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }
}

export class PeerHostSessionRepository {
  constructor(private readonly db: Database.Database) {}

  find(peerHostId: string, ownerUserId: string): PeerHostSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM peer_host_sessions
         WHERE peer_host_id = ?
           AND owner_user_id = ?`,
      )
      .get(peerHostId, ownerUserId) as PeerHostSessionRow | undefined;

    return row ? mapPeerHostSessionRow(row) : null;
  }

  upsert(record: PeerHostSessionRecord): PeerHostSessionRecord {
    this.db
      .prepare(
        `INSERT INTO peer_host_sessions (
          peer_host_id,
          owner_user_id,
          username,
          access_token_encrypted,
          refresh_token_encrypted,
          expires_at,
          remote_user_id,
          remote_username,
          remote_host_fingerprint,
          saved_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(peer_host_id, owner_user_id) DO UPDATE SET
          username = excluded.username,
          access_token_encrypted = excluded.access_token_encrypted,
          refresh_token_encrypted = excluded.refresh_token_encrypted,
          expires_at = excluded.expires_at,
          remote_user_id = excluded.remote_user_id,
          remote_username = excluded.remote_username,
          remote_host_fingerprint = excluded.remote_host_fingerprint,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.peerHostId,
        record.ownerUserId,
        record.username,
        record.accessTokenEncrypted,
        record.refreshTokenEncrypted,
        record.expiresAt,
        record.remoteUserId,
        record.remoteUsername,
        record.remoteHostFingerprint,
        record.savedAt,
        record.updatedAt,
      );

    return record;
  }

  delete(peerHostId: string, ownerUserId: string): void {
    this.db
      .prepare(
        `DELETE FROM peer_host_sessions
         WHERE peer_host_id = ?
           AND owner_user_id = ?`,
      )
      .run(peerHostId, ownerUserId);
  }

  deleteByPeerHost(peerHostId: string): void {
    this.db
      .prepare("DELETE FROM peer_host_sessions WHERE peer_host_id = ?")
      .run(peerHostId);
  }
}

interface PeerHostRow {
  id: string;
  owner_user_id: string;
  name: string;
  alias: string | null;
  tag_color: string | null;
  base_url: string;
  normalized_base_url: string;
  status: PeerHostStatus;
  remote_version: string | null;
  remote_api_compatibility: string | null;
  remote_host_fingerprint: string | null;
  last_checked_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
}

interface PeerHostWorkspaceBindingRow {
  owner_user_id: string;
  active_host_id: string;
  workspace_key: string;
  selected_host_id: string;
  remote_workspace_id: string | null;
  remote_workspace_path: string | null;
  remote_workspace_name: string | null;
  created_at: string;
  updated_at: string;
}

interface PeerHostSessionRow {
  peer_host_id: string;
  owner_user_id: string;
  username: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | null;
  remote_user_id: string;
  remote_username: string;
  remote_host_fingerprint: string | null;
  saved_at: string;
  updated_at: string;
}

function mapPeerHostRow(row: PeerHostRow): PeerHostRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    alias: row.alias,
    tagColor: row.tag_color,
    baseUrl: row.base_url,
    normalizedBaseUrl: row.normalized_base_url,
    status: row.status,
    remoteVersion: row.remote_version,
    remoteApiCompatibility: row.remote_api_compatibility,
    remoteHostFingerprint: row.remote_host_fingerprint,
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at,
  };
}

function mapPeerHostWorkspaceBindingRow(
  row: PeerHostWorkspaceBindingRow,
): PeerHostWorkspaceBindingRecord {
  return {
    ownerUserId: row.owner_user_id,
    activeHostId: row.active_host_id,
    workspaceKey: row.workspace_key,
    selectedHostId: row.selected_host_id,
    remoteWorkspaceId: row.remote_workspace_id,
    remoteWorkspacePath: row.remote_workspace_path,
    remoteWorkspaceName: row.remote_workspace_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPeerHostSessionRow(row: PeerHostSessionRow): PeerHostSessionRecord {
  return {
    peerHostId: row.peer_host_id,
    ownerUserId: row.owner_user_id,
    username: row.username,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    expiresAt: row.expires_at,
    remoteUserId: row.remote_user_id,
    remoteUsername: row.remote_username,
    remoteHostFingerprint: row.remote_host_fingerprint,
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
  };
}
