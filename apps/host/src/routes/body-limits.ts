// 会话消息可能内嵌 base64 图片，跨 HOST 代理入口也必须至少允许同样大小。
export const SESSION_MESSAGE_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
