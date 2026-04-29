import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ChannelAccount,
  ChannelDelivery,
  ChannelInboundEvent,
  ChannelThread
} from "../../types/domain.js";
import type { ChannelBridgeDispatchResult } from "./channel-bridge-service.js";
import type { ChannelPlatformAdapterRegistry, ChannelSendTextResult } from "./channel-platform-adapters.js";
import type { SessionHistoryEnvelope } from "../sessions/session-history-service.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import type { TaskManager } from "../tasks/task-manager.js";

interface ChannelAccountRepository {
  findById(id: string): ChannelAccount | null;
  update(record: ChannelAccount): ChannelAccount;
}

interface ChannelThreadRepository {
  findById(id: string): ChannelThread | null;
  update(record: ChannelThread): ChannelThread;
}

interface ChannelInboundEventRepository {
  findById(id: string): ChannelInboundEvent | null;
  update(record: ChannelInboundEvent): ChannelInboundEvent;
}

interface ChannelDeliveryRepository {
  findById(id: string): ChannelDelivery | null;
  findByInboundEventId(inboundEventId: string): ChannelDelivery | null;
  listRetryableFailures(limit?: number): ChannelDelivery[];
  create(record: ChannelDelivery): ChannelDelivery;
  update(record: ChannelDelivery): ChannelDelivery;
}

interface SessionHistoryService {
  readRecentHistoryEnvelope(sessionId: string, limit?: number): Promise<SessionHistoryEnvelope | null>;
}

interface LoggerLike {
  error(message: string, detail?: unknown): void;
  warn?(message: string, detail?: unknown): void;
  info?(message: string, detail?: unknown): void;
}

export interface ChannelDeliveryRetryTaskResult {
  deliveryId: string;
  status: "sent" | "skipped";
  attemptedAt: string;
  detail: string | null;
}

export class ChannelDeliveryService {
  constructor(
    private readonly channelAccountRepository: ChannelAccountRepository,
    private readonly channelThreadRepository: ChannelThreadRepository,
    private readonly channelInboundEventRepository: ChannelInboundEventRepository,
    private readonly channelDeliveryRepository: ChannelDeliveryRepository,
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly adapterRegistry: ChannelPlatformAdapterRegistry,
    private readonly taskManager: Pick<TaskManager, "has" | "register" | "enqueue">,
    private readonly logger: LoggerLike = console
  ) {
    this.registerBackgroundTasks();
  }

  async deliverAssistantReply(dispatch: ChannelBridgeDispatchResult): Promise<ChannelDelivery> {
    const existing = this.channelDeliveryRepository.findByInboundEventId(dispatch.event.id);
    if (existing) {
      return existing;
    }

    const assistantText = await this.waitForAssistantText(
      dispatch.controlSession.sessionId,
      dispatch.dispatch.acceptedAt
    );

    if (!assistantText) {
      return this.failDelivery(dispatch, "等待 Butler 回复超时");
    }

    return this.sendInitialDelivery(dispatch, assistantText);
  }

  recoverRetryableDeliveries(limit = 100): number {
    const deliveries = this.channelDeliveryRepository.listRetryableFailures(limit);

    for (const delivery of deliveries) {
      this.requestRetry(delivery.id, "channel.delivery_recovery");
    }

    return deliveries.length;
  }

  requestRetry(
    deliveryId: string,
    source = "channel.delivery_retry"
  ): TaskHandle<ChannelDeliveryRetryTaskResult> {
    return this.taskManager.enqueue<{ deliveryId: string }, ChannelDeliveryRetryTaskResult>(
      HOST_TASK_TYPES.channelDeliveryRetry,
      {
        key: deliveryId,
        source,
        input: {
          deliveryId
        }
      }
    );
  }

  private registerBackgroundTasks(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.channelDeliveryRetry)) {
      return;
    }

    this.taskManager.register<{ deliveryId: string }, ChannelDeliveryRetryTaskResult>({
      taskType: HOST_TASK_TYPES.channelDeliveryRetry,
      executionLane: "host_background",
      timeoutMs: 15_000,
      retryPolicy: {
        maxAttempts: 3,
        backoffMs: (attempt) => attempt * 3_000
      },
      run: async (input) => this.runRetryTask(input.deliveryId)
    });
  }

  private async sendInitialDelivery(
    dispatch: ChannelBridgeDispatchResult,
    assistantText: string
  ): Promise<ChannelDelivery> {
    const account = this.channelAccountRepository.findById(dispatch.account.id) ?? dispatch.account;
    const adapter = this.adapterRegistry.require(account.platformCode);
    const replyDelayMs = computeChannelDelayMs(dispatch.event.receivedAt, nowIso());

    this.logger.info?.("[channel-delivery] assistant reply ready", {
      accountId: account.id,
      platformCode: account.platformCode,
      threadId: dispatch.thread.id,
      inboundEventId: dispatch.event.id,
      controlSessionId: dispatch.controlSession.id,
      inboundReceivedAt: dispatch.event.receivedAt,
      replyDelayMs,
      assistantTextLength: assistantText.length,
      assistantTextPreview: previewChannelTextForLog(assistantText)
    });

    try {
      const sendResult = await adapter.sendText(account, dispatch.thread, assistantText);
      this.logger.info?.("[channel-delivery] sendText returned", {
        accountId: account.id,
        platformCode: account.platformCode,
        threadId: dispatch.thread.id,
        inboundEventId: dispatch.event.id,
        providerMessageRef: sendResult.providerMessageRef,
        status: sendResult.status,
        detail: sendResult.detail ?? null
      });
      return this.persistDeliverySuccess(
        {
          account,
          thread: dispatch.thread,
          event: dispatch.event
        },
        {
          existingDelivery: null,
          controlSessionId: dispatch.controlSession.id,
          sessionId: dispatch.controlSession.sessionId,
          textContent: assistantText,
          sendResult
        }
      );
    } catch (error) {
      const detail = resolveDeliveryError(error);
      this.logger.error("[channel-delivery] initial sendText failed", {
        accountId: dispatch.account.id,
        inboundEventId: dispatch.event.id,
        detail
      });
      const failedDelivery = this.failDelivery(dispatch, detail, assistantText);
      this.requestRetry(failedDelivery.id, "channel.delivery_initial_failed");
      return failedDelivery;
    }
  }

  private async runRetryTask(deliveryId: string): Promise<ChannelDeliveryRetryTaskResult> {
    const attemptedAt = nowIso();
    const delivery = this.channelDeliveryRepository.findById(deliveryId);

    if (!delivery) {
      return {
        deliveryId,
        status: "skipped",
        attemptedAt,
        detail: "目标回发记录不存在"
      };
    }

    const retryContext = this.resolveRetryContext(delivery);
    if (!retryContext.ok) {
      return {
        deliveryId,
        status: "skipped",
        attemptedAt,
        detail: retryContext.detail
      };
    }

    const { account, thread, event } = retryContext;
    if (account.status === "disabled") {
      return {
        deliveryId,
        status: "skipped",
        attemptedAt,
        detail: "账号已停用，跳过回发重试"
      };
    }

    try {
      const sendResult = await this.adapterRegistry
        .require(account.platformCode)
        .sendText(account, thread, delivery.textContent);
      const updated = this.persistDeliverySuccess(
        {
          account,
          thread,
          event
        },
        {
          existingDelivery: delivery,
          controlSessionId: delivery.controlSessionId,
          sessionId: delivery.sessionId,
          textContent: delivery.textContent,
          sendResult
        }
      );

      return {
        deliveryId: updated.id,
        status: "sent",
        attemptedAt: updated.updatedAt,
        detail: sendResult.detail ?? null
      };
    } catch (error) {
      const detail = resolveDeliveryError(error);
      this.logger.error("[channel-delivery] retry sendText failed", {
        deliveryId,
        accountId: account.id,
        detail
      });
      this.persistDeliveryFailure({
        delivery,
        account,
        event,
        detail,
        textContent: delivery.textContent
      });
      throw new AppError({
        statusCode: 502,
        errorCode: "CHANNEL_DELIVERY_RETRY_FAILED",
        detail
      });
    }
  }

  private resolveRetryContext(
    delivery: ChannelDelivery
  ):
    | {
        ok: true;
        account: ChannelAccount;
        thread: ChannelThread;
        event: ChannelInboundEvent;
      }
    | {
        ok: false;
        detail: string;
      } {
    if (!delivery.textContent.trim()) {
      return {
        ok: false,
        detail: "回发文本为空，不能重试"
      };
    }

    if (!delivery.threadId || !delivery.inboundEventId) {
      return {
        ok: false,
        detail: "缺少 thread / event 上下文，不能重试"
      };
    }

    const account = this.channelAccountRepository.findById(delivery.channelAccountId);
    const thread = this.channelThreadRepository.findById(delivery.threadId);
    const event = this.channelInboundEventRepository.findById(delivery.inboundEventId);

    if (!account || !thread || !event) {
      return {
        ok: false,
        detail: "重试所需的账号、线程或事件记录不存在"
      };
    }

    return {
      ok: true,
      account,
      thread,
      event
    };
  }

  private persistDeliverySuccess(
    context: {
      account: ChannelAccount;
      thread: ChannelThread;
      event: ChannelInboundEvent;
    },
    options: {
      existingDelivery: ChannelDelivery | null;
      controlSessionId: string | null;
      sessionId: string | null;
      textContent: string;
      sendResult: ChannelSendTextResult;
    }
  ): ChannelDelivery {
    const deliveredAt = nowIso();
    const { account, thread, event } = context;
    const { existingDelivery, controlSessionId, sessionId, textContent, sendResult } = options;
    const persistedErrorMessage = null;
    const delivery = existingDelivery
      ? this.channelDeliveryRepository.update({
          ...existingDelivery,
          textContent,
          providerMessageRef: sendResult.providerMessageRef,
          status: sendResult.status,
          errorMessage: persistedErrorMessage,
          updatedAt: deliveredAt
        })
      : this.channelDeliveryRepository.create({
          id: createId(),
          channelAccountId: account.id,
          threadId: thread.id,
          inboundEventId: event.id,
          controlSessionId,
          sessionId,
          textContent,
          providerMessageRef: sendResult.providerMessageRef,
          status: sendResult.status,
          errorMessage: persistedErrorMessage,
          createdAt: deliveredAt,
          updatedAt: deliveredAt
        });

    this.channelThreadRepository.update({
      ...thread,
      lastOutboundAt: deliveredAt,
      lastTransportContext: sendResult.runtimeStatePatch
        ? {
            ...thread.lastTransportContext,
            ...sendResult.runtimeStatePatch
          }
        : thread.lastTransportContext,
      updatedAt: deliveredAt
    });

    this.channelAccountRepository.update({
      ...account,
      runtimeState: sendResult.runtimeStatePatch
        ? {
            ...account.runtimeState,
            ...sendResult.runtimeStatePatch
          }
        : account.runtimeState,
      lastOutboundAt: deliveredAt,
      lastError: sendResult.status === "sent" ? null : sendResult.detail ?? null,
      updatedAt: deliveredAt
    });

    this.channelInboundEventRepository.update({
      ...event,
      status: sendResult.status === "sent" || sendResult.status === "skipped" ? "replied" : "failed",
      errorMessage: persistedErrorMessage,
      payload: {
        ...event.payload,
        deliveryId: delivery.id,
        threadId: thread.id
      },
      processedAt: deliveredAt
    });

    this.logger.info?.("[channel-delivery] delivery persisted", {
      deliveryId: delivery.id,
      accountId: account.id,
      platformCode: account.platformCode,
      threadId: thread.id,
      inboundEventId: event.id,
      providerMessageRef: delivery.providerMessageRef,
      status: delivery.status,
      textLength: textContent.length,
      textPreview: previewChannelTextForLog(textContent)
    });

    return delivery;
  }

  private persistDeliveryFailure(input: {
    delivery: ChannelDelivery;
    account: ChannelAccount;
    event: ChannelInboundEvent;
    detail: string;
    textContent: string;
  }): ChannelDelivery {
    const failedAt = nowIso();
    const delivery = this.channelDeliveryRepository.update({
      ...input.delivery,
      textContent: input.textContent,
      providerMessageRef: null,
      status: "failed",
      errorMessage: input.detail,
      updatedAt: failedAt
    });

    this.channelInboundEventRepository.update({
      ...input.event,
      status: "failed",
      errorMessage: input.detail,
      payload: {
        ...input.event.payload,
        deliveryId: delivery.id
      },
      processedAt: failedAt
    });

    this.channelAccountRepository.update({
      ...input.account,
      status: input.account.status === "disabled" ? "disabled" : "degraded",
      lastError: input.detail,
      updatedAt: failedAt
    });

    return delivery;
  }

  private async waitForAssistantText(
    sessionId: string,
    acceptedAt: string,
    options: {
      attempts?: number;
      delayMs?: number;
    } = {}
  ): Promise<string | null> {
    const attempts = options.attempts ?? 20;
    const delayMs = options.delayMs ?? 1_000;
    const acceptedAtMs = Date.parse(acceptedAt);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const envelope = await this.sessionHistoryService.readRecentHistoryEnvelope(sessionId, 20);
      const text = pickLatestAssistantText(envelope, acceptedAtMs);
      if (text) {
        return text;
      }

      if (attempt < attempts - 1) {
        await delay(delayMs);
      }
    }

    return null;
  }

  private failDelivery(
    dispatch: ChannelBridgeDispatchResult,
    detail: string,
    textContent = ""
  ): ChannelDelivery {
    const failedAt = nowIso();
    const delivery = this.channelDeliveryRepository.create({
      id: createId(),
      channelAccountId: dispatch.account.id,
      threadId: dispatch.thread.id,
      inboundEventId: dispatch.event.id,
      controlSessionId: dispatch.controlSession.id,
      sessionId: dispatch.controlSession.sessionId,
      textContent,
      providerMessageRef: null,
      status: "failed",
      errorMessage: detail,
      createdAt: failedAt,
      updatedAt: failedAt
    });

    this.channelInboundEventRepository.update({
      ...dispatch.event,
      status: "failed",
      errorMessage: detail,
      payload: {
        ...dispatch.event.payload,
        deliveryId: delivery.id
      },
      processedAt: failedAt
    });

    const account = this.channelAccountRepository.findById(dispatch.account.id) ?? dispatch.account;
    this.channelAccountRepository.update({
      ...account,
      status: account.status === "disabled" ? "disabled" : "degraded",
      lastError: detail,
      updatedAt: failedAt
    });

    return delivery;
  }
}

function pickLatestAssistantText(
  envelope: SessionHistoryEnvelope | null,
  acceptedAtMs: number
): string | null {
  if (!envelope) {
    return null;
  }

  const latest = [...envelope.messages]
    .filter((message) => message.role === "assistant" && message.kind === "text" && message.content.trim().length > 0)
    .sort((left, right) => {
      return Date.parse(right.timestamp) - Date.parse(left.timestamp);
    })
    .find((message) => {
      const messageMs = Date.parse(message.timestamp);
      return !Number.isFinite(acceptedAtMs) || !Number.isFinite(messageMs) || messageMs >= acceptedAtMs;
    });

  return latest?.content?.trim() ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function resolveDeliveryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "CHANNEL_DELIVERY_FAILED";
}

function previewChannelTextForLog(text: string): string {
  return text.length <= 100 ? text : `${text.slice(0, 100)}...`;
}

function computeChannelDelayMs(startedAt: string | null, finishedAt: string): number | null {
  if (!startedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return null;
  }

  return Math.max(0, finishedMs - startedMs);
}

export function spawnDelivery(dispatch: ChannelBridgeDispatchResult, deliveryService: ChannelDeliveryService): void {
  void deliveryService.deliverAssistantReply(dispatch).catch((error) => {
    throw wrapAsyncDeliveryError(error);
  });
}

function wrapAsyncDeliveryError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new AppError({
    statusCode: 500,
    errorCode: "CHANNEL_DELIVERY_ASYNC_FAILED",
    detail: String(error)
  });
}
