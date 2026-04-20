import { describe, expect, it } from "vitest";

import { mapSessionProviderError } from "../../src/modules/sessions/session-provider-error-mapper.js";

describe("mapSessionProviderError", () => {
  it("会把 ACTIVE_RUN_EXISTS 映射成明确的并发错误", () => {
    const mapped = mapSessionProviderError(new Error("ACTIVE_RUN_EXISTS"));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.errorCode).toBe("ACTIVE_RUN_EXISTS");
    expect(mapped.message).toContain("运行中");
  });

  it("会把 IN_RUN_INPUT_NOT_SUPPORTED 映射成明确的能力错误", () => {
    const mapped = mapSessionProviderError(new Error("IN_RUN_INPUT_NOT_SUPPORTED"));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.errorCode).toBe("IN_RUN_INPUT_NOT_SUPPORTED");
    expect(mapped.message).toContain("运行中继续输入");
  });

  it("会把 SERVER_TIMEOUT 映射成稳定的超时错误", () => {
    const mapped = mapSessionProviderError(new Error("SERVER_TIMEOUT"));

    expect(mapped.statusCode).toBe(503);
    expect(mapped.errorCode).toBe("PROVIDER_RUNTIME_TIMEOUT");
    expect(mapped.message).toContain("请求超时");
  });

  it("会把 OpenCode 目录跑偏映射成明确的工作区冲突错误", () => {
    const mapped = mapSessionProviderError(new Error("OPENCODE_SESSION_DIRECTORY_MISMATCH"));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.errorCode).toBe("OPENCODE_SESSION_DIRECTORY_MISMATCH");
    expect(mapped.message).toContain("错误的工作区目录");
  });

  it("会把跨工作区绑定冲突映射成明确的会话保护错误", () => {
    const mapped = mapSessionProviderError(new Error("SESSION_BINDING_WORKSPACE_CONFLICT"));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.errorCode).toBe("SESSION_BINDING_WORKSPACE_CONFLICT");
    expect(mapped.message).toContain("其他工作区");
  });

  it("会把 Gemini 会话缺失映射成明确的发现错误", () => {
    const mapped = mapSessionProviderError(new Error("GEMINI_CHAT_NOT_FOUND"));

    expect(mapped.statusCode).toBe(404);
    expect(mapped.errorCode).toBe("GEMINI_CHAT_NOT_FOUND");
    expect(mapped.message).toContain("Gemini 本地 chats");
  });

  it("会把 Gemini schema 变化映射成结构化解析错误", () => {
    const mapped = mapSessionProviderError(
      new Error("GEMINI_CHAT_SCHEMA_INVALID: file=/tmp/.gemini/tmp/demo/chats/session.json detail=Unexpected token")
    );

    expect(mapped.statusCode).toBe(422);
    expect(mapped.errorCode).toBe("GEMINI_CHAT_SCHEMA_INVALID");
    expect(mapped.message).toContain("GEMINI_CHAT_SCHEMA_INVALID");
    expect(mapped.message).toContain("session.json");
  });

  it("会把 Kimi 双链路失败映射成明确的 fallback 错误", () => {
    const mapped = mapSessionProviderError(
      new Error("KIMI_RUNTIME_FALLBACK_FAILED: wire=KIMI_WIRE_MODE_UNAVAILABLE: unknown; command=boom")
    );

    expect(mapped.statusCode).toBe(503);
    expect(mapped.errorCode).toBe("KIMI_RUNTIME_FALLBACK_FAILED");
    expect(mapped.message).toContain("fallback");
  });

  it("会把 Kimi wire 不可用映射成可观测降级提示", () => {
    const mapped = mapSessionProviderError(new Error("KIMI_WIRE_MODE_UNAVAILABLE: unknown error"));

    expect(mapped.statusCode).toBe(503);
    expect(mapped.errorCode).toBe("KIMI_WIRE_MODE_UNAVAILABLE");
    expect(mapped.message).toContain("wire");
  });

  it("会把 Codex 缺失 thread/read 历史映射成明确的 fork 错误", () => {
    const mapped = mapSessionProviderError(new Error("CODEX_THREAD_HISTORY_MISSING"));

    expect(mapped.statusCode).toBe(502);
    expect(mapped.errorCode).toBe("PROVIDER_IO_ERROR");
    expect(mapped.message).toContain("thread/read");
  });

  it("会把 Codex native message fork 脏子线程映射成明确的 provider 错误", () => {
    const mapped = mapSessionProviderError(new Error("CODEX_NATIVE_MESSAGE_FORK_DIRTY"));

    expect(mapped.statusCode).toBe(502);
    expect(mapped.errorCode).toBe("CODEX_NATIVE_MESSAGE_FORK_DIRTY");
    expect(mapped.message).toContain("所选消息点");
  });

  it("会把 Codex 额度限制归一化成稳定错误，并带上重试时间", () => {
    const mapped = mapSessionProviderError(
      new Error(
        "Error running remote compact task: You've hit your usage limit. Upgrade to Pro, purchase more credits or try again at 6:13 PM."
      )
    );

    expect(mapped.statusCode).toBe(429);
    expect(mapped.errorCode).toBe("PROVIDER_USAGE_LIMIT_EXCEEDED");
    expect(mapped.message).toContain("自动重试");
    expect(mapped.data?.providerUsageLimit).toEqual(
      expect.objectContaining({
        category: "usage_limit",
        retryAt: expect.any(String),
        source: "error"
      })
    );
  });

  it("会把 Claude 与 Gemini 的配额报错归一化成同一种结构", () => {
    const claudeMapped = mapSessionProviderError(
      new Error("Claude usage limit reached. Please try again at 11:45 AM.")
    );
    const geminiMapped = mapSessionProviderError(
      new Error("Gemini API quota exceeded. Retry after 15 minutes.")
    );

    expect(claudeMapped.errorCode).toBe("PROVIDER_USAGE_LIMIT_EXCEEDED");
    expect(claudeMapped.data?.providerUsageLimit).toEqual(
      expect.objectContaining({
        category: "usage_limit",
        retryAt: expect.any(String)
      })
    );

    expect(geminiMapped.errorCode).toBe("PROVIDER_USAGE_LIMIT_EXCEEDED");
    expect(geminiMapped.data?.providerUsageLimit).toEqual(
      expect.objectContaining({
        category: "usage_limit",
        retryAt: expect.any(String),
        retryAfterSeconds: 900
      })
    );
  });
});
