import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import { nowIso } from "../../shared/utils/time.js";
import type {
  OpenCliCatalogEntryRecord,
  OpenCliCatalogSource,
  OpenCliHealthState,
  OpenCliProviderRecord
} from "../../types/domain.js";
import type { OpenCliCatalogEntryRepository } from "../../storage/repositories/opencli-catalog-entry-repository.js";
import type { OpenCliProviderRepository } from "../../storage/repositories/opencli-provider-repository.js";
import {
  OpenCliInstallDiscovery,
  type OpenCliInstallDiscoveryResult
} from "./opencli-install-discovery.js";

export interface OpenCliCatalogSiteGroup {
  site: string;
  totalCount: number;
  enabledCount: number;
  browserDependentCount: number;
  commands: OpenCliCatalogEntryRecord[];
}

export interface OpenCliCatalogSummary {
  catalogCount: number;
  enabledCount: number;
  browserDependentCount: number;
  installState: OpenCliProviderRecord["installState"];
  healthState: OpenCliProviderRecord["healthState"];
}

export interface OpenCliCatalogSnapshot {
  provider: OpenCliProviderRecord;
  entries: OpenCliCatalogEntryRecord[];
  siteGroups: OpenCliCatalogSiteGroup[];
  summary: OpenCliCatalogSummary;
  effectiveCatalogSource: OpenCliCatalogSource | null;
}

export interface OpenCliCatalogRefreshResult extends OpenCliCatalogSnapshot {
  refreshState: "fresh" | "cache_retained" | "unavailable";
  errorCode: string | null;
  errorDetail: string | null;
}

export interface OpenCliInstallDiscoveryPort {
  discover(): OpenCliInstallDiscoveryResult;
}

export interface OpenCliCatalogServiceOptions {
  now?: () => string;
  commandRunner?: OpenCliCommandRunner;
}

type OpenCliCommandRunner = (binaryPath: string, args: readonly string[]) => Promise<string>;

interface NormalizedCatalogEntry {
  commandId: string;
  site: string;
  name: string;
  description: string;
  strategy: string;
  browser: boolean;
  modulePath: string | null;
  sourceFile: string | null;
}

interface OpenCliCatalogFailure {
  code: string;
  detail: string;
}

export class OpenCliCatalogService {
  private readonly now: () => string;
  private readonly commandRunner: OpenCliCommandRunner;

  constructor(
    private readonly providerRepository: OpenCliProviderRepository,
    private readonly catalogEntryRepository: OpenCliCatalogEntryRepository,
    private readonly installDiscovery: OpenCliInstallDiscoveryPort = new OpenCliInstallDiscovery(),
    options: OpenCliCatalogServiceOptions = {}
  ) {
    this.now = options.now ?? nowIso;
    this.commandRunner = options.commandRunner ?? runOpenCliCommand;
  }

  getSnapshot(): OpenCliCatalogSnapshot {
    const provider = this.providerRepository.get();
    const entries = this.catalogEntryRepository.list();

    return buildCatalogSnapshot(provider, entries, provider.catalogSource);
  }

  async refreshCatalog(): Promise<OpenCliCatalogRefreshResult> {
    const currentProvider = this.providerRepository.get();
    const cachedEntries = this.catalogEntryRepository.list();
    const discovery = this.installDiscovery.discover();
    const refreshedAt = this.now();
    const manifestFailure: OpenCliCatalogFailure[] = [];

    if (discovery.manifestSource) {
      try {
        const manifestEntries = await readManifestEntries(discovery.manifestSource.manifestPath);
        return this.persistFreshCatalog({
          currentProvider,
          cachedEntries,
          discovery,
          refreshedAt,
          source: discovery.manifestSource.kind,
          normalizedEntries: manifestEntries
        });
      } catch (error) {
        manifestFailure.push({
          code: "OPENCLI_MANIFEST_READ_FAILED",
          detail: toErrorDetail(
            `读取 ${discovery.manifestSource.kind === "manifest" ? "安装目录" : "本地目录"} manifest 失败`,
            error
          )
        });
      }
    }

    if (discovery.binaryPath) {
      try {
        const cliListEntries = await readCliListEntries(discovery.binaryPath, this.commandRunner);
        return this.persistFreshCatalog({
          currentProvider,
          cachedEntries,
          discovery,
          refreshedAt,
          source: "cli_list",
          normalizedEntries: cliListEntries
        });
      } catch (error) {
        manifestFailure.push({
          code: "OPENCLI_LIST_FAILED",
          detail: toErrorDetail("执行 opencli list -f json 失败", error)
        });
      }
    }

    const failure = resolveRefreshFailure(discovery, manifestFailure);
    const provider = this.providerRepository.upsert({
      ...currentProvider,
      installState: discovery.installState,
      healthState: resolveHealthState(currentProvider, discovery),
      version: discovery.version,
      installPath: discovery.installPath,
      lastCheckedAt: refreshedAt,
      lastErrorCode: failure.code,
      lastErrorDetail: failure.detail
    });
    const refreshState = cachedEntries.length > 0 ? "cache_retained" : "unavailable";
    const snapshot = buildCatalogSnapshot(
      provider,
      cachedEntries,
      refreshState === "cache_retained" ? "cache" : null
    );

    return {
      ...snapshot,
      refreshState,
      errorCode: failure.code,
      errorDetail: failure.detail
    };
  }

  private persistFreshCatalog(input: {
    currentProvider: OpenCliProviderRecord;
    cachedEntries: readonly OpenCliCatalogEntryRecord[];
    discovery: OpenCliInstallDiscoveryResult;
    refreshedAt: string;
    source: Extract<OpenCliCatalogSource, "manifest" | "cli_list" | "local_manifest">;
    normalizedEntries: readonly NormalizedCatalogEntry[];
  }): OpenCliCatalogRefreshResult {
    const enabledByCommandId = new Map(
      input.cachedEntries.map((entry) => [entry.commandId, entry.enabled] as const)
    );
    const entries = input.normalizedEntries.map((entry, index) => ({
      providerId: "opencli" as const,
      commandId: entry.commandId,
      site: entry.site,
      name: entry.name,
      description: entry.description,
      strategy: entry.strategy,
      browser: entry.browser,
      modulePath: entry.modulePath,
      sourceFile: entry.sourceFile,
      enabled: enabledByCommandId.get(entry.commandId) ?? true,
      sortOrder: index
    }));
    const provider = this.providerRepository.upsert({
      ...input.currentProvider,
      installState: input.discovery.installState,
      healthState: resolveHealthState(input.currentProvider, input.discovery),
      version: input.discovery.version,
      installPath: input.discovery.installPath,
      lastCheckedAt: input.refreshedAt,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: input.refreshedAt,
      catalogSource: input.source
    });

    this.catalogEntryRepository.replaceAll("opencli", entries);

    const snapshot = buildCatalogSnapshot(provider, entries, input.source);

    return {
      ...snapshot,
      refreshState: "fresh",
      errorCode: null,
      errorDetail: null
    };
  }
}

async function readManifestEntries(manifestPath: string): Promise<NormalizedCatalogEntry[]> {
  const content = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(content) as unknown;

  return normalizeCatalogEntries(parsed, "manifest");
}

async function readCliListEntries(
  binaryPath: string,
  commandRunner: OpenCliCommandRunner
): Promise<NormalizedCatalogEntry[]> {
  const content = await commandRunner(binaryPath, ["list", "-f", "json"]);
  const parsed = JSON.parse(content) as unknown;

  return normalizeCatalogEntries(parsed, "cli_list");
}

function normalizeCatalogEntries(
  rawEntries: unknown,
  source: Extract<OpenCliCatalogSource, "manifest" | "cli_list" | "local_manifest">
): NormalizedCatalogEntry[] {
  if (!Array.isArray(rawEntries)) {
    throw new Error("目录数据不是数组");
  }

  const normalized = new Map<string, NormalizedCatalogEntry>();

  rawEntries.forEach((rawEntry) => {
    const entry =
      source === "cli_list"
        ? normalizeCliListEntry(rawEntry)
        : normalizeManifestEntry(rawEntry);

    if (!entry) {
      return;
    }

    normalized.set(entry.commandId, entry);
  });

  const entries = [...normalized.values()].sort((left, right) => {
    const siteCompare = left.site.localeCompare(right.site);

    if (siteCompare !== 0) {
      return siteCompare;
    }

    const nameCompare = left.name.localeCompare(right.name);

    if (nameCompare !== 0) {
      return nameCompare;
    }

    return left.commandId.localeCompare(right.commandId);
  });

  if (entries.length === 0) {
    throw new Error("目录数据为空");
  }

  return entries;
}

function normalizeManifestEntry(rawEntry: unknown): NormalizedCatalogEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const site = readRequiredString(rawEntry.site);
  const name = readRequiredString(rawEntry.name);

  if (!site || !name) {
    return null;
  }

  return {
    commandId: `${site}/${name}`,
    site,
    name,
    description: readOptionalString(rawEntry.description) ?? "",
    strategy: readOptionalString(rawEntry.strategy) ?? "unknown",
    browser: Boolean(rawEntry.browser),
    modulePath: readOptionalString(rawEntry.modulePath),
    sourceFile: readOptionalString(rawEntry.sourceFile)
  };
}

function normalizeCliListEntry(rawEntry: unknown): NormalizedCatalogEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const commandId = readOptionalString(rawEntry.command);
  const explicitSite = readOptionalString(rawEntry.site);
  const explicitName = readOptionalString(rawEntry.name);
  const site = explicitSite ?? parseCommandPart(commandId, 0);
  const name = explicitName ?? parseCommandPart(commandId, 1);

  if (!site || !name) {
    return null;
  }

  return {
    commandId: commandId ?? `${site}/${name}`,
    site,
    name,
    description: readOptionalString(rawEntry.description) ?? "",
    strategy: readOptionalString(rawEntry.strategy) ?? "unknown",
    browser: Boolean(rawEntry.browser),
    modulePath: null,
    sourceFile: null
  };
}

function buildCatalogSnapshot(
  provider: OpenCliProviderRecord,
  entries: readonly OpenCliCatalogEntryRecord[],
  effectiveCatalogSource: OpenCliCatalogSource | null
): OpenCliCatalogSnapshot {
  const siteGroups = buildSiteGroups(entries);

  return {
    provider,
    entries: [...entries],
    siteGroups,
    summary: {
      catalogCount: entries.length,
      enabledCount: entries.filter((entry) => entry.enabled).length,
      browserDependentCount: entries.filter((entry) => entry.browser).length,
      installState: provider.installState,
      healthState: provider.healthState
    },
    effectiveCatalogSource
  };
}

function buildSiteGroups(entries: readonly OpenCliCatalogEntryRecord[]): OpenCliCatalogSiteGroup[] {
  const grouped = new Map<string, OpenCliCatalogEntryRecord[]>();

  entries.forEach((entry) => {
    const bucket = grouped.get(entry.site);

    if (bucket) {
      bucket.push(entry);
      return;
    }

    grouped.set(entry.site, [entry]);
  });

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([site, commands]) => ({
      site,
      totalCount: commands.length,
      enabledCount: commands.filter((command) => command.enabled).length,
      browserDependentCount: commands.filter((command) => command.browser).length,
      commands: [...commands].sort((left, right) => left.sortOrder - right.sortOrder)
    }));
}

function resolveHealthState(
  currentProvider: OpenCliProviderRecord,
  discovery: OpenCliInstallDiscoveryResult
): OpenCliHealthState {
  if (discovery.installState !== "installed") {
    return "unknown";
  }

  if (
    currentProvider.healthState === "bridge_missing"
    || currentProvider.healthState === "ready"
    || currentProvider.healthState === "runtime_build_failed"
  ) {
    return currentProvider.healthState;
  }

  return "binary_ready";
}

function resolveRefreshFailure(
  discovery: OpenCliInstallDiscoveryResult,
  failures: readonly OpenCliCatalogFailure[]
): OpenCliCatalogFailure {
  if (failures.length > 0) {
    if (failures.length === 1) {
      return failures[0];
    }

    return {
      code: "OPENCLI_CATALOG_REFRESH_FAILED",
      detail: failures.map((failure) => `[${failure.code}] ${failure.detail}`).join("；")
    };
  }

  if (discovery.installState === "not_installed") {
    return {
      code: "OPENCLI_NOT_INSTALLED",
      detail: "当前机器未发现 opencli 可执行文件，也没有可读取的本地 cli-manifest.json"
    };
  }

  return {
    code: "OPENCLI_CATALOG_UNAVAILABLE",
    detail: "当前无法读取 OpenCLI 目录"
  };
}

function readRequiredString(value: unknown): string | null {
  const normalized = readOptionalString(value);
  return normalized && normalized.length > 0 ? normalized : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseCommandPart(commandId: string | null, index: number): string | null {
  if (!commandId) {
    return null;
  }

  const parts = commandId
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts[index] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorDetail(prefix: string, error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `${prefix}：${error.message.trim()}`;
  }

  return prefix;
}

async function runOpenCliCommand(binaryPath: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 20_000);

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish(() => resolve(stdout));
        return;
      }

      const detail = stderr.trim() || stdout.trim() || "无输出";

      finish(() => {
        reject(
          new Error(
            signal
              ? `${detail} (signal=${signal})`
              : `${detail} (exitCode=${code ?? "null"})`
          )
        );
      });
    });
  });
}
