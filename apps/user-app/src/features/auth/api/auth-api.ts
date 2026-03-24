import { httpClient } from "../../../network/http-client";

import type { AuthSession } from "../store/auth-store";

export interface CredentialPayload {
  username: string;
  password: string;
}

export interface RefreshPayload {
  refreshToken: string;
}

export interface BootstrapStatus {
  initialized: boolean;
}

export function getBootstrapStatus(baseUrl?: string) {
  return httpClient.request<BootstrapStatus>("/api/public/bootstrap-status", {
    baseUrl,
    skipAuth: true
  });
}

export function setupRequest(payload: CredentialPayload, baseUrl?: string) {
  return httpClient.request<{ initialized: true; userId: string }>("/api/public/setup", {
    method: "POST",
    body: JSON.stringify(payload),
    baseUrl,
    skipAuth: true
  });
}

export function loginRequest(payload: CredentialPayload, baseUrl?: string) {
  return httpClient.request<AuthSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    baseUrl,
    skipAuth: true
  });
}

export function refreshRequest(payload: RefreshPayload, baseUrl?: string) {
  return httpClient.request<AuthSession>("/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify(payload),
    baseUrl,
    skipAuth: true
  });
}
