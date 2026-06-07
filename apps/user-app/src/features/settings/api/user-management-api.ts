import { httpClient } from "../../../network/http-client";

export type ManagedUserStatus = "active" | "disabled";
export type UserUsagePeriod = "day" | "week" | "month";

export interface ManagedUserDto {
  userId: string;
  username: string;
  role: "admin";
  status: ManagedUserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUsersResponseDto {
  items: ManagedUserDto[];
}

export interface CreateManagedUserPayload {
  username: string;
  password: string;
}

export interface UpdateManagedUserPayload {
  username?: string;
  password?: string;
}

export interface DeleteManagedUserResultDto {
  success: true;
  deletedUserId: string;
}

export interface UserUsageSnapshotDto {
  period: UserUsagePeriod;
  tokenUsageAvailable: boolean;
  users: UserUsageUserSnapshotDto[];
}

export interface UserUsageUserSnapshotDto {
  user: {
    userId: string;
    username: string;
    status: ManagedUserStatus;
  };
  sessionCount: number;
  tokenTotals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  tokenUsageAvailable: boolean;
  timeline: UserUsageBucketDto[];
  modelUsage: UserUsageItemDto[];
  cliProviderUsage: UserUsageItemDto[];
  modelProviderUsage: UserUsageItemDto[];
}

export interface UserUsageBucketDto {
  bucket: string;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UserUsageItemDto {
  label: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function fetchManagedUsers() {
  return httpClient.request<ManagedUsersResponseDto>("/api/admin/users");
}

export function createManagedUser(payload: CreateManagedUserPayload) {
  return httpClient.request<ManagedUserDto>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateManagedUser(userId: string, payload: UpdateManagedUserPayload) {
  return httpClient.request<ManagedUserDto>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function updateManagedUserStatus(userId: string, status: ManagedUserStatus) {
  return httpClient.request<ManagedUserDto>(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function deleteManagedUser(userId: string) {
  return httpClient.request<DeleteManagedUserResultDto>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

export function fetchUserUsage(period: UserUsagePeriod) {
  return httpClient.request<UserUsageSnapshotDto>(`/api/admin/users/usage?period=${period}`);
}
