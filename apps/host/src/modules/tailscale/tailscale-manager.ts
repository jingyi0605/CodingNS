import { EventEmitter } from "node:events";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { BootstrapStateRepository } from "../../storage/repositories/bootstrap-state-repository.js";
import type { InstanceTailscaleRepository } from "../../storage/repositories/instance-tailscale-repository.js";
import type {
  InstanceTailscaleConfig,
  InstanceTailscaleStatus,
  TailscalePhase
} from "../../types/domain.js";
import type {
  TailscaleHelperClient,
  TailscaleHelperSnapshot
} from "./tailscale-helper-client.js";

interface TransitionOverrides {
  loginUrl?: string | null;
  accountName?: string | null;
  tailnetFqdn?: string | null;
  tailnetIpv4?: string | null;
  tailnetIpv6?: string | null;
  reachableBaseUrl?: string | null;
  lastError?: string | null;
}

export class TailscaleManager extends EventEmitter {
  private currentStatus: InstanceTailscaleStatus | null;

  constructor(
    private readonly bootstrapStateRepository: BootstrapStateRepository,
    private readonly repository: InstanceTailscaleRepository,
    private readonly helperClient: TailscaleHelperClient,
    private readonly options: {
      commandPath: string;
      webUiPort: number;
    }
  ) {
    super();
    this.currentStatus = this.repository.findStatus();
  }

  async getStatus(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus> {
    if (!config.enabled) {
      const resolved = this.resolveEffectiveStatus(config);
      this.currentStatus = resolved;
      return resolved;
    }

    if (!this.isInitialized()) {
      const resolved = this.resolveEffectiveStatus(config);
      this.currentStatus = resolved;
      return resolved;
    }

    try {
      const snapshot = await this.helperClient.inspectStatus({
        commandPath: this.options.commandPath
      });
      return this.reconcileHelperSnapshot(config, snapshot);
    } catch (error) {
      return this.recordHelperFailure(config, error);
    }
  }

  async restore(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus> {
    if (!config.enabled) {
      return this.transition(config, "disabled");
    }

    if (!this.isInitialized()) {
      return this.transition(config, "blocked_uninitialized");
    }

    return await this.enable(config);
  }

  async syncConfig(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus | null> {
    if (!config.enabled) {
      const resolved = this.resolveEffectiveStatus(config);
      this.currentStatus = resolved;
      return null;
    }

    return await this.getStatus(config);
  }

  async enable(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus> {
    if (!this.isInitialized()) {
      return this.transition(config, "blocked_uninitialized");
    }

    this.transition(config, "starting");

    try {
      const snapshot = await this.helperClient.enable({
        commandPath: this.options.commandPath,
        controlServerUrl: config.controlServerUrl,
        hostname: config.hostname
      });
      return this.reconcileHelperSnapshot(config, snapshot);
    } catch (error) {
      return this.recordHelperFailure(config, error);
    }
  }

  async disable(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus> {
    const current = this.resolveEffectiveStatus(config);

    if (current.phase !== "disabled") {
      this.transition(config, "stopping");
    }

    try {
      await this.helperClient.disable({
        commandPath: this.options.commandPath
      });
    } catch (error) {
      return this.recordHelperFailure(config, error);
    }

    return this.transition(config, "disabled");
  }

  async requestLogin(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus> {
    if (!config.enabled) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TAILSCALE_NOT_ENABLED",
        detail: "当前实例尚未启用 Tailscale"
      });
    }

    if (!this.isInitialized()) {
      return this.transition(config, "blocked_uninitialized");
    }

    try {
      const snapshot = await this.helperClient.login({
        commandPath: this.options.commandPath,
        controlServerUrl: config.controlServerUrl,
        hostname: config.hostname
      });
      return this.reconcileHelperSnapshot(config, snapshot);
    } catch (error) {
      return this.recordHelperFailure(config, error);
    }
  }

  async logout(config: InstanceTailscaleConfig): Promise<InstanceTailscaleStatus> {
    if (!config.enabled) {
      return this.transition(config, "disabled");
    }

    try {
      const snapshot = await this.helperClient.logout({
        commandPath: this.options.commandPath
      });
      return this.reconcileHelperSnapshot(config, snapshot);
    } catch (error) {
      return this.recordHelperFailure(config, error);
    }
  }

  recordRunning(
    config: InstanceTailscaleConfig,
    details: {
      loginUrl?: string | null;
      accountName?: string | null;
      tailnetFqdn?: string | null;
      tailnetIpv4?: string | null;
      tailnetIpv6?: string | null;
      reachableBaseUrl?: string | null;
      lastError?: string | null;
    } = {}
  ): InstanceTailscaleStatus {
    return this.transition(config, "running", details);
  }

  recordNeedsLogin(
    config: InstanceTailscaleConfig,
    loginUrl: string | null,
    accountName: string | null = null
  ): InstanceTailscaleStatus {
    return this.transition(config, "needs_login", { loginUrl, accountName, lastError: null });
  }

  recordError(config: InstanceTailscaleConfig, detail: string): InstanceTailscaleStatus {
    return this.transition(config, "error", {
      lastError: detail,
      loginUrl: null
    });
  }

  private reconcileHelperSnapshot(
    config: InstanceTailscaleConfig,
    snapshot: TailscaleHelperSnapshot
  ): InstanceTailscaleStatus {
    switch (snapshot.backendState) {
      case "running":
        return this.recordRunning(config, {
          loginUrl: null,
          accountName: snapshot.accountName,
          tailnetFqdn: snapshot.tailnetFqdn,
          tailnetIpv4: snapshot.tailnetIpv4,
          tailnetIpv6: snapshot.tailnetIpv6,
          reachableBaseUrl: buildReachableBaseUrl(snapshot, this.options.webUiPort),
          lastError: null
        });
      case "starting":
        return this.transition(config, "starting");
      case "needs_login":
        return this.recordNeedsLogin(config, snapshot.loginUrl, snapshot.accountName);
      case "stopped":
        return this.recordError(
          config,
          snapshot.lastError ?? "Tailscale 当前未连接到 tailnet"
        );
      case "error":
      default:
        return this.recordError(
          config,
          snapshot.lastError ?? "Tailscale 状态检查失败"
        );
    }
  }

  private recordHelperFailure(
    config: InstanceTailscaleConfig,
    error: unknown
  ): InstanceTailscaleStatus {
    const detail = normalizeTailscaleErrorDetail(error instanceof Error ? error.message : String(error));
    return this.recordError(config, detail);
  }

  getStatusSync(config: InstanceTailscaleConfig): InstanceTailscaleStatus {
    const resolved = this.resolveEffectiveStatus(config);
    this.currentStatus = resolved;
    return resolved;
  }

  private transition(
    config: InstanceTailscaleConfig,
    nextPhase: TailscalePhase,
    overrides: TransitionOverrides = {}
  ): InstanceTailscaleStatus {
    const current = this.resolveEffectiveStatus(config);

    if (!isAllowedTransition(current.phase, nextPhase)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "TAILSCALE_INVALID_PHASE_TRANSITION",
        detail: `Tailscale 状态不允许从 ${current.phase} 切换到 ${nextPhase}`
      });
    }

    const next = buildStatusFromPhase(nextPhase, config, nowIso(), current, overrides);
    this.persistStatus(next);
    return next;
  }

  private resolveEffectiveStatus(config: InstanceTailscaleConfig): InstanceTailscaleStatus {
    const persisted = this.currentStatus ?? this.repository.findStatus();

    if (!config.enabled) {
      return buildStatusFromPhase("disabled", config, persisted?.observedAt ?? null, persisted);
    }

    if (!this.isInitialized()) {
      return buildStatusFromPhase(
        "blocked_uninitialized",
        config,
        persisted?.observedAt ?? null,
        persisted
      );
    }

    if (!persisted || persisted.phase === "disabled" || persisted.phase === "blocked_uninitialized") {
      return buildStatusFromPhase("needs_login", config, persisted?.observedAt ?? null, persisted);
    }

    return {
      ...persisted,
      controlServerUrl: config.controlServerUrl,
      hostname: config.hostname
    };
  }

  private isInitialized(): boolean {
    return this.bootstrapStateRepository.getState().initialized;
  }

  private persistStatus(status: InstanceTailscaleStatus): void {
    this.repository.upsertStatus(status);
    this.currentStatus = status;
    this.emit("status", status);
  }
}

function buildStatusFromPhase(
  phase: TailscalePhase,
  config: InstanceTailscaleConfig,
  observedAt: string | null,
  previous?: InstanceTailscaleStatus | null,
  overrides: TransitionOverrides = {}
): InstanceTailscaleStatus {
  const keepAddressPayload = phase === "running";
  const keepAccountPayload = phase !== "disabled" && phase !== "blocked_uninitialized";

  return {
    phase,
    connected: phase === "running",
    loginUrl: overrides.loginUrl ?? (phase === "needs_login" ? previous?.loginUrl ?? null : null),
    controlServerUrl: config.controlServerUrl,
    hostname: config.hostname,
    accountName:
      Object.hasOwn(overrides, "accountName")
        ? (overrides.accountName ?? null)
        : (keepAccountPayload ? previous?.accountName ?? null : null),
    tailnetFqdn:
      overrides.tailnetFqdn ?? (keepAddressPayload ? previous?.tailnetFqdn ?? null : null),
    tailnetIpv4:
      overrides.tailnetIpv4 ?? (keepAddressPayload ? previous?.tailnetIpv4 ?? null : null),
    tailnetIpv6:
      overrides.tailnetIpv6 ?? (keepAddressPayload ? previous?.tailnetIpv6 ?? null : null),
    reachableBaseUrl:
      overrides.reachableBaseUrl ?? (keepAddressPayload ? previous?.reachableBaseUrl ?? null : null),
    lastError: overrides.lastError ?? (phase === "error" ? previous?.lastError ?? null : null),
    observedAt
  };
}

function isAllowedTransition(from: TailscalePhase, to: TailscalePhase): boolean {
  if (from === to) {
    return true;
  }

  const allowedTransitions: Record<TailscalePhase, TailscalePhase[]> = {
    disabled: ["starting", "blocked_uninitialized"],
    blocked_uninitialized: ["disabled", "starting", "error"],
    starting: ["needs_login", "running", "stopping", "error", "disabled"],
    needs_login: ["starting", "running", "stopping", "disabled", "error", "blocked_uninitialized"],
    running: ["stopping", "error", "needs_login", "disabled"],
    stopping: ["disabled", "error"],
    error: ["starting", "needs_login", "disabled", "blocked_uninitialized", "running"]
  };

  return allowedTransitions[from].includes(to);
}

function buildReachableBaseUrl(
  snapshot: Pick<TailscaleHelperSnapshot, "tailnetFqdn" | "tailnetIpv4" | "tailnetIpv6">,
  port: number
): string | null {
  const host = snapshot.tailnetFqdn
    ?? snapshot.tailnetIpv4
    ?? (snapshot.tailnetIpv6 ? `[${snapshot.tailnetIpv6}]` : null);

  if (!host) {
    return null;
  }

  const suffix = port === 80 ? "" : `:${port}`;
  return `http://${host}${suffix}`;
}

function normalizeTailscaleErrorDetail(detail: string): string {
  if (detail === "TAILSCALE_CLI_UNAVAILABLE") {
    return "未发现 Tailscale CLI。请先安装 Tailscale，或通过 CODINGNS_TAILSCALE_COMMAND 指定命令路径。";
  }

  return detail;
}
