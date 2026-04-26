import { httpClient } from "../../../network/http-client";

export type OpenCliProviderId = "opencli";
export type OpenCliInstallState = "not_installed" | "installed" | "broken";
export type OpenCliHealthState =
  | "unknown"
  | "binary_ready"
  | "bridge_missing"
  | "ready"
  | "runtime_build_failed";
export type OpenCliCatalogSource = "manifest" | "cli_list" | "local_manifest" | "cache";
export type OpenCliRuntimeProfileStatus = "pending" | "ready" | "failed" | "stale";
export type OpenCliRuntimeAvailability = "disabled" | "ready" | "unavailable";

export interface OpenCliProviderDto {
  providerId: OpenCliProviderId;
  enabled: boolean;
  installState: OpenCliInstallState;
  healthState: OpenCliHealthState;
  version: string | null;
  installPath: string | null;
  lastCheckedAt: string | null;
  activeRuntimeId: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  catalogRefreshedAt: string | null;
  catalogSource: OpenCliCatalogSource | null;
}

export interface OpenCliCatalogEntryDto {
  providerId: OpenCliProviderId;
  commandId: string;
  site: string;
  name: string;
  description: string;
  strategy: string;
  browser: boolean;
  modulePath: string | null;
  sourceFile: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface OpenCliSiteGroupDto {
  site: string;
  totalCount: number;
  enabledCount: number;
  browserDependentCount: number;
  commands: OpenCliCatalogEntryDto[];
}

export interface OpenCliCatalogSummaryDto {
  catalogCount: number;
  enabledCount: number;
  browserDependentCount: number;
  installState: OpenCliInstallState;
  healthState: OpenCliHealthState;
}

export interface OpenCliRuntimeProfileDto {
  id: string;
  version: string;
  sourceInstallPath: string;
  runtimeRootPath: string;
  status: OpenCliRuntimeProfileStatus;
  contentHash: string;
  enabledCommandIds: string[];
  createdAt: string;
  updatedAt: string;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

export interface OpenCliOverviewDto {
  provider: OpenCliProviderDto;
  summary: OpenCliCatalogSummaryDto;
  effectiveCatalogSource: OpenCliCatalogSource | null;
  activeRuntimeProfile: OpenCliRuntimeProfileDto | null;
}

export interface OpenCliCatalogDto extends OpenCliOverviewDto {
  entries: OpenCliCatalogEntryDto[];
  siteGroups: OpenCliSiteGroupDto[];
}

export interface OpenCliCheckResultDto extends OpenCliCatalogDto {
  refreshState: "fresh" | "cache_retained" | "unavailable";
  errorCode: string | null;
  errorDetail: string | null;
  runtimeAvailability: OpenCliRuntimeAvailability;
}

export interface UpdateOpenCliConfigInput {
  enabled: boolean;
  enabledCommandIds: string[];
}

export interface UpdateOpenCliConfigResultDto extends OpenCliCatalogDto {
  runtimeAvailability: OpenCliRuntimeAvailability;
  runtimeErrorCode: string | null;
  runtimeErrorDetail: string | null;
}

export async function fetchOpenCliCatalog(): Promise<OpenCliCatalogDto> {
  return await httpClient.request<OpenCliCatalogDto>("/api/opencli/catalog");
}

export async function refreshOpenCliState(): Promise<OpenCliCheckResultDto> {
  return await httpClient.request<OpenCliCheckResultDto>("/api/opencli/check", {
    method: "POST"
  });
}

export async function updateOpenCliConfig(
  input: UpdateOpenCliConfigInput
): Promise<UpdateOpenCliConfigResultDto> {
  return await httpClient.request<UpdateOpenCliConfigResultDto>("/api/opencli/config", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
