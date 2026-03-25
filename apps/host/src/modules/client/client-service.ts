import fs from "node:fs";
import path from "node:path";

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

export class ClientService {
  constructor(private readonly config: HostConfig) {}

  getRuntimeConfig(platform: "desktop" | "web"): ClientRuntimeConfigDto {
    return {
      platform,
      hostBaseUrl: `http://${this.config.host}:${this.config.port}`,
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
}
