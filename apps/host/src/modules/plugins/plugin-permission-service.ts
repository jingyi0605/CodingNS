import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginAuditEventRepository } from "../../storage/repositories/plugin-audit-event-repository.js";
import type { PluginPermissionGrantRepository } from "../../storage/repositories/plugin-permission-grant-repository.js";
import type {
  PluginDesktopPermission,
  PluginAuditEventType,
  PluginManifest,
  PluginPermissionGrant,
  PluginPermissionGrantMode,
  PluginPermissionKey
} from "../../types/domain.js";

export interface PluginRuntimeContext {
  pluginId: string;
  workspaceId: string;
}

export interface PluginGrantRequestInput {
  manifest: PluginManifest;
  pluginId: string;
  workspaceId: string;
  permissionKey: PluginPermissionKey;
  scopeType: "workspace" | "directory" | "file";
  scopePath: string | null;
  grantMode: PluginPermissionGrantMode;
  runtimeSessionId: string | null;
  grantedByUserId: string;
}

const DESKTOP_PERMISSION_KEY_MAP: Record<PluginDesktopPermission, PluginPermissionKey> = {
  open_file: "desktop.open_file",
  reveal_in_file_manager: "desktop.reveal_in_file_manager"
};

export class PluginPermissionService {
  constructor(
    private readonly pluginPermissionGrantRepository?: PluginPermissionGrantRepository,
    private readonly pluginAuditEventRepository?: PluginAuditEventRepository
  ) {}

  assertWorkspaceScopedContext(workspaceId: string | null | undefined): string {
    const normalized = workspaceId?.trim() ?? "";
    if (!normalized) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_WORKSPACE_CONTEXT_REQUIRED",
        detail: "插件运行必须绑定当前工作区"
      });
    }

    return normalized;
  }

  assertManifestPermissionDeclared(
    manifest: PluginManifest,
    permissionKey: PluginPermissionKey
  ): void {
    if (isPermissionDeclared(manifest, permissionKey)) {
      return;
    }

    throw new AppError({
      statusCode: 403,
      errorCode: "PLUGIN_PERMISSION_DECLARATION_MISSING",
      detail: `插件未声明权限：${permissionKey}`,
      data: {
        permissionKey
      }
    });
  }

  requirePermissionGrant(input: {
    manifest: PluginManifest;
    pluginId: string;
    workspaceId: string;
    permissionKey: PluginPermissionKey;
    scopePath?: string | null;
    runtimeSessionId?: string | null;
  }): PluginPermissionGrant {
    this.assertManifestPermissionDeclared(input.manifest, input.permissionKey);

    if (!this.pluginPermissionGrantRepository) {
      throwGrantRequired(input.permissionKey, input.scopePath ?? null);
    }

    const grants = this.pluginPermissionGrantRepository.listActiveByPluginWorkspaceAndPermission(
      input.pluginId,
      input.workspaceId,
      input.permissionKey,
      nowIso()
    );
    const matched = grants.find((grant) =>
      isGrantMatchingScope(grant, input.scopePath ?? null, input.runtimeSessionId ?? null)
    );

    if (!matched) {
      throwGrantRequired(input.permissionKey, input.scopePath ?? null);
    }

    return matched;
  }

  assertWorkspaceRead(manifest: PluginManifest, context: PluginRuntimeContext): PluginPermissionGrant {
    return this.requirePermissionGrant({
      manifest,
      pluginId: context.pluginId,
      workspaceId: context.workspaceId,
      permissionKey: "workspace.read_file"
    });
  }

  assertWorkspaceWrite(manifest: PluginManifest, context: PluginRuntimeContext, scopePath?: string | null): PluginPermissionGrant {
    return this.requirePermissionGrant({
      manifest,
      pluginId: context.pluginId,
      workspaceId: context.workspaceId,
      permissionKey: "workspace.write_file",
      scopePath
    });
  }

  assertDesktopPermission(
    manifest: PluginManifest,
    context: PluginRuntimeContext,
    permission: PluginDesktopPermission,
    scopePath?: string | null,
    runtimeSessionId?: string | null
  ): PluginPermissionGrant {
    return this.requirePermissionGrant({
      manifest,
      pluginId: context.pluginId,
      workspaceId: context.workspaceId,
      permissionKey: DESKTOP_PERMISSION_KEY_MAP[permission],
      scopePath,
      runtimeSessionId
    });
  }

  listWorkspaceGrants(pluginId: string, workspaceId: string): PluginPermissionGrant[] {
    if (!this.pluginPermissionGrantRepository) {
      return [];
    }

    return this.pluginPermissionGrantRepository.listActiveByPluginAndWorkspace(
      pluginId,
      workspaceId,
      nowIso()
    );
  }

  createGrant(input: PluginGrantRequestInput): PluginPermissionGrant {
    if (!this.pluginPermissionGrantRepository) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PLUGIN_PERMISSION_STORE_UNAVAILABLE",
        detail: "插件授权存储当前不可用"
      });
    }

    this.assertManifestPermissionDeclared(input.manifest, input.permissionKey);
    const normalizedScope = normalizeGrantScope(input.scopeType, input.scopePath);
    assertGrantModeAllowed(input.grantMode, input.runtimeSessionId);

    const grantedAt = nowIso();
    const record: PluginPermissionGrant = {
      id: createId(),
      pluginId: input.pluginId,
      workspaceId: input.workspaceId,
      permissionKey: input.permissionKey,
      scopeType: normalizedScope.scopeType,
      scopePath: normalizedScope.scopePath,
      grantMode: input.grantMode,
      grantedByUserId: input.grantedByUserId,
      runtimeSessionId: input.grantMode === "session" ? input.runtimeSessionId : null,
      createdAt: grantedAt,
      expiresAt: null,
      revokedAt: null
    };

    const created = this.pluginPermissionGrantRepository.create(record);
    this.recordAuditEvent("plugin.permission_granted", created.pluginId, created.workspaceId, created.grantedByUserId, {
      grantId: created.id,
      permissionKey: created.permissionKey,
      scopeType: created.scopeType,
      scopePath: created.scopePath,
      grantMode: created.grantMode,
      runtimeSessionId: created.runtimeSessionId
    });

    return created;
  }

  revokeGrant(pluginId: string, workspaceId: string, grantId: string, actorUserId: string): PluginPermissionGrant {
    if (!this.pluginPermissionGrantRepository) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PLUGIN_PERMISSION_STORE_UNAVAILABLE",
        detail: "插件授权存储当前不可用"
      });
    }

    const existing = this.pluginPermissionGrantRepository.findById(grantId);
    if (!existing || existing.pluginId !== pluginId || existing.workspaceId !== workspaceId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_PERMISSION_GRANT_NOT_FOUND",
        detail: "未找到当前工作区下的插件授权记录"
      });
    }

    const revoked = this.pluginPermissionGrantRepository.revokeById(grantId, nowIso());
    if (!revoked) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_PERMISSION_GRANT_NOT_FOUND",
        detail: "未找到当前工作区下的插件授权记录"
      });
    }

    this.recordAuditEvent("plugin.permission_revoked", revoked.pluginId, revoked.workspaceId, actorUserId, {
      grantId: revoked.id,
      permissionKey: revoked.permissionKey,
      scopeType: revoked.scopeType,
      scopePath: revoked.scopePath,
      grantMode: revoked.grantMode,
      runtimeSessionId: revoked.runtimeSessionId
    });

    return revoked;
  }

  recordPermissionDenied(input: {
    pluginId: string;
    workspaceId: string;
    actorUserId: string | null;
    permissionKey: PluginPermissionKey;
    scopePath: string | null;
    runtimeSessionId?: string | null;
    reason: "declaration_missing" | "grant_required";
  }): void {
    this.recordAuditEvent("plugin.permission_denied", input.pluginId, input.workspaceId, input.actorUserId, {
      permissionKey: input.permissionKey,
      scopeType: input.scopePath ? "file" : "workspace",
      scopePath: input.scopePath,
      runtimeSessionId: input.runtimeSessionId ?? null,
      reason: input.reason
    });
  }

  private recordAuditEvent(
    eventType: PluginAuditEventType,
    pluginId: string,
    workspaceId: string,
    actorUserId: string | null,
    payload: Record<string, unknown>
  ): void {
    if (!this.pluginAuditEventRepository) {
      return;
    }

    this.pluginAuditEventRepository.create({
      id: createId(),
      pluginId,
      workspaceId,
      eventType,
      actorUserId,
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso()
    });
  }
}

function isPermissionDeclared(manifest: PluginManifest, permissionKey: PluginPermissionKey): boolean {
  switch (permissionKey) {
    case "workspace.read_file":
    case "workspace.list_dir":
      return manifest.permissions.workspaceRead === true;
    case "workspace.write_file":
      return manifest.permissions.workspaceWrite === true;
    case "desktop.open_file":
      return manifest.permissions.desktop?.includes("open_file") === true;
    case "desktop.reveal_in_file_manager":
      return manifest.permissions.desktop?.includes("reveal_in_file_manager") === true;
    default:
      return false;
  }
}

function isGrantMatchingScope(
  grant: PluginPermissionGrant,
  requestedScopePath: string | null,
  runtimeSessionId: string | null
): boolean {
  if (grant.grantMode === "session" && grant.runtimeSessionId && runtimeSessionId && grant.runtimeSessionId !== runtimeSessionId) {
    return false;
  }

  if (grant.scopeType === "workspace") {
    return true;
  }

  const normalizedRequestedPath = normalizeScopePath(requestedScopePath);
  const normalizedGrantPath = normalizeScopePath(grant.scopePath);

  if (!normalizedRequestedPath || !normalizedGrantPath) {
    return false;
  }

  if (grant.scopeType === "file") {
    return normalizedRequestedPath === normalizedGrantPath;
  }

  return normalizedRequestedPath === normalizedGrantPath
    || normalizedRequestedPath.startsWith(`${normalizedGrantPath}/`);
}

function normalizeScopePath(pathValue: string | null | undefined): string | null {
  const normalized = (pathValue?.trim() ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return normalized || null;
}

function normalizeGrantScope(
  scopeType: "workspace" | "directory" | "file",
  scopePath: string | null
): {
  scopeType: "workspace" | "directory" | "file";
  scopePath: string | null;
} {
  const normalizedScopePath = normalizeScopePath(scopePath);

  if (scopeType === "workspace") {
    if (normalizedScopePath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PLUGIN_PERMISSION_SCOPE_INVALID",
        detail: "全工作区授权不能再附带路径范围"
      });
    }

    return {
      scopeType,
      scopePath: null
    };
  }

  if (!normalizedScopePath) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_PERMISSION_SCOPE_INVALID",
      detail: "目录或文件授权必须提供相对路径"
    });
  }

  return {
    scopeType,
    scopePath: normalizedScopePath
  };
}

function assertGrantModeAllowed(
  grantMode: PluginPermissionGrantMode,
  runtimeSessionId: string | null
): void {
  if (grantMode === "session" && !runtimeSessionId) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_PERMISSION_SCOPE_INVALID",
      detail: "会话授权必须绑定当前 runtimeSessionId"
    });
  }
}

function throwGrantRequired(permissionKey: PluginPermissionKey, scopePath: string | null): never {
  throw new AppError({
    statusCode: 403,
    errorCode: "PLUGIN_PERMISSION_GRANT_REQUIRED",
    detail: `插件权限尚未授权：${permissionKey}`,
    data: {
      permissionKey,
      scopeType: scopePath ? "file" : "workspace",
      scopePath,
      grantOptions: ["once", "session", "persistent"]
    }
  });
}
