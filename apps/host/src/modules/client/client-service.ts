import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

export interface ClientRuntimeConfigDto {
  platform: "desktop" | "web";
  hostBaseUrl: string;
  releaseChannel: "stable" | "beta";
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
}

export interface ReleaseManifestDto {
  channel: "stable" | "beta";
  platform: string;
  version: string;
  notes: string;
  packageUrl: string;
  signature: string;
  publishedAt: string;
}

export interface ServiceUpdateDto {
  channel: "stable" | "beta";
  packageName: string;
  registryUrl: string;
  packagePageUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  updateCommand: string;
}

export class ClientService {
  constructor(private readonly config: HostConfig) {}

  getRuntimeConfig(
    platform: "desktop" | "web",
    requestContext?: {
      readonly protocol?: string | null;
      readonly host?: string | null;
    }
  ): ClientRuntimeConfigDto {
    return {
      platform,
      hostBaseUrl: resolveClientHostBaseUrl(this.config, platform, requestContext),
      releaseChannel: this.config.releaseChannel,
      autoReconnect: true,
      autoCheckUpdate: platform === "desktop"
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
      const parsed = JSON.parse(raw) as Partial<ReleaseManifestDto>;

      if (
        !parsed.channel ||
        !parsed.platform ||
        !parsed.version ||
        !parsed.packageUrl ||
        !parsed.signature ||
        !parsed.publishedAt
      ) {
        throw new Error("manifest incomplete");
      }

      return {
        channel: parsed.channel,
        platform: parsed.platform,
        version: parsed.version,
        notes: parsed.notes ?? "",
        packageUrl: parsed.packageUrl,
        signature: parsed.signature,
        publishedAt: parsed.publishedAt
      };
    } catch {
      throw new AppError({
        statusCode: 500,
        errorCode: "MANIFEST_INVALID",
        detail: `桌面发布清单 ${manifestPath} 格式无效`
      });
    }
  }

  async getServiceUpdate(channel: "stable" | "beta"): Promise<ServiceUpdateDto> {
    const packageName = this.config.serverUpdatePackageName;
    const currentVersion = readHostPackageVersion();
    const packagePageUrl = `https://www.npmjs.com/package/${packageName}`;
    const registryUrl = buildRegistryPackageUrl(this.config.npmRegistryBaseUrl, packageName);

    try {
      const response = await fetch(registryUrl, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const raw = (await response.json()) as NpmRegistryPackageDocument;
      const latestVersion = pickServiceTargetVersion(raw, channel);

      return {
        channel,
        packageName,
        registryUrl,
        packagePageUrl,
        currentVersion,
        latestVersion,
        hasUpdate:
          latestVersion !== null && compareSemver(latestVersion, currentVersion) > 0,
        updateCommand: `npm install ${packageName}@${channel === "beta" ? "beta" : "latest"}`
      };
    } catch {
      return {
        channel,
        packageName,
        registryUrl,
        packagePageUrl,
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        updateCommand: `npm install ${packageName}@${channel === "beta" ? "beta" : "latest"}`
      };
    }
  }
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

interface NpmRegistryPackageDocument {
  readonly "dist-tags"?: Record<string, string | undefined>;
}

function readHostPackageVersion(): string {
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

function buildRegistryPackageUrl(baseUrl: string, packageName: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(encodeURIComponent(packageName), normalizedBaseUrl).toString();
}

function pickServiceTargetVersion(
  payload: NpmRegistryPackageDocument,
  channel: "stable" | "beta"
): string | null {
  const distTags = payload["dist-tags"] ?? {};

  if (channel === "beta") {
    return distTags.beta ?? distTags.latest ?? null;
  }

  return distTags.latest ?? null;
}

function compareSemver(left: string, right: string): number {
  const leftMeta = parseSemver(left);
  const rightMeta = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = (leftMeta.numbers[index] ?? 0) - (rightMeta.numbers[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  if (leftMeta.prerelease === rightMeta.prerelease) {
    return 0;
  }

  if (!leftMeta.prerelease) {
    return 1;
  }

  if (!rightMeta.prerelease) {
    return -1;
  }

  return leftMeta.prerelease.localeCompare(rightMeta.prerelease);
}

function parseSemver(input: string): {
  readonly numbers: [number, number, number];
  readonly prerelease: string;
} {
  const normalized = input.trim().replace(/^v/i, "");
  const [versionPart, prerelease = ""] = normalized.split("-", 2);
  const rawNumbers = versionPart.split(".");

  return {
    numbers: [
      Number.parseInt(rawNumbers[0] ?? "0", 10) || 0,
      Number.parseInt(rawNumbers[1] ?? "0", 10) || 0,
      Number.parseInt(rawNumbers[2] ?? "0", 10) || 0
    ],
    prerelease
  };
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
