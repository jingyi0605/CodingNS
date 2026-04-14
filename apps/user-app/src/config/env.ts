import { clientConfigStore } from "./client-config-store";
import { getActiveHostBaseUrl } from "./client-config-types";
import { resolveDefaultHostBaseUrl } from "./client-config-service";

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/, "");
}

export function getHostBaseUrl(): string {
  const config = clientConfigStore.getState();
  return getActiveHostBaseUrl(config) ?? resolveDefaultHostBaseUrl(config.platform);
}

export function getHostRequestUrl(path: string, baseUrl = getHostBaseUrl()): string {
  return new URL(trimLeadingSlash(path), ensureTrailingSlash(baseUrl)).toString();
}

export function getHostWebSocketUrl(path: string, baseUrl = getHostBaseUrl()): string {
  const url = new URL(getHostRequestUrl(path, baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
