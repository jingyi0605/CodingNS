export function createCodexThreadPermissionOptions(
  permissionMode: string | null
): Record<string, unknown> {
  if (permissionMode === "bypassPermissions") {
    return {
      sandboxMode: "danger-full-access",
      approvalPolicy: "never"
    };
  }

  if (permissionMode === "acceptEdits") {
    return {
      sandboxMode: "workspace-write",
      approvalPolicy: "never"
    };
  }

  return {};
}
