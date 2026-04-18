import { httpClient } from "../../../network/http-client";

export type AuthClientType = "desktop" | "web" | "ios" | "android" | "unknown";

export interface AuthDeviceViewDto {
  deviceId: string | null;
  clientType: AuthClientType;
  clientInstanceId: string | null;
  displayName: string | null;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  lastSourceAddress: string | null;
  lastSeenAt: string;
  isPrimary: boolean;
  isCurrent: boolean;
  isLegacy: boolean;
}

export interface RecentLoginRecordViewDto {
  id: string;
  deviceId: string | null;
  clientType: AuthClientType;
  displayName: string | null;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  sourceAddress: string | null;
  occurredAt: string;
  isCurrentDevice: boolean;
  isLegacy: boolean;
}

export interface AuthDeviceManagementSnapshotDto {
  currentDevice: AuthDeviceViewDto | null;
  otherActiveDevices: AuthDeviceViewDto[];
  recentLoginRecords: RecentLoginRecordViewDto[];
}

export interface UpdateCurrentDevicePrimaryPayload {
  password: string;
  primary: boolean;
}

export interface LogoutOtherDevicesResultDto {
  success: true;
  revokedDeviceCount: number;
}

export interface LogoutDeviceResultDto {
  success: true;
  revokedSessionCount: number;
}

export function fetchAuthDeviceManagementSnapshot() {
  return httpClient.request<AuthDeviceManagementSnapshotDto>("/api/auth/devices");
}

export function updateCurrentDevicePrimary(payload: UpdateCurrentDevicePrimaryPayload) {
  return httpClient.request<AuthDeviceViewDto>("/api/auth/devices/current/primary", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logoutOtherDevices() {
  return httpClient.request<LogoutOtherDevicesResultDto>("/api/auth/devices/logout-others", {
    method: "POST"
  });
}

export function logoutDevice(deviceId: string) {
  return httpClient.request<LogoutDeviceResultDto>(`/api/auth/devices/${deviceId}/logout`, {
    method: "POST"
  });
}
