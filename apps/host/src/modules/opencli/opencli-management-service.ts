import { AppError } from "../../shared/errors/app-error.js";
import type { OpenCliCatalogEntryRepository } from "../../storage/repositories/opencli-catalog-entry-repository.js";
import type { OpenCliProviderRepository } from "../../storage/repositories/opencli-provider-repository.js";
import type { OpenCliRuntimeProfileRepository } from "../../storage/repositories/opencli-runtime-profile-repository.js";
import type { OpenCliCatalogSnapshot, OpenCliCatalogRefreshResult, OpenCliCatalogService } from "./opencli-catalog-service.js";
import type { OpenCliHealthService } from "./opencli-health-service.js";
import type { OpenCliRuntimeResolver, OpenCliSessionRuntimeResolution } from "./opencli-runtime-resolver.js";

export interface OpenCliRuntimeProfileView {
  id: string;
  version: string;
  sourceInstallPath: string;
  runtimeRootPath: string;
  status: "pending" | "ready" | "failed" | "stale";
  contentHash: string;
  enabledCommandIds: string[];
  createdAt: string;
  updatedAt: string;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

export interface OpenCliOverviewDto {
  provider: OpenCliCatalogSnapshot["provider"];
  summary: OpenCliCatalogSnapshot["summary"];
  effectiveCatalogSource: OpenCliCatalogSnapshot["effectiveCatalogSource"];
  activeRuntimeProfile: OpenCliRuntimeProfileView | null;
}

export interface OpenCliCatalogDto extends OpenCliOverviewDto {
  entries: OpenCliCatalogSnapshot["entries"];
  siteGroups: OpenCliCatalogSnapshot["siteGroups"];
}

export interface OpenCliCheckResultDto extends OpenCliCatalogDto {
  refreshState: OpenCliCatalogRefreshResult["refreshState"];
  errorCode: string | null;
  errorDetail: string | null;
  runtimeAvailability: OpenCliSessionRuntimeResolution["availability"];
}

export interface UpdateOpenCliConfigInput {
  enabled: boolean;
  enabledCommandIds: string[];
}

export interface UpdateOpenCliConfigResultDto extends OpenCliCatalogDto {
  runtimeAvailability: OpenCliSessionRuntimeResolution["availability"];
  runtimeErrorCode: string | null;
  runtimeErrorDetail: string | null;
}

const DISABLED_RUNTIME_RESOLUTION: OpenCliSessionRuntimeResolution = {
  availability: "disabled",
  runtimeRootPath: null,
  runtimeBinPath: null,
  realHome: null,
  realUserProfile: null,
  errorCode: null,
  errorDetail: null
};

export class OpenCliManagementService {
  constructor(
    private readonly providerRepository: OpenCliProviderRepository,
    private readonly catalogEntryRepository: OpenCliCatalogEntryRepository,
    private readonly runtimeProfileRepository: OpenCliRuntimeProfileRepository,
    private readonly catalogService: OpenCliCatalogService,
    private readonly healthService: OpenCliHealthService,
    private readonly runtimeResolver: OpenCliRuntimeResolver
  ) {}

  getOverview(): OpenCliOverviewDto {
    const snapshot = this.catalogService.getSnapshot();
    return buildOverviewDto(snapshot, this.resolveActiveRuntimeProfile(snapshot.provider.activeRuntimeId));
  }

  getCatalog(): OpenCliCatalogDto {
    const snapshot = this.catalogService.getSnapshot();
    return buildCatalogDto(snapshot, this.resolveActiveRuntimeProfile(snapshot.provider.activeRuntimeId));
  }

  async check(): Promise<OpenCliCheckResultDto> {
    const refreshResult = await this.catalogService.refreshCatalog();
    const providerWithHealth = await this.refreshProviderHealth(refreshResult.provider);
    let runtimeResolution = DISABLED_RUNTIME_RESOLUTION;

    if (providerWithHealth.enabled && providerWithHealth.installState === "installed") {
      runtimeResolution = this.runtimeResolver.resolveSessionRuntime();
    }

    const snapshot = this.catalogService.getSnapshot();

    return {
      ...buildCatalogDto(snapshot, this.resolveActiveRuntimeProfile(snapshot.provider.activeRuntimeId)),
      refreshState: refreshResult.refreshState,
      errorCode: refreshResult.errorCode,
      errorDetail: refreshResult.errorDetail,
      runtimeAvailability: runtimeResolution.availability
    };
  }

  updateConfig(input: UpdateOpenCliConfigInput): UpdateOpenCliConfigResultDto {
    const snapshot = this.catalogService.getSnapshot();
    const normalizedEnabledCommandIds = normalizeEnabledCommandIds(input.enabledCommandIds);
    assertKnownCommandIds(snapshot.entries.map((entry) => entry.commandId), normalizedEnabledCommandIds);

    this.catalogEntryRepository.replaceEnabledStates("opencli", normalizedEnabledCommandIds);
    this.providerRepository.upsert({
      ...snapshot.provider,
      enabled: input.enabled,
      activeRuntimeId: input.enabled ? snapshot.provider.activeRuntimeId : null
    });

    const runtimeResolution = input.enabled
      ? this.runtimeResolver.resolveSessionRuntime()
      : DISABLED_RUNTIME_RESOLUTION;
    const nextSnapshot = this.catalogService.getSnapshot();

    return {
      ...buildCatalogDto(nextSnapshot, this.resolveActiveRuntimeProfile(nextSnapshot.provider.activeRuntimeId)),
      runtimeAvailability: runtimeResolution.availability,
      runtimeErrorCode: runtimeResolution.errorCode,
      runtimeErrorDetail: runtimeResolution.errorDetail
    };
  }

  private async refreshProviderHealth(provider: OpenCliCatalogSnapshot["provider"]) {
    const healthResult = await this.healthService.check();

    return this.providerRepository.upsert({
      ...provider,
      installState: healthResult.installState,
      healthState: healthResult.healthState,
      version: healthResult.version,
      installPath: healthResult.installPath,
      lastCheckedAt: healthResult.checkedAt,
      lastErrorCode: healthResult.errorCode ?? provider.lastErrorCode,
      lastErrorDetail: healthResult.errorDetail ?? provider.lastErrorDetail
    });
  }

  private resolveActiveRuntimeProfile(activeRuntimeId: string | null): OpenCliRuntimeProfileView | null {
    if (!activeRuntimeId) {
      return null;
    }

    const profile = this.runtimeProfileRepository.findById(activeRuntimeId);

    if (!profile) {
      return null;
    }

    return {
      id: profile.id,
      version: profile.version,
      sourceInstallPath: profile.sourceInstallPath,
      runtimeRootPath: profile.runtimeRootPath,
      status: profile.status,
      contentHash: profile.contentHash,
      enabledCommandIds: parseProfileCommandIds(profile.enabledCommandIdsJson),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastErrorCode: profile.lastErrorCode,
      lastErrorDetail: profile.lastErrorDetail
    };
  }
}

function buildOverviewDto(
  snapshot: OpenCliCatalogSnapshot,
  activeRuntimeProfile: OpenCliRuntimeProfileView | null
): OpenCliOverviewDto {
  return {
    provider: snapshot.provider,
    summary: snapshot.summary,
    effectiveCatalogSource: snapshot.effectiveCatalogSource,
    activeRuntimeProfile
  };
}

function buildCatalogDto(
  snapshot: OpenCliCatalogSnapshot,
  activeRuntimeProfile: OpenCliRuntimeProfileView | null
): OpenCliCatalogDto {
  return {
    ...buildOverviewDto(snapshot, activeRuntimeProfile),
    entries: snapshot.entries,
    siteGroups: snapshot.siteGroups
  };
}

function normalizeEnabledCommandIds(enabledCommandIds: readonly string[]): string[] {
  return [...new Set(
    enabledCommandIds
      .map((commandId) => commandId.trim())
      .filter((commandId) => commandId.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

function assertKnownCommandIds(knownCommandIds: readonly string[], nextCommandIds: readonly string[]): void {
  const knownCommandIdSet = new Set(knownCommandIds);
  const unknownCommandIds = nextCommandIds.filter((commandId) => !knownCommandIdSet.has(commandId));

  if (unknownCommandIds.length === 0) {
    return;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "OPENCLI_UNKNOWN_COMMAND_IDS",
    detail: `存在未知 OpenCLI 命令：${unknownCommandIds.join(", ")}`,
    field: "enabledCommandIds"
  });
}

function parseProfileCommandIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}
