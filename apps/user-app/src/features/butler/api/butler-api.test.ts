import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssistantSandbox, listAssistantAutomations } from "./butler-api";
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
    await createAssistantSandbox({
      title: "临时沙箱",
      sourceKind: "blank"
    });

    const [, options] = vi.mocked(httpClient.request).mock.calls[0] ?? [];
    const headers = new Headers(options?.headers);

    expect(vi.mocked(httpClient.request)).toHaveBeenCalledWith(
      "/api/assistant/sandboxes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "临时沙箱",
          sourceKind: "blank"
        })
      })
    );
    expect(headers.get("X-CodingNS-Assistant-Source")).toBe("butler-ui");
  });
});
