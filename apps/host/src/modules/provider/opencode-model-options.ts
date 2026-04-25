import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

import { getSharedProviderDiscoveryHelperClient } from "./provider-discovery-helper-client.js";

const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5_000;

interface OpenCodeModelOptionsServiceOptions {
  baseUrl: string;
  baseUrlResolver?: (input?: { refresh?: boolean }) => Promise<string> | string;
  commandPath: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export interface OpenCodeDiscoverySnapshot {
  modelOptions: ProviderModelOption[];
}

interface OpenCodeProviderConfigSnapshot {
  providers: OpenCodeProviderEntry[];
  defaultByProvider: Record<string, string>;
}

interface OpenCodeProviderEntry {
  id: string;
  name: string;
  models: OpenCodeModelEntry[];
}

interface OpenCodeModelEntry {
  id: string;
  name: string;
}

export class OpenCodeModelOptionsService {
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { expiresAt: number; value: OpenCodeDiscoverySnapshot }>();
  private readonly inflight = new Map<string, Promise<OpenCodeDiscoverySnapshot>>();

  constructor(private readonly options: OpenCodeModelOptionsServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async readSnapshot(workspacePath: string | null): Promise<OpenCodeDiscoverySnapshot> {
    const cacheKey = normalizeText(workspacePath) ?? "";
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const inflight = this.inflight.get(cacheKey);

    if (inflight) {
      return inflight;
    }

    const task = this.loadSnapshot(cacheKey || null)
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

    this.inflight.set(cacheKey, task);
    return task;
  }

  peekSnapshot(workspacePath: string | null): OpenCodeDiscoverySnapshot | null {
    const cacheKey = normalizeText(workspacePath) ?? "";
    return this.cache.get(cacheKey)?.value ?? null;
  }

  private async loadSnapshot(workspacePath: string | null): Promise<OpenCodeDiscoverySnapshot> {
    try {
      const configSnapshot = await this.readConfigProvidersFromServer(workspacePath);
      const serverSnapshot = buildServerDiscoverySnapshot(configSnapshot);

      if (serverSnapshot) {
        return serverSnapshot;
      }
    } catch {
      // server 不可用时，继续回退到 CLI 真实列表
    }

    const cliModels = await this.readModelListFromCli(workspacePath);
    return {
      modelOptions: buildCliModelOptions(cliModels)
    };
  }

  private async readConfigProvidersFromServer(
    workspacePath: string | null
  ): Promise<OpenCodeProviderConfigSnapshot> {
    const response = await this.fetchJsonWithRetry(
      "/config/providers",
      {
        workspacePath,
        query: {
          directory: workspacePath ?? undefined
        }
      },
      false
    );
    const normalized = normalizeConfigProvidersResponse(response);

    if (!normalized) {
      throw new Error("OPENCODE_CONFIG_PROVIDERS_INVALID");
    }

    return normalized;
  }

  private fetchJsonWithRetry(
    pathname: string,
    input: {
      workspacePath?: string | null;
      query?: Record<string, string | undefined>;
    },
    refresh: boolean
  ): Promise<unknown> {
    return this.fetchResponseWithRetry(pathname, input, refresh)
      .then(async (response) => {
        const text = await response.text();
        return text.length > 0 ? JSON.parse(text) : null;
      });
  }

  private async fetchResponseWithRetry(
    pathname: string,
    input: {
      workspacePath?: string | null;
      query?: Record<string, string | undefined>;
    },
    refresh: boolean
  ): Promise<Response> {
    const baseUrl = await this.resolveBaseUrl(refresh, input.workspacePath ?? null);
    const url = new URL(pathname, `${baseUrl}/`);

    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await safeReadResponseText(response);

        if (!refresh && shouldRefreshOpenCodeBaseUrl(response.status) && this.options.baseUrlResolver) {
          return this.fetchResponseWithRetry(pathname, input, true);
        }

        throw new Error(detail || `OPENCODE_HTTP_${response.status}`);
      }

      return response;
    } catch (error) {
      if (
        !refresh
        && this.options.baseUrlResolver
        && isRetriableServerError(error)
      ) {
        return this.fetchResponseWithRetry(pathname, input, true);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveBaseUrl(refresh: boolean, workspacePath: string | null): Promise<string> {
    const resolved = this.options.baseUrlResolver
      ? await this.options.baseUrlResolver({ refresh, workspacePath })
      : this.options.baseUrl;

    return resolved.trim().replace(/\/+$/, "");
  }

  private readModelListFromCli(workspacePath: string | null): Promise<string[]> {
    return getSharedProviderDiscoveryHelperClient().readOpenCodeCliModels({
      commandPath: this.options.commandPath,
      workspacePath,
      timeoutMs: this.timeoutMs
    });
  }
}

export async function enrichOpenCodeCapabilities(
  capabilities: ProviderCapabilities,
  openCodeModelOptionsService: OpenCodeModelOptionsService,
  workspacePath: string | null
): Promise<ProviderCapabilities> {
  if (capabilities.provider !== "opencode") {
    return capabilities;
  }

  try {
    const snapshot = await openCodeModelOptionsService.readSnapshot(workspacePath);

    return {
      ...capabilities,
      modelOptions: snapshot.modelOptions
    };
  } catch {
    return {
      ...capabilities,
      modelOptions: createFallbackOpenCodeModelOptions(null),
      limitations: Array.from(
        new Set([
          ...capabilities.limitations,
          "当前无法读取 OpenCode 模型列表，暂时回退为跟随 OpenCode 默认模型。"
        ])
      )
    };
  }
}

function buildServerDiscoverySnapshot(
  snapshot: OpenCodeProviderConfigSnapshot
): OpenCodeDiscoverySnapshot | null {
  const currentDefaultModel = resolveServerDefaultModelId(snapshot);
  const modelOptions = snapshot.providers.flatMap((provider, providerIndex) => {
    const multipleProviders = snapshot.providers.length > 1;

    return provider.models.map((model) => {
      const modelId = buildOpenCodeModelId(provider.id, model.id);

      return {
        id: modelId,
        name: buildServerModelLabel({
          provider,
          model,
          modelId,
          multipleProviders,
          providerIndex
        })
      };
    });
  });
  const dedupedModelOptions = dedupeModelOptions(modelOptions);

  if (dedupedModelOptions.length === 0) {
    return null;
  }

  return {
    modelOptions: [
      ...createFallbackOpenCodeModelOptions(currentDefaultModel),
      ...dedupedModelOptions
    ]
  };
}

function buildCliModelOptions(models: string[]): ProviderModelOption[] {
  return [
    ...createFallbackOpenCodeModelOptions(null),
    ...dedupeModelOptions(
      models.map((modelId) => ({
        id: modelId,
        name: modelId
      }))
    )
  ];
}

export function createFallbackOpenCodeModelOptions(currentModelId: string | null): ProviderModelOption[] {
  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: currentModelId
        ? `跟随 OpenCode 默认模型（当前：${currentModelId}）`
        : "跟随 OpenCode 默认模型",
      usesProviderDefault: true
    }
  ];
}

function normalizeConfigProvidersResponse(input: unknown): OpenCodeProviderConfigSnapshot | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const providers = Array.isArray(record.providers)
    ? record.providers
        .map((provider) => normalizeProviderEntry(provider))
        .filter((provider): provider is OpenCodeProviderEntry => Boolean(provider))
    : [];

  const defaultByProvider = normalizeStringRecord(record.default);

  return {
    providers,
    defaultByProvider
  };
}

function normalizeProviderEntry(input: unknown): OpenCodeProviderEntry | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = normalizeText(record.id);

  if (!id) {
    return null;
  }

  return {
    id,
    name: normalizeText(record.name) ?? id,
    models: normalizeModelEntries(record.models)
  };
}

function normalizeModelEntries(input: unknown): OpenCodeModelEntry[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  return Object.values(input as Record<string, unknown>)
    .map((model) => normalizeModelEntry(model))
    .filter((model): model is OpenCodeModelEntry => Boolean(model));
}

function normalizeModelEntry(input: unknown): OpenCodeModelEntry | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = normalizeText(record.id);

  if (!id) {
    return null;
  }

  return {
    id,
    name: normalizeText(record.name) ?? id
  };
}

function normalizeStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") {
    return {};
  }

  return Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>(
    (result, [key, value]) => {
      const normalizedValue = normalizeText(value);

      if (normalizedValue) {
        result[key] = normalizedValue;
      }

      return result;
    },
    {}
  );
}

function normalizeCliModelId(input: string): string | null {
  const normalized = stripAnsi(input).trim();
  return /^[-\w.]+\/[-\w.:]+$/i.test(normalized) ? normalized : null;
}

function buildOpenCodeModelId(providerId: string, modelId: string | null): string {
  const normalizedModelId = normalizeText(modelId);

  if (!normalizedModelId) {
    return providerId;
  }

  if (normalizedModelId.includes("/")) {
    return normalizedModelId;
  }

  return `${providerId}/${normalizedModelId}`;
}

function toOpenCodeModelId(providerId: string, modelId: string | null): string | null {
  const normalizedModelId = normalizeText(modelId);
  return normalizedModelId ? buildOpenCodeModelId(providerId, normalizedModelId) : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveServerDefaultModelId(snapshot: OpenCodeProviderConfigSnapshot): string | null {
  const defaults = snapshot.providers
    .map((provider) => toOpenCodeModelId(provider.id, snapshot.defaultByProvider[provider.id] ?? null))
    .filter((modelId): modelId is string => Boolean(modelId));

  return defaults.length === 1 ? defaults[0] : null;
}

function buildServerModelLabel(input: {
  provider: OpenCodeProviderEntry;
  model: OpenCodeModelEntry;
  modelId: string;
  multipleProviders: boolean;
  providerIndex: number;
}): string {
  const modelName = normalizeText(input.model.name);

  if (!modelName) {
    return input.modelId;
  }

  if (input.multipleProviders) {
    return input.modelId;
  }

  if (input.providerIndex > 0 || input.provider.id !== "opencode") {
    return `${input.provider.id}/${modelName}`;
  }

  return modelName;
}

function dedupeModelOptions(modelOptions: ProviderModelOption[]): ProviderModelOption[] {
  const optionById = new Map<string, ProviderModelOption>();

  for (const option of modelOptions) {
    if (!optionById.has(option.id)) {
      optionById.set(option.id, option);
    }
  }

  return [...optionById.values()];
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function shouldRefreshOpenCodeBaseUrl(statusCode: number): boolean {
  return statusCode >= 500 || statusCode === 404;
}

function isRetriableServerError(error: unknown): boolean {
  return (
    error instanceof Error
    && (
      error.name === "AbortError"
      || /fetch failed/i.test(error.message)
      || /server unavailable/i.test(error.message)
      || /connect/i.test(error.message)
      || /econnrefused/i.test(error.message)
    )
  );
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
