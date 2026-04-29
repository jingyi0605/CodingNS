import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerProfileProviderId,
  ChannelAccount,
  ChannelInboundEvent,
  ChannelThread
} from "../../types/domain.js";
import type { ButlerControlSessionView } from "../butler/butler-control-session-service.js";
import type { ButlerControlSessionService } from "../butler/butler-control-session-service.js";

export interface NormalizedChannelInboundMessage {
  externalEventId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  externalThreadKey: string | null;
  text: string;
  senderDisplayName: string | null;
  rawPayload: Record<string, unknown>;
  transportContext: Record<string, unknown>;
}

export interface ChannelBridgeDispatchResult {
  account: ChannelAccount;
  thread: ChannelThread;
  event: ChannelInboundEvent;
  controlSession: ButlerControlSessionView;
  dispatch: {
    mode: "started" | "continued" | "duplicate";
    acceptedAt: string;
    sessionId: string;
    provider: string;
    providerSessionId: string;
    clientRequestId: string | null;
  };
}

interface ChannelAccountRepository {
  findById(id: string): ChannelAccount | null;
  update(record: ChannelAccount): ChannelAccount;
}

interface ChannelThreadRepository {
  findByAccountAndConversationKey(channelAccountId: string, externalConversationKey: string): ChannelThread | null;
  create(record: ChannelThread): ChannelThread;
  update(record: ChannelThread): ChannelThread;
}

interface ChannelInboundEventRepository {
  findByAccountAndExternalEventId(channelAccountId: string, externalEventId: string): ChannelInboundEvent | null;
  create(record: ChannelInboundEvent): ChannelInboundEvent;
  update(record: ChannelInboundEvent): ChannelInboundEvent;
}

type ButlerBridgeControlService = Pick<
  ButlerControlSessionService,
  "startSessionForProvider" | "sendMessageToSession" | "getSession"
>;

export class ChannelBridgeService {
  constructor(
    private readonly channelAccountRepository: ChannelAccountRepository,
    private readonly channelThreadRepository: ChannelThreadRepository,
    private readonly channelInboundEventRepository: ChannelInboundEventRepository,
    private readonly butlerControlSessionService: ButlerBridgeControlService
  ) {}

  async dispatchInboundText(
    channelAccountId: string,
    input: NormalizedChannelInboundMessage
  ): Promise<ChannelBridgeDispatchResult> {
    const account = this.requireEnabledAccount(channelAccountId);
    const normalized = normalizeInboundMessage(input);
    const duplicate = this.channelInboundEventRepository.findByAccountAndExternalEventId(
      account.id,
      normalized.externalEventId
    );

    if (duplicate) {
      const thread = this.requireThreadForEvent(account.id, duplicate.externalConversationKey);
      const controlSession = this.requireControlSession(thread, account.userId);

      return {
        account,
        thread,
        event: duplicate,
        controlSession,
        dispatch: {
          mode: "duplicate",
          acceptedAt: duplicate.processedAt ?? duplicate.receivedAt,
          sessionId: controlSession.sessionId,
          provider: controlSession.providerId,
          providerSessionId: controlSession.session.providerSessionId,
          clientRequestId: null
        }
      };
    }

    const receivedAt = nowIso();
    let event = this.channelInboundEventRepository.create({
      id: createId(),
      channelAccountId: account.id,
      externalEventId: normalized.externalEventId,
      externalConversationKey: normalized.externalConversationKey,
      externalUserId: normalized.externalUserId,
      controlSessionId: null,
      sessionId: null,
      textContent: normalized.text,
      payload: {
        senderDisplayName: normalized.senderDisplayName,
        externalThreadKey: normalized.externalThreadKey,
        transportContext: normalized.transportContext,
        rawPayload: normalized.rawPayload
      },
      status: "received",
      errorMessage: null,
      receivedAt,
      processedAt: null
    });

    const touchedAccount = this.channelAccountRepository.update({
      ...account,
      lastInboundAt: receivedAt,
      updatedAt: receivedAt
    });

    try {
      let thread = this.channelThreadRepository.findByAccountAndConversationKey(
        account.id,
        normalized.externalConversationKey
      );
      let controlSession: ButlerControlSessionView;
      let dispatchMode: "started" | "continued";
      let acceptedAt: string;
      let provider: string;
      let providerSessionId: string;
      let clientRequestId: string | null;

      if (thread?.controlSessionId) {
        const currentControlSession = this.butlerControlSessionService.getSession(
          thread.controlSessionId,
          account.userId
        );

        if (isReusableControlSession(currentControlSession)) {
          try {
            const sent = await this.butlerControlSessionService.sendMessageToSession(account.userId, {
              controlSessionId: thread.controlSessionId,
              content: normalized.text,
              clientRequestId: buildChannelClientRequestId(account.id, event.id, "send")
            });
            controlSession = sent.controlSession;
            dispatchMode = "continued";
            acceptedAt = sent.acceptedAt;
            provider = sent.provider;
            providerSessionId = sent.providerSessionId;
            clientRequestId = sent.clientRequestId;
          } catch (error) {
            if (!isRecoverableControlSessionError(error)) {
              throw error;
            }

            const started = await this.butlerControlSessionService.startSessionForProvider(
              account.userId,
              account.providerId,
              {
                content: normalized.text,
                title: thread.title ?? buildThreadTitle(touchedAccount, normalized),
                purpose: "chat",
                clientRequestId: buildChannelClientRequestId(account.id, event.id, "start")
              }
            );
            controlSession = started;
            dispatchMode = "started";
            acceptedAt = started.updatedAt;
            provider = started.providerId;
            providerSessionId = started.session.providerSessionId;
            clientRequestId = null;
          }
        } else {
          const started = await this.butlerControlSessionService.startSessionForProvider(
            account.userId,
            account.providerId,
            {
              content: normalized.text,
              title: thread.title ?? buildThreadTitle(touchedAccount, normalized),
              purpose: "chat",
              clientRequestId: buildChannelClientRequestId(account.id, event.id, "start")
            }
          );
          controlSession = started;
          dispatchMode = "started";
          acceptedAt = started.updatedAt;
          provider = started.providerId;
          providerSessionId = started.session.providerSessionId;
          clientRequestId = null;
        }
      } else {
        const started = await this.butlerControlSessionService.startSessionForProvider(
          account.userId,
          account.providerId,
          {
            content: normalized.text,
            title: buildThreadTitle(touchedAccount, normalized),
            purpose: "chat",
            clientRequestId: buildChannelClientRequestId(account.id, event.id, "start")
          }
        );
        controlSession = started;
        dispatchMode = "started";
        acceptedAt = started.updatedAt;
        provider = started.providerId;
        providerSessionId = started.session.providerSessionId;
        clientRequestId = null;
      }

      const threadTitle = thread?.title ?? controlSession.title ?? buildThreadTitle(touchedAccount, normalized);
      const threadRecord = thread
        ? this.channelThreadRepository.update({
            ...thread,
            externalUserId: normalized.externalUserId,
            externalThreadKey: normalized.externalThreadKey,
            controlSessionId: controlSession.id,
            sessionId: controlSession.sessionId,
            title: threadTitle,
            status: "active",
            lastInboundAt: acceptedAt,
            lastTransportContext: normalized.transportContext,
            updatedAt: acceptedAt
          })
        : this.channelThreadRepository.create({
            id: createId(),
            channelAccountId: account.id,
            externalConversationKey: normalized.externalConversationKey,
            externalUserId: normalized.externalUserId,
            externalThreadKey: normalized.externalThreadKey,
            controlSessionId: controlSession.id,
            sessionId: controlSession.sessionId,
            title: threadTitle,
            status: "active",
            lastInboundAt: acceptedAt,
            lastOutboundAt: null,
            lastTransportContext: normalized.transportContext,
            createdAt: acceptedAt,
            updatedAt: acceptedAt
          });

      event = this.channelInboundEventRepository.update({
        ...event,
        controlSessionId: controlSession.id,
        sessionId: controlSession.sessionId,
        payload: {
          ...event.payload,
          threadId: threadRecord.id
        },
        status: "dispatched",
        errorMessage: null,
        processedAt: acceptedAt
      });

      const updatedAccount = this.channelAccountRepository.update({
        ...touchedAccount,
        status: touchedAccount.status === "disabled" ? "disabled" : "active",
        lastError: null,
        lastInboundAt: acceptedAt,
        updatedAt: acceptedAt
      });

      return {
        account: updatedAccount,
        thread: threadRecord,
        event,
        controlSession,
        dispatch: {
          mode: dispatchMode,
          acceptedAt,
          sessionId: controlSession.sessionId,
          provider,
          providerSessionId,
          clientRequestId
        }
      };
    } catch (error) {
      const failedAt = nowIso();
      const detail = error instanceof Error ? error.message : "CHANNEL_BRIDGE_UNKNOWN_ERROR";

      this.channelInboundEventRepository.update({
        ...event,
        status: "failed",
        errorMessage: detail,
        processedAt: failedAt
      });
      this.channelAccountRepository.update({
        ...touchedAccount,
        status: touchedAccount.status === "disabled" ? "disabled" : "degraded",
        lastError: detail,
        updatedAt: failedAt
      });

      throw error;
    }
  }

  private requireEnabledAccount(channelAccountId: string): ChannelAccount {
    const account = this.channelAccountRepository.findById(channelAccountId.trim());

    if (!account) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CHANNEL_ACCOUNT_NOT_FOUND",
        detail: "目标通讯平台账号不存在"
      });
    }

    if (account.status === "disabled") {
      throw new AppError({
        statusCode: 409,
        errorCode: "CHANNEL_ACCOUNT_DISABLED",
        detail: "当前通讯平台账号已禁用，不能接收入站消息"
      });
    }

    this.assertSupportedProvider(account.providerId);
    return account;
  }

  private requireThreadForEvent(channelAccountId: string, externalConversationKey: string): ChannelThread {
    const thread = this.channelThreadRepository.findByAccountAndConversationKey(
      channelAccountId,
      externalConversationKey
    );

    if (!thread) {
      throw new AppError({
        statusCode: 409,
        errorCode: "CHANNEL_THREAD_NOT_FOUND",
        detail: "当前入站事件已存在，但找不到对应的外部会话映射"
      });
    }

    return thread;
  }

  private requireControlSession(thread: ChannelThread, userId: string): ButlerControlSessionView {
    if (!thread.controlSessionId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "CHANNEL_THREAD_CONTROL_SESSION_MISSING",
        detail: "当前外部会话映射还没有绑定 Butler control session"
      });
    }

    const controlSession = this.butlerControlSessionService.getSession(thread.controlSessionId, userId);

    if (!controlSession) {
      throw new AppError({
        statusCode: 409,
        errorCode: "CHANNEL_THREAD_CONTROL_SESSION_MISSING",
        detail: "当前外部会话映射引用的 Butler control session 不存在"
      });
    }

    return controlSession;
  }

  private assertSupportedProvider(providerId: ButlerProfileProviderId): void {
    if (providerId === "codex" || providerId === "claude-code") {
      return;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "channel_account.provider_id 只允许为 codex 或 claude-code",
      field: "providerId"
    });
  }
}

function normalizeInboundMessage(input: NormalizedChannelInboundMessage): NormalizedChannelInboundMessage {
  const externalEventId = requireNonEmptyText(input.externalEventId, "externalEventId");
  const externalConversationKey = requireNonEmptyText(input.externalConversationKey, "externalConversationKey");
  const text = requireNonEmptyText(input.text, "text");

  return {
    externalEventId,
    externalConversationKey,
    externalUserId: normalizeNullableText(input.externalUserId),
    externalThreadKey: normalizeNullableText(input.externalThreadKey),
    text,
    senderDisplayName: normalizeNullableText(input.senderDisplayName),
    rawPayload: normalizePlainObject(input.rawPayload, "rawPayload"),
    transportContext: normalizePlainObject(input.transportContext, "transportContext")
  };
}

function buildThreadTitle(
  account: Pick<ChannelAccount, "platformCode" | "displayName">,
  input: Pick<NormalizedChannelInboundMessage, "senderDisplayName" | "externalConversationKey">
): string {
  const sender = input.senderDisplayName?.trim();
  const suffix = sender || input.externalConversationKey;
  return `${account.displayName} · ${account.platformCode} · ${suffix}`;
}

function buildChannelClientRequestId(
  accountId: string,
  inboundEventId: string,
  mode: "start" | "send"
): string {
  return `channel-bridge:${mode}:${accountId}:${inboundEventId}`;
}

function requireNonEmptyText(value: string, field: string): string {
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

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizePlainObject(value: Record<string, unknown>, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是对象`,
      field
    });
  }

  return { ...value };
}

function isControlSessionMissing(error: unknown): boolean {
  return error instanceof AppError && error.errorCode === "BUTLER_CONTROL_SESSION_NOT_FOUND";
}

function isReusableControlSession(
  controlSession: ButlerControlSessionView | null
): controlSession is ButlerControlSessionView {
  return controlSession !== null && controlSession.status !== "failed" && controlSession.status !== "closed";
}

function isRecoverableControlSessionError(error: unknown): boolean {
  if (isControlSessionMissing(error)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();
  return normalized.includes("no rollout found for thread id") || normalized.includes("thread not loaded");
}
