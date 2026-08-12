import { createHash } from "node:crypto";

import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

import { getSharedProviderDiscoveryHelperClient } from "./provider-discovery-helper-client.js";

const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5_000;
const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

interface CodexModelListItem {
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
  }>;
  defaultReasoningEffort?: string;
}

export interface CodexDiscoverySnapshot {
  modelOptions: ProviderModelOption[];
  defaultReasoningLevel: string | null;
}

interface CodexModelOptionsServiceOptions {
  commandPath: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export interface CodexModelOptionsReadInput {
  homeDir?: string | null;
  runtimeEnv?: Record<string, string> | null;
  cacheKey?: string | null;
}

export class CodexModelOptionsService {
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, {
    expiresAt: number;
    value: CodexDiscoverySnapshot;
  }>();
  private readonly inflight = new Map<string, Promise<CodexDiscoverySnapshot>>();

  constructor(private readonly options: CodexModelOptionsServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async readSnapshot(input: CodexModelOptionsReadInput = {}): Promise<CodexDiscoverySnapshot> {
    const cacheKey = buildCodexDiscoveryCacheKey(input);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const currentInflight = this.inflight.get(cacheKey);

    if (currentInflight) {
      return currentInflight;
    }

    const inflight = this.loadSnapshot(input)
      .then((value) => {
        this.cache.set(cacheKey, {
          value,
          expiresAt: Date.now() + this.cacheTtlMs
        });
        return value;
      })
      .finally(() => {
        this.inflight.delete(cacheKey);
      });

    this.inflight.set(cacheKey, inflight);
    return inflight;
  }

  peekSnapshot(input: CodexModelOptionsReadInput = {}): CodexDiscoverySnapshot | null {
    return this.cache.get(buildCodexDiscoveryCacheKey(input))?.value ?? null;
  }

  private async loadSnapshot(input: CodexModelOptionsReadInput): Promise<CodexDiscoverySnapshot> {
    const { config, models } = await this.readAppServerState(input);
    const currentModel = normalizeText(config.model);
    const defaultReasoningLevel = normalizeReasoningLevel(config.modelReasoningEffort);

    return {
      modelOptions: buildCodexModelOptions(currentModel, models),
      defaultReasoningLevel
    };
  }

  private readAppServerState(input: CodexModelOptionsReadInput): Promise<{
    config: {
      model: string | null;
      modelReasoningEffort: string | null;
    };
    models: CodexModelListItem[];
  }> {
    return getSharedProviderDiscoveryHelperClient().readCodexAppServerState({
      commandPath: this.options.commandPath,
      timeoutMs: this.timeoutMs,
      homeDir: input.homeDir ?? null,
      runtimeEnv: input.runtimeEnv ?? null
    }).then((result) => {
      return {
        config: result.config,
        models: result.models
          .map((entry) => normalizeModelListItem(entry))
          .filter((entry): entry is CodexModelListItem => entry !== null)
      };
    });
  }
}

function buildCodexDiscoveryCacheKey(input: CodexModelOptionsReadInput): string {
  const runtimeEnv = Object.entries(input.runtimeEnv ?? {})
    .filter(([key, value]) => key.trim().length > 0 && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key.trim(), String(value)]);
  const runtimeEnvFingerprint = createHash("sha256")
    .update(JSON.stringify(runtimeEnv))
    .digest("hex")
    .slice(0, 24);

  return JSON.stringify({
    homeDir: input.homeDir?.trim() || null,
    runtimeEnvFingerprint,
    cacheKey: input.cacheKey?.trim() || null
  });
}

export async function enrichCodexCapabilities(
  capabilities: ProviderCapabilities,
  codexModelOptionsService: CodexModelOptionsService
): Promise<ProviderCapabilities> {
  if (capabilities.provider !== "codex") {
    return capabilities;
  }

  try {
    const snapshot = await codexModelOptionsService.readSnapshot();

    return {
      ...capabilities,
      modelOptions: snapshot.modelOptions,
      defaultReasoningLevel: snapshot.defaultReasoningLevel
    };
  } catch {
    return {
      ...capabilities,
      modelOptions: createFallbackCodexModelOptions(null),
      defaultReasoningLevel: null,
      limitations: Array.from(
        new Set([
          ...capabilities.limitations,
          "当前无法读取 Codex 模型列表，暂时回退为跟随当前配置模式。"
        ])
      )
    };
  }
}

function buildCodexModelOptions(
  currentModel: string | null,
  models: CodexModelListItem[]
): ProviderModelOption[] {
  const allowedModels = models.filter((model) => isVisibleCodexModel(model));
  const currentModelEntry =
    allowedModels.find((model) => model.model === currentModel)
    ?? (!currentModel ? allowedModels.find((model) => model.isDefault) : null)
    ?? null;
  const visibleModels = currentModel && !currentModelEntry
    ? [
        {
          model: currentModel,
          displayName: currentModel,
          hidden: false
        },
        ...allowedModels
      ]
    : allowedModels;

  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: "跟随 CLI 默认模型",
      usesProviderDefault: true,
      supportedReasoningEfforts: normalizeReasoningEfforts(currentModelEntry),
      ...(currentModelEntry?.defaultReasoningEffort
        ? { defaultReasoningEffort: currentModelEntry.defaultReasoningEffort }
        : {})
    },
    ...visibleModels.map((model) => ({
      id: model.model,
      name: normalizeText(model.displayName) ?? model.model,
      supportedReasoningEfforts: normalizeReasoningEfforts(model),
      ...(model.defaultReasoningEffort ? { defaultReasoningEffort: model.defaultReasoningEffort } : {})
    }))
  ];
}

export function createFallbackCodexModelOptions(currentModel: string | null): ProviderModelOption[] {
  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: "跟随 CLI 默认模型",
      usesProviderDefault: true
    }
  ];
}

function normalizeModelListItem(input: unknown): CodexModelListItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const entry = input as Record<string, unknown>;
  const model = normalizeText(entry.model);
  const displayName = normalizeText(entry.displayName);

  if (!model || !displayName) {
    return null;
  }

  const supportedReasoningEfforts = Array.isArray(entry.supportedReasoningEfforts)
    ? entry.supportedReasoningEfforts
        .filter((item): item is { reasoningEffort?: string } => !!item && typeof item === "object")
        .map((item) => ({
          reasoningEffort: normalizeText(item.reasoningEffort) ?? undefined
        }))
    : undefined;
  const defaultReasoningEffort = normalizeReasoningLevel(entry.defaultReasoningEffort) ?? undefined;

  return {
    model,
    displayName,
    hidden: Boolean(entry.hidden),
    isDefault: entry.isDefault === true,
    supportedReasoningEfforts,
    defaultReasoningEffort
  };
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeReasoningEfforts(model: CodexModelListItem | null): string[] | undefined {
  if (!model?.supportedReasoningEfforts) {
    return undefined;
  }

  const efforts = model.supportedReasoningEfforts
    .map((item) => normalizeReasoningLevel(item.reasoningEffort))
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(efforts));
}

function normalizeReasoningLevel(value: unknown): string | null {
  const normalized = normalizeText(value)?.toLowerCase() ?? null;

  if (!normalized || !REASONING_EFFORTS.has(normalized)) {
    return null;
  }

  return normalized;
}

function isVisibleCodexModel(model: CodexModelListItem): boolean {
  return model.model.trim().length > 0 && !model.hidden;
}
