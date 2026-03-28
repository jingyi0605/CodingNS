import { useSyncExternalStore } from "react";

import { getHostBaseUrl } from "../../../config/env";
import { ApiError } from "../../../shared/network/api-error";
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

export type AuthRefreshResult =
  | {
      status: "refreshed";
      session: AuthSession;
    }
  | {
      status: "invalid";
      session: null;
    }
  | {
      status: "deferred";
      session: AuthSession | null;
      error: unknown;
    };

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

  async refresh(): Promise<AuthRefreshResult> {
    const previousSession = this.state.session;
    const refreshToken = previousSession?.refreshToken;

    if (!refreshToken) {
      this.clear();
      return {
        status: "invalid",
        session: null
      };
    }

    this.state = {
      ...this.state,
      status: "refreshing"
    };
    this.emit();

    try {
      const nextSession = await refreshRequest({ refreshToken });
      this.setSession(nextSession);
      return {
        status: "refreshed",
        session: nextSession
      };
    } catch (error) {
      if (shouldClearSessionAfterRefreshFailure(error)) {
        this.clear();
        return {
          status: "invalid",
          session: null
        };
      }

      this.state = {
        status: previousSession ? "authenticated" : "anonymous",
        session: previousSession
      };
      this.emit();

      return {
        status: "deferred",
        session: previousSession,
        error
      };
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
        if (parsed.serverBaseUrl && parsed.serverBaseUrl !== currentBaseUrl) {
          // 应用启动早期客户端配置还没完成恢复，不能用 fallback host 去误删已保存登录态。
          // 真正的跨服务端失效会在后续请求里由 401/refresh 结果来收口。
          return parsed.session;
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

function shouldClearSessionAfterRefreshFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.status === 401) {
    return true;
  }

  return error.status === 403 && error.errorCode === "BOOTSTRAP_REQUIRED";
}
