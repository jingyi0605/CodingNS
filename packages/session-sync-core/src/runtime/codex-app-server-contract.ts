import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Codex App 使用的 app-server 客户端标识。 */
export const CODEX_APP_SERVER_CLIENT_NAME = "Codex Desktop";

/** Codex App 进程实际传给 Responses API 的来源标识。 */
const CODEX_APP_SERVER_ORIGINATOR = "Codex";

/** 工作区会话需要让 Responses API 按项目工作区处理。 */
export const CODEX_APP_SERVER_WORKSPACE_KIND = "project";

const DEFAULT_CODEX_APP_VERSION = "26.721.41059";
const DEFAULT_BROWSER_BACKENDS = "chrome,iab";
const DEFAULT_CODEX_APP_BUILD_FLAVOR = "prod";
const DEFAULT_NODE_REPL_CONNECT_TIMEOUT_MS = "1000";
const DEFAULT_NODE_REPL_STARTUP_TIMEOUT_SEC = "120";

const DEFAULT_BROWSER_INSTRUCTIONS = {
  NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER:
    "Control the in-app browser in conjunction with the Browser Plugin.",
  NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME:
    "Control the Chrome browser in conjunction with the Chrome Plugin. Prefer this method of controlling Chrome over alternatives (such as Computer Use) unless the user explicitly mentions an alternative.",
  NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE:
    "Control desktop apps on macOS through Computer Use."
} as const;

export function buildCodexAppServerArgs(configOverrides: readonly string[] = []): string[] {
  const args = [
    "-c",
    "features.code_mode_host=true"
  ];

  for (const override of configOverrides) {
    const normalized = override.trim();

    if (!normalized) {
      continue;
    }

    args.push("-c", normalized);
  }

  args.push("app-server", "--analytics-default-enabled");
  return args;
}

export function buildCodexAppServerRuntimeEnv(input: {
  baseEnv?: NodeJS.ProcessEnv | null;
  commandPath?: string | null;
  homeDir?: string | null;
} = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(input.baseEnv ?? {})
  };
  const homeDir = input.homeDir?.trim() ?? "";
  const commandPath = input.commandPath?.trim() ?? "";
  const inheritedHomeDir = env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
  const nativeHost =
    readNativeHostEntry(homeDir || inheritedHomeDir)
    || (homeDir ? readNativeHostEntry(inheritedHomeDir) : null);

  if (homeDir) {
    // 会话级 home 必须覆盖 Host 进程继承的全局 CODEX_HOME，否则 transcript、MCP
    // 配置和浏览器运行时会落到另一个 Codex 实例。
    env.CODEX_HOME = homeDir;
    env.CODINGNS_CODEX_HOME = homeDir;
    env.NODE_REPL_TRUSTED_CODE_PATHS = mergePathList(
      env.NODE_REPL_TRUSTED_CODE_PATHS,
      homeDir
    );
  }

  // clientInfo.name 和 Responses API 的 originator 是两套字段。Codex App 自身使用
  // "Codex Desktop" 作为前者、"Codex" 作为后者，不能把两者混用。
  setDefaultEnv(env, "CODEX_INTERNAL_ORIGINATOR_OVERRIDE", CODEX_APP_SERVER_ORIGINATOR);
  setDefaultEnv(env, "BROWSER_USE_AVAILABLE_BACKENDS", DEFAULT_BROWSER_BACKENDS);
  setDefaultEnv(env, "BROWSER_USE_CODEX_APP_BUILD_FLAVOR", DEFAULT_CODEX_APP_BUILD_FLAVOR);
  setDefaultEnv(
    env,
    "BROWSER_USE_CODEX_APP_VERSION",
    env.CODEX_APP_VERSION?.trim()
      || nativeHost?.appVersion
      || DEFAULT_CODEX_APP_VERSION
  );
  setDefaultEnv(env, "NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS", DEFAULT_NODE_REPL_CONNECT_TIMEOUT_MS);

  for (const [key, value] of Object.entries(DEFAULT_BROWSER_INSTRUCTIONS)) {
    setDefaultEnv(env, key, value);
  }

  if (commandPath) {
    env.CODEX_CLI_PATH = commandPath;
  }

  const resourcesDir = resolveChatGptResourcesDir(env, commandPath);
  if (resourcesDir) {
    setDefaultEnv(env, "NODE_REPL_NODE_PATH", path.join(resourcesDir, "cua_node", "bin", "node"));
    setDefaultEnv(
      env,
      "NODE_REPL_NODE_MODULE_DIRS",
      path.join(resourcesDir, "cua_node", "lib", "node_modules")
    );
  }

  if (nativeHost?.paths.nodeReplPath) {
    setDefaultEnv(env, "NODE_REPL_COMMAND", nativeHost.paths.nodeReplPath);
  }

  if (nativeHost?.paths.nodePath) {
    setDefaultEnv(env, "NODE_REPL_NODE_PATH", nativeHost.paths.nodePath);
  }

  if (nativeHost?.paths.nodeModuleDirs?.length) {
    setDefaultEnv(env, "NODE_REPL_NODE_MODULE_DIRS", nativeHost.paths.nodeModuleDirs.join(path.delimiter));
  }

  if (nativeHost?.paths.browserClientPath) {
    const browserClientHash = sha256File(nativeHost.paths.browserClientPath);

    if (browserClientHash) {
      env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = mergeDelimitedValues(
        env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S,
        browserClientHash
      );
    }
  }

  return env;
}

/** 生成 Codex App 用于启动 node_repl MCP 的配置覆盖项。 */
export function buildCodexAppServerNodeReplConfigOverrides(
  env: NodeJS.ProcessEnv,
  nodeReplCommand?: string | null
): string[] {
  const command = nodeReplCommand?.trim() || resolveNodeReplCommand(env);

  // 没有 Codex App 的机器仍可能使用普通 Codex CLI。此时不能用一个无法解析的
  // `node_repl` 覆盖用户已有 MCP 配置，否则会把本来可用的 CLI 会话启动失败。
  if (!command) {
    return [];
  }

  const overrides = [
    `mcp_servers.node_repl.command=${JSON.stringify(command)}`,
    "mcp_servers.node_repl.args=[]",
    `mcp_servers.node_repl.startup_timeout_sec=${DEFAULT_NODE_REPL_STARTUP_TIMEOUT_SEC}`
  ];
  const envKeys = [
    "CODEX_HOME",
    "NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS",
    "NODE_REPL_NODE_MODULE_DIRS",
    "NODE_REPL_NODE_PATH",
    "NODE_REPL_TRUSTED_CODE_PATHS",
    "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
    "BROWSER_USE_AVAILABLE_BACKENDS",
    "NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER",
    "NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME",
    "NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE",
    "BROWSER_USE_CODEX_APP_BUILD_FLAVOR",
    "BROWSER_USE_CODEX_APP_VERSION",
    "CODEX_CLI_PATH"
  ];

  for (const key of envKeys) {
    const value = env[key]?.trim();

    if (value) {
      overrides.push(
        `mcp_servers.node_repl.env.${key}=${JSON.stringify(value)}`
      );
    }
  }

  return overrides;
}

export function buildCodexAppServerInitializeParams(env?: NodeJS.ProcessEnv | null): Record<string, unknown> {
  return {
    clientInfo: {
      name: CODEX_APP_SERVER_CLIENT_NAME,
      version: resolveCodexAppVersion(env ?? process.env)
    },
    capabilities: {
      experimentalApi: true
    }
  };
}

export function buildCodexTurnRequestMetadata(): Record<string, unknown> {
  return {
    responsesapiClientMetadata: {
      workspace_kind: CODEX_APP_SERVER_WORKSPACE_KIND
    }
  };
}

function resolveCodexAppVersion(env: NodeJS.ProcessEnv): string {
  return env.BROWSER_USE_CODEX_APP_VERSION?.trim()
    || env.CODEX_APP_VERSION?.trim()
    || DEFAULT_CODEX_APP_VERSION;
}

function resolveChatGptResourcesDir(env: NodeJS.ProcessEnv, commandPath: string): string | null {
  const configured =
    env.CODINGNS_CHATGPT_RESOURCES_DIR?.trim()
    || env.CODEX_RESOURCES_DIR?.trim()
    || env.CHATGPT_RESOURCES_DIR?.trim();

  if (configured) {
    return configured;
  }

  const nativeHost = readNativeHostEntry(env.CODEX_HOME || path.join(homedir(), ".codex"));

  if (nativeHost?.paths.resourcesPath) {
    return nativeHost.paths.resourcesPath;
  }

  const commandResourcesDir = findResourcesDir(commandPath || env.CODEX_CLI_PATH || "");

  if (commandResourcesDir) {
    return commandResourcesDir;
  }

  if (process.platform === "darwin") {
    for (const candidate of [
      "/Applications/ChatGPT.app/Contents/Resources",
      "/Applications/Codex.app/Contents/Resources"
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveNodeReplCommand(env: NodeJS.ProcessEnv): string | null {
  const configuredCommand = env.NODE_REPL_COMMAND?.trim();

  if (configuredCommand) {
    return configuredCommand;
  }

  const resourcesDir = resolveChatGptResourcesDir(env, env.CODEX_CLI_PATH ?? "");

  if (!resourcesDir) {
    return null;
  }

  const binDir = path.join(resourcesDir, "cua_node", "bin");
  const candidates = process.platform === "win32"
    ? ["node_repl.exe", "node_repl.cmd", "node_repl"]
    : ["node_repl"];

  return candidates
    .map((candidate) => path.join(binDir, candidate))
    .find((candidate) => existsSync(candidate))
    ?? null;
}

function findResourcesDir(commandPath: string): string | null {
  const normalized = commandPath.trim();

  if (!normalized) {
    return null;
  }

  const resourcesMarker = `${path.sep}Contents${path.sep}Resources`;
  const markerIndex = normalized.indexOf(resourcesMarker);

  if (markerIndex >= 0) {
    return normalized.slice(0, markerIndex + resourcesMarker.length);
  }

  const parent = path.dirname(normalized);

  if (path.basename(parent).toLowerCase() === "resources") {
    return parent;
  }

  return null;
}

function mergePathList(existing: string | undefined, value: string): string {
  const entries = (existing ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.includes(value)) {
    entries.push(value);
  }

  return entries.join(path.delimiter);
}

function mergeDelimitedValues(existing: string | undefined, value: string): string {
  const entries = (existing ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.includes(value)) {
    entries.push(value);
  }

  return entries.join(",");
}

interface NativeHostEntry {
  appVersion?: string;
  paths: {
    browserClientPath?: string;
    nodePath?: string;
    nodeReplPath?: string;
    nodeModuleDirs?: string[];
    resourcesPath?: string;
  };
}

function readNativeHostEntry(codexHome: string): NativeHostEntry | null {
  const filePath = path.join(codexHome, "chrome-native-hosts-v2.json");

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      entries?: unknown;
    };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const candidates = entries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .sort((left, right) => String((right.presence as Record<string, unknown> | undefined)?.lastSeenAt ?? "")
        .localeCompare(String((left.presence as Record<string, unknown> | undefined)?.lastSeenAt ?? "")));

    for (const entry of candidates) {
      const paths = entry.paths;

      if (!paths || typeof paths !== "object") {
        continue;
      }

      const pathRecord = paths as Record<string, unknown>;
      const nativeHost: NativeHostEntry = {
        appVersion: typeof entry.appVersion === "string" ? entry.appVersion : undefined,
        paths: {
          browserClientPath: typeof pathRecord.browserClientPath === "string" ? pathRecord.browserClientPath : undefined,
          nodePath: typeof pathRecord.nodePath === "string" ? pathRecord.nodePath : undefined,
          nodeReplPath: typeof pathRecord.nodeReplPath === "string" ? pathRecord.nodeReplPath : undefined,
          nodeModuleDirs: Array.isArray(pathRecord.nodeModuleDirs)
            ? pathRecord.nodeModuleDirs.filter((value): value is string => typeof value === "string")
            : undefined,
          resourcesPath: typeof pathRecord.resourcesPath === "string" ? pathRecord.resourcesPath : undefined
        }
      };

      // 注册表会保留已卸载 Codex App 的历史项。按最近时间选中一个不存在的路径，
      // 等同于把浏览器 MCP 指到死文件，因此必须继续寻找真实可执行的条目。
      if (isUsableNativeHostEntry(nativeHost)) {
        return nativeHost;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isUsableNativeHostEntry(entry: NativeHostEntry): boolean {
  const nodeReplPath = entry.paths.nodeReplPath;
  const nodePath = entry.paths.nodePath;

  return Boolean(
    nodeReplPath
    && nodePath
    && existsSync(nodeReplPath)
    && existsSync(nodePath)
  );
}

function sha256File(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function setDefaultEnv(env: NodeJS.ProcessEnv, key: string, value: string): void {
  if (!env[key]?.trim()) {
    env[key] = value;
  }
}
