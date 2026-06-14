export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexThreadPermissionOptions {
  approvalPolicy?: "never";
  sandbox?: CodexSandboxMode;
  sandboxMode?: CodexSandboxMode;
  sandboxPolicy?:
    | {
        type: "readOnly";
        networkAccess?: boolean;
      }
    | {
        type: "workspaceWrite";
        networkAccess?: boolean;
        writableRoots?: string[];
        excludeTmpdirEnvVar?: boolean;
        excludeSlashTmp?: boolean;
      }
    | {
        type: "dangerFullAccess";
      };
}

export interface CodexPermissionResolution {
  requestedPermissionMode: string | null;
  effectivePermissionMode: "default" | "acceptEdits" | "bypassPermissions";
  approvalPolicy: "never" | null;
  sandboxMode: CodexSandboxMode | null;
  reasoning: string;
}

export function resolveCodexPermissionResolution(
  permissionMode: string | null
): CodexPermissionResolution {
  if (permissionMode === "bypassPermissions") {
    return {
      requestedPermissionMode: permissionMode,
      effectivePermissionMode: "bypassPermissions",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      reasoning: "当前会话显式请求完整权限，Codex 会关闭审批并使用 danger-full-access 沙箱。"
    };
  }

  if (permissionMode === "acceptEdits") {
    return {
      requestedPermissionMode: permissionMode,
      effectivePermissionMode: "acceptEdits",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      reasoning: "当前会话显式请求允许编辑工作区，Codex 会关闭审批并使用 workspace-write 沙箱。"
    };
  }

  return {
    requestedPermissionMode: permissionMode,
    effectivePermissionMode: "default",
    approvalPolicy: null,
    sandboxMode: null,
    reasoning: "当前会话跟随 Codex CLI 默认权限配置；如果 CLI 默认沙箱是只读，这里也会保持只读。"
  };
}

export function createCodexThreadPermissionOptions(
  permissionMode: string | null
): CodexThreadPermissionOptions {
  const resolution = resolveCodexPermissionResolution(permissionMode);

  if (!resolution.approvalPolicy && !resolution.sandboxMode) {
    return {};
  }

  return {
    approvalPolicy: resolution.approvalPolicy ?? undefined,
    sandbox: resolution.sandboxMode ?? undefined,
    sandboxMode: resolution.sandboxMode ?? undefined,
    sandboxPolicy: mapSandboxModeToSandboxPolicy(resolution.sandboxMode)
  };
}

function mapSandboxModeToSandboxPolicy(
  sandboxMode: CodexSandboxMode | null
): CodexThreadPermissionOptions["sandboxPolicy"] {
  if (sandboxMode === "workspace-write") {
    return {
      type: "workspaceWrite"
    };
  }

  if (sandboxMode === "danger-full-access") {
    return {
      type: "dangerFullAccess"
    };
  }

  if (sandboxMode === "read-only") {
    return {
      type: "readOnly"
    };
  }

  return undefined;
}
