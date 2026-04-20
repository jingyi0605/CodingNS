import { describe, expect, it } from "vitest";

import { normalizeProviderUsageLimit } from "../../src/modules/sessions/session-provider-usage-limit.js";

describe("normalizeProviderUsageLimit", () => {
  it("会解析 Codex 的复合冷却时长", () => {
    const normalized = normalizeProviderUsageLimit({
      providerId: "codex",
      referenceAt: "2026-04-20T10:00:00.000Z",
      text:
        "You have reached your monthly usage limit. Please try again in 4 days 6 hours 37 minutes."
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        category: "usage_limit",
        retryAfterSeconds: 369420
      })
    );
    expect(normalized?.retryAt).toBe("2026-04-24T16:37:00.000Z");
  });

  it("会识别 Codex 的绝对日期时间格式", () => {
    const normalized = normalizeProviderUsageLimit({
      providerId: "codex",
      referenceAt: "2026-02-20T10:00:00.000Z",
      text:
        "Usage limit reached. Please try again at Feb 23rd, 2026 9:01 PM."
    });

    expect(normalized?.category).toBe("usage_limit");
    expect(normalized?.retryAt).toEqual(expect.any(String));
  });

  it("会解析 Claude Code 带时区的 reset at 时间", () => {
    const normalized = normalizeProviderUsageLimit({
      providerId: "claude-code",
      referenceAt: "2026-04-20T10:00:00.000Z",
      text:
        "Claude usage limit reached. Your limit will reset at 2pm (America/New_York)."
    });

    expect(normalized?.retryAt).toBe("2026-04-20T18:00:00.000Z");
    expect(normalized?.retryAfterSeconds).toBe(28800);
  });

  it("会把 Claude 的泛化 rate limit 错误归类，但不乱猜时间", () => {
    const normalized = normalizeProviderUsageLimit({
      providerId: "claude-code",
      referenceAt: "2026-04-20T10:00:00.000Z",
      text:
        "Anthropic API Error (429): {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"This request would exceed your organization monthly usage limit.\"}}"
    });

    expect(normalized?.category).toBe("usage_limit");
    expect(normalized?.retryAt).toBeNull();
    expect(normalized?.retryAfterSeconds).toBeNull();
  });

  it("会把 Gemini 的每日配额识别成太平洋时区次日零点", () => {
    const normalized = normalizeProviderUsageLimit({
      providerId: "gemini",
      referenceAt: "2026-04-20T10:00:00.000Z",
      text:
        "Error [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent: [429 Too Many Requests] Resource has been exhausted (e.g. check quota). {\"error\":{\"code\":429,\"status\":\"RESOURCE_EXHAUSTED\",\"details\":[{\"@type\":\"type.googleapis.com/google.rpc.QuotaFailure\",\"violations\":[{\"quotaMetric\":\"generativelanguage.googleapis.com/generate_content_free_tier_requests\",\"quotaId\":\"GenerateRequestsPerDayPerProjectPerModel-FreeTier\"}]},{\"@type\":\"type.googleapis.com/google.rpc.RetryInfo\",\"retryDelay\":\"34s\"}]}}"
    });

    expect(normalized?.retryAt).toBe("2026-04-21T07:00:00.000Z");
    expect(normalized?.retryAfterSeconds).toBe(75600);
  });

  it("会解析 Gemini 的短周期 retryDelay", () => {
    const normalized = normalizeProviderUsageLimit({
      providerId: "gemini",
      referenceAt: "2026-04-20T10:00:00.000Z",
      text:
        "Error [GoogleGenerativeAI Error]: [429 Too Many Requests] Resource exhausted. {\"error\":{\"status\":\"RESOURCE_EXHAUSTED\",\"details\":[{\"@type\":\"type.googleapis.com/google.rpc.RetryInfo\",\"retryDelay\":\"55s\"}]}}"
    });

    expect(normalized?.retryAfterSeconds).toBe(55);
    expect(normalized?.retryAt).toBe("2026-04-20T10:00:55.000Z");
  });
});
