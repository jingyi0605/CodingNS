import fs from "node:fs";
import path from "node:path";
import {
  AppError,
  APP_ERROR_CODES,
  type LogLevel,
  type RuntimeConfig,
} from "../../../contracts/src/index.js";

const CONFIG_FILE_NAMES = [
  "doc-semantic-index.config.json",
  ".doc-semantic-indexrc.json",
  ".doc-semantic-index/config.json",
  ".ai-index/doc-semantic-index.config.json",
] as const;

interface RuntimeConfigFilePayload {
  rootDir?: string;
  indexDir?: string;
  dbPath?: string;
  exportDir?: string;
  watchDebounceMs?: number;
  parserTimeoutMs?: number;
  disabledParserExtensions?: string[];
  allowedExtensions?: string[];
  includedHiddenPaths?: string[];
  writeBatchSize?: number;
  maxIndexConcurrency?: number;
  logLevel?: LogLevel;
}

export interface LoadRuntimeConfigOptions {
  args?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}

function readString(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function readLogLevel(value: unknown): LogLevel | undefined {
  return value === "silent" || value === "error" || value === "warn" || value === "info" || value === "debug"
    ? value
    : undefined;
}

function normalizeExtensionToken(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function readStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return Array.from(new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ));
  }

  if (typeof value === "string" && value.trim()) {
    return Array.from(new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ));
  }

  return undefined;
}

function readExtensionList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return Array.from(new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(normalizeExtensionToken)
        .filter((item): item is string => Boolean(item)),
    ));
  }

  if (typeof value === "string" && value.trim()) {
    return Array.from(new Set(
      value
        .split(",")
        .map(normalizeExtensionToken)
        .filter((item): item is string => Boolean(item)),
    ));
  }

  return undefined;
}

function resolveMaybeRelative(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function detectConfigFile(cwd: string, args: Record<string, unknown>, env: Record<string, string | undefined>): string | null {
  const configured = readString(args, "config", "configFile")
    ?? env.DOC_SEMANTIC_INDEX_CONFIG
    ?? env.DOC_SEMANTIC_INDEX_CONFIG_FILE;

  if (configured) {
    const configPath = resolveMaybeRelative(cwd, configured);
    if (!fs.existsSync(configPath)) {
      throw new AppError(
        `指定的配置文件不存在：${configPath}`,
        APP_ERROR_CODES.CONFIG_FILE_NOT_FOUND,
        { details: { configPath } },
      );
    }
    return configPath;
  }

  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadConfigFile(configFilePath: string | null): RuntimeConfigFilePayload {
  if (!configFilePath) {
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configFilePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("配置文件根节点必须是对象");
    }
    return raw as RuntimeConfigFilePayload;
  } catch (error) {
    throw new AppError(
      `配置文件解析失败：${configFilePath}`,
      APP_ERROR_CODES.CONFIG_FILE_INVALID,
      {
        details: {
          configFilePath,
          reason: error instanceof Error ? error.message : "unknown",
        },
        cause: error,
      },
    );
  }
}

/**
 * 加载运行时配置。
 * 优先级：CLI args > 环境变量 > 配置文件 > 默认值。
 */
export function loadRuntimeConfig(cwd: string, options: LoadRuntimeConfigOptions = {}): RuntimeConfig {
  const args = options.args ?? {};
  const env = options.env ?? {};
  const configFilePath = detectConfigFile(cwd, args, env);
  const configFile = loadConfigFile(configFilePath);
  const configDir = configFilePath ? path.dirname(configFilePath) : cwd;

  const rootDir = resolveMaybeRelative(
    cwd,
    readString(args, "rootDir", "root-dir")
      ?? env.DOC_SEMANTIC_INDEX_ROOT_DIR
      ?? (typeof configFile.rootDir === "string" ? resolveMaybeRelative(configDir, configFile.rootDir) : cwd),
  );

  const indexDir = resolveMaybeRelative(
    rootDir,
    readString(args, "indexDir", "index-dir")
      ?? env.DOC_SEMANTIC_INDEX_INDEX_DIR
      ?? configFile.indexDir
      ?? ".ai-index",
  );

  const dbPath = resolveMaybeRelative(
    rootDir,
    readString(args, "dbPath", "db-path")
      ?? env.DOC_SEMANTIC_INDEX_DB_PATH
      ?? configFile.dbPath
      ?? path.join(path.relative(rootDir, indexDir) || ".ai-index", "catalog.db"),
  );

  const exportDir = resolveMaybeRelative(
    rootDir,
    readString(args, "exportDir", "export-dir")
      ?? env.DOC_SEMANTIC_INDEX_EXPORT_DIR
      ?? configFile.exportDir
      ?? path.join(path.relative(rootDir, indexDir) || ".ai-index", "exports"),
  );

  const logLevel = readLogLevel(
    readString(args, "logLevel", "log-level")
      ?? env.DOC_SEMANTIC_INDEX_LOG_LEVEL
      ?? configFile.logLevel
      ?? "info",
  );

  const watchDebounceMs = readPositiveNumber(
    args.watchDebounceMs
      ?? args["watch-debounce-ms"]
      ?? env.DOC_SEMANTIC_INDEX_WATCH_DEBOUNCE_MS
      ?? configFile.watchDebounceMs
      ?? 1200,
  );

  const parserTimeoutMs = readPositiveNumber(
    args.parserTimeoutMs
      ?? args["parser-timeout-ms"]
      ?? env.DOC_SEMANTIC_INDEX_PARSER_TIMEOUT_MS
      ?? configFile.parserTimeoutMs
      ?? 30000,
  );

  const disabledParserExtensions = readExtensionList(
    args.disabledParserExtensions
      ?? args["disabled-parser-extensions"]
      ?? args.disableParsers
      ?? args["disable-parsers"]
      ?? env.DOC_SEMANTIC_INDEX_DISABLED_PARSER_EXTENSIONS
      ?? env.DOC_SEMANTIC_INDEX_DISABLE_PARSERS
      ?? configFile.disabledParserExtensions
      ?? [],
  ) ?? [];

  const allowedExtensions = readExtensionList(
    args.allowedExtensions
      ?? args["allowed-extensions"]
      ?? env.DOC_SEMANTIC_INDEX_ALLOWED_EXTENSIONS
      ?? configFile.allowedExtensions
      ?? [],
  ) ?? [];

  const includedHiddenPaths = readStringList(
    args.includedHiddenPaths
      ?? args["included-hidden-paths"]
      ?? env.DOC_SEMANTIC_INDEX_INCLUDED_HIDDEN_PATHS
      ?? configFile.includedHiddenPaths
      ?? [],
  ) ?? [];

  const writeBatchSize = readPositiveNumber(
    args.writeBatchSize
      ?? args["write-batch-size"]
      ?? env.DOC_SEMANTIC_INDEX_WRITE_BATCH_SIZE
      ?? configFile.writeBatchSize
      ?? 200,
  );

  const maxIndexConcurrency = readPositiveNumber(
    args.maxIndexConcurrency
      ?? args["max-index-concurrency"]
      ?? env.DOC_SEMANTIC_INDEX_MAX_INDEX_CONCURRENCY
      ?? configFile.maxIndexConcurrency
      ?? 1,
  );

  if (
    !logLevel
    || watchDebounceMs === undefined
    || parserTimeoutMs === undefined
    || writeBatchSize === undefined
    || maxIndexConcurrency === undefined
  ) {
    throw new AppError(
      "运行时配置中存在非法值，请检查 logLevel / watchDebounceMs / parserTimeoutMs / writeBatchSize / maxIndexConcurrency。",
      APP_ERROR_CODES.CONFIG_INVALID_VALUE,
      {
        details: {
          logLevel,
          watchDebounceMs,
          parserTimeoutMs,
          writeBatchSize,
          maxIndexConcurrency,
          configFilePath,
        },
      },
    );
  }

  return {
    rootDir,
    indexDir,
    dbPath,
    exportDir,
    configFilePath,
    watchDebounceMs,
    parserTimeoutMs,
    disabledParserExtensions,
    allowedExtensions,
    includedHiddenPaths,
    writeBatchSize,
    maxIndexConcurrency,
    logLevel,
  };
}
