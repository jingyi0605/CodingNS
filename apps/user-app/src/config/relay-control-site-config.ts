import { normalizeServerBaseUrl } from "./server-config-shared";

const FIXED_RELAY_CONTROL_BASE_URL = normalizeServerBaseUrl("https://channel.codingns.com:1443");

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
