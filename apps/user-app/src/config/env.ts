import { clientConfigStore } from "./client-config-store";

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/, "");
}

function canUseWindowOrigin(): boolean {
  return typeof window !== "undefined" && Boolean(window.location.origin);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function getDevWebSocketBaseUrl(baseUrl: string): string {
  if (!import.meta.env.DEV || !canUseWindowOrigin()) {
    return baseUrl;
  }

  try {
    const targetUrl = new URL(baseUrl);
    const windowUrl = new URL(window.location.origin);

    if (
      targetUrl.origin !== windowUrl.origin &&
      isLoopbackHostname(targetUrl.hostname) &&
      isLoopbackHostname(windowUrl.hostname)
    ) {
      return windowUrl.origin;
    }
  } catch {
    return baseUrl;
  }

  return baseUrl;
}

export function getHostBaseUrl(): string {
  return clientConfigStore.getState().hostBaseUrl;
}

export function getHostRequestUrl(path: string, baseUrl = getHostBaseUrl()): string {
  return new URL(trimLeadingSlash(path), ensureTrailingSlash(baseUrl)).toString();
}

export function getHostWebSocketUrl(path: string, baseUrl = getHostBaseUrl()): string {
  const url = new URL(getHostRequestUrl(path, getDevWebSocketBaseUrl(baseUrl)));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
