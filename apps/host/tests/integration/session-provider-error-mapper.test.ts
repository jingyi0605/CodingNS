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
});
