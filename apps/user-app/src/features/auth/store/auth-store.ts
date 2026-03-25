import { useSyncExternalStore } from "react";

import { getHostBaseUrl } from "../../../config/env";
import { loginRequest, refreshRequest, setupRequest } from "../api/auth-api";

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: "admin";
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface AuthState {
  status: "anonymous" | "authenticated" | "refreshing";
  session: AuthSession | null;
}

type AuthListener = () => void;

const STORAGE_KEY = "codingns.auth.session";

interface StoredAuthSession {
  serverBaseUrl?: string;
  session: AuthSession;
}

class AuthStore {
  private state: AuthState = {
    status: "anonymous",
    session: this.readSession()
  };

  private listeners = new Set<AuthListener>();

  constructor() {
    if (this.state.session) {
      this.state = {
        status: "authenticated",
        session: this.state.session
      };
    }
  }

  subscribe = (listener: AuthListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async login(username: string, password: string, baseUrl?: string): Promise<AuthSession> {
    const session = await loginRequest({ username, password }, baseUrl);
    this.setSession(session);
    return session;
  }

  async bootstrap(username: string, password: string, baseUrl?: string): Promise<void> {
    await setupRequest({ username, password }, baseUrl);
  }

  hydrate(session: AuthSession | null): void {
    if (!session) {
      this.clear();
      return;
    }

    this.setSession(session);
  }

  async refresh(): Promise<AuthSession | null> {
    const refreshToken = this.state.session?.refreshToken;

    if (!refreshToken) {
      this.clear();
      return null;
    }

    this.state = {
      ...this.state,
      status: "refreshing"
    };
    this.emit();

    try {
      const nextSession = await refreshRequest({ refreshToken });
      this.setSession(nextSession);
      return nextSession;
    } catch {
      this.clear();
      return null;
    }
  }

  clear(): void {
    this.state = {
      status: "anonymous",
      session: null
    };
    window.localStorage.removeItem(STORAGE_KEY);
    this.emit();
  }

  private setSession(session: AuthSession): void {
    this.state = {
      status: "authenticated",
      session
    };
    const storedSession: StoredAuthSession = {
      serverBaseUrl: getHostBaseUrl(),
      session
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSession));
    this.emit();
  }

  private readSession(): AuthSession | null {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AuthSession | StoredAuthSession;
      const currentBaseUrl = getHostBaseUrl();

      if (isStoredAuthSession(parsed)) {
        if (parsed.serverBaseUrl && !canReuseStoredSession(parsed.serverBaseUrl, currentBaseUrl)) {
          window.localStorage.removeItem(STORAGE_KEY);
          return null;
        }

        if (parsed.serverBaseUrl && parsed.serverBaseUrl !== currentBaseUrl) {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              serverBaseUrl: currentBaseUrl,
              session: parsed.session
            } satisfies StoredAuthSession)
          );
        }

        return parsed.session;
      }

      if (isAuthSession(parsed)) {
        return parsed;
      }

      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const authStore = new AuthStore();

export function useAuthSelector<T>(selector: (state: AuthState) => T): T {
  return useSyncExternalStore(authStore.subscribe, () => selector(authStore.getState()));
}

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "session" in value && isAuthSession((value as StoredAuthSession).session);
}

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AuthSession>;

  return (
    typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.expiresIn === "number" &&
    typeof candidate.user === "object" &&
    candidate.user !== null
  );
}

function canReuseStoredSession(storedBaseUrl: string, currentBaseUrl: string): boolean {
  if (storedBaseUrl === currentBaseUrl) {
    return true;
  }

  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }

  const windowOrigin = window.location.origin;

  // 兼容开发环境从前端代理地址迁移到直连后端地址，避免一次配置修正把本地登录态全部清空。
  return storedBaseUrl === windowOrigin;
}
