import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ChannelAccount,
  ChannelConnectionMode
} from "../../types/domain.js";
import type { ChannelBridgeService } from "./channel-bridge-service.js";
import type { ChannelDeliveryService } from "./channel-delivery-service.js";
import type { ChannelPlatformAdapterRegistry } from "./channel-platform-adapters.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import type { TaskManager } from "../tasks/task-manager.js";
import type { WechatClawRuntimeClient } from "./wechat-claw-runtime-client.js";
import { createWechatClawRuntimeRequiredError } from "./wechat-claw-runtime-boundary.js";

export interface ChannelPollTaskResult {
  accountId: string;
  inboundCount: number;
  dispatchedCount: number;
  duplicateCount: number;
  requestedAt: string;
}

export interface RunDueChannelPollsResult {
  idle: boolean;
  dueAccountCount: number;
}

interface ChannelAccountRepository {
  findById(id: string): ChannelAccount | null;
  listActiveByConnectionModes(connectionModes: ChannelConnectionMode[]): ChannelAccount[];
  update(record: ChannelAccount): ChannelAccount;
}

interface LoggerLike {
  error(message: string, detail?: unknown): void;
}

export class ChannelPollingService {
  private readonly logger: LoggerLike;
  private readonly wechatClawRuntimeClient: WechatClawRuntimeClient | null;

  constructor(
    private readonly channelAccountRepository: ChannelAccountRepository,
    private readonly adapterRegistry: ChannelPlatformAdapterRegistry,
    private readonly channelBridgeService: Pick<ChannelBridgeService, "dispatchInboundText">,
    private readonly channelDeliveryService: Pick<ChannelDeliveryService, "deliverAssistantReply">,
    private readonly taskManager: TaskManager,
    options: {
      logger?: LoggerLike;
      wechatClawRuntimeClient?: WechatClawRuntimeClient | null;
    } = {}
  ) {
    this.logger = options.logger ?? console;
    this.wechatClawRuntimeClient = options.wechatClawRuntimeClient ?? null;
    this.registerBackgroundTasks();
  }

  requestPoll(accountId: string, source = "channel.manual_poll"): TaskHandle<ChannelPollTaskResult> {
    const account = this.requirePollingAccount(accountId);
    const requestedAt = nowIso();

    this.channelAccountRepository.update({
      ...account,
      runtimeState: {
        ...account.runtimeState,
        lastManualPollRequestedAt: requestedAt,
        lastManualPollSource: source
      },
      updatedAt: requestedAt
    });

    const handle = this.taskManager.enqueue<{ accountId: string; requestedAt: string }, ChannelPollTaskResult>(
      HOST_TASK_TYPES.channelAccountPoll,
      {
        key: account.id,
        source,
        input: {
          accountId: account.id,
          requestedAt
        }
      }
    );

    this.observeBackgroundTask(handle, source);
    return handle;
  }

  async runDuePolls(referenceAt: string): Promise<RunDueChannelPollsResult> {
    const accounts = this.channelAccountRepository
      .listActiveByConnectionModes(["polling"])
      .filter((account) => account.platformCode !== "wechat-claw" || this.wechatClawRuntimeClient);

    for (const account of accounts) {
      const handle = this.taskManager.enqueue<{ accountId: string; requestedAt: string }, ChannelPollTaskResult>(
        HOST_TASK_TYPES.channelAccountPoll,
        {
          key: account.id,
          source: "channel.polling_scheduler",
          input: {
            accountId: account.id,
            requestedAt: referenceAt
          }
        }
      );
      this.observeBackgroundTask(handle, "channel.polling_scheduler");
    }

    return {
      idle: accounts.length === 0,
      dueAccountCount: accounts.length
    };
  }

  private registerBackgroundTasks(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.channelAccountPoll)) {
      return;
    }

    this.taskManager.register<{ accountId: string; requestedAt: string }, ChannelPollTaskResult>({
      taskType: HOST_TASK_TYPES.channelAccountPoll,
      executionLane: "host_background",
      timeoutMs: 70_000,
      run: async (input) => this.runPollTask(input.accountId, input.requestedAt)
    });
  }

  private async runPollTask(accountId: string, requestedAt: string): Promise<ChannelPollTaskResult> {
    const account = this.requirePollingAccount(accountId);
    const adapter = this.adapterRegistry.require(account.platformCode);
    let pollResult;

    try {
      pollResult = await adapter.poll(account);
    } catch (error) {
      const failedAt = nowIso();
      const detail = error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : "通讯平台轮询失败";

      this.channelAccountRepository.update({
        ...account,
        status: account.status === "disabled" ? "disabled" : "degraded",
        runtimeState: {
          ...account.runtimeState,
          lastPollAt: failedAt,
          lastPollFailedAt: failedAt,
          lastPollDetail: detail
        },
        lastError: detail,
        updatedAt: failedAt
      });

      throw error;
    }

    const refreshedAt = nowIso();
    const updatedAccount = this.channelAccountRepository.update({
      ...account,
      status: account.status === "disabled" ? "disabled" : "active",
      runtimeState: pollResult.runtimeStatePatch
        ? {
            ...account.runtimeState,
            ...pollResult.runtimeStatePatch,
            lastPollAt: refreshedAt,
            lastPollDetail: pollResult.detail ?? null
          }
        : {
            ...account.runtimeState,
            lastPollAt: refreshedAt,
            lastPollDetail: pollResult.detail ?? null
          },
      lastError: null,
      updatedAt: refreshedAt
    });

    let dispatchedCount = 0;
    let duplicateCount = 0;

    for (const message of pollResult.inboundMessages) {
      const dispatch = await this.channelBridgeService.dispatchInboundText(updatedAccount.id, message);
      if (dispatch.dispatch.mode === "duplicate") {
        duplicateCount += 1;
        continue;
      }

      dispatchedCount += 1;
      void this.channelDeliveryService.deliverAssistantReply(dispatch).catch(() => {
        return;
      });
    }

    return {
      accountId: updatedAccount.id,
      inboundCount: pollResult.inboundMessages.length,
      dispatchedCount,
      duplicateCount,
      requestedAt
    };
  }

  private observeBackgroundTask(handle: TaskHandle<ChannelPollTaskResult>, source: string): void {
    void handle.promise.catch((error) => {
      this.logger.error("[channel-polling-service] background poll failed", {
        accountId: handle.key,
        source,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private requirePollingAccount(accountId: string): ChannelAccount {
    const account = this.channelAccountRepository.findById(accountId.trim());

    if (!account) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CHANNEL_ACCOUNT_NOT_FOUND",
        detail: "目标通讯平台账号不存在"
      });
    }

    if (account.connectionMode !== "polling") {
      throw new AppError({
        statusCode: 400,
        errorCode: "CHANNEL_POLL_UNSUPPORTED",
        detail: "当前账号不是 polling 模式"
      });
    }

    if (account.platformCode === "wechat-claw" && !this.wechatClawRuntimeClient) {
      throw createWechatClawRuntimeRequiredError();
    }

    return account;
  }
}
