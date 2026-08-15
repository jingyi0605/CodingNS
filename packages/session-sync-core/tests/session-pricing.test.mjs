import { describe, expect, it } from "vitest";

import {
  addCatalogCostMetric,
  calculateUsageLineCost,
  inferProviderSessionBillingProfile
} from "../dist/index.js";

describe("会话费用折叠", () => {
  it("选中模型命中价格表时按模型后缀推断收费策略", () => {
    expect(inferProviderSessionBillingProfile("deepseek-harness", "proxy-route:deepseek-v4-flash"))
      .toBe("direct-api");
    expect(inferProviderSessionBillingProfile("codex", "gateway/gpt-5.3-codex"))
      .toBe("direct-api");
    expect(inferProviderSessionBillingProfile("deepseek-harness", "proxy-route:unknown-model"))
      .toBeNull();
  });

  it("按互不重叠输入桶和输出桶计算目录估算", () => {
    const line = {
      key: "assistant-1",
      provider: "claude-code",
      model: "claude-sonnet-4-5",
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
      completed: true,
      timestamp: "2026-08-16T00:00:01.000Z"
    };
    const entry = {
      provider: "claude-code",
      model: "claude-sonnet-4-5",
      inputUsdPerToken: 1e-6,
      outputUsdPerToken: 2e-6,
      cacheReadUsdPerToken: 0.5e-6,
      cacheWriteUsdPerToken: 3e-6
    };

    expect(calculateUsageLineCost(line, entry)).toBeCloseTo(0.00145, 12);
  });

  it("完整覆盖时写入目录估算 provenance", () => {
    const metrics = {};

    addCatalogCostMetric(
      metrics,
      [{
        key: "assistant-1",
        provider: "codex",
        model: "gpt-5.3-codex",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        completed: true,
        timestamp: "2026-08-16T00:00:01.000Z"
      }],
      {
        billing: {
          billingStartedAt: "2026-08-16T00:00:00.000Z",
          pricingProfileId: "direct-api",
          priceBookVersion: "test"
        }
      },
      { kind: "source-timestamp", value: "2026-08-16T00:00:01.000Z" },
      {
        version: "test",
        entries: [{
          provider: "codex",
          model: "gpt-5.3-codex",
          inputUsdPerToken: 1e-6,
          outputUsdPerToken: 2e-6
        }]
      }
    );

    expect(metrics.costUsd).toMatchObject({
      value: 0.00014,
      source: "derived-provider-metrics",
      semantic: "priced-final-events",
      pricing: {
        kind: "catalog-estimate",
        coverage: "complete",
        pricingProfileId: "direct-api",
        priceBookVersion: "test"
      }
    });
  });

  it("缺少模型价格时隐藏整个会话费用", () => {
    const metrics = {};

    addCatalogCostMetric(
      metrics,
      [{
        key: "assistant-unknown",
        provider: "codex",
        model: "unknown-model",
        inputTokens: 100,
        outputTokens: 20,
        completed: true,
        timestamp: "2026-08-16T00:00:01.000Z"
      }],
      {
        billing: {
          billingStartedAt: "2026-08-16T00:00:00.000Z",
          pricingProfileId: "direct-api",
          priceBookVersion: "test"
        }
      },
      { kind: "source-timestamp", value: "2026-08-16T00:00:01.000Z" },
      { version: "test", entries: [] }
    );

    expect(metrics.costUsd).toBeUndefined();
  });

  it.each([
    ["订阅路由", "subscription-plan", "test"],
    ["价格表版本不一致", "direct-api", "other"]
  ])("%s 时隐藏目录费用", (_label, pricingProfileId, priceBookVersion) => {
    const metrics = {};

    addCatalogCostMetric(
      metrics,
      [{
        key: "assistant-1",
        provider: "codex",
        model: "gpt-5.3-codex",
        inputTokens: 100,
        outputTokens: 20,
        completed: true,
        timestamp: "2026-08-16T00:00:01.000Z"
      }],
      {
        billing: {
          billingStartedAt: "2026-08-16T00:00:00.000Z",
          pricingProfileId,
          priceBookVersion
        }
      },
      { kind: "source-timestamp", value: "2026-08-16T00:00:01.000Z" },
      {
        version: "test",
        entries: [{
          provider: "codex",
          model: "gpt-5.3-codex",
          inputUsdPerToken: 1e-6,
          outputUsdPerToken: 2e-6
        }]
      }
    );

    expect(metrics.costUsd).toBeUndefined();
  });

  it("任一最终 usage 桶缺失时隐藏整个目录费用", () => {
    const metrics = {};

    addCatalogCostMetric(
      metrics,
      [{
        key: "assistant-incomplete",
        provider: "codex",
        model: "gpt-5.3-codex",
        inputTokens: 100,
        outputTokens: 20,
        completed: false,
        timestamp: "2026-08-16T00:00:01.000Z"
      }],
      {
        billing: {
          billingStartedAt: "2026-08-16T00:00:00.000Z",
          pricingProfileId: "direct-api",
          priceBookVersion: "test"
        }
      },
      { kind: "source-timestamp", value: "2026-08-16T00:00:01.000Z" },
      {
        version: "test",
        entries: [{
          provider: "codex",
          model: "gpt-5.3-codex",
          inputUsdPerToken: 1e-6,
          outputUsdPerToken: 2e-6
        }]
      }
    );

    expect(metrics.costUsd).toBeUndefined();
  });
});
