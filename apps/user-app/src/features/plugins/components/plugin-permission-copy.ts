import { t } from "../../../shared/i18n";
import type { PluginPermissionGrantDto } from "../api/plugins-api";

export function getPluginPermissionLabel(permissionKey: PluginPermissionGrantDto["permissionKey"]): string {
  switch (permissionKey) {
    case "workspace.read_file":
      return t("plugins.permissionNameReadFile");
    case "workspace.list_dir":
      return t("plugins.permissionNameListDirectory");
    case "workspace.write_file":
      return t("plugins.permissionNameWriteFile");
    case "desktop.open_file":
      return t("plugins.permissionNameOpenFile");
    case "desktop.reveal_in_file_manager":
      return t("plugins.permissionNameRevealInFileManager");
    default:
      return permissionKey;
  }
}

export function getPluginPermissionScopeLabel(
  scopeType: PluginPermissionGrantDto["scopeType"],
  scopePath: string | null
): string {
  if (scopeType === "workspace") {
    return t("plugins.permissionScopeWorkspace");
  }

  if (!scopePath) {
    return t("plugins.permissionScopeUnknown");
  }

  if (scopeType === "directory") {
    return t("plugins.permissionScopeDirectory", {
      scopePath
    });
  }

  return t("plugins.permissionScopeFile", {
    scopePath
  });
}

export function getPluginPermissionGrantModeLabel(
  grantMode: PluginPermissionGrantDto["grantMode"]
): string {
  switch (grantMode) {
    case "once":
      return t("plugins.permissionGrantModeOnce");
    case "session":
      return t("plugins.permissionGrantModeSession");
    case "persistent":
      return t("plugins.permissionGrantModePersistent");
    default:
      return grantMode;
  }
}
