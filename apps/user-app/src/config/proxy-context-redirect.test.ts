import { describe, expect, it } from "vitest";

import { isLikelyDocumentNavigation, rewriteToProxyContext } from "./proxy-context-redirect";

describe("codingns proxy context redirect", () => {
  it("页面导航仅有 Cookie 时不应重写到代理路径", () => {
    const rewritten = rewriteToProxyContext({
      rawPath: "/",
      refererHeader: undefined,
      cookieHeader: "foo=1; cns_proxy_slug=ilbq8e; bar=2",
      allowCookieFallback: false
    });

    expect(rewritten).toBeNull();
  });

  it("页面导航有代理 Referer 时应重写到对应代理路径", () => {
    const rewritten = rewriteToProxyContext({
      rawPath: "/workspaces",
      refererHeader: "http://localhost:4174/proxy/ilbq8e/",
      cookieHeader: undefined,
      allowCookieFallback: false
    });

    expect(rewritten).toBe("/proxy/ilbq8e/workspaces");
  });

  it("Referer 不在代理上下文时，不能使用 Cookie 回退", () => {
    const rewritten = rewriteToProxyContext({
      rawPath: "/src/main.tsx",
      refererHeader: "http://localhost:4174/",
      cookieHeader: "cns_proxy_slug=ilbq8e",
      allowCookieFallback: true
    });

    expect(rewritten).toBeNull();
  });

  it("非页面请求在 Referer 缺失时允许回退 Cookie 以维持代理上下文", () => {
    const rewritten = rewriteToProxyContext({
      rawPath: "/@vite/client",
      refererHeader: undefined,
      cookieHeader: "cns_proxy_slug=ilbq8e",
      allowCookieFallback: true
    });

    expect(rewritten).toBe("/proxy/ilbq8e/@vite/client");
  });

  it("能识别无 sec-fetch-dest 但 Accept 为 html 的页面导航", () => {
    const isDocument = isLikelyDocumentNavigation({
      method: "GET",
      fetchDestinationHeader: undefined,
      acceptHeader: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });

    expect(isDocument).toBe(true);
  });
});
