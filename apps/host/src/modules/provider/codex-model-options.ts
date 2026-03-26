import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { ProviderCapabilities, ProviderModelOption } from "@codingns/session-sync-core";

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

interface CodexDiscoverySnapshot {
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
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.commandPath, ["app-server"], {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout = createInterface({ input: child.stdout });
      const stderrChunks: string[] = [];
      let settled = false;
      let configResult: { model: string | null; modelReasoningEffort: string | null } | null = null;
      let modelResult: CodexModelListItem[] | null = null;
      const timeout = setTimeout(() => {
        finishWithError(new Error("CODEX_APP_SERVER_TIMEOUT"));
      }, this.timeoutMs);

      function cleanup(): void {
        clearTimeout(timeout);
        stdout.close();

        if (!child.killed) {
          child.kill("SIGTERM");
        }
      }

      function finishWithError(error: Error): void {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      }

      function finishWithValue(value: {
        config: {
          model: string | null;
          modelReasoningEffort: string | null;
        };
        models: CodexModelListItem[];
      }): void {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(value);
      }

      child.on("error", (error) => {
        finishWithError(error);
      });

      child.stderr.on("data", (chunk) => {
        stderrChunks.push(chunk.toString("utf8"));
      });

      child.on("exit", (code) => {
        if (settled) {
          return;
        }

        const stderr = stderrChunks.join("").trim();
        const detail = stderr || `codex app-server exited with code ${code ?? "unknown"}`;
        finishWithError(new Error(detail));
      });

      stdout.on("line", (line) => {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
          return;
        }

        let parsed: Record<string, unknown>;

        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }

        const responseId = String(parsed.id ?? "");

        if (parsed.error && typeof parsed.error === "object") {
          const message = normalizeText((parsed.error as { message?: unknown }).message);

          if (responseId === "config.read" || responseId === "model.list") {
            finishWithError(new Error(message ?? `CODEX_APP_SERVER_${responseId}_FAILED`));
          }
          return;
        }

        if (responseId === "config.read") {
          const result = normalizeConfigReadResult(parsed.result);

          if (!result) {
            finishWithError(new Error("CODEX_CONFIG_READ_INVALID"));
            return;
          }

          configResult = result;
        } else if (responseId === "model.list") {
          const result = normalizeModelListResult(parsed.result);

          if (!result) {
            finishWithError(new Error("CODEX_MODEL_LIST_INVALID"));
            return;
          }

          modelResult = result;
        }

        if (configResult && modelResult) {
          finishWithValue({
            config: configResult,
            models: modelResult
          });
        }
      });

      const requests = [
        {
          jsonrpc: "2.0",
          id: "initialize",
          method: "initialize",
          params: {
            clientInfo: {
              name: "codingns-host",
              version: "0.0.0"
            },
            capabilities: null
          }
        },
        {
          jsonrpc: "2.0",
          method: "initialized",
          params: {}
        },
        {
          jsonrpc: "2.0",
          id: "config.read",
          method: "config/read",
          params: {}
        },
        {
          jsonrpc: "2.0",
          id: "model.list",
          method: "model/list",
          params: {
            includeHidden: false,
            limit: 100
          }
        }
      ];

      requests.forEach((request) => {
        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
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

function createFallbackCodexModelOptions(currentModel: string | null): ProviderModelOption[] {
  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: "跟随 CLI 默认模型",
      usesProviderDefault: true
    }
  ];
}

function normalizeConfigReadResult(
  input: unknown
): { model: string | null; modelReasoningEffort: string | null } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const result = input as Record<string, unknown>;
  const config =
    result.config && typeof result.config === "object"
      ? (result.config as Record<string, unknown>)
      : result;

  return {
    model: normalizeText(config.model),
    modelReasoningEffort: normalizeText(
      config.model_reasoning_effort ?? config.modelReasoningEffort
    )
  };
}

function normalizeModelListResult(input: unknown): CodexModelListItem[] | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const data = (input as { data?: unknown }).data;

  if (!Array.isArray(data)) {
    return null;
  }

  return data
    .map((item) => normalizeModelListItem(item))
    .filter((item): item is CodexModelListItem => Boolean(item));
}

function normalizeModelListItem(input: unknown): CodexModelListItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const item = input as Record<string, unknown>;
  const model = normalizeText(item.model);

  if (!model) {
    return null;
  }

  return {
    model,
    displayName: normalizeText(item.displayName) ?? model,
    hidden: Boolean(item.hidden),
    supportedReasoningEfforts: Array.isArray(item.supportedReasoningEfforts)
      ? (item.supportedReasoningEfforts as Array<{ reasoningEffort?: string }>)
      : undefined
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
