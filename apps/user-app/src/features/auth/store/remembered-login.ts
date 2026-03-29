import type { PlatformAdapter } from "../../../platform/platform-adapter";
import { normalizeServerBaseUrl } from "../../../config/server-config-shared";

const STORAGE_KEY = "codingns.auth.remembered-login";

export interface RememberedLoginCredentials {
  username: string;
  password: string;
  serverBaseUrl: string;
}

interface StoredRememberedLogin extends RememberedLoginCredentials {}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function supportsRememberPassword(platform: PlatformAdapter): boolean {
  if (platform.isNativeMobile) {
    return true;
  }

  if (!platform.isDesktop) {
    return false;
  }

  return platform.ui.osFamily === "windows" || platform.ui.osFamily === "macos";
}

export function readRememberedLoginCredentials(): RememberedLoginCredentials | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredRememberedLogin>;

    if (
      typeof parsed.username !== "string" ||
      typeof parsed.password !== "string" ||
      typeof parsed.serverBaseUrl !== "string"
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const username = parsed.username.trim();
    const password = parsed.password;
    const serverBaseUrl = normalizeServerBaseUrl(parsed.serverBaseUrl);

    if (!username || !password) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return {
      username,
      password,
      serverBaseUrl
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function persistRememberedLoginCredentials(
  credentials: RememberedLoginCredentials
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const payload: StoredRememberedLogin = {
    username: credentials.username.trim(),
    password: credentials.password,
    serverBaseUrl: normalizeServerBaseUrl(credentials.serverBaseUrl)
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function syncRememberedLoginServerBaseUrl(serverBaseUrl: string): void {
  const current = readRememberedLoginCredentials();

  if (!current) {
    return;
  }

  persistRememberedLoginCredentials({
    ...current,
    serverBaseUrl
  });
}

export function clearRememberedLoginCredentials(): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
