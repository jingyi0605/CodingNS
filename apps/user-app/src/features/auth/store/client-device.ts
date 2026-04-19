import { resolveRuntimePlatform } from "../../../platform/platform-adapter";

const CLIENT_INSTANCE_STORAGE_KEY = "codingns.auth.client-instance-id";
export const CLIENT_TYPE_HEADER = "x-codingns-client-type";
export const CLIENT_INSTANCE_ID_HEADER = "x-codingns-client-instance-id";

let inMemoryClientInstanceId: string | null = null;

export function getAuthClientHeaders(): Record<string, string> {
  return {
    [CLIENT_TYPE_HEADER]: resolveAuthClientType(),
    [CLIENT_INSTANCE_ID_HEADER]: resolveClientInstanceId()
  };
}

function resolveAuthClientType(): "desktop" | "web" | "ios" | "android" {
  const platform = resolveRuntimePlatform();

  switch (platform) {
    case "desktop":
    case "ios":
    case "android":
      return platform;
    default:
      return "web";
  }
}

function resolveClientInstanceId(): string {
  if (inMemoryClientInstanceId) {
    return inMemoryClientInstanceId;
  }

  if (!canUseLocalStorage()) {
    inMemoryClientInstanceId = createClientInstanceId();
    return inMemoryClientInstanceId;
  }

  const existing = window.localStorage.getItem(CLIENT_INSTANCE_STORAGE_KEY)?.trim();

  if (existing) {
    inMemoryClientInstanceId = existing;
    return inMemoryClientInstanceId;
  }

  const nextClientInstanceId = createClientInstanceId();
  window.localStorage.setItem(CLIENT_INSTANCE_STORAGE_KEY, nextClientInstanceId);
  inMemoryClientInstanceId = nextClientInstanceId;
  return inMemoryClientInstanceId;
}

function createClientInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}
