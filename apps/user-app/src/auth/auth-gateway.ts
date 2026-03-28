import {
  authStore,
  type AuthRefreshResult,
  type AuthSession
} from "../features/auth/store/auth-store";

export const authGateway = {
  login(username: string, password: string, baseUrl?: string): Promise<AuthSession> {
    return authStore.login(username, password, baseUrl);
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
