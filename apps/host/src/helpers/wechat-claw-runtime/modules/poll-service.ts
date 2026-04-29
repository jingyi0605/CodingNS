import { nowIso } from "../../../shared/utils/time.js";
import type {
  WechatClawRuntimeAccountConfig,
  WechatClawRuntimeInboundMessage,
  WechatClawRuntimePollResult,
  WechatClawUpstreamMessage
} from "./types.js";
import { WechatClawRuntimeStateStore } from "./runtime-state-store.js";
import { WechatClawApiClient } from "./wechat-api-client.js";
import { wechatClawStateError, wechatClawUpstreamError } from "./errors.js";

export class WechatClawPollService {
  constructor(
    private readonly store: WechatClawRuntimeStateStore,
    private readonly apiClient: WechatClawApiClient
  ) {}

  async probe(
    accountId: string,
    config: WechatClawRuntimeAccountConfig
  ): Promise<{
    accountId: string;
    checkedAt: string;
    ok: boolean;
    detail: string;
    warnings: string[];
    session: ReturnType<WechatClawRuntimeStateStore["toSessionView"]>;
  }> {
    const session = this.store.getAccountSession(accountId.trim());
    const checkedAt = nowIso();

    if (!session || session.status !== "active" || !session.token) {
      return {
        accountId: accountId.trim(),
        checkedAt,
        ok: false,
        detail: "微信账号还没有完成扫码登录。",
        warnings: [],
        session: this.store.toSessionView(session)
      };
    }

    if (!session.userId) {
      return {
        accountId: accountId.trim(),
        checkedAt,
        ok: true,
        detail: "微信账号已登录，但当前还没有最近会话上下文。",
        warnings: ["用户 ID 还没有回填，后续收到第一条微信消息后会自动补齐。"],
        session: this.store.toSessionView(session)
      };
    }

    const response = await this.apiClient.getConfig({
      apiBaseUrl: session.apiBaseUrl ?? config.apiBaseUrl,
      token: session.token,
      userId: session.userId
    });

    if (response.ret && response.ret !== 0) {
      throw wechatClawUpstreamError(`微信 getconfig 返回异常：ret=${response.ret} ${response.errmsg ?? ""}`.trim());
    }

    return {
      accountId: accountId.trim(),
      checkedAt,
      ok: true,
      detail: "微信 helper 已完成上游探活。",
      warnings: response.typing_ticket ? [] : ["上游没有返回 typing_ticket，当前先只使用文本收发。"],
      session: this.store.toSessionView(session)
    };
  }

  async poll(
    accountId: string,
    config: WechatClawRuntimeAccountConfig
  ): Promise<WechatClawRuntimePollResult> {
    const normalizedAccountId = accountId.trim();
    const session = this.store.getAccountSession(normalizedAccountId);

    if (!session || session.status !== "active" || !session.token) {
      throw wechatClawStateError("微信账号还没有完成扫码登录，不能开始 poll。");
    }

    const checkpoint = this.store.getPollCheckpoint(normalizedAccountId);
    const response = await this.apiClient.getUpdates({
      apiBaseUrl: session.apiBaseUrl ?? config.apiBaseUrl,
      token: session.token,
      cursor: checkpoint?.cursor ?? null
    });

    if ((response.ret ?? 0) !== 0) {
      if (response.errcode === -14) {
        this.store.saveAccountSession(normalizedAccountId, {
          status: "expired",
          token: null,
          lastErrorCode: String(response.errcode),
          lastErrorMessage: response.errmsg ?? "微信登录态已失效，请重新扫码。"
        });
      }

      throw wechatClawUpstreamError(
        `微信 getupdates 返回异常：ret=${response.ret ?? "unknown"} errcode=${response.errcode ?? "unknown"} ${response.errmsg ?? ""}`.trim()
      );
    }

    const inboundMessages = (response.msgs ?? [])
      .map((message) => this.normalizeInboundMessage(normalizedAccountId, message))
      .filter((message): message is WechatClawRuntimeInboundMessage => Boolean(message));

    const latestExternalEventId = inboundMessages.length > 0
      ? inboundMessages[inboundMessages.length - 1].externalEventId
      : checkpoint?.latestExternalEventId ?? null;

    this.store.setPollCheckpoint(normalizedAccountId, {
      cursor: response.get_updates_buf ?? checkpoint?.cursor ?? null,
      latestExternalEventId
    });

    return {
      accountId: normalizedAccountId,
      checkedAt: nowIso(),
      detail: `本次轮询拿到 ${inboundMessages.length} 条文本消息。`,
      inboundMessages
    };
  }

  private normalizeInboundMessage(
    accountId: string,
    message: WechatClawUpstreamMessage
  ): WechatClawRuntimeInboundMessage | null {
    if (message.message_type === 2) {
      return null;
    }

    const text = (message.item_list ?? [])
      .filter((item) => item.type === 1)
      .map((item) => item.text_item?.text?.trim() ?? "")
      .filter((item) => item.length > 0)
      .join("\n");

    if (!text) {
      return null;
    }

    const externalUserId = message.from_user_id?.trim() ?? null;
    const externalConversationKey =
      externalUserId
      ?? message.session_id?.trim()
      ?? message.to_user_id?.trim()
      ?? null;

    if (!externalConversationKey) {
      return null;
    }

    if (message.context_token && externalUserId) {
      this.store.upsertContextToken(accountId, {
        conversationKey: externalConversationKey,
        externalUserId,
        token: message.context_token,
        status: "active"
      });
    }

    return {
      externalEventId: String(message.message_id ?? message.seq ?? `${externalConversationKey}:${message.create_time_ms ?? Date.now()}`),
      externalConversationKey,
      externalUserId,
      externalThreadKey: null,
      text,
      senderDisplayName: externalUserId,
      rawPayload: message as Record<string, unknown>,
      transportContext: {
        contextToken: message.context_token ?? null,
        fromUserId: message.from_user_id ?? null,
        toUserId: message.to_user_id ?? null,
        sessionId: message.session_id ?? null
      }
    };
  }
}
