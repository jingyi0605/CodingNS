import type { ProviderId } from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { resolveCommandVersion } from "../../shared/utils/command-version.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ProviderRuntimeStateRepository } from "../../storage/repositories/provider-runtime-state-repository.js";
import type { ProviderInstallState, ProviderRuntimeStateRecord } from "../../types/domain.js";

export interface ProviderRuntimeStateSnapshot {
  provider: ProviderId;
  installState: ProviderInstallState;
  version: string | null;
  commandPath: string | null;
  updatedAt: string;
}

export class ProviderRuntimeStateService {
  private readonly providerIds: ProviderId[] = [
    "claude-code",
    "legna-code",
    "codex",
    "gemini",
    "kimi",
    "opencode",
    "deepseek-harness"
  ];
  private readonly providerInstallCommands: Readonly<Partial<Record<ProviderId, string>>>;
  private readonly stateByProvider = new Map<ProviderId, ProviderRuntimeStateSnapshot>();

  constructor(
    config: HostConfig,
    private readonly repository: Pick<ProviderRuntimeStateRepository, "get" | "list" | "upsert"> | null = null
  ) {
    this.providerInstallCommands = {
      "claude-code": process.platform === "win32" ? "claude.cmd" : "claude",
      "legna-code": config.legnaCodeCliPath,
      codex: config.codexCliPath,
      gemini: config.geminiCliPath,
      kimi: config.kimiCliPath,
      opencode: config.opencodeCliPath,
      "deepseek-harness": config.deepseekHarnessCliPath
    };

    this.hydrateFromRepository();
    this.refreshAll();
  }

  listStates(): ProviderRuntimeStateSnapshot[] {
    return this.providerIds.map((provider) => this.getState(provider));
  }

  getState(provider: string): ProviderRuntimeStateSnapshot {
    const normalizedProvider = provider.trim() as ProviderId;
    const cached = this.stateByProvider.get(normalizedProvider);

    if (cached) {
      return cached;
    }

    const persisted = this.repository?.get(normalizedProvider);
    const snapshot = persisted
      ? mapRecordToSnapshot(persisted)
      : createUnknownSnapshot(normalizedProvider);

    this.stateByProvider.set(normalizedProvider, snapshot);
    return snapshot;
  }

  refreshAll(): ProviderRuntimeStateSnapshot[] {
    const refreshed = this.providerIds.map((provider) => this.refreshProvider(provider));
    return refreshed;
  }

  refreshProvider(provider: string): ProviderRuntimeStateSnapshot {
    const normalizedProvider = provider.trim() as ProviderId;
    const snapshot = this.probeProvider(normalizedProvider);

    this.stateByProvider.set(normalizedProvider, snapshot);
    this.repository?.upsert(mapSnapshotToRecord(snapshot));

    return snapshot;
  }

  isProviderCliAvailable(provider: string): boolean {
    return this.getState(provider).installState === "ready";
  }

  private hydrateFromRepository(): void {
    const records = this.repository?.list() ?? [];

    for (const record of records) {
      this.stateByProvider.set(record.providerId as ProviderId, mapRecordToSnapshot(record));
    }
  }

  private probeProvider(provider: ProviderId): ProviderRuntimeStateSnapshot {
    const updatedAt = nowIso();
    const configuredCommandPath = this.providerInstallCommands[provider];

    if (!configuredCommandPath) {
      return {
        provider,
        installState: "unknown",
        version: null,
        commandPath: null,
        updatedAt
      };
    }

    const resolvedCommandPath = resolveAvailableCommandPath(configuredCommandPath);

    if (!resolvedCommandPath) {
      return {
        provider,
        installState: "missing",
        version: null,
        commandPath: null,
        updatedAt
      };
    }

    return {
      provider,
      installState: "ready",
      version: resolveProviderVersion(resolvedCommandPath),
      commandPath: resolvedCommandPath,
      updatedAt
    };
  }
}

export const resolveProviderVersion = resolveCommandVersion;

function createUnknownSnapshot(provider: ProviderId): ProviderRuntimeStateSnapshot {
  return {
    provider,
    installState: "unknown",
    version: null,
    commandPath: null,
    updatedAt: ""
  };
}

function mapRecordToSnapshot(record: ProviderRuntimeStateRecord): ProviderRuntimeStateSnapshot {
  return {
    provider: record.providerId as ProviderId,
    installState: record.installState,
    version: record.version,
    commandPath: null,
    updatedAt: record.updatedAt
  };
}

function mapSnapshotToRecord(snapshot: ProviderRuntimeStateSnapshot): ProviderRuntimeStateRecord {
  return {
    providerId: snapshot.provider,
    installState: snapshot.installState,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt
  };
}
