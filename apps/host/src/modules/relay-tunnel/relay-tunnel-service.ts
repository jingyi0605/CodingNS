import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secret-box.js";
import { nowIso } from "../../shared/utils/time.js";
import { RelayTunnelIdentityService } from "./crypto/relay-tunnel-identity-service.js";
import type { BootstrapStateRepository } from "../../storage/repositories/bootstrap-state-repository.js";
import type { InstanceRelayTunnelIdentityRepository } from "../../storage/repositories/instance-relay-tunnel-identity-repository.js";
import type { InstanceRelayTunnelRepository } from "../../storage/repositories/instance-relay-tunnel-repository.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import type {
  InstanceRelayTunnelConfig,
  InstanceRelayTunnelStatus,
  RelayTunnelPhase,
  RelayTunnelProvider
} from "../../types/domain.js";

export interface RelayTunnelConfigUpdateInput {
  activated?: boolean;
  relayBaseUrl?: string | null;
  controlBaseUrl?: string | null;
  localTargetBaseUrl?: string | null;
}

export interface RelayTunnelBindInput {
  accountId?: string | null;
  relayBaseUrl?: string | null;
  controlBaseUrl?: string | null;
  bindingId?: string;
  tunnelDomain?: string;
  hostPublicKey?: string;
  hostKeyFingerprint?: string;
}

export interface InstanceRelayTunnelStatusDto {
  activated: boolean;
  enabled: boolean;
  provider: RelayTunnelProvider;
  relayBaseUrl: string | null;
  controlBaseUrl: string | null;
  controlAccountEmail: string | null;
  controlSessionExpiresAt: string | null;
  accountId: string | null;
  tunnelDomain: string | null;
  bindingId: string | null;
  hostPublicKey: string | null;
  hostKeyFingerprint: string | null;
  localTargetBaseUrl: string;
  phase: RelayTunnelPhase;
  connected: boolean;
  hostFingerprint: string | null;
  trafficUsedBytes: string | null;
  trafficRemainingBytes: string | null;
  quotaResetAt: string | null;
  lastError: string | null;
  observedAt: string | null;
  updatedAt: string | null;
}

export interface RelayTunnelControlLoginInput {
  email?: string | null;
  password?: string | null;
}

export interface RelayTunnelControlHostLabelAvailability {
  hostLabel: string;
  tunnelDomain: string | null;
  available: boolean;
  reason: "available" | "occupied" | "reserved" | "unavailable";
}

export interface RelayTunnelTrafficWalletSummary {
  accountId: string;
  grantedBytes: string;
  usedBytes: string;
  remainingBytes: string;
  exhausted: boolean;
  updatedAt: string;
}

interface RelayTunnelStateSnapshot {
  config: InstanceRelayTunnelConfig;
  hasPersistedConfig: boolean;
}

interface RelayControlLoginResponse {
  account: {
    accountId: string;
    email: string;
  };
  accessToken: string;
  expiresAt: string;
}

interface RelayControlBindResponse {
  created: boolean;
  binding: {
    bindingId: string;
    tunnelDomain: string;
    hostPublicKey: string;
    hostFingerprint: string;
    relayBaseUrl: string;
    controlBaseUrl: string;
    status: "active" | "disabled";
  };
}

export interface RelayTunnelRuntimeAdapter {
  connect(
    config: InstanceRelayTunnelConfig,
    signal: AbortSignal
  ): Promise<InstanceRelayTunnelStatus>;
  disconnect?(reason?: string): Promise<void> | void;
}

export class RelayTunnelService {
  private readonly defaultLocalTargetBaseUrl: string;
  private readonly controlSessionSecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly taskManager: TaskManager;
  private readonly runtimeAdapter: RelayTunnelRuntimeAdapter;
  private readonly identityService: RelayTunnelIdentityService;

  constructor(
    private readonly db: Database.Database,
    private readonly bootstrapStateRepository: BootstrapStateRepository,
    identityRepository: InstanceRelayTunnelIdentityRepository,
    private readonly repository: InstanceRelayTunnelRepository,
    options: {
      defaultLocalTargetBaseUrl: string;
      controlSessionSecret: string;
      fetchFn?: typeof fetch;
    },
    taskManager: TaskManager = createTaskManager(),
    runtimeAdapter: RelayTunnelRuntimeAdapter = new NoopRelayTunnelRuntimeAdapter()
  ) {
    this.taskManager = taskManager;
    this.runtimeAdapter = runtimeAdapter;
    this.identityService = new RelayTunnelIdentityService(identityRepository);
    this.controlSessionSecret = normalizeRequiredText(
      options.controlSessionSecret,
      "controlSessionSecret"
    );
    this.fetchFn = options.fetchFn ?? fetch;
    this.defaultLocalTargetBaseUrl = normalizeHttpBaseUrl(
      options.defaultLocalTargetBaseUrl,
      "defaultLocalTargetBaseUrl"
    )!;
    this.registerBackgroundTasks();
  }

  async restoreOnStartup(): Promise<void> {
    const snapshot = this.readStateSnapshot();

    if (
      !snapshot.hasPersistedConfig
      || !snapshot.config.activated
      || !snapshot.config.enabled
      || !isBound(snapshot.config)
    ) {
      return;
    }

    const effectiveConfig = this.syncIdentityIntoConfig(snapshot.config);

    if (!this.isBootstrapInitialized()) {
      this.repository.upsertStatus(
        buildSkeletonStatus("blocked_uninitialized", effectiveConfig, {
          observedAt: nowIso()
        })
      );
      return;
    }

    this.requestReconnect("relay_tunnel.startup_restore");
  }

  async getStatus(): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const effectiveConfig = this.resolveConfigWithIdentity(snapshot.config);
    return this.buildStatusDto(snapshot, effectiveConfig, this.resolveEffectiveStatus(effectiveConfig));
  }

  async ensureIdentity(): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const nextConfig = this.syncIdentityIntoConfig(snapshot.config);

    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: snapshot.hasPersistedConfig || nextConfig !== snapshot.config
      },
      nextConfig,
      this.resolveEffectiveStatus(nextConfig)
    );
  }

  async updateConfig(input: RelayTunnelConfigUpdateInput): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const nextConfig: InstanceRelayTunnelConfig = {
      ...snapshot.config,
      activated:
        input.activated !== undefined
          ? input.activated
          : snapshot.config.activated,
      relayBaseUrl:
        input.relayBaseUrl !== undefined
          ? normalizeWebsocketBaseUrl(input.relayBaseUrl, "relayBaseUrl")
          : snapshot.config.relayBaseUrl,
      controlBaseUrl:
        input.controlBaseUrl !== undefined
          ? normalizeHttpBaseUrl(input.controlBaseUrl, "controlBaseUrl")
          : snapshot.config.controlBaseUrl,
      localTargetBaseUrl:
        input.localTargetBaseUrl !== undefined
          ? normalizeHttpBaseUrl(input.localTargetBaseUrl, "localTargetBaseUrl")!
          : snapshot.config.localTargetBaseUrl,
      enabled:
        input.activated === false
          ? false
          : snapshot.config.enabled,
      updatedAt: nowIso()
    };

    this.repository.upsertConfig(nextConfig);
    const effectiveConfig = this.resolveConfigWithIdentity(nextConfig);

    if (!effectiveConfig.activated) {
      const nextStatus = buildSkeletonStatus("disabled", effectiveConfig, {
        observedAt: nowIso()
      });

      this.repository.upsertStatus(nextStatus);
      this.taskManager.cancel(HOST_TASK_TYPES.relayTunnelConnect, "default", "relay_tunnel_deactivated");
      await this.runtimeAdapter.disconnect?.("relay_tunnel_deactivated");

      return this.buildStatusDto(
        {
          config: effectiveConfig,
          hasPersistedConfig: true
        },
        effectiveConfig,
        nextStatus
      );
    }

    if (effectiveConfig.enabled && isBound(effectiveConfig) && this.isBootstrapInitialized()) {
      this.requestReconnect("relay_tunnel.config_update");
    }

    return this.buildStatusDto(
      {
        config: effectiveConfig,
        hasPersistedConfig: true
      },
      effectiveConfig,
      this.resolveEffectiveStatus(effectiveConfig)
    );
  }

  async loginControl(input: RelayTunnelControlLoginInput): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const controlBaseUrl = requireConfiguredControlBaseUrl(snapshot.config);
    const email = normalizeRequiredText(input.email, "email");
    const password = normalizeRequiredText(input.password, "password");
    const response = await this.requestControlApi<RelayControlLoginResponse>({
      controlBaseUrl,
      path: "/api/public/auth/login",
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      }),
      failurePrefix: "控制站登录失败"
    });
    const timestamp = nowIso();
    const nextConfig: InstanceRelayTunnelConfig = {
      ...snapshot.config,
      accountId: response.account.accountId,
      controlAccessTokenCiphertext: encryptSecret(this.controlSessionSecret, response.accessToken),
      controlAccountEmail: response.account.email.trim(),
      controlSessionExpiresAt: normalizeOptionalText(response.expiresAt),
      updatedAt: timestamp
    };

    this.repository.upsertConfig(nextConfig);
    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      this.resolveConfigWithIdentity(nextConfig),
      this.resolveEffectiveStatus(nextConfig)
    );
  }

  async logoutControl(): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const nextConfig = clearRelayTunnelControlSession(snapshot.config, {
      clearAccountId: !snapshot.config.bindingId,
      updatedAt: nowIso()
    });

    this.repository.upsertConfig(nextConfig);
    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      this.resolveConfigWithIdentity(nextConfig),
      this.resolveEffectiveStatus(nextConfig)
    );
  }

  async checkHostLabelAvailability(hostLabel: string): Promise<RelayTunnelControlHostLabelAvailability> {
    const snapshot = this.readStateSnapshot();
    const normalizedHostLabel = normalizeRequiredText(hostLabel, "hostLabel");
    const { controlBaseUrl, accessToken } = this.requireControlSession(snapshot.config);
    const path = `/api/v1/hosts/availability?hostLabel=${encodeURIComponent(normalizedHostLabel)}`;

    return await this.requestControlApi<RelayTunnelControlHostLabelAvailability>({
      controlBaseUrl,
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      failurePrefix: "检查 Host 名称失败"
    });
  }

  async bindControlHost(hostLabel: string): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();

    if (snapshot.config.bindingId && snapshot.config.tunnelDomain) {
      const effectiveConfig = this.resolveConfigWithIdentity(snapshot.config);
      return this.buildStatusDto(snapshot, effectiveConfig, this.resolveEffectiveStatus(effectiveConfig));
    }

    const normalizedHostLabel = normalizeRequiredText(hostLabel, "hostLabel");
    const { controlBaseUrl, accessToken, accountId } = this.requireControlSession(snapshot.config);
    const identity = this.identityService.ensureIdentity();
    const bindResponse = await this.requestControlApi<RelayControlBindResponse>({
      controlBaseUrl,
      path: "/api/v1/hosts/bind",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        hostLabel: normalizedHostLabel,
        hostPublicKey: identity.publicKeyPem,
        hostFingerprint: identity.keyFingerprint
      }),
      failurePrefix: "绑定 Host 失败"
    });

    return await this.bind({
      accountId,
      bindingId: bindResponse.binding.bindingId,
      tunnelDomain: bindResponse.binding.tunnelDomain,
      relayBaseUrl: bindResponse.binding.relayBaseUrl,
      controlBaseUrl
    });
  }

  async getTrafficWallet(): Promise<RelayTunnelTrafficWalletSummary> {
    const snapshot = this.readStateSnapshot();
    const { controlBaseUrl, accessToken } = this.requireControlSession(snapshot.config);
    const response = await this.requestControlApi<{ wallet: RelayTunnelTrafficWalletSummary }>({
      controlBaseUrl,
      path: "/api/v1/traffic-wallet/me",
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      failurePrefix: "读取控制站流量信息失败"
    });

    return response.wallet;
  }

  async bind(input: RelayTunnelBindInput): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const accountId = normalizeRequiredText(input.accountId, "accountId");
    const bindingId = normalizeRequiredText(input.bindingId, "bindingId");
    const tunnelDomain = normalizeTunnelDomain(input.tunnelDomain, "tunnelDomain");
    const identity = this.identityService.ensureIdentity();
    const relayBaseUrl =
      input.relayBaseUrl !== undefined
        ? normalizeWebsocketBaseUrl(input.relayBaseUrl, "relayBaseUrl")
        : snapshot.config.relayBaseUrl;
    const controlBaseUrl =
      input.controlBaseUrl !== undefined
        ? normalizeHttpBaseUrl(input.controlBaseUrl, "controlBaseUrl")
        : snapshot.config.controlBaseUrl;

    if (!relayBaseUrl || !controlBaseUrl) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "绑定前必须提供 relayBaseUrl 和 controlBaseUrl"
      });
    }

    const timestamp = nowIso();
    const nextConfig: InstanceRelayTunnelConfig = {
      ...snapshot.config,
      relayBaseUrl,
      controlBaseUrl,
      accountId,
      tunnelDomain,
      bindingId,
      hostPublicKey: identity.publicKeyPem,
      hostKeyFingerprint: identity.keyFingerprint,
      updatedAt: timestamp
    };
    const nextStatus = buildSkeletonStatus(
      nextConfig.enabled
        ? (this.isBootstrapInitialized() ? "connecting" : "blocked_uninitialized")
        : "disabled",
      nextConfig,
      {
        observedAt: timestamp
      }
    );

    this.db.transaction(() => {
      this.repository.upsertConfig(nextConfig);
      this.repository.upsertStatus(nextStatus);
    })();

    if (nextConfig.enabled && this.isBootstrapInitialized()) {
      this.requestReconnect("relay_tunnel.bind");
    }

    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      nextConfig,
      this.resolveEffectiveStatus(nextConfig)
    );
  }

  async unbind(): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const timestamp = nowIso();
    const nextConfig = clearRelayTunnelControlSession({
      ...snapshot.config,
      enabled: false,
      bindingId: null,
      tunnelDomain: null,
      updatedAt: timestamp
    }, {
      clearAccountId: true,
      updatedAt: timestamp
    });
    const nextStatus = buildSkeletonStatus("disabled", nextConfig, {
      observedAt: timestamp
    });
    this.taskManager.cancel(HOST_TASK_TYPES.relayTunnelConnect, "default", "relay_tunnel_unbound");
    await this.runtimeAdapter.disconnect?.("relay_tunnel_unbound");

    this.db.transaction(() => {
      this.repository.upsertConfig(nextConfig);
      this.repository.upsertStatus(nextStatus);
    })();

    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      nextConfig,
      nextStatus
    );
  }

  async enable(): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();

    if (!isBound(snapshot.config)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "RELAY_TUNNEL_NOT_BOUND",
        detail: "当前实例还没有绑定公共隧道"
      });
    }

    const timestamp = nowIso();
    const nextConfig: InstanceRelayTunnelConfig = {
      ...snapshot.config,
      activated: true,
      enabled: true,
      updatedAt: timestamp
    };
    const configWithIdentity = this.syncIdentityIntoConfig(nextConfig);
    const nextStatus = buildSkeletonStatus(
      this.isBootstrapInitialized() ? "connecting" : "blocked_uninitialized",
      configWithIdentity,
      {
        observedAt: timestamp
      }
    );

    this.db.transaction(() => {
      this.repository.upsertConfig(configWithIdentity);
      this.repository.upsertStatus(nextStatus);
    })();

    if (this.isBootstrapInitialized()) {
      this.requestReconnect("relay_tunnel.enable");
    }

    return this.buildStatusDto(
      {
        config: configWithIdentity,
        hasPersistedConfig: true
      },
      configWithIdentity,
      nextStatus
    );
  }

  async disable(): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();
    const timestamp = nowIso();
    const nextConfig: InstanceRelayTunnelConfig = {
      ...snapshot.config,
      enabled: false,
      updatedAt: timestamp
    };
    const nextStatus = buildSkeletonStatus("disabled", nextConfig, {
      observedAt: timestamp
    });

    this.db.transaction(() => {
      this.repository.upsertConfig(nextConfig);
      this.repository.upsertStatus(nextStatus);
    })();
    this.taskManager.cancel(HOST_TASK_TYPES.relayTunnelConnect, "default", "relay_tunnel_disabled");
    await this.runtimeAdapter.disconnect?.("relay_tunnel_disabled");

    return this.buildStatusDto(
      {
        config: nextConfig,
        hasPersistedConfig: true
      },
      nextConfig,
      nextStatus
    );
  }

  requestReconnect(source = "relay_tunnel.reconnect"): TaskHandle<InstanceRelayTunnelStatusDto> {
    return this.taskManager.enqueue<{ source: string }, InstanceRelayTunnelStatusDto>(
      HOST_TASK_TYPES.relayTunnelConnect,
      {
        key: "default",
        source,
        input: {
          source
        }
      }
    );
  }

  private readStateSnapshot(): RelayTunnelStateSnapshot {
    const persistedConfig = this.repository.findConfig();

    return {
      config:
        persistedConfig
        ?? {
          activated: false,
          enabled: false,
          provider: "codingns_relay",
          relayBaseUrl: null,
          controlBaseUrl: null,
          controlAccessTokenCiphertext: null,
          controlAccountEmail: null,
          controlSessionExpiresAt: null,
          accountId: null,
          tunnelDomain: null,
          bindingId: null,
          hostPublicKey: null,
          hostKeyFingerprint: null,
          localTargetBaseUrl: this.defaultLocalTargetBaseUrl,
          updatedAt: nowIso()
        },
      hasPersistedConfig: persistedConfig !== null
    };
  }

  private resolveEffectiveStatus(config: InstanceRelayTunnelConfig): InstanceRelayTunnelStatus {
    const persisted = this.repository.findStatus();

    if (!config.activated || !config.enabled) {
      return buildSkeletonStatus("disabled", config, {
        observedAt: persisted?.observedAt ?? null
      });
    }

    if (!isBound(config)) {
      return buildSkeletonStatus("unbound", config, {
        observedAt: persisted?.observedAt ?? null
      });
    }

    if (!this.isBootstrapInitialized()) {
      return buildSkeletonStatus("blocked_uninitialized", config, {
        observedAt: persisted?.observedAt ?? null
      });
    }

    if (
      !persisted
      || persisted.phase === "disabled"
      || persisted.phase === "unbound"
      || persisted.phase === "blocked_uninitialized"
    ) {
      return buildSkeletonStatus("connecting", config, {
        observedAt: persisted?.observedAt ?? null
      });
    }

    return {
      ...persisted,
      bindingId: config.bindingId,
      tunnelDomain: config.tunnelDomain,
      hostFingerprint: config.hostKeyFingerprint
    };
  }

  private registerBackgroundTasks(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.relayTunnelConnect)) {
      return;
    }

    this.taskManager.register<{ source: string }, InstanceRelayTunnelStatusDto>({
      taskType: HOST_TASK_TYPES.relayTunnelConnect,
      executionLane: "host_background",
      timeoutMs: 15_000,
      run: async (_input, context) => await this.runConnectTask(context.signal)
    });
  }

  private async runConnectTask(signal: AbortSignal): Promise<InstanceRelayTunnelStatusDto> {
    const snapshot = this.readStateSnapshot();

    if (!snapshot.config.enabled || !isBound(snapshot.config)) {
      const effectiveConfig = this.resolveConfigWithIdentity(snapshot.config);
      return this.buildStatusDto(snapshot, effectiveConfig, this.resolveEffectiveStatus(effectiveConfig));
    }

    const effectiveConfig = this.syncIdentityIntoConfig(snapshot.config);

    if (!this.isBootstrapInitialized()) {
      const blockedStatus = buildSkeletonStatus("blocked_uninitialized", effectiveConfig, {
        observedAt: nowIso()
      });
      this.repository.upsertStatus(blockedStatus);
      return this.buildStatusDto(snapshot, effectiveConfig, blockedStatus);
    }

    try {
      const nextStatus = await this.runtimeAdapter.connect(effectiveConfig, signal);

      if (signal.aborted) {
        const latestSnapshot = this.readStateSnapshot();
        const effectiveConfig = this.resolveConfigWithIdentity(latestSnapshot.config);
        return this.buildStatusDto(
          latestSnapshot,
          effectiveConfig,
          this.resolveEffectiveStatus(effectiveConfig)
        );
      }

      this.repository.upsertStatus(nextStatus);
      return this.buildStatusDto(snapshot, effectiveConfig, nextStatus);
    } catch (error) {
      if (signal.aborted) {
        const latestSnapshot = this.readStateSnapshot();
        const effectiveConfig = this.resolveConfigWithIdentity(latestSnapshot.config);
        return this.buildStatusDto(
          latestSnapshot,
          effectiveConfig,
          this.resolveEffectiveStatus(effectiveConfig)
        );
      }

      const failedStatus: InstanceRelayTunnelStatus = {
        ...buildSkeletonStatus("error", snapshot.config, {
          observedAt: nowIso()
        }),
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.repository.upsertStatus(failedStatus);
      return this.buildStatusDto(snapshot, effectiveConfig, failedStatus);
    }
  }

  private buildStatusDto(
    snapshot: RelayTunnelStateSnapshot,
    effectiveConfig: InstanceRelayTunnelConfig,
    effectiveStatus: InstanceRelayTunnelStatus
  ): InstanceRelayTunnelStatusDto {
    return {
      activated: effectiveConfig.activated,
      enabled: effectiveConfig.enabled,
      provider: effectiveConfig.provider,
      relayBaseUrl: effectiveConfig.relayBaseUrl,
      controlBaseUrl: effectiveConfig.controlBaseUrl,
      controlAccountEmail: effectiveConfig.controlAccountEmail,
      controlSessionExpiresAt: effectiveConfig.controlSessionExpiresAt,
      accountId: effectiveConfig.accountId,
      tunnelDomain: effectiveConfig.tunnelDomain,
      bindingId: effectiveConfig.bindingId,
      hostPublicKey: effectiveConfig.hostPublicKey,
      hostKeyFingerprint: effectiveConfig.hostKeyFingerprint,
      localTargetBaseUrl: effectiveConfig.localTargetBaseUrl,
      phase: effectiveStatus.phase,
      connected: effectiveStatus.connected,
      hostFingerprint: effectiveStatus.hostFingerprint,
      trafficUsedBytes: effectiveStatus.trafficUsedBytes,
      trafficRemainingBytes: effectiveStatus.trafficRemainingBytes,
      quotaResetAt: effectiveStatus.quotaResetAt,
      lastError: effectiveStatus.lastError,
      observedAt: effectiveStatus.observedAt,
      updatedAt: snapshot.hasPersistedConfig ? snapshot.config.updatedAt : null
    };
  }

  private resolveConfigWithIdentity(config: InstanceRelayTunnelConfig): InstanceRelayTunnelConfig {
    const identity = this.identityService.getIdentity();

    if (!identity) {
      return config;
    }

    return {
      ...config,
      hostPublicKey: identity.publicKeyPem,
      hostKeyFingerprint: identity.keyFingerprint
    };
  }

  private syncIdentityIntoConfig(config: InstanceRelayTunnelConfig): InstanceRelayTunnelConfig {
    const identity = this.identityService.ensureIdentity();

    if (
      config.hostPublicKey === identity.publicKeyPem
      && config.hostKeyFingerprint === identity.keyFingerprint
    ) {
      return config;
    }

    const nextConfig: InstanceRelayTunnelConfig = {
      ...config,
      hostPublicKey: identity.publicKeyPem,
      hostKeyFingerprint: identity.keyFingerprint
    };
    this.repository.upsertConfig(nextConfig);
    return nextConfig;
  }

  private isBootstrapInitialized(): boolean {
    return this.bootstrapStateRepository.getState().initialized;
  }

  private requireControlSession(config: InstanceRelayTunnelConfig): {
    controlBaseUrl: string;
    accessToken: string;
    accountId: string;
  } {
    const controlBaseUrl = requireConfiguredControlBaseUrl(config);
    const encryptedAccessToken = normalizeOptionalText(config.controlAccessTokenCiphertext);
    const accountId = normalizeOptionalText(config.accountId);

    if (!encryptedAccessToken || !accountId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "RELAY_TUNNEL_CONTROL_SESSION_REQUIRED",
        detail: "当前还没有登录控制站账号"
      });
    }

    try {
      return {
        controlBaseUrl,
        accessToken: decryptSecret(this.controlSessionSecret, encryptedAccessToken),
        accountId
      };
    } catch {
      const nextConfig = clearRelayTunnelControlSession(config, {
        clearAccountId: !config.bindingId,
        updatedAt: nowIso()
      });
      this.repository.upsertConfig(nextConfig);
      throw new AppError({
        statusCode: 409,
        errorCode: "RELAY_TUNNEL_CONTROL_SESSION_REQUIRED",
        detail: "控制站登录态已失效，请重新登录"
      });
    }
  }

  private async requestControlApi<T>(input: {
    controlBaseUrl: string;
    path: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    failurePrefix: string;
  }): Promise<T> {
    const response = await this.fetchFn(
      new URL(input.path, ensureTrailingSlash(input.controlBaseUrl)),
      {
        method: input.method,
        headers: input.headers,
        body: input.body
      }
    );

    if (!response.ok) {
      throw await buildControlApiError(response, input.failurePrefix);
    }

    return await response.json() as T;
  }
}

class NoopRelayTunnelRuntimeAdapter implements RelayTunnelRuntimeAdapter {
  async connect(
    config: InstanceRelayTunnelConfig,
    _signal: AbortSignal
  ): Promise<InstanceRelayTunnelStatus> {
    return buildSkeletonStatus("connecting", config, {
      observedAt: nowIso()
    });
  }
}

function buildSkeletonStatus(
  phase: RelayTunnelPhase,
  config: InstanceRelayTunnelConfig,
  overrides?: {
    observedAt?: string | null;
  }
): InstanceRelayTunnelStatus {
  return {
    phase,
    connected: false,
    bindingId: config.bindingId,
    tunnelDomain: config.tunnelDomain,
    hostFingerprint: config.hostKeyFingerprint,
    trafficUsedBytes: null,
    trafficRemainingBytes: null,
    quotaResetAt: null,
    lastError: null,
    observedAt: overrides?.observedAt ?? null
  };
}

function isBound(config: InstanceRelayTunnelConfig): boolean {
  return Boolean(config.bindingId && config.tunnelDomain);
}

function normalizeRequiredText(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能为空`,
      field
    });
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeTunnelDomain(value: string | null | undefined, field: string): string {
  const normalized = normalizeRequiredText(value, field).toLowerCase();

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalized)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "tunnelDomain 必须是合法域名",
      field
    });
  }

  return normalized;
}

function normalizeHttpBaseUrl(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) {
    return value ?? null;
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
      detail: `${field} 必须是合法的 http 或 https 地址`,
      field
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 只允许使用 http 或 https 协议`,
      field
    });
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能包含账号、查询参数或 hash`,
      field
    });
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

function normalizeWebsocketBaseUrl(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) {
    return value ?? null;
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
      detail: `${field} 必须是合法的 ws、wss、http 或 https 地址`,
      field
    });
  }

  if (
    parsed.protocol !== "ws:"
    && parsed.protocol !== "wss:"
    && parsed.protocol !== "http:"
    && parsed.protocol !== "https:"
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 只允许使用 ws、wss、http 或 https 协议`,
      field
    });
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能包含账号、查询参数或 hash`,
      field
    });
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const normalizedProtocol =
    parsed.protocol === "https:"
      ? "wss:"
      : parsed.protocol === "http:"
        ? "ws:"
        : parsed.protocol;

  return `${normalizedProtocol}//${parsed.host}${pathname}`;
}

function requireConfiguredControlBaseUrl(config: InstanceRelayTunnelConfig): string {
  const controlBaseUrl = normalizeOptionalText(config.controlBaseUrl);

  if (!controlBaseUrl) {
    throw new AppError({
      statusCode: 409,
      errorCode: "RELAY_TUNNEL_CONTROL_BASE_URL_REQUIRED",
      detail: "当前还没有配置控制站点地址"
    });
  }

  return controlBaseUrl;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function clearRelayTunnelControlSession(
  config: InstanceRelayTunnelConfig,
  options: {
    clearAccountId: boolean;
    updatedAt: string;
  }
): InstanceRelayTunnelConfig {
  return {
    ...config,
    controlAccessTokenCiphertext: null,
    controlAccountEmail: null,
    controlSessionExpiresAt: null,
    accountId: options.clearAccountId ? null : config.accountId,
    updatedAt: options.updatedAt
  };
}

async function buildControlApiError(response: Response, failurePrefix: string): Promise<AppError> {
  const detail = await readControlApiErrorDetail(response);
  return new AppError({
    statusCode: response.status,
    errorCode: "RELAY_TUNNEL_CONTROL_API_ERROR",
    detail: `${failurePrefix}：${detail}`
  });
}

async function readControlApiErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json() as Record<string, unknown>;
      const detail =
        readJsonErrorText(payload.detail)
        ?? readJsonErrorText(payload.message)
        ?? readJsonErrorText(payload.error);

      if (detail) {
        return detail;
      }
    } catch {
      // 忽略 JSON 解析失败，回退到纯文本。
    }
  }

  const text = normalizeOptionalText(await response.text());
  return text ?? `HTTP ${response.status}`;
}

function readJsonErrorText(value: unknown): string | null {
  return typeof value === "string" ? normalizeOptionalText(value) : null;
}
