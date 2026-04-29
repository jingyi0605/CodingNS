import { useSyncExternalStore } from "react";

import { clientConfigStore } from "../../../config/client-config-store";
import {
  getActiveHost,
  isDiscoveredHostProfile,
  type HostProfile,
  type RuntimeHostProfile
} from "../../../config/client-config-types";
import { getHostRequestUrl } from "../../../config/env";
import { hostLoginRouteHintStore } from "../../../config/host-login-route-hint-store";
import { isPageUnloading } from "../../../shared/browser/page-unload-state";
import { ApiError, type ApiErrorPayload } from "../../../shared/network/api-error";
import { getAuthClientHeaders } from "./client-device";
import type { LoginPayload } from "../api/auth-api";

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
  sessionReady: boolean;
}

export interface HostSessionEnvelope {
  hostId: string;
  session: AuthSession | null;
  savedAt: number;
}

export type HostSessionMap = Record<string, HostSessionEnvelope>;

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
const RUNTIME_CONFIG_SYNC_TIMEOUT_MS = 3_000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 15_000;

interface LegacyStoredAuthSession {
  serverBaseUrl?: string;
  session: AuthSession;
}

class AuthStore {
  private state: AuthState = {
    status: "anonymous",
    session: null,
    sessionReady: true
  };

  private listeners = new Set<AuthListener>();
  private sessionMap: HostSessionMap = {};
  private lastRuntimeConfigSyncKey: string | null = null;
  private lastStoredSessionValidationKey: string | null = null;
  private refreshInFlight: Promise<AuthRefreshResult> | null = null;

  constructor() {
    this.syncCurrentHostSession();
    clientConfigStore.subscribe(() => {
      this.syncCurrentHostSession();
    });
  }

  subscribe = (listener: AuthListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async login(payload: LoginPayload, baseUrl?: string): Promise<AuthSession> {
    const currentHost = this.getCurrentHost();

    if (!currentHost) {
      const { loginRequest } = await import("../api/auth-api");
      const session = await loginRequest(payload, baseUrl);
      this.updateState({
        status: "authenticated",
        session,
        sessionReady: true
      });
      return session;
    }

    const session = await this.loginForHost(currentHost, payload, baseUrl);
    this.updateState({
      status: "authenticated",
      session,
      sessionReady: true
    });
    return session;
  }

  async loginForHost(host: RuntimeHostProfile, payload: LoginPayload, baseUrl?: string): Promise<AuthSession> {
    const { loginRequest } = await import("../api/auth-api");
    const { resolveLoginBaseUrlWithDirectCandidates } = await import("./login-direct-candidate-resolver");
    const requestedBaseUrl = baseUrl ?? host.baseUrl;
    const loginBaseUrl = await resolveLoginBaseUrlWithDirectCandidates({
      host,
      requestedBaseUrl,
      platform: clientConfigStore.getState().platform
    });
    const session = await loginRequest(payload, loginBaseUrl);

    if (loginBaseUrl !== host.baseUrl) {
      hostLoginRouteHintStore.remember(host.id, loginBaseUrl);
    } else {
      hostLoginRouteHintStore.forget(host.id);
    }

    this.persistSession(host, session);

    if (this.getCurrentHost()?.id === host.id) {
      this.updateState({
        status: "authenticated",
        session,
        sessionReady: true
      });
      this.scheduleRuntimeConfigSync(host, session);
    }

    return session;
  }

  async bootstrap(username: string, password: string, baseUrl?: string): Promise<void> {
    const { setupRequest } = await import("../api/auth-api");
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
    if (this.refreshInFlight) {
      return await this.refreshInFlight;
    }

    const refreshTask = this.runRefresh();
    this.refreshInFlight = refreshTask;

    try {
      return await refreshTask;
    } finally {
      if (this.refreshInFlight === refreshTask) {
        this.refreshInFlight = null;
      }
    }
  }

  shouldRefreshCurrentSession(now = Date.now()): boolean {
    return shouldRefreshSessionBeforeRequest(this.getCurrentSessionEnvelope(), now);
  }

  private async runRefresh(): Promise<AuthRefreshResult> {
    const previousSession = this.state.session;
    const refreshToken = previousSession?.refreshToken;
    const currentHost = this.getCurrentHost();

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
      const nextSession = await requestSessionRefresh(refreshToken, currentHost?.baseUrl);
      this.setSession(nextSession, currentHost);
      this.scheduleRuntimeConfigSync(currentHost, nextSession);
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
        session: previousSession,
        sessionReady: this.state.sessionReady
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
    const currentHost = this.getCurrentHost();
    this.lastRuntimeConfigSyncKey = null;
    this.lastStoredSessionValidationKey = null;

    if (!currentHost) {
      hostLoginRouteHintStore.clear();
      this.sessionMap = {};
      this.persistSessionMap();
      this.updateState({
        status: "anonymous",
        session: null,
        sessionReady: true
      });
      return;
    }

    hostLoginRouteHintStore.forget(currentHost.id);

    if (this.sessionMap[currentHost.id]) {
      const nextSessionMap = { ...this.sessionMap };
      delete nextSessionMap[currentHost.id];
      this.sessionMap = nextSessionMap;
      this.persistSessionMap();
    }

    this.updateState({
      status: "anonymous",
      session: null,
      sessionReady: true
    });
  }

  clearHostSession(hostId: string): void {
    if (!hostId) {
      return;
    }

    hostLoginRouteHintStore.forget(hostId);

    if (!this.sessionMap[hostId]) {
      return;
    }

    const nextSessionMap = { ...this.sessionMap };
    delete nextSessionMap[hostId];
    this.sessionMap = nextSessionMap;
    this.persistSessionMap();

    if (this.getCurrentHost()?.id === hostId) {
      this.lastRuntimeConfigSyncKey = null;
      this.lastStoredSessionValidationKey = null;
      this.updateState({
        status: "anonymous",
        session: null,
        sessionReady: true
      });
    }
  }

  private setSession(
    session: AuthSession,
    host = this.getCurrentHost(),
    options: { sessionReady?: boolean } = {}
  ): void {
    if (!host) {
      return;
    }

    this.persistSession(host, session);
    this.lastStoredSessionValidationKey = buildStoredSessionValidationKey(host, session);
    this.updateState({
      status: "authenticated",
      session,
      sessionReady: options.sessionReady ?? true
    });
  }

  private persistSession(host: RuntimeHostProfile, session: AuthSession): void {
    this.lastStoredSessionValidationKey = buildStoredSessionValidationKey(host, session);
    this.sessionMap = {
      ...this.sessionMap,
      [host.id]: {
        hostId: host.id,
        session,
        savedAt: Date.now()
      }
    };
    this.persistSessionMap();
    const connectedAt = new Date().toISOString();

    if (isDiscoveredHostProfile(host)) {
      clientConfigStore.updateRuntime({
        discoveredHosts: clientConfigStore.getState().discoveredHosts.map((item) =>
          item.id === host.id
            ? {
                ...item,
                lastConnectedAt: connectedAt,
                lastUserId: session.user.userId,
                lastUsername: session.user.username,
                updatedAt: connectedAt
              }
            : item
        )
      });
      return;
    }

    void clientConfigStore.update({
      hosts: clientConfigStore.getState().hosts.map((item) =>
        item.id === host.id
          ? {
              ...item,
              lastConnectedAt: connectedAt,
              lastUserId: session.user.userId,
              lastUsername: session.user.username,
              updatedAt: connectedAt
            }
          : item
      )
    }).catch(() => {});
  }

  private syncCurrentHostSession(): void {
    if (!clientConfigStore.isInitialized()) {
      return;
    }

    const currentHost = this.getCurrentHost();
    const { sessionMap, migrated } = this.readSessionMapFromStorage(currentHost);
    const normalizedSessionMap = pruneExpiredSessions(sessionMap);

    this.sessionMap = normalizedSessionMap;

    if (migrated || Object.keys(normalizedSessionMap).length !== Object.keys(sessionMap).length) {
      this.persistSessionMap();
    }

    const nextSession = currentHost ? normalizedSessionMap[currentHost.id]?.session ?? null : null;

    if (!currentHost || !nextSession) {
      this.lastStoredSessionValidationKey = null;
      this.updateState({
        status: "anonymous",
        session: null,
        sessionReady: true
      });
      this.lastRuntimeConfigSyncKey = null;
      return;
    }

    const validationKey = buildStoredSessionValidationKey(currentHost, nextSession);

    if (this.lastStoredSessionValidationKey === validationKey) {
      this.updateState({
        status: "authenticated",
        session: nextSession,
        sessionReady: true
      });
      return;
    }

    this.updateState({
      status: "authenticated",
      session: nextSession,
      sessionReady: false
    });
    this.scheduleStoredSessionValidation(currentHost, nextSession);
  }

  private getCurrentHost(): RuntimeHostProfile | null {
    return getActiveHost(clientConfigStore.getState());
  }

  private getCurrentSessionEnvelope(): HostSessionEnvelope | null {
    const currentHost = this.getCurrentHost();

    if (!currentHost) {
      return null;
    }

    return this.sessionMap[currentHost.id] ?? null;
  }

  private readSessionMapFromStorage(currentHost: HostProfile | null): {
    sessionMap: HostSessionMap;
    migrated: boolean;
  } {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return {
        sessionMap: {},
        migrated: false
      };
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        sessionMap: {},
        migrated: false
      };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (isHostSessionMap(parsed)) {
        return {
          sessionMap: parsed,
          migrated: false
        };
      }

      const migratedSessionMap = migrateLegacyStoredSession(parsed, currentHost);

      if (migratedSessionMap) {
        return {
          sessionMap: migratedSessionMap,
          migrated: true
        };
      }
    } catch {
      // 无效 JSON 直接清掉，避免后续一直反复解析失败。
    }

    window.localStorage.removeItem(STORAGE_KEY);
    return {
      sessionMap: {},
      migrated: false
    };
  }

  private persistSessionMap(): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return;
    }

    if (Object.keys(this.sessionMap).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessionMap));
  }

  private updateState(nextState: AuthState): void {
    if (
      this.state.status === nextState.status
      && this.state.session === nextState.session
      && this.state.sessionReady === nextState.sessionReady
    ) {
      return;
    }

    this.state = nextState;
    this.emit();
  }

  private async ensureRuntimeConfigSynced(
    host: RuntimeHostProfile | null,
    session: AuthSession | null
  ): Promise<void> {
    if (!host || !session || isPageUnloading()) {
      this.lastRuntimeConfigSyncKey = null;
      return;
    }

    if (this.getCurrentHost()?.id !== host.id) {
      return;
    }

    const syncKey = `${host.id}:${session.accessToken}`;

    if (this.lastRuntimeConfigSyncKey === syncKey) {
      return;
    }

    this.lastRuntimeConfigSyncKey = syncKey;

    try {
      const { syncActiveHostAuthenticatedRuntimeConfig } = await import(
        "../../../platform/server/client-runtime-manager"
      );
      await withTimeout(
        syncActiveHostAuthenticatedRuntimeConfig(),
        RUNTIME_CONFIG_SYNC_TIMEOUT_MS,
        "runtime_config_sync_timeout"
      );
    } catch {
      if (this.lastRuntimeConfigSyncKey === syncKey) {
        this.lastRuntimeConfigSyncKey = null;
      }

      // 运行时配置同步失败不该挡住登录链路，后续仍然允许后台自动重试或手动进入设置页刷新。
    }
  }

  private scheduleRuntimeConfigSync(
    host: RuntimeHostProfile | null,
    session: AuthSession | null
  ): void {
    void this.ensureRuntimeConfigSynced(host, session);
  }

  private scheduleStoredSessionValidation(
    host: RuntimeHostProfile,
    session: AuthSession
  ): void {
    void this.ensureStoredSessionValidated(host, session);
  }

  private async ensureStoredSessionValidated(
    host: RuntimeHostProfile,
    session: AuthSession
  ): Promise<void> {
    if (
      isPageUnloading()
      || this.getCurrentHost()?.id !== host.id
      || this.state.session?.refreshToken !== session.refreshToken
    ) {
      return;
    }

    const validationKey = buildStoredSessionValidationKey(host, session);

    try {
      const nextSession = await requestSessionRefresh(session.refreshToken, host.baseUrl);

      if (this.getCurrentHost()?.id !== host.id || this.state.session?.refreshToken !== session.refreshToken) {
        return;
      }

      this.lastStoredSessionValidationKey = validationKey;
      this.setSession(nextSession, host, { sessionReady: true });
      this.scheduleRuntimeConfigSync(host, nextSession);
    } catch (error) {
      if (this.getCurrentHost()?.id !== host.id || this.state.session?.refreshToken !== session.refreshToken) {
        return;
      }

      if (shouldClearSessionAfterRefreshFailure(error)) {
        this.clear();
        return;
      }

      this.lastStoredSessionValidationKey = validationKey;
      this.updateState({
        status: "authenticated",
        session,
        sessionReady: true
      });
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

function isHostSessionEnvelope(value: unknown): value is HostSessionEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<HostSessionEnvelope>;

  return (
    typeof candidate.hostId === "string" &&
    typeof candidate.savedAt === "number" &&
    isAuthSession(candidate.session)
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isHostSessionMap(value: unknown): value is HostSessionMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => isHostSessionEnvelope(item));
}

function isLegacyStoredAuthSession(value: unknown): value is LegacyStoredAuthSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "session" in value && isAuthSession((value as LegacyStoredAuthSession).session);
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

function migrateLegacyStoredSession(
  value: unknown,
  currentHost: HostProfile | null
): HostSessionMap | null {
  const fallbackHostId = currentHost?.id ?? null;

  if (!fallbackHostId) {
    return null;
  }

  if (isLegacyStoredAuthSession(value)) {
    const targetHostId = resolveLegacySessionHostId(value.serverBaseUrl, currentHost) ?? fallbackHostId;
    return {
      [targetHostId]: {
        hostId: targetHostId,
        session: value.session,
        savedAt: Date.now()
      }
    };
  }

  if (isAuthSession(value)) {
    return {
      [fallbackHostId]: {
        hostId: fallbackHostId,
        session: value,
        savedAt: Date.now()
      }
    };
  }

  return null;
}

function resolveLegacySessionHostId(
  serverBaseUrl: string | undefined,
  currentHost: HostProfile | null
): string | null {
  if (!serverBaseUrl) {
    return currentHost?.id ?? null;
  }

  const config = clientConfigStore.getState();
  const matchedHost = config.hosts.find((host) => host.baseUrl === serverBaseUrl);

  return matchedHost?.id ?? currentHost?.id ?? null;
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

function pruneExpiredSessions(sessionMap: HostSessionMap): HostSessionMap {
  const nextEntries = Object.entries(sessionMap).filter(([, envelope]) => !isSessionExpired(envelope));

  return Object.fromEntries(nextEntries);
}

function isSessionExpired(envelope: HostSessionEnvelope): boolean {
  const ttlMs = envelope.session?.expiresIn;

  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return true;
  }

  return envelope.savedAt + ttlMs * 1000 <= Date.now();
}

function shouldRefreshSessionBeforeRequest(
  envelope: HostSessionEnvelope | null,
  now: number
): boolean {
  const ttlMs = envelope?.session?.expiresIn;

  if (!envelope?.session || typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return false;
  }

  return envelope.savedAt + ttlMs * 1000 <= now + ACCESS_TOKEN_REFRESH_SKEW_MS;
}

function buildStoredSessionValidationKey(host: RuntimeHostProfile, session: AuthSession): string {
  return `${host.id}:${session.refreshToken}`;
}

async function requestSessionRefresh(refreshToken: string, baseUrl?: string): Promise<AuthSession> {
  const response = await fetch(getHostRequestUrl("/api/auth/refresh", baseUrl), {
    method: "POST",
    headers: {
      ...getAuthClientHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refreshToken })
  });

  const raw = await response.text();
  const payload = raw ? tryParseRefreshPayload(raw) : null;

  if (!response.ok) {
    throw new ApiError(response.status, {
      detail: payload?.detail ?? `请求失败（HTTP ${response.status}）`,
      error_code: payload?.error_code ?? (response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR"),
      field: payload?.field,
      data: payload?.data,
      timestamp: payload?.timestamp
    });
  }

  if (!payload || !isAuthSession(payload)) {
    throw new ApiError(response.status, {
      detail: "刷新登录态返回了无效响应",
      error_code: "HTTP_ERROR"
    });
  }

  return payload;
}

function tryParseRefreshPayload(raw: string): (Partial<AuthSession> & Partial<ApiErrorPayload>) | null {
  try {
    return JSON.parse(raw) as Partial<AuthSession> & Partial<ApiErrorPayload>;
  } catch {
    return null;
  }
}
