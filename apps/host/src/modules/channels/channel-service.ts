import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerProfileProviderId,
  ChannelAccount,
  ChannelAccountStatus,
  ChannelConnectionMode,
  ChannelDelivery,
  ChannelInboundEvent,
  ChannelPlatformCapability,
  ChannelPlatformCode,
  ChannelThread
} from "../../types/domain.js";
import { createProviderDisabledError } from "../provider/provider-disabled.js";
import { getChannelPlatformCapability, listChannelPlatformCapabilities } from "./channel-platform-catalog.js";
import type { ChannelPlatformAdapterRegistry } from "./channel-platform-adapters.js";
import type { ChannelPollingService } from "./channel-polling-service.js";
import type { WechatClawRuntimeClient } from "./wechat-claw-runtime-client.js";
import { createWechatClawRuntimeRequiredError } from "./wechat-claw-runtime-boundary.js";

export interface CreateChannelAccountInput {
  platformCode?: unknown;
  displayName?: unknown;
  providerId?: unknown;
  connectionMode?: unknown;
  status?: unknown;
  config?: unknown;
}

export interface UpdateChannelAccountInput {
  displayName?: unknown;
  providerId?: unknown;
  connectionMode?: unknown;
  status?: unknown;
  config?: unknown;
}

export interface ChannelAccountSummary extends ChannelAccount {
  capability: ChannelPlatformCapability;
  threadCount: number;
  inboundEventCount: number;
  deliveryCount: number;
}

export interface ProbeChannelAccountResult {
  account: ChannelAccountSummary;
  checkedAt: string;
  ok: boolean;
  detail: string;
  warnings: string[];
}

export interface PollChannelAccountResult {
  account: ChannelAccountSummary;
  requestedAt: string;
  accepted: boolean;
  detail: string;
}

type WechatClawLoginStatus =
  | "not_logged_in"
  | "waiting_scan"
  | "scan_confirmed"
  | "active"
  | "expired";

export interface WechatClawLoginActionResult {
  account: ChannelAccountSummary;
  actedAt: string;
  detail: string;
  loginStatus: WechatClawLoginStatus;
  qrcodeUrl: string | null;
  qrcodeSourceUrl: string | null;
  qrcodeText: string | null;
}

export interface RemoveChannelAccountResult {
  accountId: string;
  displayName: string;
  removedAt: string;
}

interface ChannelAccountRepository {
  listByUserId(userId: string): ChannelAccount[];
  findById(id: string): ChannelAccount | null;
  create(record: ChannelAccount): ChannelAccount;
  update(record: ChannelAccount): ChannelAccount;
  delete(id: string): boolean;
}

interface ChannelThreadRepository {
  listByAccountId(channelAccountId: string, limit?: number): ChannelThread[];
  countByAccountId(channelAccountId: string): number;
}

interface ChannelInboundEventRepository {
  listByAccountId(channelAccountId: string, limit?: number): ChannelInboundEvent[];
  countByAccountId(channelAccountId: string): number;
}

interface ChannelDeliveryRepository {
  listByAccountId(channelAccountId: string, limit?: number): ChannelDelivery[];
  countByAccountId(channelAccountId: string): number;
}

interface ProviderControlRepository {
  get(providerId: string): {
    enabled: boolean;
  };
}

export class ChannelService {
  constructor(
    private readonly channelAccountRepository: ChannelAccountRepository,
    private readonly channelThreadRepository: ChannelThreadRepository,
    private readonly channelInboundEventRepository: ChannelInboundEventRepository,
    private readonly channelDeliveryRepository: ChannelDeliveryRepository,
    private readonly providerControlRepository: ProviderControlRepository,
    private readonly adapterRegistry: ChannelPlatformAdapterRegistry,
    private readonly channelPollingService: Pick<ChannelPollingService, "requestPoll"> | null = null,
    private readonly wechatClawRuntimeClient: WechatClawRuntimeClient | null = null
  ) {}

  listPlatforms(): ChannelPlatformCapability[] {
    return listChannelPlatformCapabilities();
  }

  listAccounts(userId: string): ChannelAccountSummary[] {
    return this.channelAccountRepository
      .listByUserId(userId)
      .filter((account) => getChannelPlatformCapability(account.platformCode) !== null)
      .map((account) => this.toAccountSummary(account));
  }

  createAccount(userId: string, input: CreateChannelAccountInput): ChannelAccountSummary {
    const platformCode = normalizePlatformCode(input.platformCode);
    const displayName = normalizeDisplayName(input.displayName);
    const providerId = normalizeProviderId(input.providerId ?? "codex");
    this.ensureProviderEnabled(providerId, "providerId");
    const connectionMode = normalizeConnectionMode(
      input.connectionMode,
      platformCode,
      "connectionMode"
    );
    const status = normalizeChannelAccountStatus(input.status ?? "active");
    const config = normalizePlainObject(input.config, "config");
    const timestamp = nowIso();

    const account = this.channelAccountRepository.create({
      id: createId(),
      userId,
      platformCode,
      displayName,
      providerId,
      connectionMode,
      status,
      config,
      runtimeState: {},
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return this.toAccountSummary(account);
  }

  updateAccount(
    userId: string,
    accountId: string,
    input: UpdateChannelAccountInput
  ): ChannelAccountSummary {
    const current = this.getOwnedAccountOrThrow(userId, accountId);
    const platformCode = current.platformCode;
    const providerId =
      input.providerId !== undefined
        ? normalizeProviderId(input.providerId)
        : current.providerId;
    this.ensureProviderEnabled(providerId, "providerId");

    const updated = this.channelAccountRepository.update({
      ...current,
      displayName:
        input.displayName !== undefined
          ? normalizeDisplayName(input.displayName)
          : current.displayName,
      providerId,
      connectionMode:
        input.connectionMode !== undefined
          ? normalizeConnectionMode(input.connectionMode, platformCode, "connectionMode")
          : current.connectionMode,
      status:
        input.status !== undefined
          ? normalizeChannelAccountStatus(input.status)
          : current.status,
      config:
        input.config !== undefined
          ? normalizePlainObject(input.config, "config")
          : current.config,
      updatedAt: nowIso()
    });

    return this.toAccountSummary(updated);
  }

  async removeAccount(userId: string, accountId: string): Promise<RemoveChannelAccountResult> {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    const removedAt = nowIso();

    if (account.platformCode === "wechat-claw" && this.wechatClawRuntimeClient) {
      try {
        await this.wechatClawRuntimeClient.logout(account.id);
      } catch {
        // 删除账号时以主库删除为准，helper 私有态清理失败不阻塞移除。
      }
    }

    const deleted = this.channelAccountRepository.delete(account.id);
    if (!deleted) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CHANNEL_ACCOUNT_NOT_FOUND",
        detail: "目标通讯平台账号不存在"
      });
    }

    return {
      accountId: account.id,
      displayName: account.displayName,
      removedAt
    };
  }

  async probeAccount(userId: string, accountId: string): Promise<ProbeChannelAccountResult> {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    const checkedAt = nowIso();
    const warnings: string[] = [];
    let nextStatus: ChannelAccountStatus = account.status;
    let detail = "本地配置校验通过。";

    this.ensureProviderEnabled(account.providerId, "providerId");

    const capability = getChannelPlatformCapability(account.platformCode);
    if (!capability) {
      throw invalidField("platformCode", "未识别的通讯平台");
    }

    if (!capability.supportedConnectionModes.includes(account.connectionMode)) {
      nextStatus = "degraded";
      detail = `${capability.displayName} 当前不支持 ${account.connectionMode} 模式`;
      warnings.push("账号连接模式和平台能力声明不一致。");
    }

    const probeResult = await this.adapterRegistry.require(account.platformCode).probe(account);
    detail = probeResult.detail;
    warnings.push(...probeResult.warnings);

    if (!probeResult.ok) {
      nextStatus = "degraded";
    }

    const probed = this.channelAccountRepository.update({
      ...account,
      status: nextStatus,
      runtimeState: {
        ...account.runtimeState,
        lastProbeAt: checkedAt,
        lastProbeDetail: detail,
        lastProbeWarnings: warnings
      },
      lastError: nextStatus === "degraded" ? detail : null,
      updatedAt: checkedAt
    });

    return {
      account: this.toAccountSummary(probed),
      checkedAt,
      ok: nextStatus !== "degraded",
      detail,
      warnings
    };
  }

  requestPoll(userId: string, accountId: string): PollChannelAccountResult {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    const requestedAt = nowIso();

    if (account.connectionMode !== "polling") {
      throw invalidField("accountId", "当前账号不是 polling 模式，不能手动触发 poll");
    }

    if (account.platformCode === "wechat-claw" && !this.wechatClawRuntimeClient) {
      throw createWechatClawRuntimeRequiredError();
    }

    const updated = this.channelAccountRepository.update({
      ...account,
      runtimeState: {
        ...account.runtimeState,
        lastManualPollRequestedAt: requestedAt,
        lastManualPollSource: "api"
      },
      updatedAt: requestedAt
    });

    this.channelPollingService?.requestPoll(account.id, "channel.manual_poll_api");

    return {
      account: this.toAccountSummary(updated),
      requestedAt,
      accepted: true,
      detail: "已记录手动 poll 请求，并已进入后台任务队列。"
    };
  }

  listThreads(userId: string, accountId: string, limit = 50): ChannelThread[] {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    return this.channelThreadRepository.listByAccountId(account.id, normalizeLimit(limit));
  }

  listInboundEvents(userId: string, accountId: string, limit = 50): ChannelInboundEvent[] {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    return this.channelInboundEventRepository.listByAccountId(account.id, normalizeLimit(limit));
  }

  listDeliveries(userId: string, accountId: string, limit = 50): ChannelDelivery[] {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    return this.channelDeliveryRepository.listByAccountId(account.id, normalizeLimit(limit));
  }

  async startWechatClawLogin(userId: string, accountId: string): Promise<WechatClawLoginActionResult> {
    const account = this.getOwnedWechatClawAccountOrThrow(userId, accountId);
    const result = await this.requireWechatClawRuntimeClient().startLogin(account);
    const updated = this.syncWechatClawRuntimeState(account, result.session, result.detail, result.actedAt);

    return {
      account: this.toAccountSummary(updated),
      actedAt: result.actedAt,
      detail: result.detail,
      loginStatus: result.session.status,
      qrcodeUrl: result.session.qrCodeUrl,
      qrcodeSourceUrl: result.session.qrCodeSourceUrl,
      qrcodeText: result.session.qrCodeText
    };
  }

  async refreshWechatClawLogin(userId: string, accountId: string): Promise<WechatClawLoginActionResult> {
    const account = this.getOwnedWechatClawAccountOrThrow(userId, accountId);
    const result = await this.requireWechatClawRuntimeClient().getLoginStatus(account.id);
    const updated = this.syncWechatClawRuntimeState(account, result.session, result.detail, result.checkedAt);

    return {
      account: this.toAccountSummary(updated),
      actedAt: result.checkedAt,
      detail: result.detail,
      loginStatus: result.session.status,
      qrcodeUrl: result.session.qrCodeUrl,
      qrcodeSourceUrl: result.session.qrCodeSourceUrl,
      qrcodeText: result.session.qrCodeText
    };
  }

  async logoutWechatClaw(userId: string, accountId: string): Promise<WechatClawLoginActionResult> {
    const account = this.getOwnedWechatClawAccountOrThrow(userId, accountId);
    const result = await this.requireWechatClawRuntimeClient().logout(account.id);
    const updated = this.channelAccountRepository.update({
      ...account,
      status: account.status === "disabled" ? "disabled" : "degraded",
      runtimeState: {
        ...account.runtimeState,
        wechatClawLoginStatus: "not_logged_in",
        wechatClawQrCodeText: null,
        wechatClawQrCodeUrl: null,
        wechatClawQrCodeSourceUrl: null,
        wechatClawLastDetail: result.detail,
        wechatClawUpdatedAt: result.actedAt
      },
      lastError: result.detail,
      updatedAt: result.actedAt
    });

    return {
      account: this.toAccountSummary(updated),
      actedAt: result.actedAt,
      detail: result.detail,
      loginStatus: "not_logged_in",
      qrcodeUrl: null,
      qrcodeSourceUrl: null,
      qrcodeText: null
    };
  }

  private toAccountSummary(account: ChannelAccount): ChannelAccountSummary {
    const capability = getChannelPlatformCapability(account.platformCode);

    if (!capability) {
      throw new AppError({
        statusCode: 500,
        errorCode: "CHANNEL_PLATFORM_UNREGISTERED",
        detail: `平台 ${account.platformCode} 未注册到 channels 平台目录`
      });
    }

    return {
      ...account,
      capability,
      threadCount: this.channelThreadRepository.countByAccountId(account.id),
      inboundEventCount: this.channelInboundEventRepository.countByAccountId(account.id),
      deliveryCount: this.channelDeliveryRepository.countByAccountId(account.id)
    };
  }

  private getOwnedAccountOrThrow(userId: string, accountId: string): ChannelAccount {
    const account = this.channelAccountRepository.findById(accountId);

    if (!account || account.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CHANNEL_ACCOUNT_NOT_FOUND",
        detail: "目标通讯平台账号不存在"
      });
    }

    return account;
  }

  private ensureProviderEnabled(providerId: ButlerProfileProviderId, field: string): void {
    if (!this.providerControlRepository.get(providerId).enabled) {
      throw createProviderDisabledError(providerId, field);
    }
  }

  private requireWechatClawRuntimeClient(): WechatClawRuntimeClient {
    if (!this.wechatClawRuntimeClient) {
      throw createWechatClawRuntimeRequiredError();
    }

    return this.wechatClawRuntimeClient;
  }

  private getOwnedWechatClawAccountOrThrow(userId: string, accountId: string): ChannelAccount {
    const account = this.getOwnedAccountOrThrow(userId, accountId);
    if (account.platformCode !== "wechat-claw") {
      throw invalidField("accountId", "当前账号不是个人微信（claw）");
    }

    return account;
  }

  private syncWechatClawRuntimeState(
    account: ChannelAccount,
    session: {
      status: WechatClawLoginStatus;
      qrCodeText: string | null;
      qrCodeUrl: string | null;
      qrCodeSourceUrl?: string | null;
      lastErrorMessage: string | null;
    },
    detail: string,
    updatedAt: string
  ): ChannelAccount {
    return this.channelAccountRepository.update({
      ...account,
      status:
        account.status === "disabled"
          ? "disabled"
          : session.status === "active"
            ? "active"
            : "degraded",
      runtimeState: {
        ...account.runtimeState,
        wechatClawLoginStatus: session.status,
        wechatClawQrCodeText: session.qrCodeText,
        wechatClawQrCodeUrl: session.qrCodeUrl,
        wechatClawQrCodeSourceUrl: session.qrCodeSourceUrl ?? null,
        wechatClawLastDetail: detail,
        wechatClawUpdatedAt: updatedAt
      },
      lastError: session.status === "active" ? null : session.lastErrorMessage ?? detail,
      updatedAt
    });
  }
}

function normalizePlatformCode(value: unknown): ChannelPlatformCode {
  if (typeof value !== "string") {
    throw invalidField("platformCode", "platformCode 必须是已注册的平台代码");
  }

  const normalized = value.trim() as ChannelPlatformCode;

  if (!getChannelPlatformCapability(normalized)) {
    throw invalidField("platformCode", "platformCode 必须是已注册的平台代码");
  }

  return normalized;
}

function normalizeProviderId(value: unknown): ButlerProfileProviderId {
  if (typeof value !== "string") {
    throw invalidField("providerId", "providerId 只允许为 codex 或 claude-code");
  }

  const normalized = value.trim() as ButlerProfileProviderId;

  if (normalized !== "codex" && normalized !== "claude-code") {
    throw invalidField("providerId", "providerId 只允许为 codex 或 claude-code");
  }

  return normalized;
}

function normalizeConnectionMode(
  value: unknown,
  platformCode: ChannelPlatformCode,
  field: string
): ChannelConnectionMode {
  if (typeof value !== "string") {
    throw invalidField(field, "connectionMode 当前只允许 polling");
  }

  const normalized = value.trim() as ChannelConnectionMode;
  if (normalized !== "polling") {
    throw invalidField(field, "connectionMode 当前只允许 polling");
  }

  const capability = getChannelPlatformCapability(platformCode);
  if (!capability) {
    throw invalidField("platformCode", "未识别的通讯平台");
  }

  if (!capability.supportedConnectionModes.includes(normalized)) {
    throw invalidField(field, `${capability.displayName} 当前不支持 ${normalized} 模式`);
  }

  return normalized;
}

function normalizeChannelAccountStatus(value: unknown): ChannelAccountStatus {
  if (typeof value !== "string") {
    throw invalidField("status", "status 只允许为 active、disabled 或 degraded");
  }

  const normalized = value.trim() as ChannelAccountStatus;
  if (normalized !== "active" && normalized !== "disabled" && normalized !== "degraded") {
    throw invalidField("status", "status 只允许为 active、disabled 或 degraded");
  }

  return normalized;
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidField("displayName", "displayName 必须是非空字符串");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw invalidField("displayName", "displayName 必须是非空字符串");
  }

  return normalized;
}

function normalizePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidField(field, `${field} 必须是对象`);
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(200, Math.max(1, Math.trunc(limit)));
}

function invalidField(field: string, detail: string): AppError {
  return new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail,
    field
  });
}
