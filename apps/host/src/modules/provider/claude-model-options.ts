import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";

interface ClaudeSettingsShape {
  env?: Record<string, unknown>;
}

interface ClaudeModelInfoShape {
  value?: unknown;
  displayName?: unknown;
  supportedEffortLevels?: unknown;
}

interface ClaudeInitializeResponseShape {
  type?: unknown;
  response?: {
    subtype?: unknown;
    request_id?: unknown;
    response?: {
      models?: unknown;
    };
  };
}

interface ClaudeModelCatalogResponseShape {
  data?: unknown;
  models?: unknown;
}

interface ClaudeModelCatalogItemShape {
  id?: unknown;
  value?: unknown;
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
}

export interface ClaudeModelDiscoverySnapshot {
  modelOptions: ProviderModelOption[];
}

interface ClaudeModelOptionsServiceOptions {
  commandPath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
const CLAUDE_INITIALIZE_REQUEST_ID = "codingns-model-discovery";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_PROCESS_OUTPUT_LENGTH = 1024 * 1024;
const MAX_MODEL_CATALOG_RESPONSE_LENGTH = 1024 * 1024;
const CLAUDE_STANDARD_MODEL_IDS = new Set([
  "sonnet",
  "opus",
  "haiku"
]);
const CLAUDE_MODEL_ALIASES = [
  {
    id: "sonnet",
    label: "Sonnet",
    envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL"
  },
  {
    id: "opus",
    label: "Opus",
    envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL"
  },
  {
    id: "haiku",
    label: "Haiku",
    envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL"
  }
] as const;

/**
 * 合并 Claude Code 初始化别名与自定义 Anthropic 网关的真实模型目录。
 * CLI 初始化只做能力读取，网关探测只发 GET，都不会创建可恢复会话。
 */
export class ClaudeModelOptionsService {
  private readonly timeoutMs: number;

  constructor(private readonly options: ClaudeModelOptionsServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async readSnapshot(input: {
    claudeHomeDir: string;
    workspacePath?: string | null;
    runtimeEnv?: Record<string, string>;
  }): Promise<ClaudeModelDiscoverySnapshot> {
    const runtimeEnv = input.runtimeEnv ?? {};
    const commandPath = resolveClaudeCommandPath(this.options.commandPath);
    const catalogUrl = resolveClaudeModelCatalogUrl(runtimeEnv.ANTHROPIC_BASE_URL);
    const discoveryTasks: Array<Promise<ProviderModelOption[]>> = [];

    if (commandPath) {
      discoveryTasks.push(
        runClaudeInitialize(commandPath, {
          claudeHomeDir: input.claudeHomeDir,
          workspacePath: input.workspacePath ?? null,
          runtimeEnv,
          timeoutMs: this.timeoutMs
        }).then((response) => normalizeClaudeModelOptions(response.models))
      );
    }

    if (catalogUrl) {
      discoveryTasks.push(
        readClaudeModelCatalog(catalogUrl, {
          runtimeEnv,
          timeoutMs: this.timeoutMs,
          fetchImpl: this.options.fetchImpl ?? fetch
        })
      );
    }

    if (discoveryTasks.length === 0) {
      throw new Error("CLAUDE_COMMAND_NOT_FOUND");
    }

    // 自定义网关和 CLI 任一可用就保留结果，避免单个探测源失败拖垮模型选择器。
    const results = await Promise.allSettled(discoveryTasks);
    const modelGroups = results
      .filter((result): result is PromiseFulfilledResult<ProviderModelOption[]> => result.status === "fulfilled")
      .map((result) => result.value);

    if (modelGroups.length === 0) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );

      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error("CLAUDE_MODEL_DISCOVERY_FAILED");
    }

    return {
      modelOptions: mergeClaudeModelOptionGroups(modelGroups)
    };
  }
}

export function enrichClaudeCapabilities(
  capabilities: ProviderCapabilities,
  input: {
    claudeHomeDir: string;
    workspacePath?: string | null;
  }
): ProviderCapabilities {
  if (capabilities.provider !== "claude-code") {
    return capabilities;
  }

  const env = readEffectiveClaudeEnv(input.claudeHomeDir, input.workspacePath ?? null);

  return {
    ...capabilities,
    modelOptions: buildClaudeFallbackModelOptions(env)
  };
}

export async function enrichClaudeCapabilitiesWithDiscovery(
  capabilities: ProviderCapabilities,
  input: {
    claudeHomeDir: string;
    workspacePath?: string | null;
  },
  modelOptionsService: Pick<ClaudeModelOptionsService, "readSnapshot">
): Promise<ProviderCapabilities> {
  if (capabilities.provider !== "claude-code") {
    return capabilities;
  }

  const workspacePath = input.workspacePath ?? null;
  const env = readEffectiveClaudeEnv(input.claudeHomeDir, workspacePath);
  const fallback = enrichClaudeCapabilities(capabilities, input);

  try {
    const snapshot = await modelOptionsService.readSnapshot({
      claudeHomeDir: input.claudeHomeDir,
      workspacePath,
      runtimeEnv: env
    });

    return {
      ...capabilities,
      modelOptions: mergeClaudeConfiguredModels(snapshot.modelOptions, env)
    };
  } catch {
    return {
      ...fallback,
      limitations: Array.from(
        new Set([
          ...fallback.limitations,
          "当前无法读取 Claude Code 完整模型列表，暂时显示默认别名和配置中声明的模型。"
        ])
      )
    };
  }
}

export function mergeClaudeConfiguredModels(
  discoveredModels: ProviderModelOption[],
  env: Record<string, string>
): ProviderModelOption[] {
  const configuredModelIds = [
    normalizeModelId(env.ANTHROPIC_MODEL),
    ...CLAUDE_MODEL_ALIASES.map((alias) => normalizeModelId(env[alias.envKey]))
  ].filter((value): value is string => Boolean(value));
  const merged = [...discoveredModels];
  const knownIds = new Set(merged.map((model) => model.id));

  for (const modelId of configuredModelIds) {
    if (knownIds.has(modelId)) {
      continue;
    }

    knownIds.add(modelId);
    merged.push({
      id: modelId,
      name: modelId
    });
  }

  return merged;
}

function readEffectiveClaudeEnv(
  claudeHomeDir: string,
  workspacePath: string | null
): Record<string, string> {
  const settingsFiles = [
    join(claudeHomeDir, "settings.json"),
    join(claudeHomeDir, "settings.local.json"),
    workspacePath ? join(workspacePath, ".claude", "settings.json") : null,
    workspacePath ? join(workspacePath, ".claude", "settings.local.json") : null
  ].filter((value): value is string => Boolean(value));

  return settingsFiles.reduce<Record<string, string>>((current, filePath) => {
    const nextEnv = readClaudeEnvFile(filePath);

    if (!nextEnv) {
      return current;
    }

    return {
      ...current,
      ...nextEnv
    };
  }, {});
}

function readClaudeEnvFile(filePath: string): Record<string, string> | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ClaudeSettingsShape;
    const env = parsed.env;

    if (!env || typeof env !== "object") {
      return null;
    }

    const entries = Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0
    );

    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

function buildClaudeFallbackModelOptions(env: Record<string, string>): ProviderModelOption[] {
  const defaultModel = normalizeModelId(env.ANTHROPIC_MODEL);
  const aliasTargets = CLAUDE_MODEL_ALIASES.map((alias) => ({
    ...alias,
    target: normalizeModelId(env[alias.envKey])
  }));
  const configuredModels = new Set<string>();

  if (defaultModel && isAdditionalModel(defaultModel)) {
    configuredModels.add(defaultModel);
  }

  aliasTargets.forEach((alias) => {
    if (alias.target && isAdditionalModel(alias.target)) {
      configuredModels.add(alias.target);
    }
  });

  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: defaultModel ? `跟随 CLI 默认模型（当前：${defaultModel}）` : "跟随 CLI 默认模型",
      usesProviderDefault: true
    },
    ...aliasTargets.map((alias) => ({
      id: alias.id,
      name: alias.target ? `${alias.label}（当前：${alias.target}）` : alias.label
    })),
    ...Array.from(configuredModels).map((modelId) => ({
      id: modelId,
      name: modelId
    }))
  ];
}

function normalizeClaudeModelOptions(input: unknown): ProviderModelOption[] {
  if (!Array.isArray(input)) {
    throw new Error("CLAUDE_MODELS_RESPONSE_INVALID");
  }

  const options: ProviderModelOption[] = [];
  const knownIds = new Set<string>();

  for (const rawModel of input) {
    if (!rawModel || typeof rawModel !== "object") {
      continue;
    }

    const model = rawModel as ClaudeModelInfoShape;
    const rawId = normalizeModelId(model.value);
    const displayName = normalizeModelId(model.displayName);

    if (!rawId) {
      continue;
    }

    const id = rawId === "default" ? PROVIDER_DEFAULT_MODEL_ID : rawId;

    if (knownIds.has(id)) {
      continue;
    }

    knownIds.add(id);
    options.push({
      id,
      name: displayName ?? rawId,
      usesProviderDefault: id === PROVIDER_DEFAULT_MODEL_ID || undefined,
      supportedReasoningEfforts: normalizeEffortLevels(model.supportedEffortLevels)
    });
  }

  if (!knownIds.has(PROVIDER_DEFAULT_MODEL_ID)) {
    options.unshift({
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: "跟随 CLI 默认模型",
      usesProviderDefault: true
    });
  }

  if (options.length === 0) {
    throw new Error("CLAUDE_MODELS_RESPONSE_EMPTY");
  }

  return options;
}

async function readClaudeModelCatalog(
  catalogUrl: string,
  input: {
    runtimeEnv: Record<string, string>;
    timeoutMs: number;
    fetchImpl: typeof fetch;
  }
): Promise<ProviderModelOption[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetchImpl(catalogUrl, {
      method: "GET",
      headers: buildClaudeModelCatalogHeaders(input.runtimeEnv),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`CLAUDE_MODEL_CATALOG_HTTP_${response.status}`);
    }

    const body = await readBoundedResponseText(response, MAX_MODEL_CATALOG_RESPONSE_LENGTH);
    const parsed = JSON.parse(body) as ClaudeModelCatalogResponseShape;

    return normalizeClaudeModelCatalogOptions(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function resolveClaudeModelCatalogUrl(baseUrl: unknown): string | null {
  const normalizedBaseUrl = normalizeModelId(baseUrl);

  if (!normalizedBaseUrl) {
    return null;
  }

  try {
    const url = new URL(normalizedBaseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");

    if (/\/v1\/models$/i.test(pathname)) {
      return url.toString();
    }

    url.pathname = /\/v1$/i.test(pathname)
      ? `${pathname}/models`
      : `${pathname}/v1/models`;
    return url.toString();
  } catch {
    return null;
  }
}

function buildClaudeModelCatalogHeaders(runtimeEnv: Record<string, string>): Record<string, string> {
  const authToken = normalizeModelId(runtimeEnv.ANTHROPIC_AUTH_TOKEN);
  const apiKey = normalizeModelId(runtimeEnv.ANTHROPIC_API_KEY);
  const headerApiKey = apiKey ?? authToken;
  const headers: Record<string, string> = {
    accept: "application/json",
    "anthropic-version": "2023-06-01"
  };

  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }

  if (headerApiKey) {
    // 一部分 Anthropic 兼容网关只识别 x-api-key，即使 cc-switch 保存的是 AUTH_TOKEN。
    headers["x-api-key"] = headerApiKey;
  }

  return headers;
}

function normalizeClaudeModelCatalogOptions(
  response: ClaudeModelCatalogResponseShape
): ProviderModelOption[] {
  const rawModels = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.models)
      ? response.models
      : null;

  if (!rawModels) {
    throw new Error("CLAUDE_MODEL_CATALOG_RESPONSE_INVALID");
  }

  const options = rawModels.flatMap<ProviderModelOption>((rawModel) => {
    if (!rawModel || typeof rawModel !== "object") {
      return [];
    }

    const model = rawModel as ClaudeModelCatalogItemShape;
    const id = normalizeModelId(model.id) ?? normalizeModelId(model.value);

    if (!id) {
      return [];
    }

    return [{
      id,
      name:
        normalizeModelId(model.display_name)
        ?? normalizeModelId(model.displayName)
        ?? normalizeModelId(model.name)
        ?? id
    }];
  });

  if (options.length === 0) {
    throw new Error("CLAUDE_MODEL_CATALOG_RESPONSE_EMPTY");
  }

  return options;
}

function mergeClaudeModelOptionGroups(
  groups: ProviderModelOption[][]
): ProviderModelOption[] {
  const merged: ProviderModelOption[] = [];
  const knownIds = new Set<string>();

  for (const group of groups) {
    for (const model of group) {
      if (knownIds.has(model.id)) {
        continue;
      }

      knownIds.add(model.id);
      merged.push(model);
    }
  }

  if (!knownIds.has(PROVIDER_DEFAULT_MODEL_ID)) {
    merged.unshift({
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: "跟随 CLI 默认模型",
      usesProviderDefault: true
    });
  }

  return merged;
}

async function readBoundedResponseText(response: Response, maxLength: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxLength) {
    throw new Error("CLAUDE_MODEL_CATALOG_RESPONSE_TOO_LARGE");
  }

  const value = await response.text();

  if (value.length > maxLength) {
    throw new Error("CLAUDE_MODEL_CATALOG_RESPONSE_TOO_LARGE");
  }

  return value;
}

function normalizeEffortLevels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const levels = value
    .map((level) => normalizeModelId(level))
    .filter((level): level is string => Boolean(level));

  return levels.length > 0 ? Array.from(new Set(levels)) : undefined;
}

function resolveClaudeCommandPath(explicitCommandPath?: string): string | null {
  const configuredCommandPath =
    normalizeModelId(explicitCommandPath)
    ?? normalizeModelId(process.env.CODINGNS_CLAUDE_CODE_COMMAND)
    ?? normalizeModelId(process.env.CLAUDE_CODE_COMMAND)
    ?? (process.platform === "win32" ? "claude.cmd" : "claude");
  const fallbackCandidates = process.platform === "win32"
    ? ["claude.cmd", "claude"]
    : ["claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];

  return resolveAvailableCommandPath(configuredCommandPath, fallbackCandidates);
}

function runClaudeInitialize(
  commandPath: string,
  input: {
    claudeHomeDir: string;
    workspacePath: string | null;
    runtimeEnv: Record<string, string>;
    timeoutMs: number;
  }
): Promise<{ models: unknown }> {
  const launch = resolveCommandLaunch(commandPath, [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    "{\"mcpServers\":{}}"
  ]);
  const resolvedHomeDir = resolve(input.claudeHomeDir);
  const cwd = resolveClaudeProbeCwd(input.workspacePath);
  const xdgConfigHome = join(resolvedHomeDir, "xdg-config");
  const xdgDataHome = join(resolvedHomeDir, "xdg-data");
  const xdgStateHome = join(resolvedHomeDir, "xdg-state");
  const xdgCacheHome = join(resolvedHomeDir, "xdg-cache");

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: resolvedHomeDir,
        HOME: resolvedHomeDir,
        USERPROFILE: resolvedHomeDir,
        XDG_CONFIG_HOME: xdgConfigHome,
        XDG_DATA_HOME: xdgDataHome,
        XDG_STATE_HOME: xdgStateHome,
        XDG_CACHE_HOME: xdgCacheHome,
        APPDATA: join(resolvedHomeDir, "appdata"),
        LOCALAPPDATA: join(resolvedHomeDir, "localappdata"),
        ...input.runtimeEnv
      },
      shell: launch.shell,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = createBoundedOutputCollector(MAX_PROCESS_OUTPUT_LENGTH);
    const stderr = createBoundedOutputCollector(16_384);
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.stdin.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish(() => rejectPromise(new Error("CLAUDE_MODEL_DISCOVERY_TIMEOUT")));
        return;
      }

      if (code !== 0) {
        const detail = stderr.read().trim();
        finish(() => rejectPromise(new Error(
          detail || `CLAUDE_MODEL_DISCOVERY_FAILED:${signal ?? code ?? "unknown"}`
        )));
        return;
      }

      try {
        const response = parseClaudeInitializeResponse(stdout.read());
        finish(() => resolvePromise(response));
      } catch (error) {
        finish(() => rejectPromise(error));
      }
    });

    child.stdin.end(`${JSON.stringify({
      type: "control_request",
      request_id: CLAUDE_INITIALIZE_REQUEST_ID,
      request: {
        subtype: "initialize"
      }
    })}\n`);
  });
}

function parseClaudeInitializeResponse(output: string): { models: unknown } {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const message = JSON.parse(trimmed) as ClaudeInitializeResponseShape;
      const response = message.response;

      if (
        message.type === "control_response"
        && response?.subtype === "success"
        && response.request_id === CLAUDE_INITIALIZE_REQUEST_ID
      ) {
        return {
          models: response.response?.models
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("CLAUDE_INITIALIZE_RESPONSE_MISSING");
}

function resolveClaudeProbeCwd(workspacePath: string | null): string {
  if (workspacePath && existsSync(workspacePath)) {
    try {
      if (statSync(workspacePath).isDirectory()) {
        return workspacePath;
      }
    } catch {
      // 工作区刚被移除时回退到 Host 当前目录。
    }
  }

  return process.cwd();
}

function normalizeModelId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isAdditionalModel(modelId: string): boolean {
  return !CLAUDE_STANDARD_MODEL_IDS.has(modelId) && modelId !== PROVIDER_DEFAULT_MODEL_ID;
}

function createBoundedOutputCollector(maxLength: number): {
  push: (chunk: string) => void;
  read: () => string;
} {
  let value = "";

  return {
    push(chunk: string) {
      if (value.length >= maxLength) {
        return;
      }

      value += chunk.slice(0, maxLength - value.length);
    },
    read() {
      return value;
    }
  };
}
