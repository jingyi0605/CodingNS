import { useSyncExternalStore } from "react";

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

  async login(username: string, password: string): Promise<AuthSession> {
    const session = await loginRequest({ username, password });
    this.setSession(session);
    return session;
  }

  async bootstrap(username: string, password: string): Promise<void> {
    await setupRequest({ username, password });
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.emit();
  }

  private readSession(): AuthSession | null {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as AuthSession;
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
