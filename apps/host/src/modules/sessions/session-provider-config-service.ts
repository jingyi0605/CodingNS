import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import {
  CcSwitchAdapter,
  type ModelPresetRuntimeConfigDto,
  type ModelSwitchAppId
} from "../model-switch/cc-switch-adapter.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  SessionBinding,
  SessionProviderConfigMode
} from "../../types/domain.js";

interface SessionProviderBindingPreparation {
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
  runtimeHomeDir: string | null;
}

interface SessionProviderLaunchContext {
  runtimeHomeDir: string | null;
  runtimeEnv: Record<string, string>;
}

interface SessionProviderSelection {
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
}

interface StoredRuntimeMetadata {
  provider: SessionBinding["provider"];
  providerPresetId: string;
  runtimeEnv: Record<string, string>;
}

const SESSION_RUNTIME_METADATA_FILE = ".codingns-provider-runtime.json";
const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
const SUPPORTED_SESSION_PRESET_PROVIDERS = new Set<SessionBinding["provider"]>([
  "claude-code",
  "codex",
  "gemini"
]);
const CLAUDE_STANDARD_MODEL_IDS = new Set([
  "sonnet",
  "opus",
  "haiku"
]);
const CLAUDE_STANDARD_MODEL_PREFIX = "claude-";
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

export class SessionProviderConfigService {
  constructor(
    private readonly config: HostConfig,
    private readonly ccSwitchAdapter: CcSwitchAdapter
  ) {}

  prepareSessionBinding(input: {
    sessionId: string;
    provider: SessionBinding["provider"];
    providerConfigMode?: SessionProviderConfigMode | null;
    providerPresetId?: string | null;
  }): SessionProviderBindingPreparation {
    const selection = this.resolveRequestedSelection({
      providerConfigMode: input.providerConfigMode ?? undefined,
      providerPresetId: input.providerPresetId ?? undefined
    });

    if (selection.providerConfigMode === "global-default") {
      return {
        providerConfigMode: selection.providerConfigMode,
        providerPresetId: null,
        runtimeHomeDir: null
      };
    }

    this.assertProviderSupportsSessionPreset(input.provider);
    const presetId = selection.providerPresetId!;
    const app = mapProviderToModelSwitchApp(input.provider);
    const preset = this.ccSwitchAdapter.readPresetRuntimeConfig(app, presetId);

    if (!preset) {
      throw new AppError({
        statusCode: 404,
        errorCode: "MODEL_PRESET_NOT_FOUND",
        detail: `未找到 provider preset：${presetId}`,
        field: "providerPresetId"
      });
    }

    const runtimeHomeDir = this.resolveRuntimeHomeDir(input.provider, input.sessionId);
    this.materializeRuntimeHome(input.provider, runtimeHomeDir, preset);

    return {
      providerConfigMode: selection.providerConfigMode,
      providerPresetId: selection.providerPresetId,
      runtimeHomeDir
    };
  }

  resolveSessionBinding(input: {
    sessionId: string;
    provider: SessionBinding["provider"];
    existingBinding?: Pick<
      SessionBinding,
      "providerConfigMode" | "providerPresetId" | "runtimeHomeDir"
    > | null;
    providerConfigMode?: SessionProviderConfigMode | null;
    providerPresetId?: string | null;
  }): SessionProviderBindingPreparation {
    const existingSelection = input.existingBinding
      ? {
          providerConfigMode: input.existingBinding.providerConfigMode,
          providerPresetId: input.existingBinding.providerPresetId
        }
      : null;
    const selection = this.resolveRequestedSelection({
      providerConfigMode: input.providerConfigMode ?? undefined,
      providerPresetId: input.providerPresetId ?? undefined,
      fallback: existingSelection
    });

    if (selection.providerConfigMode === "global-default") {
      return {
        providerConfigMode: "global-default",
        providerPresetId: null,
        runtimeHomeDir: null
      };
    }

    const existingRuntimeHomeDir = input.existingBinding?.runtimeHomeDir?.trim() ?? "";

    if (
      input.existingBinding?.providerConfigMode === "cc-switch-preset"
      && input.existingBinding.providerPresetId === selection.providerPresetId
      && existingRuntimeHomeDir.length > 0
    ) {
      return {
        providerConfigMode: "cc-switch-preset",
        providerPresetId: selection.providerPresetId,
        runtimeHomeDir: existingRuntimeHomeDir
      };
    }

    return this.prepareSessionBinding({
      sessionId: input.sessionId,
      provider: input.provider,
      providerConfigMode: selection.providerConfigMode,
      providerPresetId: selection.providerPresetId
    });
  }

  resolveCapabilities(input: {
    provider: SessionBinding["provider"];
    baseCapabilities: ProviderCapabilities;
    providerConfigMode?: SessionProviderConfigMode | null;
    providerPresetId?: string | null;
  }): ProviderCapabilities {
    const selection = this.resolveRequestedSelection({
      providerConfigMode: input.providerConfigMode ?? undefined,
      providerPresetId: input.providerPresetId ?? undefined
    });

    if (selection.providerConfigMode === "global-default") {
      return input.baseCapabilities;
    }

    this.assertProviderSupportsSessionPreset(input.provider);
    const presetId = selection.providerPresetId!;
    const app = mapProviderToModelSwitchApp(input.provider);
    const preset = this.ccSwitchAdapter.readPresetRuntimeConfig(app, presetId);

    if (!preset) {
      throw new AppError({
        statusCode: 404,
        errorCode: "MODEL_PRESET_NOT_FOUND",
        detail: `未找到 provider preset：${presetId}`,
        field: "providerPresetId"
      });
    }

    switch (input.provider) {
      case "claude-code":
        return buildClaudePresetCapabilities(input.baseCapabilities, preset.settingsConfig);
      case "codex":
        return buildCodexPresetCapabilities(input.baseCapabilities, preset.settingsConfig);
      case "gemini":
        return buildGeminiPresetCapabilities(input.baseCapabilities, preset.settingsConfig);
      default:
        return input.baseCapabilities;
    }
  }

  resolveLaunchContext(binding: Pick<
    SessionBinding,
    "provider" | "providerConfigMode" | "providerPresetId" | "runtimeHomeDir"
  >): SessionProviderLaunchContext {
    if (binding.providerConfigMode !== "cc-switch-preset") {
      return {
        runtimeHomeDir: null,
        runtimeEnv: {}
      };
    }

    const runtimeHomeDir = binding.runtimeHomeDir?.trim() ?? "";

    if (!runtimeHomeDir) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_PROVIDER_RUNTIME_HOME_MISSING",
        detail: "当前会话绑定了 cc-switch preset，但缺少运行目录"
      });
    }

    const metadata = this.readRuntimeMetadata(runtimeHomeDir, binding.provider, binding.providerPresetId);

    return {
      runtimeHomeDir,
      runtimeEnv: metadata.runtimeEnv
    };
  }

  private assertProviderSupportsSessionPreset(provider: SessionBinding["provider"]): void {
    if (SUPPORTED_SESSION_PRESET_PROVIDERS.has(provider)) {
      return;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_PRESET_NOT_SUPPORTED",
      detail: `${provider} 当前不支持会话级 cc-switch preset`,
      field: "provider"
    });
  }

  private resolveRequestedSelection(input: {
    providerConfigMode?: SessionProviderConfigMode;
    providerPresetId?: string | null;
    fallback?: SessionProviderSelection | null;
  }): SessionProviderSelection {
    const normalizedPresetId = input.providerPresetId?.trim() || null;

    if (input.providerConfigMode === undefined && input.providerPresetId === undefined) {
      return input.fallback ?? {
        providerConfigMode: "global-default",
        providerPresetId: null
      };
    }

    const providerConfigMode = input.providerConfigMode ?? (normalizedPresetId ? "cc-switch-preset" : "global-default");

    if (providerConfigMode === "global-default") {
      return {
        providerConfigMode,
        providerPresetId: null
      };
    }

    if (!normalizedPresetId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "使用 cc-switch preset 时必须提供 providerPresetId",
        field: "providerPresetId"
      });
    }

    return {
      providerConfigMode,
      providerPresetId: normalizedPresetId
    };
  }

  private resolveRuntimeHomeDir(provider: SessionBinding["provider"], sessionId: string): string {
    return path.resolve(
      path.dirname(this.config.databasePath),
      "session-provider-runtime",
      provider,
      sessionId
    );
  }

  private materializeRuntimeHome(
    provider: SessionBinding["provider"],
    runtimeHomeDir: string,
    preset: ModelPresetRuntimeConfigDto
  ): void {
    fs.rmSync(runtimeHomeDir, { recursive: true, force: true });
    fs.mkdirSync(runtimeHomeDir, { recursive: true });

    const runtimeEnv = normalizeRuntimeEnv(preset.settingsConfig);
    this.writeRuntimeMetadata(runtimeHomeDir, {
      provider,
      providerPresetId: preset.id,
      runtimeEnv
    });

    switch (provider) {
      case "claude-code":
        this.materializeClaudeRuntimeHome(runtimeHomeDir, preset.settingsConfig);
        return;
      case "codex":
        this.materializeCodexRuntimeHome(runtimeHomeDir, preset.settingsConfig);
        return;
      case "gemini":
        this.materializeGeminiRuntimeHome(runtimeHomeDir);
        return;
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "PROVIDER_PRESET_NOT_SUPPORTED",
          detail: `${provider} 当前不支持会话级 cc-switch preset`
        });
    }
  }

  private materializeClaudeRuntimeHome(
    runtimeHomeDir: string,
    settingsConfig: Record<string, unknown>
  ): void {
    const sourceHomeDir = path.resolve(this.config.claudeCodeHomeDir);
    const mergedSettings = mergeJsonObjects(
      readJsonObject(path.join(sourceHomeDir, "settings.json")),
      readJsonObject(path.join(sourceHomeDir, "settings.local.json")),
      settingsConfig
    );

    syncOptionalFile(path.join(sourceHomeDir, "config.json"), path.join(runtimeHomeDir, "config.json"));
    syncOptionalFile(path.join(sourceHomeDir, "project-config.json"), path.join(runtimeHomeDir, "project-config.json"));
    syncOptionalDirectory(path.join(sourceHomeDir, "plugins"), path.join(runtimeHomeDir, "plugins"));
    syncOptionalDirectory(path.join(sourceHomeDir, "skills"), path.join(runtimeHomeDir, "skills"));

    writeJsonFile(path.join(runtimeHomeDir, "settings.json"), mergedSettings);
    removeFileIfExists(path.join(runtimeHomeDir, "settings.local.json"));
  }

  private materializeCodexRuntimeHome(
    runtimeHomeDir: string,
    settingsConfig: Record<string, unknown>
  ): void {
    const sourceHomeDir = resolveCodexSourceHomeDir(this.config.codexHomeDir, runtimeHomeDir);
    const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
    const configuredText = normalizeText(settingsConfig.config) ?? normalizeText(settingsConfig.toml) ?? "";
    const sourceConfigText =
      sourceHomeDir !== runtimeHomeDir && fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()
        ? fs.readFileSync(sourceConfigPath, "utf8")
        : "";

    syncOptionalFile(path.join(sourceHomeDir, "auth.json"), path.join(runtimeHomeDir, "auth.json"));
    syncOptionalDirectory(path.join(sourceHomeDir, "skills"), path.join(runtimeHomeDir, "skills"));
    writeTextFile(
      path.join(runtimeHomeDir, "config.toml"),
      `${composeCodexConfigContent(sourceConfigText, configuredText)}\n`
    );
  }

  private materializeGeminiRuntimeHome(runtimeHomeDir: string): void {
    fs.mkdirSync(path.join(runtimeHomeDir, "tmp"), { recursive: true });
  }

  private writeRuntimeMetadata(runtimeHomeDir: string, metadata: StoredRuntimeMetadata): void {
    writeJsonFile(
      path.join(runtimeHomeDir, SESSION_RUNTIME_METADATA_FILE),
      metadata as unknown as Record<string, unknown>
    );
  }

  private readRuntimeMetadata(
    runtimeHomeDir: string,
    provider: SessionBinding["provider"],
    providerPresetId: string | null
  ): StoredRuntimeMetadata {
    const filePath = path.join(runtimeHomeDir, SESSION_RUNTIME_METADATA_FILE);

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_PROVIDER_RUNTIME_METADATA_MISSING",
        detail: "当前会话的 provider 运行配置已经丢失，请重新创建会话"
      });
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredRuntimeMetadata;

      if (!parsed || parsed.provider !== provider) {
        throw new Error("PROVIDER_MISMATCH");
      }

      if ((parsed.providerPresetId ?? "").trim() !== (providerPresetId ?? "").trim()) {
        throw new Error("PRESET_MISMATCH");
      }

      return {
        provider,
        providerPresetId: parsed.providerPresetId,
        runtimeEnv: normalizeRuntimeEnv({
          env: parsed.runtimeEnv
        })
      };
    } catch {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_PROVIDER_RUNTIME_METADATA_INVALID",
        detail: "当前会话的 provider 运行配置已损坏，请重新创建会话"
      });
    }
  }
}

function mapProviderToModelSwitchApp(provider: SessionBinding["provider"]): ModelSwitchAppId {
  switch (provider) {
    case "claude-code":
    case "codex":
    case "gemini":
      return provider as ModelSwitchAppId;
    default:
      throw new Error(`UNSUPPORTED_MODEL_SWITCH_PROVIDER:${provider}`);
  }
}

function buildClaudePresetCapabilities(
  baseCapabilities: ProviderCapabilities,
  settingsConfig: Record<string, unknown>
): ProviderCapabilities {
  const env = normalizeRuntimeEnv(settingsConfig);
  const defaultModel = normalizeText(env.ANTHROPIC_MODEL);
  const aliasTargets = CLAUDE_MODEL_ALIASES.map((alias) => ({
    ...alias,
    target: normalizeText(env[alias.envKey])
  }));
  const customModels = new Set<string>();

  if (defaultModel && isClaudeCustomModel(defaultModel)) {
    customModels.add(defaultModel);
  }

  aliasTargets.forEach((alias) => {
    if (alias.target && isClaudeCustomModel(alias.target)) {
      customModels.add(alias.target);
    }
  });

  return {
    ...baseCapabilities,
    modelOptions: [
      buildPresetDefaultModelOption(defaultModel),
      ...aliasTargets.map((alias) => ({
        id: alias.id,
        name: alias.target ? `${alias.label}（当前：${alias.target}）` : alias.label
      })),
      ...Array.from(customModels).map((modelId) => ({
        id: modelId,
        name: modelId
      }))
    ]
  };
}

function buildCodexPresetCapabilities(
  baseCapabilities: ProviderCapabilities,
  settingsConfig: Record<string, unknown>
): ProviderCapabilities {
  const configuredText =
    normalizeText(settingsConfig.config)
    ?? normalizeText(settingsConfig.toml)
    ?? "";
  const currentModel = readTomlStringValue(configuredText, "model");
  const currentReasoningLevel = readTomlStringValue(configuredText, "model_reasoning_effort");
  const modelOptions = appendMissingModelOption(
    withPresetDefaultModelOption(baseCapabilities.modelOptions, currentModel),
    currentModel
  );

  return {
    ...baseCapabilities,
    modelOptions,
    defaultReasoningLevel: normalizeReasoningLevel(currentReasoningLevel) ?? baseCapabilities.defaultReasoningLevel ?? null
  };
}

function buildGeminiPresetCapabilities(
  baseCapabilities: ProviderCapabilities,
  settingsConfig: Record<string, unknown>
): ProviderCapabilities {
  const currentModel = resolveGeminiPresetModel(settingsConfig);

  return {
    ...baseCapabilities,
    modelOptions: appendMissingModelOption(
      withPresetDefaultModelOption(baseCapabilities.modelOptions, currentModel),
      currentModel
    )
  };
}

function withPresetDefaultModelOption(
  options: ProviderModelOption[] | undefined,
  currentModel: string | null
): ProviderModelOption[] {
  const preserved = (options ?? []).filter((option) => option.id !== PROVIDER_DEFAULT_MODEL_ID);

  return [
    buildPresetDefaultModelOption(currentModel),
    ...preserved
  ];
}

function appendMissingModelOption(
  options: ProviderModelOption[],
  currentModel: string | null
): ProviderModelOption[] {
  if (!currentModel || options.some((option) => option.id === currentModel)) {
    return options;
  }

  return [
    ...options,
    {
      id: currentModel,
      name: currentModel
    }
  ];
}

function buildPresetDefaultModelOption(currentModel: string | null): ProviderModelOption {
  return {
    id: PROVIDER_DEFAULT_MODEL_ID,
    name: currentModel ? `跟随配置文件默认模型（当前：${currentModel}）` : "跟随配置文件默认模型",
    usesProviderDefault: true
  };
}

function isClaudeCustomModel(modelId: string): boolean {
  if (CLAUDE_STANDARD_MODEL_IDS.has(modelId)) {
    return false;
  }

  if (modelId.startsWith(CLAUDE_STANDARD_MODEL_PREFIX)) {
    return false;
  }

  return true;
}

function readTomlStringValue(content: string, key: string): string | null {
  const matcher = new RegExp(`(^|\\n)\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = matcher.exec(content);
  return normalizeText(match?.[2]);
}

function resolveGeminiPresetModel(settingsConfig: Record<string, unknown>): string | null {
  const env = normalizeRuntimeEnv(settingsConfig);
  const configRecord = asRecord(settingsConfig.config);

  return normalizeText(env.GEMINI_MODEL)
    ?? normalizeText(env.GOOGLE_MODEL)
    ?? normalizeText(env.GEMINI_DEFAULT_MODEL)
    ?? normalizeText(configRecord?.model)
    ?? normalizeText(configRecord?.defaultModel);
}

function normalizeReasoningLevel(value: string | null): string | null {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRuntimeEnv(settingsConfig: Record<string, unknown>): Record<string, string> {
  const env = asRecord(settingsConfig.env);

  if (!env) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, value]) => [key, value.trim()])
  );
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function mergeJsonObjects(...records: Array<Record<string, unknown>>): Record<string, unknown> {
  return records.reduce<Record<string, unknown>>((current, record) => deepMergeRecord(current, record), {});
}

function deepMergeRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): Record<string, unknown> {
  const next = {
    ...left
  };

  for (const [key, value] of Object.entries(right)) {
    const leftValue = next[key];

    if (asRecord(leftValue) && asRecord(value)) {
      next[key] = deepMergeRecord(asRecord(leftValue) ?? {}, asRecord(value) ?? {});
      continue;
    }

    next[key] = value;
  }

  return next;
}

function composeCodexConfigContent(sourceConfigContent: string, presetConfigContent: string): string {
  const normalizedSource = sourceConfigContent.trim();
  const normalizedPreset = presetConfigContent.trim();

  return [
    "# 会话级 Codex 配置（系统自动生成）",
    normalizedSource,
    normalizedPreset
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function resolveCodexSourceHomeDir(sourceCodexHomeDir: string, targetHomeDir: string): string {
  const resolvedConfiguredSource = path.resolve(sourceCodexHomeDir);

  if (resolvedConfiguredSource !== targetHomeDir) {
    return resolvedConfiguredSource;
  }

  const fallbackHomeDir = path.resolve(path.join(os.homedir(), ".codex"));

  if (fallbackHomeDir !== targetHomeDir) {
    return fallbackHomeDir;
  }

  return targetHomeDir;
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return;
  }

  writeTextFile(targetPath, fs.readFileSync(sourcePath, "utf8"));
}

function syncOptionalDirectory(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.rmSync(filePath, { force: true });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
