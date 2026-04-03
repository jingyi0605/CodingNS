import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OpenCodeBaseUrlResolver } from "./opencode-base-url-resolver.js";

export interface HostConfig {
  host: string;
  port: number;
  webUiDir: string | null;
  databasePath: string;
  geminiHomeDir: string;
  geminiCliPath: string;
  kimiHomeDir: string;
  kimiCliPath: string;
  kimiConfigPath: string;
  kimiDefaultModel: string | null;
  opencodeBaseUrl: string;
  opencodeCliPath: string;
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
  serverUpdatePackageName: string;
  npmRegistryBaseUrl: string;
  demoMode: boolean;
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
  const geminiHomeDir =
    overrides.geminiHomeDir ??
    process.env.CODINGNS_GEMINI_HOME ??
    path.join(homeDir, ".gemini");
  const kimiHomeDir =
    overrides.kimiHomeDir ??
    process.env.CODINGNS_KIMI_HOME ??
    path.join(homeDir, ".kimi");
  const codexCliPath = resolveCodexCliPath(
    overrides.codexCliPath ?? process.env.CODINGNS_CODEX_COMMAND,
    homeDir
  );
  const geminiCliPath = resolveGeminiCliPath(
    overrides.geminiCliPath ?? process.env.CODINGNS_GEMINI_COMMAND,
    homeDir
  );
  const kimiCliPath = resolveKimiCliPath(
    overrides.kimiCliPath ?? process.env.CODINGNS_KIMI_COMMAND,
    homeDir
  );
  const kimiConfigPath =
    overrides.kimiConfigPath ??
    process.env.CODINGNS_KIMI_CONFIG_PATH ??
    path.join(kimiHomeDir, "config.toml");
  const opencodeCliPath = resolveOpenCodeCliPath(
    overrides.opencodeCliPath ?? process.env.CODINGNS_OPENCODE_COMMAND,
    homeDir
  );
  const configuredOpenCodeBaseUrl = normalizeOptionalText(
    overrides.opencodeBaseUrl ?? process.env.CODINGNS_OPENCODE_BASE_URL ?? null
  );

  return {
    host: overrides.host ?? process.env.CODINGNS_HOST ?? "0.0.0.0",
    port: overrides.port ?? Number(process.env.CODINGNS_PORT ?? "3002"),
    webUiDir:
      overrides.webUiDir ??
      resolveExistingDir(
        normalizeOptionalText(process.env.CODINGNS_WEB_UI_DIR) ?? path.join(appRootDir, "public")
      ),
    databasePath,
    geminiHomeDir,
    geminiCliPath,
    kimiHomeDir,
    kimiCliPath,
    kimiConfigPath,
    kimiDefaultModel:
      overrides.kimiDefaultModel ?? resolveKimiDefaultModelFromConfig(kimiConfigPath),
    opencodeBaseUrl: configuredOpenCodeBaseUrl ?? "",
    opencodeCliPath,
    opencodeBaseUrlResolver:
      overrides.opencodeBaseUrlResolver
      ?? new OpenCodeBaseUrlResolver({
        configuredBaseUrl: configuredOpenCodeBaseUrl,
        commandPath: opencodeCliPath
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
      resolvePersistentSecret(path.join(path.dirname(databasePath), "claude-hook-token")),
    serverUpdatePackageName:
      overrides.serverUpdatePackageName ??
      process.env.CODINGNS_SERVER_UPDATE_PACKAGE_NAME ??
      "@jingyi0605/codingns",
    npmRegistryBaseUrl:
      overrides.npmRegistryBaseUrl ??
      process.env.CODINGNS_NPM_REGISTRY_BASE_URL ??
      "https://registry.npmjs.org",
    demoMode:
      overrides.demoMode ?? process.env.DEMO_MODE === "true"
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

  const resolvedCodexScript = resolveModuleSpecifier("@openai/codex/bin/codex.js");
  const resolvedCodexSdkEntry = resolveModuleSpecifier("@openai/codex-sdk");
  const inferredPackageRoots = uniquePaths(
    [
      resolvedCodexScript ? path.dirname(path.dirname(resolvedCodexScript)) : null,
      resolvedCodexSdkEntry ? path.dirname(path.dirname(resolvedCodexSdkEntry)) : null
    ].filter((value): value is string => Boolean(value))
  );

  if (resolvedCodexScript) {
    return resolvedCodexScript;
  }

  const configDir = path.dirname(fileURLToPath(import.meta.url));
  const moduleSearchRoots = uniquePaths([
    process.cwd(),
    path.resolve(configDir, "..", "..", ".."),
    path.resolve(configDir, "..", ".."),
    resolveAppRootDir(),
    ...inferredPackageRoots
  ]);
  const nestedBinSegments = ["node_modules", "@openai", "codex-sdk", "node_modules", ".bin"];
  const nestedCodexScriptSegments = [
    "node_modules",
    "@openai",
    "codex-sdk",
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js"
  ];
  const candidates = process.platform === "win32"
    ? [
      ...moduleSearchRoots.flatMap((root) => [
        path.join(root, "node_modules", ".bin", "codex.cmd"),
        path.join(root, "node_modules", ".bin", "codex.exe"),
        path.join(root, "node_modules", ".bin", "codex"),
        path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
        path.join(root, ...nestedBinSegments, "codex.cmd"),
        path.join(root, ...nestedBinSegments, "codex.exe"),
        path.join(root, ...nestedBinSegments, "codex"),
        path.join(root, ...nestedCodexScriptSegments)
      ]),
      normalizeOptionalText(process.env.APPDATA)
        ? path.join(process.env.APPDATA as string, "npm", "codex.cmd")
        : null,
      normalizeOptionalText(process.env.APPDATA)
        ? path.join(process.env.APPDATA as string, "npm", "codex.exe")
        : null
    ]
    : [
      ...moduleSearchRoots.flatMap((root) => [
        path.join(root, "node_modules", ".bin", "codex"),
        path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
        path.join(root, ...nestedBinSegments, "codex"),
        path.join(root, ...nestedCodexScriptSegments)
      ]),
      path.resolve(process.cwd(), "packages", "session-sync-core", "node_modules", ".bin", "codex"),
      path.join(homeDir, ".local", "bin", "codex"),
      process.platform === "darwin" ? "/Applications/Codex.app/Contents/Resources/codex" : null
    ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "codex";
}

function resolveGeminiCliPath(configuredPath: string | undefined, homeDir: string): string {
  const normalizedConfiguredPath = configuredPath?.trim();

  if (normalizedConfiguredPath) {
    return normalizedConfiguredPath;
  }

  const windowsGlobalNpmRoot = normalizeOptionalText(process.env.APPDATA)
    ? path.join(process.env.APPDATA as string, "npm")
    : null;
  const candidates = process.platform === "win32"
    ? [
      path.resolve(process.cwd(), "node_modules", ".bin", "gemini.cmd"),
      path.resolve(process.cwd(), "node_modules", ".bin", "gemini.exe"),
      path.resolve(process.cwd(), "node_modules", ".bin", "gemini"),
      path.join(homeDir, ".local", "bin", "gemini.exe"),
      path.join(homeDir, ".local", "bin", "gemini.cmd"),
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "gemini.cmd") : null,
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "gemini.exe") : null
    ]
    : [
      path.resolve(process.cwd(), "node_modules", ".bin", "gemini"),
      path.join(homeDir, ".local", "bin", "gemini")
    ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "gemini";
}

function resolveKimiCliPath(configuredPath: string | undefined, homeDir: string): string {
  const normalizedConfiguredPath = configuredPath?.trim();

  if (normalizedConfiguredPath) {
    return normalizedConfiguredPath;
  }

  const windowsGlobalNpmRoot = normalizeOptionalText(process.env.APPDATA)
    ? path.join(process.env.APPDATA as string, "npm")
    : null;
  const candidates = process.platform === "win32"
    ? [
      path.resolve(process.cwd(), "node_modules", ".bin", "kimi.cmd"),
      path.resolve(process.cwd(), "node_modules", ".bin", "kimi.exe"),
      path.resolve(process.cwd(), "node_modules", ".bin", "kimi"),
      path.join(homeDir, ".local", "bin", "kimi.exe"),
      path.join(homeDir, ".local", "bin", "kimi.cmd"),
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "kimi.cmd") : null,
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "kimi.exe") : null
    ]
    : [
      path.resolve(process.cwd(), "node_modules", ".bin", "kimi"),
      path.join(homeDir, ".local", "bin", "kimi")
    ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "kimi";
}

function resolveOpenCodeCliPath(configuredPath: string | undefined, homeDir: string): string {
  const normalizedConfiguredPath = configuredPath?.trim();

  if (normalizedConfiguredPath) {
    return normalizedConfiguredPath;
  }

  const windowsGlobalNpmRoot = normalizeOptionalText(process.env.APPDATA)
    ? path.join(process.env.APPDATA as string, "npm")
    : null;
  const windowsOpenCodeInstallRoot = normalizeOptionalText(process.env.LOCALAPPDATA)
    ? path.join(process.env.LOCALAPPDATA as string, "OpenCode")
    : null;
  const candidates = process.platform === "win32"
    ? [
      windowsOpenCodeInstallRoot ? path.join(windowsOpenCodeInstallRoot, "opencode-cli.exe") : null,
      path.resolve(process.cwd(), "node_modules", ".bin", "opencode.cmd"),
      path.resolve(process.cwd(), "node_modules", ".bin", "opencode.exe"),
      path.resolve(process.cwd(), "node_modules", ".bin", "opencode"),
      path.join(homeDir, ".opencode", "bin", "opencode.exe"),
      path.join(homeDir, ".opencode", "bin", "opencode.cmd"),
      path.join(homeDir, ".opencode", "bin", "opencode"),
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "opencode.cmd") : null,
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "opencode.exe") : null
    ]
    : [
      path.resolve(process.cwd(), "node_modules", ".bin", "opencode"),
      path.join(homeDir, ".opencode", "bin", "opencode"),
      path.join(homeDir, ".local", "bin", "opencode")
    ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "opencode";
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

function resolveKimiDefaultModelFromConfig(configPath: string): string | null {
  const parsed = readKimiSimpleConfig(configPath);

  if (!parsed) {
    return null;
  }

  const candidateKeys = [
    "model",
    "default_model",
    "defaultModel",
    "provider.model",
    "provider.default_model",
    "provider.defaultModel"
  ];

  for (const key of candidateKeys) {
    const value = parsed[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function readKimiSimpleConfig(configPath: string): Record<string, string | number | boolean> | null {
  try {
    if (!existsSync(configPath)) {
      return null;
    }

    const content = readFileSync(configPath, "utf8");
    const parsed: Record<string, string | number | boolean> = {};

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#") || line.startsWith("[")) {
        continue;
      }

      const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);

      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      const normalizedValue = rawValue.replace(/\s+#.*$/, "").trim();
      const parsedValue = parseSimpleConfigValue(normalizedValue);

      if (parsedValue !== null) {
        parsed[key] = parsedValue;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function parseSimpleConfigValue(value: string): string | number | boolean | null {
  if (!value) {
    return null;
  }

  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  const numericValue = Number(value);

  if (!Number.isNaN(numericValue)) {
    return numericValue;
  }

  return value;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function resolveExistingDir(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }

  return existsSync(candidate) ? candidate : null;
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function resolveModuleSpecifier(specifier: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve(specifier);
  } catch {
    return null;
  }
}
