import { spawnSync } from "node:child_process";

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
  type ProviderId
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ProviderControlRepository } from "../../storage/repositories/provider-control-repository.js";
import type { ProviderControlRecord } from "../../types/domain.js";
import { applyProviderDisabledState, createProviderDisabledError } from "./provider-disabled.js";

const STREAMING_OUTPUT_PROVIDER_IDS = new Set<ProviderId>([
  "claude-code",
  "legna-code",
  "codex",
  "opencode",
  "gemini",
  "kimi"
]);
const ASSISTANT_SERVICE_PROVIDER_IDS = new Set<ProviderId>(["codex", "claude-code"]);
const SKILL_TARGET_PROVIDER_IDS = new Set<ProviderId>(["codex", "claude-code", "gemini", "opencode"]);
const RECONSTRUCTED_FORK_PROVIDER_IDS = new Set<ProviderId>(["codex", "claude-code", "opencode"]);

export type ProviderInstallState = "ready" | "missing" | "unknown";

export interface ProviderCatalogEntryDto {
  provider: ProviderId;
  displayName: string;
  enabled: boolean;
  installState: ProviderInstallState;
  version: string | null;
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
  private readonly providerInstallCommands: Readonly<Partial<Record<ProviderId, string>>>;

  constructor(
    config: HostConfig,
    private readonly providerControlRepository: Pick<
      ProviderControlRepository,
      "get" | "upsert"
    >
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
      })
    ]);

    this.capabilityService = new CapabilityService(providerRegistry);
    this.providerIds = providerRegistry.list().map((adapter) => adapter.providerId);
    this.providerInstallCommands = {
      "claude-code": process.platform === "win32" ? "claude.cmd" : "claude",
      "legna-code": config.legnaCodeCliPath,
      codex: config.codexCliPath,
      gemini: config.geminiCliPath,
      kimi: config.kimiCliPath,
      opencode: config.opencodeCliPath
    };
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

  applyProviderEnabledState(capabilities: ProviderCapabilities): ProviderCapabilities {
    if (this.isProviderEnabled(capabilities.provider)) {
      return capabilities;
    }

    return applyProviderDisabledState(capabilities);
  }

  private buildCatalogEntry(provider: ProviderId): ProviderCatalogEntryDto {
    const enabled = this.providerControlRepository.get(provider).enabled;
    const capabilities = this.getBaseCapabilities(provider);
    const supportsSessionFork = Boolean(
      capabilities.supportsSessionFork || RECONSTRUCTED_FORK_PROVIDER_IDS.has(provider)
    );

    return {
      provider,
      displayName: resolveProviderDisplayName(provider),
      enabled,
      installState: this.resolveInstallState(provider),
      version: this.resolveProviderVersion(provider),
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
    if (this.resolveInstallState(capabilities.provider) !== "missing") {
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

  private resolveInstallState(provider: ProviderId): ProviderInstallState {
    const configuredCommandPath = this.providerInstallCommands[provider];

    if (!configuredCommandPath) {
      return "unknown";
    }

    return this.resolveProviderCommandPath(provider) ? "ready" : "missing";
  }

  private resolveProviderVersion(provider: ProviderId): string | null {
    const commandPath = this.resolveProviderCommandPath(provider);

    if (!commandPath) {
      return null;
    }

    for (const args of VERSION_COMMAND_ARGUMENTS) {
      const result = spawnSync(commandPath, args, {
        encoding: "utf8",
        timeout: 1_500,
        windowsHide: true
      });

      const version = parseProviderVersionOutput(result.stdout, result.stderr);

      if (version) {
        return version;
      }
    }

    return null;
  }

  private resolveProviderCommandPath(provider: ProviderId): string | null {
    const configuredCommandPath = this.providerInstallCommands[provider];

    if (!configuredCommandPath) {
      return null;
    }

    return resolveAvailableCommandPath(configuredCommandPath);
  }
}

const VERSION_COMMAND_ARGUMENTS: string[][] = [["--version"], ["-V"], ["version"]];
const VERSION_PATTERN = /\bv?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?\b/;

function parseProviderVersionOutput(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();

  if (!output) {
    return null;
  }

  const match = output.match(VERSION_PATTERN);
  return match?.[0] ?? null;
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
    default:
      return "未检测到对应 provider 运行环境";
  }
}
