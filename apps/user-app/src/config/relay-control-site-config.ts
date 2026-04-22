import { normalizeServerBaseUrl } from "./server-config-shared";

const FIXED_RELAY_CONTROL_BASE_URL = normalizeServerBaseUrl("https://channel.codingns.com:1443");

export interface InferredRelayAccessConfig {
  tunnelDomain: string;
  controlBaseUrl: string;
  relayBaseUrl: string;
}

export function getFixedRelayControlBaseUrl(): string {
  return FIXED_RELAY_CONTROL_BASE_URL;
}

export function canConfigureRelayControlBaseUrl(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

export function safelyNormalizeRelayControlBaseUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    return normalizeServerBaseUrl(value);
  } catch {
    return null;
  }
}

export function resolveRelayControlBaseUrl(value: string | null | undefined): string {
  if (!canConfigureRelayControlBaseUrl()) {
    return FIXED_RELAY_CONTROL_BASE_URL;
  }

  return safelyNormalizeRelayControlBaseUrl(value) ?? FIXED_RELAY_CONTROL_BASE_URL;
}

export function inferRelayAccessConfig(baseUrl: string): InferredRelayAccessConfig | null {
  try {
    const normalizedRelayBaseUrl = normalizeServerBaseUrl(baseUrl);
    const relayUrl = new URL(normalizedRelayBaseUrl);
    const hostname = relayUrl.hostname.trim().toLowerCase();
    const hostnameParts = hostname.split(".");

    // CodingNS Connect 入口统一是 <host-label>.channel.<domain> 这种结构，
    // 控制站就是去掉最左侧 host-label 后剩下的 hostname，并保留协议和端口。
    if (hostnameParts.length < 4 || hostnameParts[1] !== "channel") {
      return null;
    }

    const controlUrl = new URL(normalizedRelayBaseUrl);
    controlUrl.hostname = hostnameParts.slice(1).join(".");
    controlUrl.pathname = "";
    controlUrl.search = "";
    controlUrl.hash = "";

    return {
      tunnelDomain: hostname,
      controlBaseUrl: normalizeServerBaseUrl(controlUrl.toString()),
      relayBaseUrl: normalizedRelayBaseUrl
    };
  } catch {
    return null;
  }
}
