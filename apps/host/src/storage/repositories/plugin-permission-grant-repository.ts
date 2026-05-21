import type Database from "better-sqlite3";

import type {
  PluginPermissionGrant,
  PluginPermissionGrantMode,
  PluginPermissionKey,
  PluginPermissionScopeType
} from "../../types/domain.js";

export class PluginPermissionGrantRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PluginPermissionGrant): PluginPermissionGrant {
    this.db
      .prepare(
        `INSERT INTO plugin_permission_grants (
           id,
           plugin_id,
           workspace_id,
           permission_key,
           scope_type,
           scope_path,
           grant_mode,
           granted_by_user_id,
           runtime_session_id,
           created_at,
           expires_at,
           revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.pluginId,
        record.workspaceId,
        record.permissionKey,
        record.scopeType,
        record.scopePath,
        record.grantMode,
        record.grantedByUserId,
        record.runtimeSessionId,
        record.createdAt,
        record.expiresAt,
        record.revokedAt
      );

    return record;
  }

  findById(id: string): PluginPermissionGrant | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           permission_key,
           scope_type,
           scope_path,
           grant_mode,
           granted_by_user_id,
           runtime_session_id,
           created_at,
           expires_at,
           revoked_at
         FROM plugin_permission_grants
         WHERE id = ?`
      )
      .get(id) as PluginPermissionGrantRow | undefined;

    return row ? mapPluginPermissionGrantRow(row) : null;
  }

  listByPluginAndWorkspace(pluginId: string, workspaceId: string): PluginPermissionGrant[] {
    return this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           permission_key,
           scope_type,
           scope_path,
           grant_mode,
           granted_by_user_id,
           runtime_session_id,
           created_at,
           expires_at,
           revoked_at
         FROM plugin_permission_grants
         WHERE plugin_id = ?
           AND workspace_id = ?
         ORDER BY created_at DESC`
      )
      .all(pluginId, workspaceId)
      .map((row) => mapPluginPermissionGrantRow(row as PluginPermissionGrantRow));
  }

  listActiveByPluginWorkspaceAndPermission(
    pluginId: string,
    workspaceId: string,
    permissionKey: PluginPermissionKey,
    referenceAt: string
  ): PluginPermissionGrant[] {
    return this.db
      .prepare(
        `SELECT
           id,
           plugin_id,
           workspace_id,
           permission_key,
           scope_type,
           scope_path,
           grant_mode,
           granted_by_user_id,
           runtime_session_id,
           created_at,
           expires_at,
           revoked_at
         FROM plugin_permission_grants
         WHERE plugin_id = ?
           AND workspace_id = ?
           AND permission_key = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`
      )
      .all(pluginId, workspaceId, permissionKey, referenceAt)
      .map((row) => mapPluginPermissionGrantRow(row as PluginPermissionGrantRow));
  }

  revokeById(id: string, revokedAt: string): PluginPermissionGrant | null {
    this.db
      .prepare(
        `UPDATE plugin_permission_grants
         SET revoked_at = ?
         WHERE id = ?
           AND revoked_at IS NULL`
      )
      .run(revokedAt, id);

    return this.findById(id);
  }
}

interface PluginPermissionGrantRow {
  id: string;
  plugin_id: string;
  workspace_id: string;
  permission_key: PluginPermissionKey;
  scope_type: PluginPermissionScopeType;
  scope_path: string | null;
  grant_mode: PluginPermissionGrantMode;
  granted_by_user_id: string;
  runtime_session_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

function mapPluginPermissionGrantRow(row: PluginPermissionGrantRow): PluginPermissionGrant {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    workspaceId: row.workspace_id,
    permissionKey: row.permission_key,
    scopeType: row.scope_type,
    scopePath: row.scope_path,
    grantMode: row.grant_mode,
    grantedByUserId: row.granted_by_user_id,
    runtimeSessionId: row.runtime_session_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}
