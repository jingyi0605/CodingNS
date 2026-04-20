import { httpClient } from "../../network/http-client";

export type RelayTunnelPhase =
  | "disabled"
  | "blocked_uninitialized"
  | "unbound"
  | "binding"
  | "connecting"
  | "running"
  | "quota_exhausted"
  | "error";

export interface RelayTunnelStatusView {
  activated: boolean;
  enabled: boolean;
  provider: "codingns_relay";
  relayBaseUrl: string | null;
  controlBaseUrl: string | null;
  controlAccountEmail: string | null;
  controlSessionExpiresAt: string | null;
  accountId: string | null;
  tunnelDomain: string | null;
  bindingId: string | null;
  hostPublicKey: string | null;
  hostKeyFingerprint: string | null;
  localTargetBaseUrl: string;
  phase: RelayTunnelPhase;
  connected: boolean;
  hostFingerprint: string | null;
  trafficUsedBytes: string | null;
  trafficRemainingBytes: string | null;
  quotaResetAt: string | null;
  lastError: string | null;
  observedAt: string | null;
  updatedAt: string | null;
}

export interface RelayTunnelConfigPayload {
  activated?: boolean;
  relayBaseUrl?: string | null;
  controlBaseUrl?: string | null;
  localTargetBaseUrl?: string | null;
}

export interface RelayTunnelBindPayload {
  accountId: string;
  bindingId: string;
  tunnelDomain: string;
  relayBaseUrl?: string | null;
  controlBaseUrl?: string | null;
}

export interface RelayTunnelIdentityView {
  hostPublicKey: string | null;
  hostKeyFingerprint: string | null;
}

export interface RelayControlLoginResponse {
  account: {
    accountId: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
  };
  accessToken: string;
  expiresAt: string;
}

export interface RelayControlBindResponse {
  created: boolean;
  binding: {
    bindingId: string;
    tunnelDomain: string;
    hostPublicKey: string;
    hostFingerprint: string;
    relayBaseUrl: string;
    controlBaseUrl: string;
    status: "active" | "disabled";
  };
}

export interface RelayControlHostLabelAvailability {
  hostLabel: string;
  tunnelDomain: string | null;
  available: boolean;
  reason: "available" | "occupied" | "reserved" | "unavailable";
}

export interface RelayTrafficWalletSummary {
  accountId: string;
  grantedBytes: string;
  usedBytes: string;
  remainingBytes: string;
  exhausted: boolean;
  updatedAt: string;
}

export interface RelayTrafficPackage {
  packageId: string;
  name: string;
  description: string;
  paddlePriceId: string;
  currency: string;
  priceMinor: number;
  grantedBytes: string;
  featured: boolean;
}

export interface RelayTrafficOrderSummary {
  orderId: string;
  packageId: string;
  packageName: string;
  currency: string;
  amountMinor: number;
  grantedBytes: string;
  status: "pending" | "paid" | "expired" | "failed";
  checkoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface RelayCheckoutSessionResponse {
  order: RelayTrafficOrderSummary;
  checkoutUrl: string;
}

export async function fetchRelayTunnelStatus(): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/status");
}

export async function ensureRelayTunnelIdentity(): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/identity/ensure", {
    method: "POST"
  });
}

export async function updateRelayTunnelConfig(
  payload: RelayTunnelConfigPayload
): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/config", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function loginRelayTunnelControl(input: {
  email: string;
  password: string;
}): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/control/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function logoutRelayTunnelControl(): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/control/logout", {
    method: "POST"
  });
}

export async function checkRelayTunnelHostLabelAvailability(input: {
  hostLabel: string;
}): Promise<RelayControlHostLabelAvailability> {
  const hostLabel = input.hostLabel.trim();
  const path = `/api/system/relay-tunnel/control/host-label-availability?hostLabel=${encodeURIComponent(hostLabel)}`;
  return await httpClient.request<RelayControlHostLabelAvailability>(path);
}

export async function bindRelayTunnelControlHost(input: {
  hostLabel: string;
}): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/control/bind", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchRelayTunnelTrafficWallet(): Promise<{ wallet: RelayTrafficWalletSummary }> {
  return await httpClient.request<{ wallet: RelayTrafficWalletSummary }>(
    "/api/system/relay-tunnel/control/wallet"
  );
}

export async function bindRelayTunnelHost(
  payload: RelayTunnelBindPayload
): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/bind", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function enableRelayTunnel(): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/enable", {
    method: "POST"
  });
}

export async function disableRelayTunnel(): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/disable", {
    method: "POST"
  });
}

export async function unbindRelayTunnel(): Promise<RelayTunnelStatusView> {
  return await httpClient.request<RelayTunnelStatusView>("/api/system/relay-tunnel/unbind", {
    method: "POST"
  });
}

export async function loginRelayControlByEmail(input: {
  controlBaseUrl: string;
  email: string;
  password: string;
}): Promise<RelayControlLoginResponse> {
  return await httpClient.request<RelayControlLoginResponse>("/api/public/auth/login", {
    baseUrl: input.controlBaseUrl,
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({
      email: input.email,
      password: input.password
    })
  });
}

export async function bindRelayControlHost(input: {
  controlBaseUrl: string;
  accessToken: string;
  hostLabel: string;
  hostPublicKey: string;
  hostFingerprint: string;
}): Promise<RelayControlBindResponse> {
  return await httpClient.request<RelayControlBindResponse>("/api/v1/hosts/bind", {
    baseUrl: input.controlBaseUrl,
    method: "POST",
    skipAuth: true,
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    },
    body: JSON.stringify({
      hostLabel: input.hostLabel,
      hostPublicKey: input.hostPublicKey,
      hostFingerprint: input.hostFingerprint
    })
  });
}

export async function checkRelayControlHostLabelAvailability(input: {
  controlBaseUrl: string;
  accessToken: string;
  hostLabel: string;
}): Promise<RelayControlHostLabelAvailability> {
  const hostLabel = input.hostLabel.trim();
  const path = `/api/v1/hosts/availability?hostLabel=${encodeURIComponent(hostLabel)}`;

  return await httpClient.request<RelayControlHostLabelAvailability>(path, {
    baseUrl: input.controlBaseUrl,
    skipAuth: true,
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    }
  });
}

export async function fetchRelayTrafficWallet(input: {
  controlBaseUrl: string;
  accessToken: string;
}): Promise<{ wallet: RelayTrafficWalletSummary }> {
  return await httpClient.request<{ wallet: RelayTrafficWalletSummary }>("/api/v1/traffic-wallet/me", {
    baseUrl: input.controlBaseUrl,
    skipAuth: true,
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    }
  });
}

export async function fetchRelayTrafficPackages(controlBaseUrl: string): Promise<{ packages: RelayTrafficPackage[] }> {
  return await httpClient.request<{ packages: RelayTrafficPackage[] }>("/api/public/traffic-packages", {
    baseUrl: controlBaseUrl,
    skipAuth: true
  });
}

export async function fetchRelayTrafficOrders(input: {
  controlBaseUrl: string;
  accessToken: string;
}): Promise<{ orders: RelayTrafficOrderSummary[] }> {
  return await httpClient.request<{ orders: RelayTrafficOrderSummary[] }>("/api/v1/orders", {
    baseUrl: input.controlBaseUrl,
    skipAuth: true,
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    }
  });
}

export async function createRelayCheckoutSession(input: {
  controlBaseUrl: string;
  accessToken: string;
  packageId: string;
}): Promise<RelayCheckoutSessionResponse> {
  return await httpClient.request<RelayCheckoutSessionResponse>("/api/v1/payments/checkout-sessions", {
    baseUrl: input.controlBaseUrl,
    method: "POST",
    skipAuth: true,
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    },
    body: JSON.stringify({
      packageId: input.packageId
    })
  });
}
