import { httpClient } from "../../network/http-client";

export type TailscalePhase =
  | "disabled"
  | "blocked_uninitialized"
  | "starting"
  | "needs_login"
  | "running"
  | "stopping"
  | "error";

export interface TailscaleStatusView {
  enabled: boolean;
  controlServerUrl: string | null;
  hostname: string | null;
  phase: TailscalePhase;
  connected: boolean;
  loginUrl: string | null;
  accountName: string | null;
  tailnetFqdn: string | null;
  tailnetIpv4: string | null;
  tailnetIpv6: string | null;
  reachableBaseUrl: string | null;
  lastError: string | null;
  observedAt: string | null;
  updatedAt: string | null;
}

export interface TailscaleConfigPayload {
  controlServerUrl: string | null;
  hostname: string | null;
}

export async function fetchTailscaleStatus(): Promise<TailscaleStatusView> {
  return await httpClient.request<TailscaleStatusView>("/api/system/tailscale/status");
}

export async function updateTailscaleConfig(
  payload: TailscaleConfigPayload
): Promise<TailscaleStatusView> {
  return await httpClient.request<TailscaleStatusView>("/api/system/tailscale/config", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function enableTailscale(): Promise<TailscaleStatusView> {
  return await httpClient.request<TailscaleStatusView>("/api/system/tailscale/enable", {
    method: "POST"
  });
}

export async function disableTailscale(): Promise<TailscaleStatusView> {
  return await httpClient.request<TailscaleStatusView>("/api/system/tailscale/disable", {
    method: "POST"
  });
}

export async function loginTailscale(): Promise<TailscaleStatusView> {
  return await httpClient.request<TailscaleStatusView>("/api/system/tailscale/login", {
    method: "POST"
  });
}

export async function logoutTailscale(): Promise<TailscaleStatusView> {
  return await httpClient.request<TailscaleStatusView>("/api/system/tailscale/logout", {
    method: "POST"
  });
}
