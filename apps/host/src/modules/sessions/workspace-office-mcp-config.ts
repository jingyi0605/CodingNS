import path from "node:path";

export const WORKSPACE_OFFICE_MCP_NAME = "codingns-workspace-office";
export const CODINGNS_OFFICE_MCP_AUTH_FILE_ENV = "CODINGNS_OFFICE_MCP_AUTH_FILE";
export const CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV = "CODINGNS_CODEX_ENABLE_WORKSPACE_OFFICE_MCP";
export const DEFAULT_CODEX_WORKSPACE_OFFICE_MCP_STARTUP_TIMEOUT_SEC = 90;

const REPO_ROOT_DIR = path.resolve(import.meta.dirname, "../../../../../");

export function buildWorkspaceOfficeMcpCommandArgs(
  authFilePath: string,
  repoRootDir = REPO_ROOT_DIR
): string[] {
  return [
    path.join(repoRootDir, "packages", "codingns", "bin", "codingns.mjs"),
    "mcp",
    "workspace-office",
    "serve",
    "--auth-file",
    authFilePath
  ];
}

export function buildCodexWorkspaceOfficeMcpConfigOverrides(input: {
  authFilePath: string;
  nodePath?: string;
  repoRootDir?: string;
  startupTimeoutSec?: number;
}): string[] {
  const mcpCommandArgs = buildWorkspaceOfficeMcpCommandArgs(
    input.authFilePath,
    input.repoRootDir ?? REPO_ROOT_DIR
  );
  const startupTimeoutSec = Math.max(
    1,
    Math.trunc(input.startupTimeoutSec ?? DEFAULT_CODEX_WORKSPACE_OFFICE_MCP_STARTUP_TIMEOUT_SEC)
  );

  return [
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.command=${JSON.stringify(input.nodePath ?? process.execPath)}`,
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.args=${JSON.stringify(mcpCommandArgs)}`,
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.env.${CODINGNS_OFFICE_MCP_AUTH_FILE_ENV}=${JSON.stringify(input.authFilePath)}`,
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.startup_timeout_sec=${startupTimeoutSec}`
  ];
}

export function shouldEnableCodexWorkspaceOfficeMcp(env: NodeJS.ProcessEnv): boolean {
  return /^(1|true|yes)$/i.test((env[CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV] ?? "").trim());
}

export function buildCodexAppServerArgsWithWorkspaceOfficeMcp(
  env: NodeJS.ProcessEnv
): string[] {
  const baseArgs = ["app-server"];

  if (!shouldEnableCodexWorkspaceOfficeMcp(env)) {
    return baseArgs;
  }

  const authFilePath = (env[CODINGNS_OFFICE_MCP_AUTH_FILE_ENV] ?? "").trim();

  if (!authFilePath) {
    return baseArgs;
  }

  const overrides = buildCodexWorkspaceOfficeMcpConfigOverrides({
    authFilePath
  });

  for (const override of overrides) {
    baseArgs.push("-c", override);
  }

  return baseArgs;
}
