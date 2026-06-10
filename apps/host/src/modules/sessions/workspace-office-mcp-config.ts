import path from "node:path";
import fs from "node:fs";

export const WORKSPACE_OFFICE_MCP_NAME = "codingns-workspace-office";
export const CODINGNS_OFFICE_MCP_AUTH_FILE_ENV = "CODINGNS_OFFICE_MCP_AUTH_FILE";
export const CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV = "CODINGNS_CODEX_ENABLE_WORKSPACE_OFFICE_MCP";
export const DEFAULT_CODEX_WORKSPACE_OFFICE_MCP_STARTUP_TIMEOUT_SEC = 90;

const REPO_ROOT_DIR = path.resolve(import.meta.dirname, "../../../../../");

const PACKAGE_JSON_FILE_NAME = "package.json";
const CODINGNS_PACKAGE_NAME = "@jingyi0605/codingns";

export function buildWorkspaceOfficeMcpCommandArgs(
  authFilePath: string,
  packageRootDir = resolveCodingnsPackageRootDir()
): string[] {
  return [
    path.join(packageRootDir, "bin", "codingns.mjs"),
    "mcp",
    "workspace-office",
    "serve",
    "--auth-file",
    authFilePath
  ];
}

export function buildCodexWorkspaceOfficeMcpConfigOverrides(input: {
  authFilePath: string;
  instructionFilePath?: string | null;
  nodePath?: string;
  repoRootDir?: string;
  startupTimeoutSec?: number;
}): string[] {
  const mcpCommandArgs = buildWorkspaceOfficeMcpCommandArgs(
    input.authFilePath,
    input.repoRootDir ? path.join(input.repoRootDir, "packages", "codingns") : resolveCodingnsPackageRootDir()
  );
  const startupTimeoutSec = Math.max(
    1,
    Math.trunc(input.startupTimeoutSec ?? DEFAULT_CODEX_WORKSPACE_OFFICE_MCP_STARTUP_TIMEOUT_SEC)
  );

  const overrides = [
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.command=${JSON.stringify(input.nodePath ?? process.execPath)}`,
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.args=${JSON.stringify(mcpCommandArgs)}`,
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.env.${CODINGNS_OFFICE_MCP_AUTH_FILE_ENV}=${JSON.stringify(input.authFilePath)}`,
    `mcp_servers.${WORKSPACE_OFFICE_MCP_NAME}.startup_timeout_sec=${startupTimeoutSec}`
  ];

  const instructionFilePath = input.instructionFilePath?.trim() ?? "";

  if (instructionFilePath) {
    overrides.push(`model_instructions_file=${JSON.stringify(instructionFilePath)}`);
  }

  return overrides;
}

export function resolveCodingnsPackageRootDir(startDir = import.meta.dirname): string {
  const packageRootDir = findPackageRootDir(startDir);

  if (packageRootDir) {
    return packageRootDir;
  }

  const sourcePackageRootDir = path.join(REPO_ROOT_DIR, "packages", "codingns");

  if (isCodingnsPackageRootDir(sourcePackageRootDir)) {
    return sourcePackageRootDir;
  }

  return sourcePackageRootDir;
}

function findPackageRootDir(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (isCodingnsPackageRootDir(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function isCodingnsPackageRootDir(candidateDir: string): boolean {
  const packageJsonPath = path.join(candidateDir, PACKAGE_JSON_FILE_NAME);

  if (!fs.existsSync(packageJsonPath) || !fs.statSync(packageJsonPath).isFile()) {
    return false;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: unknown };

    return parsed.name === CODINGNS_PACKAGE_NAME
      && fs.existsSync(path.join(candidateDir, "bin", "codingns.mjs"));
  } catch {
    return false;
  }
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
  const instructionFilePath = (env.WORKSPACE_SESSION_ASSISTANT_FILE ?? "").trim();

  if (!authFilePath) {
    return baseArgs;
  }

  const overrides = buildCodexWorkspaceOfficeMcpConfigOverrides({
    authFilePath,
    instructionFilePath: instructionFilePath || null
  });

  for (const override of overrides) {
    baseArgs.push("-c", override);
  }

  return baseArgs;
}
