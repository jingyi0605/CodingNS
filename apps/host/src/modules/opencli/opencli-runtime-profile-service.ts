import path from "node:path";

import { hashContent } from "../../shared/utils/hash.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  OpenCliCatalogEntryRecord,
  OpenCliProviderRecord,
  OpenCliRuntimeProfileRecord
} from "../../types/domain.js";
import type { OpenCliCatalogEntryRepository } from "../../storage/repositories/opencli-catalog-entry-repository.js";
import type { OpenCliProviderRepository } from "../../storage/repositories/opencli-provider-repository.js";
import type { OpenCliRuntimeProfileRepository } from "../../storage/repositories/opencli-runtime-profile-repository.js";
import { resolveOpenCliRuntimeRoot } from "./opencli-runtime-layout.js";

export interface OpenCliRuntimeProfileServiceOptions {
  now?: () => string;
  runtimeStorageRootPath: string;
}

export interface OpenCliDesiredRuntimeProfile {
  provider: OpenCliProviderRecord;
  enabledCommandIds: string[];
  contentHash: string;
  profile: OpenCliRuntimeProfileRecord;
}

export class OpenCliRuntimeProfileService {
  private readonly now: () => string;
  private readonly runtimeStorageRootPath: string;

  constructor(
    private readonly providerRepository: OpenCliProviderRepository,
    private readonly catalogEntryRepository: OpenCliCatalogEntryRepository,
    private readonly runtimeProfileRepository: OpenCliRuntimeProfileRepository,
    options: OpenCliRuntimeProfileServiceOptions
  ) {
    this.now = options.now ?? nowIso;
    this.runtimeStorageRootPath = path.resolve(options.runtimeStorageRootPath);
  }

  findOrCreateDesiredProfile(): OpenCliDesiredRuntimeProfile {
    const provider = this.providerRepository.get();
    const source = assertInstalledSource(provider);
    const catalogEntries = this.catalogEntryRepository.list();
    const enabledCommandIds = collectEnabledCommandIds(catalogEntries);
    const contentHash = computeOpenCliRuntimeProfileHash({
      version: source.version,
      sourceInstallPath: source.installPath,
      enabledCommandIds
    });

    this.markOutdatedProfilesAsStale(source.installPath, source.version);

    const existingProfile = this.runtimeProfileRepository.findByContentHash(contentHash);

    if (existingProfile) {
      return {
        provider,
        enabledCommandIds,
        contentHash,
        profile: existingProfile
      };
    }

    const timestamp = this.now();
    const profileId = `opencli-runtime-${contentHash.slice(0, 16)}`;
    const profile = this.runtimeProfileRepository.upsert({
      id: profileId,
      version: source.version,
      sourceInstallPath: source.installPath,
      enabledCommandIdsJson: JSON.stringify(enabledCommandIds),
      runtimeRootPath: resolveOpenCliRuntimeRoot(this.runtimeStorageRootPath, profileId),
      status: "pending",
      contentHash,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastErrorCode: null,
      lastErrorDetail: null
    });

    return {
      provider,
      enabledCommandIds,
      contentHash,
      profile
    };
  }

  private markOutdatedProfilesAsStale(sourceInstallPath: string, version: string): void {
    const profiles = this.runtimeProfileRepository.list();

    for (const profile of profiles) {
      if (
        profile.status === "stale"
        || (profile.sourceInstallPath === sourceInstallPath && profile.version === version)
      ) {
        continue;
      }

      this.runtimeProfileRepository.upsert({
        ...profile,
        status: "stale",
        updatedAt: this.now()
      });
    }
  }
}

export function computeOpenCliRuntimeProfileHash(input: {
  version: string;
  sourceInstallPath: string;
  enabledCommandIds: readonly string[];
}): string {
  return hashContent(
    JSON.stringify({
      version: input.version,
      sourceInstallPath: input.sourceInstallPath,
      enabledCommandIds: [...input.enabledCommandIds]
    })
  );
}

function collectEnabledCommandIds(entries: readonly OpenCliCatalogEntryRecord[]): string[] {
  return entries
    .filter((entry) => entry.enabled)
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.commandId.localeCompare(right.commandId);
    })
    .map((entry) => entry.commandId);
}

function assertInstalledSource(provider: OpenCliProviderRecord): {
  installPath: string;
  version: string;
} {
  const installPath = provider.installPath?.trim() ?? "";
  const version = provider.version?.trim() ?? "";

  if (provider.installState !== "installed" || !installPath || !version) {
    throw new Error("OPENCLI_RUNTIME_SOURCE_UNAVAILABLE");
  }

  return {
    installPath,
    version
  };
}
