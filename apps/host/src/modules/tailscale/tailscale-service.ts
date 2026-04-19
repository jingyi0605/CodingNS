import path from "node:path";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { InstanceTailscaleRepository } from "../../storage/repositories/instance-tailscale-repository.js";
import type {
  InstanceTailscaleConfig,
  InstanceTailscaleStatus,
  TailscalePhase
} from "../../types/domain.js";
import type { TailscaleManager } from "./tailscale-manager.js";

export interface TailscaleConfigUpdateInput {
  activated?: boolean;
  controlServerUrl?: string | null;
  hostname?: string | null;
}

export interface InstanceTailscaleStatusDto {
  activated: boolean;
  enabled: boolean;
  controlServerUrl: string | null;
  hostname: string | null;
  phase: TailscalePhase;
  connected: boolean;
  loginUrl: string | null;
  accountName: string | null;
  tailnetFqdn: string | null;
  tailnetIpv4: string | null;
  tailnetIpv6: string | null;
  reachableBaseUrl: string | null;
  lastError: string | null;
  observedAt: string | null;
  updatedAt: string | null;
}

interface TailscaleStateSnapshot {
  config: InstanceTailscaleConfig;
  hasPersistedConfig: boolean;
}

export class TailscaleService {
  private readonly defaultStateDir: string;

  constructor(
    private readonly db: Database.Database,
    private readonly repository: InstanceTailscaleRepository,
    private readonly manager: TailscaleManager,
    options: {
      defaultStateDir?: string;
      databasePath: string;
    }
  ) {
    this.defaultStateDir = options.defaultStateDir
      ?? path.join(path.dirname(options.databasePath), "tailscale-state");
  }

  async restoreOnStartup(): Promise<void> {
    const snapshot = this.readStateSnapshot();

    if (!snapshot.hasPersistedConfig || !snapshot.config.activated) {
      return;
    }

    if (!snapshot.config.enabled) {
      this.manager.getStatusSync(snapshot.config);
      return;
    }

    await this.manager.restore(snapshot.config);
  }

  async getStatus(): Promise<InstanceTailscaleStatusDto> {
    const snapshot = this.readStateSnapshot();
    return this.buildStatusDto(snapshot, await this.manager.getStatus(snapshot.config));
  }

  async updateConfig(input: TailscaleConfigUpdateInput): Promise<InstanceTailscaleStatusDto> {
    const snapshot = this.readStateSnapshot();
    const timestamp = nowIso();
    const nextConfig: InstanceTailscaleConfig = {
      ...snapshot.config,
      activated:
        input.activated !== undefined
          ? input.activated
          : snapshot.config.activated,
      controlServerUrl:
        input.controlServerUrl !== undefined
          ? normalizeControlServerUrl(input.controlServerUrl)
          : snapshot.config.controlServerUrl,
      hostname:
        input.hostname !== undefined
          ? normalizeHostname(input.hostname)
          : snapshot.config.hostname,
      enabled:
        input.activated === false
          ? false
          : snapshot.config.enabled,
      updatedAt: timestamp
    };

    this.repository.upsertConfig(nextConfig);

    if (!nextConfig.activated) {
      const status = snapshot.config.enabled
        ? await this.manager.disable(nextConfig)
        : this.manager.getStatusSync(nextConfig);
      return this.buildStatusDto(
        {
          config: nextConfig,
          hasPersistedConfig: true
        },
        status
      );
    }

    if (nextConfig.enabled) {
      await this.manager.syncConfig(nextConfig);
    }

    return await this.getStatus();
  }

  async enable(): Promise<InstanceTailscaleStatusDto> {
    const snapshot = this.readStateSnapshot();
    const timestamp = nowIso();
    const nextConfig: InstanceTailscaleConfig = {
      ...snapshot.config,
      activated: true,
      enabled: true,
      updatedAt: timestamp
    };
    this.repository.upsertConfig(nextConfig);
    const status = await this.manager.enable(nextConfig);
    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      status
    );
  }

  async disable(): Promise<InstanceTailscaleStatusDto> {
    const snapshot = this.readStateSnapshot();
    const timestamp = nowIso();
    const nextConfig: InstanceTailscaleConfig = {
      ...snapshot.config,
      activated: true,
      enabled: false,
      updatedAt: timestamp
    };

    this.repository.upsertConfig(nextConfig);
    const status = await this.manager.disable(nextConfig);
    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      status
    );
  }

  async login(): Promise<InstanceTailscaleStatusDto> {
    const snapshot = this.readStateSnapshot();

    if (!snapshot.config.enabled) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TAILSCALE_NOT_ENABLED",
        detail: "当前实例尚未启用 Tailscale"
      });
    }

    const status = await this.manager.requestLogin(snapshot.config);
    return this.buildStatusDto(snapshot, status);
  }

  async logout(): Promise<InstanceTailscaleStatusDto> {
    const snapshot = this.readStateSnapshot();
    const status = await this.manager.logout(snapshot.config);
    return this.buildStatusDto(snapshot, status);
  }

  private readStateSnapshot(): TailscaleStateSnapshot {
    const persistedConfig = this.repository.findConfig();

    return {
      config:
        persistedConfig
        ?? {
          activated: false,
          enabled: false,
          controlServerUrl: null,
          hostname: null,
          stateDir: this.defaultStateDir,
          updatedAt: nowIso()
        },
      hasPersistedConfig: persistedConfig !== null
    };
  }

  private buildStatusDto(
    snapshot: TailscaleStateSnapshot,
    effectiveStatus: InstanceTailscaleStatus
  ): InstanceTailscaleStatusDto {
    return {
      activated: snapshot.config.activated,
      enabled: snapshot.config.enabled,
      controlServerUrl: snapshot.config.controlServerUrl,
      hostname: snapshot.config.hostname,
      phase: effectiveStatus.phase,
      connected: effectiveStatus.connected,
      loginUrl: effectiveStatus.loginUrl,
      accountName: effectiveStatus.accountName,
      tailnetFqdn: effectiveStatus.tailnetFqdn,
      tailnetIpv4: effectiveStatus.tailnetIpv4,
      tailnetIpv6: effectiveStatus.tailnetIpv6,
      reachableBaseUrl: effectiveStatus.reachableBaseUrl,
      lastError: effectiveStatus.lastError,
      observedAt: effectiveStatus.observedAt,
      updatedAt: snapshot.hasPersistedConfig ? snapshot.config.updatedAt : null
    };
  }
}

function normalizeControlServerUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "controlServerUrl 必须是合法的 http 或 https 地址",
      field: "controlServerUrl"
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "controlServerUrl 只允许使用 http 或 https 协议",
      field: "controlServerUrl"
    });
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "controlServerUrl 不能包含账号、查询参数或 hash",
      field: "controlServerUrl"
    });
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

function normalizeHostname(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length > 63) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "hostname 最长不能超过 63 个字符",
      field: "hostname"
    });
  }

  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(normalized)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "hostname 只允许字母、数字和连字符，且不能以连字符开头或结尾",
      field: "hostname"
    });
  }

  return normalized;
}
