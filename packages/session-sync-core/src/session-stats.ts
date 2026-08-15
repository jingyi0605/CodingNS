import type {
  ProviderSessionStatMetric,
  ProviderSessionStatValue,
  ProviderSessionStats
} from "./types.js";

type CacheHitRateBucket = Extract<
  ProviderSessionStatMetric,
  "inputTokens" | "uncachedInputTokens" | "cacheReadTokens" | "cacheWriteTokens"
>;

interface DerivedCacheHitRateOptions {
  /** 分母由已核验、且互不重叠的原生 token 桶组成。 */
  denominator: readonly CacheHitRateBucket[];
  /** 原生协议没有定义该桶与分母的关系时，出现正值就不显示比例。 */
  rejectIfPositive?: readonly CacheHitRateBucket[];
}

/**
 * 只从同一 Provider 的已核验原生 token 桶计算缓存命中率。
 *
 * 不同 CLI 对 input 的定义不同：有的 input 已包含 cache read，有的把三个桶拆开。
 * 因此调用方必须显式给出分母，前端不得自行推测。
 */
export function addDerivedCacheHitRate(
  metrics: ProviderSessionStats["metrics"],
  options: DerivedCacheHitRateOptions
): void {
  const cacheRead = metrics.cacheReadTokens;

  if (!isUsableStatValue(cacheRead)) {
    return;
  }

  const denominatorValues: ProviderSessionStatValue[] = [];

  for (const metric of options.denominator) {
    const value = metrics[metric];

    if (!isUsableStatValue(value)) {
      return;
    }

    denominatorValues.push(value);
  }

  for (const metric of options.rejectIfPositive ?? []) {
    const value = metrics[metric];

    if (isUsableStatValue(value) && value.value > 0) {
      return;
    }
  }

  if (!hasSameNativeLineage(cacheRead, denominatorValues)) {
    return;
  }

  const denominator = denominatorValues.reduce((total, value) => total + value.value, 0);

  // 缓存读取不能超过已确认的总输入；来源自相矛盾时宁可隐藏，也不能截断成 100%。
  if (denominator <= 0 || cacheRead.value > denominator) {
    return;
  }

  metrics.cacheHitRate = {
    value: cacheRead.value / denominator * 100,
    source: "derived-provider-metrics",
    semantic: "derived-ratio",
    watermark: cacheRead.watermark
  };
}

function isUsableStatValue(value: ProviderSessionStatValue | undefined): value is ProviderSessionStatValue {
  if (!value) {
    return false;
  }

  return Number.isFinite(value.value) && value.value >= 0;
}

function hasSameNativeLineage(
  cacheRead: ProviderSessionStatValue,
  denominatorValues: readonly ProviderSessionStatValue[]
): boolean {
  return denominatorValues.every(
    (value) => value.source === cacheRead.source && value.semantic === cacheRead.semantic
  );
}
