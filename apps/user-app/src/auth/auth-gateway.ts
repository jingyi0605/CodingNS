import {
  authStore,
  type AuthRefreshResult,
  type AuthSession
} from "../features/auth/store/auth-store";
import type { LoginPayload } from "../features/auth/api/auth-api";

export const authGateway = {
  login(payload: LoginPayload, baseUrl?: string): Promise<AuthSession> {
    return authStore.login(payload, baseUrl);
  },
  bootstrap(username: string, password: string, baseUrl?: string): Promise<void> {
    return authStore.bootstrap(username, password, baseUrl);
  },
  refresh(): Promise<AuthRefreshResult> {
    return authStore.refresh();
  },
  logout(): void {
    authStore.clear();
  }
};
