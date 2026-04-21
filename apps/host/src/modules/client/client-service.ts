import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { HostCandidateEndpoint } from "../../types/domain.js";
import type { RelayTunnelService } from "../relay-tunnel/relay-tunnel-service.js";
import type { NpmGlobalPackageService } from "./npm-global-package-service.js";
import type { ServiceUpdateTaskService } from "./service-update-task-service.js";
import type { ServiceUpdateListDto, ServiceUpdateTaskDto } from "./service-update-types.js";

export interface ClientRuntimeConfigDto {
  platform: "desktop" | "web";
  hostBaseUrl: string;
  releaseChannel: "stable" | "beta";
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
  relayTunnel: ClientRuntimeRelayTunnelDto | null;
}

export interface ClientRuntimeRelayTunnelDto {
  provider: "codingns_relay";
  enabled: boolean;
  controlBaseUrl: string | null;
  tunnelDomain: string | null;
  bindingId: string | null;
  hostFingerprint: string | null;
  candidateEndpoints: HostCandidateEndpoint[];
}

export interface DesktopReleaseManifestDto {
  channel: "stable" | "beta";
  platform: string;
  version: string;
  notes: string;
  packageUrl: string;
  signature: string;
  publishedAt: string;
}

export interface AndroidReleaseManifestDto {
  channel: "stable" | "beta";
  version: string;
  versionCode: number;
  packageName: string;
  fileName: string;
  downloadUrl: string;
  sha256: string;
  publishedAt: string;
  notes: string;
  minSupportedVersionCode: number | null;
  htmlUrl: string | null;
}

export type ReleaseManifestDto = DesktopReleaseManifestDto | AndroidReleaseManifestDto;

export class ClientService {
  constructor(
    private readonly config: HostConfig,
    private readonly npmGlobalPackageService: NpmGlobalPackageService,
    private readonly serviceUpdateTaskService: ServiceUpdateTaskService,
    private readonly relayTunnelService: RelayTunnelService
  ) {}

  async getRuntimeConfig(
    platform: "desktop" | "web",
    requestContext?: {
      readonly protocol?: string | null;
      readonly host?: string | null;
    }
  ): Promise<ClientRuntimeConfigDto> {
    return {
      platform,
      hostBaseUrl: resolveClientHostBaseUrl(this.config, platform, requestContext),
      releaseChannel: this.config.releaseChannel,
      autoReconnect: true,
      autoCheckUpdate: platform === "desktop",
      relayTunnel: await this.getRelayTunnelRuntime()
    };
  }

  getReleaseManifest(
    channel: "stable" | "beta",
    platform: string
  ): ReleaseManifestDto {
    const manifestPath = path.resolve(this.config.releaseManifestRoot, channel, `${platform}.json`);

    if (!fs.existsSync(manifestPath)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "MANIFEST_NOT_FOUND",
        detail: `未找到 ${channel}/${platform} 的桌面发布清单`
      });
    }

    const raw = fs.readFileSync(manifestPath, "utf8");

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (platform === "android-apk") {
        return parseAndroidReleaseManifest(parsed);
      }

      return parseDesktopReleaseManifest(parsed);
    } catch {
      throw new AppError({
        statusCode: 500,
        errorCode: "MANIFEST_INVALID",
        detail: `发布清单 ${manifestPath} 格式无效`
      });
    }
  }

  async getServiceUpdate(channel: "stable" | "beta"): Promise<ServiceUpdateListDto> {
    const currentVersion = readHostPackageVersion();
    const packages = await this.npmGlobalPackageService.listManagedPackages(
      channel,
      currentVersion,
      (packageName) => this.serviceUpdateTaskService.getLatestTaskByPackageName(packageName)
    );

    return {
      channel,
      checkedAt: new Date().toISOString(),
      packages
    };
  }

  async installServiceUpdate(
    channel: "stable" | "beta",
    packageName: string
  ): Promise<ServiceUpdateTaskDto> {
    return await this.serviceUpdateTaskService.installPackage(channel, packageName);
  }

  getServiceUpdateTask(taskId: string): ServiceUpdateTaskDto {
    return this.serviceUpdateTaskService.getTask(taskId);
  }

  private async getRelayTunnelRuntime(): Promise<ClientRuntimeRelayTunnelDto | null> {
    const status = await this.relayTunnelService.getStatus();

    if (status.provider !== "codingns_relay") {
      return null;
    }

    return {
      provider: status.provider,
      enabled: status.enabled,
      controlBaseUrl: status.controlBaseUrl,
      tunnelDomain: status.tunnelDomain,
      bindingId: status.bindingId,
      hostFingerprint: status.hostFingerprint,
      candidateEndpoints: status.candidateEndpoints
    };
  }
}

function parseDesktopReleaseManifest(parsed: Record<string, unknown>): DesktopReleaseManifestDto {
  if (
    !isReleaseChannel(parsed.channel) ||
    !isNonEmptyString(parsed.platform) ||
    !isNonEmptyString(parsed.version) ||
    !isNonEmptyString(parsed.packageUrl) ||
    !isNonEmptyString(parsed.signature) ||
    !isNonEmptyString(parsed.publishedAt)
  ) {
    throw new Error("desktop manifest incomplete");
  }

  return {
    channel: parsed.channel,
    platform: parsed.platform,
    version: parsed.version,
    notes: isNonEmptyString(parsed.notes) ? parsed.notes : "",
    packageUrl: parsed.packageUrl,
    signature: parsed.signature,
    publishedAt: parsed.publishedAt
  };
}

function parseAndroidReleaseManifest(parsed: Record<string, unknown>): AndroidReleaseManifestDto {
  if (
    !isReleaseChannel(parsed.channel) ||
    !isNonEmptyString(parsed.version) ||
    !isPositiveInteger(parsed.versionCode) ||
    !isNonEmptyString(parsed.packageName) ||
    !isNonEmptyString(parsed.fileName) ||
    !isNonEmptyString(parsed.downloadUrl) ||
    !isNonEmptyString(parsed.sha256) ||
    !isNonEmptyString(parsed.publishedAt)
  ) {
    throw new Error("android manifest incomplete");
  }

  return {
    channel: parsed.channel,
    version: parsed.version,
    versionCode: parsed.versionCode,
    packageName: parsed.packageName,
    fileName: parsed.fileName,
    downloadUrl: parsed.downloadUrl,
    sha256: parsed.sha256,
    publishedAt: parsed.publishedAt,
    notes: isNonEmptyString(parsed.notes) ? parsed.notes : "",
    minSupportedVersionCode: isPositiveInteger(parsed.minSupportedVersionCode)
      ? parsed.minSupportedVersionCode
      : null,
    htmlUrl: isNonEmptyString(parsed.htmlUrl) ? parsed.htmlUrl : null
  };
}

function isReleaseChannel(value: unknown): value is "stable" | "beta" {
  return value === "stable" || value === "beta";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function resolveClientHostBaseUrl(
  config: HostConfig,
  platform: "desktop" | "web",
  requestContext?: {
    readonly protocol?: string | null;
    readonly host?: string | null;
  }
): string {
  if (platform === "web") {
    const requestHost = requestContext?.host?.trim();
    const requestProtocol = normalizeHttpProtocol(requestContext?.protocol);

    if (requestHost) {
      return `${requestProtocol}://${requestHost}`;
    }
  }

  return `http://${resolveAccessibleHost(config.host)}:${config.port}`;
}

function normalizeHttpProtocol(value: string | null | undefined): "http" | "https" {
  return value?.toLowerCase() === "https" ? "https" : "http";
}

function resolveAccessibleHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "::0") {
    return "127.0.0.1";
  }

  return host;
}

export function readHostPackageVersion(): string {
  const packageJsonPath = findNearestPackageJson(fileURLToPath(import.meta.url));

  if (!packageJsonPath) {
    return "0.0.0";
  }

  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return typeof parsed.version === "string" && parsed.version.trim().length > 0
    ? parsed.version
    : "0.0.0";
}

function findNearestPackageJson(fromFilePath: string): string | null {
  let currentDir = path.dirname(fromFilePath);

  while (true) {
    const candidate = path.join(currentDir, "package.json");

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}
