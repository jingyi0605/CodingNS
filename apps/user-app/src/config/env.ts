function getDefaultHostBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin.length > 0) {
    return window.location.origin;
  }

  return "http://127.0.0.1:3002";
}

export function getHostBaseUrl(): string {
  const envUrl = import.meta.env.VITE_HOST_BASE_URL;
  return typeof envUrl === "string" && envUrl.length > 0 ? envUrl : getDefaultHostBaseUrl();
}

export function getHostWebSocketUrl(path: string): string {
  const baseUrl = new URL(getHostBaseUrl());
  const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";

  return new URL(path, `${protocol}//${baseUrl.host}`).toString();
}
