import os from "node:os";
import path from "node:path";

import type { OpenCliProviderRepository } from "../../storage/repositories/opencli-provider-repository.js";
import type { OpenCliRuntimeProfileRepository } from "../../storage/repositories/opencli-runtime-profile-repository.js";
import type { OpenCliHealthState } from "../../types/domain.js";
import { OpenCliRuntimeBuilder } from "./opencli-runtime-builder.js";
import type { OpenCliRuntimeProfileService } from "./opencli-runtime-profile-service.js";

export interface OpenCliRuntimeResolverOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  userProfile?: string | null;
}

export interface OpenCliSessionRuntimeResolution {
  availability: "disabled" | "unavailable" | "ready";
  runtimeRootPath: string | null;
  runtimeBinPath: string | null;
  realHome: string | null;
  realUserProfile: string | null;
  errorCode: string | null;
  errorDetail: string | null;
}

export class OpenCliRuntimeResolver {
  private readonly env: NodeJS.ProcessEnv;
  private readonly realHome: string | null;
  private readonly realUserProfile: string | null;

  constructor(
    private readonly providerRepository: OpenCliProviderRepository,
    private readonly runtimeProfileRepository: OpenCliRuntimeProfileRepository,
    private readonly runtimeProfileService: OpenCliRuntimeProfileService,
    private readonly runtimeBuilder: OpenCliRuntimeBuilder,
    options: OpenCliRuntimeResolverOptions = {}
  ) {
    this.env = options.env ?? process.env;
    this.realHome = normalizeOptionalValue(options.homeDir ?? os.homedir());
    this.realUserProfile = normalizeOptionalValue(options.userProfile ?? this.env.USERPROFILE ?? this.realHome);
  }

  resolveSessionRuntime(): OpenCliSessionRuntimeResolution {
    const provider = this.providerRepository.get();

    if (!provider.enabled) {
      return unavailableResolution("disabled");
    }

    const installPath = provider.installPath?.trim() ?? "";
    const version = provider.version?.trim() ?? "";

    if (provider.installState !== "installed" || !installPath || !version) {
      return unavailableResolution("unavailable");
    }

    try {
      const desiredProfile = this.runtimeProfileService.findOrCreateDesiredProfile();
      const resolvedProfile = this.runtimeBuilder.buildProfile(desiredProfile.profile);

      if (resolvedProfile.status !== "ready") {
        this.providerRepository.upsert({
          ...provider,
          activeRuntimeId: null,
          healthState: "runtime_build_failed",
          lastErrorCode: resolvedProfile.lastErrorCode,
          lastErrorDetail: resolvedProfile.lastErrorDetail
        });

        return {
          availability: "unavailable",
          runtimeRootPath: null,
          runtimeBinPath: null,
          realHome: this.realHome,
          realUserProfile: this.realUserProfile,
          errorCode: resolvedProfile.lastErrorCode,
          errorDetail: resolvedProfile.lastErrorDetail
        };
      }

      this.providerRepository.upsert({
        ...provider,
        activeRuntimeId: resolvedProfile.id,
        healthState: resolveHealthyStateAfterRuntimeReady(provider.healthState),
        lastErrorCode: null,
        lastErrorDetail: null
      });

      return {
        availability: "ready",
        runtimeRootPath: resolvedProfile.runtimeRootPath,
        runtimeBinPath: path.join(resolvedProfile.runtimeRootPath, "bin"),
        realHome: this.realHome,
        realUserProfile: this.realUserProfile,
        errorCode: null,
        errorDetail: null
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      this.providerRepository.upsert({
        ...provider,
        activeRuntimeId: null,
        healthState: "runtime_build_failed",
        lastErrorCode: "OPENCLI_RUNTIME_RESOLVE_FAILED",
        lastErrorDetail: detail
      });

      return {
        availability: "unavailable",
        runtimeRootPath: null,
        runtimeBinPath: null,
        realHome: this.realHome,
        realUserProfile: this.realUserProfile,
        errorCode: "OPENCLI_RUNTIME_RESOLVE_FAILED",
        errorDetail: detail
      };
    }
  }
}

function resolveHealthyStateAfterRuntimeReady(current: OpenCliHealthState): OpenCliHealthState {
  if (current === "runtime_build_failed") {
    return "binary_ready";
  }

  return current;
}

function unavailableResolution(
  availability: OpenCliSessionRuntimeResolution["availability"]
): OpenCliSessionRuntimeResolution {
  return {
    availability,
    runtimeRootPath: null,
    runtimeBinPath: null,
    realHome: null,
    realUserProfile: null,
    errorCode: null,
    errorDetail: null
  };
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
