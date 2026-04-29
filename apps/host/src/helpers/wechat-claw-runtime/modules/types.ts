export const DEFAULT_WECHAT_CLAW_API_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_WECHAT_CLAW_BOT_TYPE = "3";

export type WechatClawRuntimeLoginStatus =
  | "not_logged_in"
  | "waiting_scan"
  | "scan_confirmed"
  | "active"
  | "expired";

export interface WechatClawRuntimeAccountConfig {
  apiBaseUrl?: string;
  loginBaseUrl?: string;
  botType?: string;
  routeTag?: string;
}

export interface WechatClawRuntimeSessionView {
  channelAccountId: string;
  status: WechatClawRuntimeLoginStatus;
  loginSessionKey: string | null;
  qrCodeText: string | null;
  qrCodeUrl: string | null;
  qrCodeSourceUrl: string | null;
  providerAccountId: string | null;
  userId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  loginStartedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WechatClawRuntimeLoginActionResult {
  accountId: string;
  actedAt: string;
  detail: string;
  session: WechatClawRuntimeSessionView;
}

export interface WechatClawRuntimeLoginStatusResult {
  accountId: string;
  checkedAt: string;
  detail: string;
  session: WechatClawRuntimeSessionView;
}

export interface WechatClawRuntimeProbeResult {
  accountId: string;
  checkedAt: string;
  ok: boolean;
  detail: string;
  warnings: string[];
  session: WechatClawRuntimeSessionView | null;
}

export interface WechatClawRuntimeThreadPayload {
  externalConversationKey: string;
  externalUserId: string | null;
  lastTransportContext: Record<string, unknown>;
}

export interface WechatClawRuntimeInboundMessage {
  externalEventId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  externalThreadKey: string | null;
  text: string;
  senderDisplayName: string | null;
  rawPayload: Record<string, unknown>;
  transportContext: Record<string, unknown>;
}

export interface WechatClawRuntimePollResult {
  accountId: string;
  checkedAt: string;
  detail: string;
  inboundMessages: WechatClawRuntimeInboundMessage[];
}

export interface WechatClawRuntimeSendResult {
  accountId: string;
  sentAt: string;
  status: "sent" | "skipped";
  providerMessageRef: string | null;
  detail: string | null;
}

export interface WechatClawRuntimeLogoutResult {
  accountId: string;
  actedAt: string;
  detail: string;
  session: WechatClawRuntimeSessionView | null;
}

export interface WechatClawRuntimeReadyMessage {
  type: "ready";
  port: number;
}

export interface WechatClawAccountSessionRecord {
  channelAccountId: string;
  status: WechatClawRuntimeLoginStatus;
  loginSessionKey: string | null;
  loginQrcode: string | null;
  qrCodeUrl: string | null;
  qrCodeSourceUrl: string | null;
  providerAccountId: string | null;
  apiBaseUrl: string | null;
  token: string | null;
  userId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  loginStartedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WechatClawPollCheckpointRecord {
  channelAccountId: string;
  cursor: string | null;
  latestExternalEventId: string | null;
  updatedAt: string;
}

export interface WechatClawContextTokenRecord {
  channelAccountId: string;
  conversationKey: string;
  externalUserId: string;
  token: string;
  status: string;
  expiresAt: string | null;
  updatedAt: string;
}

export interface WechatClawDeliveryReceiptRecord {
  channelAccountId: string;
  providerMessageRef: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface WechatClawQrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
}

export interface WechatClawQrStatusResponse {
  status?: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

export interface WechatClawGetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WechatClawUpstreamMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface WechatClawGetConfigResponse {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface WechatClawUpstreamMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: WechatClawUpstreamMessageItem[];
  context_token?: string;
}

export interface WechatClawUpstreamMessageItem {
  type?: number;
  text_item?: {
    text?: string;
  };
}
