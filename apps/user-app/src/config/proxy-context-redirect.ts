export const PROXY_SLUG_COOKIE_NAME = "cns_proxy_slug";
const PROXY_CONTEXT_BYPASS_PREFIXES = ["/api", "/ws", "/preview"];

export function pickHeaderValue(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

export function extractProxySlugFromReferer(referer: string | undefined): string | null {
  if (!referer) {
    return null;
  }

  try {
    const parsed = new URL(referer);
    const match = parsed.pathname.match(/^\/proxy\/([a-z0-9]+)(?:\/|$)/i);

    if (!match) {
      return null;
    }

    return match[1].toLowerCase();
  } catch {
    return null;
  }
}

export function extractProxySlugFromPath(pathname: string | undefined): string | null {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(/^\/proxy\/([a-z0-9]+)(?:\/|$)/i);

  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

export function extractProxySlugFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookiePairs = cookieHeader.split(";").map((item) => item.trim());
  const targetPrefix = `${PROXY_SLUG_COOKIE_NAME}=`;

  for (const pair of cookiePairs) {
    if (!pair.startsWith(targetPrefix)) {
      continue;
    }

    const value = pair.slice(targetPrefix.length).trim().toLowerCase();

    if (/^[a-z0-9]+$/.test(value)) {
      return value;
    }
  }

  return null;
}

export function rewriteToProxyContext(input: {
  rawPath: string | undefined;
  refererHeader: string | string[] | undefined;
  cookieHeader: string | string[] | undefined;
  allowCookieFallback: boolean;
}): string | null {
  const requestPath = input.rawPath ?? "/";

  if (
    !requestPath.startsWith("/")
    || requestPath.startsWith("/proxy/")
    || shouldBypassProxyContextRewrite(requestPath)
  ) {
    return null;
  }

  const refererValue = pickHeaderValue(input.refererHeader);
  const proxySlugFromReferer = extractProxySlugFromReferer(refererValue);

  if (proxySlugFromReferer) {
    return `/proxy/${proxySlugFromReferer}${requestPath}`;
  }

  // Referer 明确存在但不在代理上下文时，不允许再退回 Cookie，避免把主站资源错误改写到 /proxy/*。
  if (refererValue) {
    return null;
  }

  if (!input.allowCookieFallback) {
    return null;
  }

  const proxySlugFromCookie = extractProxySlugFromCookie(pickHeaderValue(input.cookieHeader));

  if (!proxySlugFromCookie) {
    return null;
  }

  return `/proxy/${proxySlugFromCookie}${requestPath}`;
}

function shouldBypassProxyContextRewrite(requestPath: string): boolean {
  return PROXY_CONTEXT_BYPASS_PREFIXES.some((prefix) =>
    requestPath === prefix || requestPath.startsWith(`${prefix}/`) || requestPath.startsWith(`${prefix}?`)
  );
}

export function isLikelyDocumentNavigation(input: {
  method: string | undefined;
  fetchDestinationHeader: string | string[] | undefined;
  acceptHeader: string | string[] | undefined;
}): boolean {
  const method = (input.method ?? "GET").toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  const fetchDestination = pickHeaderValue(input.fetchDestinationHeader);

  if (fetchDestination === "document") {
    return true;
  }

  // 某些客户端不会携带 sec-fetch-dest，回退到 Accept 判断是否是页面导航。
  if (!fetchDestination) {
    const acceptHeader = (pickHeaderValue(input.acceptHeader) ?? "").toLowerCase();
    return acceptHeader.includes("text/html");
  }

  return false;
}
