import http from "node:http";
import https from "node:https";
import os from "node:os";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secret-box.js";
import { nowIso } from "../../shared/utils/time.js";
import { RelayTunnelIdentityService } from "./crypto/relay-tunnel-identity-service.js";
import { RelayTunnelRuntimeHttpError } from "./relay-tunnel-runtime-adapter.js";
import type { BootstrapStateRepository } from "../../storage/repositories/bootstrap-state-repository.js";
import type { InstanceRelayTunnelIdentityRepository } from "../../storage/repositories/instance-relay-tunnel-identity-repository.js";
import type { InstanceRelayTunnelRepository } from "../../storage/repositories/instance-relay-tunnel-repository.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import type {
  HostCandidateEndpoint,
  HostCandidateEndpointKind,
  InstanceRelayTunnelConfig,
  InstanceRelayTunnelStatus,
  RelayTunnelPhase,
  RelayTunnelProvider
} from "../../types/domain.js";

const DEFAULT_RELAY_TUNNEL_CONTROL_BASE_URL = normalizeHttpBaseUrl(
  "https://channel.codingns.com:1443",
  "defaultRelayTunnelControlBaseUrl"
)!;
const DEFAULT_RELAY_TUNNEL_CONTROL_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RELAY_TUNNEL_CONTROL_TLS_ECDH_CURVE = "X25519";
// 线上 channel:1443 的 TLS 握手对 Node 默认参数比较挑，控制站请求统一收敛到单个 X25519，
// 避免首连阶段出现随机握手失败。
const RELAY_TUNNEL_CONTROL_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  ecdhCurve: DEFAULT_RELAY_TUNNEL_CONTROL_TLS_ECDH_CURVE
});

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
  candidateEndpoints: HostCandidateEndpoint[];
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
  private readonly legacyLocalTargetBaseUrl: string | null;
  private readonly controlSessionSecret: string;
  private readonly controlRequestTimeoutMs: number;
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
      legacyLocalTargetBaseUrl?: string | null;
      controlSessionSecret: string;
      controlRequestTimeoutMs?: number;
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
    this.controlRequestTimeoutMs = normalizePositiveInt(
      options.controlRequestTimeoutMs,
      DEFAULT_RELAY_TUNNEL_CONTROL_REQUEST_TIMEOUT_MS
    );
    this.fetchFn = resolveRelayTunnelControlFetch(options.fetchFn);
    this.defaultLocalTargetBaseUrl = normalizeHttpBaseUrl(
      options.defaultLocalTargetBaseUrl,
      "defaultLocalTargetBaseUrl"
    )!;
    this.legacyLocalTargetBaseUrl = options.legacyLocalTargetBaseUrl
      ? normalizeHttpBaseUrl(options.legacyLocalTargetBaseUrl, "legacyLocalTargetBaseUrl")
      : null;
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
    const controlBaseUrl =
      input.controlBaseUrl !== undefined
        ? normalizeHttpBaseUrl(input.controlBaseUrl, "controlBaseUrl")
        : snapshot.config.controlBaseUrl;
    const nextConfig: InstanceRelayTunnelConfig = {
      ...snapshot.config,
      activated:
        input.activated !== undefined
          ? input.activated
          : snapshot.config.activated,
      // relay 入口统一跟随控制站点，同一条地址避免再出现 control 能通、relay 走死路的分裂配置。
      relayBaseUrl: deriveRelayBaseUrlFromControlBaseUrl(controlBaseUrl),
      controlBaseUrl,
      localTargetBaseUrl:
        input.localTargetBaseUrl !== undefined
          ? normalizeHttpBaseUrl(input.localTargetBaseUrl, "localTargetBaseUrl")!
          : snapshot.config.localTargetBaseUrl,
      localTargetBaseUrlSource:
        input.localTargetBaseUrl !== undefined
          ? "custom"
          : (snapshot.config.localTargetBaseUrlSource ?? "default"),
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
    const controlBaseUrl =
      input.controlBaseUrl !== undefined
        ? normalizeHttpBaseUrl(input.controlBaseUrl, "controlBaseUrl")
        : snapshot.config.controlBaseUrl;
    const relayBaseUrl = deriveRelayBaseUrlFromControlBaseUrl(controlBaseUrl);

    if (!relayBaseUrl || !controlBaseUrl) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "绑定前必须提供 controlBaseUrl"
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
    const persistedConfig = this.reconcilePersistedConfig(this.repository.findConfig());

    return {
      config:
        persistedConfig
        ?? {
          activated: false,
          enabled: false,
          provider: "codingns_relay",
          relayBaseUrl: null,
          controlBaseUrl: DEFAULT_RELAY_TUNNEL_CONTROL_BASE_URL,
          controlAccessTokenCiphertext: null,
          controlAccountEmail: null,
          controlSessionExpiresAt: null,
          accountId: null,
          tunnelDomain: null,
          bindingId: null,
          hostPublicKey: null,
          hostKeyFingerprint: null,
          localTargetBaseUrl: this.defaultLocalTargetBaseUrl,
          localTargetBaseUrlSource: "default",
          updatedAt: nowIso()
        },
      hasPersistedConfig: persistedConfig !== null
    };
  }

  private reconcilePersistedConfig(
    config: InstanceRelayTunnelConfig | null
  ): InstanceRelayTunnelConfig | null {
    if (!config) {
      return config;
    }

    let nextConfig = config;
    let changed = false;

    if ((nextConfig.localTargetBaseUrlSource ?? "default") === "default"
      && nextConfig.localTargetBaseUrl !== this.defaultLocalTargetBaseUrl) {
      // `default` 源的目标地址由当前运行模式决定，不应该把历史默认值永久粘在库里。
      // 只要默认入口变化了，就在启动时自动收敛到新的默认值；用户显式写入的 custom 配置不动。
      nextConfig = {
        ...nextConfig,
        localTargetBaseUrl: this.defaultLocalTargetBaseUrl,
        localTargetBaseUrlSource: "default",
        updatedAt: nowIso()
      };
      changed = true;
    }

    if (!normalizeOptionalText(nextConfig.controlBaseUrl)) {
      // 正式包已经把官方控制站当成固定入口，Host 侧不能继续允许空值漂着，
      // 否则前端显示的是固定地址，真正发请求时却因为配置为空直接失败。
      nextConfig = {
        ...nextConfig,
        controlBaseUrl: DEFAULT_RELAY_TUNNEL_CONTROL_BASE_URL,
        updatedAt: nowIso()
      };
      changed = true;
    }

    const managedRelayBaseUrl = deriveRelayBaseUrlFromControlBaseUrl(nextConfig.controlBaseUrl);

    if (nextConfig.relayBaseUrl !== managedRelayBaseUrl) {
      nextConfig = {
        ...nextConfig,
        relayBaseUrl: managedRelayBaseUrl,
        updatedAt: nowIso()
      };
      changed = true;
    }

    if (!changed) {
      return config;
    }

    this.repository.upsertConfig(nextConfig);
    return nextConfig;
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

      if (shouldResetStaleRelayBinding(error)) {
        const nextConfig = this.clearBoundState(snapshot.config, {
          updatedAt: nowIso()
        });
        const nextStatus: InstanceRelayTunnelStatus = {
          ...buildSkeletonStatus("unbound", nextConfig, {
            observedAt: nowIso()
          }),
          lastError: error instanceof Error ? error.message : String(error)
        };
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
      candidateEndpoints: buildHostCandidateEndpoints(effectiveConfig),
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

  private clearBoundState(
    config: InstanceRelayTunnelConfig,
    options: {
      updatedAt: string;
    }
  ): InstanceRelayTunnelConfig {
    return {
      ...config,
      bindingId: null,
      tunnelDomain: null,
      updatedAt: options.updatedAt
    };
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
    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.controlRequestTimeoutMs);

    try {
      const requestUrl = new URL(
        input.path,
        ensureTrailingSlash(input.controlBaseUrl)
      ).toString();
      response = await this.fetchFn(
        requestUrl,
        {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: controller.signal
        }
      );
    } catch (error) {
      throw buildControlFetchError(error, input.controlBaseUrl, input.failurePrefix);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw await buildControlApiError(response, input.controlBaseUrl, input.failurePrefix);
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

function buildHostCandidateEndpoints(config: InstanceRelayTunnelConfig): HostCandidateEndpoint[] {
  const endpoints = new Map<string, HostCandidateEndpoint>();
  const relayEndpoint = buildRelayPublicUrl(config);

  if (relayEndpoint) {
    endpoints.set(relayEndpoint, {
      endpointId: `relay:${relayEndpoint}`,
      kind: "relay",
      url: relayEndpoint,
      priority: 400,
      expiresAt: null,
      source: "host_reported"
    });
  }

  for (const localCandidateUrl of buildLocalCandidateUrls(config.localTargetBaseUrl)) {
    endpoints.set(localCandidateUrl, {
      endpointId: `host_reported:${localCandidateUrl}`,
      kind: classifyCandidateEndpointKind(localCandidateUrl),
      url: localCandidateUrl,
      priority: resolveCandidateEndpointPriority(localCandidateUrl),
      expiresAt: null,
      source: "host_reported"
    });
  }

  return Array.from(endpoints.values()).sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.url.localeCompare(right.url);
  });
}

function buildRelayPublicUrl(config: InstanceRelayTunnelConfig): string | null {
  if (!config.tunnelDomain || !config.controlBaseUrl) {
    return null;
  }

  try {
    const controlUrl = new URL(config.controlBaseUrl);
    controlUrl.hostname = config.tunnelDomain.trim().toLowerCase();
    controlUrl.pathname = "/";
    controlUrl.search = "";
    controlUrl.hash = "";
    return controlUrl.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function buildLocalCandidateUrls(localTargetBaseUrl: string): string[] {
  let parsed: URL;

  try {
    parsed = new URL(localTargetBaseUrl);
  } catch {
    return [];
  }

  const candidates = new Set<string>();
  const hostname = parsed.hostname.trim().toLowerCase();

  candidates.add(normalizeUrlWithoutTrailingSlash(parsed.toString()));

  if (hostname === "0.0.0.0" || hostname === "::" || hostname === "::0") {
    for (const networkAddress of listPrivateIpv4Addresses()) {
      const candidateUrl = new URL(parsed.toString());
      candidateUrl.hostname = networkAddress;
      candidates.add(normalizeUrlWithoutTrailingSlash(candidateUrl.toString()));
    }
  }

  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
    for (const networkAddress of listPrivateIpv4Addresses()) {
      const candidateUrl = new URL(parsed.toString());
      candidateUrl.hostname = networkAddress;
      candidates.add(normalizeUrlWithoutTrailingSlash(candidateUrl.toString()));
    }
  }

  return Array.from(candidates);
}

function listPrivateIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const candidates = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      if (!isPrivateIpv4Address(entry.address)) {
        continue;
      }

      candidates.add(entry.address);
    }
  }

  return Array.from(candidates).sort();
}

function isPrivateIpv4Address(address: string): boolean {
  return (
    /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function classifyCandidateEndpointKind(candidateUrl: string): HostCandidateEndpointKind {
  try {
    const hostname = new URL(candidateUrl).hostname.toLowerCase();

    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
      return "loopback";
    }

    if (isPrivateIpv4Address(hostname)) {
      return "lan";
    }

    return "custom";
  } catch {
    return "custom";
  }
}

function resolveCandidateEndpointPriority(candidateUrl: string): number {
  const kind = classifyCandidateEndpointKind(candidateUrl);

  switch (kind) {
    case "loopback":
      return 100;
    case "lan":
      return 200;
    case "tailscale":
      return 300;
    case "relay":
      return 400;
    default:
      return 500;
  }
}

function normalizeUrlWithoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
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

function deriveRelayBaseUrlFromControlBaseUrl(controlBaseUrl: string | null | undefined): string | null {
  const normalizedControlBaseUrl = normalizeHttpBaseUrl(controlBaseUrl, "controlBaseUrl");

  if (!normalizedControlBaseUrl) {
    return null;
  }

  const relayUrl = new URL("relay", ensureTrailingSlash(normalizedControlBaseUrl));
  return normalizeWebsocketBaseUrl(relayUrl.toString(), "relayBaseUrl");
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

function shouldResetStaleRelayBinding(error: unknown): boolean {
  if (!(error instanceof RelayTunnelRuntimeHttpError)) {
    return false;
  }

  return (
    error.errorCode === "TUNNEL_NOT_FOUND"
    || error.errorCode === "BINDING_NOT_FOUND"
    || error.errorCode === "HOST_AUTH_INVALID"
    || error.errorCode === "HOST_BINDING_MISMATCH"
  );
}

async function buildControlApiError(
  response: Response,
  controlBaseUrl: string,
  failurePrefix: string
): Promise<AppError> {
  const detail = await readControlApiErrorDetail(response);

  if (response.status === 401 || response.status === 403) {
    return new AppError({
      statusCode: response.status,
      errorCode: "RELAY_TUNNEL_CONTROL_ACCESS_DENIED",
      detail:
        `${failurePrefix}：控制站 ${controlBaseUrl} 拒绝了这次请求（HTTP ${response.status}）。`
        + ` 请确认这是正确的控制站地址，并检查账号、密码或访问权限。`
        + appendControlApiDetail(detail)
    });
  }

  if (response.status === 404) {
    return new AppError({
      statusCode: 404,
      errorCode: "RELAY_TUNNEL_CONTROL_ENDPOINT_NOT_FOUND",
      detail:
        `${failurePrefix}：控制站 ${controlBaseUrl} 上没有这个接口（HTTP 404）。`
        + " 这通常说明地址写错了，或者目标服务不是 CodingNS 控制站。"
        + appendControlApiDetail(detail)
    });
  }

  return new AppError({
    statusCode: response.status,
    errorCode: "RELAY_TUNNEL_CONTROL_API_ERROR",
    detail:
      `${failurePrefix}：控制站 ${controlBaseUrl} 返回了异常响应（HTTP ${response.status}）。`
      + appendControlApiDetail(detail)
  });
}

function buildControlFetchError(
  error: unknown,
  controlBaseUrl: string,
  failurePrefix: string
): AppError {
  return new AppError({
    statusCode: 502,
    errorCode: "RELAY_TUNNEL_CONTROL_UNREACHABLE",
    detail:
      `${failurePrefix}：无法连接到控制站 ${controlBaseUrl}。`
      + " 请确认服务地址、端口和网络连接是否正确。"
      + appendControlApiDetail(resolveFetchErrorDetail(error))
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

function resolveFetchErrorDetail(error: unknown): string | null {
  if (error instanceof Error) {
    const code = readFetchErrorCode(error);

    if (error.name === "AbortError") {
      return "请求超时。";
    }

    if (code === "ECONNREFUSED") {
      return "连接被目标服务器拒绝。";
    }

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return "域名无法解析。";
    }

    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return "连接超时。";
    }

    if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
      return "TLS 证书无效。";
    }

    return normalizeOptionalText(error.message);
  }

  return null;
}

function readFetchErrorCode(error: Error): string | null {
  const cause =
    "cause" in error
      ? (error as Error & { cause?: { code?: unknown } }).cause
      : undefined;
  return typeof cause?.code === "string" ? cause.code : null;
}

function normalizePositiveInt(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function resolveRelayTunnelControlFetch(fetchFn: typeof fetch | undefined): typeof fetch {
  if (fetchFn) {
    return fetchFn;
  }

  if (isBuiltinNodeFetch(globalThis.fetch)) {
    return createRelayTunnelControlFetch();
  }

  return globalThis.fetch;
}

function isBuiltinNodeFetch(fetchFn: typeof fetch): boolean {
  const source = Function.prototype.toString.call(fetchFn);
  return source.includes("internal/deps/undici/undici");
}

function createRelayTunnelControlFetch(): typeof fetch {
  return async (input, init) => {
    const requestUrl = resolveFetchInputUrl(input);
    const parsedUrl = new URL(requestUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new TypeError(`Unsupported protocol for relay tunnel control fetch: ${parsedUrl.protocol}`);
    }

    return await new Promise<Response>((resolve, reject) => {
      const transport = parsedUrl.protocol === "https:" ? https : http;
      const headers = normalizeFetchHeaders(init?.headers);
      const body = normalizeFetchBody(init?.body);
      const abortHandler = () => request.destroy(createAbortRequestError());
      const request = transport.request(
        parsedUrl,
        {
          method: init?.method ?? "GET",
          headers,
          agent: parsedUrl.protocol === "https:" ? RELAY_TUNNEL_CONTROL_HTTPS_AGENT : undefined
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            cleanup();
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 500,
                headers: buildFetchResponseHeaders(response.headers)
              })
            );
          });
          response.on("error", (error) => {
            cleanup();
            reject(error);
          });
        }
      );

      function cleanup(): void {
        init?.signal?.removeEventListener("abort", abortHandler);
      }

      request.on("error", (error) => {
        cleanup();
        reject(error);
      });

      if (init?.signal) {
        if (init.signal.aborted) {
          cleanup();
          request.destroy(createAbortRequestError());
          return;
        }

        init.signal.addEventListener("abort", abortHandler, { once: true });
      }

      if (body !== null) {
        request.write(body);
      }

      request.end();
    });
  };
}

type RelayTunnelFetchInput = string | URL | { url: string };

function resolveFetchInputUrl(input: RelayTunnelFetchInput): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function normalizeFetchHeaders(headers: unknown): Record<string, string> {
  if (!headers) {
    return {};
  }

  return Object.fromEntries(new Headers(headers as ConstructorParameters<typeof Headers>[0]).entries());
}

function normalizeFetchBody(body: unknown): string | Buffer | null {
  if (body === null || body === undefined) {
    return null;
  }

  if (typeof body === "string" || Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  throw new TypeError("Unsupported relay tunnel control request body type");
}

function buildFetchResponseHeaders(
  headers: http.IncomingHttpHeaders
): Headers {
  const responseHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(name, item);
      }
      continue;
    }

    if (typeof value === "string") {
      responseHeaders.set(name, value);
    }
  }

  return responseHeaders;
}

function createAbortRequestError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

function appendControlApiDetail(detail: string | null | undefined): string {
  const normalized = normalizeOptionalText(detail);

  if (!normalized) {
    return "";
  }

  return ` 详情：${normalized}`;
}
