import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/network/api-error";
import {
  cancelAssistantAutomation,
  listAssistantAutomations,
  resetAssistantCapabilityCompatibilityCacheForTesting
} from "./butler-api";
import { httpClient } from "../../../network/http-client";

vi.mock("../../../network/http-client", () => ({
  httpClient: {
    request: vi.fn()
  }
}));

describe("butler assistant api", () => {
  beforeEach(() => {
    vi.mocked(httpClient.request).mockReset();
    vi.mocked(httpClient.request).mockResolvedValue({} as never);
    resetAssistantCapabilityCompatibilityCacheForTesting();
  });

  it("助手能力读取请求会带上 Butler 页面来源头", async () => {
    await listAssistantAutomations({
      status: "active",
      controlSessionId: "control-1"
    });

    const [, options] = vi.mocked(httpClient.request).mock.calls[0] ?? [];
    const headers = new Headers(options?.headers);

    expect(vi.mocked(httpClient.request)).toHaveBeenCalledWith(
      "/api/assistant/automations?status=active&controlSessionId=control-1",
      expect.any(Object)
    );
    expect(headers.get("X-CodingNS-Assistant-Source")).toBe("butler-ui");
  });

  it("助手能力写请求会保留原方法和 body，并带上来源头", async () => {
    await cancelAssistantAutomation("automation-1");

    const [, options] = vi.mocked(httpClient.request).mock.calls[0] ?? [];
    const headers = new Headers(options?.headers);

    expect(vi.mocked(httpClient.request)).toHaveBeenCalledWith(
      "/api/assistant/automations/automation-1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({})
      })
    );
    expect(headers.get("X-CodingNS-Assistant-Source")).toBe("butler-ui");
  });

  it("旧 Host 缺少助手能力路由时，读取接口会自动降级为空结果", async () => {
    vi.mocked(httpClient.request).mockRejectedValueOnce(new ApiError(404, {
      detail: "Not Found",
      error_code: "HTTP_ERROR"
    }));

    await expect(listAssistantAutomations()).resolves.toEqual({
      payload: {
        items: []
      }
    });
    expect(vi.mocked(httpClient.request)).toHaveBeenCalledTimes(1);
  });

  it("旧 Host 缺少助手能力路由时，写接口会抛出明确升级提示", async () => {
    vi.mocked(httpClient.request).mockRejectedValueOnce(new ApiError(404, {
      detail: "Not Found",
      error_code: "HTTP_ERROR"
    }));

    await expect(cancelAssistantAutomation("automation-1")).rejects.toThrow("当前 Host 版本不支持新版助手接口，请先升级 Host。");
  });
});
