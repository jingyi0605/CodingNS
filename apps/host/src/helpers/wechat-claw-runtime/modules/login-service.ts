import { nowIso } from "../../../shared/utils/time.js";
import {
  DEFAULT_WECHAT_CLAW_BOT_TYPE,
  DEFAULT_WECHAT_CLAW_API_BASE_URL,
  type WechatClawRuntimeAccountConfig,
  type WechatClawRuntimeLoginActionResult,
  type WechatClawRuntimeLoginStatusResult
} from "./types.js";
import { WechatClawRuntimeStateStore } from "./runtime-state-store.js";
import { WechatClawApiClient } from "./wechat-api-client.js";
import { invalidWechatClawInput, wechatClawUpstreamError } from "./errors.js";

export class WechatClawLoginService {
  constructor(
    private readonly store: WechatClawRuntimeStateStore,
    private readonly apiClient: WechatClawApiClient
  ) {}

  async startLogin(
    accountId: string,
    config: WechatClawRuntimeAccountConfig
  ): Promise<WechatClawRuntimeLoginActionResult> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      throw invalidWechatClawInput("accountId 不能为空", "accountId");
    }

    const current = this.store.getAccountSession(normalizedAccountId);
    if (
      current
      && (current.status === "waiting_scan" || current.status === "scan_confirmed")
      && current.qrCodeUrl
      && isRenderableQrCodeDataUrl(current.qrCodeUrl)
      && !isExpired(current.expiresAt)
    ) {
      return {
        accountId: normalizedAccountId,
        actedAt: nowIso(),
        detail: "二维码仍然有效，可以继续扫码。",
        session: this.store.toSessionView(current)!
      };
    }

    const qr = await this.apiClient.getBotQrCode({
      apiBaseUrl: config.loginBaseUrl ?? DEFAULT_WECHAT_CLAW_API_BASE_URL,
      botType: normalizeBotType(config.botType),
      routeTag: config.routeTag
    });

    if (!qr.qrcode || !qr.qrcode_img_content) {
      throw wechatClawUpstreamError("微信登录二维码响应缺少 qrcode 或二维码地址");
    }

    const qrCodeImageDataUrl = await this.apiClient.renderQrCodeDataUrl({
      text: qr.qrcode_img_content
    });

    const session = this.store.saveAccountSession(normalizedAccountId, {
      status: "waiting_scan",
      loginSessionKey: current?.loginSessionKey ?? `${normalizedAccountId}:${Date.now()}`,
      loginQrcode: qr.qrcode,
      qrCodeUrl: qrCodeImageDataUrl,
      qrCodeSourceUrl: qr.qrcode_img_content,
      apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
      token: null,
      providerAccountId: null,
      userId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      loginStartedAt: nowIso(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    return {
      accountId: normalizedAccountId,
      actedAt: nowIso(),
      detail: "二维码已生成，请用微信扫码确认。",
      session: this.store.toSessionView(session)!
    };
  }

  async refreshLoginStatus(accountId: string): Promise<WechatClawRuntimeLoginStatusResult> {
    const normalizedAccountId = accountId.trim();
    const current = this.store.getAccountSession(normalizedAccountId);

    if (!current) {
      const session = this.store.saveAccountSession(normalizedAccountId, {
        status: "not_logged_in",
        lastErrorCode: null,
        lastErrorMessage: null
      });

      return {
        accountId: normalizedAccountId,
        checkedAt: nowIso(),
        detail: "当前还没有登录会话，请先生成二维码。",
        session: this.store.toSessionView(session)!
      };
    }

    if (current.status === "active") {
      const activeSession = current.qrCodeUrl || current.qrCodeSourceUrl || current.loginQrcode
        ? this.store.saveAccountSession(normalizedAccountId, {
            status: "active",
            loginQrcode: null,
            qrCodeUrl: null,
            qrCodeSourceUrl: null,
            expiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null
          })
        : current;

      return {
        accountId: normalizedAccountId,
        checkedAt: nowIso(),
        detail: "微信账号已登录。",
        session: this.store.toSessionView(activeSession)!
      };
    }

    if (!current.loginQrcode) {
      const next = this.store.saveAccountSession(normalizedAccountId, {
        status: "not_logged_in",
        lastErrorCode: null,
        lastErrorMessage: "当前没有可刷新的二维码，请重新开始登录。"
      });

      return {
        accountId: normalizedAccountId,
        checkedAt: nowIso(),
        detail: "当前没有可刷新的二维码，请重新开始登录。",
        session: this.store.toSessionView(next)!
      };
    }

    const status = await this.apiClient.getQrCodeStatus({
      apiBaseUrl: current.apiBaseUrl ?? DEFAULT_WECHAT_CLAW_API_BASE_URL,
      qrcode: current.loginQrcode
    });

    const checkedAt = nowIso();
    const redirectBaseUrl = normalizeRedirectBaseUrl(status.redirect_host);

    if (status.status === "confirmed" && status.bot_token) {
      const next = this.store.saveAccountSession(normalizedAccountId, {
        status: "active",
        loginQrcode: null,
        qrCodeUrl: null,
        qrCodeSourceUrl: null,
        providerAccountId: status.ilink_bot_id ?? current.providerAccountId,
        apiBaseUrl: status.baseurl ?? redirectBaseUrl ?? current.apiBaseUrl,
        token: status.bot_token,
        userId: status.ilink_user_id ?? current.userId,
        lastErrorCode: null,
        lastErrorMessage: null,
        expiresAt: null
      });

      return {
        accountId: normalizedAccountId,
        checkedAt,
        detail: "扫码确认成功，微信账号已进入可用状态。",
        session: this.store.toSessionView(next)!
      };
    }

    if (status.status === "expired") {
      const next = this.store.saveAccountSession(normalizedAccountId, {
        status: "expired",
        token: null,
        lastErrorCode: "QR_EXPIRED",
        lastErrorMessage: "二维码已过期，请重新开始登录。"
      });

      return {
        accountId: normalizedAccountId,
        checkedAt,
        detail: "二维码已过期，请重新生成。",
        session: this.store.toSessionView(next)!
      };
    }

    const next = this.store.saveAccountSession(normalizedAccountId, {
      status: status.status === "scaned" || status.status === "scaned_but_redirect"
        ? "scan_confirmed"
        : "waiting_scan",
      apiBaseUrl: status.baseurl ?? redirectBaseUrl ?? current.apiBaseUrl,
      lastErrorCode: null,
      lastErrorMessage: null
    });

    return {
      accountId: normalizedAccountId,
      checkedAt,
      detail: next.status === "scan_confirmed" ? "已扫码，请在手机上继续确认。" : "等待扫码。",
      session: this.store.toSessionView(next)!
    };
  }

  logout(accountId: string): {
    accountId: string;
    actedAt: string;
    detail: string;
    session: null;
  } {
    this.store.clearAccountRuntimeState(accountId.trim());

    return {
      accountId: accountId.trim(),
      actedAt: nowIso(),
      detail: "微信 helper 私有运行态已清理。",
      session: null
    };
  }
}

function normalizeBotType(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WECHAT_CLAW_BOT_TYPE;
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WECHAT_CLAW_API_BASE_URL;
}

function normalizeRedirectBaseUrl(host: string | undefined): string | null {
  const normalized = host?.trim();
  return normalized ? `https://${normalized}` : null;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isRenderableQrCodeDataUrl(value: string): boolean {
  const normalized = value.trim();
  const prefix = "data:image/svg+xml;base64,";
  if (!normalized.startsWith(prefix)) {
    return false;
  }

  try {
    const decoded = Buffer.from(normalized.slice(prefix.length), "base64").toString("utf8");
    return decoded.includes("<svg");
  } catch {
    return false;
  }
}
