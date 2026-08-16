import type {
  ProviderSessionCostBreakdown,
  ProviderSessionCostExchangeRate,
  ProviderSessionCostPrice,
  ProviderId,
  ProviderSessionPriceBook,
  ProviderSessionBillingContext,
  ProviderSessionStatValue,
  ProviderSessionStats,
  ProviderSessionStatsReadOptions
} from "./types.js";

export const DEFAULT_PROVIDER_PRICE_BOOK_VERSION = "2026-08-16";
/** 仅用于费用详情的本地展示换算，不参与 USD 费用计算。 */
export const DEFAULT_USD_TO_CNY_RATE = 7.2;
export const DEFAULT_USD_TO_CNY_RATE_VERSION = DEFAULT_PROVIDER_PRICE_BOOK_VERSION;

export interface ProviderPriceBookEntry {
  provider: ProviderId;
  model: string;
  inputUsdPerToken: number;
  outputUsdPerToken: number;
  cacheReadUsdPerToken?: number;
  cacheWriteUsdPerToken?: number;
}

export interface ProviderPriceBook {
  version: string;
  entries: readonly ProviderPriceBookEntry[];
  source?: "builtin" | "models.dev";
  fetchedAt?: string;
}

export const DEFAULT_PROVIDER_COST_EXCHANGE_RATE: ProviderSessionCostExchangeRate = {
  from: "USD",
  to: "CNY",
  rate: DEFAULT_USD_TO_CNY_RATE,
  version: DEFAULT_USD_TO_CNY_RATE_VERSION,
  source: "application-fixed"
};

/**
 * 运行时只读的价格表。它是估算候选，不代表订阅、代理或折扣账单。
 * 未命中模型时必须隐藏总费用，不能用相近模型替代。
 */
export const DEFAULT_PROVIDER_PRICE_BOOK: ProviderPriceBook = {
  version: DEFAULT_PROVIDER_PRICE_BOOK_VERSION,
  source: "builtin",
  entries: [
    { provider: "claude-code", model: "claude-opus-4-1", inputUsdPerToken: 15e-6, outputUsdPerToken: 75e-6, cacheReadUsdPerToken: 1.5e-6, cacheWriteUsdPerToken: 18.75e-6 },
    { provider: "claude-code", model: "claude-opus-4-5", inputUsdPerToken: 5e-6, outputUsdPerToken: 25e-6, cacheReadUsdPerToken: 0.5e-6, cacheWriteUsdPerToken: 6.25e-6 },
    { provider: "claude-code", model: "claude-sonnet-4-5", inputUsdPerToken: 3e-6, outputUsdPerToken: 15e-6, cacheReadUsdPerToken: 0.3e-6, cacheWriteUsdPerToken: 3.75e-6 },
    { provider: "claude-code", model: "claude-3-7-sonnet", inputUsdPerToken: 3e-6, outputUsdPerToken: 15e-6, cacheReadUsdPerToken: 0.3e-6, cacheWriteUsdPerToken: 3.75e-6 },
    { provider: "claude-code", model: "claude-3-5-sonnet", inputUsdPerToken: 3e-6, outputUsdPerToken: 15e-6, cacheReadUsdPerToken: 0.3e-6, cacheWriteUsdPerToken: 3.75e-6 },
    { provider: "legna-code", model: "claude-opus-4-1", inputUsdPerToken: 15e-6, outputUsdPerToken: 75e-6, cacheReadUsdPerToken: 1.5e-6, cacheWriteUsdPerToken: 18.75e-6 },
    { provider: "legna-code", model: "claude-opus-4-5", inputUsdPerToken: 5e-6, outputUsdPerToken: 25e-6, cacheReadUsdPerToken: 0.5e-6, cacheWriteUsdPerToken: 6.25e-6 },
    { provider: "legna-code", model: "claude-sonnet-4-5", inputUsdPerToken: 3e-6, outputUsdPerToken: 15e-6, cacheReadUsdPerToken: 0.3e-6, cacheWriteUsdPerToken: 3.75e-6 },
    { provider: "codex", model: "gpt-5.3-codex", inputUsdPerToken: 1.75e-6, outputUsdPerToken: 14e-6, cacheReadUsdPerToken: 0.175e-6 },
    { provider: "codex", model: "gpt-5-codex", inputUsdPerToken: 1.25e-6, outputUsdPerToken: 10e-6, cacheReadUsdPerToken: 0.125e-6 },
    { provider: "codex", model: "o4-mini", inputUsdPerToken: 1.1e-6, outputUsdPerToken: 4.4e-6, cacheReadUsdPerToken: 0.275e-6 },
    { provider: "gemini", model: "gemini-2.5-pro", inputUsdPerToken: 1.25e-6, outputUsdPerToken: 10e-6, cacheReadUsdPerToken: 0.3125e-6 },
    { provider: "gemini", model: "gemini-2.5-flash", inputUsdPerToken: 0.3e-6, outputUsdPerToken: 2.5e-6, cacheReadUsdPerToken: 0.075e-6 },
    { provider: "gemini", model: "gemini-2.0-flash", inputUsdPerToken: 0.1e-6, outputUsdPerToken: 0.4e-6, cacheReadUsdPerToken: 0.025e-6 },
    { provider: "deepseek-harness", model: "deepseek-chat", inputUsdPerToken: 0.27e-6, outputUsdPerToken: 1.1e-6, cacheReadUsdPerToken: 0.07e-6, cacheWriteUsdPerToken: 0.27e-6 },
    { provider: "deepseek-harness", model: "deepseek-reasoner", inputUsdPerToken: 0.55e-6, outputUsdPerToken: 2.19e-6, cacheReadUsdPerToken: 0.14e-6, cacheWriteUsdPerToken: 0.55e-6 },
    { provider: "deepseek-harness", model: "deepseek-v4-flash", inputUsdPerToken: 0.27e-6, outputUsdPerToken: 1.1e-6, cacheReadUsdPerToken: 0.07e-6, cacheWriteUsdPerToken: 0.27e-6 },
    { provider: "deepseek-harness", model: "deepseek-v4-pro", inputUsdPerToken: 0.55e-6, outputUsdPerToken: 2.19e-6, cacheReadUsdPerToken: 0.14e-6, cacheWriteUsdPerToken: 0.55e-6 }
  ]
};

/**
 * 只要选中模型能命中当前 Provider 的本地价格表，就为新会话推断直连收费策略。
 * 未命中模型时仍返回空值，避免用相近模型或未知代理路线估价。
 */
export function inferProviderSessionBillingProfile(
  provider: ProviderId | string,
  selectedModel: string | null | undefined,
  priceBook: ProviderPriceBook = DEFAULT_PROVIDER_PRICE_BOOK
): string | null {
  const normalizedModel = selectedModel?.trim() ?? "";

  return normalizedModel
    && priceBook.entries.some(
      (entry) => entry.provider === provider && getPriceBookModelCandidates(normalizedModel).has(entry.model)
    )
    ? "direct-api"
    : null;
}

export interface VerifiedUsageLine {
  key: string;
  turnKey?: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputIncludesCacheRead?: boolean;
  completed: boolean;
  timestamp: string;
}

export function addProviderNativeCostMetric(
  metrics: ProviderSessionStats["metrics"],
  value: number,
  watermark: ProviderSessionStatValue["watermark"]
): void {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  metrics.costUsd = {
    value,
    source: "provider-session-store",
    semantic: "cumulative",
    watermark,
    pricing: {
      kind: "provider-native",
      coverage: "complete",
      priceBookVersion: DEFAULT_PROVIDER_PRICE_BOOK_VERSION,
      priceBook: buildPriceBookSnapshot(DEFAULT_PROVIDER_PRICE_BOOK),
      priceBookSource: DEFAULT_PROVIDER_PRICE_BOOK.source ?? "builtin",
      ...(DEFAULT_PROVIDER_PRICE_BOOK.fetchedAt
        ? { priceBookFetchedAt: DEFAULT_PROVIDER_PRICE_BOOK.fetchedAt }
        : {}),
      exchangeRate: DEFAULT_PROVIDER_COST_EXCHANGE_RATE
    }
  };
}

export function addCatalogCostMetric(
  metrics: ProviderSessionStats["metrics"],
  lines: readonly VerifiedUsageLine[],
  options: ProviderSessionStatsReadOptions | undefined,
  watermark: ProviderSessionStatValue["watermark"],
  priceBook: ProviderPriceBook = DEFAULT_PROVIDER_PRICE_BOOK
): void {
  const billing = options?.billing;
  const effectivePriceBook = billing?.priceBook
    ? toProviderPriceBook(billing.priceBook)
    : priceBook;

  if (!billing || !isDirectPricingProfile(billing.pricingProfileId)) {
    return;
  }

  if (effectivePriceBook.version !== billing.priceBookVersion || lines.length === 0) {
    return;
  }

  let total = 0;

  for (const line of lines) {
    if (!line.completed || !line.model.trim() || line.timestamp < billing.billingStartedAt) {
      return;
    }

    const entry = findPriceBookEntry(effectivePriceBook, line.provider, line.model);

    if (!entry) {
      return;
    }

    const cost = calculateUsageLineCost(line, entry);

    if (cost === null) {
      return;
    }

    total += cost;
  }

  if (!Number.isFinite(total) || total < 0) {
    return;
  }

  metrics.costUsd = {
    value: total,
    source: "derived-provider-metrics",
    semantic: "priced-final-events",
    watermark,
    pricing: {
      kind: "catalog-estimate",
      coverage: "complete",
      pricingProfileId: billing.pricingProfileId,
      priceBookVersion: billing.priceBookVersion,
      breakdown: buildCostBreakdown(lines, effectivePriceBook),
      priceBook: buildPriceBookSnapshot(effectivePriceBook),
      priceBookSource: effectivePriceBook.source ?? "builtin",
      ...(effectivePriceBook.fetchedAt
        ? { priceBookFetchedAt: effectivePriceBook.fetchedAt }
        : {}),
      exchangeRate: DEFAULT_PROVIDER_COST_EXCHANGE_RATE
    }
  };
}

function buildCostBreakdown(
  lines: readonly VerifiedUsageLine[],
  priceBook: ProviderPriceBook
): ProviderSessionCostBreakdown[] {
  const breakdownByKey = new Map<string, ProviderSessionCostBreakdown>();

  for (const line of lines) {
    const entry = findPriceBookEntry(priceBook, line.provider, line.model);
    const cost = entry ? calculateUsageLineCost(line, entry) : null;

    if (!entry || cost === null) {
      continue;
    }

    const inputTokens = nonNegativeInteger(line.inputTokens);
    const outputTokens = nonNegativeInteger(line.outputTokens);
    const reasoningTokens = nonNegativeInteger(line.reasoningTokens ?? 0);
    const cacheReadTokens = nonNegativeInteger(line.cacheReadTokens ?? 0);
    const cacheWriteTokens = nonNegativeInteger(line.cacheWriteTokens ?? 0);

    if (
      inputTokens === null
      || outputTokens === null
      || reasoningTokens === null
      || cacheReadTokens === null
      || cacheWriteTokens === null
    ) {
      continue;
    }

    const model = line.model.trim();
    const key = `${line.provider}\u0000${model}`;
    const current = breakdownByKey.get(key);

    if (current) {
      current.inputTokens += inputTokens;
      current.outputTokens += outputTokens;
      current.reasoningTokens += reasoningTokens;
      current.cacheReadTokens += cacheReadTokens;
      current.cacheWriteTokens += cacheWriteTokens;
      current.costUsd += cost;
      continue;
    }

    breakdownByKey.set(key, {
      provider: line.provider,
      model,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd: cost
    });
  }

  return [...breakdownByKey.values()];
}

function toCostPrice(entry: ProviderPriceBookEntry): ProviderSessionCostPrice {
  return {
    provider: entry.provider,
    model: entry.model,
    inputUsdPerToken: entry.inputUsdPerToken,
    outputUsdPerToken: entry.outputUsdPerToken,
    ...(entry.cacheReadUsdPerToken === undefined
      ? {}
      : { cacheReadUsdPerToken: entry.cacheReadUsdPerToken }),
    ...(entry.cacheWriteUsdPerToken === undefined
      ? {}
      : { cacheWriteUsdPerToken: entry.cacheWriteUsdPerToken })
  };
}

function buildPriceBookSnapshot(priceBook: ProviderPriceBook): ProviderSessionCostPrice[] {
  return priceBook.entries.map(toCostPrice);
}

function toProviderPriceBook(priceBook: ProviderSessionPriceBook): ProviderPriceBook {
  return {
    version: priceBook.version,
    entries: priceBook.entries,
    source: priceBook.source,
    fetchedAt: priceBook.fetchedAt
  };
}

export function calculateUsageLineCost(
  line: VerifiedUsageLine,
  entry: ProviderPriceBookEntry
): number | null {
  const input = nonNegativeInteger(line.inputTokens);
  const output = nonNegativeInteger(line.outputTokens);
  const reasoning = nonNegativeInteger(line.reasoningTokens ?? 0);
  const cacheRead = nonNegativeInteger(line.cacheReadTokens ?? 0);
  const cacheWrite = nonNegativeInteger(line.cacheWriteTokens ?? 0);

  if (input === null || output === null || reasoning === null || cacheRead === null || cacheWrite === null) {
    return null;
  }

  if (cacheRead > 0 && entry.cacheReadUsdPerToken === undefined) {
    return null;
  }

  if (cacheWrite > 0 && entry.cacheWriteUsdPerToken === undefined) {
    return null;
  }

  const inputCost = line.inputIncludesCacheRead
    ? Math.max(0, input - cacheRead) * entry.inputUsdPerToken
      + cacheRead * (entry.cacheReadUsdPerToken ?? entry.inputUsdPerToken)
    : input * entry.inputUsdPerToken
      + cacheRead * (entry.cacheReadUsdPerToken ?? entry.inputUsdPerToken);
  const outputCost = (output + reasoning) * entry.outputUsdPerToken;
  const cacheWriteCost = cacheWrite * (entry.cacheWriteUsdPerToken ?? entry.inputUsdPerToken);
  const total = inputCost + outputCost + cacheWriteCost;

  return Number.isFinite(total) && total >= 0 ? total : null;
}

export function filterUsageLinesByBillingStart(
  lines: readonly VerifiedUsageLine[],
  billing: ProviderSessionBillingContext | undefined
): VerifiedUsageLine[] {
  if (!billing) {
    return [];
  }

  return lines.filter((line) => line.timestamp >= billing.billingStartedAt);
}

function findPriceBookEntry(
  priceBook: ProviderPriceBook,
  provider: ProviderId,
  model: string
): ProviderPriceBookEntry | null {
  const modelCandidates = getPriceBookModelCandidates(model);
  return priceBook.entries.find(
    (entry) => entry.provider === provider && modelCandidates.has(entry.model)
  ) ?? null;
}

function getPriceBookModelCandidates(model: string): Set<string> {
  const normalizedModel = model.trim();

  return new Set([
    normalizedModel,
    normalizedModel.split(":").at(-1) ?? normalizedModel,
    normalizedModel.split("/").at(-1) ?? normalizedModel
  ]);
}

function isDirectPricingProfile(value: string): boolean {
  return /^(direct|api|catalog)(?:[-_:]|$)/i.test(value.trim());
}

function nonNegativeInteger(value: number): number | null {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0 ? value : null;
}
