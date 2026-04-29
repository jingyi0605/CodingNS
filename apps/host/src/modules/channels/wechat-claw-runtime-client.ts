import { AppError } from "../../shared/errors/app-error.js";
import type { ChannelAccount, ChannelThread } from "../../types/domain.js";
import type {
  WechatClawRuntimeLoginActionResult,
  WechatClawRuntimeLoginStatusResult,
  WechatClawRuntimeLogoutResult,
  WechatClawRuntimePollResult,
  WechatClawRuntimeProbeResult,
  WechatClawRuntimeSendResult,
  WechatClawRuntimeThreadPayload
} from "./wechat-claw-runtime-types.js";
import type { WechatClawRuntimeManager } from "./wechat-claw-runtime-manager.js";

export class WechatClawRuntimeClient {
  constructor(private readonly manager: WechatClawRuntimeManager) {}

  async startLogin(account: ChannelAccount): Promise<WechatClawRuntimeLoginActionResult> {
    return await this.request<WechatClawRuntimeLoginActionResult>(`/accounts/${account.id}/start-login`, {
      method: "POST",
      body: JSON.stringify({
        config: account.config
      })
    });
  }

  async getLoginStatus(accountId: string): Promise<WechatClawRuntimeLoginStatusResult> {
    return await this.request<WechatClawRuntimeLoginStatusResult>(`/accounts/${accountId}/login-status`, {
      method: "GET"
    });
  }

  async probe(account: ChannelAccount): Promise<WechatClawRuntimeProbeResult> {
    return await this.request<WechatClawRuntimeProbeResult>(`/accounts/${account.id}/probe`, {
      method: "POST",
      body: JSON.stringify({
        config: account.config
      })
    });
  }

  async poll(account: ChannelAccount): Promise<WechatClawRuntimePollResult> {
    return await this.request<WechatClawRuntimePollResult>(`/accounts/${account.id}/poll`, {
      method: "POST",
      body: JSON.stringify({
        config: account.config
      })
    });
  }

  async sendText(
    account: ChannelAccount,
    thread: ChannelThread,
    text: string
  ): Promise<WechatClawRuntimeSendResult> {
    const payload: WechatClawRuntimeThreadPayload = {
      externalConversationKey: thread.externalConversationKey,
      externalUserId: thread.externalUserId,
      lastTransportContext: thread.lastTransportContext
    };

    return await this.request<WechatClawRuntimeSendResult>(`/accounts/${account.id}/send`, {
      method: "POST",
      body: JSON.stringify({
        config: account.config,
        thread: payload,
        text
      })
    });
  }

  async logout(accountId: string): Promise<WechatClawRuntimeLogoutResult> {
    return await this.request<WechatClawRuntimeLogoutResult>(`/accounts/${accountId}/logout`, {
      method: "POST"
    });
  }

  private async request<TResult>(
    pathname: string,
    input: {
      method: "GET" | "POST";
      body?: string;
    }
  ): Promise<TResult> {
    const runtime = await this.manager.ensureReady();
    const response = await fetch(`${runtime.baseUrl}${pathname}`, {
      method: input.method,
      headers: {
        ...(input.body ? { "content-type": "application/json" } : {}),
        "x-codingns-helper-token": runtime.authToken
      },
      body: input.body
    });
    const text = await response.text();

    if (!response.ok) {
      throw parseRuntimeError(text, response.status);
    }

    return text.trim().length > 0 ? JSON.parse(text) as TResult : {} as TResult;
  }
}

function parseRuntimeError(body: string, statusCode: number): AppError {
  try {
    const payload = JSON.parse(body) as {
      error_code?: string;
      detail?: string;
      field?: string;
      data?: Record<string, unknown>;
    };

    if (payload.error_code && payload.detail) {
      return new AppError({
        statusCode,
        errorCode: payload.error_code,
        detail: payload.detail,
        field: payload.field,
        data: payload.data
      });
    }
  } catch {
    // ignore
  }

  return new AppError({
    statusCode,
    errorCode: "WECHAT_CLAW_RUNTIME_REQUEST_FAILED",
    detail: body.trim() || "wechat claw helper 请求失败"
  });
}
