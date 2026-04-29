import { httpClient } from "../../../network/http-client";

export type ChannelPlatformCode =
  | "wechat-claw"
  | "telegram";
export type ButlerProfileProviderId = "codex" | "claude-code";
export type ChannelConnectionMode = "webhook" | "polling" | "bridge";
export type ChannelAccountStatus = "active" | "disabled" | "degraded";
export type ChannelMultiSessionSupportLevel = "supported" | "limited";
export type ChannelThreadStatus = "active" | "closed" | "failed";
export type ChannelInboundEventStatus = "received" | "dispatched" | "replied" | "failed" | "ignored";
export type ChannelDeliveryStatus = "sent" | "failed" | "skipped";

export interface ChannelPlatformCapabilityDto {
  code: ChannelPlatformCode;
  displayName: string;
  supportedConnectionModes: ChannelConnectionMode[];
  multiSessionSupportLevel: ChannelMultiSessionSupportLevel;
  stageOneLimitations: string[];
}

export interface ChannelAccountSummaryDto {
  id: string;
  userId: string;
  platformCode: ChannelPlatformCode;
  displayName: string;
  providerId: ButlerProfileProviderId;
  connectionMode: ChannelConnectionMode;
  status: ChannelAccountStatus;
  config: Record<string, unknown>;
  runtimeState: Record<string, unknown>;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  capability: ChannelPlatformCapabilityDto;
  threadCount: number;
  inboundEventCount: number;
  deliveryCount: number;
}

export interface ChannelThreadDto {
  id: string;
  channelAccountId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  externalThreadKey: string | null;
  controlSessionId: string | null;
  sessionId: string | null;
  title: string | null;
  status: ChannelThreadStatus;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastTransportContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelInboundEventDto {
  id: string;
  channelAccountId: string;
  externalEventId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  controlSessionId: string | null;
  sessionId: string | null;
  textContent: string;
  payload: Record<string, unknown>;
  status: ChannelInboundEventStatus;
  errorMessage: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface ChannelDeliveryDto {
  id: string;
  channelAccountId: string;
  threadId: string | null;
  inboundEventId: string | null;
  controlSessionId: string | null;
  sessionId: string | null;
  textContent: string;
  providerMessageRef: string | null;
  status: ChannelDeliveryStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProbeChannelAccountResultDto {
  account: ChannelAccountSummaryDto;
  checkedAt: string;
  ok: boolean;
  detail: string;
  warnings: string[];
}

export interface PollChannelAccountResultDto {
  account: ChannelAccountSummaryDto;
  requestedAt: string;
  accepted: boolean;
  detail: string;
}

export interface UpsertChannelAccountInput {
  platformCode: ChannelPlatformCode;
  displayName: string;
  providerId: ButlerProfileProviderId;
  connectionMode: ChannelConnectionMode;
  status: ChannelAccountStatus;
  config: Record<string, unknown>;
}

export async function listChannelPlatforms(): Promise<ChannelPlatformCapabilityDto[]> {
  return await httpClient.request<ChannelPlatformCapabilityDto[]>("/api/channels/platforms");
}

export async function listChannelAccounts(): Promise<ChannelAccountSummaryDto[]> {
  return await httpClient.request<ChannelAccountSummaryDto[]>("/api/channels/accounts");
}

export async function createChannelAccount(
  input: UpsertChannelAccountInput
): Promise<ChannelAccountSummaryDto> {
  return await httpClient.request<ChannelAccountSummaryDto>("/api/channels/accounts", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateChannelAccount(
  accountId: string,
  input: Partial<UpsertChannelAccountInput>
): Promise<ChannelAccountSummaryDto> {
  return await httpClient.request<ChannelAccountSummaryDto>(`/api/channels/accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function probeChannelAccount(accountId: string): Promise<ProbeChannelAccountResultDto> {
  return await httpClient.request<ProbeChannelAccountResultDto>(`/api/channels/accounts/${accountId}/probe`, {
    method: "POST"
  });
}

export async function pollChannelAccount(accountId: string): Promise<PollChannelAccountResultDto> {
  return await httpClient.request<PollChannelAccountResultDto>(`/api/channels/accounts/${accountId}/poll`, {
    method: "POST"
  });
}

export async function listChannelThreads(accountId: string, limit = 20): Promise<ChannelThreadDto[]> {
  return await httpClient.request<ChannelThreadDto[]>(
    `/api/channels/accounts/${accountId}/threads?limit=${limit}`
  );
}

export async function listChannelEvents(accountId: string, limit = 20): Promise<ChannelInboundEventDto[]> {
  return await httpClient.request<ChannelInboundEventDto[]>(
    `/api/channels/accounts/${accountId}/events?limit=${limit}`
  );
}

export async function listChannelDeliveries(accountId: string, limit = 20): Promise<ChannelDeliveryDto[]> {
  return await httpClient.request<ChannelDeliveryDto[]>(
    `/api/channels/accounts/${accountId}/deliveries?limit=${limit}`
  );
}
