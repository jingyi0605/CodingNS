import os from "node:os";
import path from "node:path";

export interface HostConfig {
  host: string;
  port: number;
  databasePath: string;
  releaseChannel: "stable" | "beta";
  releaseManifestRoot: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  terminalIdleTimeoutSeconds: number;
  claudeCodeHomeDir: string;
  codexHomeDir: string;
}

export function resolveHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const homeDir = os.homedir();

  return {
    host: overrides.host ?? process.env.CODINGNS_HOST ?? "127.0.0.1",
    port: overrides.port ?? Number(process.env.CODINGNS_PORT ?? "3002"),
    databasePath:
      overrides.databasePath ??
      process.env.CODINGNS_DB_PATH ??
      path.resolve(process.cwd(), "apps", "host", "data", "host", "host.sqlite"),
    releaseChannel:
      overrides.releaseChannel ??
      ((process.env.CODINGNS_RELEASE_CHANNEL as "stable" | "beta" | undefined) ?? "stable"),
    releaseManifestRoot:
      overrides.releaseManifestRoot ??
      process.env.CODINGNS_RELEASE_MANIFEST_ROOT ??
      path.resolve(process.cwd(), "apps", "host", "data", "releases"),
    accessTokenTtlSeconds:
      overrides.accessTokenTtlSeconds ??
      Number(process.env.CODINGNS_ACCESS_TOKEN_TTL ?? "31536000"),
    refreshTokenTtlSeconds:
      overrides.refreshTokenTtlSeconds ??
      Number(process.env.CODINGNS_REFRESH_TOKEN_TTL ?? "31536000"),
    terminalIdleTimeoutSeconds:
      overrides.terminalIdleTimeoutSeconds ??
      Number(process.env.CODINGNS_TERMINAL_IDLE_TIMEOUT ?? "900"),
    claudeCodeHomeDir:
      overrides.claudeCodeHomeDir ??
      process.env.CODINGNS_CLAUDE_CODE_HOME ??
      path.join(homeDir, ".claude"),
    codexHomeDir:
      overrides.codexHomeDir ??
      process.env.CODINGNS_CODEX_HOME ??
      path.join(homeDir, ".codex")
  };
}
