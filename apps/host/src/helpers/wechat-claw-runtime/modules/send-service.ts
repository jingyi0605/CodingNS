import { nowIso } from "../../../shared/utils/time.js";
import type {
  WechatClawRuntimeAccountConfig,
  WechatClawRuntimeSendResult,
  WechatClawRuntimeThreadPayload
} from "./types.js";
import { WechatClawRuntimeStateStore } from "./runtime-state-store.js";
import { WechatClawApiClient } from "./wechat-api-client.js";
import { invalidWechatClawInput, wechatClawStateError } from "./errors.js";

export class WechatClawSendService {
  constructor(
    private readonly store: WechatClawRuntimeStateStore,
    private readonly apiClient: WechatClawApiClient
  ) {}

  async sendText(
    accountId: string,
    config: WechatClawRuntimeAccountConfig,
    thread: WechatClawRuntimeThreadPayload,
    text: string
  ): Promise<WechatClawRuntimeSendResult> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw invalidWechatClawInput("发送内容不能为空", "text");
    }

    const session = this.store.getAccountSession(accountId.trim());
    if (!session || session.status !== "active" || !session.token) {
      throw wechatClawStateError("微信账号还没有完成扫码登录，不能发送消息。");
    }

    const toUserId = thread.externalUserId?.trim() || thread.externalConversationKey.trim();
    if (!toUserId) {
      throw invalidWechatClawInput("当前 thread 缺少 externalUserId / externalConversationKey", "thread");
    }

    const contextTokenFromThread = readText(thread.lastTransportContext.contextToken);
    const storedContextToken = thread.externalUserId
      ? this.store.getContextToken(accountId.trim(), thread.externalConversationKey, thread.externalUserId)
      : null;
    const contextToken = contextTokenFromThread ?? storedContextToken?.token ?? null;

    await this.apiClient.sendMessage({
      apiBaseUrl: session.apiBaseUrl ?? config.apiBaseUrl,
      token: session.token,
      message: {
        to_user_id: toUserId,
        context_token: contextToken ?? undefined,
        item_list: [{
          type: 1,
          text_item: {
            text: normalizedText
          }
        }]
      }
    });

    const sentAt = nowIso();
    const providerMessageRef = `wechat-claw:${accountId.trim()}:${Date.now()}`;
    this.store.saveDeliveryReceipt(accountId.trim(), {
      providerMessageRef,
      status: "sent"
    });

    return {
      accountId: accountId.trim(),
      sentAt,
      status: "sent",
      providerMessageRef,
      detail: contextToken ? null : "当前没有可复用的 context token，已按最近目标用户直接发送。"
    };
  }
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
