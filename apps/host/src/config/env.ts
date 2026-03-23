import os from "node:os";
import path from "node:path";

export interface HostConfig {
  host: string;
  port: number;
  databasePath: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  claudeCodeHomeDir: string;
  codexHomeDir: string;
}

export function resolveHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const homeDir = os.homedir();

  return {
    host: overrides.host ?? process.env.CODINGNS_HOST ?? "127.0.0.1",
    port: overrides.port ?? Number(process.env.CODINGNS_PORT ?? "3321"),
    databasePath:
      overrides.databasePath ??
      process.env.CODINGNS_DB_PATH ??
      path.resolve(process.cwd(), "apps", "host", "data", "host", "host.sqlite"),
    accessTokenTtlSeconds:
      overrides.accessTokenTtlSeconds ??
      Number(process.env.CODINGNS_ACCESS_TOKEN_TTL ?? "900"),
    refreshTokenTtlSeconds:
      overrides.refreshTokenTtlSeconds ??
      Number(process.env.CODINGNS_REFRESH_TOKEN_TTL ?? "604800"),
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
