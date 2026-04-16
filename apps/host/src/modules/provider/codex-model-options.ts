import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

import { getSharedProviderDiscoveryHelperClient } from "./provider-discovery-helper-client.js";

const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5_000;
const VISIBLE_CODEX_MODEL_IDS = new Set([
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1-codex-mini"
]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

interface CodexModelListItem {
  model: string;
  displayName: string;
  hidden: boolean;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
  }>;
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

export class CodexModelOptionsService {
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private cache: { expiresAt: number; value: CodexDiscoverySnapshot } | null = null;
  private inflight: Promise<CodexDiscoverySnapshot> | null = null;

  constructor(private readonly options: CodexModelOptionsServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async readSnapshot(): Promise<CodexDiscoverySnapshot> {
    const now = Date.now();

    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.loadSnapshot()
      .then((value) => {
        this.cache = {
          value,
          expiresAt: Date.now() + this.cacheTtlMs
        };
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  peekSnapshot(): CodexDiscoverySnapshot | null {
    return this.cache?.value ?? null;
  }

  private async loadSnapshot(): Promise<CodexDiscoverySnapshot> {
    const { config, models } = await this.readAppServerState();
    const currentModel = normalizeText(config.model);
    const defaultReasoningLevel = normalizeReasoningLevel(config.modelReasoningEffort);

    return {
      modelOptions: buildCodexModelOptions(currentModel, models),
      defaultReasoningLevel
    };
  }

  private readAppServerState(): Promise<{
    config: {
      model: string | null;
      modelReasoningEffort: string | null;
    };
    models: CodexModelListItem[];
  }> {
    return getSharedProviderDiscoveryHelperClient().readCodexAppServerState({
      commandPath: this.options.commandPath,
      timeoutMs: this.timeoutMs
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
  const allowedModels = models.filter((model) => isVisibleCodexModel(model.model, model.hidden));
  const currentModelEntry =
    allowedModels.find((model) => model.model === currentModel) ?? null;

  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: "跟随 CLI 默认模型",
      usesProviderDefault: true,
      supportedReasoningEfforts: normalizeReasoningEfforts(currentModelEntry)
    },
    ...allowedModels.map((model) => ({
      id: model.model,
      name: normalizeText(model.displayName) ?? model.model,
      supportedReasoningEfforts: normalizeReasoningEfforts(model)
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

  return {
    model,
    displayName,
    hidden: Boolean(entry.hidden),
    supportedReasoningEfforts
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

  return efforts.length > 0 ? Array.from(new Set(efforts)) : undefined;
}

function normalizeReasoningLevel(value: unknown): string | null {
  const normalized = normalizeText(value)?.toLowerCase() ?? null;

  if (!normalized || !REASONING_EFFORTS.has(normalized)) {
    return null;
  }

  return normalized;
}

function isVisibleCodexModel(modelId: string, hidden: boolean): boolean {
  if (hidden) {
    return false;
  }

  return VISIBLE_CODEX_MODEL_IDS.has(modelId);
}
