import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OpenCodeBaseUrlResolver } from "./opencode-base-url-resolver.js";

export interface HostConfig {
  host: string;
  port: number;
  databasePath: string;
  opencodeBaseUrl: string;
  opencodeBaseUrlResolver?: OpenCodeBaseUrlResolver;
  opencodeDataDir: string;
  opencodeDbPath: string;
  releaseChannel: "stable" | "beta";
  releaseManifestRoot: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  terminalIdleTimeoutSeconds: number;
  claudeCodeHomeDir: string;
  codexHomeDir: string;
  codexCliPath: string;
  claudeHookBridgeToken: string;
}

export function resolveHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const homeDir = os.homedir();
  const appRootDir = resolveAppRootDir();
  const opencodeDataDir =
    overrides.opencodeDataDir ??
    process.env.CODINGNS_OPENCODE_DATA_DIR ??
    path.join(homeDir, ".local", "share", "opencode");
  const databasePath =
    overrides.databasePath ??
    process.env.CODINGNS_DB_PATH ??
    path.join(appRootDir, "data", "host", "host.sqlite");
  const opencodeDbPath =
    overrides.opencodeDbPath ??
    process.env.CODINGNS_OPENCODE_DB_PATH ??
    path.join(opencodeDataDir, "opencode.db");
  const codexCliPath = resolveCodexCliPath(
    overrides.codexCliPath ?? process.env.CODINGNS_CODEX_COMMAND,
    homeDir
  );
  const configuredOpenCodeBaseUrl =
    overrides.opencodeBaseUrl ?? process.env.CODINGNS_OPENCODE_BASE_URL ?? null;

  return {
    host: overrides.host ?? process.env.CODINGNS_HOST ?? "0.0.0.0",
    port: overrides.port ?? Number(process.env.CODINGNS_PORT ?? "3002"),
    databasePath,
    opencodeBaseUrl: configuredOpenCodeBaseUrl ?? "http://127.0.0.1:4096",
    opencodeBaseUrlResolver:
      overrides.opencodeBaseUrlResolver
      ?? new OpenCodeBaseUrlResolver({
        configuredBaseUrl: configuredOpenCodeBaseUrl
      }),
    opencodeDataDir,
    opencodeDbPath,
    releaseChannel:
      overrides.releaseChannel ??
      ((process.env.CODINGNS_RELEASE_CHANNEL as "stable" | "beta" | undefined) ?? "stable"),
    releaseManifestRoot:
      overrides.releaseManifestRoot ??
      process.env.CODINGNS_RELEASE_MANIFEST_ROOT ??
      path.join(appRootDir, "data", "releases"),
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
      path.join(homeDir, ".codex"),
    codexCliPath,
    claudeHookBridgeToken:
      overrides.claudeHookBridgeToken ??
      process.env.CODINGNS_CLAUDE_HOOK_TOKEN ??
      resolvePersistentSecret(path.join(path.dirname(databasePath), "claude-hook-token"))
  };
}

function resolveAppRootDir(): string {
  const configDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(configDir, "..", "..");

  // 构建产物位于 .build/src/config，源代码位于 src/config，统一回到应用根目录。
  return path.basename(candidate) === ".build" ? path.dirname(candidate) : candidate;
}

function resolveCodexCliPath(configuredPath: string | undefined, homeDir: string): string {
  const normalizedConfiguredPath = configuredPath?.trim();

  if (normalizedConfiguredPath) {
    return normalizedConfiguredPath;
  }

  const candidates = [
    path.resolve(process.cwd(), "node_modules", ".bin", "codex"),
    path.resolve(process.cwd(), "packages", "session-sync-core", "node_modules", ".bin", "codex"),
    path.join(homeDir, ".local", "bin", "codex"),
    process.platform === "darwin" ? "/Applications/Codex.app/Contents/Resources/codex" : null
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "codex";
}

function resolvePersistentSecret(secretPath: string): string {
  try {
    if (existsSync(secretPath)) {
      const existing = readFileSync(secretPath, "utf8").trim();

      if (existing.length > 0) {
        return existing;
      }
    }

    mkdirSync(path.dirname(secretPath), { recursive: true });
    const nextSecret = crypto.randomBytes(24).toString("hex");
    writeFileSync(secretPath, nextSecret, "utf8");
    return nextSecret;
  } catch {
    return crypto.randomBytes(24).toString("hex");
  }
}
