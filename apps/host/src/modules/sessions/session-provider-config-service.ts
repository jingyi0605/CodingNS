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
import type { WorkspaceSessionAuthService } from "./workspace-session-auth-service.js";
import type { OpenCliSessionRuntimeResolution } from "../opencli/opencli-runtime-resolver.js";
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

export interface SessionProviderBindingDebugSummary {
  provider: SessionBinding["provider"];
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
  providerPresetName: string | null;
  runtimeHomeDir: string | null;
  modelProvider: string | null;
  model: string | null;
  baseUrl: string | null;
  authEnvKeys: string[];
}

interface SessionProviderSelection {
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
}

interface OpenCliRuntimeResolverPort {
  resolveSessionRuntime(): OpenCliSessionRuntimeResolution;
}

interface OpenCliBridgeSkillServicePort {
  supportsProvider(provider: SessionBinding["provider"]): boolean;
  hasEnabledCommands(): boolean;
  syncRuntimeSkill(provider: SessionBinding["provider"], runtimeHomeDir: string): void;
  removeRuntimeSkill(provider: SessionBinding["provider"], runtimeHomeDir: string): void;
}

interface StoredRuntimeMetadata {
  provider: SessionBinding["provider"];
  providerPresetId: string;
  runtimeEnv: Record<string, string>;
}

interface WorkspaceSessionRuntimeContextPort {
  syncRuntimeContext(input: {
    sessionId: string;
    userId: string;
    workspaceId: string;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    runtimeHomeDir: string;
  }): void;
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
const CLAUDE_RUNTIME_STATE_FILES = [
  ".claude.json",
  "history.jsonl",
  "stats-cache.json"
] as const;
const CLAUDE_RUNTIME_STATE_DIRECTORIES = [
  "plans",
  "session-env",
  "sessions",
  "shell-snapshots",
  "todos"
] as const;
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
    private readonly ccSwitchAdapter: CcSwitchAdapter,
    private readonly openCliRuntimeResolver?: OpenCliRuntimeResolverPort,
    private readonly openCliBridgeSkillService?: OpenCliBridgeSkillServicePort,
    private readonly workspaceSessionRuntimeContextService?: WorkspaceSessionRuntimeContextPort
  ) {}

  prepareSessionBinding(input: {
    sessionId: string;
    userId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    providerConfigMode?: SessionProviderConfigMode | null;
    providerPresetId?: string | null;
  }): SessionProviderBindingPreparation {
    const selection = this.resolveRequestedSelection({
      providerConfigMode: input.providerConfigMode ?? undefined,
      providerPresetId: input.providerPresetId ?? undefined
    });

    if (selection.providerConfigMode === "global-default") {
      if (!this.shouldUseManagedRuntimeHome(input.provider)) {
        return {
          providerConfigMode: selection.providerConfigMode,
          providerPresetId: null,
          runtimeHomeDir: null
        };
      }

      const runtimeHomeDir = this.resolveRuntimeHomeDir(input.provider, input.sessionId);
      this.materializeGlobalRuntimeHome(input.provider, runtimeHomeDir);
      this.syncWorkspaceSessionRuntimeContext(input, runtimeHomeDir);

      return {
        providerConfigMode: selection.providerConfigMode,
        providerPresetId: null,
        runtimeHomeDir
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
    this.syncWorkspaceSessionRuntimeContext(input, runtimeHomeDir);

    return {
      providerConfigMode: selection.providerConfigMode,
      providerPresetId: selection.providerPresetId,
      runtimeHomeDir
    };
  }

  resolveSessionBinding(input: {
    sessionId: string;
    userId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    existingBinding?: Pick<
      SessionBinding,
      "providerConfigMode" | "providerPresetId" | "runtimeHomeDir" | "providerSessionId" | "rawStoreRef"
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

    const existingRuntimeHomeDir = input.existingBinding?.runtimeHomeDir?.trim() ?? "";

    if (selection.providerConfigMode === "global-default") {
      const shouldUseManagedRuntimeHome = this.shouldUseManagedRuntimeHome(input.provider);

      if (
        input.existingBinding?.providerConfigMode === "global-default"
        && existingRuntimeHomeDir.length > 0
      ) {
        if (shouldUseManagedRuntimeHome) {
          this.materializeGlobalRuntimeHome(input.provider, existingRuntimeHomeDir);

          return {
            providerConfigMode: "global-default",
            providerPresetId: null,
            runtimeHomeDir: existingRuntimeHomeDir
          };
        }

        return {
          providerConfigMode: "global-default",
          providerPresetId: null,
          runtimeHomeDir: null
        };
      }

      if (!shouldUseManagedRuntimeHome) {
        return {
          providerConfigMode: "global-default",
          providerPresetId: null,
          runtimeHomeDir: null
        };
      }

      const preparedBinding = this.prepareSessionBinding({
        sessionId: input.sessionId,
        userId: input.userId ?? null,
        workspaceId: input.workspaceId ?? existingBinding?.workspaceId ?? null,
        projectId: input.projectId ?? null,
        provider: input.provider,
        providerConfigMode: selection.providerConfigMode,
        providerPresetId: selection.providerPresetId
      });

      this.syncProviderRuntimeStateToPreparedHome(
        input.provider,
        input.existingBinding,
        preparedBinding.runtimeHomeDir
      );

      return preparedBinding;
    }

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

    const preparedBinding = this.prepareSessionBinding({
      sessionId: input.sessionId,
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? existingBinding?.workspaceId ?? null,
      projectId: input.projectId ?? null,
      provider: input.provider,
      providerConfigMode: selection.providerConfigMode,
      providerPresetId: selection.providerPresetId
    });

    this.syncProviderRuntimeStateToPreparedHome(
      input.provider,
      input.existingBinding,
      preparedBinding.runtimeHomeDir
    );

    return preparedBinding;
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
    const baseLaunchContext = this.resolveBaseLaunchContext(binding);
    const openCliResolution = this.openCliRuntimeResolver?.resolveSessionRuntime();

    this.refreshOpenCliBridgeSkill(binding, openCliResolution);

    if (!openCliResolution || openCliResolution.availability !== "ready" || !openCliResolution.runtimeBinPath) {
      return baseLaunchContext;
    }

    return {
      runtimeHomeDir: baseLaunchContext.runtimeHomeDir,
      runtimeEnv: mergeLaunchRuntimeEnv(baseLaunchContext.runtimeEnv, openCliResolution)
    };
  }

  private resolveBaseLaunchContext(binding: Pick<
    SessionBinding,
    "provider" | "providerConfigMode" | "providerPresetId" | "runtimeHomeDir"
  >): SessionProviderLaunchContext {
    const runtimeHomeDir = binding.runtimeHomeDir?.trim() ?? "";

    if (!runtimeHomeDir) {
      return {
        runtimeHomeDir: null,
        runtimeEnv: {}
      };
    }

    const metadata = this.readRuntimeMetadata(runtimeHomeDir, binding.provider, binding.providerPresetId);

    return {
      runtimeHomeDir,
      runtimeEnv: metadata.runtimeEnv
    };
  }

  describeBinding(binding: Pick<
    SessionBinding,
    "provider" | "providerConfigMode" | "providerPresetId" | "runtimeHomeDir"
  >): SessionProviderBindingDebugSummary {
    const summary: SessionProviderBindingDebugSummary = {
      provider: binding.provider,
      providerConfigMode: binding.providerConfigMode,
      providerPresetId: binding.providerPresetId,
      providerPresetName: null,
      runtimeHomeDir: binding.runtimeHomeDir ?? null,
      modelProvider: null,
      model: null,
      baseUrl: null,
      authEnvKeys: []
    };

    if (binding.providerConfigMode !== "cc-switch-preset") {
      return summary;
    }

    try {
      const app = mapProviderToModelSwitchApp(binding.provider);
      const preset = binding.providerPresetId
        ? this.ccSwitchAdapter.readPresetRuntimeConfig(app, binding.providerPresetId)
        : null;

      summary.providerPresetName = preset?.name ?? null;
    } catch {
      return summary;
    }

    const runtimeHomeDir = binding.runtimeHomeDir?.trim() ?? "";

    if (!runtimeHomeDir) {
      return summary;
    }

    const configPath = path.join(runtimeHomeDir, "config.toml");

    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
      const document = parseSimpleTomlDocument(fs.readFileSync(configPath, "utf8"));
      const modelProvider = decodeSimpleTomlStringValue(document.rootValues.get("model_provider"));
      const model = decodeSimpleTomlStringValue(document.rootValues.get("model"));

      summary.modelProvider = modelProvider;
      summary.model = model;

      if (modelProvider) {
        const providerTable = document.tables.get(`model_providers.${modelProvider}`);
        summary.baseUrl = decodeSimpleTomlStringValue(providerTable?.values.get("base_url"));
      }
    }

    try {
      const metadata = this.readRuntimeMetadata(runtimeHomeDir, binding.provider, binding.providerPresetId);
      summary.authEnvKeys = Object.keys(metadata.runtimeEnv).sort();
    } catch {
      return summary;
    }

    return summary;
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

  private syncWorkspaceSessionRuntimeContext(
    input: {
      sessionId: string;
      userId?: string | null;
      workspaceId?: string | null;
      projectId?: string | null;
      provider: SessionBinding["provider"];
    },
    runtimeHomeDir: string
  ): void {
    const userId = input.userId?.trim() ?? "";
    const workspaceId = input.workspaceId?.trim() ?? "";

    if (!this.workspaceSessionRuntimeContextService || !userId || !workspaceId) {
      return;
    }

    this.workspaceSessionRuntimeContextService.syncRuntimeContext({
      sessionId: input.sessionId,
      userId,
      workspaceId,
      projectId: input.projectId?.trim() || null,
      provider: input.provider,
      runtimeHomeDir
    });
  }

  private materializeRuntimeHome(
    provider: SessionBinding["provider"],
    runtimeHomeDir: string,
    preset: ModelPresetRuntimeConfigDto
  ): void {
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

    this.refreshOpenCliBridgeSkill(
      {
        provider,
        runtimeHomeDir
      },
      this.openCliRuntimeResolver?.resolveSessionRuntime()
    );
  }

  private materializeGlobalRuntimeHome(
    provider: SessionBinding["provider"],
    runtimeHomeDir: string
  ): void {
    fs.mkdirSync(runtimeHomeDir, { recursive: true });
    this.writeRuntimeMetadata(runtimeHomeDir, {
      provider,
      providerPresetId: "",
      runtimeEnv: {}
    });

    switch (provider) {
      case "claude-code":
        this.materializeClaudeRuntimeHome(runtimeHomeDir, {});
        break;
      case "codex":
        this.materializeCodexRuntimeHome(runtimeHomeDir, {});
        break;
      default:
        return;
    }

    this.refreshOpenCliBridgeSkill(
      {
        provider,
        runtimeHomeDir
      },
      this.openCliRuntimeResolver?.resolveSessionRuntime()
    );
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

  private syncProviderRuntimeStateToPreparedHome(
    provider: SessionBinding["provider"],
    existingBinding: Pick<
      SessionBinding,
      "providerSessionId" | "rawStoreRef" | "runtimeHomeDir"
    > | null | undefined,
    targetRuntimeHomeDir: string | null
  ): void {
    if (!existingBinding || !targetRuntimeHomeDir) {
      return;
    }

    switch (provider) {
      case "claude-code":
        this.syncClaudeSessionRuntimeState(existingBinding, targetRuntimeHomeDir);
        return;
      default:
        return;
    }
  }

  private syncClaudeSessionRuntimeState(
    existingBinding: Pick<
      SessionBinding,
      "providerSessionId" | "rawStoreRef" | "runtimeHomeDir"
    >,
    targetRuntimeHomeDir: string
  ): void {
    const sourceSessionFilePath = this.resolveClaudeSessionFilePath(existingBinding);
    const sourceRuntimeHomeDir = this.resolveClaudeSourceHomeDir(existingBinding, sourceSessionFilePath);

    if (sourceRuntimeHomeDir) {
      this.syncClaudeRuntimeStateEntries(sourceRuntimeHomeDir, targetRuntimeHomeDir);
    }

    if (!sourceSessionFilePath) {
      return;
    }

    const sourceSessionDirectory = path.dirname(sourceSessionFilePath);
    const targetSessionDirectory = resolveClaudeSessionTargetDirectory(
      sourceSessionDirectory,
      targetRuntimeHomeDir
    );

    if (path.resolve(sourceSessionDirectory) === path.resolve(targetSessionDirectory)) {
      return;
    }

    syncOptionalDirectory(sourceSessionDirectory, targetSessionDirectory);
  }

  private resolveClaudeSessionFilePath(
    binding: Pick<SessionBinding, "providerSessionId" | "rawStoreRef" | "runtimeHomeDir">
  ): string | null {
    const rawStoreRef = binding.rawStoreRef?.trim() ?? "";

    if (rawStoreRef && fs.existsSync(rawStoreRef) && fs.statSync(rawStoreRef).isFile()) {
      return rawStoreRef;
    }

    const providerSessionId = binding.providerSessionId?.trim() ?? "";

    if (!providerSessionId) {
      return null;
    }

    const candidateHomes = this.listClaudeCandidateHomes(binding);

    for (const homeDir of candidateHomes) {
      const matched = findClaudeSessionFileInHome(homeDir, providerSessionId);

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  private resolveClaudeSourceHomeDir(
    binding: Pick<SessionBinding, "providerSessionId" | "rawStoreRef" | "runtimeHomeDir">,
    sourceSessionFilePath: string | null
  ): string | null {
    const candidateHomes = this.listClaudeCandidateHomes(binding);
    const normalizedSessionFilePath = sourceSessionFilePath ? path.resolve(sourceSessionFilePath) : null;

    if (normalizedSessionFilePath) {
      for (const homeDir of candidateHomes) {
        const projectsRoot = path.join(homeDir, "projects");
        const normalizedProjectsRoot = path.resolve(projectsRoot);

        if (
          normalizedSessionFilePath === normalizedProjectsRoot
          || normalizedSessionFilePath.startsWith(`${normalizedProjectsRoot}${path.sep}`)
        ) {
          return homeDir;
        }
      }
    }

    const existingRuntimeHomeDir = binding.runtimeHomeDir?.trim() ?? "";

    if (
      existingRuntimeHomeDir.length > 0
      && fs.existsSync(existingRuntimeHomeDir)
      && fs.statSync(existingRuntimeHomeDir).isDirectory()
    ) {
      return path.resolve(existingRuntimeHomeDir);
    }

    return candidateHomes[0] ?? null;
  }

  private listClaudeCandidateHomes(
    binding: Pick<SessionBinding, "runtimeHomeDir">
  ): string[] {
    return [
      binding.runtimeHomeDir?.trim() ?? "",
      path.resolve(this.config.claudeCodeHomeDir)
    ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  }

  private syncClaudeRuntimeStateEntries(sourceHomeDir: string, targetRuntimeHomeDir: string): void {
    if (path.resolve(sourceHomeDir) === path.resolve(targetRuntimeHomeDir)) {
      return;
    }

    CLAUDE_RUNTIME_STATE_FILES.forEach((entry) => {
      syncOptionalFile(
        path.join(sourceHomeDir, entry),
        path.join(targetRuntimeHomeDir, entry)
      );
    });

    CLAUDE_RUNTIME_STATE_DIRECTORIES.forEach((entry) => {
      syncOptionalDirectory(
        path.join(sourceHomeDir, entry),
        path.join(targetRuntimeHomeDir, entry)
      );
    });
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

  private shouldUseManagedRuntimeHome(provider: SessionBinding["provider"]): boolean {
    if (provider === "codex") {
      // Codex 的原生桌面端会直接读取同一个 home 里的 thread 索引和 transcript。
      // 全局默认会话如果切到独立 runtime home，会把项目会话和原生 App 会话彻底分叉。
      return false;
    }

    if (!this.openCliBridgeSkillService?.supportsProvider(provider)) {
      return false;
    }

    if (!this.openCliBridgeSkillService.hasEnabledCommands()) {
      return false;
    }

    const runtimeResolution = this.openCliRuntimeResolver?.resolveSessionRuntime();
    return runtimeResolution?.availability === "ready";
  }

  private refreshOpenCliBridgeSkill(
    binding: Pick<SessionBinding, "provider" | "runtimeHomeDir">,
    openCliResolution: OpenCliSessionRuntimeResolution | undefined
  ): void {
    const targetHomeDir = this.resolveOpenCliBridgeSkillHomeDir(binding);

    if (!targetHomeDir || !this.openCliBridgeSkillService?.supportsProvider(binding.provider)) {
      return;
    }

    if (openCliResolution?.availability === "ready" && this.openCliBridgeSkillService.hasEnabledCommands()) {
      this.openCliBridgeSkillService.syncRuntimeSkill(binding.provider, targetHomeDir);
      return;
    }

    this.openCliBridgeSkillService.removeRuntimeSkill(binding.provider, targetHomeDir);
  }

  private resolveOpenCliBridgeSkillHomeDir(
    binding: Pick<SessionBinding, "provider" | "runtimeHomeDir">
  ): string | null {
    const runtimeHomeDir = binding.runtimeHomeDir?.trim() ?? "";

    if (runtimeHomeDir) {
      return runtimeHomeDir;
    }

    if (binding.provider === "codex") {
      return path.resolve(this.config.codexHomeDir);
    }

    return null;
  }
}

function mergeLaunchRuntimeEnv(
  baseRuntimeEnv: Record<string, string>,
  openCliResolution: OpenCliSessionRuntimeResolution
): Record<string, string> {
  const runtimeEnv = {
    ...baseRuntimeEnv
  };
  const basePath = runtimeEnv.PATH?.trim() || process.env.PATH?.trim() || "";
  const pathEntries = [openCliResolution.runtimeBinPath, basePath].filter(
    (entry): entry is string => Boolean(entry && entry.trim())
  );

  runtimeEnv.PATH = pathEntries.join(path.delimiter);

  if (openCliResolution.runtimeRootPath) {
    runtimeEnv.CODINGNS_OPENCLI_RUNTIME_ROOT = openCliResolution.runtimeRootPath;
  }
  if (openCliResolution.realHome) {
    runtimeEnv.CODINGNS_OPENCLI_REAL_HOME = openCliResolution.realHome;
  }
  if (openCliResolution.realUserProfile) {
    runtimeEnv.CODINGNS_OPENCLI_REAL_USERPROFILE = openCliResolution.realUserProfile;
  }

  return runtimeEnv;
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
  return {
    ...normalizeStringRecord(asRecord(settingsConfig.env)),
    ...normalizeStringRecord(asRecord(settingsConfig.auth))
  };
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
  const merged = mergeCodexTomlDocuments(
    parseSimpleTomlDocument(sourceConfigContent),
    parseSimpleTomlDocument(presetConfigContent)
  );

  return serializeSimpleTomlDocument(merged);
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

  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function findClaudeSessionFileInHome(homeDir: string, providerSessionId: string): string | null {
  const projectsDir = path.join(homeDir, "projects");

  if (!fs.existsSync(projectsDir) || !fs.statSync(projectsDir).isDirectory()) {
    return null;
  }

  const projectDirectories = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDir, entry.name, `${providerSessionId}.jsonl`));

  for (const candidatePath of projectDirectories) {
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      return candidatePath;
    }
  }

  return null;
}

function resolveClaudeSessionTargetDirectory(sourceSessionDirectory: string, targetRuntimeHomeDir: string): string {
  const normalizedSourceDirectory = path.resolve(sourceSessionDirectory);
  const projectsMarker = `${path.sep}projects${path.sep}`;
  const markerIndex = normalizedSourceDirectory.lastIndexOf(projectsMarker);
  const relativeProjectPath = markerIndex >= 0
    ? normalizedSourceDirectory.slice(markerIndex + projectsMarker.length)
    : path.basename(normalizedSourceDirectory);

  return path.join(targetRuntimeHomeDir, "projects", relativeProjectPath);
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

function normalizeStringRecord(record: Record<string, unknown> | null): Record<string, string> {
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0)
  );
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function decodeSimpleTomlStringValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  if (
    (normalizedValue.startsWith("\"") && normalizedValue.endsWith("\""))
    || (normalizedValue.startsWith("'") && normalizedValue.endsWith("'"))
  ) {
    return normalizedValue.slice(1, -1).trim() || null;
  }

  return normalizedValue;
}

interface SimpleTomlTable {
  order: string[];
  values: Map<string, string>;
}

interface SimpleTomlDocument {
  rootOrder: string[];
  rootValues: Map<string, string>;
  tableOrder: string[];
  tables: Map<string, SimpleTomlTable>;
}

function parseSimpleTomlDocument(content: string): SimpleTomlDocument {
  const document: SimpleTomlDocument = {
    rootOrder: [],
    rootValues: new Map(),
    tableOrder: [],
    tables: new Map()
  };
  let currentTableName: string | null = null;

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const tableMatch = /^\[([^\]]+)\]$/u.exec(trimmed);

    if (tableMatch) {
      currentTableName = tableMatch[1]?.trim() || null;

      if (currentTableName && !document.tables.has(currentTableName)) {
        document.tableOrder.push(currentTableName);
        document.tables.set(currentTableName, {
          order: [],
          values: new Map()
        });
      }
      continue;
    }

    const delimiterIndex = trimmed.indexOf("=");

    if (delimiterIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = trimmed.slice(delimiterIndex + 1).trim();

    if (!key || !value) {
      continue;
    }

    if (!currentTableName) {
      if (!document.rootValues.has(key)) {
        document.rootOrder.push(key);
      }
      document.rootValues.set(key, value);
      continue;
    }

    const currentTable = document.tables.get(currentTableName);

    if (!currentTable) {
      continue;
    }

    if (!currentTable.values.has(key)) {
      currentTable.order.push(key);
    }
    currentTable.values.set(key, value);
  }

  return document;
}

function mergeCodexTomlDocuments(
  source: SimpleTomlDocument,
  preset: SimpleTomlDocument
): SimpleTomlDocument {
  const merged: SimpleTomlDocument = {
    rootOrder: [...source.rootOrder],
    rootValues: new Map(source.rootValues),
    tableOrder: [...source.tableOrder],
    tables: new Map(
      Array.from(source.tables.entries()).map(([tableName, table]) => [
        tableName,
        {
          order: [...table.order],
          values: new Map(table.values)
        }
      ])
    )
  };

  for (const key of preset.rootOrder) {
    if (!merged.rootValues.has(key)) {
      merged.rootOrder.push(key);
    }
    const value = preset.rootValues.get(key);

    if (value) {
      merged.rootValues.set(key, value);
    }
  }

  for (const tableName of preset.tableOrder) {
    const presetTable = preset.tables.get(tableName);

    if (!presetTable) {
      continue;
    }

    if (!merged.tables.has(tableName)) {
      merged.tableOrder.push(tableName);
      merged.tables.set(tableName, {
        order: [],
        values: new Map()
      });
    }

    const mergedTable = merged.tables.get(tableName)!;

    for (const key of presetTable.order) {
      if (!mergedTable.values.has(key)) {
        mergedTable.order.push(key);
      }
      const value = presetTable.values.get(key);

      if (value) {
        mergedTable.values.set(key, value);
      }
    }
  }

  return merged;
}

function serializeSimpleTomlDocument(document: SimpleTomlDocument): string {
  const lines = ["# 会话级 Codex 配置（系统自动生成）"];

  if (document.rootOrder.length > 0) {
    lines.push("");
    for (const key of document.rootOrder) {
      const value = document.rootValues.get(key);

      if (!value) {
        continue;
      }

      lines.push(`${key} = ${value}`);
    }
  }

  for (const tableName of document.tableOrder) {
    const table = document.tables.get(tableName);

    if (!table || table.order.length === 0) {
      continue;
    }

    lines.push("");
    lines.push(`[${tableName}]`);

    for (const key of table.order) {
      const value = table.values.get(key);

      if (!value) {
        continue;
      }

      lines.push(`${key} = ${value}`);
    }
  }

  return lines.join("\n");
}
