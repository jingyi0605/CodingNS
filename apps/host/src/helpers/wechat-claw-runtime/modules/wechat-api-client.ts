import crypto from "node:crypto";
import QRCode from "qrcode";

import { AppError } from "../../../shared/errors/app-error.js";
import {
  DEFAULT_WECHAT_CLAW_API_BASE_URL,
  type WechatClawGetConfigResponse,
  type WechatClawGetUpdatesResponse,
  type WechatClawQrCodeResponse,
  type WechatClawQrStatusResponse
} from "./types.js";
import { wechatClawUpstreamError } from "./errors.js";

export class WechatClawApiClient {
  async getBotQrCode(input: {
    apiBaseUrl?: string | null;
    botType: string;
    routeTag?: string;
  }): Promise<WechatClawQrCodeResponse> {
    const url = new URL("/ilink/bot/get_bot_qrcode", normalizeBaseUrl(input.apiBaseUrl));
    url.searchParams.set("bot_type", input.botType);
    return await this.requestJson<WechatClawQrCodeResponse>(url.toString(), {
      method: "GET",
      headers: buildLoginHeaders(input.routeTag)
    });
  }

  async getQrCodeStatus(input: {
    apiBaseUrl?: string | null;
    qrcode: string;
    routeTag?: string;
  }): Promise<WechatClawQrStatusResponse> {
    const url = new URL("/ilink/bot/get_qrcode_status", normalizeBaseUrl(input.apiBaseUrl));
    url.searchParams.set("qrcode", input.qrcode);
    return await this.requestJson<WechatClawQrStatusResponse>(url.toString(), {
      method: "GET",
      headers: buildLoginHeaders(input.routeTag),
      timeoutMs: 35_000
    });
  }

  async renderQrCodeDataUrl(input: {
    text: string;
  }): Promise<string> {
    const qrText = input.text.trim();
    if (!qrText) {
      throw wechatClawUpstreamError("微信二维码内容不能为空");
    }

    try {
      const svg = await QRCode.toString(qrText, {
        type: "svg",
        margin: 2,
        width: 280,
        errorCorrectionLevel: "M"
      });
      return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw wechatClawUpstreamError(
        error instanceof Error ? `微信二维码本地生成失败：${error.message}` : "微信二维码本地生成失败",
        {
          qrText
        }
      );
    }
  }

  async getUpdates(input: {
    apiBaseUrl?: string | null;
    token: string;
    cursor: string | null;
  }): Promise<WechatClawGetUpdatesResponse> {
    return await this.requestAuthorizedJson<WechatClawGetUpdatesResponse>({
      apiBaseUrl: input.apiBaseUrl,
      token: input.token,
      path: "/ilink/bot/getupdates",
      body: {
        get_updates_buf: input.cursor ?? "",
        base_info: {
          channel_version: "codingns-wechat-claw-helper"
        }
      },
      timeoutMs: 35_000
    });
  }

  async sendMessage(input: {
    apiBaseUrl?: string | null;
    token: string;
    message: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return await this.requestAuthorizedJson<Record<string, unknown>>({
      apiBaseUrl: input.apiBaseUrl,
      token: input.token,
      path: "/ilink/bot/sendmessage",
      body: {
        msg: input.message,
        base_info: {
          channel_version: "codingns-wechat-claw-helper"
        }
      }
    });
  }

  async getConfig(input: {
    apiBaseUrl?: string | null;
    token: string;
    userId: string;
    contextToken?: string | null;
  }): Promise<WechatClawGetConfigResponse> {
    return await this.requestAuthorizedJson<WechatClawGetConfigResponse>({
      apiBaseUrl: input.apiBaseUrl,
      token: input.token,
      path: "/ilink/bot/getconfig",
      body: {
        ilink_user_id: input.userId,
        context_token: input.contextToken ?? undefined,
        base_info: {
          channel_version: "codingns-wechat-claw-helper"
        }
      }
    });
  }

  private async requestAuthorizedJson<T>(input: {
    apiBaseUrl?: string | null;
    token: string;
    path: string;
    body: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<T> {
    const url = new URL(input.path, normalizeBaseUrl(input.apiBaseUrl));
    const serialized = JSON.stringify(input.body);

    return await this.requestJson<T>(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorizationtype: "ilink_bot_token",
        authorization: `Bearer ${input.token}`,
        "x-wechat-uin": Buffer.from(String(crypto.randomInt(0, 2 ** 32))).toString("base64")
      },
      body: serialized,
      timeoutMs: input.timeoutMs
    });
  }

  private async requestJson<T>(
    url: string,
    input: {
      method: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
      timeoutMs?: number;
    }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, input.timeoutMs ?? 20_000);

    try {
      const response = await fetch(url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: controller.signal
      });
      const text = await response.text();

      if (!response.ok) {
        throw wechatClawUpstreamError(`微信接口请求失败：${response.status} ${response.statusText}`, {
          status: response.status,
          body: text.slice(0, 200)
        });
      }

      if (!text.trim()) {
        return {} as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw wechatClawUpstreamError("微信接口返回了无法解析的 JSON", {
          body: text.slice(0, 200),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw wechatClawUpstreamError(
        error instanceof Error ? `微信接口请求失败：${error.message}` : "微信接口请求失败"
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeBaseUrl(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WECHAT_CLAW_API_BASE_URL;
}

function buildLoginHeaders(routeTag?: string): Record<string, string> {
  return routeTag?.trim()
    ? {
        "iLink-App-ClientVersion": "1",
        SKRouteTag: routeTag.trim()
      }
    : {
        "iLink-App-ClientVersion": "1"
      };
}
