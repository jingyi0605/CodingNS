import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginPermissionGrantRepository } from "../../storage/repositories/plugin-permission-grant-repository.js";
import type {
  PluginDesktopPermission,
  PluginManifest,
  PluginPermissionGrant,
  PluginPermissionKey
} from "../../types/domain.js";

export interface PluginRuntimeContext {
  pluginId: string;
  workspaceId: string;
}

const DESKTOP_PERMISSION_KEY_MAP: Record<PluginDesktopPermission, PluginPermissionKey> = {
  open_file: "desktop.open_file",
  reveal_in_file_manager: "desktop.reveal_in_file_manager"
};

export class PluginPermissionService {
  constructor(
    private readonly pluginPermissionGrantRepository?: PluginPermissionGrantRepository
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
