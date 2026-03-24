import { serverConfigStore } from "./server-config";

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/, "");
}

export function getHostBaseUrl(): string {
  return serverConfigStore.getState().baseUrl;
}

export function getHostRequestUrl(path: string, baseUrl = getHostBaseUrl()): string {
  return new URL(trimLeadingSlash(path), ensureTrailingSlash(baseUrl)).toString();
}

export function getHostWebSocketUrl(path: string, baseUrl = getHostBaseUrl()): string {
  const url = new URL(getHostRequestUrl(path, baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
