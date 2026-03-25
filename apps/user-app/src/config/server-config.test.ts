import { describe, expect, it } from "vitest";

import { normalizeServerBaseUrl } from "./server-config";

describe("normalizeServerBaseUrl", () => {
  it("保留前端代理地址 4174，不强行改写到后端端口", () => {
    expect(normalizeServerBaseUrl("http://10.255.0.85:4174")).toBe(
      "http://10.255.0.85:4174"
    );
  });

  it("保留已经是 host 端口的地址", () => {
    expect(normalizeServerBaseUrl("http://10.255.0.85:3002")).toBe(
      "http://10.255.0.85:3002"
    );
  });
});
