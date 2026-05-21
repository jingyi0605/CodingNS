import { AppError } from "../../shared/errors/app-error.js";
import type { PluginManifest, PluginDesktopPermission } from "../../types/domain.js";

export interface PluginRuntimeContext {
  pluginId: string;
  workspaceId: string;
}

export class PluginPermissionService {
  assertWorkspaceRead(manifest: PluginManifest): void {
    if (manifest.permissions.workspaceRead) {
      return;
    }

    throw new AppError({
      statusCode: 403,
      errorCode: "PLUGIN_PERMISSION_DENIED",
      detail: "当前插件没有工作区读取权限"
    });
  }

  assertDesktopPermission(
    manifest: PluginManifest,
    permission: PluginDesktopPermission
  ): void {
    if (manifest.permissions.desktop?.includes(permission)) {
      return;
    }

    throw new AppError({
      statusCode: 403,
      errorCode: "PLUGIN_PERMISSION_DENIED",
      detail: `当前插件没有桌面权限：${permission}`
    });
  }

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
}
