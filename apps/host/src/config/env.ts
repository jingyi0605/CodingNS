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
  allowedCorsOrigins: string[];
  webUiDir: string | null;
  webUiPort: number;
  databasePath: string;
  pluginRootDir: string;
  filePreviewTokenSecret: string;
  gitCredentialSecret: string;
  teableCredentialSecret: string;
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
  legnaCodeHomeDir: string;
  codexHomeDir: string;
  tailscaleCliPath: string;
  ccSwitchCliPath: string;
  ccSwitchDbPath: string;
  codexCliPath: string;
  legnaCodeCliPath: string;
  chromeExecutablePath: string;
  edgeExecutablePath: string;
  doctCliPath: string;
  claudeHookBridgeToken: string;
  serverUpdatePackageName: string;
  npmRegistryBaseUrl: string;
  pm2ProcessName: string;
  demoMode: boolean;
}

export function resolveHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const homeDir = os.homedir();
  const appRootDir = resolveAppRootDir();
  const hostPort = overrides.port ?? Number(process.env.CODINGNS_PORT ?? "3002");
  const webUiDir =
    overrides.webUiDir ??
    resolveExistingDir(
      normalizeOptionalText(process.env.CODINGNS_WEB_UI_DIR) ?? path.join(appRootDir, "public")
    );
  const opencodeDataDir =
    overrides.opencodeDataDir ??
    process.env.CODINGNS_OPENCODE_DATA_DIR ??
    path.join(homeDir, ".local", "share", "opencode");
  const ccSwitchDbPath =
    overrides.ccSwitchDbPath ??
    process.env.CODINGNS_CC_SWITCH_DB_PATH ??
    path.join(homeDir, ".cc-switch", "cc-switch.db");
  const databasePath =
    overrides.databasePath ??
    process.env.CODINGNS_DB_PATH ??
    path.join(appRootDir, "data", "host", "host.sqlite");
  const hostDataDir = path.dirname(databasePath);
  const pluginRootDir =
    overrides.pluginRootDir ??
    process.env.CODINGNS_PLUGIN_ROOT_DIR ??
    path.join(hostDataDir, "plugins");
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
  const legnaCodeCliPath =
    overrides.legnaCodeCliPath ??
    process.env.CODINGNS_LEGNA_COMMAND ??
    "legna";
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
  const ccSwitchCliPath = resolveCcSwitchCliPath(
    overrides.ccSwitchCliPath ?? process.env.CODINGNS_CC_SWITCH_COMMAND,
    homeDir
  );
  const configuredOpenCodeBaseUrl = normalizeOptionalText(
    overrides.opencodeBaseUrl ?? process.env.CODINGNS_OPENCODE_BASE_URL ?? null
  );

  return {
    host: overrides.host ?? process.env.CODINGNS_HOST ?? "0.0.0.0",
    port: hostPort,
    allowedCorsOrigins: resolveAllowedCorsOrigins(
      overrides.allowedCorsOrigins,
      process.env.CODINGNS_ALLOWED_CORS_ORIGINS
    ),
    webUiDir,
    webUiPort: resolveWebUiPort({
      configuredPort: overrides.webUiPort ?? readOptionalNumber(process.env.CODINGNS_WEB_UI_PORT),
      hostPort,
      hasEmbeddedWebUi: Boolean(webUiDir)
    }),
    databasePath,
    pluginRootDir,
    filePreviewTokenSecret:
      overrides.filePreviewTokenSecret ??
      process.env.CODINGNS_FILE_PREVIEW_TOKEN_SECRET ??
      resolvePersistentSecret(path.join(hostDataDir, "file-preview-token")),
    gitCredentialSecret:
      overrides.gitCredentialSecret ??
      process.env.CODINGNS_GIT_CREDENTIAL_SECRET ??
      resolvePersistentSecret(path.join(hostDataDir, "git-credential-key")),
    teableCredentialSecret:
      overrides.teableCredentialSecret ??
      process.env.CODINGNS_TEABLE_CREDENTIAL_SECRET ??
      resolvePersistentSecret(path.join(hostDataDir, "teable-credential-key")),
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
    legnaCodeHomeDir:
      overrides.legnaCodeHomeDir ??
      process.env.CODINGNS_LEGNA_CODE_HOME ??
      path.join(homeDir, ".legna"),
    codexHomeDir:
      overrides.codexHomeDir ??
      resolveHostCodexHomeDirFromEnv(homeDir) ??
      path.join(homeDir, ".codex"),
    tailscaleCliPath:
      overrides.tailscaleCliPath ??
      process.env.CODINGNS_TAILSCALE_COMMAND ??
      "tailscale",
    ccSwitchCliPath,
    ccSwitchDbPath,
    codexCliPath,
    legnaCodeCliPath,
    chromeExecutablePath:
      overrides.chromeExecutablePath ??
      process.env.CODINGNS_CHROME_EXECUTABLE_PATH ??
      resolveChromeExecutablePath(homeDir),
    edgeExecutablePath:
      overrides.edgeExecutablePath ??
      process.env.CODINGNS_EDGE_EXECUTABLE_PATH ??
      resolveEdgeExecutablePath(homeDir),
    doctCliPath:
      overrides.doctCliPath ??
      process.env.CODINGNS_DOCT_COMMAND ??
      "doct",
    claudeHookBridgeToken:
      overrides.claudeHookBridgeToken ??
      process.env.CODINGNS_CLAUDE_HOOK_TOKEN ??
      resolvePersistentSecret(path.join(hostDataDir, "claude-hook-token")),
    serverUpdatePackageName:
      overrides.serverUpdatePackageName ??
      process.env.CODINGNS_SERVER_UPDATE_PACKAGE_NAME ??
      "@jingyi0605/codingns",
    npmRegistryBaseUrl:
      overrides.npmRegistryBaseUrl ??
      process.env.CODINGNS_NPM_REGISTRY_BASE_URL ??
      "https://registry.npmjs.org",
    pm2ProcessName:
      overrides.pm2ProcessName ??
      process.env.CODINGNS_PM2_PROCESS_NAME ??
      "codingns",
    demoMode:
      overrides.demoMode ?? process.env.DEMO_MODE === "true"
  };
}

function resolveHostCodexHomeDirFromEnv(homeDir: string): string | null {
  const configured = normalizeOptionalText(process.env.CODINGNS_CODEX_HOME);

  if (!configured) {
    return null;
  }

  // Host 的全局会话发现必须始终对齐原生 Codex Home。
  // 如果当前进程只是跑在某条 Codex 会话里，环境变量里的 session-provider-runtime
  // 只是这条会话的私有运行时目录，不能拿来当全局会话源。
  if (isManagedCodexRuntimeHome(configured, homeDir)) {
    return null;
  }

  return configured;
}

function isManagedCodexRuntimeHome(candidatePath: string, homeDir: string): boolean {
  const normalizedCandidate = path.resolve(candidatePath).replaceAll("\\", "/").toLowerCase();
  const codingnsHomeRoot = path.resolve(homeDir, ".codingns").replaceAll("\\", "/").toLowerCase();

  return (
    normalizedCandidate.includes("/session-provider-runtime/codex/")
    || normalizedCandidate.includes("/runtime/codex/")
    || normalizedCandidate.startsWith(`${codingnsHomeRoot}/session-provider-runtime/codex/`)
  );
}

function resolveAllowedCorsOrigins(
  overrideOrigins: string[] | undefined,
  configuredOrigins: string | undefined
): string[] {
  const override = normalizeOriginList(overrideOrigins);

  if (override.length > 0) {
    return override;
  }

  const configured = normalizeOriginList(configuredOrigins?.split(","));

  if (configured.length > 0) {
    return uniqueStrings([
      "https://app.codingns.com",
      ...configured
    ]);
  }

  return ["https://app.codingns.com"];
}

function resolveWebUiPort(input: {
  configuredPort: number | null;
  hostPort: number;
  hasEmbeddedWebUi: boolean;
}): number {
  if (input.hasEmbeddedWebUi) {
    // npm 包安装模式由 Host 自己托管前端，外部访问入口必须跟 `codingns start --port` 保持一致。
    return input.hostPort;
  }

  if (input.configuredPort && Number.isFinite(input.configuredPort) && input.configuredPort > 0) {
    return input.configuredPort;
  }

  // 开发态 Host 不直接托管页面时，默认回到 user-app 的 Vite 入口端口。
  return 4174;
}

function normalizeOriginList(values: readonly string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }

  const normalized = values
    .map((value) => normalizeOptionalText(value) ?? null)
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));

  return uniqueStrings(normalized);
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

  const configDir = path.dirname(fileURLToPath(import.meta.url));
  const moduleSearchRoots = uniquePaths([
    path.resolve(configDir, "..", "..", ".."),
    path.resolve(configDir, "..", ".."),
    resolveAppRootDir(),
    process.cwd()
  ]);
  const resolvedCodexScript = resolveModuleSpecifier("@openai/codex/bin/codex.js");
  const resolvedCodexSdkEntry = resolveModuleSpecifier("@openai/codex-sdk");
  const inferredPackageRoots = uniquePaths(
    [
      resolvedCodexScript ? path.dirname(path.dirname(resolvedCodexScript)) : null,
      resolvedCodexSdkEntry ? path.dirname(path.dirname(resolvedCodexSdkEntry)) : null
    ].filter((value): value is string => Boolean(value))
  );
  const packageCandidates = process.platform === "win32"
    ? [
      ...moduleSearchRoots.flatMap((root) => [
        path.join(root, "node_modules", ".bin", "codex.cmd"),
        path.join(root, "node_modules", ".bin", "codex.exe"),
        path.join(root, "node_modules", ".bin", "codex"),
        path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
        path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex.cmd"),
        path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex.exe"),
        path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex"),
        path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", "@openai", "codex", "bin", "codex.js")
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
        path.join(root, "node_modules", ".pnpm", "node_modules", ".bin", "codex"),
        path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
        path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex"),
        path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", "@openai", "codex", "bin", "codex.js"),
        path.join(root, "packages", "codingns", "node_modules", ".bin", "codex"),
        path.join(root, "packages", "session-sync-core", "node_modules", ".bin", "codex")
      ]),
      path.resolve(process.cwd(), "packages", "session-sync-core", "node_modules", ".bin", "codex"),
      path.resolve(process.cwd(), "packages", "codingns", "node_modules", ".bin", "codex"),
      path.join(homeDir, ".local", "bin", "codex"),
      process.platform === "darwin" ? "/Applications/Codex.app/Contents/Resources/codex" : null
    ];
  const resolvedCandidates = [
    resolvedCodexScript,
    ...inferredPackageRoots.flatMap((root) => [
      path.join(root, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex"),
      path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js")
    ])
  ];
  const globalCodexPath = resolveExecutableOnPath("codex");
  // 先使用当前 Host 依赖树里能解析到的 Codex，再退回 cwd 和 PATH。
  // npm 包安装模式下，cwd 里的旧项目依赖可能带着不支持 app-server 的旧 codex。
  const candidates = [...resolvedCandidates, ...packageCandidates, globalCodexPath];

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

function resolveCcSwitchCliPath(configuredPath: string | undefined, homeDir: string): string {
  const normalizedConfiguredPath = configuredPath?.trim();

  if (normalizedConfiguredPath) {
    return normalizedConfiguredPath;
  }

  const windowsGlobalNpmRoot = normalizeOptionalText(process.env.APPDATA)
    ? path.join(process.env.APPDATA as string, "npm")
    : null;
  const candidates = process.platform === "win32"
    ? [
      path.resolve(process.cwd(), "node_modules", ".bin", "cc-switch.cmd"),
      path.resolve(process.cwd(), "node_modules", ".bin", "cc-switch.exe"),
      path.resolve(process.cwd(), "node_modules", ".bin", "cc-switch"),
      path.join(homeDir, ".local", "bin", "cc-switch.exe"),
      path.join(homeDir, ".local", "bin", "cc-switch.cmd"),
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "cc-switch.cmd") : null,
      windowsGlobalNpmRoot ? path.join(windowsGlobalNpmRoot, "cc-switch.exe") : null
    ]
    : [
      path.resolve(process.cwd(), "node_modules", ".bin", "cc-switch"),
      path.join(homeDir, ".local", "bin", "cc-switch")
    ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "cc-switch";
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

function resolveChromeExecutablePath(homeDir: string): string {
  const candidates = process.platform === "win32"
    ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      normalizeOptionalText(process.env.LOCALAPPDATA)
        ? path.join(process.env.LOCALAPPDATA as string, "Google", "Chrome", "Application", "chrome.exe")
        : null
    ]
    : process.platform === "darwin"
      ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        path.join(homeDir, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
      ]
      : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/snap/bin/chromium",
        path.join(homeDir, ".local", "bin", "google-chrome")
      ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "google-chrome";
}

function resolveEdgeExecutablePath(homeDir: string): string {
  const candidates = process.platform === "win32"
    ? [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      normalizeOptionalText(process.env.LOCALAPPDATA)
        ? path.join(process.env.LOCALAPPDATA as string, "Microsoft", "Edge", "Application", "msedge.exe")
        : null
    ]
    : process.platform === "darwin"
      ? [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        path.join(homeDir, "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge")
      ]
      : [
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        path.join(homeDir, ".local", "bin", "microsoft-edge")
      ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "microsoft-edge";
}

function readOptionalNumber(value: string | undefined): number | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveModuleSpecifier(specifier: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

function resolveExecutableOnPath(executableName: string): string | null {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    const candidatePath = path.join(entry, executableName);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}
