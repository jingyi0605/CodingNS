import type { PlatformAdapter } from "../../../platform/platform-adapter";
import { normalizeServerBaseUrl } from "../../../config/server-config-shared";

const STORAGE_KEY = "codingns.auth.remembered-login";

export interface RememberedLoginCredentials {
  hostId: string;
  username: string;
  password: string;
  savedAt: number;
}

interface LegacyStoredRememberedLogin {
  username: string;
  password: string;
  serverBaseUrl: string;
}

type RememberedLoginMap = Record<string, RememberedLoginCredentials>;

export interface RememberedLoginSnapshot {
  credentials: RememberedLoginCredentials | null;
  legacyServerBaseUrl: string | null;
}

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

export function readRememberedLoginSnapshot(hostId: string | null): RememberedLoginSnapshot {
  const fallbackSnapshot: RememberedLoginSnapshot = {
    credentials: null,
    legacyServerBaseUrl: null
  };

  if (!canUseLocalStorage()) {
    return fallbackSnapshot;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return fallbackSnapshot;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (isRememberedLoginMap(parsed)) {
      return {
        credentials: hostId ? parsed[hostId] ?? null : null,
        legacyServerBaseUrl: null
      };
    }

    const legacyCredentials = parseLegacyStoredRememberedLogin(parsed);

    if (!legacyCredentials || !hostId) {
      return {
        credentials: null,
        legacyServerBaseUrl: legacyCredentials?.serverBaseUrl ?? null
      };
    }

    const migratedCredentials: RememberedLoginCredentials = {
      hostId,
      username: legacyCredentials.username,
      password: legacyCredentials.password,
      savedAt: Date.now()
    };
    const nextRememberedLoginMap: RememberedLoginMap = {
      [hostId]: migratedCredentials
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRememberedLoginMap));

    return {
      credentials: migratedCredentials,
      legacyServerBaseUrl: legacyCredentials.serverBaseUrl
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return fallbackSnapshot;
  }
}

export function readRememberedLoginCredentials(hostId: string | null): RememberedLoginCredentials | null {
  return readRememberedLoginSnapshot(hostId).credentials;
}

export function persistRememberedLoginCredentials(
  credentials: Pick<RememberedLoginCredentials, "hostId" | "username" | "password">
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const currentMap = readRememberedLoginMap();
  const nextCredentials: RememberedLoginCredentials = {
    hostId: credentials.hostId,
    username: credentials.username.trim(),
    password: credentials.password,
    savedAt: Date.now()
  };

  if (!nextCredentials.hostId || !nextCredentials.username || !nextCredentials.password) {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...currentMap,
      [nextCredentials.hostId]: nextCredentials
    })
  );
}

export function syncRememberedLoginServerBaseUrl(serverBaseUrl: string): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (isRememberedLoginMap(parsed)) {
      return;
    }

    const legacyCredentials = parseLegacyStoredRememberedLogin(parsed);

    if (!legacyCredentials) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...legacyCredentials,
        serverBaseUrl: normalizeServerBaseUrl(serverBaseUrl)
      })
    );
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearRememberedLoginCredentials(hostId: string | null): void {
  if (!canUseLocalStorage()) {
    return;
  }

  if (!hostId) {
    return;
  }

  const currentMap = readRememberedLoginMap();

  if (!currentMap[hostId]) {
    return;
  }

  const nextRememberedLoginMap = { ...currentMap };
  delete nextRememberedLoginMap[hostId];

  if (Object.keys(nextRememberedLoginMap).length === 0) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRememberedLoginMap));
}

function readRememberedLoginMap(): RememberedLoginMap {
  if (!canUseLocalStorage()) {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isRememberedLoginMap(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function isRememberedLoginMap(value: unknown): value is RememberedLoginMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => isRememberedLoginCredentials(item));
}

function isRememberedLoginCredentials(value: unknown): value is RememberedLoginCredentials {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RememberedLoginCredentials>;

  return (
    typeof candidate.hostId === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.password === "string" &&
    typeof candidate.savedAt === "number" &&
    candidate.username.trim().length > 0 &&
    candidate.password.length > 0
  );
}

function parseLegacyStoredRememberedLogin(value: unknown): LegacyStoredRememberedLogin | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const parsed = value as Partial<LegacyStoredRememberedLogin>;

  if (
    typeof parsed.username !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.serverBaseUrl !== "string"
  ) {
    return null;
  }

  const username = parsed.username.trim();
  const password = parsed.password;
  const serverBaseUrl = normalizeServerBaseUrl(parsed.serverBaseUrl);

  if (!username || !password) {
    return null;
  }

  return {
    username,
    password,
    serverBaseUrl
  };
}
