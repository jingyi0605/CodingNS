import { AppError } from "../../shared/errors/app-error.js";
import type {
  ChannelAccount,
  ChannelPlatformCode,
  ChannelThread
} from "../../types/domain.js";
import type { NormalizedChannelInboundMessage } from "./channel-bridge-service.js";
import type { WechatClawRuntimeClient } from "./wechat-claw-runtime-client.js";
import { createWechatClawRuntimeRequiredError, WECHAT_CLAW_RUNTIME_REQUIRED_DETAIL } from "./wechat-claw-runtime-boundary.js";

export interface ChannelWebhookRequestContext {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

export interface ChannelWebhookParseResult {
  statusCode: number;
  body: Record<string, unknown> | string;
  inboundMessages: NormalizedChannelInboundMessage[];
}

export interface ChannelPollResult {
  inboundMessages: NormalizedChannelInboundMessage[];
  runtimeStatePatch?: Record<string, unknown>;
  detail?: string;
}

export interface ChannelSendTextResult {
  status: "sent" | "skipped";
  providerMessageRef: string | null;
  detail?: string;
  runtimeStatePatch?: Record<string, unknown>;
}

export interface ChannelProbeResult {
  ok: boolean;
  detail: string;
  warnings: string[];
}

export interface ChannelPlatformAdapter {
  readonly platformCode: ChannelPlatformCode;
  parseWebhook(account: ChannelAccount, request: ChannelWebhookRequestContext): Promise<ChannelWebhookParseResult>;
  poll(account: ChannelAccount): Promise<ChannelPollResult>;
  sendText(account: ChannelAccount, thread: ChannelThread, text: string): Promise<ChannelSendTextResult>;
  probe(account: ChannelAccount): Promise<ChannelProbeResult>;
}

export class ChannelPlatformAdapterRegistry {
  private readonly adapters = new Map<ChannelPlatformCode, ChannelPlatformAdapter>();

  constructor(adapters: ChannelPlatformAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.platformCode, adapter);
    }
  }

  get(platformCode: ChannelPlatformCode): ChannelPlatformAdapter | null {
    return this.adapters.get(platformCode) ?? null;
  }

  require(platformCode: ChannelPlatformCode): ChannelPlatformAdapter {
    const adapter = this.get(platformCode);

    if (!adapter) {
      throw new AppError({
        statusCode: 500,
        errorCode: "CHANNEL_PLATFORM_ADAPTER_NOT_FOUND",
        detail: `平台 ${platformCode} 的适配器未注册`
      });
    }

    return adapter;
  }
}

export function createDefaultChannelPlatformAdapterRegistry(options: {
  wechatClawRuntimeClient?: WechatClawRuntimeClient | null;
} = {}): ChannelPlatformAdapterRegistry {
  return new ChannelPlatformAdapterRegistry([
    new WechatClawChannelAdapter(options.wechatClawRuntimeClient ?? null),
    new TelegramChannelAdapter()
  ]);
}

class WechatClawChannelAdapter implements ChannelPlatformAdapter {
  readonly platformCode = "wechat-claw" as const;

  constructor(private readonly runtimeClient: WechatClawRuntimeClient | null) {}

  async parseWebhook(
    _account: ChannelAccount,
    _request: ChannelWebhookRequestContext
  ): Promise<ChannelWebhookParseResult> {
    throw new AppError({
      statusCode: 400,
      errorCode: "CHANNEL_WEBHOOK_UNSUPPORTED",
      detail: "个人微信（claw）第一阶段只支持 polling，不支持 webhook"
    });
  }

  async poll(account: ChannelAccount): Promise<ChannelPollResult> {
    const result = await this.requireRuntimeClient().poll(account);
    return {
      inboundMessages: result.inboundMessages.map((message) => ({
        externalEventId: message.externalEventId,
        externalConversationKey: message.externalConversationKey,
        externalUserId: message.externalUserId,
        externalThreadKey: message.externalThreadKey,
        text: message.text,
        senderDisplayName: message.senderDisplayName,
        rawPayload: message.rawPayload,
        transportContext: message.transportContext
      })),
      detail: result.detail
    };
  }

  async sendText(account: ChannelAccount, thread: ChannelThread, text: string): Promise<ChannelSendTextResult> {
    const result = await this.requireRuntimeClient().sendText(account, thread, text);
    return {
      status: result.status,
      providerMessageRef: result.providerMessageRef,
      detail: result.detail ?? undefined
    };
  }

  async probe(account: ChannelAccount): Promise<ChannelProbeResult> {
    if (!this.runtimeClient) {
      return {
        ok: false,
        detail: WECHAT_CLAW_RUNTIME_REQUIRED_DETAIL,
        warnings: []
      };
    }

    const result = await this.runtimeClient.probe(account);
    return {
      ok: result.ok,
      detail: result.detail,
      warnings: result.warnings
    };
  }

  private requireRuntimeClient(): WechatClawRuntimeClient {
    if (!this.runtimeClient) {
      throw createWechatClawRuntimeRequiredError();
    }

    return this.runtimeClient;
  }
}

class TelegramChannelAdapter implements ChannelPlatformAdapter {
  readonly platformCode = "telegram" as const;

  async parseWebhook(
    _account: ChannelAccount,
    _request: ChannelWebhookRequestContext
  ): Promise<ChannelWebhookParseResult> {
    throw new AppError({
      statusCode: 400,
      errorCode: "CHANNEL_WEBHOOK_UNSUPPORTED",
      detail: "Telegram 第一阶段只支持 polling，不支持 webhook"
    });
  }

  async poll(account: ChannelAccount): Promise<ChannelPollResult> {
    const botToken = readRequiredConfiguredText(account.config, "botToken");
    const offset = Number.parseInt(readBodyText(account.runtimeState, "telegramUpdateOffset") ?? "0", 10) || 0;
    const response = await fetchJson(buildTelegramApiUrl(botToken, "getUpdates"), {
      method: "POST",
      body: JSON.stringify({
        offset,
        timeout: 0,
        allowed_updates: ["message"]
      }),
      headers: {
        "content-type": "application/json"
      }
    });
    const payload = ensureTelegramOk(response, "Telegram getUpdates");
    const updates = Array.isArray(payload.result) ? payload.result : [];
    const inboundMessages = updates.flatMap((update) => {
      const item = ensurePlainObject(update, "telegram update");
      const message = ensurePlainObject(item.message, "telegram message");
      const text = readBodyText(message, "text");
      if (!text) {
        return [];
      }

      const chatId = String(readNestedNumber(message, ["chat", "id"]) ?? invalidWebhook("Telegram 缺少 chat.id"));
      const messageThreadId = readBodyText(message, "message_thread_id");

      return [{
        externalEventId: String(item.update_id ?? createSyntheticEventId("telegram")),
        externalConversationKey: buildTelegramConversationKey(chatId, messageThreadId),
        externalUserId: readNestedNumber(message, ["from", "id"])?.toString() ?? null,
        externalThreadKey: messageThreadId,
        text,
        senderDisplayName:
          readNestedText(message, ["from", "username"])
          ?? readNestedText(message, ["from", "first_name"]),
        rawPayload: item,
        transportContext: {
          chatId,
          messageId: readBodyText(message, "message_id"),
          messageThreadId
        }
      }] satisfies NormalizedChannelInboundMessage[];
    });
    const maxUpdateId = updates
      .map((update) => Number(ensurePlainObject(update, "telegram update").update_id ?? 0))
      .filter((value) => Number.isFinite(value))
      .reduce((current, value) => Math.max(current, value), offset - 1);

    return {
      inboundMessages,
      runtimeStatePatch: maxUpdateId >= offset
        ? {
            telegramUpdateOffset: String(maxUpdateId + 1)
          }
        : undefined,
      detail: `拉取到 ${inboundMessages.length} 条 Telegram 文本消息`
    };
  }

  async sendText(account: ChannelAccount, thread: ChannelThread, text: string): Promise<ChannelSendTextResult> {
    const botToken = readRequiredConfiguredText(account.config, "botToken");
    const chatId = readRuntimeTransportText(thread.lastTransportContext, "chatId")
      ?? parseTelegramConversationChatId(thread.externalConversationKey);
    const messageThreadId = thread.externalThreadKey
      ?? readRuntimeTransportText(thread.lastTransportContext, "messageThreadId");
    const response = await fetchJson(buildTelegramApiUrl(botToken, "sendMessage"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(messageThreadId ? { message_thread_id: Number(messageThreadId) } : {})
      })
    });
    const payload = ensureTelegramOk(response, "Telegram sendMessage");
    return {
      status: "sent",
      providerMessageRef: readNestedNumber(payload.result, ["message_id"])?.toString() ?? null
    };
  }

  async probe(account: ChannelAccount): Promise<ChannelProbeResult> {
    const botToken = readConfiguredText(account.config, "botToken");
    if (!botToken) {
      return {
        ok: false,
        detail: "缺少 botToken，Telegram 账号还不能工作。",
        warnings: []
      };
    }

    const response = await fetchJson(buildTelegramApiUrl(botToken, "getMe"));
    const payload = ensureTelegramOk(response, "Telegram getMe");
    return {
      ok: true,
      detail: `Telegram Bot 可用：${readNestedText(payload.result, ["username"]) ?? "unknown"}`,
      warnings: []
    };
  }
}

function buildTelegramConversationKey(chatId: string, messageThreadId: string | null): string {
  return messageThreadId ? `${chatId}:thread:${messageThreadId}` : chatId;
}

function parseTelegramConversationChatId(conversationKey: string): string {
  return conversationKey.includes(":thread:")
    ? conversationKey.split(":thread:")[0] ?? conversationKey
    : conversationKey;
}

function ensureTelegramOk(response: unknown, label: string): Record<string, unknown> {
  const payload = ensurePlainObject(response, label);
  if (payload.ok !== true) {
    throw new AppError({
      statusCode: 502,
      errorCode: "CHANNEL_PLATFORM_REQUEST_FAILED",
      detail: `${label} 失败：${readBodyText(payload, "description") ?? "unknown error"}`
    });
  }

  return payload;
}

function buildTelegramApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`;
}

function ensurePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是对象`
    });
  }

  return value as Record<string, unknown>;
}

function readBodyText(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readNestedText(source: unknown, path: string[]): string | null {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current === "string") {
    const normalized = current.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof current === "number" && Number.isFinite(current)) {
    return String(current);
  }

  return null;
}

function readNestedNumber(source: unknown, path: string[]): number | null {
  const text = readNestedText(source, path);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function readConfiguredText(config: Record<string, unknown>, key: string): string | null {
  return readBodyText(config, key);
}

function readRequiredConfiguredText(config: Record<string, unknown>, key: string): string {
  return readConfiguredText(config, key) ?? invalidConfig(`${key} 不能为空`);
}

function readRuntimeTransportText(transportContext: Record<string, unknown>, key: string): string | null {
  return readBodyText(transportContext, key);
}

function createSyntheticEventId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

function invalidWebhook(detail: string): never {
  throw new AppError({
    statusCode: 400,
    errorCode: "CHANNEL_WEBHOOK_INVALID",
    detail
  });
}

function invalidConfig(detail: string): never {
  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail
  });
}

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new AppError({
      statusCode: 502,
      errorCode: "CHANNEL_PLATFORM_REQUEST_FAILED",
      detail: `请求 ${url} 失败：${response.status} ${response.statusText}`
    });
  }

  return payload;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      raw: text
    };
  }
}
