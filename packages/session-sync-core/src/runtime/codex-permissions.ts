export function createCodexThreadPermissionOptions(
  permissionMode: string | null
): Record<string, unknown> {
  if (permissionMode === "bypassPermissions") {
    return {
      approvalPolicy: "never"
    };
  }

  if (permissionMode === "acceptEdits") {
    return {
      approvalPolicy: "never"
    };
  }

  return {};
}
