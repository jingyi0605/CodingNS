import { spawnSync } from "node:child_process";

import type { ProviderId } from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ProviderRuntimeStateRepository } from "../../storage/repositories/provider-runtime-state-repository.js";
import type { ProviderInstallState, ProviderRuntimeStateRecord } from "../../types/domain.js";

export interface ProviderRuntimeStateSnapshot {
  provider: ProviderId;
  installState: ProviderInstallState;
  version: string | null;
  updatedAt: string;
}

const VERSION_COMMAND_ARGUMENTS: string[][] = [["--version"], ["-V"], ["version"]];
const VERSION_PATTERN = /\bv?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?\b/;

export class ProviderRuntimeStateService {
  private readonly providerIds: ProviderId[] = [
    "claude-code",
    "legna-code",
    "codex",
    "gemini",
    "kimi",
    "opencode"
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
      opencode: config.opencodeCliPath
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
        updatedAt
      };
    }

    const resolvedCommandPath = resolveAvailableCommandPath(configuredCommandPath);

    if (!resolvedCommandPath) {
      return {
        provider,
        installState: "missing",
        version: null,
        updatedAt
      };
    }

    return {
      provider,
      installState: "ready",
      version: resolveProviderVersion(resolvedCommandPath),
      updatedAt
    };
  }
}

export function resolveProviderVersion(commandPath: string): string | null {
  for (const args of VERSION_COMMAND_ARGUMENTS) {
    const launch = resolveCommandLaunch(commandPath, args);
    const result = spawnSync(launch.command, launch.args, {
      encoding: "utf8",
      timeout: 1_500,
      windowsHide: true,
      shell: launch.shell
    });
    const version = parseProviderVersionOutput(result.stdout, result.stderr);

    if (version) {
      return version;
    }
  }

  return null;
}

function parseProviderVersionOutput(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();

  if (!output) {
    return null;
  }

  const match = output.match(VERSION_PATTERN);
  return match?.[0] ?? null;
}

function createUnknownSnapshot(provider: ProviderId): ProviderRuntimeStateSnapshot {
  return {
    provider,
    installState: "unknown",
    version: null,
    updatedAt: ""
  };
}

function mapRecordToSnapshot(record: ProviderRuntimeStateRecord): ProviderRuntimeStateSnapshot {
  return {
    provider: record.providerId as ProviderId,
    installState: record.installState,
    version: record.version,
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
