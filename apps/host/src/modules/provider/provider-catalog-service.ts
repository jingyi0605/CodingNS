import {
  CapabilityService,
  ClaudeCodeAdapter,
  CodexAdapter,
  GeminiAdapter,
  KimiAdapter,
  LegnaCodeAdapter,
  OpenCodeAdapter,
  ProviderRegistry,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderAdapter
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ProviderControlRepository } from "../../storage/repositories/provider-control-repository.js";
import type { ProviderControlRecord, ProviderInstallState } from "../../types/domain.js";
import { applyProviderDisabledState, createProviderDisabledError } from "./provider-disabled.js";
import { ProviderRuntimeStateService } from "./provider-runtime-state-service.js";

const STREAMING_OUTPUT_PROVIDER_IDS = new Set<ProviderId>([
  "claude-code",
  "legna-code",
  "codex",
  "opencode",
  "gemini",
  "kimi",
  "deepseek-harness"
]);
const ASSISTANT_SERVICE_PROVIDER_IDS = new Set<ProviderId>(["codex", "claude-code"]);
const SKILL_TARGET_PROVIDER_IDS = new Set<ProviderId>([
  "codex",
  "claude-code",
  "gemini",
  "opencode",
  "deepseek-harness"
]);
const RECONSTRUCTED_FORK_PROVIDER_IDS = new Set<ProviderId>([
  "codex",
  "claude-code",
  "opencode",
  "deepseek-harness"
]);

export interface ProviderCatalogEntryDto {
  provider: ProviderId;
  displayName: string;
  enabled: boolean;
  installState: ProviderInstallState;
  version: string | null;
  commandPath: string | null;
  disableImpact: {
    hidesSessions: boolean;
    blocksSessionStart: boolean;
    blocksFork: boolean;
    blocksAssistant: boolean;
    blocksSkillTargets: boolean;
  };
  capabilities: ProviderCapabilities;
  productCapabilities: {
    streamingOutput: boolean;
    toolCalls: boolean;
    assistantService: boolean;
    sessionFork: boolean;
    skillUsage: boolean;
  };
}

export class ProviderCatalogService {
  private readonly capabilityService: CapabilityService;
  private readonly providerIds: ProviderId[];

  constructor(
    config: HostConfig,
    private readonly providerControlRepository: Pick<
      ProviderControlRepository,
      "get" | "upsert"
    >,
    private readonly providerRuntimeStateService: Pick<
      ProviderRuntimeStateService,
      "getState" | "refreshAll"
    >,
    additionalAdapters: ProviderAdapter[] = []
  ) {
    const providerRegistry = new ProviderRegistry([
      new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
      new LegnaCodeAdapter({
        homeDir: config.legnaCodeHomeDir,
        legacyClaudeHomeDir: config.claudeCodeHomeDir
      }),
      new CodexAdapter({ homeDir: config.codexHomeDir }),
      new GeminiAdapter({
        homeDir: config.geminiHomeDir,
        commandPath: config.geminiCliPath
      }),
      new KimiAdapter({
        homeDir: config.kimiHomeDir,
        defaultModel: config.kimiDefaultModel
      }),
      new OpenCodeAdapter({
        baseUrl: config.opencodeBaseUrl,
        baseUrlResolver: config.opencodeBaseUrlResolver?.resolve.bind(config.opencodeBaseUrlResolver),
        dataDir: config.opencodeDataDir,
        dbPath: config.opencodeDbPath
      }),
      ...additionalAdapters
    ]);

    this.capabilityService = new CapabilityService(providerRegistry);
    this.providerIds = providerRegistry.list().map((adapter) => adapter.providerId);
  }

  listCatalog(): ProviderCatalogEntryDto[] {
    return this.providerIds.map((provider) => this.buildCatalogEntry(provider));
  }

  getCatalogEntry(provider: string): ProviderCatalogEntryDto {
    const normalizedProvider = this.normalizeKnownProvider(provider);
    return this.buildCatalogEntry(normalizedProvider);
  }

  isProviderEnabled(provider: string): boolean {
    return this.providerControlRepository.get(provider.trim()).enabled;
  }

  assertProviderEnabled(provider: string, field = "provider"): void {
    if (this.isProviderEnabled(provider)) {
      return;
    }

    throw createProviderDisabledError(provider.trim(), field);
  }

  updateProviderEnabled(provider: string, enabled: boolean): ProviderCatalogEntryDto {
    const normalizedProvider = this.normalizeKnownProvider(provider);
    const record = this.providerControlRepository.upsert({
      providerId: normalizedProvider,
      enabled,
      updatedAt: nowIso()
    } satisfies ProviderControlRecord);

    return this.buildCatalogEntry(record.providerId);
  }

  refreshRuntimeStates(): ProviderCatalogEntryDto[] {
    this.providerRuntimeStateService.refreshAll();
    return this.listCatalog();
  }

  applyProviderEnabledState(capabilities: ProviderCapabilities): ProviderCapabilities {
    if (this.isProviderEnabled(capabilities.provider)) {
      return capabilities;
    }

    return applyProviderDisabledState(capabilities);
  }

  private buildCatalogEntry(provider: ProviderId): ProviderCatalogEntryDto {
    const enabled = this.providerControlRepository.get(provider).enabled;
    const runtimeState = this.providerRuntimeStateService.getState(provider);
    const capabilities = this.getBaseCapabilities(provider);
    const supportsSessionFork = Boolean(
      capabilities.supportsSessionFork || RECONSTRUCTED_FORK_PROVIDER_IDS.has(provider)
    );

    return {
      provider,
      displayName: resolveProviderDisplayName(provider),
      enabled,
      installState: runtimeState.installState,
      version: runtimeState.version,
      commandPath: runtimeState.commandPath,
      disableImpact: {
        hidesSessions: true,
        blocksSessionStart: true,
        blocksFork: supportsSessionFork,
        blocksAssistant: ASSISTANT_SERVICE_PROVIDER_IDS.has(provider),
        blocksSkillTargets: SKILL_TARGET_PROVIDER_IDS.has(provider)
      },
      capabilities,
      productCapabilities: {
        streamingOutput: capabilities.canSendMessage && STREAMING_OUTPUT_PROVIDER_IDS.has(provider),
        toolCalls: capabilities.supportsStructuredToolCalls,
        assistantService: enabled && ASSISTANT_SERVICE_PROVIDER_IDS.has(provider),
        sessionFork: supportsSessionFork,
        skillUsage: enabled && SKILL_TARGET_PROVIDER_IDS.has(provider)
      }
    };
  }

  private getBaseCapabilities(provider: ProviderId): ProviderCapabilities {
    try {
      return this.applyInstallState(this.capabilityService.getProviderCapabilities(provider));
    } catch (error) {
      throw normalizeUnknownProviderError(error);
    }
  }

  private normalizeKnownProvider(provider: string): ProviderId {
    const normalizedProvider = provider.trim();

    if (this.providerIds.includes(normalizedProvider as ProviderId)) {
      return normalizedProvider as ProviderId;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_NOT_SUPPORTED",
      detail: "当前 provider 不受支持",
      field: "provider"
    });
  }

  private applyInstallState(capabilities: ProviderCapabilities): ProviderCapabilities {
    const runtimeState = this.providerRuntimeStateService.getState(capabilities.provider);

    if (runtimeState.installState !== "missing") {
      return capabilities;
    }

    const limitation = buildProviderMissingMessage(capabilities.provider);
    const limitations = capabilities.limitations.includes(limitation)
      ? capabilities.limitations
      : [limitation, ...capabilities.limitations];

    return {
      ...capabilities,
      canStartSession: false,
      canResumeSession: false,
      canSendMessage: false,
      supportsSubagents: false,
      supportsInterrupt: false,
      supportsSessionFork: false,
      supportsNativeAgents: false,
      limitations
    };
  }

}

function normalizeUnknownProviderError(error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }

  if (error instanceof Error && error.message === "PROVIDER_NOT_SUPPORTED") {
    throw new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_NOT_SUPPORTED",
      detail: "当前 provider 不受支持",
      field: "provider"
    });
  }

  throw error;
}

function resolveProviderDisplayName(provider: ProviderId): string {
  switch (provider) {
    case "claude-code":
      return "Claude Code";
    case "legna-code":
      return "Legna Code";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "gemini":
      return "Gemini";
    case "kimi":
      return "Kimi";
    case "deepseek-harness":
      return "DeepSeek Harness";
    default:
      return provider;
  }
}

function buildProviderMissingMessage(provider: ProviderId): string {
  switch (provider) {
    case "claude-code":
      return "未检测到 Claude CLI";
    case "legna-code":
      return "未检测到 Legna CLI";
    case "codex":
      return "未检测到 Codex CLI";
    case "opencode":
      return "未检测到 OpenCode CLI";
    case "gemini":
      return "未检测到 Gemini CLI";
    case "kimi":
      return "未检测到 Kimi CLI";
    case "deepseek-harness":
      return "未检测到 DeepSeek Harness sidecar";
    default:
      return "未检测到对应 provider 运行环境";
  }
}
