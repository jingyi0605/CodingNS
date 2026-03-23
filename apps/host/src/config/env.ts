import path from "node:path";

export interface HostConfig {
  host: string;
  port: number;
  databasePath: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

export function resolveHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
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
      Number(process.env.CODINGNS_REFRESH_TOKEN_TTL ?? "604800")
  };
}
